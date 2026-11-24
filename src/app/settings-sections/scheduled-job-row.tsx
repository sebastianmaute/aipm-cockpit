"use client";

// src/app/settings-sections/scheduled-job-row.tsx — one job in the Scheduled jobs list: name, enabled,
// project, cadence, time zone, standing instruction and run history (§772). Presentational: the job and the
// project lists arrive as props, every write leaves through a callback.

import { useState } from "react";
import { type Lang, t, tPlural, type TranslationKey } from "../i18n";
import { aiKeyMessageKeyForStatusToken } from "../ai-key-status";
import type { JobCadence, ScheduledJob, ScheduledJobRun } from "../scheduled-jobs/types";
import { Input, Select, Checkbox, Textarea } from "../form-controls";
import { Button } from "../button";
import { formatDisplayTimestamp } from "../tz-display";
import { TEXTAREA_MAX } from "../sanitize-core";
import { REPORT_ERROR_KEY, type ReportErrorToken } from "../scheduled-reports-store";
import { type JobUpdate, useInstructionDraft } from "./use-instruction-draft";
import { type AcceptNotice, AcceptanceLine } from "./scheduled-job-acceptance-line";

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

export type { JobPatch } from "./use-instruction-draft";
export type { AcceptNotice } from "./scheduled-job-acceptance-line";

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

function noop(): void {}

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
