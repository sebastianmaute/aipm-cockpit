// src/app/calendar-pull-summary-modal.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CalendarPullSummaryModal } from "./calendar-pull-summary-modal";
import { t } from "./i18n";

// Modal is a pure shell — mock it so there is no portal/focus-trap complexity;
// the content under test is the three sections and the per-conflict buttons.
vi.mock("./modal", () => ({
  Modal: ({ children, open }: { children: React.ReactNode; open: boolean }) =>
    open ? <div data-testid="modal">{children}</div> : null,
}));

const APPLIED = [{ id: 1, name: "Kickoff", newDate: "2026-08-01" }];
const CONFLICTS = [
  {
    id: 2,
    eventId: "evt-2",
    name: "Design review",
    appDate: "2026-09-01",
    outlookDate: "2026-09-15",
  },
];
const DELETIONS = [{ id: 3, name: "Retired gate" }];

function setup(
  over: Partial<React.ComponentProps<typeof CalendarPullSummaryModal>> = {},
) {
  const onClose = vi.fn();
  const onKeepApp = vi.fn();
  const onTakeOutlook = vi.fn();
  render(
    <CalendarPullSummaryModal
      lang="en-US"
      open
      onClose={onClose}
      applied={APPLIED}
      conflicts={CONFLICTS}
      deletions={DELETIONS}
      onKeepApp={onKeepApp}
      onTakeOutlook={onTakeOutlook}
      {...over}
    />,
  );
  return { onClose, onKeepApp, onTakeOutlook };
}

describe("CalendarPullSummaryModal", () => {
  it("renders the summary title", () => {
    setup();
    expect(screen.getByText(t("en-US", "calendarPullSummaryTitle"))).toBeTruthy();
  });

  it("renders an applied row as 'name → newDate'", () => {
    setup();
    expect(screen.getByText("Kickoff → 2026-08-01")).toBeTruthy();
  });

  it("renders a conflict row with name and both dates and two buttons", () => {
    setup();
    expect(screen.getByText("Design review")).toBeTruthy();
    expect(screen.getByText(/2026-09-01/)).toBeTruthy();
    expect(screen.getByText(/2026-09-15/)).toBeTruthy();
    expect(
      screen.getByRole("button", {
        name: `${t("en-US", "calendarPullKeepApp")} – Design review`,
      }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", {
        name: `${t("en-US", "calendarPullTakeOutlook")} – Design review`,
      }),
    ).toBeTruthy();
  });

  it("Keep app date fires onKeepApp with {id,eventId,appDate}", () => {
    const { onKeepApp } = setup();
    fireEvent.click(
      screen.getByRole("button", {
        name: `${t("en-US", "calendarPullKeepApp")} – Design review`,
      }),
    );
    expect(onKeepApp).toHaveBeenCalledTimes(1);
    expect(onKeepApp).toHaveBeenCalledWith({
      id: 2,
      eventId: "evt-2",
      appDate: "2026-09-01",
    });
  });

  it("Take Outlook date fires onTakeOutlook with {id,eventId,outlookDate}", () => {
    const { onTakeOutlook } = setup();
    fireEvent.click(
      screen.getByRole("button", {
        name: `${t("en-US", "calendarPullTakeOutlook")} – Design review`,
      }),
    );
    expect(onTakeOutlook).toHaveBeenCalledTimes(1);
    expect(onTakeOutlook).toHaveBeenCalledWith({
      id: 2,
      eventId: "evt-2",
      outlookDate: "2026-09-15",
    });
  });

  it("renders a deletion row with name and the removed note", () => {
    setup();
    expect(
      screen.getByText(
        `Retired gate — ${t("en-US", "calendarPullEventRemoved")}`,
      ),
    ).toBeTruthy();
  });

  it("renders nothing when open is false", () => {
    setup({ open: false });
    expect(screen.queryByTestId("modal")).toBeNull();
    expect(
      screen.queryByText(t("en-US", "calendarPullSummaryTitle")),
    ).toBeNull();
  });
});
