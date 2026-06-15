import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TrendsPanel } from "./trends-panel";
import type { SnapshotRecord, VarianceRow } from "./snapshot";

const noop = async () => {};
function snap(id: string, bucket: string, over: Partial<SnapshotRecord> = {}): SnapshotRecord {
  return {
    id, capturedAt: id, bucket, cadence: "weekly", trigger: "auto", isBaseline: false,
    remainingHours: 50, remainingCost: 5000, pctComplete: 40, forecastEndDate: "2026-09-01",
    planEndDate: "2026-07-31", spi: 0.9, cpi: 1.0, overallRag: "A", scheduleRag: "R",
    budgetRag: "A", scopeRag: "", currency: "EUR", milestones: [], series: [], ...over,
  };
}
const variance: VarianceRow[] = [
  { key: "remainingHours", baseline: 40, current: 50, delta: 10, health: "A" },
  { key: "forecastEndDate", baseline: null, current: null, delta: null, deltaDays: 32, health: "R" },
];

const base = {
  lang: "en-US" as const,
  active: true,
  snapshots: [snap("2026-05-25T00:00:00.000Z", "2026-W22", { isBaseline: true }), snap("2026-06-10T00:00:00.000Z", "2026-W24")],
  baseline: snap("2026-05-25T00:00:00.000Z", "2026-W22", { isBaseline: true }),
  latest: snap("2026-06-10T00:00:00.000Z", "2026-W24"),
  variance,
  gaps: ["2026-W23"],
  busy: false,
  captureNow: noop, setBaseline: noop, deleteSnapshot: noop, deleteSnapshots: noop as (ids: readonly string[]) => Promise<void>,
};

describe("TrendsPanel", () => {
  it("renders the gated empty state when not active", () => {
    const { getByText, queryByText } = render(<TrendsPanel {...base} active={false} snapshots={[]} latest={null} baseline={null} variance={[]} gaps={[]} />);
    expect(getByText(/Turso/i)).toBeTruthy();
    expect(queryByText(/Baseline vs current/i)).toBeNull();
  });

  it("renders the variance table and a capture button when active", () => {
    const { getByText, getByRole } = render(<TrendsPanel {...base} />);
    expect(getByText(/Baseline vs current/i)).toBeTruthy();
    expect(getByRole("button", { name: /capture/i })).toBeTruthy();
  });

  it("shows the gap count somewhere in the trends area", () => {
    const { getAllByText } = render(<TrendsPanel {...base} />);
    expect(getAllByText(/gap/i).length).toBeGreaterThan(0);
  });

  it("calls captureNow when the capture button is clicked", async () => {
    const captureNow = vi.fn(noop);
    const { getByRole } = render(<TrendsPanel {...base} captureNow={captureNow} />);
    getByRole("button", { name: /capture/i }).click();
    expect(captureNow).toHaveBeenCalled();
  });

  it("renders a Print button (ReportCard toolbar)", () => {
    render(<TrendsPanel {...base} />);
    expect(screen.getByRole("button", { name: /print/i })).toBeInTheDocument();
  });

  it("renders a reset-size button (ReportCard toolbar)", () => {
    render(<TrendsPanel {...base} />);
    expect(screen.getByRole("button", { name: /reset.*size/i })).toBeInTheDocument();
  });

  it("shows a per-row delete button for each snapshot", () => {
    render(<TrendsPanel {...base} />);
    // Two snapshots → two delete buttons (aria-label or text "Delete")
    const deleteBtns = screen.getAllByRole("button", { name: /^Delete$/i });
    expect(deleteBtns).toHaveLength(2);
  });

  it("per-row delete calls deleteSnapshot after confirm=true", () => {
    vi.stubGlobal("confirm", () => true);
    const deleteSnapshot = vi.fn(noop);
    render(<TrendsPanel {...base} deleteSnapshot={deleteSnapshot} />);
    const [firstDelete] = screen.getAllByRole("button", { name: /^Delete$/i });
    fireEvent.click(firstDelete);
    expect(deleteSnapshot).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it("per-row delete does NOT call deleteSnapshot when confirm=false", () => {
    vi.stubGlobal("confirm", () => false);
    const deleteSnapshot = vi.fn(noop);
    render(<TrendsPanel {...base} deleteSnapshot={deleteSnapshot} />);
    const [firstDelete] = screen.getAllByRole("button", { name: /^Delete$/i });
    fireEvent.click(firstDelete);
    expect(deleteSnapshot).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("selecting two rows and clicking 'Delete selected' calls deleteSnapshots with both ids", () => {
    vi.stubGlobal("confirm", () => true);
    const deleteSnapshots = vi.fn(noop as (ids: readonly string[]) => Promise<void>);
    render(<TrendsPanel {...base} deleteSnapshots={deleteSnapshots} />);
    // Check both row checkboxes
    const checkboxes = screen.getAllByRole("checkbox");
    fireEvent.click(checkboxes[0]);
    fireEvent.click(checkboxes[1]);
    // Click the "Delete selected" button
    const bulkBtn = screen.getByRole("button", { name: /delete selected/i });
    fireEvent.click(bulkBtn);
    expect(deleteSnapshots).toHaveBeenCalledTimes(1);
    const [ids] = deleteSnapshots.mock.calls[0] as [readonly string[]];
    expect(ids).toHaveLength(2);
    vi.unstubAllGlobals();
  });

  it("'Delete selected' button is disabled when no rows are selected", () => {
    render(<TrendsPanel {...base} />);
    const bulkBtn = screen.getByRole("button", { name: /delete selected/i });
    expect(bulkBtn).toBeDisabled();
  });
});
