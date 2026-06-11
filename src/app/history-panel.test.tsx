import { it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { HistoryPanel } from "./history-panel";
import type { ProjectVersionMeta } from "./version-history";

const metas: ProjectVersionMeta[] = [
  { id: "v2", projectId: "p1", capturedAt: "2026-06-11T12:00:00.000Z", trigger: "manual", label: "Before review", summary: null },
  { id: "v1", projectId: "p1", capturedAt: "2026-06-10T09:00:00.000Z", trigger: "auto", label: null, summary: null },
];

it("lists versions newest-first with label/trigger", () => {
  render(<HistoryPanel lang="en-US" versions={metas} busy={false} onCaptureNow={vi.fn()} loadDiff={vi.fn().mockResolvedValue([])} restore={vi.fn().mockResolvedValue(undefined)} />);
  expect(screen.getByText("Before review")).toBeInTheDocument();
  expect(screen.getByText(/Auto/)).toBeInTheDocument();
});

it("shows the empty state when there are no versions", () => {
  render(<HistoryPanel lang="en-US" versions={[]} busy={false} onCaptureNow={vi.fn()} loadDiff={vi.fn().mockResolvedValue([])} restore={vi.fn().mockResolvedValue(undefined)} />);
  expect(screen.getByText(/No versions yet/)).toBeInTheDocument();
});

it("calls onCaptureNow with the entered label", () => {
  const onCaptureNow = vi.fn();
  vi.spyOn(window, "prompt").mockReturnValue("My checkpoint");
  render(<HistoryPanel lang="en-US" versions={metas} busy={false} onCaptureNow={onCaptureNow} loadDiff={vi.fn().mockResolvedValue([])} restore={vi.fn().mockResolvedValue(undefined)} />);
  fireEvent.click(screen.getByRole("button", { name: "Save version now" }));
  expect(onCaptureNow).toHaveBeenCalledWith("My checkpoint");
});

it("compares a clicked version against now and renders the diff", async () => {
  const versions = [{ id: "v1", projectId: "p1", capturedAt: "2026-06-10T09:00:00.000Z", trigger: "auto", label: null, summary: "1 Tasks" }];
  const loadDiff = vi.fn().mockResolvedValue([
    { collection: "tasks", collectionLabel: "Tasks", kind: "list", recordId: 1, recordLabel: "T1",
      type: "modified", fields: [{ field: "title", label: "Title", before: "A", after: "B" }] },
  ]);
  render(<HistoryPanel lang="en-US" versions={versions as never} busy={false} onCaptureNow={() => {}} loadDiff={loadDiff} restore={vi.fn().mockResolvedValue(undefined)} />);
  fireEvent.click(screen.getByText(/Compared with current/i));
  expect(await screen.findByText("T1")).toBeInTheDocument();
  expect(loadDiff).toHaveBeenCalledWith("v1", "now");
});

it("compares two ticked versions, ordered oldest→newest", async () => {
  const loadDiff = vi.fn().mockResolvedValue([]);
  render(<HistoryPanel lang="en-US" versions={metas} busy={false} onCaptureNow={vi.fn()} loadDiff={loadDiff} restore={vi.fn().mockResolvedValue(undefined)} />);
  // "Compare selected" is disabled until exactly two are ticked
  const compareBtn = screen.getByRole("button", { name: "Compare selected" });
  expect(compareBtn).toBeDisabled();
  const boxes = screen.getAllByRole("checkbox");
  fireEvent.click(boxes[0]); // v2 (newer)
  fireEvent.click(boxes[1]); // v1 (older)
  expect(compareBtn).toBeEnabled();
  fireEvent.click(compareBtn);
  // ordered oldest (v1) → newest (v2)
  expect(loadDiff).toHaveBeenCalledWith("v1", "v2");
});

it("restores ticked changes from a vs-now comparison", async () => {
  const versions = [{ id: "v1", projectId: "p1", capturedAt: "2026-06-10T09:00:00.000Z", trigger: "manual", label: "Baseline", summary: null }];
  const loadDiff = vi.fn().mockResolvedValue([
    { collection: "tasks", collectionLabel: "Tasks", kind: "list", recordId: 1, recordLabel: "T1",
      type: "modified", fields: [{ field: "title", label: "Title", before: "Old", after: "New" }] },
  ]);
  const restore = vi.fn().mockResolvedValue(undefined);
  render(<HistoryPanel lang="en-US" versions={versions as never} busy={false} onCaptureNow={() => {}} loadDiff={loadDiff} restore={restore} />);
  fireEvent.click(screen.getByText(/Compared with current/i));
  const box = await screen.findByLabelText("T1");
  fireEvent.click(box);
  fireEvent.click(screen.getByRole("button", { name: "Restore selected" }));
  expect(restore).toHaveBeenCalledWith("v1", { "tasks:1": "all" }, "Baseline");
});
