#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    if let Err(error) = runtime_repository::initialize_smoke_repository_from_env() {
        panic!("{}", runtime_repository::redact_storage_error(error));
    }

    tauri::Builder::default()
        .manage(GenerationCancellationState::default())
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
            cancel_text_generation,
            persist_generated_image,
            sync_generated_image_files,
            discover_local_text_providers,
            download_chub_character
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

mod runtime_repository;

const KEYRING_SERVICE: &str = "local-first-ai-rpg-runtime";
const SECRET_STORAGE_KIND: &str = "os-keychain";
const MAX_PROMPT_CHARS: usize = 200_000;
const MAX_SYSTEM_PROMPT_CHARS: usize = 200_000;
const MAX_COMBINED_PROMPT_CHARS: usize = 240_000;
const MAX_COMBINED_PROMPT_BYTES: usize = 800_000;
const MAX_ESTIMATED_INPUT_TOKENS: u32 = 60_000;
const MAX_PROVIDER_RESPONSE_BYTES: usize = 8 * 1024 * 1024;
const DEFAULT_OUTPUT_TOKENS: u32 = 900;
const MAX_OUTPUT_TOKENS: u32 = 4_096;
const MAX_MODEL_ID_CHARS: usize = 160;
const MAX_RESPONSE_FORMAT_NAME_CHARS: usize = 64;
const MAX_RESPONSE_FORMAT_JSON_CHARS: usize = 64_000;
const MAX_GENERATION_SEED: i64 = 9_007_199_254_740_991;
const DEFAULT_PROVIDER_REQUEST_TIMEOUT_MS: u64 = 60_000;
const MAX_PROVIDER_REQUEST_TIMEOUT_MS: u64 = 300_000;
const MAX_GENERATION_REQUEST_ID_CHARS: usize = 128;
const MAX_GENERATION_REQUESTS_PER_WINDOW: usize = 20;
const GENERATION_RATE_LIMIT_WINDOW: std::time::Duration = std::time::Duration::from_secs(60);

static GENERATION_REQUEST_TIMESTAMPS: std::sync::OnceLock<
    std::sync::Mutex<Vec<std::time::Instant>>,
> = std::sync::OnceLock::new();

#[derive(Default)]
struct GenerationCancellationState {
    requests: std::sync::Mutex<std::collections::HashMap<String, GenerationCancellationEntry>>,
}

struct GenerationCancellationEntry {
    cancel: tokio::sync::watch::Sender<bool>,
    completed: tokio::sync::watch::Receiver<bool>,
}

impl GenerationCancellationState {
    fn register(
        &self,
        request_id: &str,
    ) -> Result<
        (
            tokio::sync::watch::Receiver<bool>,
            tokio::sync::watch::Sender<bool>,
        ),
        String,
    > {
        let (cancel_sender, cancel_receiver) = tokio::sync::watch::channel(false);
        let (completed_sender, completed_receiver) = tokio::sync::watch::channel(false);
        let mut requests = self
            .requests
            .lock()
            .map_err(|_| "Generation cancellation state is unavailable.".to_string())?;
        if requests.contains_key(request_id) {
            return Err("Generation request id is already active.".to_string());
        }
        requests.insert(
            request_id.to_string(),
            GenerationCancellationEntry {
                cancel: cancel_sender,
                completed: completed_receiver,
            },
        );
        Ok((cancel_receiver, completed_sender))
    }

    fn request_cancellation(
        &self,
        request_id: &str,
    ) -> Result<Option<tokio::sync::watch::Receiver<bool>>, String> {
        let requests = self
            .requests
            .lock()
            .map_err(|_| "Generation cancellation state is unavailable.".to_string())?;
        let Some(entry) = requests.get(request_id) else {
            return Ok(None);
        };
        entry
            .cancel
            .send(true)
            .map_err(|_| "Generation request was no longer cancellable.".to_string())?;
        Ok(Some(entry.completed.clone()))
    }

    fn remove(&self, request_id: &str) {
        if let Ok(mut requests) = self.requests.lock() {
            requests.remove(request_id);
        }
    }
}

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
    request_id: String,
    provider_id: String,
    base_url: String,
    model: String,
    secret_reference: SecretReferenceInput,
    prompt: String,
    system_prompt: Option<String>,
    temperature: Option<f32>,
    seed: Option<i64>,
    response_format: Option<serde_json::Value>,
    max_output_tokens: Option<u32>,
    timeout_ms: Option<u64>,
    reasoning: Option<StoredReasoningConfig>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StoredReasoningConfig {
    enabled: Option<bool>,
    effort: Option<String>,
    max_tokens: Option<u32>,
    exclude: Option<bool>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct StoredTextGenerationResponse {
    provider_id: String,
    model: String,
    text: String,
    finish_reason: String,
    usage: TextUsage,
    usage_source: &'static str,
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
    cancellation_state: tauri::State<'_, GenerationCancellationState>,
) -> Result<StoredTextGenerationResponse, String> {
    validate_generation_request_id(&request.request_id)?;
    let provider_id = normalize_identifier(&request.provider_id, "provider id")?;
    let base_url = normalize_allowed_provider_base_url(&provider_id, &request.base_url)?;
    validate_secret_reference_for_request(&request.secret_reference, &provider_id, &base_url)?;
    validate_generation_prompts(&request.prompt, request.system_prompt.as_deref())?;
    validate_generation_model(&request.model)?;
    let max_output_tokens = validate_max_output_tokens(request.max_output_tokens)?;
    let request_timeout = validate_request_timeout(request.timeout_ms)?;
    let reasoning = validate_reasoning_config(request.reasoning.as_ref(), max_output_tokens)?;
    let seed = validate_generation_seed(request.seed)?;
    let response_format = validate_response_format(request.response_format.as_ref())?;
    check_generation_rate_limit()?;

    let request_id = request.request_id.clone();
    let (mut cancellation, completion) = cancellation_state.register(&request_id)?;
    let generation = async {
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

        let mut body = serde_json::json!({
            "model": request.model,
            "temperature": request.temperature,
            "max_tokens": max_output_tokens,
            "messages": messages,
        });
        if let Some(reasoning) = reasoning {
            body.as_object_mut()
                .ok_or_else(|| "Could not build provider request.".to_string())?
                .insert("reasoning".to_string(), reasoning);
        }
        if let Some(seed) = seed {
            body.as_object_mut()
                .ok_or_else(|| "Could not build provider request.".to_string())?
                .insert("seed".to_string(), serde_json::json!(seed));
        }
        if let Some(response_format) = response_format {
            body.as_object_mut()
                .ok_or_else(|| "Could not build provider request.".to_string())?
                .insert("response_format".to_string(), response_format);
        }

        let client = reqwest::Client::builder()
            .timeout(request_timeout)
            .redirect(reqwest::redirect::Policy::none())
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
            return Err(format!(
                "Provider request failed ({status}). Error details were redacted."
            ));
        }

        let response_bytes =
            read_bounded_response(response, MAX_PROVIDER_RESPONSE_BYTES, "Provider response")
                .await?;
        let raw = serde_json::from_slice::<serde_json::Value>(&response_bytes)
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
            .unwrap_or_else(|| {
                estimate_generation_input_tokens(&request.prompt, request.system_prompt.as_deref())
            });
        let output_tokens = parsed
            .usage
            .as_ref()
            .and_then(|usage| usage.completion_tokens)
            .unwrap_or_else(|| estimate_text_tokens(&text));
        let usage_source = usage_source(&parsed.usage);

        Ok(StoredTextGenerationResponse {
            provider_id,
            model: request.model,
            text,
            finish_reason: map_finish_reason(
                choice.and_then(|choice| choice.finish_reason.as_deref()),
            )
            .to_string(),
            usage: TextUsage {
                input_tokens,
                output_tokens,
                total_tokens: parsed
                    .usage
                    .and_then(|usage| usage.total_tokens)
                    .unwrap_or(input_tokens + output_tokens),
            },
            usage_source,
            raw,
        })
    };

    let result = if *cancellation.borrow() {
        Err("Generation cancelled before the provider request started.".to_string())
    } else {
        tokio::select! {
            changed = cancellation.changed() => {
                match changed {
                    Ok(()) => Err("Generation cancelled after desktop acknowledgement.".to_string()),
                    Err(_) => Err("Generation cancellation state closed unexpectedly.".to_string()),
                }
            }
            result = generation => result,
        }
    };
    let _ = completion.send(true);
    cancellation_state.remove(&request_id);
    result
}

#[tauri::command]
async fn cancel_text_generation(
    request_id: String,
    cancellation_state: tauri::State<'_, GenerationCancellationState>,
) -> Result<bool, String> {
    validate_generation_request_id(&request_id)?;
    let Some(mut completed) = cancellation_state.request_cancellation(&request_id)? else {
        return Ok(false);
    };
    if !*completed.borrow() {
        completed.changed().await.map_err(|_| {
            "Generation stopped, but completion acknowledgement was lost.".to_string()
        })?;
    }
    Ok(true)
}

const CHUB_DOWNLOAD_URL: &str = "https://api.chub.ai/api/characters/download";
const MAX_CHUB_CARD_BYTES: usize = 8 * 1024 * 1024;
const MAX_CHUB_PATH_SEGMENT_CHARS: usize = 128;

const LOCAL_MODEL_DISCOVERY_TIMEOUT: std::time::Duration = std::time::Duration::from_millis(900);
const MAX_LOCAL_MODEL_RESPONSE_BYTES: usize = 512 * 1024;
const MAX_DISCOVERED_LOCAL_MODELS: usize = 100;

#[derive(Clone)]
struct LocalProviderCandidate {
    id: &'static str,
    display_name: &'static str,
    base_url: &'static str,
    models_url: &'static str,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalProviderDetection {
    id: &'static str,
    display_name: &'static str,
    base_url: &'static str,
    models_url: &'static str,
    models: Vec<String>,
}

fn local_provider_candidates() -> [LocalProviderCandidate; 4] {
    [
        LocalProviderCandidate {
            id: "ollama",
            display_name: "Ollama",
            base_url: "http://127.0.0.1:11434/v1",
            models_url: "http://127.0.0.1:11434/v1/models",
        },
        LocalProviderCandidate {
            id: "lm-studio",
            display_name: "LM Studio",
            base_url: "http://127.0.0.1:1234/v1",
            models_url: "http://127.0.0.1:1234/v1/models",
        },
        LocalProviderCandidate {
            id: "llama-cpp",
            display_name: "llama.cpp server",
            base_url: "http://127.0.0.1:8080/v1",
            models_url: "http://127.0.0.1:8080/v1/models",
        },
        LocalProviderCandidate {
            id: "koboldcpp",
            display_name: "KoboldCpp",
            base_url: "http://127.0.0.1:5001/v1",
            models_url: "http://127.0.0.1:5001/v1/models",
        },
    ]
}

fn parse_local_model_list(payload: &serde_json::Value) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    payload
        .get("data")
        .and_then(serde_json::Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|entry| entry.get("id").and_then(serde_json::Value::as_str))
        .map(str::trim)
        .filter(|model| {
            !model.is_empty()
                && model.chars().count() <= MAX_MODEL_ID_CHARS
                && !model.chars().any(char::is_control)
                && seen.insert((*model).to_string())
        })
        .take(MAX_DISCOVERED_LOCAL_MODELS)
        .map(str::to_string)
        .collect()
}

/// Checks a fixed allowlist of loopback OpenAI-compatible model-list endpoints.
/// It never scans ports, accepts renderer-provided URLs, or mutates a server.
#[tauri::command]
async fn discover_local_text_providers() -> Result<Vec<LocalProviderDetection>, String> {
    let client = reqwest::Client::builder()
        .timeout(LOCAL_MODEL_DISCOVERY_TIMEOUT)
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| "Could not initialize local provider discovery.".to_string())?;
    let mut detections = Vec::new();

    for candidate in local_provider_candidates() {
        let Ok(response) = client.get(candidate.models_url).send().await else {
            continue;
        };
        if !response.status().is_success() {
            continue;
        }
        let Ok(bytes) = read_bounded_response(
            response,
            MAX_LOCAL_MODEL_RESPONSE_BYTES,
            "Local model response",
        )
        .await
        else {
            continue;
        };
        let Ok(payload) = serde_json::from_slice::<serde_json::Value>(&bytes) else {
            continue;
        };
        let models = parse_local_model_list(&payload);
        if models.is_empty() {
            continue;
        }
        detections.push(LocalProviderDetection {
            id: candidate.id,
            display_name: candidate.display_name,
            base_url: candidate.base_url,
            models_url: candidate.models_url,
            models,
        });
    }

    Ok(detections)
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChubDownloadRequest {
    full_path: String,
    timeout_ms: Option<u64>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ChubDownloadResponse {
    base64_data: String,
    byte_length: usize,
}

/// Downloads a Chub character card via the fixed Chub endpoint from the Rust
/// side. The webview CSP blocks `connect-src` to api.chub.ai, but a reqwest
/// call is not subject to the webview CSP — so packaged desktop builds route
/// Chub imports through here instead of widening the CSP. The endpoint is
/// hard-coded; only the `author/name` path is user-controlled and validated.
#[tauri::command]
async fn download_chub_character(
    request: ChubDownloadRequest,
) -> Result<ChubDownloadResponse, String> {
    use base64::Engine as _;

    let full_path = validate_chub_full_path(&request.full_path)?;
    let request_timeout = validate_request_timeout(request.timeout_ms)?;

    let body = serde_json::json!({
        "fullPath": full_path,
        "format": "tavern",
        "version": "main",
    });

    let client = reqwest::Client::builder()
        .timeout(request_timeout)
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| "Could not initialize the Chub HTTP client.".to_string())?;
    let response = client
        .post(CHUB_DOWNLOAD_URL)
        .json(&body)
        .send()
        .await
        .map_err(|_| "Chub request failed before receiving a response.".to_string())?;

    if !response.status().is_success() {
        let status = response.status();
        return Err(format!(
            "Chub download failed ({status}). The card may be private or the path is wrong."
        ));
    }

    let bytes = read_bounded_response(response, MAX_CHUB_CARD_BYTES, "Chub character").await?;
    if bytes.is_empty() {
        return Err("Chub returned an empty response.".to_string());
    }

    Ok(ChubDownloadResponse {
        byte_length: bytes.len(),
        base64_data: base64::engine::general_purpose::STANDARD.encode(&bytes),
    })
}

/// Validates a Chub `author/name` path: exactly two non-empty segments of
/// bounded length using the safe identifier alphabet. Prevents the fixed
/// endpoint from being steered anywhere unexpected via the request body.
fn validate_chub_full_path(input: &str) -> Result<String, String> {
    let trimmed = input.trim();
    let segments: Vec<&str> = trimmed.split('/').collect();
    if segments.len() != 2 {
        return Err("Chub path must be in author/name form.".to_string());
    }
    for segment in &segments {
        if segment.is_empty() || segment.chars().count() > MAX_CHUB_PATH_SEGMENT_CHARS {
            return Err("Chub path segments must be non-empty and not too long.".to_string());
        }
        if !segment.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.')
        }) {
            return Err("Chub path contains unsupported characters.".to_string());
        }
    }
    Ok(format!("{}/{}", segments[0], segments[1]))
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

#[tauri::command]
fn sync_generated_image_files(
    app: tauri::AppHandle,
    active_artifact_ids: Vec<String>,
) -> Result<usize, String> {
    use tauri::Manager as _;

    let active_artifact_ids = active_artifact_ids
        .iter()
        .map(|id| normalize_identifier(id, "artifact id"))
        .collect::<Result<Vec<_>, _>>()?;
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|_| "Could not resolve the app data directory.".to_string())?
        .join(GENERATED_IMAGE_DIR);
    remove_orphaned_generated_images(&directory, &active_artifact_ids)
}

fn remove_orphaned_generated_images(
    directory: &std::path::Path,
    active_artifact_ids: &[String],
) -> Result<usize, String> {
    use std::collections::HashSet;

    if !directory.exists() {
        return Ok(0);
    }
    let active: HashSet<&str> = active_artifact_ids.iter().map(String::as_str).collect();
    let entries = std::fs::read_dir(directory)
        .map_err(|_| "Could not inspect the generated image directory.".to_string())?;
    let mut removed = 0;
    for entry in entries {
        let entry = entry.map_err(|_| "Could not inspect a generated image file.".to_string())?;
        let file_type = entry
            .file_type()
            .map_err(|_| "Could not inspect a generated image file.".to_string())?;
        if !file_type.is_file() {
            continue;
        }
        let path = entry.path();
        let extension = path
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or("");
        if !matches!(
            extension.to_ascii_lowercase().as_str(),
            "png" | "jpg" | "jpeg" | "webp"
        ) {
            continue;
        }
        let stem = path
            .file_stem()
            .and_then(|value| value.to_str())
            .unwrap_or("");
        if active.contains(stem) {
            continue;
        }
        std::fs::remove_file(&path)
            .map_err(|_| "Could not remove an orphaned generated image file.".to_string())?;
        removed += 1;
    }
    Ok(removed)
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

#[cfg(test)]
mod generated_image_cleanup_tests {
    use super::remove_orphaned_generated_images;

    #[test]
    fn removes_only_supported_orphaned_image_files() {
        let directory = std::env::temp_dir().join(format!("rpg-image-gc-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&directory);
        std::fs::create_dir_all(&directory).unwrap();
        std::fs::write(directory.join("keep.png"), b"keep").unwrap();
        std::fs::write(directory.join("orphan.webp"), b"orphan").unwrap();
        std::fs::write(directory.join("notes.txt"), b"notes").unwrap();

        let removed = remove_orphaned_generated_images(&directory, &["keep".to_string()]).unwrap();

        assert_eq!(removed, 1);
        assert!(directory.join("keep.png").exists());
        assert!(!directory.join("orphan.webp").exists());
        assert!(directory.join("notes.txt").exists());
        std::fs::remove_dir_all(directory).unwrap();
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

fn validate_generation_prompts(prompt: &str, system_prompt: Option<&str>) -> Result<(), String> {
    validate_generation_prompt(prompt)?;
    let system_prompt = system_prompt.unwrap_or("");
    if system_prompt.chars().count() > MAX_SYSTEM_PROMPT_CHARS {
        return Err("System prompt exceeds the local safety limit.".to_string());
    }
    let combined_chars = prompt
        .chars()
        .count()
        .saturating_add(system_prompt.chars().count());
    if combined_chars > MAX_COMBINED_PROMPT_CHARS {
        return Err("Combined prompts exceed the local character limit.".to_string());
    }
    if prompt.len().saturating_add(system_prompt.len()) > MAX_COMBINED_PROMPT_BYTES {
        return Err("Combined prompts exceed the local byte limit.".to_string());
    }
    if estimate_generation_input_tokens(prompt, Some(system_prompt)) > MAX_ESTIMATED_INPUT_TOKENS {
        return Err("Combined prompts exceed the local estimated-token limit.".to_string());
    }
    Ok(())
}

async fn read_bounded_response(
    mut response: reqwest::Response,
    max_bytes: usize,
    label: &str,
) -> Result<Vec<u8>, String> {
    if response
        .content_length()
        .is_some_and(|length| length > max_bytes as u64)
    {
        return Err(format!("{label} exceeds the local size limit."));
    }

    let mut bytes =
        Vec::with_capacity(response.content_length().unwrap_or(0).min(max_bytes as u64) as usize);
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| format!("{label} could not be read."))?
    {
        if bytes.len().saturating_add(chunk.len()) > max_bytes {
            return Err(format!("{label} exceeds the local size limit."));
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}

fn validate_generation_request_id(request_id: &str) -> Result<(), String> {
    if request_id.is_empty() || request_id.len() > MAX_GENERATION_REQUEST_ID_CHARS {
        return Err("Generation request id is invalid.".to_string());
    }
    if !request_id
        .chars()
        .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
    {
        return Err("Generation request id contains unsupported characters.".to_string());
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

fn validate_generation_seed(value: Option<i64>) -> Result<Option<i64>, String> {
    match value {
        Some(seed) if seed.unsigned_abs() > MAX_GENERATION_SEED as u64 => {
            Err("Generation seed exceeds the supported integer range.".to_string())
        }
        _ => Ok(value),
    }
}

fn validate_response_format(
    value: Option<&serde_json::Value>,
) -> Result<Option<serde_json::Value>, String> {
    let Some(value) = value else {
        return Ok(None);
    };
    let object = value
        .as_object()
        .ok_or_else(|| "Response format must be an object.".to_string())?;
    let response_type = object
        .get("type")
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| "Response format type is required.".to_string())?;

    match response_type {
        "json_object" => {
            if object.len() != 1 {
                return Err("JSON object response format contains unsupported fields.".to_string());
            }
        }
        "json_schema" => {
            if object
                .keys()
                .any(|key| key != "type" && key != "json_schema")
            {
                return Err("JSON schema response format contains unsupported fields.".to_string());
            }
            let descriptor = object
                .get("json_schema")
                .and_then(serde_json::Value::as_object)
                .ok_or_else(|| "JSON schema response format requires json_schema.".to_string())?;
            if descriptor
                .keys()
                .any(|key| key != "name" && key != "strict" && key != "schema")
            {
                return Err("JSON schema descriptor contains unsupported fields.".to_string());
            }
            let name = descriptor
                .get("name")
                .and_then(serde_json::Value::as_str)
                .ok_or_else(|| "JSON schema response format requires a name.".to_string())?;
            if name.is_empty()
                || name.chars().count() > MAX_RESPONSE_FORMAT_NAME_CHARS
                || !name.chars().all(|character| {
                    character.is_ascii_alphanumeric() || matches!(character, '_' | '-')
                })
            {
                return Err("JSON schema response format name is invalid.".to_string());
            }
            if descriptor
                .get("strict")
                .is_some_and(|strict| !strict.is_boolean())
            {
                return Err("JSON schema strict must be a boolean.".to_string());
            }
            if !descriptor
                .get("schema")
                .is_some_and(serde_json::Value::is_object)
            {
                return Err("JSON schema response format requires an object schema.".to_string());
            }
        }
        _ => return Err("Response format type is not supported.".to_string()),
    }

    let serialized = serde_json::to_string(value)
        .map_err(|_| "Response format could not be serialized.".to_string())?;
    if serialized.chars().count() > MAX_RESPONSE_FORMAT_JSON_CHARS {
        return Err("Response format exceeds the local safety limit.".to_string());
    }
    Ok(Some(value.clone()))
}

fn validate_reasoning_config(
    value: Option<&StoredReasoningConfig>,
    max_output_tokens: u32,
) -> Result<Option<serde_json::Value>, String> {
    let Some(value) = value else {
        return Ok(None);
    };
    if value.effort.is_some() && value.max_tokens.is_some() {
        return Err("Reasoning effort and maxTokens cannot both be set.".to_string());
    }
    if let Some(effort) = value.effort.as_deref() {
        if !matches!(
            effort,
            "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max"
        ) {
            return Err("Reasoning effort is not supported.".to_string());
        }
    }
    if let Some(tokens) = value.max_tokens {
        if tokens == 0 || tokens >= max_output_tokens {
            return Err(
                "Reasoning maxTokens must be positive and lower than the total output limit."
                    .to_string(),
            );
        }
    }

    let mut result = serde_json::Map::new();
    if let Some(enabled) = value.enabled {
        result.insert("enabled".to_string(), serde_json::Value::Bool(enabled));
    }
    if let Some(effort) = value.effort.as_ref() {
        result.insert(
            "effort".to_string(),
            serde_json::Value::String(effort.clone()),
        );
    }
    if let Some(tokens) = value.max_tokens {
        result.insert("max_tokens".to_string(), serde_json::Value::from(tokens));
    }
    if let Some(exclude) = value.exclude {
        result.insert("exclude".to_string(), serde_json::Value::Bool(exclude));
    }
    Ok(Some(serde_json::Value::Object(result)))
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

fn estimate_generation_input_tokens(prompt: &str, system_prompt: Option<&str>) -> u32 {
    let system_tokens = system_prompt
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(estimate_text_tokens)
        .unwrap_or(0);
    estimate_text_tokens(prompt).saturating_add(system_tokens)
}

fn usage_source(usage: &Option<ChatCompletionUsage>) -> &'static str {
    match usage {
        Some(usage)
            if usage.prompt_tokens.is_some()
                && usage.completion_tokens.is_some()
                && usage.total_tokens.is_some() =>
        {
            "provider"
        }
        _ => "estimated",
    }
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
    #[ignore = "runs only in the signed desktop release lane against the host OS keychain"]
    fn os_keychain_round_trip_smoke() {
        assert_eq!(
            std::env::var("PHASE2_KEYCHAIN_SMOKE").as_deref(),
            Ok("1"),
            "PHASE2_KEYCHAIN_SMOKE=1 is required for the opt-in OS keychain test"
        );
        let unique = format!(
            "phase2-smoke-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("system time must follow the Unix epoch")
                .as_nanos()
        );
        let entry = keyring_entry(&unique).expect("OS keychain entry should open");
        let fake_secret = "phase2-fake-release-key";
        entry
            .set_password(fake_secret)
            .expect("OS keychain should accept the smoke credential");
        let stored = entry
            .get_password()
            .expect("OS keychain should return the smoke credential");
        assert_eq!(stored, fake_secret);
        entry
            .delete_credential()
            .expect("OS keychain smoke credential should be removed");
        assert!(matches!(entry.get_password(), Err(keyring::Error::NoEntry)));
        println!("OS keychain round-trip passed; the fake smoke credential was removed.");
    }

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
        assert!(validate_generation_prompts(
            "player",
            Some("x".repeat(MAX_SYSTEM_PROMPT_CHARS + 1).as_str()),
        )
        .is_err());
        assert!(validate_generation_prompts(
            "x".repeat(MAX_PROMPT_CHARS).as_str(),
            Some(
                "y".repeat(MAX_COMBINED_PROMPT_CHARS - MAX_PROMPT_CHARS + 1)
                    .as_str()
            ),
        )
        .is_err());
        assert!(validate_generation_prompts("player", Some("system")).is_ok());
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
    fn generation_cancellation_ids_and_acknowledgements_are_bounded() {
        assert!(validate_generation_request_id("generation-abc-1").is_ok());
        assert!(validate_generation_request_id("bad/request").is_err());
        assert!(
            validate_generation_request_id(&"x".repeat(MAX_GENERATION_REQUEST_ID_CHARS + 1))
                .is_err()
        );

        let state = GenerationCancellationState::default();
        let (receiver, completion) = state.register("generation-abc-1").unwrap();
        assert!(!*receiver.borrow());
        let acknowledgement = state
            .request_cancellation("generation-abc-1")
            .unwrap()
            .unwrap();
        assert!(*receiver.borrow());
        assert!(!*acknowledgement.borrow());
        completion.send(true).unwrap();
        assert!(*acknowledgement.borrow());
        state.remove("generation-abc-1");
        assert!(state
            .request_cancellation("generation-abc-1")
            .unwrap()
            .is_none());
    }

    #[test]
    fn optional_generation_seed_and_response_format_are_bounded() {
        assert_eq!(
            validate_generation_seed(Some(37_119)).unwrap(),
            Some(37_119)
        );
        assert!(validate_generation_seed(Some(MAX_GENERATION_SEED + 1)).is_err());
        let json_object = serde_json::json!({ "type": "json_object" });
        assert_eq!(
            validate_response_format(Some(&json_object)).unwrap(),
            Some(json_object)
        );
        let json_schema = serde_json::json!({
            "type": "json_schema",
            "json_schema": {
                "name": "memory_evidence_brief",
                "strict": true,
                "schema": { "type": "object", "properties": {} }
            }
        });
        assert_eq!(
            validate_response_format(Some(&json_schema)).unwrap(),
            Some(json_schema)
        );
        assert!(validate_response_format(Some(&serde_json::json!({
            "type": "json_schema",
            "json_schema": { "name": "bad name", "schema": {} }
        })))
        .is_err());
        assert!(validate_response_format(Some(&serde_json::json!({
            "type": "text"
        })))
        .is_err());
    }

    #[test]
    fn reasoning_request_is_bounded_and_serialized_for_the_provider() {
        let enabled = StoredReasoningConfig {
            enabled: Some(true),
            effort: None,
            max_tokens: None,
            exclude: Some(false),
        };
        assert_eq!(
            validate_reasoning_config(Some(&enabled), 4_000).unwrap(),
            Some(serde_json::json!({ "enabled": true, "exclude": false }))
        );

        let conflicting = StoredReasoningConfig {
            enabled: Some(true),
            effort: Some("high".to_string()),
            max_tokens: Some(2_000),
            exclude: Some(false),
        };
        assert!(validate_reasoning_config(Some(&conflicting), 4_000).is_err());

        let oversized = StoredReasoningConfig {
            enabled: Some(true),
            effort: None,
            max_tokens: Some(4_000),
            exclude: Some(false),
        };
        assert!(validate_reasoning_config(Some(&oversized), 4_000).is_err());
    }

    #[test]
    fn provider_usage_source_distinguishes_reported_and_estimated_tokens() {
        let complete = Some(ChatCompletionUsage {
            prompt_tokens: Some(10),
            completion_tokens: Some(4),
            total_tokens: Some(14),
        });
        let partial = Some(ChatCompletionUsage {
            prompt_tokens: Some(10),
            completion_tokens: None,
            total_tokens: None,
        });

        assert_eq!(usage_source(&complete), "provider");
        assert_eq!(usage_source(&partial), "estimated");
        assert_eq!(usage_source(&None), "estimated");
    }

    #[test]
    fn estimated_generation_input_tokens_include_nonempty_system_prompt() {
        assert_eq!(estimate_generation_input_tokens("1234", None), 1);
        assert_eq!(estimate_generation_input_tokens("1234", Some("   ")), 1);
        assert_eq!(
            estimate_generation_input_tokens("1234", Some("abcdefgh")),
            3
        );
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
    fn chub_full_path_accepts_author_name_and_rejects_junk() {
        assert_eq!(
            validate_chub_full_path(" mapmaker/aria ").unwrap(),
            "mapmaker/aria"
        );
        assert!(validate_chub_full_path("mapmaker").is_err());
        assert!(validate_chub_full_path("mapmaker/aria/extra").is_err());
        assert!(validate_chub_full_path("mapmaker/").is_err());
        assert!(validate_chub_full_path("map maker/aria").is_err());
        assert!(validate_chub_full_path("mapmaker/../secret").is_err());
        assert!(validate_chub_full_path(&format!("mapmaker/{}", "a".repeat(129))).is_err());
    }

    #[test]
    fn local_provider_discovery_candidates_are_fixed_loopback_model_endpoints() {
        for candidate in local_provider_candidates() {
            let parsed = reqwest::Url::parse(candidate.models_url).unwrap();
            assert_eq!(parsed.host_str(), Some("127.0.0.1"));
            assert_eq!(parsed.path(), "/v1/models");
            assert!(candidate.base_url.starts_with("http://127.0.0.1:"));
        }
    }

    #[test]
    fn local_model_lists_are_deduplicated_and_bounded() {
        let payload = serde_json::json!({
            "data": [
                { "id": " qwen3:8b " },
                { "id": "qwen3:8b" },
                { "id": "bad\nmodel" },
                { "id": "x".repeat(MAX_MODEL_ID_CHARS + 1) },
                { "missing": "ignored" }
            ]
        });
        assert_eq!(parse_local_model_list(&payload), vec!["qwen3:8b"]);
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
