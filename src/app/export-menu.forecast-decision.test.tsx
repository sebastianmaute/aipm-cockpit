// §502 part 4 — the header Export menu carries the forecast decision on EVERY view. The modern shell renders Open
// Points, Settings and Learning insights without `WorkspaceSection`, which used to be the only holder (it published
// its source to a module slot, empty while it was unmounted), so the header export silently dropped the section
// there. The menu now derives its own source from the live workspace context (`useWorkspaceForecastDecisionSource`).
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { useEffect } from "react";
import type React from "react";

// Builds nothing: the source hands back what it was asked with, so a test can read the input it would run on.
vi.mock("./forecast-decision", async (orig) => ({
  ...(await orig<typeof import("./forecast-decision")>()),
  forecastDecisionSource: (args: () => unknown) => () => args(),
}));
vi.mock("./export", () => ({ exportWorkspace: vi.fn(() => Promise.resolve()) }));

import { exportWorkspace } from "./export";
import type { ExportExtras } from "./export-forecast-section";
import { ActionMenus } from "./action-menus";
import { FiltersProvider } from "./filters-context";
import { t } from "./i18n";
import { ModernShell } from "./modern-shell";
import { defaultSettings } from "./settings-types";
import { ToastProvider } from "./toast-context";
import type { Milestone, Task } from "./types";
import type { WorkspaceForecastDecisionDeps } from "./use-forecast-decision-source";
import { useWorkspace, WorkspaceProvider } from "./workspace-context";
import { WorkspaceTabProvider } from "./workspace-tab-context";
import { showForecastView } from "../test/forecast-view";

const ON = { forecast: { showSimulation: true } };
const DEPS: WorkspaceForecastDecisionDeps = {
  features: defaultSettings.features, workdayHours: 8, today: "2026-10-14", holidaySet: new Set(), holidaysReady: true,
};
const milestone = (id: number, name: string) => ({ id, name, targetDate: "2026-12-01" }) as unknown as Milestone;
const task = (id: number, title: string) => ({ id, taskName: title }) as unknown as Task;

type Seed = { settingsOverrides?: typeof ON; tasks: Task[]; milestones: Milestone[] };
let swap: ((s: Seed) => void) | null = null;

/** Writes a project's slices through the real setters — what a project swap's load does to the context. */
function Seeder({ seed }: { seed: Seed }) {
  const { setSettingsOverrides, setTasks, setMilestones } = useWorkspace();
  useEffect(() => {
    const apply = (s: Seed) => { setSettingsOverrides(s.settingsOverrides); setTasks(s.tasks); setMilestones(s.milestones); };
    apply(seed);
    swap = apply;
  }, [seed, setSettingsOverrides, setTasks, setMilestones]);
  return null;
}

function shellOn(view: "open-points" | "settings", seed: Seed) {
  const menus = <ActionMenus lang="en-US" onCommand={vi.fn()} onVoiceError={vi.fn()} forecastDecisionDeps={DEPS} />;
  const wrap = (children: React.ReactNode) => (
    <ToastProvider value={{ showToast: vi.fn(), showToastAction: vi.fn() }}>
      <FiltersProvider><WorkspaceProvider><WorkspaceTabProvider><Seeder seed={seed} />{children}</WorkspaceTabProvider></WorkspaceProvider></FiltersProvider>
    </ToastProvider>
  );
  render(wrap(
    <ModernShell
      lang="en-US" activeView={view} onNavigate={vi.fn()} version="v0" mode="advanced" bannerCount={0} onShowAlerts={() => {}}
      topBarMenus={menus} sidebarFooter={null} settingsView={<div data-testid="settings" />}
      tasksSection={<div data-testid="tasks" />} workspace={<div data-testid="workspace" />}
    />,
  ));
}

async function exportCsv(): Promise<ExportExtras> {
  vi.mocked(exportWorkspace).mockClear();
  fireEvent.click(screen.getByRole("button", { name: t("en-US", "exportTitle") }));
  fireEvent.click(screen.getByRole("button", { name: new RegExp(t("en-US", "exportCsv")) }));
  await waitFor(() => expect(exportWorkspace).toHaveBeenCalledTimes(1));
  return vi.mocked(exportWorkspace).mock.calls[0][5] as ExportExtras;
}

const inputOf = (extras: ExportExtras) => (extras.forecastDecision!() as unknown as { input: { milestones: Milestone[]; tasks: Task[] } }).input;

let shown: MockInstance;
beforeEach(() => { shown = showForecastView(); });
afterEach(() => { cleanup(); shown.mockRestore(); swap = null; });

describe("the header Export menu's forecast decision (§502 part 4)", () => {
  it("exports the section from the modern shell's Open Points view, where WorkspaceSection is not mounted", async () => {
    shellOn("open-points", { settingsOverrides: ON, tasks: [task(1, "A task")], milestones: [milestone(1, "Alpha")] });
    expect(screen.getByTestId("tasks")).toBeInTheDocument();
    expect(screen.queryByTestId("workspace")).toBeNull();
    const extras = await exportCsv();
    expect(extras.forecastDecision).toBeTypeOf("function");
    expect(inputOf(extras).milestones.map((m) => m.name)).toEqual(["Alpha"]);
  });

  it("exports it from the Settings view too", async () => {
    shellOn("settings", { settingsOverrides: ON, tasks: [], milestones: [milestone(1, "Alpha")] });
    expect((await exportCsv()).forecastDecision).toBeTypeOf("function");
  });

  it("omits it with the simulation off: the extras are exactly the budget forecast", async () => {
    shellOn("open-points", { tasks: [], milestones: [milestone(1, "Alpha")] });
    expect(await exportCsv()).toEqual({ budgetForecast: null });
  });

  it("after a project swap, exports the new project's decision, never the old one's", async () => {
    shellOn("open-points", { settingsOverrides: ON, tasks: [task(1, "Old task")], milestones: [milestone(1, "Old project")] });
    expect(inputOf(await exportCsv()).milestones.map((m) => m.name)).toEqual(["Old project"]);
    act(() => swap!({ settingsOverrides: ON, tasks: [task(7, "New task")], milestones: [milestone(9, "New project")] }));
    const input = inputOf(await exportCsv());
    expect(input.milestones.map((m) => m.name)).toEqual(["New project"]);
    expect(input.tasks.map((x) => x.taskName)).toEqual(["New task"]);
  });

  it("omits it after a swap to a project with the simulation off", async () => {
    shellOn("open-points", { settingsOverrides: ON, tasks: [], milestones: [milestone(1, "Old project")] });
    expect((await exportCsv()).forecastDecision).toBeTypeOf("function");
    act(() => swap!({ tasks: [], milestones: [milestone(9, "New project")] }));
    expect(await exportCsv()).toEqual({ budgetForecast: null });
  });
});
