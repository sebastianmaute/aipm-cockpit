"use client";

// §772 — Scheduled reports: every stored run of the scheduled analysis jobs, across the portfolio.
// Turso-only (`TURSO_ONLY_VIEWS`); the panel guards at runtime too. Read-only — nothing here writes.
// ★ Report text is model output: it is rendered as plain text, never as HTML.
// ★ No AI setting gates this view — a report written earlier stays readable with the AI switched off.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type Lang, t } from "./i18n";
import { navLabelKey } from "./nav-config";
import type { TursoConfig } from "./turso-config";
import type { PortfolioMode } from "./portfolio-mode";
import { isInterrupted, listReportProjects, listReports, REPORT_ERROR_KEY, REPORT_LIST_LIMIT, type ReportErrorToken, type ScheduledReport } from "./scheduled-reports-store";
import { SCHEDULED_REPORT_EVENT } from "./use-scheduled-job-runner";
import { getDeviceLabel } from "./device-label";
import { formatDisplayTimestamp } from "./tz-display";
import { buildRowTokens } from "./row-tokens";
import { EmptyState } from "./empty-state";
import { PanelSkeleton } from "./skeleton";
import { PaneHeader } from "./pane-header";
import { RagDot } from "./rag-dot";
import { Select } from "./form-controls";
import type { Health } from "./health";
import type { AiActionSeverity } from "./action-ai";
import { VIEW_PANE_FILL_CLASS, VIEW_PANE_RESIZABLE_CLASS } from "./view-styles";
import { ScheduledReportsList, stateText, type ReportTabRow, type ReportTabState } from "./scheduled-reports-list";

export interface ScheduledReportsPanelProps {
  lang: Lang;
  tursoConfig: TursoConfig | null;
  mode: PortfolioMode;
  /** The app's display zone for the run time. */
  timeZone: string;
  /** Leads to Settings from the empty state. Omitted where the view cannot navigate (popouts). */
  onOpenSettings?: () => void;
}

interface ProjectName { id: string; name: string }

type Loaded =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "ready"; reports: readonly ScheduledReport[]; loadedAt: Date; deviceLabel: string; source: string; projects: readonly ProjectName[] };

const FILTER_ALL = "";
const PANEL_ID = "scheduled-reports-detail";
const SEV_RAG: Record<AiActionSeverity, Health> = { now: "R", soon: "A", monitor: "G" };
const UNKNOWN_DEVICE = "unknown"; // `getDeviceLabel`'s fallback: any device whose storage threw writes it, so it names no device
const SEV_KEY = { now: "actionTierNow", soon: "actionTierSoon", monitor: "actionTierMonitor" } as const;

function stateOf(r: ScheduledReport, now: Date): ReportTabState {
  if (r.status === "running") return isInterrupted(r, now) ? "interrupted" : "running";
  return r.ok ? "done" : "failed";
}

/** One option per project that has a report, named by its NEWEST report. */
function projectOptions(projects: readonly ProjectName[], lang: Lang): ProjectName[] {
  // A project whose meta could not be read has no name: a placeholder, never a blank option.
  const named = projects.map((p) => ({ id: p.id, name: p.name || t(lang, "scheduledReportsUnknownProject") }));
  const counts = new Map<string, number>();
  for (const p of named) counts.set(p.name, (counts.get(p.name) ?? 0) + 1);
  // Two projects with one name get a short id, so the options read differently.
  return named.map((p) => ({ id: p.id, name: (counts.get(p.name) ?? 0) > 1 ? `${p.name} (${p.id.slice(0, 4)})` : p.name }));
}

const stateLabel = (lang: Lang, state: ReportTabState): string => stateText(lang, state) ?? "";

/** Why a report that is not `done` has no result: its own state, with the stored error token when it failed. */
function statusText(lang: Lang, state: ReportTabState, error: ReportErrorToken | undefined): string {
  if (state === "running") return t(lang, "scheduledReportsRunningNote");
  if (state === "interrupted") return t(lang, REPORT_ERROR_KEY.interrupted);
  return t(lang, REPORT_ERROR_KEY[error ?? "error"]);
}

export function ScheduledReportsPanel({ lang, tursoConfig, mode, timeZone, onOpenSettings }: ScheduledReportsPanelProps) {
  const usable = tursoConfig !== null && mode === "turso";
  const [stored, setLoaded] = useState<Loaded>({ kind: "loading" });
  // Reports read from another portfolio are never shown while the new read is in flight.
  const source = tursoConfig?.httpUrl ?? "";
  const loaded = useMemo<Loaded>(
    () => (stored.kind === "ready" && stored.source !== source ? { kind: "loading" } : stored),
    [stored, source],
  );
  const [filter, setFilter] = useState(FILTER_ALL);
  // The reload reads the CHOSEN project's rows from the database, so it needs the filter without being rebuilt by it.
  const filterRef = useRef(FILTER_ALL);
  const [selectedId, setSelectedId] = useState("");

  // Promise callbacks, not an awaited body: the setState calls land after the read, never inside the effect.
  // Reloads overlap (focus, the runner event): only the newest request may write, or a slow older answer
  // would replace a newer list.
  const latest = useRef(0);
  // `new Date()` and `getDeviceLabel()` (which can mint and store a label) are read here, never in render.
  const load = useCallback(() => {
    const mine = ++latest.current;
    const project = filterRef.current;
    Promise.all([listReports(tursoConfig, project === FILTER_ALL ? undefined : project), listReportProjects(tursoConfig)]).then(
      async ([first, projects]) => {
        let reports = first;
        // The chosen project has no report any more: back to All, and read those rows instead.
        if (project !== FILTER_ALL && !projects.some((p) => p.id === project)) {
          filterRef.current = FILTER_ALL;
          reports = await listReports(tursoConfig);
        }
        if (mine !== latest.current) return;
        if (filterRef.current !== project) setFilter(filterRef.current);
        setLoaded({ kind: "ready", reports, loadedAt: new Date(), deviceLabel: getDeviceLabel(), source: tursoConfig?.httpUrl ?? "", projects });
      },
      // A failed reload keeps what is already on screen, but only if it was read from THIS portfolio.
      () => {
        if (mine !== latest.current) return;
        setLoaded((prev) => (prev.kind === "ready" && prev.source === (tursoConfig?.httpUrl ?? "") ? prev : { kind: "error" }));
      },
    );
  }, [tursoConfig]);

  useEffect(() => {
    if (!usable) return;
    load();
    window.addEventListener(SCHEDULED_REPORT_EVENT, load);
    window.addEventListener("focus", load);
    return () => {
      window.removeEventListener(SCHEDULED_REPORT_EVENT, load);
      window.removeEventListener("focus", load);
    };
  }, [usable, load]);

  const reports = useMemo(() => (loaded.kind === "ready" ? loaded.reports : []), [loaded]);
  const loadedAt = loaded.kind === "ready" ? loaded.loadedAt : null;
  const projects = useMemo(() => (loaded.kind === "ready" ? loaded.projects : []), [loaded]);
  const options = useMemo(() => projectOptions(projects, lang), [projects, lang]);
  // A filter whose project has no report any more reads as "All", exactly as the control shows it.
  const effectiveFilter = options.some((o) => o.id === filter) ? filter : FILTER_ALL;
  const visible = useMemo(
    () => (effectiveFilter === FILTER_ALL ? reports : reports.filter((r) => r.projectId === effectiveFilter)),
    [reports, effectiveFilter],
  );

  const rows = useMemo<ReportTabRow[]>(() => {
    if (!loadedAt) return [];
    const base = visible.map((r) => {
      const when = formatDisplayTimestamp(r.ranAt, timeZone, lang);
      const state = stateOf(r, loadedAt);
      const projectName = r.data.projectName || t(lang, "scheduledReportsUnknownProject");
      const name = [when, projectName, r.data.jobName, stateLabel(lang, state)].filter(Boolean).join(" ");
      return { id: r.id, when, projectName, jobName: r.data.jobName, state, name };
    });
    const tokens = buildRowTokens(base.map((b) => ({ id: b.id, name: b.name })));
    return base.map(({ name, ...row }) => ({ ...row, label: tokens.get(row.id) ?? name }));
  }, [visible, loadedAt, timeZone, lang]);

  if (!usable) {
    return (
      <div className={VIEW_PANE_FILL_CLASS}>
        <EmptyState title={t(lang, "navScheduledReports")} description={t(lang, "scheduledReportsNeedPortfolio")} />
      </div>
    );
  }
  if (loaded.kind === "loading") return <PanelSkeleton lang={lang} />;
  if (loaded.kind === "error") {
    return (
      <div className={VIEW_PANE_FILL_CLASS}>
        <EmptyState title={t(lang, "portfolioLoadErrorTitle")} description={t(lang, "portfolioLoadErrorDesc")} />
      </div>
    );
  }
  if (reports.length === 0) {
    return (
      <div className={VIEW_PANE_FILL_CLASS}>
        <EmptyState
          title={t(lang, "navScheduledReports")}
          description={t(lang, "scheduledReportsEmpty")}
          actions={onOpenSettings ? [{ label: t(lang, "scheduledReportsOpenSettings"), onClick: onOpenSettings }] : undefined}
        />
      </div>
    );
  }

  const selected = visible.find((r) => r.id === selectedId) ?? visible[0];
  const selectedRow = rows.find((r) => r.id === selected?.id);
  const deviceLabel = loaded.deviceLabel;
  const done = selectedRow?.state === "done";

  return (
    <div className={`print-root ${VIEW_PANE_RESIZABLE_CLASS}`}>
      <PaneHeader
        title={t(lang, "navScheduledReports")}
        actions={
          <label className="flex items-center gap-1 text-xs text-foreground">
            <span>{t(lang, "scheduledReportsFilter")}</span>
            <Select size="xs" value={effectiveFilter} onChange={(e) => { filterRef.current = e.target.value; setFilter(e.target.value); load(); }}>
              <option value={FILTER_ALL}>{t(lang, "scheduledReportsAllProjects")}</option>
              {options.map((o) => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </Select>
          </label>
        }
      />
      {reports.length >= REPORT_LIST_LIMIT && (
        <p className="text-xs text-muted-foreground">{t(lang, "scheduledReportsLimited", String(REPORT_LIST_LIMIT))}</p>
      )}
      <div className="grid min-h-[240px] flex-1 grid-cols-1 gap-3 overflow-auto rounded-xl border border-line p-3 md:grid-cols-[18rem_1fr]">
        <ScheduledReportsList
          lang={lang}
          rows={rows}
          selectedId={selected?.id ?? ""}
          onSelect={setSelectedId}
          panelId={PANEL_ID}
        />
        {selected && selectedRow && (
          <div id={PANEL_ID} role="tabpanel" aria-labelledby={`${PANEL_ID}-tab-${selected.id}`} tabIndex={0} className="min-w-0">
            <h3 className="text-base font-medium text-foreground">{selected.data.jobName}</h3>
            <p className="text-sm text-muted-foreground">{selectedRow.projectName}</p>
            <p className="text-xs text-muted-foreground">{selectedRow.when}</p>
            {selected.data.partial && <p className="text-xs text-foreground">{t(lang, "scheduledReportsPartial")}</p>}
            <p className="text-xs text-muted-foreground">
              {deviceLabel !== UNKNOWN_DEVICE && selected.claimedBy === deviceLabel
                ? t(lang, "scheduledReportsThisDevice")
                : t(lang, "scheduledReportsRanBy", selected.claimedBy)}
            </p>
            {selected.data.instruction && (
              <section className="mt-3">
                <h4 className="text-sm font-medium text-foreground">{t(lang, "scheduledReportsInstruction")}</h4>
                <p className="whitespace-pre-wrap text-sm text-foreground">{selected.data.instruction}</p>
              </section>
            )}
            {!done && (
              <section className="mt-3">
                <h4 className="text-sm font-medium text-foreground">{t(lang, "scheduledReportsStatus")}</h4>
                <p className="text-sm text-foreground">{statusText(lang, selectedRow.state, selected.data.error)}</p>
              </section>
            )}
            {(done || selected.data.summary) && (
              <section className="mt-3">
                <h4 className="text-sm font-medium text-foreground">{t(lang, "scheduledReportsSummary")}</h4>
                <p className="whitespace-pre-wrap text-sm text-foreground">{selected.data.summary}</p>
              </section>
            )}
            {(done || selected.data.actions.length > 0) && (
            <section className="mt-3">
              <h4 className="text-sm font-medium text-foreground">{t(lang, "scheduledReportsSuggestions")}</h4>
              {selected.data.actions.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t(lang, "scheduledReportsNoSuggestions")}</p>
              ) : (
                <ul className="mt-1 flex flex-col gap-2">
                  {selected.data.actions.map((a, i) => (
                    <li key={`${a.title}:${i}`} className="flex items-start gap-2 rounded-md border border-line bg-surface px-3 py-2">
                      <RagDot level={SEV_RAG[a.severity]} className="mt-1" />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground">{a.title}</p>
                        <p className="text-xs text-muted-foreground">{a.why}</p>
                        <p className="text-xs text-muted-foreground">
                          <span>{t(lang, SEV_KEY[a.severity])}</span>
                          {a.entity && <span>{` · ${t(lang, navLabelKey(a.entity.view))} #${a.entity.id}`}</span>}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
