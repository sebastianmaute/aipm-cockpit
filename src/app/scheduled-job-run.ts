// §772 — runs ONE due scheduled job for ONE slot: check the project, claim the slot, load the project,
// build the digest, analyse, ground, finish the report, record the run. Pure orchestration over injected
// deps (no React, no globals) so every branch is testable with fakes. Spec "Run" steps 1–8.
// ★ Errors are stored ONLY as `ReportErrorToken`s, never `e.message` (Turso errors carry server text).
import { groundEntity, type ActionAnalysis } from "./action-ai";
import { AiHttpError, classifyAiError } from "./ai-errors";
import { buildProjectAnalysisInput } from "./project-analysis-input";
import { buildProjectDigest, DIGEST_MAX_CHARS } from "./project-digest";
import {
  claimReport, finishReport, hasReport, releaseClaim,
  type ReportData, type ReportErrorToken,
} from "./scheduled-reports-store";
import type { ScheduledJob, ScheduledJobRun } from "./scheduled-jobs/types";
import type { Lang } from "./i18n";
import type { Settings } from "./settings-types";
import type { TursoConfig } from "./turso-config";
import { TursoStepError } from "./turso-pipeline";
import { StorageNotReadyError, type Workspace } from "./workspace";

export type RunOutcome =
  | "skipped" | "claimed-elsewhere" | "project-missing" | "project-archived" | "transient" | "failed" | "done";

export interface RunDeps {
  config: TursoConfig;
  listActive(): Promise<{ id: string; name: string }[]>;
  listArchived(): Promise<{ id: string; name: string }[]>;
  loadWorkspace(projectId: string): Promise<Workspace>;
  analyse(context: string): Promise<ActionAnalysis>;
  deviceSettings: Settings;
  lang: Lang;
  now(): Date;
  newId(): string;
  deviceLabel: string;
  clearProject(jobId: number): Promise<void>;
  disableJob(jobId: number): Promise<void>;
  recordRun(jobId: number, run: ScheduledJobRun): Promise<void>;
  notify(title: string, body: string): void;
}

/** Maps any failure to the closed token set. Reads the error's TYPE and status, never its text
 *  (the one exception is the literal "parse" `runJobAnalysis` throws). */
export function toErrorToken(e: unknown): ReportErrorToken {
  if (e instanceof AiHttpError) {
    if (classifyAiError(e.status, e.errorType) === "limit") return "limit";
    if (e.status === 401) return "401";
    if (e.status === 403) return "403";
    return "error";
  }
  if (e instanceof StorageNotReadyError) return "storage-unreachable";
  if (e instanceof TursoStepError) return "turso";
  if (e instanceof Error) {
    if (e.message === "parse") return "parse";
    if (e.message.startsWith("Turso")) return "turso";
  }
  return "error";
}

const isTransient = (token: ReportErrorToken): boolean => token === "storage-unreachable" || token === "turso";

/** A rejecting store write (job deleted mid-run, write chain failure) must never fail the run. */
async function settle(p: Promise<unknown>): Promise<void> {
  try { await p; } catch { /* best-effort */ }
}

export async function runScheduledJob(job: ScheduledJob, slot: Date, deps: RunDeps): Promise<RunOutcome> {
  const { config } = deps;
  const projectId = job.projectId;
  const jobKey = job.key;
  if (projectId === null || jobKey === null) return "skipped";
  const slotIso = slot.toISOString();

  if (await hasReport(config, jobKey, slotIso)) return "skipped";

  // 1. The project, before claiming: a hard-deleted project writes no row.
  const [active, archived] = await Promise.all([deps.listActive(), deps.listArchived()]);
  const activeHit = active.find((p) => p.id === projectId);
  const archivedHit = activeHit ? undefined : archived.find((p) => p.id === projectId);
  if (!activeHit && !archivedHit) {
    await settle(deps.clearProject(job.id));
    await settle(deps.recordRun(job.id, failedRun(deps.now(), "project-missing")));
    return "project-missing";
  }
  const projectName = (activeHit ?? archivedHit)?.name ?? "";

  // 2. Claim. Name and instruction are captured NOW; a later rename of the job never rewrites this report.
  const reportId = deps.newId();
  const base: ReportData = {
    jobName: job.name,
    projectName,
    ...(job.instruction ? { instruction: job.instruction } : {}),
    summary: "",
    actions: [],
  };
  const won = await claimReport(config, {
    id: reportId, projectId, jobKey, slot: slotIso, ranAt: deps.now().toISOString(), claimedBy: deps.deviceLabel, data: base,
  });
  if (!won) return "claimed-elsewhere";

  if (archivedHit) {
    await finishReport(config, reportId, jobKey, false, { ...base, error: "project-archived" });
    await settle(deps.disableJob(job.id));
    await settle(deps.recordRun(job.id, failedRun(deps.now(), "project-archived")));
    return "project-archived";
  }

  // 3. Load. A storage failure here is transient: nothing was billed, so the claim is released and the
  // next tick retries (no report, no run record).
  let workspace: Workspace;
  try {
    workspace = await deps.loadWorkspace(projectId);
  } catch (e) {
    const token = toErrorToken(e);
    if (isTransient(token)) {
      await settle(releaseClaim(config, reportId));
      return "transient";
    }
    return failRun(job, reportId, jobKey, base, token, deps);
  }

  // 4–7. Digest, analyse, ground, finish.
  try {
    const input = buildProjectAnalysisInput({
      workspace, deviceSettings: deps.deviceSettings, lang: deps.lang, now: deps.now(),
    });
    const context = buildProjectDigest(
      { ...input.digestInput, ...(job.instruction ? { instruction: job.instruction } : {}) },
      DIGEST_MAX_CHARS,
    );
    const analysis = await deps.analyse(context);
    const actions = analysis.actions.map(({ entity, ...rest }) => {
      const grounded = groundEntity(entity, input.grounding);
      return grounded ? { ...rest, entity: { view: grounded.view, id: String(grounded.id) } } : rest;
    });
    await finishReport(config, reportId, jobKey, true, { ...base, summary: analysis.summary, actions });
    await settle(deps.recordRun(job.id, {
      ranAt: deps.now().toISOString(), summary: analysis.summary, actionCount: actions.length, ok: true,
    }));
    deps.notify(job.name, `${projectName}: ${analysis.summary}`);
    return "done";
  } catch (e) {
    return failRun(job, reportId, jobKey, base, toErrorToken(e), deps);
  }
}

async function failRun(
  job: ScheduledJob, reportId: string, jobKey: string, base: ReportData, token: ReportErrorToken, deps: RunDeps,
): Promise<RunOutcome> {
  try {
    await finishReport(deps.config, reportId, jobKey, false, { ...base, error: token });
  } catch {
    return "failed"; // the row stays `running` and is shown as interrupted; nothing more to do
  }
  await settle(deps.recordRun(job.id, failedRun(deps.now(), token)));
  return "failed";
}

function failedRun(at: Date, error: ReportErrorToken): ScheduledJobRun {
  return { ranAt: at.toISOString(), summary: "", actionCount: 0, ok: false, error };
}
