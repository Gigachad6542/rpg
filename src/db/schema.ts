export interface SqlMigration {
  version: number;
  name: string;
  statements: readonly string[];
}

export const sqliteMigrations: readonly SqlMigration[] = [
  {
    version: 1,
    name: "initial_core_schema",
    statements: [
      `CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS profiles (
        id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS model_provider_configs (
        id TEXT PRIMARY KEY,
        provider_id TEXT NOT NULL,
        display_name TEXT NOT NULL,
        base_url TEXT,
        default_model_id TEXT,
        secret_ref TEXT,
        non_secret_settings_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS characters (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        profile_json TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'manual',
        introduced_at_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS character_versions (
        id TEXT PRIMARY KEY,
        character_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        card_json TEXT NOT NULL,
        change_reason TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE
      )`,
      `CREATE TABLE IF NOT EXISTS chats (
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
      )`,
      `CREATE TABLE IF NOT EXISTS message_branches (
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
      )`,
      `CREATE TABLE IF NOT EXISTS messages (
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
      )`,
      `CREATE TABLE IF NOT EXISTS events (
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
      )`,
      `CREATE TABLE IF NOT EXISTS character_knowledge (
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
      )`,
      `CREATE TABLE IF NOT EXISTS relationships (
        id TEXT PRIMARY KEY,
        subject_type TEXT NOT NULL,
        subject_id TEXT NOT NULL,
        object_type TEXT NOT NULL,
        object_id TEXT NOT NULL,
        metrics_json TEXT NOT NULL,
        notes TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS memory_entries (
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
      )`,
      `CREATE TABLE IF NOT EXISTS memory_archive (
        id TEXT PRIMARY KEY,
        source_memory_id TEXT NOT NULL,
        archive_reason TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        archived_at TEXT NOT NULL,
        FOREIGN KEY (source_memory_id) REFERENCES memory_entries(id) ON DELETE CASCADE
      )`,
      `CREATE TABLE IF NOT EXISTS lorebooks (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS lorebook_entries (
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
      )`,
      `CREATE TABLE IF NOT EXISTS rpg_worlds (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        ruleset TEXT NOT NULL,
        description TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS rpg_state_snapshots (
        id TEXT PRIMARY KEY,
        world_id TEXT NOT NULL,
        chat_id TEXT NOT NULL,
        branch_id TEXT NOT NULL,
        message_id TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE,
        FOREIGN KEY (branch_id) REFERENCES message_branches(id) ON DELETE CASCADE
      )`,
      `CREATE TABLE IF NOT EXISTS prompt_runs (
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
      )`,
      `CREATE TABLE IF NOT EXISTS image_prompt_runs (
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
      )`,
      `CREATE INDEX IF NOT EXISTS idx_message_branches_chat_active
        ON message_branches(chat_id, is_active)`,
      `CREATE INDEX IF NOT EXISTS idx_messages_chat_branch_created
        ON messages(chat_id, branch_id, created_at)`,
      `CREATE INDEX IF NOT EXISTS idx_prompt_runs_chat_created
        ON prompt_runs(chat_id, created_at)`,
      `CREATE INDEX IF NOT EXISTS idx_image_prompt_runs_chat_created
        ON image_prompt_runs(chat_id, created_at)`,
      `CREATE INDEX IF NOT EXISTS idx_lorebook_entries_lorebook_updated
        ON lorebook_entries(lorebook_id, updated_at)`,
      `CREATE INDEX IF NOT EXISTS idx_memory_entries_chat_updated
        ON memory_entries(chat_id, updated_at)`,
      `CREATE INDEX IF NOT EXISTS idx_rpg_state_snapshots_chat_created
        ON rpg_state_snapshots(chat_id, created_at)`,
    ],
  },
];
