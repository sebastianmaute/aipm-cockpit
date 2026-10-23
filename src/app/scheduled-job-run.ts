// §772 — runs ONE due scheduled job for ONE slot: check the project, claim the slot, load the project,
// build the digest, analyse, ground, finish the report, record the run. Pure orchestration over injected
// deps (no React, no globals) so every branch is testable with fakes. Spec "Run" steps 1–8.
// ★ Errors are stored ONLY as `ReportErrorToken`s, never `e.message` (Turso errors carry server text).
import { groundEntity, type ActionAnalysis } from "./action-ai";
import { AiHttpError, classifyAiError } from "./ai-errors";
import { buildProjectAnalysisInput } from "./project-analysis-input";
import { buildProjectDigest, DIGEST_MAX_CHARS } from "./project-digest";
import {
  claimReport, finishReport, hasReportAtOrAfter, releaseClaim,
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
  /** Both lists from ONE read, so a project archived or restored meanwhile cannot appear in neither. */
  listProjects(): Promise<{ active: { id: string; name: string }[]; archived: { id: string; name: string }[] }>;
  /** Re-read the LIVE state right before a claim: the job still exists, is enabled and has the same key and project,
   *  scheduled jobs and AI are still on with a key, and the portfolio is still the one the tick began on. */
  stillRunnable(job: ScheduledJob): boolean;
  loadWorkspace(projectId: string): Promise<Workspace>;
  analyse(context: string): Promise<ActionAnalysis>;
  deviceSettings: Settings;
  lang: Lang;
  now(): Date;
  newId(): string;
  deviceLabel: string;
  /** The three job-store writers take the job's permanent `key` as well: ids collide across portfolios, keys do not. */
  clearProject(jobId: number, jobKey: string): Promise<void>;
  disableJob(jobId: number, jobKey: string): Promise<void>;
  recordRun(jobId: number, run: ScheduledJobRun, jobKey: string): Promise<void>;
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

/** A busy or locked database (the open project's autosave holds the tenant database) is transient (spec Run step 3).
 *  Only the TYPE and the SQLite busy wording are read, never stored. */
const BUSY = /SQLITE_BUSY|database is locked|database table is locked|\bbusy\b/i;
const isBusy = (e: unknown): boolean => e instanceof Error && BUSY.test(e.message);

/** Connectivity-class failures (`postPipeline` folds a network failure or timeout into `StorageNotReadyError`) and a
 *  busy database are transient. Any OTHER Turso step or SQL error is NOT, or it would claim, fail and release every
 *  tick forever with no report and no history entry. */
const isTransient = (e: unknown): boolean => e instanceof StorageNotReadyError || isBusy(e);

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

  if (await hasReportAtOrAfter(config, jobKey, slotIso)) return "skipped";

  // 1. The project, before claiming: a hard-deleted project writes no row.
  const { active, archived } = await deps.listProjects();
  // The tick's snapshot may be minutes old: a job disabled, deleted or re-pointed since must neither claim nor
  // have its project cleared on the strength of the OLD project id.
  if (!deps.stillRunnable(job)) return "skipped";
  const activeHit = active.find((p) => p.id === projectId);
  const archivedHit = activeHit ? undefined : archived.find((p) => p.id === projectId);
  if (!activeHit && !archivedHit) {
    await settle(deps.clearProject(job.id, jobKey));
    await settle(deps.recordRun(job.id, failedRun(deps.now(), "project-missing"), jobKey));
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
    id: reportId, projectId, jobKey, slot: slotIso, claimedBy: deps.deviceLabel, data: base,
  });
  if (!won) return "claimed-elsewhere";

  // A project hard-deleted after the list read, whose side-table sweep already ran, would keep this fresh row for
  // good: check again now that the row exists. (A delete after the claim sweeps the row itself.)
  let after: Awaited<ReturnType<RunDeps["listProjects"]>>;
  try {
    after = await deps.listProjects();
  } catch {
    await settle(releaseClaim(config, reportId));
    return "transient";
  }
  if (!after.active.some((p) => p.id === projectId) && !after.archived.some((p) => p.id === projectId)) {
    await settle(releaseClaim(config, reportId));
    await settle(deps.clearProject(job.id, jobKey));
    await settle(deps.recordRun(job.id, failedRun(deps.now(), "project-missing"), jobKey));
    return "project-missing";
  }

  if (archivedHit) {
    // The disable must not depend on the write: a failed finish would otherwise leave the job enabled and
    // claim (and leave an interrupted row for) every later slot.
    try {
      await finishReport(config, reportId, jobKey, false, { ...base, error: "project-archived" });
    } catch { /* the row stays `running` and is shown as interrupted */ }
    await settle(deps.disableJob(job.id, jobKey));
    await settle(deps.recordRun(job.id, failedRun(deps.now(), "project-archived"), jobKey));
    return "project-archived";
  }

  // 3. Load. A storage failure here is transient: nothing was billed, so the claim is released and the
  // next tick retries (no report, no run record).
  let workspace: Workspace;
  try {
    workspace = await deps.loadWorkspace(projectId);
  } catch (e) {
    if (isTransient(e)) {
      await settle(releaseClaim(config, reportId));
      return "transient";
    }
    return failRun(job, reportId, jobKey, base, toErrorToken(e), deps);
  }

  // 4–6. Digest, analyse, ground.
  let analysis: ActionAnalysis;
  let actions: ReportData["actions"];
  try {
    const input = buildProjectAnalysisInput({
      workspace, deviceSettings: deps.deviceSettings, lang: deps.lang, now: deps.now(),
    });
    const context = buildProjectDigest(
      { ...input.digestInput, ...(job.instruction ? { instruction: job.instruction } : {}) },
      DIGEST_MAX_CHARS,
    );
    analysis = await deps.analyse(context);
    actions = analysis.actions.map(({ entity, ...rest }) => {
      const grounded = groundEntity(entity, input.grounding);
      return grounded ? { ...rest, entity: { view: grounded.view, id: String(grounded.id) } } : rest;
    });
  } catch (e) {
    return failRun(job, reportId, jobKey, base, toErrorToken(e), deps);
  }

  // 7. Finish. If this throws the row may or may not have committed, so there is NO second finish here
  // (it could overwrite a good report); an uncommitted row stays `running` and is shown as interrupted.
  try {
    await finishReport(config, reportId, jobKey, true, { ...base, summary: analysis.summary, actions });
  } catch {
    return "failed";
  }

  // 8. Record and notify — after the finish, outside its try, so neither can rewrite the stored report.
  await settle(deps.recordRun(job.id, {
    ranAt: deps.now().toISOString(), summary: analysis.summary, actionCount: actions.length, ok: true,
  }, jobKey));
  try { deps.notify(job.name, `${projectName}: ${analysis.summary}`); } catch { /* best-effort */ }
  return "done";
}

async function failRun(
  job: ScheduledJob, reportId: string, jobKey: string, base: ReportData, token: ReportErrorToken, deps: RunDeps,
): Promise<RunOutcome> {
  try {
    await finishReport(deps.config, reportId, jobKey, false, { ...base, error: token });
  } catch {
    return "failed"; // the row stays `running` and is shown as interrupted; nothing more to do
  }
  await settle(deps.recordRun(job.id, failedRun(deps.now(), token), jobKey));
  return "failed";
}

function failedRun(at: Date, error: ReportErrorToken): ScheduledJobRun {
  return { ranAt: at.toISOString(), summary: "", actionCount: 0, ok: false, error };
}
