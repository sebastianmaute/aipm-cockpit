import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

const loadTemplates = vi.hoisted(() => vi.fn());
const upsertTemplate = vi.hoisted(() => vi.fn(async () => {}));
const deleteTemplate = vi.hoisted(() => vi.fn(async () => {}));
const setDefaultTemplate = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("./comm-templates-store", () => ({ loadTemplates, upsertTemplate, deleteTemplate, setDefaultTemplate }));

import { useCommTemplates } from "./use-comm-templates";
import type { CommTemplate } from "./comm-templates";
import { PENDING_EDITS_PREFIX, pendingEditScope, resetPendingEditsForTests } from "./pending-edits";
import { readDiagLog, clearDiagLog } from "./diagnostics";

const cfg = {} as never;
const def: CommTemplate = { id: "d", category: "status-inquiry", name: "Def", body: "<p>hi</p>", isDefault: true, createdAt: "t", updatedAt: "t" };
const other: CommTemplate = { id: "o", category: "status-inquiry", name: "Other", body: "<p>no</p>", isDefault: false, createdAt: "t", updatedAt: "t" };

beforeEach(() => {
  loadTemplates.mockReset(); loadTemplates.mockResolvedValue([]);
  upsertTemplate.mockClear(); deleteTemplate.mockClear(); setDefaultTemplate.mockClear();
});

describe("useCommTemplates", () => {
  it("inactive: empty templates, resolveTemplateBody null, store not hit", async () => {
    const { result } = renderHook(() => useCommTemplates({ active: false, config: cfg }));
    expect(result.current.templates).toEqual([]);
    expect(result.current.resolveTemplateBody("status-inquiry")).toBeNull();
    expect(loadTemplates).not.toHaveBeenCalled();
  });
  it("active: loads, default body resolves, non-default does not win", async () => {
    loadTemplates.mockResolvedValue([other, def]);
    const { result } = renderHook(() => useCommTemplates({ active: true, config: cfg }));
    await waitFor(() => expect(result.current.templates.length).toBe(2));
    expect(result.current.resolveTemplateBody("status-inquiry")).toBe("<p>hi</p>");
    expect(result.current.resolveTemplateBody("stakeholder-update")).toBeNull();
  });
  it("create calls the store and appends", async () => {
    const { result } = renderHook(() => useCommTemplates({ active: true, config: cfg }));
    await waitFor(() => expect(loadTemplates).toHaveBeenCalled());
    await act(async () => { await result.current.create("stakeholder-update", "New", "<p>b</p>"); });
    expect(upsertTemplate).toHaveBeenCalledTimes(1);
    expect(result.current.templates.some((t) => t.name === "New")).toBe(true);
  });
  it("auto-defaults the first template in a category, not later ones", async () => {
    const { result } = renderHook(() => useCommTemplates({ active: true, config: cfg }));
    await waitFor(() => expect(loadTemplates).toHaveBeenCalled());
    await act(async () => { await result.current.create("status-inquiry", "First", "<p>a</p>"); });
    const first = result.current.templates.find((t) => t.name === "First")!;
    expect(first.isDefault).toBe(true);
    expect(result.current.resolveTemplateBody("status-inquiry")).toBe("<p>a</p>");
    await act(async () => { await result.current.create("status-inquiry", "Second", "<p>b</p>"); });
    expect(result.current.templates.find((t) => t.name === "Second")!.isDefault).toBe(false);
  });
  it("setDefault moves the default within the category", async () => {
    loadTemplates.mockResolvedValue([def, other]);
    const { result } = renderHook(() => useCommTemplates({ active: true, config: cfg }));
    await waitFor(() => expect(result.current.templates.length).toBe(2));
    await act(async () => { await result.current.setDefault("status-inquiry", "o"); });
    expect(setDefaultTemplate).toHaveBeenCalledWith(cfg, "status-inquiry", "o");
    expect(result.current.templates.find((t) => t.id === "o")!.isDefault).toBe(true);
    expect(result.current.templates.find((t) => t.id === "d")!.isDefault).toBe(false);
  });
});

// §626 — the pending-edits outbox for a template name and body.
describe("useCommTemplates — pending edits outbox", () => {
  const CFG = { httpUrl: "https://outbox-test.example.invalid", authToken: "secret-token" } as never;
  const scope = pendingEditScope("https://outbox-test.example.invalid", "templates");
  const storageKey = `${PENDING_EDITS_PREFIX}${scope}`;

  function seedEdits(...edits: Record<string, unknown>[]): void {
    const full = edits.map((e) => ({ v: 1, savedAt: Date.now(), ...e }));
    window.localStorage.setItem(storageKey, JSON.stringify(full));
  }
  const pagehide = () => window.dispatchEvent(new Event("pagehide"));
  const stored = (): unknown[] => JSON.parse(window.localStorage.getItem(storageKey) ?? "[]") as unknown[];
  const droppedLog = () => readDiagLog().filter((e) => e.code === "storage.pendingEditDropped");

  beforeEach(() => {
    window.localStorage.clear();
    resetPendingEditsForTests();
    clearDiagLog();
  });
  afterEach(() => {
    resetPendingEditsForTests();
    window.localStorage.clear();
  });

  async function renderLoaded(list: CommTemplate[] = [def]) {
    loadTemplates.mockResolvedValue(list);
    const rendered = renderHook(() => useCommTemplates({ active: true, config: CFG }));
    await waitFor(() => expect(rendered.result.current.templates).toHaveLength(list.length));
    return rendered;
  }

  it("an open name draft is written on pagehide", async () => {
    const { result } = await renderLoaded();
    act(() => result.current.trackDraft("d", "name", "Renamed"));
    pagehide();
    expect(stored()).toEqual([expect.objectContaining({ kind: "template-name", id: "d", base: "Def", value: "Renamed" })]);
  });

  it("an open body draft is written on pagehide", async () => {
    const { result } = await renderLoaded();
    act(() => result.current.trackDraft("d", "body", "<p>new</p>"));
    pagehide();
    expect(stored()).toEqual([expect.objectContaining({ kind: "template-body", id: "d", base: "<p>hi</p>", value: "<p>new</p>" })]);
  });

  it("a draft equal to the stored field is not kept", async () => {
    const { result } = await renderLoaded();
    act(() => result.current.trackDraft("d", "name", "Renamed"));
    act(() => result.current.trackDraft("d", "name", "Def"));
    pagehide();
    expect(stored()).toEqual([]);
  });

  it("a saved field is settled", async () => {
    const { result } = await renderLoaded();
    act(() => result.current.trackDraft("d", "name", "Renamed"));
    await act(async () => { await result.current.rename("d", "Renamed"); });
    pagehide();
    expect(stored()).toEqual([]);
  });

  it("a save that fails leaves the draft tracked", async () => {
    const { result } = await renderLoaded();
    upsertTemplate.mockRejectedValueOnce(new Error("network down"));
    act(() => result.current.trackDraft("d", "name", "Renamed"));
    await act(async () => { await result.current.rename("d", "Renamed").catch(() => {}); });
    pagehide();
    expect(stored()).toEqual([expect.objectContaining({ kind: "template-name", value: "Renamed" })]);
  });

  it("a save landing after a newer draft was typed keeps the newer draft", async () => {
    const { result } = await renderLoaded();
    let resolveSave: () => void = () => {};
    upsertTemplate.mockReturnValueOnce(new Promise<void>((r) => { resolveSave = r; }));
    act(() => result.current.trackDraft("d", "name", "First"));
    let saving: Promise<void> = Promise.resolve();
    act(() => { saving = result.current.rename("d", "First"); });
    act(() => result.current.trackDraft("d", "name", "Second"));
    await act(async () => { resolveSave(); await saving; });
    pagehide();
    expect(stored()).toEqual([expect.objectContaining({ kind: "template-name", value: "Second" })]);
  });

  it("a draft typed while an earlier save is in flight is based on the confirmed value, and replays", async () => {
    const { result } = await renderLoaded();
    upsertTemplate.mockReturnValueOnce(new Promise<void>(() => undefined));
    act(() => { void result.current.rename("d", "B"); });
    act(() => result.current.trackDraft("d", "name", "C"));
    pagehide();
    expect(stored()).toEqual([expect.objectContaining({ kind: "template-name", id: "d", base: "Def", value: "C" })]);
    upsertTemplate.mockClear();
    resetPendingEditsForTests();
    await renderLoaded();
    await waitFor(() => expect(upsertTemplate).toHaveBeenCalledWith(CFG, expect.objectContaining({ id: "d", name: "C" })));
  });

  it("typing back to the in-flight value keeps the edit tracked against the confirmed base", async () => {
    const { result } = await renderLoaded();
    upsertTemplate.mockReturnValueOnce(new Promise<void>(() => undefined));
    act(() => result.current.trackDraft("d", "name", "B"));
    act(() => { void result.current.rename("d", "B"); });
    act(() => result.current.trackDraft("d", "name", "C"));
    act(() => result.current.trackDraft("d", "name", "B"));
    pagehide();
    expect(stored()).toEqual([expect.objectContaining({ kind: "template-name", id: "d", base: "Def", value: "B" })]);
  });

  it("a draft equal to the confirmed value settles after a save resolved", async () => {
    const { result } = await renderLoaded();
    await act(async () => { await result.current.rename("d", "B"); });
    act(() => result.current.trackDraft("d", "name", "C"));
    act(() => result.current.trackDraft("d", "name", "B"));
    pagehide();
    expect(stored()).toEqual([]);
  });

  // R14. Writes resolve out of order; the confirmed value follows the order they were issued in.
  it("an older name save landing after a newer one does not move the confirmed name back", async () => {
    const { result } = await renderLoaded();
    let resolveFirst: () => void = () => {};
    let resolveSecond: () => void = () => {};
    upsertTemplate
      .mockReturnValueOnce(new Promise<void>((r) => { resolveFirst = r; }))
      .mockReturnValueOnce(new Promise<void>((r) => { resolveSecond = r; }));
    let first: Promise<void> = Promise.resolve();
    let second: Promise<void> = Promise.resolve();
    act(() => { first = result.current.rename("d", "B"); });
    act(() => { second = result.current.rename("d", "C"); });
    await act(async () => { resolveSecond(); await second; });
    await act(async () => { resolveFirst(); await first; });
    act(() => result.current.trackDraft("d", "name", "D"));
    pagehide();
    expect(stored()).toEqual([expect.objectContaining({ kind: "template-name", id: "d", base: "C", value: "D" })]);
  });

  it("an older save landing after a newer one does not settle the draft the newer one left", async () => {
    const { result } = await renderLoaded();
    let resolveFirst: () => void = () => {};
    let resolveSecond: () => void = () => {};
    upsertTemplate
      .mockReturnValueOnce(new Promise<void>((r) => { resolveFirst = r; }))
      .mockReturnValueOnce(new Promise<void>((r) => { resolveSecond = r; }));
    let first: Promise<void> = Promise.resolve();
    let second: Promise<void> = Promise.resolve();
    act(() => { first = result.current.rename("d", "B"); });
    act(() => { second = result.current.rename("d", "C"); });
    await act(async () => { resolveSecond(); await second; });
    act(() => result.current.trackDraft("d", "name", "B"));
    await act(async () => { resolveFirst(); await first; });
    pagehide();
    expect(stored()).toEqual([expect.objectContaining({ kind: "template-name", id: "d", base: "C", value: "B" })]);
  });

  // R18. Every upsert writes the whole row, so the newest issued write's row, name AND body, is the base.
  // §653. A rename sent while a body save is in flight carries that body, not the confirmed one.
  it("a rename sent while a body save is in flight carries the new body, so the name save that lands first holds both", async () => {
    const { result } = await renderLoaded();
    let resolveBody: () => void = () => {};
    upsertTemplate.mockReturnValueOnce(new Promise<void>((r) => { resolveBody = r; }));
    act(() => result.current.trackDraft("d", "body", "<p>new</p>"));
    let body: Promise<void> = Promise.resolve();
    act(() => { body = result.current.saveBody("d", "<p>new</p>"); });
    await act(async () => { await result.current.rename("d", "B"); });
    expect(upsertTemplate).toHaveBeenLastCalledWith(CFG, expect.objectContaining({ id: "d", name: "B", body: "<p>new</p>" }));
    await act(async () => { resolveBody(); await body; });
    expect(result.current.templates[0]).toEqual(expect.objectContaining({ name: "B", body: "<p>new</p>" }));
    act(() => result.current.trackDraft("d", "name", "D"));
    pagehide();
    // The body the name save carried has landed: its draft is settled, only the new name draft is left.
    expect(stored()).toEqual([expect.objectContaining({ kind: "template-name", id: "d", base: "B", value: "D" })]);
  });

  // §653 — a failed body save must not drop the body a still-pending rename carries.
  it("a body save that fails while a rename carrying its body is in flight: a third write still carries that body", async () => {
    const { result } = await renderLoaded();
    let rejectBody: (e: Error) => void = () => {};
    let resolveName: () => void = () => {};
    upsertTemplate
      .mockReturnValueOnce(new Promise<void>((_, rej) => { rejectBody = rej; }))
      .mockReturnValueOnce(new Promise<void>((r) => { resolveName = r; }));
    act(() => result.current.trackDraft("d", "body", "<p>Y</p>"));
    let body: Promise<void> = Promise.resolve();
    let name: Promise<void> = Promise.resolve();
    act(() => { body = result.current.saveBody("d", "<p>Y</p>").catch(() => {}); });
    act(() => { name = result.current.rename("d", "B"); });
    await act(async () => { rejectBody(new Error("offline")); await body; });

    await act(async () => { await result.current.rename("d", "C"); });
    expect(upsertTemplate).toHaveBeenLastCalledWith(CFG, expect.objectContaining({ name: "C", body: "<p>Y</p>" }));
    await act(async () => { resolveName(); await name; });
    expect(result.current.templates[0]).toEqual(expect.objectContaining({ name: "C", body: "<p>Y</p>" }));
  });

  // §653 — the pre-merge review's scenario: the two saves land IN ORDER, body first.
  it("a body save and a later rename landing in order keep the new body on the server and on screen", async () => {
    const { result } = await renderLoaded();
    let resolveBody: () => void = () => {};
    let resolveName: () => void = () => {};
    upsertTemplate
      .mockReturnValueOnce(new Promise<void>((r) => { resolveBody = r; }))
      .mockReturnValueOnce(new Promise<void>((r) => { resolveName = r; }));
    act(() => result.current.trackDraft("d", "body", "<p>Y</p>"));
    let body: Promise<void> = Promise.resolve();
    let name: Promise<void> = Promise.resolve();
    act(() => { body = result.current.saveBody("d", "<p>Y</p>"); });
    act(() => { name = result.current.rename("d", "B"); });
    await act(async () => { resolveBody(); await body; });
    await act(async () => { resolveName(); await name; });

    // The last write to land carried Y: nothing puts the old body back.
    expect(upsertTemplate).toHaveBeenLastCalledWith(CFG, expect.objectContaining({ name: "B", body: "<p>Y</p>" }));
    expect(result.current.templates[0]).toEqual(expect.objectContaining({ name: "B", body: "<p>Y</p>" }));
    await act(async () => { await result.current.saveBody("d", "<p>Z</p>"); });
    expect(upsertTemplate).toHaveBeenLastCalledWith(CFG, expect.objectContaining({ name: "B", body: "<p>Z</p>" }));
  });

  // R18 (c). A stale landing must not become the `existing` of the next write.
  it("a name save and a body save landing out of order leave the newest row on screen and in the next write", async () => {
    const { result } = await renderLoaded();
    let resolveBody: () => void = () => {};
    let resolveName: () => void = () => {};
    upsertTemplate
      .mockReturnValueOnce(new Promise<void>((r) => { resolveBody = r; }))
      .mockReturnValueOnce(new Promise<void>((r) => { resolveName = r; }));
    let body: Promise<void> = Promise.resolve();
    let name: Promise<void> = Promise.resolve();
    act(() => { body = result.current.saveBody("d", "<p>new</p>"); });
    act(() => { name = result.current.rename("d", "B"); });
    await act(async () => { resolveName(); await name; });
    await act(async () => { resolveBody(); await body; });

    // The row the newest write carried — the new name AND the in-flight body (§653) — which is what the
    // server holds in issue order; the older body save landing after it changes nothing.
    expect(result.current.templates[0]).toEqual(expect.objectContaining({ name: "B", body: "<p>new</p>" }));
    act(() => result.current.trackDraft("d", "name", "D"));
    act(() => result.current.trackDraft("d", "body", "<p>draft</p>"));
    pagehide();
    expect(stored()).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "template-name", base: "B" }),
      expect.objectContaining({ kind: "template-body", base: "<p>new</p>" }),
    ]));

    await act(async () => { await result.current.saveBody("d", "<p>third</p>"); });
    expect(upsertTemplate).toHaveBeenLastCalledWith(CFG, expect.objectContaining({ id: "d", name: "B", body: "<p>third</p>" }));
    await act(async () => { await result.current.rename("d", "E"); });
    expect(upsertTemplate).toHaveBeenLastCalledWith(CFG, expect.objectContaining({ id: "d", name: "E", body: "<p>third</p>" }));
  });

  it("a replay write still in flight keeps its edit, and the ones queued behind it, across a pagehide", async () => {
    seedEdits(
      { kind: "template-name", id: "d", base: "Def", value: "Replayed" },
      { kind: "template-body", id: "d", base: "<p>hi</p>", value: "<p>replayed</p>" },
    );
    upsertTemplate.mockReturnValueOnce(new Promise<void>(() => undefined));
    await renderLoaded();
    await waitFor(() => expect(upsertTemplate).toHaveBeenCalledTimes(1));
    pagehide();
    expect(stored()).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "template-name", id: "d", base: "Def", value: "Replayed" }),
      expect.objectContaining({ kind: "template-body", id: "d", base: "<p>hi</p>", value: "<p>replayed</p>" }),
    ]));
    expect(stored()).toHaveLength(2);
  });

  it("a replay write that lands settles its edit", async () => {
    seedEdits({ kind: "template-name", id: "d", base: "Def", value: "Replayed" });
    await renderLoaded();
    await waitFor(() => expect(upsertTemplate).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(upsertTemplate).toHaveReturned());
    await act(async () => { await Promise.resolve(); });
    pagehide();
    expect(stored()).toEqual([]);
  });

  it("a failed replay write is reported with kind and id only, and stays tracked", async () => {
    seedEdits({ kind: "template-name", id: "d", base: "Def", value: "Secret draft" });
    upsertTemplate.mockRejectedValueOnce(new Error("network down"));
    const onReplayFailure = vi.fn();
    loadTemplates.mockResolvedValue([def]);
    renderHook(() => useCommTemplates({ active: true, config: CFG, onReplayFailure }));
    await waitFor(() => expect(onReplayFailure).toHaveBeenCalledWith({ kind: "template-name", id: "d" }));
    const failed = readDiagLog().filter((e) => e.code === "storage.pendingEditReplayFailed");
    expect(failed).toHaveLength(1);
    expect(failed[0].fields).toEqual({ kind: "template-name", id: "d" });
    expect(JSON.stringify(readDiagLog())).not.toContain("Secret draft");
    pagehide();
    expect(stored()).toEqual([expect.objectContaining({ kind: "template-name", value: "Secret draft" })]);
  });

  it("a padded name is tracked as the commit saves it, so the save settles it", async () => {
    const { result } = await renderLoaded();
    act(() => result.current.trackDraft("d", "name", "  Renamed "));
    pagehide();
    expect(stored()).toEqual([expect.objectContaining({ kind: "template-name", value: "Renamed" })]);
    await act(async () => { await result.current.rename("d", "Renamed"); });
    pagehide();
    expect(stored()).toEqual([]);
  });

  it("a blank name draft settles instead of tracking", async () => {
    const { result } = await renderLoaded();
    act(() => result.current.trackDraft("d", "name", "Renamed"));
    act(() => result.current.trackDraft("d", "name", "   "));
    pagehide();
    expect(stored()).toEqual([]);
  });

  it("cancelling a body draft while its save is in flight keeps that save's edit tracked", async () => {
    const { result } = await renderLoaded();
    upsertTemplate.mockReturnValueOnce(new Promise<void>(() => undefined));
    act(() => result.current.trackDraft("d", "body", "<p>x</p>"));
    act(() => { void result.current.saveBody("d", "<p>x</p>"); });
    act(() => result.current.trackDraft("d", "body", "<p>hi</p>"));
    pagehide();
    expect(stored()).toEqual([expect.objectContaining({ kind: "template-body", base: "<p>hi</p>", value: "<p>x</p>" })]);
  });

  it("removing a template settles its name and body drafts", async () => {
    const { result } = await renderLoaded();
    act(() => result.current.trackDraft("d", "name", "Renamed"));
    act(() => result.current.trackDraft("d", "body", "<p>x</p>"));
    await act(async () => { await result.current.remove("d"); });
    pagehide();
    expect(stored()).toEqual([]);
  });

  it("nothing is tracked without a usable httpUrl", async () => {
    loadTemplates.mockResolvedValue([def]);
    const { result } = renderHook(() => useCommTemplates({ active: true, config: {} as never }));
    await waitFor(() => expect(result.current.templates).toHaveLength(1));
    act(() => result.current.trackDraft("d", "name", "Renamed"));
    pagehide();
    expect(window.localStorage.length).toBe(0);
  });

  it("the next load replays a name edit whose base matches", async () => {
    seedEdits({ kind: "template-name", id: "d", base: "Def", value: "Replayed" });
    const { result } = await renderLoaded();
    await waitFor(() => expect(upsertTemplate).toHaveBeenCalledWith(CFG, expect.objectContaining({ id: "d", name: "Replayed" })));
    await waitFor(() => expect(result.current.templates[0].name).toBe("Replayed"));
  });

  it("replays a name with the same trim the commit applies", async () => {
    seedEdits({ kind: "template-name", id: "d", base: "Def", value: "  Trimmed  " });
    await renderLoaded();
    await waitFor(() => expect(upsertTemplate).toHaveBeenCalledWith(CFG, expect.objectContaining({ name: "Trimmed" })));
  });

  it("a blank stored name is skipped while a body edit for the same template still applies", async () => {
    seedEdits(
      { kind: "template-name", id: "d", base: "Def", value: "   " },
      { kind: "template-body", id: "d", base: "<p>hi</p>", value: "<p>replayed</p>" },
    );
    const { result } = await renderLoaded();
    await waitFor(() => expect(upsertTemplate).toHaveBeenCalledTimes(1));
    expect(upsertTemplate).toHaveBeenCalledWith(CFG, expect.objectContaining({ name: "Def", body: "<p>replayed</p>" }));
    await waitFor(() => expect(result.current.templates[0].body).toBe("<p>replayed</p>"));
    expect(result.current.templates[0].name).toBe("Def");
  });

  it("a body edit whose base no longer matches is dropped as changed", async () => {
    seedEdits({ kind: "template-body", id: "d", base: "<p>stale</p>", value: "<p>draft</p>" });
    await renderLoaded();
    await waitFor(() => expect(droppedLog()).toHaveLength(1));
    expect(droppedLog()[0].fields).toEqual(expect.objectContaining({ reason: "changed", kind: "template-body", id: "d" }));
    expect(JSON.stringify(droppedLog())).not.toContain("draft");
    expect(upsertTemplate).not.toHaveBeenCalled();
  });

  it("an edit for a deleted template is dropped as missing", async () => {
    seedEdits({ kind: "template-name", id: "gone", base: "X", value: "Y" });
    await renderLoaded();
    await waitFor(() => expect(droppedLog()).toHaveLength(1));
    expect(droppedLog()[0].fields).toEqual(expect.objectContaining({ reason: "missing", id: "gone" }));
    expect(upsertTemplate).not.toHaveBeenCalled();
  });

  it("two stored edits for one template from two tabs: the first applies, the second is dropped as changed", async () => {
    seedEdits(
      { kind: "template-name", id: "d", base: "Def", value: "Tab A" },
      { kind: "template-name", id: "d", base: "Def", value: "Tab B" },
    );
    await renderLoaded();
    await waitFor(() => expect(droppedLog()).toHaveLength(1));
    expect(upsertTemplate).toHaveBeenCalledTimes(1);
    expect(upsertTemplate).toHaveBeenCalledWith(CFG, expect.objectContaining({ name: "Tab A" }));
    expect(droppedLog()[0].fields).toEqual(expect.objectContaining({ reason: "changed" }));
  });

  it("a refresh that succeeds after a failed first load replays the stored edit", async () => {
    seedEdits({ kind: "template-name", id: "d", base: "Def", value: "Replayed" });
    loadTemplates.mockRejectedValueOnce(new Error("offline"));
    const { result } = renderHook(() => useCommTemplates({ active: true, config: CFG }));
    await waitFor(() => expect(loadTemplates).toHaveBeenCalledTimes(1));
    expect(upsertTemplate).not.toHaveBeenCalled();
    loadTemplates.mockResolvedValue([def]);
    await act(async () => { await result.current.refresh(); });
    await waitFor(() => expect(upsertTemplate).toHaveBeenCalledWith(CFG, expect.objectContaining({ name: "Replayed" })));
  });
});
