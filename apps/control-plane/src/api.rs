use std::{sync::Arc, time::Instant};

use axum::{
    Json, Router,
    extract::{
        Query, State, WebSocketUpgrade,
        ws::{Message, WebSocket},
    },
    http::StatusCode,
    response::IntoResponse,
    routing::get,
};
use serde::{Deserialize, Serialize};
use tower_http::{cors::CorsLayer, trace::TraceLayer};
use trunkscope_domain::{Call, PublicationPolicy, Receiver};

use crate::state::AppState;

pub fn router(state: Arc<AppState>) -> Router {
    Router::new()
        .route("/api/v1/health", get(health))
        .route("/api/v1/snapshot", get(snapshot))
        .route("/api/v1/receivers", get(receivers))
        .route("/api/v1/calls", get(calls))
        .route("/api/v1/policies/public", get(public_policy))
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

async fn public_policy(State(state): State<Arc<AppState>>) -> Json<PublicationPolicy> {
    Json(
        state
            .public_policy
            .read()
            .expect("policy lock poisoned")
            .clone(),
    )
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
}
