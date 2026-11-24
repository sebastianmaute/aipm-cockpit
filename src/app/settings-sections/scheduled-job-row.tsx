"use client";

// src/app/settings-sections/scheduled-job-row.tsx — one job in the Scheduled jobs list: name, enabled,
// project, cadence, time zone, standing instruction and run history (§772). Presentational: the job and the
// project lists arrive as props, every write leaves through a callback.

import { useEffect, useRef, useState } from "react";
import { type Lang, t, tPlural, type TranslationKey } from "../i18n";
import { aiKeyMessageKeyForStatusToken } from "../ai-key-status";
import type { JobCadence, ScheduledJob, ScheduledJobRun } from "../scheduled-jobs/types";
import { Input, Select, Checkbox, Textarea } from "../form-controls";
import { Button } from "../button";
import { formatDisplayTimestamp } from "../tz-display";
import { TEXTAREA_MAX } from "../sanitize-core";
import type { UseScheduledJobsResult } from "../use-scheduled-jobs";
import { REPORT_ERROR_KEY, type ReportErrorToken } from "../scheduled-reports-store";
import { acceptanceState, declineJob, isEditedHere, jobFingerprint, useAcceptanceSnapshot } from "../scheduled-job-acceptance";
import { peekDeviceLabel } from "../device-label";

/** A failed run's recorded error token as text. §650 — "401"/"403" name the refused key; the
 *  token is the digit string the runner stores, so history recorded before this change reads the
 *  same way. */
function runFailureText(lang: Lang, error: string | undefined): string {
  const keyMsg = aiKeyMessageKeyForStatusToken(error);
  if (keyMsg) return t(lang, keyMsg);
  // A token this app knows reads as its translation; an unknown historic string keeps the generic line.
  if (error !== undefined && Object.hasOwn(REPORT_ERROR_KEY, error)) return t(lang, REPORT_ERROR_KEY[error as ReportErrorToken]);
  return t(lang, "scheduledJobFailed", error ?? "");
}

/** One run's outcome as a line of text: its action count, or why it failed. */
function runResultText(lang: Lang, run: ScheduledJobRun): string {
  if (run.ok) return tPlural(lang, "scheduledJobActionsN", run.actionCount, String(run.actionCount));
  return run.error === "limit" ? t(lang, "aiUsageLimitReached") : runFailureText(lang, run.error);
}

/** The fields `updateJob` accepts — exactly its patch type, so a row can never write a project or key. */
export type JobPatch = Parameters<UseScheduledJobsResult["updateJob"]>[1];

export interface ProjectOption {
  id: string;
  name: string;
}

// Weekday short labels by index (0=Sun..6=Sat), reusing the existing shift keys.
const WEEKDAY_KEYS: TranslationKey[] = [
  "shiftDaySun",
  "shiftDayMon",
  "shiftDayTue",
  "shiftDayWed",
  "shiftDayThu",
  "shiftDayFri",
  "shiftDaySat",
];

export const DEFAULT_TIME = "09:00";

interface InstructionDraft {
  jobId: number;
  draft: string;
  saved: string;
  onUpdate: (id: number, patch: JobPatch) => void;
}

/** Writes the trimmed draft when it differs from what was last saved; clearing it writes `undefined`. */
function flushInstruction(d: InstructionDraft) {
  const trimmed = d.draft.trim();
  if (trimmed === d.saved) return;
  d.saved = trimmed;
  d.onUpdate(d.jobId, { instruction: trimmed === "" ? undefined : trimmed });
}

/** The standing instruction, edited as a draft and saved (trimmed) when the field loses focus OR is unmounted
 *  (closing the dialog fires no blur on a focused node that unmounts). The caller keys it by the stored value,
 *  so a save from elsewhere starts a fresh draft. */
function InstructionField({
  lang,
  job,
  token,
  onUpdate,
}: {
  lang: Lang;
  job: ScheduledJob;
  token: string;
  onUpdate: (id: number, patch: JobPatch) => void;
}) {
  const [draft, setDraft] = useState(job.instruction ?? "");
  // What a save needs, kept current from the handlers (no ref write during render).
  const latest = useRef<InstructionDraft>({ jobId: job.id, draft, saved: draft, onUpdate });
  useEffect(() => {
    latest.current.onUpdate = onUpdate;
  });
  // The cleanup is the unmount save; a draft already saved on blur is a no-op there.
  useEffect(() => {
    const state = latest.current;
    return () => flushInstruction(state);
  }, []);

  return (
    <label className="flex flex-col gap-1 text-xs text-foreground">
      <span>{t(lang, "scheduledJobInstruction")}</span>
      <Textarea
        size="xs"
        rows={2}
        maxLength={TEXTAREA_MAX}
        value={draft}
        placeholder={t(lang, "scheduledJobInstructionPlaceholder")}
        aria-label={`${t(lang, "scheduledJobInstruction")} – ${token}`}
        onChange={(e) => {
          latest.current.draft = e.target.value;
          setDraft(e.target.value);
        }}
        onBlur={() => flushInstruction(latest.current)}
      />
    </label>
  );
}

/** Why the last answer on a row did not land: the Accept's re-read failed, the job changed elsewhere, or this device
 *  could not store the answer. */
export type AcceptNotice = "failed" | "changed" | "saveFailed";

function noop(): void {}

const ACCEPT_NOTICE_KEY: Record<AcceptNotice, TranslationKey> = {
  failed: "scheduledJobAcceptFailed",
  changed: "scheduledJobAcceptChanged",
  saveFailed: "scheduledJobAnswerSaveFailed",
};

const ACCEPTANCE_STATUS_KEY: Record<"accepted" | "declined" | "declined-changed" | "changed" | "none", TranslationKey> = {
  accepted: "scheduledJobAcceptedHere",
  declined: "scheduledJobStoppedHere",
  changed: "scheduledJobChanged",
  "declined-changed": "scheduledJobChangedElsewhere",
  none: "scheduledJobNeedsOk",
};

/** What an answer button showed when it was pressed (pointerdown). */
interface PressSnapshot {
  action: "accept" | "stop" | "decline";
  fingerprint: string;
  saving: boolean;
}

/** A pointer press answers only what it was pressed on: it is ignored when the job was saving at the press or is
 *  saving now, or when the button's action or the job's version changed between press and release. A keyboard
 *  activation (no pointerdown) is judged on the current render. */
function pressStillValid(press: PressSnapshot | null, now: PressSnapshot): boolean {
  if (press === null) return !now.saving;
  return !press.saving && !now.saving && press.action === now.action && press.fingerprint === now.fingerprint;
}

/** Keeps focus where it is (the instruction field) when an answer button is pressed with the mouse: the press must not
 *  blur the field, whose blur saves the edit and would change the version the button answers mid-press. */
function keepFocus(e: { preventDefault: () => void }): void {
  e.preventDefault();
}

/** Whether this device accepted the job, with ONE Accept / Stop button (so focus survives the switch) and where the job was made. Local only: nothing is written to the store. */
function AcceptanceLine({
  lang,
  job,
  token,
  onAccept,
  notice,
  pending,
  saving,
  onNoticeClear,
}: {
  lang: Lang;
  job: ScheduledJob;
  token: string;
  onAccept: (job: ScheduledJob) => void;
  notice: AcceptNotice | null;
  pending: boolean;
  /** A save of this job is in flight: the answer buttons cannot be used until it settles. */
  saving: boolean;
  onNoticeClear: () => void;
}) {
  useAcceptanceSnapshot(); // re-render when this device's acceptances change
  // A Stop that could not be recorded says so, until the next click.
  const [stopFailed, setStopFailed] = useState(false);
  const mainRef = useRef<HTMLButtonElement>(null);
  const state = acceptanceState(job);
  // A press answers the version shown when it was pressed. Pressing does not take focus from the instruction field,
  // so the edit is not saved by the press; it saves on the next blur and the job then asks again. While a save of this
  // job is in flight no answer can be given (see `pressStillValid` for a press that spans a save).
  const mainPress = useRef<PressSnapshot | null>(null);
  const declinePress = useRef<PressSnapshot | null>(null);
  const declineRef = useRef<HTMLButtonElement>(null);
  const fingerprint = jobFingerprint(job);
  const savingLabel = t(lang, "scheduledJobSaving");
  // A job with no project reports nothing, so there is nothing to accept; a cannot-run job has no state to show.
  const decided = state === "cannot-run" || job.projectId === null ? null : state;
  // An Accept notice never sits beside "Accepted on this device".
  // A failed Stop is shown even then: the job is still accepted precisely because the Stop did not land.
  const shown: AcceptNotice | null = stopFailed ? "saveFailed" : decided === "accepted" ? null : notice;
  // A device with no stored label cannot have created the job; peeking never writes during render.
  const createdText =
    job.createdBy === undefined
      ? null
      : job.createdBy === peekDeviceLabel()
        ? t(lang, "scheduledJobCreatedHere")
        : t(lang, "scheduledJobCreatedOn", job.createdBy);
  const accepted = decided === "accepted";
  const mainNow: PressSnapshot = { action: accepted ? "stop" : "accept", fingerprint, saving };
  const declineNow: PressSnapshot = { action: "decline", fingerprint, saving };
  const unusable = pending || saving;
  // "Changed on another device" never describes the version this tab saved (display only); a stopped job is never
  // asked to be accepted "again".
  const editedHere = (decided === "changed" || decided === "declined-changed") && isEditedHere(job);
  const statusKey: TranslationKey | null = decided === null
    ? null
    : editedHere
      ? (decided === "changed" ? "scheduledJobChangedHere" : "scheduledJobChangedHereStopped")
      : ACCEPTANCE_STATUS_KEY[decided];
  const mainName = t(lang, accepted ? "scheduledJobStopNamed" : "scheduledJobAcceptNamed", token);
  const declineName = t(lang, "scheduledJobDeclineNamed", token);
  const hasLine = decided !== null || createdText !== null;
  // The status element sits at a fixed position, outside the line, so its identity never depends on the line.
  // ONE wrapper holds the line and the status element, so the always-mounted (empty) status adds no row gap of its own.
  return (
    <div className={hasLine || shown !== null ? undefined : "-mt-2"}>
      {hasLine && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {statusKey !== null && <span>{t(lang, statusKey)}</span>}
          {decided !== null && (
            <Button
              ref={mainRef}
              // A switched-off job is not about to run, so its Accept is not the page's call to action.
              variant={accepted || !job.enabled ? "secondary" : "primary"}
              size="xs"
              // aria-disabled, never `disabled`: a disabled button drops keyboard focus.
              aria-disabled={unusable ? true : undefined}
              className="aria-disabled:cursor-wait aria-disabled:opacity-50"
              onMouseDown={keepFocus}
              onPointerDown={() => { mainPress.current = mainNow; }}
              onKeyDown={() => { mainPress.current = null; }}
              onClick={() => {
                const press = mainPress.current;
                mainPress.current = null;
                if (pending || !pressStillValid(press, mainNow)) return;
                onNoticeClear();
                setStopFailed(false);
                if (accepted) setStopFailed(!declineJob(job));
                else onAccept(job);
              }}
              // The visible "Saving…" is part of the name (label in name), and the name stays unique in the row.
              aria-label={saving ? `${savingLabel} ${mainName}` : mainName}
            >
              {saving ? savingLabel : t(lang, accepted ? "scheduledJobStop" : "scheduledJobAccept")}
            </Button>
          )}
          {(decided === "none" || decided === "changed" || decided === "declined-changed") && (
            <Button
              variant="secondary"
              size="xs"
              aria-disabled={unusable ? true : undefined}
              className="aria-disabled:cursor-wait aria-disabled:opacity-50"
              ref={declineRef}
              onMouseDown={keepFocus}
              onPointerDown={() => { declinePress.current = declineNow; }}
              onKeyDown={() => { declinePress.current = null; }}
              onClick={() => {
                const press = declinePress.current;
                declinePress.current = null;
                if (pending || !pressStillValid(press, declineNow)) return;
                // Only a focused button hands focus on (a keyboard press); a mouse press left focus where it was.
                const hadFocus = document.activeElement === declineRef.current;
                onNoticeClear();
                const declined = declineJob(job);
                setStopFailed(!declined);
                // The button is about to unmount: the main one (same element, now reading Accept) takes focus.
                if (declined && hadFocus) mainRef.current?.focus();
              }}
              aria-label={saving ? `${savingLabel} ${declineName}` : declineName}
            >
              {saving ? savingLabel : t(lang, "scheduledJobDecline")}
            </Button>
          )}
          {createdText !== null && <span>{createdText}</span>}
        </div>
      )}
      {/* Always mounted: a live region must exist before its text changes. */}
      <span role="status" className={hasLine && shown !== null ? "mt-2 block text-xs text-muted-foreground" : "text-xs text-muted-foreground"}>{shown !== null ? t(lang, ACCEPT_NOTICE_KEY[shown]) : null}</span>
    </div>
  );
}

export function JobRow({
  lang,
  job,
  token,
  busy,
  tz,
  projects,
  archivedProjects,
  projectsLoaded,
  zones,
  defaultZone,
  onUpdate,
  onAssign,
  onDelete,
  onAccept,
  acceptNotice,
  acceptPending,
  saving,
  onNoticeClear,
}: {
  lang: Lang;
  job: ScheduledJob;
  /** §715 — the zone a run's time is shown in (the stored `ranAt` is UTC). */
  tz: string;
  /** §316 — the job name made row-unique across the list; every control here is named by it. */
  token: string;
  busy: boolean;
  /** The active projects a job can report on; archived ones are not offered. */
  projects: readonly ProjectOption[];
  archivedProjects: readonly ProjectOption[];
  /** False until the project lists have been read for the current portfolio. */
  projectsLoaded: boolean;
  zones: readonly string[];
  /** The zone a newly assigned job starts in. */
  defaultZone: string;
  onUpdate: (id: number, patch: JobPatch) => void;
  onAssign: (id: number, projectId: string, timeZone: string) => void;
  onDelete: (id: number) => void;
  /** Accept the job on this device; the owner re-reads the stored job first, so a stale row never accepts what it did not show. */
  onAccept: (job: ScheduledJob) => void;
  /** Why the last Accept on this row accepted nothing, until the next Accept or Stop. */
  acceptNotice?: AcceptNotice | null;
  /** True while this row's Accept is re-reading the job. */
  acceptPending?: boolean;
  /** True while a save of this job is in flight: Accept, Stop and "Not on this device" cannot be used meanwhile. */
  saving?: boolean;
  /** Called when Accept or Stop is pressed, so the owner can clear the notice. */
  onNoticeClear?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const { cadence } = job;

  // A job a newer version made (a type or cadence this one does not know): listed read-only, never edited or run,
  // and still deletable. Its stored JSON is carried through every save untouched.
  if (job.foreign) {
    return (
      <li className="flex flex-wrap items-center gap-2 rounded-md border border-line bg-surface p-3">
        <span className="text-sm text-foreground">{job.name || token}</span>
        <span className="flex-1 text-xs text-muted-foreground">{t(lang, "scheduledJobForeign")}</span>
        <Button
          variant="destructive"
          size="xs"
          onClick={() => onDelete(job.id)}
          disabled={busy}
          aria-label={`${t(lang, "delete")} – ${token}`}
        >
          {t(lang, "delete")}
        </Button>
      </li>
    );
  }

  function setCadenceKind(kind: JobCadence["kind"]) {
    if (kind === job.cadence.kind) return;
    const next: JobCadence =
      kind === "weekly"
        ? { kind: "weekly", dayOfWeek: 0, timeOfDay: cadence.timeOfDay || DEFAULT_TIME }
        : { kind: "daily", timeOfDay: cadence.timeOfDay || DEFAULT_TIME };
    onUpdate(job.id, { cadence: next });
  }

  function setTime(timeOfDay: string) {
    // A cleared field reads "" (and would parse as 00:00, i.e. due at once): keep the stored time instead.
    if (!/^\d{2}:\d{2}$/.test(timeOfDay)) return;
    onUpdate(job.id, { cadence: { ...cadence, timeOfDay } });
  }

  function setDay(dayOfWeek: number) {
    if (cadence.kind !== "weekly") return;
    onUpdate(job.id, { cadence: { ...cadence, dayOfWeek } });
  }

  const lastRun = job.history[0] ?? null;
  const zone = job.timeZone ?? defaultZone;
  const zoneOptions = zones.includes(zone) ? zones : [zone, ...zones];
  const zoneUnset = job.timeZone === null; // a legacy job has no stored zone: the select must not pretend it has
  const archivedProject = job.projectId === null ? undefined : archivedProjects.find((p) => p.id === job.projectId);
  const projectKnown = job.projectId === null || projects.some((p) => p.id === job.projectId);

  return (
    <li className="flex flex-col gap-2 rounded-md border border-line bg-surface p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          size="xs"
          type="text"
          value={job.name}
          aria-label={`${t(lang, "scheduledJobName")} – ${token}`}
          onChange={(e) => onUpdate(job.id, { name: e.target.value })}
          className="flex-1"
        />

        <label className="flex items-center gap-1 text-xs text-foreground">
          <Checkbox
            aria-label={`${t(lang, "scheduledJobEnabled")} – ${token}`}
            checked={job.enabled}
            onChange={() => onUpdate(job.id, { enabled: !job.enabled })}
          />
          <span>{t(lang, "scheduledJobEnabled")}</span>
        </label>

        <Button
          variant="destructive"
          size="xs"
          onClick={() => onDelete(job.id)}
          disabled={busy}
          aria-label={`${t(lang, "delete")} – ${token}`}
        >
          {t(lang, "delete")}
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1 text-xs text-foreground">
          <span>{t(lang, "scheduledJobProject")}</span>
          <Select
            size="xs"
            value={job.projectId ?? ""}
            aria-label={`${t(lang, "scheduledJobProject")} – ${token}`}
            onChange={(e) => {
              if (e.target.value === "") return;
              onAssign(job.id, e.target.value, zone);
              // The runner switched it off because its project was archived; a new project brings it back.
              if (!job.enabled && archivedProject !== undefined) onUpdate(job.id, { enabled: true });
            }}
          >
            {job.projectId === null && <option value="">{t(lang, "scheduledJobChooseProject")}</option>}
            {!projectKnown && job.projectId !== null && (
              <option value={job.projectId}>{archivedProject?.name ?? (projectsLoaded ? "—" : "…")}</option>
            )}
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </label>

        <Select
          size="xs"
          value={cadence.kind}
          aria-label={`${t(lang, "scheduledJobsTitle")} – ${token}`}
          onChange={(e) => setCadenceKind(e.target.value as JobCadence["kind"])}
        >
          <option value="daily">{t(lang, "cadenceDaily")}</option>
          <option value="weekly">{t(lang, "cadenceWeekly")}</option>
        </Select>

        <label className="flex items-center gap-1 text-xs text-foreground">
          <span>{t(lang, "cadenceTime")}</span>
          <Input
            size="xs"
            type="time"
            value={cadence.timeOfDay}
            aria-label={`${t(lang, "cadenceTime")} – ${token}`}
            onChange={(e) => setTime(e.target.value)}
          />
        </label>

        {cadence.kind === "weekly" && (
          <label className="flex items-center gap-1 text-xs text-foreground">
            <span>{t(lang, "cadenceDay")}</span>
            <Select
              size="xs"
              value={cadence.dayOfWeek}
              aria-label={`${t(lang, "cadenceDay")} – ${token}`}
              onChange={(e) => setDay(Number(e.target.value))}
            >
              {WEEKDAY_KEYS.map((key, idx) => (
                <option key={key} value={idx}>
                  {t(lang, key)}
                </option>
              ))}
            </Select>
          </label>
        )}

        <label className="flex items-center gap-1 text-xs text-foreground">
          <span>{t(lang, "scheduledJobTimeZone")}</span>
          <Select
            size="xs"
            value={zoneUnset ? "" : zone}
            aria-label={`${t(lang, "scheduledJobTimeZone")} – ${token}`}
            onChange={(e) => onUpdate(job.id, { timeZone: e.target.value })}
          >
            {zoneUnset && (
              <option value="" disabled>
                {t(lang, "scheduledJobZoneUnset")}
              </option>
            )}
            {zoneOptions.map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </Select>
        </label>
      </div>

      <InstructionField key={job.instruction ?? ""} lang={lang} job={job} token={token} onUpdate={onUpdate} />

      <AcceptanceLine
        lang={lang}
        job={job}
        token={token}
        onAccept={onAccept}
        notice={acceptNotice ?? null}
        pending={acceptPending ?? false}
        saving={saving ?? false}
        onNoticeClear={onNoticeClear ?? noop}
      />

      {job.projectId === null && (
        <span className="text-xs text-muted-foreground">{t(lang, "scheduledJobChooseProject")}</span>
      )}
      {!job.enabled && archivedProject !== undefined && (
        <span className="text-xs text-muted-foreground">{t(lang, "scheduledJobArchived")}</span>
      )}
      {!job.enabled && archivedProject === undefined && job.projectId !== null && lastRun?.error === "project-archived" && (
        <span className="text-xs text-muted-foreground">{t(lang, "scheduledJobRestoredOff")}</span>
      )}

      <div className="text-xs text-muted-foreground">
        {lastRun ? (
          <span>
            {t(lang, "scheduledJobLastRun", formatDisplayTimestamp(lastRun.ranAt, tz, lang))}
            {" — "}
            {runResultText(lang, lastRun)}
          </span>
        ) : (
          <span>{t(lang, "scheduledJobNeverRun")}</span>
        )}
      </div>

      {job.history.length > 1 && (
        <div>
          <Button
            onClick={() => setExpanded((v) => !v)}
            aria-label={`${t(lang, expanded ? "showLess" : "showMore")} – ${token}`}
            variant="secondary" size="xs"
          >
            {t(lang, expanded ? "showLess" : "showMore")}
          </Button>
          {expanded && (
            <ul className="mt-2 flex flex-col gap-1">
              {job.history.slice(1).map((run, idx) => (
                <li key={`${run.ranAt}-${idx}`} className="text-xs text-muted-foreground">
                  {t(lang, "scheduledJobLastRun", formatDisplayTimestamp(run.ranAt, tz, lang))}
                  {" — "}
                  {runResultText(lang, run)}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}
