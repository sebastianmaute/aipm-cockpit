import { beforeEach, describe, expect, test } from "vitest";
import type { SearchResult } from "./global-search";
import {
  MAX_RECENTS,
  RECENTS_KEY,
  loadRecents,
  pushRecent,
  saveRecents,
} from "./search-recents";

function mk(over: Partial<SearchResult> = {}): SearchResult {
  return {
    type: "task",
    id: 1,
    view: "open-points",
    title: "A",
    subtitle: "",
    ...over,
  };
}

describe("search-recents", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  test("pushRecent onto empty list returns single-entry list", () => {
    const r1 = mk({ id: 1 });
    expect(pushRecent([], r1)).toEqual([r1]);
  });

  test("pushRecent prepends newest first", () => {
    const r1 = mk({ id: 1 });
    const r2 = mk({ id: 2 });
    expect(pushRecent([r1], r2)).toEqual([r2, r1]);
  });

  test("pushRecent dedupes by type+id, newest wins and moves to front", () => {
    const r1 = mk({ id: 1 });
    const r2 = mk({ id: 2 });
    const result = pushRecent([r1, r2], { ...r1, title: "changed" });
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ ...r1, title: "changed" });
    expect(result[1]).toEqual(r2);
  });

  test("pushRecent caps the list to MAX_RECENTS with newest at index 0", () => {
    let list: SearchResult[] = [];
    for (let i = 1; i <= 10; i++) {
      list = pushRecent(list, mk({ id: i }));
    }
    expect(list).toHaveLength(MAX_RECENTS);
    expect(list[0]).toEqual(mk({ id: 10 }));
  });

  test("loadRecents returns [] when nothing stored", () => {
    expect(loadRecents()).toEqual([]);
  });

  test("loadRecents returns [] on malformed JSON (no throw)", () => {
    localStorage.setItem(RECENTS_KEY, "not json{");
    expect(loadRecents()).toEqual([]);
  });

  test("loadRecents drops invalid entries, keeps valid ones", () => {
    const valid = mk({ id: 5 });
    localStorage.setItem(
      RECENTS_KEY,
      JSON.stringify([{ type: "bogus", id: 1 }, valid]),
    );
    expect(loadRecents()).toEqual([valid]);
  });

  test("saveRecents/loadRecents round-trip", () => {
    const r1 = mk({ id: 1 });
    const r2 = mk({ id: 2, type: "raid" });
    saveRecents([r1, r2]);
    expect(loadRecents()).toEqual([r1, r2]);
  });
});
