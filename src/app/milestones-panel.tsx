"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  SortHeaderButton,
  useSortableFilter,
  type SortDir,
} from "./report-table";
import { PanelFiltersProvider, usePanelFilters } from "./panel-filters-context";
import { PanelViewsControl } from "./panel-views-control";
import type { PanelFiltersState } from "./panel-views";

const MILESTONE_FILTER_DEFAULTS: PanelFiltersState = {
  search: "",
  filters: { status: "all" },
  sort: { key: "date", dir: "asc" },
};
import { MilestoneEditModal } from "./milestone-edit-modal";
import { useWorkspace } from "./workspace-context";
import { useWorkspaceTab } from "./workspace-tab-context";
import { useDeepLinkRowFlash, flashOutlineClass } from "./use-deeplink-row-flash";
import {
  filterMilestones,
  milestoneStatus,
  type MilestoneFilterStatus,
  type MilestoneStatus,
} from "./milestones";
import { type Lang, t } from "./i18n";
import { nextId } from "./resource-foundation";
import { useColumnResize } from "./use-column-resize";
import { ColumnResizeHandle, ResetSizeButton, ResetColWidthsButton } from "./task-manager-ui";
import { useResizable } from "./use-resizable";
import { VIEW_PANE_RESIZABLE_CLASS, INNER_TABLE_CLASS } from "./view-styles";
import { TABLE_HEAD_CLASS } from "./table-styles";
import { EmptyState } from "./empty-state";
import { INTERACTIVE, FOCUS_RING, TRANSITION } from "./interaction-styles";
import type { ActivityKind } from "./activity-log";
import type { Milestone } from "./types";

const MILESTONE_COL_WIDTHS = { name: 220, date: 130, status: 140, achieved: 130 } as const;
type MilestoneCol = keyof typeof MILESTONE_COL_WIDTHS;

const STATUS_KEY: Record<
  MilestoneStatus,
  | "milestoneStatusAchieved"
  | "milestoneStatusOverdue"
  | "milestoneStatusAtRisk"
  | "milestoneStatusDueSoon"
  | "milestoneStatusOnTrack"
> = {
  achieved: "milestoneStatusAchieved",
  overdue: "milestoneStatusOverdue",
  "at-risk": "milestoneStatusAtRisk",
  "due-soon": "milestoneStatusDueSoon",
  "on-track": "milestoneStatusOnTrack",
};

type MilestonesPanelProps = {
  lang: Lang;
  today: string;
  holidaySet: ReadonlySet<string>;
  logActivity?: (kind: ActivityKind, ...args: (string | number)[]) => void;
  openCreateNonce?: number;
  /** Called after an `openCreateNonce` create-request has been honoured so the
   *  parent can reset the nonce. Without it a stale nonce re-opens the create
   *  modal every time this panel remounts (e.g. navigating in from Gantt). */
  onCreateConsumed?: () => void;
  onPushToOutlook?: () => void;
  calendarPushBusy?: boolean;
};

export function MilestonesPanel(props: MilestonesPanelProps) {
  return (
    <PanelFiltersProvider defaults={MILESTONE_FILTER_DEFAULTS}>
      <MilestonesPanelBody {...props} />
    </PanelFiltersProvider>
  );
}

function MilestonesPanelBody({
  lang,
  today,
  holidaySet,
  logActivity,
  openCreateNonce,
  onCreateConsumed,
  onPushToOutlook,
  calendarPushBusy,
}: MilestonesPanelProps) {
  const { milestones, setMilestones, tasks } = useWorkspace();
  // `-full` suffix: the view changed from a centered half-width pane to full
  // width, so use a fresh key — a stale half-width size persisted under the old
  // key would otherwise override `w-full` and leave a gap on the right.
  const { ref, reset: resetSize } = useResizable("lop-app:milestones-size-full");
  const [editing, setEditing] = useState<Milestone | null>(null);
  const [isNew, setIsNew] = useState(false);
  const pf = usePanelFilters();

  const sort = (pf.sort ?? MILESTONE_FILTER_DEFAULTS.sort) as { key: "name" | "date"; dir: SortDir };
  const setSort = (next: { key: "name" | "date"; dir: SortDir }) =>
    pf.setSort({ key: next.key, dir: next.dir });
  const status = pf.filters.status as MilestoneFilterStatus;

  const getValue = useCallback(
    (m: Milestone, key: "name" | "date") => (key === "name" ? m.name : m.date),
    [],
  );

  const filtered = filterMilestones(milestones, {
    query: pf.search,
    status,
    today,
  });

  const { sorted, click } = useSortableFilter(
    filtered,
    sort,
    setSort,
    "",
    getValue,
  );

  const { colWidths, startColResize, resetColWidths } =
    useColumnResize<MilestoneCol>("milestone", MILESTONE_COL_WIDTHS);
  const startResize = startColResize as (col: string, e: React.MouseEvent) => void;

  const tasksById = new Map(tasks.map((tk) => [tk.id, tk] as const));

  function openNew() {
    setIsNew(true);
    setEditing({ id: nextId(milestones), name: "", date: today, linkedTaskIds: [], documentLinks: [] });
  }

  // One-way signal from the parent (Gantt "Add milestone"): when the nonce
  // changes to a positive value, open the create modal. The ref seeds from
  // `undefined` (NOT the live prop) so a positive nonce that is already set when
  // this panel first mounts — the Gantt→Milestones case, where the click both
  // bumps the nonce and switches the tab, remounting us — still opens the modal.
  // After honouring it we tell the parent to reset the nonce (onCreateConsumed)
  // so a stale value does not re-open the modal on a later normal navigation.
  const prevNonceRef = useRef<number | undefined>(undefined);
  useEffect(() => {
    const next = openCreateNonce ?? 0;
    if (next !== prevNonceRef.current) {
      prevNonceRef.current = next;
      if (next > 0) {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: a one-way parent signal must open the modal on a nonce transition, not at render time
        openNew();
        onCreateConsumed?.();
      }
    }
    // openNew is a stable hoisted declaration; depend only on the nonce.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openCreateNonce]);

  // Deep-link: when a suggested-action chip requests opening a milestone, open
  // its edit modal once and clear the pending signal.
  const { pendingOpen, clearPendingOpen } = useWorkspaceTab();
  const { flashId, containerRef } = useDeepLinkRowFlash("milestones");
  useEffect(() => {
    if (pendingOpen?.view !== "milestones") return;
    const m = milestones.find((x) => x.id === pendingOpen.id);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-way deep-link
    if (m && editing?.id !== m.id) setEditing(m);
    clearPendingOpen();
  }, [pendingOpen, milestones, editing, setEditing, clearPendingOpen]);

  function save(next: Milestone) {
    const creating = !milestones.some((m) => m.id === next.id);
    setMilestones((prev) =>
      prev.some((m) => m.id === next.id)
        ? prev.map((m) => (m.id === next.id ? next : m))
        : [...prev, next],
    );
    if (creating) {
      logActivity?.("milestone.created", next.id, next.name);
    } else {
      logActivity?.("milestone.updated", next.id);
    }
    setEditing(null);
  }

  function del(id: number) {
    setMilestones((prev) => prev.filter((m) => m.id !== id));
    logActivity?.("milestone.deleted", id);
    setEditing(null);
  }

  function toggleAchieved(m: Milestone) {
    setMilestones((prev) =>
      prev.map((x) =>
        x.id === m.id
          ? { ...x, achievedDate: x.achievedDate ? undefined : today }
          : x,
      ),
    );
  }

  return (
    <div ref={ref} className={VIEW_PANE_RESIZABLE_CLASS}>
      <header className="mb-2 flex shrink-0 flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-medium text-foreground">
          {t(lang, "milestonesTitle")}
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={openNew}
            className={`rounded-md border border-AIPM-dark-blue bg-AIPM-dark-blue px-2.5 py-1.5 text-xs font-medium text-white hover:bg-AIPM-dark-blue/90 ${INTERACTIVE}`}
          >
            + {t(lang, "milestoneNew")}
          </button>
          {onPushToOutlook ? (
            <button
              type="button"
              onClick={onPushToOutlook}
              disabled={calendarPushBusy}
              className={`rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-surface-muted disabled:opacity-60 ${INTERACTIVE}`}
            >
              {t(lang, calendarPushBusy ? "calendarPushing" : "calendarPush")}
            </button>
          ) : null}
          <input
            type="search"
            value={pf.search}
            onChange={(e) => pf.setSearch(e.target.value)}
            placeholder={t(lang, "milestonesFilterName")}
            aria-label={t(lang, "milestonesFilterName")}
            className={`min-w-[10rem] rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs text-foreground focus:border-AIPM-dark-blue focus:outline-none ${FOCUS_RING} ${TRANSITION}`}
          />
          <select
            value={status}
            onChange={(e) => pf.setFilter("status", e.target.value)}
            aria-label={t(lang, "milestonesFilterStatus")}
            className={`rounded-md border border-line bg-surface px-2 py-1.5 text-xs text-foreground focus:border-AIPM-dark-blue focus:outline-none ${FOCUS_RING} ${TRANSITION}`}
          >
            <option value="all">{t(lang, "milestonesFilterAll")}</option>
            <option value="pending">{t(lang, "milestonesFilterPending")}</option>
            <option value="achieved">{t(lang, "milestonesFilterAchieved")}</option>
            <option value="overdue">{t(lang, "milestonesFilterOverdue")}</option>
          </select>
          <PanelViewsControl lang={lang} view="milestones" />
          <ResetColWidthsButton onClick={resetColWidths} lang={lang} />
          <ResetSizeButton onClick={resetSize} lang={lang} />
        </div>
      </header>
      <div ref={containerRef} className={INNER_TABLE_CLASS}>
      {sorted.length === 0 ? (
        <EmptyState compact title={t(lang, "milestonesEmpty")} />
      ) : (
        <table className="w-full text-sm">
          <thead className={TABLE_HEAD_CLASS}>
            <tr className="text-left">
              <th
                className="relative py-1"
                style={{ width: colWidths.name, minWidth: colWidths.name }}
              >
                <SortHeaderButton
                  label={t(lang, "milestonesColName")}
                  active={sort.key === "name"}
                  dir={sort.dir}
                  onClick={() => click("name")}
                />
                <ColumnResizeHandle col="name" onMouseDown={startResize} />
              </th>
              <th
                className="relative"
                style={{ width: colWidths.date, minWidth: colWidths.date }}
              >
                <SortHeaderButton
                  label={t(lang, "milestonesColDate")}
                  active={sort.key === "date"}
                  dir={sort.dir}
                  onClick={() => click("date")}
                />
                <ColumnResizeHandle col="date" onMouseDown={startResize} />
              </th>
              <th
                className="relative"
                style={{ width: colWidths.status, minWidth: colWidths.status }}
              >
                {t(lang, "milestonesColStatus")}
                <ColumnResizeHandle col="status" onMouseDown={startResize} />
              </th>
              <th
                className="relative"
                style={{ width: colWidths.achieved, minWidth: colWidths.achieved }}
              >
                <ColumnResizeHandle col="achieved" onMouseDown={startResize} />
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((m) => {
              const s = milestoneStatus(m, tasksById, today, holidaySet);
              return (
                <tr
                  key={m.id}
                  data-deeplink-row={m.id}
                  className={["border-t border-line", flashOutlineClass(flashId === m.id)].filter(Boolean).join(" ")}
                >
                  <td className="py-1" style={{ width: colWidths.name }}>
                    <button
                      type="button"
                      title={m.name}
                      className={`rounded-md border border-transparent px-2 py-0.5 text-left font-medium text-foreground hover:border-AIPM-dark-blue hover:bg-surface-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-AIPM-green ${INTERACTIVE}`}
                      onClick={() => {
                        setIsNew(false);
                        setEditing(m);
                      }}
                    >
                      {m.name}
                    </button>
                  </td>
                  <td>{m.date}</td>
                  <td>
                    {s === "achieved" ? "✓ " : s === "at-risk" ? "⚠ " : ""}
                    {t(lang, STATUS_KEY[s])}
                  </td>
                  <td>
                    <label className="flex items-center gap-1 text-xs">
                      <input
                        type="checkbox"
                        checked={!!m.achievedDate}
                        onChange={() => toggleAchieved(m)}
                      />
                      {t(lang, "milestonesMarkAchieved")}
                    </label>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      </div>
      {editing ? (
        <MilestoneEditModal
          lang={lang}
          milestone={editing}
          isNew={isNew}
          tasks={tasks}
          onSave={save}
          onDelete={del}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}
