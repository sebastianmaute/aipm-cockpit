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
  info: "border-ui-dark-blue/40 bg-ui-dark-blue/10 text-foreground dark:border-ui-dark-blue/60 dark:bg-ui-dark-blue/15",
  warn: "border-[var(--rag-amber)]/40 bg-[var(--rag-amber)]/15 text-foreground dark:border-[var(--rag-amber)]/50 dark:bg-[var(--rag-amber)]/20",
  success: "border-ui-green/40 bg-ui-green/10 text-ui-green-strong dark:border-ui-green/60 dark:bg-ui-green/15",
  error: "border-ui-pink/40 bg-ui-pink/10 text-ui-pink-strong dark:border-ui-pink/60 dark:bg-ui-pink/15",
};

// One canonical banner radius + padding + type size for the whole app.
const BASE_CLASS = "rounded-md border px-3 py-2 text-sm";

export interface BannerProps extends HTMLAttributes<HTMLDivElement> {
  severity: BannerSeverity;
}

/** Shared tinted alert/notice box. The live-region role DEFAULTS from severity
 *  (`error` → `role="alert"` so validation/config failures are announced
 *  promptly; everything else → `role="status"` for a polite announcement) so a
 *  caller can't silently ship an unannounced error box. Pass an explicit `role`
 *  to override (e.g. `"region"` for a labelled landmark, or `"none"` to opt
 *  out of a live region). Dismiss/action controls + `className` (appended AFTER the severity
 *  classes, so layout tweaks like flex, gap, margin or column-span extend the
 *  base) ride the native div props. */
export function Banner({ severity, className, role, ...props }: BannerProps) {
  const resolvedRole =
    role !== undefined ? role : severity === "error" ? "alert" : "status";
  const classes = `${BASE_CLASS} ${SEVERITY_CLASS[severity]}${
    className ? ` ${className}` : ""
  }`;
  return <div role={resolvedRole} className={classes} {...props} />;
}
