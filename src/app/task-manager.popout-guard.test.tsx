// Pins that a popout window cannot commit BUDGET edits.
//
// ★★★ WHY THIS EXISTS AS A BEHAVIOURAL TEST AND NOT A SOURCE SCAN. Every other
// mutating handler task-manager threads to WorkspaceSection is routed through
// `guardEdit` (`makeEditGuard(isPopout, …)`), which no-ops the call and toasts.
// `onChangeBudgets` was NOT, while `budget` sits in `POPOUT_TABS` and
// `budget-panel.tsx` gates its period cells on `mirror` (budget-follows-plan)
// and never on `isPopout` — so the cells of a non-mirrored row were editable in
// a popout and typing in one committed a real workspace write, plus an undo
// entry and an activity-log line, from a window every other tab treats as a
// read-only mirror. `read-only-guard.test.ts` proves the guard WORKS; nothing
// proved which handlers are WIRED through it, which is where the defect lived.
//
// ★★ The observable is the UNDERLYING `commitBuckets`, not the workspace state:
// buckets reach the panel through `useWorkspace()` rather than a captured prop,
// so there is no prop to diff. Mocking the hook puts the assertion exactly at
// the seam that was broken.
import { render, screen } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetMintStateForTests } from "./id-mint-session";

const { commitSpy } = vi.hoisted(() => ({ commitSpy: vi.fn() }));

vi.mock("./use-budget-buckets", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./use-budget-buckets")>()),
  useBudgetBuckets: () => ({ commitBuckets: commitSpy }),
}));

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
    "aipm-cockpit:projects",
    JSON.stringify({
      projects: [{ id: "p1", name: "Seed", code: "SEED", storageConfig: { kind: "browser" } }],
      currentProjectId: "p1",
    }),
  );
}

/** `WorkspaceTabProvider` reads the popout flag from the URL ONCE, in a lazy
 *  `useState` initialiser, so the URL must be set before the mount. */
async function mountAt(search: string) {
  window.localStorage.clear();
  captured.props = null;
  commitSpy.mockClear();
  seedRegistry();
  window.history.replaceState(null, "", search);
  render(<TaskManager />);
  await screen.findByTestId("ws-section-mock");
}

const NEXT_BUCKETS = [{ id: 1, label: "Build", roleId: null, resourceIds: [], periods: {} }];

beforeEach(() => {
  __resetMintStateForTests();
});
afterEach(() => {
  window.history.replaceState(null, "", "/");
});

describe("popout read-only guard — budget commits", () => {
  // ★★★ THE POSITIVE CONTROL COMES FIRST AND IS LOAD-BEARING. The popout test
  // below asserts that nothing happened, which is vacuous unless something
  // proves the call would otherwise land. This test IS that proof: same handler,
  // same arguments, same mount path, only the URL differs.
  it("commits in the main window", async () => {
    await mountAt("/");
    const onChangeBudgets = captured.props!.onChangeBudgets as (b: unknown[]) => void;
    expect(typeof onChangeBudgets).toBe("function");

    act(() => onChangeBudgets(NEXT_BUCKETS));

    expect(commitSpy).toHaveBeenCalledTimes(1);
    expect(commitSpy).toHaveBeenCalledWith(NEXT_BUCKETS);
  }, 45000);

  it("does NOT commit from a budget popout", async () => {
    await mountAt("/?popout=budget");
    const onChangeBudgets = captured.props!.onChangeBudgets as (b: unknown[]) => void;
    expect(typeof onChangeBudgets).toBe("function");

    act(() => onChangeBudgets(NEXT_BUCKETS));

    // ★ The handler is still PRESENT and still callable — the guard's contract
    // is that the affordance stays visible and the commit is intercepted, not
    // that the prop disappears. Asserting `toBeUndefined()` here would pass for
    // the wrong reason and would also pin the wrong design.
    expect(commitSpy).not.toHaveBeenCalled();
  }, 45000);
});
