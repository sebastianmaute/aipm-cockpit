"use client";

// One way to open a file dialog. Replaces two hand-rolled shapes that had
// diverged onto the same settings surface (open-followups §15).
//
// ★★ The Button is the control; the input is only its file dialog. Three
// properties are load-bearing and each closes a real defect:
//   1. `sr-only`, never `display:none` — a display:none input cannot be
//      clicked in every browser.
//   2. `tabIndex={-1}` + `aria-hidden` — an sr-only input is otherwise a
//      SECOND tab stop announcing the same accessible name as the Button.
//      axe reports missing names, never duplicated ones, so nothing
//      automated catches a regression here; the unit test does.
//   3. A real <button> rather than a styled <label>. A <label> is not
//      focusable, so a focus ring on it can never render — the label shape
//      this replaces had no visible focus indicator at all (WCAG 2.4.7),
//      and axe has no focus-visibility rule to catch that either.
//
// Owns NO validation: mime/size/parse rules stay with the caller, which is
// why `onFile` hands back the raw File.

import { useRef, type ChangeEvent } from "react";
import { Button, type ButtonSize, type ButtonVariant } from "./button";

export interface FilePickerButtonProps {
  /** Visible button text AND its accessible name. Caller translates. */
  label: string;
  /** Forwarded verbatim to the input's `accept`. */
  accept: string;
  onFile: (file: File) => void;
  disabled?: boolean;
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export function FilePickerButton({
  label, accept, onFile, disabled = false, variant = "secondary", size = "sm",
}: FilePickerButtonProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  function onChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Reset BEFORE dispatching so re-picking the same file fires again.
    e.target.value = "";
    if (!file) return;
    onFile(file);
  }

  return (
    <>
      <Button
        variant={variant}
        size={size}
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
      >
        {label}
      </Button>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        disabled={disabled}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={onChange}
      />
    </>
  );
}
