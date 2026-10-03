import { describe, expect, it, vi } from "vitest";
import {
  CHECKOUT_TOKEN_LENGTH,
  checkoutToken,
  judgeServedCheckout,
  runStartsDevServer,
} from "./checkout-token";

describe("judgeServedCheckout (§58 guard decision)", () => {
  it("control: a matching token passes, a different one does not", () => {
    expect(judgeServedCheckout("abc", "abc", true)).toBe("match");
    expect(judgeServedCheckout("def", "abc", true)).toBe("mismatch");
    expect(judgeServedCheckout("def", "abc", false)).toBe("mismatch");
  });

  it("refuses an absent attribute when the run starts its own dev server", () => {
    expect(judgeServedCheckout(null, "abc", true)).toBe("absent-refused");
  });

  it("accepts an absent attribute only when the run targets an external server", () => {
    expect(judgeServedCheckout(null, "abc", false)).toBe("absent-external");
  });
});

describe("runStartsDevServer (mirrors playwright.config.ts webServer)", () => {
  it("is true when PLAYWRIGHT_NO_WEBSERVER is unset or empty", () => {
    expect(runStartsDevServer({})).toBe(true);
    expect(runStartsDevServer({ PLAYWRIGHT_NO_WEBSERVER: "" })).toBe(true);
  });

  it("is false when PLAYWRIGHT_NO_WEBSERVER is set", () => {
    expect(runStartsDevServer({ PLAYWRIGHT_NO_WEBSERVER: "1" })).toBe(false);
  });
});

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
