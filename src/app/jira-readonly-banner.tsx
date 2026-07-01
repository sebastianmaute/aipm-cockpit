"use client";
// src/app/jira-readonly-banner.tsx — shown atop the task editor when the task's
// Jira project is read-only (watch only). Palette-safe AIPM tokens only.
import { type Lang, t } from "./i18n";

export function JiraReadOnlyBanner({ lang, projectName }: { lang: Lang; projectName: string }) {
  return (
    <div
      role="note"
      className="rounded-md border border-line bg-surface-muted px-3 py-2 text-xs text-foreground"
    >
      {t(lang, "jiraReadOnlyBanner", projectName)}
    </div>
  );
}
