//! CSV import helpers for RadioReference-style exports.

use std::collections::HashMap;

use uuid::Uuid;

use crate::state::{SystemProfile, SystemSite};
use trunkscope_domain::Talkgroup;

#[derive(Debug, Clone)]
pub struct TalkgroupImportOptions {
    pub system_id: Uuid,
    pub merge: bool,
}

#[derive(Debug, Clone)]
pub struct TalkgroupImportResult {
    pub imported: Vec<Talkgroup>,
    pub rows: usize,
}

pub fn parse_talkgroup_csv(
    csv: &str,
    options: &TalkgroupImportOptions,
    existing: &[Talkgroup],
) -> Option<TalkgroupImportResult> {
    let mut lines = csv.lines().filter(|line| !line.trim().is_empty());
    let header = lines.next()?;
    let columns = detect_talkgroup_columns(header)?;
    let mut imported = if options.merge {
        existing.to_vec()
    } else {
        Vec::new()
    };
    let mut rows = 0usize;
    for line in lines {
        let fields = split_csv_line(line);
        if fields.len() <= columns.alpha_tag {
            continue;
        }
        let Some(decimal_id) = fields
            .get(columns.decimal)
            .and_then(|field| field.parse::<u32>().ok())
        else {
            continue;
        };
        let alpha_tag = fields
            .get(columns.alpha_tag)
            .cloned()
            .filter(|field| !field.is_empty())?;
        rows += 1;
        let description = fields.get(columns.description).cloned().unwrap_or_default();
        let category = fields.get(columns.category).cloned().unwrap_or_default();
        if let Some(existing_row) = imported
            .iter_mut()
            .find(|row| row.decimal_id == decimal_id && row.system_id == options.system_id)
        {
            existing_row.alpha_tag = alpha_tag;
            existing_row.description = description;
            existing_row.category = category;
            continue;
        }
        imported.push(Talkgroup {
            id: Uuid::new_v4(),
            system_id: options.system_id,
            decimal_id,
            alpha_tag,
            description,
            category,
            priority: 0,
            enabled: true,
            record: true,
            public_allowed: false,
            mode: None,
        });
    }
    Some(TalkgroupImportResult { imported, rows })
}

struct TalkgroupColumns {
    decimal: usize,
    alpha_tag: usize,
    description: usize,
    category: usize,
}

fn detect_talkgroup_columns(header: &str) -> Option<TalkgroupColumns> {
    let fields: Vec<String> = split_csv_line(header);
    let lower: Vec<String> = fields
        .iter()
        .map(|field| field.to_ascii_lowercase())
        .collect();
    let decimal = lower.iter().position(|field| field.contains("decimal"))?;
    let alpha_tag = lower.iter().position(|field| field.contains("alpha"))?;
    let description = lower
        .iter()
        .position(|field| field.contains("description"))
        .unwrap_or(alpha_tag.saturating_add(2));
    let category = lower
        .iter()
        .position(|field| field.contains("category"))
        .unwrap_or(description.saturating_add(1));
    Some(TalkgroupColumns {
        decimal,
        alpha_tag,
        description,
        category,
    })
}

#[derive(Debug, Clone)]
pub struct SiteImportResult {
    pub sites: Vec<SystemSite>,
    pub rows: usize,
}

pub fn parse_site_csv(csv: &str) -> Option<SiteImportResult> {
    let mut lines = csv.lines().filter(|line| !line.trim().is_empty());
    let header = lines.next()?;
    if !header.to_ascii_lowercase().contains("description") {
        return None;
    }
    let mut sites = Vec::new();
    let mut rows = 0usize;
    for line in lines {
        let fields = split_csv_line(line);
        if fields.len() < 9 {
            continue;
        }
        let name = fields.get(4)?.trim().trim_matches('"').to_string();
        if name.is_empty() {
            continue;
        }
        let nac = parse_nac(fields.get(3)?);
        let latitude = fields.get(6)?.trim().trim_matches('"').parse().ok();
        let longitude = fields.get(7)?.trim().trim_matches('"').parse().ok();
        let frequencies = if fields.len() > 10 {
            fields[9..].join(",")
        } else {
            fields.get(8).cloned().unwrap_or_default()
        };
        let (control_channels_hz, voice_channels_hz) = parse_frequencies(&frequencies);
        rows += 1;
        sites.push(SystemSite {
            id: uuid::Uuid::new_v4(),
            name,
            nac,
            latitude,
            longitude,
            control_channels_hz,
            voice_channels_hz,
        });
    }
    Some(SiteImportResult { rows, sites })
}

fn parse_nac(raw: &str) -> Option<u32> {
    let trimmed = raw.trim().trim_matches('"');
    if trimmed.is_empty() {
        return None;
    }
    if let Ok(value) = u32::from_str_radix(trimmed.trim_start_matches("0x"), 16) {
        return Some(value);
    }
    trimmed.parse().ok()
}

fn parse_frequencies(raw: &str) -> (Vec<u64>, Vec<u64>) {
    let mut control = Vec::new();
    let mut voice = Vec::new();
    for token in raw.split(',') {
        let cleaned = token.trim().trim_matches('"');
        if cleaned.is_empty() {
            continue;
        }
        let control_channel = cleaned.ends_with('c') || cleaned.ends_with('C');
        let numeric = cleaned
            .trim_end_matches(['c', 'C'])
            .parse::<f64>()
            .ok()
            .map(|mhz| (mhz * 1_000_000.0).round() as u64);
        let Some(hz) = numeric else {
            continue;
        };
        if control_channel {
            control.push(hz);
        } else {
            voice.push(hz);
        }
    }
    (control, voice)
}

pub fn parse_systems_csv(csv: &str) -> Vec<SystemProfile> {
    let mut lines = csv.lines().filter(|line| !line.trim().is_empty());
    let Some(header) = lines.next() else {
        return Vec::new();
    };
    let columns: HashMap<String, usize> = split_csv_line(header)
        .into_iter()
        .enumerate()
        .map(|(index, field)| (field.to_ascii_lowercase(), index))
        .collect();
    let mut systems = Vec::new();
    for line in lines {
        let fields = split_csv_line(line);
        let name =
            field_at(&fields, &columns, &["name", "system", "description"]).unwrap_or_default();
        if name.is_empty() {
            continue;
        }
        let protocol =
            field_at(&fields, &columns, &["protocol", "type"]).unwrap_or_else(|| "p25".into());
        let control_channel_hz =
            field_at(&fields, &columns, &["controlchannelhz", "control channel"])
                .and_then(|value| value.parse().ok());
        systems.push(SystemProfile {
            id: Uuid::new_v4(),
            name,
            protocol,
            control_channel_hz,
            control_channels_hz: Vec::new(),
            frequency_hz: field_at(&fields, &columns, &["frequencyhz", "frequency"])
                .and_then(|value| value.parse().ok()),
            nac: field_at(&fields, &columns, &["nac"]).and_then(|value| parse_nac(&value)),
            bandwidth_hz: None,
            modulation: None,
            squelch_db: None,
            tone: None,
            deviation_hz: None,
            step_hz: None,
            dwell_ms: None,
            sites: Vec::new(),
            receiver_id: None,
            decode_mdc: None,
        });
    }
    systems
}

fn field_at(fields: &[String], columns: &HashMap<String, usize>, keys: &[&str]) -> Option<String> {
    keys.iter()
        .find_map(|key| columns.get(*key))
        .and_then(|index| fields.get(*index))
        .map(|value| value.trim().trim_matches('"').to_string())
        .filter(|value| !value.is_empty())
}

fn split_csv_line(line: &str) -> Vec<String> {
    let mut fields = Vec::new();
    let mut current = String::new();
    let mut in_quotes = false;
    for ch in line.chars() {
        match ch {
            '"' => in_quotes = !in_quotes,
            ',' if !in_quotes => {
                fields.push(current.trim().to_string());
                current.clear();
            }
            _ => current.push(ch),
        }
    }
    fields.push(current.trim().to_string());
    fields
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_site_csv_fixture_row() {
        let csv = "RFSS,Site Dec,Site Hex,Site NAC,Description,County Name,Lat,Lon,Range,Frequencies\n1,002,2,B0C,\"Baraboo\",\"Sauk\",43.430920,-89.647837,30,139.187500c,152.022500";
        let result = parse_site_csv(csv).expect("site csv");
        assert_eq!(result.rows, 1);
        assert_eq!(result.sites[0].name, "Baraboo");
        assert_eq!(result.sites[0].nac, Some(0xB0C));
        assert!(!result.sites[0].control_channels_hz.is_empty());
    }

    #[test]
    fn merges_talkgroup_rows_by_decimal() {
        let csv = "Decimal,Hex,Alpha Tag,Mode,Description,Tag,Category\n100,064,Dispatch,D,Main Dispatch,Fire,Public Safety";
        let existing = vec![Talkgroup {
            id: Uuid::new_v4(),
            system_id: Uuid::nil(),
            decimal_id: 100,
            alpha_tag: "Old".into(),
            description: String::new(),
            category: String::new(),
            priority: 0,
            enabled: true,
            record: true,
            public_allowed: false,
            mode: None,
        }];
        let result = parse_talkgroup_csv(
            csv,
            &TalkgroupImportOptions {
                system_id: Uuid::nil(),
                merge: true,
            },
            &existing,
        )
        .expect("talkgroup csv");
        assert_eq!(result.rows, 1);
        assert_eq!(result.imported.len(), 1);
        assert_eq!(result.imported[0].alpha_tag, "Dispatch");
    }
}
