import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { EnrichmentActions } from "./EnrichmentActions";
import { runAiTask } from "../api";
vi.mock("../api", () => ({ runAiTask: vi.fn() }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });

it("prevents overlapping batches and reports request failure beside the controls", async () => {
  let reject!: (error: Error) => void;
  vi.mocked(runAiTask).mockImplementation(() => new Promise((_, fail) => { reject = fail; }));
  render(<EnrichmentActions />);
  fireEvent.click(screen.getByRole("button", { name: "Addresses" }));
  fireEvent.click(screen.getByRole("button", { name: "Event categories" }));
  expect(runAiTask).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("status").textContent).toContain("Running addresses");
  await act(async () => { reject(new Error("Provider unavailable")); });
  expect(screen.getByRole("alert").textContent).toBe("Provider unavailable");
  expect((screen.getByRole("button", { name: "Addresses" }) as HTMLButtonElement).disabled).toBe(false);
});

it("does not describe a processed batch as successful extraction", async () => {
  vi.mocked(runAiTask).mockResolvedValue({ task: "event-tagging", processed: 2 });
  render(<EnrichmentActions />);
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Event categories" })); });
  expect(screen.getByRole("status").textContent).toContain("individual results or failures");
});
