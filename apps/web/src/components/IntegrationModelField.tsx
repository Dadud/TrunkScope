import { useEffect, useState } from "react";
import { pickSummaryModel, pickTranscribeModel } from "../integrationModels";

type IntegrationModelFieldProps = {
  label: string;
  value: string;
  models: string[];
  loading: boolean;
  error?: string;
  source?: string;
  onChange: (model: string) => void;
  onRefresh: () => void;
  kind: "transcribe" | "summary";
};

export function IntegrationModelField({
  label,
  value,
  models,
  loading,
  error,
  source,
  onChange,
  onRefresh,
  kind,
}: IntegrationModelFieldProps) {
  const [manual, setManual] = useState(false);

  useEffect(() => {
    if (manual || models.length === 0) return;
    const next =
      kind === "transcribe"
        ? pickTranscribeModel(models, value)
        : pickSummaryModel(models, value);
    if (next && next !== value) {
      onChange(next);
    }
  }, [kind, manual, models, onChange, value]);

  return (
    <label>
      {label}
      <div className="btn-row">
        <button type="button" onClick={onRefresh} disabled={loading}>
          {loading ? "Discovering…" : "Discover models"}
        </button>
        {source && <span className="pane-desc">Catalog: {source}</span>}
      </div>
      {models.length > 0 && !manual ? (
        <select value={value} onChange={(event) => onChange(event.target.value)}>
          {models.map((model) => (
            <option key={model} value={model}>
              {model}
            </option>
          ))}
        </select>
      ) : (
        <input value={value} onChange={(event) => onChange(event.target.value)} />
      )}
      {models.length > 0 && (
        <button type="button" className="quiet-btn" onClick={() => setManual((current) => !current)}>
          {manual ? "Use discovered list" : "Enter model manually"}
        </button>
      )}
      {error && <span className="pane-desc warning">{error}</span>}
    </label>
  );
}
