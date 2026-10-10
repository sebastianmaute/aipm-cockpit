// e2e/turso-revision-live.spec.ts
//
// §654 — the §4 revision guard against a REAL Turso database. The unit suite
// runs the guard on `node:sqlite` (`turso-schema.execute.test.ts`) and against a
// stubbed Hrana client; this file sends the statements the app builds, through
// the app's own `runTursoPipeline` and `TursoBackend`, to a live server.
//
// It drives no browser: the two "devices" of check (6) are two `TursoBackend`
// instances, which is what two tabs or two machines are to the database — two
// writers that each remember the revision they last loaded. Run it without the
// dev server:
//   PLAYWRIGHT_NO_WEBSERVER=1 npx playwright test e2e/turso-revision-live.spec.ts --project=chromium --workers=1
//
// ★★ PLAYWRIGHT DOES NOT LOAD `.env.local`, so `readEnvLocal` parses it (the
// same rule as `documents-images-interactive.spec.ts`). The only skip is "no
// credentials anywhere"; past that, every check asserts.
//
// ★★★ CREDENTIALS ARE NEVER PRINTED. Assertions compare revisions, dates and
// booleans; the one recorded server message carries only the stored revision.
//
// ★★★ THROWAWAY DATABASE ONLY. Each layout starts from a FRESH database — every
// workspace table (`TABLE_NAMES`) is DROPPED, which destroys whatever the app had
// saved there — and `afterAll` drops them again. The app re-creates them on its
// next save (`CREATE TABLE IF NOT EXISTS`).

import { readFileSync, existsSync } from "node:fs";
import { test, expect } from "@playwright/test";
import {
  REVISION_CONFLICT_MARKER,
  TABLE_NAMES,
  isRevisionGuard,
  workspaceToStatements,
  type SqlStmt,
} from "../src/app/turso-schema";
import { runTursoPipeline, TursoStepError } from "../src/app/turso-pipeline";
import { TursoBackend } from "../src/app/turso-backend";
import { SaveConflictError } from "../src/app/storage-error";
import type { Workspace } from "../src/app/workspace";
import type { TursoConfig } from "../src/app/turso-config";

/** `.env.local` first-hand; `process.env` wins when the pair is exported (CI). Values are never logged. */
function readEnvLocal(): { url: string; token: string } {
  const fromProcess = {
    url: process.env.NEXT_PUBLIC_TURSO_DATABASE_URL ?? "",
    token: process.env.NEXT_PUBLIC_TURSO_AUTH_TOKEN ?? "",
  };
  if (fromProcess.url) return fromProcess;
  if (!existsSync(".env.local")) return { url: "", token: "" };
  const txt = readFileSync(".env.local", "utf8");
  const read = (key: string) =>
    (txt.match(new RegExp(`^${key}=(.*)$`, "m"))?.[1] ?? "").trim().replace(/^["']|["']$/g, "");
  return { url: read("NEXT_PUBLIC_TURSO_DATABASE_URL"), token: read("NEXT_PUBLIC_TURSO_AUTH_TOKEN") };
}

const ENV = readEnvLocal();
const LIVE = ENV.url !== "";
/** Normalised the way `turso-config.ts` normalises it. */
const CONFIG: TursoConfig = {
  httpUrl: ENV.url.replace(/^libsql:\/\//, "https://").replace(/\/$/, ""),
  authToken: ENV.token,
};

const text = (value: string) => ({ type: "text" as const, value });

/** A fresh database: no workspace table, so no `meta` row and no revision. */
async function dropWorkspaceTables(): Promise<void> {
  await runTursoPipeline(CONFIG, TABLE_NAMES.map((t) => ({ sql: `DROP TABLE IF EXISTS ${t}` })));
}

/** The stored revision, read straight from the table; `null` when there is no row. */
async function storedRevision(projectId?: string): Promise<string | null> {
  const [res] = await runTursoPipeline(CONFIG, [
    projectId === undefined
      ? { sql: "SELECT value FROM meta WHERE key = 'revision'" }
      : { sql: "SELECT value FROM meta WHERE key = 'revision' AND project_id = ?", args: [text(projectId)] },
  ]);
  const rows = (res.response?.result as { rows?: { value: string }[][] } | undefined)?.rows ?? [];
  return rows.length ? rows[0][0].value : null;
}

/** The stored plan start date — the observable of "B's write did or did not land". */
async function storedPlanStart(projectId?: string): Promise<string | null> {
  const [res] = await runTursoPipeline(CONFIG, [
    projectId === undefined
      ? { sql: 'SELECT "startDate" FROM plan' }
      : { sql: 'SELECT "startDate" FROM plan WHERE project_id = ?', args: [text(projectId)] },
  ]);
  const rows = (res.response?.result as { rows?: { value: string }[][] } | undefined)?.rows ?? [];
  return rows.length ? rows[0][0].value : null;
}

/** A workspace edit: a new `plan` reference with a recognisable start date. */
const withStart = (ws: Workspace, startDate: string): Workspace => ({ ...ws, plan: { ...ws.plan, startDate } });

test.describe("§654 — the revision guard on a live Turso database", () => {
  test.skip(!LIVE, "needs a live Turso database (.env.local NEXT_PUBLIC_TURSO_*)");
  test.describe.configure({ mode: "serial" });

  test.afterAll(async () => {
    if (LIVE) await dropWorkspaceTables().catch(() => {});
  });

  test.describe("single-tenant layout", () => {
    test.beforeAll(async () => {
      if (LIVE) await dropWorkspaceTables();
    });

    test("(4) a fresh database's first guarded save stamps 1", async () => {
      const a = new TursoBackend(CONFIG);
      const ws = await a.load();
      expect(a.revision()).toBe("0");
      expect(await storedRevision()).toBeNull();
      await a.save(withStart(ws, "2030-01-01"));
      expect(await storedRevision()).toBe("1");
      expect(a.revision()).toBe("1");
    });

    test("(1)(2)(7) a stale guard is a step error, nothing commits; a positive control commits and bumps", async () => {
      const a = new TursoBackend(CONFIG);
      const ws = await a.load();
      expect(a.revision()).toBe("1");

      // Stale: guarded on "0" while the database holds "1".
      const stale: SqlStmt[] = workspaceToStatements(withStart(ws, "2031-12-31"), undefined, { expected: "0" });
      const err = await runTursoPipeline(CONFIG, stale).then(
        () => null,
        (e: unknown) => e,
      );
      expect(err, "a stale guard must fail the batch, never return NULL and COMMIT").toBeInstanceOf(TursoStepError);
      const stepError = err as TursoStepError;
      expect(isRevisionGuard(stale[stepError.stepIndex]), "the failing step is the guard").toBe(true);
      // (2) record the server's step error text — it names the stored revision and nothing else.
      expect(stepError.message).toContain(`${REVISION_CONFLICT_MARKER}1`);
      test.info().annotations.push({ type: "step error (§654 check 2)", description: stepError.message });
      expect(await storedPlanStart(), "no row changed").toBe("2030-01-01");
      expect(await storedRevision()).toBe("1");

      // Positive control: guarded on the stored value, so it commits; the UPDATE stamp bumps it (7).
      const fresh = workspaceToStatements(withStart(ws, "2030-02-02"), undefined, { expected: "1" });
      await runTursoPipeline(CONFIG, fresh);
      expect(await storedPlanStart()).toBe("2030-02-02");
      expect(await storedRevision()).toBe("2");
    });

    test("(3)(6) two devices: B saves, then A edits — A is refused with nothing written, and the next save succeeds", async () => {
      const a = new TursoBackend(CONFIG);
      const b = new TursoBackend(CONFIG);
      const wsA = await a.load();
      const wsB = await b.load();
      expect(a.revision()).toBe("2");
      expect(b.revision()).toBe("2");

      await b.save(withStart(wsB, "2032-03-03"));
      expect(await storedRevision()).toBe("3");

      const refused = await a.save(withStart(wsA, "2033-04-04")).then(
        () => null,
        (e: unknown) => e,
      );
      expect(refused, "A saved over B's write").toBeInstanceOf(SaveConflictError);
      expect((refused as SaveConflictError).currentRevision).toBe("3");
      expect(await storedPlanStart(), "A's edit must not land").toBe("2032-03-03");
      expect(await storedRevision()).toBe("3");

      // (3) the trailing ROLLBACK left no open transaction: B's next guarded save commits.
      await b.save(withStart(wsB, "2034-05-05"));
      expect(await storedPlanStart()).toBe("2034-05-05");
      expect(await storedRevision()).toBe("4");
    });

    test("(7) a blind write stamps past the stored value and reads back what it stamped", async () => {
      const a = new TursoBackend(CONFIG);
      const ws = await a.load();
      expect(a.revision()).toBe("4");
      // Another writer moves the revision on after A loaded.
      const other = new TursoBackend(CONFIG);
      await other.save(withStart(await other.load(), "2035-06-06"));
      expect(await storedRevision()).toBe("5");

      a.forceNextSave();
      await a.save(withStart(ws, "2036-07-07"));
      expect(await storedPlanStart()).toBe("2036-07-07");
      expect(await storedRevision()).toBe("6");
      expect(a.revision(), "the in-transaction read-back").toBe("6");
    });
  });

  test.describe("tenant layout", () => {
    const P1 = "p654-a";
    const P2 = "p654-b";

    test.beforeAll(async () => {
      if (LIVE) await dropWorkspaceTables();
    });

    test("(4)(5) each project's first save stamps 1, and each project keeps a revision of its own", async () => {
      const a1 = new TursoBackend(CONFIG, P1);
      const a2 = new TursoBackend(CONFIG, P2);
      const ws1 = await a1.load();
      const ws2 = await a2.load();
      expect(a1.revision()).toBe("0");
      expect(a2.revision()).toBe("0");

      await a1.save(withStart(ws1, "2030-01-01"));
      expect(await storedRevision(P1)).toBe("1");
      expect(await storedRevision(P2)).toBeNull();

      await a2.save(withStart(ws2, "2040-01-01"));
      await a1.save(withStart(ws1, "2030-02-02"));
      expect(await storedRevision(P1)).toBe("2");
      expect(await storedRevision(P2)).toBe("1");
      expect(await storedPlanStart(P2)).toBe("2040-01-01");
    });

    test("(6) two devices on one project: the stale one is refused, the other project is untouched", async () => {
      const a = new TursoBackend(CONFIG, P1);
      const b = new TursoBackend(CONFIG, P1);
      const wsA = await a.load();
      const wsB = await b.load();
      await b.save(withStart(wsB, "2031-03-03"));
      expect(await storedRevision(P1)).toBe("3");

      const refused = await a.save(withStart(wsA, "2033-04-04")).then(
        () => null,
        (e: unknown) => e,
      );
      expect(refused).toBeInstanceOf(SaveConflictError);
      expect(await storedPlanStart(P1)).toBe("2031-03-03");
      expect(await storedRevision(P1)).toBe("3");
      expect(await storedRevision(P2)).toBe("1");
      expect(await storedPlanStart(P2)).toBe("2040-01-01");
    });
  });
});
