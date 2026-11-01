// SERVER-ONLY. Deletes saved AI chats older than the retention period, on the server's own
// schedule: once when the server starts and every 24 hours after, with server-side Turso
// credentials. Started from `src/instrumentation.ts` in the Node.js runtime only.
//
// Credentials, one PAIR at a time — a URL from one pair is never used with a token from the other:
//   AIPM_CHAT_SWEEP_TURSO_URL + AIPM_CHAT_SWEEP_TURSO_TOKEN   preferred
//   NEXT_PUBLIC_TURSO_DATABASE_URL + NEXT_PUBLIC_TURSO_AUTH_TOKEN   used when the sweep URL is unset
// A remote URL needs a token; a loopback http URL (local tursodb) may have none. No usable pair
// means no schedule.
//
// The schedule does not depend on the AI switch or on disabled integrations: deleting expired
// chats is always right. Logs carry a fixed line and a count only — never the URL, the token or
// an error message, which could quote either.

import { CHAT_THREADS_DDL, expireThreadsStatements } from "../../chat-threads-schema";
import { readChatSettings } from "../../ai-chat-retention-config";
import { runTursoPipeline } from "../../turso-pipeline";
import { toHttpUrl, type TursoConfig } from "../../turso-config";
import type { PipelineResultLike, SqlStmt } from "../../turso-schema";

export const CHAT_SWEEP_INTERVAL_MS = 86_400_000;

type Env = Record<string, string | undefined>;

export type PipelineRunner = (config: TursoConfig, stmts: SqlStmt[]) => Promise<PipelineResultLike[]>;

export type SweepTimers = {
  setInterval: (fn: () => void, ms: number) => { unref?: () => void };
};

const NODE_TIMERS: SweepTimers = { setInterval: (fn, ms) => setInterval(fn, ms) };

function value(env: Env, name: string): string {
  return env[name]?.trim() ?? "";
}

function configFrom(rawUrl: string, token: string): TursoConfig | null {
  const httpUrl = toHttpUrl(rawUrl);
  if (!httpUrl) return null;
  // `toHttpUrl` allows plaintext http only for a loopback host, so every other URL needs a token.
  if (!token && !httpUrl.startsWith("http://")) return null;
  return { httpUrl, authToken: token };
}

/** The sweep's credentials: the sweep pair, else the public pair; null when neither is usable. */
export function sweepCredentialsFrom(env: Env): TursoConfig | null {
  const sweepUrl = value(env, "AIPM_CHAT_SWEEP_TURSO_URL");
  if (sweepUrl) return configFrom(sweepUrl, value(env, "AIPM_CHAT_SWEEP_TURSO_TOKEN"));
  const publicUrl = value(env, "NEXT_PUBLIC_TURSO_DATABASE_URL");
  if (publicUrl) return configFrom(publicUrl, value(env, "NEXT_PUBLIC_TURSO_AUTH_TOKEN"));
  return null;
}

/** Creates the table if it is missing, deletes every expired chat (by the database's clock),
 *  and returns how many went. */
export async function runChatSweep(
  config: TursoConfig,
  days: number,
  run: PipelineRunner = runTursoPipeline,
): Promise<number> {
  const ddl: SqlStmt[] = CHAT_THREADS_DDL.map((sql) => ({ sql }));
  const results = await run(config, [...ddl, ...expireThreadsStatements(days)]);
  return results[results.length - 1]?.response?.result?.affected_row_count ?? 0;
}

// Dev mode can call `register()` more than once in one process; one schedule is enough.
let started = false;

/** Runs the sweep now and every 24 hours. Returns false when it did not start a schedule. */
export function startChatSweepSchedule(
  env: Env,
  timers: SweepTimers = NODE_TIMERS,
  run: PipelineRunner = runTursoPipeline,
): boolean {
  if (started) return false;
  const config = sweepCredentialsFrom(env);
  if (!config) return false;
  started = true;
  const sweep = (): void => {
    // The retention is read on every run, so a changed setting applies without a restart of the schedule.
    void runChatSweep(config, readChatSettings(env).retentionDays, run).then(
      (count) => console.info(`chat sweep: ${count} expired`),
      () => console.warn("chat sweep failed"),
    );
  };
  sweep();
  timers.setInterval(sweep, CHAT_SWEEP_INTERVAL_MS).unref?.();
  return true;
}
