// AI-04 — pins that `task-manager.tsx` routes the top bar's undo/redo AND the Ctrl+Z hotkey through
// `useReportUndoGuard` (which asks before an undo rewrites an open report's unsaved text), and hands the
// guard the REAL undo stack. `use-report-undo-guard.test.ts` proves the mechanism; this proves the wiring,
// which nothing else sees: reverting a `reportUndo.*` reference to `undoApi.*` is tsc- and eslint-green.
//
// Mutations (each turns one assertion red on its own):
//   MW1 — `onUndo={reportUndo.undo}` → `onUndo={undoApi.undo}` (likewise onUndoThrough / onRedo / onRedoThrough):
//         "the top-bar controls call the guarded ops" is red.
//   MW2 — `reportUndo.undo()` → `undoApi.undo()` in the `useUndoHotkey(…)` callbacks (likewise redo):
//         "the hotkey calls the guarded ops" is red.
//   MW3 — `useReportUndoGuard({ api: undoApi, … })` handed anything but the undo stack:
//         "the guard wraps the real undo stack" is red.
//   MW4 — delete `confirmBeforeUndo: …` from the `useUndoStack({ … })` call (the save toast's Undo then skips the
//         guard): "the save toast's Undo asks through confirmReportUndo" is red.
import { describe, expect, it, beforeAll, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { isValidElement, type ReactElement, type ReactNode } from "react";

const captured = vi.hoisted(() => ({
  guarded: { undo: vi.fn(), undoThrough: vi.fn(), redo: vi.fn(), redoThrough: vi.fn() },
  guardApi: undefined as unknown,
  guardDialogs: undefined as unknown,
  undoApi: undefined as unknown,
  hotkeyUndo: undefined as (() => void) | undefined,
  hotkeyRedo: undefined as (() => void) | undefined,
  undoControl: undefined as ReactNode,
  undoDeps: undefined as import("./undo/use-undo-stack").UseUndoStackDeps | undefined,
  confirmReportUndo: vi.fn(() => true as const),
}));

vi.mock("./use-report-undo-guard", () => ({
  useReportUndoGuard: (deps: { api: unknown; dialogsRef: unknown }) => {
    captured.guardApi = deps.api;
    captured.guardDialogs = deps.dialogsRef;
    return captured.guarded;
  },
  confirmReportUndo: (...args: unknown[]) => (captured.confirmReportUndo as (...a: unknown[]) => unknown)(...args),
}));

vi.mock("./undo/use-undo-stack", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./undo/use-undo-stack")>();
  function useUndoStack(deps: Parameters<typeof actual.useUndoStack>[0]) {
    const api = actual.useUndoStack(deps);
    captured.undoApi = api;
    captured.undoDeps = deps;
    return api;
  }
  return { ...actual, useUndoStack };
});

vi.mock("./use-undo-hotkey", () => ({
  useUndoHotkey: (undo: () => void, redo?: () => void) => {
    captured.hotkeyUndo = undo;
    captured.hotkeyRedo = redo;
  },
}));

vi.mock("./shell-chrome", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./shell-chrome")>();
  function buildShellChrome(deps: Parameters<typeof actual.buildShellChrome>[0]) {
    captured.undoControl = deps.undoControl;
    return actual.buildShellChrome(deps);
  }
  return { ...actual, buildShellChrome };
});

// The shell is stubbed, as in `task-manager.undo-scope-wiring.test.tsx`: the panes are irrelevant.
vi.mock("./modern-shell", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./modern-shell")>()),
  ModernShell: () => <div data-testid="modern-shell-mock" />,
}));

import TaskManager from "./task-manager";
import { UndoControl, RedoControl } from "./undo/undo-control";

/** The UndoControl / RedoControl elements inside task-manager's `undoControlEl` fragment. */
function controlProps(type: unknown): Record<string, unknown> {
  const fragment = captured.undoControl as ReactElement<{ children: ReactNode }>;
  const kids = ([] as ReactNode[]).concat(fragment.props.children);
  const el = kids.find((k) => isValidElement(k) && k.type === type) as ReactElement<Record<string, unknown>> | undefined;
  if (!el) throw new Error("control not found in undoControlEl");
  return el.props;
}

describe("AI-04 task-manager routes undo through the report guard", () => {
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
  }, 45000); // heavy TaskManager mount — same headroom as the sibling wiring tests

  it("the guard wraps the real undo stack and the app dialogs (MW3)", () => {
    expect(captured.undoApi).toBeDefined(); // anti-vacuity
    expect(captured.guardApi).toBe(captured.undoApi);
    expect(typeof (captured.guardDialogs as { current: { confirm: unknown } }).current.confirm).toBe("function");
  });

  it("the save toast's Undo asks through confirmReportUndo (MW4)", () => {
    expect(typeof captured.undoDeps?.confirmBeforeUndo).toBe("function"); // anti-vacuity
    const entry = { id: 7, kind: "meetingReport.updated", count: 1, timestamp: "t", label: "l" };
    expect(captured.undoDeps!.confirmBeforeUndo!(entry as import("./undo/undo-stack").UndoMeta)).toBe(true);
    expect(captured.confirmReportUndo).toHaveBeenCalledTimes(1);
    const args = captured.confirmReportUndo.mock.calls[0] as unknown as unknown[];
    expect(args[0]).toEqual([entry]);
    expect(args[1]).toBe((captured.guardDialogs as { current: unknown }).current);
    expect(args[3]).toBe("undo");
  });

  it("the top-bar controls call the guarded ops (MW1)", () => {
    expect(isValidElement(captured.undoControl)).toBe(true); // anti-vacuity: the main window built it
    const undo = controlProps(UndoControl);
    const redo = controlProps(RedoControl);
    expect(undo.onUndo).toBe(captured.guarded.undo);
    expect(undo.onUndoThrough).toBe(captured.guarded.undoThrough);
    expect(redo.onRedo).toBe(captured.guarded.redo);
    expect(redo.onRedoThrough).toBe(captured.guarded.redoThrough);
  });

  it("the hotkey calls the guarded ops (MW2)", () => {
    expect(typeof captured.hotkeyUndo).toBe("function");
    captured.hotkeyUndo!();
    expect(captured.guarded.undo).toHaveBeenCalledTimes(1);
    captured.hotkeyRedo!();
    expect(captured.guarded.redo).toHaveBeenCalledTimes(1);
  });
});
