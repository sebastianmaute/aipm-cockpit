import { describe, it, expect } from "vitest";
import { workspaceToCsv, csvToWorkspace } from "./csv-codecs";
import type { ImportDiag } from "./csv-codecs";
import { emptyWorkspace } from "./workspace";
import type { Milestone, RaidItem, Task } from "./types";

function mkTask(id: number, over: Partial<Task> = {}): Task {
  return {
    id,
    taskName: `T${id}`,
    assignee: "",
    assigneeEmail: "",
    dueDate: "",
    lastUpdateDate: "",
    status: "To Do",
    priority: "Medium",
    blockers: "",
    description: "",
    createdDate: "2026-01-01",
    ...over,
  };
}

function mkRaid(id: number, over: Partial<RaidItem> = {}): RaidItem {
  return {
    id,
    category: "R",
    title: `R${id}`,
    status: "Open",
    severity: "High",
    stakeholderIds: [],
    linkedTaskIds: [],
    causedByRaidIds: [],
    raisedDate: "2026-01-01",
    ...over,
  };
}

function mkMilestone(id: number, over: Partial<Milestone> = {}): Milestone {
  return { id, name: `M${id}`, date: "2026-03-01", linkedTaskIds: [], ...over };
}

describe("CSV section splitting is quote-aware", () => {
  // ★★★ THE FIXTURE IS FOUR TASKS ON PURPOSE. open-followups §105 carried a
  // ONE-task fixture, which showed only `blockers` truncating and hid the real
  // damage: every row after the hostile cell dies too. A single-task fixture
  // passes against a fix that still misroutes the remaining rows.
  it("keeps every later row when a cell contains a line starting with a marker", () => {
    const tasks = [
      mkTask(1, { blockers: "step one\n# RAID\nstep two" }),
      mkTask(2),
      mkTask(3),
      mkTask(4),
    ];
    const ws = { ...emptyWorkspace(), tasks };
    const back = csvToWorkspace(workspaceToCsv(ws));

    expect(back.tasks.map((t) => t.id)).toEqual([1, 2, 3, 4]);
    // LF→CRLF inside a quoted cell is accepted, pinned codec behaviour.
    expect(back.tasks[0].blockers).toBe("step one\r\n# RAID\r\nstep two");
  });

  // ★★★ THIS CASE IS THE ONE WHERE IDS PROVE NOTHING, AND ASSERTING THEM ALONE
  // IS WHAT THIS TEST USED TO DO. The embedded marker names the section that is
  // ALREADY active, so a naive `csv.split(/\r?\n/)` switches `mode` to itself:
  // no row is misrouted, no row is dropped, every id survives — and the cell has
  // silently lost its `# TASKS` line, which IS the §105 loss. Measured against a
  // mutant restoring the pre-fix split: ids `[1,2]` (green) while `blockers` came
  // back as `"a\r\nb"` instead of `"a\r\n# TASKS\r\nb"`. Only the CONTENT
  // assertion can fail here — never weaken this back to an id check.
  //
  // ★ The title used to say "in a cell of the LAST section", which this fixture
  // is not: TASKS is emitted FIRST (`csv-codecs-config.ts`, the `csvPush` order)
  // and is the only section a tasks-only workspace has. Renamed to what it
  // tests. The genuinely-last-section shape — a marker naming an EARLIER section
  // from inside the tail one — is covered by the sibling below.
  it("keeps the cell intact when the embedded marker names the ACTIVE section", () => {
    const tasks = [mkTask(1, { blockers: "a\n# TASKS\nb" }), mkTask(2)];
    const ws = { ...emptyWorkspace(), tasks };
    const back = csvToWorkspace(workspaceToCsv(ws));
    expect(back.tasks.map((t) => t.id)).toEqual([1, 2]);
    expect(back.tasks[0].blockers).toBe("a\r\n# TASKS\r\nb");
  });

  // ★★★ A GENUINE LAST-SECTION CASE — the marker sits in a cell of the section
  // emitted LAST and names an EARLIER one. `csvPush` order (csv-codecs-config.ts
  // `workspaceToCsv`) puts TASKS first and RAID second, so with only these two
  // slices populated RAID is the tail: there is no later marker for a naive
  // splitter to re-sync on, and every raid row after the hostile cell is
  // re-routed into the TASKS section instead. Unlike the same-section case
  // above, the ids DO move here — assert both, since a fix that keeps the rows
  // while eating the marker line would pass on ids alone.
  it("survives a marker-shaped line in a cell of the LAST section too", () => {
    const raid = [
      mkRaid(1, { description: "x\n# TASKS\ny" }),
      mkRaid(2, { title: "Second risk" }),
    ];
    const ws = { ...emptyWorkspace(), tasks: [mkTask(1)], raid };
    const back = csvToWorkspace(workspaceToCsv(ws));

    expect(back.raid.map((r) => r.id)).toEqual([1, 2]);
    expect(back.tasks.map((t) => t.id)).toEqual([1]);
    expect(back.raid[0].description).toBe("x\r\n# TASKS\r\ny");
  });
});

describe("unbalanced quoting is reported, not silent", () => {
  it("flags a document that ends inside a quote", () => {
    const diag: ImportDiag = { droppedRows: 0 };
    csvToWorkspace('# TASKS\r\nid,taskName,blockers\r\n1,T1,"never closed', diag);
    expect(diag.unterminatedQuote).toBe(true);
  });

  it("leaves the flag false on a well-formed document", () => {
    const diag: ImportDiag = { droppedRows: 0 };
    csvToWorkspace(workspaceToCsv({ ...emptyWorkspace(), tasks: [mkTask(1)] }), diag);
    expect(diag.unterminatedQuote).toBe(false);
  });
});

/**
 * ★★★ THE QUOTE-AWARE SPLIT CARRIES QUOTE STATE ACROSS THE WHOLE FILE, where
 * the physical `csv.split(/\r?\n/)` it replaced reset it at every line. So ONE
 * unclosed `"` in an EARLY section otherwise swallows every LATER section
 * marker into a single giant cell, and each of those sections decodes as
 * absent. `splitCsvSections` therefore falls back to the physical split for
 * ROUTING whenever `splitCsvLines` reports `unterminatedQuote`, on the grounds
 * that an unbalanced quote is proof the file is malformed (our encoder always
 * balances) and containment beats a whole-file cascade.
 *
 * ★★ THE FIXTURE NEEDS THREE POPULATED SECTIONS AND THE STRAY QUOTE IN THE
 * FIRST. With the damage in the LAST section there is nothing after it to
 * swallow, so the broken and fixed behaviours are identical and the test is
 * vacuous. TASKS is emitted first (`csv-codecs-config.ts` `csvPush` order),
 * RAID and MILESTONES follow — which is what makes them the witnesses.
 *
 * ★ The corruption is injected by replacing a SENTINEL cell in real encoder
 * output rather than by hand-writing a CSV, so the headers and column counts
 * stay whatever the codec currently emits.
 */
describe("an unbalanced quote falls back to the physical split (containment)", () => {
  function brokenCsv(): string {
    const ws = {
      ...emptyWorkspace(),
      tasks: [mkTask(1, { blockers: "SENTINELCELL" }), mkTask(2)],
      raid: [mkRaid(5), mkRaid(6, { title: "Second risk" })],
      milestones: [mkMilestone(9, { name: "Kickoff" })],
    };
    const good = workspaceToCsv(ws);
    const bad = good.replace("SENTINELCELL", '"never closed');
    // Guard the fixture itself: a renamed/re-encoded blockers cell would make
    // the replacement a no-op and every assertion below pass for free.
    expect(bad).not.toBe(good);
    return bad;
  }

  it("recovers the later sections and confines the damage to the broken one", () => {
    const back = csvToWorkspace(brokenCsv());

    // The witnesses: both later sections survive, with their CONTENT intact —
    // ids alone would pass against a decoder that recovered the rows but ate
    // their cells. Measured with the fallback removed, raid is the first to go:
    // `AssertionError: expected [] to deeply equal [ 5, 6 ]`.
    expect(back.raid.map((r) => r.id)).toEqual([5, 6]);
    expect(back.raid.map((r) => r.title)).toEqual(["R5", "Second risk"]);
    // `Workspace.milestones` is optional, so `?? []` is required to typecheck;
    // it cannot weaken the assertion — an absent slice yields [], which still
    // fails against [9].
    expect((back.milestones ?? []).map((m) => m.id)).toEqual([9]);
    expect((back.milestones ?? []).map((m) => m.name)).toEqual(["Kickoff"]);

    // The damage is real and is NOT claimed to be fixed: task 2 is absorbed
    // into task 1's unclosed cell. What the fallback buys is that it stops
    // there — the cell never reaches the `# RAID` marker line, because the
    // physical split still recognises it as a marker and switches section.
    expect(back.tasks.map((t) => t.id)).toEqual([1]);
    expect(back.tasks[0].blockers).toContain("never closed");
    expect(back.tasks[0].blockers).toContain("2,T2");
    expect(back.tasks[0].blockers).not.toContain("# RAID");
    expect(back.tasks[0].blockers).not.toContain("# MILESTONES");
  });

  /**
   * ★★★ THE FALLBACK'S `\r?\n` IS LOAD-BEARING AND NOTHING ELSE PINS IT.
   * `splitCsvSections` re-joins each section with `"\r\n"`, so a `/\n/` split
   * leaves every line carrying a trailing `\r` which then DOUBLES at each break
   * absorbed into the unclosed cell. Measured against that mutant, the cell came
   * back as `"never closed,,,…,\r\r\n2,T2,…"` — the live code produces
   * `"…,\r\n2,T2,…"`.
   *
   * ★★ EVERY OTHER ASSERTION IN THIS FILE SURVIVES THAT MUTANT, which is why it
   * needs its own test rather than a line in the containment case above: that
   * test's `toContain("never closed")` and `toContain("2,T2")` both still hold
   * across a `\r\r\n`, and no id moves. A MISSING TEST, not an equivalent
   * mutant — the distinguishing observable is the doubled CR itself.
   *
   * ★ The positive companion is required. `not.toContain("\r\r")` alone would
   * also pass if the cell were empty, or if the row had been dropped entirely —
   * so assert the single CRLF that must be there.
   */
  it("the fallback split consumes CRLF, not LF alone", () => {
    const back = csvToWorkspace(brokenCsv());
    expect(back.tasks[0].blockers).not.toContain("\r\r");
    expect(back.tasks[0].blockers).toContain("\r\n2,T2");
  });

  it("still reports unterminatedQuote — the fallback changes routing, not the diagnostic", () => {
    const diag: ImportDiag = { droppedRows: 0 };
    csvToWorkspace(brokenCsv(), diag);
    expect(diag.unterminatedQuote).toBe(true);
  });

  /**
   * ★★★ THE REGRESSION GUARD THAT MATTERS MOST. §105 is about WELL-FORMED
   * files — a legal newline inside a properly closed quoted cell — which by
   * definition have balanced quotes and therefore never take the fallback
   * branch. This pins that: the same marker-shaped-line-inside-a-cell shape,
   * across three populated sections, must still parse correctly.
   *
   * ★ Measured against a mutant that falls back UNCONDITIONALLY (i.e. the
   * pre-branch physical split, restored for every file): the `# MILESTONES`
   * line inside the cell switches section mid-row and task 2 is destroyed —
   * `AssertionError: expected [ 1 ] to deeply equal [ 1, 2 ]`. That is the
   * FIRST assertion to fail, so it is the only damage this run measured; the
   * later ones were never reached and are not claimed.
   */
  it("leaves a well-formed marker-shaped cell alone across several sections (§105 stays fixed)", () => {
    const ws = {
      ...emptyWorkspace(),
      tasks: [mkTask(1, { blockers: "before\n# MILESTONES\nafter" }), mkTask(2)],
      raid: [mkRaid(5)],
      milestones: [mkMilestone(9, { name: "Kickoff" })],
    };
    const diag: ImportDiag = { droppedRows: 0 };
    const back = csvToWorkspace(workspaceToCsv(ws), diag);

    expect(diag.unterminatedQuote).toBe(false);
    expect(back.tasks.map((t) => t.id)).toEqual([1, 2]);
    // LF→CRLF inside a quoted cell is accepted, pinned codec behaviour.
    expect(back.tasks[0].blockers).toBe("before\r\n# MILESTONES\r\nafter");
    expect(back.raid.map((r) => r.id)).toEqual([5]);
    expect((back.milestones ?? []).map((m) => m.id)).toEqual([9]);
    expect((back.milestones ?? []).map((m) => m.name)).toEqual(["Kickoff"]);
  });
});

/**
 * ★★★ THE OTHER HALF OF THE TRADE, AND THE CLAIM THE CODE COMMENT USED TO DENY.
 * `splitCsvSections` carried "★★ THIS CANNOT REGRESS §105 … a well-formed file
 * has balanced quotes by definition — so it never takes this branch". The
 * premise is true and the conclusion does not follow: §105's damage belongs to a
 * CELL (a marker-shaped continuation inside a properly CLOSED quoted cell), not
 * to the FILE, so ONE unrelated stray quote anywhere flips the flag and
 * re-enables §105 for every such cell in the document.
 *
 * ★★ THIS IS A CHARACTERIZATION TEST, NOT A GUARD. It asserts the damage is
 * STILL THERE. If a later change makes the fallback smarter this test goes red —
 * that is the point: the code comment states this loss as measured fact, so the
 * two must move together. Do not "fix" it by relaxing the assertion.
 *
 * ★ The paired clean run is what makes it non-vacuous: without it, a fixture
 * that never produced three tasks in the first place would satisfy the broken
 * expectations for free.
 */
describe("the fallback's cost: an unbalanced quote re-enables §105 (characterization)", () => {
  function fixture() {
    return {
      ...emptyWorkspace(),
      tasks: [mkTask(1), mkTask(2, { taskName: "T2\n# RAID\nstill T2" }), mkTask(3)],
      milestones: [mkMilestone(9, { name: "Kickoff" })],
    };
  }

  it("parses the marker-shaped cell correctly while the quotes are balanced", () => {
    const diag: ImportDiag = { droppedRows: 0 };
    const back = csvToWorkspace(workspaceToCsv(fixture()), diag);

    expect(diag.unterminatedQuote).toBe(false);
    expect(back.tasks.map((t) => t.id)).toEqual([1, 2, 3]);
    expect(back.tasks[1].taskName).toBe("T2\r\n# RAID\r\nstill T2");
  });

  it("loses a whole task once ONE stray quote sends it down the physical split", () => {
    const clean = workspaceToCsv(fixture());
    const broken = clean + '"';
    // Guard the fixture: if the stray were a no-op every assertion below would
    // duplicate the clean case and pass for free.
    expect(broken).not.toBe(clean);

    const diag: ImportDiag = { droppedRows: 0 };
    const back = csvToWorkspace(broken, diag);

    // Task 3 is GONE and task 2's cell is truncated at the embedded marker —
    // the §105 shape, resurrected by a stray quote in a different row entirely.
    expect(back.tasks.map((t) => t.id)).toEqual([1, 2]);
    expect(back.tasks[1].taskName).toBe("T2");

    // ★★★ AND THE LOSS IS UNCOUNTED. This is the silent-loss shape the slice
    // exists to remove, and it is why the comment refuses to guess a number:
    // an absorbed row is swallowed into a cell, never REJECTED, so the counter
    // that only sees rejections stays at zero.
    expect(diag.droppedRows).toBe(0);
    expect(diag.unterminatedQuote).toBe(true);

    // What the fallback bought in exchange: the later section still decodes.
    expect((back.milestones ?? []).map((m) => m.id)).toEqual([9]);
  });
});

// ★★★ §150's OWN FIXTURE, PINNED IN BOTH DIRECTIONS. That entry is about an
// UNDECIDABLE class — a balanced, well-positioned stray pair that swallows a
// section marker is byte-identical to a legitimate quoted cell — and that half
// is unchanged and unfixable. What the malformed-quote detector added is that
// THIS fixture, whose strays are also MISPOSITIONED, is no longer silent.
// ★★ Both halves are asserted because either alone misrepresents the state: the
// mislabelling without the count reads as "still undetected", the count without
// the mislabelling reads as "fixed". Neither is true on its own.
describe("§150: a stray quote pair that swallows a section marker", () => {
  const FIXTURE = [
    "# TASKS",
    "id,taskName,blockers",
    '1,T1,a"b',
    "",
    "# MILESTONES",
    "id,name,date,description",
    '5,M5,2026-02-01,c"d',
    "6,M6,2026-03-01,",
    "7,M7,2026-04-01,",
  ].join("\r\n");

  it("still mislabels the milestone rows as tasks — the undecidable half is UNCHANGED", () => {
    const diag: ImportDiag = { droppedRows: 0 };
    const ws = csvToWorkspace(FIXTURE, diag);
    expect(ws.tasks.map((t) => t.id)).toEqual([1, 6, 7]);
    expect(ws.tasks.map((t) => t.taskName)).toEqual(["T1", "M6", "M7"]);
    expect(ws.milestones ?? []).toEqual([]);
  });

  it("reports it as MALFORMED — and reports neither of the two older signals", () => {
    // ★★ The two older signals are the measurement §150 was written from, and
    //    both are still falsy: the swallowed rows were ABSORBED rather than
    //    rejected, and the document ends balanced. Asserting them here is what
    //    shows the new count is a third, independent signal and not a
    //    relabelling of either.
    const diag: ImportDiag = { droppedRows: 0 };
    csvToWorkspace(FIXTURE, diag);
    expect(diag.malformedQuotes).toBe(2);
    expect(diag.droppedRows).toBe(0);
    expect(diag.unterminatedQuote ?? false).toBe(false);
  });
});
