import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ArchiveDrawer } from "./ArchiveDrawer";
import { purgeCalls, undoPurgeCalls, retryCallEnrichment } from "../api";
import type { Call } from "../types";

vi.mock("../api", () => ({ callAudioUrl: () => "", purgeCalls: vi.fn(), undoPurgeCalls: vi.fn(), retryCallEnrichment: vi.fn() }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
const call = { id: "one", talkgroupLabel: "Test channel", category: "FM", startedAt: "2026-09-03T12:00:00Z", state: "complete", encryption: "clear", transcript: "Engine 4 responding", frequencyHz: 154000000, summary: "Old summary" } as Call;

it("does not offer retries for encrypted calls or unsupported tasks", () => {
  render(<ArchiveDrawer isOpen onClose={() => {}} onSelectCall={() => {}} calls={[
    { ...call, encryption: "encrypted", enrichment: { "unit-extraction": { status: "failed" } } },
    { ...call, id: "tone", enrichment: { "tone-classification": { status: "skipped" } } },
  ]} />);
  expect(screen.queryByRole("button", { name: "Retry", hidden: true })).toBeNull();
});

it("explains failed and skipped enrichment tasks", () => {
  render(<ArchiveDrawer isOpen onClose={() => {}} onSelectCall={() => {}} calls={[{ ...call, enrichment: {
    "unit-extraction": { status: "failed", error: "invalid-output", detail: "Expected a JSON object" },
    "tone-classification": { status: "skipped", reason: "Audio analysis unavailable" },
  } }]} />);
  expect(screen.getByRole("alert", { hidden: true }).textContent).toBe("invalid-output: Expected a JSON object");
  expect(screen.getByText("Audio analysis unavailable")).toBeTruthy();
});

it("bulk deletion respects search results and excludes active calls", async () => {
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
  vi.mocked(purgeCalls).mockResolvedValue({ removed: 1 });
  const recent = { ...call, startedAt: new Date().toISOString() };
  render(<ArchiveDrawer isOpen onClose={() => {}} onSelectCall={() => {}} calls={[recent, { ...recent, id: "other", talkgroupLabel: "Other channel", frequencyHz: 155000000 }, { ...recent, id: "active", state: "active" }]} />);
  fireEvent.change(screen.getByRole("textbox", { name: "Search recordings" }), { target: { value: "154.0000" } });
  fireEvent.click(screen.getByRole("button", { name: "Purge matching calls" }));
  await waitFor(() => expect(purgeCalls).toHaveBeenCalledWith({ callIds: ["one"], deleteAudio: true }));
  expect(screen.getByText("Test channel")).toBeTruthy();
  confirm.mockRestore();
});

it("undoing a metadata purge does not restore earlier audio deletions", async () => {
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
  vi.mocked(purgeCalls).mockResolvedValue({ removed: 1 });
  vi.mocked(undoPurgeCalls).mockResolvedValue({ removed: 1 });
  const recent = { ...call, startedAt: new Date().toISOString() };
  render(<ArchiveDrawer isOpen onClose={() => {}} onSelectCall={() => {}} calls={[recent, { ...recent, id: "two", talkgroupLabel: "Second channel" }]} />);
  fireEvent.click(screen.getByRole("button", { name: "Remove Test channel" }));
  await waitFor(() => expect(screen.queryByText("Test channel")).toBeNull());
  fireEvent.click(screen.getByRole("checkbox", { name: "Delete audio files too" }));
  fireEvent.click(screen.getByRole("button", { name: "Purge matching calls" }));
  await waitFor(() => expect(screen.queryByText("Second channel")).toBeNull());
  fireEvent.click(screen.getByRole("button", { name: "Undo purge" }));
  await screen.findByText("Second channel");
  expect(screen.queryByText("Test channel")).toBeNull();
  confirm.mockRestore();
});

it("finds recordings by MHz or Hz and trims search whitespace", () => {
  render(<ArchiveDrawer isOpen onClose={() => {}} onSelectCall={() => {}} calls={[call]} />);
  const search = screen.getByRole("textbox", { name: "Search recordings" });
  for (const value of [" 154.0000 ", "154000000", " test channel "]) {
    fireEvent.change(search, { target: { value } });
    expect(screen.getByText("Test channel")).toBeTruthy();
  }
  fireEvent.change(search, { target: { value: "155.5000" } });
  expect(screen.queryByText("Test channel")).toBeNull();
  expect(screen.getByText("No recordings match your filters.")).toBeTruthy();
});

it("keeps enrichment interactions in the archive and reports retry failures", async () => {
  const select = vi.fn();
  const close = vi.fn();
  vi.mocked(retryCallEnrichment).mockRejectedValue(new Error("Provider unavailable"));
  render(<ArchiveDrawer isOpen onClose={close} onSelectCall={select} calls={[{ ...call, location: { label: "Main Street" } as Call["location"], enrichment: { "unit-extraction": { status: "failed", evidence: [{ text: "Engine 4" }] } } }]} />);
  fireEvent.click(screen.getByText("AI enrichment (1 tasks)"));
  expect(screen.getByText("Engine 4")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Provider unavailable"));
  expect(select).not.toHaveBeenCalled();
  expect(close).not.toHaveBeenCalled();
  expect(retryCallEnrichment).toHaveBeenCalledWith("one", "unit-extraction");
});

it("supports selecting a call with the keyboard", () => {
  const select = vi.fn();
  render(<ArchiveDrawer isOpen onClose={() => {}} onSelectCall={select} calls={[call]} />);
  fireEvent.keyDown(screen.getByText("Test channel").closest(".archive-call-card")!, { key: "Enter" });
  expect(select).toHaveBeenCalledWith(call);
});

it("removes only the selected call and offers undo without selecting the row", async () => {
  vi.mocked(purgeCalls).mockResolvedValue({ removed: 1 });
  vi.mocked(undoPurgeCalls).mockResolvedValue({ removed: 1 });
  const select = vi.fn();
  render(<ArchiveDrawer isOpen onClose={() => {}} calls={[call]} onSelectCall={select} />);
  expect(screen.queryByText("Old summary")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Remove Test channel" }));
  await waitFor(() => expect(screen.queryByText("Test channel")).toBeNull());
  expect(purgeCalls).toHaveBeenCalledWith({ callIds: ["one"], deleteAudio: true });
  expect(select).not.toHaveBeenCalled();
  expect(screen.queryByText("Undo purge")).toBeNull();
});

it("keeps the call visible and reports a failed removal", async () => {
  vi.mocked(purgeCalls).mockRejectedValue(new Error("Administrator login required"));
  render(<ArchiveDrawer isOpen onClose={() => {}} calls={[call]} onSelectCall={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "Remove Test channel" }));
  await waitFor(() => expect(screen.getByText("Administrator login required")).toBeTruthy());
  expect(screen.getByText("Test channel")).toBeTruthy();
});
