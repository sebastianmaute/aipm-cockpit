// src/app/unload-journal.sweep.test.ts
//
// §632 — listing every unload journal in storage, and expiring the ones older
// than UNLOAD_JOURNAL_MAX_AGE_MS under keys other than the one in scope.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as diagnostics from "./diagnostics";
import {
  UNLOAD_JOURNAL_MAX_AGE_MS, UNLOAD_JOURNAL_PREFIX,
  clearUnloadJournal, expireUnloadJournals, listUnloadJournals, readUnloadJournal, writeUnloadJournal,
} from "./unload-journal";

const NOW = 1_800_000_000_000;

function put(projectKey: string, savedAt: number, tabId = "tab-a", workspace = `{"k":"${projectKey}"}`): void {
  expect(writeUnloadJournal({ projectKey, tabId, savedAt, baseFingerprint: "fp", workspace })).toBe(true);
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe("listUnloadJournals", () => {
  it("returns every readable journal, keyed by the storage key's suffix, and ignores other keys", () => {
    put("p1", NOW);
    put("turso", NOW - 5);
    window.localStorage.setItem("aipm-cockpit:settings", "{}");
    const listed = listUnloadJournals().map((j) => [j.projectKey, j.savedAt]).sort();
    expect(listed).toEqual([["p1", NOW], ["turso", NOW - 5]]);
  });

  it("reports the key's suffix even when the record names a different projectKey", () => {
    window.localStorage.setItem(`${UNLOAD_JOURNAL_PREFIX}real-key`, JSON.stringify({
      v: 1, projectKey: "other", tabId: "t", savedAt: NOW, baseFingerprint: "fp", workspace: "{}",
    }));
    expect(listUnloadJournals().map((j) => j.projectKey)).toEqual(["real-key"]);
  });

  it.each([1e16, -1e16])("treats a record whose savedAt %s is outside the Date range as malformed: removed and logged", (savedAt) => {
    const spy = vi.spyOn(diagnostics, "logDiag").mockImplementation(() => {});
    window.localStorage.setItem(`${UNLOAD_JOURNAL_PREFIX}far`, JSON.stringify({
      v: 1, projectKey: "far", tabId: "t", savedAt, baseFingerprint: "fp", workspace: "{}",
    }));
    expect(listUnloadJournals()).toEqual([]);
    expect(window.localStorage.getItem(`${UNLOAD_JOURNAL_PREFIX}far`)).toBeNull();
    expect(spy).toHaveBeenCalledWith("warn", "workspace.unloadJournalCorrupt", { projectKey: "far" });
  });

  it("accepts a savedAt at the edge of the Date range", () => {
    window.localStorage.setItem(`${UNLOAD_JOURNAL_PREFIX}edge`, JSON.stringify({
      v: 1, projectKey: "edge", tabId: "t", savedAt: 8.64e15, baseFingerprint: "fp", workspace: "{}",
    }));
    expect(listUnloadJournals().map((j) => j.projectKey)).toEqual(["edge"]);
  });

  it("leaves another version's record in place even when its fields changed shape", () => {
    const v3 = JSON.stringify({ v: 3, key: "k", body: {} });
    window.localStorage.setItem(`${UNLOAD_JOURNAL_PREFIX}v3`, v3);
    expect(listUnloadJournals()).toEqual([]);
    expect(window.localStorage.getItem(`${UNLOAD_JOURNAL_PREFIX}v3`)).toBe(v3);
  });

  it("drops a malformed record (as readUnloadJournal does) and leaves a future-version one in place", () => {
    vi.spyOn(diagnostics, "logDiag").mockImplementation(() => {});
    window.localStorage.setItem(`${UNLOAD_JOURNAL_PREFIX}bad`, "{not json");
    const v2 = JSON.stringify({ v: 2, projectKey: "v2", tabId: "t", savedAt: 1, baseFingerprint: "fp", workspace: "{}" });
    window.localStorage.setItem(`${UNLOAD_JOURNAL_PREFIX}v2`, v2);
    expect(listUnloadJournals()).toEqual([]);
    expect(window.localStorage.getItem(`${UNLOAD_JOURNAL_PREFIX}bad`)).toBeNull();
    expect(window.localStorage.getItem(`${UNLOAD_JOURNAL_PREFIX}v2`)).toBe(v2);
  });
});

describe("expireUnloadJournals", () => {
  it("removes and logs a journal under another key older than the max age, and keeps a younger one", () => {
    const spy = vi.spyOn(diagnostics, "logDiag").mockImplementation(() => {});
    put("old", NOW - UNLOAD_JOURNAL_MAX_AGE_MS - 1, "tab-a", "x".repeat(40));
    put("young", NOW - UNLOAD_JOURNAL_MAX_AGE_MS);
    const expired = expireUnloadJournals(NOW, "current");
    expect(expired.map((j) => j.projectKey)).toEqual(["old"]);
    expect(readUnloadJournal("old")).toBeNull();
    expect(readUnloadJournal("young")).not.toBeNull();
    expect(spy).toHaveBeenCalledWith("info", "workspace.unloadJournalExpired", {
      projectKey: "old", savedAt: NOW - UNLOAD_JOURNAL_MAX_AGE_MS - 1, size: 40,
    });
  });

  it("never expires the key in scope, however old", () => {
    vi.spyOn(diagnostics, "logDiag").mockImplementation(() => {});
    put("current", 1);
    expect(expireUnloadJournals(NOW, "current")).toEqual([]);
    expect(readUnloadJournal("current")).not.toBeNull();
  });

  it("never expires a journal dated in the future (clock skew)", () => {
    vi.spyOn(diagnostics, "logDiag").mockImplementation(() => {});
    put("ahead", NOW + UNLOAD_JOURNAL_MAX_AGE_MS * 3);
    expect(expireUnloadJournals(NOW, "current")).toEqual([]);
    expect(readUnloadJournal("ahead")).not.toBeNull();
  });

  it("the max age is thirty days", () => {
    expect(UNLOAD_JOURNAL_MAX_AGE_MS).toBe(30 * 24 * 60 * 60 * 1000);
  });
});

describe("clearUnloadJournal's result", () => {
  it("is true when it removed the record and false when the guard kept a newer one", () => {
    put("p", NOW, "tab-a");
    expect(clearUnloadJournal("p", { tabId: "tab-a", ifSavedAtAtMost: NOW - 1 })).toBe(false);
    expect(readUnloadJournal("p")).not.toBeNull();
    expect(clearUnloadJournal("p", { tabId: "tab-a", ifSavedAtAtMost: NOW })).toBe(true);
    expect(readUnloadJournal("p")).toBeNull();
  });
});
