// Pins the ONE argument that decides whether version history works at all: the
// `projectId` task-manager hands `useVersionHistory`.
//
// ★★★ THIS ASSERTS ON AN ARGUMENT HANDED TO A MOCKED HOOK, WHICH IS NORMALLY
// THE WEAK SHAPE — it usually proves spelling rather than behaviour. It is the
// right shape HERE because the argument IS the defect: `use-version-history.ts`
// folds `!!projectId` into its `active` predicate, so an empty string switches
// the whole feature off. Nothing downstream of that value can be observed,
// precisely because the hook never reaches the store.
//
// ★★ THE BUG THIS PINS. `enabled` and the sidebar entry (`nav-config.ts`'s
// TURSO_ONLY_VIEWS gate) both key off `settings.storageConfig.kind === "turso"`
// — the single-DB Turso STORAGE backend. `projectId` keyed off `portfolioMode`
// — the multi-project Turso PICKER, which `loadPortfolioMode()` defaults to
// "file". A user who selects Turso storage in Settings and never migrates a
// portfolio therefore gets: History in the sidebar, History panel renders,
// `versions` permanently `[]`, and `captureNow` a silent no-op — so "save
// version" saves nothing and raises no error, because the store is never
// called and `onError` never fires. Same class AGENTS.md records for the chat
// thread sidebar (picker `mode` vs storage `kind`); `trendsActive` is the
// correct pattern and ORs both signals.
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { __resetMintStateForTests } from "./id-mint-session";

const captured: { args: Record<string, unknown> | null } = { args: null };

/** Read through a function so TypeScript cannot narrow the property to `null`
 *  from the `captured.args = null` reset below — it has no way to know the
 *  mocked hook reassigns it during `render`. */
function capturedArgs(): Record<string, unknown> | null {
  return captured.args;
}

vi.mock("./use-version-history", async (importOriginal) => {
  // ONE stable result object: task-manager stores `notifySaved` in a ref keyed
  // on its identity, so a fresh object per render would re-run that effect on
  // every render for no reason.
  const stable = {
    versions: [],
    busy: false,
    notifySaved: () => {},
    captureNow: async () => {},
    loadDiff: async () => [],
    restore: async () => false,
    remove: async () => false,
    refresh: async () => {},
  };
  return {
    ...(await importOriginal<typeof import("./use-version-history")>()),
    useVersionHistory: (args: Record<string, unknown>) => {
      captured.args = args;
      return stable;
    },
  };
});

import TaskManager from "./task-manager";

beforeEach(() => {
  __resetMintStateForTests();
});

describe("task-manager → useVersionHistory projectId", () => {
  it("hands a NON-EMPTY project id on the single-DB Turso backend", async () => {
    window.localStorage.clear();
    captured.args = null;
    window.localStorage.setItem(
      "aipm-cockpit:projects",
      JSON.stringify({
        projects: [{ id: "p1", name: "Seed", code: "SEED", storageConfig: { kind: "browser" } }],
        currentProjectId: "p1",
      }),
    );
    // Turso as the STORAGE backend. Settings load shallow-merges over the
    // defaults, so every other field (including `features`, which must contain
    // "history") stays at its default.
    window.localStorage.setItem(
      "aipm-cockpit:settings",
      JSON.stringify({ storageConfig: { kind: "turso" } }),
    );
    // ★★★ DELIBERATELY NOT SET: "aipm-cockpit:portfolio-mode". That absence IS
    // the reported configuration — `loadPortfolioMode()` reads "file", which is
    // what emptied the id. Setting it to "turso" here would make the test pass
    // against the unfixed code.

    render(<TaskManager />);

    // Wait for the async settings load to reach the hook. Gating on `enabled`
    // rather than on a timeout is what stops this passing vacuously against the
    // FIRST render, where the backend is still the seeded browser one and
    // `enabled` is correctly false.
    await vi.waitFor(
      () => {
        expect(capturedArgs()?.enabled).toBe(true);
      },
      { timeout: 15000 },
    );

    expect(capturedArgs()?.projectId).not.toBe("");
    // The hook's own `active` predicate is `enabled && !!config && !!projectId`
    // — assert the property that predicate actually reads, not just inequality
    // to the empty string.
    expect(Boolean(capturedArgs()?.projectId)).toBe(true);
  }, 45000); // heavy TaskManager mount, matching the characterization suite
});
