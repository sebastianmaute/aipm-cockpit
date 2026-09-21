// §548 — on Turso storage the Turso URL/token are DRAFTS that only the explicit Apply button commits
// (`tursoIsLive` in `integrations-section.tsx`); on any other kind each keystroke commits. These pin
// the host and lifecycle edges, each with a named mutation:
//   A1 (Modal host) — Escape in `BackendConfigModal` blurs the field before closing (`modal.tsx`);
//        on Turso storage that must NOT commit the draft. Mutation MA1: commit on blur.
//   A4 (Modal host) — off Turso storage the same host commits per keystroke, with no Apply.
//   A5 — "Save & switch" applies the drafts itself and waits for the token seal before reloading,
//        BOUNDED by `waitForTokenSeals`. Mutations: MA5 — drop the bound (wait on the seals
//        alone); M5 — skip the wait; M6 — `base = settings` (no fold).
//   A6 — the render-time reconcile keeps a dirty draft and resyncs a clean one. Mutations M7/M8:
//        drop the clean-draft guard on the URL / token resync.
import "fake-indexeddb/auto";
import { useEffect, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { IntegrationsSection } from "./integrations-section";
import { BackendConfigModal } from "../backend-config-modal";
import { MODAL_HELP } from "../help-content";
import { t } from "../i18n";
import {
  defaultIntegrations,
  defaultSettings,
  defaultTursoIntegrations,
  type Settings,
} from "../settings-types";
import type { StorageConfig } from "../storage";
import { saveSecretValue, setSecretPassphrase, unlockSecret } from "../use-secrets";
import { SECRET_MERGE_TIMEOUT_MS } from "../use-settings";
import { loadPortfolioMode, savePortfolioMode } from "../portfolio-mode";
import { loadSealed, saveSealed } from "../secrets-store";
import { sealDevice, sealPassphrase } from "../secrets";

// `unlockSecret` stays REAL, wrapped in a spy only so `afterEach` can drain every in-flight verify:
// a test that fails mid-verify would otherwise leave a PBKDF2 continuation that reaches the shared
// `setSecretPassphrase` mock after the NEXT test's `mockReset`, poisoning it.
vi.mock("../use-secrets", async (importActual) => {
  const actual = await importActual<typeof import("../use-secrets")>();
  return {
    ...actual,
    saveSecretValue: vi.fn(),
    setSecretPassphrase: vi.fn(),
    unlockSecret: vi.fn(actual.unlockSecret),
  };
});

const URL_A = "libsql://a.turso.io";
const TURSO: StorageConfig = { kind: "turso" };
const BROWSER: StorageConfig = { kind: "browser" };

function settingsWith(databaseUrl: string, authToken: string, storageConfig: StorageConfig = TURSO): Settings {
  return {
    ...defaultSettings,
    storageConfig,
    integrations: {
      ...defaultIntegrations,
      turso: { ...defaultTursoIntegrations, enabled: true, databaseUrl, authToken },
    },
  };
}

const urlField = () => screen.getByPlaceholderText(t("en-US", "integrationsTursoUrlPlaceholder"));
const tokenField = () => screen.getByPlaceholderText(t("en-US", "integrationsTursoTokenPlaceholder"));
const applyLabel = t("en-US", "integrationsTursoApplyLabel");

beforeEach(() => {
  vi.mocked(saveSecretValue).mockReset();
  vi.mocked(saveSecretValue).mockResolvedValue(undefined);
  vi.mocked(setSecretPassphrase).mockReset();
  vi.mocked(setSecretPassphrase).mockResolvedValue(undefined);
  localStorage.clear();
});
afterEach(async () => {
  // Drain in-flight verifies, then one macrotask so each continuation (commit + re-seal) runs here.
  await Promise.allSettled(vi.mocked(unlockSecret).mock.results.map((r) => r.value));
  await new Promise((resolve) => setTimeout(resolve, 0));
  vi.mocked(unlockSecret).mockClear();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("A1/A4 — the Turso fields in a Modal host (BackendConfigModal)", () => {
  beforeEach(() => {
    // jsdom has no rAF; Modal's initial-focus effect queues one.
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { cb(0); return 0; });
    vi.stubGlobal("cancelAnimationFrame", () => {});
  });

  function renderModal(settings: Settings, onChangeSettings = vi.fn(), onClose = vi.fn()) {
    render(
      <BackendConfigModal
        lang="en-US"
        title="Backend"
        settings={settings}
        onChangeSettings={onChangeSettings}
        onClose={onClose}
        helpConceptId={MODAL_HELP.backendConfig}
      />,
    );
    return { onChangeSettings, onClose };
  }

  it("Turso storage: Escape closes and DISCARDS the unapplied drafts — no commit, no seal", async () => {
    const user = userEvent.setup();
    const { onChangeSettings, onClose } = renderModal(settingsWith(URL_A, "tok"));
    expect(screen.getByRole("button", { name: applyLabel })).toBeDisabled();
    await user.type(urlField(), "q");
    await user.type(tokenField(), "9");
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onChangeSettings).not.toHaveBeenCalled();
    expect(saveSecretValue).not.toHaveBeenCalled();
  });

  it("Turso storage: Apply in the modal commits both drafts in ONE change and device-seals", async () => {
    const user = userEvent.setup();
    const { onChangeSettings } = renderModal(settingsWith(URL_A, "tok"));
    await user.type(urlField(), "q");
    await user.type(tokenField(), "9");
    await user.click(screen.getByRole("button", { name: applyLabel }));
    expect(onChangeSettings).toHaveBeenCalledTimes(1);
    expect(onChangeSettings.mock.calls[0][0].integrations.turso.databaseUrl).toBe(`${URL_A}q`);
    expect(onChangeSettings.mock.calls[0][0].integrations.turso.authToken).toBe("tok9");
    expect(saveSecretValue).toHaveBeenCalledTimes(1);
    expect(saveSecretValue).toHaveBeenCalledWith("tursoAuthToken", "tok9", "device");
  });

  it("browser storage (configuring Turso before switching to it): commits per keystroke, no Apply", async () => {
    const user = userEvent.setup();
    const { onChangeSettings } = renderModal(settingsWith(URL_A, "tok", BROWSER));
    expect(screen.queryByRole("button", { name: applyLabel })).toBeNull();
    await user.type(tokenField(), "9");
    expect(onChangeSettings).toHaveBeenCalledTimes(1);
    expect(onChangeSettings.mock.calls[0][0].integrations.turso.authToken).toBe("tok9");
    expect(saveSecretValue).toHaveBeenCalledWith("tursoAuthToken", "tok9", "device");
  });

  // §565: off Turso storage every keystroke commits, and a clear used to seal "" AND set the
  // stored flag, so the "Remove" button appeared right after the user removed the token.
  it("§565: clearing the token off Turso removes the seal and hides Remove; retyping restores both", async () => {
    // A REAL device-sealed record, so the clear has something to remove: `removeSealed` is the
    // real store function here, and without this seed its deletion would leave the case green.
    saveSealed(await sealDevice("tursoAuthToken", "tok"));
    expect(loadSealed("tursoAuthToken")).not.toBeNull();
    const user = userEvent.setup();
    renderModal(settingsWith(URL_A, "tok", BROWSER));
    const remove = () => screen.queryByRole("button", { name: t("en-US", "secretPassphraseRemove") });
    await user.clear(tokenField());
    expect(remove()).toBeNull();
    expect(loadSealed("tursoAuthToken")).toBeNull();
    expect(saveSecretValue).not.toHaveBeenCalledWith("tursoAuthToken", "", "device");
    await user.type(tokenField(), "tok2");
    expect(saveSecretValue).toHaveBeenLastCalledWith("tursoAuthToken", "tok2", "device");
    expect(await screen.findByRole("button", { name: t("en-US", "secretPassphraseRemove") })).toBeInTheDocument();
  });
});

describe("A5 — Save & switch applies the drafts and waits (bounded) for the token seal", () => {
  let reload: ReturnType<typeof vi.fn>;
  const originalLocation = window.location;
  beforeEach(() => {
    reload = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...originalLocation, reload },
    });
    savePortfolioMode("file");
  });
  afterEach(() => {
    vi.useRealTimers();
    Object.defineProperty(window, "location", { configurable: true, value: originalLocation });
  });

  function Controlled() {
    const [settings, setSettings] = useState<Settings>(settingsWith(URL_A, "tok"));
    return <IntegrationsSection lang="en-US" settings={settings} onChange={setSettings} />;
  }

  const switchButton = () =>
    screen.getByRole("button", { name: t("en-US", "portfolioModeSwitchConfirm") });
  const persisted = () => JSON.parse(localStorage.getItem("aipm-cockpit:settings") ?? "{}");

  it("an applied token's pending seal holds the reload until it resolves (M5)", async () => {
    const user = userEvent.setup();
    let release: () => void = () => {};
    vi.mocked(saveSecretValue).mockReturnValueOnce(new Promise<void>((r) => { release = r; }));
    render(<Controlled />);

    await user.type(tokenField(), "2");
    await user.click(screen.getByRole("button", { name: applyLabel })); // seal starts (deferred)
    expect(saveSecretValue).toHaveBeenCalledWith("tursoAuthToken", "tok2", "device");

    await user.selectOptions(screen.getByLabelText(t("en-US", "portfolioModeLabel")), "turso");
    await user.click(switchButton());
    expect(reload).not.toHaveBeenCalled();

    await act(async () => release());
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    expect(persisted().storageConfig?.kind).toBe("turso");
  });

  it("UNAPPLIED URL and token drafts are applied by the switch and the token sealed (M6)", async () => {
    const user = userEvent.setup();
    render(<Controlled />);
    await user.selectOptions(screen.getByLabelText(t("en-US", "portfolioModeLabel")), "turso");
    await user.type(urlField(), "x");
    await user.type(tokenField(), "7");
    await user.click(switchButton());
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    expect(persisted().integrations?.turso?.databaseUrl).toBe(`${URL_A}x`);
    expect(saveSecretValue).toHaveBeenCalledWith("tursoAuthToken", "tok7", "device");
  });

  // §565: confirmPortfolioModeSwitch's `pendingMode === "turso"` guard gates only the switch-TO-turso
  // leg, so clearing the token and switching back to File still reaches the (separate) unconditional
  // seal below it — which used to seal "" exactly like `commitTurso` did.
  it("§565: switching off Turso with a cleared token does not seal an empty string", async () => {
    // A REAL device-sealed record for the switch to remove (see the off-Turso §565 case above).
    saveSealed(await sealDevice("tursoAuthToken", "tok"));
    const user = userEvent.setup();
    savePortfolioMode("turso");
    render(<Controlled />);
    await user.clear(tokenField());
    expect(loadSealed("tursoAuthToken")).not.toBeNull(); // live Turso: the clear is only a draft
    await user.selectOptions(screen.getByLabelText(t("en-US", "portfolioModeLabel")), "file");
    await user.click(switchButton());
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    expect(saveSecretValue).not.toHaveBeenCalledWith("tursoAuthToken", "", "device");
    expect(loadSealed("tursoAuthToken")).toBeNull();
  });

  it("a seal that never settles delays the reload by SECRET_MERGE_TIMEOUT_MS at most (MA5)", async () => {
    vi.useFakeTimers();
    let release: () => void = () => {};
    vi.mocked(saveSecretValue).mockReturnValueOnce(new Promise<void>((r) => { release = r; }));
    try {
      render(<Controlled />);
      fireEvent.change(tokenField(), { target: { value: "tok5" } });
      fireEvent.change(screen.getByLabelText(t("en-US", "portfolioModeLabel")), { target: { value: "turso" } });
      fireEvent.click(switchButton());
      expect(saveSecretValue).toHaveBeenCalledWith("tursoAuthToken", "tok5", "device");

      await act(async () => { await vi.advanceTimersByTimeAsync(SECRET_MERGE_TIMEOUT_MS - 1); });
      expect(reload).not.toHaveBeenCalled();
      await act(async () => { await vi.advanceTimersByTimeAsync(1); });
      expect(reload).toHaveBeenCalledTimes(1);
      expect(persisted().storageConfig?.kind).toBe("turso");
    } finally {
      // Settle the stuck seal so the module-scope in-flight set is empty for later tests.
      await act(async () => release());
    }
  });
});

describe("A6 — an outside change to the stored value keeps a draft being edited (Turso storage)", () => {
  let setExternal: (s: Settings) => void = () => {};
  function Host() {
    const [settings, setSettings] = useState<Settings>(settingsWith(URL_A, "tok"));
    useEffect(() => { setExternal = setSettings; }, []);
    return <IntegrationsSection lang="en-US" settings={settings} onChange={setSettings} />;
  }

  it("a dirty URL draft survives; the clean token field follows (M7)", async () => {
    const user = userEvent.setup();
    render(<Host />);
    await user.click(urlField());
    await user.type(urlField(), "zz");
    act(() => setExternal(settingsWith("libsql://other.turso.io", "ext-tok")));
    expect(urlField()).toHaveValue(`${URL_A}zz`);
    expect(urlField()).toHaveFocus();
    expect(tokenField()).toHaveValue("ext-tok"); // control: a clean draft resyncs
  });

  it("a dirty token draft survives; the clean URL field follows (M8)", async () => {
    const user = userEvent.setup();
    render(<Host />);
    await user.click(tokenField());
    await user.type(tokenField(), "zz");
    act(() => setExternal(settingsWith("libsql://other.turso.io", "ext-tok")));
    expect(tokenField()).toHaveValue("tokzz");
    expect(urlField()).toHaveValue("libsql://other.turso.io"); // control
  });
});

// I1 — boot's `hydrateSecretsInto` restores `authToken` from the sealed store, so sealing an
// UNAPPLIED draft would silently apply it on the next reload. On Turso storage the passphrase
// actions must seal the COMMITTED token. Mutation MA7: seal the draft again
// (`sealableTursoToken = tursoToken`) → both tests red.
describe("I1 — on Turso storage the passphrase actions seal the APPLIED token, never the draft", () => {
  const lock = () => screen.getByLabelText(t("en-US", "secretLockPassphrase"));

  it("unticking the lock re-seals the committed token", async () => {
    const user = userEvent.setup();
    render(<IntegrationsSection lang="en-US" settings={settingsWith(URL_A, "tok")} onChange={vi.fn()} />);
    await user.type(tokenField(), "NEW");
    await user.click(lock()); // tick: no seal yet
    await user.click(lock()); // untick: re-seal device-wrapped
    await waitFor(() => expect(saveSecretValue).toHaveBeenCalledTimes(1));
    expect(saveSecretValue).toHaveBeenCalledWith("tursoAuthToken", "tok", "device");
    expect(saveSecretValue).not.toHaveBeenCalledWith("tursoAuthToken", "tokNEW", "device");
  });

  it("passphrase Save seals the committed token", async () => {
    const user = userEvent.setup();
    render(<IntegrationsSection lang="en-US" settings={settingsWith(URL_A, "tok")} onChange={vi.fn()} />);
    await user.type(tokenField(), "NEW");
    await user.click(lock());
    await user.type(screen.getByLabelText(t("en-US", "secretPassphrasePlaceholder")), "pw");
    await user.type(screen.getByLabelText(t("en-US", "secretPassphraseConfirm")), "pw");
    await user.click(screen.getByRole("button", { name: t("en-US", "secretPassphraseSave") }));
    await waitFor(() => expect(setSecretPassphrase).toHaveBeenCalledTimes(1));
    expect(setSecretPassphrase).toHaveBeenCalledWith("tursoAuthToken", "tok", "pw");
  });
});

// Passphrase mode — the passphrase is never held in memory, so a changed token can be sealed only
// under a passphrase typed into the section's own fields. Until then Apply and "Save & switch" are
// disabled; with it, both re-seal the NEW token under it (else a reload + unlock yields the old
// token, or none after the switch's `writeSettings`).
//   MA9 — drop the passphrase seal from `commitTurso` → the Apply test goes red.
//   MA9b — `tokenSealBlocked` always false → the Apply test goes red (enabled while blocked).
//   MA10 — drop the passphrase seal from `confirmPortfolioModeSwitch` → the switch test goes red.
//   MA10b — Save & switch `disabled={switchBusy}` only → the switch test goes red.
// These run with NO passphrase record (case (c) of the verify below): the typed passphrase becomes it.
//   MV3 — drop `typedPassphraseOpensRecord`'s no-record early return → the Apply test goes red.
describe("Passphrase mode — Apply and Save & switch re-seal the new token under the typed passphrase", () => {
  const lock = () => screen.getByLabelText(t("en-US", "secretLockPassphrase"));
  const typePassphrase = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.type(screen.getByLabelText(t("en-US", "secretPassphrasePlaceholder")), "pw");
    await user.type(screen.getByLabelText(t("en-US", "secretPassphraseConfirm")), "pw");
  };

  it("Apply is disabled for a changed token until the passphrase is typed, then seals under it", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<IntegrationsSection lang="en-US" settings={settingsWith(URL_A, "tok")} onChange={onChange} />);
    await user.click(lock()); // passphrase mode
    await user.type(tokenField(), "NEW");
    const apply = screen.getByRole("button", { name: applyLabel });
    expect(apply).toBeDisabled();
    await user.keyboard("{Enter}"); // the keyboard path is gated the same way
    expect(onChange).not.toHaveBeenCalled();

    await typePassphrase(user);
    expect(apply).toBeEnabled();
    await user.click(apply);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0].integrations.turso.authToken).toBe("tokNEW");
    await waitFor(() => expect(setSecretPassphrase).toHaveBeenCalledWith("tursoAuthToken", "tokNEW", "pw"));
    expect(saveSecretValue).not.toHaveBeenCalled();
  });

  // MA11 — drop the blocked hint under Apply → red.
  it("a blocked Apply states why (visible + as its description); the hint goes once unblocked", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<IntegrationsSection lang="en-US" settings={settingsWith(URL_A, "tok")} onChange={onChange} />);
    // No passphrase record yet, so the hint says the typed passphrase BECOMES the passphrase.
    const hint = t("en-US", "integrationsTursoApplyNeedsNewPassphrase");
    await user.click(lock());
    expect(screen.queryByText(hint)).toBeNull(); // nothing changed yet: not blocked
    await user.type(tokenField(), "NEW");
    const apply = screen.getByRole("button", { name: applyLabel });
    expect(screen.getByText(hint)).toBeVisible();
    expect(apply).toHaveAccessibleDescription(hint);
    await user.keyboard("{Enter}"); // Enter while blocked commits nothing
    expect(onChange).not.toHaveBeenCalled();
    await typePassphrase(user);
    expect(screen.queryByText(hint)).toBeNull();
    expect(apply).not.toHaveAccessibleDescription(hint);
  });

  it("a URL-only change in passphrase mode is not blocked: Apply applies without a passphrase", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<IntegrationsSection lang="en-US" settings={settingsWith(URL_A, "tok")} onChange={onChange} />);
    await user.click(lock());
    await user.type(urlField(), "u");
    const apply = screen.getByRole("button", { name: applyLabel });
    expect(apply).toBeEnabled();
    expect(screen.queryByText(t("en-US", "integrationsTursoApplyNeedsNewPassphrase"))).toBeNull();
    await user.click(apply);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0].integrations.turso).toMatchObject({ databaseUrl: `${URL_A}u`, authToken: "tok" });
    expect(setSecretPassphrase).not.toHaveBeenCalled();
    expect(saveSecretValue).not.toHaveBeenCalled();
  });

  describe("Save & switch", () => {
    let reload: ReturnType<typeof vi.fn>;
    const originalLocation = window.location;
    beforeEach(() => {
      reload = vi.fn();
      Object.defineProperty(window, "location", { configurable: true, value: { ...originalLocation, reload } });
      savePortfolioMode("file");
    });
    afterEach(() => {
      Object.defineProperty(window, "location", { configurable: true, value: originalLocation });
    });

    it("is disabled for a changed token until the passphrase is typed, then seals the new token under it", async () => {
      const user = userEvent.setup();
      function Controlled() {
        const [settings, setSettings] = useState<Settings>(settingsWith(URL_A, "tok"));
        return <IntegrationsSection lang="en-US" settings={settings} onChange={setSettings} />;
      }
      render(<Controlled />);
      await user.click(lock());
      await user.type(tokenField(), "NEW");
      await user.selectOptions(screen.getByLabelText(t("en-US", "portfolioModeLabel")), "turso");
      const switchBtn = screen.getByRole("button", { name: t("en-US", "portfolioModeSwitchConfirm") });
      expect(switchBtn).toBeDisabled();
      expect(switchBtn).toHaveAccessibleDescription(t("en-US", "integrationsTursoApplyNeedsNewPassphrase"));

      await typePassphrase(user);
      expect(switchBtn).toBeEnabled();
      await user.click(switchBtn);
      await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
      expect(setSecretPassphrase).toHaveBeenCalledWith("tursoAuthToken", "tokNEW", "pw");
    });
  });
});

// §548 — with a passphrase-sealed record ALREADY stored, Apply and "Save & switch" must VERIFY the
// typed passphrase opens it before committing or sealing anything; otherwise a mistyped (or
// different) passphrase silently became the new one. The record is sealed for real (PBKDF2 via
// WebCrypto) and `unlockSecret` is the real one — only the RE-seal (`setSecretPassphrase`) is mocked.
//   MV1 — skip the verify in `applyTursoDrafts` → (b) goes red.
//   MV2 — the verify always fails (`=== null` for `!== null`) → (a) goes red.
//   MV4 — drop the verify from `confirmPortfolioModeSwitch` → (d) goes red.
//   MV5 — drop `!passphraseVerifying` from `canApplyTurso` → (a) goes red (double submit).
//   MV6 — the blocked hint always uses the no-record key → (a) goes red.
//   MV7 — refuse EVERY switch while a record exists (guard `isPassphraseLocked(...) || !verify`)
//         → (e) goes red.
//   MV8 — drop `!switchBusy` from `canApplyTurso` → (e) goes red.
//   MV9 — drop `|| passphraseVerifying` from the switch's `disabled` → (f) goes red.
//   MV10 — drop the error reset from `handleTursoTokenChange` → the Enter test goes red.
describe("Passphrase mode with an existing record — Apply and Save & switch verify the CURRENT passphrase", () => {
  const passphraseField = () => screen.getByLabelText(t("en-US", "secretPassphrasePlaceholder"));
  const confirmField = () => screen.getByLabelText(t("en-US", "secretPassphraseConfirm"));
  const wrong = t("en-US", "secretUnlockFailed");
  const typePassphrase = async (user: ReturnType<typeof userEvent.setup>, pass: string) => {
    await user.type(passphraseField(), pass);
    await user.type(confirmField(), pass);
  };
  const storedRecord = () => JSON.stringify(loadSealed("tursoAuthToken"));

  beforeEach(async () => {
    // Real seal: the section reads it at mount (`tokenWrap` starts in "passphrase").
    saveSealed(await sealPassphrase("tursoAuthToken", "tok", "pw"));
  });

  it("(a) the correct current passphrase applies the token and re-seals it; no double submit", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<IntegrationsSection lang="en-US" settings={settingsWith(URL_A, "tok")} onChange={onChange} />);
    await user.type(tokenField(), "NEW");
    const apply = screen.getByRole("button", { name: applyLabel });
    expect(apply).toBeDisabled();
    const hint = t("en-US", "integrationsTursoApplyNeedsPassphrase");
    expect(apply).toHaveAccessibleDescription(hint);
    expect(hint).not.toMatch(/becomes/); // the record case never says it becomes the passphrase

    await typePassphrase(user, "pw");
    await user.click(apply);
    // The verify is in flight (PBKDF2): Apply is disabled and busy, so a second click is a no-op.
    expect(apply).toBeDisabled();
    expect(apply).toHaveAttribute("aria-busy", "true");
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    expect(onChange.mock.calls[0][0].integrations.turso.authToken).toBe("tokNEW");
    await waitFor(() => expect(setSecretPassphrase).toHaveBeenCalledWith("tursoAuthToken", "tokNEW", "pw"));
    expect(screen.queryByText(wrong)).toBeNull();
  });

  it("(b) a wrong passphrase commits nothing, seals nothing, keeps the fields and says why", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<IntegrationsSection lang="en-US" settings={settingsWith(URL_A, "tok")} onChange={onChange} />);
    const before = storedRecord();
    await user.type(tokenField(), "NEW");
    await typePassphrase(user, "nope");
    const apply = screen.getByRole("button", { name: applyLabel });
    await user.click(apply);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(wrong);
    expect(apply).toHaveAccessibleDescription(wrong);
    expect(onChange).not.toHaveBeenCalled();
    expect(setSecretPassphrase).not.toHaveBeenCalled();
    expect(saveSecretValue).not.toHaveBeenCalled();
    expect(storedRecord()).toBe(before);
    expect(tokenField()).toHaveValue("tokNEW");
    expect(passphraseField()).toHaveValue("nope");
    expect(confirmField()).toHaveValue("nope");
    expect(apply).toBeEnabled(); // not stuck busy

    await user.type(passphraseField(), "x"); // editing the passphrase clears the error
    expect(screen.queryByText(wrong)).toBeNull();
    expect(apply).not.toHaveAccessibleDescription(wrong);
  });

  it("Enter in the token field: a wrong passphrase is refused, editing the token clears the error, the right one applies", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<IntegrationsSection lang="en-US" settings={settingsWith(URL_A, "tok")} onChange={onChange} />);
    await user.type(tokenField(), "NEW");
    await typePassphrase(user, "nope");
    await user.click(tokenField());
    await user.keyboard("{Enter}");
    expect(await screen.findByRole("alert")).toHaveTextContent(wrong);
    expect(onChange).not.toHaveBeenCalled();
    expect(setSecretPassphrase).not.toHaveBeenCalled();

    await user.type(tokenField(), "2"); // a new token draft: the old error no longer applies
    expect(screen.queryByText(wrong)).toBeNull();

    await user.clear(passphraseField());
    await user.clear(confirmField());
    await typePassphrase(user, "pw");
    await user.click(tokenField());
    await user.keyboard("{Enter}");
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    expect(onChange.mock.calls[0][0].integrations.turso.authToken).toBe("tokNEW2");
    await waitFor(() => expect(setSecretPassphrase).toHaveBeenCalledWith("tursoAuthToken", "tokNEW2", "pw"));
    expect(screen.queryByText(wrong)).toBeNull();
  });

  describe("Save & switch", () => {
    let reload: ReturnType<typeof vi.fn>;
    const originalLocation = window.location;
    beforeEach(() => {
      reload = vi.fn();
      Object.defineProperty(window, "location", { configurable: true, value: { ...originalLocation, reload } });
      savePortfolioMode("file");
    });
    afterEach(() => {
      Object.defineProperty(window, "location", { configurable: true, value: originalLocation });
    });

    it("(d) a wrong passphrase switches nothing and says why under the switch button", async () => {
      const user = userEvent.setup();
      function Controlled() {
        const [settings, setSettings] = useState<Settings>(settingsWith(URL_A, "tok"));
        return <IntegrationsSection lang="en-US" settings={settings} onChange={setSettings} />;
      }
      render(<Controlled />);
      const before = storedRecord();
      await user.type(tokenField(), "NEW");
      await user.selectOptions(screen.getByLabelText(t("en-US", "portfolioModeLabel")), "turso");
      await typePassphrase(user, "nope");
      const switchBtn = screen.getByRole("button", { name: t("en-US", "portfolioModeSwitchConfirm") });
      await user.click(switchBtn);

      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent(wrong);
      expect(switchBtn).toHaveAccessibleDescription(wrong);
      expect(switchBtn).toBeEnabled(); // busy released
      expect(reload).not.toHaveBeenCalled();
      expect(loadPortfolioMode()).toBe("file");
      expect(localStorage.getItem("aipm-cockpit:settings")).toBeNull();
      expect(setSecretPassphrase).not.toHaveBeenCalled();
      expect(storedRecord()).toBe(before);
      expect(tokenField()).toHaveValue("tokNEW");
    });

    it("(e) the correct current passphrase switches and re-seals under it; Apply is disabled meanwhile", async () => {
      const user = userEvent.setup();
      function Controlled() {
        const [settings, setSettings] = useState<Settings>(settingsWith(URL_A, "tok"));
        return <IntegrationsSection lang="en-US" settings={settings} onChange={setSettings} />;
      }
      render(<Controlled />);
      await user.type(tokenField(), "NEW");
      await user.selectOptions(screen.getByLabelText(t("en-US", "portfolioModeLabel")), "turso");
      await typePassphrase(user, "pw");
      const switchBtn = screen.getByRole("button", { name: t("en-US", "portfolioModeSwitchConfirm") });
      await user.click(switchBtn);
      // The switch's verify is in flight: Apply cannot start a second, parallel verify + seal.
      expect(screen.getByRole("button", { name: applyLabel })).toBeDisabled();

      await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
      expect(setSecretPassphrase).toHaveBeenCalledWith("tursoAuthToken", "tokNEW", "pw");
      expect(loadPortfolioMode()).toBe("turso");
      expect(screen.queryByText(wrong)).toBeNull();
    });

    it("(f) while Apply verifies, Save & switch is disabled", async () => {
      const user = userEvent.setup();
      function Controlled() {
        const [settings, setSettings] = useState<Settings>(settingsWith(URL_A, "tok"));
        return <IntegrationsSection lang="en-US" settings={settings} onChange={setSettings} />;
      }
      render(<Controlled />);
      await user.type(tokenField(), "NEW");
      await user.selectOptions(screen.getByLabelText(t("en-US", "portfolioModeLabel")), "turso");
      await typePassphrase(user, "pw");
      const switchBtn = screen.getByRole("button", { name: t("en-US", "portfolioModeSwitchConfirm") });
      const apply = screen.getByRole("button", { name: applyLabel });
      await user.click(apply);
      expect(apply).toHaveAttribute("aria-busy", "true");
      expect(switchBtn).toBeDisabled();
      // Settle: Apply's verify finishes and commits, releasing both.
      await waitFor(() => expect(setSecretPassphrase).toHaveBeenCalledWith("tursoAuthToken", "tokNEW", "pw"));
      expect(reload).not.toHaveBeenCalled();
    });
  });

  // ★★★ F4 M1 — THE COMMIT AFTER THE AWAIT MUST NOT REVERT A SETTINGS WRITE THAT LANDED DURING IT.
  //   `onChange` is `(s: Settings) => void` — a value, not an updater — and every parent replaces
  //   settings wholesale, so a commit spreading the CLICK-time `settings` silently rolls back
  //   anything written meanwhile. For a keystroke commit that window is 0 ms; here it is the whole
  //   PBKDF2 verify, which the user is actively waiting through with the button busy. `updateTurso`
  //   therefore builds from the LATEST committed settings (`latestSettingsRef`) rather than the
  //   closure's, without touching the prop contract its four parents share.
  //   Mutation MV11: restore `onChange({ ...settings, integrations: { ...integrations, turso: {
  //   ...turso, ...patch } } })` in `updateTurso` → the `layout` assertion is red while the
  //   `authToken` one (the positive control that Apply still applied at all) stays green.
  // ★ `aria-busy` is asserted BEFORE the outside write: without it a test that wrote after the
  //   verify had already resolved would pass no matter what `updateTurso` spreads.
  it("(g) a settings write landing DURING the verify survives the commit", async () => {
    const user = userEvent.setup();
    const commits: Settings[] = [];
    // A handle on the host's setter, filled in an effect — this stands in for any OTHER surface
    // writing settings while this section waits (a background write, another settings pane).
    const elsewhere: { write: (patch: (s: Settings) => Settings) => void } = { write: () => {} };
    function Controlled() {
      const [settings, setSettings] = useState<Settings>(settingsWith(URL_A, "tok"));
      useEffect(() => {
        elsewhere.write = (patch) => setSettings(patch);
      }, []);
      return (
        <IntegrationsSection
          lang="en-US"
          settings={settings}
          onChange={(next) => {
            commits.push(next);
            setSettings(next);
          }}
        />
      );
    }
    render(<Controlled />);
    await user.type(tokenField(), "NEW");
    await typePassphrase(user, "pw");
    const apply = screen.getByRole("button", { name: applyLabel });
    await user.click(apply);
    expect(apply).toHaveAttribute("aria-busy", "true"); // control: the verify really is in flight
    act(() => {
      elsewhere.write((s) => ({ ...s, layout: "classic" }));
    });
    expect(defaultSettings.layout).not.toBe("classic"); // anti-vacuity: the write really changed it

    await waitFor(() => expect(commits).toHaveLength(1));
    expect(commits[0].layout).toBe("classic"); // the concurrent write survived the commit
    expect(commits[0].integrations?.turso?.authToken).toBe("tokNEW"); // …and Apply still applied
    await waitFor(() => expect(setSecretPassphrase).toHaveBeenCalledWith("tursoAuthToken", "tokNEW", "pw"));
  });
});

// Enter in either field applies on Turso storage, exactly when Apply is enabled.
// Mutation MA8: drop the `onKeyDown` on the inputs → red.
describe("Enter applies the Turso drafts on Turso storage", () => {
  it.each([
    ["URL", () => urlField(), "x", { databaseUrl: `${URL_A}x`, authToken: "tok" }],
    ["token", () => tokenField(), "x", { databaseUrl: URL_A, authToken: "tokx" }],
  ] as const)("Enter in the %s field commits both drafts once; Enter while clean does nothing", async (_n, field, typed, expected) => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<IntegrationsSection lang="en-US" settings={settingsWith(URL_A, "tok")} onChange={onChange} />);
    await user.click(field());
    await user.keyboard("{Enter}");
    expect(onChange).not.toHaveBeenCalled(); // clean: Apply disabled, Enter inert
    await user.type(field(), typed);
    expect(onChange).not.toHaveBeenCalled();
    await user.keyboard("{Enter}");
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0].integrations.turso).toMatchObject(expected);
  });

  // MA12 — drop the `isComposing` guard → red. An IME commits its composition with Enter.
  it("an Enter that commits an IME composition does not apply", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<IntegrationsSection lang="en-US" settings={settingsWith(URL_A, "tok")} onChange={onChange} />);
    await user.type(urlField(), "x");
    fireEvent.keyDown(urlField(), { key: "Enter", isComposing: true });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.keyDown(urlField(), { key: "Enter" }); // control: a plain Enter applies
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
