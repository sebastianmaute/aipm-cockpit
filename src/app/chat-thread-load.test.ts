import { describe, it, expect } from "vitest";
import { mergeThreadsAfterLoad, resetThreadsAfterFailedLoad } from "./chat-thread-load";
import type { ChatThread } from "./chat-threads";

function thread(id: string, projectId = "p1"): ChatThread {
  return {
    id,
    projectId,
    name: `Thread ${id}`,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    history: [],
    display: [],
  };
}

describe("mergeThreadsAfterLoad", () => {
  it("adopts the first loaded thread when nothing live needs preserving", () => {
    const loaded = [thread("a"), thread("b")];
    const r = mergeThreadsAfterLoad(null, null, "p1", loaded, false);
    expect(r.stale).toBe(false);
    expect(r.next?.id).toBe("a");
    expect(r.updateThreads([thread("old")])).toEqual(loaded);
  });

  it("keeps the live conversation and merges when preserveLive is set", () => {
    const loaded = [thread("a")];
    const r = mergeThreadsAfterLoad("live", "live", "p1", loaded, true);
    expect(r.stale).toBe(true);
    expect(r.next).toBeNull();
  });

  it("keeps rows of this project that the load did not return", () => {
    const r = mergeThreadsAfterLoad("live", "live", "p1", [thread("a")], true);
    const merged = r.updateThreads([thread("minted"), thread("a")]);
    expect(merged.map((t) => t.id).sort()).toEqual(["a", "minted"]);
  });

  it("drops rows belonging to another project", () => {
    const r = mergeThreadsAfterLoad("live", "live", "p1", [thread("a")], true);
    const merged = r.updateThreads([thread("other", "p2")]);
    expect(merged.map((t) => t.id)).toEqual(["a"]);
  });

  it("treats a moved thread id as stale even when preserveLive is false", () => {
    const r = mergeThreadsAfterLoad("before", "after", "p1", [thread("a")], false);
    expect(r.stale).toBe(true);
  });
});

describe("resetThreadsAfterFailedLoad", () => {
  it("clears the list when nothing live needs preserving", () => {
    const r = resetThreadsAfterFailedLoad(null, null, "p1", false);
    expect(r.stale).toBe(false);
    expect(r.updateThreads([thread("a")])).toEqual([]);
  });

  it("keeps this project's rows when preserveLive is set", () => {
    const r = resetThreadsAfterFailedLoad("live", "live", "p1", true);
    expect(r.stale).toBe(true);
    expect(r.updateThreads([thread("a"), thread("other", "p2")]).map((t) => t.id)).toEqual(["a"]);
  });
});
