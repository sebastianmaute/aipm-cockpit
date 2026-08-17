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
// to re-render cannot.) The mount itself is cheap, and most of this file's wall
// clock is module transform + import, paid once.
// ★★ THE TESTS ARE NOT CHEAP THOUGH, and an earlier revision of this line claimed
// "all four tests together run in well under a second" — false twice over. There
// are EIGHT tests, not four, and the four §154 ones are dominated by REAL debounce
// waits by construction (see the real-timers note below), with another full wait
// added per test by the priming step in `beforeEach`. Measure before quoting a
// number here; the last one was invented and survived review:
//   npx vitest run src/app/task-manager.activity-actor.test.tsx --reporter=dot
// ★ Per-test mounts also make it order-independent, which `test:shuffle`
//   requires — it shuffles tests WITHIN a file, not just file order.
import { act, render, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import type { Dispatch, SetStateAction } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActivityEntry } from "./activity-log";
import type { ChangeItem, Stakeholder } from "./types";
import type { Settings } from "./settings-types";
import type { ToolDispatcher } from "./chat-tools";
import { SETTINGS_LOG_DEBOUNCE_MS } from "./settings-log";
import { useSettings } from "./use-settings";
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

// ★★ A NON-AI settings writer, and there is no simpler way to be one. TaskManager
// exposes no settings setter on the props bag, so the only public path to a change
// it did not make itself is a SECOND `useSettings()` instance: its broadcast effect
// fans the new value out to every listener, TaskManager's included. That is exactly
// the shape of a real user edit from the Settings pane — a settings identity change
// arriving with no AI credit behind it.
// ★ The capture is in an EFFECT, not the render body: `react-hooks/immutability`
// is fatal on a render-phase write to module scope, and CI runs eslint at
// `--max-warnings=0`. The mount is awaited before any test body runs, so the
// setter is in place by then.
// ★★ `hydrated` rides along because MOUNT IS NOT HYDRATION — see the beforeEach.
const probe: { set: Dispatch<SetStateAction<Settings>> | null; hydrated: boolean } = {
  set: null,
  hydrated: false,
};
function SettingsProbe() {
  const { setSettings, hydrated } = useSettings();
  useEffect(() => {
    probe.set = setSettings;
  }, [setSettings]);
  useEffect(() => {
    probe.hydrated = hydrated;
  }, [hydrated]);
  return null;
}
function userSettingsChange(): void {
  if (!probe.set) throw new Error("SettingsProbe never rendered");
  probe.set((s) => ({ ...s, expertMode: !s.expertMode }));
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

// ★★★ THE CONSUMER SIDE OF §154, and its absence is why two defects shipped in the
// fix that closed it. `use-chat-dispatcher.test.tsx` pins that credits are ISSUED —
// call counts on `onSettingsLoggedByAi` — and nothing anywhere pinned what the
// counter is FOR: that a user's own settings change still reaches the log. Both
// tests below assert ROWS, never credits, because the credit count was exactly the
// thing that looked right while the behaviour was wrong.
describe("§154 — an AI settings write suppresses its OWN duplicate row and no other", () => {
  beforeEach(async () => {
    window.localStorage.clear();
    __resetMintStateForTests();
    captured.props = null;
    probe.set = null;
    probe.hydrated = false;
    window.localStorage.setItem(
      "aipm-cockpit:projects",
      JSON.stringify({
        projects: [{ id: "p1", name: "Seed", code: "SEED", storageConfig: { kind: "browser" } }],
        currentProjectId: "p1",
      }),
    );
    render(
      <>
        <TaskManager />
        <SettingsProbe />
      </>,
    );
    await screen.findByTestId("ws-section-mock");

    // ★★★ MOUNT IS NOT HYDRATION, and reading it as such made this file flake ~40%
    // (measured: 3 red in 7 runs on UNMUTATED code, 2 of 3 at CI's own pinned seed —
    // so `unit-tests` AND `unit-tests-shuffled`, both BLOCKING, would have gone red
    // on a good branch). `findByTestId` resolves the moment TaskManager RENDERS, which
    // says nothing about either `useSettings()` instance having loaded from
    // localStorage. Three separate gates then swallow an early change and yield zero
    // rows — `use-settings`'s broadcast effect and TaskManager's log effect both
    // early-return on `!hydrated`, and `settingsInitialRef` eats a change that batches
    // with the hydration flip. The two tests that settled first never failed; the two
    // that wrote immediately were the only ones that did.
    await waitFor(() => {
      expect(probe.hydrated).toBe(true);
    });

    // ★★★ AND WAITING ON `hydrated` IS STILL NOT ENOUGH — it is the PROBE's flag, not
    // TaskManager's, and they are independent `useSettings()` instances racing the same
    // load. So prime the real path end to end: drive one throwaway user change and
    // require a row out of it. That asserts the precondition every test below depends
    // on (a settings change reaches the log) rather than approximating it with a sleep.
    // ★ A fixed `settle(300)` was measured to work and is deliberately NOT used: it
    // fixes the symptom at whatever margin the machine happened to have, which is how
    // a flake fix ends up weaker than the flake. This waits for the event itself.
    const primed = log().length;
    act(() => {
      userSettingsChange();
    });
    await settle(SETTINGS_LOG_DEBOUNCE_MS + 200);
    expect(log().length).toBeGreaterThan(primed);
  }, 45000);

  // ★★★ REAL TIMERS, DELIBERATELY — `vi.useFakeTimers()` CANNOT reach this debounce
  // and a test using it passes vacuously (measured: zero rows either way). The
  // logger is built in a `useRef` initializer during TaskManager's first render,
  // and `createSettingsLogger`'s `setTimeoutFn` parameter DEFAULTS at call time, so
  // it closes over whatever `setTimeout` was global at MOUNT. Installing fake timers
  // afterwards swaps the global the logger no longer consults. Each wait below is
  // therefore a real ~1.6s.
  async function settle(ms: number): Promise<void> {
    await act(async () => {
      await new Promise((r) => setTimeout(r, ms));
    });
  }

  /** Actor-less `settings.updated` rows appended by `fn` — the debounced effect's
   *  output, and the only thing these tests are about. */
  async function actorlessSettingsRows(fn: () => void): Promise<readonly ActivityEntry[]> {
    const before = log().length;
    fn();
    await settle(SETTINGS_LOG_DEBOUNCE_MS + 200);
    return log()
      .slice(before)
      .filter((e) => e.kind === "settings.updated" && e.actor === undefined);
  }

  // ★★★ THE LEAK. Credits are issued PER TOOL CALL and consumed PER EFFECT RUN, and
  // React batches both `setSettings` calls of one assistant turn into ONE render —
  // so two AI writes produce two credits against a single run. While the effect
  // DECREMENTED, the surplus outlived the turn and silently ate the user's next row.
  // Two writes in one `act()` is not a contrivance: `chat-panel.tsx` runs every
  // `tool_use` block of one message in a `for … await runTool(…)` loop, and the
  // awaits between them are microtasks, which React batches.
  it("logs the user's next settings change after the AI wrote TWO in one batch", async () => {
    const d = props().dispatcher as ToolDispatcher;
    act(() => {
      d.updateSettings({ showViewHints: false });
      d.updateSettings({ hideExternalTasks: true });
    });
    // Drain the AI turn's own effect run before measuring the user's.
    await settle(SETTINGS_LOG_DEBOUNCE_MS + 200);
    const rows = await actorlessSettingsRows(() => {
      act(() => {
        userSettingsChange();
      });
    });
    expect(rows).toHaveLength(1);
  });

  // ★★ THE OTHER DIRECTION — an AI write landing INSIDE the user's debounce window.
  // A per-run effect cleanup fires BEFORE the next effect body, so it cancelled the
  // user's pending row and then early-returned on the credit without re-arming: the
  // user's change vanished outright. The cleanup is unmount-scoped for this reason.
  it("keeps a user's pending row when an AI write lands inside the debounce window", async () => {
    const d = props().dispatcher as ToolDispatcher;
    const before = log().length;
    act(() => {
      userSettingsChange();
    });
    await settle(Math.floor(SETTINGS_LOG_DEBOUNCE_MS / 3));
    act(() => {
      d.updateSettings({ showViewHints: false });
    });
    await settle(SETTINGS_LOG_DEBOUNCE_MS + 200);
    const rows = log()
      .slice(before)
      .filter((e) => e.kind === "settings.updated" && e.actor === undefined);
    expect(rows).toHaveLength(1);
  });

  // ★★ THE ANTI-VACUITY CONTROL for `settle` itself. Both tests above assert a row
  // EXISTS, so they would also fail if the harness never logged anything at all —
  // but this one asserts an ABSENCE, and an absence test over a broken harness is
  // vacuous. Pin that a plain user change DOES produce exactly one row through the
  // same helper, so zero below means "suppressed", not "nothing works".
  it("logs exactly one actor-less row for a plain user settings change", async () => {
    const rows = await actorlessSettingsRows(() => {
      act(() => {
        userSettingsChange();
      });
    });
    expect(rows).toHaveLength(1);
  });

  // ★ THE CONTROL. Without it the tests above pass against an effect that ignores
  // credits entirely and logs every change — which would reopen §154 itself.
  it("still suppresses the duplicate for a SINGLE AI settings write", async () => {
    const d = props().dispatcher as ToolDispatcher;
    const rows = await actorlessSettingsRows(() => {
      act(() => {
        d.updateSettings({ showViewHints: false });
      });
    });
    expect(rows).toHaveLength(0);
  });
});
