// Pins the JOIN between the truncation guard and its only escape hatch.
//
// ★★★ WHY A WHOLE FILE. Both HALVES were already covered and both keep passing
// while the feature is dead: `use-load-truncation.test.ts` proves the guard
// raises/lowers, and `notifications.test.tsx` proves the banner renders and
// calls the props it is handed. Neither sees task-manager. Measured on
// 2026-08-07: deleting the three JSX lines that mount `TruncatedLoadBanner`
// left the entire unit suite GREEN, and so did swapping its `onSaveAnyway` for
// the dismiss handler — i.e. a save lockout with no exit, shipped green.
//
// The other half of the same seam is the DISMISSAL. The banner must stay
// dismissable (a banner you cannot clear makes the fastest way to tidy your
// screen the irreversible button), which means the ONLY surface carrying "Save
// anyway" can be gone for the rest of the session. The sidebar's "saving
// paused" control is the door back, and nothing but this file pins that it
// exists, that it is reachable, and that clicking it re-opens the banner.
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { __resetMintStateForTests } from "./id-mint-session";

// Per-test overrides layered over the REAL hook, so everything task-manager
// needs from storage keeps working and only the truncation fields are staged.
const override = vi.hoisted(() => ({
  value: {} as Record<string, unknown>,
  allowTruncatedSave: vi.fn(),
}));

vi.mock("./use-storage-backend", async (importOriginal) => {
  const mod = await importOriginal<typeof import("./use-storage-backend")>();
  return {
    ...mod,
    useStorageBackend: (args: Parameters<typeof mod.useStorageBackend>[0]) => ({
      ...mod.useStorageBackend(args),
      ...override.value,
    }),
  };
});

// The expensive child; this suite only cares about the shell chrome + banners.
vi.mock("./workspace-section", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./workspace-section")>()),
  WorkspaceSection: () => <div data-testid="ws-section-mock" />,
}));

// `storageOk` is a derived boolean with no unique DOM of its own in this
// harness (`storageDescription` is null until a backend names itself, so the
// green/grey dot never renders). Record the prop instead — the real footer
// still renders underneath, so the paused control is exercised for real.
const footerSeen = vi.hoisted(() => ({ storageReady: [] as boolean[] }));
vi.mock("./sidebar-footer", async (importOriginal) => {
  const mod = await importOriginal<typeof import("./sidebar-footer")>();
  return {
    ...mod,
    SidebarFooter: (props: Parameters<typeof mod.SidebarFooter>[0]) => {
      footerSeen.storageReady.push(props.storageReady);
      return <mod.SidebarFooter {...props} />;
    },
  };
});

import TaskManager from "./task-manager";

const TRUNCATED = { entries: 5, blocks: 0 };

beforeEach(() => {
  __resetMintStateForTests();
  footerSeen.storageReady.length = 0;
  override.allowTruncatedSave = vi.fn();
  override.value = {
    // ★ Forced true so `storageOk`'s OTHER terms cannot decide the outcome. The
    // real browser backend never reports ready inside this harness, which would
    // make "never healthy while paused" true for a reason that has nothing to do
    // with the truncation guard — a vacuous pass.
    storageReady: true,
    truncation: TRUNCATED,
    loadWasTruncated: true,
    allowTruncatedSave: override.allowTruncatedSave,
  };
  window.localStorage.clear();
  window.localStorage.setItem(
    "aipm-cockpit:projects",
    JSON.stringify({
      projects: [{ id: "p1", name: "Seed", code: "SEED", storageConfig: { kind: "browser" } }],
      currentProjectId: "p1",
    }),
  );
});

async function mountApp() {
  const utils = render(<TaskManager />);
  await screen.findByTestId("ws-section-mock", undefined, { timeout: 40000 });
  return utils;
}

/** The banner, found by the role it must announce itself with. */
function banner() {
  return screen.queryByRole("alert", { name: /could not be opened/i });
}

/** The sidebar control that re-opens a dismissed banner. */
function pausedControl() {
  return screen.queryByRole("button", { name: /saving paused/i });
}

describe("task-manager → truncation banner mount", () => {
  it("mounts the banner for a truncated load, with the count the guard reported", async () => {
    await mountApp();
    const el = banner();
    expect(el).not.toBeNull();
    // The magnitude has to survive the hop — a banner wired to a hardcoded
    // `truncation={null}` renders and says nothing about how much was lost.
    expect(within(el as HTMLElement).getByText(/5 document entries could not be opened/i)).toBeInTheDocument();
  }, 45000);

  it("wires the primary action to allowTruncatedSave, not to the dismiss handler", async () => {
    await mountApp();
    fireEvent.click(within(banner() as HTMLElement).getByRole("button", { name: "Save anyway" }));

    // Real ConfirmProvider is in the tree, so the gate is exercised end to end.
    await screen.findByText("Save anyway?");
    expect(override.allowTruncatedSave).not.toHaveBeenCalled();

    const confirms = screen.getAllByRole("button", { name: "Save anyway" });
    fireEvent.click(confirms[confirms.length - 1]);
    await waitFor(() => expect(override.allowTruncatedSave).toHaveBeenCalledTimes(1));
    // ...and it did NOT merely hide itself: the guard is what resolves this.
    expect(banner()).not.toBeNull();
  }, 45000);

  it("dismiss hides the banner without resolving the truncation, and the indicator brings it back", async () => {
    await mountApp();
    fireEvent.click(within(banner() as HTMLElement).getByRole("button", { name: /dismiss/i }));

    await waitFor(() => expect(banner()).toBeNull());
    // The lockout is still in force — dismissing is not consenting.
    expect(override.allowTruncatedSave).not.toHaveBeenCalled();

    // ...and the door back exists and works.
    const control = pausedControl();
    expect(control).not.toBeNull();
    fireEvent.click(control as HTMLElement);
    await waitFor(() => expect(banner()).not.toBeNull());
  }, 45000);

  it("a NEW truncated load re-shows a dismissed banner, with the new count", async () => {
    // ★★ The render-time reconcile. Two truncated projects in a row never lower
    // `loadWasTruncated`, so a dismissal keyed on the BOOLEAN would carry over
    // and project #2's banner would arrive already dismissed — the user is never
    // told its documents could not be opened either. Keyed on the counts object,
    // a fresh report re-opens it.
    const { rerender } = await mountApp();
    fireEvent.click(within(banner() as HTMLElement).getByRole("button", { name: /dismiss/i }));
    await waitFor(() => expect(banner()).toBeNull());

    override.value = { ...override.value, truncation: { entries: 9, blocks: 0 } };
    rerender(<TaskManager />);

    await waitFor(() => expect(banner()).not.toBeNull());
    expect(within(banner() as HTMLElement).getByText(/9 document entries could not be opened/i)).toBeInTheDocument();
  }, 45000);

  it("stops reporting storage as healthy while saving is paused", async () => {
    // ★ `storageOk` must fold in `loadWasTruncated`. Reporting healthy while
    // nothing is being written is the WRONG signal, not merely a missing one.
    // The control for this assertion is the clean-load test below, which proves
    // this harness DOES reach `storageReady: true` once a load lands — without
    // it, "never true" would be satisfied by a mount that never got that far.
    await mountApp();
    await waitFor(() => expect(footerSeen.storageReady.length).toBeGreaterThan(0));
    expect(footerSeen.storageReady.some((v) => v === true)).toBe(false);
  }, 45000);

  it("shows neither the banner nor the paused indicator on a clean load, and reports healthy", async () => {
    override.value = { storageReady: true, truncation: null, loadWasTruncated: false, allowTruncatedSave: override.allowTruncatedSave };
    await mountApp();
    expect(banner()).toBeNull();
    expect(pausedControl()).toBeNull();
    // The control described above: healthy really is reachable here.
    await waitFor(() => expect(footerSeen.storageReady).toContain(true), { timeout: 40000 });
  }, 45000);
});
