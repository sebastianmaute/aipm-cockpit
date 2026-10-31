import { afterEach, describe, expect, it, vi } from "vitest";
import "../test/ai-consent-live";
import { renderHook, act } from "@testing-library/react";
import { useProjectProposal } from "./use-project-proposal";
import { PROPOSAL_PEOPLE_PROTECTED_ERROR } from "./use-project-proposal";
import { setDisabledIntegrations } from "./integration-switches";
import { __setAiStatusRequestForTests } from "./ai-status-request";
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
  // AI people protection, Task 6 (R4): the project "Use AI" creates carries no override, so it protects its
  // people by default; the proposal reaches the wizard with no person in it. The positive control (allowed)
  // is in ai-project-proposal.people.test.ts.
  it("returns the proposal without its people, for a project that protects them by default", async () => {
    mockFetchToolUse({
      meta: { name: "Alpha", sponsor: "Zelda Quartz" }, features: [],
      seed: { tasks: [{ taskName: "Kick-off", dueDate: "2026-11-05", assignee: "Yuri Pell" }], resources: [{ firstName: "Yuri", lastName: "Pell" }] },
    });
    const { result } = renderHook(() => useProjectProposal(ai));
    let p: { meta: Record<string, unknown>; seed?: { tasks?: Record<string, unknown>[]; resources?: unknown[] } } | null = null;
    await act(async () => { p = (await result.current.generate("a CRM project")) as typeof p; });
    expect(p!.meta.name).toBe("Alpha");
    expect(p!.meta).not.toHaveProperty("sponsor");
    expect(p!.seed!.tasks![0]).toEqual({ taskName: "Kick-off", dueDate: "2026-11-05" });
    expect(p!.seed!.resources).toBeUndefined();
  });

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

  it("names a switched-off deployment by its message key", async () => {
    __setAiStatusRequestForTests(async () => new Response(JSON.stringify({ off: true, invalid: false, route: "direct" }), { status: 200 }));
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { result } = renderHook(() => useProjectProposal(ai));
    let p: unknown = "x";
    await act(async () => { p = await result.current.generate("x"); });
    expect(p).toBeNull();
    expect(result.current.error).toBe("aiDeploymentOff");
    expect(fetchSpy).not.toHaveBeenCalled();
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

  // The per-device time-zone override (settings.timezone) wins over the browser's zone.
  it("uses the time zone it is given over the browser's", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-10-23T12:00:00Z")); // 01:00 on the 23rd in UTC−11
      const fetchMock = mockFetchToolUse({ meta: { name: "P" }, features: [] });
      const { result } = renderHook(() => useProjectProposal({ ...ai, timeZone: "Pacific/Pago_Pago" }));
      await act(async () => { await result.current.generate("March to February"); });
      const raw = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string).system as string | { text: string }[];
      const system = typeof raw === "string" ? raw : raw.map((b) => b.text).join("\n");
      expect(system).toContain("Today is 2026-10-23.");
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

// §764 — a reply cut at the output budget is asked for once more at a larger one, and never read.
describe("useProjectProposal output budget (§764)", () => {
  const cutOr = (stop: string, input: unknown) =>
    ({ ok: true, json: async () => ({ stop_reason: stop, content: [{ type: "tool_use", name: "propose_project", input }] }) }) as unknown as Response;
  const budgets = (spy: { mock: { calls: unknown[][] } }) =>
    spy.mock.calls.map((c) => JSON.parse(String((c[1] as RequestInit).body)).max_tokens as number);
  const WHOLE = { meta: { name: "Alpha" }, features: [] };

  it("asks once more at 8192 when the reply was cut at 4096, and returns that proposal", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(cutOr("max_tokens", {})).mockResolvedValueOnce(cutOr("tool_use", WHOLE));
    const { result } = renderHook(() => useProjectProposal(ai));
    let p: unknown;
    await act(async () => { p = await result.current.generate("a CRM project"); });
    expect((p as { meta: { name: string } }).meta.name).toBe("Alpha");
    expect(budgets(spy)).toEqual([4096, 8192]);
  });

  it("never reads a reply cut at the retry budget too, even one that parses", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(cutOr("max_tokens", WHOLE));
    const { result } = renderHook(() => useProjectProposal(ai));
    let p: unknown = "unset";
    await act(async () => { p = await result.current.generate("a CRM project"); });
    expect(p).toBeNull();
    expect(result.current.error).toBe("parse");
    expect(budgets(spy)).toEqual([4096, 8192]);
  });
});

// Review 2, finding B: a deployment that forces people protection (AIPM_DISABLED_INTEGRATIONS=ai-people) covers
// the create-project wizard too. No people are known yet, so the dictionary is EMPTY, but the patterns still
// redact email addresses, phone numbers and IBANs, and an image or non-text document is refused before sending.
describe("useProjectProposal under a deployment that forces people protection (review 2, B)", () => {
  afterEach(() => setDisabledIntegrations([]));

  // A real Response: a protected reply is read once as text to restore the placeholders.
  function replyWith(input: unknown) {
    return vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(
      JSON.stringify({ content: [{ type: "tool_use", name: "propose_project", input }], stop_reason: "tool_use" }),
      { status: 200 },
    ));
  }
  const BRIEF = "Plan a CRM rollout for Acme. Contact jane.doe@acme.example or +49 170 1234567.";
  const bodyOf = (spy: ReturnType<typeof replyWith>) => String((spy.mock.calls[0]![1] as RequestInit).body);

  it("forced: the brief's email address and phone number are replaced by placeholders", async () => {
    setDisabledIntegrations(["ai-people"]);
    const spy = replyWith({ meta: { name: "CRM" }, features: [] });
    const { result } = renderHook(() => useProjectProposal(ai));
    let p: unknown = null;
    await act(async () => { p = await result.current.generate(BRIEF); });
    expect(p).not.toBeNull();
    const body = bodyOf(spy);
    expect(body).not.toContain("jane.doe@acme.example");
    expect(body).not.toContain("170 1234567");
    expect(body).toContain("[email 1]");
    expect(body).toContain("[phone 1]");
  });

  it("forced: an image is refused before anything is sent, with the protection's error", async () => {
    setDisabledIntegrations(["ai-people"]);
    const spy = replyWith({ meta: { name: "CRM" }, features: [] });
    const { result } = renderHook(() => useProjectProposal(ai));
    let p: unknown = "x";
    await act(async () => {
      p = await result.current.generate([
        { type: "text", text: "From this whiteboard:" },
        { type: "image", source: { type: "base64", media_type: "image/png", data: "iVBORw0KGgo=" } },
      ] as never);
    });
    expect(p).toBeNull();
    expect(result.current.error).toBe(PROPOSAL_PEOPLE_PROTECTED_ERROR);
    expect(spy).not.toHaveBeenCalled();
  });

  // The positive control: without the deployment lock the wizard sends the brief as written.
  it("not forced: the brief is sent as written", async () => {
    const spy = replyWith({ meta: { name: "CRM" }, features: [] });
    const { result } = renderHook(() => useProjectProposal(ai));
    await act(async () => { await result.current.generate(BRIEF); });
    expect(bodyOf(spy)).toContain("jane.doe@acme.example");
    expect(bodyOf(spy)).toContain("+49 170 1234567");
  });
});
