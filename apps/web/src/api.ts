import type { CallEvent, Snapshot } from "./types";

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
