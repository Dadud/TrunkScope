import { afterEach, expect, it, vi } from "vitest";
import { getAuthStatus, getSession } from "./api";
afterEach(() => vi.unstubAllGlobals());

it("treats only an unauthorized response as a missing session", async () => {
  const fetch = vi.fn().mockResolvedValueOnce(new Response(null, { status: 401 })).mockResolvedValueOnce(new Response(null, { status: 503 }));
  vi.stubGlobal("fetch", fetch);
  expect(await getSession()).toBeUndefined();
  await expect(getSession()).rejects.toThrow("Session check failed (503)");
});

it("passes startup cancellation through both auth requests", async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ enabled: true }), { status: 200 }));
  vi.stubGlobal("fetch", fetch);
  const controller = new AbortController();
  await getAuthStatus(controller.signal);
  expect(fetch).toHaveBeenCalledWith("/api/v1/auth/status", { signal: controller.signal });
  fetch.mockResolvedValue(new Response(null, { status: 401 }));
  await getSession(controller.signal);
  expect(fetch).toHaveBeenCalledWith("/api/v1/auth/me", { signal: controller.signal, credentials: "include" });
});
