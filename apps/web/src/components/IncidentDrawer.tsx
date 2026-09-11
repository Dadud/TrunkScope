import { useMemo, useState } from "react";
import type { IncidentView } from "../api";

export function IncidentDrawer({ isOpen, incidents, onClose, onSelectCall }: { isOpen: boolean; incidents: IncidentView[]; onClose: () => void; onSelectCall: (id: string) => void }) {
  const [filter, setFilter] = useState("all");
  const visible = useMemo(() => filter === "all" ? incidents : incidents.filter((item) => item.category.toLowerCase().includes(filter)), [filter, incidents]);
  if (!isOpen) return null;
  return <aside className="drawer incident-drawer" aria-label="Incidents">
    <div className="drawer-header"><div><span className="eyebrow">OPERATOR VIEW</span><h2>Incidents</h2></div><button type="button" onClick={onClose} aria-label="Close incidents">×</button></div>
    <p className="settings-help">Grouped activity from completed calls, newest first.</p>
    <div className="incident-filters">{["all", "fire", "ems", "law", "traffic"].map((item) => <button type="button" className={filter === item ? "active" : ""} key={item} onClick={() => setFilter(item)}>{item}</button>)}</div>
    {!visible.length ? <p>No incidents match this filter.</p> : visible.map((incident) => <button className="incident-drawer-row" type="button" key={incident.id} onClick={() => incident.callIds[0] && onSelectCall(incident.callIds[0])}><strong>{incident.category}</strong><span>{incident.headline}</span><small>{incident.location?.label ?? "Location unavailable"} · {incident.callIds.length} calls · {incident.confidenceState}</small></button>)}
  </aside>;
}
