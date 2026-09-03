//! External intelligence provider adapters (transcription, summary, geocoding).

use std::time::Duration;

use reqwest::{Client, multipart};
use serde::{Deserialize, Serialize};
use trunkscope_domain::IncidentLocation;

use crate::state::AppSettings;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ProviderCredentials {
    pub auth: ProviderAuth,
    pub api_key: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ProviderAuth {
    None,
    Bearer,
    ApiKeyHeader { header: String },
}

impl ProviderCredentials {
    pub fn from_settings(api_key: &str) -> Self {
        let trimmed = api_key.trim();
        if trimmed.is_empty() {
            Self {
                auth: ProviderAuth::None,
                api_key: String::new(),
            }
        } else {
            Self {
                auth: ProviderAuth::Bearer,
                api_key: trimmed.to_string(),
            }
        }
    }

    fn apply(&self, request: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
        match &self.auth {
            ProviderAuth::None => request,
            ProviderAuth::Bearer => request.bearer_auth(&self.api_key),
            ProviderAuth::ApiKeyHeader { header } => request.header(header, &self.api_key),
        }
    }
}

pub fn effective_transcribe_url(settings: &AppSettings) -> Option<String> {
    let value = settings.transcribe_url.trim();
    if !value.is_empty() {
        return Some(value.to_string());
    }
    std::env::var("TRUNKSCOPE_TRANSCRIBE_URL")
        .ok()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
}

pub fn effective_transcribe_api_key(settings: &AppSettings) -> String {
    let value = settings.transcribe_api_key.trim();
    if !value.is_empty() {
        return value.to_string();
    }
    std::env::var("TRUNKSCOPE_TRANSCRIBE_API_KEY").unwrap_or_default()
}

pub fn effective_summary_api_key(settings: &AppSettings) -> String {
    let value = settings.summary_api_key.trim();
    if !value.is_empty() {
        return value.to_string();
    }
    std::env::var("TRUNKSCOPE_SUMMARY_API_KEY").unwrap_or_default()
}

pub fn effective_geocoder_api_key(settings: &AppSettings) -> String {
    let value = settings.geocoder_api_key.trim();
    if !value.is_empty() {
        return value.to_string();
    }
    std::env::var("TRUNKSCOPE_GEOCODER_API_KEY").unwrap_or_default()
}

pub fn http_client() -> Client {
    Client::builder()
        .timeout(Duration::from_secs(180))
        .build()
        .expect("valid provider HTTP client")
}

#[derive(Deserialize)]
struct TranscriptionResponse {
    text: String,
}

pub async fn transcribe(
    client: &Client,
    settings: &AppSettings,
    path: &std::path::Path,
) -> anyhow::Result<String> {
    let url = effective_transcribe_url(settings)
        .ok_or_else(|| anyhow::anyhow!("transcription provider is not configured"))?;
    let creds = ProviderCredentials::from_settings(&effective_transcribe_api_key(settings));
    let audio = tokio::fs::read(path).await?;
    let filename = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("call.wav");
    let file = multipart::Part::bytes(audio)
        .file_name(filename.to_owned())
        .mime_str("audio/wav")?;
    let mut form = multipart::Form::new()
        .part("file", file)
        .text("model", settings.transcribe_model.clone());
    if settings.transcribe_provider != "openai-whisper" {
        form = form.text("response_format", "json");
    }
    let request = client.post(url).multipart(form);
    let response = creds
        .apply(request)
        .send()
        .await?
        .error_for_status()?
        .json::<TranscriptionResponse>()
        .await?;
    Ok(response.text.trim().to_owned())
}

#[derive(Serialize)]
struct OllamaRequest<'a> {
    model: &'a str,
    prompt: String,
    stream: bool,
}

#[derive(Deserialize)]
struct OllamaResponse {
    response: String,
}

#[derive(Serialize)]
struct ChatMessage<'a> {
    role: &'a str,
    content: String,
}

#[derive(Serialize)]
struct OpenAiChatRequest<'a> {
    model: &'a str,
    messages: Vec<ChatMessage<'a>>,
    stream: bool,
}

#[derive(Deserialize)]
struct OpenAiChatResponse {
    choices: Vec<OpenAiChoice>,
}

#[derive(Deserialize)]
struct OpenAiChoice {
    message: OpenAiMessage,
}

#[derive(Deserialize)]
struct OpenAiMessage {
    content: String,
}

#[derive(Serialize)]
struct AnthropicRequest<'a> {
    model: &'a str,
    max_tokens: u32,
    messages: Vec<ChatMessage<'a>>,
}

#[derive(Deserialize)]
struct AnthropicResponse {
    content: Vec<AnthropicBlock>,
}

#[derive(Deserialize)]
struct AnthropicBlock {
    text: String,
}

pub async fn summarize(
    client: &Client,
    settings: &AppSettings,
    _transcript: &str,
    prompt: &str,
) -> anyhow::Result<String> {
    let url = settings
        .effective_summary_url()
        .ok_or_else(|| anyhow::anyhow!("summary provider is not configured"))?;
    let creds = ProviderCredentials::from_settings(&effective_summary_api_key(settings));
    let provider = settings.summary_provider.trim();
    let model = settings.summary_model.trim();
    match provider {
        "ollama" => {
            let request = client.post(url).json(&OllamaRequest {
                model,
                prompt: prompt.to_string(),
                stream: false,
            });
            let response = creds
                .apply(request)
                .send()
                .await?
                .error_for_status()?
                .json::<OllamaResponse>()
                .await?;
            Ok(response.response.trim().to_owned())
        }
        "anthropic" => {
            let request = client.post(url).header("anthropic-version", "2023-06-01").json(
                &AnthropicRequest {
                    model,
                    max_tokens: 512,
                    messages: vec![ChatMessage {
                        role: "user",
                        content: prompt.to_string(),
                    }],
                },
            );
            let request = match creds.auth {
                ProviderAuth::Bearer => request.header("x-api-key", creds.api_key),
                ProviderAuth::ApiKeyHeader { ref header } => request.header(header, creds.api_key),
                ProviderAuth::None => request,
            };
            let response = request
                .send()
                .await?
                .error_for_status()?
                .json::<AnthropicResponse>()
                .await?;
            Ok(response
                .content
                .first()
                .map(|block| block.text.trim().to_owned())
                .unwrap_or_default())
        }
        _ => {
            let request = client.post(url).json(&OpenAiChatRequest {
                model,
                messages: vec![ChatMessage {
                    role: "user",
                    content: prompt.to_string(),
                }],
                stream: false,
            });
            let response = creds
                .apply(request)
                .send()
                .await?
                .error_for_status()?
                .json::<OpenAiChatResponse>()
                .await?;
            Ok(response
                .choices
                .first()
                .map(|choice| choice.message.content.trim().to_owned())
                .unwrap_or_default())
        }
    }
}

pub async fn geocode(
    client: &Client,
    settings: &AppSettings,
    hint: &str,
) -> Option<IncidentLocation> {
    let endpoint = settings.effective_geocoder_url()?;
    let provider = settings.geocoder_provider.trim();
    let api_key = effective_geocoder_api_key(settings);
    let (latitude, longitude, label) = match provider {
        "locationiq" => {
            let response = client
                .get(format!("{endpoint}"))
                .query(&[
                    ("key", api_key.as_str()),
                    ("q", hint),
                    ("format", "json"),
                    ("limit", "1"),
                ])
                .send()
                .await
                .ok()?
                .json::<Vec<serde_json::Value>>()
                .await
                .ok()?;
            parse_lat_lon_label(&response, hint)?
        }
        "google" => {
            let response = client
                .get("https://maps.googleapis.com/maps/api/geocode/json")
                .query(&[
                    ("address", hint),
                    ("key", api_key.as_str()),
                ])
                .send()
                .await
                .ok()?
                .json::<serde_json::Value>()
                .await
                .ok()?;
            let first = response.get("results")?.as_array()?.first()?;
            let location = first.get("geometry")?.get("location")?;
            (
                location.get("lat")?.as_f64()?,
                location.get("lng")?.as_f64()?,
                first
                    .get("formatted_address")
                    .and_then(|v| v.as_str())
                    .unwrap_or(hint)
                    .to_string(),
            )
        }
        "mapbox" => {
            let encoded = urlencoding_hint(hint);
            let response = client
                .get(format!(
                    "https://api.mapbox.com/geocoding/v5/mapbox.places/{encoded}.json"
                ))
                .query(&[("access_token", api_key.as_str()), ("limit", "1")])
                .send()
                .await
                .ok()?
                .json::<serde_json::Value>()
                .await
                .ok()?;
            let first = response.get("features")?.as_array()?.first()?;
            let coords = first.get("center")?.as_array()?;
            (
                coords.first()?.as_f64()?,
                coords.get(1)?.as_f64()?,
                first
                    .get("place_name")
                    .and_then(|v| v.as_str())
                    .unwrap_or(hint)
                    .to_string(),
            )
        }
        _ => {
            let mut request = client
                .get(endpoint)
                .query(&[("q", hint), ("format", "jsonv2"), ("limit", "1")])
                .header("user-agent", "TrunkScope/1.0");
            if !api_key.is_empty() {
                request = request.query(&[("key", api_key.as_str())]);
            }
            let response = request
                .send()
                .await
                .ok()?
                .json::<Vec<serde_json::Value>>()
                .await
                .ok()?;
            parse_lat_lon_label(&response, hint)?
        }
    };
    Some(IncidentLocation {
        label,
        latitude,
        longitude,
        confidence: 0.7,
    })
}

fn parse_lat_lon_label(
    response: &[serde_json::Value],
    hint: &str,
) -> Option<(f64, f64, String)> {
    let first = response.first()?;
    let latitude = first
        .get("lat")
        .and_then(|v| v.as_str())
        .and_then(|v| v.parse().ok())
        .or_else(|| first.get("lat").and_then(|v| v.as_f64()))?;
    let longitude = first
        .get("lon")
        .and_then(|v| v.as_str())
        .and_then(|v| v.parse().ok())
        .or_else(|| first.get("lon").and_then(|v| v.as_f64()))?;
    let label = first
        .get("display_name")
        .and_then(|v| v.as_str())
        .unwrap_or(hint)
        .to_string();
    Some((latitude, longitude, label))
}

fn urlencoding_hint(hint: &str) -> String {
    hint.replace(' ', "%20")
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredModels {
    pub models: Vec<String>,
    pub source: String,
    pub catalog_url: String,
}

pub fn service_origin(url: &str) -> Option<String> {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return None;
    }
    let scheme_end = trimmed.find("://")?;
    let after_scheme = &trimmed[scheme_end + 3..];
    let path_start = after_scheme.find('/').unwrap_or(after_scheme.len());
    let origin = &trimmed[..scheme_end + 3 + path_start];
    if origin.ends_with("://") {
        None
    } else {
        Some(origin.to_string())
    }
}

pub fn openai_models_catalog_url(configured_url: &str) -> Option<String> {
    service_origin(configured_url).map(|origin| format!("{origin}/v1/models"))
}

pub fn ollama_tags_catalog_url(configured_url: &str) -> Option<String> {
    service_origin(configured_url).map(|origin| format!("{origin}/api/tags"))
}

fn is_ollama_summary(settings: &AppSettings) -> bool {
    settings.summary_provider.trim() == "ollama"
        || settings
            .effective_summary_url()
            .is_some_and(|url| url.contains("/api/generate"))
}

fn parse_openai_models(payload: &serde_json::Value) -> Vec<String> {
    payload
        .get("data")
        .and_then(|value| value.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.get("id").and_then(|id| id.as_str()))
                .map(str::to_string)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default()
}

fn parse_ollama_models(payload: &serde_json::Value) -> Vec<String> {
    payload
        .get("models")
        .and_then(|value| value.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.get("name").and_then(|name| name.as_str()))
                .map(str::to_string)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default()
}

async fn fetch_model_catalog(
    client: &Client,
    catalog_url: &str,
    api_key: &str,
    source: &str,
) -> Result<DiscoveredModels, String> {
    let creds = ProviderCredentials::from_settings(api_key);
    let response = creds
        .apply(client.get(catalog_url))
        .send()
        .await
        .map_err(|error| error.to_string())?;
    if !response.status().is_success() {
        return Err(format!(
            "model catalog returned {}",
            response.status()
        ));
    }
    let payload = response
        .json::<serde_json::Value>()
        .await
        .map_err(|error| error.to_string())?;
    let models = if source == "ollama" {
        parse_ollama_models(&payload)
    } else {
        parse_openai_models(&payload)
    };
    if models.is_empty() {
        return Err("provider returned no models".into());
    }
    Ok(DiscoveredModels {
        models,
        source: source.to_string(),
        catalog_url: catalog_url.to_string(),
    })
}

pub async fn list_transcribe_models(settings: &AppSettings) -> Result<DiscoveredModels, String> {
    let configured = effective_transcribe_url(settings)
        .ok_or_else(|| "transcription URL is not configured".to_string())?;
    let catalog_url = openai_models_catalog_url(&configured)
        .ok_or_else(|| "transcription URL is invalid".to_string())?;
    let client = http_client();
    fetch_model_catalog(
        &client,
        &catalog_url,
        &effective_transcribe_api_key(settings),
        "openai-compatible",
    )
    .await
}

pub async fn list_summary_models(settings: &AppSettings) -> Result<DiscoveredModels, String> {
    let configured = settings
        .effective_summary_url()
        .ok_or_else(|| "summary URL is not configured".to_string())?;
    let client = http_client();
    if is_ollama_summary(settings) {
        let catalog_url = ollama_tags_catalog_url(&configured)
            .ok_or_else(|| "summary URL is invalid".to_string())?;
        return fetch_model_catalog(
            &client,
            &catalog_url,
            &effective_summary_api_key(settings),
            "ollama",
        )
        .await;
    }
    let catalog_url = openai_models_catalog_url(&configured)
        .ok_or_else(|| "summary URL is invalid".to_string())?;
    fetch_model_catalog(
        &client,
        &catalog_url,
        &effective_summary_api_key(settings),
        "openai-compatible",
    )
    .await
}

pub async fn test_transcribe(settings: &AppSettings) -> Result<(), String> {
    if effective_transcribe_url(settings).is_none() {
        return Err("transcription URL is not configured".into());
    }
    let client = http_client();
    let creds = ProviderCredentials::from_settings(&effective_transcribe_api_key(settings));
    let url = effective_transcribe_url(settings).expect("checked above");
    let request = creds.apply(client.get(&url));
    match request.send().await {
        Ok(response) if response.status().is_success() || response.status().as_u16() == 405 => {
            Ok(())
        }
        Ok(response) => Err(format!("provider returned {}", response.status())),
        Err(error) => Err(error.to_string()),
    }
}

pub async fn test_summary(settings: &AppSettings) -> Result<String, String> {
    let client = http_client();
    summarize(
        &client,
        settings,
        "Unit 12 responding to a test transmission.",
        "Reply with the single word OK if you can read this test prompt.",
    )
    .await
    .map_err(|error| error.to_string())
}

pub async fn test_geocoder(settings: &AppSettings) -> Result<String, String> {
    let client = http_client();
    geocode(&client, settings, "Main Street")
        .await
        .map(|location| location.label)
        .ok_or_else(|| "geocoder returned no results for test query".into())
}

pub fn extract_location_hint(transcript: &str) -> Option<String> {
    let lower = transcript.to_ascii_lowercase();
    [
        " at ",
        " near ",
        " on ",
        " intersection of ",
        " by ",
        " responding to ",
        " enroute to ",
    ]
    .iter()
    .find_map(|marker| {
        let start = lower.find(marker)? + marker.len();
        let value = transcript[start..].split(['.', ',', ';']).next()?.trim();
        (value.len() >= 3 && value.len() <= 80).then(|| value.to_string())
    })
}

pub fn detect_two_tone_dispatch(transcript: &str) -> bool {
    let lower = transcript.to_ascii_lowercase();
    [
        "toned out",
        "two tone",
        "two-tone",
        "tone out",
        "tones received",
        "dispatch tone",
    ]
    .iter()
    .any(|term| lower.contains(term))
}

pub async fn llm_location_hint(
    client: &Client,
    settings: &AppSettings,
    transcript: &str,
) -> Option<String> {
    if settings.effective_summary_url().is_none() {
        return None;
    }
    let prompt = format!(
        "Extract only a street address or intersection mentioned in this radio transcript. Reply with just the location text, or NONE if none is present.\n\nTranscript: {transcript}"
    );
    let hint = summarize(client, settings, transcript, &prompt).await.ok()?;
    let trimmed = hint.trim();
    if trimmed.is_empty() || trimmed.eq_ignore_ascii_case("none") {
        None
    } else {
        Some(trimmed.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_location_hint_from_transcript() {
        let hint = extract_location_hint("Engine 12 responding at 123 Main Street.");
        assert_eq!(hint.as_deref(), Some("123 Main Street"));
    }

    #[test]
    fn detects_two_tone_language() {
        assert!(detect_two_tone_dispatch("Station 3 was toned out for a medical."));
        assert!(!detect_two_tone_dispatch("Routine traffic stop."));
    }

    #[test]
    fn derives_openai_models_catalog_from_transcribe_url() {
        assert_eq!(
            openai_models_catalog_url("http://192.168.1.105:8000/v1/audio/transcriptions").as_deref(),
            Some("http://192.168.1.105:8000/v1/models")
        );
    }

    #[test]
    fn derives_ollama_tags_catalog_from_generate_url() {
        assert_eq!(
            ollama_tags_catalog_url("http://192.168.1.4:11434/api/generate").as_deref(),
            Some("http://192.168.1.4:11434/api/tags")
        );
    }

    #[test]
    fn parses_openai_and_ollama_catalog_payloads() {
        let openai = serde_json::json!({"data":[{"id":"Qwen/Qwen3-ASR-1.7B"}]});
        assert_eq!(
            parse_openai_models(&openai),
            vec!["Qwen/Qwen3-ASR-1.7B".to_string()]
        );
        let ollama = serde_json::json!({"models":[{"name":"llama3.2:3b"}]});
        assert_eq!(parse_ollama_models(&ollama), vec!["llama3.2:3b".to_string()]);
    }
}
