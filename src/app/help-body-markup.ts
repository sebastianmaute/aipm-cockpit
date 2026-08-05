// Pure, i18n-free, DOM-free parser for the `[[label]]` markers help bodies use
// to name a UI control the reader can see on screen.
//
// ★★ Why markers exist at all: `help-content-gate.test.ts` resolves every
// marked label against the live i18n dictionaries, so a body naming a control
// that was renamed or deleted fails the build. Bare quotes cannot be checked —
// help bodies also quote ordinary phrases, and a checker that could not tell
// the two apart would either miss the real cases or fail correct sentences.
//
// ★ Markers are for UI LABELS ONLY. Ordinary quoted prose stays in quotes.
// When it is unclear whether a quoted string is a label, leave it quoted: a
// false marker turns a true sentence into a build failure.

export interface HelpBodySegment {
  /** Segment text, with the `[[ ]]` delimiters already removed. */
  text: string;
  isLabel: boolean;
}

/** Split a body into label and non-label segments, in source order.
 *
 *  ★ A malformed marker (unclosed, or empty like `[[]]`) degrades to LITERAL
 *  text rather than throwing. A parser that threw here would blank the help
 *  body it was meant to describe. */
export function parseHelpBody(body: string): HelpBodySegment[] {
  // ★ Built per call, not hoisted: a `g`-flagged regex carries `lastIndex`
  // across calls, so a shared instance would skip matches on every second body.
  // ★ `exec` loop, not `matchAll` — the tsc target predates ES2020.
  const re = /\[\[([^[\]]+)\]\]/g;
  const out: HelpBodySegment[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    if (m.index > last) out.push({ text: body.slice(last, m.index), isLabel: false });
    out.push({ text: m[1], isLabel: true });
    last = m.index + m[0].length;
  }
  if (last < body.length) out.push({ text: body.slice(last), isLabel: false });
  return out.length > 0 ? out : [{ text: body, isLabel: false }];
}

/** The body as the user reads it, markers removed. Feed this to SEARCH — the
 *  raw body would let a query match `[[` markup that is never rendered. */
export function stripHelpMarkers(body: string): string {
  return parseHelpBody(body)
    .map((s) => s.text)
    .join("");
}

/** Every marked label in a body. Consumed by the gate. */
export function helpBodyLabels(body: string): string[] {
  return parseHelpBody(body)
    .filter((s) => s.isLabel)
    .map((s) => s.text);
}
