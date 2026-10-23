"use client";

// src/app/settings-sections/scheduled-job-row.tsx — one job in the Scheduled jobs list: name, enabled,
// project, cadence, time zone, standing instruction and run history (§772). Presentational: the job and the
// project lists arrive as props, every write leaves through a callback.

import { useState } from "react";
import { type Lang, t, tPlural, type TranslationKey } from "../i18n";
import { aiKeyMessageKeyForStatusToken } from "../ai-key-status";
import type { JobCadence, ScheduledJob } from "../scheduled-jobs/types";
import { Input, Select, Checkbox, Textarea } from "../form-controls";
import { Button } from "../button";
import { formatDisplayTimestamp } from "../tz-display";
import { TEXTAREA_MAX } from "../sanitize-core";
import type { UseScheduledJobsResult } from "../use-scheduled-jobs";

/** A failed run's recorded error token as text. §650 — "401"/"403" name the refused key; the
 *  token is the digit string the runner stores, so history recorded before this change reads the
 *  same way. */
function runFailureText(lang: Lang, error: string | undefined): string {
  const keyMsg = aiKeyMessageKeyForStatusToken(error);
  return keyMsg ? t(lang, keyMsg) : t(lang, "scheduledJobFailed", error ?? "");
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

/** The standing instruction, edited as a draft and saved (trimmed) when the field loses focus. The caller keys it
 *  by the stored value, so a save from elsewhere starts a fresh draft. */
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

  function save() {
    const trimmed = draft.trim();
    if (trimmed === (job.instruction ?? "")) return;
    onUpdate(job.id, { instruction: trimmed === "" ? undefined : trimmed });
  }

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
        onChange={(e) => setDraft(e.target.value)}
        onBlur={save}
      />
    </label>
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
  zones,
  defaultZone,
  onUpdate,
  onAssign,
  onDelete,
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
  zones: readonly string[];
  /** The zone a newly assigned job starts in. */
  defaultZone: string;
  onUpdate: (id: number, patch: JobPatch) => void;
  onAssign: (id: number, projectId: string, timeZone: string) => void;
  onDelete: (id: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const { cadence } = job;

  function setCadenceKind(kind: JobCadence["kind"]) {
    if (kind === job.cadence.kind) return;
    const next: JobCadence =
      kind === "weekly"
        ? { kind: "weekly", dayOfWeek: 0, timeOfDay: cadence.timeOfDay || DEFAULT_TIME }
        : { kind: "daily", timeOfDay: cadence.timeOfDay || DEFAULT_TIME };
    onUpdate(job.id, { cadence: next });
  }

  function setTime(timeOfDay: string) {
    onUpdate(job.id, { cadence: { ...cadence, timeOfDay } });
  }

  function setDay(dayOfWeek: number) {
    if (cadence.kind !== "weekly") return;
    onUpdate(job.id, { cadence: { ...cadence, dayOfWeek } });
  }

  const lastRun = job.history[0] ?? null;
  const zone = job.timeZone ?? defaultZone;
  const zoneOptions = zones.includes(zone) ? zones : [zone, ...zones];
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
              if (e.target.value !== "") onAssign(job.id, e.target.value, zone);
            }}
          >
            {job.projectId === null && <option value="">{t(lang, "scheduledJobChooseProject")}</option>}
            {!projectKnown && job.projectId !== null && (
              <option value={job.projectId}>{archivedProject?.name ?? job.projectId}</option>
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
            value={zone}
            aria-label={`${t(lang, "scheduledJobTimeZone")} – ${token}`}
            onChange={(e) => onUpdate(job.id, { timeZone: e.target.value })}
          >
            {zoneOptions.map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </Select>
        </label>
      </div>

      <InstructionField key={job.instruction ?? ""} lang={lang} job={job} token={token} onUpdate={onUpdate} />

      {job.projectId === null && (
        <span className="text-xs text-muted-foreground">{t(lang, "scheduledJobChooseProject")}</span>
      )}
      {!job.enabled && archivedProject !== undefined && (
        <span className="text-xs text-muted-foreground">{t(lang, "scheduledJobArchived")}</span>
      )}

      <div className="text-xs text-muted-foreground">
        {lastRun ? (
          <span>
            {t(lang, "scheduledJobLastRun", formatDisplayTimestamp(lastRun.ranAt, tz, lang))}
            {" — "}
            {lastRun.ok
              ? tPlural(lang, "scheduledJobActionsN", lastRun.actionCount, String(lastRun.actionCount))
              : lastRun.error === "limit"
                ? t(lang, "aiUsageLimitReached")
                : runFailureText(lang, lastRun.error)}
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
                  {run.ok
                    ? tPlural(lang, "scheduledJobActionsN", run.actionCount, String(run.actionCount))
                    : run.error === "limit"
                      ? t(lang, "aiUsageLimitReached")
                      : runFailureText(lang, run.error)}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}
