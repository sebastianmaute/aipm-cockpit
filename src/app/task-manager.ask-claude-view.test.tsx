// §702: which view does the assistant's request report when "Ask Claude" is
// pressed on a page? The view-switch counter compares the view-guide block
// (`system` block 1) between sends, and that block is chosen from the
// snapshot's `currentView`. The chat itself only shows on its own tab, so a
// TYPED message always reports "chat"; whether an Ask-Claude auto-send reports
// the page it was pressed on decides what a counted "switch" means in practice.
//
// ★★ MEASURED, 2026-10-13: an Ask-Claude press with the chat panel already
//    mounted reports the page it was pressed on, so the counter sees a view
//    switch between it and a typed follow-up. The press that MOUNTS the chat
//    panel (the session's first) reports "chat" instead — the mechanism is not
//    established, and the model is then not told which page the user asked
//    about. That is the defect §703, and the test PINS it on purpose: fixing
//    §703 turns the pin red, and the fix flips it to "dashboard". (Not
//    `it.fails`, which passes on ANY failure, a timeout included, so it would
//    go on passing when the press stopped sending at all.)
//
// ★ Full mount on purpose: the answer depends on React's effect ORDER between
//   ChatPanel's seed effect (a child, which submits synchronously) and
//   useChatDispatcher's view-ref effect (in TaskManager, the parent). A
//   harness of either half alone could not see it.
import "fake-indexeddb/auto";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetMintStateForTests } from "./id-mint-session";
import { SETTINGS_KEY } from "./use-settings";
import { defaultAiConfig } from "./settings-types";
import TaskManager from "./task-manager";

function seedRegistry() {
  window.localStorage.setItem(
    "aipm-cockpit:projects",
    JSON.stringify({
      projects: [{ id: "p1", name: "Seed", code: "SEED", storageConfig: { kind: "browser" } }],
      currentProjectId: "p1",
    }),
  );
}

// The guide library loads asynchronously, and a press made before it is ready
// only PREFILLS the box: ChatPanel's send gate blocks while guides are pending.
// Count the store's loads so the test can wait until every one has settled.
// ★ The count stands in for readiness ONLY on the localStorage backend this
//   test uses (no Turso config): `refresh` marks the library loaded a
//   microtask after the last load settles, and its save-then-reload gap is
//   microtask-only too. Against Turso that gap is a network wait, and a
//   settled count could read true before the reload starts — don't copy it.
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

type WireBody = { system: { text: string }[]; messages: unknown[] };

/** The `Current view:` line the request's turn context carried. */
function reportedView(body: WireBody): string | undefined {
  return JSON.stringify(body.messages).match(/Current view: ([\w-]+)\./)?.[1];
}

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

  it("reports the page for an Ask-Claude press once the chat is mounted, the chat tab for a typed message, and (§703) the chat tab for the press that mounts it", async () => {
    seedRegistry();
    window.localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({ ai: { ...defaultAiConfig, enabled: true, consentAccepted: true, apiKey: "sk-test" } }),
    );
    const bodies: WireBody[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("/v1/messages")) {
        bodies.push(JSON.parse(String(init?.body)) as WireBody);
        return Promise.resolve({
          ok: true,
          text: () => Promise.resolve(""),
          json: () =>
            Promise.resolve({
              content: [{ type: "text", text: "done" }],
              stop_reason: "end_turn",
              usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
            }),
        } as unknown as Response);
      }
      if (url.includes("/v1/models")) {
        return Promise.resolve({
          ok: true,
          text: () => Promise.resolve(""),
          json: () => Promise.resolve({ data: [] }),
        } as unknown as Response);
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`));
    });

    render(<TaskManager />);
    const header = await screen.findByRole("banner", undefined, { timeout: 15_000 });
    const ask = await within(header).findByRole("button", { name: "Ask Claude" }, { timeout: 15_000 });
    // The landing view, which the request should name if it reports the page.
    expect(window.location.hash).toBe("#dashboard");

    const askFromHere = async (n: number) => {
      fireEvent.click(within(screen.getByRole("banner")).getByRole("button", { name: "Ask Claude" }));
      const menu = await screen.findByRole("dialog", { name: "Ask Claude" });
      fireEvent.click(within(menu).getAllByRole("button")[0]);
      await waitFor(() => expect(bodies).toHaveLength(n), { timeout: 15_000 });
    };
    expect(ask).toBeInTheDocument();
    await waitFor(
      () => {
        expect(guideLoads.settled).toBeGreaterThan(0);
        expect(guideLoads.settled).toBe(guideLoads.started);
      },
      { timeout: 15_000 },
    );
    // Before the first press the chat panel is not mounted (in either composer
    // state); the box found after the press is the positive half of that check.
    expect(screen.queryByPlaceholderText("Ask Claude about your tasks…")).toBeNull();
    expect(screen.queryByPlaceholderText("Loading operating guides…")).toBeNull();
    await askFromHere(1);
    // §703, PINNED: the press that mounts the panel reports the chat tab, not
    // the dashboard it was pressed on. Fixing §703 turns this red; flip it.
    expect(reportedView(bodies[0])).toBe("chat");

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
    await askFromHere(3);
    expect(reportedView(bodies[2])).toBe("dashboard");

    // So that send carries a different view-guide block than the typed message
    // before it, and the counter will count it as a switch.
    const viewBlock = (b: WireBody) => b.system.slice(1).map((x) => x.text).join("\n\n");
    expect(viewBlock(bodies[2])).not.toBe(viewBlock(bodies[1]));
  }, 60_000);
});
