// src/app/demo-project.test.ts
//
// The demo orchestrator: Turso project + seeded Trends history when Turso is
// usable, the local demo otherwise, and the hook that wires it into the shell.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./snapshot-store", () => ({ appendSnapshots: vi.fn() }));

import {
  createDemo, DEMO_SAMPLE_NAME, DEMO_SNAPSHOT_WEEKS, demoVariantFor, isTursoUsable, useLoadDemo,
  type CreateDemoDeps, type UseLoadDemoDeps,
} from "./demo-project";
import { readDemoCreatedLocally } from "./demo-intent";
import { MODE_KEY } from "./portfolio-mode";
import { addProject, emptyRegistry, saveRegistry, type ProjectRegistryEntry } from "./projects-registry";
import { appendSnapshots } from "./snapshot-store";
import { buildDemoWorkspace } from "./demo-workspace";
import type { SnapshotRecord } from "./snapshot";
import type { TursoConfig } from "./turso-config";
import type { NewProjectOpts } from "./new-project-workspace";
import type { ProjectMeta } from "./types";
import { t } from "./i18n";

const TODAY = "2026-10-02"; // DEMO_AS_OF is 2026-09-18 → a one-month shift
const MASTER: unknown = JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", "sample-workspace-small.json"), "utf8"));
const WS = buildDemoWorkspace(MASTER, TODAY);
const CONFIG = { httpUrl: "https://db.example", authToken: "tok" } as unknown as TursoConfig;

function rec(capturedAt: string, isBaseline = false): SnapshotRecord {
  return {
    id: capturedAt, capturedAt, bucket: "", cadence: "weekly", trigger: "auto", isBaseline,
    remainingHours: 10, remainingCost: 100, pctComplete: 50,
    forecastEndDate: "2027-02-26", planEndDate: "2027-02-26", spi: 1, cpi: 1,
    overallRag: "G", scheduleRag: "G", budgetRag: "G", scopeRag: "",
    milestones: [], bucketProgress: [], series: [],
  };
}

// +1 month: 03-27 → 04-27 (Mon) and 04-03 → 05-03 (Sun) land in ONE ISO week (2026-W18), so the
// later one wins and the authored baseline is gone. 08-28 → 09-28 and 09-04 → 10-04 are today's
// week (W40), 09-11 → 10-11 is after it: all three are left to the live capture.
const RECORDS: SnapshotRecord[] = [
  rec("2026-03-27T17:00:00.000Z", true),
  rec("2026-04-03T17:00:00.000Z"),
  rec("2026-04-10T17:00:00.000Z"),
  rec("2026-08-21T17:00:00.000Z"),
  rec("2026-08-28T17:00:00.000Z"),
  rec("2026-09-04T17:00:00.000Z"),
  rec("2026-09-11T17:00:00.000Z"),
];

/** A create that behaves like the real one: it runs the seed with the new id, then the project
 *  becomes current ("applied"), then it resolves. `events` records that order. */
function fakeCreate(id: string | null, events: string[] = []) {
  return vi.fn(async (_meta: ProjectMeta, opts?: NewProjectOpts) => {
    if (id === null) return null;
    await opts?.seedSnapshots?.(id);
    events.push("applied");
    return id;
  });
}

function deps(over: Partial<CreateDemoDeps> = {}): CreateDemoDeps {
  return {
    ws: WS, records: RECORDS, today: TODAY, tursoUsable: true, cadence: "weekly", tursoConfig: CONFIG,
    projectName: "Customer Identity Platform (demo)",
    createTursoProject: fakeCreate("id-1"),
    createLocal: vi.fn(async () => {}),
    appendSnapshots: vi.fn(async () => {}),
    browserProject: null, tursoProjectsExist: false,
    ...over,
  };
}

const BROWSER_PROJECT: ProjectRegistryEntry = { id: "b-1", name: "Mercury", code: "MER", storageConfig: { kind: "browser" } };

function written(d: CreateDemoDeps): SnapshotRecord[] {
  return vi.mocked(d.appendSnapshots).mock.calls[0][1] as SnapshotRecord[];
}

describe("createDemo", () => {
  it("creates the local demo and never touches Turso when Turso is not usable", async () => {
    const d = deps({ tursoUsable: false });
    await expect(createDemo(d)).resolves.toBe("local");
    expect(d.createLocal).toHaveBeenCalledTimes(1);
    expect(d.createLocal).toHaveBeenCalledWith(WS);
    expect(d.createTursoProject).not.toHaveBeenCalled();
    expect(d.appendSnapshots).not.toHaveBeenCalled();
  });

  it("creates a Turso project named for the demo from the demo workspace and seeds its history", async () => {
    const d = deps();
    await expect(createDemo(d)).resolves.toBe("turso");
    expect(d.createTursoProject).toHaveBeenCalledTimes(1);
    const [meta, opts] = vi.mocked(d.createTursoProject).mock.calls[0];
    expect(meta).toEqual({ ...WS.project, name: "Customer Identity Platform (demo)" });
    expect(meta.code).toBe("CIP-2026");
    expect(opts.importedWorkspace).toBe(WS);
    expect(d.appendSnapshots).toHaveBeenCalledTimes(1);
    const [config, , projectId] = vi.mocked(d.appendSnapshots).mock.calls[0];
    expect(config).toBe(CONFIG);
    expect(projectId).toBe("id-1");
    expect(d.createLocal).not.toHaveBeenCalled();
  });

  it("shifts the records by the workspace's month shift, keeps one per bucket and stops before today's week", async () => {
    const d = deps();
    await createDemo(d);
    const out = written(d);
    expect(out.map((r) => r.capturedAt)).toEqual([
      "2026-05-03T17:00:00.000Z",
      "2026-05-10T17:00:00.000Z",
      "2026-09-21T17:00:00.000Z",
    ]);
    expect(out.map((r) => r.bucket)).toEqual(["2026-W18", "2026-W19", "2026-W39"]);
    expect(out.map((r) => r.id)).toEqual(out.map((r) => `id-1:${r.capturedAt}`));
  });

  it("marks exactly the first written record as baseline when the shift dropped the authored one", async () => {
    const d = deps();
    await createDemo(d);
    expect(written(d).map((r) => r.isBaseline)).toEqual([true, false, false]);
  });

  it("thins to the monthly cadence and leaves the current month to the live capture", async () => {
    const d = deps({ cadence: "monthly" });
    await createDemo(d);
    const out = written(d);
    expect(out.map((r) => r.capturedAt)).toEqual(["2026-05-10T17:00:00.000Z", "2026-09-21T17:00:00.000Z"]);
    expect(out.map((r) => r.bucket)).toEqual(["2026-05", "2026-09"]);
    expect(out.map((r) => r.cadence)).toEqual(["monthly", "monthly"]);
    expect(out.map((r) => r.isBaseline)).toEqual([true, false]);
  });

  it("falls back to the local demo, without seeding, when the Turso create returns no id", async () => {
    const d = deps({ createTursoProject: fakeCreate(null) });
    await expect(createDemo(d)).resolves.toBe("local-after-turso-failure");
    expect(d.createLocal).toHaveBeenCalledTimes(1);
    expect(d.createLocal).toHaveBeenCalledWith(WS);
    expect(d.appendSnapshots).not.toHaveBeenCalled();
  });

  // The local fallback switches the portfolio to file mode and RELOADS, so the notice has to be
  // stored before the create runs: nothing after it is guaranteed to execute.
  it("announces the local fallback before the local create runs", async () => {
    const order: string[] = [];
    const d = deps({
      createTursoProject: fakeCreate(null),
      onLocalFallback: () => { order.push("notice"); },
      createLocal: vi.fn(async () => { order.push("createLocal"); }),
    });
    await createDemo(d);
    expect(order).toEqual(["notice", "createLocal"]);
  });

  it("announces no fallback on the plain local path or a Turso success", async () => {
    const onLocalFallback = vi.fn();
    await createDemo(deps({ tursoUsable: false, onLocalFallback }));
    await createDemo(deps({ onLocalFallback }));
    expect(onLocalFallback).not.toHaveBeenCalled();
  });

  it("keeps the Turso project when only the history write fails", async () => {
    const d = deps({ appendSnapshots: vi.fn(async () => { throw new Error("boom"); }) });
    await expect(createDemo(d)).resolves.toBe("turso-without-history");
    expect(d.createLocal).not.toHaveBeenCalled();
  });

  it("writes the history through the create's seed, before the project becomes current", async () => {
    const events: string[] = [];
    const d = deps({ createTursoProject: fakeCreate("id-1", events), appendSnapshots: vi.fn(async () => { events.push("seeded"); }) });
    await expect(createDemo(d)).resolves.toBe("turso");
    expect(events).toEqual(["seeded", "applied"]);
  });

  it("reports the history as missing when the create never ran the seed", async () => {
    const d = deps({ createTursoProject: vi.fn(async () => "id-1") });
    await expect(createDemo(d)).resolves.toBe("turso-without-history");
    expect(d.appendSnapshots).not.toHaveBeenCalled();
  });

  it("namespaces the seeded ids by project, so two demos in one database never collide", async () => {
    const a = deps({ createTursoProject: fakeCreate("p-a") });
    const b = deps({ createTursoProject: fakeCreate("p-b") });
    await createDemo(a);
    await createDemo(b);
    const idsA = written(a).map((r) => r.id);
    const idsB = written(b).map((r) => r.id);
    expect(idsA.length).toBeGreaterThan(0);
    expect(idsA.every((x) => x.startsWith("p-a:"))).toBe(true);
    expect(idsB.every((x) => x.startsWith("p-b:"))).toBe(true);
    expect(idsA.filter((x) => idsB.includes(x))).toEqual([]);
    expect(written(a).map((r) => r.capturedAt)).toEqual(written(b).map((r) => r.capturedAt));
  });

  // C1: the local create rewrites the ONE browser store blind, so with a browser-backed project
  // registered it never runs, on the local path or as the Turso fallback.
  it("refuses the local path, writing nothing, while a browser-backed project is registered", async () => {
    const d = deps({ tursoUsable: false, browserProject: BROWSER_PROJECT });
    await expect(createDemo(d)).resolves.toBe("local-blocked");
    expect(d.createLocal).not.toHaveBeenCalled();
    expect(d.createTursoProject).not.toHaveBeenCalled();
  });

  it("does not fall back to the local demo after a failed Turso create while a browser-backed project is registered", async () => {
    const onLocalFallback = vi.fn();
    const d = deps({ createTursoProject: fakeCreate(null), browserProject: BROWSER_PROJECT, onLocalFallback });
    await expect(createDemo(d)).resolves.toBe("local-blocked");
    expect(d.createLocal).not.toHaveBeenCalled();
    expect(onLocalFallback).not.toHaveBeenCalled();
  });

  it("still creates the Turso demo while a browser-backed project is registered", async () => {
    const d = deps({ browserProject: BROWSER_PROJECT });
    await expect(createDemo(d)).resolves.toBe("turso");
    expect(d.createLocal).not.toHaveBeenCalled();
  });

  // I4: with Turso projects present (the Projects panel) a failed create reports and stays in
  // Turso; the fallback, which moves the portfolio to file mode and reloads, is the empty state's.
  it("stays in Turso, without the local fallback, when the create fails while Turso projects exist", async () => {
    const onLocalFallback = vi.fn();
    const d = deps({ createTursoProject: fakeCreate(null), tursoProjectsExist: true, onLocalFallback });
    await expect(createDemo(d)).resolves.toBe("turso-failed");
    expect(d.createLocal).not.toHaveBeenCalled();
    expect(onLocalFallback).not.toHaveBeenCalled();
  });
});

describe("the demo's start-card facts", () => {
  it("counts the weeks from the committed snapshot file", () => {
    const committed: unknown[] = JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", "sample-demo-snapshots.json"), "utf8"));
    expect(committed.length).toBeGreaterThan(0);
    expect(DEMO_SNAPSHOT_WEEKS).toBe(committed.length);
  });

  it("names the sample exactly as the master does", () => {
    expect(DEMO_SAMPLE_NAME).toBe((MASTER as { project: { name: string } }).project.name);
  });

  it("calls Turso usable only in Turso mode with a config", () => {
    expect(isTursoUsable("turso", CONFIG)).toBe(true);
    expect(isTursoUsable("turso", null)).toBe(false);
    expect(isTursoUsable("file", CONFIG)).toBe(false);
  });

  it("picks the card variant from the same predicate, naming the project as the create does", () => {
    expect(demoVariantFor("en-US", "file", CONFIG)).toEqual({ kind: "local" });
    expect(demoVariantFor("en-US", "turso", null)).toEqual({ kind: "local" });
    expect(demoVariantFor("en-US", "turso", CONFIG)).toEqual({
      kind: "turso", projectName: t("en-US", "demoProjectName", "Customer Identity Platform"),
    });
  });
});

describe("useLoadDemo", () => {
  afterEach(() => window.localStorage.clear());
  beforeEach(() => {
    vi.mocked(appendSnapshots).mockReset();
    vi.mocked(appendSnapshots).mockResolvedValue(undefined);
  });

  function hookDeps(over: Partial<UseLoadDemoDeps> = {}): UseLoadDemoDeps {
    return {
      lang: "en-US", showToast: vi.fn(), startTour: vi.fn(),
      createDemoProject: vi.fn(async () => {}),
      createTursoProject: fakeCreate("id-1"),
      refreshTursoProjects: vi.fn(async () => null),
      portfolioMode: "turso", tursoConfig: CONFIG, snapshots: undefined, hasTursoProjects: false,
      ...over,
    };
  }

  async function run(d: UseLoadDemoDeps): Promise<void> {
    const { result } = renderHook(() => useLoadDemo(d));
    await act(async () => { await result.current(); });
  }

  it("file mode: creates the local demo and starts the tour, with no toast", async () => {
    const d = hookDeps({ portfolioMode: "file" });
    await run(d);
    expect(d.createDemoProject).toHaveBeenCalledTimes(1);
    expect(d.createTursoProject).not.toHaveBeenCalled();
    expect(d.startTour).toHaveBeenCalledTimes(1);
    expect(d.showToast).not.toHaveBeenCalled();
  });

  it("Turso mode without a usable config takes the local path", async () => {
    const d = hookDeps({ tursoConfig: null });
    await run(d);
    expect(d.createDemoProject).toHaveBeenCalledTimes(1);
    expect(d.createTursoProject).not.toHaveBeenCalled();
  });

  it("Turso mode: names the project, seeds the committed history, refreshes the list, then starts the tour", async () => {
    const d = hookDeps();
    await run(d);
    expect(vi.mocked(d.createTursoProject).mock.calls[0][0].name).toBe(t("en-US", "demoProjectName", "Customer Identity Platform"));
    expect(appendSnapshots).toHaveBeenCalledTimes(1);
    const [, recs, projectId] = vi.mocked(appendSnapshots).mock.calls[0];
    expect(projectId).toBe("id-1");
    expect(recs.length).toBeGreaterThan(0);
    expect(d.refreshTursoProjects).toHaveBeenCalledTimes(1);
    expect(d.startTour).toHaveBeenCalledTimes(1);
    expect(vi.mocked(d.refreshTursoProjects).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(d.startTour).mock.invocationCallOrder[0]);
    expect(d.showToast).not.toHaveBeenCalled();
  });

  it("thins the seeded history to the configured monthly cadence", async () => {
    const d = hookDeps({ snapshots: { enabled: true, cadence: "monthly" } as UseLoadDemoDeps["snapshots"] });
    await run(d);
    const recs = vi.mocked(appendSnapshots).mock.calls[0][1];
    expect(recs.every((r) => r.cadence === "monthly")).toBe(true);
  });

  // The local fallback reloads the app, so a toast here is never seen: the notice is stored for
  // the next boot instead (`useDemoIntentOnBoot` shows it).
  it("stores the created-locally notice for the next boot when the Turso create fails", async () => {
    let storedBeforeCreate = false;
    const d = hookDeps({
      createTursoProject: fakeCreate(null),
      createDemoProject: vi.fn(async () => {
        storedBeforeCreate = readDemoCreatedLocally();
        window.localStorage.setItem(MODE_KEY, "file"); // what the real fallback does before it reloads
      }),
    });
    await run(d);
    expect(d.createDemoProject).toHaveBeenCalledTimes(1);
    expect(storedBeforeCreate).toBe(true);
    expect(readDemoCreatedLocally()).toBe(true);
    expect(d.showToast).not.toHaveBeenCalled();
    expect(d.refreshTursoProjects).not.toHaveBeenCalled();
    expect(d.startTour).toHaveBeenCalledTimes(1);
  });

  it("drops the notice when the fallback left the portfolio on Turso (no reload is coming)", async () => {
    window.localStorage.setItem(MODE_KEY, "turso");
    const d = hookDeps({ createTursoProject: fakeCreate(null) });
    await run(d);
    expect(d.createDemoProject).toHaveBeenCalledTimes(1);
    expect(readDemoCreatedLocally()).toBe(false);
  });

  it("stores no notice on the plain local path", async () => {
    await run(hookDeps({ portfolioMode: "file" }));
    expect(readDemoCreatedLocally()).toBe(false);
  });

  it("toasts that the Trends history could not be added when only the seed fails", async () => {
    vi.mocked(appendSnapshots).mockRejectedValue(new Error("boom"));
    const d = hookDeps();
    await run(d);
    expect(d.showToast).toHaveBeenCalledWith("info", t("en-US", "demoTrendsSeedFailedToast"));
    expect(d.refreshTursoProjects).toHaveBeenCalledTimes(1);
    expect(d.startTour).toHaveBeenCalledTimes(1);
  });

  it("refuses the local demo, naming the project it would replace, while the registry holds a browser-backed one", async () => {
    saveRegistry(addProject(emptyRegistry(), BROWSER_PROJECT, true));
    const d = hookDeps({ portfolioMode: "file" });
    await run(d);
    expect(d.createDemoProject).not.toHaveBeenCalled();
    expect(d.showToast).toHaveBeenCalledWith("error", t("en-US", "demoLocalBlocked", "Mercury"));
    expect(d.startTour).not.toHaveBeenCalled();
  });

  it("blocks the Turso fallback too while the registry holds a browser-backed project", async () => {
    saveRegistry(addProject(emptyRegistry(), BROWSER_PROJECT, true));
    const d = hookDeps({ createTursoProject: fakeCreate(null) });
    await run(d);
    expect(d.createDemoProject).not.toHaveBeenCalled();
    expect(readDemoCreatedLocally()).toBe(false);
    expect(d.showToast).toHaveBeenCalledWith("error", t("en-US", "demoLocalBlocked", "Mercury"));
  });

  it("from the Projects panel of a Turso portfolio, a failed create toasts and stays in Turso", async () => {
    const d = hookDeps({ createTursoProject: fakeCreate(null), hasTursoProjects: true });
    await run(d);
    expect(d.createDemoProject).not.toHaveBeenCalled();
    expect(readDemoCreatedLocally()).toBe(false);
    expect(d.showToast).toHaveBeenCalledWith("error", t("en-US", "tourDemoError"));
    expect(d.refreshTursoProjects).not.toHaveBeenCalled();
    expect(d.startTour).not.toHaveBeenCalled();
  });

  it("from the Projects panel of a Turso portfolio, a created demo still seeds and refreshes", async () => {
    const d = hookDeps({ hasTursoProjects: true });
    await run(d);
    expect(d.createTursoProject).toHaveBeenCalledTimes(1);
    expect(d.refreshTursoProjects).toHaveBeenCalledTimes(1);
    expect(d.showToast).not.toHaveBeenCalled();
  });

  it("toasts the demo error and starts no tour when the demo cannot be created", async () => {
    const d = hookDeps({ portfolioMode: "file", createDemoProject: vi.fn(async () => { throw new Error("x"); }) });
    await run(d);
    expect(d.showToast).toHaveBeenCalledWith("error", t("en-US", "tourDemoError"));
    expect(d.startTour).not.toHaveBeenCalled();
  });
});
