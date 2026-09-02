"use client";

// One way to open a file dialog. Replaces two hand-rolled shapes that had
// diverged onto the same settings surface (open-followups §15).
//
// ★★ The Button is the control; the input is only its file dialog. The
// hidden-input mechanism — including the three load-bearing properties
// (sr-only not display:none, tabIndex={-1}+aria-hidden, a real focusable
// trigger) and why each closes a real defect — now lives in `useFilePicker`
// (`use-file-picker.ts`), so a second trigger shape (a dashed empty-state
// box) can open a file dialog without hand-rolling a second input. This
// component is just that hook wired to a `Button`.
//
// Owns NO validation: mime/size/parse rules stay with the caller, which is
// why `onFile` hands back the raw File.

import { useFilePicker } from "./use-file-picker";
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
  const { open, inputProps } = useFilePicker(onFile, accept, disabled);

  return (
    <>
      <Button
        variant={variant}
        size={size}
        disabled={disabled}
        onClick={open}
      >
        {label}
      </Button>
      <input {...inputProps} />
    </>
  );
}
