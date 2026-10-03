import { createHash } from "node:crypto";
import { resolve } from "node:path";

/** Hex characters kept from the sha-256 digest. Enough to tell two checkouts apart; too short to be a path. */
export const CHECKOUT_TOKEN_LENGTH = 12;

/**
 * A short, non-reversible token naming the CHECKOUT a process runs from, for the
 * e2e guard "the served app is this checkout" (open-followups §58).
 *
 * `RootLayout` stamps it on `<html>` as `data-checkout` from the SERVING process's
 * `process.cwd()`; `e2e/a11y.spec.ts` computes it from the TEST process's
 * `process.cwd()` and compares. Two worktrees produce different tokens, which a
 * version match cannot tell apart. A leftover server started from the SAME
 * worktree produces the same token — this does not catch that case.
 *
 * Returns `undefined` in production WITHOUT calling `getDir`, so no path-derived
 * value is computed or shipped there. `getDir` is a thunk for exactly that reason.
 *
 * The path is resolved first and, on Windows, lower-cased: the file system is
 * case-insensitive there and a shell can report `c:\` where npm reports `C:\`,
 * which would otherwise make one checkout look like two.
 */
export function checkoutToken(
  nodeEnv: string | undefined,
  getDir: () => string,
  platform: NodeJS.Platform = process.platform,
): string | undefined {
  if (nodeEnv === "production") return undefined;
  const resolved = resolve(getDir());
  const normalized = platform === "win32" ? resolved.toLowerCase() : resolved;
  return createHash("sha256").update(normalized).digest("hex").slice(0, CHECKOUT_TOKEN_LENGTH);
}

/**
 * True when a Playwright run starts (or reuses) the config's own `npm run dev`
 * webServer. Mirrors `playwright.config.ts` exactly: `webServer` is configured
 * unless `PLAYWRIGHT_NO_WEBSERVER` is set to a non-empty value. It is the only
 * signal a run carries about which server it targets — with it unset the
 * intended server is a dev server, and only with it set can the run be pointed
 * (via `PLAYWRIGHT_BASE_URL`) at a production server on purpose.
 */
export function runStartsDevServer(env: Record<string, string | undefined>): boolean {
  return !env.PLAYWRIGHT_NO_WEBSERVER;
}

/** What the e2e guard concludes from the served `data-checkout` (open-followups §58). */
export type CheckoutVerdict = "match" | "mismatch" | "absent-refused" | "absent-external";

/**
 * The decision behind `e2e/a11y.spec.ts`'s checkout guard, pure so it can be
 * unit-tested. `served` is the `data-checkout` the page carries (null when the
 * attribute is absent); `expected` is `checkoutToken` of the runner's cwd.
 *
 * An ABSENT attribute is refused when the run starts its own dev server: a dev
 * server from this checkout always stamps it, so its absence means the reused
 * server is something else — a production build, or a dev server built from a
 * commit that predates the attribute. It is accepted only when the run targets
 * an external server (`PLAYWRIGHT_NO_WEBSERVER` set), where a production server
 * legitimately omits it; in that mode the version check stands alone.
 */
export function judgeServedCheckout(
  served: string | null,
  expected: string,
  startsDevServer: boolean,
): CheckoutVerdict {
  if (served === null) return startsDevServer ? "absent-refused" : "absent-external";
  return served === expected ? "match" : "mismatch";
}
