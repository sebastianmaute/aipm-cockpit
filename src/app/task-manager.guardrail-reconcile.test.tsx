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

/** ★★ Holiday readiness, made controllable. The real `useHolidaySet` resolves
 *  to `ready: true` with an EMPTY set the moment no countries are configured,
 *  which is the state every test here would otherwise run in — so the
 *  not-ready branch is unreachable without this. Default `true` so every
 *  existing case behaves exactly as it did against the real hook; only the one
 *  test that is about readiness flips it. */
let holidaysReadyRef = true;
vi.mock("./use-holiday-set", () => ({
  useHolidaySet: () => ({ holidaySet: new Set<string>(), holidaysReady: holidaysReadyRef }),
}));

// Probe standing in for the heavy pane: one cell per insight, carrying exactly
// the four fields this file is about — the key, the status, the outcome
// direction and the resolution stamp — plus the baseline. That is FIVE fields,
// not the whole record: `occurrences`, `lastSeenAt`, `data` and `entityRef` are
// outside the projection entirely (see `expectFrozen` below).
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
/** The ON rule again, for a person NO fetch in these tests ever covers. */
const UNCOVERED_KEY = "timelog:timelogCapPerDay:11";
/** A shift-dependent rule for a LINKED person who booked nothing — the exact
 *  population a cell-derived `linkedUsers` stranded permanently. */
const LINKED_CLEAN_KEY = "timelog:timelogWorkingHours:8";
/** The same rule for a person with no link at all. */
const UNLINKED_KEY = "timelog:timelogWorkingHours:12";
/** Core types — in `CORE_INSIGHT_TYPES`, nothing to do with TimeLog. Present
 *  because the fixture that omitted them let the drop-core mutant ship green. */
const CORE_KEY = "stalledWork:core";
const TREND_KEY = "overdueTrend";
/** A core type whose detector CONSUMES the holiday set, unlike the two above. */
const BUDGET_KEY = "budgetVariance:core";

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
      // ★★★ DERIVED FROM THE KEY, never a shared constant. Every guardrail key
      // here ends in the timelog userId, and the fixtures deliberately use
      // DIFFERENT people (7 fresh, 8 gone, 9 no-dates). A fixed id in `VIOLATED`
      // would put user 7 in every row's data while the keys said otherwise, so a
      // scope assertion about `goneInsight` would silently be reading user 7's
      // coverage and would pass whichever person the predicate actually checked.
      timelogUserId: Number(over.key.slice(over.key.lastIndexOf(":") + 1)),
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
/** ★★ The SCOPE twin of `goneInsight`: identical rule, identical violating
 *  dates, a different person. It exists so a scope assertion can differ in the
 *  person alone — `noDatesInsight` cannot serve that role, because it is
 *  rejected two guards EARLIER (no violating dates) and so never reaches the
 *  scope check at all. */
const uncoveredInsight = acted({ id: 7, key: UNCOVERED_KEY, type: "timelogCapPerDay", count: 4 });
/** ★★ The LINK pair, both `timelogWorkingHours`, both covered by `dailyUsers`,
 *  both inside the window, NEITHER with a violating cell in the roll. User 8 is
 *  linked and user 12 is not, so the link is the only difference between them. */
const linkedCleanInsight = acted({ id: 8, key: LINKED_CLEAN_KEY, type: "timelogWorkingHours", count: 2 });
const unlinkedInsight = acted({ id: 9, key: UNLINKED_KEY, type: "timelogWorkingHours", count: 3 });
/** A CORE type that consumes `holidaySet` — `budgetVarianceInsight` threads it
 *  into `computeBudgetReport`, so an empty-because-unloaded set moves the very
 *  number its threshold compares against. */
const budgetInsight = acted({
  id: 6,
  key: BUDGET_KEY,
  type: "budgetVariance",
  count: 12,
  // ★★★ `variancePct`, NOT `count` — `METRIC_FIELD.budgetVariance` is
  // `variancePct`, and a wrong key here makes `clear()` resolve with NO outcome
  // at all. The status assertion would still pass, so the half of the test that
  // is actually about a FABRICATED WIN would go unobserved while the test
  // reported green. `baselineCell` reads the snapshot, so both must agree.
  data: { variancePct: 12 },
  metricAtAction: { variancePct: 12 },
});

/** The probe cell for one key, split on `|`. Throws (rather than returning
 *  undefined) so a missing row names itself and prints the whole cell text. */
function cellFor(key: string): string[] {
  const text = screen.getByTestId("ws-insights").textContent ?? "";
  const cell = text.split(",").find((c) => c.startsWith(`${key}|`));
  if (cell === undefined) throw new Error(`no insight cell for ${key} in: "${text}"`);
  return cell.split("|");
}

/** ★★★ Asserts the FIVE fields the fabricated win would move: key, status,
 *  outcome direction, resolution stamp and baseline. The defect keeps the row
 *  and stamps it `resolved` + `resolvedAt` + an outcome `computeClearedOutcome`
 *  always writes as "improved", so any assertion weaker than this — "the row is
 *  still there", "it has the same key" — is green against exactly the bug it
 *  claims to catch.
 *  ★★ IT IS NOT A WHOLE-RECORD COMPARISON, and this docstring used to say it
 *  was ("the SAME RECORD, asserted field for field"). `occurrences`,
 *  `lastSeenAt`, `data` and `entityRef` are NOT checked here — they are not in
 *  the probe's projection at all. That is sufficient for the defect named
 *  above, but a reader trusting the old wording would think a field-level
 *  regression anywhere in the record was covered, and would weaken this helper
 *  believing there was a backstop. */
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
    // ★★ The SCOPE half of the coverage claim, and it has to be seeded for the
    // resolving cases to reach the resolve at all: a roll that does not say who
    // it covered freezes, which is the back-compat default.
    // ★ ALL THREE fixture people, including the two the roll carries no cell
    // for. That is the point of the field — 8 and 9 were FETCHED and found
    // clean, which is exactly the case that must stay clearable, and a roll
    // listing only the people who appear in it could never express it.
    dailyUsers: [7, 8, 9],
    ...over,
  });
}

/** Mount, seed both context slices in ONE act (one re-render, one effect run),
 *  and wait for the debounced reconcile to have produced the fresh detection —
 *  which is also the proof that the roll was read under the right cache key. */
async function mountAndReconcile(
  insights: readonly Insight[],
  linksOverride: TimelogLinks = links,
): Promise<void> {
  render(<TaskManager />);
  await screen.findByTestId("ws-insights", undefined, { timeout: MOUNT_MS });
  await waitFor(() => expect(typeof setTimelogLinksRef).toBe("function"), { timeout: MOUNT_MS });

  act(() => {
    setInsightsRef!(insights);
    setTimelogLinksRef!(linksOverride);
  });

  await waitFor(
    () => expect(screen.getByTestId("ws-insights")).toHaveTextContent(FRESH_KEY),
    { timeout: RECONCILE_MS },
  );
}

beforeEach(() => {
  setInsightsRef = null;
  setTimelogLinksRef = null;
  // Back to the real hook's no-countries behaviour, so one readiness test
  // cannot leak a frozen pipeline into whatever runs next under a shuffle.
  holidaysReadyRef = true;
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
  // ★★★ THE READINESS FLOOR IS NOT A GUARDRAIL-ONLY RULE. `budgetVarianceInsight`
  // threads `holidaySet` into `computeBudgetReport`, so an empty-because-unloaded
  // set moves capacity, moves `budgetHours`, and can push the variance under its
  // threshold — the detector goes dark and a CORE type resolves as a fabricated
  // win. The floor was applied to `timelogNonWorkingDay` alone while this
  // consumer of the same value was certified unconditionally.
  // ★★ Not merely a transient: if `loadHolidaysCtor()` rejects, `useHolidaySet`
  // holds `ready:false` with an empty set permanently.
  it("freezes budgetVariance while the holiday set has not loaded", async () => {
    holidaysReadyRef = false;
    await mountAndReconcile([budgetInsight]);
    expectFrozen(budgetInsight);
  }, TEST_MS);

  // ★ Anti-vacuity for the pair: the SAME insight, the same absence of any
  // budget data to detect against, and the only difference is readiness. Without
  // this, a predicate returning false for every core type would pass the freeze
  // test and look correct.
  it("resolves the same budgetVariance once the holiday set is ready", async () => {
    await mountAndReconcile([budgetInsight]);
    expectResolved(BUDGET_KEY);
  }, TEST_MS);

  // ★★ The two OTHER core detectors that receive `holidaySet` must NOT be
  // caught by this floor — they were checked rather than assumed: both
  // `overdueTrend` and `milestoneSlip` decide on a bare `date < today` that
  // returns BEFORE any holiday-aware workday maths, so they are
  // holiday-INDEPENDENT and freezing them would be a false freeze.
  it("does not freeze a holiday-independent core type while holidays load", async () => {
    holidaysReadyRef = false;
    await mountAndReconcile([coreInsight]);
    expectResolved(CORE_KEY);
  }, TEST_MS);

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

  // ★★★ THE SCOPE HALF, and the window check alone could not catch it. The roll
  // is a window-AND-scope snapshot: `fetchBookings(start, end, userIds)` iterates
  // only the ticked people and a successful narrow fetch is NOT partial. So the
  // days line up, the rule reports itself evaluated, and every person the fetch
  // skipped resolves as a fabricated "improved" — from one "re-check just Bob".
  // ★★ The window here is the COVERING one, identical to the resolving case
  // above; scope is the only difference, so this cannot pass for the window's
  // reasons.
  it("freezes a guardrail insight about a person the roll did not cover", async () => {
    seedCache({ dailyUsers: [7] });
    await mountAndReconcile([goneInsight]);
    expectFrozen(goneInsight);
  }, TEST_MS);

  // ★★★ THE ANTI-VACUITY PAIR, and the first version of this test was itself
  // vacuous: it asserted TWO freezes and called one of them a resolve, so a
  // predicate that froze every guardrail insight passed it unchanged — exactly
  // what the comment claimed it prevented. `expectFrozen` asserts status
  // "acted"; the second assertion asserted "acted" too.
  // ★★ Both rows here are the SAME rule over the SAME window with the SAME
  // violating dates, so scope membership is the only difference between them
  // and the pair cannot pass for any other reason. One clears, one freezes.
  it("resolves a covered person and freezes an uncovered one in the same pass", async () => {
    seedCache({ dailyUsers: [8] });
    await mountAndReconcile([goneInsight, uncoveredInsight]);
    expectResolved(GONE_KEY);
    expectFrozen(uncoveredInsight);
  }, TEST_MS);

  it("freezes a guardrail insight when the cache entry carries no covered-people list", async () => {
    seedCache({ dailyUsers: undefined });
    await mountAndReconcile([goneInsight]);
    expectFrozen(goneInsight);
  }, TEST_MS);

  // ★★★ `partial` IS VALIDATED NOWHERE, so a non-boolean reaches this
  // predicate intact. The `=== true` this replaces read `"yes"` as NOT partial
  // and went on to certify a clean. See the note at the predicate itself for
  // why this consumer and the Apply path deliberately read the flag
  // differently.
  // ★★★ THE PER-PERSON LINK FLOOR, PINNED AT ITS CALL SITE. The engine's
  // `linkedUsers` was pinned in `timelog-policy.test.ts`, and that pins only
  // that the engine COMPUTES the set — deleting the branch in
  // `task-manager.tsx` that USES it left every test in the repo green. That is
  // the extraction-pins-the-function-not-the-call-site shape, and the commit
  // that introduced it claimed the guard was mutation-proved.
  // ★★★ IT ALSO PINS THAT `linkedUsers` COMES FROM THE LINKS, NOT THE ROLL.
  // User 8 is linked and has NO cell in the seeded roll. Built from cells — as
  // the first cut was — user 8 would be absent from `linkedUsers` and would
  // FREEZE, so this test fails against that version. A linked person who simply
  // booked nothing in the window is the whole population that defect stranded,
  // and it stranded them permanently.
  // ★★ The pair differs ONLY in the link: both are `timelogWorkingHours`, both
  // carry the same violating dates, both are inside `dailyUsers` and inside the
  // window, and neither has a violating cell. So neither the scope check nor the
  // window check nor a detection can account for the difference.
  it("resolves a linked person with no bookings and freezes an unlinked one", async () => {
    seedCache({ dailyUsers: [7, 8, 9, 12] });
    await mountAndReconcile([linkedCleanInsight, unlinkedInsight], {
      userLinks: [{ timelogUserId: 8, resourceId: 40, manual: true }],
      projectLinks: [],
      // capPerDay stays ON so the fresh-detection wait in `mountAndReconcile`
      // still has something to observe; workingHours is the rule under test.
      policy: {
        timelogCapPerDay: { enabled: true, threshold: 8 },
        timelogWorkingHours: { enabled: true },
      },
    });
    expectResolved(LINKED_CLEAN_KEY);
    expectFrozen(unlinkedInsight);
  }, TEST_MS);

  it("freezes a guardrail insight when partial holds a non-boolean", async () => {
    seedCache({ partial: "yes" as unknown as boolean });
    await mountAndReconcile([goneInsight]);
    expectFrozen(goneInsight);
  }, TEST_MS);
});
