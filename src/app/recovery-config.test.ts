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

describe("recovery-config", () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it("CONFIG_KEYS matches the real config key constants (drift guard)", () => {
    expect(CONFIG_KEYS).toEqual([SETTINGS_KEY, MODE_KEY, CURRENT_TURSO_PROJECT_KEY]);
  });

  it("quarantine copies each present key to a backup key, then removes the live key", () => {
    window.localStorage.setItem(SETTINGS_KEY, '{"a":1}');
    window.localStorage.setItem(MODE_KEY, "turso");
    const { ok, id } = quarantineConfig();
    expect(ok).toBe(true);
    expect(id).toBeTruthy();
    expect(window.localStorage.getItem(SETTINGS_KEY)).toBeNull();
    expect(window.localStorage.getItem(MODE_KEY)).toBeNull();
    expect(window.localStorage.getItem(`lop-app:recovery-backup:${id}:${SETTINGS_KEY}`)).toBe('{"a":1}');
    expect(window.localStorage.getItem(`lop-app:recovery-backup:${id}:${MODE_KEY}`)).toBe("turso");
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
    window.localStorage.setItem("lop-app:recovery-backups", "{not json");
    expect(listBackups()).toEqual([]);
  });

  it("exportConfig emits the live config keys with secrets redacted", () => {
    window.localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({ integrations: { turso: { authToken: "SECRET" } }, jira: { token: "JSECRET" } }),
    );
    const out = JSON.parse(exportConfig());
    expect(out[SETTINGS_KEY].integrations.turso.authToken).toBe("***REDACTED***");
    expect(out[SETTINGS_KEY].jira.token).toBe("***REDACTED***");
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
});
