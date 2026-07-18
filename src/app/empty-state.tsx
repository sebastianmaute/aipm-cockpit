"use client";

import type React from "react";
import { INTERACTIVE } from "./interaction-styles";

export interface EmptyStateAction {
  label: string;
  onClick: () => void;
}

interface EmptyStateProps {
  /** Headline — already translated by the caller (this component is i18n-free). */
  title: string;
  /** Optional supporting line. */
  description?: string;
  /** Optional decorative glyph; pass an `aria-hidden` SVG/element. */
  icon?: React.ReactNode;
  /** Optional call-to-action buttons (text label is the accessible name). */
  actions?: readonly EmptyStateAction[];
  /** Tighter padding for inline card slots (vs a full empty view). */
  compact?: boolean;
}

/** Composed "nothing here" view. Replaces bare `<p>no data</p>` lines so empty
 *  surfaces read as intentional rather than broken. Palette-safe (surface/line/
 *  muted tokens only); CTA buttons carry the shared interaction states. */
export function EmptyState({ title, description, icon, actions, compact = false }: EmptyStateProps) {
  return (
    <div className={`flex flex-col items-center text-center ${compact ? "gap-1 py-4" : "gap-2 py-10"}`}>
      {icon && <div aria-hidden="true" className="text-muted-foreground">{icon}</div>}
      <p className="text-sm font-medium text-foreground">{title}</p>
      {description && <p className="max-w-prose text-xs text-muted-foreground">{description}</p>}
      {actions && actions.length > 0 && (
        <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
          {actions.map((a, i) => (
            <button
              key={`${i}-${a.label}`}
              type="button"
              onClick={a.onClick}
              className={`rounded-md border border-line bg-surface px-3 py-1 text-xs font-medium text-foreground hover:border-ui-dark-blue hover:bg-surface-muted ${INTERACTIVE}`}
            >
              {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
