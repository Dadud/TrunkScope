use std::{sync::Arc, time::Duration};

use chrono::Utc;
use tokio::time::sleep;
use trunkscope_domain::{
    Call, CallEvent, CallState, EncryptionState, IncidentLocation, Receiver, ReceiverCapabilities,
    ReceiverDriver, ReceiverHealth, ReceiverState,
};
use uuid::Uuid;

use crate::state::AppState;

pub fn spawn(state: Arc<AppState>) {
    let receiver = Receiver {
        id: Uuid::new_v4(),
        label: "RF Simulator".into(),
        driver: ReceiverDriver::Simulator,
        serial: "SIM-001".into(),
        state: ReceiverState::Monitoring,
        center_frequency_hz: Some(851_012_500),
        sample_rate_hz: Some(2_400_000),
        gain_db: Some(28.0),
        ppm: 0.0,
        enabled: true,
        role: trunkscope_domain::ReceiverRole::General,
        soapy_index: Some(0),
        capabilities: ReceiverCapabilities {
            minimum_frequency_hz: 24_000_000,
            maximum_frequency_hz: 1_766_000_000,
            sample_rates_hz: vec![1_024_000, 2_400_000, 3_200_000],
            maximum_bandwidth_hz: 3_200_000,
            supports_agc: true,
            gain_elements: vec!["LNA".into()],
        },
        health: ReceiverHealth {
            signal_dbfs: -31.4,
            noise_dbfs: -57.2,
            frequency_error_hz: 42.0,
            dropped_samples: 0,
            updated_at: Utc::now(),
        },
    };
    state
        .receivers
        .write()
        .expect("receiver lock poisoned")
        .push(receiver);

    tokio::spawn(async move {
        let system_id = Uuid::new_v4();
        let site_id = Uuid::new_v4();
        let samples = [
            (
                1201,
                "Fire Dispatch",
                "Structure Fire",
                851_262_500,
                44.3984,
                -90.5785,
            ),
            (
                2305,
                "EMS Dispatch",
                "Medical",
                852_112_500,
                41.891,
                -87.621,
            ),
            (
                3417,
                "Public Works",
                "Services",
                853_462_500,
                41.877,
                -87.645,
            ),
        ];
        let mut index = 0usize;
        loop {
            let (talkgroup_id, label, category, frequency_hz, lat, lon) =
                samples[index % samples.len()];
            index += 1;
            let mut call = Call {
                id: Uuid::new_v4(),
                system_id,
                system_name: "Metro P25 (simulation)".into(),
                site_id,
                talkgroup_id,
                talkgroup_label: label.into(),
                category: category.into(),
                frequency_hz,
                tdma_slot: Some((index % 2) as u8),
                source_radio_id: Some(70_000 + index as u32),
                started_at: Utc::now(),
                ended_at: None,
                state: CallState::Active,
                encryption: EncryptionState::Clear,
                signal_dbfs: -29.0 - index as f32 % 8.0,
                transcript: None,
                summary: None,
                location: Some(IncidentLocation {
                    label: "Simulated incident".into(),
                    latitude: lat,
                    longitude: lon,
                    confidence: 0.92,
                }),
                audio: None,
            };
            state.upsert_call(call.clone(), CallEvent::Started(call.clone()));
            sleep(Duration::from_secs(3)).await;
            call.state = CallState::Complete;
            call.ended_at = Some(Utc::now());
            call.transcript = Some(format!("Simulated radio traffic on {label}."));
            call.summary = Some(format!("{category} response in progress."));
            state.upsert_call(call.clone(), CallEvent::Ended(call));
            sleep(Duration::from_secs(4)).await;
        }
    });
}
