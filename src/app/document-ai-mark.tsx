"use client";

// §801 — the open document's AI-generated mark: a plain label, plus (for a person who can edit) the
// one control that removes it. The badge is NOT a control; the button's accessible name is its
// visible label. Removal is decided by the host (it confirms, mutates and logs) — this is presentation.

import { type Lang, t } from "./i18n";
import { Button } from "./button";
import { isAiMarked } from "./ai-content-mark";
import type { ProjectDocument } from "./document-model";

interface DocumentAiMarkProps {
  lang: Lang;
  doc: ProjectDocument | null;
  /** Popout mirrors and other read-only surfaces: the badge shows, remove is not offered. */
  isReadOnly?: boolean;
  onRemove: (doc: ProjectDocument) => void;
}

export function DocumentAiMark({ lang, doc, isReadOnly, onRemove }: DocumentAiMarkProps) {
  if (!doc || !isAiMarked(doc)) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="rounded bg-surface-muted px-1.5 py-0.5 text-xs font-medium text-foreground">
        {t(lang, "docAiMarkBadge")}
      </span>
      {!isReadOnly && (
        <Button variant="secondary" size="xs" onClick={() => onRemove(doc)}>
          {t(lang, "docAiMarkRemove")}
        </Button>
      )}
    </div>
  );
}
