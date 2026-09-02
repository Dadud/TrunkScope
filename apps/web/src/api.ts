import type { CallEvent, Snapshot } from "./types";

export type SystemProfile = { id: string; name: string; protocol: string; controlChannelHz?: number; nac?: number; frequencyHz?: number; bandwidthHz?: number; modulation?: string; squelchDb?: number; tone?: string };
export async function getSystems(): Promise<any[]> { const response = await fetch("/api/v1/systems"); if (!response.ok) throw new Error(`API returned ${response.status}`); return response.json() as Promise<any[]>; }
export async function saveSystem(profile: Omit<SystemProfile, "id"> & { id?: string }): Promise<{ id: string; name: string; protocol: string; controlChannelHz: number; nac?: number }> {
  const response = await fetch("/api/v1/systems", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: profile.id ?? "00000000-0000-0000-0000-000000000000", ...profile }) });
  if (!response.ok) throw new Error(`API returned ${response.status}`);
  return response.json() as Promise<{ id: string; name: string; protocol: string; controlChannelHz: number; nac?: number }>;
}

export async function getSnapshot(signal?: AbortSignal): Promise<Snapshot> {
  const response = await fetch("/api/v1/snapshot", { signal });
  if (!response.ok) throw new Error(`API returned ${response.status}`);
  return response.json() as Promise<Snapshot>;
}

export function subscribeToCalls(
  onEvent: (event: CallEvent) => void,
  onStatus: (connected: boolean) => void,
): () => void {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  const socket = new WebSocket(`${protocol}//${location.host}/api/v1/live`);
  socket.onopen = () => onStatus(true);
  socket.onclose = () => onStatus(false);
  socket.onerror = () => onStatus(false);
  socket.onmessage = (message) => {
    try { onEvent(JSON.parse(message.data as string) as CallEvent); } catch { /* ignore malformed events */ }
  };
  return () => socket.close();
}
