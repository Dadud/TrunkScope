use crate::state::AppState;
use crate::state::{ScanChannel, ScanList};
use std::sync::Arc;
use tokio::time::{Duration, sleep};

/// Decide whether an RF sample window should be treated as activity.
/// Signal is expressed in dBFS; a stronger signal is numerically higher.
pub fn opens_squelch(
    signal_dbfs: f32,
    threshold_dbfs: f32,
    detected_tone: Option<&str>,
    channel: &ScanChannel,
) -> bool {
    if signal_dbfs < threshold_dbfs.max(channel.squelch_db) {
        return false;
    }
    if !channel.tone_required {
        return true;
    }
    match (channel.tone.as_deref(), detected_tone) {
        (Some(expected), Some(actual)) => expected.trim().eq_ignore_ascii_case(actual.trim()),
        _ => false,
    }
}

pub fn next_channel(list: &ScanList, current: Option<usize>) -> Option<(usize, &ScanChannel)> {
    if list.channels.is_empty() {
        return None;
    }
    let start = current
        .map(|index| (index + 1) % list.channels.len())
        .unwrap_or(0);
    (0..list.channels.len())
        .map(|offset| (start + offset) % list.channels.len())
        .map(|index| (index, &list.channels[index]))
        .find(|(_, channel)| !channel.locked_out)
}

pub fn spawn(state: Arc<AppState>) {
    tokio::spawn(async move {
        let mut current: Option<usize> = None;
        let retune_path = std::env::var("TRUNKSCOPE_RETUNE_FILE")
            .unwrap_or_else(|_| "/tmp/trunkscope-retune-frequency".into());
        loop {
            let active = *state
                .active_scan_list
                .read()
                .expect("scan state lock poisoned");
            let Some(list_id) = active else {
                current = None;
                let _ = std::fs::remove_file(&retune_path);
                sleep(Duration::from_millis(250)).await;
                continue;
            };
            let list = state
                .scan_lists
                .read()
                .expect("scan list lock poisoned")
                .iter()
                .find(|list| list.id == list_id)
                .cloned();
            let Some(list) = list else {
                *state
                    .active_scan_list
                    .write()
                    .expect("scan state lock poisoned") = None;
                continue;
            };
            let Some((index, channel)) = next_channel(&list, current) else {
                *state
                    .active_scan_list
                    .write()
                    .expect("scan state lock poisoned") = None;
                continue;
            };
            current = Some(index);
            let receiver_id = state
                .receivers
                .read()
                .expect("receiver lock poisoned")
                .first()
                .map(|receiver| receiver.id);
            let activity = state
                .receivers
                .read()
                .expect("receiver lock poisoned")
                .first()
                .map(|receiver| opens_squelch(receiver.health.signal_dbfs, -120.0, None, channel))
                .unwrap_or(false);
            if list.pause_on_activity && activity && !channel.tone_required {
                sleep(Duration::from_millis(list.resume_after_ms as u64)).await;
                continue;
            }
            if receiver_id.is_some() {
                let _ = std::fs::write(&retune_path, channel.frequency_hz.to_string());
            }
            sleep(Duration::from_millis(channel.dwell_ms as u64)).await;
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    fn channel() -> ScanChannel {
        ScanChannel {
            id: Uuid::new_v4(),
            name: "Dispatch".into(),
            frequency_hz: 155_550_000,
            modulation: "NFM".into(),
            bandwidth_hz: 12_500,
            squelch_db: -65.0,
            tone: Some("100.0".into()),
            tone_required: true,
            dwell_ms: 2_500,
            priority: 0,
            locked_out: false,
        }
    }

    #[test]
    fn squelch_rejects_weak_signal_and_wrong_tone() {
        let c = channel();
        assert!(!opens_squelch(-70.0, -60.0, Some("100.0"), &c));
        assert!(!opens_squelch(-50.0, -60.0, Some("123.0"), &c));
        assert!(opens_squelch(-50.0, -60.0, Some("100.0"), &c));
    }

    #[test]
    fn scan_skips_locked_channels() {
        let mut c = channel();
        c.locked_out = true;
        let list = ScanList {
            id: Uuid::new_v4(),
            name: "Test".into(),
            enabled: true,
            pause_on_activity: true,
            resume_after_ms: 5000,
            channels: vec![c, channel()],
        };
        assert_eq!(next_channel(&list, None).map(|(index, _)| index), Some(1));
    }
}
