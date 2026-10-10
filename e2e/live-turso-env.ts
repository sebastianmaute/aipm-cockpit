// e2e/live-turso-env.ts
//
// The ONE place a live-Turso spec learns which database it may touch.
//
// ★★★ LIVE SPECS READ ONLY `TURSO_THROWAWAY_DATABASE_URL` / `TURSO_THROWAWAY_AUTH_TOKEN`.
// `NEXT_PUBLIC_TURSO_*` in a normal `.env.local` is the developer's REAL database
// (the app's own configuration), and a plain `npm run e2e` runs every live spec,
// so having app credentials is not consent. Setting the throwaway pair is the
// statement "this database can be lost". A spec skips, saying why, unless BOTH
// values are set: a URL alone would fail on auth rather than skip.
//
// ★★ A SPEC THAT DRIVES THE UI ALSO NEEDS THE APP'S DATABASE TO BE THE THROWAWAY
// ONE. The dev server reads `NEXT_PUBLIC_TURSO_*`, and a spec's node-side checks
// must read the database the app writes. Two guards, because each misses a case:
// - `APP_IS_THROWAWAY` asks NEXT ITSELF which URL the app gets: it runs
//   `@next/env`'s `loadEnvConfig` in a child process (`appUsesDatabase`), so an
//   exported variable, `.env.development.local`, `.env.development`, `.env` and a
//   duplicated line all resolve exactly as the dev server resolves them, and the
//   test process's own environment is never touched. A UI describe skips unless
//   it holds. It cannot see a server started EARLIER with other settings
//   (`PLAYWRIGHT_REUSE_SERVER=1`, or an external `PLAYWRIGHT_BASE_URL`).
// - `guardAppDatabase(page)` covers that case where it happens: it aborts any
//   app request to a `/v2/pipeline` on another host and records the host, which
//   the spec asserts is empty. A host is not a secret; no URL or token is logged.
// To run the UI specs, set both pairs to the same throwaway database. §215 will
// map CI's two secrets into both.
//
// ★★ PLAYWRIGHT DOES NOT LOAD `.env.local` — only Next does — so the file is
// parsed here. An exported pair wins (CI), but only when BOTH halves are set: a
// stale URL exported alone would point the test process at one database while
// the dev server reads another.
//
// ★★★ CREDENTIALS ARE NEVER PRINTED. Values are returned, never logged; callers
// treat them as opaque, and no assertion message, annotation or skip reason may
// carry one.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import type { Page } from "@playwright/test";

export interface TursoPair {
  url: string;
  token: string;
}

function readPair(urlKey: string, tokenKey: string): TursoPair {
  const fromProcess = { url: process.env[urlKey] ?? "", token: process.env[tokenKey] ?? "" };
  if (fromProcess.url && fromProcess.token) return fromProcess;
  // ★★★ RESOLVE AGAINST THE REPO, NOT THE CWD: a bare ".env.local" finds no file
  // when playwright is invoked from another directory, and everything skips.
  // ★★ `__dirname`, NOT `import.meta.url`: playwright transpiles specs to CJS,
  // where `import.meta` is a runtime SyntaxError that `tsc --noEmit` accepts.
  const envPath = join(__dirname, "..", ".env.local");
  if (!existsSync(envPath)) return { url: "", token: "" };
  const txt = readFileSync(envPath, "utf8");
  const read = (key: string) =>
    // Strip surrounding quotes and the CR of a CRLF file — both are silent
    // corruptions that would produce an unparseable URL rather than an error.
    (txt.match(new RegExp(`^${key}=(.*)$`, "m"))?.[1] ?? "").trim().replace(/^["']|["']$/g, "");
  return { url: read(urlKey), token: read(tokenKey) };
}

/** A database URL as the pipeline base, normalised the way `turso-config.ts` normalises it. */
export const pipelineBase = (url: string): string => url.replace(/^libsql:\/\//, "https://").replace(/\/$/, "");

/** The only database a live spec writes to, deletes from or drops tables in. */
export const THROWAWAY: TursoPair = readPair("TURSO_THROWAWAY_DATABASE_URL", "TURSO_THROWAWAY_AUTH_TOKEN");

/** Both throwaway values are set. */
export const LIVE = THROWAWAY.url !== "" && THROWAWAY.token !== "";

/** Whether a Next dev server started in `dir` with `env` would give the app `url` as
 *  `NEXT_PUBLIC_TURSO_DATABASE_URL`. Next's own loader decides, in a child process
 *  (it writes into `process.env`, which this process must not inherit), and the
 *  child prints only "1" or "0". Exported for its test (`live-turso-env.spec.ts`). */
export function appUsesDatabase(url: string, opts: { dir?: string; env?: NodeJS.ProcessEnv } = {}): boolean {
  if (!url) return false;
  const script =
    "const { loadEnvConfig } = require(process.env.AIPM_NEXT_ENV_PATH);" +
    "loadEnvConfig(process.cwd(), true, { info() {}, error() {} });" +
    "const n = (u) => (u || '').replace(/^libsql:\\/\\//, 'https://').replace(/\\/$/, '');" +
    "process.stdout.write(n(process.env.NEXT_PUBLIC_TURSO_DATABASE_URL) === n(process.env.AIPM_CHECK_URL) ? '1' : '0');";
  const res = spawnSync(process.execPath, ["-e", script], {
    cwd: opts.dir ?? join(__dirname, ".."),
    env: { ...(opts.env ?? process.env), AIPM_NEXT_ENV_PATH: require.resolve("@next/env"), AIPM_CHECK_URL: url },
    encoding: "utf8",
  });
  if (res.status !== 0) throw new Error(`appUsesDatabase: the env probe exited ${res.status}`);
  return res.stdout === "1";
}

/** The app's database (what the dev server will read) is the throwaway one. */
export const APP_IS_THROWAWAY = LIVE && appUsesDatabase(THROWAWAY.url);

/** Abort any app request to a Turso pipeline on a host other than the throwaway
 *  one, and return the hosts it blocked, for the spec to assert empty. Covers a
 *  server started with other settings, which `APP_IS_THROWAWAY` cannot see.
 *  Requests to the throwaway host fall through to any later-registered route. */
export async function guardAppDatabase(page: Page): Promise<string[]> {
  const blocked: string[] = [];
  const allowed = LIVE ? new URL(pipelineBase(THROWAWAY.url)).host : "";
  await page.route("**/v2/pipeline", async (route) => {
    const host = new URL(route.request().url()).host;
    if (host === allowed) return route.fallback();
    blocked.push(host);
    return route.abort("blockedbyclient");
  });
  return blocked;
}

/** `/v2/pipeline` on the throwaway database; empty when not `LIVE`. */
export const PIPELINE_URL = LIVE ? `${pipelineBase(THROWAWAY.url)}/v2/pipeline` : "";

export const SKIP_NO_THROWAWAY =
  "writes to the database: set TURSO_THROWAWAY_DATABASE_URL and TURSO_THROWAWAY_AUTH_TOKEN to a database you can lose";

export const SKIP_APP_NOT_THROWAWAY =
  "drives the app, whose database (NEXT_PUBLIC_TURSO_DATABASE_URL) is not the throwaway one (TURSO_THROWAWAY_DATABASE_URL); point both at a database you can lose";

/** A text argument for a pipeline statement. */
export const txt = (value: string) => ({ type: "text" as const, value });

/** Raw pipeline call from the TEST process, for setup, verification and cleanup
 *  on the throwaway database: one `execute` request per statement, so a failing
 *  statement does NOT stop the rest (that is the §637 behaviour the DDL probe
 *  measures). Prefer `runTursoPipeline` when the app's own transport is the point.
 *  ★ Throws with the HTTP status only — never the URL, never the token. */
export async function rawPipeline(stmts: { sql: string; args?: { type: string; value: string }[] }[]) {
  const res = await fetch(PIPELINE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(THROWAWAY.token ? { Authorization: `Bearer ${THROWAWAY.token}` } : {}),
    },
    body: JSON.stringify({ requests: stmts.map((stmt) => ({ type: "execute", stmt })) }),
  });
  if (!res.ok) throw new Error(`pipeline HTTP ${res.status}`);
  const json = (await res.json()) as {
    results?: { type: string; error?: { message?: string }; response?: { result?: { rows?: { value: string }[][] } } }[];
  };
  return json.results ?? [];
}
