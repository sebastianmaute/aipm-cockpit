// Integration test: the stakeholder-comms reminder banner is mode-gated.
// Seeds workspace data through the default BrowserBackend (fake-indexeddb) and
// feature flags through the `lop-app:settings` localStorage key, then renders
// the real <TaskManager /> and asserts the banner appears only when the
// stakeholders module is enabled.
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import TaskManager from "./task-manager";
import { createBackend, emptyWorkspace } from "./storage";
import { ALL_MODULE_IDS } from "./feature-modules";
import type { Milestone, Stakeholder } from "./types";

// A High/High ("manage-closely") stakeholder who is RACI-linked to a milestone.
function makeStakeholder(milestoneId: number): Stakeholder {
  return {
    id: 1,
    name: "Dana Sponsor",
    organization: "Acme",
    category: "Sponsor",
    influence: "High",
    interest: "High",
    raci: { [String(milestoneId)]: "A" },
    localModifiedAt: "2026-06-09T10:00:00.000Z",
  };
}

// A milestone due in 3 days (inside the manage-closely 14-day lead window).
function makeDueSoonMilestone(today: string): Milestone {
  const due = new Date(`${today}T00:00:00Z`);
  due.setUTCDate(due.getUTCDate() + 3);
  return { id: 2, name: "Go live", date: due.toISOString().slice(0, 10), linkedTaskIds: [] };
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

async function seedWorkspace(stakeholders: Stakeholder[], milestones: Milestone[]): Promise<void> {
  await createBackend({ kind: "browser" }).save({
    ...emptyWorkspace(),
    stakeholders,
    milestones,
  });
}

function seedFeatures(features: readonly string[]): void {
  window.localStorage.setItem("lop-app:settings", JSON.stringify({ features }));
}

describe("TaskManager stakeholder-comms banner gating", () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
    window.localStorage.clear();
  });
  afterEach(() => {
    cleanup();
    globalThis.indexedDB = new IDBFactory();
  });

  it("shows the comms banner when the stakeholders module is enabled", async () => {
    const today = todayISO();
    const ms = makeDueSoonMilestone(today);
    await seedWorkspace([makeStakeholder(ms.id)], [ms]);
    seedFeatures([...ALL_MODULE_IDS]);

    render(<TaskManager />);

    // The banner only appears after async backend hydration + load; allow a
    // generous timeout so a loaded test worker doesn't flake on the default 1s.
    expect(
      await screen.findByTestId("stakeholder-comms-banner", {}, { timeout: 20000 }),
    ).toBeInTheDocument();
  }, 30000);

  it("hides the comms banner when the stakeholders module is disabled", async () => {
    const today = todayISO();
    const ms = makeDueSoonMilestone(today);
    await seedWorkspace([makeStakeholder(ms.id)], [ms]);
    seedFeatures(ALL_MODULE_IDS.filter((id) => id !== "stakeholders"));

    render(<TaskManager />);

    // Wait for hydration/load to settle, then assert the banner stays absent.
    await screen.findByText("PROJECT MANAGEMENT TRACKER", {}, { timeout: 20000 });
    await waitFor(() => {
      expect(screen.queryByTestId("stakeholder-comms-banner")).not.toBeInTheDocument();
    });
  }, 30000);
});
