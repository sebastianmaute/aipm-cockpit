import { describe, expect, it } from "vitest";
import { disabledViewRedirect } from "./feature-modules";

describe("disabled-view redirect rule (disabledViewRedirect)", () => {
  it("keeps an enabled view", () => {
    expect(disabledViewRedirect("raid", ["raid"], "modern", false)).toBe("raid");
  });
  it("keeps a core view regardless of features", () => {
    expect(disabledViewRedirect("chat", [], "modern", false)).toBe("chat");
  });
  it("redirects a disabled view to dashboard when dashboard is on", () => {
    expect(disabledViewRedirect("raid", ["dashboard"], "modern", false)).toBe("dashboard");
  });
  it("falls back to open-points when dashboard is also off", () => {
    expect(disabledViewRedirect("raid", [], "modern", false)).toBe("open-points");
  });
  it("falls back to chat in classic layout when dashboard is off", () => {
    expect(disabledViewRedirect("raid", [], "classic", false)).toBe("chat");
  });
  it("falls back to chat in a popout when dashboard is off", () => {
    expect(disabledViewRedirect("raid", [], "modern", true)).toBe("chat");
  });
});
