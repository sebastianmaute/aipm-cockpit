// ★★★ THE DEFECT HALF OF THE TIMELOG-GUARDRAIL SLICE, PINNED AT ITS ONLY CALL
// SITE. `reconcileInsights` takes a REQUIRED per-insight predicate so that a
// detector which can go dark cannot have its stored insights resolved as a
// fabricated win. That guard cannot be broken from INSIDE reconcile — and was
// entirely unpinned OUTSIDE it: measured on this branch, substituting a
// hardcoded four-type set at the `task-manager.tsx` call site left 31 files /
// 321 tests passing.
//
// ★★★ THIS FILE'S HEADER USED TO CLAIM "nothing but this file fails when the
// call site fabricates the set." That was true of the ONE mutant measured and
// FALSE as the general claim it reads as — and the gap it hid was the worst
// mutant of the three. Dropping `CORE_INSIGHT_TYPES` from the predicate passed
// BOTH tests this file originally had: the unevaluated case froze for its own
// reason and the evaluated case cleared for its own, while every CORE insight
// in the app silently became immortal — never resolved, never pruned — because
// no fixture here carried a core-typed insight. A test file's coverage claim is
// a claim about the FIXTURES, not about the assertions. The core tests below
// exist for exactly that mutant; do not delete them as "not about timelog".
//
// ★★★ IT ASSERTS THE FIELDS THE DEFECT WRITES, NEVER MERE SURVIVAL. The defect
// KEEPS the row and resolves it (`status: "resolved"` + `resolvedAt` + an
// `outcome` that `computeClearedOutcome` always writes as "improved"), so a
// presence-only assertion is green against exactly the bug it claims to catch —
// the same vacuity `reconcile.test.ts` records for its own mutant.
//
// ★★ BOTH DIRECTIONS LIVE HERE AND EACH IS THE OTHER'S ANTI-VACUITY CONTROL. A
// wiring that froze EVERYTHING would pass the freeze test alone; a wiring that
// evaluated everything would pass the clear test alone. The freeze test also
// asserts the ENABLED rule's fresh detection, which is what proves the daily
// roll was actually read from the actuals cache under the right project key —
// without that, a cache miss (empty `evaluated`, no violations) would satisfy
// the freeze assertion for entirely the wrong reason.
//
// ★ Seeding runs through the workspace CONTEXT setters rather than a storage
// backend: `insights` and `timelogLinks` are both plain context slices, and the
// pipeline under test reads them from render scope, so a context write
// exercises the same path a load would with none of the backend scaffolding.
import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { vi } from "vitest";
import type { Dispatch, SetStateAction } from "react";
import type { Insight } from "./insights/insight";
import type { TimelogDailyRoll, TimelogLinks } from "./timelog-types";
import { dailyKey } from "./timelog-types";
import { saveActualsCache } from "./timelog-actuals-store";
import { saveLandingState } from "./landing-state";

let setInsightsRef: Dispatch<SetStateAction<readonly Insight[] | undefined>> | null = null;
let setTimelogLinksRef: Dispatch<SetStateAction<TimelogLinks | undefined>> | null = null;

/** The stored baseline, whichever METRIC_FIELD this type keeps it under. A
 *  `function` declaration so the hoisted `vi.mock` factory below can close over
 *  it; the probe and `expectFrozen` share it so they cannot drift. */
function baselineCell(i: Insight): string {
  return `${i.metricAtAction?.count ?? i.metricAtAction?.current ?? "-"}`;
}

// Probe standing in for the heavy pane: one cell per insight, carrying exactly
// the four fields this file is about — the key, the status, the outcome
// direction and the resolution stamp — plus the baseline, so a "frozen" row is
// pinned as the SAME record rather than merely a row with the same key.
vi.mock("./workspace-section", async (importOriginal) => {
  const { useWorkspace } = await import("./workspace-context");
  return {
    ...(await importOriginal<typeof import("./workspace-section")>()),
    WorkspaceSection: () => {
      const ws = useWorkspace();
      setInsightsRef = ws.setInsights;
      setTimelogLinksRef = ws.setTimelogLinks;
      return (
        <div data-testid="ws-insights">
          {(ws.insights ?? [])
            .map(
              (i) =>
                `${i.key}|${i.status}|${i.outcome?.direction ?? "no-outcome"}` +
                // ★ `count` OR `current`: the baseline is stored under this
                // type's own METRIC_FIELD, and reading only `count` would print
                // "-" for every overdueTrend row — an unobservable baseline in
                // the one cell that exists to make the baseline observable.
                // Neither key may contain a comma; the row split depends on it.
                `|${i.resolvedAt ?? "no-resolvedAt"}|m${baselineCell(i)}`,
            )
            .join(",")}
        </div>
      );
    },
  };
});

import TaskManager from "./task-manager";

const PROJECT = "p1";
/** Mount + hook-capture budget: the first render pulls the whole task-manager
 *  tree through the vitest transform, which is genuinely slow. */
const MOUNT_MS = 40000;
/** The debounced insights effect waits INSIGHTS_RECONCILE_DEBOUNCE_MS (4s) of
 *  REAL time. Fake timers are deliberately not used: the effect sits behind
 *  settings hydration and an async storage mount, and faking the clock for one
 *  of those three makes the other two unreliable. */
const RECONCILE_MS = 20000;
const TEST_MS = 60000;

/** The rule left OFF in the policy below. Its stored insight must come back
 *  untouched: not evaluated is not the same as not violated. */
const OFF_KEY = "timelog:timelogCapPerEntry:7";
/** The ON rule, for a user the roll no longer carries. Clears ONLY when the
 *  roll still demonstrably covered the days it was about. */
const GONE_KEY = "timelog:timelogCapPerDay:8";
/** The ON rule's live violation, freshly detected from the seeded roll. */
const FRESH_KEY = "timelog:timelogCapPerDay:7";
/** An ON-rule insight stored BEFORE the violating-day fields existed. */
const NO_DATES_KEY = "timelog:timelogCapPerDay:9";
/** Core types — in `CORE_INSIGHT_TYPES`, nothing to do with TimeLog. Present
 *  because the fixture that omitted them let the drop-core mutant ship green. */
const CORE_KEY = "stalledWork:core";
const TREND_KEY = "overdueTrend";

/** The days the stored guardrail insights are about — deliberately FAR from the
 *  seeded roll's single August day, so a window covering one need not cover the
 *  other and the two cases cannot be confused. */
const VIOLATED = { firstViolationDate: "2026-02-03", lastViolationDate: "2026-02-11" };
/** Covers February AND the roll's own August day. */
const COVERING = { from: "2026-01-01", to: "2026-12-31" };
/** A later fetch that never looked at February — the "fetch Jan–Mar, act, then
 *  fetch Apr–Jun" sequence that resolved a stored insight as a clean win. */
const MOVED_ON = { from: "2026-04-01", to: "2026-06-30" };

/** ★ Only `timelogCapPerDay` is configured. `TimelogPolicy` is Partial by
 *  construction, so an unconfigured rule has NO key and `evaluateTimelogPolicy`
 *  never reports it evaluated. */
const links: TimelogLinks = {
  userLinks: [],
  projectLinks: [],
  policy: { timelogCapPerDay: { enabled: true, threshold: 8 } },
};

/** 12h on one day for TimeLog user 7 — over the 8h cap, so the ON rule fires.
 *  Nothing for user 8, so that rule's stored insight has nothing to re-detect. */
const roll: TimelogDailyRoll = {
  [dailyKey(7, "2026-08-24")]: { hours: 12, maxEntryHours: 12, entryCount: 2 },
};

/** ★★ `actedAt` is what makes these clearable at all — `clear()` branches on
 *  `hadUserAction`, which reads the STAMPS, not the status. `metricAtAction` is
 *  what makes the defect observable: without a baseline `clear()` resolves with
 *  NO outcome, and the fabricated-win half of the bug would be invisible. */
function acted(
  over: Pick<Insight, "id" | "key" | "type"> & {
    count: number;
    data?: Insight["data"];
    /** ★★ MUST be keyed by this type's `METRIC_FIELD`, which is NOT `count` for
     *  every type — `overdueTrend` measures `current`. A baseline under the
     *  wrong key leaves `baselineOf` undefined, and `clear()` then resolves with
     *  NO outcome: the row still says "resolved", so a status-only assertion
     *  passes while the fabricated-win half goes unobserved. */
    metricAtAction?: Insight["metricAtAction"];
  },
): Insight {
  return {
    id: over.id,
    key: over.key,
    type: over.type,
    severity: "medium",
    data: over.data ?? {
      person: "#7",
      count: over.count,
      worstHours: 14,
      threshold: 8,
      ...VIOLATED,
    },
    status: "acted",
    actedAt: "2026-08-01",
    firstSeenAt: "2026-07-01",
    lastSeenAt: "2026-07-20",
    occurrences: 4,
    metricAtAction: over.metricAtAction ?? { count: over.count },
  };
}

/** A guardrail insight of the ON rule, about the February days above. */
const goneInsight = acted({ id: 2, key: GONE_KEY, type: "timelogCapPerDay", count: 5 });
/** Same rule, same absence from the roll — but stored before the violating-day
 *  fields existed, so its coverage can never be established. */
const noDatesInsight = acted({
  id: 3,
  key: NO_DATES_KEY,
  type: "timelogCapPerDay",
  count: 6,
  data: { person: "#9", count: 6, worstHours: 14, threshold: 8 },
});
const coreInsight = acted({
  id: 4,
  key: CORE_KEY,
  type: "stalledWork",
  count: 7,
  data: { count: 7 },
});
const trendInsight = acted({
  id: 5,
  key: TREND_KEY,
  type: "overdueTrend",
  count: 9,
  data: { current: 9, prior: 4, delta: 5 },
  metricAtAction: { current: 9 },
});
const offInsight = acted({ id: 1, key: OFF_KEY, type: "timelogCapPerEntry", count: 3 });

/** The probe cell for one key, split on `|`. Throws (rather than returning
 *  undefined) so a missing row names itself and prints the whole cell text. */
function cellFor(key: string): string[] {
  const text = screen.getByTestId("ws-insights").textContent ?? "";
  const cell = text.split(",").find((c) => c.startsWith(`${key}|`));
  if (cell === undefined) throw new Error(`no insight cell for ${key} in: "${text}"`);
  return cell.split("|");
}

/** ★★★ FROZEN means the SAME RECORD, asserted field for field. The defect keeps
 *  the row and stamps it `resolved` + `resolvedAt` + an outcome
 *  `computeClearedOutcome` always writes as "improved", so any assertion weaker
 *  than this — "the row is still there", "it has the same key" — is green
 *  against exactly the bug it claims to catch. */
function expectFrozen(insight: Insight): void {
  expect(cellFor(insight.key)).toEqual([
    insight.key,
    "acted",
    "no-outcome",
    "no-resolvedAt",
    `m${baselineCell(insight)}`,
  ]);
}

/** RESOLVED means the clear path actually ran, outcome and stamp included. */
function expectResolved(key: string): void {
  const cell = cellFor(key);
  expect(cell[1]).toBe("resolved");
  expect(cell[2]).toBe("improved");
  expect(cell[3]).not.toBe("no-resolvedAt");
}

/** ★ Under the REAL project id, never "default": the reader keys on
 *  `currentProjectId ?? "default"`, the same key TimelogPanel writes under, and
 *  a reader that fell back would find nothing here. */
function seedCache(over: Partial<Parameters<typeof saveActualsCache>[1]> = {}): void {
  saveActualsCache(PROJECT, {
    fetchedAt: "2026-08-25T08:00:00.000Z",
    daily: roll,
    dailyWindow: COVERING,
    ...over,
  });
}

/** Mount, seed both context slices in ONE act (one re-render, one effect run),
 *  and wait for the debounced reconcile to have produced the fresh detection —
 *  which is also the proof that the roll was read under the right cache key. */
async function mountAndReconcile(insights: readonly Insight[]): Promise<void> {
  render(<TaskManager />);
  await screen.findByTestId("ws-insights", undefined, { timeout: MOUNT_MS });
  await waitFor(() => expect(typeof setTimelogLinksRef).toBe("function"), { timeout: MOUNT_MS });

  act(() => {
    setInsightsRef!(insights);
    setTimelogLinksRef!(links);
  });

  await waitFor(
    () => expect(screen.getByTestId("ws-insights")).toHaveTextContent(FRESH_KEY),
    { timeout: RECONCILE_MS },
  );
}

beforeEach(() => {
  setInsightsRef = null;
  setTimelogLinksRef = null;
  window.localStorage.clear();
  window.localStorage.setItem(
    "aipm-cockpit:projects",
    JSON.stringify({
      projects: [{ id: PROJECT, name: "Seed", code: "SEED", storageConfig: { kind: "browser" } }],
      currentProjectId: PROJECT,
    }),
  );
  seedCache();
});

// ★★★ THE MUTANT THIS DESCRIBE EXISTS FOR: `const evaluated = new Set(policy
// Result.evaluated)` — i.e. building the predicate from the policy report ALONE
// and dropping `CORE_INSIGHT_TYPES`. It passes every guardrail test in this
// file, and makes every core insight in the app immortal.
describe("task-manager → core insight types", () => {
  it("resolves an acted CORE insight that is no longer detected", async () => {
    // Nothing in this workspace is stalled, so `stalledWork` is legitimately
    // absent from the pass — and a core detector needs no configuration and no
    // per-device cache, so absent really does mean cleared.
    await mountAndReconcile([coreInsight]);
    expectResolved(CORE_KEY);
  }, TEST_MS);

  // ★★ `overdueTrend` is IN `CORE_INSIGHT_TYPES` and still goes dark: the
  // detector returns null outright when `priorOverdueCount === null`, and that
  // count comes from `loadLandingState` — per-browser, per-project, never
  // exported. A device that has not landed on this project's Dashboard detects
  // no trend at all, so treating the type as evaluated resolves ANOTHER
  // device's acted insight as a fabricated win.
  it("freezes an acted overdueTrend when this device has no landing snapshot", async () => {
    await mountAndReconcile([trendInsight]);
    // The pipeline demonstrably ran (FRESH_KEY is asserted by the mount helper),
    // so this is a live pass declining to certify ONE insight.
    expectFrozen(trendInsight);
  }, TEST_MS);

  // The anti-vacuity control for the test above, and it is not optional: a
  // predicate returning false for everything passes that one on its own.
  it("resolves the same overdueTrend once a landing snapshot exists", async () => {
    // Prior overdue 0 vs a workspace with no overdue tasks ⇒ the detector runs
    // and legitimately emits nothing, which is a real clear.
    saveLandingState(PROJECT, { metrics: { overdue: 0 } });
    await mountAndReconcile([trendInsight]);
    expectResolved(TREND_KEY);
  }, TEST_MS);
});

describe("task-manager → the evaluated scope handed to reconcileInsights", () => {
  it("leaves an acted insight of an UNEVALUATED rule completely unchanged", async () => {
    await mountAndReconcile([offInsight, goneInsight]);

    // The ON rule really did run (its fresh violation is here), so this is a
    // live pipeline freezing one type — not a pipeline that produced nothing.
    expect(cellFor(FRESH_KEY)[1]).toBe("active");
    expectFrozen(offInsight);
  }, TEST_MS);

  it("resolves an acted insight whose rule ran over a window covering its days", async () => {
    await mountAndReconcile([offInsight, goneInsight]);

    // Same pass, opposite direction: capPerDay IS in the evaluated set, the roll
    // carries nothing for user 8, and the window still spans the February days
    // this insight is about — so this one must clear normally. A wiring that
    // dropped the policy's evaluated types would freeze it instead.
    expectResolved(GONE_KEY);
  }, TEST_MS);

  // ★★★ The roll is a window-and-scope SNAPSHOT that `finish()` replaces
  // wholesale. Fetch Jan–Mar, breach the cap in February, act on the insight,
  // then fetch Apr–Jun: the rule still reports itself evaluated and still finds
  // nothing, because it never looked at February.
  it("freezes a guardrail insight whose violating days fall outside the roll window", async () => {
    seedCache({ dailyWindow: MOVED_ON });
    await mountAndReconcile([goneInsight]);
    expectFrozen(goneInsight);
  }, TEST_MS);

  // ★ Identical to the resolving case in every respect but this flag — a
  // partial fetch is missing whole people while every rule still reports itself
  // evaluated, so its zero is a lost one, not a real one.
  it("freezes a guardrail insight when the roll is partial", async () => {
    seedCache({ partial: true });
    await mountAndReconcile([goneInsight]);
    expectFrozen(goneInsight);
  }, TEST_MS);

  // ★★ BACK-COMPAT, BOTH SIDES. Absent evidence is not evidence of coverage, so
  // both of these freeze — recoverable, where a fabricated "improved" in an
  // exported artifact is not.
  it("freezes a guardrail insight stored without violating dates", async () => {
    await mountAndReconcile([noDatesInsight]);
    expectFrozen(noDatesInsight);
  }, TEST_MS);

  it("freezes a guardrail insight when the cache entry carries no window", async () => {
    seedCache({ dailyWindow: undefined });
    await mountAndReconcile([goneInsight]);
    expectFrozen(goneInsight);
  }, TEST_MS);
});
