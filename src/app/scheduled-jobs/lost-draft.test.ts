import { beforeEach, describe, expect, it, vi } from "vitest";
import { addLostText, forgetLostDraft, LOST_DRAFT_KEY, peekLostDrafts, removeLostTexts, subscribeLostTexts } from "./lost-draft";

beforeEach(() => sessionStorage.clear());

describe("lost-draft store", () => {
  it("keeps up to five texts per job, newest first", () => {
    for (const text of ["a", "b", "c", "d", "e", "f"]) addLostText("k", { text, reason: "dropped" });
    expect(peekLostDrafts("k").map((d) => d.text)).toEqual(["f", "e", "d", "c", "b"]);
  });

  it("removes only the texts named (trimmed), leaving the others", () => {
    for (const text of ["a", "b", "c"]) addLostText("k", { text, reason: "dropped" });
    removeLostTexts("k", [" b "]);
    expect(peekLostDrafts("k").map((d) => d.text)).toEqual(["c", "a"]);
    removeLostTexts("k", ["c", "a"]);
    expect(sessionStorage.getItem(LOST_DRAFT_KEY)).toBeNull();
  });

  it("tells subscribers each text added or removed, and each forget, even when storage cannot be used", () => {
    const seen: unknown[] = [];
    const stop = subscribeLostTexts((id, change) => seen.push([id, change]));
    addLostText("k", { text: "a", reason: "dropped" });
    removeLostTexts("k", ["a"]);
    forgetLostDraft("k");
    const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    try {
      addLostText("k", { text: "b", reason: "notSaved" });
    } finally {
      set.mockRestore();
    }
    stop();
    addLostText("k", { text: "c", reason: "dropped" });
    expect(seen).toEqual([
      ["k", { added: { text: "a", reason: "dropped" } }],
      ["k", { removed: ["a"] }],
      ["k", { removed: "all" }],
      ["k", { added: { text: "b", reason: "notSaved" } }],
    ]);
  });

  it("a text kept again moves to the front with its new reason, never twice", () => {
    addLostText("k", { text: "a", reason: "notSaved" });
    addLostText("k", { text: "b", reason: "dropped" });
    addLostText("k", { text: "a", reason: "dropped" });
    expect(peekLostDrafts("k")).toEqual([{ text: "a", reason: "dropped" }, { text: "b", reason: "dropped" }]);
  });

  it("keeps each job apart and forgets one without touching the others", () => {
    addLostText("k", { text: "a", reason: "dropped" });
    addLostText("j", { text: "b", reason: "notSaved" });
    forgetLostDraft("k");
    expect(peekLostDrafts("k")).toEqual([]);
    expect(peekLostDrafts("j")).toEqual([{ text: "b", reason: "notSaved" }]);
    forgetLostDraft("j");
    expect(sessionStorage.getItem(LOST_DRAFT_KEY)).toBeNull();
  });

  it("ignores entries it cannot read, including the older single-entry shape", () => {
    sessionStorage.setItem(LOST_DRAFT_KEY, JSON.stringify({ k: { text: "a", reason: "dropped", base: "b" }, j: [{ text: 1 }, { text: "c", reason: "notSaved" }] }));
    expect(peekLostDrafts("k")).toEqual([]);
    expect(peekLostDrafts("j")).toEqual([{ text: "c", reason: "notSaved" }]);
    sessionStorage.setItem(LOST_DRAFT_KEY, "not json");
    expect(peekLostDrafts("j")).toEqual([]);
  });
});
