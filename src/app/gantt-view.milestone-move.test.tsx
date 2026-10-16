// §715 project D — GanttView wires the milestone drag to the workspace: a move
// lands in `milestones`, records the same undo entry and activity row as the
// Milestones editor, and is offered only where milestones may change (not in
// the read-only pop-out, not with the Milestones function off).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useEffect, type ReactNode } from "react";
import { FiltersProvider } from "./filters-context";
import { WorkspaceProvider, useWorkspace } from "./workspace-context";
import { WorkspaceTabProvider } from "./workspace-tab-context";
import { GanttView } from "./gantt-view";
import { defaultSettings } from "./settings-types";
import type { Milestone } from "./types";

vi.mock("./use-resizable", () => ({
  useResizable: () => ({ ref: { current: null }, size: 400 }),
}));
vi.mock("./use-settings", () => ({ useSettings: vi.fn() }));

import { useSettings } from "./use-settings";

const MS: Milestone[] = [{ id: 3, name: "Pilot Go-Live", date: "2026-10-23", linkedTaskIds: [] }];
const HANDLE = "Move milestone (changes its date) – Pilot Go-Live";

function Seed() {
  const { setMilestones } = useWorkspace();
  useEffect(() => { setMilestones(MS); }, [setMilestones]);
  return null;
}
function ShowDate() {
  const { milestones } = useWorkspace();
  return <output data-testid="date">{milestones[0]?.date}</output>;
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
function renderView(props: Partial<React.ComponentProps<typeof GanttView>> = {}) {
  return render(
    <>
      <Seed />
      <ShowDate />
      <GanttView milestonesEnabled {...props} />
    </>,
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
    window.history.replaceState(null, "", "/");
    vi.restoreAllMocks();
  });

  it("writes the new date, with an undo entry and an activity row", () => {
    const onCaptureFieldEdit = vi.fn();
    const logActivityChanges = vi.fn();
    renderView({ onCaptureFieldEdit, logActivityChanges });
    fireEvent.keyDown(screen.getByRole("button", { name: HANDLE }), { key: "ArrowRight", shiftKey: true });
    expect(screen.getByTestId("date").textContent).toBe("2026-10-30");
    expect(onCaptureFieldEdit).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "milestone.updated", id: 3, before: { date: "2026-10-23" }, after: { date: "2026-10-30" } }),
    );
    expect(logActivityChanges).toHaveBeenCalledWith(
      "milestone.updated",
      expect.arrayContaining([expect.objectContaining({ field: "date", from: "2026-10-23", to: "2026-10-30" })]),
      3,
    );
  });

  it("offers no handle in the read-only pop-out", () => {
    window.history.replaceState(null, "", "/?popout=gantt");
    renderView();
    expect(screen.getAllByText("Pilot Go-Live").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: HANDLE })).toBeNull();
  });
});
