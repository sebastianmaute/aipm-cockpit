// src/app/notes-badge-button.tsx
//
// Shared note-log count badge button. Opens the floating notes window for an
// entity (task or RAID item). Extracted so the task-row cell and the RAID row
// cell render identical markup instead of duplicating it (honours the
// no-hand-roll / no-DS-sprawl rule). The accessible name is row-UNIQUE — it
// incorporates the entity name — because the RAID table is axe-scanned and N
// identical "Notes log" labels would fail WCAG 2.4.6.
import { DocumentTextIcon } from "@heroicons/react/24/outline";
import { type Lang, t } from "./i18n";
import { INTERACTIVE } from "./interaction-styles";

export interface NotesBadgeButtonProps {
  /** Number of note-log entries (rendered as the count). */
  count: number;
  /** Entity name, used to build a row-unique accessible name. */
  entityName: string;
  lang: Lang;
  /** Open the floating notes window for this entity. */
  onClick: () => void;
}

export function NotesBadgeButton({ count, entityName, lang, onClick }: NotesBadgeButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`${t(lang, "noteLogTitle")} – ${entityName}`}
      title={t(lang, "noteLogTitle")}
      className={`inline-flex items-center gap-1 rounded-md border border-transparent px-2 py-0.5 text-muted-foreground hover:border-ui-dark-blue hover:bg-surface-muted ${INTERACTIVE}`}
    >
      <DocumentTextIcon aria-hidden="true" className="h-4 w-4" />
      <span className="text-xs font-medium">{count}</span>
    </button>
  );
}
