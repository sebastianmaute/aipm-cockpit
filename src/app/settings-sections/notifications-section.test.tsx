import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, test, vi } from "vitest";
import { NotificationsSection } from "./notifications-section";
import { defaultSettings } from "../settings-types";
import { t } from "../i18n";

describe("NotificationsSection", () => {
  it("editing reminder lead days persists the value", () => {
    const onChange = vi.fn();
    render(<NotificationsSection lang="en-US" settings={defaultSettings} onChange={onChange} />);
    // The global lead days input has the aria-label from reminderLeadDays
    const leadDaysInput = screen.getByRole("spinbutton", { name: t("en-US", "reminderLeadDays") });
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

describe("useGlobalLeadDays toggle", () => {
  it("renders the global lead-time checkbox and reflects useGlobalLeadDays:true by default", () => {
    render(
      <NotificationsSection lang="en-US" settings={defaultSettings} onChange={vi.fn()} />,
    );
    const cb = screen.getByRole("checkbox", {
      name: t("en-US", "notifUseGlobalLeadDays"),
    }) as HTMLInputElement;
    expect(cb.checked).toBe(true);
  });

  it("per-reminder day inputs are disabled when useGlobalLeadDays is true", () => {
    render(
      <NotificationsSection lang="en-US" settings={defaultSettings} onChange={vi.fn()} />,
    );
    // Only birthday has a lead-days input now (raidReview and stakeholderComms
    // use interval/quadrant-policy; the dead banner/toast/popup rows were removed)
    const perReminderLabel = t("en-US", "notifLeadDaysPerReminder");
    const inputs = screen
      .getAllByRole("spinbutton")
      .filter((el) => el.getAttribute("aria-label") === perReminderLabel);
    expect(inputs).toHaveLength(1);
    inputs.forEach((el) => expect(el).toBeDisabled());
  });

  it("per-reminder day inputs are enabled when useGlobalLeadDays is false", () => {
    const settings = {
      ...defaultSettings,
      notifications: { ...defaultSettings.notifications, useGlobalLeadDays: false },
    };
    render(<NotificationsSection lang="en-US" settings={settings} onChange={vi.fn()} />);
    const perReminderLabel = t("en-US", "notifLeadDaysPerReminder");
    const inputs = screen
      .getAllByRole("spinbutton")
      .filter((el) => el.getAttribute("aria-label") === perReminderLabel);
    expect(inputs).toHaveLength(1);
    inputs.forEach((el) => expect(el).not.toBeDisabled());
  });

  it("toggling the global checkbox calls onChange with the new useGlobalLeadDays value", () => {
    const onChange = vi.fn();
    render(<NotificationsSection lang="en-US" settings={defaultSettings} onChange={onChange} />);
    fireEvent.click(
      screen.getByRole("checkbox", { name: t("en-US", "notifUseGlobalLeadDays") }),
    );
    const next = onChange.mock.calls.at(-1)![0];
    expect(next.notifications.useGlobalLeadDays).toBe(false);
  });
});

describe("stakeholder comms per-quadrant lead days", () => {
  const settingsWithCommsOn = {
    ...defaultSettings,
    notifications: { ...defaultSettings.notifications, stakeholderComms: { enabled: true } },
  };

  it("renders four quadrant lead-day inputs when stakeholderComms is enabled", () => {
    render(<NotificationsSection lang="en-US" settings={settingsWithCommsOn} onChange={vi.fn()} />);
    expect(screen.getByRole("spinbutton", { name: t("en-US", "quadrantManageClosely") })).toBeInTheDocument();
    expect(screen.getByRole("spinbutton", { name: t("en-US", "quadrantKeepSatisfied") })).toBeInTheDocument();
    expect(screen.getByRole("spinbutton", { name: t("en-US", "quadrantKeepInformed") })).toBeInTheDocument();
    expect(screen.getByRole("spinbutton", { name: t("en-US", "quadrantMonitor") })).toBeInTheDocument();
  });

  it("quadrant inputs are NOT disabled when useGlobalLeadDays is true", () => {
    const settings = { ...settingsWithCommsOn, notifications: { ...settingsWithCommsOn.notifications, useGlobalLeadDays: true } };
    render(<NotificationsSection lang="en-US" settings={settings} onChange={vi.fn()} />);
    expect(screen.getByRole("spinbutton", { name: t("en-US", "quadrantManageClosely") })).not.toBeDisabled();
    expect(screen.getByRole("spinbutton", { name: t("en-US", "quadrantMonitor") })).not.toBeDisabled();
  });

  it("editing manage-closely calls onChange with updated stakeholderCommsLeadDays", () => {
    const onChange = vi.fn();
    render(<NotificationsSection lang="en-US" settings={settingsWithCommsOn} onChange={onChange} />);
    const input = screen.getByRole("spinbutton", { name: t("en-US", "quadrantManageClosely") });
    fireEvent.change(input, { target: { value: "21" } });
    const next = onChange.mock.calls.at(-1)![0] as typeof settingsWithCommsOn;
    expect(next.notifications.stakeholderCommsLeadDays["manage-closely"]).toBe(21);
    // other quadrants untouched
    expect(next.notifications.stakeholderCommsLeadDays["keep-satisfied"]).toBe(
      settingsWithCommsOn.notifications.stakeholderCommsLeadDays["keep-satisfied"],
    );
  });

  it("quadrant inputs are hidden when stakeholderComms is disabled", () => {
    const settings = {
      ...defaultSettings,
      notifications: { ...defaultSettings.notifications, stakeholderComms: { enabled: false } },
    };
    render(<NotificationsSection lang="en-US" settings={settings} onChange={vi.fn()} />);
    expect(screen.queryByRole("spinbutton", { name: t("en-US", "quadrantManageClosely") })).not.toBeInTheDocument();
  });
});

describe("jiraTokenError toggle", () => {
  it("renders the jira token error checkbox and reflects jiraTokenError.enabled", () => {
    render(
      <NotificationsSection lang="en-US" settings={defaultSettings} onChange={vi.fn()} />,
    );
    const cb = screen.getByRole("checkbox", {
      name: t("en-US", "notifJiraTokenError"),
    }) as HTMLInputElement;
    // defaultSettings has jiraTokenError.enabled = true
    expect(cb.checked).toBe(true);
  });

  it("toggling jiraTokenError calls onChange with new enabled value", () => {
    const onChange = vi.fn();
    render(<NotificationsSection lang="en-US" settings={defaultSettings} onChange={onChange} />);
    fireEvent.click(
      screen.getByRole("checkbox", { name: t("en-US", "notifJiraTokenError") }),
    );
    const next = onChange.mock.calls.at(-1)![0];
    expect(next.notifications.jiraTokenError.enabled).toBe(false);
  });
});

function installNotification(result: NotificationPermission) {
  const ctor = vi.fn();
  (ctor as unknown as { permission: NotificationPermission }).permission = "default";
  (ctor as unknown as { requestPermission: () => Promise<NotificationPermission> }).requestPermission =
    vi.fn(async () => result);
  (globalThis as unknown as { Notification: unknown }).Notification = ctor;
  return ctor;
}

describe("NotificationsSection desktop toggle", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete (globalThis as unknown as { Notification?: unknown }).Notification;
  });

  it("requests permission on enable and turns on when granted", async () => {
    installNotification("granted");
    const onChange = vi.fn();
    render(<NotificationsSection lang="en-US" settings={defaultSettings} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText(/Desktop notifications for urgent actions/i));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const next = onChange.mock.calls.at(-1)![0];
    expect(next.notifications.desktopUrgent.enabled).toBe(true);
  });

  it("stays off when permission is denied", async () => {
    installNotification("denied");
    const onChange = vi.fn();
    render(<NotificationsSection lang="en-US" settings={defaultSettings} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText(/Desktop notifications for urgent actions/i));
    await new Promise((r) => setTimeout(r, 0));
    const calls = onChange.mock.calls.map((c) => c[0].notifications.desktopUrgent.enabled);
    expect(calls.every((v: boolean) => v === false)).toBe(true);
  });

  it("disabling does not request permission", () => {
    const ctor = installNotification("granted");
    const onChange = vi.fn();
    const settings = {
      ...defaultSettings,
      notifications: { ...defaultSettings.notifications, desktopUrgent: { enabled: true } },
    };
    render(<NotificationsSection lang="en-US" settings={settings} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText(/Desktop notifications for urgent actions/i));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        notifications: expect.objectContaining({ desktopUrgent: { enabled: false } }),
      }),
    );
    expect((ctor as unknown as { requestPermission: ReturnType<typeof vi.fn> }).requestPermission)
      .not.toHaveBeenCalled();
  });
});
