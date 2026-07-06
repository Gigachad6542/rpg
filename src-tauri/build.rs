fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "initialize_runtime_repository",
            "load_runtime_snapshot",
            "save_runtime_snapshot",
            "secure_storage_status",
            "store_provider_secret",
            "delete_provider_secret",
            "generate_text_with_stored_secret",
            "persist_generated_image",
        ]),
    ))
    .expect("failed to build Tauri app");
}
