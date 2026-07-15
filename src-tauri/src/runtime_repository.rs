use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::Serialize;
use serde_json::{json, Map, Value};
use std::collections::{BTreeSet, HashMap};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

mod schema;
mod validation;

#[cfg(test)]
use schema::SCHEMA_V2_INDEX_STATEMENTS;
use schema::{configure_connection, run_migrations};
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

fn load_runtime_snapshot_at_path(path: &Path) -> RepoResult<Option<Value>> {
    let conn = open_migrated_connection(path)?;
    let stored = conn
        .query_row(
            "SELECT profile_json, updated_at FROM characters WHERE id = ?1 LIMIT 1",
            params![RUNTIME_SNAPSHOT_CHARACTER_ID],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )
        .optional()
        .map_err(|_| RuntimeRepositoryError::Storage)?;
    let Some((profile_json, updated_at)) = stored else {
        return Ok(None);
    };

    // The snapshot row exists, so this is an established install, not a fresh
    // database. If its payload cannot be parsed into a usable snapshot, fail
    // closed (Err) instead of reporting an empty snapshot (Ok(None)): otherwise
    // desktop hydration would treat the corruption as a new install and autosave
    // would overwrite the real (but unreadable) row with starter state, when it
    // must route the user to the recovery gate instead.
    let profile: Value = serde_json::from_str(&profile_json)
        .map_err(|_| RuntimeRepositoryError::Validation(CORRUPT_SNAPSHOT_MESSAGE.to_string()))?;
    let mut snapshot = profile.get("snapshot").cloned().unwrap_or(Value::Null);
    let Some(object) = snapshot.as_object_mut() else {
        return Err(RuntimeRepositoryError::Validation(
            CORRUPT_SNAPSHOT_MESSAGE.to_string(),
        ));
    };
    if !matches!(object.get("cards"), Some(Value::Array(_))) {
        return Err(RuntimeRepositoryError::Validation(
            CORRUPT_SNAPSHOT_MESSAGE.to_string(),
        ));
    }

    let runtime_branch_id = conn
        .query_row(
            "SELECT active_branch_id FROM chats WHERE id = ?1 LIMIT 1",
            params![RUNTIME_CHAT_ID],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|_| RuntimeRepositoryError::Storage)?;
    let runtime_rows_are_authoritative = runtime_branch_id.is_some();
    let branch_id = runtime_branch_id.unwrap_or_else(|| RUNTIME_BRANCH_ID.to_string());
    let normalized_messages = if runtime_rows_are_authoritative {
        load_normalized_messages(&conn, &branch_id)?
    } else {
        Vec::new()
    };

    let cards = overlay_normalized_card_data(
        &conn,
        object
            .get("cards")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default(),
        runtime_rows_are_authoritative,
    )?;
    object.insert("version".to_string(), json!(2));
    object.insert(
        "theme".to_string(),
        if object.get("theme").and_then(Value::as_str) == Some("light") {
            json!("light")
        } else {
            json!("dark")
        },
    );
    let active_card_id = object
        .get("activeCardId")
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)
        .or_else(|| {
            cards
                .first()
                .and_then(Value::as_object)
                .and_then(|card| card.get("id"))
                .and_then(Value::as_str)
                .map(ToOwned::to_owned)
        })
        .unwrap_or_default();
    object.insert("activeCardId".to_string(), json!(active_card_id));
    object.insert("cards".to_string(), Value::Array(cards));

    if runtime_rows_are_authoritative || !matches!(object.get("messages"), Some(Value::Array(_))) {
        object.insert(
            "messages".to_string(),
            Value::Array(
                normalized_messages
                    .iter()
                    .map(strip_runtime_message_metadata)
                    .collect(),
            ),
        );
    }
    if runtime_rows_are_authoritative || !matches!(object.get("promptRuns"), Some(Value::Array(_)))
    {
        object.insert(
            "promptRuns".to_string(),
            Value::Array(load_normalized_prompt_runs(&conn)?),
        );
    }
    if let Some(chat_sessions) = build_runtime_chat_sessions(
        object.get("chatSessions"),
        &normalized_messages,
        runtime_rows_are_authoritative,
    ) {
        object.insert("chatSessions".to_string(), chat_sessions);
    } else {
        object.remove("chatSessions");
    }
    if let Some(active_chat_ids) = sanitize_string_record(object.get("activeChatIds")) {
        object.insert("activeChatIds".to_string(), active_chat_ids);
    } else {
        object.remove("activeChatIds");
    }
    if !matches!(object.get("providerKeyStatus"), Some(Value::String(_))) {
        object.insert(
            "providerKeyStatus".to_string(),
            json!("No plaintext keys stored."),
        );
    }
    if let Some(provider_settings) = sanitize_provider_settings(object.get("providerSettings"))? {
        object.insert("providerSettings".to_string(), provider_settings);
    } else {
        object.remove("providerSettings");
    }
    if let Some(image_provider_settings) =
        sanitize_image_provider_settings(object.get("imageProviderSettings"))?
    {
        object.insert("imageProviderSettings".to_string(), image_provider_settings);
    } else {
        object.remove("imageProviderSettings");
    }
    if !matches!(object.get("runtimeSettings"), Some(Value::Object(_))) {
        object.remove("runtimeSettings");
    }
    if runtime_rows_are_authoritative {
        object.insert(
            "generatedMaps".to_string(),
            Value::Array(load_normalized_generated_maps(&conn, object)?),
        );
    } else if !matches!(object.get("generatedMaps"), Some(Value::Array(_))) {
        object.insert("generatedMaps".to_string(), Value::Array(Vec::new()));
    }
    if !matches!(object.get("savedAt"), Some(Value::String(_))) {
        object.insert("savedAt".to_string(), json!(updated_at));
    }

    Ok(Some(snapshot))
}

fn save_runtime_snapshot_at_path(path: &Path, snapshot: Value) -> RepoResult<()> {
    let mut snapshot = sanitize_snapshot(snapshot)?;
    let mut conn = open_migrated_connection(path)?;
    let tx = conn
        .transaction()
        .map_err(|_| RuntimeRepositoryError::Storage)?;
    save_runtime_snapshot_in_transaction(&tx, &mut snapshot, None)?;
    tx.commit().map_err(|_| RuntimeRepositoryError::Storage)
}

fn save_runtime_snapshot_in_transaction(
    tx: &Transaction<'_>,
    snapshot: &mut Value,
    fail_after_prune: Option<&str>,
) -> RepoResult<()> {
    ensure_runtime_chat(tx)?;
    let previous_snapshot = load_previous_snapshot(tx)?;
    upsert_snapshot_character(tx, snapshot)?;
    save_provider_config(tx, snapshot)?;
    prune_deleted_runtime_rows(tx, snapshot, previous_snapshot.as_ref())?;
    if fail_after_prune.is_some() {
        return Err(RuntimeRepositoryError::Validation(
            "Injected repository failure after prune.".to_string(),
        ));
    }
    save_card_data(tx, snapshot)?;
    save_messages(tx, snapshot)?;
    save_prompt_runs(tx, snapshot)?;
    Ok(())
}

fn overlay_normalized_card_data(
    conn: &Connection,
    cards: Vec<Value>,
    authoritative: bool,
) -> RepoResult<Vec<Value>> {
    let memories = load_memory_rows(conn)?;
    let rpg_snapshots = load_rpg_rows(conn)?;
    let lorebooks_by_card = if authoritative {
        load_lorebooks_by_card(conn)?
    } else {
        HashMap::new()
    };
    let mut result = Vec::with_capacity(cards.len());

    for mut card in cards {
        let Some(card_object) = card.as_object_mut() else {
            result.push(card);
            continue;
        };
        let card_id = card_object
            .get("id")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();

        if authoritative {
            card_object.remove("memory");
            card_object.remove("lorebooks");
            card_object.remove("rpg");
            let mut lorebooks = lorebooks_by_card.get(&card_id).cloned().unwrap_or_default();
            for lorebook in lorebooks.iter_mut() {
                let Some(lorebook_object) = lorebook.as_object_mut() else {
                    continue;
                };
                let Some(lorebook_id) = lorebook_object.get("id").and_then(Value::as_str) else {
                    continue;
                };
                let entries = load_lorebook_entries(conn, lorebook_id)?;
                lorebook_object.insert("entries".to_string(), Value::Array(entries));
            }
            card_object.insert("lorebooks".to_string(), Value::Array(lorebooks));
        } else if let Some(Value::Array(lorebooks)) = card_object.get_mut("lorebooks") {
            for lorebook in lorebooks.iter_mut() {
                let Some(lorebook_object) = lorebook.as_object_mut() else {
                    continue;
                };
                let Some(lorebook_id) = lorebook_object.get("id").and_then(Value::as_str) else {
                    continue;
                };
                let entries = load_lorebook_entries(conn, lorebook_id)?;
                if !entries.is_empty() {
                    lorebook_object.insert("entries".to_string(), Value::Array(entries));
                }
            }
        }

        let card_memories: Vec<Value> = memories
            .iter()
            .filter(|memory| memory.related_character_ids.iter().any(|id| id == &card_id))
            .map(|memory| {
                json!({
                    "id": memory.id,
                    "label": memory.category.strip_prefix("card_memory:").unwrap_or(&memory.category),
                    "detail": memory.text,
                })
            })
            .collect();
        if authoritative || !card_memories.is_empty() {
            card_object.insert("memory".to_string(), Value::Array(card_memories));
        }

        if let Some(rpg) = rpg_snapshots.get(&card_id) {
            card_object.insert("rpg".to_string(), rpg.clone());
        }
        result.push(card);
    }

    Ok(result)
}

fn load_normalized_messages(conn: &Connection, branch_id: &str) -> RepoResult<Vec<Value>> {
    let mut statement = conn
        .prepare(
            "SELECT id, role, content, metadata_json FROM messages WHERE chat_id = ?1 AND branch_id = ?2 ORDER BY created_at ASC",
        )
        .map_err(|_| RuntimeRepositoryError::Storage)?;
    let rows = statement
        .query_map(params![RUNTIME_CHAT_ID, branch_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
            ))
        })
        .map_err(|_| RuntimeRepositoryError::Storage)?;

    let mut messages = Vec::new();
    for row in rows {
        let (id, role, content, metadata_json) =
            row.map_err(|_| RuntimeRepositoryError::Storage)?;
        let mut object = parse_json(&metadata_json, json!({}))
            .as_object()
            .cloned()
            .unwrap_or_default();
        object.insert("id".to_string(), json!(id));
        object.insert("role".to_string(), json!(normalize_message_role(&role)));
        object.insert("content".to_string(), json!(content));
        messages.push(Value::Object(object));
    }
    Ok(messages)
}

fn strip_runtime_message_metadata(message: &Value) -> Value {
    let Some(object) = message.as_object() else {
        return message.clone();
    };
    let mut public_message = object.clone();
    public_message.remove(RUNTIME_SESSION_IDS_METADATA_KEY);
    Value::Object(public_message)
}

fn build_runtime_chat_sessions(
    snapshot_sessions: Option<&Value>,
    normalized_messages: &[Value],
    runtime_rows_are_authoritative: bool,
) -> Option<Value> {
    let sessions = snapshot_sessions?.as_array()?;
    if !runtime_rows_are_authoritative {
        return Some(Value::Array(sessions.clone()));
    }

    let public_messages: Vec<Value> = normalized_messages
        .iter()
        .map(strip_runtime_message_metadata)
        .collect();
    let mut messages_by_session: HashMap<String, Vec<Value>> = HashMap::new();
    for message in normalized_messages {
        for session_id in string_vec_at(message, RUNTIME_SESSION_IDS_METADATA_KEY) {
            messages_by_session
                .entry(session_id)
                .or_default()
                .push(strip_runtime_message_metadata(message));
        }
    }

    let rebuilt: Vec<Value> = sessions
        .iter()
        .enumerate()
        .map(|(index, session)| {
            let mut session = session.clone();
            let Some(object) = session.as_object_mut() else {
                return session;
            };
            let session_id = object.get("id").and_then(Value::as_str).unwrap_or_default();
            let messages = messages_by_session
                .get(session_id)
                .cloned()
                .unwrap_or_else(|| {
                    if index == 0 {
                        public_messages.clone()
                    } else {
                        Vec::new()
                    }
                });
            object.insert("messages".to_string(), Value::Array(messages));
            session
        })
        .collect();
    Some(Value::Array(rebuilt))
}

fn load_normalized_prompt_runs(conn: &Connection) -> RepoResult<Vec<Value>> {
    let mut statement = conn
        .prepare(
            "SELECT id, chat_id, provider, model, compiled_prompt, included_lore_entry_ids_json, response_text, state_changes_json, request_json, model_settings_json FROM prompt_runs WHERE chat_id = ?1 ORDER BY created_at ASC",
        )
        .map_err(|_| RuntimeRepositoryError::Storage)?;
    let rows = statement
        .query_map(params![RUNTIME_CHAT_ID], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, Option<String>>(6)?,
                row.get::<_, Option<String>>(7)?,
                row.get::<_, String>(8)?,
                row.get::<_, String>(9)?,
            ))
        })
        .map_err(|_| RuntimeRepositoryError::Storage)?;

    let mut prompt_runs = Vec::new();
    for row in rows {
        let (
            id,
            chat_id,
            provider,
            model,
            compiled_prompt,
            included_lore_entry_ids_json,
            response_text,
            state_changes_json,
            request_json,
            model_settings_json,
        ) = row.map_err(|_| RuntimeRepositoryError::Storage)?;
        let request = parse_json(&request_json, json!({}));
        let state_changes = parse_json(&state_changes_json.unwrap_or_default(), json!({}));
        let model_settings = parse_json(&model_settings_json, json!({}));
        let mut object = Map::new();
        object.insert("id".to_string(), json!(id));
        object.insert(
            "cardId".to_string(),
            json!(string_at(&request, "cardId", "")),
        );
        object.insert(
            "chatId".to_string(),
            json!(string_at(&request, "chatId", &chat_id)),
        );
        object.insert("compiledPrompt".to_string(), json!(compiled_prompt));
        object.insert(
            "response".to_string(),
            json!(response_text.unwrap_or_default()),
        );
        object.insert("provider".to_string(), json!(provider));
        object.insert("model".to_string(), json!(model));
        object.insert(
            "tokenEstimate".to_string(),
            json!(number_at(&model_settings, "tokenEstimate", 0.0) as i64),
        );
        object.insert(
            "includedLayerIds".to_string(),
            string_array_at(&request, "includedLayerIds"),
        );
        object.insert(
            "includedLoreEntryIds".to_string(),
            parse_json(&included_lore_entry_ids_json, json!([])),
        );
        object.insert(
            "warnings".to_string(),
            string_array_at(&state_changes, "warnings"),
        );
        object.insert(
            "stateChanges".to_string(),
            string_array_at(&state_changes, "changes"),
        );
        if matches!(state_changes.get("proposals"), Some(Value::Array(_))) {
            object.insert(
                "stateProposals".to_string(),
                state_changes
                    .get("proposals")
                    .cloned()
                    .unwrap_or_else(|| json!([])),
            );
        }
        if let Some(usage) = read_usage(model_settings.get("usage")) {
            object.insert("usage".to_string(), usage);
        }
        if matches!(model_settings.get("modelCalls"), Some(Value::Array(_))) {
            object.insert(
                "modelCalls".to_string(),
                model_settings
                    .get("modelCalls")
                    .cloned()
                    .unwrap_or_else(|| json!([])),
            );
        }
        prompt_runs.push(Value::Object(object));
    }
    Ok(prompt_runs)
}

fn load_normalized_generated_maps(
    conn: &Connection,
    snapshot_object: &Map<String, Value>,
) -> RepoResult<Vec<Value>> {
    let active_chat_ids = sanitize_string_record(snapshot_object.get("activeChatIds"))
        .and_then(|value| value.as_object().cloned())
        .unwrap_or_default();
    let mut card_id_by_chat_id = HashMap::<String, String>::new();
    for (card_id, chat_id) in active_chat_ids {
        if let Some(chat_id) = chat_id.as_str() {
            card_id_by_chat_id.insert(chat_id.to_string(), card_id);
        }
    }
    let snapshot_maps_by_id: HashMap<String, Map<String, Value>> = snapshot_object
        .get("generatedMaps")
        .and_then(Value::as_array)
        .map(|maps| {
            maps.iter()
                .filter_map(|map| {
                    let object = map.as_object()?.clone();
                    let id = object.get("id")?.as_str()?.to_string();
                    Some((id, object))
                })
                .collect()
        })
        .unwrap_or_default();
    let active_card_id = snapshot_object
        .get("activeCardId")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();

    let mut statement = conn
        .prepare(
            "SELECT id, chat_id, provider, compiled_prompt, negative_prompt, style_preset, result_uri, created_at FROM image_prompt_runs ORDER BY created_at ASC",
        )
        .map_err(|_| RuntimeRepositoryError::Storage)?;
    let rows = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, Option<String>>(4)?,
                row.get::<_, Option<String>>(5)?,
                row.get::<_, Option<String>>(6)?,
                row.get::<_, String>(7)?,
            ))
        })
        .map_err(|_| RuntimeRepositoryError::Storage)?;

    let mut maps = Vec::new();
    for row in rows {
        let (
            id,
            chat_id,
            provider,
            compiled_prompt,
            negative_prompt,
            style_preset,
            result_uri,
            created_at,
        ) = row.map_err(|_| RuntimeRepositoryError::Storage)?;
        if !card_id_by_chat_id.is_empty()
            && !card_id_by_chat_id.contains_key(&chat_id)
            && chat_id != RUNTIME_CHAT_ID
        {
            continue;
        }
        let mut object = snapshot_maps_by_id.get(&id).cloned().unwrap_or_default();
        let card_id = object
            .get("cardId")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned)
            .or_else(|| card_id_by_chat_id.get(&chat_id).cloned())
            .unwrap_or_else(|| active_card_id.clone());
        object.insert("id".to_string(), json!(id));
        object.insert("cardId".to_string(), json!(card_id));
        object.insert("chatId".to_string(), json!(chat_id));
        object.insert("prompt".to_string(), json!(compiled_prompt));
        if let Some(negative_prompt) = negative_prompt {
            object.insert("negativePrompt".to_string(), json!(negative_prompt));
        }
        if let Some(provider) = provider {
            object.insert("provider".to_string(), json!(provider));
        }
        if let Some(style_preset) = style_preset {
            object.insert("model".to_string(), json!(style_preset));
        }
        if !matches!(object.get("status"), Some(Value::String(_))) {
            object.insert(
                "status".to_string(),
                json!(if result_uri.is_some() {
                    "generated"
                } else {
                    "prompt_ready"
                }),
            );
        }
        if let Some(result_uri) = result_uri {
            object.insert("imageUrl".to_string(), json!(result_uri));
        }
        object.insert("createdAt".to_string(), json!(created_at));
        maps.push(Value::Object(object));
    }
    Ok(maps)
}

fn load_memory_rows(conn: &Connection) -> RepoResult<Vec<MemoryRow>> {
    let mut statement = conn
        .prepare(
            "SELECT id, category, text, related_character_ids_json FROM memory_entries WHERE chat_id = ?1 ORDER BY updated_at ASC",
        )
        .map_err(|_| RuntimeRepositoryError::Storage)?;
    let rows = statement
        .query_map(params![RUNTIME_CHAT_ID], |row| {
            Ok(MemoryRow {
                id: row.get(0)?,
                category: row.get(1)?,
                text: row.get(2)?,
                related_character_ids: parse_json_string_array(row.get::<_, String>(3)?),
            })
        })
        .map_err(|_| RuntimeRepositoryError::Storage)?;
    collect_rows(rows)
}

fn load_rpg_rows(conn: &Connection) -> RepoResult<HashMap<String, Value>> {
    let mut statement = conn
        .prepare("SELECT world_id, payload_json FROM rpg_state_snapshots WHERE chat_id = ?1 ORDER BY created_at ASC")
        .map_err(|_| RuntimeRepositoryError::Storage)?;
    let rows = statement
        .query_map(params![RUNTIME_CHAT_ID], |row| {
            Ok((
                row.get::<_, String>(0)?,
                parse_json(&row.get::<_, String>(1)?, json!({})),
            ))
        })
        .map_err(|_| RuntimeRepositoryError::Storage)?;
    let mut map = HashMap::new();
    for row in rows {
        let (world_id, payload) = row.map_err(|_| RuntimeRepositoryError::Storage)?;
        map.insert(world_id, payload);
    }
    Ok(map)
}

fn load_lorebooks_by_card(conn: &Connection) -> RepoResult<HashMap<String, Vec<Value>>> {
    let mut statement = conn
        .prepare("SELECT id, name, description FROM lorebooks WHERE description LIKE 'card:%' ORDER BY updated_at ASC")
        .map_err(|_| RuntimeRepositoryError::Storage)?;
    let rows = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
            ))
        })
        .map_err(|_| RuntimeRepositoryError::Storage)?;

    let mut lorebooks_by_card: HashMap<String, Vec<Value>> = HashMap::new();
    for row in rows {
        let (id, name, description) = row.map_err(|_| RuntimeRepositoryError::Storage)?;
        let Some(description) = description else {
            continue;
        };
        let Some(card_id) = description.strip_prefix("card:") else {
            continue;
        };
        lorebooks_by_card
            .entry(card_id.to_string())
            .or_default()
            .push(json!({
                "id": id,
                "name": name,
                "description": description,
            }));
    }
    Ok(lorebooks_by_card)
}

fn load_lorebook_entries(conn: &Connection, lorebook_id: &str) -> RepoResult<Vec<Value>> {
    let mut statement = conn
        .prepare(
            "SELECT id, title, content, constant, triggers_json FROM lorebook_entries WHERE lorebook_id = ?1 ORDER BY updated_at ASC",
        )
        .map_err(|_| RuntimeRepositoryError::Storage)?;
    let rows = statement
        .query_map(params![lorebook_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, i64>(3)?,
                parse_json(&row.get::<_, String>(4)?, json!({})),
            ))
        })
        .map_err(|_| RuntimeRepositoryError::Storage)?;

    let mut entries = Vec::new();
    for row in rows {
        let (id, title, content, constant, triggers) =
            row.map_err(|_| RuntimeRepositoryError::Storage)?;
        entries.push(json!({
            "id": id,
            "title": title,
            "content": content,
            "enabled": bool_at(&triggers, "enabled", true),
            "constant": constant == 1,
            "keys": string_array_at(&triggers, "keys"),
            "secondaryKeys": string_array_at(&triggers, "secondaryKeys"),
            "insertionOrder": number_at(&triggers, "insertionOrder", 100.0),
            "priority": number_at(&triggers, "priority", 0.0),
            "probability": number_at(&triggers, "probability", 100.0),
            "caseSensitive": bool_at(&triggers, "caseSensitive", false),
            "wholeWord": bool_at(&triggers, "wholeWord", false),
        }));
    }
    Ok(entries)
}

fn load_previous_snapshot(tx: &Transaction<'_>) -> RepoResult<Option<Value>> {
    let profile_json = tx
        .query_row(
            "SELECT profile_json FROM characters WHERE id = ?1 LIMIT 1",
            params![RUNTIME_SNAPSHOT_CHARACTER_ID],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|_| RuntimeRepositoryError::Storage)?;
    Ok(profile_json.and_then(|profile_json| {
        parse_json(&profile_json, json!({}))
            .get("snapshot")
            .cloned()
    }))
}

fn upsert_snapshot_character(tx: &Transaction<'_>, snapshot: &Value) -> RepoResult<()> {
    let now = now_iso();
    let created_at = tx
        .query_row(
            "SELECT created_at FROM characters WHERE id = ?1 LIMIT 1",
            params![RUNTIME_SNAPSHOT_CHARACTER_ID],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|_| RuntimeRepositoryError::Storage)?
        .unwrap_or_else(|| now.clone());

    tx.execute(
        "INSERT OR REPLACE INTO characters (id, name, description, profile_json, source, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            RUNTIME_SNAPSHOT_CHARACTER_ID,
            "Local-First RPG runtime snapshot",
            "Serialized card library and runtime UI state.",
            json_string(&json!({ "snapshot": snapshot })),
            "runtime-snapshot",
            created_at,
            now,
        ],
    )
    .map_err(|_| RuntimeRepositoryError::Storage)?;
    Ok(())
}

fn save_provider_config(tx: &Transaction<'_>, snapshot: &Value) -> RepoResult<()> {
    let Some(provider_settings) = sanitize_provider_settings(snapshot.get("providerSettings"))?
    else {
        return Ok(());
    };
    let provider_id = string_at(&provider_settings, "providerId", "runtime");
    let display_name = string_at(&provider_settings, "displayName", "Runtime provider");
    let base_url = provider_settings
        .get("baseUrl")
        .and_then(Value::as_str)
        .map(ToOwned::to_owned);
    let model = provider_settings
        .get("model")
        .and_then(Value::as_str)
        .map(ToOwned::to_owned);
    let secret_ref = provider_settings.get("secretReference").map(json_string);
    let non_secret_settings = json!({
        "mode": provider_settings.get("mode").cloned().unwrap_or(Value::Null),
        "providerId": provider_settings.get("providerId").cloned().unwrap_or(Value::Null),
        "displayName": provider_settings.get("displayName").cloned().unwrap_or(Value::Null),
        "baseUrl": provider_settings.get("baseUrl").cloned().unwrap_or(Value::Null),
        "model": provider_settings.get("model").cloned().unwrap_or(Value::Null),
    });
    let id = format!("provider_{provider_id}");
    let now = now_iso();
    let created_at = tx
        .query_row(
            "SELECT created_at FROM model_provider_configs WHERE id = ?1 LIMIT 1",
            params![id],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|_| RuntimeRepositoryError::Storage)?
        .unwrap_or_else(|| now.clone());
    tx.execute(
        "INSERT OR REPLACE INTO model_provider_configs (id, provider_id, display_name, base_url, default_model_id, secret_ref, non_secret_settings_json, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![id, provider_id, display_name, base_url, model, secret_ref, json_string(&non_secret_settings), created_at, now],
    )
    .map_err(|_| RuntimeRepositoryError::Storage)?;
    Ok(())
}

fn prune_deleted_runtime_rows(
    tx: &Transaction<'_>,
    snapshot: &Value,
    previous_snapshot: Option<&Value>,
) -> RepoResult<()> {
    tx.execute(
        "DELETE FROM messages WHERE chat_id = ?1",
        params![RUNTIME_CHAT_ID],
    )
    .map_err(|_| RuntimeRepositoryError::Storage)?;
    tx.execute(
        "DELETE FROM prompt_runs WHERE chat_id = ?1",
        params![RUNTIME_CHAT_ID],
    )
    .map_err(|_| RuntimeRepositoryError::Storage)?;

    let previous_ids = collect_snapshot_side_table_ids(previous_snapshot);
    let current_ids = collect_snapshot_side_table_ids(Some(snapshot));
    delete_missing(
        tx,
        "image_prompt_runs",
        &previous_ids.image_prompt_run_ids,
        &current_ids.image_prompt_run_ids,
    )?;
    delete_missing(
        tx,
        "rpg_state_snapshots",
        &previous_ids.rpg_state_snapshot_ids,
        &current_ids.rpg_state_snapshot_ids,
    )?;
    delete_missing(
        tx,
        "lorebook_entries",
        &previous_ids.lorebook_entry_ids,
        &current_ids.lorebook_entry_ids,
    )?;
    delete_missing(
        tx,
        "lorebooks",
        &previous_ids.lorebook_ids,
        &current_ids.lorebook_ids,
    )?;
    Ok(())
}

fn delete_missing(
    tx: &Transaction<'_>,
    table: &str,
    previous: &BTreeSet<String>,
    current: &BTreeSet<String>,
) -> RepoResult<()> {
    let sql = format!("DELETE FROM {table} WHERE id = ?1");
    for id in previous.difference(current) {
        tx.execute(&sql, params![id])
            .map_err(|_| RuntimeRepositoryError::Storage)?;
    }
    Ok(())
}

fn save_card_data(tx: &Transaction<'_>, snapshot: &Value) -> RepoResult<()> {
    tx.execute(
        "DELETE FROM memory_entries WHERE chat_id = ?1",
        params![RUNTIME_CHAT_ID],
    )
    .map_err(|_| RuntimeRepositoryError::Storage)?;
    for card in array_at(snapshot, "cards") {
        save_memories_for_card(tx, card)?;
        save_lorebooks_for_card(tx, card)?;
        save_rpg_state_for_card(tx, card)?;
    }
    for generated_map in array_at(snapshot, "generatedMaps") {
        save_generated_map(tx, generated_map)?;
    }
    Ok(())
}

fn save_memories_for_card(tx: &Transaction<'_>, card: &Value) -> RepoResult<()> {
    let card_id = string_at(card, "id", "");
    if card_id.is_empty() {
        return Ok(());
    }
    for memory in array_at(card, "memory") {
        let Some(detail) = memory.get("detail").and_then(Value::as_str) else {
            continue;
        };
        let id = memory
            .get("id")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned)
            .unwrap_or_else(|| {
                format!(
                    "memory_{card_id}_{}",
                    detail.chars().take(24).collect::<String>()
                )
            });
        let label = string_at(memory, "label", "Memory");
        let now = now_iso();
        let created_at = tx
            .query_row(
                "SELECT created_at FROM memory_entries WHERE id = ?1 LIMIT 1",
                params![id],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(|_| RuntimeRepositoryError::Storage)?
            .unwrap_or_else(|| now.clone());
        tx.execute(
            "INSERT OR REPLACE INTO memory_entries (id, chat_id, category, text, importance, pinned, related_character_ids_json, related_event_ids_json, last_accessed_at, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![id, RUNTIME_CHAT_ID, format!("card_memory:{label}"), detail, 1.0_f64, 0_i64, json_string(&json!([card_id])), json_string(&json!([])), Option::<String>::None, created_at, now],
        )
        .map_err(|_| RuntimeRepositoryError::Storage)?;
    }
    Ok(())
}

fn save_lorebooks_for_card(tx: &Transaction<'_>, card: &Value) -> RepoResult<()> {
    let card_id = string_at(card, "id", "");
    for lorebook in array_at(card, "lorebooks") {
        let Some(lorebook_id) = lorebook.get("id").and_then(Value::as_str) else {
            continue;
        };
        let now = now_iso();
        let created_at = tx
            .query_row(
                "SELECT created_at FROM lorebooks WHERE id = ?1 LIMIT 1",
                params![lorebook_id],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(|_| RuntimeRepositoryError::Storage)?
            .unwrap_or_else(|| now.clone());
        tx.execute(
            "INSERT OR REPLACE INTO lorebooks (id, name, description, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![lorebook_id, string_at(lorebook, "name", "Card Lorebook"), format!("card:{card_id}"), created_at, now],
        )
        .map_err(|_| RuntimeRepositoryError::Storage)?;
        tx.execute(
            "DELETE FROM lorebook_entries WHERE lorebook_id = ?1",
            params![lorebook_id],
        )
        .map_err(|_| RuntimeRepositoryError::Storage)?;
        for entry in array_at(lorebook, "entries") {
            let Some(entry_id) = entry.get("id").and_then(Value::as_str) else {
                continue;
            };
            let Some(content) = entry.get("content").and_then(Value::as_str) else {
                continue;
            };
            let now = now_iso();
            let created_at = tx
                .query_row(
                    "SELECT created_at FROM lorebook_entries WHERE id = ?1 LIMIT 1",
                    params![entry_id],
                    |row| row.get::<_, String>(0),
                )
                .optional()
                .map_err(|_| RuntimeRepositoryError::Storage)?
                .unwrap_or_else(|| now.clone());
            let triggers = json!({
                "enabled": bool_at(entry, "enabled", true),
                "keys": string_array_at(entry, "keys"),
                "secondaryKeys": string_array_at(entry, "secondaryKeys"),
                "insertionOrder": number_at(entry, "insertionOrder", 100.0),
                "priority": number_at(entry, "priority", 0.0),
                "probability": number_at(entry, "probability", 100.0),
                "caseSensitive": bool_at(entry, "caseSensitive", false),
                "wholeWord": bool_at(entry, "wholeWord", false),
            });
            tx.execute(
                "INSERT OR REPLACE INTO lorebook_entries (id, lorebook_id, title, content, constant, triggers_json, token_budget, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                params![entry_id, lorebook_id, string_at(entry, "title", "Untitled lore entry"), content, if bool_at(entry, "constant", false) { 1_i64 } else { 0_i64 }, json_string(&triggers), number_at(lorebook, "tokenBudget", 800.0) as i64, created_at, now],
            )
            .map_err(|_| RuntimeRepositoryError::Storage)?;
        }
    }
    Ok(())
}

fn save_rpg_state_for_card(tx: &Transaction<'_>, card: &Value) -> RepoResult<()> {
    if string_at(card, "kind", "") != "rpg" || !matches!(card.get("rpg"), Some(Value::Object(_))) {
        return Ok(());
    }
    let card_id = string_at(card, "id", "");
    if card_id.is_empty() {
        return Ok(());
    }
    let id = format!("state_{card_id}");
    let created_at = now_iso();
    let rpg_payload = card.get("rpg").cloned().unwrap_or_else(|| json!({}));
    tx.execute(
        "INSERT OR REPLACE INTO rpg_state_snapshots (id, world_id, chat_id, branch_id, message_id, payload_json, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![id, card_id, RUNTIME_CHAT_ID, RUNTIME_BRANCH_ID, "runtime_snapshot", json_string(&rpg_payload), created_at],
    )
    .map_err(|_| RuntimeRepositoryError::Storage)?;
    Ok(())
}

fn save_generated_map(tx: &Transaction<'_>, generated_map: &Value) -> RepoResult<()> {
    let Some(id) = generated_map.get("id").and_then(Value::as_str) else {
        return Ok(());
    };
    let Some(prompt) = generated_map.get("prompt").and_then(Value::as_str) else {
        return Ok(());
    };
    let created_at = string_at(generated_map, "createdAt", &now_iso());
    tx.execute(
        "INSERT OR REPLACE INTO image_prompt_runs (id, chat_id, message_id, provider, compiled_prompt, negative_prompt, style_preset, result_uri, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            id,
            string_at(generated_map, "chatId", RUNTIME_CHAT_ID),
            Option::<String>::None,
            generated_map.get("provider").and_then(Value::as_str),
            prompt,
            generated_map.get("negativePrompt").and_then(Value::as_str),
            generated_map.get("model").and_then(Value::as_str),
            generated_map.get("imageUrl").and_then(Value::as_str),
            created_at,
        ],
    )
    .map_err(|_| RuntimeRepositoryError::Storage)?;
    Ok(())
}

fn save_messages(tx: &Transaction<'_>, snapshot: &Value) -> RepoResult<()> {
    let messages = flatten_snapshot_messages(snapshot);
    let mut previous_message_id: Option<String> = None;
    for message in messages {
        let Some(message_object) = message.as_object() else {
            continue;
        };
        let id = string_at(&message, "id", "");
        let content = string_at(&message, "content", "");
        if id.is_empty() {
            continue;
        }
        let metadata = strip_message_metadata(message_object);
        let now = now_iso();
        tx.execute(
            "INSERT INTO messages (id, chat_id, parent_message_id, branch_id, role, content, state_snapshot_id, metadata_json, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                id,
                RUNTIME_CHAT_ID,
                previous_message_id,
                RUNTIME_BRANCH_ID,
                normalize_message_role(&string_at(&message, "role", "assistant")),
                content,
                Option::<String>::None,
                json_string(&Value::Object(metadata)),
                now,
                now,
            ],
        )
        .map_err(|_| RuntimeRepositoryError::Storage)?;
        previous_message_id = Some(id);
    }
    Ok(())
}

fn save_prompt_runs(tx: &Transaction<'_>, snapshot: &Value) -> RepoResult<()> {
    let messages = flatten_snapshot_messages(snapshot);
    for run in array_at(snapshot, "promptRuns") {
        let id = string_at(run, "id", "");
        if id.is_empty() {
            continue;
        }
        let assistant_message_id = find_assistant_message_id_for_run(&messages, &id);
        let state_changes = json!({
            "changes": string_array_at(run, "stateChanges"),
            "warnings": string_array_at(run, "warnings"),
            "proposals": run.get("stateProposals").cloned().unwrap_or_else(|| json!([])),
        });
        let request = json!({
            "cardId": string_at(run, "cardId", ""),
            "chatId": string_at(run, "chatId", RUNTIME_CHAT_ID),
            "includedLayerIds": string_array_at(run, "includedLayerIds"),
        });
        let model_settings = json!({
            "tokenEstimate": number_at(run, "tokenEstimate", 0.0),
            "usage": run.get("usage").cloned().unwrap_or(Value::Null),
            "modelCalls": run.get("modelCalls").filter(|value| value.is_array()).cloned().unwrap_or_else(|| json!([])),
        });
        tx.execute(
            "INSERT INTO prompt_runs (id, chat_id, message_id, provider, model, temperature, token_budget, compiled_prompt, included_memory_ids_json, included_lore_entry_ids_json, included_state_snapshot_id, response_text, extraction_json, state_changes_json, request_json, model_settings_json, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)",
            params![
                id,
                RUNTIME_CHAT_ID,
                assistant_message_id,
                string_at(run, "provider", ""),
                string_at(run, "model", ""),
                Option::<f64>::None,
                Option::<i64>::None,
                string_at(run, "compiledPrompt", ""),
                json_string(&json!([])),
                json_string(&string_array_at(run, "includedLoreEntryIds")),
                Option::<String>::None,
                string_at(run, "response", ""),
                json_string(&json!({})),
                json_string(&state_changes),
                json_string(&request),
                json_string(&model_settings),
                now_iso(),
            ],
        )
        .map_err(|_| RuntimeRepositoryError::Storage)?;
    }
    Ok(())
}

fn ensure_runtime_chat(tx: &Transaction<'_>) -> RepoResult<()> {
    let exists = tx
        .query_row(
            "SELECT id FROM chats WHERE id = ?1 LIMIT 1",
            params![RUNTIME_CHAT_ID],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|_| RuntimeRepositoryError::Storage)?
        .is_some();
    if exists {
        return Ok(());
    }
    let now = now_iso();
    tx.execute(
        "INSERT INTO chats (id, title, mode, active_branch_id, root_state_snapshot_id, metadata_json, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            RUNTIME_CHAT_ID,
            "Local-First RPG runtime",
            "rpg",
            RUNTIME_BRANCH_ID,
            Option::<String>::None,
            json_string(&json!({ "source": "local-cards-ui" })),
            now,
            now,
        ],
    )
    .map_err(|_| RuntimeRepositoryError::Storage)?;
    tx.execute(
        "INSERT INTO message_branches (id, chat_id, name, label, root_message_id, head_message_id, base_message_id, is_active, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![RUNTIME_BRANCH_ID, RUNTIME_CHAT_ID, "Main", "Main", Option::<String>::None, Option::<String>::None, Option::<String>::None, 1_i64, now, now],
    )
    .map_err(|_| RuntimeRepositoryError::Storage)?;
    Ok(())
}

fn collect_snapshot_side_table_ids(snapshot: Option<&Value>) -> SnapshotSideTableIds {
    let mut ids = SnapshotSideTableIds::default();
    let Some(snapshot) = snapshot else {
        return ids;
    };
    for generated_map in array_at(snapshot, "generatedMaps") {
        if let Some(id) = generated_map.get("id").and_then(Value::as_str) {
            ids.image_prompt_run_ids.insert(id.to_string());
        }
    }
    for card in array_at(snapshot, "cards") {
        let card_id = string_at(card, "id", "");
        if string_at(card, "kind", "") == "rpg"
            && !card_id.is_empty()
            && matches!(card.get("rpg"), Some(Value::Object(_)))
        {
            ids.rpg_state_snapshot_ids
                .insert(format!("state_{card_id}"));
        }
        for lorebook in array_at(card, "lorebooks") {
            if let Some(lorebook_id) = lorebook.get("id").and_then(Value::as_str) {
                ids.lorebook_ids.insert(lorebook_id.to_string());
            }
            for entry in array_at(lorebook, "entries") {
                if let Some(entry_id) = entry.get("id").and_then(Value::as_str) {
                    ids.lorebook_entry_ids.insert(entry_id.to_string());
                }
            }
        }
    }
    ids
}

fn flatten_snapshot_messages(snapshot: &Value) -> Vec<Value> {
    let mut messages = Vec::<Value>::new();
    let mut positions = HashMap::<String, usize>::new();
    for message in array_at(snapshot, "messages") {
        if let Some(id) = message.get("id").and_then(Value::as_str) {
            if !positions.contains_key(id) {
                positions.insert(id.to_string(), messages.len());
                messages.push(message.clone());
            }
        }
    }
    for session in array_at(snapshot, "chatSessions") {
        let session_id = string_at(session, "id", "");
        if session_id.is_empty() {
            continue;
        }
        for message in array_at(session, "messages") {
            if let Some(id) = message.get("id").and_then(Value::as_str) {
                if let Some(position) = positions.get(id).copied() {
                    messages[position] = with_runtime_session_id(&messages[position], &session_id);
                } else {
                    positions.insert(id.to_string(), messages.len());
                    messages.push(with_runtime_session_id(message, &session_id));
                }
            }
        }
    }
    messages
}

fn with_runtime_session_id(message: &Value, session_id: &str) -> Value {
    let mut message = message.clone();
    let Some(object) = message.as_object_mut() else {
        return message;
    };
    let mut session_ids = string_vec_at(
        &Value::Object(object.clone()),
        RUNTIME_SESSION_IDS_METADATA_KEY,
    );
    if !session_ids.iter().any(|id| id == session_id) {
        session_ids.push(session_id.to_string());
    }
    object.insert(
        RUNTIME_SESSION_IDS_METADATA_KEY.to_string(),
        Value::Array(session_ids.into_iter().map(Value::String).collect()),
    );
    message
}

fn find_assistant_message_id_for_run(messages: &[Value], run_id: &str) -> Option<String> {
    let target = format!("assistant-{run_id}");
    messages
        .iter()
        .find(|message| message.get("id").and_then(Value::as_str) == Some(target.as_str()))
        .and_then(|message| message.get("id").and_then(Value::as_str))
        .map(ToOwned::to_owned)
}

fn strip_message_metadata(message: &Map<String, Value>) -> Map<String, Value> {
    let mut metadata = message.clone();
    metadata.remove("id");
    metadata.remove("role");
    metadata.remove("content");
    metadata
}

fn read_usage(value: Option<&Value>) -> Option<Value> {
    let usage = value?;
    let input_tokens = number_at(usage, "inputTokens", 0.0) as i64;
    let output_tokens = number_at(usage, "outputTokens", 0.0) as i64;
    let total_tokens =
        number_at(usage, "totalTokens", (input_tokens + output_tokens) as f64) as i64;
    (total_tokens > 0).then(|| {
        json!({
            "inputTokens": input_tokens,
            "outputTokens": output_tokens,
            "totalTokens": total_tokens,
        })
    })
}

fn sanitize_string_record(value: Option<&Value>) -> Option<Value> {
    let Value::Object(object) = value? else {
        return None;
    };
    let mut output = Map::new();
    for (key, field) in object {
        if let Some(value) = field.as_str() {
            output.insert(key.clone(), json!(value));
        }
    }
    (!output.is_empty()).then_some(Value::Object(output))
}

fn legacy_has_runtime_snapshot(path: &Path) -> bool {
    let Ok(conn) = Connection::open(path) else {
        return false;
    };
    let has_characters = conn
        .query_row(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'characters' LIMIT 1",
            [],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .ok()
        .flatten()
        .is_some();
    if !has_characters {
        return false;
    }
    conn.query_row(
        "SELECT profile_json FROM characters WHERE id = ?1 LIMIT 1",
        params![RUNTIME_SNAPSHOT_CHARACTER_ID],
        |row| row.get::<_, String>(0),
    )
    .optional()
    .ok()
    .flatten()
    .and_then(|profile_json| {
        parse_json(&profile_json, json!({}))
            .get("snapshot")
            .cloned()
    })
    .and_then(|snapshot| snapshot.get("cards").cloned())
    .is_some_and(|cards| matches!(cards, Value::Array(_)))
}

fn normalize_message_role(role: &str) -> &'static str {
    match role {
        "system" => "system",
        "user" => "user",
        "assistant" => "assistant",
        _ => "assistant",
    }
}

fn string_at(value: &Value, key: &str, fallback: &str) -> String {
    value
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or(fallback)
        .to_string()
}

fn bool_at(value: &Value, key: &str, fallback: bool) -> bool {
    value.get(key).and_then(Value::as_bool).unwrap_or(fallback)
}

fn number_at(value: &Value, key: &str, fallback: f64) -> f64 {
    value.get(key).and_then(Value::as_f64).unwrap_or(fallback)
}

fn array_at<'a>(value: &'a Value, key: &str) -> &'a [Value] {
    value
        .get(key)
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or(&[])
}

fn string_array_at(value: &Value, key: &str) -> Value {
    let items: Vec<Value> = value
        .get(key)
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(|item| json!(item))
                .collect()
        })
        .unwrap_or_default();
    Value::Array(items)
}

fn string_vec_at(value: &Value, key: &str) -> Vec<String> {
    value
        .get(key)
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(ToOwned::to_owned)
                .collect()
        })
        .unwrap_or_default()
}

fn parse_json(value: &str, fallback: Value) -> Value {
    serde_json::from_str(value).unwrap_or(fallback)
}

fn parse_json_string_array(value: String) -> Vec<String> {
    serde_json::from_str::<Vec<String>>(&value).unwrap_or_default()
}

fn json_string(value: &Value) -> String {
    serde_json::to_string(value).unwrap_or_else(|_| "{}".to_string())
}

fn collect_rows<T>(
    rows: rusqlite::MappedRows<'_, impl FnMut(&rusqlite::Row<'_>) -> rusqlite::Result<T>>,
) -> RepoResult<Vec<T>> {
    let mut output = Vec::new();
    for row in rows {
        output.push(row.map_err(|_| RuntimeRepositoryError::Storage)?);
    }
    Ok(output)
}

#[derive(Default)]
struct SnapshotSideTableIds {
    image_prompt_run_ids: BTreeSet<String>,
    lorebook_ids: BTreeSet<String>,
    lorebook_entry_ids: BTreeSet<String>,
    rpg_state_snapshot_ids: BTreeSet<String>,
}

struct MemoryRow {
    id: String,
    category: String,
    text: String,
    related_character_ids: Vec<String>,
}

#[cfg(test)]
mod tests;
