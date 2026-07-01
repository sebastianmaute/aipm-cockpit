"use client";
// src/app/task-jira-badge.tsx — Jira-reference badge shown on a task.
// Signage-only: a Jira-synced task (`!!task.jiraKey`) is read-only — drag on the
// Kanban board and manual status changes are disabled elsewhere. This badge adds
// a leading lock icon + a descriptive tooltip/aria so the read-only state is
// obvious. It changes NO drag/disabled logic.
//
// Takes everything as PROPS (lang/href/issueType) so it works both in the table
// row AND on the Kanban card — the board renders cards OUTSIDE RowContextProvider,
// so the badge must never call useTaskRowContext(). Imports nothing from task-row.
import { memo, type ReactNode } from "react";
import { type Lang, t } from "./i18n";
import { INTERACTIVE } from "./interaction-styles";

interface JiraBadgeProps {
  jiraKey: string;
  lang: Lang;
  href?: string;
  issueType?: string;
  /** true = the issue's project is read-only (watch); false = two-way. Drives the
   *  glyph + tooltip wording. Defaults to two-way. */
  readOnlyProject?: boolean;
}

const BADGE_CLASS =
  "inline-block rounded bg-surface px-1.5 py-0.5 text-[10px] font-medium text-AIPM-dark-blue dark:text-AIPM-blue";

// Decorative closed-padlock glyph. `fill="currentColor"` so it inherits the
// chip's brand-token text color (palette-safe — no hardcoded color); aria-hidden
// because the chip text + title carry the meaning (no label-bleed).
const lockIcon: ReactNode = (
  <svg
    aria-hidden="true"
    viewBox="0 0 24 24"
    className="inline-block h-2.5 w-2.5 mr-0.5 align-[-1px]"
    fill="currentColor"
  >
    <path d="M12 2a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-1V7a5 5 0 0 0-5-5zm-3 5a3 3 0 0 1 6 0v3H9V7zm3 8a1.5 1.5 0 0 1 .75 2.8V19a.75.75 0 0 1-1.5 0v-1.2A1.5 1.5 0 0 1 12 15z" />
  </svg>
);

// Two circular arrows — signals a two-way synced link (vs the read-only padlock).
const syncIcon: ReactNode = (
  <svg
    aria-hidden="true"
    viewBox="0 0 24 24"
    className="inline-block h-2.5 w-2.5 mr-0.5 align-[-1px]"
    fill="currentColor"
  >
    <path d="M12 4V1L8 5l4 4V6a6 6 0 0 1 6 6h2a8 8 0 0 0-8-8zm-6 8H4a8 8 0 0 0 8 8v3l4-4-4-4v3a6 6 0 0 1-6-6z" />
  </svg>
);

function JiraBadgeImpl({ jiraKey, lang, href, issueType, readOnlyProject = false }: JiraBadgeProps) {
  const label = t(lang, readOnlyProject ? "jiraSyncedReadOnlyProject" : "jiraSyncedTwoWay");
  const glyph = readOnlyProject ? lockIcon : syncIcon;

  if (href) {
    const title = issueType ? `${jiraKey} (${issueType}) — ${label}` : `${jiraKey} — ${label}`;
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        title={title}
        aria-label={label}
        className={`${BADGE_CLASS} hover:underline ${INTERACTIVE}`}
      >
        {glyph}
        {jiraKey}
      </a>
    );
  }

  return (
    <span title={label} aria-label={label} className={BADGE_CLASS}>
      {glyph}
      {jiraKey}
    </span>
  );
}

export const JiraBadge = memo(JiraBadgeImpl);
