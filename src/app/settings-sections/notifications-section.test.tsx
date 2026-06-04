import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, test, vi } from "vitest";
import { NotificationsSection } from "./notifications-section";
import { defaultSettings } from "../settings-types";
import { t } from "../i18n";

describe("NotificationsSection", () => {
  it("toggling the toast channel persists notifications.toast.enabled", () => {
    const onChange = vi.fn();
    render(<NotificationsSection lang="en-US" settings={defaultSettings} onChange={onChange} />);
    fireEvent.click(screen.getByRole("checkbox", { name: t("en-US", "notifToast") }));
    const last = onChange.mock.calls.at(-1)?.[0];
    expect(last.notifications.toast.enabled).toBe(false);
  });

  it("editing reminder lead days persists the value", () => {
    const onChange = vi.fn();
    render(<NotificationsSection lang="en-US" settings={defaultSettings} onChange={onChange} />);
    // Two number inputs now exist (lead days + RAID interval); lead days is first in the DOM.
    const leadDaysInput = screen.getAllByRole("spinbutton")[0];
    fireEvent.change(leadDaysInput, { target: { value: "14" } });
    const last = onChange.mock.calls.at(-1)?.[0];
    expect(last.notifications.reminderLeadDays).toBe(14);
  });
});

test("toggling RAID review reminders calls onChange with it disabled", async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  render(<NotificationsSection lang="en-US" settings={defaultSettings} onChange={onChange} />);
  await user.click(screen.getByLabelText("RAID review reminders"));
  expect(onChange).toHaveBeenCalled();
  const next = onChange.mock.calls.at(-1)![0];
  expect(next.notifications.raidReview.enabled).toBe(false);
});

test("editing the review interval calls onChange with the new value", () => {
  const onChange = vi.fn();
  render(<NotificationsSection lang="en-US" settings={defaultSettings} onChange={onChange} />);
  const input = screen.getByLabelText("RAID review interval (days)") as HTMLInputElement;
  fireEvent.change(input, { target: { value: "30" } });
  const next = onChange.mock.calls.at(-1)![0];
  expect(next.notifications.raidReviewIntervalDays).toBe(30);
});
