import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, beforeEach, vi } from "vitest";
import TaskManager from "./task-manager";

// Mock the Turso portfolio list calls so no network is hit. The active list is
// empty (→ empty-state should show in turso mode after load); archived is empty.
const listProjects = vi.fn(async () => [] as unknown[]);
const listArchivedProjects = vi.fn(async () => [] as unknown[]);
vi.mock("./turso-portfolio", () => ({
  listProjects: () => listProjects(),
  listArchivedProjects: () => listArchivedProjects(),
  updateProjectMeta: vi.fn(async () => {}),
  createProject: vi.fn(async () => {}),
  archiveProject: vi.fn(async () => {}),
  restoreProject: vi.fn(async () => {}),
  hardDeleteProject: vi.fn(async () => {}),
}));

// A valid Turso config so getTursoConfig() returns non-null and the refresh runs.
function seedTursoSettings() {
  window.localStorage.setItem(
    "lop-app:settings",
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
    "lop-app:projects",
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
    window.localStorage.setItem("lop-app:portfolio-mode", "turso");
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
    expect(listProjects).toHaveBeenCalled();
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
