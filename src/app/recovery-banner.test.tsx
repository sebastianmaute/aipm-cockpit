import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { RecoveryBanner } from "./recovery-banner";
import { __resetSafeModeCache } from "./safe-mode";

describe("RecoveryBanner", () => {
  beforeEach(() => {
    __resetSafeModeCache();
    window.history.replaceState({}, "", "/");
  });
  afterEach(() => {
    __resetSafeModeCache();
    window.history.replaceState({}, "", "/");
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
});
