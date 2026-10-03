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
