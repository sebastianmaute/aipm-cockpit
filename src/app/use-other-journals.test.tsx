// src/app/use-other-journals.test.tsx
//
// §632 — the hook that expires and lists unload journals under keys other than the one in scope,
// and the two notices task-manager mounts for it.
import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as diagnostics from "./diagnostics";
import * as download from "./download-json";
import { ExpiredJournalsBanner, OtherJournalsBanner } from "./notifications";
import { saveRegistry } from "./projects-registry";
import { UNLOAD_JOURNAL_MAX_AGE_MS, readUnloadJournal, writeUnloadJournal } from "./unload-journal";
import { otherJournalFileName, useOtherJournals, type OtherJournal } from "./use-other-journals";

const NOW = 1_800_000_000_000;
const OLD = NOW - UNLOAD_JOURNAL_MAX_AGE_MS - 1;

function put(projectKey: string, savedAt: number, tabId = "tab-a", workspace = `{"k":"${projectKey}"}`): void {
  expect(writeUnloadJournal({ projectKey, tabId, savedAt, baseFingerprint: "fp", workspace })).toBe(true);
}

beforeEach(() => {
  window.localStorage.clear();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.spyOn(diagnostics, "logDiag").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe("useOtherJournals", () => {
  it("does nothing until enabled, then expires the old ones once and lists the rest, newest first", () => {
    put("current", OLD);
    put("gone", OLD);
    put("p1", NOW - 10);
    put("p2", NOW - 5);
    const { result, rerender } = renderHook((p: { enabled: boolean }) =>
      useOtherJournals({ projectKey: "current", enabled: p.enabled, isPopout: false }), { initialProps: { enabled: false } });
    expect(result.current.others).toEqual([]);
    expect(readUnloadJournal("gone")).not.toBeNull();

    rerender({ enabled: true });
    expect(result.current.expiredCount).toBe(1);
    expect(readUnloadJournal("gone")).toBeNull();
    expect(readUnloadJournal("current")).not.toBeNull();
    expect(result.current.others.map((e) => e.journal.projectKey)).toEqual(["p2", "p1"]);
  });

  it("labels an entry with the registry project's name, else the key", () => {
    saveRegistry({ projects: [{ id: "p1", name: "Apollo", code: "AP", storageConfig: { kind: "local-json" } as never }], currentProjectId: "current" });
    put("p1", NOW - 10);
    put("turso", NOW - 5);
    const { result } = renderHook(() => useOtherJournals({ projectKey: "current", enabled: true, isPopout: false }));
    expect(result.current.others.map((e) => e.label)).toEqual(["turso", "Apollo"]);
  });

  it("sweeps only once per page, and re-lists without the new key in scope when it changes", () => {
    put("a", NOW - 10);
    put("b", NOW - 5);
    const { result, rerender } = renderHook((p: { projectKey: string }) =>
      useOtherJournals({ projectKey: p.projectKey, enabled: true, isPopout: false }), { initialProps: { projectKey: "a" } });
    expect(result.current.others.map((e) => e.journal.projectKey)).toEqual(["b"]);
    put("c", OLD);
    rerender({ projectKey: "b" });
    expect(result.current.others.map((e) => e.journal.projectKey)).toEqual(["a", "c"]);
    expect(result.current.expiredCount).toBe(0);
    expect(readUnloadJournal("c")).not.toBeNull();
  });

  it("never runs in a popout", () => {
    put("gone", OLD);
    put("p1", NOW);
    const { result } = renderHook(() => useOtherJournals({ projectKey: "current", enabled: true, isPopout: true }));
    expect(result.current.others).toEqual([]);
    expect(result.current.expiredCount).toBe(0);
    expect(readUnloadJournal("gone")).not.toBeNull();
  });

  it("Discard removes the listed record and its entry, but not a later write under the same key", () => {
    put("p1", NOW - 10);
    put("p2", NOW - 5);
    const { result } = renderHook(() => useOtherJournals({ projectKey: "current", enabled: true, isPopout: false }));
    const [p2, p1] = result.current.others;
    act(() => result.current.discard(p1));
    expect(readUnloadJournal("p1")).toBeNull();
    expect(result.current.others).toEqual([p2]);

    put("p2", NOW, "tab-b");
    act(() => result.current.discard(p2));
    expect(readUnloadJournal("p2")?.tabId).toBe("tab-b");
    expect(result.current.others).toEqual([]);
  });

  it("Dismiss hides the list for the page and keeps the records", () => {
    put("p1", NOW);
    const { result } = renderHook(() => useOtherJournals({ projectKey: "current", enabled: true, isPopout: false }));
    act(() => result.current.dismiss());
    expect(result.current.others).toEqual([]);
    expect(readUnloadJournal("p1")).not.toBeNull();
  });

  it("Download saves the record's workspace JSON under a safe file name", () => {
    const spy = vi.spyOn(download, "downloadJson").mockReturnValue(true);
    put("a/b:c", NOW, "tab-a", '{"ws":1}');
    const { result } = renderHook(() => useOtherJournals({ projectKey: "current", enabled: true, isPopout: false }));
    expect(result.current.download(result.current.others[0])).toBe(true);
    expect(spy).toHaveBeenCalledWith(`aipm-cockpit-unsaved-a_b_c-${new Date(NOW).toISOString().slice(0, 10)}.json`, '{"ws":1}');
  });
});

describe("otherJournalFileName", () => {
  it("keeps letters, digits, dash and underscore", () => {
    const journal = { v: 1 as const, projectKey: "Proj_1-x", tabId: "t", savedAt: Date.UTC(2026, 0, 2), baseFingerprint: "", workspace: "" };
    expect(otherJournalFileName(journal)).toBe("aipm-cockpit-unsaved-Proj_1-x-2026-01-02.json");
  });
});

function entry(projectKey: string, label: string, chars: number): OtherJournal {
  return { label, journal: { v: 1, projectKey, tabId: "t", savedAt: NOW, baseFingerprint: "", workspace: "x".repeat(chars) } };
}

describe("OtherJournalsBanner", () => {
  it("lists each entry with its size and calls Download / Discard / Dismiss with it", () => {
    const onDownload = vi.fn(() => true);
    const onDiscard = vi.fn();
    const onDismiss = vi.fn();
    const a = entry("p1", "Apollo", 3000);
    const b = entry("p2", "Zeus", 10);
    render(<OtherJournalsBanner lang="en-US" others={[a, b]} onDownload={onDownload} onDiscard={onDiscard} onDismiss={onDismiss} />);
    expect(screen.getByText(/^Apollo — saved .*, 3 KB$/)).toBeTruthy();
    expect(screen.getByText(/^Zeus — saved .*, 1 KB$/)).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "Download" })[1]);
    expect(onDownload).toHaveBeenCalledWith(b);
    fireEvent.click(screen.getAllByRole("button", { name: "Discard" })[0]);
    expect(onDiscard).toHaveBeenCalledWith(a);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(onDismiss).toHaveBeenCalled();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("says so when the browser refused the download", () => {
    render(<OtherJournalsBanner lang="en-US" others={[entry("p1", "Apollo", 1)]} onDownload={() => false} onDiscard={vi.fn()} onDismiss={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Download" }));
    expect(screen.getByRole("alert").textContent).toBe("The download could not be started.");
  });
});

describe("ExpiredJournalsBanner", () => {
  it("counts the removed drafts, singular and plural", () => {
    const { rerender } = render(<ExpiredJournalsBanner lang="en-US" count={1} onDismiss={vi.fn()} />);
    expect(screen.getByText("1 unsaved draft older than 30 days was removed from this browser.")).toBeTruthy();
    rerender(<ExpiredJournalsBanner lang="en-US" count={3} onDismiss={vi.fn()} />);
    expect(screen.getByText("3 unsaved drafts older than 30 days were removed from this browser.")).toBeTruthy();
  });
});
