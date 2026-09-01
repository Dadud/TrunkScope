mod api;
mod decoder;
mod processor;
mod radiod;
mod simulator;
mod state;

use std::{env, net::SocketAddr, sync::Arc};

use anyhow::{Context, Result};
use state::AppState;
use tokio::net::TcpListener;
use tracing::info;
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| EnvFilter::new("trunkscope=info,tower_http=info")),
        )
        .init();

    let state = Arc::new(AppState::new());
    processor::spawn(Arc::clone(&state));
    let radio_mode = env::var("TRUNKSCOPE_RADIO_MODE").unwrap_or_else(|_| {
        if env_bool("TRUNKSCOPE_SIMULATOR", true) {
            "simulator".into()
        } else {
            "radiod".into()
        }
    });
    match radio_mode.as_str() {
        "simulator" => simulator::spawn(Arc::clone(&state)),
        "radiod" => radiod::spawn(Arc::clone(&state))?,
        "decoder" => info!("external central decoder mode active"),
        other => anyhow::bail!(
            "TRUNKSCOPE_RADIO_MODE must be simulator, radiod, or decoder; got {other}"
        ),
    }

    let bind = env::var("TRUNKSCOPE_BIND").unwrap_or_else(|_| "127.0.0.1:8080".into());
    let address: SocketAddr = bind.parse().context("TRUNKSCOPE_BIND must be host:port")?;
    let listener = TcpListener::bind(address).await?;
    info!(%address, "TrunkScope control plane listening");

    axum::serve(listener, api::router(state))
        .with_graceful_shutdown(shutdown_signal())
        .await?;
    Ok(())
}

fn env_bool(name: &str, fallback: bool) -> bool {
    env::var(name)
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(fallback)
}

async fn shutdown_signal() {
    let ctrl_c = async {
        tokio::signal::ctrl_c().await.ok();
    };
    #[cfg(unix)]
    let terminate = async {
        tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("install SIGTERM handler")
            .recv()
            .await;
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();
    tokio::select! { _ = ctrl_c => {}, _ = terminate => {} }
}
