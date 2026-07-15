use rusqlite::{params, Connection};
use serde::Serialize;
use serde_json::Value;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

mod schema;
mod storage;
mod validation;

#[cfg(test)]
use schema::SCHEMA_V2_INDEX_STATEMENTS;
use schema::{configure_connection, run_migrations};
use storage::{
    flatten_snapshot_messages, legacy_has_runtime_snapshot, load_runtime_snapshot_at_path,
    save_runtime_snapshot_at_path,
};
#[cfg(test)]
use storage::{json_string, save_runtime_snapshot_in_transaction, string_at};
use validation::{
    now_iso, sanitize_image_provider_settings, sanitize_provider_settings, sanitize_snapshot,
};

const DATABASE_FILENAME: &str = "local-first-ai-rpg-runtime.db";
const LEGACY_DATABASE_FILENAME: &str = "runtime.db";
const APP_DATA_DIR_OVERRIDE_ENV: &str = "LOCAL_FIRST_AI_RPG_RUNTIME_APP_DATA_DIR";
/// Latest schema version. v2 backfills indexes that were retroactively added to
/// v1; v3 rebuilds the affected tables so historical installs also receive the
/// foreign-key and CHECK constraints that SQLite cannot add with ALTER TABLE.
const SCHEMA_VERSION: i64 = 3;
const RUNTIME_CHAT_ID: &str = "chat_local_cards_runtime";
const RUNTIME_BRANCH_ID: &str = "branch_local_cards_runtime";
const RUNTIME_SNAPSHOT_CHARACTER_ID: &str = "char_local_cards_runtime_snapshot";
const RUNTIME_SESSION_IDS_METADATA_KEY: &str = "__runtimeChatSessionIds";
const MAX_SNAPSHOT_BYTES: usize = 10 * 1024 * 1024;
const MAX_CARDS: usize = 500;
const MAX_CHAT_SESSIONS: usize = 1_000;
const MAX_MESSAGES: usize = 10_000;
const MAX_PROMPT_RUNS: usize = 5_000;
const MAX_GENERATED_MAPS: usize = 100;
const MAX_ID_CHARS: usize = 160;
const MAX_TEXT_CHARS: usize = 200_000;
const BACKUP_DIR_NAME: &str = "backups";
const BACKUP_FILE_PREFIX: &str = "runtime-backup-";
const ARCHIVE_FILE_PREFIX: &str = "runtime-archive-";
const BACKUP_KEEP_COUNT: usize = 5;
/// Shown on the recovery gate when a persisted snapshot row exists but its
/// payload cannot be read; deliberately leaks no storage internals.
const CORRUPT_SNAPSHOT_MESSAGE: &str =
    "Saved data is present but could not be read. Retry, or archive it and start fresh.";

#[derive(Debug)]
pub(crate) enum RuntimeRepositoryError {
    Validation(String),
    Storage,
}

type RepoResult<T> = Result<T, RuntimeRepositoryError>;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MigrationRun {
    version: i64,
    name: &'static str,
    status: &'static str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RuntimeRepositoryInitialization {
    backend: &'static str,
    schema_version: i64,
    migrations: Vec<MigrationRun>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LoadRuntimeSnapshotResponse {
    snapshot: Option<Value>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SaveRuntimeSnapshotResponse {
    saved: bool,
}

pub(crate) fn initialize_runtime_repository(
    app: AppHandle,
    database_path: Option<String>,
) -> RepoResult<RuntimeRepositoryInitialization> {
    let path = resolve_database_path(&app, database_path)?;
    let migrations = initialize_repository_at_path(&path)?;
    Ok(RuntimeRepositoryInitialization {
        backend: "tauri-sqlite",
        schema_version: SCHEMA_VERSION,
        migrations,
    })
}

pub(crate) fn load_runtime_snapshot(
    app: AppHandle,
    database_path: Option<String>,
) -> RepoResult<LoadRuntimeSnapshotResponse> {
    let path = resolve_database_path(&app, database_path)?;
    Ok(LoadRuntimeSnapshotResponse {
        snapshot: load_runtime_snapshot_at_path(&path)?,
    })
}

pub(crate) fn save_runtime_snapshot(
    app: AppHandle,
    database_path: Option<String>,
    snapshot: Value,
) -> RepoResult<SaveRuntimeSnapshotResponse> {
    let path = resolve_database_path(&app, database_path)?;
    save_runtime_snapshot_at_path(&path, snapshot)?;
    Ok(SaveRuntimeSnapshotResponse { saved: true })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BackupRuntimeDatabaseResponse {
    backed_up_to: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ArchiveRuntimeDatabaseResponse {
    archived_to: Option<String>,
}

pub(crate) fn backup_runtime_database(
    app: AppHandle,
    database_path: Option<String>,
) -> RepoResult<BackupRuntimeDatabaseResponse> {
    let path = resolve_database_path(&app, database_path)?;
    Ok(BackupRuntimeDatabaseResponse {
        backed_up_to: backup_database_at_path(&path)?,
    })
}

pub(crate) fn archive_runtime_database(
    app: AppHandle,
    database_path: Option<String>,
) -> RepoResult<ArchiveRuntimeDatabaseResponse> {
    let path = resolve_database_path(&app, database_path)?;
    Ok(ArchiveRuntimeDatabaseResponse {
        archived_to: archive_database_at_path(&path)?,
    })
}

fn backup_database_at_path(path: &Path) -> RepoResult<Option<String>> {
    if !path.is_file() {
        return Ok(None);
    }
    let backup_dir = backup_directory_for(path)?;
    let target = unique_backup_target(&backup_dir, BACKUP_FILE_PREFIX)?;
    let source = Connection::open(path).map_err(|_| RuntimeRepositoryError::Storage)?;
    source
        .execute("VACUUM INTO ?1", params![target.to_string_lossy().as_ref()])
        .map_err(|_| RuntimeRepositoryError::Storage)?;
    prune_backup_files(&backup_dir, BACKUP_KEEP_COUNT)?;
    Ok(Some(target.to_string_lossy().into_owned()))
}

fn archive_database_at_path(path: &Path) -> RepoResult<Option<String>> {
    if !path.is_file() {
        return Ok(None);
    }
    let backup_dir = backup_directory_for(path)?;
    let target = unique_backup_target(&backup_dir, ARCHIVE_FILE_PREFIX)?;
    if std::fs::rename(path, &target).is_err() {
        std::fs::copy(path, &target).map_err(|_| RuntimeRepositoryError::Storage)?;
        std::fs::remove_file(path).map_err(|_| RuntimeRepositoryError::Storage)?;
    }
    Ok(Some(target.to_string_lossy().into_owned()))
}

fn backup_directory_for(database_path: &Path) -> RepoResult<PathBuf> {
    let parent = database_path
        .parent()
        .ok_or(RuntimeRepositoryError::Storage)?;
    let backup_dir = parent.join(BACKUP_DIR_NAME);
    std::fs::create_dir_all(&backup_dir).map_err(|_| RuntimeRepositoryError::Storage)?;
    Ok(backup_dir)
}

/// Builds `<prefix><UTC stamp>-<NNNN>.db`. The zero-padded sequence always
/// advances past the highest existing one for the same stamp (never reusing a
/// pruned slot), so lexicographic file-name order equals creation order and
/// pruning can sort by name alone.
fn unique_backup_target(backup_dir: &Path, prefix: &str) -> RepoResult<PathBuf> {
    // Colon-free UTC stamp: Windows rejects ':' in file names.
    let stamp = chrono::Utc::now().format("%Y%m%dT%H%M%SZ");
    let base = format!("{prefix}{stamp}-");
    let next_sequence = std::fs::read_dir(backup_dir)
        .map_err(|_| RuntimeRepositoryError::Storage)?
        .filter_map(|entry| entry.ok())
        .filter_map(|entry| entry.file_name().to_str().map(String::from))
        .filter_map(|name| {
            name.strip_prefix(&base)
                .and_then(|rest| rest.strip_suffix(".db"))
                .and_then(|sequence| sequence.parse::<u32>().ok())
        })
        .max()
        .map_or(0, |max| max + 1);
    if next_sequence > 9_999 {
        return Err(RuntimeRepositoryError::Storage);
    }
    Ok(backup_dir.join(format!("{base}{next_sequence:04}.db")))
}

fn prune_backup_files(backup_dir: &Path, keep: usize) -> RepoResult<()> {
    let entries = std::fs::read_dir(backup_dir).map_err(|_| RuntimeRepositoryError::Storage)?;
    let mut backups: Vec<PathBuf> = entries
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.path())
        .filter(|path| {
            path.is_file()
                && path
                    .file_name()
                    .and_then(|name| name.to_str())
                    .is_some_and(|name| name.starts_with(BACKUP_FILE_PREFIX))
        })
        .collect();
    // Newest first: names embed a fixed-width UTC stamp plus sequence, so
    // descending name order is descending creation order.
    backups.sort_by(|a, b| b.file_name().cmp(&a.file_name()));
    for stale in backups.iter().skip(keep) {
        let _ = std::fs::remove_file(stale);
    }
    Ok(())
}

pub(crate) fn redact_storage_error(error: RuntimeRepositoryError) -> String {
    match error {
        RuntimeRepositoryError::Validation(message) => message,
        RuntimeRepositoryError::Storage => {
            "Runtime repository operation failed. Storage details were redacted.".to_string()
        }
    }
}

pub(crate) fn initialize_smoke_repository_from_env() -> RepoResult<Option<PathBuf>> {
    let Some(app_data_dir) = resolve_smoke_app_data_dir_override()? else {
        return Ok(None);
    };
    std::fs::create_dir_all(&app_data_dir).map_err(|_| RuntimeRepositoryError::Storage)?;
    let path = app_data_dir.join(DATABASE_FILENAME);
    initialize_repository_at_path(&path)?;
    Ok(Some(path))
}

fn resolve_database_path(app: &AppHandle, database_path: Option<String>) -> RepoResult<PathBuf> {
    if let Some(database_path) = database_path {
        return resolve_development_database_path(&database_path);
    }
    if let Some(app_data_dir) = resolve_smoke_app_data_dir_override()? {
        std::fs::create_dir_all(&app_data_dir).map_err(|_| RuntimeRepositoryError::Storage)?;
        return Ok(app_data_dir.join(DATABASE_FILENAME));
    }

    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|_| RuntimeRepositoryError::Storage)?;
    std::fs::create_dir_all(&app_data_dir).map_err(|_| RuntimeRepositoryError::Storage)?;

    let primary = app_data_dir.join(DATABASE_FILENAME);
    let legacy = app_data_dir.join(LEGACY_DATABASE_FILENAME);
    if !primary.exists() && legacy.exists() && legacy_has_runtime_snapshot(&legacy) {
        std::fs::copy(&legacy, &primary).map_err(|_| RuntimeRepositoryError::Storage)?;
    }

    Ok(primary)
}

fn resolve_smoke_app_data_dir_override() -> RepoResult<Option<PathBuf>> {
    let Ok(raw_path) = std::env::var(APP_DATA_DIR_OVERRIDE_ENV) else {
        return Ok(None);
    };
    let trimmed = raw_path.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }

    let path = PathBuf::from(trimmed);
    if !path.is_absolute() {
        return Err(RuntimeRepositoryError::Validation(format!(
            "{APP_DATA_DIR_OVERRIDE_ENV} must be an absolute temp directory path."
        )));
    }
    let temp_root = std::env::temp_dir();
    if !path.starts_with(&temp_root) {
        return Err(RuntimeRepositoryError::Validation(format!(
            "{APP_DATA_DIR_OVERRIDE_ENV} must stay under the system temp directory."
        )));
    }

    Ok(Some(path))
}

fn resolve_development_database_path(input: &str) -> RepoResult<PathBuf> {
    #[cfg(not(debug_assertions))]
    {
        let _ = input;
        return Err(RuntimeRepositoryError::Validation(
            "databasePath is available only in development and tests.".to_string(),
        ));
    }

    #[cfg(debug_assertions)]
    {
        let path = PathBuf::from(input);
        if path.is_absolute() {
            return Err(RuntimeRepositoryError::Validation(
                "databasePath must be relative to the development runtime data directory."
                    .to_string(),
            ));
        }
        if path.as_os_str().is_empty()
            || path
                .components()
                .any(|component| matches!(component, std::path::Component::ParentDir))
        {
            return Err(RuntimeRepositoryError::Validation(
                "databasePath cannot contain path traversal.".to_string(),
            ));
        }
        if path.file_name().is_none() {
            return Err(RuntimeRepositoryError::Validation(
                "databasePath must include a database file name.".to_string(),
            ));
        }
        let base = std::env::temp_dir().join("local-first-ai-rpg-runtime-dev");
        let resolved = base.join(path);
        if let Some(parent) = resolved.parent() {
            if !parent.as_os_str().is_empty() {
                std::fs::create_dir_all(parent).map_err(|_| RuntimeRepositoryError::Storage)?;
            }
        }
        Ok(resolved)
    }
}

fn initialize_repository_at_path(path: &Path) -> RepoResult<Vec<MigrationRun>> {
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent).map_err(|_| RuntimeRepositoryError::Storage)?;
        }
    }

    let mut conn = Connection::open(path).map_err(|_| RuntimeRepositoryError::Storage)?;
    configure_connection(&conn)?;
    run_migrations(&mut conn, path)
}

fn open_migrated_connection(path: &Path) -> RepoResult<Connection> {
    initialize_repository_at_path(path)?;
    let conn = Connection::open(path).map_err(|_| RuntimeRepositoryError::Storage)?;
    configure_connection(&conn)?;
    Ok(conn)
}

#[cfg(test)]
mod tests;
