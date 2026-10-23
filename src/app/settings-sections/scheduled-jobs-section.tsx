"use client";

// src/app/settings-sections/scheduled-jobs-section.tsx — SP5 Settings UI for
// scheduled Claude jobs. Mirrors ai-section's toggle pattern (read/write the
// ai.* flag through onChange) and comm-templates-section's self-instantiated,
// config-gated hook. The job UI is gated on (a) a configured Anthropic key,
// (b) the opt-in master toggle and (c) the Turso portfolio, because a report is
// about one STORED project (§772). The hook (useScheduledJobs) owns persistence;
// this surface is presentation + project / zone / instruction / cadence editing.
// It reads the project lists itself (never through usePortfolioProjects, which
// follows the OPEN portfolio) so the picker works from any view.

import { useEffect, useMemo, useState } from "react";
import { type Lang, t } from "../i18n";
import { FieldHint } from "../field-hint";
import { isAiEnabled, type Settings } from "../settings-types";
import type { TursoConfig } from "../turso-config";
import { useScheduledJobs } from "../use-scheduled-jobs";
import type { JobCadence, ScheduledJob } from "../scheduled-jobs/types";
import { Checkbox } from "../form-controls";
import { useRowTokens } from "../use-row-tokens";
import { Button } from "../button";
import { useDisplayTzOrBrowser } from "../display-timezone-context";
import { loadCurrentTursoProjectId, loadPortfolioMode } from "../portfolio-mode";
import { listProjectRefs } from "../turso-portfolio";
import { resolveTimezone, tzZones } from "../timezone";
import { DEFAULT_TIME, JobRow, type ProjectOption } from "./scheduled-job-row";

export interface ScheduledJobsSectionProps {
  lang: Lang;
  settings: Settings;
  onChange: (s: Settings) => void;
  config: TursoConfig | null;
}

function defaultDailyCadence(): JobCadence {
  return { kind: "daily", timeOfDay: DEFAULT_TIME };
}

const nameOfJob = (job: ScheduledJob) => job.name;

interface ProjectLists {
  active: ProjectOption[];
  archived: ProjectOption[];
  /** False until read for the CURRENT config. */
  loaded: boolean;
  failed: boolean;
}

const NO_PROJECTS: ProjectLists = { active: [], archived: [], loaded: false, failed: false };

/** The active and archived projects of the Turso portfolio. Each result carries the config it was read for, so the
 *  lists of another portfolio are never offered while the new read is in flight; a failed read is reported. */
function useProjectLists(config: TursoConfig | null, available: boolean): ProjectLists {
  const [read, setRead] = useState<{ config: TursoConfig | null; lists: ProjectLists } | null>(null);
  useEffect(() => {
    if (!available) return;
    let cancelled = false;
    void (async () => {
      try {
        const { active, archived } = await listProjectRefs(config);
        if (!cancelled) {
          setRead({ config, lists: { active, archived, loaded: true, failed: false } });
        }
      } catch {
        if (!cancelled) setRead({ config, lists: { ...NO_PROJECTS, failed: true } });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [config, available]);
  return available && read !== null && read.config === config ? read.lists : NO_PROJECTS;
}

export function ScheduledJobsSection({ lang, settings, onChange, config }: ScheduledJobsSectionProps) {
  const { jobs, busy, createJob, updateJob, deleteJob, assignProject } = useScheduledJobs({ config });
  // §316 — every new job starts with the same default name.
  const jobTokens = useRowTokens(jobs, nameOfJob);
  const tz = useDisplayTzOrBrowser();
  const portfolioAvailable = config !== null && loadPortfolioMode() === "turso";
  const projects = useProjectLists(config, portfolioAvailable);
  const zones = useMemo(() => tzZones(), []);
  // A job's cadence is read in its own zone; a new or newly assigned one starts in the device's.
  const defaultZone = resolveTimezone(settings.timezone, undefined);

  const enabled = settings.ai.scheduledJobs === true;
  const hasKey = isAiEnabled(settings.ai);
  // A LEGACY job predates §772: it carries no permanent key. A job added now has one (createJob mints it) and
  // only lacks a project, which its own row says.
  const hasLegacyJob = jobs.some((j) => j.key === null);

  function toggleEnabled() {
    onChange({ ...settings, ai: { ...settings.ai, scheduledJobs: !enabled } });
  }

  function addJob() {
    // A new job reports on the project that is open in the portfolio, else the first active one; with no active
    // project it is created without one and its row says "Choose a project".
    const openId = loadCurrentTursoProjectId();
    const projectId = (projects.active.find((p) => p.id === openId) ?? projects.active[0])?.id;
    void createJob({
      name: t(lang, "scheduledJobsTitle"),
      cadence: defaultDailyCadence(),
      enabled: true,
      timeZone: defaultZone,
      ...(projectId !== undefined ? { projectId } : {}),
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div>
        <p className="text-sm font-medium text-foreground">{t(lang, "scheduledJobsTitle")}</p>
        <FieldHint className="mt-1">{t(lang, "scheduledJobsHelp")}</FieldHint>
      </div>

      {!portfolioAvailable ? (
        <p className="rounded-md border border-line bg-surface p-3 text-xs text-muted-foreground">
          {t(lang, "scheduledJobsNeedPortfolio")}
        </p>
      ) : !hasKey ? (
        <p className="rounded-md border border-line bg-surface p-3 text-xs text-muted-foreground">
          {t(lang, "emptyStateConfigAi")}
        </p>
      ) : (
        <>
          {hasLegacyJob && <FieldHint>{t(lang, "scheduledJobsUpgradeNote")}</FieldHint>}
          <label className="flex items-center gap-2">
            <Checkbox
              aria-label={t(lang, "scheduledJobsToggle")}
              checked={enabled}
              onChange={toggleEnabled}
            />
            <span className="text-xs text-foreground">{t(lang, "scheduledJobsToggle")}</span>
          </label>
          <FieldHint>{t(lang, "scheduledJobsCostNote")}</FieldHint>

          {enabled && (
            <>
              {projects.failed && <FieldHint>{t(lang, "tursoPickerError")}</FieldHint>}

              <ul className="flex flex-col gap-2">
                {jobs.map((job) => (
                  <JobRow
                    key={job.id}
                    lang={lang}
                    job={job}
                    token={jobTokens.get(job.id) ?? job.name}
                    busy={busy}
                    tz={tz}
                    projects={projects.active}
                    archivedProjects={projects.archived}
                    projectsLoaded={projects.loaded}
                    zones={zones}
                    defaultZone={defaultZone}
                    // The permanent key rides along, so a write can only reach THIS portfolio's job (ids collide across portfolios).
                    onUpdate={(id, patch) => void updateJob(id, patch, job.key ?? undefined)}
                    onAssign={(id, projectId, timeZone) => void assignProject(id, projectId, timeZone, job.key ?? undefined)}
                    onDelete={(id) => void deleteJob(id, job.key ?? undefined)}
                  />
                ))}
              </ul>

              <Button variant="accent" size="xs" onClick={addJob} disabled={busy || !(projects.loaded || projects.failed)} className="self-start">
                {t(lang, "scheduledJobsAdd")}
              </Button>

              <FieldHint>{t(lang, "scheduledJobsBgNote")}</FieldHint>
            </>
          )}
        </>
      )}
    </div>
  );
}
