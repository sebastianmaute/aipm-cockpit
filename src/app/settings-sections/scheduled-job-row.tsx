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
import type { UpdateJobOptions, UseScheduledJobsResult } from "../use-scheduled-jobs";
import { JobChangedError } from "../scheduled-jobs/schedule";
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

/** A job write from the row; the instruction draft waits for it, so a failed save keeps the draft. The draft's save
 *  passes a precondition (`UpdateJobOptions`) so it never writes over a change made elsewhere. */
type JobUpdate = (id: number, patch: JobPatch, options?: UpdateJobOptions) => Promise<void> | void;

/** Where the instruction draft stands against the stored job: in step, kept after a failed save (`notSaved`), or
 *  dropped because its save found the job changed elsewhere (`dropped`). */
export type DraftStatus = "ok" | "notSaved" | "dropped";

/** What a draft save needs, kept current by the handlers and an effect (never written during render). */
interface DraftRefs {
  latest: { current: { jobId: number; draft: string; base: string; onUpdate: JobUpdate } };
  /** Texts this row has sent and not yet seen settle, oldest first. */
  pending: { current: readonly string[] };
  mounted: { current: boolean };
  setStatus: (update: (s: DraftStatus) => DraftStatus) => void;
  setDraft: (value: string) => void;
  setBase: (value: string) => void;
}

/** Saves the trimmed draft when it differs from what the store will hold (the text the draft started from, or the
 *  last text this row is still saving). The save is conditional: it writes only while the stored instruction is the
 *  text the draft started from or one this row is saving, so it never overwrites another device's change; a refused
 *  save drops the draft and says so. The draft counts as saved only once the write succeeds: a failed save keeps it
 *  ("not saved", while it still differs) and the next blur retries. */
function flushDraft(r: DraftRefs): void {
  const d = r.latest.current;
  const typed = d.draft.trim();
  const expected = r.pending.current.length > 0 ? r.pending.current[r.pending.current.length - 1] : d.base;
  if (typed === expected) {
    if (r.pending.current.length === 0) r.setStatus((st) => (st === "notSaved" ? "ok" : st));
    return;
  }
  const allowed = [d.base, ...r.pending.current];
  r.pending.current = [...r.pending.current, typed];
  const settle = () => {
    const sent = r.pending.current.indexOf(typed);
    r.pending.current = r.pending.current.filter((_, i) => i !== sent);
  };
  Promise.resolve(d.onUpdate(d.jobId, { instruction: typed === "" ? undefined : typed }, { ifInstructionIn: allowed })).then(
    () => {
      settle();
      r.latest.current = { ...r.latest.current, base: typed };
      if (!r.mounted.current) return;
      r.setBase(typed);
      r.setStatus((st) => (st === "notSaved" ? "ok" : st));
    },
    (err: unknown) => {
      settle();
      if (err instanceof JobChangedError) {
        // Another device changed the job since the draft started: drop the draft, never write over that change.
        r.latest.current = { ...r.latest.current, draft: err.stored, base: err.stored };
        if (!r.mounted.current) return;
        r.setDraft(err.stored);
        r.setBase(err.stored);
        r.setStatus(() => "dropped");
        return;
      }
      const now = r.latest.current;
      if (r.mounted.current && now.draft.trim() !== now.base) r.setStatus(() => "notSaved");
    },
  );
}

/** The standing instruction as a draft against the stored job. It saves on blur and on unmount (closing the dialog
 *  fires no blur on a focused node that unmounts); see `flushDraft`. When the stored instruction changes and the field
 *  holds no unsaved change, the draft follows the store; an unsaved draft is kept, and its conditional save decides. */
function useInstructionDraft(job: ScheduledJob, onUpdate: JobUpdate) {
  const stored = job.instruction ?? "";
  const [draft, setDraft] = useState(stored);
  const [base, setBase] = useState(stored);
  const [seen, setSeen] = useState(stored);
  const [status, setStatus] = useState<DraftStatus>("ok");
  if (stored !== seen) {
    setSeen(stored);
    if (draft.trim() === base) {
      setDraft(stored);
      setBase(stored);
    }
  }
  const latest = useRef({ jobId: job.id, draft, base, onUpdate });
  const pending = useRef<readonly string[]>([]);
  const mounted = useRef(true);
  useEffect(() => {
    latest.current = { jobId: job.id, draft, base, onUpdate };
  });
  useEffect(() => {
    mounted.current = true;
    const refs: DraftRefs = { latest, pending, mounted, setStatus, setDraft, setBase };
    return () => {
      mounted.current = false;
      flushDraft(refs);
    };
  }, []);
  return {
    draft,
    status,
    onChange: (value: string) => {
      latest.current = { ...latest.current, draft: value };
      setDraft(value);
      // A draft typed back to the stored text has nothing left unsaved; a new edit ends the dropped notice.
      setStatus((st) => (value.trim() === base || st === "dropped" ? "ok" : st));
    },
    onBlur: () => flushDraft({ latest, pending, mounted, setStatus, setDraft, setBase }),
    clearDropped: () => setStatus((st) => (st === "dropped" ? "ok" : st)),
  };
}

/** The standing instruction field: presentational, the draft lives in `useInstructionDraft`. */
function InstructionField({
  lang,
  token,
  value,
  onChange,
  onBlur,
}: {
  lang: Lang;
  token: string;
  value: string;
  onChange: (value: string) => void;
  onBlur: () => void;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs text-foreground">
      <span>{t(lang, "scheduledJobInstruction")}</span>
      <Textarea
        size="xs"
        rows={2}
        maxLength={TEXTAREA_MAX}
        value={value}
        placeholder={t(lang, "scheduledJobInstructionPlaceholder")}
        aria-label={`${t(lang, "scheduledJobInstruction")} – ${token}`}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
      />
    </label>
  );
}

/** Why the last answer on a row did not land: the Accept's re-read failed, the job changed elsewhere, or this device
 *  could not store the answer. */
export type AcceptNotice = "failed" | "changed" | "saveFailed" | "pressIgnored" | "changeNotSaved" | "draftDropped";

function noop(): void {}

const ACCEPT_NOTICE_KEY: Record<AcceptNotice, TranslationKey> = {
  failed: "scheduledJobAcceptFailed",
  changed: "scheduledJobAcceptChanged",
  saveFailed: "scheduledJobAnswerSaveFailed",
  pressIgnored: "scheduledJobPressIgnored",
  changeNotSaved: "scheduledJobChangeNotSaved",
  draftDropped: "scheduledJobDraftDropped",
};

const ACCEPTANCE_STATUS_KEY: Record<"accepted" | "declined" | "declined-changed" | "changed" | "none", TranslationKey> = {
  accepted: "scheduledJobAcceptedHere",
  declined: "scheduledJobStoppedHere",
  changed: "scheduledJobChanged",
  "declined-changed": "scheduledJobChangedElsewhere",
  none: "scheduledJobNeedsOk",
};

/** What an answer button showed when it was pressed (pointerdown, or keydown of Space / Enter). */
interface PressSnapshot {
  action: "accept" | "stop" | "decline";
  fingerprint: string;
  saving: boolean;
}

/** A press answers only what it was pressed on: it is ignored when the job was saving at the press or is saving now,
 *  or when the button's action or the job's version changed between press and release. An activation with no press
 *  (a screen reader's click) is judged on the current render. */
function pressStillValid(press: PressSnapshot | null, now: PressSnapshot): boolean {
  if (press === null) return !now.saving;
  return !press.saving && !now.saving && press.action === now.action && press.fingerprint === now.fingerprint;
}

/** An ignored press is silent only when the button visibly could not be used for the whole press (no press recorded
 *  and blocked now, or blocked both at the press and now); otherwise the job changed under it, and the row says so. */
function ignoredSilently(press: PressSnapshot | null, now: PressSnapshot): boolean {
  return press === null ? now.saving : press.saving && now.saving;
}

/** Records what an answer button showed when it was pressed — by pointer, or by Space / Enter (Space clicks on keyup,
 *  so a held Space spans renders just like a held pointer) — and hands it to the click. A press that is cancelled,
 *  leaves the button before release, or a button that loses focus leaves nothing behind, so a stale press never
 *  swallows a later activation. */
function usePressGuard(now: PressSnapshot) {
  const press = useRef<{ snapshot: PressSnapshot; held: boolean } | null>(null);
  // A held Enter / Space repeats: those repeats never answer (the first press already did, or will on release).
  const repeating = useRef(false);
  const forget = () => { press.current = null; };
  const forgetIfHeld = () => { if (press.current?.held) press.current = null; };
  const handlers = {
    onPointerDown: () => { press.current = { snapshot: now, held: true }; },
    onPointerUp: () => { if (press.current) press.current = { ...press.current, held: false }; },
    onPointerCancel: forget,
    onPointerLeave: forgetIfHeld,
    onLostPointerCapture: forgetIfHeld,
    onBlur: () => { press.current = null; repeating.current = false; },
    onKeyDown: (e: { key: string; repeat: boolean; preventDefault: () => void }) => {
      if (e.key !== " " && e.key !== "Enter") return;
      if (e.repeat) {
        e.preventDefault();
        repeating.current = true;
        return;
      }
      press.current = { snapshot: now, held: false };
    },
    onKeyUp: () => { repeating.current = false; },
  };
  /** Whether a click comes from a key that is being held (repeating): ignored, silently. */
  const isRepeat = (): boolean => repeating.current;
  /** The press the current click completes (or null), consumed. */
  const takePress = (): PressSnapshot | null => {
    const taken = press.current?.snapshot ?? null;
    press.current = null;
    return taken;
  };
  return { handlers, takePress, isRepeat };
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
  draftStatus,
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
  /** The instruction draft against the stored job: after a failed save the buttons cannot be used either. */
  draftStatus: DraftStatus;
  onNoticeClear: () => void;
}) {
  useAcceptanceSnapshot(); // re-render when this device's acceptances change
  // A Stop that could not be recorded says so, until the next click.
  const [stopFailed, setStopFailed] = useState(false);
  // A press the press check ignored because the job changed while it was held says so, until the next answer.
  const [pressIgnored, setPressIgnored] = useState(false);
  const mainRef = useRef<HTMLButtonElement>(null);
  const state = acceptanceState(job);
  // A press answers the version shown when it was pressed. Pressing does not take focus from the instruction field,
  // so the edit is not saved by the press; it saves on the next blur and the job then asks again. While a save of this
  // job is in flight no answer can be given (see `pressStillValid` for a press that spans a save).
  const declineRef = useRef<HTMLButtonElement>(null);
  const fingerprint = jobFingerprint(job);
  const notSaved = draftStatus === "notSaved";
  // The field shows a version the buttons would not answer: blocked like a save in flight, and labelled as such.
  const blocked = saving || notSaved;
  const blockedLabel = t(lang, saving ? "scheduledJobSaving" : "scheduledJobNotSaved");
  // A job with no project reports nothing, so there is nothing to accept; a cannot-run job has no state to show.
  const decided = state === "cannot-run" || job.projectId === null ? null : state;
  // An Accept notice never sits beside "Accepted on this device".
  // A failed Stop is shown even then: the job is still accepted precisely because the Stop did not land.
  const draftNotice: AcceptNotice | null = notSaved ? "changeNotSaved" : draftStatus === "dropped" ? "draftDropped" : null;
  // Draft notices outrank an ignored press, which is stale once the job's version or the draft changed.
  const pressContext = `${jobFingerprint(job)}|${draftStatus}`;
  const [seenPressContext, setSeenPressContext] = useState(pressContext);
  if (pressContext !== seenPressContext) {
    setSeenPressContext(pressContext);
    setPressIgnored(false);
  }
  const shown: AcceptNotice | null = stopFailed
    ? "saveFailed"
    : draftNotice ?? (pressIgnored ? "pressIgnored" : decided === "accepted" ? null : notice);
  // A device with no stored label cannot have created the job; peeking never writes during render.
  const createdText =
    job.createdBy === undefined
      ? null
      : job.createdBy === peekDeviceLabel()
        ? t(lang, "scheduledJobCreatedHere")
        : t(lang, "scheduledJobCreatedOn", job.createdBy);
  const accepted = decided === "accepted";
  const mainNow: PressSnapshot = { action: accepted ? "stop" : "accept", fingerprint, saving: blocked };
  const declineNow: PressSnapshot = { action: "decline", fingerprint, saving: blocked };
  const unusable = pending || blocked;
  const mainGuard = usePressGuard(mainNow);
  const declineGuard = usePressGuard(declineNow);
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
              {...mainGuard.handlers}
              onClick={() => {
                const press = mainGuard.takePress();
                if (pending || mainGuard.isRepeat()) return;
                if (!pressStillValid(press, mainNow)) {
                  if (!ignoredSilently(press, mainNow)) setPressIgnored(true);
                  return;
                }
                setPressIgnored(false);
                onNoticeClear();
                setStopFailed(false);
                if (accepted) setStopFailed(!declineJob(job));
                else onAccept(job);
              }}
              // The visible "Saving…" is part of the name (label in name), and the name stays unique in the row.
              aria-label={blocked ? `${blockedLabel} ${mainName}` : mainName}
            >
              {blocked ? blockedLabel : t(lang, accepted ? "scheduledJobStop" : "scheduledJobAccept")}
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
              {...declineGuard.handlers}
              onClick={() => {
                const press = declineGuard.takePress();
                if (pending || declineGuard.isRepeat()) return;
                if (!pressStillValid(press, declineNow)) {
                  if (!ignoredSilently(press, declineNow)) setPressIgnored(true);
                  return;
                }
                setPressIgnored(false);
                // Only a focused button hands focus on (a keyboard press); a mouse press left focus where it was.
                const hadFocus = document.activeElement === declineRef.current;
                onNoticeClear();
                const declined = declineJob(job);
                setStopFailed(!declined);
                // The button is about to unmount: the main one (same element, now reading Accept) takes focus.
                if (declined && hadFocus) mainRef.current?.focus();
              }}
              aria-label={blocked ? `${blockedLabel} ${declineName}` : declineName}
            >
              {blocked ? blockedLabel : t(lang, "scheduledJobDecline")}
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
  onUpdate: JobUpdate;
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
  const instruction = useInstructionDraft(job, onUpdate);
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

      <InstructionField lang={lang} token={token} value={instruction.draft} onChange={instruction.onChange} onBlur={instruction.onBlur} />

      <AcceptanceLine
        lang={lang}
        job={job}
        token={token}
        onAccept={onAccept}
        notice={acceptNotice ?? null}
        pending={acceptPending ?? false}
        saving={saving ?? false}
        draftStatus={instruction.status}
        onNoticeClear={() => {
          (onNoticeClear ?? noop)();
          instruction.clearDropped();
        }}
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
