import { describe, expect, it, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { IntegrationsSection } from "./integrations-section";
import { defaultSettings, defaultIntegrations, defaultM365Integrations } from "../settings-types";

function m365EnabledSettings() {
  return {
    ...defaultSettings,
    integrations: {
      ...defaultIntegrations,
      m365: { ...defaultM365Integrations, enabled: true },
    },
  };
}

describe("IntegrationsSection Outlook calendar push toggle", () => {
  it("renders the push checkbox when M365 is enabled", () => {
    const { getByLabelText } = render(
      <IntegrationsSection lang="en-US" settings={m365EnabledSettings()} onChange={() => {}} />,
    );
    expect(getByLabelText(/Push milestones to my Outlook calendar/i)).toBeTruthy();
  });

  it("toggling it calls onChange with outlookCalendarPush: true", () => {
    const onChange = vi.fn();
    const { getByLabelText } = render(
      <IntegrationsSection lang="en-US" settings={m365EnabledSettings()} onChange={onChange} />,
    );
    fireEvent.click(getByLabelText(/Push milestones to my Outlook calendar/i));
    expect(onChange).toHaveBeenCalled();
    const next = onChange.mock.calls.at(-1)![0];
    expect(next.integrations.m365.outlookCalendarPush).toBe(true);
  });
});
