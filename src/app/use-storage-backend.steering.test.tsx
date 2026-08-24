// Regression pin for open-followups §232: `Workspace.steeringCommittee` was
// LOADED into React state by the storage hook and written back by NOTHING, so
// every backend — all of which are delete-on-absent — dropped it on the next
// unrelated autosave.
//
// ★★★ These tests drive a REAL `BrowserBackend` over `fake-indexeddb`, NOT a
// mocked `./storage`. Asserting on the argument handed to a `vi.fn()` save
// would prove only that the key is spelled right in one literal; it cannot see
// that the backend actually persists it, and it cannot see the dependency-array
// half of the defect at all. `use-storage-backend.test.tsx` mocks `./storage`
// at module scope, which is why this lives in its own file rather than there.
//
// ★★ The three tests are deliberately NOT redundant — each one discriminates a
// different mutant:
//   1. the control        → the backend DOES persist a committee handed to it,
//                           so a failure below is attributable to the hook's
//                           key set and to nothing about IndexedDB.
//   2. the save path      → RED when `steeringCommittee` is dropped from the
//                           `backend.save({ … })` literal.
//   3. the dependency arr → RED when `steeringCommittee` is dropped from the
//                           save effect's dep array ALONE (test 2 still passes
//                           there, because it mutates other listed deps in the
//                           same tick and rides their effect run).
import "fake-indexeddb/auto";
import { act, renderHook, waitFor } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Lang } from "./i18n";
import type { Settings } from "./settings-types";
import type { SteeringCommittee, Task } from "./types";

// Cross-tab broadcast is irrelevant here and needs a BroadcastChannel — stub it.
vi.mock("./broadcast-sync", () => ({ useBroadcastSync: vi.fn() }));

import { BrowserBackend } from "./browser-backend";
import { TestProviders } from "./test-providers";
import { useStorageBackend } from "./use-storage-backend";
import { useWorkspace } from "./workspace-context";
import { emptyWorkspace } from "./workspace";

const task = {
  id: 1,
  taskName: "Build the thing",
  assignee: "Ada",
  priority: "Medium",
  startDate: "2026-01-01",
  dueDate: "2026-01-05",
} as unknown as Task;

const committee: SteeringCommittee = {
  name: "Programme Board",
  memberResourceIds: [3, 7],
  meetings: [{ id: 1, date: "2026-09-01", title: "Kickoff" }],
  infoSchedules: [{ id: 1, label: "Weekly digest", leadDays: 3 }],
};

function makeArgs(): Parameters<typeof useStorageBackend>[0] {
  return {
    settings: { storageConfig: { kind: "browser" } } as unknown as Settings,
    lang: "en-US" as Lang,
    hydrated: true,
    isPopout: false,
    showToast: vi.fn(),
    setStorageConfig: vi.fn(),
  };
}

function useProbe(args: Parameters<typeof useStorageBackend>[0]) {
  const backend = useStorageBackend(args);
  const { setTasks, setSteeringCommittee, steeringCommittee } = useWorkspace();
  return { ...backend, setTasks, setSteeringCommittee, steeringCommittee };
}

function renderBackend() {
  const args = makeArgs();
  return renderHook(() => useProbe(args), {
    wrapper: ({ children }) => <TestProviders>{children}</TestProviders>,
  });
}

/** Read the persisted workspace back through a FRESH backend — the same code
 *  path a reload takes, so a value only living in React state cannot pass. */
async function readBack() {
  return await new BrowserBackend().load();
}

beforeEach(() => {
  // Fresh IndexedDB per test: leakage between them would make an assertion pass
  // on the PREVIOUS test's write.
  globalThis.indexedDB = new IDBFactory();
  localStorage.clear();
});

describe("steeringCommittee survives the storage hook's save path (§232)", () => {
  // ── ANTI-VACUITY CONTROL ──────────────────────────────────────────────────
  // Without this, a red test below could equally mean "IndexedDB/jsdom cannot
  // hold this shape at all" — which would make the other two prove nothing.
  it("control: BrowserBackend round-trips a committee it is handed directly", async () => {
    await new BrowserBackend().save({
      ...emptyWorkspace(),
      tasks: [task],
      steeringCommittee: committee,
    });

    const reloaded = await readBack();

    expect(reloaded.steeringCommittee).toEqual(committee);
  });

  it("persists the committee the hook holds in render scope", async () => {
    const { result } = renderBackend();
    // ★ Wait for the initial load to land BEFORE mutating: the load sets a
    // one-shot save suppression, and an edit made inside that window is
    // swallowed by it — a harness artefact, not the defect under test.
    await waitFor(() => expect(result.current.workspaceLoaded).toBe(true));
    await new Promise((r) => setTimeout(r, 700));

    act(() => {
      result.current.setTasks([task]);
      result.current.setSteeringCommittee(committee);
    });

    await waitFor(
      async () => {
        expect((await readBack()).steeringCommittee).toEqual(committee);
      },
      { timeout: 5000 },
    );
  });

  // ── ROUTE A: the save effect's DEPENDENCY ARRAY ───────────────────────────
  // A committee-only edit changes no other dep, so if `steeringCommittee` is
  // missing from the array the effect never re-runs and NO save fires at all —
  // the committee is not merely written without it, it is never written.
  it("fires a save when the committee is the ONLY thing that changed", async () => {
    // Seed through the real backend so the hook's load applies real data and
    // the post-load suppressed save is consumed before the assertion window.
    await new BrowserBackend().save({ ...emptyWorkspace(), tasks: [task] });

    const { result } = renderBackend();
    // Wait until the load has landed in render scope AND the initial
    // (suppressed) save cycle has quiesced.
    await waitFor(() => expect(result.current.workspaceLoaded).toBe(true));
    await new Promise((r) => setTimeout(r, 700));
    expect((await readBack()).steeringCommittee).toBeUndefined();

    act(() => {
      result.current.setSteeringCommittee(committee);
    });

    await waitFor(
      async () => {
        expect((await readBack()).steeringCommittee).toEqual(committee);
      },
      { timeout: 5000 },
    );
  });
});
