mod api;
mod apply;
mod auth;
mod decoder;
mod file_ingest;
mod imports;
mod persistence;
mod processor;
mod providers;
mod radiod;
mod receiver_presets;
mod retention;
mod scanner;
mod simulator;
mod sqlite;
mod state;

use std::{env, net::SocketAddr, sync::Arc};

use anyhow::{Context, Result};
use state::AppState;
use tokio::net::TcpListener;
use tracing::info;
use tracing_subscriber::EnvFilter;
use trunkscope_domain::{Receiver, ReceiverCapabilities, ReceiverHealth, ReceiverState};

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| EnvFilter::new("trunkscope=info,tower_http=info")),
        )
        .init();

    let state = Arc::new(AppState::new());
    sqlite::hydrate(&state);
    retention::spawn(Arc::clone(&state));
    // Session boundaries are runtime state, not a UI heuristic. Finalize an
    // exchange once it has been quiet for the configured ten-second dwell.
    {
        let session_state = Arc::clone(&state);
        tokio::spawn(async move {
            let mut ticker = tokio::time::interval(std::time::Duration::from_secs(1));
            loop {
                ticker.tick().await;
                session_state.finalize_expired_sessions();
            }
        });
    }
    if let Ok(database_url) = env::var("TRUNKSCOPE_DATABASE_URL") {
        persistence::hydrate(&state, &database_url).await;
        if let Some(sender) = persistence::start(database_url).await {
            *state
                .persistence
                .write()
                .expect("persistence lock poisoned") = Some(sender);
        }
    }
    // Decoder mode does not run the local radiod worker, so create the
    // operator-visible receiver inventory entry from persisted settings.
    if state
        .receivers
        .read()
        .expect("receiver lock poisoned")
        .is_empty()
        && state
            .settings
            .read()
            .expect("settings lock poisoned")
            .radio_mode
            == "decoder"
    {
        let settings = state
            .settings
            .read()
            .expect("settings lock poisoned")
            .clone();
        state
            .receivers
            .write()
            .expect("receiver lock poisoned")
            .push(Receiver {
                id: uuid::Uuid::new_v4(),
                label: "RSP1B via Trunk Recorder".into(),
                driver: trunkscope_domain::ReceiverDriver::Sdrplay,
                serial: settings.radio_device.clone(),
                state: ReceiverState::Monitoring,
                center_frequency_hz: Some(settings.radio_frequency_hz),
                sample_rate_hz: Some(settings.radio_sample_rate_hz),
                gain_db: settings.radio_gain_db,
                ppm: settings.radio_ppm,
                enabled: true,
                role: trunkscope_domain::ReceiverRole::General,
                soapy_index: Some(0),
                auto_tune: None,
                capabilities: ReceiverCapabilities {
                    minimum_frequency_hz: 1_000_000,
                    maximum_frequency_hz: 2_000_000_000,
                    sample_rates_hz: vec![2_000_000, 2_048_000, 2_400_000, 6_000_000],
                    maximum_bandwidth_hz: 8_000_000,
                    supports_agc: true,
                    gain_elements: vec!["IFGR".into(), "RFGR".into()],
                },
                health: ReceiverHealth {
                    signal_dbfs: -120.0,
                    noise_dbfs: -120.0,
                    frequency_error_hz: 0.0,
                    dropped_samples: 0,
                    updated_at: chrono::Utc::now(),
                },
            });
    }
    api::write_decoder_config(&state);
    // The boot-time write is, by definition, what the supervised capture
    // starts with; without this the apply task would bounce the decoder
    // seconds after every container start.
    state.mark_config_applied();
    processor::spawn(Arc::clone(&state));
    file_ingest::spawn(Arc::clone(&state));
    // An enabled scan list is an operator intent, not merely UI metadata.
    // Restore the first enabled list after restart so radiod immediately
    // begins retuning through persisted FM channels.
    if state
        .settings
        .read()
        .expect("settings lock poisoned")
        .radio_mode
        == "radiod"
    {
        let active = state
            .scan_lists
            .read()
            .expect("scan list lock poisoned")
            .iter()
            .find(|list| list.enabled)
            .map(|list| list.id);
        *state
            .active_scan_list
            .write()
            .expect("scan state lock poisoned") = active;
    }
    scanner::spawn(Arc::clone(&state));
    let radio_mode = state
        .settings
        .read()
        .expect("settings lock poisoned")
        .radio_mode
        .clone();
    match radio_mode.as_str() {
        "simulator" => simulator::spawn(Arc::clone(&state)),
        "radiod" => radiod::spawn(Arc::clone(&state))?,
        "decoder" => info!("external central decoder mode active"),
        other => anyhow::bail!(
            "TRUNKSCOPE_RADIO_MODE must be simulator, radiod, or decoder; got {other}"
        ),
    }
    // Watches config generations so saves reach the running pipeline without a
    // manual restart. Started after the mode worker so both see the same state.
    apply::spawn(Arc::clone(&state));

    let bind = env::var("TRUNKSCOPE_BIND").unwrap_or_else(|_| "127.0.0.1:8080".into());
    let address: SocketAddr = bind.parse().context("TRUNKSCOPE_BIND must be host:port")?;
    let listener = TcpListener::bind(address).await?;
    info!(%address, "TrunkScope control plane listening");

    axum::serve(listener, api::router(state))
        .with_graceful_shutdown(shutdown_signal())
        .await?;
    Ok(())
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
