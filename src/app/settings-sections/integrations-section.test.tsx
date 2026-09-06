import "fake-indexeddb/auto";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { IntegrationsSection } from "./integrations-section";
import { ConfirmProvider } from "../confirm-dialog";
import { t, loadI18n, type Lang } from "../i18n";
import { StorageNotReadyError } from "../storage";
import {
  defaultSettings,
  defaultIntegrations,
  defaultM365Integrations,
  defaultTursoIntegrations,
  defaultJiraConfig,
  type Settings,
} from "../settings-types";
import { defaultTimelogConfig } from "../timelog-types";
import { readDeviceSecret, isPassphraseLocked } from "../secrets-store";
import { testTursoConnection } from "../turso-pipeline";
import { expectRowUniqueNames } from "../../test/row-unique-names";

vi.mock("../turso-pipeline", async (importActual) => ({
  ...(await importActual<typeof import("../turso-pipeline")>()),
  testTursoConnection: vi.fn(),
}));

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

describe("IntegrationsSection Turso credentials supplied by the environment", () => {
  // ★★★ THE TOKEN INPUT IS HIDDEN WHENEVER ITS `NEXT_PUBLIC_TURSO_*` VAR IS
  // SET, and that is deliberate: `getTursoConfig` lets a non-empty env token
  // WIN over anything typed here, so an editable field would be inert.
  // Nothing SAID so, and an env-configured deployment therefore rendered an
  // empty bordered box that reads as a broken settings panel — reported
  // 2026-09-02 against a working Turso backend. These pin the disclosure,
  // which is the only thing standing between the two readings.
  // ★★ THE URL INPUT IS DIFFERENT (§337): env PRESENCE and env USABILITY are
  // separate questions, and `getTursoConfig` only lets a USABLE env URL win.
  // A typo'd env value used to hide this field while resolving to no config
  // at all — unconfigurable from the UI with no route back. The URL input
  // hides only when the env value is usable; an unusable one keeps the input
  // AND adds a disclosure naming the var. See the "§337" describe below.
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("names the env var that supplies the database URL instead of leaving a gap", () => {
    vi.stubEnv("NEXT_PUBLIC_TURSO_DATABASE_URL", "libsql://env-db.turso.io");
    render(<IntegrationsSection lang="en-US" settings={tursoSettings("")} onChange={() => {}} />);
    expect(
      screen.queryByPlaceholderText(t("en-US", "integrationsTursoUrlPlaceholder")),
    ).toBeNull();
    expect(screen.getByText(/NEXT_PUBLIC_TURSO_DATABASE_URL/)).toBeInTheDocument();
  });

  it("names the env var that supplies the auth token instead of leaving a gap", () => {
    vi.stubEnv("NEXT_PUBLIC_TURSO_AUTH_TOKEN", "env-tok");
    render(<IntegrationsSection lang="en-US" settings={tursoSettings("")} onChange={() => {}} />);
    expect(
      screen.queryByPlaceholderText(t("en-US", "integrationsTursoTokenPlaceholder")),
    ).toBeNull();
    expect(screen.getByText(/NEXT_PUBLIC_TURSO_AUTH_TOKEN/)).toBeInTheDocument();
  });

  // The positive observable. Without it an inverted gate — notice always, fields
  // never — passes both assertions above.
  it("keeps both fields and shows no env notice when neither var is set", () => {
    render(<IntegrationsSection lang="en-US" settings={tursoSettings("")} onChange={() => {}} />);
    expect(
      screen.getByPlaceholderText(t("en-US", "integrationsTursoUrlPlaceholder")),
    ).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText(t("en-US", "integrationsTursoTokenPlaceholder")),
    ).toBeInTheDocument();
    expect(screen.queryByText(/NEXT_PUBLIC_TURSO_/)).toBeNull();
  });
});

describe("§337 — an unusable env URL still lets the user configure Turso", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("renders the URL input AND the disclosure when the env var is set but unusable", () => {
    vi.stubEnv("NEXT_PUBLIC_TURSO_DATABASE_URL", "postgres://nope");
    render(<IntegrationsSection lang="en-US" settings={tursoSettings("")} onChange={() => {}} />);
    expect(screen.getByText(t("en-US", "integrationsTursoUrlEnvUnusable"))).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText(t("en-US", "integrationsTursoUrlPlaceholder")),
    ).toBeInTheDocument();
  });

  // ★ THE MUTATION-RELEVANT CASE. A suite that only covers the unusable
  // branch passes whether or not the usable branch still hides the field.
  it("keeps the from-env hint and NO input when the env var is usable", () => {
    vi.stubEnv("NEXT_PUBLIC_TURSO_DATABASE_URL", "libsql://db.turso.io");
    render(<IntegrationsSection lang="en-US" settings={tursoSettings("")} onChange={() => {}} />);
    expect(screen.getByText(t("en-US", "integrationsTursoUrlFromEnv"))).toBeInTheDocument();
    expect(
      screen.queryByPlaceholderText(t("en-US", "integrationsTursoUrlPlaceholder")),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(t("en-US", "integrationsTursoUrlEnvUnusable")),
    ).not.toBeInTheDocument();
  });

  // ★★ The disclosure must be the field's DESCRIPTION, never part of its NAME.
  // Nested inside the implicit <label> it joined the accessible name, turning
  // it into a paragraph. axe has no rule for an over-long accessible name, so
  // this test is the only thing that can catch a regression here.
  it("attaches the disclosure as a description, not as part of the field name", () => {
    vi.stubEnv("NEXT_PUBLIC_TURSO_DATABASE_URL", "postgres://nope");
    render(<IntegrationsSection lang="en-US" settings={tursoSettings("")} onChange={() => {}} />);
    const input = screen.getByPlaceholderText(t("en-US", "integrationsTursoUrlPlaceholder"));
    const notice = screen.getByText(t("en-US", "integrationsTursoUrlEnvUnusable"));

    // Wired by id, and the notice really is outside the label.
    expect(notice.id).toBeTruthy();
    expect(input.getAttribute("aria-describedby")).toBe(notice.id);
    expect(input.closest("label")?.contains(notice)).toBe(false);

    // And the name itself stays short: no textbox may be NAMED by the
    // disclosure sentence. This is the assertion that goes red on a revert to
    // the nested form.
    expect(
      screen.queryByRole("textbox", {
        name: /NEXT_PUBLIC_TURSO_DATABASE_URL is set but/,
      }),
    ).toBeNull();
    // Positive control: the field IS still reachable by its real name, so the
    // assertion above cannot pass merely because no textbox rendered.
    expect(
      screen.getByRole("textbox", { name: new RegExp(t("en-US", "integrationsTursoUrl")) }),
    ).toBe(input);
  });

  it("shows neither hint nor disclosure when no env var is set", () => {
    // ★ Clear the var explicitly — this test asserts an ABSENCE, so a host or
    // CI shell that exports NEXT_PUBLIC_TURSO_DATABASE_URL would otherwise flip
    // it red on correct code. `backend-setup-steps.test.ts` carries the same
    // guard for the same reason.
    vi.stubEnv("NEXT_PUBLIC_TURSO_DATABASE_URL", "");
    render(<IntegrationsSection lang="en-US" settings={tursoSettings("")} onChange={() => {}} />);
    expect(
      screen.queryByText(t("en-US", "integrationsTursoUrlFromEnv")),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(t("en-US", "integrationsTursoUrlEnvUnusable")),
    ).not.toBeInTheDocument();
    expect(
      screen.getByPlaceholderText(t("en-US", "integrationsTursoUrlPlaceholder")),
    ).toBeInTheDocument();
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

describe("§408 — Turso test connection", () => {
  it("reports success in transient state and stores nothing", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    vi.mocked(testTursoConnection).mockResolvedValueOnce(undefined);
    render(<IntegrationsSection lang="en-US" settings={tursoSettings("fake")} onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: t("en-US", "integrationsTursoTestLabel") }));
    expect(await screen.findByText(t("en-US", "integrationsTursoTestOk"))).toBeInTheDocument();
    // ★ The whole point of the transient shape: a probe must not write settings.
    expect(onChange).not.toHaveBeenCalled();
  });

  // ★★★ THROW WHAT THE SUBSTRATE THROWS. An earlier version of this test
  //     rejected with a bare `new Error("storage-unreachable")` and asserted
  //     "Connection failed: storage-unreachable" — a string the production path
  //     CANNOT emit, because `runTursoPipeline` throws `StorageNotReadyError`
  //     and that constructor prefixes its hint (`Storage not ready: ${hint}`).
  //     The test was green while the real UI said something else, and it would
  //     have stayed green through any rewrite of the message shaping. Reject
  //     with the real error type so the classifier under test actually runs.
  it("reports a localized unreachable message when the probe rejects", async () => {
    const user = userEvent.setup();
    vi.mocked(testTursoConnection).mockRejectedValueOnce(
      new StorageNotReadyError("storage-unreachable"),
    );
    render(<IntegrationsSection lang="en-US" settings={tursoSettings("fake")} onChange={() => {}} />);
    await user.click(screen.getByRole("button", { name: t("en-US", "integrationsTursoTestLabel") }));
    expect(
      await screen.findByText(t("en-US", "integrationsTursoTestUnreachable")),
    ).toBeInTheDocument();
    // The raw hint and the StorageNotReadyError prefix must BOTH be absent —
    // this is the assertion that would have caught the original defect.
    expect(screen.queryByText(/storage-unreachable/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Storage not ready/)).not.toBeInTheDocument();
  });

  it("reports a localized auth message when the token is rejected", async () => {
    const user = userEvent.setup();
    vi.mocked(testTursoConnection).mockRejectedValueOnce(
      new StorageNotReadyError("Turso auth token rejected. Check the token in Settings."),
    );
    render(<IntegrationsSection lang="en-US" settings={tursoSettings("fake")} onChange={() => {}} />);
    await user.click(screen.getByRole("button", { name: t("en-US", "integrationsTursoTestLabel") }));
    expect(await screen.findByText(t("en-US", "integrationsTursoTestAuth"))).toBeInTheDocument();
    expect(screen.queryByText(/Check the token in Settings/)).not.toBeInTheDocument();
  });

  // ★ The fixture must be an error `tursoErrorKind` does NOT classify. Note
  // that "Turso returned an unexpected response shape." would NOT work here:
  // the classifier matches /^Turso returned/i and calls it "unreachable", so a
  // response-shape failure is reported as an unreachable host. That is
  // pre-existing shared behaviour (the storage banner reads the same
  // classifier) and is deliberately not changed from this surface.
  it("falls back to the generic message for an unclassified failure", async () => {
    const user = userEvent.setup();
    vi.mocked(testTursoConnection).mockRejectedValueOnce(new Error("boom"));
    render(<IntegrationsSection lang="en-US" settings={tursoSettings("fake")} onChange={() => {}} />);
    await user.click(screen.getByRole("button", { name: t("en-US", "integrationsTursoTestLabel") }));
    expect(
      await screen.findByText(t("en-US", "integrationsTursoTestFailGeneric")),
    ).toBeInTheDocument();
    expect(screen.queryByText(/boom/)).not.toBeInTheDocument();
  });

  // ★★ NOT "shows a message when unconfigured" — there is no such message, and
  // writing one would be dead code. The control is DISABLED whenever
  // `getTursoConfig` cannot resolve, and a disabled button dispatches no click,
  // so the probe is unreachable rather than guarded. Pin the disabled state
  // itself; an earlier version of this test clicked the button and awaited a
  // message, which timed out at 15 s instead of failing an assertion.
  it("disables the probe entirely when there is no usable config", () => {
    vi.mocked(testTursoConnection).mockClear();
    render(<IntegrationsSection lang="en-US" settings={tursoSettings("")} onChange={() => {}} />);
    expect(
      screen.getByRole("button", { name: t("en-US", "integrationsTursoTestLabel") }),
    ).toBeDisabled();
    expect(testTursoConnection).not.toHaveBeenCalled();
  });

  it("localizes the failure message in German too", async () => {
    await loadI18n("de");
    const user = userEvent.setup();
    vi.mocked(testTursoConnection).mockRejectedValueOnce(
      new StorageNotReadyError("storage-unreachable"),
    );
    render(<IntegrationsSection lang="de" settings={tursoSettings("fake")} onChange={() => {}} />);
    await user.click(screen.getByRole("button", { name: t("de", "integrationsTursoTestLabel") }));
    expect(await screen.findByText(t("de", "integrationsTursoTestUnreachable"))).toBeInTheDocument();
    // The defect this whole block exists for: English leaking into a DE surface.
    expect(screen.queryByText(/Storage not ready/)).not.toBeInTheDocument();
  });

  it("disables the button while a probe is in flight", async () => {
    const user = userEvent.setup();
    let release: (() => void) | undefined;
    vi.mocked(testTursoConnection).mockReturnValueOnce(
      new Promise<void>((res) => {
        release = res;
      }),
    );
    render(<IntegrationsSection lang="en-US" settings={tursoSettings("fake")} onChange={() => {}} />);
    const btn = screen.getByRole("button", { name: t("en-US", "integrationsTursoTestLabel") });
    await user.click(btn);
    expect(btn).toBeDisabled();
    release?.();
    await waitFor(() => expect(btn).toBeEnabled());
  });

  // ★★ THIS SECTION IS FULLY CONTROLLED — `turso` is derived from the
  // `settings` prop — so the rest of this file's `onChange={() => {}}` renders
  // CANNOT move the URL or the token. Every test below THAT MOVES A FIELD
  // therefore needs this wrapper, which feeds the edit back in so the fields
  // the fingerprint is compared against really move. ★ That qualifier is
  // measured, not hedging: making the wrapper uncontrolled reds the two
  // editing tests and leaves the language and fail-probe tests GREEN, because
  // neither of those edits anything. A non-editing test added here does not
  // need the wrapper.
  // ★★ A typing test written against an UNCONTROLLED render is UNSATISFIABLE,
  // not vacuous, and the difference decides what a red means. Vacuous would
  // mean it silently PASSES; in fact it FAILS even against a correct
  // implementation, because the field's value never changes, so the
  // fingerprint still matches, so nothing invalidates the verdict and the
  // message stays on screen. Measured against the shipped component by
  // swapping this wrapper for `<IntegrationsSection … onChange={() => {}} />`
  // in one test: THAT test alone went red, every other test in the file stayed
  // green. (The pass TOTAL is deliberately not quoted — it moves with every
  // test added to this file, and a rotted number invites re-measuring the
  // wrong thing.)
  // ★★ SO THE TWO REDS MEAN OPPOSITE THINGS, and only the first is a harness
  // artefact. A red from THAT SWAP (an uncontrolled render) means the harness
  // cannot express the behaviour — do not go looking for a bug. A red from any
  // test BELOW, all of which use this wrapper, is a genuine regression: the
  // invalidation really is broken. Nothing here licenses dismissing those.
  function ControlledIntegrations({ lang = "en-US" }: { lang?: Lang }) {
    const [settings, setSettings] = useState<Settings>(tursoSettings("fake"));
    return <IntegrationsSection lang={lang} settings={settings} onChange={setSettings} />;
  }

  it("drops the confirmed result when the URL is edited after a passing test", async () => {
    const user = userEvent.setup();
    vi.mocked(testTursoConnection).mockResolvedValueOnce(undefined);
    render(<ControlledIntegrations />);

    await user.click(screen.getByRole("button", { name: t("en-US", "integrationsTursoTestLabel") }));
    expect(await screen.findByText(t("en-US", "integrationsTursoTestOk"))).toBeInTheDocument();

    await user.type(
      screen.getByPlaceholderText(t("en-US", "integrationsTursoUrlPlaceholder")),
      "x",
    );

    expect(screen.queryByText(t("en-US", "integrationsTursoTestOk"))).toBeNull();
  });

  // ★★ THE TOKEN HALF NEEDS ITS OWN TEST — the URL one above cannot cover it.
  // The freshness derivation is a conjunction, so a test that only ever moves
  // the URL leaves the `token` comparison unpinned: deleting it keeps the
  // suite green while a pasted-over token silently inherits the old verdict.
  // Mutation-proved by deleting that comparison — this test alone goes red.
  it("drops the confirmed result when the auth token is edited after a passing test", async () => {
    const user = userEvent.setup();
    vi.mocked(testTursoConnection).mockResolvedValueOnce(undefined);
    render(<ControlledIntegrations />);

    await user.click(screen.getByRole("button", { name: t("en-US", "integrationsTursoTestLabel") }));
    expect(await screen.findByText(t("en-US", "integrationsTursoTestOk"))).toBeInTheDocument();

    await user.type(
      screen.getByPlaceholderText(t("en-US", "integrationsTursoTokenPlaceholder")),
      "2",
    );

    expect(screen.queryByText(t("en-US", "integrationsTursoTestOk"))).toBeNull();
  });

  // ★★ THE VERDICT MUST FOLLOW `lang`, WHICH IS WHY THE RECORD HOLDS AN I18N
  // KEY AND NOT A RENDERED STRING. `LocalizationSection` and this section mount
  // in the SAME panel, so the language can change with a verdict on screen; a
  // message frozen at probe time leaves an English sentence inside a German
  // panel — the exact defect the CLASSIFY-NEVER-INTERPOLATE comment on
  // `runTursoTest` exists to prevent, reintroduced one layer up.
  it("re-renders the verdict in the new language when lang changes", async () => {
    await loadI18n("de");
    const user = userEvent.setup();
    vi.mocked(testTursoConnection).mockResolvedValueOnce(undefined);
    const { rerender } = render(<ControlledIntegrations lang="en-US" />);

    await user.click(screen.getByRole("button", { name: t("en-US", "integrationsTursoTestLabel") }));
    expect(await screen.findByText(t("en-US", "integrationsTursoTestOk"))).toBeInTheDocument();

    // Same component type, so the verdict state survives the re-render — this
    // is a language switch under a live verdict, not a fresh probe.
    rerender(<ControlledIntegrations lang="de" />);

    // ★★ THIS ASSERTION CARRIES A SECOND PROPERTY, and it is the stronger of
    // the two: asserting the DE message IS PRESENT proves POSITIVELY that a
    // language change does NOT invalidate the verdict — `lang` is not part of
    // the fingerprint, and must never become part of it. An absence-only test
    // ("the EN string is gone") would pass just as well if the verdict had
    // been dropped entirely, which is the opposite of the intended behaviour.
    // Keep both halves if this test is ever rewritten.
    expect(screen.getByText(t("de", "integrationsTursoTestOk"))).toBeInTheDocument();
    expect(screen.queryByText(t("en-US", "integrationsTursoTestOk"))).toBeNull();
  });

  // ★ Coverage for the discriminator Task 2 will gate the Move button on, so it
  // does not arrive with none. What is observable TODAY is only the rendered
  // message: with the union, a `kind` of "ok" selects the success key, so a
  // catch branch mis-tagged "ok" would surface here. That is a real pin on the
  // discriminator, but it is an INDIRECT one — when the confirmed reading gets
  // a consumer, assert on THAT too rather than treating this as sufficient.
  // ★★ AND IT IS REDUNDANT TODAY — do not read it as independent coverage.
  // A catch branch mis-tagged "ok" fails "reports a localized unreachable
  // message when the probe rejects" (above) FIRST, and review could not
  // construct a mutant that kills this test ALONE. Its value is documentary
  // and forward-looking: it states the property Task 2's gate depends on, in
  // the place someone will look for it. Deleting it loses no detection today.
  it("never reports a confirmed connection when the probe failed", async () => {
    const user = userEvent.setup();
    vi.mocked(testTursoConnection).mockRejectedValueOnce(
      new StorageNotReadyError("storage-unreachable"),
    );
    render(<ControlledIntegrations />);

    await user.click(screen.getByRole("button", { name: t("en-US", "integrationsTursoTestLabel") }));
    expect(
      await screen.findByText(t("en-US", "integrationsTursoTestUnreachable")),
    ).toBeInTheDocument();
    expect(screen.queryByText(t("en-US", "integrationsTursoTestOk"))).toBeNull();
  });
});

describe("§408 — Move to Turso is gated on a confirmed connection", () => {
  // ★★★ ASSERT THE DISABLED STATE, NEVER A CLICK. A `disabled` element
  // dispatches no events, so "click Move and assert nothing happened" does not
  // fail — it TIMES OUT at 15 s (`vitest.setup.ts` `asyncUtilTimeout`), which
  // reads like a broken suite rather than a red test. The same fact is why a
  // handler guard duplicating this predicate would be dead code.
  //
  // ★★ CONTROLLED, for the same reason the wrapper above the previous block
  // exists — read that comment for why an uncontrolled render makes an editing
  // test UNSATISFIABLE rather than vacuous. This one additionally supplies
  // `onMigrateToTurso`, without which `canMoveToTurso` renders no button at
  // all and every assertion here would fail on a missing element instead of on
  // the gate.
  function ControlledMove({ onMigrateToTurso }: { onMigrateToTurso: () => void }) {
    const [settings, setSettings] = useState<Settings>(tursoSettings("fake"));
    return (
      <IntegrationsSection
        lang="en-US"
        settings={settings}
        onChange={setSettings}
        onMigrateToTurso={onMigrateToTurso}
      />
    );
  }

  const moveButton = () =>
    screen.getByRole("button", { name: t("en-US", "projectMigrateToTurso") });

  async function passingProbe() {
    const user = userEvent.setup();
    vi.mocked(testTursoConnection).mockResolvedValueOnce(undefined);
    await user.click(screen.getByRole("button", { name: t("en-US", "integrationsTursoTestLabel") }));
    expect(await screen.findByText(t("en-US", "integrationsTursoTestOk"))).toBeInTheDocument();
    return user;
  }

  it("is disabled before any test has run", () => {
    const migrate = vi.fn();
    render(<ControlledMove onMigrateToTurso={migrate} />);
    expect(moveButton()).toBeDisabled();
    expect(migrate).not.toHaveBeenCalled();
  });

  it("is enabled once the probe confirms the connection", async () => {
    render(<ControlledMove onMigrateToTurso={vi.fn()} />);
    await passingProbe();
    expect(moveButton()).toBeEnabled();
  });

  it("stays disabled when the probe fails", async () => {
    const user = userEvent.setup();
    const migrate = vi.fn();
    vi.mocked(testTursoConnection).mockRejectedValueOnce(
      new StorageNotReadyError("storage-unreachable"),
    );
    render(<ControlledMove onMigrateToTurso={migrate} />);

    await user.click(screen.getByRole("button", { name: t("en-US", "integrationsTursoTestLabel") }));
    expect(
      await screen.findByText(t("en-US", "integrationsTursoTestUnreachable")),
    ).toBeInTheDocument();

    // ★ The DIRECT pin on the discriminator the block above could only reach
    // indirectly, through the rendered message: a `fail` verdict mis-tagged
    // "ok" is FRESH either way, so only this assertion separates the two.
    expect(moveButton()).toBeDisabled();
    expect(migrate).not.toHaveBeenCalled();
  });

  // ★★ THE FINGERPRINT NEEDS BOTH HALVES PINNED. Freshness is a conjunction
  // over the URL and the token, so a test that only ever edits one leaves the
  // other comparison unpinned — see the equivalent pair in the block above.
  it("re-disables when the URL is edited after a pass", async () => {
    render(<ControlledMove onMigrateToTurso={vi.fn()} />);
    const user = await passingProbe();
    expect(moveButton()).toBeEnabled();

    await user.type(screen.getByPlaceholderText(t("en-US", "integrationsTursoUrlPlaceholder")), "x");

    expect(moveButton()).toBeDisabled();
  });

  it("re-disables when the auth token is edited after a pass", async () => {
    render(<ControlledMove onMigrateToTurso={vi.fn()} />);
    const user = await passingProbe();
    expect(moveButton()).toBeEnabled();

    await user.type(
      screen.getByPlaceholderText(t("en-US", "integrationsTursoTokenPlaceholder")),
      "2",
    );

    expect(moveButton()).toBeDisabled();
  });

  // ★★ WHY THE HINT CANNOT RIDE THE BUTTON'S `title` ALONE: a disabled control
  // is not focusable, so `title` has no keyboard route and none on touch,
  // while `aria-describedby` IS exposed on a disabled control and OUTRANKS
  // `title` as the accessible description. The sr-only node is what reaches
  // AT; the wrapper's `title` serves the sighted mouse user. Same contract as
  // `projects-panel.tsx` — jsdom has no layout, so these assertions pin the
  // wiring and the classes only; the hover behaviour is owed a browser
  // eye-verify there and here alike.
  it("describes why it is disabled, where AT can reach it", () => {
    render(<ControlledMove onMigrateToTurso={vi.fn()} />);
    const btn = moveButton();
    expect(btn).toHaveAccessibleDescription(t("en-US", "integrationsTursoMoveNeedsTest"));
    expect(btn.className).toContain("disabled:pointer-events-none");
    expect(btn.closest("[title]")!.className).toContain("cursor-not-allowed");
  });

  it("swaps the description for the action's own hint once confirmed", async () => {
    render(<ControlledMove onMigrateToTurso={vi.fn()} />);
    await passingProbe();
    const btn = moveButton();
    expect(btn).toHaveAccessibleDescription(t("en-US", "projectMigrateToTursoHint"));
    expect(btn.closest("[title]")!.className).not.toContain("cursor-not-allowed");
  });
});

describe("IntegrationsSection — Test-connection button names (WCAG 2.4.6)", () => {
  // Turso, Timelog and Jira each render their own "Test connection" button
  // (jiraTest/timelogTest/integrationsTursoTest are the SAME EN string), and
  // all three mount in this one subtree once Turso + Timelog + Jira are all
  // enabled. The visible text stays "Test connection" on every button; only
  // the ACCESSIBLE NAME is qualified per service.
  //
  // ★ `requireCollisionSeed` does NOT fit this shape and is deliberately NOT
  // used. It throws unless two RENDERED names collide once a trailing
  // `" (N)"` occurrence suffix is stripped (`buildRowTokens`'s disambiguation
  // shape) — but this fix's whole point is that the three rendered names are
  // no longer equal, and none of them ever carries an "(N)" suffix. Calling
  // it here would throw "seeded no two rows sharing a display name" against
  // CORRECT code. This is instead the "distinct-name regression pin" case
  // the helper's own docstring calls out as legitimate but different:
  // `expectRowUniqueNames({ minControls: 3 })` with no `requireCollisionSeed`
  // asserts the three qualified names are pairwise distinct, and the
  // explicit `getAllByText`/`getByRole` assertions above it independently
  // pin that the SHARED VISIBLE TEXT is what makes the collision possible in
  // the first place.
  it("gives each Test-connection button a service-qualified accessible name", () => {
    const settings = {
      ...tursoSettings("fake"),
      timelog: { ...defaultTimelogConfig, enabled: true },
      jira: { ...defaultJiraConfig, enabled: true },
    };
    render(<IntegrationsSection lang="en-US" settings={settings} onChange={() => {}} />);

    // Sanity: the fixture really does render three "Test connection"-worded
    // buttons, i.e. the collision is genuinely possible here and this test is
    // not passing because a button failed to mount.
    // ★★ An earlier revision of this comment said `requireCollisionSeed`
    // "below re-checks this against the RENDERED names" — there is no such
    // call, and the block comment above this test explains at length why it is
    // deliberately absent. That was a false-coverage claim: it named a second
    // guard that does not exist.
    expect(screen.getAllByText(t("en-US", "integrationsTursoTest"))).toHaveLength(3);

    expect(
      screen.getByRole("button", { name: t("en-US", "integrationsTursoTestLabel") }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: t("en-US", "timelogTestLabel") }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: t("en-US", "jiraTestLabel") }),
    ).toBeInTheDocument();

    // ★★ THE THREE `getByRole` ASSERTIONS ABOVE ARE DOING THE REAL WORK, not
    // this call — it is weaker than its name reads. `expectRowUniqueNames`
    // fails on a DUPLICATE, and removing exactly ONE of the three `aria-label`s
    // produces no duplicate at all ("Test connection" / "… – Timelog" /
    // "… – Jira" are still pairwise distinct), so this call alone passes that
    // regression. Keep all three `getByRole` lines: each pins one label by key,
    // and they are what goes red when a single label is dropped.
    expectRowUniqueNames({ minControls: 3 });
  });
});
