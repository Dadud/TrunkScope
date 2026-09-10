import { useRef, useState } from "react";
import { runAiTask } from "../api";

const tasks = [
  ["event-tagging", "Event categories"],
  ["unit-extraction", "Units and call signs"],
  ["address-normalization", "Addresses"],
  ["correlation", "Incident references"],
] as const;

export function EnrichmentActions() {
  const pending = useRef(false);
  const [running, setRunning] = useState<string>();
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  async function run(task: string, name: string) {
    if (pending.current) return;
    pending.current = true;
    setRunning(task);
    setFailed(false);
    setMessage(`Running ${name.toLowerCase()}… This may take several minutes.`);
    try {
      const result = await runAiTask(task);
      setMessage(`${name}: batch finished for ${result.processed} calls. Check call details for individual results or failures.`);
    } catch (error) {
      setFailed(true);
      setMessage(error instanceof Error ? error.message : "Enrichment request failed");
    } finally {
      pending.current = false;
      setRunning(undefined);
    }
  }
  return <section className="config-section" aria-label="Run enrichment now">
    <h4>Run enrichment now</h4>
    <p className="pane-desc">Uses saved settings. Results stay attached to calls; a finished batch can contain individual failures.</p>
    <div className="btn-row">{tasks.map(([task, name]) => <button key={task} type="button" disabled={!!running} onClick={() => void run(task, name)}>{running === task ? `Running ${name.toLowerCase()}…` : name}</button>)}</div>
    {message && <p role={failed ? "alert" : "status"}>{message}</p>}
  </section>;
}
