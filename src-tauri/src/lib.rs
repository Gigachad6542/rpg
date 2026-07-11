#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    if let Err(error) = runtime_repository::initialize_smoke_repository_from_env() {
        panic!("{}", runtime_repository::redact_storage_error(error));
    }

    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            initialize_runtime_repository,
            load_runtime_snapshot,
            save_runtime_snapshot,
            backup_runtime_database,
            archive_runtime_database,
            secure_storage_status,
            store_provider_secret,
            delete_provider_secret,
            generate_text_with_stored_secret,
            persist_generated_image
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

mod runtime_repository;

const KEYRING_SERVICE: &str = "local-first-ai-rpg-runtime";
const SECRET_STORAGE_KIND: &str = "os-keychain";
const MAX_PROMPT_CHARS: usize = 200_000;
const DEFAULT_OUTPUT_TOKENS: u32 = 900;
const MAX_OUTPUT_TOKENS: u32 = 4_096;
const MAX_MODEL_ID_CHARS: usize = 160;
const DEFAULT_PROVIDER_REQUEST_TIMEOUT_MS: u64 = 60_000;
const MAX_PROVIDER_REQUEST_TIMEOUT_MS: u64 = 300_000;
const MAX_GENERATION_REQUESTS_PER_WINDOW: usize = 20;
const GENERATION_RATE_LIMIT_WINDOW: std::time::Duration = std::time::Duration::from_secs(60);

static GENERATION_REQUEST_TIMESTAMPS: std::sync::OnceLock<
    std::sync::Mutex<Vec<std::time::Instant>>,
> = std::sync::OnceLock::new();

#[tauri::command]
fn initialize_runtime_repository(
    app: tauri::AppHandle,
    database_path: Option<String>,
) -> Result<runtime_repository::RuntimeRepositoryInitialization, String> {
    runtime_repository::initialize_runtime_repository(app, database_path)
        .map_err(runtime_repository::redact_storage_error)
}

#[tauri::command]
fn load_runtime_snapshot(
    app: tauri::AppHandle,
    database_path: Option<String>,
) -> Result<runtime_repository::LoadRuntimeSnapshotResponse, String> {
    runtime_repository::load_runtime_snapshot(app, database_path)
        .map_err(runtime_repository::redact_storage_error)
}

#[tauri::command]
fn save_runtime_snapshot(
    app: tauri::AppHandle,
    database_path: Option<String>,
    snapshot: serde_json::Value,
) -> Result<runtime_repository::SaveRuntimeSnapshotResponse, String> {
    runtime_repository::save_runtime_snapshot(app, database_path, snapshot)
        .map_err(runtime_repository::redact_storage_error)
}

#[tauri::command]
fn backup_runtime_database(
    app: tauri::AppHandle,
    database_path: Option<String>,
) -> Result<runtime_repository::BackupRuntimeDatabaseResponse, String> {
    runtime_repository::backup_runtime_database(app, database_path)
        .map_err(runtime_repository::redact_storage_error)
}

#[tauri::command]
fn archive_runtime_database(
    app: tauri::AppHandle,
    database_path: Option<String>,
) -> Result<runtime_repository::ArchiveRuntimeDatabaseResponse, String> {
    runtime_repository::archive_runtime_database(app, database_path)
        .map_err(runtime_repository::redact_storage_error)
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct SecureStorageStatus {
    available: bool,
    storage_kind: &'static str,
    reason: Option<String>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct SecretReference {
    provider_id: String,
    secret_name: String,
    storage_kind: &'static str,
    storage_key: String,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct SecretReferenceInput {
    provider_id: String,
    secret_name: String,
    storage_kind: String,
    storage_key: String,
    provider_base_url: Option<String>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredTextGenerationRequest {
    provider_id: String,
    base_url: String,
    model: String,
    secret_reference: SecretReferenceInput,
    prompt: String,
    system_prompt: Option<String>,
    temperature: Option<f32>,
    max_output_tokens: Option<u32>,
    timeout_ms: Option<u64>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct StoredTextGenerationResponse {
    provider_id: String,
    model: String,
    text: String,
    finish_reason: String,
    usage: TextUsage,
    raw: serde_json::Value,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct TextUsage {
    input_tokens: u32,
    output_tokens: u32,
    total_tokens: u32,
}

#[derive(serde::Deserialize)]
struct ChatCompletionResponse {
    choices: Option<Vec<ChatCompletionChoice>>,
    usage: Option<ChatCompletionUsage>,
}

#[derive(serde::Deserialize)]
struct ChatCompletionChoice {
    message: Option<ChatCompletionMessage>,
    finish_reason: Option<String>,
}

#[derive(serde::Deserialize)]
struct ChatCompletionMessage {
    content: Option<String>,
}

#[derive(serde::Deserialize)]
struct ChatCompletionUsage {
    prompt_tokens: Option<u32>,
    completion_tokens: Option<u32>,
    total_tokens: Option<u32>,
}

#[tauri::command]
fn secure_storage_status() -> SecureStorageStatus {
    match probe_keyring() {
        Ok(()) => SecureStorageStatus {
            available: true,
            storage_kind: SECRET_STORAGE_KIND,
            reason: None,
        },
        Err(reason) => SecureStorageStatus {
            available: false,
            storage_kind: SECRET_STORAGE_KIND,
            reason: Some(reason),
        },
    }
}

#[tauri::command]
fn store_provider_secret(
    provider_id: String,
    secret_name: String,
    secret_value: String,
) -> Result<SecretReference, String> {
    let storage_key = secret_storage_key(&provider_id, &secret_name)?;
    if secret_value.trim().is_empty() {
        return Err("Secret value cannot be empty.".to_string());
    }

    let entry = keyring_entry(&storage_key)?;
    entry
        .set_password(&secret_value)
        .map_err(|error| format!("Could not write secret to OS keychain: {error}"))?;

    Ok(SecretReference {
        provider_id,
        secret_name,
        storage_kind: SECRET_STORAGE_KIND,
        storage_key,
    })
}

#[tauri::command]
fn delete_provider_secret(
    provider_id: String,
    secret_name: String,
    storage_key: String,
) -> Result<(), String> {
    let expected_key = secret_storage_key(&provider_id, &secret_name)?;
    if storage_key != expected_key {
        return Err("Secret reference does not match the requested provider.".to_string());
    }

    let entry = keyring_entry(&storage_key)?;
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(format!("Could not delete secret from OS keychain: {error}")),
    }
}

#[tauri::command]
async fn generate_text_with_stored_secret(
    request: StoredTextGenerationRequest,
) -> Result<StoredTextGenerationResponse, String> {
    let provider_id = normalize_identifier(&request.provider_id, "provider id")?;
    let base_url = normalize_allowed_provider_base_url(&provider_id, &request.base_url)?;
    validate_secret_reference_for_request(&request.secret_reference, &provider_id, &base_url)?;
    validate_generation_prompt(&request.prompt)?;
    validate_generation_model(&request.model)?;
    let max_output_tokens = validate_max_output_tokens(request.max_output_tokens)?;
    let request_timeout = validate_request_timeout(request.timeout_ms)?;
    check_generation_rate_limit()?;

    let entry = keyring_entry(&request.secret_reference.storage_key)?;
    let secret = entry.get_password().map_err(|error| match error {
        keyring::Error::NoEntry => {
            "Stored provider key reference exists, but the OS keychain entry was not found."
                .to_string()
        }
        _ => "Could not read provider key from OS keychain. Secret details were redacted."
            .to_string(),
    })?;

    let mut messages = Vec::new();
    if let Some(system_prompt) = request.system_prompt.as_deref() {
        if !system_prompt.trim().is_empty() {
            messages.push(serde_json::json!({ "role": "system", "content": system_prompt }));
        }
    }
    messages.push(serde_json::json!({ "role": "user", "content": request.prompt }));

    let body = serde_json::json!({
        "model": request.model,
        "temperature": request.temperature,
        "max_tokens": max_output_tokens,
        "messages": messages,
    });

    let client = reqwest::Client::builder()
        .timeout(request_timeout)
        .build()
        .map_err(|_| "Could not initialize provider HTTP client.".to_string())?;
    let response = client
        .post(format!("{base_url}/chat/completions"))
        .bearer_auth(&secret)
        .json(&body)
        .send()
        .await
        .map_err(|_| "Provider request failed before receiving a response.".to_string())?;
    drop(secret);

    if !response.status().is_success() {
        let status = response.status();
        let _ = response.text().await;
        return Err(format!(
            "Provider request failed ({status}). Error details were redacted."
        ));
    }

    let raw = response
        .json::<serde_json::Value>()
        .await
        .map_err(|_| "Provider returned invalid JSON.".to_string())?;
    let parsed: ChatCompletionResponse = serde_json::from_value(raw.clone())
        .map_err(|_| "Provider response did not match chat completion shape.".to_string())?;
    let choice = parsed.choices.as_ref().and_then(|choices| choices.first());
    let text = choice
        .and_then(|choice| choice.message.as_ref())
        .and_then(|message| message.content.as_deref())
        .unwrap_or("")
        .trim()
        .to_string();
    let input_tokens = parsed
        .usage
        .as_ref()
        .and_then(|usage| usage.prompt_tokens)
        .unwrap_or_else(|| estimate_text_tokens(&request.prompt));
    let output_tokens = parsed
        .usage
        .as_ref()
        .and_then(|usage| usage.completion_tokens)
        .unwrap_or_else(|| estimate_text_tokens(&text));

    Ok(StoredTextGenerationResponse {
        provider_id,
        model: request.model,
        text,
        finish_reason: map_finish_reason(choice.and_then(|choice| choice.finish_reason.as_deref()))
            .to_string(),
        usage: TextUsage {
            input_tokens,
            output_tokens,
            total_tokens: parsed
                .usage
                .and_then(|usage| usage.total_tokens)
                .unwrap_or(input_tokens + output_tokens),
        },
        raw,
    })
}

const GENERATED_IMAGE_DIR: &str = "generated-images";
const MAX_IMAGE_BASE64_CHARS: usize = 16_000_000;

#[tauri::command]
fn persist_generated_image(
    app: tauri::AppHandle,
    artifact_id: String,
    format: String,
    base64_data: String,
) -> Result<String, String> {
    use tauri::Manager as _;

    let artifact_id = normalize_identifier(&artifact_id, "artifact id")?;
    let extension = validate_generated_image_format(&format)?;
    let bytes = decode_generated_image_base64(&base64_data)?;
    validate_image_magic_bytes(extension, &bytes)?;

    let directory = app
        .path()
        .app_data_dir()
        .map_err(|_| "Could not resolve the app data directory.".to_string())?
        .join(GENERATED_IMAGE_DIR);
    std::fs::create_dir_all(&directory)
        .map_err(|_| "Could not create the generated image directory.".to_string())?;

    let path = directory.join(format!("{artifact_id}.{extension}"));
    std::fs::write(&path, bytes)
        .map_err(|_| "Could not write the generated image file.".to_string())?;

    Ok(path.to_string_lossy().to_string())
}

fn validate_generated_image_format(format: &str) -> Result<&'static str, String> {
    match format.trim().to_ascii_lowercase().as_str() {
        "png" => Ok("png"),
        "jpeg" | "jpg" => Ok("jpg"),
        "webp" => Ok("webp"),
        _ => Err("Generated images only support png, jpeg, or webp.".to_string()),
    }
}

fn decode_generated_image_base64(data: &str) -> Result<Vec<u8>, String> {
    use base64::Engine as _;

    let trimmed = data.trim();
    if trimmed.is_empty() {
        return Err("Generated image data cannot be empty.".to_string());
    }
    if trimmed.len() > MAX_IMAGE_BASE64_CHARS {
        return Err("Generated image exceeds the local size limit.".to_string());
    }
    base64::engine::general_purpose::STANDARD
        .decode(trimmed)
        .map_err(|_| "Generated image data is not valid base64.".to_string())
}

/// Rejects decoded payloads whose leading bytes do not match the declared image
/// format. The extension has already been narrowed to one of "png"/"jpg"/"webp"
/// by `validate_generated_image_format`, so this only guards against arbitrary
/// bytes being written under an image extension.
fn validate_image_magic_bytes(extension: &str, bytes: &[u8]) -> Result<(), String> {
    let matches = match extension {
        "png" => bytes.starts_with(&[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
        "jpg" => bytes.starts_with(&[0xFF, 0xD8, 0xFF]),
        "webp" => bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP",
        _ => false,
    };
    if matches {
        Ok(())
    } else {
        Err("Generated image bytes do not match the declared image format.".to_string())
    }
}

fn keyring_entry(storage_key: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYRING_SERVICE, storage_key)
        .map_err(|error| format!("Could not open OS keychain entry: {error}"))
}

fn probe_keyring() -> Result<(), String> {
    let entry = keyring_entry("__secure_storage_probe__")?;
    match entry.get_password() {
        Ok(_) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(format!("Could not access OS keychain: {error}")),
    }
}

fn secret_storage_key(provider_id: &str, secret_name: &str) -> Result<String, String> {
    let provider_id = normalize_identifier(provider_id, "provider id")?;
    let secret_name = normalize_identifier(secret_name, "secret name")?;
    validate_known_provider_id(&provider_id)?;
    validate_secret_name(&secret_name)?;
    Ok(format!("{provider_id}:{secret_name}"))
}

fn validate_known_provider_id(provider_id: &str) -> Result<(), String> {
    match provider_id {
        "alibaba-model-studio" | "openrouter" | "local" => Ok(()),
        _ => Err("Provider id is not supported for stored secrets.".to_string()),
    }
}

fn validate_secret_name(secret_name: &str) -> Result<(), String> {
    if secret_name == "apiKey" {
        Ok(())
    } else {
        Err("Stored provider secrets only support apiKey.".to_string())
    }
}

fn validate_generation_prompt(prompt: &str) -> Result<(), String> {
    if prompt.trim().is_empty() {
        return Err("Prompt cannot be empty.".to_string());
    }
    if prompt.chars().count() > MAX_PROMPT_CHARS {
        return Err("Prompt exceeds the local safety limit.".to_string());
    }
    Ok(())
}

fn validate_generation_model(model: &str) -> Result<(), String> {
    let trimmed = model.trim();
    if trimmed.is_empty() {
        return Err("Model id cannot be empty.".to_string());
    }
    if trimmed.chars().count() > MAX_MODEL_ID_CHARS {
        return Err("Model id is too long.".to_string());
    }
    if !trimmed.chars().all(|character| {
        character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.' | '/' | ':')
    }) {
        return Err("Model id contains unsupported characters.".to_string());
    }
    Ok(())
}

fn validate_max_output_tokens(value: Option<u32>) -> Result<u32, String> {
    let tokens = value.unwrap_or(DEFAULT_OUTPUT_TOKENS);
    if tokens == 0 || tokens > MAX_OUTPUT_TOKENS {
        return Err("Requested output token count exceeds the local safety limit.".to_string());
    }
    Ok(tokens)
}

fn validate_request_timeout(value: Option<u64>) -> Result<std::time::Duration, String> {
    let timeout_ms = value.unwrap_or(DEFAULT_PROVIDER_REQUEST_TIMEOUT_MS);
    if timeout_ms == 0 || timeout_ms > MAX_PROVIDER_REQUEST_TIMEOUT_MS {
        return Err(format!(
            "Provider request timeout must be between 1 and {MAX_PROVIDER_REQUEST_TIMEOUT_MS}ms."
        ));
    }
    Ok(std::time::Duration::from_millis(timeout_ms))
}

fn check_generation_rate_limit() -> Result<(), String> {
    let mut timestamps = GENERATION_REQUEST_TIMESTAMPS
        .get_or_init(|| std::sync::Mutex::new(Vec::new()))
        .lock()
        .map_err(|_| "Provider request limiter is unavailable.".to_string())?;

    check_generation_rate_limit_for(&mut timestamps, std::time::Instant::now())
}

fn check_generation_rate_limit_for(
    timestamps: &mut Vec<std::time::Instant>,
    now: std::time::Instant,
) -> Result<(), String> {
    timestamps.retain(|timestamp| now.duration_since(*timestamp) <= GENERATION_RATE_LIMIT_WINDOW);
    if timestamps.len() >= MAX_GENERATION_REQUESTS_PER_WINDOW {
        return Err(
            "Provider request rate limit exceeded. Wait before sending another request."
                .to_string(),
        );
    }
    timestamps.push(now);
    Ok(())
}

fn validate_secret_reference_for_request(
    reference: &SecretReferenceInput,
    provider_id: &str,
    base_url: &str,
) -> Result<(), String> {
    if reference.storage_kind != SECRET_STORAGE_KIND {
        return Err("Stored provider key must use the OS keychain.".to_string());
    }
    if normalize_identifier(&reference.provider_id, "secret provider id")? != provider_id {
        return Err("Stored provider key reference does not match this provider.".to_string());
    }
    if reference.secret_name != "apiKey" {
        return Err("Stored provider key reference uses an unsupported secret name.".to_string());
    }
    let expected_key = secret_storage_key(&reference.provider_id, &reference.secret_name)?;
    if reference.storage_key != expected_key {
        return Err("Stored provider key reference is not canonical.".to_string());
    }
    let reference_base_url = reference
        .provider_base_url
        .as_deref()
        .ok_or_else(|| "Stored provider key reference must include its endpoint.".to_string())?;
    if normalize_allowed_provider_base_url(provider_id, reference_base_url)? != base_url {
        return Err("Stored provider key reference does not match this endpoint.".to_string());
    }
    Ok(())
}

fn normalize_allowed_provider_base_url(
    provider_id: &str,
    base_url: &str,
) -> Result<String, String> {
    let trimmed = base_url.trim().trim_end_matches('/');
    let parsed = reqwest::Url::parse(trimmed)
        .map_err(|_| "Provider endpoint must be a valid URL.".to_string())?;
    if parsed.query().is_some() || parsed.fragment().is_some() {
        return Err("Provider endpoint cannot include query or fragment text.".to_string());
    }

    let host = parsed.host_str().unwrap_or("").to_ascii_lowercase();
    let scheme = parsed.scheme();
    if provider_id == "local" {
        if ["http", "https"].contains(&scheme)
            && ["localhost", "127.0.0.1", "::1"].contains(&host.as_str())
        {
            return Ok(trimmed.to_string());
        }
        return Err("Local provider endpoints must be loopback URLs.".to_string());
    }

    let known_base_url = match provider_id {
        "alibaba-model-studio" => Some("https://dashscope-intl.aliyuncs.com/compatible-mode/v1"),
        "openrouter" => Some("https://openrouter.ai/api/v1"),
        _ => None,
    };
    if let Some(known_base_url) = known_base_url {
        if trimmed == known_base_url {
            return Ok(trimmed.to_string());
        }
        return Err("Provider endpoint must match the selected known hosted provider.".to_string());
    }

    Err("Hosted provider endpoints must use a known provider preset.".to_string())
}

fn map_finish_reason(reason: Option<&str>) -> &'static str {
    match reason {
        Some("length") => "length",
        Some("tool_calls") | Some("function_call") => "tool_call",
        Some("stop") | None => "stop",
        _ => "error",
    }
}

fn estimate_text_tokens(value: &str) -> u32 {
    let chars = value.chars().count() as u32;
    (chars / 4).max(1)
}

fn normalize_identifier(value: &str, label: &str) -> Result<String, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(format!("{label} cannot be empty."));
    }
    if trimmed.len() > 96 {
        return Err(format!("{label} is too long."));
    }
    if !trimmed
        .chars()
        .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.'))
    {
        return Err(format!(
            "{label} can only contain letters, numbers, dashes, underscores, or periods."
        ));
    }
    Ok(trimmed.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn secret_storage_key_rejects_colon_collisions() {
        assert!(secret_storage_key("a:b", "c").is_err());
        assert!(secret_storage_key("a", "b:c").is_err());
        assert_eq!(
            secret_storage_key("openrouter", "apiKey").unwrap(),
            "openrouter:apiKey"
        );
    }

    #[test]
    fn secret_storage_key_rejects_unknown_providers_and_non_api_key_names() {
        assert!(secret_storage_key("unknown-provider", "apiKey").is_err());
        assert!(secret_storage_key("openrouter", "refreshToken").is_err());
        assert_eq!(
            secret_storage_key("alibaba-model-studio", "apiKey").unwrap(),
            "alibaba-model-studio:apiKey"
        );
    }

    #[test]
    fn hosted_provider_urls_are_limited_to_known_providers() {
        assert!(
            normalize_allowed_provider_base_url("unknown-provider", "https://example.test/v1")
                .is_err()
        );
        assert_eq!(
            normalize_allowed_provider_base_url("openrouter", "https://openrouter.ai/api/v1")
                .unwrap(),
            "https://openrouter.ai/api/v1"
        );
    }

    #[test]
    fn generation_request_limits_reject_oversized_prompts_models_and_outputs() {
        assert!(validate_generation_prompt("x".repeat(MAX_PROMPT_CHARS + 1).as_str()).is_err());
        assert!(validate_generation_model("model name with spaces").is_err());
        assert!(validate_generation_model("qwen3.7-max").is_ok());
        assert!(validate_max_output_tokens(Some(MAX_OUTPUT_TOKENS + 1)).is_err());
        assert_eq!(
            validate_max_output_tokens(None).unwrap(),
            DEFAULT_OUTPUT_TOKENS
        );
        assert_eq!(
            validate_request_timeout(None).unwrap(),
            std::time::Duration::from_millis(DEFAULT_PROVIDER_REQUEST_TIMEOUT_MS)
        );
        assert!(validate_request_timeout(Some(MAX_PROVIDER_REQUEST_TIMEOUT_MS + 1)).is_err());
    }

    #[test]
    fn generated_image_persistence_validates_format_and_payload() {
        assert_eq!(validate_generated_image_format("PNG").unwrap(), "png");
        assert_eq!(validate_generated_image_format("jpeg").unwrap(), "jpg");
        assert_eq!(validate_generated_image_format(" webp ").unwrap(), "webp");
        assert!(validate_generated_image_format("gif").is_err());
        assert!(validate_generated_image_format("../png").is_err());

        assert!(decode_generated_image_base64("").is_err());
        assert!(decode_generated_image_base64("not-base64!!").is_err());
        assert_eq!(decode_generated_image_base64("aGVsbG8=").unwrap(), b"hello");
        let oversized = "A".repeat(MAX_IMAGE_BASE64_CHARS + 1);
        assert!(decode_generated_image_base64(&oversized).is_err());
    }

    #[test]
    fn image_magic_bytes_must_match_declared_format() {
        let png = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00];
        assert!(validate_image_magic_bytes("png", &png).is_ok());
        assert!(validate_image_magic_bytes("jpg", &png).is_err());

        let jpg = [0xFF, 0xD8, 0xFF, 0xE0];
        assert!(validate_image_magic_bytes("jpg", &jpg).is_ok());

        let webp = [b'R', b'I', b'F', b'F', 0, 0, 0, 0, b'W', b'E', b'B', b'P'];
        assert!(validate_image_magic_bytes("webp", &webp).is_ok());
        assert!(validate_image_magic_bytes("webp", &jpg).is_err());

        // Arbitrary bytes written under an image extension are rejected.
        assert!(validate_image_magic_bytes("png", b"hello").is_err());
    }

    #[test]
    fn generation_rate_limit_is_windowed() {
        let mut timestamps = Vec::new();
        let now = std::time::Instant::now();
        for _ in 0..MAX_GENERATION_REQUESTS_PER_WINDOW {
            assert!(check_generation_rate_limit_for(&mut timestamps, now).is_ok());
        }
        assert!(check_generation_rate_limit_for(&mut timestamps, now).is_err());
        assert!(check_generation_rate_limit_for(
            &mut timestamps,
            now + GENERATION_RATE_LIMIT_WINDOW + std::time::Duration::from_millis(1)
        )
        .is_ok());
    }
}
