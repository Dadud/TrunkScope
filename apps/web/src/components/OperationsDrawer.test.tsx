import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { OperationsDrawer } from "./OperationsDrawer";
import { askOperations, getOperationsSummary, type OperationsSummary } from "../api";

vi.mock("../api", () => ({ getOperationsSummary: vi.fn(), askOperations: vi.fn() }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });

it("cancels an AI question on close and ignores its late answer", async () => {
  vi.mocked(getOperationsSummary).mockImplementation(() => new Promise(() => {}));
  let finish!: (value: Awaited<ReturnType<typeof askOperations>>) => void;
  vi.mocked(askOperations).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const { rerender } = render(<OperationsDrawer isOpen onClose={() => {}} />);
  fireEvent.click(screen.getByText("ASK AI"));
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "  Any fires?  " } });
  fireEvent.click(screen.getByRole("button", { name: "Ask" }));
  const signal = vi.mocked(askOperations).mock.calls[0][2];
  expect(vi.mocked(askOperations).mock.calls[0][0]).toBe("Any fires?");
  rerender(<OperationsDrawer isOpen={false} onClose={() => {}} />);
  expect(signal?.aborted).toBe(true);
  await act(async () => finish({ answer: "Late answer", status: "ok", citedCallIds: [] }));
  rerender(<OperationsDrawer isOpen onClose={() => {}} />);
  expect(screen.queryByText("Late answer")).toBeNull();
  expect(screen.getByRole("button", { name: "Ask" })).toBeTruthy();
});

it("clears the old brief when another window fails and allows retry", async () => {
  const summary = { headline: "Four-hour results", generatedAt: new Date().toISOString(), callCount: 0, activeThreadCount: 0, threads: [] } as unknown as OperationsSummary;
  vi.mocked(getOperationsSummary).mockResolvedValueOnce(summary).mockRejectedValueOnce(new Error("Connection lost")).mockResolvedValueOnce({ ...summary, headline: "One-hour results" });
  render(<OperationsDrawer isOpen onClose={() => {}} />);
  await screen.findByText("Four-hour results");
  fireEvent.click(screen.getByText("1H WINDOW"));
  await screen.findByRole("alert");
  expect(screen.queryByText("Four-hour results")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Retry brief" }));
  await screen.findByText("One-hour results");
});

it("cancels a request when the panel closes", async () => {
  vi.mocked(getOperationsSummary).mockImplementation(() => new Promise(() => {}));
  const { rerender } = render(<OperationsDrawer isOpen onClose={() => {}} />);
  const signal = vi.mocked(getOperationsSummary).mock.calls[0][1];
  rerender(<OperationsDrawer isOpen={false} onClose={() => {}} />);
  await waitFor(() => expect(signal?.aborted).toBe(true));
});

it("keeps the newest time window when an older request finishes later", async () => {
  const pending: Array<(value: OperationsSummary) => void> = [];
  vi.mocked(getOperationsSummary).mockImplementation(() => new Promise((resolve) => pending.push(resolve)));
  render(<OperationsDrawer isOpen onClose={() => undefined} />);
  fireEvent.click(screen.getByText("1H WINDOW"));
  expect(getOperationsSummary).toHaveBeenCalledTimes(2);
  const summary = (headline: string) => ({ headline, generatedAt: new Date().toISOString(), callCount: 0, activeThreadCount: 0, threads: [] } as unknown as OperationsSummary);
  await act(async () => pending[1](summary("Latest window")));
  await act(async () => pending[0](summary("Stale window")));
  expect(screen.getByText("Latest window")).toBeTruthy();
  expect(screen.queryByText("Stale window")).toBeNull();
});
