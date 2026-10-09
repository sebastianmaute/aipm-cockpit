// Saving a template from Settings → Templates must not reload the workspace. The
// Templates section writes through its OWN `useSettings` instance; its broadcast used
// to hand TaskManager a separately parsed `storageConfig`, `useStorageBackend` rebuilt
// the backend on that new identity, the reload raised the load hold, and Settings
// remounted on General. This drives the real path end to end: the section, the
// broadcast, TaskManager's settings and the backend memo. WorkspaceSection is mocked
// out; none of these views renders it.
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetMintStateForTests } from "./id-mint-session";

vi.mock("./workspace-section", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./workspace-section")>()),
  WorkspaceSection: () => <div data-testid="ws-section-mock" />,
}));

import TaskManager from "./task-manager";

beforeEach(() => {
  __resetMintStateForTests();
  window.localStorage.clear();
  window.localStorage.setItem(
    "aipm-cockpit:settings",
    JSON.stringify({ layout: "modern", expertMode: true, storageConfig: { kind: "browser" } }),
  );
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

describe("TaskManager — saving a template", () => {
  it("keeps Settings on Templates instead of reloading back to General", async () => {
    window.history.replaceState(null, "", "/#raid");
    render(<TaskManager />);
    await screen.findByTestId("ws-section-mock", undefined, { timeout: 40000 });
    act(() => {
      window.location.hash = "#settings";
    });
    const rail = await screen.findByRole("navigation", { name: "Settings" });
    fireEvent.click(within(rail).getByRole("button", { name: "Templates" }));

    /** The Settings rail entry marked current, or null when Settings is not mounted
     *  (the load hold renders a skeleton in its place). */
    const currentSection = () => {
      const nav = screen.queryByRole("navigation", { name: "Settings" });
      if (!nav) return null;
      return within(nav).queryAllByRole("button").find((b) => b.getAttribute("aria-current") === "page")?.textContent ?? null;
    };
    const settle = (ms: number) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });

    // Let the Templates section's own settings instance hydrate before typing. Measured on
    // the unfixed code (twice): nothing is broadcast during this pause, and the save then
    // broadcasts once, changing only `templates` — which was enough to bring Settings back
    // on General.
    await settle(1000);
    expect(currentSection()).toBe("Templates");

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Kept here" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await settle(500);

    // Still on Templates, and the saved template is listed (its name input).
    expect(currentSection()).toBe("Templates");
    expect(screen.getByDisplayValue("Kept here")).toBeInTheDocument();
  }, 45000);
});
