// src/app/demo-project.ts
//
// The demo orchestrator. With Turso usable it creates the demo as a Turso project and seeds its
// Trends history; otherwise (file mode, or Turso mode without a usable config) it keeps the local
// demo. `createDemo` is pure orchestration over injected effects; `useLoadDemo` wires it into the
// shell (deps-object hook, AGENTS.md "Extraction conventions").

import { useCallback } from "react";
import { buildDemoWorkspace, DEMO_AS_OF } from "./demo-workspace";
import { shiftDemoSnapshots, thinForCadence } from "./demo-snapshot-shift";
import { demoShiftFor } from "./shift-workspace-dates";
import { bucketKey, type SnapshotCadence, type SnapshotRecord } from "./snapshot";
import { appendSnapshots } from "./snapshot-store";
import { defaultSnapshotSettings, type SnapshotSettings } from "./settings-types";
import { t, type Lang } from "./i18n";
import type { NewProjectOpts } from "./new-project-workspace";
import type { PortfolioMode } from "./portfolio-mode";
import type { TursoConfig } from "./turso-config";
import type { ProjectMeta } from "./types";
import type { Workspace } from "./workspace";

export type DemoOutcome = "turso" | "local" | "local-after-turso-failure" | "turso-without-history";

export interface CreateDemoDeps {
  ws: Workspace;
  records: readonly SnapshotRecord[];
  today: string;
  tursoUsable: boolean;
  cadence: SnapshotCadence;
  tursoConfig: TursoConfig | null;
  projectName: string;
  createTursoProject: (meta: ProjectMeta, opts: NewProjectOpts) => Promise<string | null>;
  createLocal: (ws: Workspace) => Promise<void>;
  appendSnapshots: typeof appendSnapshots;
}

/** The seeded history as the new project should hold it: shifted by the workspace's own shift,
 *  thinned to the user's cadence, and ending before the current bucket (left to the live
 *  capture, so no bucket is written twice). A shift collision can drop the authored baseline,
 *  so the first remaining record becomes the baseline. */
export function demoHistoryFor(
  records: readonly SnapshotRecord[],
  ws: Workspace,
  today: string,
  cadence: SnapshotCadence,
): SnapshotRecord[] {
  const n = demoShiftFor(DEMO_AS_OF, today, ws.plan.granularity);
  const now = new Date(`${today}T00:00:00Z`);
  // Compared per record cadence: a monthly-thinned record carries a "YYYY-MM" bucket, which
  // never orders against a weekly "YYYY-Www" key.
  return thinForCadence(shiftDemoSnapshots(records, n, ws.plan.granularity), cadence)
    .filter((r) => r.bucket < bucketKey(now, r.cadence))
    .map((r, i) => ({ ...r, isBaseline: i === 0 }));
}

export async function createDemo(deps: CreateDemoDeps): Promise<DemoOutcome> {
  const { ws } = deps;
  if (!deps.tursoUsable || !ws.project) {
    await deps.createLocal(ws);
    return "local";
  }
  // The seed runs INSIDE the held create, before the project becomes current, so the new
  // project's first snapshot load sees the history (and its baseline) instead of racing it.
  // It catches its own failure so the create still completes; the outcome reports it.
  let seeded = false;
  const seedSnapshots = async (projectId: string): Promise<void> => {
    try {
      await deps.appendSnapshots(deps.tursoConfig, demoRecordsFor(deps, projectId), projectId);
      seeded = true;
    } catch {
      // reported as "turso-without-history" below
    }
  };
  const id = await deps.createTursoProject({ ...ws.project, name: deps.projectName }, { importedWorkspace: ws, seedSnapshots });
  if (id === null) {
    await deps.createLocal(ws);
    return "local-after-turso-failure";
  }
  return seeded ? "turso" : "turso-without-history";
}

/** `snapshot.id` is a global primary key, so each project's seeded ids carry its own id: a second
 *  demo in the same database would otherwise collide with the first one's rows. */
function demoRecordsFor(deps: CreateDemoDeps, projectId: string): SnapshotRecord[] {
  return demoHistoryFor(deps.records, deps.ws, deps.today, deps.cadence)
    .map((r) => ({ ...r, id: `${projectId}:${r.capturedAt}` }));
}

export interface UseLoadDemoDeps {
  lang: Lang;
  showToast: (kind: "info" | "error", text: string) => void;
  startTour: () => void;
  createDemoProject: (ws: Workspace) => Promise<void>;
  createTursoProject: (meta: ProjectMeta, opts?: NewProjectOpts) => Promise<string | null>;
  /** The Turso empty-state gate reads the project LIST, so a created project must re-fetch it. */
  refreshTursoProjects: () => Promise<unknown>;
  portfolioMode: PortfolioMode;
  tursoConfig: TursoConfig | null;
  snapshots: SnapshotSettings | undefined;
}

/** Loads the curated sample as a REAL, deletable demo project and kicks off the tour. The CTA is
 *  empty-state-only (no real project to clobber); registering the project is what flips the
 *  empty-state gate off so the views and the tour overlay mount. Errors toast, never crash. */
export function useLoadDemo(deps: UseLoadDemoDeps): () => Promise<void> {
  const {
    lang, showToast, startTour, createDemoProject, createTursoProject, refreshTursoProjects,
    portfolioMode, tursoConfig, snapshots,
  } = deps;
  return useCallback(async () => {
    try {
      const [mod, recs] = await Promise.all([
        import("../../sample-workspace-small.json"),
        import("../../sample-demo-snapshots.json"),
      ]);
      const today = new Date().toISOString().slice(0, 10); // callback context — lint-safe
      const ws = buildDemoWorkspace((mod as { default?: unknown }).default ?? mod, today);
      const outcome = await createDemo({
        ws,
        records: ((recs as { default?: unknown }).default ?? recs) as SnapshotRecord[],
        today,
        tursoUsable: portfolioMode === "turso" && tursoConfig !== null,
        cadence: (snapshots ?? defaultSnapshotSettings).cadence,
        tursoConfig,
        projectName: t(lang, "demoProjectName", ws.project?.name ?? ""),
        createTursoProject,
        createLocal: createDemoProject,
        appendSnapshots,
      });
      if (outcome === "turso" || outcome === "turso-without-history") await refreshTursoProjects();
      if (outcome === "local-after-turso-failure") showToast("info", t(lang, "demoCreatedLocallyToast"));
      if (outcome === "turso-without-history") showToast("info", t(lang, "demoTrendsSeedFailedToast"));
      startTour();
    } catch {
      showToast("error", t(lang, "tourDemoError"));
    }
  }, [lang, showToast, startTour, createDemoProject, createTursoProject, refreshTursoProjects, portfolioMode, tursoConfig, snapshots]);
}
