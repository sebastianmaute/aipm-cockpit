import { describe, expect, it } from "vitest";
import {
  addBlocker,
  blockersText,
  deleteBlocker,
  editBlocker,
  migrateBlockers,
  nextBlockerId,
  openBlockerCount,
  reopenBlocker,
  resolveBlocker,
  sanitizeBlockerLog,
  setBlockersText,
  withBlockerLog,
} from "./blocker-log";
import { MAX_NOTE_ENTRIES } from "./note-log-policy";
import { TEXTAREA_MAX } from "./sanitize-core";
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

  it("migrateBlockers lets the log win and is idempotent", () => {
    const t = makeTask({
      blockers: "old",
      blockerLog: [{ id: 1, text: "Fresh", createdAt: "2026-01-01T00:00:00Z" }],
    });
    const once = migrateBlockers(t);
    expect(once.blockers).toBe("Fresh");
    expect(migrateBlockers(once)).toEqual(once);
    expect(migrateBlockers(once)).toBe(once);
    const empty = makeTask({ blockers: "" });
    expect(migrateBlockers(empty)).toBe(empty);
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
});
