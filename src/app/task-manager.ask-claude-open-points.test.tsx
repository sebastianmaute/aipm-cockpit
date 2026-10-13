// §703: an "Ask Claude" press on Open Points, where the chat panel is not
// mounted. Measured 2026-10-13 against the pre-fix code: such a press
// reported "chat" even with the chat panel's lazy chunk already loaded, so it
// is the case that does not depend on that chunk (see the header of
// `task-manager.ask-claude-view.test.tsx` for the rest of the measurement).
// ★★ Its own file because it loads the chat chunk before pressing, which the
//    first-press case in the other file must not see — the header of
//    `src/test/ask-claude-harness.ts` records the order dependence.
import "fake-indexeddb/auto";
import { act, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetMintStateForTests } from "./id-mint-session";
import TaskManager from "./task-manager";
import {
  askFromHere,
  mockClaude,
  reportedView,
  seedAiSettings,
  seedRegistry,
  waitForGuides,
  type WireBody,
} from "../test/ask-claude-harness";

// Counts the guide store's loads for `waitForGuides` (the harness says why).
const guideLoads = vi.hoisted(() => ({ started: 0, settled: 0 }));
vi.mock("./operating-guide-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./operating-guide-store")>();
  return {
    ...actual,
    loadGuides: async (...args: Parameters<typeof actual.loadGuides>) => {
      guideLoads.started += 1;
      try {
        return await actual.loadGuides(...args);
      } finally {
        guideLoads.settled += 1;
      }
    },
  };
});

describe("§703 — an Ask-Claude press on Open Points", () => {
  beforeEach(() => {
    __resetMintStateForTests();
    guideLoads.started = 0;
    guideLoads.settled = 0;
    window.localStorage.clear();
    window.history.replaceState(null, "", "/");
  });
  afterEach(() => {
    vi.restoreAllMocks();
    window.history.replaceState(null, "", "/");
  });

  it("sends that view and its digest, with the chat panel not mounted", async () => {
    seedRegistry();
    seedAiSettings();
    const bodies: WireBody[] = [];
    mockClaude(bodies);

    render(<TaskManager />);
    const header = await screen.findByRole("banner", undefined, { timeout: 15_000 });
    await within(header).findByRole("button", { name: "Ask Claude" }, { timeout: 15_000 });
    await waitForGuides(guideLoads);
    // Let the chat panel's lazy chunk load on the dashboard first, so this
    // pins the case that does not depend on it: before §703 this press still
    // reported "chat".
    await screen.findByPlaceholderText("Ask Claude about your tasks…", undefined, { timeout: 15_000 });
    expect(screen.queryByRole("combobox", { name: "Health" })).toBeNull();
    // The app lands on the dashboard whatever the URL says; navigate as a user would.
    act(() => {
      window.location.hash = "#open-points";
    });
    // Open Points' own health filter is on screen, and the chat panel is gone.
    await screen.findByRole("combobox", { name: "Health" }, { timeout: 15_000 });
    expect(screen.queryByPlaceholderText("Ask Claude about your tasks…")).toBeNull();

    await askFromHere(bodies, 1);
    expect(reportedView(bodies[0])).toBe("open-points");
    // The open-points digest, which the chat tab has none of.
    expect(JSON.stringify(bodies[0])).toMatch(/tasks? visible as/);
  }, 60_000);
});
