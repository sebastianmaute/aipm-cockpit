"use client";

// src/app/settings-sections/scheduled-job-acceptance-line.tsx — a scheduled job's acceptance on this device: the status,
// ONE Accept / Stop button, "Not on this device", and the press guard that makes a press answer only what it was
// pressed on. Extracted from scheduled-job-row.tsx unchanged.
import { useRef, useState } from "react";
import { type Lang, t, type TranslationKey } from "../i18n";
import type { ScheduledJob } from "../scheduled-jobs/types";
import { Button } from "../button";
import { acceptanceState, declineJob, isEditedHere, jobFingerprint, useAcceptanceSnapshot } from "../scheduled-job-acceptance";
import { peekDeviceLabel } from "../device-label";
import type { DraftStatus } from "./use-instruction-draft";

/** Why the last answer on a row did not land: the Accept's re-read failed, the job changed elsewhere, or this device
 *  could not store the answer. */
export type AcceptNotice = "failed" | "changed" | "saveFailed" | "pressIgnored" | "changeNotSaved" | "draftDropped" | "lostNotSaved";

const ACCEPT_NOTICE_KEY: Record<AcceptNotice, TranslationKey> = {
  failed: "scheduledJobAcceptFailed",
  changed: "scheduledJobAcceptChanged",
  saveFailed: "scheduledJobAnswerSaveFailed",
  pressIgnored: "scheduledJobPressIgnored",
  changeNotSaved: "scheduledJobChangeNotSaved",
  draftDropped: "scheduledJobDraftDropped",
  lostNotSaved: "scheduledJobLostNotSaved",
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
export function AcceptanceLine({
  lang,
  job,
  scope,
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
  /** The portfolio this device's answers are kept for (`acceptanceScope`). */
  scope: string;
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
  const state = acceptanceState(job, scope);
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
  const draftNotice: AcceptNotice | null = notSaved
    ? "changeNotSaved"
    : draftStatus === "dropped"
      ? "draftDropped"
      : draftStatus === "lostNotSaved"
        ? "lostNotSaved"
        : null;
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
  const editedHere = (decided === "changed" || decided === "declined-changed") && isEditedHere(job, scope);
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
                if (accepted) setStopFailed(!declineJob(job, scope));
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
                const declined = declineJob(job, scope);
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
