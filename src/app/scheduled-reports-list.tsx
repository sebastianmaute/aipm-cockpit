"use client";

// §772 — the vertical tab list of the Scheduled reports view. Presentational: the panel owns the data,
// the selection and the time formatting. Selection follows focus (`useTablistRoving` clicks the target).
import { ExclamationTriangleIcon } from "./icons";
import { FOCUS_RING } from "./interaction-styles";
import { type Lang, t } from "./i18n";
import { useTablistRoving } from "./use-tablist-roving";

export type ReportTabState = "done" | "failed" | "running" | "interrupted";

export interface ReportTabRow {
  id: string;
  /** Run time, already formatted in the app zone. */
  when: string;
  projectName: string;
  jobName: string;
  state: ReportTabState;
  /** Row-unique accessible name; contains every visible word of the tab. */
  label: string;
}

export interface ScheduledReportsListProps {
  lang: Lang;
  rows: readonly ReportTabRow[];
  selectedId: string;
  onSelect: (id: string) => void;
  panelId: string;
}

function stateText(lang: Lang, state: ReportTabState): string | null {
  if (state === "failed") return t(lang, "scheduledReportsFailed");
  if (state === "interrupted") return t(lang, "scheduledReportsInterrupted");
  if (state === "running") return t(lang, "scheduledReportsRunning");
  return null;
}

export function ScheduledReportsList({ lang, rows, selectedId, onSelect, panelId }: ScheduledReportsListProps) {
  const roving = useTablistRoving();
  return (
    <div
      role="tablist"
      aria-orientation="vertical"
      aria-label={t(lang, "scheduledReportsListLabel")}
      onKeyDown={roving}
      className="flex flex-col gap-1"
    >
      {rows.map((row) => {
        const selected = row.id === selectedId;
        const text = stateText(lang, row.state);
        const isProblem = row.state === "failed" || row.state === "interrupted";
        return (
          <button
            key={row.id}
            type="button"
            role="tab"
            id={`${panelId}-tab-${row.id}`}
            aria-selected={selected}
            aria-controls={selected ? panelId : undefined}
            aria-label={row.label}
            tabIndex={selected ? 0 : -1}
            onClick={() => onSelect(row.id)}
            className={`flex flex-col gap-0.5 rounded-md border px-3 py-2 text-left text-sm ${FOCUS_RING} ${
              selected ? "border-ui-green bg-surface text-foreground" : "border-line text-muted-foreground hover:text-foreground"
            }`}
          >
            <span className="font-medium">{row.when}</span>
            <span>{row.projectName}</span>
            <span>{row.jobName}</span>
            {text && (
              <span className="inline-flex items-center gap-1 text-xs">
                {isProblem && <ExclamationTriangleIcon aria-hidden="true" className="h-3.5 w-3.5" />}
                {text}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
