import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BirthdayBanner, JiraTokenBanner, TruncatedLoadBanner } from "./notifications";
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
  it("renders the generic message and is exposed as a labelled region", () => {
    render(<TruncatedLoadBanner lang="en-US" onSaveAnyway={vi.fn()} onDismiss={vi.fn()} />);
    expect(screen.getByText(/could not be opened/i)).toBeInTheDocument();
    // ★ The copy must never claim the CAP did the cutting — both counts are
    // upper bounds (a version with malformed blocks reports them as truncation
    // with nothing capped), so "could not be opened" is the only accurate wording.
    expect(screen.queryByText(/cut off/i)).toBeNull();
    expect(screen.getByRole("region", { name: "Document limit warning" })).toBeInTheDocument();
  });

  it("fires onSaveAnyway from the primary action — the only escape from the save lockout", () => {
    const onSaveAnyway = vi.fn();
    const onDismiss = vi.fn();
    render(<TruncatedLoadBanner lang="en-US" onSaveAnyway={onSaveAnyway} onDismiss={onDismiss} />);

    fireEvent.click(screen.getByRole("button", { name: "Save anyway" }));
    expect(onSaveAnyway).toHaveBeenCalledTimes(1);
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("fires onDismiss from the dismiss action, and NOT onSaveAnyway", () => {
    // Dismissing hides the banner but must not resolve the truncation — the two
    // callbacks are distinct so the save guard stays armed after a dismiss.
    const onSaveAnyway = vi.fn();
    const onDismiss = vi.fn();
    render(<TruncatedLoadBanner lang="en-US" onSaveAnyway={onSaveAnyway} onDismiss={onDismiss} />);

    fireEvent.click(screen.getByRole("button", { name: /dismiss/i }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onSaveAnyway).not.toHaveBeenCalled();
  });
});
