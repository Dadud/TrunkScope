use std::{sync::Arc, sync::atomic::Ordering, time::Duration};

use tokio::time::sleep;
use tracing::{info, warn};

use crate::state::AppState;

/// Watches config generations per capture mode so persisted changes reach the
/// running pipeline without a manual restart:
///
/// - `decoder`: bounces the supervised Trunk Recorder process via
///   `supervisorctl restart decoder` after saves settle.
/// - `simulator`: nothing to reload; generations are acknowledged instantly.
/// - `radiod`: handled natively by the supervise loop's pending-apply poll.
pub fn spawn(state: Arc<AppState>) {
    tokio::spawn(async move {
        loop {
            let mode = state
                .settings
                .read()
                .expect("settings lock poisoned")
                .radio_mode
                .clone();
            match mode.as_str() {
                "simulator" => {
                    state.mark_config_applied();
                    state.force_apply.store(false, Ordering::SeqCst);
                    sleep(Duration::from_secs(1)).await;
                }
                "decoder" => {
                    let forced = state.force_apply.load(Ordering::SeqCst);
                    if state.pending_apply() || forced {
                        // Coalesce bursts of saves before bouncing Trunk
                        // Recorder so a settings form round-trip reloads once.
                        sleep(Duration::from_secs(3)).await;
                        if !state.pending_apply() && !state.force_apply.load(Ordering::SeqCst) {
                            continue;
                        }
                        state.force_apply.store(false, Ordering::SeqCst);
                        match supervisor_restart().await {
                            Ok(()) => {
                                info!("decoder restarted to apply pending configuration");
                                state.mark_config_applied();
                            }
                            Err(error) => {
                                warn!(%error, "failed to restart decoder for pending configuration");
                                // Back off so a missing supervisorctl (dev
                                // hosts) does not spin; pending stays visible.
                                sleep(Duration::from_secs(30)).await;
                            }
                        }
                        continue;
                    }
                    sleep(Duration::from_millis(500)).await;
                }
                _ => {
                    state.force_apply.store(false, Ordering::SeqCst);
                    sleep(Duration::from_secs(1)).await;
                }
            }
        }
    });
}

async fn supervisor_restart() -> Result<(), String> {
    let output = tokio::process::Command::new("supervisorctl")
        .args(["restart", "decoder"])
        .output()
        .await
        .map_err(|error| format!("supervisorctl unavailable: {error}"))?;
    if output.status.success() {
        Ok(())
    } else {
        Err(format!(
            "supervisorctl restart decoder failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ))
    }
}
