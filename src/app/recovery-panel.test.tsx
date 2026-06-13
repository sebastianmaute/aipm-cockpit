import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { RecoveryPanel } from "./recovery-panel";
import * as recovery from "./recovery-config";
import { SETTINGS_KEY } from "./use-settings";

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

  it("lists backups for restore", () => {
    vi.spyOn(recovery, "listBackups").mockReturnValue([
      { id: "111", at: "2026-06-13T00:00:00.000Z", keys: [SETTINGS_KEY] },
    ]);
    const restore = vi.spyOn(recovery, "restoreConfig").mockReturnValue(true);
    const { getByText } = render(<RecoveryPanel />);
    fireEvent.click(getByText(/Restore last config/i));
    expect(restore).toHaveBeenCalledWith("111");
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
