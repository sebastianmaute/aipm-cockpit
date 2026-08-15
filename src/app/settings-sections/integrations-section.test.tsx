import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, fireEvent, screen, waitFor } from "@testing-library/react";
import { IntegrationsSection } from "./integrations-section";
import { ConfirmProvider } from "../confirm-dialog";
import { t } from "../i18n";
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

describe("IntegrationsSection portfolio-mode load hint", () => {
  it("shows a hint naming the load action when Turso is configured", () => {
    render(
      <IntegrationsSection lang="en-US" settings={tursoSettings("test-token")} onChange={() => {}} />,
    );
    expect(
      screen.getByText(/already have a project stored in this database/i),
    ).toBeInTheDocument();
  });

  it("hides that hint when Turso is enabled but not yet configured (URL set, no token)", () => {
    // Turso must stay enabled so the config block itself renders — otherwise
    // the hint's absence would be explained by the whole block being gone,
    // not by the tursoConfigured check this test means to exercise.
    render(
      <IntegrationsSection lang="en-US" settings={tursoSettings("")} onChange={() => {}} />,
    );
    expect(
      screen.getByText(t("en-US", "portfolioModeTursoNeedsConfig")),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/already have a project stored in this database/i),
    ).toBeNull();
  });
});

describe("IntegrationsSection portfolio switch label", () => {
  it("shows the default 'Save & switch portfolio' label when a project is loaded", () => {
    render(
      <IntegrationsSection lang="en-US" settings={tursoSettings("test-token")} onChange={() => {}} />,
    );
    fireEvent.change(
      screen.getByRole("combobox", { name: t("en-US", "portfolioModeLabel") }),
      { target: { value: "turso" } },
    );
    expect(
      screen.getByRole("button", { name: t("en-US", "portfolioModeSwitchConfirm") }),
    ).toBeInTheDocument();
  });

  it("shows a 'Switch portfolio' label instead when noCurrentProject is set", () => {
    render(
      <IntegrationsSection
        lang="en-US"
        settings={tursoSettings("test-token")}
        onChange={() => {}}
        noCurrentProject
      />,
    );
    fireEvent.change(
      screen.getByRole("combobox", { name: t("en-US", "portfolioModeLabel") }),
      { target: { value: "turso" } },
    );
    expect(
      screen.getByRole("button", { name: t("en-US", "portfolioModeSwitchConfirmNoProject") }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: t("en-US", "portfolioModeSwitchConfirm") }),
    ).toBeNull();
  });
});

// ★★ The four per-entity calendar rows had NO test at all — the two below cover
//    the enable control, whose `auto:false`-on-disable behaviour AGENTS.md calls
//    load-bearing (re-enabling would otherwise silently reactivate auto-sync) and
//    which was asserted only at the toolbar site. The control is a ToggleButton,
//    not a checkbox, so it is reached by ROLE and its per-entity accessible name.
describe("IntegrationsSection per-entity calendar sync rows", () => {
  function syncSettings(enabled: boolean, auto: boolean) {
    const s = m365EnabledSettings();
    return {
      ...s,
      outlookCalendar: { ...(s.outlookCalendar ?? {}), task: { enabled, auto } },
    };
  }

  // ★★ The stale-auto flag is defended at three layers: `calendarSyncFor` masks
  //    on READ, the writers force auto:false on disable, and
  //    `sanitizeOutlookCalendar` masks at LOAD so the stored state cannot hold
  //    the combination either.
  //    ★★ THIS TEST PINS THE WRITER, NOT THE READER — an earlier version of this
  //    comment claimed the reader, which is wrong: the handler is now the literal
  //    `write(!sync.enabled, false)`, so deleting `enabled &&` from
  //    `calendarSyncFor` cannot fail it. The reader is pinned in
  //    `calendar-sync-config.test.ts`, and the load mask alongside it.
  //    ★ No claim is made that a shipped build ever wrote {enabled:false,
  //    auto:true} — an earlier version asserted that without evidence. The
  //    reachable source is an imported or hand-edited blob.
  it("enabling a row does not resurrect a stale auto flag", () => {
    const onChange = vi.fn();
    render(
      <IntegrationsSection lang="en-US" settings={syncSettings(false, true)} onChange={onChange} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Add to Outlook – Tasks/i }));
    expect(onChange.mock.calls.at(-1)![0].outlookCalendar.task).toEqual({ enabled: true, auto: false });
  });

  // ★★ Auto is a ToggleButton too, and it is the app's FIRST consumer of the
  //    primitive's `disabled`. It must stay a real disabled <button> — an
  //    aria-disabled lookalike would still fire onToggle and could arm background
  //    sync from a row the user has switched off.
  it("leaves auto inoperable while the row is off", () => {
    const onChange = vi.fn();
    render(
      <IntegrationsSection lang="en-US" settings={syncSettings(false, false)} onChange={onChange} />,
    );
    const auto = screen.getByRole("button", { name: /Keep in sync automatically – Tasks/i });
    expect(auto).toBeDisabled();
    fireEvent.click(auto);
    expect(onChange).not.toHaveBeenCalled();
  });

  // ★★ A real `disabled` leaves the tab order, so the auto toggle cannot explain
  //    itself to a keyboard user. The dependency has to be stated somewhere the
  //    user actually reaches — a visible hint, wired as the button's description.
  it("explains why auto is inert, and drops the explanation once it is live", () => {
    const { rerender } = render(
      <IntegrationsSection lang="en-US" settings={syncSettings(false, false)} onChange={() => {}} />,
    );
    const auto = screen.getByRole("button", { name: /Keep in sync automatically – Tasks/i });
    const hintId = auto.getAttribute("aria-describedby");
    expect(hintId).toBeTruthy();
    expect(document.getElementById(hintId!)).toHaveTextContent(/Available once Add to Outlook is on/i);

    rerender(
      <IntegrationsSection lang="en-US" settings={syncSettings(true, false)} onChange={() => {}} />,
    );
    const live = screen.getByRole("button", { name: /Keep in sync automatically – Tasks/i });
    expect(live).not.toHaveAttribute("aria-describedby");
    // Scoped to THIS row's hint by id. A `queryByText` here matches the three
    // sibling rows that are still off and legitimately still showing theirs.
    expect(document.getElementById(hintId!)).toBeNull();
  });

  it("toggles auto without disturbing enabled once the row is on", () => {
    const onChange = vi.fn();
    render(
      <IntegrationsSection lang="en-US" settings={syncSettings(true, false)} onChange={onChange} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Keep in sync automatically – Tasks/i }));
    expect(onChange.mock.calls.at(-1)![0].outlookCalendar.task).toEqual({ enabled: true, auto: true });
  });

  it("disabling a row also clears auto, so re-enabling cannot silently resume background sync", () => {
    const onChange = vi.fn();
    render(
      <IntegrationsSection lang="en-US" settings={syncSettings(true, true)} onChange={onChange} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Add to Outlook – Tasks/i }));
    // auto MUST come back false here — `{enabled:false, auto:true}` is the bug.
    expect(onChange.mock.calls.at(-1)![0].outlookCalendar.task).toEqual({ enabled: false, auto: false });
  });
});

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
