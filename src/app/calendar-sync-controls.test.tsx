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
  it("shows the short label but keeps the descriptive, entity-qualified accessible name", () => {
    render(<CalendarSyncControls {...base} />);
    // Asserted with toBe, not toContain: the short label is a SUBSTRING of the
    // long one ("Push" of "Push to Outlook – RAID items (review dates)"), so a
    // containment check passes whether or not the label was ever shortened.
    const push = screen.getByRole("button", {
      name: `${t("en-US", "calendarPush")} – ${t("en-US", "calendarSyncEntityRaid")}`,
    });
    expect(push.textContent).toBe(t("en-US", "calendarPushShort"));
    const pull = screen.getByRole("button", {
      name: `${t("en-US", "calendarPull")} – ${t("en-US", "calendarSyncEntityRaid")}`,
    });
    expect(pull.textContent).toBe(t("en-US", "calendarPullShort"));
  });

  // §42: the enable toggle was already entity-qualified; the Push/Pull buttons
  // were not, so two co-rendered instances would announce two identical "Push
  // to Outlook" buttons — a WCAG 2.4.6 collision axe cannot see (it reports
  // missing names, never duplicate ones). Two instances render together only in
  // the classic layout (Tasks below RAID/Changes/Resources); this pins the
  // names apart for that case and for any future co-render.
  it("qualifies the push and pull names with the entity, so two instances never collide", () => {
    render(
      <>
        <CalendarSyncControls {...base} entityLabelKey="calendarSyncEntityAbsence" />
        <CalendarSyncControls {...base} entityLabelKey="calendarSyncEntityTask" />
      </>,
    );
    const names = screen.getAllByRole("button").map((b) => b.getAttribute("aria-label"));
    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain(`${t("en-US", "calendarPush")} – ${t("en-US", "calendarSyncEntityTask")}`);
    expect(names).toContain(`${t("en-US", "calendarPull")} – ${t("en-US", "calendarSyncEntityTask")}`);
  });

  // ★ The enable control is a ToggleButton, not a checkbox: the visible label is
  //   PINNED to what pressed=true enables and `aria-pressed` carries the state.
  //   A label that flipped with the state would announce the wrong mode as on.
  it("gives the enable toggle an explanatory tooltip and a pressed state", () => {
    render(<CalendarSyncControls {...base} />);
    const toggle = screen.getByRole("button", {
      name: `${t("en-US", "calendarSyncEnable")} – ${t("en-US", "calendarSyncEntityRaid")}`,
    });
    // ★ The tooltip carries the STATE; the label may not (it is pinned to what
    //   turning it on does). `title` is the accessible description, not the name.
    expect(toggle.getAttribute("title")).toContain(t("en-US", "calendarSyncEnableHint"));
    expect(toggle.getAttribute("title")).toContain(t("en-US", "toggleStateOn"));
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    // Pinned, not flipped: the label names what turning it ON does, in both states.
    expect(toggle.textContent).toBe(t("en-US", "calendarSyncEnable"));
  });

  it("keeps the same pinned label when off, with aria-pressed false", () => {
    render(<CalendarSyncControls {...base} calendarEnabled={false} />);
    const toggle = screen.getByRole("button", {
      name: `${t("en-US", "calendarSyncEnable")} – ${t("en-US", "calendarSyncEntityRaid")}`,
    });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(toggle.textContent).toBe(t("en-US", "calendarSyncEnable"));
    // The tooltip is the one thing that DOES flip, and it must actually flip —
    // asserting only the "on" case would pass against a hardcoded string.
    expect(toggle.getAttribute("title")).toContain(t("en-US", "toggleStateOff"));
    expect(toggle.getAttribute("title")).not.toContain(t("en-US", "toggleStateOn"));
  });

  it("switches the accessible name to the busy text while pushing, so the name still contains the visible label — and stays entity-qualified", () => {
    render(<CalendarSyncControls {...base} calendarPushBusy />);
    const push = screen.getByRole("button", {
      name: `${t("en-US", "calendarPushing")} – ${t("en-US", "calendarSyncEntityRaid")}`,
    });
    expect(push.textContent).toContain(t("en-US", "calendarPushing"));
  });
});
