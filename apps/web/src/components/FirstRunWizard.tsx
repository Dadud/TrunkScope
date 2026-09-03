import { useState } from "react";
import { AI_STACK_PRESETS, type AppSettings, saveSettings } from "../api";

type FirstRunWizardProps = {
  settings: AppSettings;
  onComplete: (settings: AppSettings) => void;
  onDismiss: () => void;
};

export function FirstRunWizard({ settings, onComplete, onDismiss }: FirstRunWizardProps) {
  const [draft, setDraft] = useState<AppSettings>(settings);
  const [stack, setStack] = useState("local-gpu");
  const [status, setStatus] = useState("");

  const applyStack = () => {
    const preset = AI_STACK_PRESETS[stack];
    if (preset) {
      setDraft({ ...draft, ...preset, aiEnabled: true });
    }
  };

  const finish = async () => {
    try {
      const saved = await saveSettings({ ...draft, wizardCompleted: true });
      onComplete(saved);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Setup failed");
    }
  };

  return (
    <div className="first-run-wizard">
      <div className="first-run-panel">
        <h2>Welcome to TrunkScope</h2>
        <p>Configure your single-container appliance. Use your LAN IP for AI services, not localhost.</p>
        <label>
          AI stack preset
          <select value={stack} onChange={(event) => setStack(event.target.value)}>
            <option value="local-gpu">Local GPU (Speaches + Ollama)</option>
            <option value="cloud-hybrid">Cloud hybrid (Groq + OpenRouter)</option>
            <option value="privacy-max">Privacy max (local only)</option>
          </select>
        </label>
        <button type="button" onClick={applyStack}>Apply preset</button>
        <div className="form-grid">
          <label>Transcribe URL<input value={draft.transcribeUrl} onChange={(e) => setDraft({ ...draft, transcribeUrl: e.target.value })} /></label>
          <label>Summary URL<input value={draft.summaryUrl ?? ""} onChange={(e) => setDraft({ ...draft, summaryUrl: e.target.value })} /></label>
          <label>Geocoder URL<input value={draft.geocoderUrl ?? ""} onChange={(e) => setDraft({ ...draft, geocoderUrl: e.target.value })} /></label>
          <label>Site filter<input value={draft.siteFilter ?? ""} onChange={(e) => setDraft({ ...draft, siteFilter: e.target.value })} placeholder="e.g. black river falls" /></label>
        </div>
        {status && <p className="warning">{status}</p>}
        <div className="btn-row">
          <button type="button" className="primary-btn" onClick={finish}>Finish setup</button>
          <button type="button" onClick={onDismiss}>Skip for now</button>
        </div>
      </div>
    </div>
  );
}
