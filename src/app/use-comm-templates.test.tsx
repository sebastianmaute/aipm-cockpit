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
