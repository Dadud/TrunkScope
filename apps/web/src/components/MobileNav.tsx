interface MobileNavProps {
  active: "operations" | "talkgroups" | "archive" | "appliance" | "settings" | "incidents" | null;
  onOpen: (drawer: "archive" | "appliance" | "settings" | "incidents" | null) => void;
}

export function MobileNav({ active, onOpen }: MobileNavProps) {
  const items = [
    { id: null, label: "Listen", icon: "⌂" },
    { id: "incidents" as const, label: "Incidents", icon: "⚠" },
    { id: "archive" as const, label: "Recordings", icon: "▣" },
    { id: "appliance" as const, label: "Radio Setup", icon: "◉" },
    { id: "settings" as const, label: "Settings", icon: "⚙" },
  ];
  return <nav className="mobile-bottom-nav" aria-label="Primary navigation">
    {items.map((item) => <button key={item.label} type="button" className={active === item.id ? "active" : ""} aria-current={active === item.id ? "page" : undefined} onClick={() => onOpen(item.id)}>
      <span aria-hidden="true">{item.icon}</span><small>{item.label}</small>
    </button>)}
  </nav>;
}
