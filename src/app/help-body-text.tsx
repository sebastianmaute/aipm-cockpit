"use client";

import { parseHelpBody } from "./help-body-markup";
import { highlightSegments } from "./help-search";

/** Renders one help body's `[[label]]` segments.
 *
 *  ★ EXTRACTED so the Help view and the modal help popover cannot drift. Its
 *  only consumer today is `help-content-pane.tsx`, which passes its live search
 *  query; the modal help popover is the second one it was extracted FOR and
 *  will pass none.
 *
 *  ★★ `labelClass` IS A PROP, NOT A CONSTANT, because the pane's two sites
 *  differ: the primer uses `font-medium`, the body `font-medium text-foreground`.
 *  Hardcoding either one silently restyles the other.
 *
 *  ★★ THE WEIGHT IS THE WHOLE EFFECT. `scheme-tokens.ts` derives
 *  `--muted-foreground` FROM `--foreground`, so they are identical by
 *  construction in every built-in scheme — a "simplification" that keeps the
 *  colour class and drops `font-medium` renders labels invisible. */
export function HelpBodyText({
  body,
  labelClass,
  query = "",
}: {
  body: string;
  labelClass: string;
  /** Omitted by the popover; `highlightSegments` returns one unmatched segment
   *  for an empty query, so no `<mark>` is emitted. */
  query?: string;
}) {
  return (
    <>
      {parseHelpBody(body).map((seg, i) =>
        seg.isLabel ? (
          <span key={i} className={labelClass}>
            <Highlighted text={seg.text} query={query} />
          </span>
        ) : (
          <Highlighted key={i} text={seg.text} query={query} />
        ),
      )}
    </>
  );
}

/** One entry's search-term highlighting, shared rather than copied.
 *
 *  ★★ EXPORTED because `help-content-pane.tsx` renders an entry's TITLE, which
 *  is not a body and so cannot route through `HelpBodyText`. It calls this
 *  DIRECTLY for the title and reaches it through `HelpBodyText` for the primer
 *  and the body. A second copy is how those two drift: change the `<mark>`
 *  class in one place only, and a search term highlights differently in a
 *  title than in the body directly beneath it, inside one view. */
export function Highlighted({ text, query }: { text: string; query: string }) {
  return (
    <>
      {highlightSegments(text, query).map((seg, k) =>
        seg.match ? (
          <mark key={k} className="bg-ui-green/20 text-inherit">
            {seg.text}
          </mark>
        ) : (
          <span key={k}>{seg.text}</span>
        ),
      )}
    </>
  );
}
