use rusqlite::{params, Connection, OptionalExtension, Transaction, TransactionBehavior};
use serde::Serialize;
use serde_json::{json, Map, Value};
use std::collections::{BTreeSet, HashMap};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

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

fn configure_connection(conn: &Connection) -> RepoResult<()> {
    conn.pragma_update(None, "foreign_keys", "ON")
        .map_err(|_| RuntimeRepositoryError::Storage)?;
    conn.busy_timeout(std::time::Duration::from_millis(5_000))
        .map_err(|_| RuntimeRepositoryError::Storage)?;
    Ok(())
}

/// Applies every absent migration in order. Static migrations use transactional
/// SQL; v3 uses a procedural table rebuild because SQLite cannot add historical
/// foreign keys or CHECK constraints with ALTER TABLE.
fn run_migrations(conn: &mut Connection, database_path: &Path) -> RepoResult<Vec<MigrationRun>> {
    conn.execute_batch(SCHEMA_MIGRATIONS_CREATE)
        .map_err(|_| RuntimeRepositoryError::Storage)?;

    let initially_applied = {
        let mut statement = conn
            .prepare("SELECT version FROM schema_migrations")
            .map_err(|_| RuntimeRepositoryError::Storage)?;
        let versions = statement
            .query_map([], |row| row.get::<_, i64>(0))
            .map_err(|_| RuntimeRepositoryError::Storage)?;
        versions
            .collect::<Result<BTreeSet<_>, _>>()
            .map_err(|_| RuntimeRepositoryError::Storage)?
    };

    let mut runs = Vec::with_capacity(MIGRATIONS.len());
    for migration in MIGRATIONS {
        let already_applied = conn
            .query_row(
                "SELECT version FROM schema_migrations WHERE version = ?1 LIMIT 1",
                params![migration.version],
                |row| row.get::<_, i64>(0),
            )
            .optional()
            .map_err(|_| RuntimeRepositoryError::Storage)?
            .is_some();

        if already_applied {
            runs.push(MigrationRun {
                version: migration.version,
                name: migration.name,
                status: "skipped",
            });
            continue;
        }

        match migration.kind {
            MigrationKind::Statements(statements) => {
                apply_statement_migration(conn, migration, statements)?;
            }
            MigrationKind::HardenCoreConstraints => {
                if initially_applied.contains(&1) || initially_applied.contains(&2) {
                    backup_database_at_path(database_path)?;
                }
                apply_core_constraint_migration(conn, migration)?;
            }
        }

        runs.push(MigrationRun {
            version: migration.version,
            name: migration.name,
            status: "applied",
        });
    }

    Ok(runs)
}

fn apply_statement_migration(
    conn: &mut Connection,
    migration: &MigrationDef,
    statements: &[&str],
) -> RepoResult<()> {
    let tx = conn
        .transaction()
        .map_err(|_| RuntimeRepositoryError::Storage)?;
    for statement in statements {
        tx.execute_batch(statement)
            .map_err(|_| RuntimeRepositoryError::Storage)?;
    }
    record_migration(&tx, migration)?;
    tx.commit().map_err(|_| RuntimeRepositoryError::Storage)
}

fn apply_core_constraint_migration(
    conn: &mut Connection,
    migration: &MigrationDef,
) -> RepoResult<()> {
    validate_historical_constraint_data(conn)?;
    conn.pragma_update(None, "foreign_keys", "OFF")
        .map_err(|_| RuntimeRepositoryError::Storage)?;

    let migration_result = (|| {
        let tx = conn
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|_| RuntimeRepositoryError::Storage)?;
        let row_counts = CORE_CONSTRAINT_REBUILDS
            .iter()
            .map(|rebuild| Ok((rebuild.table, count_table_rows(&tx, rebuild.table)?)))
            .collect::<RepoResult<Vec<_>>>()?;

        for rebuild in CORE_CONSTRAINT_REBUILDS {
            rebuild_table_with_current_constraints(&tx, rebuild)?;
        }
        for statement in SCHEMA_V2_INDEX_STATEMENTS {
            tx.execute_batch(statement)
                .map_err(|_| RuntimeRepositoryError::Storage)?;
        }
        for (table, expected) in row_counts {
            if count_table_rows(&tx, table)? != expected {
                return Err(RuntimeRepositoryError::Validation(format!(
                    "Database schema upgrade stopped because the row count changed for {table}."
                )));
            }
        }
        ensure_database_integrity(&tx)?;
        record_migration(&tx, migration)?;
        tx.commit().map_err(|_| RuntimeRepositoryError::Storage)
    })();

    let foreign_keys_restored = conn
        .pragma_update(None, "foreign_keys", "ON")
        .and_then(|()| conn.pragma_query_value(None, "foreign_keys", |row| row.get::<_, i64>(0)))
        .map(|enabled| enabled == 1)
        .unwrap_or(false);
    if !foreign_keys_restored {
        return Err(RuntimeRepositoryError::Storage);
    }
    migration_result
}

fn record_migration(tx: &Transaction<'_>, migration: &MigrationDef) -> RepoResult<()> {
    tx.execute(
        "INSERT INTO schema_migrations (version, name, applied_at) VALUES (?1, ?2, ?3)",
        params![migration.version, migration.name, now_iso()],
    )
    .map_err(|_| RuntimeRepositoryError::Storage)?;
    Ok(())
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

    let profile = parse_json(&profile_json, json!({}));
    let mut snapshot = profile.get("snapshot").cloned().unwrap_or(Value::Null);
    let Some(object) = snapshot.as_object_mut() else {
        return Ok(None);
    };
    if !matches!(object.get("cards"), Some(Value::Array(_))) {
        return Ok(None);
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
            "Local Cards runtime snapshot",
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
            "Local Cards runtime",
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

fn sanitize_snapshot(snapshot: Value) -> RepoResult<Value> {
    let serialized = serde_json::to_vec(&snapshot).map_err(|_| {
        RuntimeRepositoryError::Validation("Snapshot must be valid JSON.".to_string())
    })?;
    if serialized.len() > MAX_SNAPSHOT_BYTES {
        return Err(RuntimeRepositoryError::Validation(
            "Snapshot exceeds the 10 MB persistence limit.".to_string(),
        ));
    }
    let Some(object) = snapshot.as_object() else {
        return Err(RuntimeRepositoryError::Validation(
            "Snapshot must be a JSON object.".to_string(),
        ));
    };

    validate_array_cap(object.get("cards"), MAX_CARDS, "cards")?;
    validate_array_cap(
        object.get("chatSessions"),
        MAX_CHAT_SESSIONS,
        "chatSessions",
    )?;
    validate_array_cap(object.get("promptRuns"), MAX_PROMPT_RUNS, "promptRuns")?;
    validate_array_cap(
        object.get("generatedMaps"),
        MAX_GENERATED_MAPS,
        "generatedMaps",
    )?;
    let flattened_message_count = flatten_snapshot_messages(&snapshot).len();
    if flattened_message_count > MAX_MESSAGES {
        return Err(RuntimeRepositoryError::Validation(
            "Snapshot exceeds the message persistence limit.".to_string(),
        ));
    }
    validate_value_limits(&snapshot, None)?;

    let mut sanitized = snapshot;
    if let Some(object) = sanitized.as_object_mut() {
        object.insert("version".to_string(), json!(2));
        if let Some(provider_settings) = sanitize_provider_settings(object.get("providerSettings"))?
        {
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
        if !matches!(object.get("generatedMaps"), Some(Value::Array(_))) {
            object.insert("generatedMaps".to_string(), Value::Array(Vec::new()));
        }
        if !matches!(object.get("savedAt"), Some(Value::String(_))) {
            object.insert("savedAt".to_string(), json!(now_iso()));
        }
    }

    Ok(sanitized)
}

fn sanitize_provider_settings(value: Option<&Value>) -> RepoResult<Option<Value>> {
    let Some(Value::Object(input)) = value else {
        return Ok(None);
    };

    for (key, field) in input {
        if is_secretish_key(key) && field.as_str().is_some_and(looks_like_raw_secret) {
            return Err(RuntimeRepositoryError::Validation(
                "Provider settings cannot persist raw-looking secrets.".to_string(),
            ));
        }
    }

    let mut output = Map::new();
    for key in ["mode", "providerId", "displayName", "baseUrl", "model"] {
        if let Some(Value::String(field)) = input.get(key) {
            output.insert(key.to_string(), json!(field));
        }
    }
    if let Some(secret_reference) = sanitize_secret_reference(input.get("secretReference"))? {
        output.insert("secretReference".to_string(), secret_reference);
    }

    Ok((!output.is_empty()).then_some(Value::Object(output)))
}

fn sanitize_image_provider_settings(value: Option<&Value>) -> RepoResult<Option<Value>> {
    let Some(Value::Object(input)) = value else {
        return Ok(None);
    };

    let mut output = Map::new();
    for key in [
        "mode",
        "providerId",
        "displayName",
        "endpoint",
        "model",
        "samplerName",
        "scheduler",
    ] {
        if let Some(Value::String(field)) = input.get(key) {
            output.insert(key.to_string(), json!(field));
        }
    }
    if let Some(workflow_json) = input.get("workflowJson").and_then(Value::as_str) {
        if !workflow_json_contains_sensitive_content(workflow_json) {
            output.insert("workflowJson".to_string(), json!(workflow_json));
        }
    }
    for key in ["width", "height", "seed", "steps", "cfg", "pollTimeoutMs"] {
        if let Some(Value::Number(number)) = input.get(key) {
            output.insert(key.to_string(), Value::Number(number.clone()));
        }
    }

    Ok((!output.is_empty()).then_some(Value::Object(output)))
}

fn workflow_json_contains_sensitive_content(raw: &str) -> bool {
    if contains_raw_secret_like_token(raw) {
        return true;
    }

    match serde_json::from_str::<Value>(raw) {
        Ok(value) => workflow_value_contains_sensitive_content(&value),
        Err(_) => contains_secretish_json_key(raw),
    }
}

fn workflow_value_contains_sensitive_content(value: &Value) -> bool {
    match value {
        Value::String(text) => contains_raw_secret_like_token(text),
        Value::Array(items) => items.iter().any(workflow_value_contains_sensitive_content),
        Value::Object(object) => object.iter().any(|(key, field)| {
            is_secretish_workflow_key(key) || workflow_value_contains_sensitive_content(field)
        }),
        _ => false,
    }
}

fn is_secretish_workflow_key(key: &str) -> bool {
    let normalized: String = key
        .chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .map(|character| character.to_ascii_lowercase())
        .collect();
    normalized.contains("apikey")
        || normalized.contains("token")
        || normalized.contains("secret")
        || normalized.contains("password")
        || normalized.contains("authorization")
        || normalized.contains("bearer")
        || ((normalized.contains("auth") || normalized.contains("access"))
            && normalized.contains("key"))
}

fn contains_secretish_json_key(raw: &str) -> bool {
    let mut remaining = raw;
    while let Some(start) = remaining.find('"') {
        let after_quote = &remaining[start + 1..];
        let Some(end) = after_quote.find('"') else {
            return false;
        };
        let candidate_key = &after_quote[..end];
        let after_key = &after_quote[end + 1..];
        if after_key.trim_start().starts_with(':') && is_secretish_workflow_key(candidate_key) {
            return true;
        }
        remaining = after_key;
    }
    false
}

fn sanitize_secret_reference(value: Option<&Value>) -> RepoResult<Option<Value>> {
    let Some(Value::Object(input)) = value else {
        return Ok(None);
    };
    let Some(provider_id) = input.get("providerId").and_then(Value::as_str) else {
        return Ok(None);
    };
    let Some(secret_name) = input.get("secretName").and_then(Value::as_str) else {
        return Ok(None);
    };
    let Some(storage_kind) = input.get("storageKind").and_then(Value::as_str) else {
        return Ok(None);
    };
    let Some(storage_key) = input.get("storageKey").and_then(Value::as_str) else {
        return Ok(None);
    };
    if storage_kind == "memory-only"
        || !["os-keychain", "tauri-stronghold", "external-vault"].contains(&storage_kind)
        || storage_key != format!("{provider_id}:{secret_name}")
        || looks_like_raw_secret(storage_key)
    {
        return Ok(None);
    }
    validate_id(provider_id)?;
    validate_id(secret_name)?;
    let mut output = Map::new();
    output.insert("providerId".to_string(), json!(provider_id));
    output.insert("secretName".to_string(), json!(secret_name));
    output.insert("storageKind".to_string(), json!(storage_kind));
    output.insert("storageKey".to_string(), json!(storage_key));
    if let Some(provider_base_url) = input.get("providerBaseUrl").and_then(Value::as_str) {
        output.insert("providerBaseUrl".to_string(), json!(provider_base_url));
    }
    Ok(Some(Value::Object(output)))
}

fn validate_value_limits(value: &Value, key: Option<&str>) -> RepoResult<()> {
    match value {
        Value::String(text) => {
            if text.chars().count() > MAX_TEXT_CHARS {
                return Err(RuntimeRepositoryError::Validation(
                    "Snapshot text field exceeds the persistence limit.".to_string(),
                ));
            }
            if key.is_some_and(is_id_key) {
                validate_id(text)?;
            }
        }
        Value::Array(items) => {
            for item in items {
                validate_value_limits(item, key)?;
            }
        }
        Value::Object(object) => {
            for (child_key, child_value) in object {
                validate_value_limits(child_value, Some(child_key))?;
            }
        }
        _ => {}
    }
    Ok(())
}

fn validate_id(value: &str) -> RepoResult<()> {
    if value.chars().count() > MAX_ID_CHARS {
        return Err(RuntimeRepositoryError::Validation(
            "Snapshot id exceeds the persistence limit.".to_string(),
        ));
    }
    Ok(())
}

fn validate_array_cap(value: Option<&Value>, max: usize, label: &str) -> RepoResult<()> {
    if let Some(Value::Array(items)) = value {
        if items.len() > max {
            return Err(RuntimeRepositoryError::Validation(format!(
                "Snapshot exceeds the {label} persistence limit."
            )));
        }
    }
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

fn is_secretish_key(key: &str) -> bool {
    let key = key.to_ascii_lowercase();
    key.contains("key")
        || key.contains("token")
        || key.contains("secret")
        || key.contains("password")
}

fn looks_like_raw_secret(value: &str) -> bool {
    let trimmed = value.trim();
    (trimmed.starts_with("sk-") && trimmed.len() > 8)
        || (trimmed.len() >= 40
            && trimmed.chars().all(|character| {
                character.is_ascii_alphanumeric() || matches!(character, '_' | '-')
            }))
}

fn contains_raw_secret_like_token(value: &str) -> bool {
    value
        .split(|character: char| {
            !(character.is_ascii_alphanumeric() || matches!(character, '_' | '-'))
        })
        .any(looks_like_raw_secret)
}

fn is_id_key(key: &str) -> bool {
    let key = key.to_ascii_lowercase();
    key == "id" || key.ends_with("id") || key.ends_with("ids")
}

fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
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

const SCHEMA_MIGRATIONS_CREATE: &str = r#"CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL
)"#;

struct MigrationDef {
    version: i64,
    name: &'static str,
    kind: MigrationKind,
}

#[derive(Clone, Copy)]
enum MigrationKind {
    Statements(&'static [&'static str]),
    HardenCoreConstraints,
}

struct TableRebuildDef {
    table: &'static str,
    columns: &'static str,
}

/// Ordered migration ledger. Append new migrations; never rewrite an applied
/// one. v1 creates the current tables for fresh installs, v2 backfills missing
/// indexes, and v3 hardens real historical v1/v2 tables with the constraints
/// that were once edited into v1 in place.
const MIGRATIONS: &[MigrationDef] = &[
    MigrationDef {
        version: 1,
        name: "initial_core_schema",
        kind: MigrationKind::Statements(SCHEMA_V1_TABLE_STATEMENTS),
    },
    MigrationDef {
        version: 2,
        name: "backfill_core_indexes",
        kind: MigrationKind::Statements(SCHEMA_V2_INDEX_STATEMENTS),
    },
    MigrationDef {
        version: 3,
        name: "harden_core_constraints",
        kind: MigrationKind::HardenCoreConstraints,
    },
];

const SCHEMA_V1_TABLE_STATEMENTS: &[&str] = &[
    r#"CREATE TABLE IF NOT EXISTS profiles (
      id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )"#,
    r#"CREATE TABLE IF NOT EXISTS model_provider_configs (
      id TEXT PRIMARY KEY,
      provider_id TEXT NOT NULL,
      display_name TEXT NOT NULL,
      base_url TEXT,
      default_model_id TEXT,
      secret_ref TEXT,
      non_secret_settings_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )"#,
    r#"CREATE TABLE IF NOT EXISTS characters (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      profile_json TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'manual',
      introduced_at_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )"#,
    r#"CREATE TABLE IF NOT EXISTS character_versions (
      id TEXT PRIMARY KEY,
      character_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      card_json TEXT NOT NULL,
      change_reason TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE
    )"#,
    r#"CREATE TABLE IF NOT EXISTS chats (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      mode TEXT NOT NULL,
      active_branch_id TEXT NOT NULL,
      root_state_snapshot_id TEXT,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      profile_id TEXT,
      world_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )"#,
    r#"CREATE TABLE IF NOT EXISTS message_branches (
      id TEXT PRIMARY KEY,
      chat_id TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT 'Main',
      root_message_id TEXT,
      head_message_id TEXT,
      base_message_id TEXT,
      label TEXT NOT NULL,
      is_active INTEGER NOT NULL CHECK (is_active IN (0, 1)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE
    )"#,
    r#"CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      chat_id TEXT NOT NULL,
      branch_id TEXT NOT NULL,
      parent_message_id TEXT,
      role TEXT NOT NULL CHECK (role IN ('system', 'user', 'assistant', 'tool', 'narrator')),
      content TEXT NOT NULL,
      state_snapshot_id TEXT,
      prompt_run_id TEXT,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE,
      FOREIGN KEY (branch_id) REFERENCES message_branches(id) ON DELETE CASCADE,
      FOREIGN KEY (parent_message_id) REFERENCES messages(id) ON DELETE SET NULL
    )"#,
    r#"CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      chat_id TEXT NOT NULL,
      branch_id TEXT,
      message_id TEXT,
      summary TEXT NOT NULL,
      occurred_at TEXT,
      location TEXT,
      participant_character_ids_json TEXT NOT NULL,
      world_truth INTEGER NOT NULL CHECK (world_truth IN (0, 1)),
      metadata_json TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE,
      FOREIGN KEY (branch_id) REFERENCES message_branches(id) ON DELETE SET NULL,
      FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE SET NULL
    )"#,
    r#"CREATE TABLE IF NOT EXISTS character_knowledge (
      id TEXT PRIMARY KEY,
      character_id TEXT NOT NULL,
      event_id TEXT NOT NULL,
      chat_id TEXT,
      knowledge_type TEXT NOT NULL,
      certainty REAL NOT NULL,
      interpretation TEXT NOT NULL,
      emotional_reaction TEXT,
      can_discuss_with_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE,
      FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
      FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE SET NULL
    )"#,
    r#"CREATE TABLE IF NOT EXISTS relationships (
      id TEXT PRIMARY KEY,
      subject_type TEXT NOT NULL,
      subject_id TEXT NOT NULL,
      object_type TEXT NOT NULL,
      object_id TEXT NOT NULL,
      metrics_json TEXT NOT NULL,
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )"#,
    r#"CREATE TABLE IF NOT EXISTS memory_entries (
      id TEXT PRIMARY KEY,
      chat_id TEXT,
      category TEXT NOT NULL,
      text TEXT NOT NULL,
      importance REAL NOT NULL,
      pinned INTEGER NOT NULL,
      related_character_ids_json TEXT NOT NULL,
      related_event_ids_json TEXT NOT NULL,
      last_accessed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      CHECK (pinned IN (0, 1)),
      FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE
    )"#,
    r#"CREATE TABLE IF NOT EXISTS memory_archive (
      id TEXT PRIMARY KEY,
      source_memory_id TEXT NOT NULL,
      archive_reason TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      archived_at TEXT NOT NULL,
      FOREIGN KEY (source_memory_id) REFERENCES memory_entries(id) ON DELETE CASCADE
    )"#,
    r#"CREATE TABLE IF NOT EXISTS lorebooks (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )"#,
    r#"CREATE TABLE IF NOT EXISTS lorebook_entries (
      id TEXT PRIMARY KEY,
      lorebook_id TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      constant INTEGER NOT NULL CHECK (constant IN (0, 1)),
      triggers_json TEXT NOT NULL,
      token_budget INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (lorebook_id) REFERENCES lorebooks(id) ON DELETE CASCADE
    )"#,
    r#"CREATE TABLE IF NOT EXISTS rpg_worlds (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      ruleset TEXT NOT NULL,
      description TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )"#,
    r#"CREATE TABLE IF NOT EXISTS rpg_state_snapshots (
      id TEXT PRIMARY KEY,
      world_id TEXT NOT NULL,
      chat_id TEXT NOT NULL,
      branch_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE,
      FOREIGN KEY (branch_id) REFERENCES message_branches(id) ON DELETE CASCADE
    )"#,
    r#"CREATE TABLE IF NOT EXISTS prompt_runs (
      id TEXT PRIMARY KEY,
      chat_id TEXT NOT NULL,
      message_id TEXT,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      temperature REAL,
      token_budget INTEGER,
      compiled_prompt TEXT NOT NULL,
      included_memory_ids_json TEXT NOT NULL,
      included_lore_entry_ids_json TEXT NOT NULL,
      included_state_snapshot_id TEXT,
      response_text TEXT,
      extraction_json TEXT,
      state_changes_json TEXT,
      request_json TEXT NOT NULL DEFAULT '{}',
      model_settings_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE,
      FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE SET NULL
    )"#,
    r#"CREATE TABLE IF NOT EXISTS image_prompt_runs (
      id TEXT PRIMARY KEY,
      chat_id TEXT NOT NULL,
      message_id TEXT,
      provider TEXT,
      compiled_prompt TEXT NOT NULL,
      negative_prompt TEXT,
      style_preset TEXT,
      result_uri TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE SET NULL
    )"#,
];

const SCHEMA_V2_INDEX_STATEMENTS: &[&str] = &[
    r#"CREATE INDEX IF NOT EXISTS idx_message_branches_chat_active
      ON message_branches(chat_id, is_active)"#,
    r#"CREATE INDEX IF NOT EXISTS idx_messages_chat_branch_created
      ON messages(chat_id, branch_id, created_at)"#,
    r#"CREATE INDEX IF NOT EXISTS idx_prompt_runs_chat_created
      ON prompt_runs(chat_id, created_at)"#,
    r#"CREATE INDEX IF NOT EXISTS idx_image_prompt_runs_chat_created
      ON image_prompt_runs(chat_id, created_at)"#,
    r#"CREATE INDEX IF NOT EXISTS idx_lorebook_entries_lorebook_updated
      ON lorebook_entries(lorebook_id, updated_at)"#,
    r#"CREATE INDEX IF NOT EXISTS idx_memory_entries_chat_updated
      ON memory_entries(chat_id, updated_at)"#,
    r#"CREATE INDEX IF NOT EXISTS idx_rpg_state_snapshots_chat_created
      ON rpg_state_snapshots(chat_id, created_at)"#,
];

const CORE_CONSTRAINT_REBUILDS: &[TableRebuildDef] = &[
    TableRebuildDef {
        table: "character_versions",
        columns: "id, character_id, version, card_json, change_reason, created_at",
    },
    TableRebuildDef {
        table: "message_branches",
        columns: "id, chat_id, name, root_message_id, head_message_id, base_message_id, label, is_active, created_at, updated_at",
    },
    TableRebuildDef {
        table: "messages",
        columns: "id, chat_id, branch_id, parent_message_id, role, content, state_snapshot_id, prompt_run_id, metadata_json, updated_at, created_at",
    },
    TableRebuildDef {
        table: "events",
        columns: "id, chat_id, branch_id, message_id, summary, occurred_at, location, participant_character_ids_json, world_truth, metadata_json, created_at",
    },
    TableRebuildDef {
        table: "character_knowledge",
        columns: "id, character_id, event_id, chat_id, knowledge_type, certainty, interpretation, emotional_reaction, can_discuss_with_json, created_at, updated_at",
    },
    TableRebuildDef {
        table: "memory_entries",
        columns: "id, chat_id, category, text, importance, pinned, related_character_ids_json, related_event_ids_json, last_accessed_at, created_at, updated_at",
    },
    TableRebuildDef {
        table: "memory_archive",
        columns: "id, source_memory_id, archive_reason, payload_json, archived_at",
    },
    TableRebuildDef {
        table: "lorebook_entries",
        columns: "id, lorebook_id, title, content, constant, triggers_json, token_budget, created_at, updated_at",
    },
    TableRebuildDef {
        table: "rpg_state_snapshots",
        columns: "id, world_id, chat_id, branch_id, message_id, payload_json, created_at",
    },
    TableRebuildDef {
        table: "prompt_runs",
        columns: "id, chat_id, message_id, provider, model, temperature, token_budget, compiled_prompt, included_memory_ids_json, included_lore_entry_ids_json, included_state_snapshot_id, response_text, extraction_json, state_changes_json, request_json, model_settings_json, created_at",
    },
    TableRebuildDef {
        table: "image_prompt_runs",
        columns: "id, chat_id, message_id, provider, compiled_prompt, negative_prompt, style_preset, result_uri, created_at",
    },
];

const HISTORICAL_CONSTRAINT_PREFLIGHTS: &[(&str, &str)] = &[
    (
        "message_branches.is_active",
        "SELECT COUNT(*) FROM message_branches WHERE is_active NOT IN (0, 1)",
    ),
    (
        "messages.role",
        "SELECT COUNT(*) FROM messages WHERE role NOT IN ('system', 'user', 'assistant', 'tool', 'narrator')",
    ),
    (
        "events.world_truth",
        "SELECT COUNT(*) FROM events WHERE world_truth NOT IN (0, 1)",
    ),
    (
        "memory_entries.pinned",
        "SELECT COUNT(*) FROM memory_entries WHERE pinned NOT IN (0, 1)",
    ),
    (
        "lorebook_entries.constant",
        "SELECT COUNT(*) FROM lorebook_entries WHERE constant NOT IN (0, 1)",
    ),
    (
        "character_versions.character_id",
        "SELECT COUNT(*) FROM character_versions child LEFT JOIN characters parent ON parent.id = child.character_id WHERE parent.id IS NULL",
    ),
    (
        "message_branches.chat_id",
        "SELECT COUNT(*) FROM message_branches child LEFT JOIN chats parent ON parent.id = child.chat_id WHERE parent.id IS NULL",
    ),
    (
        "messages.chat_id",
        "SELECT COUNT(*) FROM messages child LEFT JOIN chats parent ON parent.id = child.chat_id WHERE parent.id IS NULL",
    ),
    (
        "messages.branch_id",
        "SELECT COUNT(*) FROM messages child LEFT JOIN message_branches parent ON parent.id = child.branch_id WHERE parent.id IS NULL",
    ),
    (
        "messages.parent_message_id",
        "SELECT COUNT(*) FROM messages child LEFT JOIN messages parent ON parent.id = child.parent_message_id WHERE child.parent_message_id IS NOT NULL AND parent.id IS NULL",
    ),
    (
        "events.chat_id",
        "SELECT COUNT(*) FROM events child LEFT JOIN chats parent ON parent.id = child.chat_id WHERE parent.id IS NULL",
    ),
    (
        "events.branch_id",
        "SELECT COUNT(*) FROM events child LEFT JOIN message_branches parent ON parent.id = child.branch_id WHERE child.branch_id IS NOT NULL AND parent.id IS NULL",
    ),
    (
        "events.message_id",
        "SELECT COUNT(*) FROM events child LEFT JOIN messages parent ON parent.id = child.message_id WHERE child.message_id IS NOT NULL AND parent.id IS NULL",
    ),
    (
        "character_knowledge.character_id",
        "SELECT COUNT(*) FROM character_knowledge child LEFT JOIN characters parent ON parent.id = child.character_id WHERE parent.id IS NULL",
    ),
    (
        "character_knowledge.event_id",
        "SELECT COUNT(*) FROM character_knowledge child LEFT JOIN events parent ON parent.id = child.event_id WHERE parent.id IS NULL",
    ),
    (
        "character_knowledge.chat_id",
        "SELECT COUNT(*) FROM character_knowledge child LEFT JOIN chats parent ON parent.id = child.chat_id WHERE child.chat_id IS NOT NULL AND parent.id IS NULL",
    ),
    (
        "memory_entries.chat_id",
        "SELECT COUNT(*) FROM memory_entries child LEFT JOIN chats parent ON parent.id = child.chat_id WHERE child.chat_id IS NOT NULL AND parent.id IS NULL",
    ),
    (
        "memory_archive.source_memory_id",
        "SELECT COUNT(*) FROM memory_archive child LEFT JOIN memory_entries parent ON parent.id = child.source_memory_id WHERE parent.id IS NULL",
    ),
    (
        "lorebook_entries.lorebook_id",
        "SELECT COUNT(*) FROM lorebook_entries child LEFT JOIN lorebooks parent ON parent.id = child.lorebook_id WHERE parent.id IS NULL",
    ),
    (
        "rpg_state_snapshots.chat_id",
        "SELECT COUNT(*) FROM rpg_state_snapshots child LEFT JOIN chats parent ON parent.id = child.chat_id WHERE parent.id IS NULL",
    ),
    (
        "rpg_state_snapshots.branch_id",
        "SELECT COUNT(*) FROM rpg_state_snapshots child LEFT JOIN message_branches parent ON parent.id = child.branch_id WHERE parent.id IS NULL",
    ),
    (
        "prompt_runs.chat_id",
        "SELECT COUNT(*) FROM prompt_runs child LEFT JOIN chats parent ON parent.id = child.chat_id WHERE parent.id IS NULL",
    ),
    (
        "prompt_runs.message_id",
        "SELECT COUNT(*) FROM prompt_runs child LEFT JOIN messages parent ON parent.id = child.message_id WHERE child.message_id IS NOT NULL AND parent.id IS NULL",
    ),
    (
        "image_prompt_runs.message_id",
        "SELECT COUNT(*) FROM image_prompt_runs child LEFT JOIN messages parent ON parent.id = child.message_id WHERE child.message_id IS NOT NULL AND parent.id IS NULL",
    ),
];

fn validate_historical_constraint_data(conn: &Connection) -> RepoResult<()> {
    let mut violations = Vec::new();
    for (label, query) in HISTORICAL_CONSTRAINT_PREFLIGHTS {
        let count = conn
            .query_row(query, [], |row| row.get::<_, i64>(0))
            .map_err(|_| RuntimeRepositoryError::Storage)?;
        if count > 0 {
            violations.push(format!("{label}: {count}"));
        }
    }
    if violations.is_empty() {
        return Ok(());
    }
    Err(RuntimeRepositoryError::Validation(format!(
        "Database schema upgrade blocked because legacy rows violate required constraints ({}). A pre-migration backup was preserved; no rows were changed.",
        violations.join(", ")
    )))
}

fn rebuild_table_with_current_constraints(
    tx: &Transaction<'_>,
    rebuild: &TableRebuildDef,
) -> RepoResult<()> {
    let old_table = format!("__v3_old_{}", rebuild.table);
    tx.execute_batch(&format!(
        "ALTER TABLE \"{}\" RENAME TO \"{old_table}\"",
        rebuild.table
    ))
    .map_err(|_| RuntimeRepositoryError::Storage)?;

    let desired_statement = SCHEMA_V1_TABLE_STATEMENTS
        .iter()
        .find(|statement| {
            statement.starts_with(&format!("CREATE TABLE IF NOT EXISTS {} (", rebuild.table))
        })
        .ok_or(RuntimeRepositoryError::Storage)?;
    tx.execute_batch(desired_statement)
        .map_err(|_| RuntimeRepositoryError::Storage)?;
    tx.execute_batch(&format!(
        "INSERT INTO \"{}\" ({}) SELECT {} FROM \"{old_table}\"",
        rebuild.table, rebuild.columns, rebuild.columns
    ))
    .map_err(|_| RuntimeRepositoryError::Storage)?;

    let old_count = count_table_rows(tx, &old_table)?;
    let new_count = count_table_rows(tx, rebuild.table)?;
    if old_count != new_count {
        return Err(RuntimeRepositoryError::Validation(format!(
            "Database schema upgrade stopped because copying {} changed its row count.",
            rebuild.table
        )));
    }
    tx.execute_batch(&format!("DROP TABLE \"{old_table}\""))
        .map_err(|_| RuntimeRepositoryError::Storage)?;
    Ok(())
}

fn count_table_rows(conn: &Connection, table: &str) -> RepoResult<i64> {
    conn.query_row(&format!("SELECT COUNT(*) FROM \"{table}\""), [], |row| {
        row.get(0)
    })
    .map_err(|_| RuntimeRepositoryError::Storage)
}

fn ensure_database_integrity(conn: &Connection) -> RepoResult<()> {
    let has_foreign_key_violation = conn
        .prepare("PRAGMA foreign_key_check")
        .and_then(|mut statement| statement.exists([]))
        .map_err(|_| RuntimeRepositoryError::Storage)?;
    if has_foreign_key_violation {
        return Err(RuntimeRepositoryError::Validation(
            "Database schema upgrade stopped because foreign-key verification failed.".to_string(),
        ));
    }
    let integrity = conn
        .pragma_query_value(None, "integrity_check", |row| row.get::<_, String>(0))
        .map_err(|_| RuntimeRepositoryError::Storage)?;
    if !integrity.eq_ignore_ascii_case("ok") {
        return Err(RuntimeRepositoryError::Validation(
            "Database schema upgrade stopped because SQLite integrity verification failed."
                .to_string(),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const HISTORICAL_SCHEMA_V1: &str = include_str!("../tests/fixtures/schema-v1-0996b8d.sql");

    #[test]
    fn migrations_are_idempotent() {
        let path = temp_db_path("migrations_are_idempotent");
        let first = initialize_repository_at_path(&path).unwrap();
        let second = initialize_repository_at_path(&path).unwrap();
        assert_eq!(first.len(), MIGRATIONS.len());
        assert!(first.iter().all(|run| run.status == "applied"));
        assert!(second.iter().all(|run| run.status == "skipped"));
        cleanup(&path);
    }

    #[test]
    fn upgrades_the_real_historical_v1_schema_without_losing_data() {
        let workspace = temp_workspace_dir("upgrades_real_historical_v1");
        let path = workspace.join("runtime.db");
        create_historical_v1_database(&path, false);

        let before = Connection::open(&path).unwrap();
        assert_eq!(count_indexes(&before), 0);
        assert_eq!(count_foreign_keys(&before), 0);
        assert_eq!(count_check_constraints(&before), 0);
        drop(before);

        let runs = initialize_repository_at_path(&path).unwrap();
        assert_eq!(migration_status(&runs, 1), "skipped");
        assert_eq!(migration_status(&runs, 2), "applied");
        assert_eq!(migration_status(&runs, 3), "applied");

        let conn = open_migrated_connection(&path).unwrap();
        assert_eq!(latest_schema_version(&conn), 3);
        assert_eq!(
            count_indexes(&conn),
            SCHEMA_V2_INDEX_STATEMENTS.len() as i64
        );
        assert_eq!(count_foreign_keys(&conn), 19);
        assert_eq!(count_check_constraints(&conn), 5);
        assert_historical_rows_survived(&conn);
        assert_constraint_actions(&conn);
        assert_check_constraints_are_enforced(&conn);
        assert_foreign_keys_reject_orphans(&conn);
        drop(conn);

        assert_eq!(count_migration_backups(&workspace), 1);
        let rerun = initialize_repository_at_path(&path).unwrap();
        assert!(rerun.iter().all(|run| run.status == "skipped"));
        assert_eq!(count_migration_backups(&workspace), 1);
        let _ = std::fs::remove_dir_all(&workspace);
    }

    #[test]
    fn upgrades_a_v2_database_that_still_has_the_unconstrained_v1_tables() {
        let workspace = temp_workspace_dir("upgrades_unconstrained_v2");
        let path = workspace.join("runtime.db");
        create_historical_v1_database(&path, true);

        let before = Connection::open(&path).unwrap();
        assert_eq!(
            count_indexes(&before),
            SCHEMA_V2_INDEX_STATEMENTS.len() as i64
        );
        assert_eq!(count_foreign_keys(&before), 0);
        drop(before);

        let runs = initialize_repository_at_path(&path).unwrap();
        assert_eq!(migration_status(&runs, 1), "skipped");
        assert_eq!(migration_status(&runs, 2), "skipped");
        assert_eq!(migration_status(&runs, 3), "applied");

        let conn = open_migrated_connection(&path).unwrap();
        assert_eq!(count_foreign_keys(&conn), 19);
        assert_eq!(count_check_constraints(&conn), 5);
        assert_historical_rows_survived(&conn);
        let _ = std::fs::remove_dir_all(&workspace);
    }

    #[test]
    fn upgraded_historical_schema_matches_a_fresh_database() {
        let workspace = temp_workspace_dir("historical_schema_matches_fresh");
        let historical_path = workspace.join("historical.db");
        let fresh_path = workspace.join("fresh.db");
        create_historical_v1_database(&historical_path, false);
        initialize_repository_at_path(&historical_path).unwrap();
        initialize_repository_at_path(&fresh_path).unwrap();

        let historical = open_migrated_connection(&historical_path).unwrap();
        let fresh = open_migrated_connection(&fresh_path).unwrap();
        assert_eq!(
            core_schema_signature(&historical),
            core_schema_signature(&fresh)
        );
        assert_eq!(
            foreign_key_signature(&historical),
            foreign_key_signature(&fresh)
        );
        let _ = std::fs::remove_dir_all(&workspace);
    }

    #[test]
    fn dirty_historical_data_blocks_v3_atomically_and_keeps_a_backup() {
        let workspace = temp_workspace_dir("dirty_historical_v3");
        let path = workspace.join("runtime.db");
        create_historical_v1_database(&path, true);
        {
            let conn = Connection::open(&path).unwrap();
            conn.execute(
                "UPDATE message_branches SET chat_id = 'missing-chat', is_active = 7 WHERE id = 'branch-1'",
                [],
            )
            .unwrap();
        }

        let result = initialize_repository_at_path(&path);
        assert!(matches!(result, Err(RuntimeRepositoryError::Validation(_))));

        let conn = Connection::open(&path).unwrap();
        configure_connection(&conn).unwrap();
        assert_eq!(latest_schema_version(&conn), 2);
        assert_eq!(count_foreign_keys(&conn), 0);
        assert_eq!(
            conn.query_row(
                "SELECT chat_id || ':' || is_active FROM message_branches WHERE id = 'branch-1'",
                [],
                |row| row.get::<_, String>(0),
            )
            .unwrap(),
            "missing-chat:7"
        );
        assert_eq!(
            conn.pragma_query_value(None, "foreign_keys", |row| row.get::<_, i64>(0))
                .unwrap(),
            1
        );
        assert_eq!(count_migration_backups(&workspace), 1);
        let _ = std::fs::remove_dir_all(&workspace);
    }

    #[test]
    fn save_load_round_trip_and_prune_runtime_rows() {
        let path = temp_db_path("save_load_round_trip_and_prune_runtime_rows");
        save_runtime_snapshot_at_path(&path, fixture_snapshot("card_blank_slate_rpg")).unwrap();
        let loaded = load_runtime_snapshot_at_path(&path).unwrap().unwrap();
        assert_eq!(
            string_at(&loaded, "activeCardId", ""),
            "card_blank_slate_rpg"
        );
        assert_eq!(
            loaded["cards"][0]["memory"][0]["detail"],
            json!("The player inspected the gate.")
        );
        assert_eq!(loaded["generatedMaps"][0]["id"], json!("map-1"));
        assert!(!json_string(&loaded["providerSettings"]).contains("sk-"));

        let mut second = fixture_snapshot("card_survivor");
        second["cards"] = json!([
            {
                "id": "card_survivor",
                "name": "Survivor",
                "kind": "character",
                "lorebooks": [],
                "memory": []
            }
        ]);
        second["messages"] = json!([]);
        second["promptRuns"] = json!([]);
        second["generatedMaps"] = json!([]);
        save_runtime_snapshot_at_path(&path, second).unwrap();

        let conn = Connection::open(&path).unwrap();
        assert_eq!(count_rows(&conn, "messages"), 0);
        assert_eq!(count_rows(&conn, "prompt_runs"), 0);
        assert_eq!(count_rows(&conn, "image_prompt_runs"), 0);
        assert_eq!(count_rows(&conn, "lorebooks"), 0);
        assert_eq!(count_rows(&conn, "lorebook_entries"), 0);
        assert_eq!(count_rows(&conn, "memory_entries"), 0);
        assert_eq!(count_rows(&conn, "rpg_state_snapshots"), 0);
        cleanup(&path);
    }

    #[test]
    fn legacy_compatibility_snapshot_loads_without_normalized_rows() {
        let path = temp_db_path("legacy_compatibility_snapshot_loads_without_normalized_rows");
        initialize_repository_at_path(&path).unwrap();
        let conn = Connection::open(&path).unwrap();
        conn.execute(
            "INSERT INTO characters (id, name, description, profile_json, source, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                RUNTIME_SNAPSHOT_CHARACTER_ID,
                "Local Cards runtime snapshot",
                "legacy",
                json_string(&json!({ "snapshot": fixture_snapshot("legacy-card") })),
                "runtime-snapshot",
                now_iso(),
                now_iso(),
            ],
        )
        .unwrap();
        let loaded = load_runtime_snapshot_at_path(&path).unwrap().unwrap();
        assert_eq!(string_at(&loaded, "activeCardId", ""), "legacy-card");
        cleanup(&path);
    }

    #[test]
    fn normalized_rows_win_over_stale_snapshot_blob() {
        let path = temp_db_path("normalized_rows_win_over_stale_snapshot_blob");
        let mut snapshot = fixture_snapshot("card_blank_slate_rpg");
        snapshot["chatSessions"] = json!([
            {
                "id": "chat-card",
                "cardId": "card_blank_slate_rpg",
                "title": "Card chat",
                "messages": snapshot["messages"].clone()
            }
        ]);
        snapshot["activeChatIds"] = json!({
            "card_blank_slate_rpg": "chat-card"
        });
        snapshot["promptRuns"][0]["chatId"] = json!("chat-card");
        snapshot["generatedMaps"][0]["chatId"] = json!("chat-card");
        save_runtime_snapshot_at_path(&path, snapshot.clone()).unwrap();

        let mut stale_snapshot = snapshot;
        stale_snapshot["cards"][0]["memory"] = json!([
            {
                "id": "stale-memory",
                "label": "Stale",
                "detail": "This stale memory should not load."
            }
        ]);
        stale_snapshot["cards"][0]["lorebooks"] = json!([]);
        stale_snapshot["cards"][0]["rpg"] = json!({ "location": "Wrong room" });
        stale_snapshot["messages"] = json!([
            { "id": "stale-message", "role": "assistant", "content": "stale" }
        ]);
        stale_snapshot["chatSessions"][0]["messages"] = json!([
            { "id": "stale-session-message", "role": "assistant", "content": "stale" }
        ]);
        stale_snapshot["promptRuns"] = json!([
            {
                "id": "stale-run",
                "cardId": "card_blank_slate_rpg",
                "chatId": "chat-card",
                "compiledPrompt": "stale",
                "response": "stale",
                "provider": "mock",
                "model": "mock",
                "tokenEstimate": 1,
                "includedLayerIds": [],
                "includedLoreEntryIds": [],
                "warnings": [],
                "stateChanges": []
            }
        ]);
        stale_snapshot["generatedMaps"] = json!([
            {
                "id": "stale-map",
                "cardId": "card_blank_slate_rpg",
                "chatId": "chat-card",
                "prompt": "stale map",
                "status": "prompt_ready",
                "createdAt": "2026-06-27T20:01:00.000Z"
            }
        ]);

        let conn = open_migrated_connection(&path).unwrap();
        conn.execute(
            "UPDATE characters SET profile_json = ?1 WHERE id = ?2",
            params![
                json_string(&json!({ "snapshot": stale_snapshot })),
                RUNTIME_SNAPSHOT_CHARACTER_ID
            ],
        )
        .unwrap();
        drop(conn);

        let loaded = load_runtime_snapshot_at_path(&path).unwrap().unwrap();
        assert_eq!(loaded["cards"][0]["memory"][0]["id"], json!("memory-1"));
        assert_eq!(loaded["cards"][0]["lorebooks"][0]["id"], json!("lore-1"));
        assert_eq!(
            loaded["cards"][0]["lorebooks"][0]["entries"][0]["id"],
            json!("lore-gate")
        );
        assert_eq!(loaded["cards"][0]["rpg"]["location"], json!("Cellar"));
        assert_eq!(loaded["messages"][0]["id"], json!("assistant-run_001"));
        assert_eq!(
            loaded["chatSessions"][0]["messages"][0]["id"],
            json!("assistant-run_001")
        );
        assert_eq!(loaded["promptRuns"][0]["id"], json!("run_001"));
        assert_eq!(
            loaded["promptRuns"][0]["stateProposals"][0]["provenance"],
            json!("player-action")
        );
        assert_eq!(loaded["generatedMaps"][0]["id"], json!("map-1"));
        assert_eq!(loaded["generatedMaps"][0]["chatId"], json!("chat-card"));
        cleanup(&path);
    }

    #[test]
    fn sqlite_foreign_keys_are_enforced() {
        let path = temp_db_path("sqlite_foreign_keys_are_enforced");
        initialize_repository_at_path(&path).unwrap();
        let conn = open_migrated_connection(&path).unwrap();
        let result = conn.execute(
            "INSERT INTO messages (id, chat_id, branch_id, role, content, metadata_json, updated_at, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                "orphan-message",
                "missing-chat",
                "missing-branch",
                "assistant",
                "orphan",
                "{}",
                now_iso(),
                now_iso()
            ],
        );
        assert!(result.is_err());
        cleanup(&path);
    }

    #[cfg(debug_assertions)]
    #[test]
    fn development_database_path_is_confined_to_temp_workspace() {
        let base = std::env::temp_dir().join("local-first-ai-rpg-runtime-dev");
        let path = resolve_development_database_path("nested/test.db").unwrap();
        assert!(path.starts_with(&base));
        assert!(resolve_development_database_path("../escape.db").is_err());
        assert!(resolve_development_database_path(
            &std::env::temp_dir()
                .join("outside-runtime-dev.db")
                .to_string_lossy()
        )
        .is_err());
        let _ = std::fs::remove_dir_all(base);
    }

    #[test]
    fn smoke_app_data_override_is_confined_to_temp_workspace() {
        let base = std::env::temp_dir().join(format!(
            "local-first-ai-rpg-runtime-smoke-{}",
            now_iso().replace([':', '.'], "")
        ));
        std::env::set_var(
            APP_DATA_DIR_OVERRIDE_ENV,
            base.to_string_lossy().to_string(),
        );
        let resolved = resolve_smoke_app_data_dir_override().unwrap().unwrap();
        assert_eq!(resolved, base);
        let initialized = initialize_smoke_repository_from_env().unwrap().unwrap();
        assert_eq!(initialized, base.join(DATABASE_FILENAME));
        assert!(initialized.exists());

        std::env::set_var(APP_DATA_DIR_OVERRIDE_ENV, "relative/path");
        assert!(resolve_smoke_app_data_dir_override().is_err());

        std::env::set_var(
            APP_DATA_DIR_OVERRIDE_ENV,
            std::env::current_dir()
                .unwrap()
                .join("outside")
                .to_string_lossy()
                .to_string(),
        );
        assert!(resolve_smoke_app_data_dir_override().is_err());

        std::env::remove_var(APP_DATA_DIR_OVERRIDE_ENV);
        let _ = std::fs::remove_dir_all(base);
    }

    #[test]
    fn validation_rejects_oversized_snapshots_and_raw_secrets() {
        let mut too_many_cards = fixture_snapshot("card");
        too_many_cards["cards"] = Value::Array(
            (0..=MAX_CARDS)
                .map(|index| json!({ "id": format!("card-{index}") }))
                .collect(),
        );
        assert!(matches!(
            sanitize_snapshot(too_many_cards),
            Err(RuntimeRepositoryError::Validation(_))
        ));

        let mut raw_secret = fixture_snapshot("card");
        raw_secret["providerSettings"]["apiKey"] = json!("sk-this-secret-should-not-persist");
        assert!(matches!(
            sanitize_snapshot(raw_secret),
            Err(RuntimeRepositoryError::Validation(_))
        ));
    }

    #[test]
    fn image_provider_settings_are_sanitized_at_snapshot_boundary() {
        let mut safe_image_settings = fixture_snapshot("card");
        safe_image_settings["imageProviderSettings"] = json!({
            "mode": "comfyui",
            "providerId": "comfyui",
            "displayName": "ComfyUI local API",
            "endpoint": "http://127.0.0.1:8188",
            "model": "FLUX.1-schnell",
            "workflowJson": "{\"1\":{\"class_type\":\"CheckpointLoaderSimple\",\"inputs\":{\"ckpt_name\":\"FLUX.1-schnell\"}}}",
            "width": 1024,
            "height": 1024,
            "pollTimeoutMs": 120000,
            "apiKey": "sk-image-secret-should-drop",
            "ignored": true
        });
        let sanitized = sanitize_snapshot(safe_image_settings).unwrap();
        assert_eq!(sanitized["imageProviderSettings"]["mode"], json!("comfyui"));
        assert_eq!(sanitized["imageProviderSettings"]["workflowJson"], json!("{\"1\":{\"class_type\":\"CheckpointLoaderSimple\",\"inputs\":{\"ckpt_name\":\"FLUX.1-schnell\"}}}"));
        assert!(sanitized["imageProviderSettings"].get("apiKey").is_none());
        assert!(sanitized["imageProviderSettings"].get("ignored").is_none());

        let mut unsafe_image_settings = fixture_snapshot("card");
        unsafe_image_settings["imageProviderSettings"] = json!({
            "mode": "comfyui",
            "workflowJson": "{\"1\":{\"inputs\":{\"apiKey\":\"workflow-secret\"}}}",
            "token": "raw-token"
        });
        let sanitized = sanitize_snapshot(unsafe_image_settings).unwrap();
        assert_eq!(sanitized["imageProviderSettings"]["mode"], json!("comfyui"));
        assert!(sanitized["imageProviderSettings"]
            .get("workflowJson")
            .is_none());
        assert!(sanitized["imageProviderSettings"].get("token").is_none());
    }

    #[test]
    fn transaction_rolls_back_after_mid_save_failure() {
        let path = temp_db_path("transaction_rolls_back_after_mid_save_failure");
        save_runtime_snapshot_at_path(&path, fixture_snapshot("card_blank_slate_rpg")).unwrap();
        let before = load_runtime_snapshot_at_path(&path).unwrap().unwrap();
        let mut conn = open_migrated_connection(&path).unwrap();
        let tx = conn.transaction().unwrap();
        let mut second = fixture_snapshot("card_survivor");
        assert!(
            save_runtime_snapshot_in_transaction(&tx, &mut second, Some("after_prune")).is_err()
        );
        drop(tx);
        let after = load_runtime_snapshot_at_path(&path).unwrap().unwrap();
        assert_eq!(before["activeCardId"], after["activeCardId"]);
        cleanup(&path);
    }

    #[test]
    fn rpg_state_row_is_pruned_when_card_loses_rpg_payload() {
        let path = temp_db_path("rpg_state_row_is_pruned_when_card_loses_rpg_payload");
        save_runtime_snapshot_at_path(&path, fixture_snapshot("card_blank_slate_rpg")).unwrap();

        let mut without_rpg = fixture_snapshot("card_blank_slate_rpg");
        without_rpg["cards"][0]
            .as_object_mut()
            .unwrap()
            .remove("rpg");
        save_runtime_snapshot_at_path(&path, without_rpg).unwrap();

        let conn = Connection::open(&path).unwrap();
        assert_eq!(count_rows(&conn, "rpg_state_snapshots"), 0);
        let loaded = load_runtime_snapshot_at_path(&path).unwrap().unwrap();
        assert!(loaded["cards"][0].get("rpg").is_none());
        cleanup(&path);
    }

    fn fixture_snapshot(active_card_id: &str) -> Value {
        json!({
            "version": 2,
            "theme": "dark",
            "activeCardId": active_card_id,
            "cards": [
                {
                    "id": active_card_id,
                    "name": "Blank Slate RPG",
                    "kind": "rpg",
                    "memory": [
                        {
                            "id": "memory-1",
                            "label": "Recent validated turn",
                            "detail": "The player inspected the gate."
                        }
                    ],
                    "lorebooks": [
                        {
                            "id": "lore-1",
                            "name": "Gate Lore",
                            "tokenBudget": 800,
                            "entries": [
                                {
                                    "id": "lore-gate",
                                    "title": "Ancient Gate",
                                    "content": "The gate opens to a remembered oath.",
                                    "keys": ["gate"],
                                    "secondaryKeys": [],
                                    "insertionOrder": 100,
                                    "priority": 4,
                                    "enabled": true,
                                    "constant": false,
                                    "probability": 100,
                                    "caseSensitive": false,
                                    "wholeWord": false
                                }
                            ]
                        }
                    ],
                    "rpg": {
                        "location": "Cellar",
                        "health": "10/10",
                        "inventory": ["brass key"],
                        "quests": [],
                        "flags": { "gate_seen": true }
                    }
                }
            ],
            "messages": [
                { "id": "assistant-run_001", "role": "assistant", "content": "The action is validated." }
            ],
            "promptRuns": [
                {
                    "id": "run_001",
                    "cardId": active_card_id,
                    "chatId": RUNTIME_CHAT_ID,
                    "compiledPrompt": "## Prompt",
                    "response": "The action is validated.",
                    "provider": "mock",
                    "model": "mock-narrator",
                    "tokenEstimate": 42,
                    "includedLayerIds": ["latest-user-message"],
                    "includedLoreEntryIds": ["lore-gate"],
                    "warnings": [],
                    "stateChanges": ["Location -> Cellar"],
                    "stateProposals": [
                        {
                            "kind": "location",
                            "summary": "Location -> Cellar",
                            "provenance": "player-action",
                            "applied": true
                        }
                    ],
                    "usage": { "inputTokens": 20, "outputTokens": 8, "totalTokens": 28 }
                }
            ],
            "providerKeyStatus": "Stored OS keychain reference active.",
            "providerSettings": {
                "mode": "openai-compatible",
                "providerId": "openrouter",
                "displayName": "OpenRouter BYOK",
                "baseUrl": "https://openrouter.ai/api/v1",
                "model": "qwen3.7-max",
                "secretReference": {
                    "providerId": "openrouter",
                    "secretName": "apiKey",
                    "storageKind": "os-keychain",
                    "storageKey": "openrouter:apiKey",
                    "providerBaseUrl": "https://openrouter.ai/api/v1"
                }
            },
            "generatedMaps": [
                {
                    "id": "map-1",
                    "cardId": active_card_id,
                    "chatId": RUNTIME_CHAT_ID,
                    "prompt": "Birdseye map of the cellar",
                    "negativePrompt": "first-person view",
                    "provider": "comfyui",
                    "model": "FLUX.1-schnell",
                    "status": "generated",
                    "imageUrl": "http://127.0.0.1:8188/view?filename=map.png&type=output&subfolder=",
                    "createdAt": "2026-06-27T20:00:01.000Z"
                }
            ],
            "savedAt": "2026-06-27T20:00:00.000Z"
        })
    }

    const CONSTRAINED_CORE_TABLES: &[&str] = &[
        "character_versions",
        "message_branches",
        "messages",
        "events",
        "character_knowledge",
        "memory_entries",
        "memory_archive",
        "lorebook_entries",
        "rpg_state_snapshots",
        "prompt_runs",
        "image_prompt_runs",
    ];

    fn create_historical_v1_database(path: &Path, mark_v2_applied: bool) {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).unwrap();
        }
        let conn = Connection::open(path).unwrap();
        conn.execute_batch(HISTORICAL_SCHEMA_V1).unwrap();
        seed_historical_constraint_graph(&conn);
        if mark_v2_applied {
            for statement in SCHEMA_V2_INDEX_STATEMENTS {
                conn.execute_batch(statement).unwrap();
            }
            conn.execute(
                "INSERT INTO schema_migrations (version, name, applied_at) VALUES (2, 'backfill_core_indexes', ?1)",
                params![now_iso()],
            )
            .unwrap();
        }
    }

    fn seed_historical_constraint_graph(conn: &Connection) {
        conn.execute_batch(
            r#"
            INSERT INTO characters
              (id, name, description, profile_json, source, introduced_at_json, created_at, updated_at)
            VALUES
              ('char-1', 'Nia', 'historical character', '{"kind":"character"}', 'manual', NULL, 't0', 't0');
            INSERT INTO character_versions
              (id, character_id, version, card_json, change_reason, created_at)
            VALUES
              ('char-version-1', 'char-1', 1, '{"name":"Nia"}', 'seed', 't0');
            INSERT INTO chats
              (id, title, mode, active_branch_id, root_state_snapshot_id, metadata_json, profile_id, world_id, created_at, updated_at)
            VALUES
              ('chat-1', 'Historical chat', 'rpg', 'branch-1', NULL, '{"fixture":true}', NULL, 'world-1', 't0', 't0');
            INSERT INTO message_branches
              (id, chat_id, name, root_message_id, head_message_id, base_message_id, label, is_active, created_at, updated_at)
            VALUES
              ('branch-1', 'chat-1', 'Main', 'message-1', 'message-2', NULL, 'Main', 1, 't0', 't0');
            INSERT INTO messages
              (id, chat_id, branch_id, parent_message_id, role, content, state_snapshot_id, prompt_run_id, metadata_json, updated_at, created_at)
            VALUES
              ('message-1', 'chat-1', 'branch-1', NULL, 'user', 'parent payload', NULL, NULL, '{}', 't0', 't0'),
              ('message-2', 'chat-1', 'branch-1', 'message-1', 'assistant', 'child payload', 'state-1', 'prompt-1', '{"variant":0}', 't0', 't0');
            INSERT INTO events
              (id, chat_id, branch_id, message_id, summary, occurred_at, location, participant_character_ids_json, world_truth, metadata_json, created_at)
            VALUES
              ('event-1', 'chat-1', 'branch-1', 'message-2', 'Historical event', 't0', 'Cellar', '["char-1"]', 1, '{}', 't0');
            INSERT INTO character_knowledge
              (id, character_id, event_id, chat_id, knowledge_type, certainty, interpretation, emotional_reaction, can_discuss_with_json, created_at, updated_at)
            VALUES
              ('knowledge-1', 'char-1', 'event-1', 'chat-1', 'witnessed', 0.9, 'Saw the gate open', 'alert', '["char-1"]', 't0', 't0');
            INSERT INTO memory_entries
              (id, chat_id, category, text, importance, pinned, related_character_ids_json, related_event_ids_json, last_accessed_at, created_at, updated_at)
            VALUES
              ('memory-1', 'chat-1', 'continuity', 'Historical memory payload', 0.8, 1, '["char-1"]', '["event-1"]', 't0', 't0', 't0');
            INSERT INTO memory_archive
              (id, source_memory_id, archive_reason, payload_json, archived_at)
            VALUES
              ('archive-1', 'memory-1', 'fixture', '{"preserve":true}', 't0');
            INSERT INTO lorebooks
              (id, name, description, created_at, updated_at)
            VALUES
              ('lorebook-1', 'History', 'fixture lore', 't0', 't0');
            INSERT INTO lorebook_entries
              (id, lorebook_id, title, content, constant, triggers_json, token_budget, created_at, updated_at)
            VALUES
              ('lore-entry-1', 'lorebook-1', 'Gate', 'Historical lore payload', 1, '["gate"]', 500, 't0', 't0');
            INSERT INTO rpg_worlds
              (id, name, ruleset, description, created_at, updated_at)
            VALUES
              ('world-1', 'Historical world', 'fixture', 'world payload', 't0', 't0');
            INSERT INTO rpg_state_snapshots
              (id, world_id, chat_id, branch_id, message_id, payload_json, created_at)
            VALUES
              ('state-1', 'world-1', 'chat-1', 'branch-1', 'message-2', '{"location":"Cellar"}', 't0');
            INSERT INTO prompt_runs
              (id, chat_id, message_id, provider, model, temperature, token_budget, compiled_prompt, included_memory_ids_json, included_lore_entry_ids_json, included_state_snapshot_id, response_text, extraction_json, state_changes_json, request_json, model_settings_json, created_at)
            VALUES
              ('prompt-1', 'chat-1', 'message-2', 'mock', 'fixture', 0.2, 100, 'prompt payload', '["memory-1"]', '["lore-entry-1"]', 'state-1', 'response payload', '{}', '{}', '{}', '{}', 't0');
            INSERT INTO image_prompt_runs
              (id, chat_id, message_id, provider, compiled_prompt, negative_prompt, style_preset, result_uri, created_at)
            VALUES
              ('image-1', 'chat-1', 'message-2', 'mock', 'image prompt payload', 'none', 'fixture', 'asset://image-1', 't0');
            "#,
        )
        .unwrap();
    }

    fn migration_status(runs: &[MigrationRun], version: i64) -> &'static str {
        runs.iter()
            .find(|run| run.version == version)
            .map(|run| run.status)
            .unwrap_or("missing")
    }

    fn latest_schema_version(conn: &Connection) -> i64 {
        conn.query_row(
            "SELECT COALESCE(MAX(version), 0) FROM schema_migrations",
            [],
            |row| row.get(0),
        )
        .unwrap()
    }

    fn count_migration_backups(workspace: &Path) -> usize {
        let backup_dir = workspace.join(BACKUP_DIR_NAME);
        let Ok(entries) = std::fs::read_dir(backup_dir) else {
            return 0;
        };
        entries
            .filter_map(|entry| entry.ok())
            .filter(|entry| {
                entry
                    .file_name()
                    .to_str()
                    .is_some_and(|name| name.starts_with(BACKUP_FILE_PREFIX))
            })
            .count()
    }

    fn count_foreign_keys(conn: &Connection) -> usize {
        foreign_key_signature(conn).len()
    }

    fn foreign_key_signature(conn: &Connection) -> Vec<String> {
        let mut output = Vec::new();
        for table in CONSTRAINED_CORE_TABLES {
            let mut statement = conn
                .prepare(&format!("PRAGMA foreign_key_list('{table}')"))
                .unwrap();
            let rows = statement
                .query_map([], |row| {
                    Ok(format!(
                        "{table}|{}|{}|{}|{}|{}",
                        row.get::<_, String>(3)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, String>(4)?,
                        row.get::<_, String>(5)?,
                        row.get::<_, String>(6)?,
                    ))
                })
                .unwrap();
            output.extend(rows.map(|row| row.unwrap()));
        }
        output.sort();
        output
    }

    fn count_check_constraints(conn: &Connection) -> usize {
        let mut statement = conn
            .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND sql IS NOT NULL")
            .unwrap();
        statement
            .query_map([], |row| row.get::<_, String>(0))
            .unwrap()
            .map(|sql| sql.unwrap().to_uppercase().matches("CHECK (").count())
            .sum()
    }

    fn core_schema_signature(conn: &Connection) -> Vec<String> {
        let mut statement = conn
            .prepare(
                "SELECT type, name, sql FROM sqlite_master
                 WHERE (type = 'table' AND name IN (
                   'character_versions', 'message_branches', 'messages', 'events',
                   'character_knowledge', 'memory_entries', 'memory_archive',
                   'lorebook_entries', 'rpg_state_snapshots', 'prompt_runs',
                   'image_prompt_runs'
                 )) OR (type = 'index' AND name LIKE 'idx_%')
                 ORDER BY type, name",
            )
            .unwrap();
        statement
            .query_map([], |row| {
                let sql: String = row.get(2)?;
                Ok(format!(
                    "{}|{}|{}",
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    sql.split_whitespace().collect::<Vec<_>>().join(" ")
                ))
            })
            .unwrap()
            .map(|row| row.unwrap())
            .collect()
    }

    fn assert_historical_rows_survived(conn: &Connection) {
        for (table, expected) in [
            ("character_versions", 1),
            ("message_branches", 1),
            ("messages", 2),
            ("events", 1),
            ("character_knowledge", 1),
            ("memory_entries", 1),
            ("memory_archive", 1),
            ("lorebook_entries", 1),
            ("rpg_state_snapshots", 1),
            ("prompt_runs", 1),
            ("image_prompt_runs", 1),
        ] {
            assert_eq!(
                count_rows(conn, table),
                expected,
                "row count changed for {table}"
            );
        }
        assert_eq!(
            conn.query_row(
                "SELECT content FROM messages WHERE id = 'message-2'",
                [],
                |row| row.get::<_, String>(0),
            )
            .unwrap(),
            "child payload"
        );
        assert_eq!(
            conn.query_row(
                "SELECT payload_json FROM memory_archive WHERE id = 'archive-1'",
                [],
                |row| row.get::<_, String>(0),
            )
            .unwrap(),
            "{\"preserve\":true}"
        );
    }

    fn assert_constraint_actions(conn: &Connection) {
        let mut expected = vec![
            "character_knowledge|character_id|characters|id|NO ACTION|CASCADE",
            "character_knowledge|chat_id|chats|id|NO ACTION|SET NULL",
            "character_knowledge|event_id|events|id|NO ACTION|CASCADE",
            "character_versions|character_id|characters|id|NO ACTION|CASCADE",
            "events|branch_id|message_branches|id|NO ACTION|SET NULL",
            "events|chat_id|chats|id|NO ACTION|CASCADE",
            "events|message_id|messages|id|NO ACTION|SET NULL",
            "image_prompt_runs|message_id|messages|id|NO ACTION|SET NULL",
            "lorebook_entries|lorebook_id|lorebooks|id|NO ACTION|CASCADE",
            "memory_archive|source_memory_id|memory_entries|id|NO ACTION|CASCADE",
            "memory_entries|chat_id|chats|id|NO ACTION|CASCADE",
            "message_branches|chat_id|chats|id|NO ACTION|CASCADE",
            "messages|branch_id|message_branches|id|NO ACTION|CASCADE",
            "messages|chat_id|chats|id|NO ACTION|CASCADE",
            "messages|parent_message_id|messages|id|NO ACTION|SET NULL",
            "prompt_runs|chat_id|chats|id|NO ACTION|CASCADE",
            "prompt_runs|message_id|messages|id|NO ACTION|SET NULL",
            "rpg_state_snapshots|branch_id|message_branches|id|NO ACTION|CASCADE",
            "rpg_state_snapshots|chat_id|chats|id|NO ACTION|CASCADE",
        ]
        .into_iter()
        .map(String::from)
        .collect::<Vec<_>>();
        expected.sort();
        assert_eq!(foreign_key_signature(conn), expected);
    }

    fn assert_check_constraints_are_enforced(conn: &Connection) {
        assert!(conn
            .execute(
                "INSERT INTO message_branches (id, chat_id, label, is_active, created_at, updated_at) VALUES ('bad-branch', 'chat-1', 'bad', 2, 't', 't')",
                [],
            )
            .is_err());
        assert!(conn
            .execute(
                "INSERT INTO messages (id, chat_id, branch_id, role, content, metadata_json, updated_at, created_at) VALUES ('bad-message-role', 'chat-1', 'branch-1', 'invalid', 'bad', '{}', 't', 't')",
                [],
            )
            .is_err());
        assert!(conn
            .execute(
                "INSERT INTO events (id, chat_id, summary, participant_character_ids_json, world_truth, created_at) VALUES ('bad-event', 'chat-1', 'bad', '[]', 2, 't')",
                [],
            )
            .is_err());
        assert!(conn
            .execute(
                "INSERT INTO memory_entries (id, chat_id, category, text, importance, pinned, related_character_ids_json, related_event_ids_json, created_at, updated_at) VALUES ('bad-memory', 'chat-1', 'bad', 'bad', 1, 2, '[]', '[]', 't', 't')",
                [],
            )
            .is_err());
        assert!(conn
            .execute(
                "INSERT INTO lorebook_entries (id, lorebook_id, title, content, constant, triggers_json, created_at, updated_at) VALUES ('bad-lore', 'lorebook-1', 'bad', 'bad', 2, '[]', 't', 't')",
                [],
            )
            .is_err());
    }

    fn assert_foreign_keys_reject_orphans(conn: &Connection) {
        assert!(conn
            .execute(
                "INSERT INTO messages (id, chat_id, branch_id, role, content, metadata_json, updated_at, created_at) VALUES ('orphan-message-v3', 'missing-chat', 'missing-branch', 'assistant', 'orphan', '{}', 't', 't')",
                [],
            )
            .is_err());
    }

    fn count_rows(conn: &Connection, table: &str) -> i64 {
        conn.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
            row.get(0)
        })
        .unwrap()
    }

    fn count_indexes(conn: &Connection) -> i64 {
        conn.query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_%'",
            [],
            |row| row.get(0),
        )
        .unwrap()
    }

    fn temp_db_path(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "local-first-ai-rpg-runtime-{name}-{}.db",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ))
    }

    /// Per-test directory so backup/archive tests never share a backups folder.
    fn temp_workspace_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "local-first-ai-rpg-runtime-ws-{name}-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn backup_rotates_and_preserves_the_database() {
        let workspace = temp_workspace_dir("backup_rotates");
        let path = workspace.join("runtime.db");
        initialize_repository_at_path(&path).unwrap();

        for _ in 0..(BACKUP_KEEP_COUNT + 2) {
            let backed_up_to = backup_database_at_path(&path).unwrap();
            assert!(backed_up_to.is_some());
            assert!(PathBuf::from(backed_up_to.unwrap()).is_file());
        }

        let backup_dir = workspace.join(BACKUP_DIR_NAME);
        let backup_count = std::fs::read_dir(&backup_dir)
            .unwrap()
            .filter_map(|entry| entry.ok())
            .filter(|entry| {
                entry
                    .file_name()
                    .to_str()
                    .is_some_and(|file_name| file_name.starts_with(BACKUP_FILE_PREFIX))
            })
            .count();
        assert_eq!(backup_count, BACKUP_KEEP_COUNT);
        assert!(path.is_file());
        assert!(load_runtime_snapshot_at_path(&path).is_ok());

        let _ = std::fs::remove_dir_all(&workspace);
    }

    #[test]
    fn backup_returns_none_when_database_is_missing() {
        let workspace = temp_workspace_dir("backup_missing");
        let path = workspace.join("runtime.db");

        assert!(backup_database_at_path(&path).unwrap().is_none());

        let _ = std::fs::remove_dir_all(&workspace);
    }

    #[test]
    fn backup_includes_committed_wal_rows() {
        let workspace = temp_workspace_dir("backup_includes_wal");
        let path = workspace.join("runtime.db");
        let conn = Connection::open(&path).unwrap();
        conn.pragma_update(None, "journal_mode", "WAL").unwrap();
        conn.execute_batch(
            "CREATE TABLE backup_probe (value TEXT NOT NULL);
             INSERT INTO backup_probe (value) VALUES ('committed-in-wal');",
        )
        .unwrap();

        let backup_path = PathBuf::from(backup_database_at_path(&path).unwrap().unwrap());
        let backup = Connection::open(&backup_path).unwrap();
        assert_eq!(
            backup
                .query_row("SELECT value FROM backup_probe", [], |row| {
                    row.get::<_, String>(0)
                })
                .unwrap(),
            "committed-in-wal"
        );
        drop(backup);
        drop(conn);
        let _ = std::fs::remove_dir_all(&workspace);
    }

    #[test]
    fn archive_moves_the_database_aside() {
        let workspace = temp_workspace_dir("archive_moves");
        let path = workspace.join("runtime.db");
        initialize_repository_at_path(&path).unwrap();

        let archived_to = archive_database_at_path(&path).unwrap();
        assert!(archived_to.is_some());
        let archived_path = PathBuf::from(archived_to.unwrap());
        assert!(archived_path.is_file());
        assert!(archived_path
            .file_name()
            .and_then(|file_name| file_name.to_str())
            .is_some_and(|file_name| file_name.starts_with(ARCHIVE_FILE_PREFIX)));
        assert!(!path.exists());

        // A second archive has nothing left to move.
        assert!(archive_database_at_path(&path).unwrap().is_none());

        let _ = std::fs::remove_dir_all(&workspace);
    }

    fn cleanup(path: &Path) {
        let _ = std::fs::remove_file(path);
    }
}
