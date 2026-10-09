// §102 — the Learning insights view's Back button is the shared secondary Button. It is
// built inline in task-manager (`learningInsightsEl`) and mounted only by the modern
// shell's "learning-insights" view, so nothing but a TaskManager mount reaches it. The
// hand-rolled one had no focus ring.
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
  it("renders Back as the secondary Button, keeping its self-start alignment", async () => {
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
    expect(back.className).toBe(buttonClassFor({ variant: "secondary", size: "sm", className: "self-start" }));
  }, 45000);
});
