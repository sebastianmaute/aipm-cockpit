import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearAppConfig, resetAppToCleanSlate } from "./app-reset";
import { beginSealedWrite, SECRETS_KEY } from "./secrets-store";
import { sealDevice } from "./secrets";
import { keptProjectKey, UNLOAD_JOURNAL_PREFIX } from "./unload-journal";
import { writeSettings } from "./use-settings";
import { __resetSettingsReloadSeal } from "./settings-reload-seal";
import { defaultSettings } from "./settings-types";

afterEach(() => {
  __resetSettingsReloadSeal();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("clearAppConfig", () => {
  it("removes every aipm-cockpit:* key but leaves foreign keys untouched", () => {
    localStorage.setItem("aipm-cockpit:settings", "{}");
    localStorage.setItem("aipm-cockpit:projects", "[]");
    localStorage.setItem("aipm-cockpit:secrets", "cipher");
    localStorage.setItem("aipm-cockpit:dashboard-size", "{}");
    localStorage.setItem("aipm-cockpit:digest-state", '{"p1":{}}');
    localStorage.setItem("some-other-app:keep", "x");

    clearAppConfig();

    expect(localStorage.getItem("aipm-cockpit:settings")).toBeNull();
    expect(localStorage.getItem("aipm-cockpit:projects")).toBeNull();
    expect(localStorage.getItem("aipm-cockpit:secrets")).toBeNull();
    expect(localStorage.getItem("aipm-cockpit:dashboard-size")).toBeNull();
    expect(localStorage.getItem("aipm-cockpit:digest-state")).toBeNull();
    // A non-namespaced key from another origin/app is left alone.
    expect(localStorage.getItem("some-other-app:keep")).toBe("x");
  });

  it("§4 removes both unload-journal slots of a project: the ordinary one and the kept one", () => {
    localStorage.setItem(`${UNLOAD_JOURNAL_PREFIX}p1`, "{}");
    localStorage.setItem(`${UNLOAD_JOURNAL_PREFIX}${keptProjectKey("p1")}`, "{}");
    localStorage.setItem(`${UNLOAD_JOURNAL_PREFIX}${keptProjectKey("p1", 123)}`, "{}");
    clearAppConfig();
    expect(localStorage.getItem(`${UNLOAD_JOURNAL_PREFIX}p1`)).toBeNull();
    expect(localStorage.getItem(`${UNLOAD_JOURNAL_PREFIX}${keptProjectKey("p1")}`)).toBeNull();
    expect(localStorage.getItem(`${UNLOAD_JOURNAL_PREFIX}${keptProjectKey("p1", 123)}`)).toBeNull();
  });

  it("deletes the config IndexedDB databases (secrets device key + file handles)", () => {
    const spy = vi.spyOn(indexedDB, "deleteDatabase");
    clearAppConfig();
    expect(spy).toHaveBeenCalledWith("aipm-cockpit-secrets");
    expect(spy).toHaveBeenCalledWith("aipm-cockpit-project-handles");
    // The workspace data store is NEVER deleted (detach-only).
    expect(spy).not.toHaveBeenCalledWith("aipm-cockpit");
  });
});

// The Microsoft sign-in library (MSAL, `cacheLocation: "localStorage"` in `use-ms-auth.ts`) keeps
// its accounts and tokens under its own key names. The shapes below follow the installed
// @azure/msal-browser 5.28.0: `generateAccountKey` / `generateCredentialKey` in
// `dist/cache/BrowserCacheManager.mjs` (`msal.3|…`), `getAccountKeysCacheKey` /
// `getTokenKeysCacheKey` and `VERSION_CACHE_KEY` in `dist/cache/CacheKeys.mjs`, the temporary
// `msal.interaction.status` key in sessionStorage, and msal-common's `generateAppMetadataKey`
// (`appmetadata-<environment>-<clientId>`), which carries no `msal` prefix.
describe("clearAppConfig removes the Microsoft sign-in cache", () => {
  const CLIENT_ID = "11111111-2222-3333-4444-555555555555";
  const HOME = "uid-1.tid-1";
  const ENV = "login.microsoftonline.com";
  const ACCOUNT_KEY = `msal.3|${HOME}|${ENV}|tid-1`;
  const ID_TOKEN_KEY = `msal.3|${HOME}|${ENV}|idtoken|${CLIENT_ID}|tid-1||`;
  const ACCESS_TOKEN_KEY = `msal.3|${HOME}|${ENV}|accesstoken|${CLIENT_ID}|tid-1|user.read openid profile|`;
  const REFRESH_TOKEN_KEY = `msal.3|${HOME}|${ENV}|refreshtoken|${CLIENT_ID}|||`;
  const MSAL_LOCAL_KEYS = [
    ACCOUNT_KEY,
    ID_TOKEN_KEY,
    ACCESS_TOKEN_KEY,
    REFRESH_TOKEN_KEY,
    "msal.3.account.keys",
    `msal.3.token.keys.${CLIENT_ID}`,
    "msal.version",
    `msal.${CLIENT_ID}.active-account-filters`,
  ];

  function seedMsalCache(): void {
    localStorage.setItem(ACCOUNT_KEY, '{"id":"x","nonce":"n","data":"cipher"}');
    localStorage.setItem(ID_TOKEN_KEY, '{"id":"x","nonce":"n","data":"cipher"}');
    localStorage.setItem(ACCESS_TOKEN_KEY, '{"id":"x","nonce":"n","data":"cipher"}');
    localStorage.setItem(REFRESH_TOKEN_KEY, '{"id":"x","nonce":"n","data":"cipher"}');
    localStorage.setItem("msal.3.account.keys", JSON.stringify([ACCOUNT_KEY]));
    localStorage.setItem(
      `msal.3.token.keys.${CLIENT_ID}`,
      JSON.stringify({ idToken: [ID_TOKEN_KEY], accessToken: [ACCESS_TOKEN_KEY], refreshToken: [REFRESH_TOKEN_KEY] }),
    );
    localStorage.setItem("msal.version", "5.28.0");
    localStorage.setItem(`msal.${CLIENT_ID}.active-account-filters`, "{}");
    sessionStorage.setItem("msal.interaction.status", CLIENT_ID);
  }

  afterEach(() => {
    sessionStorage.clear();
  });

  it("leaves no MSAL account, token or bookkeeping entry in localStorage or sessionStorage", () => {
    seedMsalCache();
    clearAppConfig();
    for (const key of MSAL_LOCAL_KEYS) expect(localStorage.getItem(key)).toBeNull();
    expect(sessionStorage.getItem("msal.interaction.status")).toBeNull();
  });

  it("also removes the unprefixed entries keyed by the configured client id", () => {
    const appMetadataKey = `appmetadata-${ENV}-${CLIENT_ID}`;
    localStorage.setItem(
      "aipm-cockpit:settings",
      JSON.stringify({ integrations: { m365: { enabled: true, clientId: CLIENT_ID } } }),
    );
    localStorage.setItem(appMetadataKey, "{}");
    clearAppConfig();
    expect(localStorage.getItem(appMetadataKey)).toBeNull();
  });

  it("works with no settings at all, as on the recovery page", () => {
    seedMsalCache();
    expect(localStorage.getItem("aipm-cockpit:settings")).toBeNull();
    clearAppConfig();
    for (const key of MSAL_LOCAL_KEYS) expect(localStorage.getItem(key)).toBeNull();
  });

  it("keeps keys that belong to other code, including ones that merely mention msal", () => {
    seedMsalCache();
    localStorage.setItem("some-other-app:keep", "x");
    localStorage.setItem("my-msal-notes", "x");
    localStorage.setItem("notmsal.thing", "x");
    sessionStorage.setItem("other-app:session", "x");
    clearAppConfig();
    expect(localStorage.getItem("some-other-app:keep")).toBe("x");
    expect(localStorage.getItem("my-msal-notes")).toBe("x");
    expect(localStorage.getItem("notmsal.thing")).toBe("x");
    expect(sessionStorage.getItem("other-app:session")).toBe("x");
  });

  it("ignores a client id that is not a GUID, so a bad setting cannot widen the sweep", () => {
    localStorage.setItem(
      "aipm-cockpit:settings",
      JSON.stringify({ integrations: { m365: { enabled: true, clientId: "a" } } }),
    );
    localStorage.setItem("keep-a-key", "x");
    clearAppConfig();
    expect(localStorage.getItem("keep-a-key")).toBe("x");
  });

  it("opens no window and navigates nowhere", () => {
    seedMsalCache();
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.reject(new Error("no network")));
    clearAppConfig();
    expect(open).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// §609 — `clearAppConfig` removes the secrets key directly (not via `removeSealed`), and the
// reload that follows does not stop a WebCrypto continuation already queued, so it must also
// cancel every seal in flight.
describe("clearAppConfig vs a seal in flight (§609)", () => {
  it("a seal that began before the reset never writes the secrets key back", async () => {
    const sealed = await sealDevice("anthropicApiKey", "sk-1");
    const commit = beginSealedWrite("anthropicApiKey");
    clearAppConfig();
    expect(commit(sealed)).toBe(false);
    expect(localStorage.getItem(SECRETS_KEY)).toBeNull();
  });
});

describe("resetAppToCleanSlate", () => {
  it("clears config then invokes the injected reload exactly once", () => {
    localStorage.setItem("aipm-cockpit:settings", "{}");
    const reload = vi.fn();
    resetAppToCleanSlate(reload);
    expect(localStorage.getItem("aipm-cockpit:settings")).toBeNull();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  // §740 — the same race as the portfolio switch: a persist-effect write landing between the
  // clear and the reload would put the old settings back.
  it("a stale settings write before the reload cannot restore the cleared settings (§740)", () => {
    localStorage.setItem("aipm-cockpit:settings", "{}");
    resetAppToCleanSlate(vi.fn());
    writeSettings(defaultSettings);
    expect(localStorage.getItem("aipm-cockpit:settings")).toBeNull();
  });
});
