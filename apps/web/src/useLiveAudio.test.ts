import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useLiveAudio } from "./useLiveAudio";
import type { Call } from "./types";

const call = (id: string, overrides: Partial<Call> = {}): Call => ({
  id, systemName: "Test", talkgroupId: 1, talkgroupLabel: "Dispatch", category: "Fire",
  frequencyHz: 154445000, startedAt: "2026-09-08T12:00:00Z", state: "complete",
  encryption: "clear", signalDbfs: -40,
  audio: { objectKey: `${id}.wav`, contentType: "audio/wav", durationMs: 5000 }, ...overrides,
});

function mockAudio() {
  const player = { src: "", volume: 1, paused: true, ended: false,
    onended: null as null | (() => void), onerror: null as null | (() => void),
    play: vi.fn(async () => { player.paused = false; }),
    pause: vi.fn(() => { player.paused = true; }),
  };
  vi.stubGlobal("Audio", vi.fn(function () { return player; }));
  return player;
}

afterEach(() => vi.unstubAllGlobals());

describe("live audio", () => {
  it("does not replay loaded archive calls after trimming playback history", async () => {
    const player = mockAudio();
    const archive = Array.from({ length: 2100 }, (_, index) => call(`archive-${index}`));
    const { rerender } = renderHook(({ calls }) => useLiveAudio(calls, true, 1), { initialProps: { calls: archive } });
    await act(async () => rerender({ calls: [...archive] }));
    await act(async () => rerender({ calls: [...archive] }));
    expect(player.play).not.toHaveBeenCalled();
  });
  it("plays an active call once when audio is finalized, queues later calls, and ignores enrichment", async () => {
    const player = mockAudio();
    const { rerender } = renderHook(({ calls }) => useLiveAudio(calls, true, 0.4), {
      initialProps: { calls: [call("a", { state: "active", audio: undefined })] },
    });
    await act(async () => rerender({ calls: [call("a")] }));
    expect(player.play).toHaveBeenCalledTimes(1);
    expect(player.src).toContain("a");
    await act(async () => rerender({ calls: [call("b"), call("a", { summary: "Updated" })] }));
    expect(player.play).toHaveBeenCalledTimes(1);
    await act(async () => player.onended?.());
    expect(player.play).toHaveBeenCalledTimes(2);
    expect(player.src).toContain("b");
  });

  it("skips archive audio and encrypted calls, updates volume, and stops when disabled", async () => {
    const player = mockAudio();
    const { rerender } = renderHook(({ calls, enabled, volume }) => useLiveAudio(calls, enabled, volume), {
      initialProps: { calls: [call("old")], enabled: true, volume: 0.7 },
    });
    expect(player.play).not.toHaveBeenCalled();
    await act(async () => rerender({ calls: [call("secret", { encryption: "encrypted" }), call("new")], enabled: true, volume: 0 }));
    expect(player.play).toHaveBeenCalledTimes(1);
    expect(player.volume).toBe(0);
    await act(async () => rerender({ calls: [call("new")], enabled: false, volume: 0 }));
    expect(player.paused).toBe(true);
  });
});
