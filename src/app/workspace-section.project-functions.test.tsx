// §779 — Settings -> Functions opens Edit project on the Projects tab. The section that renders it
// mounts its OWN `useSettings` instance, and the request opens the dialog on that instance's first
// render, so `settings.features` there can still be the all-modules default (or simply behind the
// workspace) when the dialog seeds its Functions draft. The dialog edits `Workspace.features`
// (`onCommitFeatures` is `workspace.setFeatures`), so it must read that same slice back: these tests
// pin `settings.features` to a STALE all-on list and expect the editor to follow the workspace anyway.
// Budget's setup checklist and the Time bookings notice turn a function on the same way (the shown
// set plus one, written to the workspace), so they are pinned to the same slice below.
import { render, screen, fireEvent, within, act } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Wrapper, makeProps } from "../test/workspace-section-harness";
import { useWorkspace } from "./workspace-context";
import { useWorkspaceTab } from "./workspace-tab-context";
import { WorkspaceSection } from "./workspace-section";
import { ALL_MODULE_IDS, type FeatureModuleId } from "./feature-modules";
import type { ProjectMeta } from "./types";

vi.mock("./use-settings", async () => {
  const { defaultSettings } = await import("./settings-types");
  const { ALL_MODULE_IDS: all } = await import("./feature-modules");
  // Never updates: the stale mirror a freshly mounted instance holds before it catches up.
  const settings = { ...defaultSettings, features: [...all] };
  return {
    useSettings: vi.fn(() => ({ settings, setSettings: vi.fn(), hydrated: true, i18nReady: true, lang: "en-US" as const })),
  };
});

// Both panels are lazy and heavy; only the features pair they are handed matters here.
const panelProps = vi.hoisted(() => ({ budget: [] as Record<string, unknown>[], timelog: [] as Record<string, unknown>[] }));
vi.mock("./budget-panel", () => ({
  BudgetPanel: (p: Record<string, unknown>) => { panelProps.budget.push(p); return <div data-testid="budget-panel" />; },
}));
vi.mock("./timelog-panel", () => ({
  TimelogPanel: (p: Record<string, unknown>) => { panelProps.timelog.push(p); return <div data-testid="timelog-panel" />; },
}));

const META: ProjectMeta = {
  name: "Borealis",
  code: "BOR-1",
  projectManager: "Kim Planner",
  keyStakeholdersInternal: [],
  keyStakeholdersExternal: [],
  customer: "Northwind Labs",
  naceSection: "C",
  identityTypes: [],
  products: "",
  deployment: "",
  startDate: "2026-01-01",
  endDate: "2026-06-01",
  profitCenter: "",
  contactPersons: [],
  regulatory: [],
};

function Probe() {
  const { setActiveTab } = useWorkspaceTab();
  const { features, setFeatures } = useWorkspace();
  return (
    <>
      <button data-testid="goto-projects" onClick={() => setActiveTab("projects")} />
      <button data-testid="goto-budget" onClick={() => setActiveTab("budget")} />
      <button data-testid="goto-timelog" onClick={() => setActiveTab("timelog")} />
      <button data-testid="switch-off" onClick={() => setFeatures(WITHOUT_CHANGES_AND_RESOURCES)} />
      <output data-testid="ws-features">{JSON.stringify(features ?? null)}</output>
    </>
  );
}

const WITHOUT_CHANGES_AND_RESOURCES = ALL_MODULE_IDS.filter((id) => id !== "changes" && id !== "resources");

const wsFeatures = () => JSON.parse(screen.getByTestId("ws-features").textContent ?? "null") as string[] | null;
const dialog = () => screen.getByRole("dialog");
const box = (name: string) => within(dialog()).getByRole("checkbox", { name }) as HTMLInputElement;
const save = () => fireEvent.click(within(dialog()).getByRole("button", { name: "Save" }));

function setup() {
  const props = (request: number) => makeProps({ currentProjectId: "p1", currentProject: META, projectFunctionsRequest: request });
  const ui = (request: number) => (
    <>
      <Probe />
      <WorkspaceSection {...props(request)} />
    </>
  );
  const view = render(ui(1), { wrapper: Wrapper });
  fireEvent.click(screen.getByTestId("goto-projects"));
  /** Settings -> Functions again: a new request number reopens the dialog. */
  const reopen = (request: number) => view.rerender(ui(request));
  return { reopen };
}

describe("WorkspaceSection — Edit project reads the functions it writes (§779)", () => {
  afterEach(() => {
    window.history.replaceState(null, "", "/");
  });

  // Mutation: passing `features={features}` (the section's `settings.features`) to ProjectsPanel
  // again turns this red — the reopened dialog shows Changes ticked.
  it("a function switched off and saved shows as off when the editor is reopened", async () => {
    const { reopen } = setup();
    await screen.findByRole("dialog");
    expect(box("Changes").checked).toBe(true);

    fireEvent.click(box("Changes"));
    await act(async () => save());
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(wsFeatures()).toEqual(ALL_MODULE_IDS.filter((id) => id !== "changes"));

    reopen(2);
    await screen.findByRole("dialog");
    expect(box("Changes").checked).toBe(false);
    expect(box("Stakeholders").checked).toBe(true);
  });

  // Mutation: same as above. The stale dialog seeds an all-on draft, so toggling any OTHER function
  // writes that whole draft back and switches Changes on again behind the user's back.
  it("saving the reopened editor leaves the switched-off function off", async () => {
    const { reopen } = setup();
    await screen.findByRole("dialog");
    fireEvent.click(box("Changes"));
    await act(async () => save());

    // Unchanged save: nothing written.
    reopen(2);
    await screen.findByRole("dialog");
    await act(async () => save());
    expect(wsFeatures()).toEqual(ALL_MODULE_IDS.filter((id) => id !== "changes"));

    // An unrelated function switched off: only that one changes.
    reopen(3);
    await screen.findByRole("dialog");
    fireEvent.click(box("Stakeholders"));
    await act(async () => save());
    expect(wsFeatures()).toEqual(ALL_MODULE_IDS.filter((id) => id !== "changes" && id !== "stakeholders"));
  });
});

// Mutation: passing `settings.features` (the section's `features` local) to BudgetPanel or TimelogPanel
// turns the matching test red: the panel is handed the stale all-on list, and its turn-on writes it back.
describe("WorkspaceSection — Budget and Time bookings read the functions they write (§779)", () => {
  afterEach(() => {
    window.history.replaceState(null, "", "/");
  });

  async function handedTo(view: "budget" | "timelog") {
    panelProps[view].length = 0;
    render(
      <>
        <Probe />
        <WorkspaceSection {...makeProps()} />
      </>,
      { wrapper: Wrapper },
    );
    fireEvent.click(screen.getByTestId("switch-off"));
    fireEvent.click(screen.getByTestId(`goto-${view}`));
    await screen.findByTestId(`${view}-panel`);
    return panelProps[view].at(-1)! as { features: readonly FeatureModuleId[]; onCommitFeatures: (next: FeatureModuleId[]) => void };
  }
  /** A MODEL of both panels' "Turn on" (the shown set plus the missing function, in registry order), so the
   *  consequence of the handed list is visible here. The real check is the `props.features` assertion; the
   *  assertion after `turnOn` adds no evidence of its own. The real buttons are tested in
   *  `budget-setup-checklist.test.tsx` and `timelog-panel.test.tsx`. */
  const turnOn = (props: { features: readonly FeatureModuleId[]; onCommitFeatures: (next: FeatureModuleId[]) => void }, id: FeatureModuleId) => {
    const next = new Set<FeatureModuleId>([...props.features, id]);
    act(() => props.onCommitFeatures(ALL_MODULE_IDS.filter((m) => next.has(m))));
  };

  it("Budget is handed the workspace's functions, not the settings mirror", async () => {
    const props = await handedTo("budget");
    expect(props.features).toEqual(WITHOUT_CHANGES_AND_RESOURCES);
    turnOn(props, "resources");
    expect(wsFeatures()).toEqual(ALL_MODULE_IDS.filter((id) => id !== "changes"));
  });

  it("Time bookings is handed the workspace's functions, not the settings mirror", async () => {
    const props = await handedTo("timelog");
    expect(props.features).toEqual(WITHOUT_CHANGES_AND_RESOURCES);
    turnOn(props, "resources");
    expect(wsFeatures()).toEqual(ALL_MODULE_IDS.filter((id) => id !== "changes"));
  });
});
