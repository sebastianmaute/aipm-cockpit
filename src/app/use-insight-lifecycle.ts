// src/app/use-insight-lifecycle.ts
//
// Deps-object hook factory extracted from task-manager.tsx (Phase 3 convention,
// §491). Holds the Insights → Action Loop (#6B SP1) lifecycle: the detection
// input, the debounced detect → reconcile runner, and the acknowledge / act /
// logged-as-RAID / dismiss handlers. Called unconditionally with the live
// closure values via a typed `deps` object; the inline `useCallback`/`useMemo`
// keep the exact memoization the code had inline, because
// `useInsightRecommendations` and `useRaidCreate` take these handlers. Move-only:
// no behaviour change.
//
// ★ Coverage-GATED on purpose (not in `coverage.exclude`): the reconcile
// predicate is real logic, not glue. `task-manager.guardrail-reconcile.test.tsx`
// drives the runner through `TaskManager`; `use-insight-lifecycle.test.ts` pins
// the four handlers.
//
// ★ Call-site placement: before `useInsightRecommendations` and `useRaidCreate`,
// which consume the handlers. Derive today's order rather than trusting this line:
//   grep -n "useInsightLifecycle\|useInsightRecommendations\|useRaidCreate" src/app/task-manager.tsx
import { useCallback, useEffect, useMemo, type Dispatch, type SetStateAction } from "react";
import type { AppView } from "./nav-config";
import type { Shift } from "./types";
import type { TimelogLinks } from "./timelog-types";
import { CORE_INSIGHT_TYPES, detectInsights, type InsightInput } from "./insights/detect";
import { insightsMateriallyEqual, reconcileInsights } from "./insights/reconcile";
import type { Insight, InsightType } from "./insights/insight";
import { loadLandingState } from "./landing-state";
import { loadActualsCache } from "./timelog-actuals-store";
import { evaluateTimelogPolicy } from "./timelog-policy";
import { metricAtActionPatch } from "./insights/outcome";
import { applyInsightLoggedAsRaid } from "./insights/log-as-raid";

// Debounce before the insights detect→reconcile runner fires, so a burst of
// edits collapses into one recompute (#6B Insights → Action Loop, SP1).
const INSIGHTS_RECONCILE_DEBOUNCE_MS = 4_000;

export interface InsightLifecycleDeps
  extends Omit<InsightInput, "priorOverdueCount" | "timelogViolations"> {
  hydrated: boolean;
  isPopout: boolean;
  /** §548 — the runner never writes while a load or swap is pending. */
  loadPending: boolean;
  today: string;
  currentProjectId: string | null;
  /** The per-project landing-state key `priorOverdueCount` is read from. */
  landingProjectId: string;
  holidaysReady: boolean;
  shifts: readonly Shift[];
  timelogLinks: TimelogLinks | undefined;
  insights: readonly Insight[] | undefined;
  setInsights: Dispatch<SetStateAction<readonly Insight[] | undefined>>;
  requestOpen: (view: AppView, id: number) => void;
}

export interface InsightLifecycleHandlers {
  onAcknowledgeInsight: (id: number) => void;
  onActInsight: (id: number) => void;
  onInsightLoggedAsRaid: (insightId: number, raidId: number) => void;
  onDismissInsight: (id: number, reason?: string) => void;
}

export function useInsightLifecycle(deps: InsightLifecycleDeps): InsightLifecycleHandlers {
  const {
    hydrated, isPopout, loadPending, today, currentProjectId, landingProjectId,
    tasks, milestones, raid, budgets, roles, resources, plan,
    holidaySet, holidaysReady, shifts, timelogLinks,
    insights, setInsights, requestOpen,
  } = deps;
  // Assemble the detection input from live entities. `plan` is always present
  // here (workspace-context seeds defaultResourcePlan) so it is passed as-is;
  // `budgets` are forwarded raw (the budgetVariance detector self-gates on an
  // empty list), mirroring the dashboardModel inputs in task-manager.tsx. `roles`/`resources`
  // feed the budget engine so budgetFollowsPlan buckets derive real hours.
  // `priorOverdueCount` (SP2) reads the prior overdue snapshot from the
  // per-project landing-state — the SAME key workspace-section writes
  // (portfolioCurrentId ?? "default") — so a rising overdue count surfaces the
  // overdueTrend insight. A fresh project has no snapshot yet → null → the
  // detector stays inert (nothing to compare). ★ Deliberately keyed ONLY on
  // landingProjectId (captured once per project, mirroring use-landing-delta's
  // mount-time capture) — NOT re-read on every entity/activity change: the
  // companion debounced advance effect (use-landing-delta) overwrites the
  // stored snapshot with the LIVE overdue count ~4s after the Dashboard
  // mounts, so a live-recomputed read here would quickly start comparing
  // "current" against a snapshot of itself and never fire again this session.
  const priorOverdueCount = useMemo(
    () => loadLandingState(landingProjectId).metrics?.overdue ?? null,
    [landingProjectId],
  );
  // ★ Returns everything EXCEPT `timelogViolations`: those come from the
  // per-device actuals cache, which is read inside the debounced body below so
  // a fetch landing between recomputes is picked up on the next pass. Building
  // them here would key the effect on a value this builder cannot observe.
  const buildInsightInput = useCallback(
    (): Omit<InsightInput, "timelogViolations"> => ({
      tasks,
      milestones,
      raid,
      budgets,
      roles,
      resources,
      plan,
      priorOverdueCount,
      holidaySet,
    }),
    [tasks, milestones, raid, budgets, roles, resources, plan, priorOverdueCount, holidaySet],
  );

  // Detect → reconcile runner. Debounced so a burst of edits collapses into one
  // recompute. Keyed on the DETECTION INPUTS (via buildInsightInput identity +
  // today), NEVER on `insights`, so the setInsights below cannot re-trigger this
  // effect — that would be the reconcile→setInsights→re-run loop (occurrences
  // would climb without bound). Writes via the setter only (a side effect, not
  // render-phase setState). Popout is read-only; pre-hydration is skipped.
  useEffect(() => {
    // §548 — never while a load or swap is pending: its write would be replaced when the load lands.
    // `loadPending` is a dep, so the reconcile runs once the load does.
    if (!hydrated || isPopout || loadPending) return;
    const timer = setTimeout(() => {
      // The guardrail rules read the per-device daily roll from the actuals
      // cache — keyed the same way TimelogPanel WRITES it (open-followups §14).
      // ★★ Read the entry ONCE. `daily`, `partial` and `dailyWindow` describe
      // ONE fetch, and the predicate below compares them against each other;
      // three separate `loadActualsCache` calls could straddle a write and pair
      // a window with a roll it never covered.
      const actuals = loadActualsCache(currentProjectId ?? "default");
      const policyResult = evaluateTimelogPolicy({
        daily: actuals?.daily ?? null,
        policy: timelogLinks?.policy,
        holidaySet,
        holidaysReady,
        userLinks: timelogLinks?.userLinks ?? [],
        shifts,
      });
      const detected = detectInsights(
        { ...buildInsightInput(), timelogViolations: policyResult.violations },
        today,
      );
      // ★★★ THE PREDICATE THAT KEEPS "this produced no violation" DISTINCT FROM
      // "this was never looked at". Answered PER INSIGHT, never per type: for
      // the guardrails the answer depends on the row's own violating days.
      // Every unproven case returns FALSE, because freezing is recoverable (the
      // next covering fetch clears it) and a fabricated "improved" in an
      // exported artifact is not.
      const evaluatedRules = new Set<InsightType>(policyResult.evaluated);
      const rollWindow = actuals?.dailyWindow;
      const rollUsers = actuals?.dailyUsers;
      // ★★★ ANY NON-FALSE `partial` FREEZES HERE — and this deliberately does
      // NOT match how the Apply path reads the same flag. `partial` is validated
      // NOWHERE, so a non-boolean
      // survives into the entry and `=== true` read `partial: "yes"` as NOT
      // partial, then went on to certify a clean.
      // ★★★ §172 IS RIGHT FOR ITS OWN CONSUMER AND WRONG FOR THIS ONE, which is
      // why the two now differ on purpose. Its rule is `=== true` because
      // treating a hand-edited value as partial would DISABLE APPLY with no way
      // back but Clear all — there, the unsafe direction is refusing to act.
      // Here the unsafe direction is the opposite: acting on an unproven flag
      // writes a fabricated "improved" into shared, exported data, which no user
      // can undo because nothing tells them it happened. `budget-unapplied-
      // notice.tsx` keeps `=== true` and should. One flag, two consumers,
      // opposite safe directions — do not "harmonise" them.
      // ★★ Absent stays not-partial: that is the real back-compat case (§172),
      // and it is untouched here.
      const partialFlag = actuals?.partial;
      const rollPartial = partialFlag !== undefined && partialFlag !== false;
      const isEvaluated = (insight: Insight): boolean => {
        // ★★ NOT a core type merely because it is in the list: `overdueTrend`
        // goes dark whenever this device has no landing snapshot for the
        // project, so it is certified by the same value the detector gates on.
        if (insight.type === "overdueTrend") return priorOverdueCount !== null;
        // ★★★ THE READINESS FLOOR IS NOT A GUARDRAIL-ONLY RULE, and applying it
        // to one rule while a CORE detector consumed the same value was the gap.
        // `budgetVarianceInsight` threads `holidaySet` into `computeBudgetReport`
        // (capacity → `budgetHours` → the variance pct), so an
        // empty-because-unloaded set moves the number the threshold is compared
        // against and the insight can go dark. The other two core detectors
        // receiving `holidaySet` are unaffected and were checked rather than
        // assumed: `overdueTrend` and `milestoneSlip` both decide on a bare
        // `date < today` that returns BEFORE any holiday-aware workday maths.
        // ★★ Not just the transient load: if `loadHolidaysCtor()` rejects,
        // `useHolidaySet` keeps `ready:false` and an empty set permanently, so
        // this is the difference between freezing and fabricating forever.
        if (insight.type === "budgetVariance") return holidaysReady;
        if (CORE_INSIGHT_TYPES.includes(insight.type)) return true;
        // Everything left is a guardrail rule (or, defensively, a type nothing
        // here evaluates — which falls through to false, the safe direction).
        // The policy module's OWN report, never the rules that happened to
        // yield violations and never all four unconditionally.
        if (!evaluatedRules.has(insight.type)) return false;
        // A `partial` fetch is missing whole people while every rule still
        // reports itself evaluated — a lost zero, not a real one.
        if (rollPartial) return false;
        // ★★★ The roll is a WINDOW-and-scope snapshot that `finish()` replaces
        // wholesale, so a rule can run, find nothing, and simply never have
        // looked at the days this insight is about (fetch Feb, act, re-fetch
        // Apr). Only a window demonstrably covering them certifies a clean.
        // ★★ An EMPTY roll over a covering, non-partial window is a REAL clean
        // — a fetch that legitimately returned no rows — and clears here. "No
        // data" and "no bookings" are what `partial` and this window separate.
        if (rollWindow === undefined) return false;
        // ★★ BACK-COMPAT FREEZES. An insight stored before the dates existed,
        // or a cache entry written before `dailyWindow` did, cannot ESTABLISH
        // coverage — absent evidence is not evidence of coverage.
        const first = insight.data.firstViolationDate;
        const last = insight.data.lastViolationDate;
        if (typeof first !== "string" || typeof last !== "string") return false;
        // ISO `YYYY-MM-DD` compares correctly with `<=`/`>=`; the store already
        // rejects a window that is not two ISO dates with `from <= to`.
        if (!(rollWindow.from <= first && rollWindow.to >= last)) return false;
        // ★★★ THE SCOPE HALF, AND THE WINDOW ALONE WAS NOT ENOUGH. The roll is a
        // window-AND-scope snapshot: `fetchBookings` iterates only the ticked
        // people and a successful narrow fetch is NOT `partial`, so without this
        // check one "re-check just Bob" resolves every other person's insight as
        // "improved". Project scope reports covering nobody, because it fetches
        // selected PROJECTS rather than whole days and can never certify a
        // person's total.
        // ★★ Absent freezes, exactly like an absent window: an entry written
        // before this field existed cannot ESTABLISH who it covered, and absent
        // evidence is not evidence of coverage.
        if (rollUsers === undefined) return false;
        const who = insight.data.timelogUserId;
        if (typeof who !== "number") return false;
        if (!rollUsers.includes(who)) return false;
        // ★★★ THE PER-PERSON LINK FLOOR. The two shift-dependent rules need this
        // person to resolve to a resource before "no violation" means anything:
        // `timelogWorkingHours` reads their expected hours from the shift, and
        // `timelogNonWorkingDay`'s weekday half reads their weekend from it. The
        // whole-rule floor in the engine only asks whether SOME link exists, so
        // removing one person's link leaves the rule evaluated while that person
        // goes dark — and the key is per person.
        // ★★ `timelogNonWorkingDay` is included even though its HOLIDAY half needs no
        // link, and that is deliberately conservative: the two halves share one
        // insight key, so a currently-unlinked person's "no violation" is an
        // answer about the holiday half ALONE and cannot certify the other.
        // ★ Cost: a never-linked booker's guardrail rows stop auto-resolving.
        // They still get RAISED — detection is deliberately link-independent
        // (`buildDailyRoll` measures unlinked bookers on purpose). Measuring and
        // certifying-a-clean are different acts, and only the second needs this.
        if (insight.type === "timelogWorkingHours" || insight.type === "timelogNonWorkingDay") {
          return policyResult.linkedUsers.includes(who);
        }
        return true;
      };
      setInsights((prev) => {
        const base = prev ?? [];
        const next = reconcileInsights(base, detected, today, isEvaluated);
        return insightsMateriallyEqual(base, next) ? base : next;
      });
    }, INSIGHTS_RECONCILE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // ★ `holidaysReady` is a real dep, not noise: the pass taken while it is
    // false leaves `timelogNonWorkingDay` unevaluated, so the reconcile MUST
    // re-run when it flips true or those insights stay frozen for the session.
    // ★ `priorOverdueCount` is a dep in its OWN right, not merely via
    // `buildInsightInput`: the predicate above reads it directly to decide
    // whether `overdueTrend` was evaluated at all.
  }, [buildInsightInput, today, hydrated, isPopout, setInsights, currentProjectId, timelogLinks, holidaySet, holidaysReady, shifts, priorOverdueCount, loadPending]);

  // Lifecycle handlers (threaded to the dashboard as an insightActions bag; the
  // review UI that invokes them is built in Task 6/7). Each is a functional
  // setter so a burst can't drop writes; popout is a no-op. Stamps use `today`
  // (date-only) to match reconcile's own firstSeenAt/lastSeenAt convention.
  const onAcknowledgeInsight = useCallback(
    (id: number) => {
      if (isPopout) return;
      setInsights((prev) =>
        (prev ?? []).map((i) =>
          i.id === id ? { ...i, status: "acknowledged" as const, acknowledgedAt: today } : i,
        ),
      );
    },
    [isPopout, setInsights, today],
  );
  const onActInsight = useCallback(
    (id: number) => {
      if (isPopout) return;
      const target = (insights ?? []).find((i) => i.id === id);
      setInsights((prev) =>
        (prev ?? []).map((i) =>
          i.id === id
            ? {
                ...i,
                status: "acted" as const,
                actedAt: today,
                // SP3: baseline for outcome measurement. metricAtActionPatch is a
                // no-op when a baseline already exists (first act wins) or when the
                // insight has no extractable metric.
                ...metricAtActionPatch(i),
              }
            : i,
        ),
      );
      // Route to the referenced entity via the shared deep-link channel.
      if (target?.entityRef) requestOpen(target.entityRef.view, target.entityRef.id);
    },
    [isPopout, insights, setInsights, today, requestOpen],
  );
  // "Log as RAID" on-saved writer (§515): the Act transition plus the link to the
  // RAID item, via the functional setter (first act wins). `raidId` is the id the
  // save COMMITTED — `useRaidCreate` never passes the draft's open-time id.
  const onInsightLoggedAsRaid = useCallback(
    (insightId: number, raidId: number) => {
      if (isPopout) return;
      setInsights((prev) => applyInsightLoggedAsRaid(prev, insightId, raidId, today));
    },
    [isPopout, setInsights, today],
  );
  const onDismissInsight = useCallback(
    (id: number, reason?: string) => {
      if (isPopout) return;
      setInsights((prev) =>
        (prev ?? []).map((i) =>
          i.id === id
            ? { ...i, status: "dismissed" as const, dismissedAt: today, ...(reason ? { dismissReason: reason } : {}) }
            : i,
        ),
      );
    },
    [isPopout, setInsights, today],
  );
  return { onAcknowledgeInsight, onActInsight, onInsightLoggedAsRaid, onDismissInsight };
}
