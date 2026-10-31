// src/app/absence-clash-notes.tsx — §773: the absence warning line every AI preview renders for a clash.
// `AbsenceClashLine` is the one leaf (icon + sentence) the inline edit popover, the chat staged card, the
// insight review (through `AbsenceClashNotes`), Plan with AI's move rows and the WBS plan's rows all render;
// each surface picks its own element and classes.
// ★ Icon PLUS text, never colour alone: the glyph is `aria-hidden` (lucide does not hide an icon handed an
//  a11y prop, so it is set explicitly) and the sentence carries the whole warning.
import { formatAbsenceClash } from "./absence-clash-notice";
import type { AbsenceClash } from "./absence-clash";
import { type Lang } from "./i18n";
import { ExclamationTriangleIcon } from "./icons";
import type { ClashNote } from "./inline-ai-edit/plan";

export interface AbsenceClashLineProps {
  as: "li" | "p" | "span";
  className: string;
  lang: Lang;
  clash: AbsenceClash;
  /** A list item names the item it concerns; an empty title shows none. Omitted, the sentence stands alone. */
  title?: string;
  id?: string;
}

export function AbsenceClashLine({ as: Tag, className, lang, clash, title, id }: AbsenceClashLineProps) {
  const sentence = <span>{formatAbsenceClash(clash, lang)}</span>;
  return (
    <Tag id={id} className={className}>
      <ExclamationTriangleIcon aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      {title === undefined ? (
        sentence
      ) : (
        <span>
          {title ? <span className="font-medium">{title}: </span> : null}
          {sentence}
        </span>
      )}
    </Tag>
  );
}

/** The absence warnings of one AI change preview, as list items the surface places inside its own change list. */
export function AbsenceClashNotes({ lang, clashes }: { lang: Lang; clashes: readonly ClashNote[] }) {
  return clashes.map((n, i) => (
    <AbsenceClashLine
      key={`a${i}-${n.entity}-${n.id ?? "new"}`}
      as="li"
      className="flex items-start gap-1.5 text-foreground"
      lang={lang}
      clash={n.clash}
      title={n.title}
    />
  ));
}
