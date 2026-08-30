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
import { t } from "./i18n";

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
    fireEvent.click(
      within(banner() as HTMLElement).getByRole("button", { name: t("en-US", "documentsTruncatedSaveAnyway") }),
    );

    // Real ConfirmProvider is in the tree, so the gate is exercised end to end.
    // ★ Named, because the guided tour's welcome dialog is mounted too.
    const dialog = await screen.findByRole("dialog", { name: t("en-US", "documentsTruncatedConfirmTitle") });
    expect(override.allowIncompleteSave).not.toHaveBeenCalled();

    // ★★ NAMES THE BUTTON IT COMMITS WITH, and this replaced a
    // `getAllByRole("button", { name: "Save anyway" })` that clicked the LAST
    // match. That form existed only because the trigger and the confirm's commit
    // shared one accessible name — the WCAG 2.4.6 defect fixed in
    // `notifications.tsx` this same slice — so the test could not say which
    // control it meant and depended on DOM order to reach the right one. Now the
    // commit carries `documentsTruncatedConfirmSaveAnyway`, this is scoped to the
    // dialog and names it. Strictly stronger: the old form would have passed
    // against a click on the trigger had the order gone the other way.
    fireEvent.click(within(dialog).getByRole("button", { name: t("en-US", "documentsTruncatedConfirmSaveAnyway") }));
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
    // The control for this assertion is "shows neither the banner nor the
    // paused indicator on a clean load, and reports healthy", which proves this
    // harness DOES reach `storageReady: true` once a load lands — without it,
    // "never true" would be satisfied by a mount that never got that far.
    // ★ Named, not positioned: the sibling of this comment in the
    // destructive-refusal describe said "the describe above" and pointed at the
    // wrong test. A relative pointer rots on the next insertion.
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
    // ★ NO truncation — but NOT for the reason that used to sit here. That
    // comment said staging both "would pin a state the app cannot reach", and
    // the state WAS reachable: a refusal raised on one project outlived a
    // switch and met the new project's truncating load. Its justification (the
    // save effect returns on truncation ABOVE the destructive guard) only ever
    // covered the OTHER order — a new refusal while truncation stands.
    // Exclusivity takes TWO mechanisms: (a) `allowIncompleteSave` clears all
    // three truncation states, and (b) the save effect's suppress-after-load
    // branch clears a standing refusal, on all nine load/switch/create paths.
    // ★★ Neither can be pinned HERE: this file overrides the storage hook, so
    // it stages banner inputs directly and can never exercise the guard that
    // makes them exclusive. Both live in `use-storage-backend.test.tsx`. What
    // this beforeEach is really doing is the SECOND half of the old comment,
    // which was sound on its own: the truncation banner would satisfy a loosely
    // written query for the destructive one, so stage one cause per test.
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

  it("forwards fullWipe, so a refused FULL WIPE reaches the HEAVY type-to-confirm tier", async () => {
    // ★★★ THIS PINS THE FLAG'S HOP, NOT THE TIER SELECTION. `notifications.test.tsx`
    // already pins the selection: it hands `fullWipe` straight to the component as a
    // PROP and proves `true` mounts `TypeToConfirmDialog` while `false` takes the light
    // `ConfirmDialog`. What nothing pinned is the JOIN — task-manager BUILDS the cause
    // object itself, and `fullWipe: destructiveRefusal.fullWipe` is the only expression
    // carrying the guard's verdict across to the component.
    // ★★ THE MUTANT IT KILLS: replace that one expression with a literal `false`. The
    // whole suite stays GREEN — the component tests never go through task-manager, and
    // every other case in this describe stages `fullWipe: false` — while in the app a
    // genuine full wipe silently drops to the one-click confirm and the heavy tier
    // becomes dead code. The INVERSE mutant (a literal `true`) is already caught by the
    // light-tier test above, which awaits the mass-delete dialog's title.
    // ★ Expected strings come from `t(...)`, not English literals: this surface has been
    // reworded under quoted literals before, which turns such an assertion silently
    // vacuous. `en-GB` mirrors `en-US` in `i18n.ts`, so "en-US" is right whichever of the
    // two the shell resolves to.
    override.value = {
      ...override.value,
      destructiveRefusal: { ...REFUSAL, curCollections: 0, curRecords: 0, fullWipe: true },
    };
    await mountApp();
    fireEvent.click(
      // ★ The WIPE tier's own trigger label. It used to be
      // `storageDestructiveSaveAnyway` ("Save this deletion"), shared with the mass
      // deletion, while this banner's count line and dialog title both said WIPE;
      // the wipe tier now renders `storageDestructiveWipeBannerSaveAnyway`. Only the
      // EXPECTED STRING moved — the query is still `getByRole` scoped to the
      // destructive banner, so a component that dropped the wipe trigger entirely
      // still fails here.
      within(destructiveBanner() as HTMLElement).getByRole("button", { name: t("en-US", "storageDestructiveWipeBannerSaveAnyway") }),
    );

    // The heavy tier, found by the title only it carries. Nothing here mocks
    // `./confirm-dialog` or `./type-to-confirm-dialog`, so both tiers are real.
    const dialog = await screen.findByRole("dialog", { name: t("en-US", "storageDestructiveWipeConfirmTitle") });
    // ★ It is the FRICTION that identifies the tier, not merely "a dialog opened": a
    // phrase to type, and a commit inert until it matches.
    const phrase = t("en-US", "storageDestructiveWipeConfirmValue");
    const commit = within(dialog).getByRole("button", { name: t("en-US", "storageDestructiveWipeSaveAnyway") });
    expect(commit).toBeDisabled();
    // The negative, and the half the mutant would show instead: the light tier's dialog.
    expect(screen.queryByText(t("en-US", "storageDestructiveConfirmTitle"))).toBeNull();
    expect(allowAnyway).not.toHaveBeenCalled();

    // ...and the heavy tier's commit reaches the SAME handler the light one does — the
    // second half of the hop, since a wipe confirmed but never applied is still a
    // lockout with no exit.
    fireEvent.change(
      within(dialog).getByRole("textbox", { name: t("en-US", "typeToConfirmPrompt", phrase) }),
      { target: { value: phrase } },
    );
    fireEvent.click(commit);
    await waitFor(() => expect(allowAnyway).toHaveBeenCalledTimes(1));
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

  // ── the dismissal must not outlive the episode it dismissed ────────────────
  // ★★★ The peer of the truncation reconcile's three tests above, for the OTHER
  // cause. `destructiveBannerDismissed` was never reset when a refusal
  // RESOLVED, so: refuse → dismiss → the refusal clears → a later, different
  // refusal raised the banner ALREADY HIDDEN. Saving is paused and the only
  // things left saying so are the transient toast and the footer indicator —
  // neither of which names the magnitude.
  it("a DIFFERENT refusal after the first RESOLVES re-shows a dismissed banner", async () => {
    const { rerender } = await mountApp();
    fireEvent.click(within(destructiveBanner() as HTMLElement).getByRole("button", { name: /dismiss/i }));
    await waitFor(() => expect(destructiveBanner()).toBeNull());

    // The refusal RESOLVES (the user saved anyway, or a load re-baselined).
    // ★ The paused control going too is the control on this step: it proves the
    // resolution really landed rather than the banner merely staying dismissed,
    // which is the same observable and the wrong reason.
    override.value = { ...override.value, destructiveRefusal: null };
    rerender(<TaskManager />);
    await waitFor(() => expect(pausedControl()).toBeNull());

    // A LATER, different refusal. Before the reconcile this arrived hidden.
    const later = { prevCollections: 3, prevRecords: 400, curCollections: 1, curRecords: 12, fullWipe: false };
    override.value = { ...override.value, destructiveRefusal: later };
    rerender(<TaskManager />);

    await waitFor(() => expect(destructiveBanner()).not.toBeNull());
    // ★ And it is the NEW magnitude, not the dismissed one re-shown: a reconcile
    // that un-hid a stale banner would satisfy the line above and mislead.
    // ★ Derived from `t`, never quoted English — this surface has been reworded
    // under quoted literals before, which turns such an assertion silently vacuous.
    expect((destructiveBanner() as HTMLElement).textContent)
      .toContain(t("en-US", "storageDestructiveCount", 388, 400));
  }, 45000);

  // ★★★ THE LOAD-BEARING HALF. The test above passes against a reconcile keyed
  // on almost anything that moves; this is the one that says what the key may
  // NOT be. While a refusal stands, EVERY later save re-refuses (one per edit,
  // indefinitely — `use-storage-backend.test.tsx`'s "keeps refusing every later
  // save while a refusal stands" pins that), and `useDestructiveSaveGuard`'s
  // `sameRefusal` functional setter hands back the SAME object each time. So the
  // dismissal has to survive a re-refusal, or dismissing is impossible: the
  // banner reappears on the user's next keystroke, forever.
  it("a re-refusal at the SAME refusal identity leaves a dismissed banner hidden", async () => {
    const { rerender } = await mountApp();
    fireEvent.click(within(destructiveBanner() as HTMLElement).getByRole("button", { name: /dismiss/i }));
    await waitFor(() => expect(destructiveBanner()).toBeNull());

    // A fresh hook result — a new spread object, as the real hook returns every
    // render — carrying the SAME refusal identity, which is what `sameRefusal`
    // guarantees for a re-refusal at unchanged counts.
    override.value = { ...override.value };
    rerender(<TaskManager />);
    rerender(<TaskManager />);

    expect(destructiveBanner()).toBeNull();
    // ...and the door back is still there, so this is a hidden banner and not a
    // resolved refusal — the two states differ only by this control.
    expect(pausedControl()).not.toBeNull();
  }, 45000);

  // ★★★ WHAT THE OBJECT KEY BUYS OVER A BOOLEAN ONE, and the only test that can
  // see it. A key of `destructiveRefusal !== null` passes both tests above: the
  // resolution in the first flips it, and the re-refusal in the second does not.
  // It fails HERE, where the refusal never resolves and the deletion simply gets
  // WORSE — `evaluate` mints a new object because the counts moved, no null in
  // between. The user dismissed a claim about 847 records; 890 is a different
  // claim, and the banner is the only surface that names either.
  it("an ESCALATING refusal re-shows a dismissed banner while it still stands", async () => {
    const { rerender } = await mountApp();
    expect((destructiveBanner() as HTMLElement).textContent)
      .toContain(t("en-US", "storageDestructiveCount", 847, 900));
    fireEvent.click(within(destructiveBanner() as HTMLElement).getByRole("button", { name: /dismiss/i }));
    await waitFor(() => expect(destructiveBanner()).toBeNull());

    // The user deletes more while saving is paused. NO intervening null.
    override.value = { ...override.value, destructiveRefusal: { ...REFUSAL, curRecords: 10 } };
    rerender(<TaskManager />);

    await waitFor(() => expect(destructiveBanner()).not.toBeNull());
    expect((destructiveBanner() as HTMLElement).textContent)
      .toContain(t("en-US", "storageDestructiveCount", 890, 900));
  }, 45000);

  it("stops reporting storage as healthy while a refusal stands", async () => {
    // ★ `storageOk` must fold in the destructive refusal too, not only
    // `loadWasIncomplete`. The control is "shows neither the destructive banner
    // nor the paused indicator with no refusal standing", which stages THIS
    // describe's `beforeEach` minus the refusal and proves the harness DOES
    // reach `storageReady: true` — without it, "never true" would be satisfied
    // by a mount that never got that far.
    // ★★ Cited by NAME, not by position: this pointed at "the clean-load test
    // in the describe above" and was wrong, because that test does NOT run
    // under this describe's `beforeEach` and replaces `override.value`
    // wholesale, so it cannot speak for the staging used here. A relative
    // pointer is what made the comment wrong; a line number would rot the same
    // way on the next insertion.
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

  it("stacks BOTH banners when both causes are staged — the price of the sibling mounts", async () => {
    // ★★★ A CHARACTERIZATION OF THE MOUNT LAYER, NOT A CLAIM THAT THIS HAPPENS.
    // The two JSX mounts in `task-manager.tsx` are siblings with no guard
    // between them, deliberately: the exclusivity is enforced upstream in the
    // save effect, and an `else` here would ENCODE it where it is not enforced
    // and hide where it is. The price is that the mount layer degrades badly
    // rather than safely — and it degraded for real, because until the
    // suppress-after-load branch learned to clear a standing refusal this
    // combination WAS reachable (refuse on one project, switch to a project
    // whose load truncates).
    // ★ So this asserts what the app DOES in that state, not what it should. If
    // you guard the destructive mount against `loadWasIncomplete`, THIS is the
    // test to rewrite, and what makes that safe is
    // `use-storage-backend.test.tsx`'s "leaves exactly ONE lockout standing when
    // a truncating load arrives on a refusal" — the pin for the real invariant.
    override.value = { ...override.value, truncation: TRUNCATED, loadWasIncomplete: true };
    await mountApp();
    expect(banner()).not.toBeNull();
    expect(destructiveBanner()).not.toBeNull();

    // The concrete damage, and the reason upstream exclusivity is worth having:
    // two live controls, same role, same accessible name, different meanings —
    // the duplicate-name class the axe gate provably cannot see.
    const truncationDismiss = within(banner() as HTMLElement).getByRole("button", { name: /dismiss/i });
    const destructiveDismiss = within(destructiveBanner() as HTMLElement).getByRole("button", { name: /dismiss/i });
    expect(destructiveDismiss).not.toBe(truncationDismiss);
    // ★ Read the attribute, not the rendered text: `DismissButton` sets both, so
    // an assertion on `textContent` would still pass if only one carried a name.
    expect(truncationDismiss.getAttribute("aria-label")).toBeTruthy();
    expect(destructiveDismiss.getAttribute("aria-label")).toBe(truncationDismiss.getAttribute("aria-label"));
  }, 45000);
});
