// The sim next-action's CTA is `{ kind: "open", view: "forecast", id }`: opening it
// must bring that milestone's row in the chances table into view and flash it,
// the same `useDeepLinkRowFlash` contract the Milestones and Changes panels honour.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { ForecastPanelDeepLinked } from "./forecast-panel";
import { WorkspaceTabProvider, useWorkspaceTab } from "./workspace-tab-context";
import { flashOutlineClass } from "./use-deeplink-row-flash";
import type { Milestone, ResourcePlan, Task } from "./types";
import { workingDaysBefore } from "./working-days";

const TODAY = "2026-10-14";
const NO_HOLIDAYS: ReadonlySet<string> = new Set();
const PLAN = { startDate: "2026-01-01", endDate: "2026-12-31", granularity: "week", currency: "EUR" } as ResourcePlan;
const FLASH = flashOutlineClass(true).split(" ")[0];

function task(id: number, over: Partial<Task> = {}): Task {
  return { id, title: `t${id}`, dueDate: "", priority: "Medium", status: "Open", ...over } as Task;
}
const done = [...workingDaysBefore(TODAY, 59, NO_HOLIDAYS), TODAY].map((d, i) =>
  task(1000 + i, { status: "Done", completedDate: d }),
);
const TASKS = [task(1), task(2), ...done];
const MILESTONES: Milestone[] = [
  { id: 7, name: "Go-live", date: "2026-12-01", linkedTaskIds: [1] },
  { id: 8, name: "Beta", date: "2026-11-02", linkedTaskIds: [2] },
];

function Harness({ mounted = true }: { mounted?: boolean }) {
  const { requestOpen, pendingOpen } = useWorkspaceTab();
  return (
    <>
      <button onClick={() => requestOpen("forecast", 7)}>open-7</button>
      <span data-testid="pending">{pendingOpen ? `${pendingOpen.view}:${pendingOpen.id}` : "none"}</span>
      {mounted && (
        <ForecastPanelDeepLinked lang="en-US" tasks={TASKS} milestones={MILESTONES} plan={PLAN} today={TODAY} holidaySet={NO_HOLIDAYS} />
      )}
    </>
  );
}

const rowOf = (name: string) => screen.getByRole("rowheader", { name: new RegExp(name) }).closest("tr")!;

describe("ForecastPanelDeepLinked", () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
    vi.stubGlobal("requestAnimationFrame", (cb: (t: number) => void) => {
      cb(0);
      return 0;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("scrolls the opened milestone's row into view and flashes it, and only that row", () => {
    render(<WorkspaceTabProvider><Harness /></WorkspaceTabProvider>);
    expect(rowOf("Go-live").className).not.toContain(FLASH);

    fireEvent.click(screen.getByText("open-7"));

    expect(rowOf("Go-live").className).toContain(FLASH);
    expect(rowOf("Beta").className).not.toContain(FLASH);
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1);
    expect(vi.mocked(Element.prototype.scrollIntoView).mock.contexts[0]).toBe(rowOf("Go-live"));
  });

  it("consumes the request, so a later fresh mount does not flash again", () => {
    const { rerender } = render(<WorkspaceTabProvider><Harness /></WorkspaceTabProvider>);
    fireEvent.click(screen.getByText("open-7"));
    expect(screen.getByTestId("pending").textContent).toBe("none");

    rerender(<WorkspaceTabProvider><Harness mounted={false} /></WorkspaceTabProvider>);
    act(() => {});
    rerender(<WorkspaceTabProvider><Harness /></WorkspaceTabProvider>);
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1);
  });
});
