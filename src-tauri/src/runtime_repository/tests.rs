use super::*;

const HISTORICAL_SCHEMA_V1: &str = include_str!("../../tests/fixtures/schema-v1-0996b8d.sql");

#[test]
fn migrations_are_idempotent() {
    let path = temp_db_path("migrations_are_idempotent");
    let first = initialize_repository_at_path(&path).unwrap();
    let second = initialize_repository_at_path(&path).unwrap();
    assert_eq!(first.len(), schema::migration_count());
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
            "Local-First RPG runtime snapshot",
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
fn present_but_unparseable_snapshot_fails_closed_instead_of_reporting_empty() {
    let path = temp_db_path("present_but_unparseable_snapshot_fails_closed");
    initialize_repository_at_path(&path).unwrap();
    let conn = Connection::open(&path).unwrap();
    conn.execute(
        "INSERT INTO characters (id, name, description, profile_json, source, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            RUNTIME_SNAPSHOT_CHARACTER_ID,
            "Local-First RPG runtime snapshot",
            "corrupt",
            "{ this is not valid json",
            "runtime-snapshot",
            now_iso(),
            now_iso(),
        ],
    )
    .unwrap();
    drop(conn);

    // A present-but-corrupt row must surface as an error (→ recovery gate),
    // never as Ok(None), which would let autosave overwrite the real row.
    assert!(matches!(
        load_runtime_snapshot_at_path(&path),
        Err(RuntimeRepositoryError::Validation(_))
    ));
    cleanup(&path);
}

#[test]
fn present_snapshot_missing_cards_array_fails_closed() {
    let path = temp_db_path("present_snapshot_missing_cards_array_fails_closed");
    initialize_repository_at_path(&path).unwrap();
    let conn = Connection::open(&path).unwrap();
    conn.execute(
        "INSERT INTO characters (id, name, description, profile_json, source, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            RUNTIME_SNAPSHOT_CHARACTER_ID,
            "Local-First RPG runtime snapshot",
            "corrupt",
            json_string(&json!({ "snapshot": { "theme": "dark" } })),
            "runtime-snapshot",
            now_iso(),
            now_iso(),
        ],
    )
    .unwrap();
    drop(conn);

    assert!(matches!(
        load_runtime_snapshot_at_path(&path),
        Err(RuntimeRepositoryError::Validation(_))
    ));
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
        loaded["promptRuns"][0]["modelCalls"][0]["phase"],
        json!("hidden-continuity")
    );
    assert_eq!(
        loaded["promptRuns"][0]["modelCalls"][1]["usage"]["totalTokens"],
        json!(28)
    );
    assert_eq!(
        loaded["promptRuns"][0]["modelCalls"][0]["inputBudgetTokens"],
        json!(14200)
    );
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
        "portraitGenerationMode": "confirm-first",
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
    assert_eq!(
        sanitized["imageProviderSettings"]["portraitGenerationMode"],
        json!("confirm-first")
    );
    assert_eq!(sanitized["imageProviderSettings"]["workflowJson"], json!("{\"1\":{\"class_type\":\"CheckpointLoaderSimple\",\"inputs\":{\"ckpt_name\":\"FLUX.1-schnell\"}}}"));
    assert!(sanitized["imageProviderSettings"].get("apiKey").is_none());
    assert!(sanitized["imageProviderSettings"].get("ignored").is_none());

    let mut unsafe_image_settings = fixture_snapshot("card");
    unsafe_image_settings["imageProviderSettings"] = json!({
        "mode": "comfyui",
        "portraitGenerationMode": "untrusted",
        "workflowJson": "{\"1\":{\"inputs\":{\"apiKey\":\"workflow-secret\"}}}",
        "token": "raw-token"
    });
    let sanitized = sanitize_snapshot(unsafe_image_settings).unwrap();
    assert_eq!(sanitized["imageProviderSettings"]["mode"], json!("comfyui"));
    assert!(sanitized["imageProviderSettings"]
        .get("portraitGenerationMode")
        .is_none());
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
    assert!(save_runtime_snapshot_in_transaction(&tx, &mut second, Some("after_prune")).is_err());
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
                "usage": { "inputTokens": 20, "outputTokens": 8, "totalTokens": 28 },
                "modelCalls": [
                    {
                        "phase": "hidden-continuity",
                        "provider": "mock",
                        "model": "mock-narrator",
                        "usage": { "inputTokens": 8, "outputTokens": 2, "totalTokens": 10 },
                        "inputBudgetTokens": 14200,
                        "durationMs": 12,
                        "status": "success"
                    },
                    {
                        "phase": "visible-response",
                        "provider": "mock",
                        "model": "mock-narrator",
                        "usage": { "inputTokens": 20, "outputTokens": 8, "totalTokens": 28 },
                        "inputBudgetTokens": 5100,
                        "durationMs": 34,
                        "status": "success"
                    }
                ]
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
