import { it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { HistoryPanel } from "./history-panel";
import type { ProjectVersionMeta } from "./version-history";

const metas: ProjectVersionMeta[] = [
  { id: "v2", projectId: "p1", capturedAt: "2026-06-11T12:00:00.000Z", trigger: "manual", label: "Before review", summary: null },
  { id: "v1", projectId: "p1", capturedAt: "2026-06-10T09:00:00.000Z", trigger: "auto", label: null, summary: null },
];

it("lists versions newest-first with label/trigger", () => {
  render(<HistoryPanel lang="en-US" versions={metas} busy={false} onCaptureNow={vi.fn()} />);
  expect(screen.getByText("Before review")).toBeInTheDocument();
  expect(screen.getByText(/Auto/)).toBeInTheDocument();
});

it("shows the empty state when there are no versions", () => {
  render(<HistoryPanel lang="en-US" versions={[]} busy={false} onCaptureNow={vi.fn()} />);
  expect(screen.getByText(/No versions yet/)).toBeInTheDocument();
});

it("calls onCaptureNow with the entered label", () => {
  const onCaptureNow = vi.fn();
  vi.spyOn(window, "prompt").mockReturnValue("My checkpoint");
  render(<HistoryPanel lang="en-US" versions={metas} busy={false} onCaptureNow={onCaptureNow} />);
  fireEvent.click(screen.getByRole("button", { name: "Save version now" }));
  expect(onCaptureNow).toHaveBeenCalledWith("My checkpoint");
});
