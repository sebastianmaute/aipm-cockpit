"use client";

// src/app/document-entity-filter-banner.tsx — "you are looking at a SUBSET".
//
// ★★ A filtered list that does not say it is filtered reads as an empty or
// truncated project — the orphaned-list-filter class (`resolveEffectiveFilters`)
// exists because of exactly that. So the dismiss control is mandatory furniture,
// not decoration: it is the only visible way back to the full list once a
// DocumentBadge armed the filter from another view.
//
// Props only — no context, no state. The pane owns both.

import { type Lang, t } from "./i18n";
import { INTERACTIVE } from "./interaction-styles";

interface DocumentEntityFilterBannerProps {
  lang: Lang;
  /** Display title of the entity being filtered to. The caller falls back to
   *  `#<id>` for an entity that has since been deleted — a banner with a blank
   *  subject would not say what was filtered out. */
  title: string;
  /** Whether the filtered list came back empty. */
  isEmpty: boolean;
  onClear: () => void;
}

export function DocumentEntityFilterBanner({ lang, title, isEmpty, onClear }: DocumentEntityFilterBannerProps) {
  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-2 rounded-md border border-line bg-surface-muted px-3 py-2 text-sm"
    >
      <span className="min-w-0 text-foreground">{t(lang, "documentsFilteredBy", title)}</span>
      {/* The empty case is the one that most needs saying: an empty list under
          an unexplained filter is indistinguishable from a project with no
          documents at all. */}
      {isEmpty && <span className="text-muted-foreground">{t(lang, "documentsFilterEmpty")}</span>}
      {/* ★ A real <button>, never a clickable <span> — this is the only exit
          from the filter, so it has to be keyboard-operable and named. */}
      <button
        type="button"
        onClick={onClear}
        aria-label={t(lang, "documentsFilterClear")}
        className={`ml-auto rounded-md border border-line bg-surface px-2 py-1 text-xs font-medium text-foreground hover:bg-surface-muted ${INTERACTIVE}`}
      >
        {t(lang, "documentsFilterClear")}
      </button>
    </div>
  );
}
