import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { RecoveryPanel } from "./recovery-panel";
import * as recovery from "./recovery-config";
import { SETTINGS_KEY, writeSettings } from "./use-settings";
import { SECRETS_KEY } from "./secrets-store";
import { defaultSettings, type Settings } from "./settings-types";
import { readDiagLog } from "./diagnostics";
import { t } from "./i18n";

describe("RecoveryPanel", () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it("shows the current backend kind and never reveals the token", () => {
    window.localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({ storageConfig: { kind: "turso" }, integrations: { turso: { authToken: "SECRET" } } }),
    );
    const { getByText, queryByText } = render(<RecoveryPanel />);
    expect(getByText("turso")).toBeTruthy();
    expect(queryByText(/SECRET/)).toBeNull();
  });

  it("Reset button calls quarantineConfig", () => {
    const q = vi.spyOn(recovery, "quarantineConfig").mockReturnValue({ ok: true, id: "1" });
    const { getByText } = render(<RecoveryPanel />);
    fireEvent.click(getByText(/Reset to clean config/i));
    expect(q).toHaveBeenCalledTimes(1);
  });

  it("shows a failure message and logs a diagnostic when the reset fails", () => {
    vi.spyOn(recovery, "quarantineConfig").mockReturnValue({ ok: false, id: null });
    const { getByText, queryByText } = render(<RecoveryPanel />);
    fireEvent.click(getByText(/Reset to clean config/i));
    expect(getByText(t("en-US", "guardRecoveryResetFailed"))).toBeTruthy();
    expect(queryByText(t("en-US", "recoveryResetDone"))).toBeNull();
    expect(readDiagLog().some((e) => e.code === "recovery.resetFailed")).toBe(true);
  });

  it("lists backups for restore", () => {
    vi.spyOn(recovery, "listBackups").mockReturnValue([
      { id: "111", at: "2026-06-13T00:00:00.000Z", keys: [SETTINGS_KEY] },
    ]);
    const restore = vi.spyOn(recovery, "restoreConfig").mockReturnValue(true);
    const { getByText } = render(<RecoveryPanel />);
    fireEvent.click(getByText(/Restore last config/i));
    expect(restore).toHaveBeenCalledWith("111");
  });

  it("shows a failure message and logs a diagnostic when the restore fails", () => {
    vi.spyOn(recovery, "listBackups").mockReturnValue([
      { id: "111", at: "2026-06-13T00:00:00.000Z", keys: [SETTINGS_KEY] },
    ]);
    vi.spyOn(recovery, "restoreConfig").mockReturnValue(false);
    const { getByText, queryByText } = render(<RecoveryPanel />);
    fireEvent.click(getByText(/Restore last config/i));
    expect(getByText(t("en-US", "guardRecoveryRestoreFailed"))).toBeTruthy();
    expect(queryByText(t("en-US", "recoveryRestoreDone"))).toBeNull();
    expect(readDiagLog().some((e) => e.code === "recovery.restoreFailed")).toBe(true);
  });

  it("Download triggers an export", () => {
    const exp = vi.spyOn(recovery, "exportConfig").mockReturnValue("{}");
    URL.createObjectURL = vi.fn(() => "blob:x");
    URL.revokeObjectURL = vi.fn();
    const { getByText } = render(<RecoveryPanel />);
    fireEvent.click(getByText(/Download config/i));
    expect(exp).toHaveBeenCalledTimes(1);
  });

  it("shows the storage-unavailable notice and disables actions when localStorage is broken", () => {
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("disabled");
    });
    const { getByText } = render(<RecoveryPanel />);
    expect(getByText(/Storage is unavailable/i)).toBeTruthy();
    const reset = getByText(/Reset to clean config/i).closest("button") as HTMLButtonElement;
    expect(reset.disabled).toBe(true);
    spy.mockRestore();
  });
});

// The settings key never holds the Turso token: writeSettings blanks it, and
// the sealed ciphertext lives in SECRETS_KEY. "Turso configured" must read
// that store (presence only, never decrypting) or it says No for every user.
describe("RecoveryPanel — Turso configured", () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => window.localStorage.clear());

  const persistTurso = (databaseUrl: string) =>
    writeSettings({
      ...defaultSettings,
      integrations: {
        ...defaultSettings.integrations,
        turso: { enabled: true, databaseUrl, authToken: "tok-secret" },
      },
    } as Settings);
  const sealedTursoToken = {
    v: 1,
    id: "tursoAuthToken",
    wrap: "device",
    alg: "AES-GCM",
    iv: "AAAAAAAAAAAAAAAA",
    ciphertext: "BBBBBBBBBBBB",
  };
  const tursoConfiguredCell = (getByText: (s: string) => HTMLElement) =>
    getByText(t("en-US", "recoveryTursoConfigured")).nextElementSibling?.textContent;

  it("reads Yes when the database URL is set and a sealed Turso token exists", () => {
    persistTurso("libsql://x.turso.io");
    window.localStorage.setItem(SECRETS_KEY, JSON.stringify({ tursoAuthToken: sealedTursoToken }));
    // Precondition: the settings key really carries no token.
    expect(JSON.parse(window.localStorage.getItem(SETTINGS_KEY)!).integrations.turso.authToken ?? "").toBe("");
    const { getByText } = render(<RecoveryPanel />);
    expect(tursoConfiguredCell(getByText)).toBe(t("en-US", "recoveryYes"));
  });

  it("reads No when the database URL is set but no sealed Turso token exists", () => {
    persistTurso("libsql://x.turso.io");
    const { getByText } = render(<RecoveryPanel />);
    expect(tursoConfiguredCell(getByText)).toBe(t("en-US", "recoveryNo"));
  });

  it("reads No when a sealed Turso token exists but the database URL is blank", () => {
    persistTurso("");
    window.localStorage.setItem(SECRETS_KEY, JSON.stringify({ tursoAuthToken: sealedTursoToken }));
    const { getByText } = render(<RecoveryPanel />);
    expect(tursoConfiguredCell(getByText)).toBe(t("en-US", "recoveryNo"));
  });
});
