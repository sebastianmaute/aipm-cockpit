import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

const loadTemplates = vi.hoisted(() => vi.fn());
const upsertTemplate = vi.hoisted(() => vi.fn(async () => {}));
const deleteTemplate = vi.hoisted(() => vi.fn(async () => {}));
const setDefaultTemplate = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("./comm-templates-store", () => ({ loadTemplates, upsertTemplate, deleteTemplate, setDefaultTemplate }));

import { useCommTemplates } from "./use-comm-templates";
import type { CommTemplate } from "./comm-templates";

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
