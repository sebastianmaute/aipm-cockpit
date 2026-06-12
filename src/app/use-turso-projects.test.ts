// src/app/use-turso-projects.test.ts
//
// The hook's job is (1) mode-routing the portfolio lifecycle callbacks and
// (2) surfacing failed Turso operations as error toasts — previously these
// async chains were fire-and-forget and rejections vanished silently.
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useTursoProjects, type UseTursoProjectsArgs } from "./use-turso-projects";
import type { ProjectListEntry } from "./turso-tenant-schema";
import type { ProjectMeta } from "./types";

vi.mock("./turso-portfolio", () => ({
  listProjects: vi.fn(),
  updateProjectMeta: vi.fn(),
}));
vi.mock("./turso-config", () => ({
  getTursoConfig: vi.fn(() => ({ httpUrl: "https://db.example", authToken: "tok" })),
}));

import { listProjects, updateProjectMeta } from "./turso-portfolio";
import { getTursoConfig } from "./turso-config";

const META = { name: "Apollo", code: "AP" } as ProjectMeta;

function makeArgs(overrides: Partial<UseTursoProjectsArgs> = {}): UseTursoProjectsArgs {
  return {
    portfolioMode: "turso",
    lang: "en-US",
    showToast: vi.fn(),
    tursoDatabaseUrl: "libsql://db.example",
    tursoAuthToken: "tok",
    tursoProjectId: "p-1",
    switchToTursoProject: vi.fn(async () => {}),
    createTursoProject: vi.fn(async () => {}),
    archiveTursoProject: vi.fn(async () => {}),
    restoreTursoProject: vi.fn(async () => {}),
    hardDeleteTursoProject: vi.fn(async () => {}),
    // Default: refresh "failed" (null) so repoint falls back to its own fetch.
    refreshTursoProjects: vi.fn<UseTursoProjectsArgs["refreshTursoProjects"]>(async () => null),
    setProject: vi.fn(),
    createFileProject: vi.fn(),
    updateCurrentFileProject: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(listProjects).mockReset().mockResolvedValue([]);
  vi.mocked(updateProjectMeta).mockReset().mockResolvedValue(undefined);
  vi.mocked(getTursoConfig).mockClear();
});

describe("useTursoProjects — create", () => {
  it("turso mode: creates then refreshes, no toast on success", async () => {
    const args = makeArgs();
    const { result } = renderHook(() => useTursoProjects(args));
    result.current.handleCreateProjectByMode(META, "json");
    await waitFor(() => expect(args.refreshTursoProjects).toHaveBeenCalled());
    expect(args.createTursoProject).toHaveBeenCalledWith(META, {});
    expect(args.showToast).not.toHaveBeenCalled();
    expect(args.createFileProject).not.toHaveBeenCalled();
  });

  it("turso mode: surfaces a rejection as an error toast", async () => {
    const args = makeArgs({
      createTursoProject: vi.fn(async () => { throw new Error("boom"); }),
    });
    const { result } = renderHook(() => useTursoProjects(args));
    result.current.handleCreateProjectByMode(META, "json");
    await waitFor(() =>
      expect(args.showToast).toHaveBeenCalledWith("error", "Couldn't create the project: boom"),
    );
    expect(args.refreshTursoProjects).not.toHaveBeenCalled();
  });

  it("file mode: routes to the file callback", () => {
    const args = makeArgs({ portfolioMode: "file" });
    const { result } = renderHook(() => useTursoProjects(args));
    result.current.handleCreateProjectByMode(META, "csv");
    expect(args.createFileProject).toHaveBeenCalledWith(META, "csv", {});
    expect(args.createTursoProject).not.toHaveBeenCalled();
  });
});

describe("useTursoProjects — update current meta", () => {
  it("turso mode: writes the row, mirrors into the workspace, refreshes", async () => {
    const args = makeArgs();
    const { result } = renderHook(() => useTursoProjects(args));
    result.current.handleUpdateCurrentProjectByMode(META);
    await waitFor(() => expect(args.refreshTursoProjects).toHaveBeenCalled());
    expect(vi.mocked(updateProjectMeta)).toHaveBeenCalledWith(
      { httpUrl: "https://db.example", authToken: "tok" },
      META,
      "p-1",
    );
    expect(args.setProject).toHaveBeenCalledWith(META);
    expect(args.showToast).not.toHaveBeenCalled();
  });

  it("turso mode: a rejected meta write toasts and does NOT mirror locally", async () => {
    vi.mocked(updateProjectMeta).mockRejectedValue(new Error("401 token rejected"));
    const args = makeArgs();
    const { result } = renderHook(() => useTursoProjects(args));
    result.current.handleUpdateCurrentProjectByMode(META);
    await waitFor(() =>
      expect(args.showToast).toHaveBeenCalledWith(
        "error",
        "Couldn't save the project details: 401 token rejected",
      ),
    );
    expect(args.setProject).not.toHaveBeenCalled();
    expect(args.refreshTursoProjects).not.toHaveBeenCalled();
  });

  it("file mode: routes to the file callback", () => {
    const args = makeArgs({ portfolioMode: "file" });
    const { result } = renderHook(() => useTursoProjects(args));
    result.current.handleUpdateCurrentProjectByMode(META);
    expect(args.updateCurrentFileProject).toHaveBeenCalledWith(META);
    expect(vi.mocked(updateProjectMeta)).not.toHaveBeenCalled();
  });
});

describe("useTursoProjects — archive / restore / hard-delete", () => {
  it("archive: archives, refreshes, and repoints to the survivor using the refreshed list (no second fetch)", async () => {
    const refreshed: ProjectListEntry[] = [
      { id: "p-1", meta: META, archived: false },
      { id: "p-2", meta: META, archived: false },
    ];
    const args = makeArgs({
      tursoProjectId: "p-1",
      refreshTursoProjects: vi.fn<UseTursoProjectsArgs["refreshTursoProjects"]>(async () => refreshed),
    });
    const { result } = renderHook(() => useTursoProjects(args));
    result.current.handleArchiveTursoProject("p-1");
    await waitFor(() => expect(args.switchToTursoProject).toHaveBeenCalledWith("p-2"));
    expect(args.archiveTursoProject).toHaveBeenCalledWith("p-1");
    expect(args.refreshTursoProjects).toHaveBeenCalled();
    // The refresh already fetched the list — repoint must NOT fetch it again.
    expect(vi.mocked(listProjects)).not.toHaveBeenCalled();
    expect(args.showToast).not.toHaveBeenCalled();
  });

  it("archive: falls back to its own listProjects fetch when the refresh returned null", async () => {
    vi.mocked(listProjects).mockResolvedValue([
      { id: "p-2", meta: META, archived: false },
    ] as never);
    const args = makeArgs({ tursoProjectId: "p-1" }); // default refresh resolves null
    const { result } = renderHook(() => useTursoProjects(args));
    result.current.handleArchiveTursoProject("p-1");
    await waitFor(() => expect(args.switchToTursoProject).toHaveBeenCalledWith("p-2"));
    expect(vi.mocked(listProjects)).toHaveBeenCalledTimes(1);
  });

  it("archive: does not repoint when a non-active project was archived", async () => {
    const args = makeArgs({ tursoProjectId: "p-1" });
    const { result } = renderHook(() => useTursoProjects(args));
    result.current.handleArchiveTursoProject("p-9");
    await waitFor(() => expect(args.refreshTursoProjects).toHaveBeenCalled());
    expect(vi.mocked(listProjects)).not.toHaveBeenCalled();
    expect(args.switchToTursoProject).not.toHaveBeenCalled();
  });

  it("archive: surfaces a rejection as an error toast", async () => {
    const args = makeArgs({
      archiveTursoProject: vi.fn(async () => { throw new Error("down"); }),
    });
    const { result } = renderHook(() => useTursoProjects(args));
    result.current.handleArchiveTursoProject("p-1");
    await waitFor(() =>
      expect(args.showToast).toHaveBeenCalledWith("error", "Couldn't archive the project: down"),
    );
  });

  it("repoint: a rejected project-list read toasts instead of vanishing", async () => {
    vi.mocked(listProjects).mockRejectedValue(new Error("offline"));
    const args = makeArgs({ tursoProjectId: "p-1" });
    const { result } = renderHook(() => useTursoProjects(args));
    result.current.handleArchiveTursoProject("p-1");
    await waitFor(() =>
      expect(args.showToast).toHaveBeenCalledWith(
        "error",
        "Couldn't switch to another project: offline",
      ),
    );
    expect(args.switchToTursoProject).not.toHaveBeenCalled();
  });

  it("restore: restores then refreshes; rejection toasts", async () => {
    const args = makeArgs({
      restoreTursoProject: vi.fn(async () => { throw new Error("nope"); }),
    });
    const { result } = renderHook(() => useTursoProjects(args));
    result.current.handleRestoreTursoProject("p-3");
    await waitFor(() =>
      expect(args.showToast).toHaveBeenCalledWith("error", "Couldn't restore the project: nope"),
    );
    expect(args.refreshTursoProjects).not.toHaveBeenCalled();
  });

  it("hard delete: rejection toasts", async () => {
    const args = makeArgs({
      hardDeleteTursoProject: vi.fn(async () => { throw new Error("gone wrong"); }),
    });
    const { result } = renderHook(() => useTursoProjects(args));
    result.current.handleHardDeleteTursoProject("p-1");
    await waitFor(() =>
      expect(args.showToast).toHaveBeenCalledWith(
        "error",
        "Couldn't delete the project: gone wrong",
      ),
    );
  });

  it("hard delete: success path archives nothing, refreshes, repoints from the refreshed list", async () => {
    const args = makeArgs({
      tursoProjectId: "p-1",
      refreshTursoProjects: vi.fn<UseTursoProjectsArgs["refreshTursoProjects"]>(async () => [
        { id: "p-7", meta: META, archived: false },
      ]),
    });
    const { result } = renderHook(() => useTursoProjects(args));
    result.current.handleHardDeleteTursoProject("p-1");
    await waitFor(() => expect(args.switchToTursoProject).toHaveBeenCalledWith("p-7"));
    expect(args.hardDeleteTursoProject).toHaveBeenCalledWith("p-1");
    expect(vi.mocked(listProjects)).not.toHaveBeenCalled();
    expect(args.showToast).not.toHaveBeenCalled();
  });
});
