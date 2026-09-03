import { useState, type ChangeEvent } from "react";
import { importTalkgroups } from "./api";

type Preview = { valid: boolean; rows: number; sample: Array<{ raw: string }>; requiresConfirmation: boolean };

export function TalkgroupImportControl() {
  const [file, setFile] = useState<File>();
  const [preview, setPreview] = useState<Preview>();
  const [status, setStatus] = useState("");
  const inspect = async (event: ChangeEvent<HTMLInputElement>) => {
    const selected = event.target.files?.[0]; if (!selected) return;
    setFile(selected); setStatus("Validating import…");
    try { const response = await fetch("/api/v1/imports/talkgroups/preview", { method: "POST", headers: { "content-type": "text/csv" }, credentials: "include", body: selected }); if (!response.ok) throw new Error(response.status === 401 ? "Administrator login required" : "Invalid talkgroup CSV"); setPreview(await response.json() as Preview); setStatus("Preview ready; review before applying"); }
    catch (error) { setPreview(undefined); setStatus(error instanceof Error ? error.message : "Preview failed"); }
    finally { event.target.value = ""; }
  };
  const apply = async () => { if (!file || !preview?.valid) return; try { const result = await importTalkgroups(file); setStatus(`${result.rows} talkgroups imported and decoder configuration regenerated`); setPreview(undefined); setFile(undefined); } catch (error) { setStatus(error instanceof Error ? error.message : "Talkgroup import failed"); } };
  return <div className="talkgroup-import"><small>TALKGROUP DATABASE</small><label className="operator-edit">PREVIEW CSV<input type="file" accept=".csv,text/csv" hidden onChange={(event) => void inspect(event)} /></label>{preview && <div className="import-preview"><strong>{preview.valid ? `${preview.rows} rows validated` : "Import rejected"}</strong>{preview.sample.slice(0, 3).map((row, index) => <code key={index}>{row.raw}</code>)}{preview.valid && <button className="primary" onClick={() => void apply()}>APPLY IMPORT</button>}</div>}{status && <em>{status}</em>}</div>;
}
