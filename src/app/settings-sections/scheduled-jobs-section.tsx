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

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { isBackgroundOffForced } from "../ai-project-switches";
import { type Lang, t, tPlural } from "../i18n";
import { FieldHint } from "../field-hint";
import { isAiBackgroundEnabled, isAiEnabled, type Settings } from "../settings-types";
import { aiDeploymentBlockedMessageKey } from "../ai-deployment";
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
import { type AcceptNotice, DEFAULT_TIME, JobRow, type ProjectOption } from "./scheduled-job-row";
import { Banner } from "../banner";
import { isRunnable, JobChangedError, JobGoneError, JobNotEditableError, JobSourceChangedError, jobSaveId } from "../scheduled-jobs/schedule";
import { acceptanceScope, acceptanceState, acceptJob, jobFingerprint, storedAcceptanceEntry, useAcceptanceSnapshot } from "../scheduled-job-acceptance";

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
  const { jobs, jobsSource, failedSource, busy, createJob, updateJob, deleteJob, assignProject, refresh, readFresh, savingJobs } =
    useScheduledJobs({ config, refreshOnFocus: true, trackSaving: true });
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
  // The deployment's AI setting outranks the key: no key the user adds turns it on.
  const blockedMessageKey = aiDeploymentBlockedMessageKey();
  const hasBackgroundConsent = isAiBackgroundEnabled(settings.ai);
  const backgroundHintId = useId();
  // A LEGACY job predates §772: it carries no permanent key. A job added now has one (createJob mints it) and
  // only lacks a project, which its own row says.
  useAcceptanceSnapshot(); // the notice follows Accept / Stop on this device
  // This device's answers count in one portfolio only (a cloned database holds the same job keys): the portfolio of the
  // list ON SCREEN. While that list is still the previous portfolio's (a switch whose new list has not arrived), the
  // answer buttons are unusable, so a press never answers in either portfolio by mistake.
  const activeBackend = config ? config.httpUrl : null;
  const shownBackend = jobsSource !== undefined ? jobsSource : activeBackend;
  const scope = acceptanceScope(shownBackend);
  const answersLive = shownBackend === activeBackend;
  // The active portfolio NOW (for an answer whose read resolves after a switch). Synced in a layout effect, so it is
  // current from the commit on: no read resolves between a switch's commit and this update.
  const activeBackendRef = useRef(activeBackend);
  useLayoutEffect(() => { activeBackendRef.current = activeBackend; }, [activeBackend]);
  // The new portfolio's list could not be read: the rows on screen are still the previous portfolio's (and cannot be
  // answered), so say so until a read of it succeeds.
  const loadFailedAfterSwitch = failedSource !== undefined && failedSource === activeBackend && shownBackend !== activeBackend;
  const awaitingOk = jobs.filter((j) => {
    if (!isRunnable(j)) return false;
    const state = acceptanceState(j, scope);
    return state === "none" || state === "changed" || state === "declined-changed";
  }).length;
  const hasLegacyJob = jobs.some((j) => j.foreign === undefined && j.key === null);
  // A write that fails (the database unreachable) must not look as if it worked until the next reload.
  const [writeFailed, setWriteFailed] = useState(false);
  // A job deleted on another device leaves no row to speak in: the section's status region says so instead.
  const [deletedElsewhere, setDeletedElsewhere] = useState(false);
  // The legacy job whose project was just assigned here: its row starts afresh (the key it is given is part of the row
  // key), and the new row puts focus back on its project select.
  const [focusProjectOf, setFocusProjectOf] = useState<number | null>(null);
  // An edit of a job a newer version rewrote (it cannot be edited here any more) is not a connection failure either.
  const [editedByNewer, setEditedByNewer] = useState(false);
  // A row edit (other than the instruction, which keeps its text) refused because the portfolio was switched first.
  const [switchRefused, setSwitchRefused] = useState(false);
  const track = (write: Promise<void>, instruction = false): void => {
    // A conditional save refused (the row says so), an edit of a job deleted elsewhere or rewritten by a newer version
    // is not a failed write: say what happened instead.
    void Promise.resolve(write).then(
      () => { setWriteFailed(false); setDeletedElsewhere(false); setEditedByNewer(false); setSwitchRefused(false); },
      (err: unknown) => {
        if (err instanceof JobGoneError) setDeletedElsewhere(true);
        else if (err instanceof JobNotEditableError) setEditedByNewer(true);
        // A write from a row of the portfolio just left: nothing written. A typed instruction is kept for copying by
        // the row itself; any other refused edit is said here, so it is never lost in silence.
        else if (err instanceof JobSourceChangedError) { if (!instruction) setSwitchRefused(true); }
        else if (!(err instanceof JobChangedError)) setWriteFailed(true);
      },
    );
  };

  // What the last Accept on each row found out when it accepted nothing, keyed by the job's permanent key.
  const [acceptNotices, setAcceptNotices] = useState<ReadonlyMap<string, AcceptNotice>>(new Map());
  const [acceptPending, setAcceptPending] = useState<ReadonlySet<string>>(new Set());
  function setPending(key: string, on: boolean): void {
    setAcceptPending((prev) => {
      const next = new Set(prev);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
  }
  function setAcceptNotice(key: string | null, notice: AcceptNotice | null): void {
    if (key === null) return;
    setAcceptNotices((prev) => {
      const next = new Map(prev);
      if (notice === null) next.delete(key);
      else next.set(key, notice);
      return next;
    });
  }

  // The row may show a stale job: re-read, and accept only what the store still holds unchanged. Otherwise show the
  // current job and say so; a failed read accepts nothing and says that.
  async function acceptFresh(job: ScheduledJob): Promise<void> {
    if (job.key === null || acceptPending.has(job.key)) return;
    setAcceptNotice(job.key, null);
    setDeletedElsewhere(false);
    setEditedByNewer(false);
    setSwitchRefused(false);
    setPending(job.key, true);
    const entryAtClick = storedAcceptanceEntry(job.key, scope);
    try {
      // After the saves in progress settle, so the job is compared with what the store holds once they land. (An answer
      // press never ends the edit: an instruction still being typed is not saved yet, and the row shows the stored job.)
      // Read from the portfolio of the list on screen only: an answer is never recorded for another one.
      const fresh = (await readFresh(shownBackend)).find((j) => j.key !== null && j.key === job.key);
      // Switched while reading: the portfolio answered for is no longer the active one, so nothing is answered.
      if (activeBackendRef.current !== shownBackend) return;
      if (fresh?.foreign !== undefined) {
        // A newer version rewrote the job: this version can neither run nor answer it. Nothing is answered — and this is
        // said first, even when an answer changed during the read.
        setEditedByNewer(true);
        await refresh();
        return;
      }
      // The user answered again while the read was in flight (a decline, in this or another tab): that answer wins.
      if (storedAcceptanceEntry(job.key, scope) !== entryAtClick) {
        if (fresh && jobFingerprint(fresh) !== jobFingerprint(job)) await refresh();
        return;
      }
      if (fresh && acceptanceState(fresh, scope) === "accepted") {
        // This device already accepted the current version; a row still showing an older one is brought up to date.
        if (jobFingerprint(fresh) !== jobFingerprint(job)) await refresh();
        return;
      }
      if (fresh && jobFingerprint(fresh) === jobFingerprint(job)) {
        if (!acceptJob(fresh, scope)) setAcceptNotice(job.key, "saveFailed");
        return;
      }
      if (fresh === undefined) {
        // Deleted on another device: its row goes away with the refresh, so the section says so.
        setDeletedElsewhere(true);
      } else {
        setAcceptNotice(job.key, "changed");
      }
      await refresh();
    } catch (err: unknown) {
      // The portfolio changed before the read: nothing is answered (the row is about to be replaced by the new list).
      if (err instanceof JobSourceChangedError) return;
      setAcceptNotice(job.key, "failed");
    } finally {
      setPending(job.key, false);
    }
  }

  function toggleEnabled() {
    onChange({ ...settings, ai: { ...settings.ai, scheduledJobs: !enabled } });
  }

  function addJob() {
    // A new job reports on the project that is open in the portfolio, else the first active one; with no active
    // project it is created without one and its row says "Choose a project".
    const openId = loadCurrentTursoProjectId();
    const projectId = (projects.active.find((p) => p.id === openId) ?? projects.active[0])?.id;
    track(createJob({
      name: t(lang, "scheduledJobsTitle"),
      cadence: defaultDailyCadence(),
      enabled: true,
      timeZone: defaultZone,
      ...(projectId !== undefined ? { projectId } : {}),
    }));
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
      ) : blockedMessageKey !== null ? (
        <p className="rounded-md border border-line bg-surface p-3 text-xs text-muted-foreground">
          {t(lang, blockedMessageKey)}
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
              // AI-01 — only switching ON needs the background consent: a job left on from before can always be switched off.
              disabled={!hasBackgroundConsent && !enabled}
              aria-describedby={!hasBackgroundConsent && !enabled ? backgroundHintId : undefined}
              onChange={toggleEnabled}
            />
            <span className="text-xs text-foreground">{t(lang, "scheduledJobsToggle")}</span>
          </label>
          {!hasBackgroundConsent && <FieldHint id={backgroundHintId}>{t(lang, "aiBackgroundConsentNeeded")}</FieldHint>}
          {/* A job decides from its OWN project, not the open one, so only the organisation lock is named; otherwise the rule is stated once. */}
          <FieldHint>{t(lang, isBackgroundOffForced() ? "aiBackgroundPausedByDeployment" : "scheduledJobsPausedProjectHint")}</FieldHint>
          <FieldHint>{t(lang, "scheduledJobsCostNote")}</FieldHint>

          {enabled && (
            <>
              {/* Always mounted: a live region must exist before its text changes. */}
              <div role="status">
                {awaitingOk > 0 && (
                  <Banner severity="info" role="none">
                    {tPlural(lang, "scheduledJobsAwaitingOk", awaitingOk, String(awaitingOk))}
                  </Banner>
                )}
                {deletedElsewhere && <p className="text-xs text-foreground">{t(lang, "scheduledJobDeletedElsewhere")}</p>}
                {editedByNewer && <p className="text-xs text-foreground">{t(lang, "scheduledJobEditedByNewerVersion")}</p>}
              </div>
              {projects.failed && <FieldHint>{t(lang, "tursoPickerError")}</FieldHint>}
              {writeFailed && <p role="alert" className="text-xs text-foreground">{t(lang, "scheduledJobsWriteFailed")}</p>}
              {loadFailedAfterSwitch && (
                <p role="alert" className="text-xs text-foreground">{t(lang, "scheduledJobsLoadFailedAfterSwitch")}</p>
              )}
              {switchRefused && (
                <p role="alert" className="text-xs text-foreground">{t(lang, "scheduledJobChangeNotSavedPortfolioSwitch")}</p>
              )}

              <ul className="flex flex-col gap-2">
                {jobs.map((job) => (
                  <JobRow
                    // Per portfolio (the backend the list was read from), id and permanent key: a portfolio switch, an id
                    // reused for another job, or a key given to a legacy job starts a fresh row, so no text, draft or
                    // notice is ever carried to another job.
                    key={`${jobsSource ?? ""}:${job.id}:${job.key ?? ""}`}
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
                    // The permanent key rides along (`null` for a legacy job: the job with this id that has no key, or the key
                    // this tab just minted for it), and the hook binds every row write to the portfolio this list was read
                    // from, so a write reaches only this job (ids collide across portfolios).
                    onUpdate={(id, patch, options) => {
                      const key = job.key;
                      const write = options === undefined ? updateJob(id, patch, key) : updateJob(id, patch, key, options);
                      track(write, options !== undefined); // the instruction draft's save passes options
                      return write; // the instruction draft waits for it: a failed save keeps the draft
                    }}
                    onAssign={(id, projectId, timeZone) => {
                      const write = assignProject(id, projectId, timeZone, job.key);
                      if (job.key === null) {
                        // Minting the key starts the row afresh: its project select takes keyboard focus back on mount.
                        setFocusProjectOf(id);
                        write.catch(() => setFocusProjectOf((f) => (f === id ? null : f)));
                      }
                      track(write);
                    }}
                    focusProjectOnMount={focusProjectOf === job.id}
                    scope={scope}
                    onProjectFocused={() => setFocusProjectOf(null)}
                    onDelete={(id) => track(deleteJob(id, job.key))}
                    onAccept={(j) => { void acceptFresh(j); }}
                    acceptPending={!answersLive || (job.key !== null && acceptPending.has(job.key))}
                    // A save of this job in flight: its answer buttons wait for it, so an answer never races an edit.
                    saving={savingJobs.has(jobSaveId(job))}
                    acceptNotice={job.key !== null ? (acceptNotices.get(job.key) ?? null) : null}
                    onNoticeClear={() => setAcceptNotice(job.key, null)}
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
