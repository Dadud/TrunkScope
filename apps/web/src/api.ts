import type { CallEvent, Snapshot } from "./types";

export type AuthStatus = { enabled: boolean };
export type Session = { username: string; role: string };
export async function getAuthStatus(): Promise<AuthStatus> { const response = await fetch("/api/v1/auth/status"); if (!response.ok) throw new Error(`API returned ${response.status}`); return response.json() as Promise<AuthStatus>; }
export async function login(username: string, password: string): Promise<Session> { const response = await fetch("/api/v1/auth/login", { method: "POST", headers: { "content-type": "application/json" }, credentials: "include", body: JSON.stringify({ username, password }) }); if (!response.ok) throw new Error(response.status === 401 ? "Invalid username or password" : `Login unavailable (${response.status})`); return response.json() as Promise<Session>; }
export async function getSession(): Promise<Session | undefined> { const response = await fetch("/api/v1/auth/me", { credentials: "include" }); return response.ok ? response.json() as Promise<Session> : undefined; }

export type SystemProfile = { id: string; name: string; protocol: string; controlChannelHz?: number; nac?: number; frequencyHz?: number; bandwidthHz?: number; modulation?: string; squelchDb?: number; tone?: string; deviationHz?: number; stepHz?: number; dwellMs?: number };
export async function getSystems(): Promise<SystemProfile[]> { const response = await fetch("/api/v1/systems"); if (!response.ok) throw new Error(`API returned ${response.status}`); return response.json() as Promise<SystemProfile[]>; }
export async function saveSystem(profile: Omit<SystemProfile, "id"> & { id?: string }): Promise<SystemProfile> {
  const response = await fetch("/api/v1/systems", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: profile.id ?? "00000000-0000-0000-0000-000000000000", ...profile }) });
  if (!response.ok) throw new Error(`API returned ${response.status}`);
  return response.json() as Promise<SystemProfile>;
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
