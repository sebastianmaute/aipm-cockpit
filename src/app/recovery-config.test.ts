import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CONFIG_KEYS,
  quarantineConfig,
  restoreConfig,
  listBackups,
  exportConfig,
  readPersistedLang,
} from "./recovery-config";
import { SETTINGS_KEY } from "./use-settings";
import { MODE_KEY, CURRENT_TURSO_PROJECT_KEY } from "./portfolio-mode";
import { SECRETS_KEY } from "./secrets-store";
import { SECRET_IDS, SECRET_SETTINGS_PATHS } from "./secrets";

describe("recovery-config", () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it("CONFIG_KEYS matches the real config key constants (drift guard)", () => {
    expect(CONFIG_KEYS).toEqual([SETTINGS_KEY, MODE_KEY, CURRENT_TURSO_PROJECT_KEY]);
  });

  it("CONFIG_KEYS never includes the encrypted secrets store (recovery/export exclusion)", () => {
    // The secrets ciphertext must stay OUT of recovery backups and config
    // export — it is device-key-wrapped and worthless (or a leak) elsewhere.
    expect(CONFIG_KEYS as readonly string[]).not.toContain(SECRETS_KEY);
  });

  it("quarantine copies each present key to a backup key, then removes the live key", () => {
    window.localStorage.setItem(SETTINGS_KEY, '{"a":1}');
    window.localStorage.setItem(MODE_KEY, "turso");
    const { ok, id } = quarantineConfig();
    expect(ok).toBe(true);
    expect(id).toBeTruthy();
    expect(window.localStorage.getItem(SETTINGS_KEY)).toBeNull();
    expect(window.localStorage.getItem(MODE_KEY)).toBeNull();
    expect(window.localStorage.getItem(`aipm-cockpit:recovery-backup:${id}:${SETTINGS_KEY}`)).toBe('{"a":1}');
    expect(window.localStorage.getItem(`aipm-cockpit:recovery-backup:${id}:${MODE_KEY}`)).toBe("turso");
  });

  it("restore writes the backed-up values back to the live keys", () => {
    window.localStorage.setItem(SETTINGS_KEY, '{"a":1}');
    window.localStorage.setItem(MODE_KEY, "turso");
    const { id } = quarantineConfig();
    expect(restoreConfig(id!)).toBe(true);
    expect(window.localStorage.getItem(SETTINGS_KEY)).toBe('{"a":1}');
    expect(window.localStorage.getItem(MODE_KEY)).toBe("turso");
  });

  it("restore returns false for an unknown backup id", () => {
    expect(restoreConfig("nope")).toBe(false);
  });

  it("listBackups returns entries newest-first and survives a corrupt index", () => {
    window.localStorage.setItem(SETTINGS_KEY, "{}");
    const a = quarantineConfig().id!;
    window.localStorage.setItem(SETTINGS_KEY, "{}");
    const b = quarantineConfig().id!;
    const ids = listBackups().map((x) => x.id);
    expect(ids[0]).toBe(b);
    expect(ids).toContain(a);
    window.localStorage.setItem("aipm-cockpit:recovery-backups", "{not json");
    expect(listBackups()).toEqual([]);
  });

  it("exportConfig emits the live config keys with secrets redacted", () => {
    window.localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({ ai: { apiKey: "ASECRET" }, integrations: { turso: { authToken: "SECRET" } }, jira: { apiToken: "JSECRET" } }),
    );
    const out = JSON.parse(exportConfig());
    expect(out[SETTINGS_KEY].integrations.turso.authToken).toBe("***REDACTED***");
    expect(out[SETTINGS_KEY].jira.apiToken).toBe("***REDACTED***");
    expect(out[SETTINGS_KEY].ai.apiKey).toBe("***REDACTED***");
  });

  it("exportConfig redacts EVERY sealed secret, not the three a hardcoded list named", () => {
    // The fixture spells all five paths by hand, so a wrong path in
    // SECRET_SETTINGS_PATHS cannot hide: the walk below would read `undefined`
    // from it while the real field stayed in the export.
    window.localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({
        ai: { apiKey: "anthropic-value" },
        integrations: { turso: { authToken: "turso-value" } },
        jira: { apiToken: "jira-value" },
        timelog: { apiToken: "timelog-value" },
        dictation: { sttApiKey: "stt-value" },
      }),
    );
    const settings = JSON.parse(exportConfig())[SETTINGS_KEY];
    expect(SECRET_IDS.length).toBeGreaterThanOrEqual(5); // anti-vacuity: the loop must run
    // Collect rather than assert per-iteration: a bare expect inside the loop
    // stops at the first offender, and "which secrets leak" is the whole answer.
    const leaked = SECRET_IDS.filter((id) => {
      const leaf = SECRET_SETTINGS_PATHS[id].reduce<unknown>(
        (node, key) => (node as Record<string, unknown> | undefined)?.[key],
        settings,
      );
      return leaf !== "***REDACTED***";
    });
    expect(leaked).toEqual([]);
  });

  it("exportConfig leaves the blank fields writeSettings already wrote alone", () => {
    // The normal case: writeSettings blanked all five, so the export must carry
    // "" — turning an empty field into ***REDACTED*** would tell a reader a
    // secret was present when none was.
    window.localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({ ai: { apiKey: "" }, jira: { apiToken: "" }, language: "de" }),
    );
    const settings = JSON.parse(exportConfig())[SETTINGS_KEY];
    expect(settings.ai.apiKey).toBe("");
    expect(settings.jira.apiToken).toBe("");
    expect(settings.language).toBe("de"); // non-secret keys survive untouched
  });

  it("exportConfig does not invent branches for integrations a user never configured", () => {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ai: { apiKey: "x" } }));
    const settings = JSON.parse(exportConfig())[SETTINGS_KEY];
    expect(settings.ai.apiKey).toBe("***REDACTED***");
    expect(settings.jira).toBeUndefined();
    expect(settings.timelog).toBeUndefined();
    expect(settings.dictation).toBeUndefined();
    expect(settings.integrations).toBeUndefined();
  });

  it("exportConfig returns the raw string when the settings blob is not JSON", () => {
    window.localStorage.setItem(SETTINGS_KEY, "{not json");
    expect(JSON.parse(exportConfig())[SETTINGS_KEY]).toBe("{not json");
  });

  it("every sealed SecretId has a settings path, so a sixth secret cannot slip past the backstop", () => {
    expect(SECRET_IDS.length).toBeGreaterThanOrEqual(5); // anti-vacuity
    for (const id of SECRET_IDS) {
      expect(SECRET_SETTINGS_PATHS[id], `no settings path mapped for "${id}"`).toBeTruthy();
    }
    // And no entry for an id that no longer exists — a stale path is dead code
    // that reads as coverage.
    expect(Object.keys(SECRET_SETTINGS_PATHS).sort()).toEqual([...SECRET_IDS].sort());
  });

  it("readPersistedLang returns a valid Lang, defaulting to en-US", () => {
    expect(readPersistedLang()).toBe("en-US");
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify({ language: "de" }));
    expect(readPersistedLang()).toBe("de");
  });

  it("does not throw when localStorage is unavailable", () => {
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("disabled");
    });
    expect(() => quarantineConfig()).not.toThrow();
    spy.mockRestore();
  });

  it("a mid-quarantine failure still leaves already-moved keys restorable via the index", () => {
    window.localStorage.setItem(SETTINGS_KEY, '{"a":1}');
    window.localStorage.setItem(MODE_KEY, "turso");
    // Throw when the SECOND key (MODE_KEY) is copied to its backup — after the
    // first key (SETTINGS_KEY) has already been copied, indexed, and removed.
    const realSet = Storage.prototype.setItem;
    const spy = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(function (this: Storage, k: string, v: string) {
        if (k.startsWith("aipm-cockpit:recovery-backup:") && k.endsWith(`:${MODE_KEY}`)) {
          throw new Error("quota");
        }
        return realSet.call(this, k, v);
      });

    const { ok } = quarantineConfig();
    expect(ok).toBe(false); // failed partway through
    spy.mockRestore();

    // The first key was indexed BEFORE its live key was removed, so it is
    // reachable + restorable despite the mid-loop failure (no orphan).
    const backups = listBackups();
    expect(backups).toHaveLength(1);
    expect(backups[0].keys).toEqual([SETTINGS_KEY]);
    expect(window.localStorage.getItem(SETTINGS_KEY)).toBeNull(); // live key was moved
    expect(restoreConfig(backups[0].id)).toBe(true);
    expect(window.localStorage.getItem(SETTINGS_KEY)).toBe('{"a":1}'); // recovered

    // The second key never got moved — its live value is untouched.
    expect(window.localStorage.getItem(MODE_KEY)).toBe("turso");
  });
});
