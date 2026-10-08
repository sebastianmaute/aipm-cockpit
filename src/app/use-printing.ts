// usePrinting(): true while a print is laid out. Moved out of use-task-row-window.ts so
// the Kanban board (task-kanban-board.tsx) renders every card while printing too (§5).
import { useSyncExternalStore } from "react";

const noop = (): void => {};

// ── Printing ────────────────────────────────────────────────────────────────
// A printout must hold EVERY row, so the window switches off while printing.
// Two sources, because neither covers every path alone:
//  - the `print` media query, which flips for an emulated print medium;
//  - `beforeprint`/`afterprint`, which Chromium dispatches for a real print,
//    including one the browser starts (Ctrl+P) rather than `window.print()`.
//    The desktop shell's File → Print… is such a print (docs/AGENTS/desktop.md
//    "Print and the menu"). ★ NOT yet verified on a packaged desktop build —
//    owed, recorded in §5.
// An external-store change outside a React event renders at sync priority,
// flushed in the microtask checkpoint right after the `beforeprint` handler —
// before the print layout is taken.
let printEventActive = false;

function subscribePrint(onChange: () => void): () => void {
  if (typeof window === "undefined") return noop;
  const mql = typeof window.matchMedia === "function" ? window.matchMedia("print") : null;
  const onBefore = () => {
    printEventActive = true;
    onChange();
  };
  const onAfter = () => {
    printEventActive = false;
    onChange();
  };
  mql?.addEventListener("change", onChange);
  window.addEventListener("beforeprint", onBefore);
  window.addEventListener("afterprint", onAfter);
  return () => {
    mql?.removeEventListener("change", onChange);
    window.removeEventListener("beforeprint", onBefore);
    window.removeEventListener("afterprint", onAfter);
  };
}

function getPrintSnapshot(): boolean {
  if (printEventActive) return true;
  return typeof window.matchMedia === "function" && window.matchMedia("print").matches;
}

const getServerPrintSnapshot = () => false;

/** True while a print is laid out: the `print` media query, or between `beforeprint`
 *  and `afterprint`. False on the server. */
export function usePrinting(): boolean {
  return useSyncExternalStore(subscribePrint, getPrintSnapshot, getServerPrintSnapshot);
}
