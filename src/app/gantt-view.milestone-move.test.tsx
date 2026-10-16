// §715 project D — GanttView wires the milestone drag to the workspace: a move
// lands in `milestones`, records the same undo entry and activity row as the
// Milestones editor, and is offered only where milestones may change (not in
// the read-only pop-out, not with the Milestones function off).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, fireEvent } from "@testing-library/react";
import { useEffect, type ReactNode } from "react";
import { FiltersProvider } from "./filters-context";
import { WorkspaceProvider, useWorkspace } from "./workspace-context";
import { WorkspaceTabProvider } from "./workspace-tab-context";
import { GanttView } from "./gantt-view";
import { defaultSettings } from "./settings-types";
import type { Milestone } from "./types";
import { fmtFull } from "./gantt-engine";
import { ToastProvider } from "./toast-context";
import { MILESTONE_KEY_COMMIT_DELAY_MS } from "./use-gantt-milestone-drag";
import type { ToastKind } from "./use-toast";

vi.mock("./use-resizable", () => ({
  useResizable: () => ({ ref: { current: null }, size: 400 }),
}));
vi.mock("./use-settings", () => ({ useSettings: vi.fn() }));

import { useSettings } from "./use-settings";

const MS: Milestone[] = [{ id: 3, name: "Pilot Go-Live", date: "2026-10-23", linkedTaskIds: [] }];
const HANDLE = "Move milestone – Pilot Go-Live";

function Seed({ list }: { list: readonly Milestone[] }) {
  const { setMilestones } = useWorkspace();
  useEffect(() => { setMilestones(list); }, [setMilestones, list]);
  return null;
}
function ShowDate() {
  const { milestones, setMilestones } = useWorkspace();
  return (
    <>
      {milestones.map((m) => <output key={m.id} data-testid="date">{m.date}</output>)}
      {/* A concurrent writer deleting every milestone. */}
      <button type="button" aria-label="delete-all" onClick={() => setMilestones([])} />
      {/* A concurrent writer moving the first milestone to 2026-11-01. */}
      <button
        type="button"
        aria-label="shift-date"
        onClick={() => setMilestones((prev) => prev.map((m, i) => (i === 0 ? { ...m, date: "2026-11-01" } : m)))}
      />
      {/* A concurrent writer signing the first milestone off. */}
      <button
        type="button"
        aria-label="sign-off"
        onClick={() => setMilestones((prev) => prev.map((m, i) => (i === 0 ? { ...m, achievedDate: "2026-10-16" } : m)))}
      />
    </>
  );
}
function Wrapper({ children }: { children: ReactNode }) {
  return (
    <FiltersProvider>
      <WorkspaceProvider>
        <WorkspaceTabProvider>{children}</WorkspaceTabProvider>
      </WorkspaceProvider>
    </FiltersProvider>
  );
}
function renderView(
  { seed = MS, withToast, ...props }: Partial<React.ComponentProps<typeof GanttView>> & {
    seed?: readonly Milestone[];
    withToast?: (kind: ToastKind, text: string) => void;
  } = {},
) {
  const tree = (
    <>
      <Seed list={seed} />
      <ShowDate />
      <GanttView milestonesEnabled {...props} />
    </>
  );
  return render(
    withToast ? <ToastProvider value={{ showToast: withToast, showToastAction: vi.fn() }}>{tree}</ToastProvider> : tree,
    { wrapper: Wrapper },
  );
}

describe("GanttView — milestone move", () => {
  beforeEach(() => {
    vi.mocked(useSettings).mockReturnValue({
      settings: defaultSettings, setSettings: vi.fn(), hydrated: true, i18nReady: true, lang: "en-US" as const,
    } as unknown as ReturnType<typeof useSettings>);
  });
  afterEach(() => {
    vi.useRealTimers();
    window.history.replaceState(null, "", "/");
    vi.restoreAllMocks();
  });

  it("writes the new date, with an undo entry and an activity row", () => {
    const onCaptureFieldEdit = vi.fn();
    const logActivityChanges = vi.fn();
    renderView({ onCaptureFieldEdit, logActivityChanges });
    fireEvent.keyDown(screen.getByRole("slider", { name: HANDLE }), { key: "ArrowRight", shiftKey: true });
    fireEvent.keyDown(screen.getByRole("slider", { name: HANDLE }), { key: "Enter" });
    expect(screen.getAllByTestId("date")[0].textContent).toBe("2026-10-30");
    // The control announces the date it now holds.
    expect(screen.getByRole("slider", { name: HANDLE }).getAttribute("aria-valuetext"))
      .toBe(fmtFull(new Date(Date.UTC(2026, 9, 30)), "en-US"));
    expect(onCaptureFieldEdit).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "milestone.updated", id: 3, before: { date: "2026-10-23" }, after: { date: "2026-10-30" } }),
    );
    expect(logActivityChanges).toHaveBeenCalledWith(
      "milestone.updated",
      expect.arrayContaining([expect.objectContaining({ field: "date", from: "2026-10-23", to: "2026-10-30" })]),
      3,
    );
  });

  it("keeps focus on the moved milestone when the move re-sorts the rows", () => {
    renderView({ seed: [...MS, { id: 8, name: "Rollout", date: "2026-10-25", linkedTaskIds: [] }] });
    const slider = screen.getByRole("slider", { name: HANDLE });
    slider.focus();
    fireEvent.keyDown(slider, { key: "PageUp" }); // 2026-10-30: now after Rollout
    fireEvent.keyDown(slider, { key: "Enter" });
    expect(screen.getAllByTestId("date").map((n) => n.textContent)).toContain("2026-10-30");
    expect(document.activeElement).toBe(screen.getByRole("slider", { name: HANDLE }));
  });

  it("tells the user when the milestone was deleted before the move landed", () => {
    vi.useFakeTimers();
    const showToast = vi.fn();
    renderView({ withToast: showToast });
    const slider = screen.getByRole("slider", { name: HANDLE });
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    fireEvent.click(screen.getByRole("button", { name: "delete-all" }));
    // The row (and its handle) is gone, so no blur arrives; the pending move
    // lands after the pause, against the live list, and finds nothing.
    act(() => { vi.advanceTimersByTime(MILESTONE_KEY_COMMIT_DELAY_MS); });
    expect(showToast).toHaveBeenCalledWith("error", "This item was deleted elsewhere — your change wasn't saved.");
  });

  it("tells the user when the milestone was signed off before the move landed", () => {
    vi.useFakeTimers();
    const showToast = vi.fn();
    renderView({ withToast: showToast });
    fireEvent.keyDown(screen.getByRole("slider", { name: HANDLE }), { key: "ArrowRight" });
    fireEvent.click(screen.getByRole("button", { name: "sign-off" }));
    act(() => { vi.advanceTimersByTime(MILESTONE_KEY_COMMIT_DELAY_MS); });
    expect(screen.getAllByTestId("date")[0].textContent).toBe("2026-10-23");
    expect(showToast).toHaveBeenCalledWith(
      "error",
      "This milestone was marked achieved elsewhere — it stays on its date, so your move wasn't saved.",
    );
  });

  it("moves from the date a concurrent writer set, not the one the presses started on", () => {
    renderView();
    const slider = screen.getByRole("slider", { name: HANDLE });
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    fireEvent.click(screen.getByRole("button", { name: "shift-date" }));
    fireEvent.keyDown(screen.getByRole("slider", { name: HANDLE }), { key: "Enter" });
    expect(screen.getAllByTestId("date")[0].textContent).toBe("2026-11-02");
  });

  it("lands a pending move when the chart unmounts on navigation, and drops it during a project swap", () => {
    for (const [swapping, expected] of [[false, "2026-10-24"], [true, "2026-10-23"]] as const) {
      const ui = (show: boolean) => (
        <>
          <Seed list={MS} />
          <ShowDate />
          {show && <GanttView milestonesEnabled isSwapInFlight={() => swapping} />}
        </>
      );
      const { rerender, unmount } = render(ui(true), { wrapper: Wrapper });
      fireEvent.keyDown(screen.getByRole("slider", { name: HANDLE }), { key: "ArrowRight" });
      rerender(ui(false));
      expect(screen.getAllByTestId("date")[0].textContent).toBe(expected);
      unmount();
    }
  });

  it("offers no handle in the read-only pop-out", () => {
    window.history.replaceState(null, "", "/?popout=gantt");
    renderView();
    expect(screen.getAllByText("Pilot Go-Live").length).toBeGreaterThan(0);
    expect(screen.queryByRole("slider", { name: HANDLE })).toBeNull();
  });
});
