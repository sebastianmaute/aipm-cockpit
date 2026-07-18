"use client";

// Canonical text-link button primitive (design-system). For inline ACTION links
// that look like a hyperlink (no fill/border, underline-on-hover) but perform an
// in-page action, not navigation — e.g. "Remove", "Reset", "Compare to now".
// Distinct from the padded `<Button>` chip: TextButton has NO padding and does
// NOT set a text size, so callers keep their own `text-xs`/`text-sm` (no
// override conflict). Two tones only: `default` (dark-blue) and `danger` (pink);
// links needing other colours or that are prose/navigation stay bespoke.

import type { ButtonHTMLAttributes, Ref } from "react";
import { FOCUS_RING, TRANSITION } from "./interaction-styles";

export type TextButtonTone = "default" | "danger";

const TONE_CLASS: Record<TextButtonTone, string> = {
  default: "text-ui-dark-blue hover:underline dark:text-ui-light-grey",
  danger: "text-ui-pink-strong hover:underline",
};

// No padding, no text-size (caller owns those); a small radius keeps the focus
// ring tidy. `font-medium` + `underline-offset-2` match the app's link look.
const BASE_CLASS =
  "cursor-pointer rounded-sm font-medium underline-offset-2 disabled:cursor-not-allowed disabled:opacity-50";

export interface TextButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  tone?: TextButtonTone;
  ref?: Ref<HTMLButtonElement>;
}

/** Shared inline text-link action button. Defaults to the `default` (dark-blue)
 *  tone and `type="button"`. Caller `className` is appended AFTER (keep the
 *  control's own `text-xs`/`text-sm`, `self-start`, margins, etc.). */
export function TextButton({
  tone = "default",
  type = "button",
  className,
  ref,
  ...props
}: TextButtonProps) {
  const classes = `${BASE_CLASS} ${TONE_CLASS[tone]} ${FOCUS_RING} ${TRANSITION}${
    className ? ` ${className}` : ""
  }`;
  return <button ref={ref} type={type} className={classes} {...props} />;
}
