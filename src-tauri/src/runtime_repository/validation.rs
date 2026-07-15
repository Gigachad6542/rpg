use serde_json::{json, Map, Value};

use super::{
    flatten_snapshot_messages, RepoResult, RuntimeRepositoryError, MAX_CARDS, MAX_CHAT_SESSIONS,
    MAX_GENERATED_MAPS, MAX_ID_CHARS, MAX_MESSAGES, MAX_PROMPT_RUNS, MAX_SNAPSHOT_BYTES,
    MAX_TEXT_CHARS,
};

pub(super) fn sanitize_snapshot(snapshot: Value) -> RepoResult<Value> {
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
    if flatten_snapshot_messages(&snapshot).len() > MAX_MESSAGES {
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

pub(super) fn sanitize_provider_settings(value: Option<&Value>) -> RepoResult<Option<Value>> {
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

pub(super) fn sanitize_image_provider_settings(value: Option<&Value>) -> RepoResult<Option<Value>> {
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
    if let Some(mode @ ("auto" | "confirm-first" | "off")) =
        input.get("portraitGenerationMode").and_then(Value::as_str)
    {
        output.insert("portraitGenerationMode".to_string(), json!(mode));
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

pub(super) fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}
