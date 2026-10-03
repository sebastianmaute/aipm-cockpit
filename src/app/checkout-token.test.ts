import { describe, expect, it, vi } from "vitest";
import { CHECKOUT_TOKEN_LENGTH, checkoutToken } from "./checkout-token";

describe("checkoutToken (§58)", () => {
  it("returns the same token for the same directory", () => {
    const a = checkoutToken("development", () => "/work/aipm-cockpit");
    const b = checkoutToken("development", () => "/work/aipm-cockpit");
    expect(a).toBe(b);
  });

  it("returns different tokens for different checkouts", () => {
    const main = checkoutToken("development", () => "/work/aipm-cockpit");
    const sibling = checkoutToken("development", () => "/work/aipm-cockpit-2");
    expect(main).not.toBe(sibling);
  });

  it("is a short lower-case hex string that does not contain the path", () => {
    const token = checkoutToken("development", () => "/work/aipm-cockpit");
    expect(token).toMatch(new RegExp(`^[0-9a-f]{${CHECKOUT_TOKEN_LENGTH}}$`));
    expect(token).not.toContain("aipm");
  });

  it("returns undefined in production without reading the directory", () => {
    const getDir = vi.fn(() => "/work/aipm-cockpit");
    expect(checkoutToken("production", getDir)).toBeUndefined();
    expect(getDir).not.toHaveBeenCalled();
  });

  it("emits a token outside production, including when NODE_ENV is unset", () => {
    expect(checkoutToken("test", () => "/work/aipm-cockpit")).toBeDefined();
    expect(checkoutToken(undefined, () => "/work/aipm-cockpit")).toBeDefined();
  });

  it("ignores drive-letter and path case on Windows only", () => {
    const upper = checkoutToken("development", () => "C:\\Projects\\Aipm", "win32");
    const lower = checkoutToken("development", () => "c:\\projects\\aipm", "win32");
    expect(upper).toBe(lower);
    const posixUpper = checkoutToken("development", () => "/Projects/Aipm", "linux");
    const posixLower = checkoutToken("development", () => "/projects/aipm", "linux");
    expect(posixUpper).not.toBe(posixLower);
  });
});
