import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useActionAnalysis } from "./use-action-analysis";

const ok = (body: unknown) => ({ ok: true, json: async () => body }) as unknown as Response;

describe("useActionAnalysis", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it("parses a successful tool_use response and stores the result", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      ok({ content: [{ type: "tool_use", name: "report_analysis", input: { summary: "s", actions: [] } }] }),
    );
    const { result } = renderHook(() => useActionAnalysis({ apiKey: "k", model: "m" }));
    let returned: unknown;
    await act(async () => { returned = await result.current.analyze("ctx"); });
    expect(returned).toEqual({ summary: "s", actions: [] });
    expect(result.current.result).toEqual({ summary: "s", actions: [] });
    expect(result.current.error).toBeNull();
  });

  it("sets a status-only error on HTTP failure (no key or body leaked)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: false, status: 500, json: async () => ({}) } as unknown as Response);
    const { result } = renderHook(() => useActionAnalysis({ apiKey: "secret-key", model: "m" }));
    await act(async () => { await result.current.analyze("ctx"); });
    expect(result.current.error).toBe("500");
    expect(result.current.error).not.toContain("secret-key");
  });

  it("classifies a 429 as the 'limit' token (Anthropic's own rate/usage limit)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({ error: { type: "rate_limit_error" } }),
    } as unknown as Response);
    const { result } = renderHook(() => useActionAnalysis({ apiKey: "k", model: "m" }));
    await act(async () => { await result.current.analyze("ctx"); });
    expect(result.current.error).toBe("limit");
  });

  it("errors 'no-key' when apiKey is blank", async () => {
    const { result } = renderHook(() => useActionAnalysis({ apiKey: "  ", model: "m" }));
    await act(async () => { await result.current.analyze("ctx"); });
    expect(result.current.error).toBe("no-key");
  });

  it("errors 'parse' on malformed tool output", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(ok({ content: [{ type: "text", text: "nope" }] }));
    const { result } = renderHook(() => useActionAnalysis({ apiKey: "k", model: "m" }));
    await act(async () => { await result.current.analyze("ctx"); });
    expect(result.current.error).toBe("parse");
  });

  it("collapses an arbitrary fetch error to 'network' (no URL leaked)", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new TypeError("Failed to fetch https://api.anthropic.com/v1/messages"),
    );
    const { result } = renderHook(() => useActionAnalysis({ apiKey: "k", model: "m" }));
    await act(async () => { await result.current.analyze("ctx"); });
    expect(result.current.error).toBe("network");
    expect(result.current.error).not.toContain("anthropic");
  });

  it("clear() resets result and error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      ok({ content: [{ type: "tool_use", name: "report_analysis", input: { summary: "s", actions: [] } }] }),
    );
    const { result } = renderHook(() => useActionAnalysis({ apiKey: "k", model: "m" }));
    await act(async () => { await result.current.analyze("ctx"); });
    act(() => result.current.clear());
    expect(result.current.result).toBeNull();
    expect(result.current.error).toBeNull();
  });
});
