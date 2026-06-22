"use client";

// src/app/settings-sections/scheduled-jobs-section.tsx — SP5 Settings UI for
// scheduled Claude jobs. Mirrors ai-section's toggle pattern (read/write the
// ai.* flag through onChange) and comm-templates-section's self-instantiated,
// config-gated hook. The job UI is gated on (a) a configured Anthropic key and
// (b) the opt-in master toggle. The hook (useScheduledJobs) owns persistence;
// this surface is presentation + a thin cadence/history editor.

import { useState } from "react";
import { type Lang, t, type TranslationKey } from "../i18n";
import type { Settings } from "../settings-types";
import type { TursoConfig } from "../turso-config";
import { useScheduledJobs } from "../use-scheduled-jobs";
import type { JobCadence, ScheduledJob } from "../scheduled-jobs/types";
import { FOCUS_RING, TRANSITION, INTERACTIVE } from "../interaction-styles";

export interface ScheduledJobsSectionProps {
  lang: Lang;
  settings: Settings;
  onChange: (s: Settings) => void;
  config: TursoConfig | null;
}

const INPUT_CLASS =
  `rounded-md border border-line bg-surface px-2 py-1 text-sm text-foreground focus:border-line focus:outline-none ${FOCUS_RING} ${TRANSITION}`;

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

const DEFAULT_TIME = "09:00";

function defaultDailyCadence(): JobCadence {
  return { kind: "daily", timeOfDay: DEFAULT_TIME };
}

function JobRow({
  lang,
  job,
  busy,
  onUpdate,
  onDelete,
}: {
  lang: Lang;
  job: ScheduledJob;
  busy: boolean;
  onUpdate: (id: number, patch: Partial<Omit<ScheduledJob, "id">>) => void;
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

  return (
    <li className="flex flex-col gap-2 rounded-md border border-line bg-surface p-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={job.name}
          aria-label={`${t(lang, "scheduledJobName")} – ${job.name}`}
          onChange={(e) => onUpdate(job.id, { name: e.target.value })}
          className={`flex-1 ${INPUT_CLASS}`}
        />

        <label className="flex items-center gap-1 text-xs text-foreground">
          <input
            type="checkbox"
            aria-label={`${t(lang, "scheduledJobEnabled")} – ${job.name}`}
            checked={job.enabled}
            onChange={() => onUpdate(job.id, { enabled: !job.enabled })}
          />
          <span>{t(lang, "scheduledJobEnabled")}</span>
        </label>

        <button
          type="button"
          onClick={() => onDelete(job.id)}
          disabled={busy}
          aria-label={`${t(lang, "delete")} – ${job.name}`}
          className={`rounded-md border border-line bg-surface px-2 py-1 text-xs font-medium text-AIPM-pink-strong hover:bg-surface-muted disabled:opacity-50 ${INTERACTIVE}`}
        >
          {t(lang, "delete")}
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select
          value={cadence.kind}
          aria-label={`${t(lang, "scheduledJobsTitle")} – ${job.name}`}
          onChange={(e) => setCadenceKind(e.target.value as JobCadence["kind"])}
          className={INPUT_CLASS}
        >
          <option value="daily">{t(lang, "cadenceDaily")}</option>
          <option value="weekly">{t(lang, "cadenceWeekly")}</option>
        </select>

        <label className="flex items-center gap-1 text-xs text-foreground">
          <span>{t(lang, "cadenceTime")}</span>
          <input
            type="time"
            value={cadence.timeOfDay}
            aria-label={`${t(lang, "cadenceTime")} – ${job.name}`}
            onChange={(e) => setTime(e.target.value)}
            className={INPUT_CLASS}
          />
        </label>

        {cadence.kind === "weekly" && (
          <label className="flex items-center gap-1 text-xs text-foreground">
            <span>{t(lang, "cadenceDay")}</span>
            <select
              value={cadence.dayOfWeek}
              aria-label={`${t(lang, "cadenceDay")} – ${job.name}`}
              onChange={(e) => setDay(Number(e.target.value))}
              className={INPUT_CLASS}
            >
              {WEEKDAY_KEYS.map((key, idx) => (
                <option key={key} value={idx}>
                  {t(lang, key)}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      <div className="text-xs text-muted-foreground">
        {lastRun ? (
          <span>
            {t(lang, "scheduledJobLastRun", lastRun.ranAt)}
            {" — "}
            {lastRun.ok
              ? t(lang, "scheduledJobActionsN", String(lastRun.actionCount))
              : t(lang, "scheduledJobFailed", lastRun.error ?? "")}
          </span>
        ) : (
          <span>{t(lang, "scheduledJobNeverRun")}</span>
        )}
      </div>

      {job.history.length > 1 && (
        <div>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-label={`${t(lang, expanded ? "showLess" : "showMore")} – ${job.name}`}
            className={`rounded-md border border-line bg-surface px-2 py-0.5 text-xs font-medium text-foreground hover:bg-surface-muted ${INTERACTIVE}`}
          >
            {t(lang, expanded ? "showLess" : "showMore")}
          </button>
          {expanded && (
            <ul className="mt-2 flex flex-col gap-1">
              {job.history.slice(1).map((run, idx) => (
                <li key={`${run.ranAt}-${idx}`} className="text-xs text-muted-foreground">
                  {t(lang, "scheduledJobLastRun", run.ranAt)}
                  {" — "}
                  {run.ok
                    ? t(lang, "scheduledJobActionsN", String(run.actionCount))
                    : t(lang, "scheduledJobFailed", run.error ?? "")}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}

export function ScheduledJobsSection({ lang, settings, onChange, config }: ScheduledJobsSectionProps) {
  const { jobs, busy, createJob, updateJob, deleteJob } = useScheduledJobs({ config });

  const enabled = settings.ai.scheduledJobs === true;
  const hasKey = settings.ai.apiKey.trim().length > 0;

  function toggleEnabled() {
    onChange({ ...settings, ai: { ...settings.ai, scheduledJobs: !enabled } });
  }

  function addJob() {
    void createJob({
      name: t(lang, "scheduledJobsTitle"),
      cadence: defaultDailyCadence(),
      enabled: true,
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div>
        <p className="text-sm font-medium text-foreground">{t(lang, "scheduledJobsTitle")}</p>
        <p className="mt-1 text-xs text-muted-foreground">{t(lang, "scheduledJobsHelp")}</p>
      </div>

      {!hasKey ? (
        <p className="rounded-md border border-line bg-surface p-3 text-xs text-muted-foreground">
          {t(lang, "emptyStateConfigAi")}
        </p>
      ) : (
        <>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              aria-label={t(lang, "scheduledJobsToggle")}
              checked={enabled}
              onChange={toggleEnabled}
            />
            <span className="text-xs text-foreground">{t(lang, "scheduledJobsToggle")}</span>
          </label>
          <p className="text-xs text-muted-foreground">{t(lang, "scheduledJobsCostNote")}</p>

          {enabled && (
            <>
              <ul className="flex flex-col gap-2">
                {jobs.map((job) => (
                  <JobRow
                    key={job.id}
                    lang={lang}
                    job={job}
                    busy={busy}
                    onUpdate={(id, patch) => void updateJob(id, patch)}
                    onDelete={(id) => void deleteJob(id)}
                  />
                ))}
              </ul>

              <button
                type="button"
                onClick={addJob}
                disabled={busy}
                className={`self-start rounded-md border border-line bg-AIPM-green px-3 py-1.5 text-xs font-medium text-foreground disabled:opacity-50 ${INTERACTIVE}`}
              >
                {t(lang, "scheduledJobsAdd")}
              </button>

              <p className="text-xs text-muted-foreground">{t(lang, "scheduledJobsBgNote")}</p>
            </>
          )}
        </>
      )}
    </div>
  );
}
