use rusqlite::{params, Connection, OptionalExtension, Transaction, TransactionBehavior};
use std::collections::BTreeSet;
use std::path::Path;

use super::{backup_database_at_path, now_iso, MigrationRun, RepoResult, RuntimeRepositoryError};

pub(super) fn configure_connection(conn: &Connection) -> RepoResult<()> {
    conn.pragma_update(None, "foreign_keys", "ON")
        .map_err(|_| RuntimeRepositoryError::Storage)?;
    conn.busy_timeout(std::time::Duration::from_millis(5_000))
        .map_err(|_| RuntimeRepositoryError::Storage)?;
    Ok(())
}

/// Applies every absent migration in order. Static migrations use transactional
/// SQL; v3 uses a procedural table rebuild because SQLite cannot add historical
/// foreign keys or CHECK constraints with ALTER TABLE.
pub(super) fn run_migrations(
    conn: &mut Connection,
    database_path: &Path,
) -> RepoResult<Vec<MigrationRun>> {
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

#[cfg(test)]
pub(super) fn migration_count() -> usize {
    MIGRATIONS.len()
}

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

pub(super) const SCHEMA_V2_INDEX_STATEMENTS: &[&str] = &[
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
