export const formatFrequency = (hz?: number): string => hz ? `${(hz / 1_000_000).toFixed(4)} MHz` : "—";

export const hzToMhz = (hz?: number): string => (hz && hz > 0 ? String(Number((hz / 1_000_000).toFixed(6))) : "");

export const mhzToHz = (mhz: string): number => {
  const value = Number(mhz);
  return Number.isFinite(value) && value > 0 ? Math.round(value * 1_000_000) : 0;
};

export function formatElapsed(startedAt: string, endedAt?: string): string {
  const end = endedAt ? new Date(endedAt).getTime() : Date.now();
  const seconds = Math.max(0, Math.round((end - new Date(startedAt).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

export const signalQuality = (dbfs: number): number => Math.max(0, Math.min(100, (dbfs + 70) * 2));
