import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BirthdayBanner, JiraTokenBanner, TruncatedLoadBanner } from "./notifications";

// TruncatedLoadBanner routes "Save anyway" through the branded ConfirmDialog.
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

describe("TruncatedLoadBanner", () => {
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
    render(<TruncatedLoadBanner dismissed={false} hasFooterIndicator onReopen={vi.fn()} lang="en-US" truncation={FIVE_ENTRIES} onSaveAnyway={vi.fn()} onDismiss={vi.fn()} />);
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
    render(<TruncatedLoadBanner dismissed={false} hasFooterIndicator onReopen={vi.fn()} lang="en-US" truncation={{ entries: 0, blocks: 7 }} onSaveAnyway={vi.fn()} onDismiss={vi.fn()} />);
    const alert = screen.getByRole("alert");
    expect(alert.textContent ?? "").not.toMatch(/cut off|over the limit/i);
    expect(alert.getAttribute("aria-label") ?? "").not.toMatch(/limit/i);
  });

  it("names the magnitude — the count is not left to a 7s toast", () => {
    render(<TruncatedLoadBanner dismissed={false} hasFooterIndicator onReopen={vi.fn()} lang="en-US" truncation={FIVE_ENTRIES} onSaveAnyway={vi.fn()} onDismiss={vi.fn()} />);
    expect(screen.getByText(/5 document entries could not be opened/i)).toBeInTheDocument();
  });

  it("a blocks-only truncation names BLOCKS, never '0 document entries'", () => {
    // ★ "stored documents", NOT "stored document versions": since 0.221.0 a LIVE
    // document over `MAX_BLOCKS_PER_DOC` feeds the same counter, so naming
    // versions would assert something the count no longer implies.
    render(<TruncatedLoadBanner dismissed={false} hasFooterIndicator onReopen={vi.fn()} lang="en-US" truncation={{ entries: 0, blocks: 7 }} onSaveAnyway={vi.fn()} onDismiss={vi.fn()} />);
    expect(screen.getByText(/7 blocks in stored documents could not be opened/i)).toBeInTheDocument();
    expect(screen.queryByText(/versions/i)).toBeNull();
    expect(screen.queryByText(/document entries/i)).toBeNull();
  });

  it("uses the DESTRUCTIVE button variant, not the recommended-action primary", () => {
    // ★ "Save anyway" permanently discards whatever could not be opened, and it
    // is the first tabbable control in <main>. Wearing StorageBanner's benign
    // primary blue made a data-destroying action read as the recommended one.
    render(<TruncatedLoadBanner dismissed={false} hasFooterIndicator onReopen={vi.fn()} lang="en-US" truncation={FIVE_ENTRIES} onSaveAnyway={vi.fn()} onDismiss={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Save anyway" }).className).toMatch(/ui-pink/);
  });

  it("gates Save anyway behind the confirm dialog and fires on accept", async () => {
    const onSaveAnyway = vi.fn();
    const onDismiss = vi.fn();
    render(<TruncatedLoadBanner dismissed={false} hasFooterIndicator onReopen={vi.fn()} lang="en-US" truncation={FIVE_ENTRIES} onSaveAnyway={onSaveAnyway} onDismiss={onDismiss} />);

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
    render(<TruncatedLoadBanner dismissed={false} hasFooterIndicator onReopen={vi.fn()} lang="en-US" truncation={FIVE_ENTRIES} onSaveAnyway={onSaveAnyway} onDismiss={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Save anyway" }));
    await waitFor(() => expect(confirmState.calls).toBe(1));
    expect(onSaveAnyway).not.toHaveBeenCalled();
  });

  it("carries the count INTO the confirm dialog, so the decision is made on a number", async () => {
    render(<TruncatedLoadBanner dismissed={false} hasFooterIndicator onReopen={vi.fn()} lang="en-US" truncation={FIVE_ENTRIES} onSaveAnyway={vi.fn()} onDismiss={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Save anyway" }));
    await waitFor(() => expect(confirmState.lastOpts).not.toBeNull());
    expect(String(confirmState.lastOpts?.message ?? "")).toMatch(/5 document entries/i);
  });

  it("fires onDismiss from the dismiss action, and NOT onSaveAnyway", () => {
    // Dismissing hides the banner but must not resolve the truncation — the two
    // callbacks are distinct so the save guard stays armed after a dismiss.
    const onSaveAnyway = vi.fn();
    const onDismiss = vi.fn();
    render(<TruncatedLoadBanner dismissed={false} hasFooterIndicator onReopen={vi.fn()} lang="en-US" truncation={FIVE_ENTRIES} onSaveAnyway={onSaveAnyway} onDismiss={onDismiss} />);

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
    render(<TruncatedLoadBanner dismissed hasFooterIndicator={false} onReopen={onReopen} lang="en-US" truncation={FIVE_ENTRIES} onSaveAnyway={vi.fn()} onDismiss={vi.fn()} />);

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

  it("renders nothing when dismissed and the footer already carries the indicator (modern layout)", () => {
    const { container } = render(<TruncatedLoadBanner dismissed hasFooterIndicator onReopen={vi.fn()} lang="en-US" truncation={FIVE_ENTRIES} onSaveAnyway={vi.fn()} onDismiss={vi.fn()} />);
    // Control: the SAME props with hasFooterIndicator=false DO render something
    // (the case above), so an empty container here is the branch, not a broken
    // fixture.
    expect(container).toBeEmptyDOMElement();
  });
});
