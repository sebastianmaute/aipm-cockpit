// ★★★ THE ONLY PLACE THE `"user"` ACTOR CAN BE PINNED, and that is a
// consequence of the design rather than a convenience.
//
// Most entity hooks log GENERIC kinds (`change.created`, `stakeholder.created`)
// that the chat dispatcher writes too, so none of them names its own actor —
// `task-manager` stamps at the WIRING and threads the result (see the "who names
// the actor" rule on `useActivityLog`). A leaf-level test therefore CANNOT see
// the actor: `use-change-log.test.tsx` passes its own `logActivity` spy and
// would stay green with every thread in task-manager reverted to the actor-less
// logger — which is exactly the defect this suite exists for. The assertion has
// to sit above the wiring, so it mounts the real TaskManager and drives the real
// handlers it threads into WorkspaceSection.
//
// ★★ ANTI-VACUITY: each test records `activityLog.length` BEFORE acting and
// asserts on the entry at that index, never on `at(-1)` of a log it did not
// grow. A handler that silently no-ops (a `guardEdit` block, a sanitizer reject)
// would otherwise leave the previous test's entry in place and pass.
//
// ★★★ MOUNTS PER TEST, NOT ONCE — and this is not a style choice. A `beforeAll`
// mount is DEAD after the first test: `vitest.setup.ts` calls RTL `cleanup()` in
// an `afterEach`, so the tree unmounts and `captured.props` freezes at whatever
// the last render produced. Written that way first, this file went 1 passed / 3
// failed with three EMPTY appends — a failure that reads like a broken stamp and
// is actually a dead mount. (The neighbouring characterization suite gets away
// with `beforeAll` because it only READS the frozen prop bag; anything that has
// to re-render cannot.) The mount is cheap — the 28s this file takes is module
// transform, paid once; all four tests together run in well under a second.
// ★ Per-test mounts also make it order-independent, which `test:shuffle`
//   requires — it shuffles tests WITHIN a file, not just file order.
import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActivityEntry } from "./activity-log";
import type { ChangeItem, Stakeholder } from "./types";
import { __resetMintStateForTests } from "./id-mint-session";

const captured: { props: Record<string, unknown> | null } = { props: null };
vi.mock("./workspace-section", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./workspace-section")>()),
  WorkspaceSection: (props: Record<string, unknown>) => {
    captured.props = props;
    return <div data-testid="ws-section-mock" />;
  },
}));

import TaskManager from "./task-manager";

function props(): Record<string, unknown> {
  if (!captured.props) throw new Error("WorkspaceSection never rendered");
  return captured.props;
}

function log(): readonly ActivityEntry[] {
  return props().activityLog as readonly ActivityEntry[];
}

/** Run `fn`, then return every entry it appended. Empty ⇒ the handler no-opped,
 *  which every caller below asserts against. */
function appended(fn: () => void): readonly ActivityEntry[] {
  const before = log().length;
  act(() => {
    fn();
  });
  return log().slice(before);
}

describe("task-manager stamps the actor on the loggers it threads", () => {
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
    render(<TaskManager />);
    await screen.findByTestId("ws-section-mock");
  }, 45000); // heavy TaskManager mount — headroom over the 20s hookTimeout

  // Converted site #1 — `use-change-log.ts`, reached through the real
  // `useChangeLog({ logActivity: logActivityUser })` thread.
  it('stamps "user" on a change created through the threaded handler', () => {
    const save = props().handleSaveChange as (item: ChangeItem, isNew?: boolean) => void;
    const entries = appended(() =>
      save({ id: 0, title: "Re-scope phase 2", linkedTaskIds: [] } as unknown as ChangeItem, true),
    );
    expect(entries).toHaveLength(1);
    expect(entries[0].kind).toBe("change.created");
    expect(entries[0].actor).toBe("user");
  });

  // Converted site #2 — a DIFFERENT file (`use-stakeholders.ts`) on a different
  // thread, so a fix applied to one hook's wiring alone cannot satisfy both.
  it('stamps "user" on a stakeholder created through the threaded handler', () => {
    const save = props().handleSaveStakeholder as (item: Stakeholder, isNew?: boolean) => void;
    const entries = appended(() =>
      save({ id: 0, name: "Dana Okafor" } as unknown as Stakeholder, true),
    );
    expect(entries).toHaveLength(1);
    expect(entries[0].kind).toBe("stakeholder.created");
    expect(entries[0].actor).toBe("user");
  });

  // ★★ The CONTROL, and it is load-bearing: without it a `logActivityAs` that
  // ignored its argument and hard-coded `"user"` would pass both tests above.
  // The same contract carries the AI channel, so pin that the two disagree.
  it('keeps the AI channel distinct — logActivityAs("ai") is not user-stamped', () => {
    const logAs = props().logActivityAs as (
      actor: "user" | "ai" | "integration",
      kind: string,
      ...args: (string | number)[]
    ) => void;
    const entries = appended(() => logAs("ai", "task.updated", 4242, "From the assistant"));
    expect(entries).toHaveLength(1);
    expect(entries[0].actor).toBe("ai");
  });

  // ★ `logActivityChanges` is a SEPARATE wrapper (`logActivityChangesUser`) with
  // its own thread, so stamping only the plain one leaves every field-diff entry
  // unattributed. An update needs a row to exist first — create, then edit.
  it('stamps "user" on the field-diff variant too', () => {
    // ★★ RE-READ the handler between the two calls. `handleSaveChange` closes
    // over the `changes` array of the render that produced it, so the create's
    // handler cannot see the row it just added — an update through it finds no
    // `previous`, takes `use-change-log`'s vanished-row branch and returns
    // WITHOUT logging. That is a silent no-op, and the length check below is
    // what turns it into a failure instead of a pass.
    const saveOf = () => props().handleSaveChange as (i: ChangeItem, isNew?: boolean) => void;
    const created = appended(() =>
      saveOf()({ id: 0, title: "Add a vendor", linkedTaskIds: [] } as unknown as ChangeItem, true),
    );
    expect(created).toHaveLength(1);
    const id = Number(created[0].args[0]);
    const updated = appended(() =>
      saveOf()({ id, title: "Add two vendors", linkedTaskIds: [] } as unknown as ChangeItem, false),
    );
    expect(updated).toHaveLength(1);
    expect(updated[0].kind).toBe("change.updated");
    expect(updated[0].actor).toBe("user");
    // The diff is what distinguishes this path from the plain logger — assert it
    // survived, or the test would pass against a fallback to `logActivity`.
    expect(updated[0].changes?.length ?? 0).toBeGreaterThan(0);
  });
});
