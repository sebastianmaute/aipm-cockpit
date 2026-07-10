import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, fireEvent, screen, waitFor } from "@testing-library/react";
import { IntegrationsSection } from "./integrations-section";
import { ConfirmProvider } from "../confirm-dialog";
import {
  defaultSettings,
  defaultIntegrations,
  defaultM365Integrations,
  defaultTursoIntegrations,
} from "../settings-types";
import { readDeviceSecret, isPassphraseLocked } from "../secrets-store";

afterEach(async () => {
  // Editing the Turso auth token fires an un-awaited device-seal (encrypts then
  // writes ciphertext to localStorage). Flush those pending writes BEFORE
  // clearing, so a late seal from this test cannot leak into the next test and
  // race its own seal of the same key (the cross-test stale-token flake).
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  localStorage.clear();
});

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

describe("IntegrationsSection weekly digest control", () => {
  it("renders the digest enable control with an accessible name", () => {
    const { getByLabelText } = render(
      <IntegrationsSection lang="en-US" settings={defaultSettings} onChange={() => {}} />,
    );
    expect(getByLabelText(/Weekly status digest/i)).toBeTruthy();
  });

  it("enabling the digest calls onChange with digest.enabled: true", () => {
    const onChange = vi.fn();
    const { getByText } = render(
      <IntegrationsSection lang="en-US" settings={defaultSettings} onChange={onChange} />,
    );
    fireEvent.click(getByText(/Weekly status digest/i));
    expect(onChange).toHaveBeenCalled();
    const next = onChange.mock.calls.at(-1)![0];
    expect(next.digest.enabled).toBe(true);
    expect(next.digest.cadenceDays).toBe(7);
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

  it("passphrase toggle locks the Turso token once the confirm matches", async () => {
    render(<IntegrationsSection lang="en-US" settings={tursoSettings("tok-have")} onChange={() => {}} />);
    fireEvent.click(screen.getByLabelText(/require a passphrase/i));
    fireEvent.change(screen.getByLabelText(/^passphrase$/i), { target: { value: "pw" } });
    fireEvent.change(screen.getByLabelText(/confirm passphrase/i), { target: { value: "pw" } });
    fireEvent.click(screen.getByRole("button", { name: /save passphrase/i }));
    await waitFor(() => expect(isPassphraseLocked("tursoAuthToken")).toBe(true));
  });

  it("Save is disabled until the confirm passphrase matches", () => {
    render(<IntegrationsSection lang="en-US" settings={tursoSettings("tok-have")} onChange={() => {}} />);
    fireEvent.click(screen.getByLabelText(/require a passphrase/i));
    fireEvent.change(screen.getByLabelText(/^passphrase$/i), { target: { value: "pw" } });
    fireEvent.change(screen.getByLabelText(/confirm passphrase/i), { target: { value: "px" } });
    expect(screen.getByText(/passphrases do not match/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /save passphrase/i })).toBeDisabled();
  });

  it("removing the stored token forgets the secret and unsets the lock", async () => {
    // The branded confirm dialog (not window.confirm) now gates removal, so the
    // component is wrapped in a ConfirmProvider and we click its Confirm button.
    render(
      <ConfirmProvider lang="en-US">
        <IntegrationsSection lang="en-US" settings={tursoSettings("tok-have")} onChange={() => {}} />
      </ConfirmProvider>,
    );
    // Lock under a passphrase first.
    fireEvent.click(screen.getByLabelText(/require a passphrase/i));
    fireEvent.change(screen.getByLabelText(/^passphrase$/i), { target: { value: "pw" } });
    fireEvent.change(screen.getByLabelText(/confirm passphrase/i), { target: { value: "pw" } });
    fireEvent.click(screen.getByRole("button", { name: /save passphrase/i }));
    await waitFor(() => expect(isPassphraseLocked("tursoAuthToken")).toBe(true));
    // Remove it entirely — opens the branded confirm dialog; confirm it.
    fireEvent.click(screen.getByRole("button", { name: /remove stored secret/i }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(isPassphraseLocked("tursoAuthToken")).toBe(false));
  });
});
