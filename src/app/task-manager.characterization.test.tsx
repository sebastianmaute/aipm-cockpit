// @characterization — pins the task-manager → WorkspaceSection prop contract.
// The Phase 3 decomposition is DONE: the calendar wiring, Action-Center
// handlers, AI orchestration, dual-header assembly, and pull-summary modals now
// live in use-calendar-integrations / use-action-center-handlers /
// use-ai-orchestration / shell-chrome (buildShellChrome) / calendar-summary-modals.
// This suite proved (and now guards) that those move-only extractions kept the
// load-bearing prop KEYS reaching the child. It MAY be updated freely when a diff
// is understood (e.g. the future calendar prop-bag consolidation renames these) —
// it is NOT a golden fixture. Coarse on purpose: a tripwire, not a spec.
import { render, screen } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetMintStateForTests } from "./id-mint-session";

// task-manager mints task/resource ids from session-scoped state on interaction;
// clear it before each test so the suite never inherits another test's mark.
beforeEach(() => {
  __resetMintStateForTests();
});

// Capture the props task-manager threads into WorkspaceSection. Preserve every
// other real export (types/re-exports) via importOriginal so the module graph
// is otherwise untouched.
const captured: { props: Record<string, unknown> | null } = { props: null };
vi.mock("./workspace-section", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./workspace-section")>()),
  WorkspaceSection: (props: Record<string, unknown>) => {
    captured.props = props;
    return <div data-testid="ws-section-mock" />;
  },
}));

import TaskManager from "./task-manager";

function seedRegistry() {
  window.localStorage.setItem(
    "lop-app:projects",
    JSON.stringify({
      projects: [{ id: "p1", name: "Seed", code: "SEED", storageConfig: { kind: "browser" } }],
      currentProjectId: "p1",
    }),
  );
}

describe("@characterization task-manager → WorkspaceSection prop contract", () => {
  // Render TaskManager ONCE (it's a heavy mount) and assert against the captured
  // props in each test — the prop bag is identical across the three groups.
  beforeAll(async () => {
    window.localStorage.clear();
    captured.props = null;
    seedRegistry();
    render(<TaskManager />);
    await screen.findByTestId("ws-section-mock");
  }, 45000); // heavy TaskManager mount — headroom over the 20s hookTimeout under coverage load

  it("threads the calendar push/pull prop keys for every entity (Phase 3: use-calendar-integrations)", () => {
    const p = captured.props!;
    for (const key of [
      // milestone (manual — stays flat, no toggle)
      "onPushMilestonesToOutlook",
      "onPullMilestonesFromOutlook",
      "calendarPushBusy",
      "calendarPullBusy",
      // raid / change / absence consolidated into EntityCalendarProps bags (Task 8)
      "raidCalendar",
      "changeCalendar",
      "absenceCalendar",
      "m365Configured",
    ]) {
      expect(p, `missing threaded calendar prop: ${key}`).toHaveProperty(key);
    }
  });

  it("threads the action-center handler bundles (Phase 3: use-action-center-handlers)", () => {
    const p = captured.props!;
    for (const key of [
      "nextActions",
      "onOpenAction",
      "onSnooze",
      "assignOwner",
      "escalate",
      "rebaseline",
      "reschedule",
      "onMarkDone",
      "onClearBlocker",
      "onCreateTask",
      "onDraftMessage",
    ]) {
      expect(p, `missing threaded action-center prop: ${key}`).toHaveProperty(key);
    }
  });

  it("threads the AI orchestration + activity props (Phase 3: use-ai-orchestration)", () => {
    const p = captured.props!;
    for (const key of ["dispatcher", "aiAnalysis", "logActivity", "activityLog", "guides"]) {
      expect(p, `missing threaded prop: ${key}`).toHaveProperty(key);
    }
  });
});
