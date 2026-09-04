// ★★★ THE DEFECT HALF OF THE TIMELOG-GUARDRAIL SLICE, PINNED AT ITS ONLY CALL
// SITE. `reconcileInsights` takes a REQUIRED `evaluated` set so that a detector
// which can go dark cannot have its stored insights resolved as a fabricated
// win. That guard cannot be broken from INSIDE reconcile — and was entirely
// unpinned OUTSIDE it: measured on this branch, substituting a hardcoded
// four-type set at the `task-manager.tsx` call site left 31 files / 321 tests
// passing. Nothing but this file fails when the call site fabricates the set.
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

let setInsightsRef: Dispatch<SetStateAction<readonly Insight[] | undefined>> | null = null;
let setTimelogLinksRef: Dispatch<SetStateAction<TimelogLinks | undefined>> | null = null;

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
                `|${i.resolvedAt ?? "no-resolvedAt"}|m${i.metricAtAction?.count ?? "-"}`,
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
/** The ON rule, for a user the roll no longer carries — this one MUST clear. */
const GONE_KEY = "timelog:timelogCapPerDay:8";
/** The ON rule's live violation, freshly detected from the seeded roll. */
const FRESH_KEY = "timelog:timelogCapPerDay:7";

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
function acted(over: Pick<Insight, "id" | "key" | "type"> & { count: number }): Insight {
  return {
    id: over.id,
    key: over.key,
    type: over.type,
    severity: "medium",
    data: { person: "#7", count: over.count, worstHours: 14, threshold: 8 },
    status: "acted",
    actedAt: "2026-08-01",
    firstSeenAt: "2026-07-01",
    lastSeenAt: "2026-07-20",
    occurrences: 4,
    metricAtAction: { count: over.count },
  };
}

const stored: readonly Insight[] = [
  acted({ id: 1, key: OFF_KEY, type: "timelogCapPerEntry", count: 3 }),
  acted({ id: 2, key: GONE_KEY, type: "timelogCapPerDay", count: 5 }),
];

/** The probe cell for one key, split on `|`. Throws (rather than returning
 *  undefined) so a missing row names itself and prints the whole cell text. */
function cellFor(key: string): string[] {
  const text = screen.getByTestId("ws-insights").textContent ?? "";
  const cell = text.split(",").find((c) => c.startsWith(`${key}|`));
  if (cell === undefined) throw new Error(`no insight cell for ${key} in: "${text}"`);
  return cell.split("|");
}

/** Mount, seed both context slices in ONE act (one re-render, one effect run),
 *  and wait for the debounced reconcile to have produced the fresh detection —
 *  which is also the proof that the roll was read under the right cache key. */
async function mountAndReconcile(): Promise<void> {
  render(<TaskManager />);
  await screen.findByTestId("ws-insights", undefined, { timeout: MOUNT_MS });
  await waitFor(() => expect(typeof setTimelogLinksRef).toBe("function"), { timeout: MOUNT_MS });

  act(() => {
    setInsightsRef!(stored);
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
  // ★ Under the REAL project id, never "default": the reader keys on
  // `currentProjectId ?? "default"`, the same key TimelogPanel writes under, and
  // a reader that fell back would find nothing here.
  saveActualsCache(PROJECT, { fetchedAt: "2026-08-25T08:00:00.000Z", daily: roll });
});

describe("task-manager → the evaluated scope handed to reconcileInsights", () => {
  it("leaves an acted insight of an UNEVALUATED rule completely unchanged", async () => {
    await mountAndReconcile();

    // The ON rule really did run (its fresh violation is here), so this is a
    // live pipeline freezing one type — not a pipeline that produced nothing.
    expect(cellFor(FRESH_KEY)[1]).toBe("active");
    // ★★★ Field-for-field, not mere presence: the defect keeps this row and
    // stamps it "resolved" + resolvedAt + outcome "improved".
    expect(cellFor(OFF_KEY)).toEqual([OFF_KEY, "acted", "no-outcome", "no-resolvedAt", "m3"]);
  }, TEST_MS);

  it("still resolves an acted insight whose rule WAS evaluated and no longer fires", async () => {
    await mountAndReconcile();

    // Same pass, opposite direction: capPerDay IS in the evaluated set, and the
    // roll carries nothing for user 8, so this one must clear normally. A
    // wiring that dropped the policy's evaluated types would freeze it instead.
    const cell = cellFor(GONE_KEY);
    expect(cell[1]).toBe("resolved");
    expect(cell[2]).toBe("improved");
    expect(cell[3]).not.toBe("no-resolvedAt");
  }, TEST_MS);
});
