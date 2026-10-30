import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useMeetingReportActions, type MeetingReportActionsDeps } from "./use-meeting-report-actions";
import type { SteeringCommittee, Resource } from "./types";
import type { DashboardModel } from "./dashboard";
import { defaultSettings } from "./settings-types";
import { AiGatewayError, AiHttpError } from "./ai-errors";
import { t } from "./i18n";
import { clearDiagLog, readDiagLog } from "./diagnostics";

const sendMail = vi.fn<(token: string, msg: unknown) => Promise<void>>(async () => {});
const runMeetingReport = vi.fn<() => Promise<string>>(async () => "<p>ai draft</p>");
vi.mock("./committee-report/report-call", () => ({
  runMeetingReport: (...args: unknown[]) => runMeetingReport(...(args as [])),
}));
const saveVersion = vi.fn<() => Promise<void>>(async () => {});
const loadVersionsFn = vi.fn<() => Promise<unknown[]>>(async () => []);
vi.mock("./committee-report-versions-store", () => ({
  saveVersion: (...a: unknown[]) => saveVersion(...(a as [])),
  loadVersions: (...a: unknown[]) => loadVersionsFn(...(a as [])),
}));
vi.mock("./graph-mail", () => ({
  MAIL_SEND_SCOPE: ["Mail.Send"],
  buildGraphMessage: (to: unknown, subject: string, html: string) => ({ to, subject, html }),
  sendMail: (token: string, msg: unknown) => sendMail(token, msg),
}));
// ★ Spread the ACTUAL module rather than listing exports: html-start.ts reads the
// three tag arrays at module-eval to build its per-sink classifiers, and a mock
// that omits them throws "No X export is defined on the mock" the moment anything
// in the graph reaches rich-text-plain. Handing it `[]` instead would be worse than
// the throw — htmlStartRe returns its never-matching regex for an empty list, so
// every stored value would silently classify as plain text. Only the one DOM-bound
// function this test needs to avoid is stubbed.
vi.mock("./sanitize-html", async (importActual) => ({
  ...(await importActual<typeof import("./sanitize-html")>()),
  sanitizeRichHtml: (h: string) => h,
}));

const resources: Resource[] = [
  { id: 1, firstName: "A", lastName: "", roleId: null, utilizationMode: "percent", utilization: {}, email: "a@x.com" },
  { id: 2, firstName: "B", lastName: "", roleId: null, utilizationMode: "percent", utilization: {} }, // no email
];

function committee(withReport = true): SteeringCommittee {
  return {
    name: "SC",
    memberResourceIds: [1, 2],
    infoSchedules: [],
    meetings: [{ id: 10, date: "2026-06-01", title: "M1", ...(withReport ? { report: { html: "<p>x</p>", updatedAt: "t0" } } : {}) }],
  };
}

function makeDeps(over: Partial<MeetingReportActionsDeps> = {}): MeetingReportActionsDeps {
  return {
    lang: "en-US",
    isPopout: false,
    settings: defaultSettings,
    committee: committee(),
    resources,
    setSteeringCommittee: vi.fn(),
    tursoConfig: null,
    m365Configured: true,
    acquireToken: vi.fn(async () => "token"),
    showToast: vi.fn(),
    getDashboardModel: () => ({}) as DashboardModel,
    aiKey: "sk-ant-test",
    aiModel: "claude-x",
    guides: [],
    projectId: "p1",
    getScopeEpoch: () => 0,
    ...over,
  };
}

const TURSO = {} as unknown as MeetingReportActionsDeps["tursoConfig"];

beforeEach(() => {
  sendMail.mockClear();
  runMeetingReport.mockClear();
  saveVersion.mockClear();
  loadVersionsFn.mockClear();
});

describe("useMeetingReportActions", () => {
  it("returns undefined in popouts", () => {
    const { result } = renderHook(() => useMeetingReportActions(makeDeps({ isPopout: true })));
    expect(result.current).toBeUndefined();
  });

  it("onSaveReport writes the report onto the meeting via a functional setter", () => {
    const setSteeringCommittee = vi.fn();
    const { result } = renderHook(() => useMeetingReportActions(makeDeps({ setSteeringCommittee })));
    act(() => result.current!.onSaveReport(10, "<p>new</p>"));
    const updater = setSteeringCommittee.mock.calls[0][0] as (c: SteeringCommittee) => SteeringCommittee;
    const next = updater(committee());
    expect(next.meetings[0].report?.html).toBe("<p>new</p>");
  });

  describe("previous version", () => {
    function harness() {
      let state: SteeringCommittee | undefined = committee();
      const setSteeringCommittee = vi.fn((u: (c: SteeringCommittee | undefined) => SteeringCommittee | undefined) => {
        state = u(state);
      });
      const { result } = renderHook(() => useMeetingReportActions(makeDeps({ setSteeringCommittee })));
      return { result, report: () => state!.meetings[0].report! };
    }

    it("a save keeps the replaced text as previous, dated by its updatedAt", () => {
      const h = harness();
      act(() => h.result.current!.onSaveReport(10, "<p>second</p>"));
      expect(h.report().html).toBe("<p>second</p>");
      expect(h.report().previous).toEqual({ html: "<p>x</p>", savedAt: "t0" });
      act(() => h.result.current!.onSaveReport(10, "<p>third</p>"));
      expect(h.report().previous?.html).toBe("<p>second</p>");
    });

    it("sets no previous when there was no report, or the old html was empty", () => {
      let state: SteeringCommittee | undefined = committee(false);
      const setSteeringCommittee = vi.fn((u: (c: SteeringCommittee | undefined) => SteeringCommittee | undefined) => {
        state = u(state);
      });
      const { result } = renderHook(() => useMeetingReportActions(makeDeps({ setSteeringCommittee })));
      act(() => result.current!.onSaveReport(10, "<p>first</p>"));
      expect(state!.meetings[0].report?.previous).toBeUndefined();
      state = { ...state!, meetings: [{ ...state!.meetings[0], report: { html: "", updatedAt: "t0" } }] };
      act(() => result.current!.onSaveReport(10, "<p>second</p>"));
      expect(state!.meetings[0].report?.previous).toBeUndefined();
    });

    it("onRestorePrevious swaps current and previous, and a second call swaps back", () => {
      const h = harness();
      act(() => h.result.current!.onSaveReport(10, "<p>second</p>"));
      act(() => h.result.current!.onRestorePrevious(10));
      expect(h.report().html).toBe("<p>x</p>");
      expect(h.report().previous?.html).toBe("<p>second</p>");
      expect(h.report().sentAt).toBeUndefined();
      act(() => h.result.current!.onRestorePrevious(10));
      expect(h.report().html).toBe("<p>second</p>");
      expect(h.report().previous?.html).toBe("<p>x</p>");
    });

    it("onRestorePrevious on a report with no previous is a no-op", () => {
      const h = harness();
      act(() => h.result.current!.onRestorePrevious(10));
      expect(h.report()).toEqual({ html: "<p>x</p>", updatedAt: "t0" });
    });
  });

  it("send with an empty recipient list shows the no-recipients toast and does NOT send", async () => {
    const showToast = vi.fn();
    const { result } = renderHook(() => useMeetingReportActions(makeDeps({ showToast })));
    await act(async () => { result.current!.onSendReport(10, []); });
    expect(showToast).toHaveBeenCalledWith("info", expect.any(String));
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("happy path sends to the given recipients, stamps sentAt, success toast", async () => {
    const showToast = vi.fn();
    const setSteeringCommittee = vi.fn();
    const deps = makeDeps({ showToast, setSteeringCommittee });
    const { result } = renderHook(() => useMeetingReportActions(deps));
    await act(async () => { result.current!.onSendReport(10, ["a@x.com"]); });
    await waitFor(() => expect(sendMail).toHaveBeenCalledTimes(1));
    const [, msg] = sendMail.mock.calls[0] as [string, { to: string[] }];
    expect(msg.to).toEqual(["a@x.com"]);
    // sentAt stamped via a functional setter
    const updater = setSteeringCommittee.mock.calls.at(-1)![0] as (c: SteeringCommittee) => SteeringCommittee;
    expect(updater(committee()).meetings[0].report?.sentAt).toBeTruthy();
    expect(showToast).toHaveBeenCalledWith("info", expect.stringContaining("1"));
  });

  it("generate drafts via AI and saves the sanitized result", async () => {
    const setSteeringCommittee = vi.fn();
    const { result } = renderHook(() => useMeetingReportActions(makeDeps({ setSteeringCommittee })));
    await act(async () => { result.current!.onGenerateReport(10); });
    await waitFor(() => expect(runMeetingReport).toHaveBeenCalledTimes(1));
    const updater = setSteeringCommittee.mock.calls.at(-1)![0] as (c: SteeringCommittee) => SteeringCommittee;
    expect(updater(committee()).meetings[0].report?.html).toBe("<p>ai draft</p>");
  });

  // §701 — the guides that target the committee report reach its call.
  it("generate sends the guides that target the committee report", async () => {
    const guides = [
      { id: "r", name: "House style", content: "Lead with the decision.", enabled: true, priority: 10, scope: { targets: ["committeeReport" as const] }, builtIn: false },
      { id: "c", name: "Chat", content: "Chat-only rule.", enabled: true, priority: 11, scope: {}, builtIn: false },
    ];
    const { result } = renderHook(() => useMeetingReportActions(makeDeps({ guides })));
    await act(async () => { result.current!.onGenerateReport(10); });
    await waitFor(() => expect(runMeetingReport).toHaveBeenCalledTimes(1));
    const ctx = (runMeetingReport.mock.calls[0] as unknown[])[2] as { guideText?: string };
    expect(ctx.guideText).toContain("Lead with the decision.");
    expect(ctx.guideText).not.toContain("Chat-only rule.");
  });

  // §125: the AI draft is a billed Anthropic call and must be stoppable.
  it("cancelGenerateReport aborts the in-flight draft and shows no failure toast", async () => {
    let seen: AbortSignal | undefined;
    runMeetingReport.mockImplementationOnce(
      (...args: unknown[]) =>
        new Promise<string>((_resolve, reject) => {
          seen = args[3] as AbortSignal | undefined;
          seen?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        }),
    );
    const showToast = vi.fn();
    const setSteeringCommittee = vi.fn();
    const { result } = renderHook(() => useMeetingReportActions(makeDeps({ showToast, setSteeringCommittee })));
    act(() => { result.current!.onGenerateReport(10); });
    await waitFor(() => expect(result.current!.generateBusyMeetingId).toBe(10));
    expect(seen).toBeInstanceOf(AbortSignal);
    expect(seen!.aborted).toBe(false);

    act(() => { result.current!.onCancelGenerateReport(); });

    expect(seen!.aborted).toBe(true);
    await waitFor(() => expect(result.current!.generateBusyMeetingId).toBeNull());
    expect(showToast).not.toHaveBeenCalled();
    expect(setSteeringCommittee).not.toHaveBeenCalled();
  });

  it("does not save a draft that resolves after the user stopped it", async () => {
    let release: ((v: string) => void) | undefined;
    runMeetingReport.mockImplementationOnce(
      () => new Promise<string>((resolve) => { release = resolve; }), // ignores the signal
    );
    const setSteeringCommittee = vi.fn();
    const { result } = renderHook(() => useMeetingReportActions(makeDeps({ setSteeringCommittee })));
    act(() => { result.current!.onGenerateReport(10); });
    await waitFor(() => expect(result.current!.generateBusyMeetingId).toBe(10));
    act(() => { result.current!.onCancelGenerateReport(); });
    await act(async () => { release!("<p>late</p>"); });
    await waitFor(() => expect(result.current!.generateBusyMeetingId).toBeNull());
    expect(setSteeringCommittee).not.toHaveBeenCalled();
  });

  it("generate is a no-op with no AI key", async () => {
    const { result } = renderHook(() => useMeetingReportActions(makeDeps({ aiKey: "" })));
    await act(async () => { result.current!.onGenerateReport(10); });
    expect(runMeetingReport).not.toHaveBeenCalled();
  });

  it("generate failure surfaces an error toast (no body leak)", async () => {
    runMeetingReport.mockRejectedValueOnce(new Error("secret-body"));
    const showToast = vi.fn();
    const { result } = renderHook(() => useMeetingReportActions(makeDeps({ showToast })));
    await act(async () => { result.current!.onGenerateReport(10); });
    await waitFor(() => expect(showToast).toHaveBeenCalledWith("error", expect.any(String)));
    const errText = showToast.mock.calls.find((c) => c[0] === "error")![1] as string;
    expect(errText).not.toContain("secret-body");
  });

  it("send failure surfaces an error toast (no body leak)", async () => {
    sendMail.mockRejectedValueOnce(new Error("boom-body"));
    const showToast = vi.fn();
    const { result } = renderHook(() => useMeetingReportActions(makeDeps({ showToast })));
    await act(async () => { result.current!.onSendReport(10, ["a@x.com"]); });
    await waitFor(() => expect(showToast).toHaveBeenCalledWith("error", expect.any(String)));
    const errText = showToast.mock.calls.find((c) => c[0] === "error")![1] as string;
    expect(errText).not.toContain("boom-body");
  });

  it("snapshots the prior report before an overwrite when Turso is active", async () => {
    const { result } = renderHook(() => useMeetingReportActions(makeDeps({ tursoConfig: TURSO })));
    await act(async () => { result.current!.onSaveReport(10, "<p>new</p>"); });
    await waitFor(() => expect(saveVersion).toHaveBeenCalledTimes(1));
  });

  it("does NOT snapshot on file backends (tursoConfig null)", () => {
    const { result } = renderHook(() => useMeetingReportActions(makeDeps()));
    act(() => result.current!.onSaveReport(10, "<p>new</p>"));
    expect(saveVersion).not.toHaveBeenCalled();
  });

  it("restore loads the version and writes its html into the meeting", async () => {
    loadVersionsFn.mockResolvedValueOnce([
      { id: "v1", projectId: "p1", meetingId: 10, html: "<p>old version</p>", isAuto: true, capturedAt: "t" },
    ]);
    const setSteeringCommittee = vi.fn();
    const { result } = renderHook(() =>
      useMeetingReportActions(makeDeps({ tursoConfig: TURSO, setSteeringCommittee })),
    );
    await act(async () => { result.current!.onRestore(10, "v1"); });
    await waitFor(() => expect(setSteeringCommittee).toHaveBeenCalled());
    const updater = setSteeringCommittee.mock.calls.at(-1)![0] as (c: SteeringCommittee) => SteeringCommittee;
    expect(updater(committee()).meetings[0].report?.html).toBe("<p>old version</p>");
  });

  it("loadVersions returns [] on file backends", async () => {
    const { result } = renderHook(() => useMeetingReportActions(makeDeps()));
    await expect(result.current!.loadVersions(10)).resolves.toEqual([]);
  });
});

describe("§650 a refused key shows the key message on the report draft toast", () => {
  it.each([
    [401, "aiKeyRejected"],
    [403, "aiKeyForbidden"],
  ] as const)("a %i toasts %s instead of 'Could not draft the report'", async (status, key) => {
    runMeetingReport.mockRejectedValueOnce(new AiHttpError(status));
    const showToast = vi.fn();
    const { result } = renderHook(() => useMeetingReportActions(makeDeps({ showToast })));
    await act(async () => { result.current!.onGenerateReport(10); });
    await waitFor(() => expect(showToast).toHaveBeenCalledWith("error", t("en-US", key)));
    expect(showToast).not.toHaveBeenCalledWith("error", t("en-US", "reportGenerateFailed"));
  });

  it("a refused gateway toasts the gateway message instead of 'Could not draft the report'", async () => {
    runMeetingReport.mockRejectedValueOnce(new AiGatewayError("ai-gateway-rejected"));
    const showToast = vi.fn();
    const { result } = renderHook(() => useMeetingReportActions(makeDeps({ showToast })));
    await act(async () => { result.current!.onGenerateReport(10); });
    await waitFor(() => expect(showToast).toHaveBeenCalledWith("error", t("en-US", "aiGatewayRejected")));
    expect(showToast).not.toHaveBeenCalledWith("error", t("en-US", "reportGenerateFailed"));
  });
});

// §763 / §548 — a draft (or a restore, or a send) that resolves after a project swap must not write into
// the next project: meeting ids restart at 1 in every project, so the functional setter would find a
// meeting #N there and overwrite its report. The epoch is captured before the first await; a moved
// epoch drops the write and logs one storage.staleScopeWriteDropped naming the writer.
describe("§763 a report write that resolves after a project swap is dropped", () => {
  beforeEach(() => clearDiagLog());
  const dropped = (writer: string) =>
    readDiagLog().filter((ev) => ev.code === "storage.staleScopeWriteDropped" && ev.fields?.writer === writer);
  function deferred<T>() {
    let resolve!: (v: T) => void;
    const promise = new Promise<T>((r) => { resolve = r; });
    return { promise, resolve };
  }

  it("a draft that resolves after the swap writes nothing, snapshots nothing and shows no toast", async () => {
    const d = deferred<string>();
    runMeetingReport.mockImplementationOnce(() => d.promise);
    let epoch = 1;
    const setSteeringCommittee = vi.fn();
    const showToast = vi.fn();
    const { result } = renderHook(() =>
      useMeetingReportActions(makeDeps({ setSteeringCommittee, showToast, tursoConfig: TURSO, getScopeEpoch: () => epoch })),
    );
    act(() => { result.current!.onGenerateReport(10); });
    await waitFor(() => expect(result.current!.generateBusyMeetingId).toBe(10));
    epoch = 2; // the project swapped while the model was answering
    await act(async () => { d.resolve("<p>late draft</p>"); });
    await waitFor(() => expect(result.current!.generateBusyMeetingId).toBeNull());
    expect(setSteeringCommittee).not.toHaveBeenCalled();
    expect(saveVersion).not.toHaveBeenCalled();
    expect(showToast).not.toHaveBeenCalled();
    expect(dropped("useMeetingReportActions.generate")).toEqual([
      expect.objectContaining({ fields: expect.objectContaining({ writer: "useMeetingReportActions.generate", meetingId: 10 }) }),
    ]);
  });

  it("a draft with no swap still writes, and logs no drop", async () => {
    const setSteeringCommittee = vi.fn();
    const { result } = renderHook(() =>
      useMeetingReportActions(makeDeps({ setSteeringCommittee, getScopeEpoch: () => 7 })),
    );
    await act(async () => { result.current!.onGenerateReport(10); });
    await waitFor(() => expect(setSteeringCommittee).toHaveBeenCalledTimes(1));
    const updater = setSteeringCommittee.mock.calls[0][0] as (c: SteeringCommittee) => SteeringCommittee;
    expect(updater(committee()).meetings[0].report?.html).toBe("<p>ai draft</p>");
    expect(dropped("useMeetingReportActions.generate")).toEqual([]);
  });

  it("a restore whose versions load after the swap writes nothing and does not say Restored", async () => {
    const d = deferred<unknown[]>();
    loadVersionsFn.mockImplementationOnce(() => d.promise);
    let epoch = 1;
    const setSteeringCommittee = vi.fn();
    const showToast = vi.fn();
    const { result } = renderHook(() =>
      useMeetingReportActions(makeDeps({ setSteeringCommittee, showToast, tursoConfig: TURSO, getScopeEpoch: () => epoch })),
    );
    act(() => { result.current!.onRestore(10, "v1"); });
    await waitFor(() => expect(result.current!.restoreBusyId).toBe("v1"));
    epoch = 2;
    await act(async () => {
      d.resolve([{ id: "v1", projectId: "p1", meetingId: 10, html: "<p>old version</p>", isAuto: true, capturedAt: "t" }]);
    });
    await waitFor(() => expect(result.current!.restoreBusyId).toBeNull());
    expect(setSteeringCommittee).not.toHaveBeenCalled();
    expect(showToast).not.toHaveBeenCalled();
    expect(dropped("useMeetingReportActions.restore")).toHaveLength(1);
  });

  it("a send that finishes after the swap does not stamp sentAt on the next project's meeting, and still says it was sent", async () => {
    const d = deferred<void>();
    sendMail.mockImplementationOnce(() => d.promise);
    let epoch = 1;
    const setSteeringCommittee = vi.fn();
    const showToast = vi.fn();
    const { result } = renderHook(() =>
      useMeetingReportActions(makeDeps({ setSteeringCommittee, showToast, getScopeEpoch: () => epoch })),
    );
    act(() => { result.current!.onSendReport(10, ["a@x.com"]); });
    await waitFor(() => expect(sendMail).toHaveBeenCalledTimes(1));
    epoch = 2;
    await act(async () => { d.resolve(); });
    await waitFor(() => expect(result.current!.sendBusyMeetingId).toBeNull());
    expect(setSteeringCommittee).not.toHaveBeenCalled();
    expect(dropped("useMeetingReportActions.send")).toHaveLength(1);
    // The mail did go out, so the user is still told it was sent.
    expect(showToast).toHaveBeenCalledWith("info", expect.stringContaining("1"));
  });
});
