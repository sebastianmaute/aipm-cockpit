import { describe, expect, it } from "vitest";
import {
  addBlocker,
  applyTaskPatch,
  blockersText,
  deleteBlocker,
  editBlocker,
  migrateBlockers,
  nextBlockerId,
  openBlockerCount,
  previewBlockersText,
  reopenBlocker,
  resolveBlocker,
  sanitizeBlockerLog,
  selfBlockerActor,
  setBlockersText,
  withBlockerLog,
} from "./blocker-log";
import { MAX_NOTE_ENTRIES } from "./note-log-policy";
import { sanitizeBlockers, TEXTAREA_MAX } from "./sanitize-core";
import type { BlockerEntry, Task } from "./types";

const NOW = "2026-05-01T10:00:00.000Z";
const ACTOR = { resourceId: 7, name: "Ada" };

function makeTask(over: Partial<Task> = {}): Task {
  return {
    id: 1,
    title: "T",
    blockers: "",
    lastUpdateDate: "2026-03-04",
    ...over,
  } as Task;
}

describe("blocker-log", () => {
  it("blockersText joins open entries oldest first and skips resolved", () => {
    const log: BlockerEntry[] = [
      { id: 2, text: "B", createdAt: "2026-01-02T00:00:00Z" },
      { id: 1, text: "A", createdAt: "2026-01-01T00:00:00Z" },
      { id: 3, text: "C", createdAt: "2026-01-03T00:00:00Z", resolvedAt: "2026-01-04T00:00:00Z" },
    ];
    expect(blockersText(log)).toBe("A\nB");
    expect(blockersText(undefined)).toBe("");
    expect(openBlockerCount(log)).toBe(2);
    expect(openBlockerCount(undefined)).toBe(0);
  });

  it("withBlockerLog sets the log and the derived text together", () => {
    const log: BlockerEntry[] = [{ id: 1, text: "A", createdAt: "2026-01-01T00:00:00Z" }];
    const t = makeTask({ blockers: "stale" });
    const out = withBlockerLog(t, log);
    expect(out).not.toBe(t);
    expect(out.blockerLog).toEqual(log);
    expect(out.blockers).toBe("A");
    expect(t.blockers).toBe("stale");
  });

  it("setBlockersText leaves the task untouched for the same text", () => {
    const t = migrateBlockers(makeTask({ blockers: "X\nY" }));
    expect(setBlockersText(t, " X\nY ", ACTOR, NOW)).toBe(t);
  });

  it("setBlockersText with empty text resolves every open entry", () => {
    const t = withBlockerLog(makeTask(), [
      { id: 1, text: "A", createdAt: "2026-01-01T00:00:00Z" },
      { id: 2, text: "B", createdAt: "2026-01-02T00:00:00Z" },
    ]);
    const out = setBlockersText(t, "  ", ACTOR, NOW);
    expect(out.blockerLog?.map((e) => e.resolvedAt)).toEqual([NOW, NOW]);
    expect(out.blockers).toBe("");
  });

  it("setBlockersText with new text resolves the open ones and adds one", () => {
    const t = withBlockerLog(makeTask(), [
      { id: 1, text: "A", createdAt: "2026-01-01T00:00:00Z" },
      { id: 4, text: "Old", createdAt: "2026-01-02T00:00:00Z", resolvedAt: "2026-01-03T00:00:00Z" },
    ]);
    const out = setBlockersText(t, " New ", { name: "Ada" }, NOW);
    expect(out.blockerLog).toHaveLength(3);
    expect(out.blockerLog?.[0].resolvedAt).toBe(NOW);
    expect(out.blockerLog?.[1].resolvedAt).toBe("2026-01-03T00:00:00Z");
    const added = out.blockerLog?.[2];
    expect(added).toEqual({ id: 5, text: "New", authorName: "Ada", createdAt: NOW });
    expect(added && "authorResourceId" in added).toBe(false);
    expect(out.blockers).toBe("New");
  });

  it("migrateBlockers turns legacy text into one open entry", () => {
    const out = migrateBlockers(makeTask({ blockers: "Line1\nLine2" }));
    expect(out.blockerLog).toHaveLength(1);
    const e = out.blockerLog?.[0];
    expect(e?.text).toBe("Line1\nLine2");
    expect(e?.createdAt.startsWith("2026-03-04")).toBe(true);
    expect(e && "authorName" in e).toBe(false);
    expect(e && "authorResourceId" in e).toBe(false);
    expect(out.blockers).toBe("Line1\nLine2");
  });

  it("migrateBlockers stamps legacy text deterministically: a real date at midnight UTC, else the epoch", () => {
    const EPOCH_STAMP = "1970-01-01T00:00:00.000Z";
    const real = migrateBlockers(makeTask({ blockers: "X", lastUpdateDate: "2026-03-04" }));
    expect(real.blockerLog?.[0]?.createdAt).toBe("2026-03-04T00:00:00.000Z");
    for (const lastUpdateDate of ["2026-13-45", "", "bad", undefined]) {
      const task = makeTask({ blockers: "X", lastUpdateDate });
      const a = migrateBlockers(task);
      expect(a.blockerLog?.[0]?.createdAt).toBe(EPOCH_STAMP);
      expect(migrateBlockers(task)).toEqual(a);
      // The minted entry survives the sanitizer, so it is not dropped and re-minted.
      expect(sanitizeBlockerLog(a.blockerLog)).toEqual(a.blockerLog);
    }
  });

  it("migrateBlockers keeps a disagreeing text as a new entry, keeping the history, and is idempotent", () => {
    // Amended 2026-10-02: the text was written by something unaware of the log
    // (an older build, a hand-edited file), so the replace rule runs against it.
    const t = makeTask({
      blockers: "old",
      blockerLog: [
        { id: 1, text: "Fresh", createdAt: "2026-01-01T00:00:00Z" },
        { id: 2, text: "Done", createdAt: "2026-01-01T00:00:00Z", resolvedAt: "2026-01-02T00:00:00Z" },
      ],
    });
    const once = migrateBlockers(t);
    expect(once.blockerLog).toEqual([
      { id: 1, text: "Fresh", createdAt: "2026-01-01T00:00:00Z", resolvedAt: "2026-03-04T00:00:00.000Z" },
      { id: 2, text: "Done", createdAt: "2026-01-01T00:00:00Z", resolvedAt: "2026-01-02T00:00:00Z" },
      { id: 3, text: "old", createdAt: "2026-03-04T00:00:00.000Z" },
    ]);
    expect(once.blockers).toBe("old");
    expect(migrateBlockers(once)).toBe(once);
    const empty = makeTask({ blockers: "" });
    expect(migrateBlockers(empty)).toBe(empty);
  });

  it("migrateBlockers keeps still-present open entries open when the text disagrees", () => {
    const log: BlockerEntry[] = [
      { id: 1, text: "A", createdAt: "2026-01-01T00:00:00Z" },
      { id: 2, text: "B", createdAt: "2026-01-02T00:00:00Z" },
    ];
    const once = migrateBlockers(makeTask({ blockers: "B\nC", blockerLog: log }));
    expect(once.blockerLog?.[0]).toEqual({ ...log[0], resolvedAt: "2026-03-04T00:00:00.000Z" });
    expect(once.blockerLog?.[1]).toBe(log[1]);
    expect(once.blockerLog?.[2]).toEqual({ id: 3, text: "C", createdAt: "2026-03-04T00:00:00.000Z" });
    expect(once.blockers).toBe("B\nC");
    expect(migrateBlockers(once)).toBe(once);
  });

  it("migrateBlockers returns the same reference when the text agrees with the log", () => {
    const t = withBlockerLog(makeTask(), [
      { id: 1, text: "A", createdAt: "2026-01-01T00:00:00Z" },
      { id: 2, text: "B", createdAt: "2026-01-02T00:00:00Z" },
    ]);
    expect(migrateBlockers(t)).toBe(t);
  });

  it("migrateBlockers treats CRLF and edge whitespace from a codec as agreeing", () => {
    const log: BlockerEntry[] = [
      { id: 1, text: "A", createdAt: "2026-01-01T00:00:00Z" },
      { id: 2, text: "B", createdAt: "2026-01-02T00:00:00Z" },
    ];
    for (const blockers of [" A\r\nB ", "A\r\nB", "A \nB\n", "\tA\nB"]) {
      const out = migrateBlockers(makeTask({ blockers, blockerLog: log }));
      expect(out.blockerLog, JSON.stringify(blockers)).toBe(log);
      expect(out.blockers).toBe("A\nB");
    }
  });

  it("migrateBlockers treats the derived text cut at the text cap as agreeing", () => {
    // Two open entries joined run past TEXTAREA_MAX, so a path that caps the
    // text (`sanitizeBlockers`) stores a prefix of the derived text.
    const log: BlockerEntry[] = [
      { id: 1, text: "a".repeat(TEXTAREA_MAX - 10), createdAt: "2026-01-01T00:00:00Z" },
      { id: 2, text: "b".repeat(200), createdAt: "2026-01-02T00:00:00Z" },
    ];
    const derived = blockersText(log);
    expect(derived.length).toBeGreaterThan(TEXTAREA_MAX);
    const capped = sanitizeBlockers(derived);
    const out = migrateBlockers(makeTask({ blockers: capped, blockerLog: log }));
    expect(out.blockerLog).toBe(log);
    expect(out.blockers).toBe(derived);
    expect(migrateBlockers(out)).toBe(out);
  });

  it("migrateBlockers agrees with a cap that drops an astral character whole", () => {
    // `sanitizeBlockers` backs the cut off by one rather than split a surrogate
    // pair; the log's own normaliser slices plainly, so the two prefixes differ.
    const log: BlockerEntry[] = [
      { id: 1, text: `${"a".repeat(TEXTAREA_MAX - 1)}\u{1F600}`, createdAt: "2026-01-01T00:00:00Z" },
      { id: 2, text: "b", createdAt: "2026-01-02T00:00:00Z" },
    ];
    const capped = sanitizeBlockers(blockersText(log));
    expect(capped).toBe("a".repeat(TEXTAREA_MAX - 1));
    expect(migrateBlockers(makeTask({ blockers: capped, blockerLog: log })).blockerLog).toBe(log);
  });

  it("migrateBlockers stamps a disagreement from the newest log time when lastUpdateDate is invalid, else the epoch", () => {
    const log: BlockerEntry[] = [
      { id: 1, text: "A", createdAt: "2026-01-01T00:00:00.000Z", resolvedAt: "2026-02-05T00:00:00.000Z" },
      { id: 2, text: "B", createdAt: "2026-01-03T00:00:00.000Z", editedAt: "2026-01-04T00:00:00.000Z" },
    ];
    const out = migrateBlockers(makeTask({ blockers: "X", lastUpdateDate: "bad", blockerLog: log }));
    expect(out.blockerLog?.[1]?.resolvedAt).toBe("2026-02-05T00:00:00.000Z");
    expect(out.blockerLog?.[2]).toEqual({ id: 3, text: "X", createdAt: "2026-02-05T00:00:00.000Z" });
    const bare = migrateBlockers(makeTask({ blockers: "X", lastUpdateDate: "", blockerLog: [] }));
    expect(bare.blockerLog).toEqual([{ id: 1, text: "X", createdAt: "1970-01-01T00:00:00.000Z" }]);
  });

  it("setBlockersText keeps open entries whose text is still present and adds the rest as one", () => {
    const log: BlockerEntry[] = [
      { id: 1, text: "A", createdAt: "2026-01-01T00:00:00Z" },
      { id: 2, text: "B", createdAt: "2026-01-02T00:00:00Z" },
    ];
    const t = withBlockerLog(makeTask(), log);
    const grown = setBlockersText(t, "A\nB\nC", ACTOR, NOW);
    expect(grown.blockerLog?.[0]).toBe(log[0]);
    expect(grown.blockerLog?.[1]).toBe(log[1]);
    expect(grown.blockerLog?.[2]).toEqual({ id: 3, text: "C", createdAt: NOW, authorResourceId: 7, authorName: "Ada" });
    expect(grown.blockers).toBe("A\nB\nC");
    const shrunk = setBlockersText(t, "B", ACTOR, NOW);
    expect(shrunk.blockerLog).toEqual([{ ...log[0], resolvedAt: NOW }, log[1]]);
    expect(shrunk.blockerLog?.[1]).toBe(log[1]);
    expect(shrunk.blockers).toBe("B");
  });

  it("setBlockersText matches a multi-line entry as a contiguous block, each entry at most once", () => {
    const log: BlockerEntry[] = [
      { id: 1, text: "X\nY", createdAt: "2026-01-01T00:00:00Z" },
      { id: 2, text: "Z", createdAt: "2026-01-02T00:00:00Z" },
      { id: 3, text: "Q", createdAt: "2026-01-03T00:00:00Z" },
      { id: 4, text: "Q", createdAt: "2026-01-04T00:00:00Z" },
    ];
    const t = withBlockerLog(makeTask(), log);
    const out = setBlockersText(t, "New\nX\nY\nQ\nZ more", {}, NOW);
    expect(out.blockerLog?.[0]).toBe(log[0]);
    expect(out.blockerLog?.[1]?.resolvedAt).toBe(NOW);
    expect(out.blockerLog?.[2]).toBe(log[2]);
    expect(out.blockerLog?.[3]?.resolvedAt).toBe(NOW);
    expect(out.blockerLog?.[4]).toEqual({ id: 5, text: "New\nZ more", createdAt: NOW });
    // "X" alone is not the whole block "X\nY": the entry is resolved.
    const split = setBlockersText(t, "X\nZ", {}, NOW);
    expect(split.blockerLog?.[0]?.resolvedAt).toBe(NOW);
    expect(split.blockerLog?.[1]).toBe(log[1]);
    expect(split.blockerLog?.[4]).toEqual({ id: 5, text: "X", createdAt: NOW });
  });

  it("setBlockersText with only a reordering of the open entries is a no-op", () => {
    const t = withBlockerLog(makeTask(), [
      { id: 1, text: "A", createdAt: "2026-01-01T00:00:00Z" },
      { id: 2, text: "B", createdAt: "2026-01-02T00:00:00Z" },
    ]);
    expect(setBlockersText(t, "B\nA", ACTOR, NOW)).toBe(t);
  });

  it("setBlockersText with the derived text cut at the cap is a no-op", () => {
    const t = withBlockerLog(makeTask(), [
      { id: 1, text: "a".repeat(TEXTAREA_MAX - 10), createdAt: "2026-01-01T00:00:00Z" },
      { id: 2, text: "b".repeat(200), createdAt: "2026-01-02T00:00:00Z" },
    ]);
    expect(setBlockersText(t, sanitizeBlockers(t.blockers), ACTOR, NOW)).toBe(t);
    expect(setBlockersText(t, t.blockers, ACTOR, NOW)).toBe(t);
  });

  it("previewBlockersText shows the text the replace rule will store", () => {
    const stored = withBlockerLog(makeTask(), [{ id: 1, text: "A", createdAt: "2026-01-01T00:00:00Z" }]);
    expect(previewBlockersText(stored, "C\nA")).toBe("A\nC");
    expect(previewBlockersText(stored, " A ")).toBe("A");
    expect(previewBlockersText(stored, "")).toBe("");
    expect(previewBlockersText({ blockers: "legacy" }, "x\nlegacy")).toBe("legacy\nx");
    expect(previewBlockersText(undefined, "  new ")).toBe("new");
  });

  it("addBlocker ignores blank text", () => {
    const t = makeTask();
    expect(addBlocker(t, "   ", ACTOR, NOW)).toBe(t);
  });

  it("addBlocker appends an entry with the actor and a fresh id", () => {
    const t = withBlockerLog(makeTask(), [{ id: 3, text: "A", createdAt: "2026-01-01T00:00:00Z" }]);
    const out = addBlocker(t, " Hi ", ACTOR, NOW);
    expect(out.blockerLog?.[1]).toEqual({
      id: 4,
      text: "Hi",
      createdAt: NOW,
      authorResourceId: 7,
      authorName: "Ada",
    });
  });

  it("editBlocker refuses blank text", () => {
    const t = withBlockerLog(makeTask(), [{ id: 1, text: "A", createdAt: "2026-01-01T00:00:00Z" }]);
    expect(editBlocker(t, 1, "  ", NOW)).toBe(t);
  });

  it("editBlocker updates text and editedAt; unknown id returns the task", () => {
    const t = withBlockerLog(makeTask(), [{ id: 1, text: "A", createdAt: "2026-01-01T00:00:00Z" }]);
    const out = editBlocker(t, 1, " B ", NOW);
    expect(out.blockerLog?.[0]).toMatchObject({ text: "B", editedAt: NOW });
    expect(out.blockers).toBe("B");
    expect(editBlocker(t, 99, "B", NOW)).toBe(t);
  });

  it("editBlocker with unchanged text returns the task, stamping no editedAt", () => {
    const t = withBlockerLog(makeTask(), [{ id: 1, text: "A\nB", createdAt: "2026-01-01T00:00:00Z" }]);
    expect(editBlocker(t, 1, "A\nB", NOW)).toBe(t);
    expect(editBlocker(t, 1, " A\r\nB ", NOW)).toBe(t);
  });

  it("resolve, reopen and delete behave and return the task for no-ops", () => {
    const t = withBlockerLog(makeTask(), [{ id: 1, text: "A", createdAt: "2026-01-01T00:00:00Z" }]);
    const resolved = resolveBlocker(t, 1, NOW);
    expect(resolved.blockerLog?.[0].resolvedAt).toBe(NOW);
    expect(resolved.blockers).toBe("");
    expect(resolveBlocker(resolved, 1, "2027-01-01T00:00:00Z")).toBe(resolved);
    const reopened = reopenBlocker(resolved, 1);
    expect(reopened.blockerLog?.[0] && "resolvedAt" in reopened.blockerLog[0]).toBe(false);
    expect(reopened.blockers).toBe("A");
    expect(reopenBlocker(t, 1)).toBe(t);
    expect(resolveBlocker(t, 9, NOW)).toBe(t);
    expect(reopenBlocker(t, 9)).toBe(t);
    expect(deleteBlocker(t, 9)).toBe(t);
    const deleted = deleteBlocker(t, 1);
    expect(deleted.blockerLog).toEqual([]);
    expect(deleted.blockers).toBe("");
  });

  it("nextBlockerId never reuses an id after a delete", () => {
    expect(nextBlockerId(undefined)).toBe(1);
    expect(nextBlockerId([])).toBe(1);
    expect(
      nextBlockerId([
        { id: 1, text: "a", createdAt: "x" },
        { id: 5, text: "b", createdAt: "x" },
      ]),
    ).toBe(6);
  });

  it("sanitizeBlockerLog drops malformed entries and caps", () => {
    const ok = "2026-01-01T00:00:00Z";
    const out = sanitizeBlockerLog([
      "junk",
      null,
      { text: "no id", createdAt: ok },
      { id: NaN, text: "nan", createdAt: ok },
      { id: 2, text: "   ", createdAt: ok },
      { id: 3, text: "bad date", createdAt: "nope" },
      { id: 4, text: ` ${"x".repeat(TEXTAREA_MAX + 50)} `, createdAt: ok },
      { id: 5, text: "first", createdAt: ok },
      { id: 5, text: "dupe", createdAt: ok },
      { id: 6, text: "keep", createdAt: ok, resolvedAt: "bad", editedAt: "bad" },
    ]);
    expect(out?.map((e) => e.id)).toEqual([4, 5, 6]);
    expect(out?.[0].text).toHaveLength(TEXTAREA_MAX);
    expect(out?.[1].text).toBe("first");
    expect(out?.[2] && "resolvedAt" in out[2]).toBe(false);
    expect(out?.[2] && "editedAt" in out[2]).toBe(false);
  });

  it("sanitizeBlockerLog returns undefined for non-arrays and empty results", () => {
    expect(sanitizeBlockerLog("x")).toBeUndefined();
    expect(sanitizeBlockerLog(undefined)).toBeUndefined();
    expect(sanitizeBlockerLog([])).toBeUndefined();
    expect(sanitizeBlockerLog([{ id: 1, text: "", createdAt: "2026-01-01" }])).toBeUndefined();
  });

  it("sanitizeBlockerLog caps the list length and keeps author fields", () => {
    const raw = Array.from({ length: MAX_NOTE_ENTRIES + 5 }, (_, i) => ({
      id: i + 1,
      text: "t",
      createdAt: "2026-01-01T00:00:00Z",
    }));
    expect(sanitizeBlockerLog(raw)).toHaveLength(MAX_NOTE_ENTRIES);
    const one = sanitizeBlockerLog([
      { id: 1, text: "t", createdAt: "2026-01-01", authorResourceId: 3, authorName: " Bo " },
    ]);
    expect(one?.[0]).toMatchObject({ authorResourceId: 3, authorName: "Bo" });
  });

  it("CRLF legacy text migrates to LF and an unchanged LF save is a no-op", () => {
    const migrated = migrateBlockers(makeTask({ blockers: "A\r\nB\u0007" }));
    expect(migrated.blockerLog?.[0]?.text).toBe("A\nB");
    expect(migrated.blockers).toBe("A\nB");
    expect(setBlockersText(migrated, "A\nB", ACTOR, NOW)).toBe(migrated);
    // The add/edit paths normalise the same way.
    const added = addBlocker(makeTask(), "X\r\nY", ACTOR, NOW);
    expect(added.blockerLog?.[0]?.text).toBe("X\nY");
    expect(editBlocker(added, 1, "P\rQ", NOW).blockerLog?.[0]?.text).toBe("P\nQ");
  });

  it("applyTaskPatch routes blockers through the STORED row's log and keeps the history", () => {
    const stored = withBlockerLog(makeTask(), [
      { id: 1, text: "Old", createdAt: "2026-01-01T00:00:00Z", resolvedAt: "2026-01-02T00:00:00Z" },
      { id: 2, text: "Open", createdAt: "2026-01-03T00:00:00Z" },
    ]);
    const out = applyTaskPatch(stored, { blockers: "New", priority: "High" }, ACTOR, NOW);
    expect(out.priority).toBe("High");
    expect(out.blockers).toBe("New");
    expect(out.blockerLog).toEqual([
      { id: 1, text: "Old", createdAt: "2026-01-01T00:00:00Z", resolvedAt: "2026-01-02T00:00:00Z" },
      { id: 2, text: "Open", createdAt: "2026-01-03T00:00:00Z", resolvedAt: NOW },
      { id: 3, text: "New", createdAt: NOW, authorResourceId: 7, authorName: "Ada" },
    ]);
  });

  it("applyTaskPatch without blockers leaves the log untouched, and ignores a patch's stale log", () => {
    const log: BlockerEntry[] = [
      { id: 1, text: "Old", createdAt: "2026-01-01T00:00:00Z", resolvedAt: "2026-01-02T00:00:00Z" },
      { id: 2, text: "Open", createdAt: "2026-01-03T00:00:00Z" },
    ];
    const stored = withBlockerLog(makeTask(), log);
    const out = applyTaskPatch(stored, { priority: "Low", blockerLog: [] }, ACTOR, NOW);
    expect(out.priority).toBe("Low");
    expect(out.blockerLog).toBe(stored.blockerLog);
    expect(out.blockers).toBe("Open");
  });

  it("selfBlockerActor names the user's own resource, the attribution the notes window uses", () => {
    const resources = [{ id: 7, firstName: "Ada", lastName: "Lovelace" }];
    expect(selfBlockerActor(7, resources)).toEqual({ resourceId: 7, name: "Ada Lovelace" });
    expect(selfBlockerActor(9, resources)).toEqual({ resourceId: 9 });
    expect(selfBlockerActor(undefined, resources)).toEqual({});
    expect(selfBlockerActor(null, resources)).toEqual({});
  });

  it("setBlockersText keeps the indentation of the new entry's lines", () => {
    const out = setBlockersText(makeTask(), "Waiting:\n  - legal\n    - review", ACTOR, NOW);
    expect(out.blockerLog?.[0]?.text).toBe("Waiting:\n  - legal\n    - review");
    expect(out.blockers).toBe("Waiting:\n  - legal\n    - review");
  });

  it("setBlockersText still matches an open entry when the line's surrounding whitespace differs", () => {
    const log: BlockerEntry[] = [
      { id: 1, text: "A", createdAt: "2026-01-01T00:00:00Z" },
      { id: 2, text: "B\nC", createdAt: "2026-01-02T00:00:00Z" },
    ];
    const t = withBlockerLog(makeTask(), log);
    const out = setBlockersText(t, "  A\t\n B \n   C\nNew\n  - sub", ACTOR, NOW);
    expect(out.blockerLog?.[0]).toBe(log[0]);
    expect(out.blockerLog?.[1]).toBe(log[1]);
    expect(out.blockerLog?.[2]).toEqual({
      id: 3,
      text: "New\n  - sub",
      createdAt: NOW,
      authorResourceId: 7,
      authorName: "Ada",
    });
  });

  it("a load-minted entry never sorts before existing entries nor resolves before its creation", () => {
    const log: BlockerEntry[] = [
      { id: 1, text: "A", createdAt: "2026-06-01T00:00:00.000Z" },
      { id: 2, text: "Z", createdAt: "2026-05-01T00:00:00.000Z" },
    ];
    const out = migrateBlockers(makeTask({ blockers: "A\nNew", lastUpdateDate: "2026-03-04", blockerLog: log }));
    expect(out.blockerLog?.[1]?.resolvedAt).toBe("2026-06-01T00:00:00.000Z");
    expect(out.blockerLog?.[2]).toEqual({ id: 3, text: "New", createdAt: "2026-06-01T00:00:00.000Z" });
    expect(out.blockers).toBe("A\nNew");
    expect(migrateBlockers(out)).toBe(out);
    // A later lastUpdateDate still wins over an older log.
    const later = migrateBlockers(makeTask({ blockers: "A\nNew", lastUpdateDate: "2026-09-09", blockerLog: log }));
    expect(later.blockerLog?.[2]?.createdAt).toBe("2026-09-09T00:00:00.000Z");
  });

  it("setBlockersText with duplicate identical open entries keeps the oldest and resolves the other", () => {
    const log: BlockerEntry[] = [
      { id: 1, text: "A", createdAt: "2026-01-01T00:00:00Z" },
      { id: 2, text: "A", createdAt: "2026-01-02T00:00:00Z" },
    ];
    const t = withBlockerLog(makeTask(), log);
    const one = setBlockersText(t, "A", ACTOR, NOW);
    expect(one.blockerLog?.[0]).toBe(log[0]);
    expect(one.blockerLog?.[1]).toEqual({ ...log[1], resolvedAt: NOW });
    expect(one.blockers).toBe("A");
    const grown = setBlockersText(t, "A\nA\nB", ACTOR, NOW);
    expect(grown.blockerLog?.[0]).toBe(log[0]);
    expect(grown.blockerLog?.[1]).toBe(log[1]);
    expect(grown.blockerLog?.[2]).toMatchObject({ id: 3, text: "B", createdAt: NOW });
    expect(grown.blockerLog).toHaveLength(3);
  });

  it("setBlockersText does not match an open entry against a longer line", () => {
    const log: BlockerEntry[] = [{ id: 1, text: "A", createdAt: "2026-01-01T00:00:00Z" }];
    const out = setBlockersText(withBlockerLog(makeTask(), log), "AB", ACTOR, NOW);
    expect(out.blockerLog?.[0]).toEqual({ ...log[0], resolvedAt: NOW });
    expect(out.blockerLog?.[1]).toMatchObject({ id: 2, text: "AB", createdAt: NOW });
    expect(out.blockers).toBe("AB");
  });

  it("a text whose cap lands just after a space settles in one migrate", () => {
    // The cap falls on the space at index TEXTAREA_MAX - 1, so a cleaner that
    // only trimmed BEFORE slicing would keep a trailing space for the next pass.
    const legacy = `${"a".repeat(TEXTAREA_MAX - 1)} tail`;
    const once = migrateBlockers(makeTask({ blockers: legacy }));
    const text = once.blockerLog?.[0]?.text ?? "";
    expect(text).toBe("a".repeat(TEXTAREA_MAX - 1));
    expect(sanitizeBlockerLog(once.blockerLog)).toEqual(once.blockerLog);
    expect(setBlockersText(once, text, ACTOR, NOW)).toBe(once);
    expect(setBlockersText(once, legacy, ACTOR, NOW)).toBe(once);
  });
});
