import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useProjectProposal } from "./use-project-proposal";

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
});
