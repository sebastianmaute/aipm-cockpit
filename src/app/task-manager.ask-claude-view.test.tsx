// §702: which view does the assistant's request report when "Ask Claude" is
// pressed on a page? The view-switch counter compares the view-guide block
// (`system` block 1) between sends, and that block is chosen from the
// snapshot's `currentView`. The chat itself only shows on its own tab, so a
// TYPED message always reports "chat"; whether an Ask-Claude auto-send reports
// the page it was pressed on decides what a counted "switch" means in practice.
//
// ★★ MEASURED, 2026-10-13: an Ask-Claude press with the chat panel already
//    mounted reports the page it was pressed on, so the counter sees a view
//    switch between it and a typed follow-up. The FIRST press of a session
//    reported "chat" instead — the mechanism is not established, and the model
//    is then not told which page the user asked about (§703). That first press
//    is deliberately NOT asserted here: pinning it would lock in the defect;
//    the fix adds the assertion.
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

type WireBody = { system: { text: string }[]; messages: unknown[] };

/** The `Current view:` line the request's turn context carried. */
function reportedView(body: WireBody): string | undefined {
  return JSON.stringify(body.messages).match(/Current view: ([\w-]+)\./)?.[1];
}

describe("§702 — the view an Ask-Claude send reports", () => {
  beforeEach(() => {
    __resetMintStateForTests();
    window.localStorage.clear();
    window.history.replaceState(null, "", "/");
  });
  afterEach(() => {
    vi.restoreAllMocks();
    window.history.replaceState(null, "", "/");
  });

  it("reports the page for an Ask-Claude press once the chat is mounted, and the chat tab for a typed message", async () => {
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
    // The session's first press mounts the chat; its view is not asserted.
    await askFromHere(1);

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
