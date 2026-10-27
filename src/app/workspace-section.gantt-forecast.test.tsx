// §502 part 4 — the Gantt reads the ONE shared forecast run workspace-section asks `useAppForecast` for:
// `forecast: null` while the simulation is off, the run's result with it on.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { showForecastView } from "../test/forecast-view";
import { Wrapper, makeProps } from "../test/workspace-section-harness";
import { WorkspaceSection } from "./workspace-section";
import { useWorkspace } from "./workspace-context";
import { useWorkspaceTab } from "./workspace-tab-context";
import { useSettings } from "./use-settings";
import type { AppForecast } from "./forecast/app-forecast";

const SETTINGS = {
  lang: "en-US",
  ai: { consent: undefined, provider: "none" },
  jira: { enabled: false, siteUrl: "", email: "", apiToken: "", projectKey: "", issueTypes: [] },
  notifications: { reminderLeadDays: 7, banner: { enabled: false }, popup: { enabled: false } },
  holidayCountries: [],
  resources: { workdayHours: 8 },
  popout: { reuseWindow: false },
  storageConfig: { kind: "browser" as const },
  features: ["dashboard", "milestones"],
};
vi.mock("./use-settings", () => ({ useSettings: vi.fn() }));

const gantt = vi.hoisted(() => ({ props: [] as Record<string, unknown>[] }));
vi.mock("./gantt-view", () => ({
  GanttView: (p: Record<string, unknown>) => {
    gantt.props.push(p);
    return <div data-testid="gantt-view" />;
  },
}));

const trends = vi.hoisted(() => ({ props: [] as Record<string, unknown>[] }));
vi.mock("./trends-panel", () => ({
  TrendsPanel: (p: Record<string, unknown>) => {
    trends.props.push(p);
    return <div data-testid="trends-panel" />;
  },
}));

function Probe() {
  const { setActiveTab } = useWorkspaceTab();
  const { setSettingsOverrides } = useWorkspace();
  return (
    <>
      <button data-testid="go-gantt" onClick={() => setActiveTab("gantt")} />
      <button data-testid="go-trends" onClick={() => setActiveTab("trends")} />
      <button data-testid="sim-on" onClick={() => setSettingsOverrides({ forecast: { showSimulation: true } })} />
    </>
  );
}

async function openGantt(clicks: string[]) {
  render(<><Probe /><WorkspaceSection {...makeProps()} /></>, { wrapper: Wrapper });
  for (const id of clicks) fireEvent.click(screen.getByTestId(id));
  fireEvent.click(screen.getByTestId("go-gantt"));
  await screen.findByTestId("gantt-view");
  return gantt.props.at(-1) as { forecast?: AppForecast | null };
}

describe("WorkspaceSection — the Gantt's forecast", () => {
  beforeEach(() => {
    gantt.props.length = 0;
    showForecastView();
    vi.mocked(useSettings).mockReturnValue({
      settings: SETTINGS, setSettings: vi.fn(), hydrated: true, i18nReady: true, lang: "en-US",
    } as unknown as ReturnType<typeof useSettings>);
  });
  afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); });

  it("passes forecast: null while the simulation is off", async () => {
    const props = await openGantt([]);
    expect(props).toHaveProperty("forecast", null);
  });

  it("passes the shared run's result with the simulation on", async () => {
    const props = await openGantt(["sim-on"]);
    expect(props.forecast?.kind).toMatch(/^(forecast|insufficient)$/);
  });
});

describe("WorkspaceSection — the Trends P80 chart's history", () => {
  beforeEach(() => {
    trends.props.length = 0;
    showForecastView();
    vi.mocked(useSettings).mockReturnValue({
      settings: SETTINGS, setSettings: vi.fn(), hydrated: true, i18nReady: true, lang: "en-US",
    } as unknown as ReturnType<typeof useSettings>);
  });
  afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); });

  async function openTrends(clicks: string[]) {
    render(<><Probe /><WorkspaceSection {...makeProps()} /></>, { wrapper: Wrapper });
    for (const id of clicks) fireEvent.click(screen.getByTestId(id));
    fireEvent.click(screen.getByTestId("go-trends"));
    await screen.findByTestId("trends-panel");
    return trends.props.at(-1) as { forecastHistory?: unknown; planEnd?: string };
  }

  it("passes no history while the simulation is off", async () => {
    const props = await openTrends([]);
    expect(props.forecastHistory).toBeUndefined();
  });

  it("passes the workspace's forecast history with the simulation on", async () => {
    const props = await openTrends(["sim-on"]);
    expect(Array.isArray(props.forecastHistory)).toBe(true);
  });
});
