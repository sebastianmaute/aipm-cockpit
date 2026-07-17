"use client";

// Canonical indeterminate loading spinner (design-system Phase 2b). Replaces the
// hand-rolled `h-7 w-7 animate-spin rounded-full border-2 border-AIPM-dark-blue
// border-t-transparent` span that was copy-declared across the AI-analysis,
// file-import and timelog fetch surfaces. ONE rotating-ring spinner so busy
// indicators read identically app-wide.
//
// Decorative by default (`aria-hidden`) — the surrounding status region (a
// `role="status"`/`aria-live` container, or an adjacent label) announces the
// loading state to screen readers; a lone spinning glyph carries no meaning.
// Palette-safe: brand ring colour, no shadow/gradient.

const SPINNER_SIZE: Record<"sm" | "md" | "lg", string> = {
  sm: "h-4 w-4 border-2",
  md: "h-7 w-7 border-2",
  lg: "h-10 w-10 border-[3px]",
};

export interface SpinnerProps {
  /** Ring diameter. Default `md` reproduces the legacy `h-7 w-7 border-2`. */
  size?: "sm" | "md" | "lg";
  className?: string;
}

export function Spinner({ size = "md", className = "" }: SpinnerProps) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block animate-spin rounded-full border-AIPM-dark-blue border-t-transparent ${SPINNER_SIZE[size]}${
        className ? ` ${className}` : ""
      }`}
    />
  );
}
