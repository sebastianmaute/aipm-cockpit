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

/** Nav views with no Help entry pointing at them. Slice 3 emptied this list —
 *  every nav view is now covered, so the assertion below reads "nothing is
 *  uncovered" and any regression fails on the next run.
 *
 *  ★★ The assertion below is set EQUALITY, not subset. A new gap fails (the
 *  point of a ratchet) AND a CLOSED gap fails until its id is deleted from
 *  here. Equality is what makes the baseline self-draining; a subset check
 *  would let it outlive the gaps and quietly become a permanent exemption — a
 *  defeated gate that reports success.
 *
 *  ★ Ids, never a count: a count lets one gap be swapped for another. */
const KNOWN_UNCOVERED: readonly AppView[] = [];

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

  // ★★ `tsc` proves a DE key EXISTS (TranslationKey parity) — it cannot prove
  // anyone translated it. An entry added with the English body pasted into
  // `i18n.de.ts` typechecks, renders, and reads as German to every gate in the
  // repo. This is the only assertion that catches it.
  //
  // ★★★ It CANNOT be vacuous through the lazy-dictionary trap, which is the
  // usual way a DE assertion rots: without the `loadI18n("de")` above, `t("de",
  // k)` falls back to en-US and every pair becomes IDENTICAL — so the omission
  // fails this test loudly instead of quietly passing it. That is the opposite
  // polarity from the marker check below, where the same omission would pass by
  // testing English twice.
  // ★★ TITLES ARE INCLUDED, via a self-draining allow-list rather than a blanket
  // exemption. Exactly two titles are legitimately identical in both languages —
  // `helpSecTabsTitle` ("Tabs") and `helpConceptStakeholderTitle`
  // ("Stakeholder"). An earlier revision excluded ALL titles from the identity
  // half on the grounds that an allow-list "outlives its reason"; that reasoning
  // was wrong on its own file's evidence, because `KNOWN_UNCOVERED` thirty lines
  // above is an allow-list made safe by exactly the mechanism used here — set
  // EQUALITY, so translating one of these two fails until its key is removed.
  // The blanket exclusion left a real hole: a title left in English passed,
  // and titles are the most visible strings in the Help window.
  const TITLES_IDENTICAL_IN_BOTH_LANGS: readonly string[] = [
    "helpSecTabsTitle",
    "helpConceptStakeholderTitle",
  ];

  it("every entry's prose is actually translated, not copied from English", () => {
    // ★ Floor first: both loops below iterate `HELP_ENTRIES`, so an empty or
    // mocked backbone would satisfy every assertion by running none of them.
    expect(HELP_ENTRIES.length).toBeGreaterThan(50);

    const identical: string[] = [];
    for (const e of HELP_ENTRIES) {
      for (const key of [e.titleKey, e.bodyKey, e.primerKey]) {
        if (!key) continue;
        const enText = t("en-US", key).trim();
        const deText = t("de", key).trim();
        expect(enText, `${e.id}: ${key} is empty in en-US`).not.toBe("");
        expect(deText, `${e.id}: ${key} is empty in de`).not.toBe("");
        if (enText === deText) identical.push(key);
      }
    }
    expect([...new Set(identical)].sort()).toEqual([...TITLES_IDENTICAL_IN_BOTH_LANGS].sort());
  });

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
