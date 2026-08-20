// One comment stripper for every SOURCE assertion in the suite.
//
// ★★★ A SOURCE ASSERTION OVER A FILE THAT DOCUMENTS ITSELF WILL READ ITS OWN
// PROSE. That is not hypothetical: `rich-text-editor-lazy.test.tsx` once
// asserted `toContain("ssr: false")` against raw source and SURVIVED the
// `ssr: true` mutant, because the module's header discusses `ssr: false` in
// words. Measured — the mutated file passed 5/5. Strip first, always.
//
// ★★ LENGTH-PRESERVING: comments are blanked to spaces, newlines kept. The
// label-binding scanner compares match INDEXES and reports LINE NUMBERS, so
// deleting the text outright would move both.
//
// ★★ WHY THIS IS A SCANNER AND NOT THREE REGEXES. The regex form it replaces
// stripped a `//` comment only when it STARTED a line — deliberately, because a
// bare `//` rule eats the `//` of a URL and truncates the rest of the line. The
// cost of that trade was a whole class of invisible needle: a TRAILING
// `code(); // …★…` comment survived every strip, so the very assertion added to
// prove no prose was read (`expect(CODE).not.toContain("★")`) could itself be
// satisfied by prose. Tracking strings instead of guessing at line shape closes
// both ends at once.
//
// ★★ FAILURE DIRECTION IS DELIBERATE. Anything this scanner misreads as a
// string is copied through VERBATIM, never blanked — so a misread degrades to
// "that comment was not stripped", which is exactly the old behaviour, and can
// never blank a line of real code. A single- or double-quoted run must also
// close on the SAME LINE to count as a string, which keeps an apostrophe in JSX
// prose (`don't`) from opening a span that swallows a real comment after it.
//
// ★ KNOWN LIMIT, stated rather than hidden: a REGEX LITERAL is not tracked. A
// literal containing an unescaped `//` or `/*` would be mangled. No such
// literal exists in the files scanned today (escaped forms like `\/\*` are
// safe, since the characters are never adjacent), and adding regex tracking
// needs the full "is this a division or a regex?" analysis, which is not worth
// its risk here. Re-check if you point a source assertion at a new file.

const blank = (text: string): string => text.replace(/[^\r\n]/g, " ");

/** Source with every comment blanked to spaces of the same length. */
export function stripComments(src: string): string {
  const out: string[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];

    if (c === "`") {
      out.push(src.slice(i, (i = endOfQuoted(src, i, "`", false))));
      continue;
    }
    if (c === '"' || c === "'") {
      const end = endOfQuoted(src, i, c, true);
      // Unterminated on this line: not a string. Emit the quote alone and carry
      // on scanning from the next character, so a comment behind it is still seen.
      if (end === -1) {
        out.push(c);
        i++;
        continue;
      }
      out.push(src.slice(i, (i = end)));
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      const close = src.indexOf("*/", i + 2);
      const end = close === -1 ? src.length : close + 2;
      out.push(blank(src.slice(i, end)));
      i = end;
      continue;
    }
    if (c === "/" && src[i + 1] === "/") {
      let end = i;
      while (end < src.length && src[end] !== "\n" && src[end] !== "\r") end++;
      out.push(blank(src.slice(i, end)));
      i = end;
      continue;
    }

    out.push(c);
    i++;
  }
  return out.join("");
}

/** Index one past the closing `quote` opened at `start`. `sameLine` bounds the
 *  search to the opening line and returns -1 when it does not close there. */
function endOfQuoted(src: string, start: number, quote: string, sameLine: boolean): number {
  for (let j = start + 1; j < src.length; j++) {
    const ch = src[j];
    if (ch === "\\") {
      j++;
      continue;
    }
    if (ch === quote) return j + 1;
    if (sameLine && (ch === "\n" || ch === "\r")) return -1;
  }
  return sameLine ? -1 : src.length;
}
