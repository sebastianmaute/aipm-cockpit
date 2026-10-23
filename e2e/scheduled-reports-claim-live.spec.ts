// e2e/scheduled-reports-claim-live.spec.ts
//
// §772 — the run claim against a REAL Turso database: two concurrent `claimReport` calls for the same
// (jobKey, slot) through the real pipeline must produce exactly one `true`. Unit tests run the SQL on
// node:sqlite, which cannot show how a remote libSQL server orders two simultaneous inserts.
//
// ★★★ Runs only via `npm run e2e:live-destructive` (the `live-turso-destructive` project) and skips
// without the throwaway pair (`live-turso-env.ts`). It creates `scheduled_reports` if missing and removes
// only its own rows. Credentials are never printed.
import { test, expect } from "@playwright/test";
import { claimReport, releaseClaim, type ReportData } from "../src/app/scheduled-reports-store";
import {
  THROWAWAY, LIVE, SKIP_NO_THROWAWAY, DESTRUCTIVE_RUN, SKIP_NOT_DESTRUCTIVE_RUN, pipelineBase,
} from "./live-turso-env";

const CONFIG = { httpUrl: pipelineBase(THROWAWAY.url), authToken: THROWAWAY.token };
const DATA: ReportData = { jobName: "probe", projectName: "probe", summary: "", actions: [] };
const SUFFIX = `${process.pid}-${Date.now()}`;
const JOB_KEY = `claim-probe-${SUFFIX}`;

test.describe("§772 — two devices claiming one slot", () => {
  test.skip(!LIVE, SKIP_NO_THROWAWAY);
  test.skip(!DESTRUCTIVE_RUN, SKIP_NOT_DESTRUCTIVE_RUN);

  const ids = [`probe-a-${SUFFIX}`, `probe-b-${SUFFIX}`];

  test.afterAll(async () => {
    for (const id of ids) await releaseClaim(CONFIG, id).catch(() => undefined);
  });

  test("exactly one of two concurrent claims wins", async () => {
    const slot = "2026-01-01T00:00:00.000Z";
    const wins = await Promise.all(ids.map((id, i) =>
      claimReport(CONFIG, { id, projectId: "probe", jobKey: JOB_KEY, slot, ranAt: slot, claimedBy: `dev-${i}`, data: DATA })));
    expect(wins.filter(Boolean)).toHaveLength(1);
  });
});
