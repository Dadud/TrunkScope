import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { IntegrationModelField } from "./IntegrationModelField";
afterEach(cleanup);
it("labels the model input independently of discovery and manual controls", () => {
  const refresh = vi.fn();
  render(<IntegrationModelField label="Summary model" value="local-model" models={["local-model"]} loading={false} onRefresh={refresh} onChange={vi.fn()} kind="summary" />);
  expect(screen.getByRole("combobox", { name: "Summary model" })).toBe(screen.getByLabelText("Summary model"));
  fireEvent.click(screen.getByRole("button", { name: "Discover summary model options" }));
  expect(refresh).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Enter model manually" }));
  expect((screen.getByRole("textbox", { name: "Summary model" }) as HTMLInputElement).value).toBe("local-model");
});
