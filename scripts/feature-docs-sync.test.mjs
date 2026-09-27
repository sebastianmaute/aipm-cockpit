import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseFeatureGuide, VALID_VIEWS } from "./gen-operating-guide.mjs";

// Coverage check between the two feature lists (open-followups §485).
//
// `lib/app-feature-guide.md` is the per-view guide the AI assistant reads;
// `docs/features.md` is the user-facing table. Neither is generated from the
// other, so a view documented for the assistant can be missing from the list
// users read. This test forces a decision: every guide section must appear in
// SECTION_TO_ROWS below, and every row named there must exist in features.md.
//
// ★★ WHAT IT CANNOT CATCH: a false claim INSIDE a row. It proves only that a
// row with that name exists, never that its text still matches the product.
// Claim-level drift (a dead anchor, a wrong count, a feature that changed)
// passes this test and still needs a manual audit — every drift the 2026-09-13
// audit found was of that kind, and this test would have caught none of them.
//
// Names are matched explicitly rather than by title because the two files are
// shaped differently: Open Points is "Task management" (plus two siblings),
// Calendar and Settings each span several rows.

// ★ `import.meta.url` is NOT a file: URL under vitest; resolve from cwd like
// the sibling script tests.
const GUIDE = path.join(process.cwd(), "lib/app-feature-guide.md");
const FEATURES = path.join(process.cwd(), "docs/features.md");

/** The app-wide Overview section describes the whole app, not one feature. */
const OVERVIEW = "Overview";

/** Guide section title → the `docs/features.md` row names it corresponds to. */
const SECTION_TO_ROWS = {
  "Open Points": ["Task management", "Task dependencies", "Groups & labels"],
  "Action Center": ["Action Center"],
  "AI assistant": ["AI assistant (Claude)"],
  Dashboard: ["Dashboard"],
  Trends: ["Baseline / variance trends (Turso)"],
  Reports: ["Reports"],
  RAID: ["RAID register"],
  Changes: ["Change Log"],
  "Milestones & Gantt": ["Milestones", "Gantt chart"],
  Stakeholders: ["Stakeholder register"],
  "Steering committee": ["Steering committee"],
  Calendar: ["Resource planner & address book", "Timezones"],
  Settings: ["Layout & theme", "Feature modes", "Encrypted secrets at rest"],
  Budget: ["Budget planner"],
  "Resources & capacity": ["Resource planner & address book"],
  Knowledge: ["Knowledge tab"],
  Documents: ["Documents"],
  Insights: ["Insights"],
  "Time bookings": ["Timelog time bookings"],
  "Portfolio health": ["Portfolio health (Turso)"],
  "Version history": ["Version history (Turso)"],
  "Activity log": ["Activity log"],
};

/** Section titles as written in the guide, via the generator's own parser. */
function guideSectionTitles() {
  const guides = parseFeatureGuide(readFileSync(GUIDE, "utf8"), VALID_VIEWS);
  return guides.map((g) => (g.id === "builtin-app-overview" ? OVERVIEW : g.name.replace(/^Feature: /, "")));
}

/** First-column cells of the features table, header and separator excluded. */
function featureRowNames() {
  return readFileSync(FEATURES, "utf8")
    .split(/\r?\n/)
    .filter((line) => line.startsWith("| "))
    .map((line) => line.split("|")[1].trim())
    .filter((name) => name !== "Feature" && !/^-+$/.test(name));
}

describe("docs/features.md covers every section of lib/app-feature-guide.md", () => {
  const titles = guideSectionTitles();
  const rows = featureRowNames();

  it("parses both files (anti-vacuity)", () => {
    // An empty parse would pass every assertion below.
    expect(titles).toContain(OVERVIEW);
    expect(titles.length).toBeGreaterThan(1);
    expect(rows.length).toBeGreaterThan(0);
  });

  it("maps every guide section to at least one features.md row", () => {
    const unmapped = titles.filter((t) => t !== OVERVIEW && !(t in SECTION_TO_ROWS));
    expect(unmapped).toEqual([]);
  });

  it("has no map entry for a section the guide no longer has", () => {
    const stale = Object.keys(SECTION_TO_ROWS).filter((t) => !titles.includes(t));
    expect(stale).toEqual([]);
  });

  it("names only rows that exist in features.md", () => {
    const missing = Object.entries(SECTION_TO_ROWS).flatMap(([section, names]) =>
      names.filter((n) => !rows.includes(n)).map((n) => `${section} → ${n}`),
    );
    expect(missing).toEqual([]);
  });
});
