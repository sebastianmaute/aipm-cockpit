import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, fireEvent, screen, waitFor } from "@testing-library/react";
import { IntegrationsSection } from "./integrations-section";
import {
  defaultSettings,
  defaultIntegrations,
  defaultM365Integrations,
  defaultTursoIntegrations,
} from "../settings-types";
import { readDeviceSecret, isPassphraseLocked } from "../secrets-store";

afterEach(() => localStorage.clear());

function m365EnabledSettings() {
  return {
    ...defaultSettings,
    integrations: {
      ...defaultIntegrations,
      m365: { ...defaultM365Integrations, enabled: true },
    },
  };
}

function tursoSettings(authToken: string) {
  return {
    ...defaultSettings,
    integrations: {
      ...defaultIntegrations,
      turso: { ...defaultTursoIntegrations, enabled: true, databaseUrl: "libsql://x.turso.io", authToken },
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

describe("IntegrationsSection Turso auth token sealing", () => {
  it("device-seals the Turso auth token when edited", async () => {
    const { container } = render(
      <IntegrationsSection lang="en-US" settings={tursoSettings("")} onChange={() => {}} />,
    );
    const input = container.querySelector('input[type="password"]') as HTMLInputElement;
    expect(input).toBeTruthy();
    fireEvent.change(input, { target: { value: "tok-typed" } });
    await waitFor(async () => expect(await readDeviceSecret("tursoAuthToken")).toBe("tok-typed"));
  });

  it("passphrase toggle locks the Turso token", async () => {
    render(<IntegrationsSection lang="en-US" settings={tursoSettings("tok-have")} onChange={() => {}} />);
    fireEvent.click(screen.getByLabelText(/require a passphrase/i));
    fireEvent.change(screen.getByLabelText(/^passphrase$/i), { target: { value: "pw" } });
    fireEvent.click(screen.getByRole("button", { name: /require a passphrase/i }));
    await waitFor(() => expect(isPassphraseLocked("tursoAuthToken")).toBe(true));
  });
});
