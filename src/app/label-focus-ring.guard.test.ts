import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { stripComments } from "../test/strip-comments";

// ---------------------------------------------------------------------------
// Guard (open-followups §46): no `<label>` may carry a `focus:` style.
// ---------------------------------------------------------------------------
//
// A `<label>` is not a form control, so `focus:ring-2` compiles to `&:focus`
// and can never match it. When the control inside is `sr-only`, the clip also
// hides the UA's own ring, so the focus indicator vanishes outright (WCAG
// 2.4.7). That shipped at three Settings → Appearance sites. axe has no focus-
// visibility rule, and a wrapping label supplies a correct accessible NAME, so
// no other gate sees it.
//
// The fix is to put the ring on the control itself, or to use `focus-within:`
// on the label if a label shape is genuinely wanted. `focus-within:` passes;
// so does a label given a `tabIndex` (then it IS focusable).
//
// ★ `FOCUS_RING` and `INTERACTIVE` (which contains it) are matched by NAME,
//   because a class string built from them never spells `focus:` in the source.
// ★ A NAME-level scan: a label whose classes arrive through some other
//   variable is invisible to it. Green is not proof that no label is ringed.

const FOCUS_ON_LABEL = /\bfocus:|\bFOCUS_RING\b|\bINTERACTIVE\b/;

/** Every `<label …>` opening tag in `src`, with its 1-based line. The tag body
 *  may contain `=>` (arrow functions in a `className` expression), so a `>` only
 *  ends the tag when it is not part of `=>`. */
export function labelTags(src: string): { tag: string; line: number }[] {
  const out: { tag: string; line: number }[] = [];
  const re = /<label\b(?:=>|[^>])*>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) out.push({ tag: m[0], line: src.slice(0, m.index).split("\n").length });
  return out;
}

export function offendingLabels(src: string): number[] {
  return labelTags(src)
    .filter(({ tag }) => FOCUS_ON_LABEL.test(tag) && !/\btabIndex\b/.test(tag))
    .map(({ line }) => line);
}

function sourceFiles(): string[] {
  return readdirSync(__dirname, { recursive: true, encoding: "utf8" })
    .filter((f) => f.endsWith(".tsx") && !f.endsWith(".test.tsx"))
    .map((f) => join(__dirname, f));
}

describe("label focus-ring guard (open-followups §46)", () => {
  it("finds no `focus:` style on any <label> in src/app", () => {
    const files = sourceFiles();
    let scanned = 0;
    const hits: string[] = [];
    for (const file of files) {
      const src = stripComments(readFileSync(file, "utf8"), file);
      scanned += labelTags(src).length;
      for (const line of offendingLabels(src)) hits.push(`${file}:${line}`);
    }
    // Anti-vacuity: the app renders a few hundred labels; a broken scan reads none.
    expect(scanned).toBeGreaterThan(100);
    expect(hits).toEqual([]);
  });

  it("flags the shapes it exists for, and passes the fixes", () => {
    expect(offendingLabels('<label className="focus:ring-2">')).toEqual([1]);
    expect(offendingLabels("<label className={`x ${FOCUS_RING}`}>")).toEqual([1]);
    expect(offendingLabels("<label\n  className={cn(a, INTERACTIVE)}\n>")).toEqual([1]);
    expect(offendingLabels("<label className={f(() => x)} data-x={INTERACTIVE}>")).toEqual([1]);
    expect(offendingLabels('<label className="focus-within:ring-2">')).toEqual([]);
    expect(offendingLabels('<label tabIndex={0} className="focus:ring-2">')).toEqual([]);
    expect(offendingLabels('<input className="focus:ring-2" />')).toEqual([]);
  });
});
