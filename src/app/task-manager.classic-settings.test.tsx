// §650 fix round 2 — a banner's "open settings" action in the CLASSIC layout.
//
// Classic has no Settings view: `setActiveTab("settings")` is bounced to chat by task-manager's
// classic-fallback effect, and classic settings live in the header's `SettingsMenu` popover. So
// both banners' buttons (the AI key banner's "Open AI settings" and `StorageBanner`'s "Open
// storage settings") must OPEN THAT POPOVER in classic, and keep navigating to the Settings view in
// the modern shell. The popover's own dismissal protocol (Escape, focus restore to its trigger)
// must hold when it was opened from a banner rather than from the gear.
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetMintStateForTests } from "./id-mint-session";
import { __resetAiKeyStatusForTests, reportAiKeyResponse } from "./ai-key-status";

vi.mock("./use-ai-key-check", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./use-ai-key-check")>()),
  useAiKeyCheck: () => {},
}));

// Capture the storage hook's args so a test can report a storage failure AFTER the mount's own
// load outcome has settled (a load success would otherwise clear the staged failure).
const storage = vi.hoisted(() => ({ onStorageOutcome: null as ((err: unknown | null) => void) | null }));
vi.mock("./use-storage-backend", async (importOriginal) => {
  const mod = await importOriginal<typeof import("./use-storage-backend")>();
  return {
    ...mod,
    useStorageBackend: (args: Parameters<typeof mod.useStorageBackend>[0]) => {
      storage.onStorageOutcome = args.onStorageOutcome ?? null;
      return mod.useStorageBackend(args);
    },
  };
});

vi.mock("./workspace-section", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./workspace-section")>()),
  WorkspaceSection: () => <div data-testid="ws-section-mock" />,
}));

import TaskManager from "./task-manager";

const KEY = "sk-ant-api03-ClassicSettingsKey000000";

function seed(layout: "modern" | "classic") {
  window.localStorage.clear();
  window.localStorage.setItem("aipm-cockpit:settings", JSON.stringify({ layout, ai: { enabled: true } }));
  window.localStorage.setItem(
    "aipm-cockpit:projects",
    JSON.stringify({
      projects: [{ id: "p1", name: "Seed", code: "SEED", storageConfig: { kind: "browser" } }],
      currentProjectId: "p1",
    }),
  );
}

async function mount() {
  render(<TaskManager />);
  await screen.findByTestId("ws-section-mock", undefined, { timeout: 40000 });
}

const settingsPopover = () => screen.queryByRole("dialog", { name: "Settings" });
const settingsView = () => screen.queryByRole("navigation", { name: "Settings" });

async function raiseStorageBanner() {
  // Let the mount's own load outcome land first, then fail.
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  act(() => storage.onStorageOutcome?.(new Error("boom")));
  return screen.findByRole("region", { name: "Storage connection problem" });
}

beforeEach(() => {
  __resetMintStateForTests();
  __resetAiKeyStatusForTests();
  storage.onStorageOutcome = null;
});
afterEach(() => {
  window.history.replaceState(null, "", "/");
});

describe("classic layout — a banner's open-settings action opens the header settings popover", () => {
  it("the AI key banner's action opens Settings with the AI section in it", async () => {
    seed("classic");
    reportAiKeyResponse(KEY, 401);
    await mount();
    expect(settingsPopover()).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open AI settings" }));
    const popover = await screen.findByRole("dialog", { name: "Settings" });
    expect(within(popover).getByRole("checkbox", { name: "Enable AI assistant" })).toBeInTheDocument();
  }, 45000);

  it("the storage banner's action opens it too", async () => {
    seed("classic");
    await mount();
    const region = await raiseStorageBanner();
    fireEvent.click(within(region).getByRole("button", { name: "Open storage settings" }));
    expect(await screen.findByRole("dialog", { name: "Settings" })).toBeInTheDocument();
  }, 45000);

  it("focus lands inside the popover, and Escape closes it and returns focus to the settings trigger", async () => {
    seed("classic");
    reportAiKeyResponse(KEY, 401);
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Open AI settings" }));
    const popover = await screen.findByRole("dialog", { name: "Settings" });
    await waitFor(() => expect(popover.contains(document.activeElement)).toBe(true));
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    await waitFor(() => expect(settingsPopover()).toBeNull());
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Settings" }));
  }, 45000);
});

describe("classic layout — the controlled popover follows the gear and dies with the layout", () => {
  it("the gear opens and closes the controlled menu", async () => {
    seed("classic");
    await mount();
    const gear = screen.getByRole("button", { name: "Settings" });
    fireEvent.click(gear);
    expect(await screen.findByRole("dialog", { name: "Settings" })).toBeInTheDocument();
    expect(gear).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(gear);
    await waitFor(() => expect(settingsPopover()).toBeNull());
    expect(gear).toHaveAttribute("aria-expanded", "false");
  }, 45000);

  it("a layout switch closes it: open in classic, pick Modern in it, switch back to Classic — the popover is closed", async () => {
    seed("classic");
    reportAiKeyResponse(KEY, 401); // gives the modern shell a way back into Settings (the banner)
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    const popover = await screen.findByRole("dialog", { name: "Settings" });
    fireEvent.click(within(popover).getByRole("radio", { name: "Modern" }));
    // Modern shell: no classic header, so no popover.
    await waitFor(() => expect(screen.queryByRole("button", { name: "Open AI settings" })).not.toBeNull());
    expect(settingsPopover()).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open AI settings" }));
    await screen.findByRole("navigation", { name: "Settings" });
    fireEvent.click(screen.getByRole("button", { name: "Appearance" }));
    fireEvent.click(await screen.findByRole("radio", { name: "Classic" }));
    // Back in classic: the header (and its gear) is back, and the popover must NOT reappear.
    await screen.findByRole("button", { name: "Settings" });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(settingsPopover()).toBeNull();
  }, 45000);
});

describe("modern layout — unchanged: the actions navigate to the Settings view", () => {
  it("the AI key banner's action lands on Settings → AI, with no popover", async () => {
    seed("modern");
    reportAiKeyResponse(KEY, 401);
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Open AI settings" }));
    expect(await screen.findByRole("navigation", { name: "Settings" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Enable AI assistant" })).toBeInTheDocument();
    expect(settingsPopover()).toBeNull();
  }, 45000);

  it("the storage banner's action lands on the Settings view, with no popover", async () => {
    seed("modern");
    await mount();
    const region = await raiseStorageBanner();
    expect(settingsView()).toBeNull();
    fireEvent.click(within(region).getByRole("button", { name: "Open storage settings" }));
    expect(await screen.findByRole("navigation", { name: "Settings" })).toBeInTheDocument();
    expect(settingsPopover()).toBeNull();
  }, 45000);
});
