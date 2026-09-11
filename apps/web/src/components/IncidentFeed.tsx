import type { IncidentView } from "../api";

type Props = { incidents: IncidentView[]; onSelectCall: (id: string) => void };

export function IncidentFeed({ incidents, onSelectCall }: Props) {
  if (!incidents.length) return <section className="incident-feed"><div className="incident-feed-empty">No incidents detected yet</div></section>;
  return <section className="incident-feed" aria-label="Recent incidents">
    <div className="incident-feed-header"><span>INCIDENTS</span><span>{incidents.length}</span></div>
    {incidents.slice(0, 8).map((incident) => <button className="incident-card" key={incident.id} onClick={() => incident.callIds[0] && onSelectCall(incident.callIds[0])} type="button">
      <div className="incident-card-top"><strong>{incident.category || "Other"}</strong><span className={`confidence-badge ${incident.confidenceState}`}>{incident.confidenceState}</span></div>
      <div className="incident-headline">{incident.headline}</div>
      {incident.location && <div className="incident-location">⌖ {incident.location.label}</div>}
      <div className="incident-meta">{incident.callIds.length} call{incident.callIds.length === 1 ? "" : "s"}{incident.units.length ? ` · ${incident.units.slice(0, 3).join(", ")}` : ""}</div>
    </button>)}
  </section>;
}
