import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

const loadVersions = vi.hoisted(() => vi.fn());
const saveVersion = vi.hoisted(() => vi.fn(async () => {}));
const deleteVersion = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("./comm-template-versions-store", () => ({ loadVersions, saveVersion, deleteVersion }));

import { useCommTemplateVersions } from "./use-comm-template-versions";

const cfg = {} as never;

beforeEach(() => { loadVersions.mockReset(); loadVersions.mockResolvedValue([]); saveVersion.mockClear(); });

describe("useCommTemplateVersions", () => {
  it("inactive: empty, store not hit", async () => {
    const { result } = renderHook(() => useCommTemplateVersions({ active: false, config: cfg, templateId: "x" }));
    expect(result.current.versions).toEqual([]);
    expect(loadVersions).not.toHaveBeenCalled();
  });
  it("active with templateId: loads", async () => {
    loadVersions.mockResolvedValue([{ id: "x-v-1", templateId: "x", name: "v1", body: "<p>b</p>", isAuto: false, createdAt: "t" }]);
    const { result } = renderHook(() => useCommTemplateVersions({ active: true, config: cfg, templateId: "x" }));
    await waitFor(() => expect(result.current.versions.length).toBe(1));
    expect(loadVersions).toHaveBeenCalledWith(cfg, "x");
  });
  it("saveVersion inserts and prepends to state", async () => {
    const { result } = renderHook(() => useCommTemplateVersions({ active: true, config: cfg, templateId: "x" }));
    await waitFor(() => expect(loadVersions).toHaveBeenCalled());
    await act(async () => { await result.current.saveVersion("v2", "<p>c</p>", false); });
    expect(saveVersion).toHaveBeenCalledTimes(1);
    expect(result.current.versions[0]?.name).toBe("v2");
  });
});
