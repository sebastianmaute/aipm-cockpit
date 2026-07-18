"use client";

// Canonical form-field primitives (design-system Phase 2a). Replaces the ~130
// ad-hoc <input>/<select>/<textarea> shells and ~90 forked checkboxes that
// drifted across every form surface. ONE text-field shell (rounded-md border-
// line bg-surface, ring-2 ui-green focus) and ONE checkbox accent, so field
// chrome / focus / checkbox-fill read identically app-wide.
//
// ★ FORM FIELDS get FOCUS_RING (ring-2 ui-green) + TRANSITION only — NEVER
// PRESS (a 1px translate on a text field is wrong; AGENTS.md). Invalid state
// swaps the neutral green ring for the pink SEMANTIC ring — the two are never
// combined (both set --tw-ring-color, so whichever is emitted later in the
// stylesheet wins regardless of className order; the bespoke-ring landmine).
//
// ★ Checkbox accent is `accent-ui-dark-blue` (the CSS `accent-color`
// mechanism). This project has NO @tailwindcss/forms plugin, so the widespread
// `text-AIPM-*` checkbox classes were INERT (native checkboxes ignore `color`) —
// the tick rendered browser-default. `accent-*` is the mechanism that actually
// paints the brand colour, so it is the canonical one.
//
// Palette-safe by construction: only sanctioned AIPM brand / RAG tokens.

import { useRef } from "react";
import type {
  InputHTMLAttributes,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import { FOCUS_RING, TRANSITION } from "./interaction-styles";
import { useAutogrow } from "./use-autogrow";

// ONE text-field shell. `border` (no colour) here; the state layer supplies the
// border colour so valid/invalid diverge on colour only. `w-full` matches the
// overwhelming majority of form fields (and every copy-declared `inputClass`
// this primitive single-sources).
const FIELD_BASE =
  "w-full rounded-md border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50";

// valid = neutral line border + canonical green ring. invalid = pink semantic
// ring + pink border (NEVER also carry the green ring — see the header note).
const FIELD_VALID = `border-line ${FOCUS_RING}`;
const FIELD_INVALID =
  "border-ui-pink focus:outline-none focus:ring-2 focus:ring-ui-pink";

/** Canonical field class string (shell + valid/invalid state + 150ms
 *  transition). Exported so string-based consumers (the copy-declared
 *  `inputClass` locals) can single-source the exact same shell without adopting
 *  the component. `className` is appended LAST so layout tweaks extend the
 *  base. */
export function fieldClass(invalid?: boolean, className?: string): string {
  return `${FIELD_BASE} ${invalid ? FIELD_INVALID : FIELD_VALID} ${TRANSITION}${
    className ? ` ${className}` : ""
  }`;
}

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Renders the pink semantic error state + sets aria-invalid. */
  invalid?: boolean;
}

/** Canonical text `<input>`. All native input props pass through; pair with a
 *  `<label>`/`aria-label` (a placeholder is not an accessible name). */
export function Input({ invalid, className, "aria-invalid": ariaInvalid, ...props }: InputProps) {
  return (
    <input
      className={fieldClass(invalid, className)}
      aria-invalid={ariaInvalid ?? (invalid ? true : undefined)}
      {...props}
    />
  );
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  invalid?: boolean;
}

/** Canonical native `<select>` — same shell as Input. */
export function Select({ invalid, className, "aria-invalid": ariaInvalid, ...props }: SelectProps) {
  return (
    <select
      className={fieldClass(invalid, className)}
      aria-invalid={ariaInvalid ?? (invalid ? true : undefined)}
      {...props}
    />
  );
}

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
  /** Grows to fit content (needs a controlled string `value`). */
  autoGrow?: boolean;
}

/** Canonical `<textarea>` — Input shell + `resize-none`. `autoGrow` grows the
 *  field to fit its value via the shared use-autogrow hook (internal ref). */
export function Textarea({
  invalid,
  autoGrow,
  className,
  "aria-invalid": ariaInvalid,
  ...props
}: TextareaProps) {
  const ref = useRef<HTMLTextAreaElement>(null);
  // Hook is always called (rules-of-hooks); it early-returns while ref.current
  // is null, so a non-autoGrow textarea pays nothing.
  useAutogrow(ref, typeof props.value === "string" ? props.value : "");
  return (
    <textarea
      ref={autoGrow ? ref : undefined}
      className={fieldClass(invalid, `resize-none${className ? ` ${className}` : ""}`)}
      aria-invalid={ariaInvalid ?? (invalid ? true : undefined)}
      {...props}
    />
  );
}

// ONE checkbox accent for the whole app (see header note on why `accent-*`).
// Size is a SEPARATE axis (kept out of the base so a `size` variant can't
// collide with a hard-coded `h-4 w-4`): `md` (default) matches the original
// primitive; `sm` is the compact size the toolbar filter/column popovers use.
const CHECKBOX_BASE = `rounded border-line accent-ui-dark-blue ${FOCUS_RING} ${TRANSITION} disabled:cursor-not-allowed disabled:opacity-50`;
const CHECKBOX_SIZE: Record<"sm" | "md", string> = { sm: "h-3.5 w-3.5", md: "h-4 w-4" };

// Omit the native numeric `size` attribute — we repurpose `size` as the variant.
export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "size"> {
  size?: "sm" | "md";
}

/** Canonical checkbox. Always `type="checkbox"`; caller owns the label /
 *  aria-label (an unlabeled checkbox is an axe-critical fail). */
export function Checkbox({ className, size = "md", ...props }: CheckboxProps) {
  return (
    <input
      type="checkbox"
      className={`${CHECKBOX_SIZE[size]} ${CHECKBOX_BASE}${className ? ` ${className}` : ""}`}
      {...props}
    />
  );
}
