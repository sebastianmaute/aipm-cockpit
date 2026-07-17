"use client";

// Canonical <Banner> primitive (design-system Phase 1e). Replaces the ~11
// hand-rolled tinted alert/notice boxes that drifted across the app — including
// the shared `AlertBanner`, which was HARD-PINNED to error-pink for ALL
// consumers, so a birthday reminder and a Jira-token warning both rendered in
// the error colour. Banner OWNS the semantic tint per `severity`, so the colour
// finally tracks the meaning.
//
// Every tint is a sanctioned AIPM brand / RAG role token, so the primitive is
// palette-safe by construction (no gradients, shadows or off-palette values).
// ★ warn rides the `--rag-amber` token on the BORDER/BACKGROUND only — never as
// small text (`--rag-amber-text` fails AA on dark/mockup, see AGENTS.md); the
// text stays `text-foreground`. The container text colour is a default only —
// callers routinely set their own inner text colours.

import type { HTMLAttributes } from "react";

export type BannerSeverity = "info" | "warn" | "success" | "error";

// Severity → sanctioned token tint. border/40 + bg/10-15 keep the box subtle;
// the text colour is AA-safe on the tint (AIPM-*-strong on surface, foreground
// on the neutral/amber tints).
const SEVERITY_CLASS: Record<BannerSeverity, string> = {
  info: "border-AIPM-dark-blue/40 bg-AIPM-dark-blue/10 text-foreground dark:border-AIPM-dark-blue/60 dark:bg-AIPM-dark-blue/15",
  warn: "border-[var(--rag-amber)]/40 bg-[var(--rag-amber)]/15 text-foreground dark:border-[var(--rag-amber)]/50 dark:bg-[var(--rag-amber)]/20",
  success: "border-AIPM-green/40 bg-AIPM-green/10 text-AIPM-green-strong dark:border-AIPM-green/60 dark:bg-AIPM-green/15",
  error: "border-AIPM-pink/40 bg-AIPM-pink/10 text-AIPM-pink-strong dark:border-AIPM-pink/60 dark:bg-AIPM-pink/15",
};

// One canonical banner radius + padding + type size for the whole app.
const BASE_CLASS = "rounded-md border px-3 py-2 text-sm";

export interface BannerProps extends HTMLAttributes<HTMLDivElement> {
  severity: BannerSeverity;
}

/** Shared tinted alert/notice box. The caller owns the live-region role
 *  (`role="alert"` for errors, `"status"` for polite notices, `"region"` for a
 *  labelled landmark) and any dismiss/action controls, passed as children +
 *  native div props. `className` is appended AFTER the severity classes so
 *  layout tweaks (flex, gap, mb-*, sm:col-span-2…) extend the base. */
export function Banner({ severity, className, ...props }: BannerProps) {
  const classes = `${BASE_CLASS} ${SEVERITY_CLASS[severity]}${
    className ? ` ${className}` : ""
  }`;
  return <div className={classes} {...props} />;
}
