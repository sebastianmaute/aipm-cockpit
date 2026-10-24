// §102 — the Learning insights view's Back button is the shared secondary Button (the
// hand-rolled one had no focus ring). §777 moved it into the pane's own toolbar row
// (`LearningInsights`' `onBack`); task-manager builds the view (`learningInsightsEl`)
// and only the modern shell's "learning-insights" view mounts it, so nothing but a
// TaskManager mount reaches the wiring: Back returns to Settings, and the pane card is
// the shell's direct child (a wrapper div is what kept it from filling the view).
// ★ That view has no hash route (`slugToView` finds it in no nav group and falls back to
// Open Points), so the test walks the one real path in: Settings → Next actions (an
// expert-mode section) → "View learning insights". WorkspaceSection is mocked out; none
// of those views renders it.
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetMintStateForTests } from "./id-mint-session";
import { buttonClassFor } from "../test/button-variant";

vi.mock("./workspace-section", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./workspace-section")>()),
  WorkspaceSection: () => <div data-testid="ws-section-mock" />,
}));

import TaskManager from "./task-manager";

beforeEach(() => {
  __resetMintStateForTests();
  window.localStorage.clear();
  window.localStorage.setItem("aipm-cockpit:settings", JSON.stringify({ layout: "modern", expertMode: true }));
  window.localStorage.setItem(
    "aipm-cockpit:projects",
    JSON.stringify({
      projects: [{ id: "p1", name: "Seed", code: "SEED", storageConfig: { kind: "browser" } }],
      currentProjectId: "p1",
    }),
  );
});
afterEach(() => {
  window.history.replaceState(null, "", "/");
});

describe("TaskManager learning insights view", () => {
  it("renders Back as the secondary Button in the pane, and Back returns to Settings", async () => {
    // Mount on a workspace view and let the first load finish (the shell holds every view
    // until then), then navigate to Settings the way a link does.
    window.history.replaceState(null, "", "/#raid");
    render(<TaskManager />);
    await screen.findByTestId("ws-section-mock", undefined, { timeout: 40000 });
    act(() => {
      window.location.hash = "#settings";
    });
    // Scoped to the Settings rail: the sidebar also has a "Next actions" entry (a view).
    const rail = await screen.findByRole("navigation", { name: "Settings" });
    fireEvent.click(within(rail).getByRole("button", { name: "Next actions" }));
    fireEvent.click(await screen.findByRole("button", { name: "View learning insights" }));
    const back = await screen.findByRole("button", { name: "Back" });
    expect(back.className).toBe(buttonClassFor({ variant: "secondary", size: "xs", className: "print:hidden" }));
    const pane = screen.getByRole("heading", { level: 2, name: "Action Center learning" }).closest(".print-root");
    expect(pane?.parentElement?.id).toBe("main-content");
    fireEvent.click(back);
    expect(await screen.findByRole("navigation", { name: "Settings" })).toBeTruthy();
    expect(screen.queryByRole("heading", { level: 2, name: "Action Center learning" })).toBeNull();
  }, 45000);

  // §780 — the `learningEnabled` prop is wired from the SAME setting the learning
  // hook reads. Seeded with learning switched off and one stored row, the view's
  // Adjustment cell must say "learning off"; a `learningEnabled={true}` wiring
  // would show the row's adjustment instead.
  it("passes the learning switch to the view (learning off shows 'learning off')", async () => {
    window.localStorage.setItem(
      "aipm-cockpit:settings",
      JSON.stringify({ layout: "modern", expertMode: true, nextActionsLearning: { enabled: false, store: "local" } }),
    );
    window.localStorage.setItem(
      "aipm-cockpit:action-learning",
      JSON.stringify({ state: { "raid:actionRaidWhySeverity": { acted: 4, snoozed: 0, dismissed: 1, lastAt: 0 } }, overrides: {} }),
    );
    window.history.replaceState(null, "", "/#raid");
    render(<TaskManager />);
    await screen.findByTestId("ws-section-mock", undefined, { timeout: 40000 });
    act(() => {
      window.location.hash = "#settings";
    });
    const rail = await screen.findByRole("navigation", { name: "Settings" });
    fireEvent.click(within(rail).getByRole("button", { name: "Next actions" }));
    fireEvent.click(await screen.findByRole("button", { name: "View learning insights" }));
    expect(await screen.findByText("learning off")).toBeTruthy();
  }, 45000);
});
