// e2e/live-turso-env.spec.ts
//
// Pins `appUsesDatabase` (live-turso-env.ts): the check that decides whether a
// live UI spec may run, because the app's database is the throwaway one. It
// must resolve `NEXT_PUBLIC_TURSO_DATABASE_URL` exactly as the Next dev server
// does; a reader of its own once said "throwaway" while the app wrote elsewhere.
// Each case builds a scratch directory of env files and asks the real
// `@next/env` loader. Needs no database, no server and no credentials, so it
// runs in every `npm run e2e`.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect } from "@playwright/test";
import { appUsesDatabase } from "./live-turso-env";

const A = "libsql://throwaway-db.example.turso.io";
const B = "libsql://real-db.example.turso.io";
const KEY = "NEXT_PUBLIC_TURSO_DATABASE_URL";

/** A scratch project directory holding the given env files; removed afterwards. */
function withEnvFiles(files: Record<string, string>, fn: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "live-turso-env-"));
  try {
    for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The environment of a run that exports nothing Turso-related. */
const cleanEnv = (): NodeJS.ProcessEnv => {
  const env: Record<string, string | undefined> = { ...process.env };
  delete env[KEY];
  delete env.NEXT_PUBLIC_TURSO_AUTH_TOKEN;
  delete env.NODE_ENV;
  return env as NodeJS.ProcessEnv;
};

test.describe("appUsesDatabase resolves the app's database the way Next does", () => {
  test("reads .env.local", () => {
    withEnvFiles({ ".env.local": `${KEY}=${A}\n` }, (dir) => {
      expect(appUsesDatabase(A, { dir, env: cleanEnv() })).toBe(true);
      expect(appUsesDatabase(B, { dir, env: cleanEnv() })).toBe(false);
    });
  });

  test("an exported URL overrides .env.local, even with no token exported", () => {
    withEnvFiles({ ".env.local": `${KEY}=${A}\n` }, (dir) => {
      const env = { ...cleanEnv(), [KEY]: B };
      expect(appUsesDatabase(B, { dir, env })).toBe(true);
      expect(appUsesDatabase(A, { dir, env })).toBe(false);
    });
  });

  test(".env.development.local wins over .env.local in dev", () => {
    withEnvFiles({ ".env.local": `${KEY}=${A}\n`, ".env.development.local": `${KEY}=${B}\n` }, (dir) => {
      expect(appUsesDatabase(B, { dir, env: cleanEnv() })).toBe(true);
      expect(appUsesDatabase(A, { dir, env: cleanEnv() })).toBe(false);
    });
  });

  test("a URL set only in .env still reaches the app", () => {
    withEnvFiles({ ".env": `${KEY}=${B}\n` }, (dir) => {
      expect(appUsesDatabase(B, { dir, env: cleanEnv() })).toBe(true);
    });
  });

  test("a duplicated line resolves as Next resolves it, not as the first match", () => {
    withEnvFiles({ ".env.local": `${KEY}=${A}\n${KEY}=${B}\n` }, (dir) => {
      expect(appUsesDatabase(B, { dir, env: cleanEnv() })).toBe(true);
      expect(appUsesDatabase(A, { dir, env: cleanEnv() })).toBe(false);
    });
  });

  test("an empty throwaway URL never matches", () => {
    withEnvFiles({ ".env.local": `${KEY}=\n` }, (dir) => {
      expect(appUsesDatabase("", { dir, env: cleanEnv() })).toBe(false);
    });
  });
});
