// Pins that the Resources "clear unlinked" route ARMS the one-shot
// destructive-save bypass, and that it does so ONLY when a record actually went.
//
// ★★★ WHY THIS ROUTE NEEDS ITS OWN FILE. `onClearUnlinked` drops an UNBOUNDED
// number of absence and shift rows on a single confirm click — every row whose
// free-text assignee matches the unlinked workload row. `absences` and `shifts`
// are both COUNTED slices, so this handler can trip the save-time
// mass-deletion guard (`isMassDeletion`) by itself and have the user's own
// deliberate cleanup refused. Its arming lives in `task-manager.tsx` rather
// than in an entity hook, so no leaf harness can see it: the assertion has to
// sit above the wiring, which is why this file mounts the real TaskManager and
// drives the real prop it threads.
//
// ★★ AND WHY THE LEAK CASE IS SPLIT INTO ITS OWN `it`. The bypass is ONE-SHOT.
// Arming it on a no-op call does not fail anything here and now — it leaves the
// bypass armed for whatever save comes next, which is then permitted to wipe.
// A fix that over-arms is therefore a data-loss VECTOR wearing a data-loss
// fix's clothes, and vitest aborts a block at its first failing hard assertion,
// so the two claims must not share one.
//
// ★★ The tasks/RAID writes in the same handler are field EDITS (they `map`), so
// they remove no records and must not contribute to the signal. Nothing below
// observes that directly; what it observes is that a call matching no absence
// and no shift does not arm.
import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Absence, Shift } from "./types";
import { __resetMintStateForTests } from "./id-mint-session";

// The arming spy. `allowDestructiveSave` is produced by `useStorageBackend` and
// only writes a ref inside that hook, so there is no observable state to assert
// on — the seam has to be wrapped. The wrapper still calls the REAL function,
// so the guard's own behaviour is unchanged.
// ★ `stableArm` is module scope, NOT rebuilt per render: `use-register-tools.ts`
// lists `allowDestructiveSave` in an exhaustive `useMemo` deps array that
// assumes it is identity-stable, and handing that array a fresh function every
// render would make this harness perturb the tree it is measuring.
const armSpy = vi.fn();
let realArm: (() => void) | null = null;
const stableArm = (): void => {
  armSpy();
  realArm?.();
};

vi.mock("./use-storage-backend", async (importOriginal) => {
  const orig = await importOriginal<typeof import("./use-storage-backend")>();
  return {
    ...orig,
    useStorageBackend: (args: Parameters<typeof orig.useStorageBackend>[0]) => {
      const real = orig.useStorageBackend(args);
      realArm = real.allowDestructiveSave;
      return { ...real, allowDestructiveSave: stableArm };
    },
  };
});

// Probe standing in for the heavy pane: captures the prop bag AND the workspace
// setters, so a test can seed absences/shifts the way a real load would.
const captured: { props: Record<string, unknown> | null } = { props: null };
let setAbsencesRef: ((v: readonly Absence[]) => void) | null = null;
let setShiftsRef: ((v: readonly Shift[]) => void) | null = null;

vi.mock("./workspace-section", async (importOriginal) => {
  const { useWorkspace } = await import("./workspace-context");
  return {
    ...(await importOriginal<typeof import("./workspace-section")>()),
    WorkspaceSection: (props: Record<string, unknown>) => {
      captured.props = props;
      const ws = useWorkspace();
      setAbsencesRef = ws.setAbsences;
      setShiftsRef = ws.setShifts;
      return <div data-testid="ws-section-mock" />;
    },
  };
});

import TaskManager from "./task-manager";

type UnlinkedRow = { display: string; email: string; firstName: string; lastName: string };

/** ★★ RE-READ per call. `workspaceProps` is a plain object rebuilt every render
 *  and `onClearUnlinked` closes over THAT render's `absences`/`shifts`, so a
 *  handler grabbed before the seed would compute its signal from empty arrays
 *  and never arm — a false red that reads like a missing arming line. */
function clearUnlinked(): (row: UnlinkedRow) => void {
  if (!captured.props) throw new Error("WorkspaceSection never rendered");
  return captured.props.onClearUnlinked as (row: UnlinkedRow) => void;
}

const row = (display: string): UnlinkedRow => ({ display, email: "", firstName: "", lastName: "" });

const absence = (id: number, assignee: string): Absence => ({
  id, assignee, startDate: "2026-03-02", endDate: "2026-03-06", type: "vacation",
});
const shift = (id: number, assignee: string): Shift => ({
  id, assignee, hoursPerWeekday: [0, 8, 8, 8, 8, 8, 0],
});

// The two seeded strays carry DIFFERENT names so each filter can be driven on
// its own: clearing "Ghost Owner" removes an absence and no shift, clearing
// "Shift Only" removes a shift and no absence. Seeding one name for both would
// leave the `removesShift` half of the signal unexercised.
const ABSENCE_ONLY = "Ghost Owner";
const SHIFT_ONLY = "Shift Only";

describe("onClearUnlinked arms the destructive-save bypass", () => {
  beforeEach(async () => {
    window.localStorage.clear();
    __resetMintStateForTests();
    captured.props = null;
    window.localStorage.setItem(
      "aipm-cockpit:projects",
      JSON.stringify({
        projects: [{ id: "p1", name: "Seed", code: "SEED", storageConfig: { kind: "browser" } }],
        currentProjectId: "p1",
      }),
    );
    // ★★ MOUNTS PER TEST, never once: vitest.setup.ts calls RTL `cleanup()` in
    // an afterEach, so a `beforeAll` mount is unmounted and dead — the captured
    // prop bag would freeze and every seed after the first would be lost.
    render(<TaskManager />);
    await screen.findByTestId("ws-section-mock");
    act(() => {
      setAbsencesRef?.([absence(1, ABSENCE_ONLY)]);
      setShiftsRef?.([shift(1, SHIFT_ONLY)]);
    });
    // Cleared AFTER the mount + seed, so nothing the boot path happens to do
    // can be mistaken for the handler's own arming.
    armSpy.mockClear();
  }, 45000); // heavy TaskManager mount — headroom over the 20s hookTimeout

  it("onClearUnlinked arms once when it removed at least one record", () => {
    act(() => {
      clearUnlinked()(row(ABSENCE_ONLY));
    });
    expect(armSpy).toHaveBeenCalledTimes(1);
  });

  it("onClearUnlinked does NOT arm when nothing matched", () => {
    act(() => {
      clearUnlinked()(row("Nobody Here"));
    });
    expect(armSpy).not.toHaveBeenCalled();
    // POSITIVE CONTROL — mandatory. Without it this block passes identically
    // against a tree where the arming line was never written at all. It also
    // drives the SHIFT half of the signal, which the test above does not.
    act(() => {
      clearUnlinked()(row(SHIFT_ONLY));
    });
    expect(armSpy).toHaveBeenCalledTimes(1);
  });
});
