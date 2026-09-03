import { useEffect, useState } from "react";
import { confirmSessionLocation, conversationAudioUrl, type ConversationSession } from "./api";

export function SessionPanel() {
  const [sessions, setSessions] = useState<ConversationSession[]>([]);
  const [editing, setEditing] = useState<string>();
  const [form, setForm] = useState({ label: "", latitude: "44.3984", longitude: "-90.5785" });
  const [message, setMessage] = useState<string>();
  const load = () => fetch("/api/v1/operations/sessions").then((r) => r.ok ? r.json() : []).then((value: ConversationSession[]) => setSessions(value.slice(0, 3))).catch(() => undefined);
  useEffect(() => { load(); const timer = window.setInterval(load, 15000); return () => window.clearInterval(timer); }, []);
  if (!sessions.length) return null;
  const submit = async (id: string) => {
    try { await confirmSessionLocation(id, { label: form.label.trim() || "Operator-confirmed location", latitude: Number(form.latitude), longitude: Number(form.longitude), confidence: 1 }); setEditing(undefined); setMessage("Location confirmed"); await load(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Location update failed"); }
  };
  return <div className="session-panel"><div className="session-panel-title"><small>CONVERSATION SESSIONS</small><span>10-second dwell · merged playback</span></div>{message && <div className="notice">{message}</div>}{sessions.map((session) => <article className="session-row" key={session.id}><div className="session-copy"><strong>Talkgroup {session.talkgroupId}</strong><span>{session.callIds.length} transmission{session.callIds.length === 1 ? "" : "s"} · {session.state}</span>{session.location ? <em>⌖ {session.location.label} ({Math.round(session.location.confidence * 100)}%)</em> : <em className="location-muted">⌖ no confirmed location</em>}{session.summary && <p>{session.summary}</p>}{session.transcript && <details><summary>Chronological transcript</summary><p className="session-transcript">{session.transcript}</p></details>}{editing === session.id ? <div className="location-editor"><input aria-label="Location label" placeholder="Location label" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} /><input aria-label="Latitude" inputMode="decimal" value={form.latitude} onChange={(e) => setForm({ ...form, latitude: e.target.value })} /><input aria-label="Longitude" inputMode="decimal" value={form.longitude} onChange={(e) => setForm({ ...form, longitude: e.target.value })} /><button onClick={() => void submit(session.id)}>SAVE LOCATION</button><button className="quiet" onClick={() => setEditing(undefined)}>CANCEL</button></div> : <button className="quiet location-action" onClick={() => { setEditing(session.id); setMessage(undefined); }}>CONFIRM LOCATION</button>}</div><audio controls preload="none" src={conversationAudioUrl(session.id)} /></article>)}</div>;
}
