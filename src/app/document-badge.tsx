"use client";

// src/app/document-badge.tsx — "N documents reference this row".
//
// ★★ PROPS ONLY, no context. It renders inside the Kanban card, which sits
// OUTSIDE RowContextProvider, and `useWorkspaceTab` THROWS without a provider —
// either hook would crash a surface or an unwrapped test. The host supplies
// `onOpen`. Same rule, same reason, as task-raid-badge.tsx.

import { memo } from "react";
import { DocumentTextIcon } from "./icons";
import { type Lang, t } from "./i18n";
import { INTERACTIVE } from "./interaction-styles";

interface DocumentBadgeProps {
  /** How many documents reference this entity. 0 renders nothing. */
  count: number;
  /** ★ Row-UNIQUE qualifier for the accessible name (WCAG 2.4.6). N identical
   *  "2 documents" names in a list is a failure the axe gate CANNOT see. */
  entityTitle: string;
  lang: Lang;
  onOpen: () => void;
}

function DocumentBadgeImpl({ count, entityTitle, lang, onOpen }: DocumentBadgeProps) {
  // A badge reading 0 is noise on every row of an unlinked project.
  if (count <= 0) return null;
  const name = `${t(lang, "documentsLinkedBadge", count)} – ${entityTitle}`;
  return (
    <button
      type="button"
      onClick={(e) => {
        // In-<tr> controls must stop propagation or the row's own handler fires.
        e.stopPropagation();
        onOpen();
      }}
      title={t(lang, "documentsLinkedBadge", count)}
      aria-label={name}
      className={`ml-1 inline-flex items-center gap-0.5 whitespace-nowrap rounded bg-surface-muted px-1.5 py-0.5 text-[10px] font-medium text-foreground ${INTERACTIVE}`}
    >
      <DocumentTextIcon aria-hidden="true" className="h-3 w-3" />
      {count}
    </button>
  );
}

export const DocumentBadge = memo(DocumentBadgeImpl);
