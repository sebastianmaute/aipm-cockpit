// src/app/codec-roundtrip.property.test.ts
//
// Round-trip PROPERTIES for the CSV and Markdown workspace codecs.
//
// Why this exists: `golden-workspace.test.ts` pins the codecs' exact output
// BYTES, but against exactly ONE input (`sample-workspace-small.json`). It
// therefore says nothing about the input SPACE — a value carrying the codec's
// own delimiters is simply not in the fixture. `decode(encode(ws)) === ws` is
// the property a golden structurally cannot express. Two real defects fell out
// of writing it; both are at the bottom of this file, kept as the properties
// they should satisfy and skipped rather than softened into passing.
//
// Scope, deliberately narrow (depth over breadth): TASKS only, and within a
// task only the five fields whose CSV/MD decode is the IDENTITY on the parsed
// cell string — `taskName`, `assignee`, `assigneeEmail`, `blockers`,
// `description` (each is `obj.X ?? ""` in `buildTaskFromObj`). Every other task
// field is held at a fixed valid value by the arbitrary, so a failure here can
// only be a codec-layer defect, never a sanitizer decision. The full list of
// what is excluded and why is in EXCLUSIONS below.
//
// Runs at `{ numRuns: 20 }` everywhere: a whole-workspace encode+decode per
// case is expensive and this repo's property suites are its load-sensitive
// flake source. ★ Every property here was ALSO run once at numRuns 1500 while
// being written — that is how the second defect was found (20 runs missed it on
// the first seed). Re-stress after changing the alphabet.

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { workspaceToCsv, csvToWorkspace } from "./csv-codecs";
import { workspaceToMarkdown, markdownToWorkspace } from "./markdown-codecs";
import { emptyWorkspace } from "./workspace";
import type { Task } from "./types";

/*
 * EXCLUSIONS — task fields NOT asserted to round-trip, with the reason. Every
 * one was read out of the decoder, not guessed.
 *
 * (a) `startDate` / `createdDate` / `completedDate` / `jiraKey` /
 *     `jiraIssueType` / `lastSyncedAt` / `localModifiedAt` / `outlookEventId`
 *     — decoded as `obj.X || undefined`, so "" and undefined are the SAME
 *     stored value. Round-trip is exact only modulo that collapse; asserting
 *     it would test `||`, not the codec.
 * (b) `group` — `sanitizeGroup` trims and clips to GROUP_MAX (100).
 * (c) `labels` — `sanitizeLabels` replaces [|,\r\n\t] with a space, trims,
 *     drops empties, dedupes case-insensitively and clips to LABEL_MAX (50).
 *     Both (b) and (c) are SANITIZER behaviour, not codec behaviour.
 * (d) `dependencies` — `dropDanglingDependencies` runs over the decoded set,
 *     so the result depends on which OTHER rows survived. Held at [].
 * (e) `noteLog` / `knowledgeLinks` — JSON-in-cell via encode/decodeNoteLog and
 *     encode/decodeKnowledgeLinks; their own codecs, not these. Held absent.
 * (f) `priority` / `status` — held at valid constants so `migrateTask`
 *     short-circuits. A generated invalid status would be BACKFILLED, which is
 *     load-path repair rather than a round-trip.
 * (g) `inquiriesSent` / `originalEstimateMinutes` / `timeSpentMinutes` —
 *     numeric coercion (`sanitizeOptionalMinutes` drops non-integers and
 *     negatives). Held at 0 / absent.
 * (h) `id` IS asserted (it is the row key) but is generated as a small unique
 *     positive integer, since `buildTaskFromObj` drops any row without one.
 *
 * Beyond the field level, each codec applies normalisation to a cell's TEXT,
 * and those are asserted rather than excluded:
 *   CSV      — a bare LF becomes CRLF (see `csvNewlines`).
 *   Markdown — cell trimming, CRLF collapse and literal `<br>` absorption
 *              (each pinned individually in its own describe block below).
 */

// --- hostile string alphabet ----------------------------------------------

/** Chunks chosen for what they mean TO A CODEC, not for coverage of Unicode:
 *  the CSV delimiter and its escape, the Markdown delimiter and its escape,
 *  every newline flavour, markdown syntax leaders, a formula-injection prefix,
 *  whitespace at the edges, and an astral pair (two UTF-16 code units, which
 *  is what a naive index-based splitter would cut in half). */
const HOSTILE_CHUNKS = [
  "",
  "a",
  "b c",
  ",",
  ",,",
  '"',
  '""',
  '"quoted"',
  "'",
  "\n",
  "\r\n",
  "\r",
  "|",
  "||",
  "\\",
  "\\\\",
  "\\|",
  "<br>",
  "<br/>",
  "#",
  "# ",
  "*",
  "**bold**",
  "_",
  "`",
  "```",
  "  ",
  "\t",
  "=SUM(A1)",
  "+1",
  "-x",
  "@here",
  "ä ö ü ß",
  "日本語",
  "\u{1F600}",
  "\u{1F1E9}\u{1F1EA}",
];

const hostileString = fc
  .array(fc.constantFrom(...HOSTILE_CHUNKS), { maxLength: 6 })
  .map((parts) => parts.join(""));

/** A `fc.string()` alongside the curated chunks so the property is not limited
 *  to characters someone already thought of. */
const anyString = fc.oneof(
  { weight: 4, arbitrary: hostileString },
  { weight: 1, arbitrary: fc.string({ maxLength: 12 }) },
);

// --- the workspace arbitrary ----------------------------------------------

type VariedFields = {
  taskName: string;
  assignee: string;
  assigneeEmail: string;
  blockers: string;
  description: string;
};

function makeTask(id: number, f: VariedFields): Task {
  return {
    id,
    taskName: f.taskName,
    assignee: f.assignee,
    assigneeEmail: f.assigneeEmail,
    startDate: "2026-01-05",
    dueDate: "2026-02-01",
    lastUpdateDate: "2026-01-15",
    createdDate: "2026-01-01",
    priority: "Medium",
    status: "To Do",
    blockers: f.blockers,
    description: f.description,
    inquiriesSent: 0,
    group: "",
    labels: [],
    dependencies: [],
  };
}

function variedArb(str: fc.Arbitrary<string>): fc.Arbitrary<VariedFields> {
  return fc.record({
    taskName: str,
    assignee: str,
    assigneeEmail: str,
    blockers: str,
    description: str,
  });
}

/** Ids are assigned positionally AFTER generation so they are always unique and
 *  positive — `buildTaskFromObj` returns null otherwise and the row silently
 *  disappears, which would make every assertion below pass vacuously. */
function tasksArb(str: fc.Arbitrary<string>): fc.Arbitrary<Task[]> {
  return fc
    .array(variedArb(str), { minLength: 1, maxLength: 4 })
    .map((rows) => rows.map((f, i) => makeTask(i + 1, f)));
}

/** The projection the properties compare. Restricting it is what keeps the
 *  property honest — see EXCLUSIONS. */
function varied(t: Task) {
  return {
    id: t.id,
    taskName: t.taskName,
    assignee: t.assignee,
    assigneeEmail: t.assigneeEmail,
    blockers: t.blockers,
    description: t.description,
  };
}

// --- proof that the arbitrary actually generates hostile input -------------

/**
 * ★★★ A round-trip property is the easiest kind to write VACUOUSLY: if the
 * generated workspace never contains a delimiter, a quote, a newline or a
 * pipe, `decode(encode(ws)) === ws` passes trivially and proves nothing. The
 * counters below make that failure mode LOUD — each live property tallies how
 * many generated field values carried each hazard class and asserts a floor
 * afterwards, so a generator change that stops producing (say) pipes fails the
 * suite instead of quietly turning it green.
 *
 * Counted per FIELD VALUE, not per case: ~10-20 values per case at numRuns 20,
 * which is what makes the floors stable at all. The floor is set from measured
 * rates, not guessed — see the comment on HAZARD_FLOOR.
 */
type Hazards = {
  comma: number;
  quote: number;
  newline: number;
  pipe: number;
  backslash: number;
  astral: number;
};

const newHazards = (): Hazards => ({
  comma: 0,
  quote: 0,
  newline: 0,
  pipe: 0,
  backslash: 0,
  astral: 0,
});

function tallyHazards(tasks: readonly Task[], h: Hazards): void {
  for (const t of tasks) {
    for (const s of [
      t.taskName,
      t.assignee,
      t.assigneeEmail,
      t.blockers,
      t.description,
    ]) {
      if (s.includes(",")) h.comma++;
      if (s.includes('"')) h.quote++;
      if (s.includes("\n") || s.includes("\r")) h.newline++;
      if (s.includes("|")) h.pipe++;
      if (s.includes("\\")) h.backslash++;
      // Iterating with for..of yields whole code points, so a value above
      // 0xFFFF is an astral character — i.e. a real UTF-16 surrogate PAIR,
      // which is what a naive index-based splitter would cut in half.
      if ([...s].some((ch) => (ch.codePointAt(0) ?? 0) > 0xffff)) h.astral++;
    }
  }
}

/** MEASURED over 5 runs at numRuns 20 (the committed setting), 10 tallies in
 *  all: the lowest single value across every class and both alphabets was 16
 *  (astral), typical values 20-55. The floor sits at half that worst case, so a
 *  normal seed cannot flake, while a generator that stopped emitting a hazard
 *  class — the failure this exists to catch — lands at or near 0 and fails
 *  hard. Re-measure if HOSTILE_CHUNKS or either alphabet changes. */
const HAZARD_FLOOR = 8;

function expectHazards(h: Hazards): void {
  expect(h.comma, "generated values containing a comma").toBeGreaterThanOrEqual(HAZARD_FLOOR);
  expect(h.quote, "generated values containing a double quote").toBeGreaterThanOrEqual(HAZARD_FLOOR);
  expect(h.newline, "generated values containing a newline").toBeGreaterThanOrEqual(HAZARD_FLOOR);
  expect(h.pipe, "generated values containing a pipe").toBeGreaterThanOrEqual(HAZARD_FLOOR);
  expect(h.backslash, "generated values containing a backslash").toBeGreaterThanOrEqual(HAZARD_FLOOR);
  expect(h.astral, "generated values containing an astral character").toBeGreaterThanOrEqual(HAZARD_FLOOR);
}

// ★ The return type is `readonly Task[]`, not `Task[]`: `Workspace.tasks` is
// readonly, so declaring these mutable is a TS4104 that vitest never sees —
// tests are not typechecked by the runner OR by `next build`, only by CI's
// `npx tsc --noEmit`. Caught there, not here.
const csvRound = (tasks: readonly Task[]): readonly Task[] =>
  csvToWorkspace(workspaceToCsv({ ...emptyWorkspace(), tasks })).tasks;

const mdRound = (tasks: readonly Task[]): readonly Task[] =>
  markdownToWorkspace(workspaceToMarkdown({ ...emptyWorkspace(), tasks })).tasks;

/** Round-trips ONE field of ONE task through Markdown and returns it. Used by
 *  the deterministic blocks, where a property would only obscure the case. */
const oneBlockers = (blockers: string): string =>
  mdRound([
    makeTask(1, {
      taskName: "T",
      assignee: "",
      assigneeEmail: "",
      blockers,
      description: "",
    }),
  ])[0].blockers;

// --- CSV -------------------------------------------------------------------

/**
 * The ONE normalisation the CSV path applies to a cell: a bare LF inside a
 * quoted cell comes back as CRLF.
 *
 * Not a quirk of the tokenizer — `splitCsvSections` splits the whole document
 * on `/\r?\n/` and rejoins each section with `"\r\n"` (csv-codecs-decode.ts,
 * whose join carries a comment saying the CRLF is deliberate). A physical line
 * break inside a quoted cell is indistinguishable from a row separator at that
 * stage, so it is rewritten along with the real ones. A LONE `\r` is not a
 * split point and survives untouched, which is why this is not a blanket
 * newline collapse — and why the regex here must not be `/\r?\n/`.
 */
function csvNewlines(s: string): string {
  return s.replace(/\r\n|\n/g, "\r\n");
}

describe("CSV workspace codec — task round-trip", () => {
  it("preserves the five identity-decoded task fields for any string, modulo LF→CRLF", () => {
    const hazards = newHazards();
    fc.assert(
      fc.property(tasksArb(anyString), (tasks) => {
        tallyHazards(tasks, hazards);
        const back = csvRound(tasks);
        expect(back.map(varied)).toEqual(
          tasks.map((t) => {
            const v = varied(t);
            return {
              ...v,
              taskName: csvNewlines(v.taskName),
              assignee: csvNewlines(v.assignee),
              assigneeEmail: csvNewlines(v.assigneeEmail),
              blockers: csvNewlines(v.blockers),
              description: csvNewlines(v.description),
            };
          }),
        );
      }),
      { numRuns: 20 },
    );
    // Proves the property above was not vacuous — see the Hazards comment.
    expectHazards(hazards);
  });

  it("never drops or reorders a row", () => {
    fc.assert(
      fc.property(tasksArb(anyString), (tasks) => {
        expect(csvRound(tasks).map((t) => t.id)).toEqual(tasks.map((t) => t.id));
      }),
      { numRuns: 20 },
    );
  });

  it("is a fixed point after one pass", () => {
    fc.assert(
      fc.property(tasksArb(anyString), (tasks) => {
        const once = csvRound(tasks);
        // toStrictEqual, not toEqual: the second pass must not resurrect a key
        // as `undefined` that the first pass omitted, which toEqual ignores.
        expect(csvRound(once)).toStrictEqual(once);
      }),
      { numRuns: 20 },
    );
  });
});

// --- Markdown --------------------------------------------------------------

/** Markdown is exact only on strings that avoid its three lossy transforms
 *  (each pinned individually below). Excluded here so the exact property stays
 *  a real assertion rather than a restatement of `mdEscape`:
 *    - any `\r` at all (bare CR is trimmed at a cell edge; CRLF collapses),
 *    - a leading or trailing space/tab (`splitMdRow` trims every cell),
 *    - a literal `<br…>` (indistinguishable from an encoded newline).
 *  Everything genuinely interesting to the format is still in: `|`, `\`, `\|`,
 *  interior `\n`, quotes, commas, markdown syntax leaders, astral pairs. */
/** ★ CR is STRIPPED by a `map`, not rejected by a `filter`. Rejecting threw
 *  away every value built from the "\r\n" chunk, which dropped the newline
 *  hazard count to a third of the CSV alphabet's (measured 7/11/21 vs 34-42)
 *  and made the newline floor below flake. Stripping keeps "\r\n" as a real
 *  "\n", so this alphabet exercises interior newlines at full density. */
const mdSafeString = anyString
  .map((s) => s.replace(/\r/g, ""))
  .filter(
    (s) =>
      !/<br/i.test(s) &&
      s === s.replace(/^[ \t]+/, "").replace(/[ \t]+$/, ""),
  );

/** The three transforms above are each idempotent on their own, so one pass is
 *  a fixed point as long as no bare CR is present. A CR is the exception, and
 *  it is a defect — see the second skipped block at the bottom. */
const mdNoCrString = anyString.map((s) => s.replace(/\r/g, ""));

describe("Markdown workspace codec — task round-trip", () => {
  it("preserves the five identity-decoded task fields exactly on the safe alphabet", () => {
    const hazards = newHazards();
    fc.assert(
      fc.property(tasksArb(mdSafeString), (tasks) => {
        tallyHazards(tasks, hazards);
        expect(mdRound(tasks).map(varied)).toEqual(tasks.map(varied));
      }),
      { numRuns: 20 },
    );
    // ★ The `newline` class here counts LF only — mdSafeString filters CR out
    // by construction (see its comment), so a CR would be a generator bug.
    expectHazards(hazards);
  });

  it("never drops or reorders a row, even on the full hostile alphabet", () => {
    fc.assert(
      fc.property(tasksArb(anyString), (tasks) => {
        expect(mdRound(tasks).map((t) => t.id)).toEqual(tasks.map((t) => t.id));
      }),
      { numRuns: 20 },
    );
  });

  it("is a fixed point after one pass when no bare CR is present", () => {
    // What this buys beyond the exact property above: the three lossy
    // transforms must each be IDEMPOTENT. A non-idempotent one (a backslash
    // that doubled on every save, say) would corrupt a file progressively
    // across ordinary open/save cycles while every single round-trip still
    // looked fine on its own. That is exactly what a bare CR does — hence the
    // exclusion, and the skipped property that states the unrestricted claim.
    fc.assert(
      fc.property(tasksArb(mdNoCrString), (tasks) => {
        const once = mdRound(tasks);
        expect(mdRound(once)).toStrictEqual(once);
      }),
      { numRuns: 20 },
    );
  });
});

// --- the Markdown normalisations, pinned rather than merely described ------

describe("Markdown codec — the three documented lossy transforms", () => {
  it("trims leading/trailing whitespace from every cell", () => {
    // `splitMdRow` trims each cell because the encoder pads with " | ", and the
    // padding is indistinguishable from the value's own edge whitespace.
    expect(oneBlockers("  x  ")).toBe("x");
    expect(oneBlockers("\tx\t")).toBe("x");
  });

  it("collapses CRLF, and trims a bare CR only at a cell edge", () => {
    // mdEscape rewrites /\r?\n/ to "<br>", so CRLF returns as LF. A BARE CR is
    // not matched at all: it survives inside a cell, and disappears at an edge
    // through the trim above (CR is whitespace), not through any newline rule.
    expect(oneBlockers("a\r\nb")).toBe("a\nb");
    expect(oneBlockers("a\rb")).toBe("a\rb");
    expect(oneBlockers("\ra")).toBe("a");
  });

  it("absorbs a literal <br> into a newline", () => {
    // mdEscape does not escape "<br>", and mdUnescape cannot tell an authored
    // one from the newline it emits. One-way, but idempotent.
    expect(oneBlockers("a<br>b")).toBe("a\nb");
    expect(oneBlockers("a<BR />b")).toBe("a\nb");
  });

  it("preserves an interior newline, pipe and backslash exactly", () => {
    // The positive control for the three tests above: without it they would all
    // still pass against a codec that simply threw every cell away.
    expect(oneBlockers("a\nb")).toBe("a\nb");
    expect(oneBlockers("a|b")).toBe("a|b");
    expect(oneBlockers("a\\|b")).toBe("a\\|b");
    expect(oneBlockers("a\\\\b")).toBe("a\\\\b");
  });
});

// --- DEFECT 1 --------------------------------------------------------------

/**
 * ★★★ REAL DATA LOSS — CSV section markers are matched on RAW TEXT LINES,
 * BEFORE the CSV tokenizer runs.
 *
 * `splitCsvSections` (csv-codecs-decode.ts) splits the document on /\r?\n/ and
 * tests each line with `trimmed.startsWith(CSV_SECTION_*)`. A quoted cell
 * containing a newline puts its continuation on its own physical line, so a
 * task field whose text contains a line beginning "# RAID" — or any other
 * marker — SWITCHES THE PARSER'S SECTION MID-ROW. Everything from that line on
 * is fed to the wrong decoder and the task row is truncated.
 *
 * MEASURED, not reasoned: `blockers` of "step one\n# RAID\nstep two" comes back
 * as "step one". The remainder is gone; there is no diagnostic and no throw.
 *
 * Markdown is immune by construction — `mdEscape` turns every newline into
 * "<br>", so no cell can ever begin a physical line.
 *
 * Reachability: needs a newline inside a plain-text field. `description` is
 * HTML (the editor emits no bare newlines) and `noteLog` is JSON-in-cell
 * (escaped), but `blockers` is plain multi-line free text, and ANY imported /
 * AI-written / backend-converted workspace can carry a newline in any of them.
 * The same hazard applies to every other entity the CSV backend writes.
 */
describe.skip("CSV codec — section markers must not be matched inside a quoted cell", () => {
  it("survives a task field containing a line that starts with a section marker", () => {
    const tasks = [
      makeTask(1, {
        taskName: "T",
        assignee: "",
        assigneeEmail: "",
        blockers: "step one\n# RAID\nstep two",
        description: "",
      }),
    ];
    expect(csvRound(tasks).map(varied)).toEqual(
      tasks.map((t) => ({ ...varied(t), blockers: csvNewlines(t.blockers) })),
    );
  });
});

// --- DEFECT 2 --------------------------------------------------------------

/**
 * ★★ PROGRESSIVE CORRUPTION — the Markdown codec is NOT a fixed point when a
 * run of bare CRs precedes a newline. It erodes exactly one CR per save/load
 * cycle, so the stored value keeps changing across cycles that make no edit.
 *
 * Mechanism: `mdEscape` rewrites /\r?\n/ — which consumes the ONE CR nearest
 * the LF — to "<br>", and `mdUnescape` turns that back into a bare LF. The CRs
 * further left are untouched this pass, and the fresh LF hands the next pass
 * another /\r\n/ to eat.
 *
 * MEASURED chain, one arrow per full workspaceToMarkdown → markdownToWorkspace:
 *   "a\r\r\r\nb" -> "a\r\r\nb" -> "a\r\nb" -> "a\nb" -> "a\nb"
 *
 * Severity is well below defect 1: it converges, it only ever loses CR
 * characters, and CRLF→LF on the FIRST pass is accepted behaviour (this repo's
 * markdown format is LF). What is not acceptable is the value still moving on
 * passes 2 and 3. Found by the fixed-point property at numRuns 1500, from the
 * counterexample `description: "😀\r<br>"`; 20 runs did not reach it — which is
 * why the live property above excludes bare CR rather than pretending the case
 * does not exist.
 */
describe.skip("Markdown codec — one pass must be a fixed point on any string", () => {
  // ★ The property below is SEED-DEPENDENT at numRuns 20 — measured: unskipping
  // this block reproduces the defect through the deterministic `it` every time,
  // while the property itself passed on that run. The deterministic case is the
  // reliable reproduction; the property is what should hold once fixed.
  it("is a fixed point after one pass, on the full hostile alphabet", () => {
    fc.assert(
      fc.property(tasksArb(anyString), (tasks) => {
        const once = mdRound(tasks);
        expect(mdRound(once)).toStrictEqual(once);
      }),
      { numRuns: 20 },
    );
  });

  it("does not erode a CR run on each successive save", () => {
    const first = oneBlockers("a\r\r\r\nb");
    expect(oneBlockers(first)).toBe(first);
  });
});
