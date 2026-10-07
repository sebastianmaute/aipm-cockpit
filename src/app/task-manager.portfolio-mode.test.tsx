// A real IndexedDB, so a browser-backend save succeeds instead of raising its own banner (§678).
import "fake-indexeddb/auto";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, beforeEach, vi } from "vitest";
import TaskManager from "./task-manager";

// Pass-through captures of the two hooks' args, for the wiring test below (§491).
const wiring = vi.hoisted(() => ({
  backendOutcome: null as ((err: unknown | null) => void) | null,
  listOutcome: null as ((err: unknown | null) => void) | null,
  muteSnapshotErrors: false,
  backendSucceeded: false,
}));
vi.mock("./use-storage-backend", async (importOriginal) => {
  const mod = await importOriginal<typeof import("./use-storage-backend")>();
  return {
    ...mod,
    useStorageBackend: (args: Parameters<typeof mod.useStorageBackend>[0]) => {
      wiring.backendOutcome = args.onStorageOutcome ?? null;
      const report = args.onStorageOutcome;
      return mod.useStorageBackend({
        ...args,
        onStorageOutcome: report && ((err) => {
          if (err == null) wiring.backendSucceeded = true;
          report(err);
        }),
      });
    },
  };
});
// §678's test mutes the snapshot auto-capture's error report: in this setup it fails too,
// and its banner would hide whether the LIST failure survived the backend's success.
vi.mock("./use-snapshots", async (importOriginal) => {
  const mod = await importOriginal<typeof import("./use-snapshots")>();
  return {
    ...mod,
    useSnapshots: (args: Parameters<typeof mod.useSnapshots>[0]) =>
      mod.useSnapshots(wiring.muteSnapshotErrors ? { ...args, onError: () => {} } : args),
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
    listProjects.mockReset();
    listProjects.mockImplementation(async () => []);
    listArchivedProjects.mockReset();
    listArchivedProjects.mockImplementation(async () => []);
    // Module-level captures: reset so no test can read a previous mount's args.
    wiring.backendOutcome = null;
    wiring.listOutcome = null;
    wiring.muteSnapshotErrors = false;
    wiring.backendSucceeded = false;
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

  // §678: a failed list fetch must stay visible after the storage backend reports its own
  // load success. That success clears the shared storage error, and the list is still
  // unloaded, so without a separate list-failure state the loading skeleton came back
  // over a list that had failed. Measured order here: list failure, then the backend's
  // `null`, then a snapshot failure, which is muted so only the list can raise the banner.
  it("keeps the list-failure banner, not the loading skeleton, after the backend load succeeds", async () => {
    window.localStorage.setItem("aipm-cockpit:portfolio-mode", "turso");
    seedTursoSettings();
    wiring.muteSnapshotErrors = true;
    listProjects.mockImplementation(async () => {
      throw new TypeError("Failed to fetch");
    });

    render(<TaskManager />);

    // Same headroom as the empty-state test above: a heavy mount plus an async DB call.
    await waitFor(() => expect(listProjects).toHaveBeenCalled(), { timeout: 40000 });
    // The backend's own success, which clears the shared storage error, lands after the
    // list failure; assert only once it has.
    await waitFor(() => expect(wiring.backendSucceeded).toBe(true), { timeout: 40000 });
    expect(
      await screen.findByRole("region", { name: "Storage connection problem" }),
    ).toBeTruthy();
    expect(screen.queryByText("Loading…")).toBeNull();
    // The sidebar status dot reads the same combined failure, so it is not green either.
    expect(document.querySelector("[data-storage-marker]")?.getAttribute("data-storage-marker")).toBe("not-ready");
  }, 45000);

  // §678 review: a dismissed list failure stays dismissed through a good save, because the
  // list is still failing; a NEW backend failure after that still re-shows the banner.
  it("keeps a dismissed list-failure banner hidden after a good save, and re-shows it for a backend failure", async () => {
    window.localStorage.setItem("aipm-cockpit:portfolio-mode", "turso");
    seedTursoSettings();
    wiring.muteSnapshotErrors = true;
    listProjects.mockImplementation(async () => {
      throw new TypeError("Failed to fetch");
    });

    render(<TaskManager />);

    await waitFor(() => expect(listProjects).toHaveBeenCalled(), { timeout: 40000 });
    await waitFor(() => expect(wiring.backendSucceeded).toBe(true), { timeout: 40000 });
    const banner = await screen.findByRole("region", { name: "Storage connection problem" });
    fireEvent.click(within(banner).getByRole("button", { name: /dismiss/i }));
    expect(screen.queryByRole("region", { name: "Storage connection problem" })).toBeNull();

    // A good save reports `null` through the same bridge the backend uses.
    act(() => wiring.backendOutcome?.(null));
    expect(screen.queryByRole("region", { name: "Storage connection problem" })).toBeNull();

    act(() => wiring.backendOutcome?.(new TypeError("Failed to fetch")));
    const backendBanner = screen.getByRole("region", { name: "Storage connection problem" });

    // A dismissed backend failure stays hidden while it repeats, and its recovery clears
    // the dismissal, so the next backend failure is shown again.
    fireEvent.click(within(backendBanner).getByRole("button", { name: /dismiss/i }));
    act(() => wiring.backendOutcome?.(new TypeError("Failed to fetch")));
    expect(screen.queryByRole("region", { name: "Storage connection problem" })).toBeNull();
    act(() => wiring.backendOutcome?.(null));
    act(() => wiring.backendOutcome?.(new TypeError("Failed to fetch")));
    expect(screen.getByRole("region", { name: "Storage connection problem" })).toBeTruthy();
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
