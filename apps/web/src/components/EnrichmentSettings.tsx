import { useState } from "react";
import type { AiTaskSettings } from "../api";

const tasks = [
  ["event-tagging", "Event categories", "Identify fire, EMS, law, traffic, and other activity."],
  ["unit-extraction", "Units and call signs", "Extract unit identifiers mentioned in transcripts."],
  ["address-normalization", "Addresses", "Normalize explicitly stated addresses and intersections."],
  ["correlation", "Incident references", "Extract references for related incidents. Cross-channel linking is unfinished."],
  ["map-placement", "Location candidates", "Extract candidate locations. Automatic placement and review are unfinished."],
] as const;

export function EnrichmentSettings({ value, onChange }: {
  value: Record<string, AiTaskSettings>;
  onChange: (value: Record<string, AiTaskSettings>) => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const update = (id: string, patch: Partial<AiTaskSettings>) => onChange({ ...value, [id]: { ...value[id], ...patch } });
  return <section className="full-width config-box enrichment-settings" aria-label="Background enrichment">
    <h4>Background enrichment</h4>
    <p className="pane-desc">Choose which transcript tasks run and how often. Changes take effect after saving settings.</p>
    {tasks.filter(([id]) => value[id]).map(([id, name, description]) => {
      const config = value[id];
      const open = selected === id;
      return <div className="enrichment-task" key={id}>
        <div className="enrichment-task-heading">
          <label className="checkbox-label"><input type="checkbox" checked={config.enabled} onChange={event => update(id, { enabled: event.target.checked })} />{name}</label>
          <span>{config.enabled ? `Every ${config.intervalMinutes} min` : "Off"}</span>
          <button type="button" aria-expanded={open} aria-controls={`enrichment-${id}`} onClick={() => setSelected(open ? null : id)}>{open ? "Close" : `Edit ${name.toLowerCase()}`}</button>
        </div>
        {open && <div id={`enrichment-${id}`} className="enrichment-task-editor">
          <p className="pane-desc">{description}</p>
          <div className="form-grid">
            <label>Run every (minutes)<input type="number" min={1} max={1440} value={config.intervalMinutes} onChange={event => { const n = Number(event.target.value); if (Number.isInteger(n) && n >= 1 && n <= 1440) update(id, { intervalMinutes: n }); }} /></label>
            <label>Calls per batch<input type="number" min={1} max={256} value={config.maxBatch} onChange={event => { const n = Number(event.target.value); if (Number.isInteger(n) && n >= 1 && n <= 256) update(id, { maxBatch: n }); }} /></label>
          </div>
          <details><summary>Advanced model and prompt</summary>
            <p className="pane-desc">Tasks share the summary endpoint and API key. The format below must match that endpoint.</p>
            <label>API format<select value={config.provider ?? ""} onChange={event => update(id, { provider: event.target.value })}>
              <option value="">Use summary provider</option><option value="ollama">Ollama</option><option value="openai-compatible">OpenAI-compatible</option><option value="anthropic">Anthropic</option>
              {config.provider && !["ollama", "openai-compatible", "anthropic"].includes(config.provider) && <option value={config.provider}>{config.provider} (saved)</option>}
            </select></label>
            <label>Model override<input value={config.model ?? ""} placeholder="Use summary model" onChange={event => update(id, { model: event.target.value })} /></label>
            <label>System prompt<textarea rows={5} value={config.systemPrompt ?? ""} placeholder="Use the built-in task prompt" onChange={event => update(id, { systemPrompt: event.target.value })} /></label>
            <button type="button" onClick={() => update(id, { systemPrompt: "" })}>Use default prompt</button>
          </details>
        </div>}
      </div>;
    })}
    <p className="pane-desc">Transcription is configured separately. Audio tone analysis is unavailable. Workload counts are calculated on demand; the scheduled workload dashboard is unfinished.</p>
  </section>;
}
