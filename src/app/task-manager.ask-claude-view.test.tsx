// §702: which view does the assistant's request report when "Ask Claude" is
// pressed on a page? The view-switch counter compares the view-guide block
// (`system` block 1) between sends, and that block is chosen from the
// snapshot's `currentView`. The chat itself only shows on its own tab, so a
// TYPED message always reports "chat"; whether an Ask-Claude auto-send reports
// the page it was pressed on decides what a counted "switch" means in practice.
//
// ★★ An Ask-Claude press reports the page it was pressed on, so the counter
//    sees a view switch between it and a typed follow-up. Until §703 a press
//    that MOUNTED the chat panel reported "chat": the report came from
//    whichever value the view ref held when the chat's seed effect ran. The
//    seed now carries the view it was requested from (`ChatSeed.originView`),
//    so no auto-sent press depends on that.
// ★★ WHEN the panel mounts at the press, measured 2026-10-13 against the
//    pre-fix code by a throwaway probe of this file's own shape: on the
//    dashboard the panel is in the tree and its lazy chunk loads by itself, so
//    a press made once it had loaded reported "dashboard", and only one made
//    before it had (the test below) reported "chat". Open Points renders no
//    WorkspaceSection, so the panel is not mounted there at all, and a press
//    from it reported "chat" even with the chunk already loaded
//    (`task-manager.ask-claude-open-points.test.tsx`). So the lazy chunk is not
//    the whole story; why a mount in the press commit still read "chat" was
//    not traced.
// ★★ This file must keep the chat chunk UNLOADED until its first press, so a
//    test that loads it first belongs in another file — see the header of
//    `src/test/ask-claude-harness.ts` for the order dependence that caused.
//
// ★ Full mount on purpose, as a regression guard: the old answer depended on
//   when ChatPanel's seed effect (a child, which submits synchronously) ran
//   relative to useChatDispatcher's view-ref effect (in TaskManager, the
//   parent), and how that timing played out was not fully traced (above). A
//   harness of either half alone could not see a regression back to that.
import "fake-indexeddb/auto";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

describe("§702 — the view an Ask-Claude send reports", () => {
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

  it("reports the page for every Ask-Claude press, the first included (§703), and the chat tab for a typed message", async () => {
    seedRegistry();
    seedAiSettings();
    const bodies: WireBody[] = [];
    mockClaude(bodies);

    render(<TaskManager />);
    const header = await screen.findByRole("banner", undefined, { timeout: 15_000 });
    const ask = await within(header).findByRole("button", { name: "Ask Claude" }, { timeout: 15_000 });
    // The landing view, which the request should name if it reports the page.
    expect(window.location.hash).toBe("#dashboard");

    expect(ask).toBeInTheDocument();
    await waitForGuides(guideLoads);
    // Before the first press the panel's lazy chunk has not loaded yet (no
    // composer in either state); the box found after the press is the positive
    // half of that check.
    expect(screen.queryByPlaceholderText("Ask Claude about your tasks…")).toBeNull();
    expect(screen.queryByPlaceholderText("Loading operating guides…")).toBeNull();
    await askFromHere(bodies, 1);
    // §703: a press made before the chunk loads reports the dashboard it was
    // pressed on. It reported the chat tab until the seed carried its origin.
    expect(reportedView(bodies[0])).toBe("dashboard");

    // The chat tab is showing now; a typed follow-up reports it.
    const box = await screen.findByPlaceholderText("Ask Claude about your tasks…");
    await waitFor(() => expect(box).not.toBeDisabled());
    fireEvent.change(box, { target: { value: "and next?" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(bodies).toHaveLength(2), { timeout: 15_000 });
    expect(reportedView(bodies[1])).toBe("chat");

    // Back to the dashboard, and Ask Claude again with the chat already loaded.
    act(() => {
      window.location.hash = "#dashboard";
    });
    await waitFor(() => expect(screen.getByPlaceholderText("Ask Claude about your tasks…")).not.toBeVisible());
    await askFromHere(bodies, 3);
    expect(reportedView(bodies[2])).toBe("dashboard");

    // So that send carries a different view-guide block than the typed message
    // before it, and the counter will count it as a switch.
    const viewBlock = (b: WireBody) => b.system.slice(1).map((x) => x.text).join("\n\n");
    expect(viewBlock(bodies[2])).not.toBe(viewBlock(bodies[1]));
  }, 60_000);
});
