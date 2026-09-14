// Pins that a popout window cannot commit BUDGET edits.
//
// ★★★ WHY THIS EXISTS AS A BEHAVIOURAL TEST AND NOT A SOURCE SCAN. Nearly every
// mutating handler task-manager threads to WorkspaceSection is routed through
// `guardEdit` (`makeEditGuard(isPopout, …)`), which no-ops the call and toasts;
// the AI dispatcher instead guards itself with its own `isReadOnly` throws.
// `onChangeBudgets` did NEITHER, while `budget` sits in `POPOUT_TABS` and
// `budget-panel.tsx` gates its period cells on `mirror` (budget-follows-plan)
// and never on `isPopout` — so the cells OF A NON-MIRRORED ROW were editable in
// a popout. ★ That four-word qualifier is load-bearing and a previous revision
// dropped it: with budget-follows-plan on and a resourced row, the cells are
// read-only and the bug is unreachable.
// `read-only-guard.test.ts` proves the guard WORKS; nothing proved which
// handlers are WIRED through it, which is where the defect lived.
//
// ★★★ SEVERITY — THIS PARAGRAPH HAS NOW BEEN WRONG THREE TIMES RUNNING, SO
// READ THE QUALIFIERS AND RE-DERIVE BEFORE QUOTING IT. v1 said the popout
// "committed a real workspace write": false — `use-storage-backend.ts` returns
// early from the save effect when `isPopout`, and `canSend = !args.isPopout`
// disables every outbound `useBroadcastSync`. v2 over-corrected to "never
// storage … all discarded on close". v3 corrected THAT by naming the activity
// log: per-device `localStorage`, written by `use-activity-log` with no
// `isPopout` check, so a popout Ctrl+Z persisted a line outliving the window.
// ★★★ v3 IS FALSE TOO, AND WAS ALREADY FALSE WHEN IT WAS WRITTEN.
// `c2e7958b` (2026-08-15) made the log WORKSPACE state and deleted both
// effects plus the `clearActivityLog` wipe; `use-activity-log.ts`'s own header
// says so and forbids reintroducing a local mirror. Persistence is the save
// effect in `use-storage-backend.ts`, which returns early on `isPopout` and
// names §91 at that very line as the writer that used to escape it. Accurate
// statement TODAY: no PERSISTED write escapes a popout — the storage save and
// BroadcastChannel are both `isPopout`-gated, and the one non-workspace store
// that was not is gone; what the unguarded paths below still buy is
// popout-LOCAL state. open-followups.md §91 carries the same correction and
// the severity drop that follows from it. ★★ Every revision made the SAME mistake, not three
// different ones: it inherited the previous one's store instead of re-deriving
// it. Scope a claim to the store it is true of, and check that store still
// exists.
//
// ★★ The observable is the UNDERLYING `commitBuckets`, not the workspace state:
// buckets reach the panel through `useWorkspace()` rather than a captured prop,
// so there is no prop to diff. Mocking the hook puts the assertion exactly at
// the seam that was broken.
//
// ★★★ `onChangeBudgets` IS SAFE TO WRAP ONLY BECAUSE `commitBuckets` RETURNS
// VOID. That is why it is NOT wrapped: task-manager passes `isPopout ? undefined :
// handleCreateResource` instead, and `ResourcePicker` hides its "+ Add" row
// when the callback is absent. A SECOND route reached the resource editor from
// a popout — the task form's "+" address-book button — and is closed the same
// way, with `AppModals` refusing to render `ResourceEditModal` in a popout at
// all (open-followups §90, every route pinned below).
//
// ★★ A THIRD unguarded path, same class, also still open: `onCaptureRaidBulk` /
// `onCaptureUndo` / `onCaptureFieldEdit` are unwrapped and `useUndoHotkey` is
// mounted unconditionally, while only the visible undo BUTTON is popout-gated.
// So a RAID popout can bulk-apply (capturing a real undo entry while every
// per-row save is guarded away), then Ctrl+Z restores it — an unguarded write
// reachable through an affordance that is invisible. Same popout-local blast
// radius as the above. Not fixed here; a gate on the hotkey is the likely fix.
//
// ★ This rationale lives HERE and not at the call site because
// `task-manager.tsx` is on the file-size ratchet (baselined at 2972 lines);
// nine lines of comment there failed `size:check`, and raising the baseline to
// hold a comment would be widening a gate to make a pipeline pass.
// ★ `act` from testing-library, NOT from react: the bare react export logs
// "The current testing environment is not configured to support act(...)" to
// stderr on every call, which is exactly the noise that teaches people to stop
// reading stderr.
import { act, render, screen } from "@testing-library/react";
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

const capturedModals: { props: Record<string, unknown> | null } = { props: null };
vi.mock("./app-modals", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./app-modals")>();
  const RealAppModals = actual.AppModals;
  return {
    ...actual,
    AppModals: (props: Parameters<typeof RealAppModals>[0]) => {
      capturedModals.props = props as unknown as Record<string, unknown>;
      return <RealAppModals {...props} />;
    },
  };
});

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
  capturedModals.props = null;
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

const ADA = { id: 1, firstName: "Ada", lastName: "L", roleId: null, utilizationMode: "percent", utilization: {} };

describe("popout read-only guard — resource creation (open-followups §90)", () => {
  // ★ Positive controls first: every route below is proven LIVE in the main
  //  window by the same call on the same mount path, so each popout absence
  //  assertion is not vacuous.
  it("main window: passes onCreateResource and onAddAssigneeToAddressBook", async () => {
    await mountAt("/");
    expect(typeof captured.props!.onCreateResource).toBe("function");
    expect(typeof capturedModals.props!.onCreateResource).toBe("function");
    expect(typeof capturedModals.props!.onAddAssigneeToAddressBook).toBe("function");
  }, 45000);

  it("popout: passes NO onCreateResource and NO onAddAssigneeToAddressBook", async () => {
    await mountAt("/?popout=raid");
    // ★ Unlike onChangeBudgets, the props DISAPPEAR: `makeEditGuard` would
    // widen `number` to `number | undefined`, ResourcePicker already hides its
    // "+ Add" row when the callback is absent, and TaskFormFields now hides the
    // "+" address-book button the same way.
    expect(captured.props!.onCreateResource).toBeUndefined();
    expect(capturedModals.props!.onCreateResource).toBeUndefined();
    expect(capturedModals.props!.onAddAssigneeToAddressBook).toBeUndefined();
  }, 45000);

  it("main window: the address-book route opens a NEW-resource editor (positive control for route b)", async () => {
    await mountAt("/");
    const addToBook = capturedModals.props!.onAddAssigneeToAddressBook as (name: string, email: string) => void;
    act(() => addToBook("Ada Lovelace", "ada@x.com"));
    expect(capturedModals.props!.editingResource).toMatchObject({ isNew: true });
  }, 45000);

  it("main window: onEditResource opens the resource editor (positive control for the Part 7 pin)", async () => {
    await mountAt("/");
    const onEditResource = captured.props!.onEditResource as (r: unknown) => void;
    act(() => onEditResource(ADA));
    expect(capturedModals.props!.editingResource).toMatchObject({ isNew: false });
  }, 45000);

  it("popout: onEditResource opens no resource editor (spec Part 7 popout pin)", async () => {
    await mountAt("/?popout=resources");
    const onEditResource = captured.props!.onEditResource as (r: unknown) => void;
    act(() => onEditResource(ADA));
    expect(capturedModals.props!.editingResource ?? null).toBeNull();
  }, 45000);
});
