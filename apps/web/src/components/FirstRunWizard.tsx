import { useEffect, useState } from "react";
import {
  AI_STACK_PRESETS,
  discoverSummaryModels,
  discoverTranscribeModels,
  type AppSettings,
  saveSettings,
} from "../api";
import { IntegrationModelField } from "./IntegrationModelField";
import { deriveAiProfile, pickSummaryModel, pickTranscribeModel } from "../integrationModels";

type FirstRunWizardProps = {
  settings: AppSettings;
  onComplete: (settings: AppSettings) => void;
  onDismiss: () => void;
};

export function FirstRunWizard({ settings, onComplete, onDismiss }: FirstRunWizardProps) {
  const [draft, setDraft] = useState<AppSettings>(settings);
  const [stack, setStack] = useState("local-gpu");
  const [status, setStatus] = useState("");
  const [transcribeModels, setTranscribeModels] = useState<string[]>([]);
  const [summaryModels, setSummaryModels] = useState<string[]>([]);
  const [transcribeModelSource, setTranscribeModelSource] = useState<string>();
  const [summaryModelSource, setSummaryModelSource] = useState<string>();
  const [transcribeModelsLoading, setTranscribeModelsLoading] = useState(false);
  const [summaryModelsLoading, setSummaryModelsLoading] = useState(false);
  const [transcribeModelsError, setTranscribeModelsError] = useState<string>();
  const [summaryModelsError, setSummaryModelsError] = useState<string>();

  const applyStack = () => {
    const preset = AI_STACK_PRESETS[stack];
    if (preset) {
      setDraft({ ...draft, ...preset, aiEnabled: true });
    }
  };

  const refreshTranscribeModels = async () => {
    if (!draft.transcribeUrl.trim()) {
      setTranscribeModels([]);
      setTranscribeModelsError("Transcribe URL is required");
      return;
    }
    setTranscribeModelsLoading(true);
    setTranscribeModelsError(undefined);
    try {
      const discovered = await discoverTranscribeModels({
        transcribeUrl: draft.transcribeUrl,
        transcribeProvider: draft.transcribeProvider,
        transcribeApiKey: draft.transcribeApiKey,
      });
      setTranscribeModels(discovered.models);
      setTranscribeModelSource(discovered.catalogUrl);
      const transcribeModel = pickTranscribeModel(discovered.models, draft.transcribeModel);
      setDraft((current) => ({
        ...current,
        transcribeModel,
        aiProfile: deriveAiProfile(transcribeModel),
      }));
    } catch (error) {
      setTranscribeModels([]);
      setTranscribeModelsError(error instanceof Error ? error.message : "Model discovery failed");
    } finally {
      setTranscribeModelsLoading(false);
    }
  };

  const refreshSummaryModels = async () => {
    if (!draft.summaryUrl?.trim()) {
      setSummaryModels([]);
      setSummaryModelsError("Summary URL is required");
      return;
    }
    setSummaryModelsLoading(true);
    setSummaryModelsError(undefined);
    try {
      const discovered = await discoverSummaryModels({
        summaryUrl: draft.summaryUrl,
        summaryProvider: draft.summaryProvider,
        summaryApiKey: draft.summaryApiKey,
      });
      setSummaryModels(discovered.models);
      setSummaryModelSource(discovered.catalogUrl);
      setDraft((current) => ({
        ...current,
        summaryModel: pickSummaryModel(discovered.models, current.summaryModel),
      }));
    } catch (error) {
      setSummaryModels([]);
      setSummaryModelsError(error instanceof Error ? error.message : "Model discovery failed");
    } finally {
      setSummaryModelsLoading(false);
    }
  };

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refreshTranscribeModels();
      void refreshSummaryModels();
    }, 400);
    return () => window.clearTimeout(timer);
  }, [
    draft.transcribeUrl,
    draft.transcribeProvider,
    draft.transcribeApiKey,
    draft.summaryUrl,
    draft.summaryProvider,
    draft.summaryApiKey,
  ]);

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
          <IntegrationModelField
            label="Transcribe model"
            kind="transcribe"
            value={draft.transcribeModel}
            models={transcribeModels}
            loading={transcribeModelsLoading}
            error={transcribeModelsError}
            source={transcribeModelSource}
            onRefresh={() => void refreshTranscribeModels()}
            onChange={(transcribeModel) =>
              setDraft({
                ...draft,
                transcribeModel,
                aiProfile: deriveAiProfile(transcribeModel),
              })
            }
          />
          <label>Summary URL<input value={draft.summaryUrl ?? ""} onChange={(e) => setDraft({ ...draft, summaryUrl: e.target.value })} /></label>
          <IntegrationModelField
            label="Summary model"
            kind="summary"
            value={draft.summaryModel}
            models={summaryModels}
            loading={summaryModelsLoading}
            error={summaryModelsError}
            source={summaryModelSource}
            onRefresh={() => void refreshSummaryModels()}
            onChange={(summaryModel) => setDraft({ ...draft, summaryModel })}
          />
          <label>Geocoder URL<input value={draft.geocoderUrl ?? ""} onChange={(e) => setDraft({ ...draft, geocoderUrl: e.target.value })} /></label>
          <label>Site filter<input value={draft.siteFilter ?? ""} onChange={(e) => setDraft({ ...draft, siteFilter: e.target.value })} placeholder="e.g. black river falls" /></label>
        </div>
        {draft.aiProfile && <p className="pane-desc">ASR profile (auto): {draft.aiProfile}</p>}
        {status && <p className="warning">{status}</p>}
        <div className="btn-row">
          <button type="button" className="primary-btn" onClick={finish}>Finish setup</button>
          <button type="button" onClick={onDismiss}>Skip for now</button>
        </div>
      </div>
    </div>
  );
}
