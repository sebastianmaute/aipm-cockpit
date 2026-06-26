// src/app/use-portfolio-health.ts
"use client";
//
// Loads each Turso portfolio project's Workspace via TursoBackend, runs
// computeDashboard, and returns per-project PortfolioRow[] + aggregate KPIs.
//
// Partial failures (one project fails to load) are tolerated: the project is
// skipped (logged, not thrown) so the rest of the portfolio still renders.
// No secrets / auth tokens are logged — only the project id and error message.

import { useEffect, useState } from "react";
import type { TursoConfig } from "./turso-config";
import { TursoBackend } from "./turso-backend";
import { computeDashboard } from "./dashboard";
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
  const configKey = tursoConfig ? tursoConfig.httpUrl : "";
  const projectIds = projects.map((p) => p.id).join(",");
  const projectCount = projects.length;

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

      await Promise.all(
        projects.map(async (proj) => {
          try {
            const backend = new TursoBackend(tursoConfig, proj.id);
            const ws = await backend.load();
            const model = computeDashboard({
              tasks: ws.tasks,
              raid: ws.raid,
              budgets: ws.budgets ?? [],
              plan: ws.plan ?? FALLBACK_PLAN,
              roles: ws.roles,
              resources: ws.resources,
              absences: ws.absences,
              workdayHours,
              holidaySet,
              status: ws.status ?? {},
              activity: [],
              today,
              milestones: ws.milestones ?? [],
              changes: ws.changes ?? [],
            });
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
              completionPercent: model.progress.percent,
              openRaidCount: model.openRaidCount,
              milestoneHealth: msHealth,
            });
          } catch (err) {
            // Partial failure: skip project, log message only (no token/body).
            const msg = err instanceof Error ? err.message : "unknown error";
            console.error(`[portfolio-health] project ${proj.id} failed to load: ${msg}`);
          }
        }),
      );

      if (cancelled) return;

      // Restore original project order (Promise.all may resolve out-of-order).
      const orderMap = new Map(projects.map((p, i) => [p.id, i] as const));
      collected.sort(
        (a, b) => (orderMap.get(a.id) ?? 9999) - (orderMap.get(b.id) ?? 9999),
      );

      setRows(collected);
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
  }, [configKey, projectIds, projectCount, today, workdayHours]);
  // holidaySet excluded (see comment above). projects and tursoConfig covered
  // by their derived stable keys (configKey / projectIds / projectCount).

  const aggregate = aggregatePortfolio(rows);
  return { rows, aggregate, loading, error };
}
