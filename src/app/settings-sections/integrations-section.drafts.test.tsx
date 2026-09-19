// §548 — the Turso URL/token are DRAFTS committed when focus leaves the credentials group. These pin
// the three ways a draft could still be lost or clobbered, each with a named mutation:
//   R2 — Escape in a `Modal` host (`BackendConfigModal`) closed the dialog with no blur, so the
//        draft never committed. Mutation: delete `blurFocusInside` in `modal.tsx`'s Escape branch.
//   R3 — "Save & switch" reloaded before the device-seal settled, and `writeSettings` blanks the
//        token, so the new token was lost. Mutation: drop the `pendingTokenSeals` wait in
//        `confirmPortfolioModeSwitch` (call `finishPortfolioModeSwitch` straight away).
//   R4 — the render-time reconcile replaced a draft being typed when the STORED value moved
//        underneath it. Mutation: drop the clean-draft guard on the URL (or token) resync.
import "fake-indexeddb/auto";
import { useEffect, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
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
import { saveSecretValue } from "../use-secrets";
import { savePortfolioMode } from "../portfolio-mode";

vi.mock("../use-secrets", async (importActual) => ({
  ...(await importActual<typeof import("../use-secrets")>()),
  saveSecretValue: vi.fn(),
}));

const URL_A = "libsql://a.turso.io";

function settingsWith(databaseUrl: string, authToken: string): Settings {
  return {
    ...defaultSettings,
    integrations: {
      ...defaultIntegrations,
      turso: { ...defaultTursoIntegrations, enabled: true, databaseUrl, authToken },
    },
  };
}

const urlField = () => screen.getByPlaceholderText(t("en-US", "integrationsTursoUrlPlaceholder"));
const tokenField = () => screen.getByPlaceholderText(t("en-US", "integrationsTursoTokenPlaceholder"));

beforeEach(() => {
  vi.mocked(saveSecretValue).mockReset();
  vi.mocked(saveSecretValue).mockResolvedValue(undefined);
  localStorage.clear();
});
afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("R2 — Escape in a Modal host commits the Turso draft", () => {
  beforeEach(() => {
    // jsdom has no rAF; Modal's initial-focus effect queues one.
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { cb(0); return 0; });
    vi.stubGlobal("cancelAnimationFrame", () => {});
  });

  it("BackendConfigModal: typing into the URL then Escape commits it before onClose", async () => {
    const user = userEvent.setup();
    const onChangeSettings = vi.fn();
    const onClose = vi.fn();
    render(
      <BackendConfigModal
        lang="en-US"
        title="Backend"
        settings={settingsWith(URL_A, "tok")}
        onChangeSettings={onChangeSettings}
        onClose={onClose}
        helpConceptId={MODAL_HELP.backendConfig}
      />,
    );
    await user.click(urlField());
    await user.type(urlField(), "q");
    expect(onChangeSettings).not.toHaveBeenCalled(); // still a draft
    await user.keyboard("{Escape}");
    expect(onChangeSettings).toHaveBeenCalledTimes(1);
    expect(onChangeSettings.mock.calls[0][0].integrations.turso.databaseUrl).toBe(`${URL_A}q`);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("BackendConfigModal: typing into the token then Escape commits and seals it", async () => {
    const user = userEvent.setup();
    const onChangeSettings = vi.fn();
    render(
      <BackendConfigModal
        lang="en-US"
        title="Backend"
        settings={settingsWith(URL_A, "tok")}
        onChangeSettings={onChangeSettings}
        onClose={() => {}}
        helpConceptId={MODAL_HELP.backendConfig}
      />,
    );
    await user.click(tokenField());
    await user.type(tokenField(), "9");
    await user.keyboard("{Escape}");
    expect(onChangeSettings.mock.calls[0][0].integrations.turso.authToken).toBe("tok9");
    expect(saveSecretValue).toHaveBeenCalledWith("tursoAuthToken", "tok9", "device");
  });
});

describe("R3 — Save & switch waits for the token seal before reloading", () => {
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
    Object.defineProperty(window, "location", { configurable: true, value: originalLocation });
  });

  function Controlled() {
    const [settings, setSettings] = useState<Settings>(settingsWith(URL_A, "tok"));
    return <IntegrationsSection lang="en-US" settings={settings} onChange={setSettings} />;
  }

  const switchButton = () =>
    screen.getByRole("button", { name: t("en-US", "portfolioModeSwitchConfirm") });

  it("a committed token's pending seal holds the reload until it resolves", async () => {
    const user = userEvent.setup();
    let release: () => void = () => {};
    vi.mocked(saveSecretValue).mockReturnValueOnce(new Promise<void>((r) => { release = r; }));
    render(<Controlled />);

    await user.click(tokenField());
    await user.type(tokenField(), "2");
    await user.click(document.body); // focus leaves the group → commit → seal starts (deferred)
    expect(saveSecretValue).toHaveBeenCalledWith("tursoAuthToken", "tok2", "device");

    await user.selectOptions(screen.getByLabelText(t("en-US", "portfolioModeLabel")), "turso");
    await user.click(switchButton());
    expect(reload).not.toHaveBeenCalled();

    await act(async () => release());
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    const persisted = JSON.parse(localStorage.getItem("aipm-cockpit:settings") ?? "{}");
    expect(persisted.storageConfig?.kind).toBe("turso");
  });

  // The switch button keeps focus where it is (mousedown prevented), so a draft is still a
  // draft when the click lands — the switch folds it in. Mutation: `const base = settings`.
  it("an UNCOMMITTED URL draft is folded into the settings the switch persists", async () => {
    const user = userEvent.setup();
    render(<Controlled />);
    await user.selectOptions(screen.getByLabelText(t("en-US", "portfolioModeLabel")), "turso");
    await user.click(urlField());
    await user.type(urlField(), "x");
    await user.click(switchButton());
    expect(urlField()).toHaveFocus(); // the mousedown did not blur the field
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    const persisted = JSON.parse(localStorage.getItem("aipm-cockpit:settings") ?? "{}");
    expect(persisted.integrations?.turso?.databaseUrl).toBe(`${URL_A}x`);
  });
});

describe("R4 — an outside change to the stored value keeps a draft being edited", () => {
  let setExternal: (s: Settings) => void = () => {};
  function Host() {
    const [settings, setSettings] = useState<Settings>(settingsWith(URL_A, "tok"));
    useEffect(() => { setExternal = setSettings; }, []);
    return <IntegrationsSection lang="en-US" settings={settings} onChange={setSettings} />;
  }

  it("a dirty URL draft survives; the clean token field follows (mutation: URL guard)", async () => {
    const user = userEvent.setup();
    render(<Host />);
    await user.click(urlField());
    await user.type(urlField(), "zz");
    act(() => setExternal(settingsWith("libsql://other.turso.io", "ext-tok")));
    expect(urlField()).toHaveValue(`${URL_A}zz`);
    expect(urlField()).toHaveFocus();
    expect(tokenField()).toHaveValue("ext-tok"); // control: a clean draft resyncs
  });

  it("a dirty token draft survives; the clean URL field follows (mutation: token guard)", async () => {
    const user = userEvent.setup();
    render(<Host />);
    await user.click(tokenField());
    await user.type(tokenField(), "zz");
    act(() => setExternal(settingsWith("libsql://other.turso.io", "ext-tok")));
    expect(tokenField()).toHaveValue("tokzz");
    expect(urlField()).toHaveValue("libsql://other.turso.io"); // control
  });
});
