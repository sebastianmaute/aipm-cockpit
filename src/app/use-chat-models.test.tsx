import { describe, expect, it, vi, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useChatModels } from "./use-chat-models";

afterEach(() => vi.restoreAllMocks());

const KEY = "sk-ant-api03-AbC123_def-456GHI789jkl";

function mockFetchOnce(body: unknown, ok = true, status = 200) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue({
    ok,
    status,
    json: async () => body,
  } as Response);
}

describe("useChatModels", () => {
  it("returns live claude models (newest first) when enabled with a valid key", async () => {
    mockFetchOnce({
      data: [
        { id: "claude-opus-4-8", display_name: "Claude Opus 4.8", created_at: "2026-01-01T00:00:00Z" },
        { id: "claude-sonnet-4-6", display_name: "Claude Sonnet 4.6", created_at: "2025-06-01T00:00:00Z" },
      ],
    });
    const { result } = renderHook(() => useChatModels(KEY, true, "claude-sonnet-4-6"));
    await waitFor(() => expect(result.current.options.map((o) => o.id)).toEqual(["claude-opus-4-8", "claude-sonnet-4-6"]));
    expect(result.current.loaded).toBe(true);
  });

  it("sends the three Anthropic headers", async () => {
    const spy = mockFetchOnce({ data: [] });
    renderHook(() => useChatModels(KEY, true, "claude-sonnet-4-6"));
    await waitFor(() => expect(spy).toHaveBeenCalled());
    const init = spy.mock.calls[0][1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe(KEY);
    expect(headers["anthropic-version"]).toBeTruthy();
    expect(headers["anthropic-dangerous-direct-browser-access"]).toBe("true");
  });

  it("does NOT pre-fill from the registry on a non-2xx response — only the current selection, loaded=false", async () => {
    mockFetchOnce({}, false, 401);
    const { result } = renderHook(() => useChatModels(KEY, true, "claude-sonnet-4-6"));
    // No live poll → the dropdown holds ONLY the current selection (not the whole
    // offline registry), and `loaded` stays false so the UI can show the key hint.
    await waitFor(() => expect(result.current.options).toEqual([{ id: "claude-sonnet-4-6", label: expect.any(String) }]));
    expect(result.current.loaded).toBe(false);
  });

  it("aborts the in-flight request on unmount", async () => {
    let aborted = false;
    vi.spyOn(globalThis, "fetch").mockImplementation((_url, init) => {
      (init?.signal as AbortSignal).addEventListener("abort", () => { aborted = true; });
      return new Promise(() => {}); // never resolves
    });
    const { unmount } = renderHook(() => useChatModels(KEY, true, "claude-sonnet-4-6"));
    unmount();
    expect(aborted).toBe(true);
  });

  it("does not fetch when disabled or key absent/malformed", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    renderHook(() => useChatModels(KEY, false, "claude-sonnet-4-6"));
    renderHook(() => useChatModels("", true, "claude-sonnet-4-6"));
    renderHook(() => useChatModels("not-a-key", true, "claude-sonnet-4-6"));
    expect(spy).not.toHaveBeenCalled();
  });
});
