import { beforeEach, describe, expect, it } from "vitest";
import { forgetLostDraft, keepLostDraft, LOST_DRAFT_KEY, peekLostDrafts } from "./lost-draft";

beforeEach(() => sessionStorage.clear());

describe("lost-draft store", () => {
  it("keeps up to three texts per job, newest first", () => {
    for (const text of ["a", "b", "c", "d"]) keepLostDraft("k", { text, reason: "dropped" });
    expect(peekLostDrafts("k").map((d) => d.text)).toEqual(["d", "c", "b"]);
  });

  it("a text kept again moves to the front with its new reason, never twice", () => {
    keepLostDraft("k", { text: "a", reason: "notSaved" });
    keepLostDraft("k", { text: "b", reason: "dropped" });
    keepLostDraft("k", { text: "a", reason: "dropped" });
    expect(peekLostDrafts("k")).toEqual([{ text: "a", reason: "dropped" }, { text: "b", reason: "dropped" }]);
  });

  it("keeps each job apart and forgets one without touching the others", () => {
    keepLostDraft("k", { text: "a", reason: "dropped" });
    keepLostDraft("j", { text: "b", reason: "notSaved" });
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
