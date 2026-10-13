// §702: which view does the assistant's request report when "Ask Claude" is
// pressed on a page? The view-switch counter compares the view-guide block
// (`system` block 1) between sends, and that block is chosen from the
// snapshot's `currentView`. The chat itself only shows on its own tab, so a
// TYPED message always reports "chat"; whether an Ask-Claude auto-send reports
// the page it was pressed on decides what a counted "switch" means in practice.
//
// ★★ An Ask-Claude press reports the page it was pressed on, so the counter
//    sees a view switch between it and a typed follow-up. Until §703 the press
//    that MOUNTS the chat panel (the session's first) reported "chat": the
//    report came from whichever value the view ref held when the chat's seed
//    effect ran, and the panel is a lazy chunk that mounts after the parent's
//    effect has written "chat". The seed now carries the view it was requested
//    from (`ChatSeed.originView`), so no press depends on effect order.
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

function seedAiSettings() {
  window.localStorage.setItem(
    SETTINGS_KEY,
    JSON.stringify({ ai: { ...defaultAiConfig, enabled: true, consentAccepted: true, apiKey: "sk-test" } }),
  );
}

/** Answers every Claude request with "done" and records its body. */
function mockClaude(bodies: WireBody[]) {
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
}

/** Presses Ask Claude in the header, picks the first prompt, waits for request n. */
async function askFromHere(bodies: WireBody[], n: number) {
  fireEvent.click(within(screen.getByRole("banner")).getByRole("button", { name: "Ask Claude" }));
  const menu = await screen.findByRole("dialog", { name: "Ask Claude" });
  fireEvent.click(within(menu).getAllByRole("button")[0]);
  await waitFor(() => expect(bodies).toHaveLength(n), { timeout: 15_000 });
}

/** Waits until every guide load has settled, so a press sends instead of prefilling. */
async function waitForGuides() {
  await waitFor(
    () => {
      expect(guideLoads.settled).toBeGreaterThan(0);
      expect(guideLoads.settled).toBe(guideLoads.started);
    },
    { timeout: 15_000 },
  );
}

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
    await waitForGuides();
    // Before the first press the chat panel is not mounted (in either composer
    // state); the box found after the press is the positive half of that check.
    expect(screen.queryByPlaceholderText("Ask Claude about your tasks…")).toBeNull();
    expect(screen.queryByPlaceholderText("Loading operating guides…")).toBeNull();
    await askFromHere(bodies, 1);
    // §703: the press that mounts the panel reports the dashboard it was
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

  it("§703: the first press from a digest view sends that view and its digest", async () => {
    seedRegistry();
    seedAiSettings();
    const bodies: WireBody[] = [];
    mockClaude(bodies);

    render(<TaskManager />);
    const header = await screen.findByRole("banner", undefined, { timeout: 15_000 });
    await within(header).findByRole("button", { name: "Ask Claude" }, { timeout: 15_000 });
    await waitForGuides();
    // The app lands on the dashboard whatever the URL says; navigate as a user would.
    act(() => {
      window.location.hash = "#open-points";
    });
    await waitFor(() => expect(window.location.hash).toBe("#open-points"));
    expect(screen.queryByPlaceholderText("Ask Claude about your tasks…")).toBeNull();

    await askFromHere(bodies, 1);
    expect(reportedView(bodies[0])).toBe("open-points");
    // The open-points digest, which the chat tab has none of.
    expect(JSON.stringify(bodies[0])).toMatch(/tasks? visible as/);
  }, 60_000);
});
