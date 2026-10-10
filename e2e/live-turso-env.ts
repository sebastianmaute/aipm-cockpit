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
// must read the database the app writes. `APP_IS_THROWAWAY` compares the two URLs
// (normalised, never printed); a UI describe skips unless it holds, or it would
// write its e2e rows into the developer's real database. To run everything, set
// both pairs to the same throwaway database. CI maps its two secrets into both.
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

/** The app's database (what the dev server reads) is the throwaway one. */
export const APP_IS_THROWAWAY =
  LIVE && pipelineBase(readPair("NEXT_PUBLIC_TURSO_DATABASE_URL", "NEXT_PUBLIC_TURSO_AUTH_TOKEN").url) === pipelineBase(THROWAWAY.url);

/** `/v2/pipeline` on the throwaway database; empty when not `LIVE`. */
export const PIPELINE_URL = LIVE ? `${pipelineBase(THROWAWAY.url)}/v2/pipeline` : "";

export const SKIP_NO_THROWAWAY =
  "writes to the database: set TURSO_THROWAWAY_DATABASE_URL and TURSO_THROWAWAY_AUTH_TOKEN to a database you can lose";

export const SKIP_APP_NOT_THROWAWAY =
  "drives the app, whose database (NEXT_PUBLIC_TURSO_DATABASE_URL) is not the throwaway one (TURSO_THROWAWAY_DATABASE_URL); point both at a database you can lose";
