// budgetHistory through the storage HOOK (`use-storage-backend.ts`). The six
// backends are pinned in their own files; this file pins the part tsc cannot:
// `Workspace.budgetHistory`
// is OPTIONAL, so dropping it from the save effect's `outgoing` literal, from
// the effect's dependency array, or from `applyWorkspace` compiles clean and
// silently loses the series on the next autosave.
//
// ★★ Drives a REAL `BrowserBackend` over `fake-indexeddb` (the harness of
// `use-storage-backend.steering.test.tsx`), not a mocked `./storage`: a
// `vi.fn()` save would prove only that one literal spells the key.
//   1. control      → the backend persists a history handed to it directly.
//   2. `outgoing`   → RED when `budgetHistory` is dropped from that literal.
//   3. deps array   → RED when it is dropped from the save effect's deps ALONE.
//   4. load         → RED when `applyWorkspace` never sets it.
import "fake-indexeddb/auto";
import { createElement, type ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Lang } from "./i18n";
import type { Settings } from "./settings-types";
import type { Task } from "./types";
import { recordBudgetChange, type BudgetHistoryEntry } from "./budget-history";

// Cross-tab broadcast is irrelevant here and needs a BroadcastChannel — stub it.
vi.mock("./broadcast-sync", () => ({ useBroadcastSync: vi.fn() }));

import { useBroadcastSync } from "./broadcast-sync";
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

function history(): readonly BudgetHistoryEntry[] {
  let n = 0;
  return recordBudgetChange([], {
    kind: "updated", bucketId: 1, bucketName: "Build",
    before: { hours: 100, value: 10000 }, after: { hours: 120, value: 12000 },
    at: "2026-09-01T10:00:00.000Z", date: "2026-09-01", newId: () => `bh-${++n}`,
  });
}

function makeArgs(): Parameters<typeof useStorageBackend>[0] {
  return {
    settings: { storageConfig: { kind: "browser" } } as unknown as Settings,
    lang: "en-US" as Lang,
    hydrated: true,
    isPopout: false,
    showToast: vi.fn(),
    showToastAction: vi.fn(),
    onRevealSavingPaused: vi.fn(),
    setStorageConfig: vi.fn(),
  };
}

function useProbe(args: Parameters<typeof useStorageBackend>[0]) {
  const backend = useStorageBackend(args);
  const { setTasks, budgetHistory, setBudgetHistory } = useWorkspace();
  return { ...backend, setTasks, budgetHistory, setBudgetHistory };
}

function renderBackend() {
  const args = makeArgs();
  return renderHook(() => useProbe(args), {
    wrapper: ({ children }: { children: ReactNode }) => createElement(TestProviders, null, children),
  });
}

/** Read back through a FRESH backend — the path a reload takes. */
async function readBack() {
  return await new BrowserBackend().load();
}

/** Wait for the load AND the post-load suppressed save cycle to quiesce. */
async function settle(result: { current: { workspaceLoaded: boolean } }) {
  await waitFor(() => expect(result.current.workspaceLoaded).toBe(true));
  await new Promise((r) => setTimeout(r, 700));
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  localStorage.clear();
});

describe("budgetHistory survives the storage hook's save path", () => {
  it("control: BrowserBackend round-trips a history it is handed directly", async () => {
    await new BrowserBackend().save({ ...emptyWorkspace(), tasks: [task], budgetHistory: history() });
    expect((await readBack()).budgetHistory).toEqual(history());
  });

  it("the saved workspace (`outgoing`) carries budgetHistory", async () => {
    const { result } = renderBackend();
    await settle(result);

    act(() => {
      result.current.setTasks([task]);
      result.current.setBudgetHistory(history());
    });

    await waitFor(async () => {
      expect((await readBack()).budgetHistory).toEqual(history());
    }, { timeout: 5000 });
  });

  it("fires a save when budgetHistory is the ONLY thing that changed", async () => {
    await new BrowserBackend().save({ ...emptyWorkspace(), tasks: [task] });
    const { result } = renderBackend();
    await settle(result);
    expect((await readBack()).budgetHistory).toBeUndefined();

    act(() => {
      result.current.setBudgetHistory(history());
    });

    await waitFor(async () => {
      expect((await readBack()).budgetHistory).toEqual(history());
    }, { timeout: 5000 });
  });

  it("loads a stored budgetHistory into workspace state", async () => {
    await new BrowserBackend().save({ ...emptyWorkspace(), tasks: [task], budgetHistory: history() });
    const { result } = renderBackend();
    await waitFor(() => expect(result.current.workspaceLoaded).toBe(true));
    await waitFor(() => expect(result.current.budgetHistory).toEqual(history()));
  });

  it("registers a `budgetHistory` broadcast-sync channel", () => {
    renderBackend();
    const kinds = (useBroadcastSync as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    expect(kinds).toContain("activityLog"); // positive control: the spy records channels at all
    expect(kinds).toContain("budgetHistory");
  });
});
