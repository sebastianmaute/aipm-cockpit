import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { runMeetingReport } from "./report-call";
import { __resetToolChoiceFallbackForTests } from "../ai-forced-call";
import type { DashboardModel } from "../dashboard";
import type { MeetingReportCtx } from "./report-call";

const MODEL = {
  overall: { computed: "G", effective: "G", overridden: false },
  schedule: { computed: "G", effective: "G", overridden: false },
  budget: { computed: null, effective: null, overridden: false },
  scope: { computed: null, effective: null, overridden: false },
  changes: { pending: 0, approved: 0, implemented: 0, total: 0 },
  topChanges: [],
  progress: { total: 0, completed: 0, percent: 0, counts: { R: 0, A: 0, G: 0 } },
  burn: null,
  burndown: null,
  evm: {},
  topRaid: [],
  openRaidCount: 0,
  overdue: [],
  dueSoon: [],
  overdueMilestones: [],
  atRiskMilestones: [],
  dueSoonMilestones: [],
  recentActivity: [],
  narrative: { text: "" },
} as unknown as DashboardModel;

const CTX: MeetingReportCtx = { apiKey: "sk-ant-secret-123", model: "claude-x", lang: "en-US" };

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("runMeetingReport", () => {
  it("returns parsed HTML from the forced tool_use block", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [
          { type: "tool_use", name: "write_status_report", input: { html: "<h2>Exec</h2><p>All good.</p>" } },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const out = await runMeetingReport(MODEL, "Budget review", CTX);
    expect(out).toBe("<h2>Exec</h2><p>All good.</p>");

    // request assertions: forced tool + browser-access header
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect(init.headers["anthropic-dangerous-direct-browser-access"]).toBe("true");
    const body = JSON.parse(init.body);
    expect(body.tool_choice.name).toBe("write_status_report");
  });

  it("throws Error('429') without leaking key or body on !ok", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({ error: "rate limited sk-ant-secret-123" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(runMeetingReport(MODEL, "Agenda", CTX)).rejects.toThrow(/^429$/);
    try {
      await runMeetingReport(MODEL, "Agenda", CTX);
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).not.toContain("sk-ant");
      expect(msg).not.toContain("rate limited");
    }
  });

  it("throws 'parse' when no matching tool_use is present", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ content: [{ type: "text", text: "nope" }] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(runMeetingReport(MODEL, "Agenda", CTX)).rejects.toThrow(/^parse$/);
  });
});

// §701 — the report call has no fixed system prompt, so the guides are all of it.
describe("runMeetingReport guide text", () => {
  afterEach(() => vi.unstubAllGlobals());
  function stub() {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ content: [{ type: "tool_use", name: "write_status_report", input: { html: "<p>x</p>" } }] }),
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }
  const sys = (m: ReturnType<typeof stub>) =>
    JSON.parse(((m.mock.calls[0] as unknown[])[1] as RequestInit).body as string).system as unknown;
  it("sends the guide text as the system prompt", async () => {
    const m = stub();
    await runMeetingReport(MODEL, "Agenda", { ...CTX, guideText: "GUIDE-MARK" });
    expect(sys(m)).toEqual([{ type: "text", text: "GUIDE-MARK" }]);
  });
  it("sends no system prompt without one", async () => {
    const m = stub();
    await runMeetingReport(MODEL, "Agenda", CTX);
    expect(sys(m)).toBeUndefined();
  });
});

// §763 — under auto tool choice the model thinks first, and thinking plus a ~1.9k-token report overran
// 2048: the reply stopped at max_tokens with the tool input `{}`, and the user saw "Could not draft".
describe("runMeetingReport output budget (§763)", () => {
  afterEach(() => vi.unstubAllGlobals());
  const reply = (stop: string, input: unknown) => ({
    ok: true,
    json: async () => ({ stop_reason: stop, content: [{ type: "tool_use", name: "write_status_report", input }] }),
  });
  const budgets = (m: { mock: { calls: unknown[][] } }) =>
    m.mock.calls.map((c) => JSON.parse(String((c[1] as RequestInit).body)).max_tokens as number);

  it("asks for an output budget of 4096 tokens", async () => {
    const m = vi.fn().mockResolvedValue(reply("tool_use", { html: "<p>whole</p>" }));
    vi.stubGlobal("fetch", m);
    await expect(runMeetingReport(MODEL, "Agenda", CTX)).resolves.toBe("<p>whole</p>");
    expect(budgets(m)).toEqual([4096]);
  });

  it("asks once more with 8192 tokens when the reply was cut with an empty input, and returns that report", async () => {
    const m = vi.fn()
      .mockResolvedValueOnce(reply("max_tokens", {}))
      .mockResolvedValueOnce(reply("tool_use", { html: "<p>whole</p>" }));
    vi.stubGlobal("fetch", m);
    await expect(runMeetingReport(MODEL, "Agenda", CTX)).resolves.toBe("<p>whole</p>");
    expect(budgets(m)).toEqual([4096, 8192]);
  });

  it("never returns a cut reply's half report, even when its html parses", async () => {
    const m = vi.fn()
      .mockResolvedValueOnce(reply("max_tokens", { html: "<p>half</p>" }))
      .mockResolvedValueOnce(reply("max_tokens", { html: "<p>half again</p>" }));
    vi.stubGlobal("fetch", m);
    await expect(runMeetingReport(MODEL, "Agenda", CTX)).rejects.toThrow(/^parse$/);
    expect(budgets(m)).toEqual([4096, 8192]);
  });

  it("passes the caller's signal to the retry too", async () => {
    const controller = new AbortController();
    const m = vi.fn()
      .mockResolvedValueOnce(reply("max_tokens", {}))
      .mockResolvedValueOnce(reply("tool_use", { html: "<p>whole</p>" }));
    vi.stubGlobal("fetch", m);
    await runMeetingReport(MODEL, "Agenda", CTX, controller.signal);
    expect(m.mock.calls.map((c) => (c[1] as RequestInit).signal)).toEqual([controller.signal, controller.signal]);
  });

  it("does not retry a reply that was not cut", async () => {
    const m = vi.fn().mockResolvedValue(reply("tool_use", {}));
    vi.stubGlobal("fetch", m);
    await expect(runMeetingReport(MODEL, "Agenda", CTX)).rejects.toThrow(/^parse$/);
    expect(m).toHaveBeenCalledTimes(1);
  });
});

// §763 — the path the defect ran on: a model that refuses a forced tool_choice is asked with `auto`, plain
// first; a plain reply cut to `{}` breaks the schema, so the envelope re-asks it strict at the SAME budget
// and marks the tool strict; only a cut strict reply reaches this caller's retry, which then goes strict.
describe("runMeetingReport on a model that refuses a forced tool_choice (§763)", () => {
  beforeEach(() => __resetToolChoiceFallbackForTests());
  afterEach(() => {
    __resetToolChoiceFallbackForTests();
    vi.unstubAllGlobals();
  });
  const refused = () => ({
    ok: false,
    status: 400,
    json: async () => ({ error: { type: "invalid_request_error", message: 'tool_choice: type "tool" and "any" are not supported for this model.' } }),
  });
  const reply = (stop: string, input: unknown) => ({
    ok: true,
    json: async () => ({ stop_reason: stop, content: [{ type: "tool_use", name: "write_status_report", input }] }),
  });
  /** [tool_choice, strict tool, max_tokens] per request. */
  const shape = (m: { mock: { calls: unknown[][] } }) =>
    m.mock.calls.map((c) => {
      const b = JSON.parse(String((c[1] as RequestInit).body)) as { tool_choice: { type: string }; tools: { strict?: boolean }[]; max_tokens: number };
      return [b.tool_choice.type, b.tools[0]?.strict === true, b.max_tokens];
    });

  it("forced refused, plain cut to {}, strict cut too: the retry asks strict at 8192 and returns that report", async () => {
    const m = vi.fn()
      .mockResolvedValueOnce(refused())
      .mockResolvedValueOnce(reply("max_tokens", {}))
      .mockResolvedValueOnce(reply("max_tokens", { html: "<p>half</p>" }))
      .mockResolvedValueOnce(reply("tool_use", { html: "<p>whole</p>" }));
    vi.stubGlobal("fetch", m);
    await expect(runMeetingReport(MODEL, "Agenda", CTX)).resolves.toBe("<p>whole</p>");
    expect(shape(m)).toEqual([
      ["tool", false, 4096],
      ["auto", false, 4096],
      ["auto", true, 4096],
      ["auto", true, 8192],
    ]);
  });

  it("forced refused, plain cut to {}, strict whole: the strict reply is the report and there is no retry", async () => {
    const m = vi.fn()
      .mockResolvedValueOnce(refused())
      .mockResolvedValueOnce(reply("max_tokens", {}))
      .mockResolvedValueOnce(reply("tool_use", { html: "<p>whole</p>" }));
    vi.stubGlobal("fetch", m);
    await expect(runMeetingReport(MODEL, "Agenda", CTX)).resolves.toBe("<p>whole</p>");
    expect(shape(m)).toEqual([
      ["tool", false, 4096],
      ["auto", false, 4096],
      ["auto", true, 4096],
    ]);
  });

  it("ends in the parse error, never half a report, when the strict retry at 8192 is cut too", async () => {
    const m = vi.fn()
      .mockResolvedValueOnce(refused())
      .mockResolvedValueOnce(reply("max_tokens", {}))
      .mockResolvedValueOnce(reply("max_tokens", { html: "<p>half</p>" }))
      .mockResolvedValueOnce(reply("max_tokens", { html: "<p>half again</p>" }));
    vi.stubGlobal("fetch", m);
    await expect(runMeetingReport(MODEL, "Agenda", CTX)).rejects.toThrow(/^parse$/);
    expect(m).toHaveBeenCalledTimes(4);
  });
});
