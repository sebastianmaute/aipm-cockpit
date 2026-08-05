import { describe, it, expect } from "vitest";
import { HELP_ENTRIES } from "./help-content";
import { allNavViews } from "./nav-config";
import type { AppView } from "./nav-config";

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
  "directory",
  "calendar",
  "manage-roles",
  "stakeholder-map",
  "timelog",
  "reports",
  "raid-report",
  "change-report",
  "activity",
  "history",
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
