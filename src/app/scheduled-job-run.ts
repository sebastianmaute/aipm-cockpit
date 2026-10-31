// §772 — runs ONE due scheduled job for ONE slot: check the project, claim the slot, load the project,
// build the digest, analyse, ground, finish the report, record the run. Pure orchestration over injected
// deps (no React, no globals) so every branch is testable with fakes. Spec "Run" steps 1–8.
// ★ Errors are stored ONLY as `ReportErrorToken`s, never `e.message` (Turso errors carry server text).
import { groundEntity, type ActionAnalysis } from "./action-ai";
import {
  AI_KEY_WRONG_ORGANIZATION, AI_KEY_WRONG_WORKSPACE,
  AiDeploymentError, AiGatewayError, AiHttpError, AiKeyCheckUnavailableError, AiKeyRefusedError, classifyAiError,
} from "./ai-errors";
import { AiConsentRevokedError, AiWeeklyCapReachedError } from "./ai-consent";
import { aiPrivacyFor, type AiPrivacy } from "./ai-privacy";
import { buildProjectAnalysisInput } from "./project-analysis-input";
import { periodStartFor } from "./scheduled-jobs/schedule";
import { buildProjectDigest, DIGEST_MAX_CHARS } from "./project-digest";
import {
  claimReport, finishReport, hasReportAtOrAfter, releaseClaim,
  type ReportData, type ReportErrorToken,
} from "./scheduled-reports-store";
import type { ScheduledJob, ScheduledJobRun } from "./scheduled-jobs/types";
import type { Lang } from "./i18n";
import type { Settings } from "./settings-types";
import type { TursoConfig } from "./turso-config";
import { TursoHttpError, TursoStepError } from "./turso-pipeline";
import { StorageNotReadyError, type Workspace } from "./workspace";
import { isBusyDbError, isTursoServerBlip } from "./storage-transient";

export type RunOutcome =
  | "skipped" | "claimed-elsewhere" | "project-missing" | "project-archived" | "transient" | "failed" | "done";

export interface RunDeps {
  config: TursoConfig;
  /** Both lists from ONE read, so a project archived or restored meanwhile cannot appear in neither. */
  listProjects(): Promise<{ active: { id: string; name: string }[]; archived: { id: string; name: string }[] }>;
  /** Re-read the LIVE state right before a claim: the job still exists, is enabled and has the same key and project,
   *  scheduled jobs and AI are still on with a key, and the portfolio is still the one the tick began on. */
  stillRunnable(job: ScheduledJob): boolean | Promise<boolean>;
  /** Asks the server whether AI is on and on the route this page loaded with (`confirmAiDeployment`); rejects when
   *  not. Asked right before the claim, so a tab that cannot send never claims (and fails) the shared slot. */
  confirmDeployment(): Promise<void>;
  /** Throws when an unattended run may not send on this device: the background consent is gone or the weekly hard
   *  cap is reached. Synchronous and free, so it is asked first, before any server read, and again beside
   *  `confirmDeployment`, for the same reason: a device that cannot send never claims. */
  confirmBackgroundGate(): void;
  loadWorkspace(projectId: string): Promise<Workspace>;
  /** After a load: true when part of the project failed to decode or was truncated (the report then says so). */
  lastLoadPartial?(): boolean;
  /** `privacy` is the TARGET project's (AI people protection, spec R3): its setting and its people, never the
   *  open project's. */
  analyse(context: string, privacy: AiPrivacy): Promise<ActionAnalysis>;
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

/** Maps any failure to the closed token set, stored instead of a message. It reads the error's type and status. The only
 *  text it reads: the literal "parse" `runJobAnalysis` throws, and the `Turso` prefix of the pipeline's plain errors.
 *  An `AiDeploymentError` or an `AiKeyCheckUnavailableError` never reaches it: the run catches them first as transient and waits for its next check. */
export function toErrorToken(e: unknown): ReportErrorToken {
  if (e instanceof AiHttpError) {
    if (classifyAiError(e.status, e.errorType) === "limit") return "limit";
    if (e.status === 401) return "401";
    if (e.status === 403) return "403";
    return "error";
  }
  if (e instanceof AiGatewayError) return e.code;
  if (e instanceof AiKeyRefusedError) return e.reason === "organization" ? AI_KEY_WRONG_ORGANIZATION : AI_KEY_WRONG_WORKSPACE;
  if (e instanceof StorageNotReadyError) return "storage-unreachable";
  if (e instanceof TursoStepError || e instanceof TursoHttpError) return "turso";
  if (e instanceof Error) {
    if (e.message === "parse") return "parse";
    if (e.message.startsWith("Turso")) return "turso";
  }
  return "error";
}

/** Connectivity-class failures (`postPipeline` folds a network failure or timeout into `StorageNotReadyError`), a
 *  rate limit or server error from Turso, and a busy database are transient. Any OTHER Turso step or SQL error is NOT, or it would claim, fail and release every
 *  tick forever with no report and no history entry. */
const isTransient = (e: unknown): boolean => e instanceof StorageNotReadyError || isTursoServerBlip(e) || isBusyDbError(e);

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

  // A device that may not send (a capped week, a revoked consent) does no server work at all: the same outcome as the
  // check beside `confirmDeployment` below, without a read of the server on every tick.
  try {
    deps.confirmBackgroundGate();
  } catch {
    return "transient";
  }

  // At most one run per cadence period (day or ISO week, in the job's current zone): any report since the period began
  // spends it, so a later edit of the time or zone cannot bill again. The UNIQUE claim still guards the exact slot.
  const periodStart = (periodStartFor(job, slot) ?? slot).toISOString();
  if (await hasReportAtOrAfter(config, jobKey, periodStart)) return "skipped";

  // 1. The project, before claiming: a hard-deleted project writes no row.
  const { active, archived } = await deps.listProjects();
  // The tick's snapshot may be minutes old: a job disabled, deleted or re-pointed since must neither claim nor
  // have its project cleared on the strength of the OLD project id.
  if (!(await deps.stillRunnable(job))) return "skipped";
  const activeHit = active.find((p) => p.id === projectId);
  const archivedHit = activeHit ? undefined : archived.find((p) => p.id === projectId);
  if (!activeHit && !archivedHit) {
    await settle(deps.clearProject(job.id, jobKey));
    await settle(deps.recordRun(job.id, failedRun(deps.now(), "project-missing", slotIso), jobKey));
    return "project-missing";
  }
  const projectName = (activeHit ?? archivedHit)?.name ?? "";

  // The slot is shared by every device: a tab whose AI is off, invalid, on a stale route or unreachable would claim it
  // and fail it for all of them. Nothing was sent, so nothing is claimed and the next tick retries.
  try {
    await deps.confirmDeployment();
    deps.confirmBackgroundGate();
  } catch {
    return "transient";
  }

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
    id: reportId, projectId, jobKey, slot: slotIso, periodStart, claimedBy: deps.deviceLabel, data: base,
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
    await settle(deps.recordRun(job.id, failedRun(deps.now(), "project-missing", slotIso), jobKey));
    return "project-missing";
  }

  if (archivedHit) {
    // The disable must not depend on the write: a failed finish would otherwise leave the job enabled and
    // claim (and leave an interrupted row for) every later slot.
    try {
      await finishReport(config, reportId, jobKey, false, { ...base, error: "project-archived" });
    } catch { /* the row stays `running` and is shown as interrupted */ }
    await settle(deps.disableJob(job.id, jobKey));
    await settle(deps.recordRun(job.id, failedRun(deps.now(), "project-archived", slotIso), jobKey));
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
    return failRun(job, reportId, jobKey, base, toErrorToken(e), deps, slotIso);
  }

  // The load took seconds: re-read the live state once more before the billed call. A job switched off, deleted or
  // re-pointed meanwhile writes no report, records no run and makes no AI call.
  if (!(await deps.stillRunnable(job))) {
    await settle(releaseClaim(config, reportId));
    return "skipped";
  }

  const partial = deps.lastLoadPartial?.() === true;
  const reportBase: ReportData = partial ? { ...base, partial: true } : base;

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
    // The request carries THIS project's data, so it carries this project's privacy (spec R3), whichever
    // project the app has open. The key is the project's storage id, as the open project's is.
    analysis = await deps.analyse(context, aiPrivacyFor([{ key: projectId, ws: workspace }]));
    actions = analysis.actions.map(({ entity, ...rest }) => {
      const grounded = groundEntity(entity, input.grounding);
      return grounded ? { ...rest, entity: { view: grounded.view, id: String(grounded.id) } } : rest;
    });
  } catch (e) {
    // The transport throws `AiDeploymentError` before it sends anything (the setting changed since the check above), and
    // `AiKeyCheckUnavailableError` when the relay could not check the key (nothing was forwarded): nothing was billed, so, as
    // for the load, the claim is released and the next tick retries. A consent withdrawn or a weekly hard cap reached
    // since the check above is refused the same way, before a send. With the max-tokens retry the first reply may
    // already have been billed when the second send is refused: that spend stays recorded in the usage store, and the
    // released slot is retried once the gate allows it.
    if (e instanceof AiDeploymentError || e instanceof AiKeyCheckUnavailableError || e instanceof AiWeeklyCapReachedError || e instanceof AiConsentRevokedError) {
      await settle(releaseClaim(config, reportId));
      return "transient";
    }
    return failRun(job, reportId, jobKey, reportBase, toErrorToken(e), deps, slotIso);
  }

  // 7. Finish. If this throws the row may or may not have committed, so there is NO second finish here
  // (it could overwrite a good report); an uncommitted row stays `running` and is shown as interrupted.
  try {
    await finishReport(config, reportId, jobKey, true, { ...reportBase, summary: analysis.summary, actions });
  } catch {
    return "failed";
  }

  // 8. Record and notify — after the finish, outside its try, so neither can rewrite the stored report.
  await settle(deps.recordRun(job.id, {
    ranAt: deps.now().toISOString(), summary: analysis.summary, actionCount: actions.length, ok: true, slot: slotIso,
  }, jobKey));
  try { deps.notify(job.name, `${projectName}: ${analysis.summary}`); } catch { /* best-effort */ }
  return "done";
}

async function failRun(
  job: ScheduledJob, reportId: string, jobKey: string, base: ReportData, token: ReportErrorToken, deps: RunDeps, slotIso: string,
): Promise<RunOutcome> {
  try {
    await finishReport(deps.config, reportId, jobKey, false, { ...base, error: token });
  } catch {
    return "failed"; // the row stays `running` and is shown as interrupted; nothing more to do
  }
  await settle(deps.recordRun(job.id, failedRun(deps.now(), token, slotIso), jobKey));
  return "failed";
}

function failedRun(at: Date, error: ReportErrorToken, slotIso: string): ScheduledJobRun {
  return { ranAt: at.toISOString(), summary: "", actionCount: 0, ok: false, error, slot: slotIso };
}
