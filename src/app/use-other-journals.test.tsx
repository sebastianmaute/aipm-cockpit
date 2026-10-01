// src/app/use-other-journals.test.tsx
//
// §632 — the hook that expires and lists unload journals under keys other than the one in scope,
// and the two notices task-manager mounts for it.
import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as diagnostics from "./diagnostics";
import * as download from "./download-json";
import { loadI18n, t } from "./i18n";
import { ExpiredJournalsBanner, OtherJournalsBanner } from "./notifications";
import { saveRegistry } from "./projects-registry";
import { UNLOAD_JOURNAL_MAX_AGE_MS, readUnloadJournal, writeUnloadJournal } from "./unload-journal";
import { otherJournalFileName, useOtherJournals, type OtherJournal, type UseOtherJournalsArgs } from "./use-other-journals";
import { UNLOAD_JOURNAL_TAB_ID } from "./use-unload-journal";

const NOW = 1_800_000_000_000;
const OLD = NOW - UNLOAD_JOURNAL_MAX_AGE_MS - 1;
const NONE: ReadonlySet<string> = new Set();

function put(projectKey: string, savedAt: number, tabId = "tab-a", workspace = `{"k":"${projectKey}"}`): void {
  expect(writeUnloadJournal({ projectKey, tabId, savedAt, baseFingerprint: "fp", workspace })).toBe(true);
}

/** Renders the hook with `current` in scope and its restore run, unless the props say otherwise. */
function renderOthers(initial: Partial<UseOtherJournalsArgs> = {}) {
  const base: UseOtherJournalsArgs = { projectKey: "current", restoredKeys: new Set(["current"]), enabled: true, isPopout: false };
  return renderHook((p: UseOtherJournalsArgs) => useOtherJournals(p), { initialProps: { ...base, ...initial } });
}

const keys = (list: readonly OtherJournal[]) => list.map((e) => e.journal.projectKey);

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
    const { result, rerender } = renderOthers({ enabled: false });
    expect(result.current.others).toEqual([]);
    expect(readUnloadJournal("gone")).not.toBeNull();

    rerender({ projectKey: "current", restoredKeys: new Set(["current"]), enabled: true, isPopout: false });
    expect(keys(result.current.expired)).toEqual(["gone"]);
    expect(readUnloadJournal("gone")).toBeNull();
    expect(readUnloadJournal("current")).not.toBeNull();
    expect(keys(result.current.others)).toEqual(["p2", "p1"]);
  });

  it("keeps the expired records in memory so they can still be downloaded, until dismissed", () => {
    const spy = vi.spyOn(download, "downloadJson").mockReturnValue(true);
    put("gone", OLD, "tab-a", '{"old":1}');
    const { result } = renderOthers();
    expect(result.current.download(result.current.expired[0])).toBe(true);
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("aipm-cockpit-unsaved-gone-"), '{"old":1}');
    act(() => result.current.dismissExpired());
    expect(result.current.expired).toEqual([]);
  });

  it("labels an entry with the registry project's name, else null", () => {
    saveRegistry({ projects: [{ id: "p1", name: "Apollo", code: "AP", storageConfig: { kind: "local-json" } as never }], currentProjectId: "current" });
    put("p1", NOW - 10);
    put("turso", NOW - 5);
    const { result } = renderOthers();
    expect(result.current.others.map((e) => e.label)).toEqual([null, "Apollo"]);
  });

  it("lists the key in scope when its restore did not run (an incomplete load, a project op), and never expires it", () => {
    put("current", OLD);
    put("p1", NOW);
    const { result } = renderOthers({ restoredKeys: NONE });
    expect(result.current.expired).toEqual([]);
    expect(keys(result.current.others)).toEqual(["p1", "current"]);
  });

  it("leaves out every key whose restore ran, re-listing when that set or the key in scope changes, and sweeps only once", () => {
    put("a", NOW - 10);
    put("b", NOW - 5);
    const { result, rerender } = renderOthers({ projectKey: "a", restoredKeys: new Set(["a"]) });
    expect(keys(result.current.others)).toEqual(["b"]);
    put("c", OLD);
    // A project op moves to "b" without a restore: "b" stays listed.
    rerender({ projectKey: "b", restoredKeys: new Set(["a"]), enabled: true, isPopout: false });
    expect(keys(result.current.others)).toEqual(["b", "c"]);
    expect(result.current.expired).toEqual([]);
    expect(readUnloadJournal("c")).not.toBeNull();
    // A later load of "b" runs its restore: "b" drops out.
    rerender({ projectKey: "b", restoredKeys: new Set(["a", "b"]), enabled: true, isPopout: false });
    expect(keys(result.current.others)).toEqual(["c"]);
  });

  it("leaves out a record this page wrote itself", () => {
    put("p1", NOW, UNLOAD_JOURNAL_TAB_ID);
    put("p2", NOW - 5);
    const { result } = renderOthers();
    expect(keys(result.current.others)).toEqual(["p2"]);
  });

  it("keeps showing the expiry and the list when a later load leaves the workspace unloaded", () => {
    put("gone", OLD);
    put("p1", NOW);
    const { result, rerender } = renderOthers();
    rerender({ projectKey: "current", restoredKeys: new Set(["current"]), enabled: false, isPopout: false });
    expect(keys(result.current.expired)).toEqual(["gone"]);
    expect(keys(result.current.others)).toEqual(["p1"]);
  });

  it("never runs in a popout", () => {
    put("gone", OLD);
    put("p1", NOW);
    const { result } = renderOthers({ isPopout: true });
    expect(result.current.others).toEqual([]);
    expect(result.current.expired).toEqual([]);
    expect(readUnloadJournal("gone")).not.toBeNull();
  });

  it("Discard removes the listed record and its entry", () => {
    put("p1", NOW - 10);
    put("p2", NOW - 5);
    const { result } = renderOthers();
    const [p2, p1] = result.current.others;
    act(() => result.current.discard(p1));
    expect(readUnloadJournal("p1")).toBeNull();
    expect(result.current.others).toEqual([p2]);
  });

  it("Discard keeps a later write under the same key and re-lists so that record shows", () => {
    put("p2", NOW - 5);
    const { result } = renderOthers();
    const [listed] = result.current.others;
    put("p2", NOW, "tab-b");
    act(() => result.current.discard(listed));
    expect(readUnloadJournal("p2")?.tabId).toBe("tab-b");
    expect(result.current.others.map((e) => e.journal.tabId)).toEqual(["tab-b"]);
  });

  it("Dismiss hides the list for the page and keeps the records", () => {
    put("p1", NOW);
    const { result } = renderOthers();
    act(() => result.current.dismiss());
    expect(result.current.others).toEqual([]);
    expect(readUnloadJournal("p1")).not.toBeNull();
  });

  it("Download saves the record's workspace JSON under a safe file name", () => {
    const spy = vi.spyOn(download, "downloadJson").mockReturnValue(true);
    put("a/b:c", NOW, "tab-a", '{"ws":1}');
    const { result } = renderOthers();
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

function entry(projectKey: string, label: string | null, chars: number): OtherJournal {
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
    expect(screen.getByText(/^Apollo — from .*, 3 KB$/)).toBeTruthy();
    expect(screen.getByText(/^Zeus — from .*, 1 KB$/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Download: Zeus" }));
    expect(onDownload).toHaveBeenCalledWith(b);
    fireEvent.click(screen.getByRole("button", { name: "Discard: Apollo" }));
    expect(onDiscard).toHaveBeenCalledWith(a);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(onDismiss).toHaveBeenCalled();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("names the entry whose download the browser refused, and clears it once one succeeds", () => {
    let ok = false;
    render(<OtherJournalsBanner lang="en-US" others={[entry("p1", "Apollo", 1)]} onDownload={() => ok} onDiscard={vi.fn()} onDismiss={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Download: Apollo" }));
    expect(screen.getByRole("alert").textContent).toBe("The download of Apollo could not be started.");
    ok = true;
    fireEvent.click(screen.getByRole("button", { name: "Download: Apollo" }));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("names an entry without a registry project by its key, translating browser and turso", () => {
    render(<OtherJournalsBanner lang="en-US" others={[entry("browser", null, 1), entry("turso", null, 1), entry("tp-9", null, 1)]}
      onDownload={vi.fn(() => true)} onDiscard={vi.fn()} onDismiss={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Discard: Browser workspace (no project)" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Discard: Turso workspace (no project)" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Discard: tp-9" })).toBeTruthy();
  });
});

describe("OtherJournalsBanner — §4 kept slots", () => {
  it("names a kept slot after its project, translating browser, and keeps two versions of one project row-unique", () => {
    const first = entry("browser:kept", null, 1);
    const second = { ...entry("browser:kept:1799999000000", null, 1), journal: { ...entry("browser:kept:1799999000000", null, 1).journal, savedAt: NOW - 3_600_000 } };
    const plain = entry("tp-9:kept", null, 1);
    render(<OtherJournalsBanner lang="en-US" others={[first, second, plain]} onDownload={vi.fn(() => true)} onDiscard={vi.fn()} onDismiss={vi.fn()} />);
    const discards = screen.getAllByRole("button", { name: /^Discard: / }).map((b) => b.getAttribute("aria-label"));
    expect(discards.filter((n) => n!.startsWith("Discard: Browser workspace (no project)"))).toHaveLength(2);
    expect(new Set(discards).size).toBe(discards.length); // row-unique
    expect(discards).toContain("Discard: tp-9"); // a lone entry keeps its plain name
    expect(screen.getAllByText(/^Browser workspace \(no project\) — not saved \(conflict\), from /)).toHaveLength(2);
  });

  it("marks a kept entry as not saved (conflict) and says reloading does not restore it, only while one is listed", () => {
    const hint = "Versions marked \"not saved (conflict)\" were refused because the project was changed in another tab or on another device. Reloading does not restore them; download one to recover your changes.";
    const { rerender } = render(<OtherJournalsBanner lang="en-US" others={[entry("p1:kept", "Apollo", 3000), entry("p2", "Zeus", 10)]}
      onDownload={vi.fn(() => true)} onDiscard={vi.fn()} onDismiss={vi.fn()} />);
    expect(screen.getByText(/^Apollo — not saved \(conflict\), from .*, 3 KB$/)).toBeTruthy();
    expect(screen.getByText(/^Zeus — from .*, 1 KB$/)).toBeTruthy(); // an ordinary draft keeps its wording
    expect(screen.getByText(hint)).toBeTruthy();
    // label-in-name: each button's name starts with its visible text, and stays row-unique
    expect(screen.getByRole("button", { name: "Download: Apollo" }).textContent).toBe("Download");
    expect(screen.getByRole("button", { name: "Discard: Apollo" }).textContent).toBe("Discard");
    rerender(<OtherJournalsBanner lang="en-US" others={[entry("p2", "Zeus", 10)]} onDownload={vi.fn(() => true)} onDiscard={vi.fn()} onDismiss={vi.fn()} />);
    expect(screen.queryByText(hint)).toBeNull();
  });

  it("renders the kept entry and its hint in German", async () => {
    await loadI18n("de");
    render(<OtherJournalsBanner lang="de" others={[entry("p1:kept:1799999000000", "Apollo", 1)]} onDownload={vi.fn(() => true)} onDiscard={vi.fn()} onDismiss={vi.fn()} />);
    expect(screen.getByText(/^Apollo — nicht gespeichert \(Konflikt\), vom .*, 1 KB$/)).toBeTruthy();
    expect(screen.getByText(/^Als "nicht gespeichert \(Konflikt\)" markierte Versionen wurden abgelehnt, weil das Projekt in einem anderen Tab oder auf einem anderen Gerät geändert wurde\./)).toBeTruthy();
    expect(t("de", "unloadJournalKeptHint")).not.toBe(t("en-US", "unloadJournalKeptHint"));
  });

  it("keeps two versions of one project row-unique when they were written in the same displayed minute", () => {
    // §4 — the date is shown to the minute, so two keeps 20 s apart still share it: an ordinal separates them.
    const first = entry("tp-9:kept", null, 1);
    const second = { ...entry("tp-9:kept:1799999980000", null, 1), journal: { ...entry("tp-9:kept:1799999980000", null, 1).journal, savedAt: NOW + 20_000 } };
    render(<OtherJournalsBanner lang="en-US" others={[first, second]} onDownload={vi.fn(() => true)} onDiscard={vi.fn()} onDismiss={vi.fn()} />);
    for (const verb of ["Download", "Discard"]) {
      const labels = screen.getAllByRole("button", { name: new RegExp(`^${verb}: `) }).map((b) => b.getAttribute("aria-label"));
      expect(labels).toHaveLength(2);
      expect(new Set(labels).size).toBe(2);
      expect(labels[1]).toMatch(/\(2\)$/);
    }
  });
});

describe("ExpiredJournalsBanner", () => {
  it("counts and names the removed drafts, singular and plural, offering Download but no Discard", () => {
    const onDownload = vi.fn(() => true);
    const one = entry("p1", "Apollo", 1);
    const { rerender } = render(<ExpiredJournalsBanner lang="en-US" expired={[one]} onDownload={onDownload} onDismiss={vi.fn()} />);
    expect(screen.getByText("1 unsaved draft older than 30 days was removed from this browser. You can still download it until you close this notice.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Download: Apollo" }));
    expect(onDownload).toHaveBeenCalledWith(one);
    expect(screen.queryByRole("button", { name: /^Discard/ })).toBeNull();

    const onDismiss = vi.fn();
    rerender(<ExpiredJournalsBanner lang="en-US" expired={[one, entry("p2", "Zeus", 1), entry("p3", null, 1)]} onDownload={onDownload} onDismiss={onDismiss} />);
    expect(screen.getByText("3 unsaved drafts older than 30 days were removed from this browser. You can still download them until you close this notice.")).toBeTruthy();
    expect(screen.getByText(/^Zeus — from /)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(onDismiss).toHaveBeenCalled();
  });
});
