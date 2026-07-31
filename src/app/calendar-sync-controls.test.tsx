import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { CalendarSyncControls } from "./calendar-sync-controls";
import { t } from "./i18n";

const base = {
  lang: "en-US" as const,
  entityLabelKey: "calendarSyncEntityRaid" as const,
  m365Configured: true,
  calendarEnabled: true,
  onToggleCalendar: () => {},
  onPushCalendar: () => {},
  onPullCalendar: () => {},
};

describe("CalendarSyncControls", () => {
  it("shows the short label but keeps the descriptive accessible name", () => {
    render(<CalendarSyncControls {...base} />);
    // Asserted with toBe, not toContain: the short label is a SUBSTRING of the
    // long one ("Push" of "Push to Outlook"), so a containment check passes
    // whether or not the label was ever shortened.
    const push = screen.getByRole("button", { name: t("en-US", "calendarPush") });
    expect(push.textContent).toBe(t("en-US", "calendarPushShort"));
    const pull = screen.getByRole("button", { name: t("en-US", "calendarPull") });
    expect(pull.textContent).toBe(t("en-US", "calendarPullShort"));
  });

  it("gives the enable checkbox an explanatory tooltip", () => {
    render(<CalendarSyncControls {...base} />);
    const box = screen.getByRole("checkbox");
    expect(box.getAttribute("title")).toBe(t("en-US", "calendarSyncEnableHint"));
  });

  it("switches the accessible name to the busy text while pushing, so the name still contains the visible label", () => {
    render(<CalendarSyncControls {...base} calendarPushBusy />);
    const push = screen.getByRole("button", { name: t("en-US", "calendarPushing") });
    expect(push.textContent).toContain(t("en-US", "calendarPushing"));
  });
});
