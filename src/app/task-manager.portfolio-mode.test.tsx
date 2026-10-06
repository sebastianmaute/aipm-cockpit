import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, beforeEach, vi } from "vitest";
import TaskManager from "./task-manager";

// Pass-through captures of the two hooks' args, for the wiring test below (§491).
const wiring = vi.hoisted(() => ({
  backendOutcome: null as ((err: unknown | null) => void) | null,
  listOutcome: null as ((err: unknown | null) => void) | null,
}));
vi.mock("./use-storage-backend", async (importOriginal) => {
  const mod = await importOriginal<typeof import("./use-storage-backend")>();
  return {
    ...mod,
    useStorageBackend: (args: Parameters<typeof mod.useStorageBackend>[0]) => {
      wiring.backendOutcome = args.onStorageOutcome ?? null;
      return mod.useStorageBackend(args);
    },
  };
});
vi.mock("./use-turso-project-list", async (importOriginal) => {
  const mod = await importOriginal<typeof import("./use-turso-project-list")>();
  return {
    ...mod,
    useTursoProjectList: (deps: Parameters<typeof mod.useTursoProjectList>[0]) => {
      wiring.listOutcome = deps.reportStorageOutcome;
      return mod.useTursoProjectList(deps);
    },
  };
});

// Mock the Turso portfolio list calls so no network is hit. The active list is
// empty (→ empty-state should show in turso mode after load); archived is empty.
const listProjects = vi.fn<(cfg: unknown) => Promise<unknown[]>>(async () => []);
const listArchivedProjects = vi.fn<(cfg: unknown) => Promise<unknown[]>>(async () => []);
vi.mock("./turso-portfolio", () => ({
  listProjects: (cfg: unknown) => listProjects(cfg),
  listArchivedProjects: (cfg: unknown) => listArchivedProjects(cfg),
  updateProjectMeta: vi.fn(async () => {}),
  createProject: vi.fn(async () => {}),
  archiveProject: vi.fn(async () => {}),
  restoreProject: vi.fn(async () => {}),
  hardDeleteProject: vi.fn(async () => {}),
}));

// A valid Turso config so getTursoConfig() returns non-null and the refresh runs.
function seedTursoSettings() {
  window.localStorage.setItem(
    "aipm-cockpit:settings",
    JSON.stringify({
      integrations: {
        turso: {
          enabled: true,
          databaseUrl: "https://example.turso.io",
          authToken: "tok",
        },
      },
    }),
  );
}

function seedFileRegistry() {
  window.localStorage.setItem(
    "aipm-cockpit:projects",
    JSON.stringify({
      projects: [
        { id: "p1", name: "Seed", code: "SEED", storageConfig: { kind: "browser" } },
      ],
      currentProjectId: "p1",
    }),
  );
}

describe("TaskManager portfolio mode (Turso)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    listProjects.mockClear();
    listArchivedProjects.mockClear();
  });

  it("shows the empty-state in turso mode once the (empty) project list loads", async () => {
    window.localStorage.setItem("aipm-cockpit:portfolio-mode", "turso");
    seedTursoSettings();
    // A file registry IS seeded; turso mode must IGNORE it and use the DB list.
    seedFileRegistry();

    render(<TaskManager />);

    // The empty-state modal (title + Create button) appears only after the
    // shared-DB list resolves empty — proving turso mode drives the gate.
    // Extra timeout headroom: this heavy TaskManager mount + async DB resolve can
    // exceed the 20s default under full-suite coverage load on a slow machine
    // (the documented load-timeout flake; passes in isolation and CI). The findBy
    // poll AND the per-test budget (it()'s 3rd arg below) must both exceed the
    // suite default — a findBy timeout alone is capped by testTimeout.
    expect(await screen.findByText("Create a new project", undefined, { timeout: 40000 })).toBeTruthy();
    // The Settings token reaches the DB call (§491: the `useTursoProjectList` call site
    // passes the URL and the token as two separate deps fields).
    expect(listProjects).toHaveBeenCalledWith(expect.objectContaining({ authToken: "tok" }));
  }, 45000);

  // ★ Pins the `reportStorageOutcome` wiring at the `useTursoProjectList` call
  // site (§491): the hook's own test passes a mock, so only a mounted TaskManager
  // can show that a failed list fetch reports to the storage-status bridge.
  // ★★ It asserts IDENTITY with the bridge the storage backend reports to, not the
  // banner. The banner is a single slot that three reporters share in this setup —
  // the backend's own load success (`null`, which clears it), the Turso snapshot
  // capture, and the list — and it renders only after the load hold. Measured with a
  // probe: a banner test passed only by catching the banner in the gap between a
  // list failure and the backend's success, and with that order fixed a banner was
  // already up before the list failed. Neither shape can isolate the list's report.
  it("hands the list hook the same storage-outcome bridge the storage backend reports to", async () => {
    window.localStorage.setItem("aipm-cockpit:portfolio-mode", "turso");
    seedTursoSettings();

    render(<TaskManager />);

    // Same headroom as the empty-state test above: a heavy mount plus an async DB call.
    await waitFor(() => expect(listProjects).toHaveBeenCalled(), { timeout: 40000 });
    expect(wiring.backendOutcome).toBeTypeOf("function");
    expect(wiring.listOutcome).toBe(wiring.backendOutcome);
  }, 45000);

  it("file mode is unchanged: a seeded registry suppresses the empty-state", async () => {
    // No portfolio-mode key → defaults to "file".
    seedFileRegistry();

    render(<TaskManager />);

    // App chrome renders (modern sidebar brand); empty-state does NOT.
    expect(await screen.findByText("PROJECT MANAGEMENT TRACKER")).toBeTruthy();
    expect(screen.queryByText("Create a new project")).toBeNull();
    // Turso list calls are never made in file mode.
    await waitFor(() => expect(listProjects).not.toHaveBeenCalled());
  });
});
