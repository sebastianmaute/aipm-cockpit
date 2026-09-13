// Pins the per-device key-facts cache write effect (task-manager.tsx, spec
// §5.3) and its delete-eviction call, at the lowest layer that can observe
// each: a real (fake-indexeddb-backed) TaskManager mount for the write
// effect — `project` only becomes truthy once the browser backend actually
// loads a project meta, so a lighter unit can't see the guard fire — and the
// captured `onDeleteProject` prop for the file-mode eviction, which is an
// internal, unexported callback with no lower observable seam.
//
// ★ `saveKeyFactsSnapshot`/`loadKeyFactsSnapshot` are used FOR REAL (not
// mocked) — the effect's only externally observable behaviour is what lands
// in the device store, and reading it back is more direct than spying on an
// implementation detail. `removeKeyFactsSnapshot` is spied (importOriginal
// passthrough) so the delete test can assert the call without needing a
// second real mount.
// ★★ The "load has settled" signal is `useSnapshots`' `workspaceReady` arg
// (mirrors task-manager.snapshot-gate.test.tsx), NOT a rendered project name
// — a popout mounts via task-manager's early `if (isPopout) return (...)`,
// which renders `legacyTree` only and never reaches the project-switcher
// header at all, so there is no popout-visible text this suite could wait on
// instead.
import "fake-indexeddb/auto";
import { act, render, screen, waitFor } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetMintStateForTests } from "./id-mint-session";
import { idbSet, KV_PROJECT_KEY } from "./idb";
import {
  clearKeyFactsCache,
  loadKeyFactsSnapshot,
  saveKeyFactsSnapshot,
} from "./project-key-facts-cache";
import type { ProjectMeta } from "./types";

const { removeSpy } = vi.hoisted(() => ({ removeSpy: vi.fn() }));
vi.mock("./project-key-facts-cache", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./project-key-facts-cache")>();
  return {
    ...actual,
    removeKeyFactsSnapshot: (id: string) => {
      removeSpy(id);
      return actual.removeKeyFactsSnapshot(id);
    },
  };
});

// Keep the heavy child out of the mount and capture the props task-manager
// threads into it — mirrors task-manager.popout-guard.test.tsx.
const captured: { props: Record<string, unknown> | null } = { props: null };
vi.mock("./workspace-section", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./workspace-section")>()),
  WorkspaceSection: (props: Record<string, unknown>) => {
    captured.props = props;
    return <div data-testid="ws-section-mock" />;
  },
}));

// The workspace-load-settled signal, independent of whether a project meta
// was found — task-manager.snapshot-gate.test.tsx pins the same seam.
const seenReady: boolean[] = [];
vi.mock("./use-snapshots", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./use-snapshots")>()),
  useSnapshots: (args: { workspaceReady: boolean }) => {
    seenReady.push(args.workspaceReady);
    return {
      snapshots: [], baseline: null, latest: null, variance: [], gaps: [], busy: false,
      captureNow: async () => {}, rebaselineNow: async () => {}, setBaseline: async () => {},
      deleteSnapshot: async () => {}, deleteSnapshots: async () => {},
    };
  },
}));

import TaskManager from "./task-manager";

const META: ProjectMeta = {
  name: "Ledger Corp",
  code: "LC-1",
  projectManager: "Dana PM",
  keyStakeholdersInternal: [],
  keyStakeholdersExternal: [],
  customer: "Acme Holdings",
  naceSection: "C",
  identityTypes: [],
  products: "Widget",
  deployment: "Cloud",
  startDate: "2026-01-01",
  endDate: "2026-06-01",
  profitCenter: "PC-9",
  contactPersons: [{ name: "Pat Contact", email: "", synced: false }],
  regulatory: ["GDPR / data protection regulation"],
};

function seedRegistry(projects: { id: string; name: string; code: string }[], currentProjectId: string) {
  window.localStorage.setItem(
    "aipm-cockpit:projects",
    JSON.stringify({
      projects: projects.map((p) => ({ ...p, storageConfig: { kind: "browser" } })),
      currentProjectId,
    }),
  );
}

async function waitForWorkspaceReady() {
  await waitFor(() => expect(seenReady).toContain(true), { timeout: 40000 });
}

beforeEach(() => {
  __resetMintStateForTests();
  window.localStorage.clear();
  globalThis.indexedDB = new IDBFactory();
  clearKeyFactsCache();
  captured.props = null;
  removeSpy.mockClear();
  seenReady.length = 0;
});
afterEach(() => {
  window.history.replaceState(null, "", "/");
  clearKeyFactsCache();
});

describe("task-manager — key-facts cache write effect", () => {
  it("writes a snapshot under the current project id once its meta loads", async () => {
    seedRegistry([{ id: "p1", name: "Seed", code: "SEED" }], "p1");
    await idbSet(KV_PROJECT_KEY, META);

    render(<TaskManager />);
    await waitForWorkspaceReady();

    await waitFor(() => expect(loadKeyFactsSnapshot("p1")).not.toBeNull());
    expect(loadKeyFactsSnapshot("p1")!.customer).toBe("Acme Holdings");
  }, 45000);

  it("writes nothing while there is no project meta to measure", async () => {
    seedRegistry([{ id: "p1", name: "Seed", code: "SEED" }], "p1");
    // No idbSet(KV_PROJECT_KEY, ...) — project stays undefined.

    render(<TaskManager />);
    await waitForWorkspaceReady();

    expect(loadKeyFactsSnapshot("p1")).toBeNull();
  }, 45000);

  // ★★★ Mutation-checked: temporarily deleting the `isPopout ||` guard in
  // task-manager's key-facts cache-write effect turns this red.
  it("writes nothing from a popout render, even once the same meta loads", async () => {
    seedRegistry([{ id: "p1", name: "Seed", code: "SEED" }], "p1");
    await idbSet(KV_PROJECT_KEY, META);
    window.history.replaceState(null, "", "/?popout=budget");

    render(<TaskManager />);
    await waitForWorkspaceReady();

    expect(loadKeyFactsSnapshot("p1")).toBeNull();
  }, 45000);
});

describe("task-manager — delete-project cache eviction", () => {
  it("drops the deleted project's key-facts cache entry", async () => {
    seedRegistry(
      [
        { id: "p1", name: "Current", code: "CUR" },
        { id: "p2", name: "Other", code: "OTH" },
      ],
      "p1",
    );
    saveKeyFactsSnapshot("p2", {
      filled: 5,
      missing: ["code", "regulatory", "startDate", "products", "customer", "profitCenter"],
      customer: "Stale",
      at: "2026-01-01T00:00:00.000Z",
    });

    render(<TaskManager />);
    await screen.findByTestId("ws-section-mock", undefined, { timeout: 40000 });

    const onDeleteProject = captured.props!.onDeleteProject as (id: string) => void;
    expect(typeof onDeleteProject).toBe("function");

    act(() => onDeleteProject("p2"));

    expect(removeSpy).toHaveBeenCalledWith("p2");
    expect(loadKeyFactsSnapshot("p2")).toBeNull();
  }, 45000);
});
