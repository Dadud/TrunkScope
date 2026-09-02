use crate::state::AppState;
use argon2::{Argon2, PasswordHash, PasswordVerifier};
use axum::{
    Json,
    extract::State,
    http::{HeaderMap, StatusCode, header},
    response::IntoResponse,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use uuid::Uuid;

#[derive(Deserialize)]
pub struct LoginRequest {
    pub username: String,
    pub password: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionResponse {
    pub username: String,
    pub role: &'static str,
}

pub async fn login(
    State(state): State<Arc<AppState>>,
    Json(request): Json<LoginRequest>,
) -> impl IntoResponse {
    let expected_user =
        std::env::var("TRUNKSCOPE_ADMIN_USERNAME").unwrap_or_else(|_| "admin".into());
    let Ok(hash) = std::env::var("TRUNKSCOPE_ADMIN_PASSWORD_HASH") else {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };
    let Ok(parsed) = PasswordHash::new(&hash) else {
        return StatusCode::INTERNAL_SERVER_ERROR.into_response();
    };
    if request.username != expected_user
        || Argon2::default()
            .verify_password(request.password.as_bytes(), &parsed)
            .is_err()
    {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let token = Uuid::new_v4().to_string();
    state
        .sessions
        .write()
        .expect("sessions lock poisoned")
        .insert(token.clone(), request.username.clone());
    let mut response = Json(SessionResponse {
        username: request.username,
        role: "administrator",
    })
    .into_response();
    response.headers_mut().insert(
        header::SET_COOKIE,
        format!("trunkscope_session={token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400")
            .parse()
            .unwrap(),
    );
    response
}

pub async fn me(State(state): State<Arc<AppState>>, headers: HeaderMap) -> impl IntoResponse {
    let Some(token) = cookie(&headers) else {
        return StatusCode::UNAUTHORIZED.into_response();
    };
    let Some(username) = state
        .sessions
        .read()
        .expect("sessions lock poisoned")
        .get(token)
        .cloned()
    else {
        return StatusCode::UNAUTHORIZED.into_response();
    };
    Json(SessionResponse {
        username,
        role: "administrator",
    })
    .into_response()
}

pub async fn logout(State(state): State<Arc<AppState>>, headers: HeaderMap) -> impl IntoResponse {
    if let Some(token) = cookie(&headers) {
        state
            .sessions
            .write()
            .expect("sessions lock poisoned")
            .remove(token);
    }
    (
        [(
            header::SET_COOKIE,
            "trunkscope_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0",
        )],
        StatusCode::NO_CONTENT,
    )
}

fn cookie(headers: &HeaderMap) -> Option<&str> {
    headers
        .get(header::COOKIE)?
        .to_str()
        .ok()?
        .split(';')
        .find_map(|part| part.trim().strip_prefix("trunkscope_session="))
}
