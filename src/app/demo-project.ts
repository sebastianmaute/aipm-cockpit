// src/app/demo-project.ts
//
// The demo orchestrator. With Turso usable it creates the demo as a Turso project and seeds its
// Trends history; otherwise (file mode, or Turso mode without a usable config) it keeps the local
// demo. `createDemo` is pure orchestration over injected effects; `useLoadDemo` wires it into the
// shell (deps-object hook, AGENTS.md "Extraction conventions").

import { useCallback } from "react";
import demoSnapshots from "../../sample-demo-snapshots.json";
import { clearDemoCreatedLocally, setDemoCreatedLocally } from "./demo-intent";
import { buildDemoWorkspace, DEMO_AS_OF } from "./demo-workspace";
import { shiftDemoSnapshots, thinForCadence } from "./demo-snapshot-shift";
import { demoShiftFor } from "./shift-workspace-dates";
import { bucketKey, type SnapshotCadence, type SnapshotRecord } from "./snapshot";
import { appendSnapshots } from "./snapshot-store";
import { defaultSnapshotSettings, type SnapshotSettings } from "./settings-types";
import { t, type Lang } from "./i18n";
import type { NewProjectOpts } from "./new-project-workspace";
import { loadPortfolioMode, type PortfolioMode } from "./portfolio-mode";
import { browserProjectIn, loadRegistry, type ProjectRegistryEntry } from "./projects-registry";
import type { TursoConfig } from "./turso-config";
import type { PlanGranularity, ProjectMeta } from "./types";
import type { Workspace } from "./workspace";

export type DemoOutcome =
  | "turso" | "local" | "local-after-turso-failure" | "turso-without-history"
  | "local-blocked" | "turso-failed";

/** The seeded history, imported statically so the card can quote its week count before any
 *  click: the file is ~79 KB raw, ~3 KB gzipped. */
const DEMO_RECORDS = demoSnapshots as unknown as readonly SnapshotRecord[];

/** The demo master's plan granularity, which sets the shift unit. `demo-project.test.ts` pins it
 *  to the master, so the card can count before the 89 KB master is loaded. */
export const DEMO_PLAN_GRANULARITY: PlanGranularity = "month";

let weeksCache: { today: string; weeks: number } | null = null;

/** How many weeks of history the demo stores when created on `today`: the card and the boot
 *  note quote it. ★ Not the file's length: the history ends before the current week, so the
 *  count moves with the date. Cached per date, so a render does not re-shift 27 records. */
export function demoHistoryWeeks(today: string): number {
  if (weeksCache?.today !== today) {
    weeksCache = { today, weeks: historyFor(DEMO_RECORDS, DEMO_PLAN_GRANULARITY, today, "weekly").length };
  }
  return weeksCache.weeks;
}

/** The sample master's `project.name`, which the Turso card quotes before the 89 KB master is
 *  loaded. `demo-project.test.ts` pins it to the master. The copy (`demoCardBody`) names it too. */
export const DEMO_SAMPLE_NAME = "Customer Identity Platform";

/** The one predicate for "the demo goes to Turso" (AGENTS.md "Turso-gated features"): the card's
 *  variant, the boot note and the create all read it. */
export function isTursoUsable(portfolioMode: PortfolioMode, tursoConfig: TursoConfig | null): boolean {
  return portfolioMode === "turso" && tursoConfig !== null;
}

export type DemoVariant = { kind: "local" } | { kind: "turso"; projectName: string };

export function demoVariantFor(lang: Lang, portfolioMode: PortfolioMode, tursoConfig: TursoConfig | null): DemoVariant {
  return isTursoUsable(portfolioMode, tursoConfig)
    ? { kind: "turso", projectName: t(lang, "demoProjectName", DEMO_SAMPLE_NAME) }
    : { kind: "local" };
}

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
  /** The browser-backed project the local demo would overwrite (`browserProjectIn`), or null.
   *  Set, the local create never runs: neither the local path nor the Turso fallback. */
  browserProject: ProjectRegistryEntry | null;
  /** Turso projects already exist, so the user has a working Turso portfolio (the Projects
   *  panel). A failed Turso create then reports and stays in Turso; the local fallback, which
   *  switches the portfolio to file mode and reloads, is for the empty state alone. */
  tursoProjectsExist: boolean;
  /** Runs before the local FALLBACK's create, which in Turso mode reloads the app: nothing after
   *  that create is guaranteed to run, so a notice for the next boot is stored here. */
  onLocalFallback?: () => void;
}

/** The seeded history as the new project should hold it: shifted by the workspace's own shift,
 *  thinned to the user's cadence, and ending before the current bucket (left to the live
 *  capture, so no bucket is written twice). The first remaining record is the baseline. */
export function demoHistoryFor(
  records: readonly SnapshotRecord[],
  ws: Workspace,
  today: string,
  cadence: SnapshotCadence,
): SnapshotRecord[] {
  return historyFor(records, ws.plan.granularity, today, cadence);
}

function historyFor(
  records: readonly SnapshotRecord[],
  granularity: PlanGranularity,
  today: string,
  cadence: SnapshotCadence,
): SnapshotRecord[] {
  const n = demoShiftFor(DEMO_AS_OF, today, granularity);
  const now = new Date(`${today}T00:00:00Z`);
  // Compared per record cadence: a monthly-thinned record carries a "YYYY-MM" bucket, which
  // never orders against a weekly "YYYY-Www" key.
  return thinForCadence(shiftDemoSnapshots(records, n, granularity), cadence)
    .filter((r) => r.bucket < bucketKey(now, r.cadence))
    .map((r, i) => ({ ...r, isBaseline: i === 0 }));
}

export async function createDemo(deps: CreateDemoDeps): Promise<DemoOutcome> {
  const { ws } = deps;
  if (!deps.tursoUsable || !ws.project) {
    if (deps.browserProject) return "local-blocked";
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
    if (deps.tursoProjectsExist) return "turso-failed";
    if (deps.browserProject) return "local-blocked";
    deps.onLocalFallback?.();
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
  /** The Turso project list is non-empty (`tursoProjects.length > 0`): the demo came from the
   *  Projects panel of a working Turso portfolio, so a failed create must not fall back. */
  hasTursoProjects: boolean;
}

/** Loads the curated sample as a REAL, deletable demo project and kicks off the tour. Registering
 *  the project is what flips the empty-state gate off so the views and the tour overlay mount.
 *  The entry is reachable while projects exist (the Projects panel), so the local create, which
 *  rewrites the one shared browser store, is refused while the registry holds a browser-backed
 *  project (`browserProjectIn`, read at click time). Errors toast, never crash. */
export function useLoadDemo(deps: UseLoadDemoDeps): () => Promise<void> {
  const {
    lang, showToast, startTour, createDemoProject, createTursoProject, refreshTursoProjects,
    portfolioMode, tursoConfig, snapshots, hasTursoProjects,
  } = deps;
  return useCallback(async () => {
    try {
      const mod = await import("../../sample-workspace-small.json");
      const today = new Date().toISOString().slice(0, 10); // callback context — lint-safe
      const ws = buildDemoWorkspace((mod as { default?: unknown }).default ?? mod, today);
      const browserProject = browserProjectIn(loadRegistry().projects);
      const outcome = await createDemo({
        ws,
        records: DEMO_RECORDS,
        today,
        tursoUsable: isTursoUsable(portfolioMode, tursoConfig),
        cadence: (snapshots ?? defaultSnapshotSettings).cadence,
        tursoConfig,
        projectName: t(lang, "demoProjectName", ws.project?.name ?? ""),
        createTursoProject,
        createLocal: createDemoProject,
        appendSnapshots,
        browserProject,
        tursoProjectsExist: hasTursoProjects,
        onLocalFallback: setDemoCreatedLocally,
      });
      if (outcome === "local-blocked") {
        showToast("error", t(lang, "demoLocalBlocked", browserProject?.name ?? ""));
        return;
      }
      if (outcome === "turso-failed") {
        showToast("error", t(lang, "tourDemoError"));
        return;
      }
      if (outcome === "turso" || outcome === "turso-without-history") await refreshTursoProjects();
      // The fallback that worked moved the portfolio to file mode and is reloading; the next boot
      // shows the stored notice. Still on Turso means it did not (it failed and said so, or it
      // returned early), so there is no local demo to announce.
      if (outcome === "local-after-turso-failure" && loadPortfolioMode() === "turso") clearDemoCreatedLocally();
      if (outcome === "turso-without-history") showToast("info", t(lang, "demoTrendsSeedFailedToast"));
      startTour();
    } catch {
      showToast("error", t(lang, "tourDemoError"));
    }
  }, [lang, showToast, startTour, createDemoProject, createTursoProject, refreshTursoProjects, portfolioMode, tursoConfig, snapshots, hasTursoProjects]);
}
