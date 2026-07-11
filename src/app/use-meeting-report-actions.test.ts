import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useMeetingReportActions, type MeetingReportActionsDeps } from "./use-meeting-report-actions";
import type { SteeringCommittee, Resource } from "./types";
import type { DashboardModel } from "./dashboard";
import { defaultSettings } from "./settings-types";

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
vi.mock("./sanitize-html", () => ({ sanitizeTemplateHtml: (h: string) => h }));

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
    projectId: "p1",
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

  it("send with no member emails shows the no-recipients toast and does NOT send", async () => {
    const showToast = vi.fn();
    const deps = makeDeps({ showToast, resources: [resources[1]] }); // only the emailless member
    const { result } = renderHook(() => useMeetingReportActions(deps));
    await act(async () => { result.current!.onSendReport(10); });
    expect(showToast).toHaveBeenCalledWith("info", expect.any(String));
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("happy path sends to resolved emails, stamps sentAt, success toast", async () => {
    const showToast = vi.fn();
    const setSteeringCommittee = vi.fn();
    const deps = makeDeps({ showToast, setSteeringCommittee });
    const { result } = renderHook(() => useMeetingReportActions(deps));
    await act(async () => { result.current!.onSendReport(10); });
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
    await act(async () => { result.current!.onSendReport(10); });
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
