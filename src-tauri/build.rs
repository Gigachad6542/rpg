fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "initialize_runtime_repository",
            "load_runtime_snapshot",
            "save_runtime_snapshot",
            "backup_runtime_database",
            "archive_runtime_database",
            "secure_storage_status",
            "store_provider_secret",
            "delete_provider_secret",
            "generate_text_with_stored_secret",
            "persist_generated_image",
            "sync_generated_image_files",
            "discover_local_text_providers",
            "download_chub_character",
        ]),
    ))
    .expect("failed to build Tauri app");
}
