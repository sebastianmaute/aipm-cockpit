import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useTemplates } from "./use-templates";

afterEach(() => window.localStorage.clear());

describe("useTemplates", () => {
  it("merges built-ins with user templates", () => {
    const { result } = renderHook(() => useTemplates());
    expect(result.current.templates.length).toBeGreaterThanOrEqual(3);
    expect(result.current.userTemplates).toEqual([]);
  });
  it("adds, updates, and removes user templates", () => {
    const { result } = renderHook(() => useTemplates());
    act(() => result.current.addTemplate({ id: "u1", name: "Mine", features: [], fieldVisibility: {} }));
    expect(result.current.userTemplates.map((t) => t.id)).toContain("u1");
    act(() => result.current.updateTemplate("u1", { name: "Renamed" }));
    expect(result.current.userTemplates.find((t) => t.id === "u1")!.name).toBe("Renamed");
    act(() => result.current.removeTemplate("u1"));
    expect(result.current.userTemplates).toEqual([]);
  });
  it("duplicate of a built-in creates an editable user copy", () => {
    const { result } = renderHook(() => useTemplates());
    act(() => result.current.duplicateTemplate("builtin-minimal"));
    const copy = result.current.userTemplates[0];
    expect(copy.builtIn).toBeFalsy();
    expect(copy.id).not.toBe("builtin-minimal");
    expect(copy.name).toMatch(/Minimal/);
  });
  it("update/remove are no-ops on built-in ids", () => {
    const { result } = renderHook(() => useTemplates());
    act(() => result.current.removeTemplate("builtin-minimal"));
    expect(result.current.templates.some((t) => t.id === "builtin-minimal")).toBe(true);
  });
});
