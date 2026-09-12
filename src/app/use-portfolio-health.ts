// src/app/use-portfolio-health.ts
"use client";
//
// Loads each Turso portfolio project's Workspace via TursoBackend, runs
// computeDashboard, and returns per-project PortfolioRow[] + aggregate KPIs.
//
// Partial failures (SOME projects fail) are tolerated: the failing project is
// skipped (logged, not thrown) so the rest of the portfolio still renders. A
// TOTAL failure (every project fails) surfaces an error instead of an empty
// state. Projects load SEQUENTIALLY (load() runs DDL outside the write lock →
// parallel loads would contend / SQLITE_BUSY). No secrets / auth tokens are
// logged — only the project id and error message.

import { useEffect, useState } from "react";
import type { TursoConfig } from "./turso-config";
import { TursoBackend } from "./turso-backend";
import { buildDashboardInput, computeDashboard, hasNoActiveScope } from "./dashboard";
import type { ProjectRegistryEntry } from "./projects-registry";
import type { ResourcePlan } from "./types";
import {
  aggregatePortfolio,
  deriveMilestoneHealthBucket,
  type PortfolioAggregate,
  type PortfolioRow,
} from "./portfolio-rollup";

/** Fallback plan used when a project workspace has no plan stored.
 *  Granularity and dates don't matter for RAG derivation (no EV math runs
 *  when budgets are empty), but the field is required by computeDashboard. */
const FALLBACK_PLAN: ResourcePlan = {
  startDate: "2024-01-01",
  endDate: "2024-12-31",
  granularity: "month",
  currency: "EUR",
};

/** Sentinel `error` value when EVERY project failed to load (vs. a genuinely
 *  empty portfolio). The panel maps it to a translated message. */
export const PORTFOLIO_LOAD_FAILED = "portfolio-load-failed";

export type UsePortfolioHealthResult = {
  rows: PortfolioRow[];
  aggregate: PortfolioAggregate;
  loading: boolean;
  error: string | null;
};

/**
 * Loads all portfolio projects from Turso in parallel, runs computeDashboard
 * for each, and returns per-project PortfolioRow[] + aggregate.
 *
 * Deps: tursoConfig changes → reload; projectIds string changes → reload.
 * holidaySet is intentionally excluded from deps (ReadonlySet has no stable
 * reference identity across renders; content only changes with settings changes
 * which also update today or the turso URL).
 */
export function usePortfolioHealth(
  tursoConfig: TursoConfig | null,
  projects: readonly ProjectRegistryEntry[],
  today: string,
  holidaySet: ReadonlySet<string>,
  workdayHours: number,
): UsePortfolioHealthResult {
  const [rows, setRows] = useState<PortfolioRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Stable dep keys (avoid exhaustive-deps rejects on obj.member deps).
  // ★ configKey includes the auth token so rotating it (same URL) re-runs the
  //   load; otherwise stale credentials would silently fail every project.
  const configKey = tursoConfig ? `${tursoConfig.httpUrl}\u0000${tursoConfig.authToken}` : "";
  const projectIds = projects.map((p) => p.id).join(",");
  const projectCount = projects.length;
  // ★ Content key for holidaySet (a Set has no stable identity to dep on) so an
  //   edit to the holiday calendar re-runs the rollup (schedule RAG follows it).
  const holidayKey = Array.from(holidaySet).sort().join(",");

  useEffect(() => {
    let cancelled = false;

    const loadAll = async (): Promise<void> => {
      // Empty / unconfigured: reset (inside the async callback, not the effect
      // body, to satisfy the react-hooks/set-state-in-effect ban).
      if (!tursoConfig || projectCount === 0) {
        if (!cancelled) {
          setRows([]);
          setLoading(false);
          setError(null);
        }
        return;
      }
      if (!cancelled) {
        setLoading(true);
        setError(null);
      }
      const collected: PortfolioRow[] = [];
      let failures = 0;

      // SEQUENTIAL, not Promise.all: TursoBackend.load() embeds CREATE TABLE IF
      // NOT EXISTS DDL (a write transaction) OUTSIDE the write lock, so N
      // concurrent loads against the one shared DB contend and return
      // SQLITE_BUSY. Loading one project at a time avoids the contention; the
      // view is explicit and shows a loading state meanwhile.
      for (const proj of projects) {
        if (cancelled) return;
        try {
          const backend = new TursoBackend(tursoConfig, proj.id);
          const ws = await backend.load();
          // Budget RAG needs a real plan to align period keys; with no stored
          // plan we pass NO budgets (→ budget shows "—") rather than scoring
          // them against the placeholder FALLBACK_PLAN and mis-ranking the row.
          const hasPlan = !!ws.plan;
          const model = computeDashboard(
            buildDashboardInput(
              {
                tasks: ws.tasks,
                raid: ws.raid,
                budgets: hasPlan ? (ws.budgets ?? []) : [],
                plan: ws.plan ?? FALLBACK_PLAN,
                roles: ws.roles,
                resources: ws.resources,
                absences: ws.absences,
                fxRates: ws.fxRates ?? null,
                milestones: ws.milestones,
                changes: ws.changes,
              },
              { workdayHours, holidaySet, status: ws.status ?? {}, activity: [], today },
            ),
          );
          const totalMilestones = (ws.milestones ?? []).length;
          const msHealth = deriveMilestoneHealthBucket(
            model.overdueMilestones.length,
            model.atRiskMilestones.length,
            model.dueSoonMilestones.length,
            totalMilestones,
          );
          collected.push({
            id: proj.id,
            name: proj.name,
            overall: model.overall.effective,
            schedule: model.schedule.effective,
            budget: model.budget.effective,
            // ★ null, not 0, when nothing is in scope — gated on the SAME
            //   predicate the dashboard tiles use, so this table cannot drift
            //   from them (open-followups §64).
            completionPercent: hasNoActiveScope(model.progress) ? null : model.progress.percent,
            openRaidCount: model.openRaidCount,
            milestoneHealth: msHealth,
          });
        } catch (err) {
          // Partial failure: skip project, log message only (no token/body).
          failures += 1;
          const msg = err instanceof Error ? err.message : "unknown error";
          console.error(`[portfolio-health] project ${proj.id} failed to load: ${msg}`);
        }
      }

      if (cancelled) return;

      setRows(collected);
      // ★ If EVERY project failed (collected empty but failures occurred), this
      //   is an outage/bad-config — surface an error, NOT the "no projects yet"
      //   empty state (which would tell the user their portfolio is empty).
      setError(collected.length === 0 && failures > 0 ? PORTFOLIO_LOAD_FAILED : null);
      setLoading(false);
    };

    void loadAll().catch((err: unknown) => {
      if (cancelled) return;
      const msg = err instanceof Error ? err.message : "Unknown error";
      setError(msg);
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configKey, projectIds, projectCount, today, workdayHours, holidayKey]);
  // projects + tursoConfig covered by derived keys (configKey incl. token /
  // projectIds / projectCount); holidaySet via holidayKey.

  const aggregate = aggregatePortfolio(rows);
  return { rows, aggregate, loading, error };
}
