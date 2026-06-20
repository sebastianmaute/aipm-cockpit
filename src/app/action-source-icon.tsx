// src/app/action-source-icon.tsx
import type { ReactNode } from "react";
import type { ActionSource } from "./next-actions/types";

// Small decorative glyphs (currentColor, no fill flourishes) — one per ActionSource.
// Keyed by every union member so a missing source is a tsc error. The accessible
// hint comes from the adjacent InfoTooltip, so each svg is aria-hidden.
const ICON_CLASS = "h-3.5 w-3.5";

export const ACTION_SOURCE_ICON: Record<ActionSource, ReactNode> = {
  // task-due: checkbox
  "task-due": (
    <svg aria-hidden viewBox="0 0 16 16" className={ICON_CLASS} fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="2.5" y="2.5" width="11" height="11" rx="2" />
      <path d="M5 8l2 2 4-4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  // raid: warning triangle
  raid: (
    <svg aria-hidden viewBox="0 0 16 16" className={ICON_CLASS} fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M8 2.5l5.5 10h-11z" strokeLinejoin="round" />
      <path d="M8 6.5v3" strokeLinecap="round" />
      <circle cx="8" cy="11.5" r="0.6" fill="currentColor" stroke="none" />
    </svg>
  ),
  // change-pending: circular arrows
  "change-pending": (
    <svg aria-hidden viewBox="0 0 16 16" className={ICON_CLASS} fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M3 8a5 5 0 0 1 8.5-3.5M13 8a5 5 0 0 1-8.5 3.5" strokeLinecap="round" />
      <path d="M11.5 2v2.5H9M4.5 14v-2.5H7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  // milestone: flag
  milestone: (
    <svg aria-hidden viewBox="0 0 16 16" className={ICON_CLASS} fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M4 2v12" strokeLinecap="round" />
      <path d="M4 3h7l-1.5 2.5L11 8H4z" strokeLinejoin="round" />
    </svg>
  ),
  // budget: currency note
  budget: (
    <svg aria-hidden viewBox="0 0 16 16" className={ICON_CLASS} fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="2" y="4" width="12" height="8" rx="1.5" />
      <circle cx="8" cy="8" r="2" />
    </svg>
  ),
  // stakeholder-comms: speech bubble
  "stakeholder-comms": (
    <svg aria-hidden viewBox="0 0 16 16" className={ICON_CLASS} fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z" strokeLinejoin="round" />
    </svg>
  ),
  // schedule: calendar
  schedule: (
    <svg aria-hidden viewBox="0 0 16 16" className={ICON_CLASS} fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="2.5" y="3.5" width="11" height="10" rx="1.5" />
      <path d="M2.5 6.5h11M5.5 2v3M10.5 2v3" strokeLinecap="round" />
    </svg>
  ),
  // workload: stacked bars
  workload: (
    <svg aria-hidden viewBox="0 0 16 16" className={ICON_CLASS} fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M3 13V8M8 13V4M13 13v-3" strokeLinecap="round" />
    </svg>
  ),
  // committee: people / group
  committee: (
    <svg aria-hidden viewBox="0 0 16 16" className={ICON_CLASS} fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="5.5" cy="5" r="2" />
      <circle cx="11" cy="5.5" r="1.5" />
      <path d="M2 13v-1.5a3 3 0 0 1 3-3h1a3 3 0 0 1 3 3V13M10 13v-1a2.5 2.5 0 0 1 2.5-2.5H13" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
};
