// §548 — the calendar background writers (four auto-sync pushes, four background pulls, the auto-pull
// runner) run on timers and never unmount with the held app tree, so they gate on `loadPending`
// themselves. The Graph-facing hooks are stubbed; what is pinned is the enable flags this hook hands them.
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Settings } from "./settings-types";

const seen = vi.hoisted(() => ({ autoSync: [] as boolean[], autoPull: [] as boolean[], backgroundPull: [] as boolean[] }));

vi.mock("./use-calendar-auto-sync", () => ({
  useCalendarAutoSync: (a: { active: boolean }) => { seen.autoSync.push(a.active); },
}));
vi.mock("./use-calendar-auto-pull", () => ({
  useCalendarAutoPull: (a: { enabled: boolean }) => { seen.autoPull.push(a.enabled); },
}));
vi.mock("./use-entity-calendar-push", () => ({
  useEntityCalendarPush: () => ({ pushToOutlook: vi.fn(), busy: false }),
}));
vi.mock("./use-entity-calendar-pull", () => ({
  useEntityCalendarPull: (a: { enabled: boolean; background?: boolean }) => {
    if (a.background) seen.backgroundPull.push(a.enabled);
    return { pull: vi.fn(), busy: false, result: null, clearResult: vi.fn(), keepApp: vi.fn(), applyMove: vi.fn() };
  },
}));
vi.mock("./use-outlook-calendar-push", () => ({
  useOutlookCalendarPush: () => ({ pushToOutlook: vi.fn(), busy: false }),
}));
vi.mock("./use-milestone-calendar-pull", () => ({
  useMilestoneCalendarPull: () => ({ pull: vi.fn(), busy: false, result: null, clearResult: vi.fn(), keepApp: vi.fn(), applyMove: vi.fn() }),
}));
vi.mock("./use-committee-outlook-push", () => ({
  useCommitteeOutlookPush: () => ({ pushToOutlook: vi.fn(), pushingTarget: null }),
}));

import { useCalendarIntegrations, type CalendarIntegrationDeps } from "./use-calendar-integrations";

const ON = { enabled: true, auto: true };

function deps(loadPending: boolean): CalendarIntegrationDeps {
  return {
    isPopout: false,
    loadPending,
    getScopeEpoch: () => 0,
    settings: {
      integrations: { m365: { enabled: true, outlookCalendarPush: true } },
      outlookCalendar: { task: ON, raid: ON, change: ON, absence: ON },
    } as unknown as Settings,
    m365Enabled: true,
    portfolioCurrentId: "p1",
    project: undefined,
    lang: "en-US",
    today: "2026-09-19",
    logActivityAs: vi.fn() as unknown as CalendarIntegrationDeps["logActivityAs"],
    setSettings: vi.fn(),
    milestones: [], setMilestones: vi.fn(),
    steeringCommittee: undefined, setSteeringCommittee: vi.fn(),
    tasks: [], setTasks: vi.fn(),
    raid: [], setRaid: vi.fn(),
    changes: [], setChanges: vi.fn(),
    absences: [], setAbsences: vi.fn(),
  };
}

function lastRender() {
  return { autoSync: seen.autoSync.slice(-4), backgroundPull: seen.backgroundPull.slice(-4), autoPull: seen.autoPull.slice(-1) };
}

beforeEach(() => {
  seen.autoSync.length = 0;
  seen.autoPull.length = 0;
  seen.backgroundPull.length = 0;
});

describe("useCalendarIntegrations — background writers hold while the load is pending (§548)", () => {
  it("keeps every auto-sync push, background pull and the auto-pull runner OFF while loadPending", () => {
    renderHook(() => useCalendarIntegrations(deps(true)));
    expect(lastRender()).toEqual({ autoSync: [false, false, false, false], backgroundPull: [false, false, false, false], autoPull: [false] });
  });

  it("control: the same settings switch them ON once the load has settled", () => {
    renderHook(() => useCalendarIntegrations(deps(false)));
    expect(lastRender()).toEqual({ autoSync: [true, true, true, true], backgroundPull: [true, true, true, true], autoPull: [true] });
  });
});
