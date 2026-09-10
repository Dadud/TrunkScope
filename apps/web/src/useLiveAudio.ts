import { useEffect, useRef, useState } from "react";
import { callAudioUrl } from "./api";
import type { Call } from "./types";

const playable = (call: Call) => call.encryption === "clear" && call.state === "complete" && Boolean(call.audio);

/** Plays finalized calls once, in order, without interrupting the current call. */
export function useLiveAudio(calls: Call[], enabled: boolean, volume: number) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const seen = useRef(new Set<string>());
  const queue = useRef<string[]>([]);
  const started = useRef(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const player = new Audio();
    player.preload = "auto";
    audio.current = player;
    const next = () => {
      const id = queue.current.shift();
      if (!id) return;
      player.src = callAudioUrl(id);
      player.load?.();
      void player.play().catch(() => {
        queue.current = [];
        setError("Playback was blocked. Toggle autoplay to retry, or play a call manually.");
      });
    };
    player.onended = next;
    player.onerror = () => {
      setError("A recording could not be played.");
      next();
    };
    return () => {
      player.onended = null;
      player.onerror = null;
      player.pause();
      audio.current = null;
    };
  }, []);

  useEffect(() => {
    if (audio.current) audio.current.volume = Math.max(0, Math.min(1, volume));
  }, [volume]);

  useEffect(() => {
    const ready = calls.filter(playable);
    if (!enabled || !started.current) {
      seen.current = new Set(ready.map((call) => call.id));
      queue.current = [];
      audio.current?.pause();
      started.current = enabled;
      setError("");
      return;
    }
    const incoming = ready.filter((call) => !seen.current.has(call.id))
      .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
    incoming.forEach((call) => seen.current.add(call.id));
    queue.current.push(...incoming.map((call) => call.id));
    // Keep bounded state even when the console runs for days.
    if (seen.current.size > 2000) {
      const visible = new Set(ready.map((call) => call.id));
      const recent = [...seen.current].slice(-1000);
      seen.current = new Set([...visible, ...recent]);
    }
    queue.current = queue.current.slice(-50);
    const player = audio.current;
    if (player && (player.paused || player.ended) && queue.current.length) {
      player.src = callAudioUrl(queue.current.shift()!);
      player.load?.();
      void player.play().catch(() => {
        queue.current = [];
        setError("Playback was blocked. Toggle autoplay to retry, or play a call manually.");
      });
    }
  }, [calls, enabled]);

  return error;
}
