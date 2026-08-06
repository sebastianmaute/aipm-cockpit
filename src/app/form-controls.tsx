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
// border colour so valid/invalid diverge on colour only. ★ WIDTH is the caller's
// (layout) — pass `w-full`/`flex-1`/a fixed width via `className`; the base sets
// none, so there is no width to fight. ★ SIZE (padding + text size) is a
// SEPARATE axis (`FIELD_SIZE`) kept out of the base so a `size` variant can't
// collide with the base padding (the same CSS-source-order trap the Button
// primitive has): `md` (default) is the roomy form field; `xs` the compact
// toolbar/table field.
const FIELD_BASE =
  "rounded-md border bg-surface text-foreground placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50";

export type FieldSize = "xs" | "md";

const FIELD_SIZE: Record<FieldSize, string> = {
  md: "px-3 py-2 text-sm",
  xs: "px-2 py-1 text-xs",
};

// valid = neutral line border + canonical green ring. invalid = pink semantic
// ring + pink border (NEVER also carry the green ring — see the header note).
const FIELD_VALID = `border-line ${FOCUS_RING}`;
const FIELD_INVALID =
  "border-ui-pink focus:outline-none focus:ring-2 focus:ring-ui-pink";

/** Canonical field class string (shell + size + valid/invalid state + 150ms
 *  transition). Exported so string-based consumers (the copy-declared
 *  `inputClass` locals) can single-source the exact same shell without adopting
 *  the component. ★ Width is NOT set — pass `w-full`/`flex-1`/a fixed width in
 *  `className` (appended LAST so layout tweaks extend the base). `size` defaults
 *  to `md`. */
export function fieldClass(invalid?: boolean, className?: string, size: FieldSize = "md"): string {
  return `${FIELD_BASE} ${FIELD_SIZE[size]} ${invalid ? FIELD_INVALID : FIELD_VALID} ${TRANSITION}${
    className ? ` ${className}` : ""
  }`;
}

// Native `size` (visible char/row count) is repurposed as the field-size
// variant, so it is omitted from the passthrough props (mirrors Checkbox).
export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
  /** Renders the pink semantic error state + sets aria-invalid. */
  invalid?: boolean;
  /** Field size (padding + text size). `md` (default) or compact `xs`. */
  size?: FieldSize;
}

/** Canonical text `<input>`. All native input props pass through; pair with a
 *  `<label>`/`aria-label` (a placeholder is not an accessible name). Pass a
 *  width (`w-full`/`flex-1`/fixed) via `className`. */
export function Input({ invalid, size, className, "aria-invalid": ariaInvalid, ...props }: InputProps) {
  return (
    <input
      className={fieldClass(invalid, className, size)}
      aria-invalid={ariaInvalid ?? (invalid ? true : undefined)}
      {...props}
    />
  );
}

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "size"> {
  invalid?: boolean;
  size?: FieldSize;
}

/** Canonical native `<select>` — same shell as Input. Pass a width via `className`. */
export function Select({ invalid, size, className, "aria-invalid": ariaInvalid, ...props }: SelectProps) {
  return (
    <select
      className={fieldClass(invalid, className, size)}
      aria-invalid={ariaInvalid ?? (invalid ? true : undefined)}
      {...props}
    />
  );
}

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
  /** Grows to fit content (needs a controlled string `value`). */
  autoGrow?: boolean;
  /** Field size (padding + text size). `md` (default) or compact `xs`. */
  size?: FieldSize;
}

/** Canonical `<textarea>` — Input shell + `resize-none`. `autoGrow` grows the
 *  field to fit its value via the shared use-autogrow hook (internal ref). Pass
 *  a width via `className`. */
export function Textarea({
  invalid,
  autoGrow,
  size,
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
      className={fieldClass(invalid, `resize-none${className ? ` ${className}` : ""}`, size)}
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

// ---------------------------------------------------------------------------
// FieldGroup — a captioned field block that is NOT a <label>
// ---------------------------------------------------------------------------

/**
 * A captioned block for a widget that a `<label>` MUST NOT wrap.
 *
 * ★★★ A `<label>` with no `for` binds to its FIRST LABELABLE DESCENDANT, and
 * the labelable set is button · input · meter · output · progress · select ·
 * textarea. A chip row, a radiogroup `<div>` and a contenteditable are none of
 * those — so a `<label>` around one silently adopts a BUTTON inside it. Two
 * consequences, both measured in Chromium: hovering anywhere in the caption
 * paints that button's `:hover` state, and clicking the caption forwards a
 * synthetic click to it. On a link picker that UNLINKS an entity; on a
 * `SegmentedControl` it WRITES the first option. jsdom has no CSS engine, so
 * only the click half is testable here.
 *
 * This renders `<div role="group" aria-label>` instead: the block is still
 * named for assistive tech, but the caption is not a click target. Use it
 * wherever the children's first labelable element is a button, or where there
 * is none at all.
 *
 * ★ NOT a general replacement for `<label>`. Where the caption legitimately
 * names a real `<input>` and a button merely got in front of it, keep the
 * `<label>` and add an explicit `htmlFor`/`id` — that preserves the name that
 * `role="group"` would move off the control. See `src/test/label-binding.ts`.
 */
export function FieldGroup({
  name,
  caption,
  className,
  children,
}: {
  /** Accessible name for the block. Qualify it when several render on one
   *  surface (the picker's own `label` prop is the usual source). */
  name: string;
  /** Rendered caption — a `<span>`, never a `<label>`. */
  caption: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div role="group" aria-label={name} className={className}>
      {caption}
      {children}
    </div>
  );
}
