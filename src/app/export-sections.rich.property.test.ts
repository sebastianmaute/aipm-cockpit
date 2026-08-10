// @vitest-environment jsdom
//
// src/app/export-sections.rich.property.test.ts
//
// Properties over export-sections.ts's rich-cell contract.
//
// `richCell(value, column, rich)` is PRIVATE, so everything here reaches it
// through the public `buildExportSections`. The contract has three halves and a
// property for each:
//
//   1. a column IN the entity's rich set is projected with
//      descriptionTextWithBreaks — the BREAK-PRESERVING projection. Swapping in
//      descriptionText (the collapsing one, correct for search and AI digests)
//      is the exact defect that shipped: a three-paragraph description arrived
//      in the export as one run-on line, and every downstream renderer maps that
//      "\n" to its own primitive (<br> for HTML/PDF, <w:br/> for DOCX, one <a:p>
//      per line for PPTX), so losing it fuses text in ALL of them silently.
//   2. a projected column carries no markup.
//   3. a column NOT in the set is passed through byte-identically. This is the
//      CONTROL — without it a richCell that projected every column would satisfy
//      1 and 2 and still be wrong.
//
// ★★ Rich values must OPEN with a tag the sink recognises to be read as HTML at
// all. These cells go through descriptionTextWithBreaks, whose "projection" sink
// derives that test from DOCUMENT_ALLOWED_TAGS (see html-start.ts), so a value
// opening with <h3>, <table> or <span> is treated as LEGACY PLAIN TEXT, escaped by
// plainToHtml, and the projection then decodes the escapes back — so the cell
// legitimately contains a literal "<h3>". That is the documented storage rule,
// not a richCell defect, so the generators below keep those tags in a NON-
// leading position where they exercise the block-boundary path as intended.
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  buildExportSections,
  TASK_RICH_COLUMNS,
  RAID_RICH_COLUMNS,
  MILESTONE_RICH_COLUMNS,
  CHANGE_RICH_COLUMNS,
} from "./export-sections";
import { emptyWorkspace } from "./workspace";
import { EXPORT_SECTION_KEYS } from "./settings-types";
import type { ExportConfig, ExportSectionKey } from "./settings-types";
import type { Workspace } from "./storage";
import type { Task, RaidItem, Milestone, ChangeItem } from "./types";

// ---------------------------------------------------------------------------
// Fixtures — same minimal shapes export-sections.test.ts uses.
// ---------------------------------------------------------------------------

function makeTask(id: number): Task {
  return {
    id,
    taskName: `Task ${id}`,
    assignee: "Alice",
    assigneeEmail: "alice@example.com",
    startDate: "2025-01-01",
    dueDate: "2025-06-01",
    lastUpdateDate: "2025-03-01",
    status: "To Do",
    priority: "Medium",
    blockers: "",
    description: "",
    completedDate: undefined,
    inquiriesSent: 0,
    group: undefined,
    labels: [],
    dependencies: [],
  };
}

function makeRaidItem(id: number): RaidItem {
  return {
    id,
    category: "R",
    title: `Risk ${id}`,
    description: "",
    severity: "Medium",
    probability: 3,
    impact: 3,
    status: "Open",
    owner: "Bob",
    ownerEmail: "bob@example.com",
    mitigation: "",
    linkedTaskIds: [],
    raisedDate: "2025-01-01",
    causedByRaidIds: [],
    stakeholderIds: [],
  };
}

function makeMilestone(id: number): Milestone {
  return {
    id,
    name: `Milestone ${id}`,
    date: "2025-12-31",
    description: "",
    linkedTaskIds: [],
  };
}

function makeChange(id: number): ChangeItem {
  return {
    id,
    title: `Change ${id}`,
    type: "Scope",
    status: "Proposed",
    impact: "Medium",
    impactDescription: "",
    scheduleImpactDays: 0,
    costImpact: 0,
    requestedBy: "PM",
    raisedDate: "2025-01-01",
    decisionBy: "",
    decisionDate: "",
    resolutionNotes: "",
    description: "",
    linkedTaskIds: [],
    linkedRaidIds: [],
    stakeholderIds: [],
  };
}

/** Every section enabled, so a property never fails merely because the config
 *  gated the section it wanted to look at. */
const ALL_ON: ExportConfig = Object.fromEntries(
  EXPORT_SECTION_KEYS.map((k) => [k, true]),
) as ExportConfig;

type RichSection = Extract<ExportSectionKey, "tasks" | "raid" | "milestones" | "changes">;

function withField<T extends object>(base: T, column: string, value: string): T {
  return { ...base, [column]: value } as T;
}

/** A workspace holding exactly one entity of `section`, with `column` set to
 *  `value` and nothing else populated. */
function workspaceWithField(section: RichSection, column: string, value: string): Workspace {
  const base = emptyWorkspace();
  switch (section) {
    case "tasks":
      return { ...base, tasks: [withField(makeTask(1), column, value)] };
    case "raid":
      return { ...base, raid: [withField(makeRaidItem(1), column, value)] };
    case "milestones":
      return { ...base, milestones: [withField(makeMilestone(1), column, value)] };
    case "changes":
      return { ...base, changes: [withField(makeChange(1), column, value)] };
  }
}

/** The single cell at (section, column) of the first row. Fails loudly rather
 *  than returning "" when the section or column is missing — a silent "" would
 *  make every string assertion below vacuous. */
function cellFor(ws: Workspace, section: ExportSectionKey, column: string): string {
  const sections = buildExportSections(ws, ALL_ON, "en-US");
  const found = sections.find((s) => s.key === section);
  expect(found, `section ${section} missing`).toBeDefined();
  const idx = found!.columns.indexOf(column);
  expect(idx, `column ${column} missing from ${section}`).toBeGreaterThanOrEqual(0);
  expect(found!.rows.length).toBeGreaterThan(0);
  return String(found!.rows[0][idx]);
}

// ---------------------------------------------------------------------------
// Generators
//
// ★ Fixed lowercase alphabet on purpose. A free fc.string() body could contain
// "<", "&", whitespace or an entity, all of which the projection legitimately
// rewrites — the property would then be asserting the projection's whitespace
// and entity rules rather than the boundary rule it exists to pin, and would
// fail for reasons that have nothing to do with richCell.
// ---------------------------------------------------------------------------

const LETTERS = "abcdefghijklmnopqrstuvwxyz".split("");
const wordArb = fc
  .array(fc.constantFrom(...LETTERS), { minLength: 1, maxLength: 8 })
  .map((cs) => cs.join(""));

/** 2..5 paragraph texts, made pairwise distinct by an index suffix so a fused
 *  concatenation can never coincide with a legitimate substring. */
const paragraphTextsArb = fc
  .array(wordArb, { minLength: 2, maxLength: 5 })
  .map((ws) => ws.map((w, i) => `${w}${i}`));

/** The three stored shapes that carry a block boundary. `<br>` is not optional
 *  colour: descriptionHtml turns EVERY legacy multi-line value into
 *  "<p>line one<br>line two</p>", so it is the most common shape in real data. */
const BLOCK_SHAPES = ["paragraphs", "brs", "mixed"] as const;
type BlockShape = (typeof BLOCK_SHAPES)[number];

function buildBlockHtml(texts: readonly string[], shape: BlockShape): string {
  if (shape === "paragraphs") return texts.map((t) => `<p>${t}</p>`).join("");
  if (shape === "brs") return `<p>${texts.join("<br>")}</p>`;
  // A paragraph break AND a <br> break in one value — both must survive, and
  // the doubled boundary at "</p><p>" must collapse to ONE newline, not two.
  const [first, ...rest] = texts;
  return `<p>${first}<br>${rest[0]}</p>${rest
    .slice(1)
    .map((t) => `<p>${t}</p>`)
    .join("")}`;
}

/** Assorted inline + block markup. Each shape OPENS with a tag the projection
 *  sink recognises (see the file header) so the value is recognised as HTML
 *  rather than escaped. */
const MARKUP_SHAPES: ReadonlyArray<(a: string, b: string) => string> = [
  (a, b) => `<p><strong>${a}</strong> and <em>${b}</em></p>`,
  (a, b) => `<ul><li>${a}</li><li>${b}</li></ul>`,
  (a, b) => `<ol><li>${a}</li><li>${b}</li></ol>`,
  (a, b) => `<p><span style="color:red">${a}</span><br><u>${b}</u></p>`,
  (a, b) => `<p>${a}</p><blockquote><p>${b}</p></blockquote>`,
  (a, b) => `<p><a href="https://example.com/x?y=1">${a}</a></p><h3>${b}</h3>`,
  (a, b) => `<p>${a}</p><table><tr><td>${b}</td></tr></table>`,
];

const richSectionArb = fc.constantFrom<RichSection>("tasks", "raid", "milestones", "changes");

// Every (section, column) pair the four EXPORTED sets name — derived, never
// hardcoded, so a new rich field added to a set is covered the moment it lands
// and an unwired one fails here.
const RICH_TARGETS: ReadonlyArray<{ section: RichSection; column: string }> = [
  ...[...TASK_RICH_COLUMNS].map((column) => ({ section: "tasks" as const, column })),
  ...[...RAID_RICH_COLUMNS].map((column) => ({ section: "raid" as const, column })),
  ...[...MILESTONE_RICH_COLUMNS].map((column) => ({ section: "milestones" as const, column })),
  ...[...CHANGE_RICH_COLUMNS].map((column) => ({ section: "changes" as const, column })),
];

/** One rich column per entity, enough to exercise tasks AND raid (raid carries
 *  TWO rich columns, so it catches a per-column bug tasks structurally cannot). */
const FIRST_RICH_COLUMN: Readonly<Record<RichSection, string>> = {
  tasks: "description",
  raid: "description",
  milestones: "description",
  changes: "description",
};

// ---------------------------------------------------------------------------
// 1. THE property — block boundaries survive into the exported cell.
// ---------------------------------------------------------------------------

describe("rich export cells preserve block boundaries", () => {
  it("renders N paragraphs as N-1 newlines, never as fused text", () => {
    fc.assert(
      fc.property(
        richSectionArb,
        paragraphTextsArb,
        fc.constantFrom(...BLOCK_SHAPES),
        (section, texts, shape) => {
          const column = FIRST_RICH_COLUMN[section];
          const html = buildBlockHtml(texts, shape);
          const cell = cellFor(workspaceWithField(section, column, html), section, column);

          // Exact form: this is what a renderer maps to <br> / <w:br/> / <a:p>.
          expect(cell).toBe(texts.join("\n"));
          expect(cell.split("\n")).toHaveLength(texts.length);
          // The shipped defect, stated directly: adjacent paragraphs fused.
          for (let i = 0; i + 1 < texts.length; i += 1) {
            expect(cell).not.toContain(`${texts[i]}${texts[i + 1]}`);
          }
        },
      ),
      { numRuns: 25 },
    );
  });

  it("preserves boundaries in EVERY rich column of EVERY entity, not just the first", () => {
    // RAID's `mitigation` and Change's `impactDescription`/`resolutionNotes`
    // ride the same set as their `description`; a per-column wiring slip is
    // invisible to the property above.
    fc.assert(
      fc.property(fc.constantFrom(...RICH_TARGETS), paragraphTextsArb, (target, texts) => {
        const html = texts.map((t) => `<p>${t}</p>`).join("");
        const cell = cellFor(
          workspaceWithField(target.section, target.column, html),
          target.section,
          target.column,
        );
        expect(cell).toBe(texts.join("\n"));
      }),
      { numRuns: 25 },
    );
  });
});

// ---------------------------------------------------------------------------
// 2. No markup reaches an export cell.
// ---------------------------------------------------------------------------

describe("rich export cells carry no markup", () => {
  it("strips every tag while keeping the text", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...RICH_TARGETS),
        wordArb,
        wordArb,
        fc.integer({ min: 0, max: MARKUP_SHAPES.length - 1 }),
        (target, a, b, shapeIdx) => {
          const wordA = `${a}1`;
          const wordB = `${b}2`;
          const html = MARKUP_SHAPES[shapeIdx](wordA, wordB);
          const cell = cellFor(
            workspaceWithField(target.section, target.column, html),
            target.section,
            target.column,
          );

          expect(cell).not.toContain("<");
          expect(cell).not.toContain(">");
          // Anti-vacuity: an implementation that emitted "" would pass the two
          // negative assertions above and be catastrophically wrong.
          expect(cell).toContain(wordA);
          expect(cell).toContain(wordB);
        },
      ),
      { numRuns: 25 },
    );
  });
});

// ---------------------------------------------------------------------------
// 3. CONTROL — a column outside the rich set is passed through verbatim.
// ---------------------------------------------------------------------------

describe("non-rich export cells are byte-identical to the stored value", () => {
  // Free-text columns that are NOT in their entity's rich set. Asserted against
  // the exported sets rather than assumed, so promoting one to rich fails here
  // loudly instead of silently weakening the control.
  const PLAIN_TARGETS: ReadonlyArray<{ section: RichSection; column: string }> = [
    { section: "tasks", column: "blockers" },
    { section: "tasks", column: "taskName" },
    { section: "raid", column: "title" },
    { section: "raid", column: "owner" },
    { section: "milestones", column: "name" },
    { section: "changes", column: "requestedBy" },
  ];

  const RICH_BY_SECTION: Readonly<Record<RichSection, ReadonlySet<string>>> = {
    tasks: TASK_RICH_COLUMNS,
    raid: RAID_RICH_COLUMNS,
    milestones: MILESTONE_RICH_COLUMNS,
    changes: CHANGE_RICH_COLUMNS,
  };

  it("keeps the control columns genuinely outside the rich sets", () => {
    for (const { section, column } of PLAIN_TARGETS) {
      expect(RICH_BY_SECTION[section].has(column)).toBe(false);
    }
  });

  it("passes HTML-looking text through untouched", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...PLAIN_TARGETS),
        paragraphTextsArb,
        fc.constantFrom(...BLOCK_SHAPES),
        (target, texts, shape) => {
          // Deliberately the SAME shapes the rich properties use: if richCell
          // projected every column, this value would come back as "a\nb".
          const stored = buildBlockHtml(texts, shape);
          const cell = cellFor(
            workspaceWithField(target.section, target.column, stored),
            target.section,
            target.column,
          );
          expect(cell).toBe(stored);
        },
      ),
      { numRuns: 25 },
    );
  });
});

// ---------------------------------------------------------------------------
// 4. Totality — buildExportSections never throws, and every section it returns
//    is structurally well-formed.
// ---------------------------------------------------------------------------

const junkRichArb = fc.oneof(
  fc.constant(""),
  fc.string({ maxLength: 40 }),
  wordArb.map((w) => `<p>${w}</p>`),
  wordArb.map((w) => `<p>${w}`), // unclosed
  wordArb.map((w) => `${w} < ${w} > ${w}`), // literal angle brackets, not markup
  wordArb.map((w) => `<p>${w} &amp;lt; ${w} &#8212; ${w}&nbsp;</p>`),
  wordArb.map((w) => `${w}\nsecond line\n\nthird`), // legacy plain multi-line
  fc.constant("<p></p>"),
  fc.constant("<p><br></p>"),
);

const cfgArb: fc.Arbitrary<ExportConfig> = fc
  .array(fc.boolean(), {
    minLength: EXPORT_SECTION_KEYS.length,
    maxLength: EXPORT_SECTION_KEYS.length,
  })
  .map(
    (flags) =>
      Object.fromEntries(EXPORT_SECTION_KEYS.map((k, i) => [k, flags[i]])) as ExportConfig,
  );

const messyWorkspaceArb: fc.Arbitrary<Workspace> = fc
  .record({
    taskDescriptions: fc.array(junkRichArb, { maxLength: 3 }),
    raidPairs: fc.array(fc.tuple(junkRichArb, junkRichArb), { maxLength: 3 }),
    milestoneDescriptions: fc.array(junkRichArb, { maxLength: 3 }),
    changeTriples: fc.array(fc.tuple(junkRichArb, junkRichArb, junkRichArb), { maxLength: 3 }),
  })
  .map(({ taskDescriptions, raidPairs, milestoneDescriptions, changeTriples }) => ({
    ...emptyWorkspace(),
    tasks: taskDescriptions.map((d, i) => ({ ...makeTask(i + 1), description: d })),
    raid: raidPairs.map(([d, m], i) => ({
      ...makeRaidItem(i + 1),
      description: d,
      mitigation: m,
    })),
    milestones: milestoneDescriptions.map((d, i) => ({
      ...makeMilestone(i + 1),
      description: d,
    })),
    changes: changeTriples.map(([d, imp, res], i) => ({
      ...makeChange(i + 1),
      description: d,
      impactDescription: imp,
      resolutionNotes: res,
    })),
  }));

describe("buildExportSections is total", () => {
  it("never throws and returns rectangular sections of string|number cells", () => {
    let sectionsSeen = 0;
    let cellsSeen = 0;

    fc.assert(
      fc.property(messyWorkspaceArb, cfgArb, (ws, cfg) => {
        const sections = buildExportSections(ws, cfg, "en-US");
        sectionsSeen += sections.length;
        for (const section of sections) {
          expect(cfg[section.key]).toBe(true);
          for (const row of section.rows) {
            // Rectangular: every renderer indexes rows by column position, so a
            // ragged row silently shifts data into the wrong column.
            expect(row).toHaveLength(section.columns.length);
            for (const cell of row) {
              expect(["string", "number"]).toContain(typeof cell);
              cellsSeen += 1;
            }
          }
        }
      }),
      { numRuns: 25 },
    );

    // Anti-vacuity: an all-false config or an all-empty workspace on every run
    // would make the loop body above execute zero times and pass regardless.
    expect(sectionsSeen).toBeGreaterThan(0);
    expect(cellsSeen).toBeGreaterThan(0);
  });
});
