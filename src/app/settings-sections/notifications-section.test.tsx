import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
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
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "14" } });
    const last = onChange.mock.calls.at(-1)?.[0];
    expect(last.notifications.reminderLeadDays).toBe(14);
  });
});
