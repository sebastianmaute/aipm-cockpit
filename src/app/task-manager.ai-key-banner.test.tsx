// §650 — pins the JOIN between the in-memory AI key verdict and the banner that tells the user:
// mounted in BOTH shells (modern default + classic — the two-shell trap, AGENTS.md "Top bar in TWO
// independent places"), absent from popouts, dismissible for the page, and its one action lands on
// Settings → AI. `notifications.ai-key.test.tsx` covers the component alone; nothing but this file
// sees task-manager mount it. The start-up check is mocked out (its own suite is
// use-ai-key-check.test.tsx) so the verdict staged here is the one the banner reads, and so the
// test can assert the check is mounted with the popout flag.
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetMintStateForTests } from "./id-mint-session";
import { __resetAiKeyStatusForTests, reportAiKeyResponse, reportAiKeyUnreadable, syncAiKey } from "./ai-key-status";

const checkCalls = vi.hoisted(() => ({ args: [] as { isPopout: boolean; hydrated: boolean }[] }));
vi.mock("./use-ai-key-check", async (importOriginal) => {
  const mod = await importOriginal<typeof import("./use-ai-key-check")>();
  return {
    ...mod,
    useAiKeyCheck: (args: Parameters<typeof mod.useAiKeyCheck>[0]) => {
      checkCalls.args.push({ isPopout: args.isPopout, hydrated: args.hydrated });
    },
  };
});

vi.mock("./workspace-section", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./workspace-section")>()),
  WorkspaceSection: () => <div data-testid="ws-section-mock" />,
}));

import TaskManager from "./task-manager";

const KEY = "sk-ant-api03-BannerTestKey0000000000";
const KEY_2 = "sk-ant-api03-BannerTestKey2222222222";
const REJECTED = "Claude rejected your Anthropic API key. Enter a new key in Settings → AI.";

function seed(layout: "modern" | "classic", aiEnabled = true) {
  window.localStorage.clear();
  window.localStorage.setItem("aipm-cockpit:settings", JSON.stringify({ layout, ai: { enabled: aiEnabled } }));
  window.localStorage.setItem(
    "aipm-cockpit:projects",
    JSON.stringify({
      projects: [{ id: "p1", name: "Seed", code: "SEED", storageConfig: { kind: "browser" } }],
      currentProjectId: "p1",
    }),
  );
}

async function mountAt(search = "/") {
  window.history.replaceState(null, "", search);
  render(<TaskManager />);
  await screen.findByTestId("ws-section-mock", undefined, { timeout: 40000 });
}

function banner() {
  return screen.queryByRole("region", { name: "Anthropic API key problem" });
}

beforeEach(() => {
  __resetMintStateForTests();
  __resetAiKeyStatusForTests();
  checkCalls.args.length = 0;
});
afterEach(() => {
  window.history.replaceState(null, "", "/");
});

describe("task-manager → AI key banner", () => {
  it("modern shell: a rejected key shows the banner, and its action opens Settings → AI", async () => {
    seed("modern");
    reportAiKeyResponse(KEY, 401);
    await mountAt();
    const el = banner();
    expect(el).not.toBeNull();
    expect(el).toHaveTextContent(REJECTED);
    expect(screen.queryByRole("checkbox", { name: "Enable AI assistant" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open AI settings" }));
    expect(await screen.findByRole("checkbox", { name: "Enable AI assistant" })).toBeInTheDocument();
    // The check is mounted for the main window.
    expect(checkCalls.args.some((a) => a.isPopout === false)).toBe(true);
  }, 45000);

  it("classic shell: the banner renders too", async () => {
    seed("classic");
    reportAiKeyResponse(KEY, 403);
    await mountAt();
    expect(banner()).toHaveTextContent("Your Anthropic API key isn't allowed to make this request.");
  }, 45000);

  it("an unreadable key shows the banner", async () => {
    seed("modern");
    reportAiKeyUnreadable();
    await mountAt();
    expect(banner()).toHaveTextContent("Your saved Anthropic API key couldn't be read on this device.");
  }, 45000);

  it("dismiss hides it for the page", async () => {
    seed("modern");
    reportAiKeyResponse(KEY, 401);
    await mountAt();
    expect(banner()).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(banner()).toBeNull();
  }, 45000);

  it("a dismissal belongs to the verdict it dismissed: a NEW key refused again shows the banner again", async () => {
    seed("modern");
    reportAiKeyResponse(KEY, 401);
    await mountAt();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(banner()).toBeNull();
    // The user enters a new key: the verdict resets to unknown …
    act(() => syncAiKey(KEY_2));
    expect(banner()).toBeNull();
    // … and that key is refused too.
    act(() => reportAiKeyResponse(KEY_2, 401));
    expect(banner()).not.toBeNull();
  }, 45000);

  it("is not rendered in a popout, and the popout mounts the check with isPopout", async () => {
    seed("modern");
    reportAiKeyResponse(KEY, 401);
    await mountAt("/?popout=budget");
    expect(banner()).toBeNull();
    expect(checkCalls.args.length).toBeGreaterThan(0);
    expect(checkCalls.args.every((a) => a.isPopout === true)).toBe(true);
  }, 45000);

  it("is not rendered for a good key, or while AI is switched off", async () => {
    seed("modern");
    reportAiKeyResponse(KEY, 200);
    await mountAt();
    expect(banner()).toBeNull();
  }, 45000);

  it("is not rendered while AI is switched off, even for a rejected key", async () => {
    seed("modern", false);
    reportAiKeyResponse(KEY, 401);
    await mountAt();
    expect(banner()).toBeNull();
  }, 45000);
});
