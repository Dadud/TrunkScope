use crate::state::{AppState, atomic_write};
use argon2::password_hash::SaltString;
use argon2::{Argon2, PasswordHash, PasswordHasher, PasswordVerifier};
use axum::{
    Json,
    extract::State,
    http::{HeaderMap, StatusCode, header},
    response::{IntoResponse, Response},
};
use rand_core::OsRng;
use serde::{Deserialize, Serialize};
use std::{path::PathBuf, sync::Arc};
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
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthStatus {
    pub enabled: bool,
    pub setup_required: bool,
    pub local_only: bool,
}
#[derive(Deserialize)]
pub struct SetupRequest {
    pub username: String,
    pub password: String,
}
#[derive(Serialize, Deserialize)]
struct StoredCredentials {
    username: String,
    password_hash: String,
}

fn credentials_path() -> PathBuf {
    std::env::var("TRUNKSCOPE_AUTH_PATH")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("/var/lib/trunkscope/audio/auth.json"))
}
fn credentials() -> Option<StoredCredentials> {
    if let (Ok(username), Ok(password_hash)) = (
        std::env::var("TRUNKSCOPE_ADMIN_USERNAME"),
        std::env::var("TRUNKSCOPE_ADMIN_PASSWORD_HASH"),
    ) {
        return Some(StoredCredentials {
            username,
            password_hash,
        });
    }
    let bytes = std::fs::read(credentials_path()).ok()?;
    serde_json::from_slice(&bytes).ok()
}
fn insecure_mode() -> bool {
    ["TRUNKSCOPE_LOCAL_ONLY", "TRUNKSCOPE_INSECURE_MODE"]
        .iter()
        .any(|key| {
            std::env::var(key)
                .map(|v| v.eq_ignore_ascii_case("true"))
                .unwrap_or(false)
        })
}

pub async fn status() -> Json<AuthStatus> {
    let local_only = insecure_mode();
    let enabled = credentials().is_some() && !local_only;
    Json(AuthStatus {
        enabled,
        setup_required: !enabled && !local_only,
        local_only,
    })
}

pub async fn setup(
    State(_state): State<Arc<AppState>>,
    Json(request): Json<SetupRequest>,
) -> Response {
    if credentials().is_some() {
        return (
            StatusCode::CONFLICT,
            "administrator credentials are already configured",
        )
            .into_response();
    }
    if request.username.trim().is_empty() || request.password.chars().count() < 12 {
        return (
            StatusCode::BAD_REQUEST,
            "username is required and password must be at least 12 characters",
        )
            .into_response();
    }
    let salt = SaltString::generate(&mut OsRng);
    let Ok(password_hash) = Argon2::default()
        .hash_password(request.password.as_bytes(), &salt)
        .map(|hash| hash.to_string())
    else {
        return StatusCode::INTERNAL_SERVER_ERROR.into_response();
    };
    let document = match serde_json::to_vec_pretty(&StoredCredentials {
        username: request.username.trim().to_owned(),
        password_hash,
    }) {
        Ok(value) => value,
        Err(_) => return StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    };
    if atomic_write(&credentials_path(), &document).is_err() {
        return StatusCode::INTERNAL_SERVER_ERROR.into_response();
    }
    StatusCode::CREATED.into_response()
}

pub async fn change_password(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(request): Json<SetupRequest>,
) -> Response {
    if !authenticated(&state, &headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    if std::env::var("TRUNKSCOPE_ADMIN_PASSWORD_HASH").is_ok() {
        return (
            StatusCode::CONFLICT,
            "password is managed by the deployment environment",
        )
            .into_response();
    }
    if request.password.chars().count() < 12 {
        return (
            StatusCode::BAD_REQUEST,
            "password must be at least 12 characters",
        )
            .into_response();
    }
    let Some(mut stored) = credentials() else {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };
    if !request.username.trim().is_empty() {
        stored.username = request.username.trim().to_owned();
    }
    let salt = SaltString::generate(&mut OsRng);
    let Ok(hash) = Argon2::default()
        .hash_password(request.password.as_bytes(), &salt)
        .map(|value| value.to_string())
    else {
        return StatusCode::INTERNAL_SERVER_ERROR.into_response();
    };
    stored.password_hash = hash;
    if atomic_write(
        &credentials_path(),
        &serde_json::to_vec_pretty(&stored).unwrap_or_default(),
    )
    .is_err()
    {
        return StatusCode::INTERNAL_SERVER_ERROR.into_response();
    }
    StatusCode::NO_CONTENT.into_response()
}

pub async fn login(
    State(state): State<Arc<AppState>>,
    Json(request): Json<LoginRequest>,
) -> Response {
    let Some(stored) = credentials() else {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };
    let Ok(parsed) = PasswordHash::new(&stored.password_hash) else {
        return StatusCode::INTERNAL_SERVER_ERROR.into_response();
    };
    let username = request.username.trim();
    if username != stored.username
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
        .insert(token.clone(), username.to_owned());
    let mut response = Json(SessionResponse {
        username: username.to_owned(),
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

pub async fn me(State(state): State<Arc<AppState>>, headers: HeaderMap) -> Response {
    if insecure_mode() {
        return Json(SessionResponse {
            username: "local".to_owned(),
            role: "administrator",
        })
        .into_response();
    }
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
pub async fn logout(State(state): State<Arc<AppState>>, headers: HeaderMap) -> Response {
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
        .into_response()
}
fn cookie(headers: &HeaderMap) -> Option<&str> {
    headers
        .get(header::COOKIE)?
        .to_str()
        .ok()?
        .split(';')
        .find_map(|part| part.trim().strip_prefix("trunkscope_session="))
}
pub fn authenticated(state: &AppState, headers: &HeaderMap) -> bool {
    cookie(headers).is_some_and(|token| {
        state
            .sessions
            .read()
            .expect("sessions lock poisoned")
            .contains_key(token)
    })
}
pub fn admin_accessible(state: &AppState, headers: &HeaderMap) -> bool {
    insecure_mode() || authenticated(state, headers)
}
