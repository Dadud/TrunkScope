import { useEffect, useMemo, useState } from "react";
import { getSnapshot, subscribeToCalls } from "./api";
import { formatElapsed, formatFrequency, signalQuality } from "./format";
import { MapPanel } from "./MapPanel";
import type { Call, Snapshot } from "./types";

const empty: Snapshot = { receivers: [], calls: [], publicPolicy: { enabled: false, delaySeconds: 120, allowedTalkgroups: [], exposeTranscripts: false, exposeRadioIds: false, exposePreciseLocations: false } };

function Icon({ name }: { name: string }) {
  const paths: Record<string, string> = { live: "M4 12h3l2-6 4 13 3-9 2 2h2", map: "M4 6l5-2 6 2 5-2v14l-5 2-6-2-5 2z", radio: "M5 8h14v11H5zM8 4l8 4M9 14h.01M13 14h4", archive: "M4 7h16v13H4zM2 3h20v4H2z", gear: "M12 8a4 4 0 100 8 4 4 0 000-8z" };
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d={paths[name]} /></svg>;
}

export default function App() {
  const [data, setData] = useState<Snapshot>(empty);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string>();
  const [selected, setSelected] = useState<string>();

  useEffect(() => {
    const controller = new AbortController();
    getSnapshot(controller.signal).then(setData).catch((cause: Error) => setError(cause.message));
    const unsubscribe = subscribeToCalls((event) => {
      setData((current) => ({ ...current, calls: [event.payload, ...current.calls.filter((call) => call.id !== event.payload.id)].slice(0, 100) }));
    }, setConnected);
    return () => { controller.abort(); unsubscribe(); };
  }, []);

  const active = data.calls.filter((call) => call.state === "active");
  const receiver = data.receivers[0];
  const selectedCall = data.calls.find((call) => call.id === selected) ?? active[0] ?? data.calls[0];
  const categories = useMemo(() => new Set(data.calls.map((call) => call.category)).size, [data.calls]);

  return <div className="shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark">⌁</span><span>TRUNKSCOPE</span></div>
      <nav>
        <button className="active"><Icon name="live" /><span>Live console</span><b>{active.length}</b></button>
        <button><Icon name="map" /><span>Map</span></button>
        <button><Icon name="radio" /><span>Receivers</span></button>
        <button><Icon name="archive" /><span>Call archive</span></button>
      </nav>
      <div className="side-bottom">
        <div className="privacy"><span>Public feed</span><strong>{data.publicPolicy.enabled ? "ENABLED" : "PRIVATE"}</strong></div>
        <button><Icon name="gear" /><span>Administration</span></button>
        <div className="profile"><span>OS</span><div><strong>Administrator</strong><small>Local appliance</small></div></div>
      </div>
    </aside>

    <main>
      <header>
        <div><p className="eyebrow">MONITORING</p><h1>Live console</h1></div>
        <div className={`connection ${connected ? "online" : ""}`}><i />{connected ? "RF LINK ONLINE" : "CONNECTING"}</div>
      </header>
      {error && <div className="notice">API unavailable: {error}. Start the Rust control plane to receive simulated traffic.</div>}

      <section className="metrics">
        <article><small>ACTIVE CALLS</small><strong>{active.length.toString().padStart(2, "0")}</strong><span className="lime">Live now</span></article>
        <article><small>RECEIVER SIGNAL</small><strong>{receiver ? `${receiver.health.signalDbfs.toFixed(1)}` : "—"}<em> dBFS</em></strong><div className="meter"><i style={{ width: `${receiver ? signalQuality(receiver.health.signalDbfs) : 0}%` }} /></div></article>
        <article><small>CALLS CAPTURED</small><strong>{data.calls.length}</strong><span>Current session</span></article>
        <article><small>CATEGORIES</small><strong>{categories}</strong><span>Detected</span></article>
      </section>

      <section className="workspace">
        <div className="map-card">
          <div className="panel-title"><div><small>INCIDENT VIEW</small><h2>Activity map</h2></div><span className="chip">{data.calls.filter((c) => c.location).length} located</span></div>
          <MapPanel calls={data.calls} />
          <div className="map-legend"><span><i className="active-dot" /> Active</span><span><i /> Recent</span></div>
        </div>

        <div className="call-card">
          <div className="panel-title"><div><small>NOW PLAYING</small><h2>{selectedCall?.talkgroupLabel ?? "Waiting for traffic"}</h2></div>{selectedCall && <span className={`state ${selectedCall.state}`}>{selectedCall.state}</span>}</div>
          {selectedCall ? <>
            <div className="waveform" aria-label="Audio waveform">{Array.from({ length: 38 }, (_, i) => <i key={i} style={{ height: `${18 + ((i * 17) % 58)}%` }} />)}</div>
            <div className="call-facts"><span><small>FREQUENCY</small>{formatFrequency(selectedCall.frequencyHz)}</span><span><small>TALKGROUP</small>{selectedCall.talkgroupId}</span><span><small>DURATION</small>{formatElapsed(selectedCall.startedAt, selectedCall.endedAt)}</span></div>
            <div className="transcript"><small>TRANSCRIPT</small><p>{selectedCall.transcript ?? "Listening… transcription will appear when the call completes."}</p>{selectedCall.summary && <blockquote>{selectedCall.summary}</blockquote>}</div>
            <div className="controls"><button className="round">Ⅱ</button><div className="timeline"><i style={{ width: selectedCall.state === "active" ? "64%" : "100%" }} /></div><button className="outline">HOLD TG</button><button className="outline">SKIP</button></div>
          </> : <div className="empty-state">The receiver is quiet. Live calls will appear here.</div>}
        </div>
      </section>

      <section className="feed">
        <div className="panel-title"><div><small>EVENT STREAM</small><h2>Recent calls</h2></div><button className="filter">All categories⌄</button></div>
        <div className="feed-head"><span>TIME</span><span>TALKGROUP</span><span>CATEGORY</span><span>FREQUENCY</span><span>SIGNAL</span><span>STATUS</span></div>
        {data.calls.slice(0, 6).map((call: Call) => <button className={`feed-row ${call.id === selectedCall?.id ? "selected" : ""}`} key={call.id} onClick={() => setSelected(call.id)}>
          <span>{new Date(call.startedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span><strong>{call.talkgroupLabel}<small>TG {call.talkgroupId}</small></strong><span><mark>{call.category}</mark></span><span>{formatFrequency(call.frequencyHz)}</span><span className="signal">▂▄▆█ <small>{call.signalDbfs.toFixed(0)} dB</small></span><span className={`state ${call.state}`}>{call.state}</span>
        </button>)}
      </section>
    </main>
  </div>;
}
