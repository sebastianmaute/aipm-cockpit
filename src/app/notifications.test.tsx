import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BirthdayBanner, JiraTokenBanner, SavingPausedBanner } from "./notifications";

// SavingPausedBanner routes "Save anyway" through the branded ConfirmDialog.
// No ConfirmProvider is mounted in this harness, and the real context DEFAULT
// resolves false — which would make every "it fired" assertion below pass for
// the wrong reason (nothing fires). Mock the hook with a per-test controllable
// answer instead (mirrors budget-bucket-modal.test.tsx).
const confirmState = vi.hoisted(() => ({
  result: true,
  lastOpts: null as Record<string, unknown> | null,
  calls: 0,
}));
vi.mock("./confirm-dialog", () => ({
  useConfirm: () => (opts: Record<string, unknown>) => {
    confirmState.calls += 1;
    confirmState.lastOpts = opts;
    return Promise.resolve(confirmState.result);
  },
}));
import { SNOOZE_1H, SNOOZE_1D } from "./reminder-snooze";
import type { UpcomingBirthday } from "./birthdays";
import type { Resource } from "./types";
import type { JiraTokenAlert } from "./jira-token-status";
import { t } from "./i18n";

function makeResource(id: number, firstName: string, lastName: string): Resource {
  return {
    id,
    firstName,
    lastName,
    roleId: null,
    utilizationMode: "percent",
    utilization: {},
  };
}

function makeItem(id: number, firstName: string, lastName: string, daysUntil: number): UpcomingBirthday {
  return { resource: makeResource(id, firstName, lastName), daysUntil };
}

describe("BirthdayBanner", () => {
  it("renders nothing when items is empty", () => {
    const { container } = render(
      <BirthdayBanner items={[]} lang="en-US" onDismiss={() => {}} onSnooze={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders banner title with count and summary for a single item (today)", () => {
    const items = [makeItem(1, "Alice", "Smith", 0)];
    render(<BirthdayBanner items={items} lang="en-US" onDismiss={() => {}} onSnooze={vi.fn()} />);

    expect(screen.getByText(/1 upcoming birthday/i)).toBeInTheDocument();
    expect(screen.getByText(/Alice Smith/i)).toBeInTheDocument();
    expect(screen.getByText(/today/i)).toBeInTheDocument();
  });

  it("renders 'in Nd' for daysUntil > 0", () => {
    const items = [makeItem(1, "Bob", "Jones", 5)];
    render(<BirthdayBanner items={items} lang="en-US" onDismiss={() => {}} onSnooze={vi.fn()} />);

    expect(screen.getByText(/Bob Jones/i)).toBeInTheDocument();
    expect(screen.getByText(/in 5d/i)).toBeInTheDocument();
  });

  it("calls onDismiss when the dismiss button is clicked", () => {
    const onDismiss = vi.fn();
    const items = [makeItem(1, "Carol", "White", 3)];
    render(<BirthdayBanner items={items} lang="en-US" onDismiss={onDismiss} onSnooze={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /dismiss/i }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("renders multiple items as a comma-separated summary", () => {
    const items = [
      makeItem(1, "Dave", "Brown", 0),
      makeItem(2, "Eve", "Green", 2),
    ];
    render(<BirthdayBanner items={items} lang="en-US" onDismiss={() => {}} onSnooze={vi.fn()} />);

    expect(screen.getByText(/2 upcoming birthday/i)).toBeInTheDocument();
    expect(screen.getByText(/Dave Brown/i)).toBeInTheDocument();
    expect(screen.getByText(/Eve Green/i)).toBeInTheDocument();
  });

  it("uses German translations when lang is 'de'", () => {
    const items = [makeItem(1, "Franz", "Müller", 0)];
    render(<BirthdayBanner items={items} lang="de" onDismiss={() => {}} onSnooze={vi.fn()} />);

    // Falls back to en-US for 'de' until the async dict loads — 'today' key
    // will be "today" (en-US fallback). This is the expected behaviour per
    // the i18n design: de dict is lazy-loaded and not available synchronously.
    expect(screen.getByText(/Franz Müller/i)).toBeInTheDocument();
  });

  it("BirthdayBanner fires onSnooze with the chosen duration", () => {
    const onSnooze = vi.fn();
    const items = [makeItem(1, "Alice", "Smith", 2)];
    render(<BirthdayBanner items={items} lang="en-US" onDismiss={vi.fn()} onSnooze={onSnooze} />);
    fireEvent.click(screen.getByRole("button", { name: /in 1 hour/i }));
    expect(onSnooze).toHaveBeenCalledWith(SNOOZE_1H);
    fireEvent.click(screen.getByRole("button", { name: /in 1 day/i }));
    expect(onSnooze).toHaveBeenCalledWith(SNOOZE_1D);
  });
});

describe("JiraTokenBanner", () => {
  it("renders the invalid message", () => {
    const alert: JiraTokenAlert = { state: "invalid", daysLeft: 0, date: "" };
    render(
      <JiraTokenBanner
        alert={alert}
        lang="en-US"
        onSnooze={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.getByText(/rejected your API token/i)).toBeInTheDocument();
  });

  it("renders the expired message", () => {
    const alert: JiraTokenAlert = { state: "expired", daysLeft: -3, date: "2026-05-20" };
    render(
      <JiraTokenBanner
        alert={alert}
        lang="en-US"
        onSnooze={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.getByText(/expired on/i)).toBeInTheDocument();
  });

  it("renders the expiring message with day count", () => {
    const alert: JiraTokenAlert = { state: "expiring", daysLeft: 4, date: "2026-05-30" };
    render(
      <JiraTokenBanner
        alert={alert}
        lang="en-US"
        onSnooze={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.getByText(/expires in 4 day/i)).toBeInTheDocument();
  });
});

describe("SavingPausedBanner", () => {
  const FIVE_ENTRIES = { entries: 5, blocks: 0 };

  beforeEach(() => {
    confirmState.result = true;
    confirmState.lastOpts = null;
    confirmState.calls = 0;
  });

  it("announces as an alert, not a passive landmark", () => {
    // ★★ role="alert", NOT the "region" its three siblings use. This banner
    // arrives asynchronously after a load the user did not watch and reports an
    // ONGOING blocking state — a labelled landmark announces nothing on arrival,
    // so a user who is never told saving stopped goes on editing into a paused
    // session. `banner.tsx` already defaults error → "alert" for exactly this
    // reason; AlertBanner's "region" default was overriding it.
    render(<SavingPausedBanner cause={{ kind: "truncation", truncation: FIVE_ENTRIES, decodeFailureCount: 0, malformedQuoteCount: 0 }} dismissed={false} hasFooterIndicator onReopen={vi.fn()} lang="en-US" onSaveAnyway={vi.fn()} onDismiss={vi.fn()} />);
    expect(screen.getByRole("alert", { name: "Document data could not be opened" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: /document/i })).toBeNull();
  });

  it("never claims the limit did the cutting, in the copy OR the accessible name", () => {
    // ★★★ Both counts are UPPER BOUNDS and neither means "the cap cut this
    // much off". ★★ NOT for the reason an earlier revision of this comment gave
    // — it said `blocks` also counts blocks dropped as INVALID, and since
    // 0.221.0 it deliberately does not (`document-versions.ts`: counting them
    // armed a sticky guard over a loss that refusing to save cannot recover).
    // The rule survives on the CURRENT reason: both counts are RAW ARRAY
    // ENTRIES past their cap, never entries proven valid, so some of what they
    // report would have been dropped by the validator anyway. They over-claim
    // the real loss, which is why the copy may only say the data could not be
    // OPENED. The aria string is the one a screen-reader user hears first, and it said
    // "Document limit warning" — the exact claim this rule forbids. An earlier
    // version of this test only checked for /cut off/i and sailed straight past
    // the word "limit" two lines above it.
    render(<SavingPausedBanner cause={{ kind: "truncation", truncation: { entries: 0, blocks: 7 }, decodeFailureCount: 0, malformedQuoteCount: 0 }} dismissed={false} hasFooterIndicator onReopen={vi.fn()} lang="en-US" onSaveAnyway={vi.fn()} onDismiss={vi.fn()} />);
    const alert = screen.getByRole("alert");
    expect(alert.textContent ?? "").not.toMatch(/cut off|over the limit/i);
    expect(alert.getAttribute("aria-label") ?? "").not.toMatch(/limit/i);
  });

  it("names the magnitude — the count is not left to a 7s toast", () => {
    render(<SavingPausedBanner cause={{ kind: "truncation", truncation: FIVE_ENTRIES, decodeFailureCount: 0, malformedQuoteCount: 0 }} dismissed={false} hasFooterIndicator onReopen={vi.fn()} lang="en-US" onSaveAnyway={vi.fn()} onDismiss={vi.fn()} />);
    expect(screen.getByText(/5 document entries could not be opened/i)).toBeInTheDocument();
  });

  it("a blocks-only truncation names BLOCKS, never '0 document entries'", () => {
    // ★ "stored documents", NOT "stored document versions": since 0.221.0 a LIVE
    // document over `MAX_BLOCKS_PER_DOC` feeds the same counter, so naming
    // versions would assert something the count no longer implies.
    render(<SavingPausedBanner cause={{ kind: "truncation", truncation: { entries: 0, blocks: 7 }, decodeFailureCount: 0, malformedQuoteCount: 0 }} dismissed={false} hasFooterIndicator onReopen={vi.fn()} lang="en-US" onSaveAnyway={vi.fn()} onDismiss={vi.fn()} />);
    expect(screen.getByText(/7 blocks in stored documents could not be opened/i)).toBeInTheDocument();
    expect(screen.queryByText(/versions/i)).toBeNull();
    expect(screen.queryByText(/document entries/i)).toBeNull();
  });

  it("names BOTH magnitudes when one load truncated AND failed to decode", async () => {
    // ★★★ THE TWO CAUSES CO-OCCUR, and the count line used to short-circuit on
    // the truncation branch under a comment asserting they did not.
    // `rowsToWorkspace` (`turso-schema.ts`) threads ONE `DocTruncationDiag`
    // through `sanitizeProjectDocuments` AND every `reportUnreadableSlice`, so a
    // `documents` blob over the cap plus a thrown `settings_overrides` is a
    // single load reporting both. The decode magnitude then reached NO
    // persistent surface: its toast is single-slot and 7s long, and this line
    // and the dialog it feeds are all that outlives it.
    render(<SavingPausedBanner cause={{ kind: "truncation", truncation: FIVE_ENTRIES, decodeFailureCount: 3, malformedQuoteCount: 0 }} dismissed={false} hasFooterIndicator onReopen={vi.fn()} lang="en-US" onSaveAnyway={vi.fn()} onDismiss={vi.fn()} />);
    const alert = screen.getByRole("alert");
    expect(alert.textContent ?? "").toMatch(/5 document entries could not be opened/i);
    expect(alert.textContent ?? "").toMatch(/3 kinds of saved data could not be read/i);

    // ★ And into the dialog — the last thing the user sees before discarding it
    // all. A banner that names both while the dialog names one still decides the
    // question on half the loss.
    fireEvent.click(screen.getByRole("button", { name: "Save anyway" }));
    await waitFor(() => expect(confirmState.lastOpts).not.toBeNull());
    const message = String(confirmState.lastOpts?.message ?? "");
    expect(message).toMatch(/5 document entries/i);
    expect(message).toMatch(/3 kinds of saved data/i);
  });

  it("still names exactly ONE cause when only one is present", () => {
    // ★ The control for the join above. Without it, a `countText` that
    // unconditionally concatenated both strings would pass that test while
    // telling every truncation-only user that some unnamed number of kinds of
    // data was unreadable too — a joined line that reads as thorough and is
    // false. Both directions, because each is a separate way to get it wrong.
    const { unmount } = render(<SavingPausedBanner cause={{ kind: "truncation", truncation: FIVE_ENTRIES, decodeFailureCount: 0, malformedQuoteCount: 0 }} dismissed={false} hasFooterIndicator onReopen={vi.fn()} lang="en-US" onSaveAnyway={vi.fn()} onDismiss={vi.fn()} />);
    expect(screen.getByRole("alert").textContent ?? "").not.toMatch(/could not be read/i);
    unmount();

    render(<SavingPausedBanner cause={{ kind: "truncation", truncation: null, decodeFailureCount: 2, malformedQuoteCount: 0 }} dismissed={false} hasFooterIndicator onReopen={vi.fn()} lang="en-US" onSaveAnyway={vi.fn()} onDismiss={vi.fn()} />);
    const alert = screen.getByRole("alert");
    expect(alert.textContent ?? "").toMatch(/2 kinds of saved data could not be read/i);
    expect(alert.textContent ?? "").not.toMatch(/document entries|blocks in stored documents/i);
  });

  // ★★★ THE THIRD CAUSE MUST NAME A MAGNITUDE, and for a release it named none.
  // A malformed import commonly arrives with `truncation` null AND
  // `decodeFailureCount` 0 — a file backend has no meta blob to fail decoding —
  // so `countText` came out null, the banner rendered a bare headline, and
  // `askThenSave` fell through to `message: body`. That dialog is a PERMANENT
  // discard, which is the reason the counts are threaded here at all.
  it("names the magnitude when malformed quoting is the only cause", async () => {
    render(<SavingPausedBanner cause={{ kind: "truncation", truncation: null, decodeFailureCount: 0, malformedQuoteCount: 4 }} dismissed={false} hasFooterIndicator onReopen={vi.fn()} lang="en-US" onSaveAnyway={vi.fn()} onDismiss={vi.fn()} />);
    const alert = screen.getByRole("alert");
    expect(alert.textContent ?? "").toMatch(/breaks CSV quoting rules in 4 place/i);
    // The other two causes are absent, so neither may be named — the control
    // that stops an unconditional concatenation passing this.
    expect(alert.textContent ?? "").not.toMatch(/could not be read|document entries/i);

    // ★★ The dialog is the assertion that matters: the count reaching the BANNER
    // but not the confirm would still leave the irreversible click unlabelled.
    fireEvent.click(screen.getByRole("button", { name: "Save anyway" }));
    await waitFor(() => expect(confirmState.calls).toBe(1));
    expect(String(confirmState.lastOpts?.message ?? "")).toMatch(/breaks CSV quoting rules in 4 place/i);
  });

  it("joins all three causes when all three hold", () => {
    // ★ The join spans three now, not two. Each cause keeps its own vocabulary,
    // so a reader can tell which loss is which.
    render(<SavingPausedBanner cause={{ kind: "truncation", truncation: FIVE_ENTRIES, decodeFailureCount: 2, malformedQuoteCount: 3 }} dismissed={false} hasFooterIndicator onReopen={vi.fn()} lang="en-US" onSaveAnyway={vi.fn()} onDismiss={vi.fn()} />);
    const text = screen.getByRole("alert").textContent ?? "";
    expect(text).toMatch(/5 document entries/i);
    expect(text).toMatch(/2 kinds of saved data could not be read/i);
    expect(text).toMatch(/breaks CSV quoting rules in 3 place/i);
  });

  // ★★★ THE FIXTURE MUST ISOLATE THE MALFORMED TERM, and the obvious one does
  // not. `truncationOnly` is `truncation != null && decode === 0 && malformed
  // === 0`; an all-three fixture carries `decode > 0`, which forces the flag
  // false on the DECODE term alone — so the malformed term is dead weight there
  // and dropping it leaves such a test green. Measured, not reasoned: reverting
  // the third term with an all-three fixture in place SURVIVED the whole file
  // (30/30 passed). Truncation present, decode ZERO, malformed positive is the
  // only shape in which the third term is load-bearing.
  it("takes the wider headline when truncation and malformed quoting hold, with no decode failure", () => {
    render(<SavingPausedBanner cause={{ kind: "truncation", truncation: FIVE_ENTRIES, decodeFailureCount: 0, malformedQuoteCount: 3 }} dismissed={false} hasFooterIndicator onReopen={vi.fn()} lang="en-US" onSaveAnyway={vi.fn()} onDismiss={vi.fn()} />);
    // ★ "Document data" is true of truncation and false of a malformed import,
    // so the pair must take the wider wording — the same rule the
    // truncation+decode pair already follows.
    expect(screen.getByRole("alert", { name: "Saved data could not be opened" })).toBeInTheDocument();
    expect(screen.queryByRole("alert", { name: "Document data could not be opened" })).toBeNull();
  });

  // ★★★ THE HEADLINE MUST NOT NAME DOCUMENTS FOR A CAUSE THAT COVERS ELEVEN
  // SLICES. `reportUnreadableSlice` reaches project_status, field_visibility,
  // features, steering_committee, timelog_links, knowledge_items, insights,
  // activityLog, documents, documentVersions and settings_overrides. A corrupt
  // steering-committee blob in a project with NO documents announced itself as
  // "document data", the user concluded it did not apply, and clicked the
  // PERMANENT-discard button — on a screen that misnamed what was discarded.
  it("does not call a decode failure 'document data', in the copy OR the accessible name", () => {
    render(<SavingPausedBanner cause={{ kind: "truncation", truncation: null, decodeFailureCount: 2, malformedQuoteCount: 0 }} dismissed={false} hasFooterIndicator onReopen={vi.fn()} lang="en-US" onSaveAnyway={vi.fn()} onDismiss={vi.fn()} />);
    const alert = screen.getByRole("alert");
    // The HEADLINE specifically: the count line legitimately says "kinds of
    // saved data", so a whole-node scan for /document/i would be answered by a
    // line that is not under test. Scoped to the first paragraph.
    const headline = alert.querySelector("p")?.textContent ?? "";
    expect(headline).toMatch(/saved data could not be opened/i);
    expect(headline).not.toMatch(/document/i);
    expect(alert.getAttribute("aria-label") ?? "").not.toMatch(/document/i);
  });

  it("keeps the narrower 'document data' headline for a truncation-only load", () => {
    // The control for the rule above, and the no-regression pin: truncation
    // genuinely IS about documents (the cap cuts document entries and blocks),
    // so widening its wording would lose real specificity.
    render(<SavingPausedBanner cause={{ kind: "truncation", truncation: FIVE_ENTRIES, decodeFailureCount: 0, malformedQuoteCount: 0 }} dismissed={false} hasFooterIndicator onReopen={vi.fn()} lang="en-US" onSaveAnyway={vi.fn()} onDismiss={vi.fn()} />);
    const alert = screen.getByRole("alert");
    expect(alert.querySelector("p")?.textContent ?? "").toMatch(/document data could not be opened/i);
    expect(alert.getAttribute("aria-label")).toBe("Document data could not be opened");
  });

  it("takes the WIDER headline when both causes hold", () => {
    // ★ Both really can arrive together — `rowsToWorkspace` accumulates them
    // into one diagnostic — and the only headline accurate for the pair is the
    // one that names neither cause specifically. The count line below it still
    // names each magnitude in its own vocabulary, so nothing is lost.
    render(<SavingPausedBanner cause={{ kind: "truncation", truncation: FIVE_ENTRIES, decodeFailureCount: 3, malformedQuoteCount: 0 }} dismissed={false} hasFooterIndicator onReopen={vi.fn()} lang="en-US" onSaveAnyway={vi.fn()} onDismiss={vi.fn()} />);
    const alert = screen.getByRole("alert");
    expect(alert.querySelector("p")?.textContent ?? "").not.toMatch(/document data/i);
    // Positive control: the magnitudes are still both there, one line down.
    expect(alert.textContent ?? "").toMatch(/5 document entries could not be opened/i);
    expect(alert.textContent ?? "").toMatch(/3 kinds of saved data could not be read/i);
  });

  it("uses the DESTRUCTIVE button variant, not the recommended-action primary", () => {
    // ★ "Save anyway" permanently discards whatever could not be opened, and it
    // is the first tabbable control in <main>. Wearing StorageBanner's benign
    // primary blue made a data-destroying action read as the recommended one.
    render(<SavingPausedBanner cause={{ kind: "truncation", truncation: FIVE_ENTRIES, decodeFailureCount: 0, malformedQuoteCount: 0 }} dismissed={false} hasFooterIndicator onReopen={vi.fn()} lang="en-US" onSaveAnyway={vi.fn()} onDismiss={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Save anyway" }).className).toMatch(/ui-pink/);
  });

  it("gates Save anyway behind the confirm dialog and fires on accept", async () => {
    const onSaveAnyway = vi.fn();
    const onDismiss = vi.fn();
    render(<SavingPausedBanner cause={{ kind: "truncation", truncation: FIVE_ENTRIES, decodeFailureCount: 0, malformedQuoteCount: 0 }} dismissed={false} hasFooterIndicator onReopen={vi.fn()} lang="en-US" onSaveAnyway={onSaveAnyway} onDismiss={onDismiss} />);

    fireEvent.click(screen.getByRole("button", { name: "Save anyway" }));
    await waitFor(() => expect(onSaveAnyway).toHaveBeenCalledTimes(1));
    expect(confirmState.calls).toBe(1);
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("does NOT save when the confirm is declined — the gate, not just a dialog", async () => {
    // ★★★ The half that matters. Without this, a confirm that resolved and was
    // ignored would pass the accept test above and still destroy data on cancel.
    confirmState.result = false;
    const onSaveAnyway = vi.fn();
    render(<SavingPausedBanner cause={{ kind: "truncation", truncation: FIVE_ENTRIES, decodeFailureCount: 0, malformedQuoteCount: 0 }} dismissed={false} hasFooterIndicator onReopen={vi.fn()} lang="en-US" onSaveAnyway={onSaveAnyway} onDismiss={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Save anyway" }));
    await waitFor(() => expect(confirmState.calls).toBe(1));
    expect(onSaveAnyway).not.toHaveBeenCalled();
  });

  it("carries the count INTO the confirm dialog, so the decision is made on a number", async () => {
    render(<SavingPausedBanner cause={{ kind: "truncation", truncation: FIVE_ENTRIES, decodeFailureCount: 0, malformedQuoteCount: 0 }} dismissed={false} hasFooterIndicator onReopen={vi.fn()} lang="en-US" onSaveAnyway={vi.fn()} onDismiss={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Save anyway" }));
    await waitFor(() => expect(confirmState.lastOpts).not.toBeNull());
    expect(String(confirmState.lastOpts?.message ?? "")).toMatch(/5 document entries/i);
  });

  it("fires onDismiss from the dismiss action, and NOT onSaveAnyway", () => {
    // Dismissing hides the banner but must not resolve the truncation — the two
    // callbacks are distinct so the save guard stays armed after a dismiss.
    const onSaveAnyway = vi.fn();
    const onDismiss = vi.fn();
    render(<SavingPausedBanner cause={{ kind: "truncation", truncation: FIVE_ENTRIES, decodeFailureCount: 0, malformedQuoteCount: 0 }} dismissed={false} hasFooterIndicator onReopen={vi.fn()} lang="en-US" onSaveAnyway={onSaveAnyway} onDismiss={onDismiss} />);

    fireEvent.click(screen.getByRole("button", { name: /dismiss/i }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onSaveAnyway).not.toHaveBeenCalled();
    expect(confirmState.calls).toBe(0);
  });

  // ★★★ THE CLASSIC LAYOUT HAS NO SIDEBAR FOOTER. `SidebarFooter` has exactly one
  // mount in the app and it is inside `modernTree`, so a classic user who dismissed
  // this banner lost the only "Save anyway" surface for the session while saving
  // stayed paused and nothing on screen said so — the very lockout the banner
  // exists to prevent, still live in one of the two layouts. These two cases are
  // the kill line for that: without the `dismissed` branch the first renders
  // nothing and the second renders the full banner.
  it("leaves a re-open control when dismissed with no footer indicator (classic layout)", () => {
    const onReopen = vi.fn();
    render(<SavingPausedBanner cause={{ kind: "truncation", truncation: FIVE_ENTRIES, decodeFailureCount: 0, malformedQuoteCount: 0 }} dismissed hasFooterIndicator={false} onReopen={onReopen} lang="en-US" onSaveAnyway={vi.fn()} onDismiss={vi.fn()} />);

    // Not the full banner — dismissing must still quieten it.
    expect(screen.queryByRole("button", { name: "Save anyway" })).toBeNull();
    // ★ It carries the COUNT, not a third repetition of "Saving paused" (the
    // region is labelled that and the button says it too). Caught by looking at
    // it in a browser — jsdom cannot see that a line was wasted.
    expect(screen.getByText(/5 document entries could not be opened/i)).toBeInTheDocument();
    // But the door back is present, and clicking it re-opens rather than saving.
    fireEvent.click(screen.getByRole("button", { name: /show how to resolve/i }));
    expect(onReopen).toHaveBeenCalledTimes(1);
    expect(confirmState.calls).toBe(0);
  });

  it("names the DECODE magnitude on the dismissed chip, not a bare 'Saving paused'", () => {
    // ★★ The chip's `countText ?? t(lang, "storageSavingPaused")` was covered
    // for truncation only — every other render in this file passes
    // `decodeFailureCount={0}`, so on a decode-only failure the one line a
    // classic user gets was pinned nowhere. It matters most there: that layout
    // has no sidebar footer, so this chip is the entire persistent account of
    // what happened, and the decode cause has no counts object to fall back on.
    render(<SavingPausedBanner cause={{ kind: "truncation", truncation: null, decodeFailureCount: 2, malformedQuoteCount: 0 }} dismissed hasFooterIndicator={false} onReopen={vi.fn()} lang="en-US" onSaveAnyway={vi.fn()} onDismiss={vi.fn()} />);
    expect(screen.getByText(/2 kinds of saved data could not be read/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /show how to resolve/i })).toBeInTheDocument();
  });

  it("falls back to the status text on the chip only when NO magnitude is known", () => {
    // ★ The control for the case above: without it, a chip hardcoded to the
    // count string would pass that assertion, and a chip that ignored the count
    // entirely would pass this one. `truncation` null with a zero decode count
    // is the only shape that reaches the fallback.
    render(<SavingPausedBanner cause={{ kind: "truncation", truncation: null, decodeFailureCount: 0, malformedQuoteCount: 0 }} dismissed hasFooterIndicator={false} onReopen={vi.fn()} lang="en-US" onSaveAnyway={vi.fn()} onDismiss={vi.fn()} />);
    expect(screen.getByText("Saving paused")).toBeInTheDocument();
    expect(screen.queryByText(/could not be read|could not be opened/i)).toBeNull();
  });

  it("renders nothing when dismissed and the footer already carries the indicator (modern layout)", () => {
    const { container } = render(<SavingPausedBanner cause={{ kind: "truncation", truncation: FIVE_ENTRIES, decodeFailureCount: 0, malformedQuoteCount: 0 }} dismissed hasFooterIndicator onReopen={vi.fn()} lang="en-US" onSaveAnyway={vi.fn()} onDismiss={vi.fn()} />);
    // Control: the SAME props with hasFooterIndicator=false DO render something
    // (the case above), so an empty container here is the branch, not a broken
    // fixture.
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the truncation cause with its own headline and counts", () => {
    render(
      <SavingPausedBanner
        lang="en-US"
        cause={{ kind: "truncation", truncation: { entries: 3, blocks: 0 }, decodeFailureCount: 0, malformedQuoteCount: 0 }}
        dismissed={false}
        hasFooterIndicator
        onSaveAnyway={() => {}}
        onDismiss={() => {}}
        onReopen={() => {}}
      />,
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: t("en-US", "documentsTruncatedSaveAnyway") })).toBeInTheDocument();
  });
});
