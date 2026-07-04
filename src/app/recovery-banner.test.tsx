import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { RecoveryBanner } from "./recovery-banner";
import { __resetSafeModeCache } from "./safe-mode";
import * as recovery from "./recovery-config";
import { readDiagLog } from "./diagnostics";
import { t } from "./i18n";

describe("RecoveryBanner", () => {
  beforeEach(() => {
    __resetSafeModeCache();
    window.history.replaceState({}, "", "/");
    window.localStorage.clear();
  });
  afterEach(() => {
    __resetSafeModeCache();
    window.history.replaceState({}, "", "/");
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it("renders nothing when not in safe mode", () => {
    const { container } = render(<RecoveryBanner />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the safe-mode banner with an Open recovery link when ?safe=1", () => {
    __resetSafeModeCache();
    window.history.replaceState({}, "", "/?safe=1");
    const { getByText, getByRole } = render(<RecoveryBanner />);
    expect(getByText(/Safe mode/i)).toBeTruthy();
    const link = getByRole("link", { name: /Open recovery/i }) as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("/recovery");
  });

  it("navigates on a successful reset without showing a failure message", () => {
    __resetSafeModeCache();
    window.history.replaceState({}, "", "/?safe=1");
    const q = vi.spyOn(recovery, "quarantineConfig").mockReturnValue({ ok: true, id: "1" });
    const { getByText, queryByText } = render(<RecoveryBanner />);
    fireEvent.click(getByText(/Reset config now/i));
    expect(q).toHaveBeenCalledTimes(1);
    expect(queryByText(t("en-US", "guardRecoveryResetFailed"))).toBeNull();
  });

  it("shows a failure message and logs a diagnostic when the reset fails", () => {
    __resetSafeModeCache();
    window.history.replaceState({}, "", "/?safe=1");
    vi.spyOn(recovery, "quarantineConfig").mockReturnValue({ ok: false, id: null });
    const { getByText } = render(<RecoveryBanner />);
    fireEvent.click(getByText(/Reset config now/i));
    expect(getByText(t("en-US", "guardRecoveryResetFailed"))).toBeTruthy();
    expect(readDiagLog().some((e) => e.code === "recovery.resetFailed")).toBe(true);
  });
});
