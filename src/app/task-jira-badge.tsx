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
import { ArrowPathRoundedSquareIcon, LockClosedIcon } from "./icons";
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
  "inline-block whitespace-nowrap rounded bg-surface px-1.5 py-0.5 text-[10px] font-medium text-ui-dark-blue dark:text-ui-blue";

// Decorative closed-padlock glyph. `fill="currentColor"` so it inherits the
// chip's brand-token text color (palette-safe — no hardcoded color); aria-hidden
// because the chip text + title carry the meaning (no label-bleed).
const lockIcon: ReactNode = (
  <LockClosedIcon aria-hidden="true" className="inline-block h-2.5 w-2.5 mr-0.5 align-[-1px]" />
);

// Two circular arrows — signals a two-way synced link (vs the read-only padlock).
const syncIcon: ReactNode = (
  <ArrowPathRoundedSquareIcon aria-hidden="true" className="inline-block h-2.5 w-2.5 mr-0.5 align-[-1px]" />
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
