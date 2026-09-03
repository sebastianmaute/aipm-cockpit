// Pins the ONE argument that decides whether version history works at all: the
// `projectId` task-manager hands `useVersionHistory`.
//
// ★★★ THIS ASSERTS ON AN ARGUMENT HANDED TO A MOCKED HOOK, normally the weak
// shape — it usually proves spelling rather than behaviour. It is the right
// shape HERE because the argument IS the defect: `use-version-history.ts` folds
// `!!projectId` into its `active` predicate, so a wrong or empty value switches
// the whole feature off and nothing downstream can be observed, precisely
// because the hook never reaches the store.
//
// ★★★ THE BUG. `projectId` was `portfolioMode === "turso" ? (tursoProjectId ??
// "") : ""`, and that ternary discarded an id that was already correct:
// `use-storage-backend.ts` seeds `tursoProjectId` from
// `loadCurrentTursoProjectId()` whatever the portfolio mode is. Single-DB Turso
// STORAGE is a configuration the app supports — `trendsActive` and
// `workspace-section.tsx`'s `chatTursoMode` both handle it by ORing the two
// signals — so the ternary forced `""` there and version history alone went
// inert behind a visible, permanently empty view.
//
// ★★ ASSERTING "NON-EMPTY" WOULD BE TOO WEAK, and that weakness already shipped
// once: a first cut of this fix keyed history to a fallback CONSTANT, which is
// non-empty and still wrong. A user detached from a Turso portfolio keeps every
// version under their real project id, so anything but that id forks the
// history and hides the originals. The assertion is therefore EQUALITY with the
// cached id.
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
    active: false,
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

const CACHED_PROJECT = "proj-from-the-turso-portfolio";

beforeEach(() => {
  __resetMintStateForTests();
});

describe("task-manager → useVersionHistory projectId", () => {
  it("keys history by the cached Turso project id on the single-DB backend", async () => {
    window.localStorage.clear();
    captured.args = null;
    window.localStorage.setItem(
      "aipm-cockpit:projects",
      JSON.stringify({
        projects: [{ id: "p1", name: "Seed", code: "SEED", storageConfig: { kind: "browser" } }],
        currentProjectId: "p1",
      }),
    );
    // Turso as the STORAGE backend. The settings load shallow-merges over the
    // defaults, so `features` (which must contain "history") stays default.
    window.localStorage.setItem(
      "aipm-cockpit:settings",
      JSON.stringify({ storageConfig: { kind: "turso" } }),
    );
    // The id a detached portfolio user still carries. `use-storage-backend.ts`
    // seeds `tursoProjectId` from this key on mount.
    window.localStorage.setItem("aipm-cockpit:turso-current-project", CACHED_PROJECT);
    // ★★★ DELIBERATELY NOT SET: "aipm-cockpit:portfolio-mode". That absence IS
    // the reported configuration — `loadPortfolioMode()` reads "file", which is
    // what the old ternary keyed off. Setting it to "turso" would make this
    // test pass against the unfixed code.

    render(<TaskManager />);

    // Gate on `enabled` rather than a bare timeout: this is what stops the test
    // passing vacuously against the FIRST render, where the backend is still
    // the seeded browser one and `enabled` is correctly false.
    await vi.waitFor(
      () => {
        expect(capturedArgs()?.enabled).toBe(true);
      },
      { timeout: 15000 },
    );

    expect(capturedArgs()?.projectId).toBe(CACHED_PROJECT);
  }, 45000); // heavy TaskManager mount, matching the characterization suite

  it("stays empty under Safe Mode, so no version is keyed to a guessed id", async () => {
    // Control, and a real guarantee rather than a mirror of the block above:
    // `loadCurrentTursoProjectId()` returns null under `?safe`, so the id must
    // collapse and the hook must stay inert. Without this, a future "just
    // default it" change would look harmless.
    window.localStorage.clear();
    captured.args = null;
    window.localStorage.setItem(
      "aipm-cockpit:projects",
      JSON.stringify({
        projects: [{ id: "p1", name: "Seed", code: "SEED", storageConfig: { kind: "browser" } }],
        currentProjectId: "p1",
      }),
    );
    window.localStorage.setItem(
      "aipm-cockpit:settings",
      JSON.stringify({ storageConfig: { kind: "turso" } }),
    );
    window.localStorage.setItem("aipm-cockpit:turso-current-project", CACHED_PROJECT);
    const { __resetSafeModeCache } = await import("./safe-mode");
    window.history.replaceState(null, "", "/?safe=1");
    __resetSafeModeCache();
    try {
      render(<TaskManager />);
      // No `enabled` gate here — Safe Mode may legitimately never enable the
      // hook, and waiting for something that must not happen would time out.
      // Settle the mount, then assert on whatever the last render passed.
      await vi.waitFor(() => {
        expect(capturedArgs()).not.toBeNull();
      });
      expect(capturedArgs()?.projectId).toBe("");
    } finally {
      window.history.replaceState(null, "", "/");
      __resetSafeModeCache();
    }
  }, 45000);
});
