import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { TrendsPanel } from "./trends-panel";

// Branded confirm dialog — mock the hook so tests control the resolved boolean.
const { confirmMock } = vi.hoisted(() => ({ confirmMock: { result: true } }));
vi.mock("./confirm-dialog", () => ({
  useConfirm: () => () => Promise.resolve(confirmMock.result),
}));
import { DisplayTimezoneProvider } from "./display-timezone-context";
import type { SnapshotRecord, VarianceRow } from "./snapshot";
import { expectRowUniqueNames } from "../test/row-unique-names";
import { rowLabel } from "./row-tokens";
import { t } from "./i18n";

// The panel reads useDisplayTimezone(); wrap every render in the provider. A
// non-UTC zone (Asia/Kolkata, +5:30) makes the zone conversion observable.
function renderPanel(ui: React.ReactNode) {
  return render(<DisplayTimezoneProvider effectiveTz="Asia/Kolkata">{ui}</DisplayTimezoneProvider>);
}

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
    const { getByText, queryByText } = renderPanel(<TrendsPanel {...base} active={false} snapshots={[]} latest={null} baseline={null} variance={[]} gaps={[]} />);
    expect(getByText(/Turso/i)).toBeTruthy();
    expect(queryByText(/Baseline vs current/i)).toBeNull();
  });

  it("renders the variance table and a capture button when active", () => {
    const { getByText, getByRole } = renderPanel(<TrendsPanel {...base} />);
    expect(getByText(/Baseline vs current/i)).toBeTruthy();
    expect(getByRole("button", { name: /capture/i })).toBeTruthy();
  });

  it("shows the gap count somewhere in the trends area", () => {
    const { getAllByText } = renderPanel(<TrendsPanel {...base} />);
    expect(getAllByText(/gap/i).length).toBeGreaterThan(0);
  });

  it("calls captureNow when the capture button is clicked", async () => {
    const captureNow = vi.fn(noop);
    const { getByRole } = renderPanel(<TrendsPanel {...base} captureNow={captureNow} />);
    getByRole("button", { name: /capture/i }).click();
    expect(captureNow).toHaveBeenCalled();
  });

  it("renders a Print button (ReportCard toolbar)", () => {
    renderPanel(<TrendsPanel {...base} />);
    expect(screen.getByRole("button", { name: /print/i })).toBeInTheDocument();
  });

  it("renders a reset-size button (ReportCard toolbar)", () => {
    renderPanel(<TrendsPanel {...base} />);
    expect(screen.getByRole("button", { name: /reset.*size/i })).toBeInTheDocument();
  });

  it("shows a per-row delete button for each snapshot", () => {
    renderPanel(<TrendsPanel {...base} />);
    // Two snapshots → two delete buttons (aria-label or text "Delete")
    const deleteBtns = deleteButtons();
    expect(deleteBtns).toHaveLength(2);
  });

  it("per-row delete calls deleteSnapshot after confirm=true", async () => {
    confirmMock.result = true;
    const deleteSnapshot = vi.fn(noop);
    renderPanel(<TrendsPanel {...base} deleteSnapshot={deleteSnapshot} />);
    const [firstDelete] = deleteButtons();
    fireEvent.click(firstDelete);
    await waitFor(() => expect(deleteSnapshot).toHaveBeenCalledTimes(1));
  });

  it("per-row delete does NOT call deleteSnapshot when confirm=false", async () => {
    confirmMock.result = false;
    const deleteSnapshot = vi.fn(noop);
    renderPanel(<TrendsPanel {...base} deleteSnapshot={deleteSnapshot} />);
    const [firstDelete] = deleteButtons();
    fireEvent.click(firstDelete);
    await act(async () => {});
    expect(deleteSnapshot).not.toHaveBeenCalled();
    confirmMock.result = true;
  });

  it("selecting two rows and clicking 'Delete selected' calls deleteSnapshots with both ids", async () => {
    confirmMock.result = true;
    const deleteSnapshots = vi.fn(noop as (ids: readonly string[]) => Promise<void>);
    renderPanel(<TrendsPanel {...base} deleteSnapshots={deleteSnapshots} />);
    // Check both row checkboxes
    const checkboxes = screen.getAllByRole("checkbox");
    fireEvent.click(checkboxes[0]);
    fireEvent.click(checkboxes[1]);
    // Click the "Delete selected" button
    const bulkBtn = screen.getByRole("button", { name: /delete selected/i });
    fireEvent.click(bulkBtn);
    await waitFor(() => expect(deleteSnapshots).toHaveBeenCalledTimes(1));
    const [ids] = deleteSnapshots.mock.calls[0] as [readonly string[]];
    expect(ids).toHaveLength(2);
  });

  it("renders a snapshot's capturedAt in the display timezone", () => {
    // 2026-06-10T00:00Z in Asia/Kolkata (+5:30) = 05:30 on 06/10/2026.
    renderPanel(<TrendsPanel {...base} />);
    const shown = screen.getAllByText(/06\/10\/2026/);
    expect(shown.length).toBeGreaterThan(0);
    expect(shown[0].textContent).toContain("05:30");
    expect(shown[0].textContent).not.toContain("2026-06-10T00:00:00.000Z");
  });

  it("'Delete selected' button is disabled when no rows are selected", () => {
    renderPanel(<TrendsPanel {...base} />);
    const bulkBtn = screen.getByRole("button", { name: /delete selected/i });
    expect(bulkBtn).toBeDisabled();
  });

  // ★★ WCAG 2.4.6 — the row name is a formatted TIMESTAMP, and a timestamp
  // REPEATS: two snapshots captured in the same displayed minute render the
  // same string. That is the same defect class as a bare "Delete", so the
  // checkbox (which was already interpolating the raw timestamp) is fixed the
  // same way as the two unqualified buttons — one occurrence token per row.
  // ★ Both rows are non-baseline so BOTH render a "Set as baseline" button;
  // with a baseline row only one would, and the collision would not render.
  const colliding = [
    snap("s-earlier", "2026-W24", { capturedAt: "2026-06-10T00:00:00.000Z" }),
    snap("s-later", "2026-W24", { capturedAt: "2026-06-10T00:00:30.000Z" }),
  ];
  function renderColliding(over: Partial<typeof base> = {}) {
    return renderPanel(
      <TrendsPanel {...base} snapshots={colliding} baseline={null} latest={colliding[1]} {...over} />,
    );
  }
  // `rowLabel(verb, "")` is the verb plus the separator the shared helper emits,
  // so nothing here hardcodes the separator glyph.
  const DELETE_PREFIX = rowLabel(t("en-US", "snapshotDelete"), "");
  const nameOf = (el: Element) => el.getAttribute("aria-label") || el.textContent || "";
  const deleteButtons = () =>
    screen.getAllByRole("button").filter((b) => nameOf(b).startsWith(DELETE_PREFIX));

  it("gives every per-row BUTTON a row-unique accessible name when two snapshots share a displayed timestamp", () => {
    renderColliding();
    // 10 = measured for this fixture (whole-document scope).
    expectRowUniqueNames({ minControls: 10, requireCollisionSeed: true });
  });

  it("gives every per-row CHECKBOX a row-unique accessible name when two snapshots share a displayed timestamp", () => {
    renderColliding();
    // 2 = measured for this fixture (one checkbox per snapshot row).
    expectRowUniqueNames({ minControls: 2, roles: ["checkbox"], requireCollisionSeed: true });
  });

  it("numbers the occurrence index in RENDERED (newest-first) order, not raw snapshot order", async () => {
    const deleteSnapshot = vi.fn(noop);
    renderColliding({ deleteSnapshot });
    const deletes = deleteButtons();
    expect(deletes).toHaveLength(2);
    // The panel renders `[...snapshots].reverse()`, so the NEWEST row is first
    // and must carry occurrence (1) — building the token map over the raw
    // array would swap the two.
    expect(nameOf(deletes[0])).toMatch(/\(1\)$/);
    expect(nameOf(deletes[1])).toMatch(/\(2\)$/);
    fireEvent.click(deletes[0]);
    await waitFor(() => expect(deleteSnapshot).toHaveBeenCalledWith("s-later"));
  });
});
