"use client";

// Sole owner of the "hidden input + click it" file-dialog mechanism.
//
// ★★ Extracted from `file-picker-button.tsx` so a second trigger shape (a
// dashed empty-state box, which is an `AddFirstItemButton` and not a
// `Button`) can open a file dialog without hand-rolling a second input.
// Three properties below are load-bearing and each closes a real defect —
// they live here, once:
//   1. `sr-only`, never `display:none` — a display:none input cannot be
//      clicked in every browser.
//   2. `tabIndex={-1}` + `aria-hidden` — an sr-only input is otherwise a
//      SECOND tab stop announcing the same accessible name as its trigger.
//      axe reports missing names, never duplicated ones, so nothing
//      automated catches a regression here; the unit tests do.
//   3. The TRIGGER must be a real focusable control, never a styled
//      <label> — a <label> is not focusable, so a focus ring on it can
//      never render (WCAG 2.4.7), and axe has no focus-visibility rule to
//      catch that either. That is the caller's job, not this hook's — but
//      it is why this hook returns an imperative `open()` rather than
//      rendering a label.
//
// Owns NO validation: mime/size/parse rules stay with the caller, which is
// why `onFile` hands back the raw File.

import { useRef, type ChangeEvent, type ComponentPropsWithRef } from "react";

export interface FilePicker {
  /** Open the file dialog. Wire to the trigger's `onClick`. */
  open: () => void;
  /** Spread onto a single `<input>` the caller renders beside its trigger. */
  inputProps: ComponentPropsWithRef<"input">;
}

export function useFilePicker(
  onFile: (file: File) => void,
  accept: string,
  disabled = false,
): FilePicker {
  const inputRef = useRef<HTMLInputElement | null>(null);

  function onChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Reset BEFORE dispatching so re-picking the same file fires again.
    e.target.value = "";
    if (!file) return;
    onFile(file);
  }

  return {
    open: () => inputRef.current?.click(),
    inputProps: {
      ref: inputRef,
      type: "file",
      accept,
      disabled,
      className: "sr-only",
      tabIndex: -1,
      "aria-hidden": "true",
      onChange,
    },
  };
}
