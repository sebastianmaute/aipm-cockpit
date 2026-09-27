// §628 — pins that `task-manager.tsx` hands the undo stack the REAL scope-epoch reader and the
// REAL load-hold flag. `use-undo-stack.test.tsx` proves the mechanism; this proves the wiring,
// which nothing else can see: `getScopeEpoch` is OPTIONAL on `UseUndoStackDeps` (absent = never
// stale), and task-manager reaches it through a forward ref whose fallback is `() => 0` — so a
// dropped thread or an unfilled ref keeps every stale entry, silently, with tsc and eslint green.
//
// ★ The storage hook's reader is REPLACED with a sentinel whose value the test moves. The real
//   reader answers 0 until a switch, which is exactly what the `() => 0` fallback answers too, so
//   an identity-free check against it could not tell the two apart.
//
// Mutations (each named, each turns one assertion red on its own):
//   MU1 — drop `getScopeEpoch: readScopeEpochForUndo` from the `useUndoStack({…})` deps:
//         "the undo stack reads the storage hook's epoch" is red (reader undefined).
//   MU2 — drop `getScopeEpochRef.current = getScopeEpoch;` from the forward-ref effect:
//         the same test is red (the fallback answers 0, never 7).
//   MU3 — delete the `useClearUndoOnLoadHold(loadPending, undoApi.clear)` line:
//         "the load-hold clear is wired" is red.
import { describe, expect, it, beforeAll, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const captured = vi.hoisted(() => {
  const c = {
    epoch: 7,
    sentinel: (): number => c.epoch, // ONE stable function, like the real `useCallback(…, [])` reader
    storageLoadPending: undefined as boolean | undefined,
    undoReader: undefined as (() => number) | undefined,
    undoClear: undefined as unknown,
    holdCalls: [] as { loadPending: boolean; clear: unknown }[],
  };
  return c;
});

vi.mock("./use-storage-backend", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./use-storage-backend")>();
  function useStorageBackend(args: Parameters<typeof actual.useStorageBackend>[0]) {
    const result = actual.useStorageBackend(args);
    captured.storageLoadPending = result.loadPending;
    return { ...result, getScopeEpoch: captured.sentinel };
  }
  return { ...actual, useStorageBackend };
});

vi.mock("./undo/use-undo-stack", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./undo/use-undo-stack")>();
  function useUndoStack(deps: Parameters<typeof actual.useUndoStack>[0]) {
    captured.undoReader = deps.getScopeEpoch;
    const api = actual.useUndoStack(deps);
    captured.undoClear = api.clear;
    return api;
  }
  function useClearUndoOnLoadHold(loadPending: boolean, clear: () => void) {
    captured.holdCalls.push({ loadPending, clear });
    actual.useClearUndoOnLoadHold(loadPending, clear);
  }
  return { ...actual, useUndoStack, useClearUndoOnLoadHold };
});

// The shell is stubbed, as in `task-manager.scope-epoch-wiring.test.tsx`: the panes are irrelevant.
vi.mock("./modern-shell", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./modern-shell")>()),
  ModernShell: () => <div data-testid="modern-shell-mock" />,
}));

import TaskManager from "./task-manager";

describe("§628 task-manager scopes the undo stack", () => {
  beforeAll(async () => {
    window.localStorage.clear();
    window.localStorage.setItem(
      "aipm-cockpit:projects",
      JSON.stringify({
        projects: [{ id: "p1", name: "Seed", code: "SEED", storageConfig: { kind: "browser" } }],
        currentProjectId: "p1",
      }),
    );
    render(<TaskManager />);
    await screen.findByTestId("modern-shell-mock");
  }, 45000); // heavy TaskManager mount — same headroom as the sibling wiring test

  it("the undo stack reads the storage hook's epoch, live (MU1, MU2)", () => {
    expect(typeof captured.undoReader).toBe("function");
    expect(captured.undoReader!()).toBe(7);
    captured.epoch = 9;
    expect(captured.undoReader!()).toBe(9);
  });

  it("the load-hold clear is wired to this undo stack and the storage hook's flag (MU3)", () => {
    // Anti-vacuity: the storage hook really ran and the undo stack really produced a clear.
    expect(typeof captured.storageLoadPending).toBe("boolean");
    expect(typeof captured.undoClear).toBe("function");
    expect(captured.holdCalls.length).toBeGreaterThan(0);
    const last = captured.holdCalls[captured.holdCalls.length - 1];
    expect(last.clear).toBe(captured.undoClear);
    expect(last.loadPending).toBe(captured.storageLoadPending);
    // The hold was seen both raised (boot) and lowered (the load landed), so the reconcile saw a real transition input.
    expect(captured.holdCalls.some((c) => c.loadPending)).toBe(true);
    expect(captured.holdCalls.some((c) => !c.loadPending)).toBe(true);
  });
});
