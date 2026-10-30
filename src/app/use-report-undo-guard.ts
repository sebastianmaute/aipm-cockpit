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
// Handlers are deliberately NOT memoized (deps-object convention): each reads the live stacks.
import { t, type Lang } from "./i18n";
import type { AppDialogs } from "./confirm-dialog";
import type { UndoStackApi } from "./undo/use-undo-stack";
import type { UndoMeta } from "./undo/undo-stack";

/** Set by meeting-report-panel on its root while its draft differs from the stored report. */
const DIRTY_REPORT_SELECTOR = '[data-report-dirty="true"]';

type GuardedOps = Pick<UndoStackApi, "undo" | "undoThrough" | "redo" | "redoThrough">;

export interface ReportUndoGuardDeps {
  api: GuardedOps & Pick<UndoStackApi, "stack" | "redoStack">;
  dialogsRef: { readonly current: AppDialogs };
  lang: Lang;
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

export function useReportUndoGuard({ api, dialogsRef, lang }: ReportUndoGuardDeps): GuardedOps {
  const guard = (entries: readonly UndoMeta[], confirmKey: "undo" | "redo", run: () => void): void => {
    if (!wouldOverwriteDirtyReport(entries)) {
      run();
      return;
    }
    void dialogsRef.current
      .confirm({
        title: t(lang, "reportUnsavedTitle"),
        message: t(lang, "reportUndoUnsavedBody"),
        confirmLabel: t(lang, confirmKey),
      })
      .then((ok) => {
        if (ok) run();
      });
  };
  return {
    undo: () => guard(api.stack.slice(-1), "undo", api.undo),
    undoThrough: (id) => guard(throughTop(api.stack, id), "undo", () => api.undoThrough(id)),
    redo: () => guard(api.redoStack.slice(-1), "redo", api.redo),
    redoThrough: (id) => guard(throughTop(api.redoStack, id), "redo", () => api.redoThrough(id)),
  };
}
