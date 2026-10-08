// src/app/use-trend-snapshots.ts
//
// task-manager's wiring for baseline/variance trend snapshots and the
// render-scope dashboard model: whether recording is active (`trendsActive`),
// the `useSnapshots` call with its capture context, the next-actions trend
// directions (`actionTrends`) and `dashboardModel`, which reads the recorded
// snapshots behind the same gate. Extracted from task-manager.tsx (§491);
// move-only. The workspace slices are read from `useWorkspace()`, the same
// context task-manager reads them from; `activityLog` arrives as a deps field
// because task-manager takes it from `useActivityLog`.
//
// ★ `actionTrends` and `dashboardModel` KEEP their `useMemo`, against Extraction
// convention 1: both feed downstream memos and effects in task-manager
// (`useNextActions`, the AI handlers' `getDashboardModel`), and a fresh object
// each render would re-run them all.
"use client";
import { useMemo } from "react";
import { computeActionTrends } from "./next-actions/trends";
import { buildLiveDashboardInput, computeDashboard, type DashboardModel } from "./dashboard";
import { isModuleEnabled } from "./feature-modules";
import { defaultSnapshotSettings, type Settings } from "./settings-types";
import { useSnapshots, type UseSnapshotsArgs, type UseSnapshotsResult } from "./use-snapshots";
import { useWorkspace } from "./workspace-context";
import type { ActivityEntry } from "./activity-log";
import type { PortfolioMode } from "./portfolio-mode";
import type { TursoConfig } from "./turso-config";
import type { Lang } from "./i18n";

export interface TrendSnapshotsDeps {
  settings: Settings;
  portfolioMode: PortfolioMode;
  tursoConfig: TursoConfig | null;
  isPopout: boolean;
  workspaceLoaded: boolean;
  tursoProjectId: string | null;
  holidaySet: ReadonlySet<string>;
  today: string;
  activityLog: readonly ActivityEntry[];
  reportStorageOutcome: (err: unknown | null) => void;
  showToast: UseSnapshotsArgs["showToast"];
  lang: Lang;
}

export interface TrendSnapshotsResult {
  trendsActive: boolean;
  snapshots: UseSnapshotsResult;
  trends: UseSnapshotsResult & { active: boolean };
  actionTrends: ReturnType<typeof computeActionTrends> | undefined;
  dashboardModel: DashboardModel;
}

export function useTrendSnapshots(deps: TrendSnapshotsDeps): TrendSnapshotsResult {
  const {
    settings, portfolioMode, tursoConfig, isPopout, workspaceLoaded, tursoProjectId,
    holidaySet, today, activityLog, reportStorageOutcome, showToast, lang,
  } = deps;
  const { tasks, raid, budgets, plan, roles, resources, absences, fxRates, milestones, changes, budgetHistory, status } = useWorkspace();
  const workdayHours = settings.resources.workdayHours;

  // Baseline/variance trend snapshots. Active when the project's data lives in
  // Turso — either the single-DB Turso storage backend (storageConfig.kind) OR
  // turso portfolio mode (Move-to-Turso) — in the main window with recording on.
  const snapshotsCfg = settings.snapshots ?? defaultSnapshotSettings;
  const trendsActive =
    (settings.storageConfig.kind === "turso" || portfolioMode === "turso") &&
    // Require a usable Turso config: storage kind can be "turso" while the URL /
    // token are still unset or quarantined, and snapshot capture must not run
    // (and throw StorageNotReadyError) against a null config.
    tursoConfig !== null &&
    !isPopout && snapshotsCfg.enabled &&
    isModuleEnabled("trends", settings.features);
  const snapshots = useSnapshots({
    active: trendsActive, cadence: snapshotsCfg.cadence, tasks, workspaceReady: workspaceLoaded,
    tursoConfig,
    projectId: portfolioMode === "turso" ? (tursoProjectId ?? "") : "",
    today: new Date(),
    buildContext: () => {
      // No snapshots here: a capture (`buildSnapshot`) reads only the model's burndown, progress,
      // EVM and RAGs, none of which depend on them — and the list is this `useSnapshots` call's own
      // return value, so passing it would need a self-reference.
      const model = computeDashboard(
        buildLiveDashboardInput(
          { tasks, raid, budgets, plan, roles, resources, absences, fxRates, milestones, changes, budgetHistory },
          { workdayHours, holidaySet, status, activity: activityLog, today },
          null,
        ),
      );
      return {
        model,
        tasks,
        milestones,
        buckets: budgets,
        planEndDate: plan.endDate,
      };
    },
    onError: (err) => {
      // reportStorageOutcome now owns both the banner (all kinds) and the
      // one-shot generic toast, so no explicit fallback toast is needed here.
      reportStorageOutcome(err);
    },
    showToast, lang,
  });
  const trends = { ...snapshots, active: trendsActive };

  // Aggregate-metric trend directions for the next-actions confidence ranking.
  // Only meaningful when snapshots are recorded (Turso); undefined otherwise.
  const actionTrends = useMemo(
    () => (trendsActive ? computeActionTrends(snapshots.snapshots) : undefined),
    [trendsActive, snapshots.snapshots],
  );

  // Render-scope dashboard model, read by Next Actions (`buildActionInput`'s `dashboard`), both
  // `getDashboardModel` handlers (the AI assistant's dashboard snapshot and the meeting report) —
  // NOT by the dashboard panel, which builds its own module-gated model and also passes `disciplines`/`grades`.
  // Unlike the snapshot buildContext above it also passes the recorded snapshots, behind the
  // same `trendsActive` gate the panel's `tursoActive` prop carries.
  const snapshotRecords = snapshots.snapshots;
  const dashboardModel = useMemo(
    () =>
      computeDashboard(
        buildLiveDashboardInput(
          { tasks, raid, budgets, plan, roles, resources, absences, fxRates, milestones, changes, budgetHistory },
          { workdayHours, holidaySet, status, activity: activityLog, today },
          { active: trendsActive, snapshots: snapshotRecords },
        ),
      ),
    [tasks, raid, budgets, plan, roles, resources, absences, fxRates, workdayHours, holidaySet, status, activityLog, today, milestones, changes, budgetHistory, trendsActive, snapshotRecords],
  );

  return { trendsActive, snapshots, trends, actionTrends, dashboardModel };
}
