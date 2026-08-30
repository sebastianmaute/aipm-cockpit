// Pins the JOIN between the truncation guard and its only escape hatch.
//
// ★★★ WHY A WHOLE FILE. Both HALVES were already covered and both keep passing
// while the feature is dead: `use-load-truncation.test.ts` proves the guard
// raises/lowers, and `notifications.test.tsx` proves the banner renders and
// calls the props it is handed. Neither sees task-manager. Measured on
// 2026-08-07: deleting the three JSX lines that mount `TruncatedLoadBanner`
// left the entire unit suite GREEN, and so did swapping its `onSaveAnyway` for
// the dismiss handler — i.e. a save lockout with no exit, shipped green.
// ★ That measurement is DATED and its name is kept as measured: the component
// was renamed to `SavingPausedBanner` on 2026-08-30 when it grew a second cause
// (a refused destructive save). Renaming it inside the record would claim a
// measurement nobody took. The seam it pins is unchanged — this file still
// mounts the real task-manager and still asserts the mount and its handlers.
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
  allowIncompleteSave: vi.fn(),
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
  override.allowIncompleteSave = vi.fn();
  override.value = {
    // ★ Forced true so `storageOk`'s OTHER terms cannot decide the outcome. The
    // real browser backend never reports ready inside this harness, which would
    // make "never healthy while paused" true for a reason that has nothing to do
    // with the truncation guard — a vacuous pass.
    storageReady: true,
    truncation: TRUNCATED,
    loadWasIncomplete: true,
    allowIncompleteSave: override.allowIncompleteSave,
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

  it("wires the primary action to allowIncompleteSave, not to the dismiss handler", async () => {
    await mountApp();
    fireEvent.click(within(banner() as HTMLElement).getByRole("button", { name: "Save anyway" }));

    // Real ConfirmProvider is in the tree, so the gate is exercised end to end.
    await screen.findByText("Save anyway?");
    expect(override.allowIncompleteSave).not.toHaveBeenCalled();

    const confirms = screen.getAllByRole("button", { name: "Save anyway" });
    fireEvent.click(confirms[confirms.length - 1]);
    await waitFor(() => expect(override.allowIncompleteSave).toHaveBeenCalledTimes(1));
    // ...and it did NOT merely hide itself: the guard is what resolves this.
    expect(banner()).not.toBeNull();
  }, 45000);

  it("dismiss hides the banner without resolving the truncation, and the indicator brings it back", async () => {
    await mountApp();
    fireEvent.click(within(banner() as HTMLElement).getByRole("button", { name: /dismiss/i }));

    await waitFor(() => expect(banner()).toBeNull());
    // The lockout is still in force — dismissing is not consenting.
    expect(override.allowIncompleteSave).not.toHaveBeenCalled();

    // ...and the door back exists and works.
    const control = pausedControl();
    expect(control).not.toBeNull();
    fireEvent.click(control as HTMLElement);
    await waitFor(() => expect(banner()).not.toBeNull());
  }, 45000);

  it("a NEW truncated load re-shows a dismissed banner, with the new count", async () => {
    // ★★ The render-time reconcile. Two truncated projects in a row never lower
    // `loadWasIncomplete`, so a dismissal keyed on the BOOLEAN would carry over
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

  it("a SECOND decode-failing load re-shows a dismissed banner, at the same failure count", async () => {
    // ★★★ THE DECODE PATH HAS NO COUNTS OBJECT TO KEY ON. `truncation` is null
    // for the whole of it, so a reconcile keyed on that alone never fires:
    // project A fails to decode → banner → dismiss → project B ALSO fails, and
    // B's banner arrives already dismissed while saving is paused on B and
    // nothing on screen says so.
    // ★★ THE COUNT IS DELIBERATELY HELD AT 2 ACROSS BOTH LOADS. Keying on
    // `decodeFailureCount` would pass this test's premise (two projects, two
    // banners) while failing exactly here — the commonest real shape is the same
    // number of slices failing twice, and a fix that reads as done is worse than
    // none. The nonce is what moves.
    override.value = { ...override.value, truncation: null, decodeFailureCount: 2, decodeFailureNonce: 1, loadWasIncomplete: true };
    const { rerender } = await mountApp();
    fireEvent.click(within(banner() as HTMLElement).getByRole("button", { name: /dismiss/i }));
    await waitFor(() => expect(banner()).toBeNull());

    override.value = { ...override.value, decodeFailureNonce: 2 };
    rerender(<TaskManager />);

    await waitFor(() => expect(banner()).not.toBeNull());
    expect(within(banner() as HTMLElement).getByText(/2 kinds of saved data could not be read/i)).toBeInTheDocument();
  }, 45000);

  it("a SECOND malformed-quote load re-shows a dismissed banner, at the same violation count", async () => {
    // ★★★ THE THIRD CAUSE HAS NEITHER A COUNTS OBJECT NOR THE DECODE NONCE.
    // On the import path `truncation` is null and `decodeFailureNonce` never
    // moves, so a reconcile keyed on those two cannot see this load at all:
    // file A imports with bad quoting → banner → dismiss → file B ALSO imports
    // with bad quoting, and B's banner arrives already dismissed while saving is
    // paused on B and nothing on screen says so. This is the SAME defect the
    // decode test above records, one cause later, reintroduced by adding a third
    // cause to `loadWasIncomplete` without extending the reconcile key.
    // ★★ THE COUNT IS HELD AT 4 ACROSS BOTH LOADS, for the same reason it is
    // held at 2 above: keying on `malformedQuoteCount` would satisfy the premise
    // while failing exactly here, and two files breaking the same NUMBER of
    // quoting rules is the commonest real shape. The nonce is what moves.
    override.value = { ...override.value, truncation: null, decodeFailureCount: 0, decodeFailureNonce: 0, malformedQuoteCount: 4, malformedQuotesNonce: 1, loadWasIncomplete: true };
    const { rerender } = await mountApp();
    fireEvent.click(within(banner() as HTMLElement).getByRole("button", { name: /dismiss/i }));
    await waitFor(() => expect(banner()).toBeNull());

    override.value = { ...override.value, malformedQuotesNonce: 2 };
    rerender(<TaskManager />);

    await waitFor(() => expect(banner()).not.toBeNull());
    expect(within(banner() as HTMLElement).getByText(/breaks CSV quoting rules in 4 place/i)).toBeInTheDocument();
  }, 45000);

  it("names how many kinds of data were unreadable in the save-anyway dialog", async () => {
    // ★★★ THE DECODE CAUSE HAS NO `truncation` COUNTS, so the banner's count
    // line and — the part that matters — the confirm dialog would name NO
    // magnitude at all. That dialog is the last thing the user sees before
    // permanently discarding the data, and "some data" is not enough to decide.
    override.value = {
      ...override.value,
      truncation: null,
      decodeFailureCount: 2,
      loadWasIncomplete: true,
    };
    await mountApp();
    const el = banner();
    expect(el).not.toBeNull();
    fireEvent.click(within(el as HTMLElement).getByRole("button", { name: "Save anyway" }));
    await screen.findByText("Save anyway?");
    // ★ Scoped to the DIALOG. The banner's own count line carries the same
    // sentence, so an unscoped query matches twice and errors — and the dialog
    // is the half that decides, so it is the half asserted here.
    // ★ Named, because the guided tour's welcome dialog is mounted too.
    const dialog = screen.getByRole("dialog", { name: "Save anyway?" });
    expect(within(dialog).getByText(/2 kinds of saved data could not be read/)).toBeInTheDocument();
  }, 45000);

  it("stops reporting storage as healthy while saving is paused", async () => {
    // ★ `storageOk` must fold in `loadWasIncomplete`. Reporting healthy while
    // nothing is being written is the WRONG signal, not merely a missing one.
    // The control for this assertion is the clean-load test below, which proves
    // this harness DOES reach `storageReady: true` once a load lands — without
    // it, "never true" would be satisfied by a mount that never got that far.
    await mountApp();
    await waitFor(() => expect(footerSeen.storageReady.length).toBeGreaterThan(0));
    expect(footerSeen.storageReady.some((v) => v === true)).toBe(false);
  }, 45000);

  it("shows neither the banner nor the paused indicator on a clean load, and reports healthy", async () => {
    override.value = { storageReady: true, truncation: null, loadWasIncomplete: false, allowIncompleteSave: override.allowIncompleteSave };
    await mountApp();
    expect(banner()).toBeNull();
    expect(pausedControl()).toBeNull();
    // The control described above: healthy really is reachable here.
    await waitFor(() => expect(footerSeen.storageReady).toContain(true), { timeout: 40000 });
  }, 45000);
});

// ── the SECOND cause: a refused destructive save ──────────────────────────────
// ★★★ SAME SEAM, SAME REASON THIS FILE EXISTS. `notifications.test.tsx` proves
// the banner renders the destructive cause and calls the props it is handed, and
// `use-storage-backend.test.tsx` proves the guard raises `destructiveRefusal`
// and that `allowDestructiveSaveAnyway` resolves it. Neither sees task-manager,
// so deleting the JSX that mounts this cause — or wiring its `onSaveAnyway` to
// the dismiss handler — leaves both of them green while saving is paused with
// no exit. That is the defect measured for the truncation cause on 2026-08-07.
//
// ★ It lives HERE and not in `task-manager.characterization.test.tsx`: that file
// pins the task-manager→WorkspaceSection PROP CONTRACT and mocks the shell, so
// it cannot reach the banner mount or the real sidebar footer. This file already
// layers per-test overrides over the real hook and renders both for real.
/** The destructive banner, by the role and name it must announce itself with. */
function destructiveBanner() {
  return screen.queryByRole("alert", { name: /large deletion was withheld/i });
}

describe("task-manager → destructive-refusal banner mount", () => {
  const REFUSAL = { prevCollections: 4, prevRecords: 900, curCollections: 1, curRecords: 53, fullWipe: false };
  let allowAnyway: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    allowAnyway = vi.fn();
    // ★ NO truncation. The two lockouts cannot hold at once (the save effect
    // returns on truncation ABOVE the destructive guard), so staging both would
    // pin a state the app cannot reach — and the truncation banner would satisfy
    // a loosely-written query here.
    override.value = {
      storageReady: true,
      truncation: null,
      loadWasIncomplete: false,
      allowIncompleteSave: override.allowIncompleteSave,
      destructiveRefusal: REFUSAL,
      allowDestructiveSaveAnyway: allowAnyway,
    };
  });

  it("mounts the banner for a standing refusal, with the magnitude the guard reported", async () => {
    await mountApp();
    const el = destructiveBanner();
    expect(el).not.toBeNull();
    // The counts have to survive the hop — a mount wired to hardcoded zeroes
    // renders and tells the user nothing about how much would be removed.
    expect(within(el as HTMLElement).getByText(/847 of 900 records would be removed/i)).toBeInTheDocument();
    // ...and it is THIS cause, not the truncation one reaching the same banner.
    expect(banner()).toBeNull();
  }, 45000);

  it("wires the primary action to allowDestructiveSaveAnyway, not to the dismiss handler", async () => {
    await mountApp();
    fireEvent.click(within(destructiveBanner() as HTMLElement).getByRole("button", { name: "Save this deletion" }));

    // Real ConfirmProvider in the tree, so the gate is exercised end to end.
    await screen.findByText("Save this deletion?");
    expect(allowAnyway).not.toHaveBeenCalled();

    fireEvent.click(within(screen.getByRole("dialog", { name: "Save this deletion?" })).getByRole("button", { name: "Remove these records" }));
    await waitFor(() => expect(allowAnyway).toHaveBeenCalledTimes(1));
    // ...and it did NOT merely hide itself: the guard is what resolves this, and
    // the override holds the refusal standing, so the banner must still be up.
    expect(destructiveBanner()).not.toBeNull();
  }, 45000);

  it("dismiss hides the banner without resolving the refusal, and the indicator brings it back", async () => {
    await mountApp();
    fireEvent.click(within(destructiveBanner() as HTMLElement).getByRole("button", { name: /dismiss/i }));

    await waitFor(() => expect(destructiveBanner()).toBeNull());
    expect(allowAnyway).not.toHaveBeenCalled(); // dismissing is not consenting

    const control = pausedControl();
    expect(control).not.toBeNull();
    fireEvent.click(control as HTMLElement);
    await waitFor(() => expect(destructiveBanner()).not.toBeNull());
  }, 45000);

  it("stops reporting storage as healthy while a refusal stands", async () => {
    // ★ `storageOk` must fold in the destructive refusal too, not only
    // `loadWasIncomplete`. The control is the clean-load test in the describe
    // above, which proves this harness DOES reach `storageReady: true` — without
    // it, "never true" would be satisfied by a mount that never got that far.
    await mountApp();
    await waitFor(() => expect(footerSeen.storageReady.length).toBeGreaterThan(0));
    expect(footerSeen.storageReady.some((v) => v === true)).toBe(false);
  }, 45000);

  it("shows neither the destructive banner nor the paused indicator with no refusal standing", async () => {
    // The negative half of every assertion above: with `destructiveRefusal` null
    // and nothing truncated, this surface is entirely absent.
    override.value = { ...override.value, destructiveRefusal: null };
    await mountApp();
    expect(destructiveBanner()).toBeNull();
    expect(pausedControl()).toBeNull();
    await waitFor(() => expect(footerSeen.storageReady).toContain(true), { timeout: 40000 });
  }, 45000);
});
