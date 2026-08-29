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
import { workspaceToCsv, csvToWorkspace, parseCsv } from "./csv-codecs";
import { workspaceToMarkdown, markdownToWorkspace } from "./markdown-codecs";
import { emptyWorkspace } from "./workspace";
import type { Task } from "./types";
// ★★★ `quoteStep` is DELIBERATELY NOT IMPORTED. It is the helper BOTH scanners
// under test are built on, so an oracle written with it cannot disagree with
// them — see the tautology note in the last describe block. Do not add it back
// to make an assertion "simpler".
import { quoteStep, splitCsvLines } from "./csv-line-scan";

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

const chunkArb = fc.constantFrom(...HOSTILE_CHUNKS);

const hostileString = fc
  .array(chunkArb, { maxLength: 6 })
  .map((parts) => parts.join(""));

// --- the six hazard classes: what the floors count, and what the alphabet
// --- guarantees. Both come from ONE predicate record, defined here rather than
// --- beside the counters below because the alphabet is derived from it.

/** The classes this file's anti-vacuity floors count. */
type Hazards = {
  comma: number;
  quote: number;
  newline: number;
  pipe: number;
  backslash: number;
  astral: number;
};

/** The predicate behind each class, in ONE place: `tallyHazards` counts with it
 *  and `HAZARD_CHUNKS` is DERIVED from it, so a class can never be counted by
 *  one rule and constructed by another. */
const HAZARD_TESTS: { readonly [K in keyof Hazards]: (s: string) => boolean } = {
  comma: (s) => s.includes(","),
  quote: (s) => s.includes('"'),
  newline: (s) => s.includes("\n") || s.includes("\r"),
  pipe: (s) => s.includes("|"),
  backslash: (s) => s.includes("\\"),
  // Iterating with for..of yields whole code points, so a value above 0xFFFF is
  // an astral character — i.e. a real UTF-16 surrogate PAIR, which is what a
  // naive index-based splitter would cut in half.
  astral: (s) => [...s].some((ch) => (ch.codePointAt(0) ?? 0) > 0xffff),
};

const HAZARD_CLASSES = Object.keys(HAZARD_TESTS) as (keyof Hazards)[];

/** The chunks carrying a class, DERIVED from the alphabet rather than listed, so
 *  deleting (say) every pipe-bearing chunk empties a pool and THROWS at import
 *  instead of silently zeroing a counter.
 *
 *  ★★ The predicate is applied to the chunk WITH ITS CRs STRIPPED — precisely
 *  what `mdSafeString` does to a value — so one pool serves BOTH call sites.
 *  Without that step class `newline` would admit the bare "\r" chunk, which the
 *  Markdown alphabet removes: the guarantee would hold for CSV and evaporate for
 *  Markdown, which is the site that needs it more (see the floor measurement). */
function chunksCarrying(cls: keyof Hazards): readonly string[] {
  const pool = HOSTILE_CHUNKS.filter((c) => HAZARD_TESTS[cls](c.replace(/\r/g, "")));
  if (pool.length === 0) {
    throw new Error(
      `HOSTILE_CHUNKS no longer carries a '${cls}' chunk surviving mdSafeString's CR strip`,
    );
  }
  return pool;
}

const HAZARD_CHUNKS = Object.fromEntries(
  HAZARD_CLASSES.map((cls) => [cls, chunksCarrying(cls)]),
) as Record<keyof Hazards, readonly string[]>;

/** Every unordered pair of DISTINCT classes — 15 of them. Drawn uniformly, each
 *  class sits in exactly five, so a hazard-loaded value carries a given class
 *  with p = 1/3 exactly — and p = 1/6 per FIELD VALUE once the 5/10 loaded
 *  weight is applied. Two classes rather than one is what buys the tail.
 *  ★★★ COMPARE THEM AT THE SUPPORT MINIMUM, N = 100, WHICH IS A CONSTRUCTION
 *  FACT: `tasksArb` is minLength 1 / maxLength 4, `tallyHazards` walks 5 fields,
 *  and both sites run at numRuns 20 — so N ∈ [100, 400] with a HARD floor, and
 *  a bound must be taken there. One class (p = 1/12) gives P(< 8) = 4.0e-1,
 *  two classes give 3.8e-3: a 106x advantage, still decisive, and the ONLY
 *  form of this comparison that holds over the whole support.
 *  ★★ Take N from the arbitraries, never from a run — `docs/open-followups.md`
 *  §244 carries what it cost to learn that here. Recompute:
 *    node -e "const lf=x=>{let s=0;for(let i=2;i<=x;i++)s+=Math.log(i);return s};const b=(n,p,k)=>{let t=0;for(let i=0;i<k;i++)t+=Math.exp(lf(n)-lf(i)-lf(n-i)+i*Math.log(p)+(n-i)*Math.log(1-p));return t};console.log(b(100,1/12,8),b(100,1/6,8))"
 */
const HAZARD_PAIRS = HAZARD_CLASSES.flatMap((a, i) =>
  HAZARD_CLASSES.slice(i + 1).map((b) => [a, b] as const),
);

const insertChunk = (parts: readonly string[], chunk: string, at: number): string[] => {
  const i = at % (parts.length + 1);
  return [...parts.slice(0, i), chunk, ...parts.slice(i)];
};

/** A value CONSTRUCTED to carry two named hazard classes, at positions drawn
 *  like any other chunk. Four filler chunks plus the two hazard chunks is SIX —
 *  the same cap `hostileString` uses, deliberately, so every value this can
 *  produce was already in `hostileString`'s support. */
function hazardLoaded(a: keyof Hazards, b: keyof Hazards): fc.Arbitrary<string> {
  return fc
    .tuple(
      fc.array(chunkArb, { maxLength: 4 }),
      fc.constantFrom(...HAZARD_CHUNKS[a]),
      fc.constantFrom(...HAZARD_CHUNKS[b]),
      fc.nat(),
      fc.nat(),
    )
    .map(([parts, first, second, at1, at2]) =>
      insertChunk(insertChunk(parts, first, at1), second, at2).join(""),
    );
}

const hazardLoadedString = fc.oneof(...HAZARD_PAIRS.map(([a, b]) => hazardLoaded(a, b)));

/** A `fc.string()` alongside the curated chunks so the property is not limited
 *  to characters someone already thought of, plus the hazard-loaded branch that
 *  turns the floors below from a bet into a fact.
 *
 *  ★★ THE HAZARD-LOADED BRANCH NARROWS NOTHING. Its values are joins of at most
 *  six `HOSTILE_CHUNKS` — exactly `hostileString`'s support — so the SET of
 *  reachable strings is unchanged and only the distribution moves. Hazard-FREE
 *  values (the empty string, bare whitespace, a lone markdown leader) stay
 *  reachable through the other two branches, and the 4:1 hostile-derived to
 *  `fc.string` ratio this alphabet always had is preserved exactly: (3 + 5) : 2.
 *
 *  ★ Do NOT raise the loaded weight to "make the floors safer". Over the WHOLE
 *  support — N ≥ 100 by construction, p ≥ 1/6 at THIS alphabet — this already
 *  bounds P(< 8) at 3.8e-3 per evaluation, and the only thing more weight buys
 *  is less breadth. ★★ `mdSafeString` wraps this alphabet in a REJECTING
 *  `.filter()` (no `<br`, no edge whitespace) and accepts the three branches
 *  at different rates — 0.75 hostile / 0.98 `fc.string` / 0.84 loaded over
 *  200,000 draws — so the 5/10 weight is not preserved there by construction.
 *  It is preserved in FACT: the perturbations nearly cancel (posterior loaded
 *  weight 0.497–0.500) and the worst per-class rate over ACCEPTED values is
 *  0.2389, clear of 1/6. ★★★ AN EARLIER REVISION OF THIS NOTE ASSERTED THE
 *  OPPOSITE DIRECTION — "rejection correlates with the loaded branch" — from
 *  READING the code, and measuring refuted it: loaded is accepted MORE than
 *  hostile. `<br>`, `"  "`, `"\t"` and `"# "` satisfy no `HAZARD_TESTS`
 *  predicate, so the two GUARANTEED chunks are never rejectable and only the
 *  fillers are — of which `hostileString` draws up to 6 and `hazardLoaded`
 *  up to 4. A direction is a measurement, never a reading. ★★ That bound is deliberately LOOSE and must not be read as
 *  a flake rate: N = 100 requires all twenty runs to draw exactly one task, and
 *  the measured per-value rate is 0.24–0.33 at both sites rather than the 1/6
 *  the bound assumes. It is the number that holds without measuring anything,
 *  which is the only kind worth pinning here. */
const anyString = fc.oneof(
  { weight: 3, arbitrary: hostileString },
  { weight: 2, arbitrary: fc.string({ maxLength: 12 }) },
  { weight: 5, arbitrary: hazardLoadedString },
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
 * which is what makes the floors stable at all. The `Hazards` type and the
 * predicates that decide each class live UP in the alphabet section, because
 * `HAZARD_CHUNKS` — the pool the hazard-loaded branch draws from — is derived
 * from those same predicates. See the comment on HAZARD_FLOOR for the numbers.
 */
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
      // The SAME predicates the hazard pools are derived from, so a class the
      // alphabet guarantees and a class this counts cannot mean different
      // things. Kept CONDITIONAL rather than asserted: if `anyString` ever
      // regresses, the counter drops and the floor below still catches it.
      for (const cls of HAZARD_CLASSES) if (HAZARD_TESTS[cls](s)) h[cls]++;
    }
  }
}

/**
 * What the floor proves: the generated workspaces really did carry each codec
 * hazard, so `decode(encode(ws)) === ws` above was not asserted over inert text.
 *
 * ★★★ IT IS NOW A FACT ABOUT THE ARBITRARY, NOT A BET ON THE SEED — and the
 * value 8 has not moved, only the odds behind it. fast-check is UNSEEDED, so
 * every counter is a random variable and CI tosses these SIX floors at TWO call
 * sites (`anyString` and `mdSafeString`), on TWO blocking jobs, every pipeline.
 *
 * BEFORE (`anyString` = 4:1 hostile:`fc.string`, no loaded branch), measured at
 * numRuns 20 over 80,000 POOLED samples per site — two independent runs of
 * 40,000, pooled because a single run of a rare event does not reproduce: FOUR
 * of the twelve evaluations went below 8. Markdown `newline` 6/80,000 = 7.5e-5,
 * Markdown `astral` 5/80,000 = 6.3e-5, Markdown `comma` 3/80,000 = 3.8e-5, CSV
 * `astral` 1/80,000 = 1.3e-5; smallest observed count 6, i.e. the floor was
 * ALREADY failing, not merely close. That is what "half an observed minimum"
 * bought, and it was the weakest calibration of the 35 floors in this repo's
 * property suites. Note the two runs disagreed on which counters fired at all
 * (Markdown `comma` was 3 then 0) — ordinary noise on a rare event, and the
 * reason no single-run figure is quoted here.
 *
 * ★★ THESE FOUR RATES COUNT `v < 8` — STRICTLY BELOW, which is what these
 * floors actually fail on, since they are `toBeGreaterThanOrEqual(8)`. Say so
 * because the shared harness does NOT default to it: `measureFloor`'s `below`
 * counts `v <= floor`, so re-measuring these with `floors: [8]` reports a
 * LARGER number by the whole `v === 8` mass, and the discrepancy reads as a
 * contradiction of this paragraph rather than as a convention mismatch. Pass
 * `floors: [7]` to reproduce the figures above. ★ The qualitative conclusion —
 * that the floor was already failing rather than merely close — does not rest
 * on the convention either way: the smallest observed count was 6, which is
 * below 8 under both.
 *
 * AFTER: `hazardLoadedString` gives every drawn value probability 1/3 of
 * carrying a named class (a uniform pair out of 15) at weight 5 of 10, so a
 * given class rides p = (1/3)(1/2) = 1/6 per value by construction, and the
 * CONSTRUCTED contribution alone is Binom(N, 1/6) over the N field values a
 * 20-run sample generates. ★★★ N IS BOUNDED BY THE ARBITRARIES, NOT BY A RUN:
 * `tasksArb` is minLength 1 / maxLength 4, `tallyHazards` walks 5 fields per
 * task, numRuns is 20 at both sites, so N ∈ [100, 400] — a HARD support.
 * **Take the worst case at N = 100:
 * P(< 8) ≤ 3.8e-3 per evaluation, which needs no measurement and holds
 * always.** That bound is loose on purpose — N = 100 needs all twenty runs to
 * draw one task — but a loose bound that is TRUE outranks a tight one that is
 * an artifact of the seed. The construction also IGNORES the alphabet's own
 * hazard density, which is why real counts land near 3x its mean and why the
 * measured per-value rate is 0.24–0.33 rather than 1/6 (200,000 values per
 * site, independently reimplemented against the real `HOSTILE_CHUNKS`); at the
 * measured rate the same worst-case N gives 7.8e-6. Corroboration, not the
 * claim.
 *
 * ★★ WHAT IS AND IS NOT ESTABLISHED HERE. The EMPIRICAL result is: 40,000
 * samples per site, 0 at or below 8 anywhere, and the smallest of the twelve
 * observed minima rose from 6 to 23. That is the claim. An earlier revision
 * also quoted "P(< 8) = 2.2e-8" as an exact mixture over the N distribution;
 * that figure is NOT reproducible from anything stated here and has been
 * removed rather than restated — it is simply Binom(190, 1/6), an unstated
 * interior point. ★★ It survived in two other comments in THIS file and in the
 * register long after this paragraph declared it gone, which is the failure
 * mode to watch: deleting a number in the place that discusses it, while the
 * places that USE it go unswept.
 * ★ Note a zero is not a bound either: rule-of-three puts 0/40,000 at 7.5e-5,
 * which alone would not clear the defect this replaced. The case for the fix is
 * the CONSTRUCTION (p = 1/6 guaranteed, against a hazard density that was
 * previously incidental), corroborated by the minima, not a single tail number.
 *
 * ★★★ DO NOT TIGHTEN THIS AND DO NOT RAISE numRuns. A larger sample against an
 * unchanged absolute floor is a WEAKER guard, not a safer run; a higher floor
 * re-opens the tail the construction just closed. If `HOSTILE_CHUNKS` or either
 * alphabet changes, re-measure with `scripts/measure-property-floor.mjs` —
 * quote a probability, never a sample minimum.
 */
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
 *  "\n", so this alphabet exercises interior newlines at full density.
 *  ★★ That strip is LOAD-BEARING IN A SECOND PLACE now: `chunksCarrying` applies
 *  it before deciding which class a chunk belongs to, so the `newline` pool the
 *  hazard-loaded branch draws from holds only chunks that survive HERE — one
 *  pool serving both call sites. Change the strip and re-measure both. */
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
describe("CSV codec — section markers must not be matched inside a quoted cell", () => {
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

describe("csv-line-scan and parseCsv agree about quoting", () => {
  // ★★★ THE ALPHABET IS THE PROPERTY. `fc.string()` in this project's
  // fast-check (4.8.0) emits PRINTABLE ASCII ONLY. Measured by counting inside
  // the property, not assumed: NOT ONE generated string contained `\n` or `\r`
  // (0 of 2000), so `splitCsvLines` returned a single line every time. Both
  // properties below are about what happens at a line break inside a quoted
  // cell, so on `fc.string()` the first degenerated to `s === s` and the second
  // held trivially. Every generator here therefore builds its string from an
  // explicit hostile alphabet; `fc.stringOf` does not exist in 4.8.0, so it is
  // `fc.array(...).map(join)`.
  //
  // ★★ THAT `0 of 2000` IS THE ONLY COUNT THIS BLOCK MAY QUOTE, and the reason
  // is a difference in KIND, not in size: it is a zero, and it falls out of the
  // generator's character range rather than out of a seed. Every code point
  // `fc.string({maxLength:200})` produced over those 2000 runs lay in 32..126 —
  // reproduce with this ONE line (it prints `4.8.0 32 126 0`):
  // node -e "const fc=require('fast-check');let lo=1e6,hi=0,nl=0;fc.assert(fc.property(fc.string({maxLength:200}),s=>{if(/[\r\n]/.test(s))nl++;for(const c of s){const p=c.codePointAt(0);if(p<lo)lo=p;if(p>hi)hi=p}return true}),{numRuns:2000});console.log(fc.__version,lo,hi,nl)"
  // Every OTHER census figure that has stood in this block was a nonzero count
  // over a seed `fc.assert` was never given, so it was unreachable on the next
  // run — and each was eventually retracted. ★★ TWO OF THEM WERE INTRODUCED BY
  // THE VERY COMMIT THAT RETRACTED THEIR PREDECESSOR, which is why this warning
  // is phrased as a prohibition rather than a correction: `3de672bb` wrote a
  // "500 runs, 164 discarded" census, and `1306ea4a` retracted it AND added two
  // fresh unreproducible figures in the same change — a count of strings
  // containing a quote, and a headroom multiple on the floor below. Both were
  // re-measured by a later reviewer and both were wrong. Reproduce the overlap
  // with `git log --oneline -S"164 were discarded" -- src/app/codec-roundtrip.property.test.ts`
  // and the same for `-S"5× headroom"`; they name the same commit.
  // ★ No replacement figure is quoted here on purpose — writing "the real number
  // is N" is the identical mistake one round later. Assert a floor instead.
  const csvHostileString = fc
    .array(fc.constantFrom("a", '"', ",", "\r\n", "\n", "\r", "#"), { maxLength: 40 })
    .map((chars) => chars.join(""));

  /** The oracle for "is the scan closed here", written as ARITHMETIC so it can
   *  share no code with either scanner. It is EXACT, not an approximation:
   *  quote-state changes only at a `"`, a doubled quote consumes two characters
   *  without changing state and a lone quote consumes one and toggles, so the
   *  state after any prefix is `start XOR (the number of '"' seen is odd)`.
   *  Hence closed ⟺ an even number of quotes. */
  const evenQuotes = (s: string) => (s.match(/"/g)?.length ?? 0) % 2 === 0;

  // ★★★ THE TRAILING `expect`s ARE NOT INSTRUMENTATION — they are the guard
  // that keeps this property honest, and they replace a prose census that
  // nothing could reproduce. A comment claiming "N runs split" rots silently the
  // moment the alphabet is edited; a floor goes RED. No seed is pinned, so every
  // floor sits far below the observed rate and cannot flake on an unlucky seed.
  // Re-measure by counting into a `console.log` if you change the alphabet; do
  // not tighten a floor to the number you happen to see, and do not write the
  // number you saw into this comment.
  it("splitCsvLines is lossless on any string", () => {
    let multiLine = 0;
    let quoted = 0;
    fc.assert(
      fc.property(csvHostileString, (s) => {
        if (s.includes('"')) quoted++;
        const expected = s.replace(/\r?\n/g, "\r\n");
        const { lines } = splitCsvLines(s);
        if (lines.length > 1) multiLine++;
        expect(lines.join("\r\n")).toBe(expected);
      }),
      { numRuns: 500 },
    );
    expect(multiLine).toBeGreaterThan(50);
    expect(quoted).toBeGreaterThan(50);
  });

  // ★★★ THE FALSE-POSITIVE GUARANTEE, STATED AS A LAW RATHER THAN ASSERTED.
  // `malformedQuotes` is surfaced to the USER as an incomplete-load signal, so
  // an over-firing detector is worse than none: it would hold saves on every
  // correct import. `csvEscape` wraps and doubles, so nothing this app writes
  // can violate RFC 4180 — and that is exactly the kind of claim a comment
  // gets wrong silently. Running it over the hostile alphabet, through the
  // REAL encoder, is what makes it checkable.
  // ★★ This is the property §150 could not have: intent is undecidable, so no
  // law can be stated about "was a marker swallowed". Malformedness is
  // syntactic, so it can be.
  /** True iff a CRLF is reached while INSIDE a quoted cell — literally
   *  `splitCsvLines`' own branch condition, replayed through the same exported
   *  `quoteStep`, so this cannot disagree with production about what `""` means.
   *  ★★★ NOT A REGEX, and two were measured wrong before this landed. The
   *  shipped `/"[^"]*\r\n/` fires on any quoted cell (its closing quote), and
   *  the obvious repair `/"[^"]*\r\n[^"]*"/` is wrong in the OPPOSITE direction:
   *  over 1000 draws it produced 18 false positives (1.8%, the `""` over-fire)
   *  but 57 false negatives (5.7%), missing real multi-line cells whose tail
   *  after the newline contains a doubled quote. A regex cannot promise
   *  agreement with the scanner; replaying the walk can.
   *  ★ The `\r?\n` normalization mirrors `splitCsvLines` step 1 — the encoder
   *  emits a BARE `\n` inside quoted cells, so a detector that looked only for
   *  a literal CRLF would under-count against the very scanner it models. */
  const hasMultilineQuotedCell = (text: string): boolean => {
    const normalized = text.replace(/\r?\n/g, "\r\n");
    let inQuotes = false;
    let i = 0;
    while (i < normalized.length) {
      const step = quoteStep(normalized, i, inQuotes);
      if (step) {
        inQuotes = step.inQuotes;
        i = step.next;
        continue;
      }
      if (inQuotes && normalized.startsWith("\r\n", i)) return true;
      i += 1;
    }
    return false;
  };

  it("never fires malformedQuotes on output our own encoder wrote", () => {
    const RUNS = 200;
    let quotedCells = 0;
    let multilineQuotedRuns = 0;
    fc.assert(
      fc.property(tasksArb(anyString), (tasks) => {
        const csv = workspaceToCsv({ ...emptyWorkspace(), tasks });
        if (csv.includes('"')) quotedCells++;
        if (hasMultilineQuotedCell(csv)) multilineQuotedRuns++;
        expect(splitCsvLines(csv).malformedQuotes).toBe(0);
      }),
      { numRuns: RUNS },
    );
    // ★★ Anti-vacuity, and it is not optional here: a run whose encoder output
    // never QUOTED anything would satisfy the property trivially, and this
    // test's whole subject is what the escaper does with quotes.
    expect(quotedCells).toBeGreaterThan(20);
    // ★★★ THE SECOND FLOOR USED TO MEASURE NOTHING. It counted `/"[^"]*\r\n/`,
    // which needs a `"` followed by non-quote characters up to a CRLF — a
    // condition ANY quoted cell in a CRLF-terminated row satisfies via its
    // CLOSING quote. Measured over 10 unseeded reps of 200: that regex and the
    // bare `csv.includes('"')` counter above both averaged 199.5/200, i.e. it
    // was empirically the SAME counter, and its `> 5` floor was a near-duplicate
    // of the one above rather than a statement about multi-line quoted cells.
    // ★★ THE COVERAGE WAS REAL ANYWAY — do not record this as "the branch was
    // never exercised". Ground truth measured 0.926 (10x200 unseeded, min rep
    // 0.895, max 0.965), so the CRLF-inside-quotes branch is reached in ~9 runs
    // out of 10; the encoder emits a bare `\n` inside quoted cells and
    // `splitCsvLines` normalizes it to CRLF before the walk. The defect was that
    // the floor could not DETECT a future loss of that coverage, not that the
    // coverage was missing.
    // ★★★ A FRACTION, NEVER A SAMPLE MINIMUM. An absolute count gets EASIER to
    // clear as `numRuns` rises, so a floor pinned to the count you happened to
    // observe silently weakens the moment anyone raises N. At 0.75: P(false
    // failure) is 3.0e-10 even if the true rate slipped to 0.90, and 7.7e-5 at
    // 0.85 — negligible beside this suite's other flake sources — while it still
    // trips essentially always if the class disappears. 0.85 was rejected as too
    // tight (~1 spurious red per 100 runs at p=0.90).
    // ★ Re-measure, do not re-guess, if the alphabet changes. The indicator is
    // per-RUN ("this CSV holds >=1 multi-line quoted cell"), which is what this
    // floor counts; it is NOT a per-cell rate and the two are not
    // interchangeable if the counter is ever rewritten to count cells.
    expect(multilineQuotedRuns / RUNS).toBeGreaterThan(0.75);
  });

  // ★★★ DO NOT write this one as `parseCsv(rejoined) === parseCsv(normalized)`.
  // That is VACUOUS: the property above says rejoining REPRODUCES the
  // normalized input, so such a test compares a value with itself and cannot
  // fail for any implementation. It was written that way first and caught in
  // review. The real invariant is that a line never ENDS mid-quote — which is
  // precisely what a naive splitter violates.
  //
  // ★★★ `fc.string({maxLength:200})` is ALSO vacuous here: every surviving run
  // contained no `"` at all, so no quote state was ever entered and the
  // assertion held trivially. Hence `csvHostileString` above.
  //
  // ★★★ AND SO WAS THE ORACLE, WHICH IS THE HARDER TRAP OF THE TWO — the
  // alphabet was fixed first and this property stayed unkillable afterwards. It
  // re-walked each line with the SAME `quoteStep` that `splitCsvLines` had used
  // to choose the break points, restarting at `inQuotes = false` per line. But
  // `splitCsvLines` only ever breaks while its OWN `inQuotes` is false, so a
  // per-line restart replays the implementation's exact state trajectory: the
  // walk ended `false` on every non-final line for ANY `quoteStep` whatsoever,
  // and `fc.pre(!unterminatedQuote)` discarded the one line that could have
  // differed. Three planted `quoteStep` mutants each left it green.
  //
  // ★★★ THE ORACLE IS NOW ARITHMETIC (`evenQuotes`, defined above) and shares no
  // code with either scanner. ★★ It is not a weaker approximation of the walk —
  // it is exactly equivalent to it, for the reason given on `evenQuotes`. ★ The
  // one thing it is structurally blind to is a change that preserves quote
  // PARITY, which is why the doubled-quote rule is pinned separately below.
  //
  // ★★ `fc.pre` IS GONE ON PURPOSE. Discarding unbalanced documents threw away
  // the only line whose end-state could differ from the implementation's, and it
  // made the census figures unreadable ("500 survivors PLUS an unknown number
  // discarded", never "N of 500" — an earlier comment here got that backwards).
  // Asserting the LAST line's parity against `unterminatedQuote` keeps all 500
  // runs, pins the returned flag, and makes a mutant that mis-splits an
  // unbalanced document fail without needing a lucky balanced counterexample.
  it("never ends a line inside a quote, and reports an unbalanced document", () => {
    let quoted = 0;
    let multiLine = 0;
    let unterminated = 0;
    fc.assert(
      fc.property(csvHostileString, (s) => {
        const { lines, unterminatedQuote } = splitCsvLines(s);
        if (s.includes('"')) quoted++;
        if (lines.length > 1) multiLine++;
        if (unterminatedQuote) unterminated++;
        for (let i = 0; i < lines.length - 1; i++) {
          expect(evenQuotes(lines[i]), `line ${i} of ${JSON.stringify(s)}`).toBe(true);
        }
        // The final line has no terminator, so it is the one line allowed to end
        // open — and it must do so EXACTLY when the scanner said so.
        expect(
          evenQuotes(lines[lines.length - 1]),
          `final line of ${JSON.stringify(s)}`,
        ).toBe(!unterminatedQuote);
      }),
      { numRuns: 500 },
    );
    // The cases that matter: a quoted cell spanning physical lines is the exact
    // shape §105 broke. Floors, not equalities — see above.
    expect(quoted, "runs whose input contained a quote").toBeGreaterThan(50);
    expect(multiLine, "runs that produced more than one line").toBeGreaterThan(50);
    expect(unterminated, "runs whose document ended mid-quote").toBeGreaterThan(20);
  });

  // ★★★ THE BLOCK IS NAMED FOR AN AGREEMENT AND UNTIL NOW NOTHING TESTED IT —
  // `parseCsv` was not imported, so the drift the header comment warns about was
  // pinned by nothing at all. These two properties are that cross-check.
  //
  // ★ This is NOT the vacuous shape warned against above. That one compared
  // `parseCsv(x)` with `parseCsv(x)` for one x; this compares `parseCsv` of the
  // WHOLE document with the CONCATENATION of `parseCsv` over the individual
  // lines — a claim about WHERE `parseCsv` ends a row, which can and does fail.
  // Measured against the §105 regression, planted as a mutant that drops the
  // `!inQuotes` guard from the break site so every physical CRLF ends a line: a
  // quoted cell spanning two physical lines then yields ONE row on the left and
  // TWO on the right, and this property goes red.
  //
  // ★★★ IT IS ONE-DIRECTIONAL, AND CALLING IT "the two cannot drift" WOULD BE
  // THE OVERCLAIM THIS BLOCK KEEPS MAKING. Both sides call `parseCsv`, so a
  // change to the TOKENIZER moves them together and cancels. Measured, not
  // reasoned: a mutant letting a CRLF end a row INSIDE a quoted cell — the
  // textbook scanner/tokenizer disagreement — leaves this property GREEN, and so
  // does one that stops treating a bare CR as a row terminator. It sees the
  // `splitCsvLines` side only. The escaper property below is what catches the
  // first of those two; nothing here catches the second.
  //
  // ★★ It compares against the NORMALIZED document, not `s`. `splitCsvLines`
  // rewrites `\r?\n` to `\r\n` before scanning (that step is load-bearing — see
  // its own header), so the lines it returns describe the normalized text; the
  // property above already pins that rejoining them reproduces it exactly.
  it("parseCsv ends a row exactly where splitCsvLines ends a line", () => {
    fc.assert(
      fc.property(csvHostileString, (s) => {
        const normalized = s.replace(/\r?\n/g, "\r\n");
        const { lines } = splitCsvLines(s);
        // ★ Every line but the last is followed by a terminator IN THE DOCUMENT,
        // and a terminator always closes a row, while `parseCsv` drops a
        // trailing empty row (`buf.length > 0 || row.length > 0`). Re-terminate
        // the non-final lines or the two sides disagree on every input whose
        // line ends empty — which is not a defect, just a different question.
        const perLine = lines.flatMap((line, i) =>
          i < lines.length - 1 ? parseCsv(line + "\r\n") : parseCsv(line),
        );
        expect(parseCsv(normalized)).toStrictEqual(perLine);
      }),
      { numRuns: 500 },
    );
  });

  // ★★★ NO TEST OF `splitCsvLines` CAN EVER SEE THE DOUBLED-QUOTE RULE, and
  // that is a theorem, not a gap in the assertions above. Deleting the branch
  // makes a doubled quote TWO toggles instead of one skip — same end state, same
  // index — and every position inside a run of quotes is consumed by `quoteStep`
  // itself, so the CRLF check is never reached there and no break point can
  // move. Measured against the real module, not only argued: a sha256 over
  // `{lines, unterminatedQuote}` for every string of length ≤ 6 built from this
  // alphabet (7 symbols, so sum(7^d) for d in 0..6 = 137257 cases) is BYTE-
  // IDENTICAL with the branch deleted, while the same fingerprint moves for
  // every other mutant tried. Re-derive it rather than trusting this line — a
  // fingerprint over an exhaustive corpus is the only thing that separates
  // "equivalent mutant" from "missing test", which look identical from the
  // harness, and it is a dozen lines of throwaway script. The
  // parity oracle above is blind to it for the same reason, and the boundary
  // property compares `parseCsv` with `parseCsv`, so a change to the rule moves
  // both sides together.
  //
  // ★★ So the rule is only observable through what a CELL ends up containing,
  // and the missing oracle is an ESCAPER — written from scratch here, sharing no
  // code with the codec — saying what the cells were before they were encoded.
  // Without it, deleting the branch is killed in this file only by the
  // whole-workspace round-trip at the top, which reports a task field that no
  // longer matches rather than a quoting rule that changed.
  //
  // ★★ It is also the ONLY property here that sees a TOKENIZER-side change: it
  // is the sole killer of a mutant letting a CRLF end a row inside a quoted
  // cell, which every other property in this block passes.
  const csvCell = fc.constantFrom("", "a", '"', 'x"y', '""', ",", "\r\n", "\n", "\r", "a,b", "#");
  /** RFC 4180: wrap every cell, double every quote inside it. */
  const escapeCell = (cell: string) => `"${cell.replace(/"/g, '""')}"`;
  it("parseCsv recovers every cell an RFC-4180 escaper produced", () => {
    let quotedCells = 0;
    fc.assert(
      fc.property(
        fc.array(fc.array(csvCell, { minLength: 1, maxLength: 3 }), {
          minLength: 1,
          maxLength: 3,
        }),
        (rows) => {
          // ★ `parseCsv` DROPS a trailing row whose only cell is empty, because
          // its tail guard is `buf.length > 0 || row.length > 0` and an empty
          // quoted cell contributes neither. Real, and not what this pins — so
          // the document always ends on a non-empty sentinel row.
          const all = [...rows, ["z"]];
          for (const row of all) for (const c of row) if (c.includes('"')) quotedCells++;
          const doc = all.map((r) => r.map(escapeCell).join(",")).join("\r\n");
          expect(parseCsv(doc)).toStrictEqual(all);
        },
      ),
      { numRuns: 300 },
    );
    expect(quotedCells, "generated cells containing a quote").toBeGreaterThan(50);
  });
});
