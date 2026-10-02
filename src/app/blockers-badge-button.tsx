// src/app/blockers-badge-button.tsx
//
// Open-blocker count badge for the Open Points table's Blockers cell. Opens the
// floating blocker window for the task. Shaped like `notes-badge-button.tsx`.
//
// ★★ The red tier colour rides the DOT, never the number: tinted small text on
// `bg-surface` fails AA in the dark schemes (AGENTS.md, the `--rag-amber-text`
// landmine), and a dot is non-text, so it is AA-exempt. With nothing open the
// dot is muted and no number renders.
//
// ★ The accessible name is row-UNIQUE (the caller passes the row token)
// because the Open Points table is axe-scanned, and it CONTAINS the visible
// count (WCAG 2.5.3 label-in-name) — `blockerBadgeLabel` carries both.
import { Dot } from "./dot";
import { type Lang, t } from "./i18n";
import { INTERACTIVE } from "./interaction-styles";
import { TIER_RAG } from "./next-actions/action-cta";

export interface BlockersBadgeButtonProps {
  /** Number of OPEN blocker entries (resolved ones are not counted). */
  openCount: number;
  /** Row-unique entity label, used in the accessible name. */
  entityName: string;
  lang: Lang;
  /** The open blockers' text (`Task.blockers`). Shown as the hover `title`
   *  while any are open, so the text is a hover away; never the accessible
   *  name, which stays `blockerBadgeLabel` (`aria-label` wins over `title`). */
  text?: string;
  /** Open the floating blocker window for this task. */
  onClick: () => void;
}

export function BlockersBadgeButton({ openCount, entityName, lang, text, onClick }: BlockersBadgeButtonProps) {
  const hasOpen = openCount > 0;
  const hoverText = hasOpen && text ? text : t(lang, "blockerLogTitle");
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={t(lang, "blockerBadgeLabel", entityName, openCount)}
      title={hoverText}
      className={`inline-flex items-center gap-1.5 rounded-md border border-transparent px-2 py-0.5 text-muted-foreground hover:border-ui-dark-blue hover:bg-surface-muted ${INTERACTIVE}`}
    >
      <Dot color={hasOpen ? TIER_RAG.now.dot : "bg-line"} size="sm" />
      {hasOpen && <span className="text-xs font-medium">{openCount}</span>}
    </button>
  );
}
