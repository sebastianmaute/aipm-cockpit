import { describe, expect, it, vi } from "vitest";
import {
  BOOT_NONCE_ENV,
  CHECKOUT_TOKEN_LENGTH,
  bootNonce,
  checkoutToken,
  judgeBootNonce,
  judgeServedCheckout,
  mintBootNonce,
  reuseDevServer,
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

describe("judgeBootNonce (§58 (b) guard decision)", () => {
  it("passes only the nonce this run minted", () => {
    expect(judgeBootNonce("n-1", "n-1", true)).toBe("match");
    expect(judgeBootNonce("n-0", "n-1", true)).toBe("mismatch");
  });

  it("refuses a server with no nonce when the run starts its own server", () => {
    expect(judgeBootNonce(null, "n-1", true)).toBe("absent-refused");
  });

  it("refuses rather than skips when the run has no nonce to compare", () => {
    expect(judgeBootNonce("n-1", undefined, true)).toBe("unminted");
    expect(judgeBootNonce(null, "", true)).toBe("unminted");
  });

  it("does not check an external run, which boots no server", () => {
    expect(judgeBootNonce(null, undefined, false)).toBe("external");
    expect(judgeBootNonce("n-0", "n-1", false)).toBe("external");
  });
});

describe("bootNonce (what RootLayout stamps)", () => {
  it("is the serving process's E2E_BOOT_NONCE outside production", () => {
    expect(bootNonce("development", { [BOOT_NONCE_ENV]: "n-1" })).toBe("n-1");
    expect(bootNonce(undefined, { [BOOT_NONCE_ENV]: "n-1" })).toBe("n-1");
  });

  it("is absent in production and when the server was not booted with one", () => {
    expect(bootNonce("production", { [BOOT_NONCE_ENV]: "n-1" })).toBeUndefined();
    expect(bootNonce("development", {})).toBeUndefined();
    expect(bootNonce("development", { [BOOT_NONCE_ENV]: "" })).toBeUndefined();
  });
});

describe("mintBootNonce (playwright.config.ts, once per run)", () => {
  it("mints a random nonce into the env when none is set", () => {
    const a: Record<string, string | undefined> = {};
    const b: Record<string, string | undefined> = {};
    const na = mintBootNonce(a);
    expect(a[BOOT_NONCE_ENV]).toBe(na);
    expect(mintBootNonce(b)).not.toBe(na);
  });

  it("keeps a nonce already in the env, so every worker of a run reads the same one", () => {
    const env: Record<string, string | undefined> = { [BOOT_NONCE_ENV]: "set-by-hand" };
    expect(mintBootNonce(env)).toBe("set-by-hand");
    expect(mintBootNonce(env)).toBe("set-by-hand");
  });
});

describe("reuseDevServer (playwright.config.ts reuseExistingServer)", () => {
  it("is off by default, so a run starts its own server", () => {
    expect(reuseDevServer({})).toBe(false);
  });

  it("is on only for PLAYWRIGHT_REUSE_SERVER=1 outside CI", () => {
    expect(reuseDevServer({ PLAYWRIGHT_REUSE_SERVER: "1" })).toBe(true);
    expect(reuseDevServer({ PLAYWRIGHT_REUSE_SERVER: "true" })).toBe(false);
    expect(reuseDevServer({ PLAYWRIGHT_REUSE_SERVER: "1", CI: "true" })).toBe(false);
  });
});
