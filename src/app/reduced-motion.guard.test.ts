import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { stripComments } from "../test/strip-comments";

// ---------------------------------------------------------------------------
// Guard (open-followups §332): no motion reaches the app without passing the
// reduced-motion policy.
// ---------------------------------------------------------------------------
//
// The policy is two halves. CSS: globals.css's `@media (prefers-reduced-motion:
// reduce)` block names each animation utility by hand. JS: every smooth scroll
// asks `smoothScrollBehavior()` (reduced-motion.ts). Before this guard, a new
// `animate-bounce`, a `@keyframes` rule or a bare `behavior: "smooth"` got
// nothing, silently.
//
// ★★ THIS IS A STRING CHECK, NOT A BEHAVIOUR CHECK. It proves each animation is
//   NAMED in the block; it cannot prove the rule inside is right, or that the
//   motion is gone on screen. jsdom does not evaluate media queries, so that half
//   stays eye-verify-only.
// ★ CSS TRANSITIONS ARE DELIBERATELY OUT OF SCOPE. `transition-colors` and its
//   relatives animate colour, not position or scale — not the motion WCAG 2.3.3
//   targets. `PRESS`'s 1px `active:` nudge is likewise not animated motion. This
//   is a decision, recorded here so it does not read as an oversight.

function walk(ext: RegExp): string[] {
  return readdirSync(__dirname, { recursive: true, encoding: "utf8" })
    .filter((f) => ext.test(f) && !/\.test\.tsx?$/.test(f))
    .map((f) => join(__dirname, f));
}

const css = readFileSync(join(__dirname, "globals.css"), "utf8");

/** The body of the reduced-motion media block, or "" when there is none. */
function reducedMotionBlock(src: string): string {
  const at = src.indexOf("@media (prefers-reduced-motion: reduce)");
  if (at === -1) return "";
  let depth = 0;
  for (let i = src.indexOf("{", at); i < src.length; i += 1) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}" && (depth -= 1) === 0) return src.slice(at, i + 1);
  }
  return "";
}

/** Every `animate-<name>` utility named in `src`, including arbitrary
 *  `animate-[…]` values and variant-prefixed ones (`motion-safe:animate-x`).
 *  `animate-none` stops motion, so it is not collected. */
export function animationUtilities(src: string): string[] {
  const names = new Set<string>();
  for (const m of src.matchAll(/(?<![\w-])animate-(\[[^\]\s]*\]|[a-z0-9][a-z0-9-]*)/g)) {
    if (m[1] !== "none") names.add(`animate-${m[1]}`);
  }
  return [...names];
}

describe("reduced-motion guard (open-followups §332)", () => {
  const block = reducedMotionBlock(css);

  it("finds the reduced-motion block in globals.css", () => {
    expect(block).toContain(".animate-pulse");
  });

  it("names every animation utility the app uses in the reduced-motion block", () => {
    const used = new Set<string>();
    for (const file of walk(/\.(tsx|ts)$/)) {
      for (const n of animationUtilities(stripComments(readFileSync(file, "utf8"), file))) used.add(n);
    }
    // Anti-vacuity: pulse and spin are in use today; a broken scan finds neither.
    expect([...used]).toEqual(expect.arrayContaining(["animate-pulse", "animate-spin"]));
    const uncovered = [...used].filter((n) => n.startsWith("animate-[") || (!block.includes(`.${n} `) && !block.includes(`.${n}{`)));
    expect(uncovered).toEqual([]);
  });

  it("defines no @keyframes and no raw `animation:` outside the reduced-motion block", () => {
    const outside = css.replace(block, "").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(outside).not.toMatch(/@keyframes|(?<![\w-])animation(?:-name)?\s*:/);
  });

  it("routes every smooth scroll through smoothScrollBehavior()", () => {
    const hits: string[] = [];
    for (const file of walk(/\.(tsx|ts)$/)) {
      if (file.endsWith("reduced-motion.ts")) continue;
      const src = stripComments(readFileSync(file, "utf8"), file);
      if (/behavior\s*:\s*["'`]smooth["'`]/.test(src)) hits.push(file);
    }
    expect(hits).toEqual([]);
  });

  it("collects the shapes it exists for", () => {
    expect(animationUtilities('className="animate-bounce p-2"')).toEqual(["animate-bounce"]);
    expect(animationUtilities("motion-safe:animate-ping")).toEqual(["animate-ping"]);
    expect(animationUtilities("animate-[wiggle_1s_ease-in-out]")).toEqual(["animate-[wiggle_1s_ease-in-out]"]);
    expect(animationUtilities("animate-none data-animate-x")).toEqual([]);
  });
});
