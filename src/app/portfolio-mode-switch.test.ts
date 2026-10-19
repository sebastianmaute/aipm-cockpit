// §749 — the shared portfolio switch (Settings' "Save & switch", the setup wizard's Finish) reloads, which
// blanks the Claude key (`writeSettings`); a key typed under its passphrase lock and not saved under it would be
// lost, so the switch refuses — nothing written, no reload — until a seal covers it.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const writeSettings = vi.hoisted(() => vi.fn());
vi.mock("./use-settings", async (importOriginal) => ({ ...(await importOriginal<typeof import("./use-settings")>()), writeSettings }));
vi.mock("./settings-reload-seal", () => ({ sealSettingsUntilReload: vi.fn() }));

import { aiKeyHeldUnsealed, commitPortfolioModeSwitch, reloadRefusalText, secretLostToReload } from "./portfolio-mode-switch";
import { markUnsealedPassphraseSecret, markUnsealedPassphraseToken, noteSecretSealed } from "./turso-token-marker";
import { trackSecretSeal } from "./turso-token-seals";
import { t } from "./i18n";
import { defaultSettings, type Settings } from "./settings-types";

const KEY = "sk-ant-api03-fictional00000000";
const withKey: Settings = { ...defaultSettings, ai: { ...defaultSettings.ai, apiKey: KEY } };
const reload = vi.fn();

beforeEach(() => {
  writeSettings.mockClear();
  reload.mockClear();
  Object.defineProperty(window, "location", { configurable: true, value: { ...window.location, reload } });
});
afterEach(() => { localStorage.clear(); });

describe("commitPortfolioModeSwitch — the Claude key under its passphrase lock (§749)", () => {
  // KILLED BY: deleting the `aiKeyHeldUnsealed(base)` refusal.
  it("refuses while the key is held unsealed: nothing written, no reload", async () => {
    markUnsealedPassphraseSecret("anthropicApiKey", KEY);
    expect(aiKeyHeldUnsealed(withKey)).toBe(true);
    await expect(commitPortfolioModeSwitch(withKey, "file")).resolves.toBe(false);
    expect(writeSettings).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });

  it("the positive control: once a seal covers the key, the switch writes and reloads", async () => {
    markUnsealedPassphraseSecret("anthropicApiKey", KEY);
    noteSecretSealed("anthropicApiKey", KEY);
    await expect(commitPortfolioModeSwitch(withKey, "file")).resolves.toBe(true);
    expect(writeSettings).toHaveBeenCalledTimes(1);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("is keyed by value: a key the settings no longer hold refuses nothing", async () => {
    markUnsealedPassphraseSecret("anthropicApiKey", "sk-ant-api03-older00000000000");
    await expect(commitPortfolioModeSwitch(withKey, "file")).resolves.toBe(true);
  });
});

// §749 — the gate the other reload paths share: which secret a reload now would lose, after the seals in flight.
describe("secretLostToReload (§749)", () => {
  const withToken: Settings = { ...withKey, integrations: { ...defaultSettings.integrations, turso: { enabled: true, databaseUrl: "libsql://x", authToken: "tokM" } } } as Settings;

  it("names the Turso token, then the Claude key, and nothing when neither is held", async () => {
    await expect(secretLostToReload(() => withToken)).resolves.toBeNull();
    markUnsealedPassphraseSecret("anthropicApiKey", KEY);
    await expect(secretLostToReload(() => withToken)).resolves.toBe("aiKey");
    markUnsealedPassphraseToken("tokM");
    await expect(secretLostToReload(() => withToken)).resolves.toBe("tursoToken");
  });

  it("waits for a seal in flight, and reads the settings after it", async () => {
    markUnsealedPassphraseSecret("anthropicApiKey", KEY);
    let land: () => void = () => {};
    trackSecretSeal(new Promise<void>((r) => { land = r; }).then(() => noteSecretSealed("anthropicApiKey", KEY)), "anthropicApiKey");
    const answer = secretLostToReload(() => withKey);
    land();
    await expect(answer).resolves.toBeNull();
  });

  it("says which secret and how to save it", () => {
    expect(reloadRefusalText("en-US", "aiKey")).toBe(t("en-US", "aiKeyNeedsPassphraseSave", t("en-US", "secretPassphraseSave")));
    expect(reloadRefusalText("en-US", "tursoToken")).toBe(t("en-US", "reloadTursoTokenNeedsPassphrase", t("en-US", "secretPassphraseSave")));
  });
});
