"use client";
// AI-04 — the top-bar undo/redo asks first when it would rewrite a meeting report while that report is
// open in its dialog with unsaved changes (the panel re-seeds its draft from every stored write, so the
// typed text would be replaced without a word).
//
// ★ Why this exists at all: `Modal` does NOT make the page behind it inert. Its root `div` sets
//   `role="dialog"` + `aria-modal="true"` and a `fixed inset-0` backdrop, and traps Tab — but no `inert`
//   attribute is set anywhere in modal.tsx, the report modal is not portalled (`portal` defaults to false),
//   and `aria-modal` is a hint that not every screen reader's virtual cursor honours. So the top bar is out
//   of reach for the mouse and the Tab key, but not provably for everything. (The Ctrl+Z HOTKEY is not the
//   gap: the report modal passes `appUndoOff`, which puts `data-app-undo="off"` on the dialog root itself,
//   so the hotkey is off everywhere in the dialog, the `tabIndex={-1}` root included.)
//
// ★ Matching is by kind, not by meeting: `UndoMeta` carries no meeting id, so ANY `meetingReport.updated`
//   entry asks while an open report is dirty. Only one report dialog is open at a time, so the over-ask is
//   an undo of a DIFFERENT meeting's report while this one has unsaved text — rare, and a question, not a loss.
//
// ★ The save toast's Undo does not need to be unreachable: `useUndoStack` asks `confirmBeforeUndo` (task-manager wires
//   it to `confirmReportUndo` below) before running a toast Undo, so it asks exactly like the top bar.
//
// ★ After the confirm the op runs only on what was ASKED about. A plain undo runs `undoById` on the entry that was on
//   top; a through-undo / redo runs only if the top of that stack is STILL the one it asked about (read live, from the
//   latest committed `api`), else it does nothing: a capture that lands while the dialog is open must not be undone
//   with it. Redo has no by-id op, so it takes the same do-nothing rule.
//
// Handlers are deliberately NOT memoized (deps-object convention): each reads the live stacks.
import { useEffect, useRef } from "react";
import { t, type Lang } from "./i18n";
import type { AppDialogs } from "./confirm-dialog";
import type { UndoStackApi } from "./undo/use-undo-stack";
import type { UndoMeta } from "./undo/undo-stack";

/** Set by meeting-report-panel on its root while its draft differs from the stored report. */
const DIRTY_REPORT_SELECTOR = '[data-report-dirty="true"]';

type GuardedOps = Pick<UndoStackApi, "undo" | "undoThrough" | "redo" | "redoThrough">;
type GuardApi = GuardedOps & Pick<UndoStackApi, "undoById" | "stack" | "redoStack">;

export interface ReportUndoGuardDeps {
  api: GuardApi;
  dialogsRef: { readonly current: AppDialogs };
  lang: Lang;
  /** Says when a confirmed op did nothing because the stack changed under the dialog. Optional (tests). */
  showToast?: (kind: "info" | "error", text: string) => void;
}

/** True when running `entries` (the slice an op would apply) would overwrite an open report's unsaved text. */
function wouldOverwriteDirtyReport(entries: readonly UndoMeta[]): boolean {
  if (typeof document === "undefined" || document.querySelector(DIRTY_REPORT_SELECTOR) === null) return false;
  return entries.some((e) => e.kind === "meetingReport.updated");
}

/** The entries from `id` up to the top (the stack's last element), as `undoThrough`/`redoThrough` take them. */
function throughTop(stack: readonly UndoMeta[], id: number): readonly UndoMeta[] {
  const idx = stack.findIndex((e) => e.id === id);
  return idx === -1 ? [] : stack.slice(idx);
}

/** Resolves true to go ahead: at once when no open report would lose unsaved text, else after asking. */
export function confirmReportUndo(
  entries: readonly UndoMeta[],
  dialogs: AppDialogs,
  lang: Lang,
  confirmKey: "undo" | "redo",
): true | Promise<boolean> {
  if (!wouldOverwriteDirtyReport(entries)) return true;
  return dialogs.confirm({
    title: t(lang, "reportUnsavedTitle"),
    message: t(lang, "reportUndoUnsavedBody"),
    confirmLabel: t(lang, confirmKey),
    appUndoOff: true, // the provider renders at the app root: without this Ctrl+Z inside it would open a second question
  });
}

export function useReportUndoGuard({ api, dialogsRef, lang, showToast }: ReportUndoGuardDeps): GuardedOps {
  // The latest committed api: the stacks as they are when the confirm resolves, not as they were when it was asked.
  const liveApi = useRef(api);
  useEffect(() => {
    liveApi.current = api;
  });
  const topId = (which: "stack" | "redoStack"): number | undefined => liveApi.current[which].at(-1)?.id;
  /** Runs `run` only if the top of `which` is still `asked`; otherwise nothing is undone, and the user is told. */
  const ifTopUnchanged = (which: "stack" | "redoStack", asked: number | undefined, run: () => void): void => {
    if (topId(which) === asked) run();
    else showToast?.("info", t(lang, which === "stack" ? "reportUndoListChanged" : "reportRedoListChanged"));
  };
  /** `runNow` when nothing needs asking; `runAfterAsk` (bound to the entries as they were ASKED) once confirmed. */
  const guard = (entries: readonly UndoMeta[], confirmKey: "undo" | "redo", runNow: () => void, runAfterAsk: () => void): void => {
    const ok = confirmReportUndo(entries, dialogsRef.current, lang, confirmKey);
    if (ok === true) {
      runNow();
      return;
    }
    void ok.then((go) => {
      if (go) runAfterAsk();
    });
  };
  return {
    undo: () => {
      const top = api.stack[api.stack.length - 1];
      guard(top ? [top] : [], "undo", api.undo, () => api.undoById(top.id));
    },
    undoThrough: (id) => {
      const entries = throughTop(api.stack, id);
      const asked = entries.at(-1)?.id;
      guard(entries, "undo", () => api.undoThrough(id), () => ifTopUnchanged("stack", asked, () => api.undoThrough(id)));
    },
    redo: () => {
      const top = api.redoStack[api.redoStack.length - 1];
      guard(top ? [top] : [], "redo", api.redo, () => ifTopUnchanged("redoStack", top.id, () => api.redoThrough(top.id)));
    },
    redoThrough: (id) => {
      const entries = throughTop(api.redoStack, id);
      const asked = entries.at(-1)?.id;
      guard(entries, "redo", () => api.redoThrough(id), () => ifTopUnchanged("redoStack", asked, () => api.redoThrough(id)));
    },
  };
}
