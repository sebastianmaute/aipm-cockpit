import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import * as store from "./version-store";
import * as diagnostics from "./diagnostics";
import { useVersionHistory, isEmptyWorkspacePayload } from "./use-version-history";
import { changeKey, type RestoreSelection } from "./version-restore";
import type { VersionChange } from "./version-diff";
import { prepareRestoredVersion } from "./baseline-switch";
import type { BaselineEntry } from "./baseline-currency";
import type { Workspace } from "./workspace";
import type { BudgetCurrency } from "./types";
import { CAPTURE_FORMAT, readCaptureFormat } from "./version-capture-format";

vi.mock("./version-store", { spy: true });
vi.mock("./diagnostics", { spy: true });
const cfg = { url: "x", authToken: "t" } as never;

beforeEach(() => { vi.useFakeTimers(); localStorage.clear(); });
afterEach(() => { vi.clearAllMocks(); vi.restoreAllMocks(); vi.useRealTimers(); });

// Stable references so the hook's useCallback deps don't change every render
// (a fresh onError/getPayload each render would re-run the list effect → loop).
const stableOnError = vi.fn();
const stableGetPayload = () => '{"tasks":[1]}';

// §476 — `prepareVersion` is required; engine tests that are not about currency pass it through.
const identityPrepare = (v: Workspace) => v;
function args(over = {}) {
  return { config: cfg, projectId: "p1", enabled: true, idleMs: 1000, retention: 50,
    getPayload: stableGetPayload, onError: stableOnError, prepareVersion: identityPrepare, ...over };
}

// ★★★ THE END-TO-END PIN FOR THE CAPTURE MARKER, and the one test whose absence
// would let the whole mechanism become a silent no-op. Every other test around
// it passes whether or not a capture is stamped: an unstamped payload simply
// reads as format 1, which is the SAFE branch everywhere — nothing is deleted,
// no row is offered, no assertion fails. It is just permanently useless, because
// a restore can then never remove a record added since any capture. Only an
// assertion on what actually reaches the store can tell the two apart.
describe("useVersionHistory capture format", () => {
  // ★★ Shaped like real `workspaceToJson` output — `JSON.stringify(obj, null, 2)`
  // — because `stampCaptureFormat` deliberately leaves anything else UNCHANGED
  // rather than risk corrupting it. The one-line `stableGetPayload` above would
  // therefore pass this test's negative half for the wrong reason.
  const realistic = JSON.stringify({ tasks: [{ id: 1, title: "A" }], raid: [] }, null, 2);

  it("stamps the capture format onto the stored payload", async () => {
    const append = vi.spyOn(store, "appendVersion").mockResolvedValue();
    vi.spyOn(store, "pruneVersions").mockResolvedValue();
    vi.spyOn(store, "listVersionMeta").mockResolvedValue([]);
    const { result } = renderHook(() => useVersionHistory(args({ getPayload: () => realistic })));
    await act(async () => { await result.current.captureNow("checkpoint"); });
    expect(append).toHaveBeenCalledTimes(1);
    const stored = append.mock.calls[0][1].payload;
    expect(readCaptureFormat(stored)).toBe(CAPTURE_FORMAT);
    // Additive only: the workspace the payload described must survive intact.
    expect((JSON.parse(stored) as { tasks: unknown[] }).tasks).toEqual([{ id: 1, title: "A" }]);
  });
});

describe("useVersionHistory", () => {
  it("coalesces rapid saves into ONE auto capture after the idle window", async () => {
    const append = vi.spyOn(store, "appendVersion").mockResolvedValue();
    vi.spyOn(store, "pruneVersions").mockResolvedValue();
    vi.spyOn(store, "listVersionMeta").mockResolvedValue([]);
    const { result } = renderHook(() => useVersionHistory(args()));
    act(() => { result.current.notifySaved(); result.current.notifySaved(); result.current.notifySaved(); });
    expect(append).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(append).toHaveBeenCalledTimes(1);
    expect(append.mock.calls[0][1].trigger).toBe("auto");
  });

  it("skips capture when the payload is unchanged since the last version", async () => {
    const append = vi.spyOn(store, "appendVersion").mockResolvedValue();
    vi.spyOn(store, "pruneVersions").mockResolvedValue();
    vi.spyOn(store, "listVersionMeta").mockResolvedValue([]);
    const { result } = renderHook(() => useVersionHistory(args()));
    act(() => { result.current.notifySaved(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(append).toHaveBeenCalledTimes(1);
    act(() => { result.current.notifySaved(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(append).toHaveBeenCalledTimes(1); // unchanged → no 2nd capture
  });

  it("skips an auto capture when only volatile bookkeeping (localModifiedAt) changed", async () => {
    const append = vi.spyOn(store, "appendVersion").mockResolvedValue();
    vi.spyOn(store, "pruneVersions").mockResolvedValue();
    vi.spyOn(store, "listVersionMeta").mockResolvedValue([]);
    const base = { raid: [], absences: [], shifts: [], resources: [], roles: [], disciplines: [],
      grades: [], plan: {}, budgets: [], milestones: [], changes: [], stakeholders: [], status: {} };
    let payload = JSON.stringify({ tasks: [{ id: 1, taskName: "A", localModifiedAt: "2026-01-01T00:00:00.000Z" }], ...base });
    const { result } = renderHook(() => useVersionHistory(args({ getPayload: () => payload })));

    act(() => { result.current.notifySaved(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(append).toHaveBeenCalledTimes(1); // first snapshot

    // Same content, only the timestamp moved — the byte string differs but the
    // semantic diff is empty, so no new version should be written.
    payload = JSON.stringify({ tasks: [{ id: 1, taskName: "A", localModifiedAt: "2026-02-02T00:00:00.000Z" }], ...base });
    act(() => { result.current.notifySaved(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(append).toHaveBeenCalledTimes(1); // timestamp-only → no 2nd capture
  });

  it("skips an auto capture of a load-transient (empty workspace over a prior non-empty version)", async () => {
    const append = vi.spyOn(store, "appendVersion").mockResolvedValue();
    vi.spyOn(store, "pruneVersions").mockResolvedValue();
    vi.spyOn(store, "listVersionMeta").mockResolvedValue([]);
    const base = { raid: [], absences: [], shifts: [], resources: [], roles: [], disciplines: [],
      grades: [], plan: {}, budgets: [], milestones: [], changes: [], stakeholders: [], status: {} };
    let payload = JSON.stringify({ tasks: [{ id: 1, taskName: "A" }], ...base }); // full
    const { result } = renderHook(() => useVersionHistory(args({ getPayload: () => payload })));
    act(() => { result.current.notifySaved(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(append).toHaveBeenCalledTimes(1); // full snapshot captured

    // Project-switch transient: content arrays reset to [] before the new project
    // hydrates. This must NOT overwrite history with an empty version.
    payload = JSON.stringify({ tasks: [], ...base });
    act(() => { result.current.notifySaved(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(append).toHaveBeenCalledTimes(1); // empty transient → NOT captured
    const { readDiagLog } = await import("./diagnostics");
    expect(readDiagLog().some((e) => e.code === "version.skipEmptyTransientCapture")).toBe(true);
  });

  it("loadDiff logs version.compareEmptyPayload (and returns []) when a version payload is missing/empty", async () => {
    vi.spyOn(store, "listVersionMeta").mockResolvedValue([]);
    vi.spyOn(store, "loadVersionPayload").mockResolvedValue(null);
    const { result } = renderHook(() => useVersionHistory(args()));
    let diff: unknown;
    await act(async () => { diff = await result.current.loadDiff("v1", "now"); });
    expect(diff).toEqual([]);
    const { readDiagLog } = await import("./diagnostics");
    expect(readDiagLog().some((e) => e.code === "version.compareEmptyPayload")).toBe(true);
  });

  it("loadDiff logs version.compareParseFailed (and returns []) when a payload is truncated/malformed", async () => {
    vi.spyOn(store, "listVersionMeta").mockResolvedValue([]);
    // Truncated JSON — strict parse throws instead of silently degrading to empty.
    vi.spyOn(store, "loadVersionPayload").mockResolvedValue('{"tasks":[{"id":1,');
    const { result } = renderHook(() => useVersionHistory(args()));
    let diff: unknown;
    await act(async () => { diff = await result.current.loadDiff("v1", "now"); });
    expect(diff).toEqual([]);
    const { readDiagLog } = await import("./diagnostics");
    expect(readDiagLog().some((e) => e.code === "version.compareParseFailed")).toBe(true);
  });

  it("a MANUAL checkpoint still captures even an empty workspace (explicit user action)", async () => {
    const append = vi.spyOn(store, "appendVersion").mockResolvedValue();
    vi.spyOn(store, "pruneVersions").mockResolvedValue();
    vi.spyOn(store, "listVersionMeta").mockResolvedValue([]);
    const empty = JSON.stringify({ tasks: [], raid: [], absences: [], shifts: [], resources: [], roles: [],
      disciplines: [], grades: [], plan: {}, budgets: [], milestones: [], changes: [], stakeholders: [], status: {} });
    const { result } = renderHook(() => useVersionHistory(args({ getPayload: () => empty })));
    await act(async () => { await result.current.captureNow("empty checkpoint"); });
    expect(append).toHaveBeenCalledTimes(1); // manual always captures
  });

  it("isEmptyWorkspacePayload: true when all content lists empty (reference data ignored)", () => {
    const payload = JSON.stringify({ tasks: [], raid: [], milestones: [], stakeholders: [], resources: [],
      changes: [], budgets: [], absences: [], shifts: [], roles: [{ id: 1 }], disciplines: [{ id: 1 }],
      grades: [{ id: 1 }], plan: {}, status: {}, project: {} });
    expect(isEmptyWorkspacePayload(payload)).toBe(true);
  });
  it("isEmptyWorkspacePayload: false when a content list has items, and false on parse failure", () => {
    expect(isEmptyWorkspacePayload(JSON.stringify({ tasks: [{ id: 1, taskName: "A" }] }))).toBe(false);
    expect(isEmptyWorkspacePayload("{not json")).toBe(false);
  });
  it("isEmptyWorkspacePayload: false for a project holding only user-authored content", () => {
    // Each of these is a real project shape that captured NO version before:
    // the guard counted nine legacy lists and none of these three.
    expect(isEmptyWorkspacePayload(JSON.stringify({ documents: [{ id: 1, title: "Doc" }] }))).toBe(false);
    expect(isEmptyWorkspacePayload(JSON.stringify({ knowledgeItems: [{ id: "a", name: "K" }] }))).toBe(false);
    expect(isEmptyWorkspacePayload(JSON.stringify({ calendarEvents: [{ id: 1, title: "E" }] }))).toBe(false);
  });
  it("isEmptyWorkspacePayload: true for DERIVED slices alone", () => {
    // ★★ Deliberate, not an oversight. `insights` is written by a DEBOUNCED
    // detect effect whose timer can fire AFTER a project switch has reset the
    // content arrays, and `documentVersions` is derived from `documents`.
    // Counting either would let a stale write mark an empty transient
    // non-empty — re-opening the hole this guard exists to close.
    expect(isEmptyWorkspacePayload(JSON.stringify({ insights: [{ id: 1, key: "x" }] }))).toBe(true);
    expect(isEmptyWorkspacePayload(JSON.stringify({ documentVersions: [{ id: 1, documentId: 1 }] }))).toBe(true);
  });

  it("remove deletes a snapshot and refreshes the list", async () => {
    const del = vi.spyOn(store, "deleteVersion").mockResolvedValue();
    const list = vi.spyOn(store, "listVersionMeta").mockResolvedValue([]);
    const { result } = renderHook(() => useVersionHistory(args()));
    let ok: boolean | undefined;
    await act(async () => { ok = await result.current.remove("v1"); });
    expect(del).toHaveBeenCalledWith(cfg, "v1", "p1");
    expect(ok).toBe(true);
    expect(list).toHaveBeenCalled(); // refreshed
  });

  it("captureNow writes a manual version immediately with the label", async () => {
    const append = vi.spyOn(store, "appendVersion").mockResolvedValue();
    vi.spyOn(store, "pruneVersions").mockResolvedValue();
    vi.spyOn(store, "listVersionMeta").mockResolvedValue([]);
    const { result } = renderHook(() => useVersionHistory(args()));
    await act(async () => { await result.current.captureNow("Before review"); });
    expect(append).toHaveBeenCalledTimes(1);
    expect(append.mock.calls[0][1]).toMatchObject({ trigger: "manual", label: "Before review" });
  });

  it("stores a change-summary computed against the previous capture", async () => {
    const append = vi.spyOn(store, "appendVersion").mockResolvedValue();
    vi.spyOn(store, "pruneVersions").mockResolvedValue();
    vi.spyOn(store, "listVersionMeta").mockResolvedValue([]);
    const base = { raid: [], absences: [], shifts: [], resources: [], roles: [], disciplines: [],
      grades: [], plan: {}, budgets: [], milestones: [], changes: [], stakeholders: [], status: {} };
    let payload = JSON.stringify({ tasks: [{ id: 1, title: "A" }], ...base });
    const { result } = renderHook(() => useVersionHistory(args({ getPayload: () => payload })));
    await act(async () => { await result.current.captureNow("v1"); });
    expect(append.mock.calls[0][1].summary).toBeNull(); // first capture: no previous
    payload = JSON.stringify({ tasks: [{ id: 1, title: "B" }], ...base });
    await act(async () => { await result.current.captureNow("v2"); });
    expect(append.mock.calls[1][1].summary).toMatch(/Tasks \(1\)/);
  });

  it("does NOT auto-capture after a reload when nothing changed (seeds baseline from the latest stored version)", async () => {
    const base = { raid: [], absences: [], shifts: [], resources: [], roles: [], disciplines: [],
      grades: [], plan: {}, budgets: [], milestones: [], changes: [], stakeholders: [], status: {} };
    const payload = JSON.stringify({ tasks: [{ id: 1, title: "A" }], ...base });
    // History already has a version with this exact content (the prior session).
    vi.spyOn(store, "listVersionMeta").mockResolvedValue([
      { id: "v1", projectId: "p1", capturedAt: "2026-01-01T00:00:00.000Z", trigger: "auto", label: null, summary: null },
    ]);
    vi.spyOn(store, "loadVersionPayload").mockResolvedValue(payload);
    const append = vi.spyOn(store, "appendVersion").mockResolvedValue();
    vi.spyOn(store, "pruneVersions").mockResolvedValue();
    const { result } = renderHook(() => useVersionHistory(args({ getPayload: () => payload })));
    // Flush the mount refresh so the baseline seeds before the idle timer fires.
    await act(async () => { for (let i = 0; i < 6; i += 1) await Promise.resolve(); });
    act(() => { result.current.notifySaved(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(append).not.toHaveBeenCalled(); // unchanged since last stored version → no redundant capture
  });

  it("computes a summary for the FIRST capture of a session against the latest stored version", async () => {
    const base = { raid: [], absences: [], shifts: [], resources: [], roles: [], disciplines: [],
      grades: [], plan: {}, budgets: [], milestones: [], changes: [], stakeholders: [], status: {} };
    const stored = JSON.stringify({ tasks: [{ id: 1, title: "A" }], ...base });
    const current = JSON.stringify({ tasks: [{ id: 1, title: "B" }, { id: 2, title: "C" }], ...base });
    vi.spyOn(store, "listVersionMeta").mockResolvedValue([
      { id: "v1", projectId: "p1", capturedAt: "2026-01-01T00:00:00.000Z", trigger: "auto", label: null, summary: null },
    ]);
    vi.spyOn(store, "loadVersionPayload").mockResolvedValue(stored);
    const append = vi.spyOn(store, "appendVersion").mockResolvedValue();
    vi.spyOn(store, "pruneVersions").mockResolvedValue();
    const { result } = renderHook(() => useVersionHistory(args({ getPayload: () => current })));
    await act(async () => { for (let i = 0; i < 6; i += 1) await Promise.resolve(); });
    await act(async () => { await result.current.captureNow("v2"); });
    expect(append).toHaveBeenCalledTimes(1);
    expect(append.mock.calls[0][1].summary).toMatch(/Tasks \(2\)/); // 1 modified + 1 added, vs seeded baseline
  });

  it("is inert when disabled (off-Turso)", async () => {
    const append = vi.spyOn(store, "appendVersion").mockResolvedValue();
    const list = vi.spyOn(store, "listVersionMeta").mockResolvedValue([]);
    const { result } = renderHook(() => useVersionHistory(args({ enabled: false })));
    act(() => { result.current.notifySaved(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(append).not.toHaveBeenCalled();
    expect(list).not.toHaveBeenCalled();
  });

  // Regression: when inactive, the refresh callback must NOT churn `versions`
  // with a fresh [] each call. A new array is a state change that re-renders;
  // with an unstable caller arg (an inline onError, as the real call site had)
  // that re-creates `refresh`, the refresh effect re-runs and calls refresh
  // again — a mount-time whole-tree render loop (~1000 renders/sec) that froze
  // the app. The inactive path now returns the same reference, so it can't loop.
  it("inactive + unstable onError keeps versions stable and does not loop", async () => {
    vi.spyOn(store, "listVersionMeta").mockResolvedValue([]);
    let renders = 0;
    const { result } = renderHook(() => {
      renders += 1;
      // Fresh onError EVERY render — the production bug shape.
      return useVersionHistory(args({ enabled: false, onError: () => {} }));
    });
    const firstVersions = result.current.versions;
    // Flush the refresh effect's microtask chain several times.
    await act(async () => {
      for (let i = 0; i < 5; i += 1) await Promise.resolve();
    });
    expect(result.current.versions).toBe(firstVersions); // same ref → no churn
    expect(renders).toBeLessThan(5); // bounded, not a runaway loop
  });

  it("restore applies the reverted workspace and logs the restore", async () => {
    const base = { raid: [], absences: [], shifts: [], resources: [], roles: [], disciplines: [],
      grades: [], plan: {}, budgets: [], milestones: [], changes: [], stakeholders: [], status: {} };
    const version = JSON.stringify({ tasks: [{ id: 1, title: "Old" }], ...base });
    vi.spyOn(store, "loadVersionPayload").mockResolvedValue(version);
    vi.spyOn(store, "listVersionMeta").mockResolvedValue([]);
    const now = JSON.stringify({ tasks: [{ id: 1, title: "New" }], ...base });
    const applyWorkspace = vi.fn();
    const logActivity = vi.fn();
    const { result } = renderHook(() => useVersionHistory(args({ getPayload: () => now, applyWorkspace, logActivity })));
    let ok: boolean | undefined;
    // ★★ Build the key through `changeKey`, never a literal. It is
    // `JSON.stringify([collection, recordId])`, not a `${collection}:${id}`
    // join — a literal in the dead join format makes `applyRestore` miss the
    // change and `continue`, so the restore is a SILENT NO-OP that still
    // returns true and still logs `history.restore`. That is the exact failure
    // this test exists to catch, so the key must not be hand-spelled.
    await act(async () => { ok = await result.current.restore("v1", { [changeKey("tasks", 1)]: ["title"] }, "v1-label"); });
    expect(ok).toBe(true); // success is reported so the UI can clear its compare state
    expect(applyWorkspace).toHaveBeenCalledTimes(1);
    const applied = applyWorkspace.mock.calls[0][0];
    expect(applied.tasks[0].title).toBe("Old");
    expect(logActivity).toHaveBeenCalledWith("history.restore", 1, "v1-label");
  });

  // §476 pre-merge ruling — a restore converts the money it takes from a version into the CURRENT
  // currency (the switches made since the version's capture) and never changes `plan.currency`. The
  // hook hands the parsed version and its capture time to `prepareVersion` BEFORE the diff and the
  // merge, so whole-record and per-field restores both see converted values. Real `applyRestore`.
  describe("§476 — restore converts version money into the current currency", () => {
    const V1_AT = "2026-10-14T08:00:00.000Z";
    const PLAN = { startDate: "2026-01-01", endDate: "2026-12-31", granularity: "month" };
    const base = { raid: [], absences: [], shifts: [], resources: [], disciplines: [], grades: [],
      budgets: [], milestones: [], stakeholders: [], status: {}, tasks: [] };
    const role = (internalRate: number, externalRate: number) => ({ id: 3, disciplineId: 1, gradeId: 1, internalRate, externalRate });
    const chg = (costImpact: number) => ({ id: 7, title: "C", raisedDate: "2026-01-01", linkedTaskIds: [], linkedRaidIds: [], costImpact });
    const version = JSON.stringify({ ...base, plan: { ...PLAN, startDate: "2025-01-01", currency: "EUR" }, roles: [role(100, 150)], changes: [chg(1000)] });
    const meta = { id: "v1", projectId: "p1", capturedAt: V1_AT, trigger: "auto" as const, label: null, summary: null };
    async function restoreWith(history: BaselineEntry[], currency: BudgetCurrency, now: string, selection: RestoreSelection) {
      vi.spyOn(store, "loadVersionPayload").mockResolvedValue(version);
      vi.spyOn(store, "listVersionMeta").mockResolvedValue([meta]);
      const applyWorkspace = vi.fn();
      const prepareVersion = (v: Workspace, capturedAt: string | null) => prepareRestoredVersion(v, { history, capturedAt, currency, workdayHours: 8 });
      const { result } = renderHook(() => useVersionHistory(args({ getPayload: () => now, applyWorkspace, prepareVersion })));
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      expect(result.current.versions).toHaveLength(1); // control: the capture time is known
      await act(async () => { await result.current.restore("v1", selection, "v1-label"); });
      expect(applyWorkspace).toHaveBeenCalledTimes(1);
      return applyWorkspace.mock.calls[0][0] as Workspace;
    }
    const GBP_SWITCH: BaselineEntry[] = [{ from: "2026-10-14", at: "2026-10-14T09:00:00.000Z", currency: "GBP", perPrevious: 0.85 }];
    const nowGbp = JSON.stringify({ ...base, plan: { ...PLAN, currency: "GBP" }, roles: [role(170, 127.5)], changes: [chg(1700)] });

    // The compare vs "now" must show what a restore would write: rows, selections and the values
    // restored all come from the SAME converted version, or untouched money shows a spurious row.
    async function diffVsNow(history: BaselineEntry[], currency: BudgetCurrency, versionPayload: string, now: string) {
      vi.spyOn(store, "loadVersionPayload").mockResolvedValue(versionPayload);
      vi.spyOn(store, "listVersionMeta").mockResolvedValue([meta]);
      const prepareVersion = (v: Workspace, capturedAt: string | null) => prepareRestoredVersion(v, { history, capturedAt, currency, workdayHours: 8 });
      const { result } = renderHook(() => useVersionHistory(args({ getPayload: () => now, prepareVersion })));
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      expect(result.current.versions).toHaveLength(1); // control: the capture time is known
      let changes: VersionChange[] = [];
      await act(async () => { changes = await result.current.loadDiff("v1", "now"); });
      return changes;
    }

    it("a vs-now compare of a pre-switch version shows no row for untouched money and no currency row", async () => {
      const v = JSON.stringify({ ...base, plan: { ...PLAN, currency: "EUR" }, roles: [role(100, 150)], changes: [chg(1000)] });
      const changes = await diffVsNow(GBP_SWITCH, "GBP", v, JSON.stringify({ ...base, plan: { ...PLAN, currency: "GBP" }, roles: [role(85, 127.5)], changes: [chg(850)] }));
      expect(changes).toEqual([]);
    });

    it("a version missing from the loaded list falls back to factor 1 and logs it", async () => {
      vi.spyOn(store, "loadVersionPayload").mockResolvedValue(version);
      vi.spyOn(store, "listVersionMeta").mockResolvedValue([]);
      const prepareVersion = vi.fn((v: Workspace) => v);
      const { result } = renderHook(() => useVersionHistory(args({ getPayload: () => nowGbp, prepareVersion })));
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      await act(async () => { await result.current.loadDiff("v1", "now"); });
      expect(prepareVersion).toHaveBeenCalledWith(expect.anything(), null);
      expect(diagnostics.logDiag).toHaveBeenCalledWith("warn", "version.captureTimeUnknown", { versionId: "v1" });
    });

    it("a version-to-version compare stays raw", async () => {
      vi.spyOn(store, "loadVersionPayload").mockResolvedValue(version);
      vi.spyOn(store, "listVersionMeta").mockResolvedValue([meta]);
      const prepareVersion = vi.fn((v: Workspace) => v);
      const { result } = renderHook(() => useVersionHistory(args({ getPayload: () => nowGbp, prepareVersion })));
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      await act(async () => { await result.current.loadDiff("v1", "v2"); });
      expect(prepareVersion).not.toHaveBeenCalled();
    });

    it("a really-changed field shows the converted value the restore writes", async () => {
      const changes = await diffVsNow(GBP_SWITCH, "GBP", version, nowGbp);
      const roleRow = changes.find((c) => c.collection === "roles");
      expect(roleRow?.fields).toEqual([expect.objectContaining({ field: "internalRate", before: 85, after: 170 })]);
      const planRow = changes.find((c) => c.collection === "plan");
      expect(planRow?.fields.map((f) => f.field)).toEqual(["startDate"]); // no currency row
    });

    it("(1a) restoring the whole plan record from a pre-switch EUR version keeps GBP and restores the rest", async () => {
      const applied = await restoreWith(GBP_SWITCH, "GBP", nowGbp, { [changeKey("plan", null)]: "all" });
      expect(applied.plan.currency).toBe("GBP");
      expect(applied.plan.startDate).toBe("2025-01-01");
    });

    it("(1b) a per-field restore of one role rate and one costImpact converts them (EUR→GBP 0.85)", async () => {
      const applied = await restoreWith(GBP_SWITCH, "GBP", nowGbp, {
        [changeKey("roles", 3)]: ["internalRate"], [changeKey("changes", 7)]: ["costImpact"],
      });
      expect(applied.roles[0]).toMatchObject({ internalRate: 85, externalRate: 127.5 });
      expect(applied.changes?.[0]?.costImpact).toBe(850);
    });

    it("(2) after a non-cancelling round trip (EUR→USD 1.10→EUR 0.95) the restored rate carries the move", async () => {
      const trip: BaselineEntry[] = [
        { from: "2026-10-14", at: "2026-10-14T09:00:00.000Z", currency: "USD", perPrevious: 1.1 },
        { from: "2026-10-14", at: "2026-10-14T10:00:00.000Z", currency: "EUR", perPrevious: 0.95 },
      ];
      const nowEur = JSON.stringify({ ...base, plan: { ...PLAN, currency: "EUR" }, roles: [role(200, 150)], changes: [chg(1000)] });
      const applied = await restoreWith(trip, "EUR", nowEur, { [changeKey("roles", 3)]: ["internalRate"] });
      expect(applied.roles[0].internalRate).toBe(104.5);
    });
  });

  // §674 — a restored version can carry a RAID cause loop saved before the guard
  // existed. The restore repairs it as a load and logs it, rather than handing the
  // loop to the setter, which would break it against the current state.
  it("restore removes a RAID cause loop from the restored workspace and logs it as a load", async () => {
    const raidRow = (id: number, causedByRaidIds: number[]) => ({ id, category: "R", title: `R${id}`, status: "Open", linkedTaskIds: [], causedByRaidIds, stakeholderIds: [], raisedDate: "2026-01-01" });
    const base = { raid: [raidRow(1, [2]), raidRow(2, [1])], absences: [], shifts: [], resources: [], roles: [], disciplines: [],
      grades: [], plan: {}, budgets: [], milestones: [], changes: [], stakeholders: [], status: {} };
    vi.spyOn(store, "loadVersionPayload").mockResolvedValue(JSON.stringify({ tasks: [{ id: 1, title: "Old" }], ...base }));
    vi.spyOn(store, "listVersionMeta").mockResolvedValue([]);
    const now = JSON.stringify({ tasks: [{ id: 1, title: "New" }], ...base });
    const applyWorkspace = vi.fn();
    const { clearDiagLog, readDiagLog } = await import("./diagnostics");
    clearDiagLog();
    const { result } = renderHook(() => useVersionHistory(args({ getPayload: () => now, applyWorkspace })));
    await act(async () => { await result.current.restore("v1", { [changeKey("tasks", 1)]: ["title"] }, "v1-label"); });
    const applied = applyWorkspace.mock.calls[0][0];
    expect(applied.raid.map((r: { causedByRaidIds: number[] }) => r.causedByRaidIds)).toEqual([[2], []]);
    expect(readDiagLog().filter((e) => e.code === "raid.causeCycleBroken").map((e) => e.fields)).toEqual([{ count: 1, links: "2 caused by 1", on: "load" }]);
  });

  it("restore surfaces onError when the version payload could not be loaded (not silent)", async () => {
    vi.spyOn(store, "loadVersionPayload").mockResolvedValue(null);
    vi.spyOn(store, "listVersionMeta").mockResolvedValue([]);
    const append = vi.spyOn(store, "appendVersion").mockResolvedValue();
    const applyWorkspace = vi.fn();
    const onError = vi.fn();
    const { result } = renderHook(() => useVersionHistory(args({ onError, applyWorkspace })));
    let ok: boolean | undefined;
    await act(async () => { ok = await result.current.restore("v1", { [changeKey("tasks", 1)]: ["title"] }, "v1-label"); });
    expect(ok).toBe(false); // failure is reported so the UI keeps its compare state
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toBeInstanceOf(Error);
    expect(applyWorkspace).not.toHaveBeenCalled(); // never reached — no false "restored" UI
    expect(append).not.toHaveBeenCalled();
    const { readDiagLog } = await import("./diagnostics");
    expect(readDiagLog().some((e) => e.code === "history.restoreVersionMissing")).toBe(true);
  });

  it("loadDiff compares a version payload against the current workspace", async () => {
    const base = { raid: [], absences: [], shifts: [], resources: [], roles: [], disciplines: [],
      grades: [], plan: {}, budgets: [], milestones: [], changes: [], stakeholders: [], status: {} };
    const older = JSON.stringify({ tasks: [{ id: 1, title: "A" }], ...base });
    vi.spyOn(store, "loadVersionPayload").mockResolvedValue(older);
    vi.spyOn(store, "listVersionMeta").mockResolvedValue([]);
    const now = JSON.stringify({ tasks: [{ id: 1, title: "B" }], ...base });
    const { result } = renderHook(() => useVersionHistory(args({ getPayload: () => now })));
    let changes: unknown[] = [];
    await act(async () => { changes = await result.current.loadDiff("v1", "now"); });
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ collection: "tasks", recordId: 1, type: "modified" });
  });

  it("captures an immediate version of the restored state (no stale getPayload)", async () => {
    const base = { raid: [], absences: [], shifts: [], resources: [], roles: [], disciplines: [],
      grades: [], plan: {}, budgets: [], milestones: [], changes: [], stakeholders: [], status: {} };
    const version = JSON.stringify({ tasks: [{ id: 1, title: "Old" }], ...base });
    vi.spyOn(store, "loadVersionPayload").mockResolvedValue(version);
    vi.spyOn(store, "pruneVersions").mockResolvedValue();
    vi.spyOn(store, "listVersionMeta").mockResolvedValue([]);
    const append = vi.spyOn(store, "appendVersion").mockResolvedValue();
    const now = JSON.stringify({ tasks: [{ id: 1, title: "New" }], ...base });
    const { result } = renderHook(() => useVersionHistory(args({ getPayload: () => now, applyWorkspace: vi.fn(), logActivity: vi.fn() })));
    await act(async () => { await result.current.restore("v1", { [changeKey("tasks", 1)]: ["title"] }, "Baseline"); });
    expect(append).toHaveBeenCalledTimes(1);
    const captured = JSON.parse(append.mock.calls[0][1].payload);
    expect(captured.tasks[0].title).toBe("Old"); // the RESTORED state was captured
  });
});

// Review Focus 4 (§620): a version payload holding a junk `steeringCommittee`
// (or any other slice that sanitizes to nothing) is diffed and restored
// through this file's `jsonToWorkspace(prev)` / `jsonToWorkspace(payload)`
// calls with no decode failure ever recorded, because none of them pass a
// `diag` — so `writeVersion`'s diff gate and `restore` never pause saving on
// this hook's behalf. This is a STRUCTURAL PIN on that fact, not a behavioral
// one: it reads the module's own source and asserts no `jsonToWorkspace(`
// call's argument text contains `diag`, rather than exercising a diff/restore
// with a junk payload — version-history never opts INTO the pause mechanism
// at all, so the fact worth pinning is the absence of `diag` at every call
// site, which a source read states directly and a behavioral probe could only
// infer indirectly (and only for whichever slice the probe happens to pick).
describe("useVersionHistory — jsonToWorkspace never records a decode failure (§620)", () => {
  /** Bracket-matches from `${fnName}(` to its closing `)`, so a nested call
   *  like `jsonToWorkspace(getPayload())` is captured whole rather than
   *  truncated at the first `)`. */
  function callArgLists(src: string, fnName: string): string[] {
    const marker = `${fnName}(`;
    const out: string[] = [];
    let idx = src.indexOf(marker);
    while (idx !== -1) {
      let depth = 1;
      let i = idx + marker.length;
      while (depth > 0 && i < src.length) {
        if (src[i] === "(") depth++;
        else if (src[i] === ")") depth--;
        i++;
      }
      out.push(src.slice(idx + marker.length, i - 1));
      idx = src.indexOf(marker, i);
    }
    return out;
  }

  it("structural pin: no jsonToWorkspace( call in use-version-history.ts passes a diag", () => {
    const src = readFileSync(join(import.meta.dirname, "use-version-history.ts"), "utf8");
    const calls = callArgLists(src, "jsonToWorkspace");
    // Guards the pin itself against a future refactor silently deleting every
    // call this test means to cover.
    expect(calls.length).toBeGreaterThanOrEqual(6);
    for (const call of calls) expect(call).not.toMatch(/diag/);
  });
});
