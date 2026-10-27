import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { render, screen, waitFor, within, act, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { t, loadI18n, type Lang } from "./i18n";
import { NAV_GROUPS, TURSO_ONLY_VIEWS, navLabelKey } from "./nav-config";
import { REPORT_LIST_LIMIT, type ScheduledReport } from "./scheduled-reports-store";
import type { TursoConfig } from "./turso-config";

const mockList = vi.fn();
const mockProjects = vi.fn();
vi.mock("./scheduled-reports-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./scheduled-reports-store")>()),
  listReports: (...args: unknown[]) => mockList(...args),
  listReportProjects: (...args: unknown[]) => mockProjects(...args),
}));
const mockDevice = vi.hoisted(() => vi.fn(() => "dev-mine"));
vi.mock("./device-label", () => ({ getDeviceLabel: mockDevice }));

import { ScheduledReportsPanel } from "./scheduled-reports-panel";
import { SCHEDULED_REPORT_EVENT } from "./use-scheduled-job-runner";

const CONFIG: TursoConfig = { httpUrl: "https://db.example.io", authToken: "tok" };
const en = (key: Parameters<typeof t>[1]) => t("en-US", key);

function report(over: Partial<ScheduledReport> & { id: string }, data?: Partial<ScheduledReport["data"]>): ScheduledReport {
  return {
    projectId: "p1", jobKey: "job-a", slot: "2026-10-22", status: "done", ok: true,
    ranAt: "2026-10-22T08:00:00.000Z", claimedBy: "dev-other",
    ...over,
    data: {
      jobName: "Daily check", projectName: "Alpha", instruction: "Look at risks", summary: "All calm",
      actions: [{ title: "Call Sam", why: "Overdue", severity: "now", entity: { view: "raid", id: "7" } }],
      ...data,
    },
  };
}

const THREE: ScheduledReport[] = [
  report({ id: "r3", projectId: "p2", jobKey: "job-b", slot: "2026-10-23", ranAt: "2026-10-23T08:00:00.000Z" },
    { jobName: "Weekly scan", projectName: "Beta", summary: "Beta summary" }),
  report({ id: "r2", slot: "2026-10-22", ranAt: "2026-10-22T08:00:00.000Z" }, { summary: "Second summary" }),
  report({ id: "r1", slot: "2026-10-21", ranAt: "2026-10-21T08:00:00.000Z" }, { summary: "First summary" }),
];

/** The projects the filter lists: one per project that has a report, named by its newest report. */
function deriveProjects(list: readonly ScheduledReport[]): { id: string; name: string }[] {
  const seen = new Map<string, string>();
  for (const r of list) if (!seen.has(r.projectId)) seen.set(r.projectId, r.data.projectName);
  return Array.from(seen, ([id, name]) => ({ id, name }));
}

/** What the store would return: the report rows, and (by its own query) the project list. */
function setReports(list: ScheduledReport[]): void {
  mockList.mockResolvedValue(list);
  mockProjects.mockImplementation(async () => deriveProjects(list));
}

function renderPanel(over: Partial<React.ComponentProps<typeof ScheduledReportsPanel>> = {}) {
  return render(
    <ScheduledReportsPanel lang="en-US" tursoConfig={CONFIG} mode="turso" timeZone="UTC" {...over} />,
  );
}

beforeAll(async () => {
  await loadI18n("de");
});

beforeEach(() => {
  mockList.mockReset();
  mockProjects.mockReset();
  setReports(THREE);
  mockDevice.mockReset();
  mockDevice.mockReturnValue("dev-mine");
});

describe("ScheduledReportsPanel", () => {
  it("renders a vertical tablist of the reports, newest first, each with a unique name", async () => {
    renderPanel();
    const list = await screen.findByRole("tablist");
    expect(list).toHaveAttribute("aria-orientation", "vertical");
    const tabs = within(list).getAllByRole("tab");
    expect(tabs).toHaveLength(3);
    expect(tabs[0]).toHaveAccessibleName(/Weekly scan/);
    expect(tabs[0]).toHaveAccessibleName(/Beta/);
    expect(tabs[0]).toHaveAccessibleName(/10\/23\/2026/);
    expect(tabs[1]).toHaveAccessibleName(/Daily check/);
    expect(tabs[1]).toHaveAccessibleName(/Alpha/);
    const names = tabs.map((tab) => tab.getAttribute("aria-label") ?? tab.textContent);
    expect(new Set(names).size).toBe(3);
  });

  // KILLED BY: removing the check glyph (the selected tab would differ by border colour only).
  it("marks the selected tab with a non-colour glyph, and only that tab", async () => {
    renderPanel();
    const tabs = await screen.findAllByRole("tab");
    const marks = tabs.map((tab) => tab.querySelector("[data-selected-marker]"));
    expect(marks.every((m) => m !== null)).toBe(true);
    expect(marks.map((m) => m!.getAttribute("data-selected-marker"))).toEqual(tabs.map((tab) => (tab.getAttribute("aria-selected") === "true" ? "on" : "off")));
    expect(marks.filter((m) => m!.getAttribute("data-selected-marker") === "on")).toHaveLength(1);
    expect(marks.every((m) => m!.getAttribute("aria-hidden") === "true")).toBe(true);
    // What the user sees: the glyph is hidden on every unselected tab and shown on the selected one.
    expect(marks.map((m) => m!.classList.contains("invisible"))).toEqual(tabs.map((tab) => tab.getAttribute("aria-selected") !== "true"));
  });

  it("keeps names unique when two reports read identically", async () => {
    setReports([report({ id: "a" }), report({ id: "b", slot: "2026-10-21" })]);
    renderPanel();
    const tabs = await screen.findAllByRole("tab");
    const names = tabs.map((tab) => tab.getAttribute("aria-label") ?? tab.textContent);
    expect(new Set(names).size).toBe(2);
  });

  it("moves focus and selection with ArrowDown, ArrowUp, End and Home", async () => {
    const user = userEvent.setup();
    renderPanel();
    const tabs = await screen.findAllByRole("tab");
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    tabs[0].focus();
    await user.keyboard("{ArrowDown}");
    expect(tabs[1]).toHaveFocus();
    expect(tabs[1]).toHaveAttribute("aria-selected", "true");
    expect(tabs[0]).toHaveAttribute("aria-selected", "false");
    await user.keyboard("{End}");
    expect(tabs[2]).toHaveFocus();
    expect(tabs[2]).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{ArrowUp}");
    expect(tabs[1]).toHaveFocus();
    await user.keyboard("{Home}");
    expect(tabs[0]).toHaveFocus();
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
  });

  it("points the selected tab's aria-controls at the panel", async () => {
    renderPanel();
    const tabs = await screen.findAllByRole("tab");
    const panel = screen.getByRole("tabpanel");
    expect(tabs[0].getAttribute("aria-controls")).toBe(panel.id);
    expect(panel.id).not.toBe("");
  });

  it("shows the selected report's job, project, time, instruction, summary and actions", async () => {
    renderPanel();
    const tabs = await screen.findAllByRole("tab");
    await userEvent.setup().click(tabs[1]);
    const panel = screen.getByRole("tabpanel");
    expect(within(panel).getByText("Daily check")).toBeInTheDocument();
    expect(within(panel).getByText("Alpha")).toBeInTheDocument();
    expect(within(panel).getByText(/10\/22\/2026/)).toBeInTheDocument();
    expect(within(panel).getByText("Look at risks")).toBeInTheDocument();
    expect(within(panel).getByText(en("scheduledReportsInstruction"))).toBeInTheDocument();
    expect(within(panel).getByText("Second summary")).toBeInTheDocument();
    expect(within(panel).getByText("Call Sam")).toBeInTheDocument();
    expect(within(panel).getByText("Overdue")).toBeInTheDocument();
    expect(within(panel).getByText(en("actionTierNow"))).toBeInTheDocument();
    expect(within(panel).getByText(`· ${t("en-US", navLabelKey("raid"))} #7`, { exact: false })).toBeInTheDocument();
  });

  it("names an action's entity by its translated view label, not the internal view id", async () => {
    setReports([
      report({ id: "x" }, { actions: [{ title: "Do it", why: "Because", severity: "soon", entity: { view: "open-points", id: "12" } }] }),
    ]);
    renderPanel();
    const panel = await screen.findByRole("tabpanel");
    expect(within(panel).getByText(`· ${t("en-US", navLabelKey("open-points"))} #12`)).toBeInTheDocument();
    expect(within(panel).queryByText(/open-points/)).toBeNull();
  });

  it("renders summary and action text as literal text, never as HTML", async () => {
    setReports([
      report({ id: "x" }, {
        summary: "<b>x</b>",
        actions: [{ title: "<i>t</i>", why: "<u>w</u>", severity: "soon" }],
      }),
    ]);
    renderPanel();
    const panel = await screen.findByRole("tabpanel");
    expect(within(panel).getByText("<b>x</b>")).toBeInTheDocument();
    expect(within(panel).getByText("<i>t</i>")).toBeInTheDocument();
    expect(within(panel).getByText("<u>w</u>")).toBeInTheDocument();
    expect(panel.querySelector("b, i, u")).toBeNull();
  });

  it("marks a failed report with text and an icon, not colour alone", async () => {
    setReports([report({ id: "f", ok: false }, { error: "limit", actions: [] })]);
    renderPanel();
    const tab = await screen.findByRole("tab");
    expect(within(tab).getByText(en("scheduledReportsFailed"))).toBeInTheDocument();
    expect(tab.querySelector("svg")).not.toBeNull();
  });

  it("marks a running report older than 30 minutes as interrupted", async () => {
    setReports([
      report({ id: "s", status: "running", ok: false, ranAt: "2020-01-01T00:00:00.000Z" }),
    ]);
    renderPanel();
    const tab = await screen.findByRole("tab");
    expect(within(tab).getByText(en("scheduledReportsInterrupted"))).toBeInTheDocument();
  });

  it("shows a fresh running report as running, not interrupted", async () => {
    setReports([
      report({ id: "s", status: "running", ok: false, ranAt: new Date().toISOString() }),
    ]);
    renderPanel();
    const tab = await screen.findByRole("tab");
    expect(within(tab).queryByText(en("scheduledReportsInterrupted"))).toBeNull();
    expect(within(tab).getByText(en("scheduledReportsRunning"))).toBeInTheDocument();
  });

  // KILLED BY: dropping the partial note.
  it("says so when a report was made from a partly read project", async () => {
    setReports([report({ id: "x" }, { partial: true })]);
    renderPanel();
    await screen.findAllByRole("tab");
    expect(screen.getByText(en("scheduledReportsPartial"))).toBeInTheDocument();
  });

  it("shows no partial note for an ordinary report", async () => {
    renderPanel();
    await screen.findAllByRole("tab");
    expect(screen.queryByText(en("scheduledReportsPartial"))).toBeNull();
  });

  // KILLED BY: using the raw (blank) project name for the option.
  it("gives a project without a name a placeholder option, never a blank one", async () => {
    setReports([report({ id: "x", projectId: "p7" }, { projectName: "" })]);
    renderPanel();
    const select = await screen.findByRole("combobox", { name: en("scheduledReportsFilter") });
    const options = within(select).getAllByRole("option").map((o) => o.textContent);
    expect(options).toContain(en("scheduledReportsUnknownProject"));
    expect(options.every((o) => (o ?? "").trim() !== "")).toBe(true);
  });

  // KILLED BY: dropping the duplicate-name disambiguation.
  it("tells two projects with one name apart in the filter", async () => {
    setReports([
      report({ id: "a", projectId: "aaaa-1", slot: "2026-10-23" }, { projectName: "Same" }),
      report({ id: "b", projectId: "bbbb-2", slot: "2026-10-22" }, { projectName: "Same" }),
    ]);
    renderPanel();
    const select = await screen.findByRole("combobox", { name: en("scheduledReportsFilter") });
    const options = within(select).getAllByRole("option").map((o) => o.textContent);
    expect(options).toContain("Same (aaaa)");
    expect(options).toContain("Same (bbbb)");
  });

  it("filters by project, listing archived projects by their newest report's name", async () => {
    setReports([
      report({ id: "n", projectId: "p9", slot: "2026-10-23" }, { projectName: "Gamma (new name)", jobName: "G" }),
      report({ id: "o", projectId: "p9", slot: "2026-10-20" }, { projectName: "Gamma (old name)", jobName: "G" }),
      ...THREE,
    ]);
    const user = userEvent.setup();
    renderPanel();
    const select = await screen.findByRole("combobox", { name: en("scheduledReportsFilter") });
    expect(within(select).getByRole("option", { name: en("scheduledReportsAllProjects") })).toBeInTheDocument();
    expect(select).toHaveValue("");
    const options = within(select).getAllByRole("option").map((o) => o.textContent);
    expect(options).toContain("Gamma (new name)");
    expect(options).not.toContain("Gamma (old name)");
    expect(options).toContain("Alpha");
    expect(options).toContain("Beta");
    await user.selectOptions(select, "p9");
    expect(screen.getAllByRole("tab")).toHaveLength(2);
    // The chosen project's rows are read from the database, not cut out of the newest rows of the whole table.
    expect(mockList).toHaveBeenLastCalledWith(CONFIG, "p9");
  });

  // KILLED BY: building the options from the rows of the list read (a project whose reports are all older than the
  // newest REPORT_LIST_LIMIT rows would be missing).
  it("lists a project the report read did not return, from the project query", async () => {
    setReports(THREE.filter((r) => r.projectId === "p1"));
    mockProjects.mockImplementation(async () => [{ id: "p1", name: "Alpha" }, { id: "old", name: "Old one" }]);
    renderPanel();
    const select = await screen.findByRole("combobox", { name: en("scheduledReportsFilter") });
    const options = within(select).getAllByRole("option").map((o) => o.textContent);
    expect(options).toContain("Old one");
    expect(options).toContain("Alpha");
  });

  // KILLED BY: showing the raw (blank) name in the tab and the detail.
  it("shows the Unknown project label in the tab and the detail, as the filter does", async () => {
    setReports([report({ id: "x", projectId: "p7" }, { projectName: "" })]);
    renderPanel();
    const tab = await screen.findByRole("tab");
    expect(tab).toHaveAccessibleName(new RegExp(en("scheduledReportsUnknownProject")));
    expect(within(tab).getByText(en("scheduledReportsUnknownProject"))).toBeInTheDocument();
    expect(within(screen.getByRole("tabpanel")).getByText(en("scheduledReportsUnknownProject"))).toBeInTheDocument();
  });

  it("labels a report claimed by this device", async () => {
    setReports([report({ id: "m", claimedBy: "dev-mine" })]);
    renderPanel();
    const panel = await screen.findByRole("tabpanel");
    expect(within(panel).getByText(en("scheduledReportsThisDevice"))).toBeInTheDocument();
  });

  it("names another device that ran the report", async () => {
    renderPanel();
    const panel = await screen.findByRole("tabpanel");
    expect(within(panel).getByText(/dev-other/)).toBeInTheDocument();
    expect(within(panel).queryByText(en("scheduledReportsThisDevice"))).toBeNull();
  });

  it("shows the empty state when there are no reports", async () => {
    setReports([]);
    renderPanel();
    expect(await screen.findByText(en("scheduledReportsEmpty"))).toBeInTheDocument();
  });

  it("asks for a Turso portfolio without a config, and does not read the store", async () => {
    renderPanel({ tursoConfig: null });
    expect(screen.getByText(en("scheduledReportsNeedPortfolio"))).toBeInTheDocument();
    expect(mockList).not.toHaveBeenCalled();
  });

  it("asks for a Turso portfolio when the portfolio is not Turso", async () => {
    renderPanel({ mode: "file" });
    expect(screen.getByText(en("scheduledReportsNeedPortfolio"))).toBeInTheDocument();
    expect(mockList).not.toHaveBeenCalled();
  });

  it("reloads on the scheduled-report event and on window focus", async () => {
    renderPanel();
    await screen.findAllByRole("tab");
    const base = mockList.mock.calls.length;
    await act(async () => { window.dispatchEvent(new CustomEvent(SCHEDULED_REPORT_EVENT)); });
    await waitFor(() => expect(mockList.mock.calls.length).toBe(base + 1));
    await act(async () => { fireEvent.focus(window); });
    await waitFor(() => expect(mockList.mock.calls.length).toBe(base + 2));
  });

  it("makes no catch-up claim in any of its strings, in EN or DE", () => {
    const keys = [
      "scheduledReportsEmpty", "scheduledReportsNeedPortfolio", "scheduledReportsRunningNote",
      "scheduledReportsErrInterrupted", "helpSecScheduledReportsBody",
    ] as const;
    const CATCH_UP = /catch|later|missed|made up|nachhol|nachgeholt|später|verpasst|versäumt/i;
    for (const lang of ["en-US", "de"] as Lang[]) {
      for (const key of keys) {
        expect(t(lang, key), `${lang} ${key}`).not.toMatch(CATCH_UP);
      }
    }
    // The detector itself fires on the phrasings it exists for, in both languages.
    expect("Missed runs are run later").toMatch(CATCH_UP);
    expect("Verpasste Läufe werden nachgeholt").toMatch(CATCH_UP);
  });

  it("points the empty state to Settings and opens it from the action", async () => {
    setReports([]);
    const onOpenSettings = vi.fn();
    renderPanel({ onOpenSettings });
    expect(await screen.findByText(/Settings → Scheduled jobs/)).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: en("scheduledReportsOpenSettings") }));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it("offers no Settings action where the view cannot navigate", async () => {
    setReports([]);
    renderPanel();
    await screen.findByText(en("scheduledReportsEmpty"));
    expect(screen.queryByRole("button", { name: en("scheduledReportsOpenSettings") })).toBeNull();
  });

  it.each([
    ["an archived project", { status: "done" as const, ok: false }, { error: "project-archived" as const }, "scheduledReportsErrProjectArchived"],
    ["a missing project", { status: "done" as const, ok: false }, { error: "project-missing" as const }, "scheduledReportsErrProjectMissing"],
    ["a rate limit", { status: "done" as const, ok: false }, { error: "limit" as const }, "scheduledReportsErrLimit"],
    ["an unreadable answer", { status: "done" as const, ok: false }, { error: "parse" as const }, "scheduledReportsErrParse"],
    ["a switched-off deployment", { status: "done" as const, ok: false }, { error: "ai-off" as const }, "aiDeploymentOff"],
    ["a refused gateway", { status: "done" as const, ok: false }, { error: "ai-gateway-rejected" as const }, "aiGatewayRejected"],
    ["a rate-limiting gateway", { status: "done" as const, ok: false }, { error: "ai-gateway-rate-limited" as const }, "aiGatewayRateLimited"],
    ["a failure without a token", { status: "done" as const, ok: false }, {}, "scheduledReportsErrError"],
    ["an interrupted run", { status: "running" as const, ok: false, ranAt: "2020-01-01T00:00:00.000Z" }, {}, "scheduledReportsErrInterrupted"],
    ["a run in progress", { status: "running" as const, ok: false, ranAt: "2999-01-01T00:00:00.000Z" }, {}, "scheduledReportsRunningNote"],
  ] as const)("explains %s in the detail instead of an empty result", async (_name, over, data, key) => {
    setReports([report({ id: "x", ...over }, { summary: "", actions: [], ...data })]);
    renderPanel();
    const panel = await screen.findByRole("tabpanel");
    expect(within(panel).getByText(en(key))).toBeInTheDocument();
    expect(within(panel).queryByText(en("scheduledReportsNoSuggestions"))).toBeNull();
    expect(within(panel).queryByText(en("scheduledReportsSummary"))).toBeNull();
    expect(within(panel).queryByText(en("scheduledReportsSuggestions"))).toBeNull();
  });

  it("still shows a summary a failed report did carry", async () => {
    setReports([report({ id: "x", ok: false }, { summary: "Partial notes", error: "error" })]);
    renderPanel();
    const panel = await screen.findByRole("tabpanel");
    expect(within(panel).getByText("Partial notes")).toBeInTheDocument();
    expect(within(panel).getByText(en("scheduledReportsErrError"))).toBeInTheDocument();
  });

  it("shows a done report with no suggestions as a clean result", async () => {
    setReports([report({ id: "x" }, { actions: [] })]);
    renderPanel();
    const panel = await screen.findByRole("tabpanel");
    expect(within(panel).getByText(en("scheduledReportsNoSuggestions"))).toBeInTheDocument();
  });

  it("lists a project whose only report is a project-archived failure", async () => {
    setReports([
      report({ id: "z", projectId: "p-arch", ok: false }, { projectName: "Old project", error: "project-archived", summary: "", actions: [] }),
      ...THREE,
    ]);
    renderPanel();
    const select = await screen.findByRole("combobox", { name: en("scheduledReportsFilter") });
    expect(within(select).getAllByRole("option").map((o) => o.textContent)).toContain("Old project");
  });

  it("falls back to All projects when the filtered project has no report any more", async () => {
    const user = userEvent.setup();
    renderPanel();
    const select = await screen.findByRole("combobox", { name: en("scheduledReportsFilter") });
    await user.selectOptions(select, "p2");
    expect(screen.getAllByRole("tab")).toHaveLength(1);
    setReports(THREE.filter((r) => r.projectId === "p1"));
    await act(async () => { window.dispatchEvent(new CustomEvent(SCHEDULED_REPORT_EVENT)); });
    await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(2));
    expect(screen.getByRole("combobox", { name: en("scheduledReportsFilter") })).toHaveValue("");
  });

  it("lets only the newest reload write, whatever order the answers arrive in", async () => {
    let resolveSlow: (v: ScheduledReport[]) => void = () => undefined;
    mockList.mockReset();
    mockList.mockImplementationOnce(() => Promise.resolve(THREE.slice(0, 1)));
    renderPanel();
    await screen.findAllByRole("tab");
    mockList.mockImplementationOnce(() => new Promise<ScheduledReport[]>((r) => { resolveSlow = r; }));
    await act(async () => { fireEvent.focus(window); });
    mockList.mockImplementationOnce(() => Promise.resolve(THREE));
    await act(async () => { window.dispatchEvent(new CustomEvent(SCHEDULED_REPORT_EVENT)); });
    await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(3));
    await act(async () => { resolveSlow([]); });
    expect(screen.getAllByRole("tab")).toHaveLength(3);
  });

  it("keeps the list on screen when a reload fails", async () => {
    renderPanel();
    await screen.findAllByRole("tab");
    mockList.mockRejectedValueOnce(new Error("boom"));
    await act(async () => { fireEvent.focus(window); });
    expect(screen.getAllByRole("tab")).toHaveLength(3);
  });

  // KILLED BY: keeping any `ready` state on a failed reload (the other portfolio's reports would stay up).
  // KILLED BY: rendering `stored` directly (the other portfolio's reports stay up while the new read is in flight).
  it("hides the previous portfolio's reports while the new portfolio's read is in flight", async () => {
    const view = renderPanel();
    await screen.findAllByRole("tab");
    mockList.mockReturnValue(new Promise(() => undefined));
    view.rerender(<ScheduledReportsPanel lang="en-US" tursoConfig={{ ...CONFIG, httpUrl: "https://other.example.io" }} mode="turso" timeZone="UTC" />);
    await waitFor(() => expect(screen.queryAllByRole("tab")).toHaveLength(0));
  });

  it("does not keep the previous portfolio's reports when the reload for the new one fails", async () => {
    const view = renderPanel();
    await screen.findAllByRole("tab");
    mockList.mockRejectedValue(new Error("boom"));
    view.rerender(<ScheduledReportsPanel lang="en-US" tursoConfig={{ ...CONFIG, httpUrl: "https://other.example.io" }} mode="turso" timeZone="UTC" />);
    await waitFor(() => expect(screen.queryAllByRole("tab")).toHaveLength(0));
  });

  // KILLED BY: dropping the note (retained reports beyond the read bound would vanish without a word).
  it("says the list is capped when the read hit its bound, and not otherwise", async () => {
    setReports(Array.from({ length: REPORT_LIST_LIMIT }, (_, i) =>
      report({ id: `r${i}`, jobKey: `j${i}`, slot: `2026-10-23T00:${String(i % 60).padStart(2, "0")}:00.${String(i).padStart(3, "0")}Z` })));
    const view = renderPanel();
    await screen.findAllByRole("tab");
    expect(screen.getByText(en("scheduledReportsLimited").replace("{0}", String(REPORT_LIST_LIMIT)))).toBeInTheDocument();
    view.unmount();
    setReports(THREE);
    renderPanel();
    await screen.findAllByRole("tab");
    expect(screen.queryByText(en("scheduledReportsLimited").replace("{0}", String(REPORT_LIST_LIMIT)))).toBeNull();
  });

  it("reads the device label once per load, never while rendering", async () => {
    const user = userEvent.setup();
    renderPanel();
    const tabs = await screen.findAllByRole("tab");
    expect(mockDevice).toHaveBeenCalledTimes(1);
    await user.click(tabs[1]);
    await user.click(tabs[2]);
    expect(mockDevice).toHaveBeenCalledTimes(1);
  });

  it("does not call the unknown-device fallback this device", async () => {
    mockDevice.mockReturnValue("unknown");
    setReports([report({ id: "m", claimedBy: "unknown" })]);
    renderPanel();
    const panel = await screen.findByRole("tabpanel");
    expect(within(panel).queryByText(en("scheduledReportsThisDevice"))).toBeNull();
  });

  it("makes the detail panel reachable by Tab", async () => {
    renderPanel();
    expect(await screen.findByRole("tabpanel")).toHaveAttribute("tabindex", "0");
  });
});

describe("nav-config", () => {
  it("places scheduled-reports directly after portfolio-health and Turso-gates it", () => {
    const items = NAV_GROUPS.flatMap((g) => g.items.map((i) => i.view));
    const at = items.indexOf("portfolio-health");
    expect(items[at + 1]).toBe("scheduled-reports");
    expect(TURSO_ONLY_VIEWS).toContain("scheduled-reports");
  });
});

describe("reload edges (§772 cr4 re-review)", () => {
  const fire = () => window.dispatchEvent(new CustomEvent(SCHEDULED_REPORT_EVENT));
  const onlyP1 = THREE.filter((r) => r.projectId === "p1");

  // KILLED BY: an unguarded await in the fulfilled handler (the rejection would be unhandled and the view stuck).
  it("keeps what is on screen when the read after a vanished project fails", async () => {
    const user = userEvent.setup();
    renderPanel();
    const select = await screen.findByRole("combobox", { name: en("scheduledReportsFilter") });
    await user.selectOptions(select, "p2");
    expect(screen.getAllByRole("tab")).toHaveLength(1);
    mockProjects.mockImplementation(async () => deriveProjects(onlyP1)); // p2 has no report any more
    let calls = 0;
    mockList.mockImplementation(async () => { calls += 1; if (calls === 1) return THREE; throw new Error("boom"); });
    await act(async () => { fire(); });
    await waitFor(() => expect(calls).toBe(2)); // the fallback read ran, and failed
    expect(screen.getAllByRole("tab")).toHaveLength(1);
    expect(screen.getByRole("combobox", { name: en("scheduledReportsFilter") })).toHaveValue("p2");
  });

  // KILLED BY: resetting the filter before the staleness check (a superseded load would undo the newer one's choice).
  it("a superseded load does not reset the filter the newer load kept", async () => {
    const user = userEvent.setup();
    renderPanel();
    const select = await screen.findByRole("combobox", { name: en("scheduledReportsFilter") });
    await user.selectOptions(select, "p2");
    let release: (v: ScheduledReport[]) => void = () => undefined;
    const held = new Promise<ScheduledReport[]>((r) => { release = r; });
    let calls = 0;
    mockList.mockImplementation(async () => { calls += 1; return calls === 3 ? held : THREE; });
    mockProjects.mockReset();
    mockProjects.mockImplementationOnce(async () => deriveProjects(onlyP1)); // the first reload: p2 "vanished"
    mockProjects.mockImplementation(async () => deriveProjects(THREE)); // the newer reload: p2 is there
    await act(async () => { fire(); fire(); });
    await waitFor(() => expect(calls).toBe(3)); // the first reload is waiting on its fallback read
    await act(async () => { release(onlyP1); });
    expect(screen.getByRole("combobox", { name: en("scheduledReportsFilter") })).toHaveValue("p2");
  });
});
