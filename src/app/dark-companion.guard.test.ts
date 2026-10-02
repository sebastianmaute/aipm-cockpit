import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { stripComments } from "../test/strip-comments";

// ---------------------------------------------------------------------------
// Guard (open-followups §40): a ONE-MODE colour token used as text needs a
// dark companion AT THE SAME VARIANT LEVEL.
// ---------------------------------------------------------------------------
//
// `--ui-dark-blue` is a near-black navy in every dark scheme (~1.1–1.3:1 on
// `--surface`), and `--ui-purple` sits under 4.5:1 there. So `text-ui-dark-blue`
// and `text-ui-purple` need a `dark:` companion whose VALUE differs. No other
// gate can see this: axe scans the resting state only, so a `hover:` arm is
// invisible to it by construction, and three hand sweeps of this class each
// undercounted (§40 records how).
//
// ★★ THE COMPANION MUST SIT AT THE SAME VARIANT LEVEL. `dark:text-x` does NOT
//   survive `hover:` — `:where()` gives the dark variant zero specificity, so
//   `hover:text-ui-dark-blue` (0,2,0) beats `dark:text-x` (0,1,0) whatever the
//   source order. Only `dark:hover:text-*` fixes a hover arm; the same holds for
//   `group-hover:`, `active:` and an arbitrary variant like `[&_a]:`.
// ★ A companion that re-asserts the SAME token (`dark:text-ui-dark-blue`) is
//   not one — checked by value, not presence.
// ★ The companion is looked for on the SAME LINE, which is where every class
//   string in this repo keeps its pair; a pair split across lines reads as a
//   violation here — keep them together.
//
// Exempt, each a bucket §40 CHECKED rather than assumed:
//   • a checkbox / radio (`h-4 w-4` / `h-3 w-3` control): Tailwind Forms uses
//     `text-*` as the CHECKED FILL, which sits on its own fill, not on a surface;
//   • text on a SOLID `bg-ui-green` (navy on green passes AA in both modes —
//     the background moves with the scheme). A TINT (`bg-ui-green/15`) does not
//     count;
//   • `focus:` paired with `focus:bg-ui-green` (the skip link — both colours
//     forced, so the pair is mode-independent).

const TOKENS = ["ui-dark-blue", "ui-purple"] as const;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

const VARIANTS = String.raw`((?:[a-z-]+:|\[&_[a-z]+\]:)*)`;

/** Every uncompanioned use of `token` on `line`, as its variant prefix. */
export function missingCompanions(line: string, token: string): string[] {
  const use = new RegExp(String.raw`(?<![\w:\-\[\]&])` + VARIANTS + `text-${token}(?![\\w/-])`, "g");
  const out: string[] = [];
  for (const m of line.matchAll(use)) {
    const variant = m[1] ?? "";
    if (variant.startsWith("dark:")) continue;
    if (/\bh-[34] w-[34]\b/.test(line)) continue;
    if (/(?:^|[\s"'`])(?:focus:)?bg-ui-green(?![\w/-])/.test(line)) continue;
    const esc = variant.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); // every regex metacharacter, the backslash included
    const companion = new RegExp(String.raw`dark:` + esc + String.raw`text-(?!` + token + String.raw`(?![\w/-]))[\w\-[\]/]+`);
    if (!companion.test(line)) out.push(variant);
  }
  return out;
}

describe("dark companions for one-mode text tokens (§40)", () => {
  const files = sourceFiles(join(process.cwd(), "src", "app"));

  it("scans a real population (a scan that reads nothing passes everything)", () => {
    let uses = 0;
    for (const f of files) {
      const src = stripComments(readFileSync(f, "utf8"));
      for (const token of TOKENS) uses += (src.match(new RegExp(`text-${token}(?![\\w/-])`, "g")) ?? []).length;
    }
    expect(uses).toBeGreaterThan(100);
  });

  it("finds no uncompanioned use", () => {
    const offenders: string[] = [];
    for (const f of files) {
      const lines = stripComments(readFileSync(f, "utf8")).split("\n");
      lines.forEach((line, i) => {
        for (const token of TOKENS) {
          for (const v of missingCompanions(line, token)) offenders.push(`${f.slice(process.cwd().length + 1)}:${i + 1} ${v}text-${token}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });

  it("checks the companion's VARIANT and VALUE, not its presence", () => {
    expect(missingCompanions('"text-ui-dark-blue dark:text-ui-light-grey"', "ui-dark-blue")).toEqual([]);
    // A base companion does not cover a hover arm …
    expect(missingCompanions('"hover:text-ui-dark-blue dark:text-ui-light-grey"', "ui-dark-blue")).toEqual(["hover:"]);
    expect(missingCompanions('"hover:text-ui-dark-blue dark:hover:text-ui-light-grey"', "ui-dark-blue")).toEqual([]);
    // … re-asserting the same token is not a companion …
    expect(missingCompanions('"text-ui-dark-blue dark:text-ui-dark-blue"', "ui-dark-blue")).toEqual([""]);
    // … and an arbitrary variant needs its own.
    expect(missingCompanions('"[&_a]:text-ui-dark-blue"', "ui-dark-blue")).toEqual(["[&_a]:"]);
    expect(missingCompanions('"[&_a]:text-ui-dark-blue dark:[&_a]:text-ui-light-grey"', "ui-dark-blue")).toEqual([]);
    // `-strong` is a different, AA-derived token.
    expect(missingCompanions('"text-ui-purple-strong"', "ui-purple")).toEqual([]);
    // A tint is not the solid green that exempts.
    expect(missingCompanions('"bg-ui-green/15 text-ui-dark-blue"', "ui-dark-blue")).toEqual([""]);
  });
});
