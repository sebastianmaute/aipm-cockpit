import { describe, it, expect, vi, afterEach } from "vitest";
import { runMeetingReport } from "./report-call";
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
