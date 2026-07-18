// Shared primitive for STATIC help/description copy shown under a form control
// or setting (design-system Phase 3i). The app repeated a bare
// `text-xs text-muted-foreground` span/paragraph for this everywhere; this owns
// the one canonical treatment so field help reads identically app-wide.
//
// Scope: descriptive HELP text only — the sentence that explains what a control
// does or when to enable it. NOT for values, counts, timestamps, meta lines, or
// empty-state copy that merely happen to be muted; those keep their own classes
// (a FieldHint would misrepresent their meaning). When the help text names a
// control for a screen reader, pass `id` and wire the control's
// `aria-describedby` to it (see mode-section's per-module descriptions).

import type { ElementType, ReactNode } from "react";

interface FieldHintProps {
  children: ReactNode;
  /** Extra classes appended after the canonical muted-help classes. */
  className?: string;
  /** Element tag. Defaults to `p`; use `span` inside inline/flow contexts. */
  as?: ElementType;
  /** Link target for a control's `aria-describedby`. */
  id?: string;
}

export function FieldHint({ children, className, as, id }: FieldHintProps) {
  const Tag = as ?? "p";
  return (
    <Tag
      id={id}
      className={`text-xs text-muted-foreground${className ? ` ${className}` : ""}`}
    >
      {children}
    </Tag>
  );
}
