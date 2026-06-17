import { describe, it, expect, afterEach } from "vitest";
import { writeSettings, SETTINGS_KEY } from "./use-settings";
import { defaultSettings } from "./settings-types";

afterEach(() => localStorage.clear());

describe("writeSettings secret blanking", () => {
  it("never persists apiKey or turso authToken into lop-app:settings", () => {
    writeSettings({
      ...defaultSettings,
      ai: { ...defaultSettings.ai, apiKey: "sk-secret" },
      integrations: {
        ...defaultSettings.integrations,
        turso: { enabled: true, databaseUrl: "libsql://x", authToken: "tok-secret" },
      },
    });
    const persisted = JSON.parse(localStorage.getItem(SETTINGS_KEY)!);
    expect(persisted.ai.apiKey).toBe("");
    expect(persisted.integrations.turso.authToken ?? "").toBe("");
    expect(persisted.integrations.turso.databaseUrl).toBe("libsql://x");
  });
});
