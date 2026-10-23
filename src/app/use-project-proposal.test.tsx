import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useProjectProposal } from "./use-project-proposal";
import type { ReactNode } from "react";
import { ActionGuidesProvider } from "./action-guides-context";

// UTC+14, so a noon-UTC instant is already the next calendar day there: the
// prompt's "today" must be the user's local day, not the UTC one.
vi.mock("./timezone", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./timezone")>()),
  browserTimeZone: () => "Pacific/Kiritimati",
}));

const ai = { apiKey: "sk-test", model: "claude-sonnet-4-6" };

afterEach(() => vi.restoreAllMocks());

function mockFetchToolUse(input: unknown) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue({
    ok: true,
    json: async () => ({ content: [{ type: "tool_use", name: "propose_project", input }], stop_reason: "tool_use" }),
  } as Response);
}

describe("useProjectProposal", () => {
  it("returns a parsed proposal on a forced tool_use response", async () => {
    mockFetchToolUse({ meta: { name: "Alpha" }, features: [] });
    const { result } = renderHook(() => useProjectProposal(ai));
    let p: unknown;
    await act(async () => { p = await result.current.generate("a CRM project"); });
    expect((p as { meta: { name: string } }).meta.name).toBe("Alpha");
    expect(result.current.error).toBeNull();
  });

  it("sets error and resolves null on an HTTP failure", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: false, status: 401, text: async () => "nope" } as Response);
    const { result } = renderHook(() => useProjectProposal(ai));
    let p: unknown = "x";
    await act(async () => { p = await result.current.generate("x"); });
    expect(p).toBeNull();
    expect(result.current.error).toBe("401");
  });

  it("refuses with no-key when the API key is blank", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { result } = renderHook(() => useProjectProposal({ apiKey: "  ", model: "claude-sonnet-4-6" }));
    let p: unknown = "x";
    await act(async () => { p = await result.current.generate("x"); });
    expect(p).toBeNull();
    expect(result.current.error).toBe("no-key");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("sends a content-block array verbatim as the user message content", async () => {
    const fetchMock = mockFetchToolUse({ meta: { name: "P" }, features: [] });
    const { result } = renderHook(() => useProjectProposal(ai));
    const blocks = [
      { type: "text", text: "Create a project from this doc:" },
      { type: "document", source: { type: "base64", media_type: "application/pdf", data: "QUJD" } },
    ];
    await act(async () => { await result.current.generate(blocks as never); });
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.messages[0].content).toEqual(blocks); // array passed through, NOT stringified
  });

  it("passes the abort signal to fetch", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true, json: async () => ({ content: [] }),
    } as Response);
    const { result } = renderHook(() => useProjectProposal(ai));
    const ctrl = new AbortController();
    await act(async () => { await result.current.generate("hi", ctrl.signal); });
    expect((spy.mock.calls[0][1] as RequestInit).signal).toBe(ctrl.signal);
  });

  it("does not set an error when aborted", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new DOMException("aborted", "AbortError"));
    const { result } = renderHook(() => useProjectProposal(ai));
    const ctrl = new AbortController(); ctrl.abort();
    await act(async () => { await result.current.generate("hi", ctrl.signal); });
    expect(result.current.error).toBeNull();
  });

  it("tells the model the user's local date at the moment of the call", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-10-23T12:00:00Z"));
      const fetchMock = mockFetchToolUse({ meta: { name: "P" }, features: [] });
      const { result } = renderHook(() => useProjectProposal(ai));
      await act(async () => { await result.current.generate("March to February"); });
      const raw = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string).system as string | { text: string }[];
      const system = typeof raw === "string" ? raw : raw.map((b) => b.text).join("\n");
      expect(system).toContain("Today is 2026-10-24.");
    } finally {
      vi.useRealTimers();
    }
  });
});

// §701 — the wizard's proposal call reads the guides that target it from the
// root provider (the wizard renders inside it).
describe("useProjectProposal guide text", () => {
  it("appends the guides that target project creation, and only those", async () => {
    const fetchMock = mockFetchToolUse({ meta: { name: "P" }, features: [] });
    const guides = [
      { id: "p", name: "Phases", content: "PROPOSAL-MARK", enabled: true, priority: 10, scope: { targets: ["projectProposal" as const] }, builtIn: false },
      { id: "c", name: "Chat", content: "CHAT-ONLY", enabled: true, priority: 11, scope: {}, builtIn: false },
    ];
    const wrapper = ({ children }: { children: ReactNode }) => (
      <ActionGuidesProvider value={{ guides, groundInGuides: true, ready: true }}>{children}</ActionGuidesProvider>
    );
    const { result } = renderHook(() => useProjectProposal(ai), { wrapper });
    await act(async () => { await result.current.generate("x"); });
    const blocks = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string).system as { text: string }[];
    const system = blocks.map((b) => b.text).join("\n");
    expect(system).toContain("PROPOSAL-MARK");
    expect(system).not.toContain("CHAT-ONLY");
  });
});
