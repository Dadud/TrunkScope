import { useEffect, useState } from "react";
import { changePassword, getSnapshot, getRuntime, getDiagnostics, getSettings, saveSettings, getScanLists, receiverAction, saveScanList, type AppSettings, type Diagnostics, type ScanList, type RuntimeStatus } from "./api";
import type { Call, Receiver } from "./types";
import { TalkgroupImportControl } from "./TalkgroupImport";

const asrModels: Record<string, string> = { "cpu-faster-whisper-small": "Systran/faster-distil-whisper-small.en", "cpu-whispercpp": "ggml-base.en", "gpu-faster-whisper": "Systran/faster-whisper-large-v3-turbo", "gpu-parakeet": "nvidia/parakeet-tdt-1.1b-v2", "gpu-qwen3": "Qwen/Qwen3-ASR-1.7B", "experimental-radio": "chrullis/qwen3-asr-radio-1.7b" };

function AsrProfileControl() {
  const [settings, setSettings] = useState<AppSettings>();
  const [message, setMessage] = useState("");
  useEffect(() => { getSettings().then(setSettings).catch(() => undefined); }, []);
  if (!settings) return null;
  const update = (patch: Partial<AppSettings>) => setSettings((current) => current ? { ...current, ...patch } : current);
  const save = async () => { try { setSettings(await saveSettings(settings)); setMessage("ASR settings saved; restart AI workers to apply"); } catch (error) { setMessage(error instanceof Error ? error.message : "ASR settings failed"); } };
  return <div className="integration-card asr-profile-card"><small>LOCAL TRANSCRIPTION</small><label>Profile<select value={settings.aiProfile} onChange={(event) => { const profile = event.target.value; update({ aiProfile: profile, transcribeModel: asrModels[profile] ?? settings.transcribeModel }); }}><option value="cpu-faster-whisper-small">CPU · faster-whisper small</option><option value="cpu-whispercpp">CPU · whisper.cpp</option><option value="gpu-faster-whisper">NVIDIA GPU · faster-whisper turbo</option><option value="gpu-parakeet">NVIDIA GPU · Parakeet</option><option value="gpu-qwen3">GPU · Qwen3-ASR</option><option value="experimental-radio">Experimental · radio-tuned Qwen3</option></select></label><label>Endpoint<input value={settings.transcribeUrl} onChange={(event) => update({ transcribeUrl: event.target.value })} /></label><label className="check"><input type="checkbox" checked={settings.vadEnabled} onChange={(event) => update({ vadEnabled: event.target.checked })} /> VAD silence filtering</label><button className="primary" onClick={() => void save()}>SAVE ASR</button>{message && <span>{message}</span>}</div>;
}

function PasswordControl() {
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const save = async () => { try { await changePassword(username, password); setPassword(""); setMessage("Password changed"); } catch (error) { setMessage(error instanceof Error ? error.message : "Password change failed"); } };
  return <div className="integration-card"><small>ADMINISTRATOR CREDENTIALS</small><label>Username<input value={username} onChange={(event) => setUsername(event.target.value)} /></label><label>New password<input type="password" minLength={12} value={password} onChange={(event) => setPassword(event.target.value)} /></label><button className="primary" onClick={() => void save()}>ROTATE PASSWORD</button>{message && <span>{message}</span>}</div>;
}

export function OperatorOverlay() {
  const [open, setOpen] = useState(false);
  const [receiver, setReceiver] = useState<Receiver>();
  const [latestCall, setLatestCall] = useState<Call>();
  const [scanLists, setScanLists] = useState<ScanList[]>([]);
  const [activeScan, setActiveScan] = useState<string>();
  const [message, setMessage] = useState("");
  const [editing, setEditing] = useState<ScanList>();
  const [runtime, setRuntime] = useState<RuntimeStatus>();
  const [diagnostics, setDiagnostics] = useState<Diagnostics>();
  const [policy, setPolicy] = useState({ enabled: false, delaySeconds: 120, allowedTalkgroups: [] as string[], exposeTranscripts: false, exposeRadioIds: false, exposePreciseLocations: false });
  const [policyOpen, setPolicyOpen] = useState(false);
  const [discordConfigured, setDiscordConfigured] = useState(false);
  const [geocoderConfigured, setGeocoderConfigured] = useState(false);

  const refresh = async () => {
    try {
      const snapshot = await getSnapshot();
      setReceiver(snapshot.receivers[0]);
      setLatestCall(snapshot.calls.find((call) => call.audio && call.encryption === "clear"));
      setPolicy({ ...snapshot.publicPolicy, allowedTalkgroups: snapshot.publicPolicy.allowedTalkgroups ?? [] });
    } catch { /* main app reports API failures */ }
    try { setRuntime(await getRuntime()); } catch { /* diagnostics are optional */ }
    try { setDiagnostics(await getDiagnostics()); } catch { /* diagnostics are optional */ }
    try {
      setScanLists(await getScanLists());
    } catch { /* optional feature */ }
    try { const response = await fetch("/api/v1/integrations/discord"); if (response.ok) setDiscordConfigured(Boolean((await response.json()).configured)); } catch { /* optional integration */ }
    try { const response = await fetch("/api/v1/integrations/geocoder"); if (response.ok) setGeocoderConfigured(Boolean((await response.json()).configured)); } catch { /* optional integration */ }
  };
  useEffect(() => { void refresh(); const timer = window.setInterval(() => void refresh(), 3000); return () => window.clearInterval(timer); }, []);

  const action = async (name: "probe" | "start" | "stop" | "restart") => {
    if (!receiver) return;
    try { setReceiver(await receiverAction(receiver.id, name)); setMessage(`Receiver ${name} requested`); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Receiver action failed"); }
  };
  const toggleScan = async (list: ScanList) => {
    const actionName = activeScan === list.id ? "stop" : "start";
    const response = await fetch(`/api/v1/scan-lists/${list.id}/${actionName}`, { method: "POST", credentials: "include" });
    if (response.ok) { setActiveScan(actionName === "start" ? list.id : undefined); setMessage(`Scan ${actionName} requested`); }
    else setMessage(response.status === 401 ? "Administrator login required" : "Scan action failed");
  };
  const updateEditing = (patch: Partial<ScanList>) => setEditing((current) => current ? { ...current, ...patch } : current);
  const addChannel = () => setEditing((current) => current ? { ...current, channels: [...current.channels, { id: crypto.randomUUID(), name: "New channel", frequencyHz: 155550000, modulation: "NFM", bandwidthHz: 12500, squelchDb: -65, tone: undefined, toneRequired: false, dwellMs: 2500, priority: 0, lockedOut: false }] } : current);
  const saveEditing = async () => { if (!editing) return; try { const saved = await saveScanList(editing); setScanLists((items) => [...items.filter((item) => item.id !== saved.id), saved]); setEditing(undefined); setMessage("Scan list saved"); } catch (error) { setMessage(error instanceof Error ? error.message : "Scan list save failed"); } };
  const savePolicy = async () => { const response = await fetch("/api/v1/public-policy", { method: "PUT", headers: { "content-type": "application/json" }, credentials: "include", body: JSON.stringify(policy) }); setMessage(response.ok ? "Public policy saved" : response.status === 400 ? "Enable requires at least one allowed talkgroup" : "Public policy save failed"); };
  const testDiscord = async () => { const response = await fetch("/api/v1/integrations/discord/test", { method: "POST", credentials: "include" }); setMessage(response.ok ? "Discord test delivered" : response.status === 501 ? "Discord webhook is not configured" : "Discord test failed"); };
  return <div className={`operator-overlay ${open ? "open" : "closed"}`} aria-label="Operator controls"><button className="operator-toggle" onClick={() => setOpen((value) => !value)} aria-expanded={open}>{open ? "HIDE TOOLS" : "TOOLS"}</button>{open && <div className="operator-content"><TalkgroupImportControl />
    {receiver && <div><small>RECEIVER CONTROL</small><strong>{receiver.label}</strong><span className={`state ${receiver.state}`}>{receiver.state}</span><div className="operator-actions"><button onClick={() => void action("probe")}>PROBE</button><button onClick={() => void action("start")}>START</button><button onClick={() => void action("stop")}>STOP</button><button onClick={() => void action("restart")}>RESTART</button></div></div>}
    {scanLists.length > 0 && <div><small>SCAN LIST</small><select value={activeScan ?? ""} onChange={(event) => { const list = scanLists.find((item) => item.id === event.target.value); if (list) void toggleScan(list); }}><option value="">Select scan list</option>{scanLists.map((list) => <option key={list.id} value={list.id}>{activeScan === list.id ? "Stop · " : "Start · "}{list.name}</option>)}</select><button className="operator-edit" onClick={() => setEditing(scanLists.find((list) => list.id === (activeScan ?? scanLists[0].id)))}>EDIT CHANNELS</button></div>}
    {latestCall?.audio && <div><small>LATEST CLEAR AUDIO</small><strong>{latestCall.talkgroupLabel}</strong><audio className="call-audio" controls preload="metadata" src={`/api/v1/audio/${latestCall.id}`} /></div>}
    {message && <em>{message}</em>}
    <div className="integration-card"><small>DISCORD</small><span>{discordConfigured ? "Webhook configured · finalized summaries" : "Not configured · no notifications"}</span>{discordConfigured && <button onClick={() => void testDiscord()}>SEND TEST</button>}</div>
    <div className="integration-card"><small>LOCATION ENRICHMENT</small><span>{geocoderConfigured ? "Geocoder configured · transcript hints enriched" : "Local evidence only · operator confirmation available"}</span></div>
    <AsrProfileControl />
    <PasswordControl />
    {runtime && <div className="runtime-diagnostics"><small>RUNTIME</small><span>RF capture {diagnostics?.capture.state ?? (runtime.receiverStates?.[0] ?? "unknown")}</span><span>Storage {runtime.storageHealthy ? "healthy" : "unavailable"}</span><span>Persistence {runtime.persistenceConnected ? "PostgreSQL" : "file fallback"}</span><span>Queue {runtime.queueBacklog ?? 0}</span><span>P25 decoder {diagnostics?.decoder.state ?? (runtime.decoderConnected ? "connected" : "offline")}</span><span>Control lock {diagnostics?.decoderControlLockAgeSeconds == null ? "not observed" : `${diagnostics.decoderControlLockAgeSeconds}s ago`}</span><span>Recording {diagnostics?.recording.state ?? "unknown"}</span><span>Ingestion {diagnostics?.ingestion.state ?? "unknown"}</span><span>AI {runtime.aiWorkerStatus ?? (runtime.aiEnabled ? "starting" : "disabled")}</span>{diagnostics?.imageVersion && <span>Image {diagnostics.imageVersion}</span>}{diagnostics?.simulated && <span className="simulated-badge">SIMULATED MODE</span>}{diagnostics?.failureReason && <span className="failure-detail">{diagnostics.failureReason}</span>}{diagnostics?.aiFailureReason && <span className="failure-detail">AI: {diagnostics.aiFailureReason}</span>}</div>}
    <div className="policy-editor"><button className="operator-edit" onClick={() => setPolicyOpen((open) => !open)}>{policyOpen ? "HIDE PUBLIC POLICY" : "EDIT PUBLIC POLICY"}</button>{policyOpen && <div className="scan-editor"><small>PUBLIC FEED POLICY</small><label><input type="checkbox" checked={policy.enabled} onChange={(event) => setPolicy({ ...policy, enabled: event.target.checked })} /> Enable delayed feed</label><label>Delay (seconds)<input inputMode="numeric" value={policy.delaySeconds} onChange={(event) => setPolicy({ ...policy, delaySeconds: Number(event.target.value) })} /></label><label>Allowed talkgroup UUIDs<input placeholder="Comma-separated UUIDs" value={policy.allowedTalkgroups.join(", ")} onChange={(event) => setPolicy({ ...policy, allowedTalkgroups: event.target.value.split(",").map((value) => value.trim()).filter(Boolean) })} /></label><label><input type="checkbox" checked={policy.exposeTranscripts} onChange={(event) => setPolicy({ ...policy, exposeTranscripts: event.target.checked })} /> Expose transcripts</label><label><input type="checkbox" checked={policy.exposeRadioIds} onChange={(event) => setPolicy({ ...policy, exposeRadioIds: event.target.checked })} /> Expose radio IDs</label><label><input type="checkbox" checked={policy.exposePreciseLocations} onChange={(event) => setPolicy({ ...policy, exposePreciseLocations: event.target.checked })} /> Expose precise locations</label><button className="primary" onClick={() => void savePolicy()}>SAVE PUBLIC POLICY</button></div>}</div>
    {editing && <div className="scan-editor"><small>EDIT SCAN LIST</small><input value={editing.name} onChange={(event) => updateEditing({ name: event.target.value })} /><label><input type="checkbox" checked={editing.pauseOnActivity} onChange={(event) => updateEditing({ pauseOnActivity: event.target.checked })} /> Pause on activity</label>{editing.channels.map((channel, index) => <div className="scan-channel" key={channel.id}><input aria-label="Channel name" value={channel.name} onChange={(event) => updateEditing({ channels: editing.channels.map((item, i) => i === index ? { ...item, name: event.target.value } : item) })} /><input aria-label="Frequency" inputMode="numeric" value={channel.frequencyHz} onChange={(event) => updateEditing({ channels: editing.channels.map((item, i) => i === index ? { ...item, frequencyHz: Number(event.target.value) } : item) })} /><input aria-label="Squelch" inputMode="decimal" value={channel.squelchDb} onChange={(event) => updateEditing({ channels: editing.channels.map((item, i) => i === index ? { ...item, squelchDb: Number(event.target.value) } : item) })} /><input aria-label="Tone" placeholder="CTCSS/DCS" value={channel.tone ?? ""} onChange={(event) => updateEditing({ channels: editing.channels.map((item, i) => i === index ? { ...item, tone: event.target.value || undefined } : item) })} /><label><input type="checkbox" checked={channel.toneRequired} onChange={(event) => updateEditing({ channels: editing.channels.map((item, i) => i === index ? { ...item, toneRequired: event.target.checked } : item) })} /> Tone required</label><button onClick={() => updateEditing({ channels: editing.channels.filter((_, i) => i !== index) })}>REMOVE</button></div>)}<button onClick={addChannel}>ADD CHANNEL</button><button className="primary" onClick={() => void saveEditing()}>SAVE SCAN LIST</button></div>}
  </div>}</div>;
}
