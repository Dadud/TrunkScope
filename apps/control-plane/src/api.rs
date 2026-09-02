use std::{sync::Arc, time::Instant};

use axum::{
    Json, Router,
    extract::{
        Path, Query, State, WebSocketUpgrade,
        ws::{Message, WebSocket},
    },
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::get,
};
use serde::{Deserialize, Serialize};
use tower_http::{cors::CorsLayer, trace::TraceLayer};
use trunkscope_domain::{Call, PublicationPolicy, Receiver};

use crate::state::{AppState, SystemProfile};

pub fn router(state: Arc<AppState>) -> Router {
    Router::new()
        .route("/api/v1/health", get(health))
        .route(
            "/api/v1/auth/login",
            axum::routing::post(crate::auth::login),
        )
        .route("/api/v1/auth/me", get(crate::auth::me))
        .route(
            "/api/v1/auth/logout",
            axum::routing::post(crate::auth::logout),
        )
        .route("/api/v1/snapshot", get(snapshot))
        .route("/api/v1/receivers", get(receivers))
        .route("/api/v1/calls", get(calls))
        .route("/api/v1/audio/{id}", get(audio))
        .route("/api/v1/policies/public", get(public_policy))
        .route("/api/v1/systems", get(systems).post(save_system))
        .route("/api/v1/live", get(live))
        .route("/api/v1/decoder/status", get(crate::decoder::status_socket))
        .with_state(state)
        .layer(CorsLayer::permissive())
        .layer(TraceLayer::new_for_http())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct HealthResponse {
    status: &'static str,
    version: &'static str,
    uptime_ms: u128,
}

async fn health() -> Json<HealthResponse> {
    static STARTED: std::sync::OnceLock<Instant> = std::sync::OnceLock::new();
    let started = STARTED.get_or_init(Instant::now);
    Json(HealthResponse {
        status: "ok",
        version: env!("CARGO_PKG_VERSION"),
        uptime_ms: started.elapsed().as_millis(),
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Snapshot {
    receivers: Vec<Receiver>,
    calls: Vec<Call>,
    public_policy: PublicationPolicy,
}

async fn snapshot(State(state): State<Arc<AppState>>) -> Json<Snapshot> {
    Json(Snapshot {
        receivers: state
            .receivers
            .read()
            .expect("receiver lock poisoned")
            .clone(),
        calls: state
            .calls
            .read()
            .expect("calls lock poisoned")
            .iter()
            .cloned()
            .collect(),
        public_policy: state
            .public_policy
            .read()
            .expect("policy lock poisoned")
            .clone(),
    })
}

async fn receivers(State(state): State<Arc<AppState>>) -> Json<Vec<Receiver>> {
    Json(
        state
            .receivers
            .read()
            .expect("receiver lock poisoned")
            .clone(),
    )
}

#[derive(Deserialize)]
struct CallQuery {
    limit: Option<usize>,
}

async fn calls(
    State(state): State<Arc<AppState>>,
    Query(query): Query<CallQuery>,
) -> Json<Vec<Call>> {
    let limit = query.limit.unwrap_or(50).clamp(1, 200);
    Json(
        state
            .calls
            .read()
            .expect("calls lock poisoned")
            .iter()
            .take(limit)
            .cloned()
            .collect(),
    )
}

async fn audio(
    State(state): State<Arc<AppState>>,
    Path(id): Path<uuid::Uuid>,
    headers: axum::http::HeaderMap,
) -> Response {
    let expected = std::env::var("TRUNKSCOPE_AUDIO_TOKEN").unwrap_or_default();
    let provided = headers
        .get("authorization")
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default();
    if expected.is_empty() || provided != format!("Bearer {expected}") {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let Some(asset) = state.calls.read().ok().and_then(|calls| {
        calls
            .iter()
            .find(|call| call.id == id)
            .and_then(|call| call.audio.clone())
    }) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let root = std::path::PathBuf::from(
        std::env::var("TRUNKSCOPE_CALLS_PATH")
            .unwrap_or_else(|_| "/var/lib/trunkscope/calls".into()),
    );
    let relative = asset
        .object_key
        .trim_start_matches("/var/lib/trunkscope/calls/");
    let path = root.join(relative);
    if !path.starts_with(&root) {
        return StatusCode::NOT_FOUND.into_response();
    }
    match tokio::fs::read(path).await {
        Ok(bytes) => (
            [(axum::http::header::CONTENT_TYPE, asset.content_type)],
            bytes,
        )
            .into_response(),
        Err(_) => StatusCode::NOT_FOUND.into_response(),
    }
}

async fn public_policy(State(state): State<Arc<AppState>>) -> Json<PublicationPolicy> {
    Json(
        state
            .public_policy
            .read()
            .expect("policy lock poisoned")
            .clone(),
    )
}

async fn systems(State(state): State<Arc<AppState>>) -> Json<Vec<SystemProfile>> {
    Json(state.systems.read().expect("systems lock poisoned").clone())
}

async fn save_system(
    State(state): State<Arc<AppState>>,
    Json(mut profile): Json<SystemProfile>,
) -> (StatusCode, Json<SystemProfile>) {
    let is_p25 = profile.protocol.starts_with("p25");
    if profile.name.trim().is_empty()
        || (is_p25 && profile.control_channel_hz.unwrap_or_default() == 0)
        || (!is_p25 && profile.frequency_hz.unwrap_or_default() == 0)
    {
        return (StatusCode::BAD_REQUEST, Json(profile));
    }
    if !is_p25 {
        let bandwidth_ok = matches!(profile.bandwidth_hz, Some(6250 | 12500 | 25000));
        if !bandwidth_ok || profile.modulation.as_deref().is_none() {
            return (StatusCode::BAD_REQUEST, Json(profile));
        }
        profile.control_channel_hz = None;
        profile.nac = None;
    } else {
        profile.frequency_hz = None;
        profile.tone = None;
    }
    if profile.id.is_nil() {
        profile.id = uuid::Uuid::new_v4();
    }
    profile.name = profile.name.trim().to_string();
    let mut systems = state.systems.write().expect("systems lock poisoned");
    if let Some(existing) = systems.iter_mut().find(|item| item.id == profile.id) {
        *existing = profile.clone();
    } else {
        systems.push(profile.clone());
    }
    if let Ok(serialized) = serde_json::to_vec_pretty(&*systems) {
        if let Some(parent) = state.systems_path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let _ = std::fs::write(&state.systems_path, serialized);
    }
    (StatusCode::CREATED, Json(profile))
}

async fn live(upgrade: WebSocketUpgrade, State(state): State<Arc<AppState>>) -> impl IntoResponse {
    upgrade.on_upgrade(move |socket| live_socket(socket, state))
}

async fn live_socket(mut socket: WebSocket, state: Arc<AppState>) {
    let mut events = state.events.subscribe();
    while let Ok(event) = events.recv().await {
        let Ok(payload) = serde_json::to_string(&event) else {
            continue;
        };
        if socket.send(Message::Text(payload.into())).await.is_err() {
            break;
        }
    }
}

#[allow(dead_code)]
fn internal_error() -> impl IntoResponse {
    (StatusCode::INTERNAL_SERVER_ERROR, "internal server error")
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{body::Body, http::Request};
    use tower::ServiceExt;

    #[tokio::test]
    async fn health_endpoint_is_available() {
        let response = router(Arc::new(AppState::new()))
            .oneshot(
                Request::builder()
                    .uri("/api/v1/health")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn policy_is_private_by_default() {
        let response = router(Arc::new(AppState::new()))
            .oneshot(
                Request::builder()
                    .uri("/api/v1/policies/public")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn analog_profile_does_not_require_control_channel_or_nac() {
        let state = Arc::new(AppState::new());
        let response = router(state)
            .oneshot(
                Request::post("/api/v1/systems")
                    .header("content-type", "application/json")
                    .body(Body::from(r#"{"id":"00000000-0000-0000-0000-000000000000","name":"Local FM","protocol":"analog-fm","frequencyHz":155550000,"bandwidthHz":12500,"modulation":"NFM"}"#))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::CREATED);
    }

    #[tokio::test]
    async fn audio_requires_bearer_token() {
        let response = router(Arc::new(AppState::new()))
            .oneshot(
                Request::get(format!("/api/v1/audio/{}", uuid::Uuid::new_v4()))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }
}
