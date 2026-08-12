// @characterization — pins the task-manager → WorkspaceSection prop contract.
// The Phase 3 decomposition is DONE: the calendar wiring, Action-Center
// handlers, AI orchestration, dual-header assembly, and pull-summary modals now
// live in use-calendar-integrations / use-action-center-handlers /
// use-ai-orchestration / shell-chrome (buildShellChrome) / calendar-summary-modals.
// This suite proved (and now guards) that those move-only extractions kept the
// load-bearing prop KEYS reaching the child. It MAY be updated freely when a diff
// is understood (e.g. the future calendar prop-bag consolidation renames these) —
// it is NOT a golden fixture. Coarse on purpose: a tripwire, not a spec.
import { render, screen, within } from "@testing-library/react";
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

// Capture the props task-manager threads into AppModals. The budgetLink prop is
// OPTIONAL at every hop down to TaskFormFields, so dropping it here removes the
// task editor’s Budget bucket field with no type error and no throw.
const capturedModals: { props: Record<string, unknown> | null } = { props: null };
vi.mock("./app-modals", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./app-modals")>()),
  AppModals: (props: Record<string, unknown>) => {
    capturedModals.props = props;
    return <div data-testid="app-modals-mock" />;
  },
}));

// ★ NOT captured here: TasksSection. This suite mounts TaskManager on its
//   DEFAULT view (dashboard), and the modern shell renders only the active view,
//   so the pane never mounts and a mock of it captures nothing — measured, not
//   assumed. Its prop contract is therefore untested from this side; see the
//   `colWidths` note in `use-column-manager.test.ts` for what that leaves open.
import TaskManager from "./task-manager";

function seedRegistry() {
  window.localStorage.setItem(
    "aipm-cockpit:projects",
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
  it("threads budgetLink into AppModals (the task-editor budget-bucket field)", () => {
    const link = capturedModals.props!.budgetLink as
      | { buckets: unknown[]; bucketId: number | null; onChange: unknown }
      | undefined;
    // The budget module is enabled by default, so this must be a real bag —
    // asserting only that the KEY exists would pass for an undefined value.
    expect(link).toBeDefined();
    expect(Array.isArray(link!.buckets)).toBe(true);
    expect(typeof link!.onChange).toBe("function");
  });
});

// Isolated from the shared block above: it queries the live DOM (`screen`),
// not the captured-props objects the other tests assert against. Those
// objects are plain JS and survive RTL's `afterEach(cleanup)` between tests,
// but a DOM query does not — `cleanup()` unmounts the ONE shared `beforeAll`
// render after the FIRST test in that block runs, so a DOM-querying test
// appended there would run against an empty document and pass (return null)
// regardless of whether the gate under test works. Own describe, own
// beforeAll, own mount — mirrors shell-chrome.test.tsx's pattern.
describe("@characterization task-manager → AI Assistant button gate", () => {
  beforeAll(async () => {
    window.localStorage.clear();
    seedRegistry();
    render(<TaskManager />);
    await screen.findByTestId("ws-section-mock");
  }, 45000); // heavy TaskManager mount — headroom over the 20s hookTimeout under coverage load

  it("hides the AI Assistant button in the modern TopBar when AI is off by default (task-manager.tsx: aiAssistantOpener(settings.ai, ...))", () => {
    // Seeded/default settings leave AI off (defaultAiConfig has no `enabled`
    // key → falsy, and `apiKey` is ""), so isAiEnabled(settings.ai) is false
    // and aiAssistantOpener(settings.ai, ...) returns undefined. Unlike the
    // WorkspaceSection/AppModals props above, ModernShell/TopBar are NOT
    // mocked in this suite's mount, so this reads the real DOM the default
    // (modern, non-popout) layout renders.
    //
    // Scoped to the TopBar's `<header>` (role "banner" — the sole top-level
    // header in the modern, non-popout tree; WorkspaceSection is mocked out
    // so its own "AI Assistant" tab label (i18n `tabChat`) never mounts
    // here, and sidebar-nav has no control sharing this accessible name) —
    // querying unscoped risks a "found multiple elements" throw the moment
    // any other live surface happens to share the same accessible name,
    // which would fail this test for the wrong reason.
    const header = screen.getByRole("banner");
    expect(within(header).queryByRole("button", { name: "AI Assistant" })).toBeNull();
  });

  // The "enabled → button present" half of this gate is deliberately NOT
  // re-verified here with a second full TaskManager mount (this file's own
  // beforeAll comment above: "heavy TaskManager mount"). It is already
  // covered at the pure-logic level by settings-types.test.ts's
  // aiAssistantOpener tests, at the classic-mount level by
  // shell-chrome.test.tsx's enabled case (the identical call against a real
  // settings object), and at the modern-mount level by top-bar.test.tsx
  // (ModernShell forwards onOpenAiAssistant straight to TopBar, which
  // renders the button whenever the prop is defined — see modern-shell.tsx).
  // The only slice those three don't reach is whether task-manager.tsx's own
  // one-line call site still reads `aiAssistantOpener(settings.ai, ...)` —
  // this test's disabled-case assertion already fails hard if that line
  // reverts to an unconditional opener (or otherwise always shows the
  // button).
});
