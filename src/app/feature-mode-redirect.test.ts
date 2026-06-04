import { describe, expect, it } from "vitest";
import { isViewEnabled, isModuleEnabled, type FeatureModuleId } from "./feature-modules";
import type { AppView } from "./nav-config";

function redirectTarget(
  active: AppView,
  features: FeatureModuleId[],
  layout: "modern" | "classic" = "modern",
  isPopout = false,
): AppView {
  if (isViewEnabled(active, features)) return active;
  const fallback = (isPopout || layout === "classic") ? "chat" : "open-points";
  return isModuleEnabled("dashboard", features) ? "dashboard" : fallback;
}

describe("disabled-view redirect rule", () => {
  it("keeps an enabled view", () => {
    expect(redirectTarget("raid", ["raid"])).toBe("raid");
  });
  it("redirects a disabled view to dashboard when dashboard is on", () => {
    expect(redirectTarget("raid", ["dashboard"])).toBe("dashboard");
  });
  it("falls back to open-points when dashboard is also off", () => {
    expect(redirectTarget("raid", [])).toBe("open-points");
  });
  it("falls back to chat in classic layout when dashboard is off", () => {
    expect(redirectTarget("raid", [], "classic")).toBe("chat");
  });
  it("falls back to chat in a popout when dashboard is off", () => {
    expect(redirectTarget("raid", [], "modern", true)).toBe("chat");
  });
});
