import { describe, expect, test, vi } from "vitest";
import { render } from "@testing-library/react";
import { ResourcesPanel } from "./resources-panel";
import { defaultSettings } from "./settings-types";
import type { AllocPlanDeps } from "./use-alloc-plan";
import type { Milestone, Stakeholder, Task } from "./types";

// §769 — the panel must hand the Plan with AI hook the REAL tasks, milestones, RACI stakeholders and
// the §774 reassign step, not placeholders (a placeholder offers the model no task moves).
const allocMock = vi.hoisted(() => ({ deps: [] as unknown[] }));
vi.mock("./use-alloc-plan", () => ({
  useAllocPlan: (deps: unknown) => {
    allocMock.deps.push(deps);
    return { button: null, modal: null };
  },
}));
vi.mock("./use-settings", () => ({
  useSettings: () => ({ settings: defaultSettings, setSettings: vi.fn(), hydrated: true, i18nReady: true, lang: "en-US" as const }),
}));

const noop = () => {};
const tasks = [{ id: 1, title: "Build", assignee: "Maya Patel", assigneeEmail: "" }] as unknown as Task[];
const milestones = [{ id: 5, title: "Beta" }] as unknown as Milestone[];
const stakeholders = [{ id: 9, name: "Maya Patel" }] as unknown as Stakeholder[];

describe("ResourcesPanel → useAllocPlan (§769)", () => {
  test("passes the real tasks, milestones, stakeholders, reassign step and composite capture", () => {
    allocMock.deps.length = 0;
    const onReassignTasks = vi.fn(() => 2);
    const onIsLoadHeld = vi.fn(() => false);
    const onCaptureComposite = vi.fn();
    render(
      <ResourcesPanel
        lang="en-US" view="planning" tasks={tasks} absences={[]} shifts={[]} raid={[]} raidEnabled
        resources={[]} today="2026-05-23" holidaySet={new Set<string>()}
        onAddAbsence={noop} onEditAbsence={noop} onEditShift={noop}
        roles={[]} disciplines={[]} grades={[]} setResources={noop}
        plan={{ startDate: "2026-02-01", endDate: "2026-02-28", granularity: "month", currency: "EUR" }}
        workdayHours={8} onSetUtilization={noop} overAllocatedPct={100}
        onReassignTask={noop} onRescheduleTask={noop} onSetAllUtilizationMode={noop}
        onSetAbsenceOverride={noop} onSetPlanWindow={noop} onEditResource={noop} onAddResource={noop}
        milestones={milestones} stakeholders={stakeholders}
        onReassignTasks={onReassignTasks} onIsLoadHeld={onIsLoadHeld} onCaptureComposite={onCaptureComposite}
      />,
    );
    const deps = allocMock.deps.at(-1) as AllocPlanDeps;
    expect(deps.tasks).toBe(tasks);
    expect(deps.milestones).toBe(milestones);
    expect(deps.stakeholders).toBe(stakeholders);
    expect(deps.today).toBe("2026-05-23");
    expect(deps.reassignTasks).toBe(onReassignTasks);
    // Second wave, 8: the load-hold signal reaches the hook as the same function.
    expect(deps.isLoadHeld).toBe(onIsLoadHeld);
    expect(deps.captureComposite).toBe(onCaptureComposite);
  });
});
