import { beforeAll, describe, it, expect } from "vitest";
import { HELP_ENTRIES } from "./help-content";
import { allNavViews } from "./nav-config";
import type { AppView } from "./nav-config";
import { t, loadI18n, type Lang } from "./i18n";
import { de } from "./i18n.de";
import { helpBodyLabels } from "./help-body-markup";

// ★★★ THIS GATE PROVES STRUCTURE, NOT TRUTH. It proves an entry EXISTS for a
// view and that a marked label RESOLVES. It cannot tell whether a sentence is
// correct: `helpSecAiBody` claimed the Anthropic key "is stored in this
// browser's localStorage" when it is AES-256-GCM encrypted in IndexedDB, and
// that claim passes every assertion in this file. A green run here is NOT
// evidence that help content is trustworthy — same limit as
// `docs:symbols:check`, which proves a name is real and never that a claim
// about it holds.

/** Nav views with no Help entry pointing at them. Slice 3 writes those entries
 *  and empties this list.
 *
 *  ★★ The assertion below is set EQUALITY, not subset. A new gap fails (the
 *  point of a ratchet) AND a CLOSED gap fails until its id is deleted from
 *  here. Equality is what makes the baseline self-draining; a subset check
 *  would let it outlive the gaps and quietly become a permanent exemption — a
 *  defeated gate that reports success.
 *
 *  ★ Ids, never a count: a count lets one gap be swapped for another. */
const KNOWN_UNCOVERED: readonly AppView[] = [
  "projects",
  "portfolio-health",
  "insights",
  "timelog",
  "reports",
  "raid-report",
  "change-report",
  "help",
];

describe("help coverage ratchet", () => {
  it("uncovered nav views match the baseline exactly", () => {
    const covered = new Set<AppView>(HELP_ENTRIES.flatMap((e) => e.relatedViews ?? []));
    // ★ `allNavViews()` flattens nested `children`. A hand-rolled walk over
    // `NAV_GROUPS` items alone sees only half the sidebar — that mistake
    // measured 7 gaps when there are 14, and would have seeded this baseline
    // at half its true size, blessing seven real gaps.
    const uncovered = allNavViews()
      .filter((v) => !covered.has(v))
      .sort();
    expect(uncovered).toEqual([...KNOWN_UNCOVERED].sort());
  });
});

// ★ All three langs, not just EN + DE. `enGB` is `{ ...enUS }` with zero
// overrides today, so it is byte-identical — but walking it costs nothing and
// survives the day someone adds a GB spelling.
const LANGS: readonly Lang[] = ["en-US", "en-GB", "de"];

describe("help marker resolution", () => {
  // ★★ The DE dictionary is LAZY. Without this await, `t("de", k)` silently
  // falls back to en-US and the DE assertion below passes by testing English
  // twice — vacuous, and it would hide exactly the drift it exists to catch.
  beforeAll(async () => {
    await loadI18n("de");
  });

  const valuesFor = (lang: Lang): Set<string> =>
    new Set((Object.keys(de) as (keyof typeof de)[]).map((k) => t(lang, k).trim()));

  it.each(LANGS)("every [[label]] resolves to a real UI string in %s", (lang) => {
    const known = valuesFor(lang);
    const unresolved: string[] = [];
    for (const e of HELP_ENTRIES) {
      // ★★ BOTH prose keys, not just the body. A primer is ordinary help prose
      // that happens to render at one reading level, so it can carry markers
      // like any body — and walking only `bodyKey` would leave twelve strings
      // entirely ungated while this file went on reporting success over
      // content it had never read.
      for (const key of [e.bodyKey, e.primerKey]) {
        if (!key) continue;
        for (const label of helpBodyLabels(t(lang, key))) {
          if (!known.has(label.trim())) unresolved.push(`${e.id}: [[${label}]]`);
        }
      }
    }
    expect(unresolved).toEqual([]);
  });
});
