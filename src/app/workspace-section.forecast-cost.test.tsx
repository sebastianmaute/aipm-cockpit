// §502 part 3 — the Forecast view reads `budgetFacts` from the section: the pace forecast's facts
// (`computeProjectForecastFacts`), computed only on the Forecast tab with the Budget module enabled (the
// simulation switch gates only the cost card and cost rows, inside the panel). Its own file because workspace-section.test.tsx sits at the size ratchet.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { showForecastView } from "../test/forecast-view";
import { Wrapper, makeProps } from "../test/workspace-section-harness";
import { WorkspaceSection } from "./workspace-section";
import { useWorkspace } from "./workspace-context";
import { useWorkspaceTab } from "./workspace-tab-context";
import { useSettings } from "./use-settings";
import type { BudgetBucket } from "./types";

const SETTINGS = {
  lang: "en-US",
  ai: { consent: undefined, provider: "none" },
  jira: { enabled: false, siteUrl: "", email: "", apiToken: "", projectKey: "", issueTypes: [] },
  notifications: { reminderLeadDays: 7, banner: { enabled: false }, popup: { enabled: false } },
  holidayCountries: [],
  resources: { workdayHours: 8 },
  popout: { reuseWindow: false },
  storageConfig: { kind: "browser" as const },
  features: ["dashboard", "milestones", "resources", "budget"],
};
vi.mock("./use-settings", () => ({ useSettings: vi.fn() }));

const forecastPanelMock = vi.hoisted(() => ({ props: [] as Record<string, unknown>[] }));
vi.mock("./forecast-panel", () => ({
  ForecastPanelDeepLinked: (p: Record<string, unknown>) => {
    forecastPanelMock.props.push(p);
    return <div data-testid="forecast-panel" />;
  },
}));

const BUCKET = {
  id: 1, name: "B1", type: "tm", currency: "EUR", startDate: "2026-01-01", endDate: "2026-12-31", status: "open",
  allocations: [{ roleId: 1, resourceIds: [], budgetHours: { "2026-06": 100 }, actualHours: {} }],
} as unknown as BudgetBucket;

function Probe() {
  const { setActiveTab } = useWorkspaceTab();
  const { setBudgets, setSettingsOverrides } = useWorkspace();
  return (
    <>
      <button data-testid="go-forecast" onClick={() => setActiveTab("forecast")} />
      <button data-testid="sim-on" onClick={() => setSettingsOverrides({ forecast: { showSimulation: true } })} />
      <button data-testid="add-bucket" onClick={() => setBudgets([BUCKET])} />
    </>
  );
}

function mockFeatures(features: string[]) {
  vi.mocked(useSettings).mockReturnValue({
    settings: { ...SETTINGS, features }, setSettings: vi.fn(), hydrated: true, i18nReady: true, lang: "en-US",
  } as unknown as ReturnType<typeof useSettings>);
}

async function openForecast(clicks: string[]) {
  render(<><Probe /><WorkspaceSection {...makeProps()} /></>, { wrapper: Wrapper });
  for (const id of clicks) fireEvent.click(screen.getByTestId(id));
  fireEvent.click(screen.getByTestId("go-forecast"));
  await screen.findByTestId("forecast-panel"); // a dynamic() panel
  return forecastPanelMock.props.at(-1)?.budgetFacts;
}

describe("WorkspaceSection — the Forecast view's budget facts", () => {
  beforeEach(() => {
    forecastPanelMock.props.length = 0;
    showForecastView();
    mockFeatures(SETTINGS.features);
  });
  afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); });

  it("passes the pace forecast's facts with the simulation on and a bucket", async () => {
    const facts = (await openForecast(["sim-on", "add-bucket"])) as { eur: { dated: unknown[] } } | null;
    expect(facts).not.toBeNull();
    expect(Array.isArray(facts?.eur.dated)).toBe(true);
    expect(forecastPanelMock.props.at(-1)?.budgetEnabled).toBe(true);
  });

  // Added-people sizing (§502 build step 2) needs the booked hours with the switch off too; the panel keeps
  // the cost card behind `showSimulation`, which the section passes as false here.
  it("passes the facts while the simulation is off (added-people sizing needs booked hours); the cost card stays hidden", async () => {
    const facts = (await openForecast(["add-bucket"])) as { hours: { dated: unknown[] } } | null;
    expect(facts).not.toBeNull();
    expect(Array.isArray(facts?.hours.dated)).toBe(true);
    expect(forecastPanelMock.props.at(-1)?.showSimulation).toBe(false);
  });

  it("passes the saved-scenario support, writable outside a popout", async () => {
    await openForecast([]);
    const scenarios = forecastPanelMock.props.at(-1)?.scenarios as { api: { scenarios: unknown[] }; directory: { baseCurrency: string }; readOnly: boolean };
    expect(scenarios.api.scenarios).toEqual([]);
    expect(scenarios.directory.baseCurrency).toBe("EUR");
    expect(scenarios.readOnly).toBe(false);
  });

  it("passes null without buckets", async () => {
    expect(await openForecast(["sim-on"])).toBeNull();
  });

  // Mutation: dropping the `isModuleEnabled("budget", …)` conjunct turns this red.
  it("passes null while the Budget module is off", async () => {
    mockFeatures(["dashboard", "milestones", "resources"]);
    expect(await openForecast(["sim-on", "add-bucket"])).toBeNull();
    expect(forecastPanelMock.props.at(-1)?.budgetEnabled).toBe(false);
  });
});
