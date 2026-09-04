//! Encoding hygiene gate. A PowerShell `Get-Content`/`Set-Content` round-trip
//! once rewrote UTF-8 sources as cp1252 mojibake and shipped it to the
//! production UI. These byte sequences only ever appear as corruption
//! artifacts; legitimate content uses proper codepoints (— U+2014,
//! … U+2026, · U+00B7, real emoji), which this gate ignores.

use std::path::{Path, PathBuf};

const MOJIBAKE_SIGNATURES: &[&str] = &[
    "Ã¢â‚¬",            // generic em-dash/ellipsis/quote corruption
    "ÃÂ·",              // middle-dot corruption
    "Ã°",               // emoji corruption
    "\u{00E2}\u{20AC}", // â + € without the closing quote byte
    "\u{00C2}\u{00B7}", // Â·
];

fn collect_sources(dir: &Path, files: &mut Vec<PathBuf>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
            if matches!(name, "node_modules" | "dist" | "target") {
                continue;
            }
            collect_sources(&path, files);
        } else if path
            .extension()
            .is_some_and(|ext| matches!(ext.to_str(), Some("tsx" | "ts" | "rs" | "css" | "md")))
        {
            files.push(path);
        }
    }
}

#[test]
fn no_source_file_contains_cp1252_mojibake() {
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let roots = [
        manifest.join("../../apps/web/src"),
        manifest.join("src"),
        manifest.join("../../crates/domain/src"),
        manifest.join("../../docs"),
    ];
    let mut files = Vec::new();
    for root in roots {
        collect_sources(&root, &mut files);
    }
    assert!(
        files.len() > 50,
        "source walk found only {} files; paths moved?",
        files.len()
    );
    let offenders: Vec<String> = files
        .iter()
        .filter(|file| {
            let Ok(text) = std::fs::read_to_string(file) else {
                return false;
            };
            MOJIBAKE_SIGNATURES
                .iter()
                .any(|signature| text.contains(signature))
        })
        .map(|file| file.display().to_string())
        .collect();
    assert!(
        offenders.is_empty(),
        "cp1252 mojibake detected (shell-pipe file edit regression) in: {}",
        offenders.join(", ")
    );
}
