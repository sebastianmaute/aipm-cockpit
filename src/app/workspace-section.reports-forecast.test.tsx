// §502 part 4 — what workspace-section hands the Reports Forecast section: nothing (and no budget-facts pass) while
// the simulation is off; with it on, the As-is input, the facts and an Explore that opens the Forecast view.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { showForecastView } from "../test/forecast-view";
import { Wrapper, makeProps } from "../test/workspace-section-harness";
import { WorkspaceSection } from "./workspace-section";
import { useWorkspace } from "./workspace-context";
import { useWorkspaceTab } from "./workspace-tab-context";
import { useSettings } from "./use-settings";
import type { ForecastReportProps } from "./forecast-report-section";
import type { BudgetBucket } from "./types";

const SETTINGS = {
  lang: "en-US",
  ai: { consentAccepted: false, provider: "none" },
  jira: { enabled: false, siteUrl: "", email: "", apiToken: "", projectKey: "", issueTypes: [] },
  notifications: { reminderLeadDays: 7, banner: { enabled: false }, popup: { enabled: false } },
  holidayCountries: [],
  resources: { workdayHours: 8 },
  popout: { reuseWindow: false },
  storageConfig: { kind: "browser" as const },
  features: ["dashboard", "milestones", "resources", "budget"],
};
vi.mock("./use-settings", () => ({ useSettings: vi.fn() }));

const reports = vi.hoisted(() => ({ props: [] as Record<string, unknown>[] }));
vi.mock("./reports", () => ({
  ReportsPanel: (p: Record<string, unknown>) => {
    reports.props.push(p);
    return <div data-testid="reports-panel" />;
  },
}));
// Call-through spy: the facts are built for real, the spy only counts.
const facts = vi.hoisted(() => ({ spy: vi.fn() }));
vi.mock("./budget-forecast", async (orig) => {
  const real = await orig<typeof import("./budget-forecast")>();
  facts.spy.mockImplementation(real.computeProjectForecastFacts as never);
  return { ...real, computeProjectForecastFacts: facts.spy };
});

const BUCKET = {
  id: 1, name: "B1", type: "tm", currency: "EUR", startDate: "2026-01-01", endDate: "2026-12-31", status: "open",
  allocations: [{ roleId: 1, resourceIds: [], budgetHours: { "2026-06": 100 }, actualHours: {} }],
} as unknown as BudgetBucket;

function Probe() {
  const { setActiveTab, activeTab } = useWorkspaceTab();
  const { setSettingsOverrides, setBudgets } = useWorkspace();
  return (
    <>
      <span data-testid="tab">{activeTab}</span>
      <button data-testid="go-reports" onClick={() => setActiveTab("reports")} />
      <button data-testid="sim-on" onClick={() => setSettingsOverrides({ forecast: { showSimulation: true } })} />
      <button data-testid="add-bucket" onClick={() => setBudgets([BUCKET])} />
    </>
  );
}

async function openReports(clicks: string[]) {
  render(<><Probe /><WorkspaceSection {...makeProps()} /></>, { wrapper: Wrapper });
  for (const id of clicks) fireEvent.click(screen.getByTestId(id));
  fireEvent.click(screen.getByTestId("go-reports"));
  await screen.findByTestId("reports-panel");
  return reports.props.at(-1) as { simulationActive?: boolean; forecast?: ForecastReportProps };
}

describe("WorkspaceSection — the Reports Forecast section's inputs", () => {
  beforeEach(() => {
    reports.props.length = 0;
    facts.spy.mockClear();
    showForecastView();
    vi.mocked(useSettings).mockReturnValue({
      settings: SETTINGS, setSettings: vi.fn(), hydrated: true, i18nReady: true, lang: "en-US",
    } as unknown as ReturnType<typeof useSettings>);
  });
  afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); });

  it("passes no section and builds no budget facts on Reports while the simulation is off", async () => {
    const props = await openReports(["add-bucket"]);
    expect(props.simulationActive).toBe(false);
    expect(props.forecast).toBeUndefined();
    expect(facts.spy).not.toHaveBeenCalled();
  });

  it("with the simulation on, passes the As-is input with the facts and an Explore that opens the Forecast view", async () => {
    const props = await openReports(["sim-on", "add-bucket"]);
    expect(props.simulationActive).toBe(true);
    const section = props.forecast!;
    expect(section.input).toMatchObject({ window: 60, unit: "tasks", costOn: true });
    expect(section.input?.budgetFacts).not.toBeNull();
    expect(facts.spy).toHaveBeenCalled();
    expect(section.onExplore).toBeTypeOf("function");
    fireEvent.click(screen.getByTestId("go-reports")); // stays on Reports until Explore
    section.onExplore!({ target: { kind: "planEnd" }, kind: "tasks", n: 1, alt: null });
    expect(await screen.findByText("forecast")).toBeTruthy();
  });
});
