import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within, act, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { t } from "./i18n";
import { NAV_GROUPS, TURSO_ONLY_VIEWS } from "./nav-config";
import type { ScheduledReport } from "./scheduled-reports-store";
import type { TursoConfig } from "./turso-config";

const mockList = vi.fn();
vi.mock("./scheduled-reports-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./scheduled-reports-store")>()),
  listReports: (...args: unknown[]) => mockList(...args),
}));
vi.mock("./device-label", () => ({ getDeviceLabel: () => "dev-mine" }));

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

function renderPanel(over: Partial<React.ComponentProps<typeof ScheduledReportsPanel>> = {}) {
  return render(
    <ScheduledReportsPanel lang="en-US" tursoConfig={CONFIG} mode="turso" timeZone="UTC" {...over} />,
  );
}

beforeEach(() => {
  mockList.mockReset();
  mockList.mockResolvedValue(THREE);
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

  it("keeps names unique when two reports read identically", async () => {
    mockList.mockResolvedValue([report({ id: "a" }), report({ id: "b", slot: "2026-10-21" })]);
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
    expect(within(panel).getByText(/raid.*7/)).toBeInTheDocument();
  });

  it("renders summary and action text as literal text, never as HTML", async () => {
    mockList.mockResolvedValue([
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
    mockList.mockResolvedValue([report({ id: "f", ok: false }, { error: "limit", actions: [] })]);
    renderPanel();
    const tab = await screen.findByRole("tab");
    expect(within(tab).getByText(en("scheduledReportsFailed"))).toBeInTheDocument();
    expect(tab.querySelector("svg")).not.toBeNull();
  });

  it("marks a running report older than 30 minutes as interrupted", async () => {
    mockList.mockResolvedValue([
      report({ id: "s", status: "running", ok: false, ranAt: "2020-01-01T00:00:00.000Z" }),
    ]);
    renderPanel();
    const tab = await screen.findByRole("tab");
    expect(within(tab).getByText(en("scheduledReportsInterrupted"))).toBeInTheDocument();
  });

  it("shows a fresh running report as running, not interrupted", async () => {
    mockList.mockResolvedValue([
      report({ id: "s", status: "running", ok: false, ranAt: new Date().toISOString() }),
    ]);
    renderPanel();
    const tab = await screen.findByRole("tab");
    expect(within(tab).queryByText(en("scheduledReportsInterrupted"))).toBeNull();
    expect(within(tab).getByText(en("scheduledReportsRunning"))).toBeInTheDocument();
  });

  it("filters by project, listing archived projects by their newest report's name", async () => {
    mockList.mockResolvedValue([
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
  });

  it("labels a report claimed by this device", async () => {
    mockList.mockResolvedValue([report({ id: "m", claimedBy: "dev-mine" })]);
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
    mockList.mockResolvedValue([]);
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

  it("renders the reports with no AI settings involved", async () => {
    renderPanel();
    expect(await screen.findAllByRole("tab")).toHaveLength(3);
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

  it("shows no stale catch-up claim in its own strings", () => {
    for (const key of ["scheduledReportsEmpty", "scheduledReportsNeedPortfolio", "helpSecScheduledReportsBody"] as const) {
      expect(en(key)).not.toMatch(/catch/i);
    }
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
