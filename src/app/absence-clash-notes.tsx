// src/app/absence-clash-notes.tsx — §773: the absence warnings of one AI change preview, as list items the
// surface places inside its own change list (inline edit popover, chat staged card, insight review).
// ★ Icon PLUS text, never colour alone: the glyph is `aria-hidden` (lucide does not hide an icon handed an
//  a11y prop, so it is set explicitly) and the sentence carries the whole warning.
import { formatAbsenceClash } from "./absence-clash-notice";
import { type Lang } from "./i18n";
import { ExclamationTriangleIcon } from "./icons";
import type { ClashNote } from "./inline-ai-edit/plan";

export function AbsenceClashNotes({ lang, clashes }: { lang: Lang; clashes: readonly ClashNote[] }) {
  return clashes.map((n, i) => (
    <li key={`a${i}-${n.entity}-${n.id ?? "new"}`} className="flex items-start gap-1.5 text-foreground">
      <ExclamationTriangleIcon aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>
        {n.title ? <span className="font-medium">{n.title}: </span> : null}
        <span>{formatAbsenceClash(n.clash, lang)}</span>
      </span>
    </li>
  ));
}
