"use client";

import { useCallback, useRef, useState } from "react";
import {
  ReportCard,
  SortHeaderButton,
  useSortableFilter,
  type SortDir,
} from "./report-table";
import { MilestoneEditModal } from "./milestone-edit-modal";
import { useWorkspace } from "./workspace-context";
import {
  milestoneStatus,
  sortMilestones,
  type MilestoneStatus,
} from "./milestones";
import { type Lang, t } from "./i18n";
import type { ActivityKind } from "./activity-log";
import type { Milestone } from "./types";

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

export function MilestonesPanel({
  lang,
  today,
  holidaySet,
  logActivity,
}: {
  lang: Lang;
  today: string;
  holidaySet: ReadonlySet<string>;
  logActivity?: (kind: ActivityKind, ...args: (string | number)[]) => void;
}) {
  const { milestones, setMilestones, tasks } = useWorkspace();
  const sizeRef = useRef<HTMLDivElement | null>(null);
  const [editing, setEditing] = useState<Milestone | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [sort, setSort] = useState<{ key: "name" | "date"; dir: SortDir }>({
    key: "date",
    dir: "asc",
  });

  const getValue = useCallback(
    (m: Milestone, key: "name" | "date") => (key === "name" ? m.name : m.date),
    [],
  );

  const { sorted, click } = useSortableFilter(
    sortMilestones(milestones),
    sort,
    setSort,
    "",
    getValue,
  );

  const tasksById = new Map(tasks.map((tk) => [tk.id, tk] as const));

  function nextId() {
    return milestones.reduce((m, x) => Math.max(m, x.id), 0) + 1;
  }

  function openNew() {
    setIsNew(true);
    setEditing({ id: nextId(), name: "", date: today, linkedTaskIds: [] });
  }

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
    <ReportCard
      lang={lang}
      sizeRef={sizeRef}
      onResetSize={() => undefined}
      title={t(lang, "milestonesTitle")}
      toolbarExtra={
        <button
          type="button"
          onClick={openNew}
          className="rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs font-medium hover:border-AIPM-dark-blue"
        >
          + {t(lang, "milestoneNew")}
        </button>
      }
    >
      {sorted.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t(lang, "milestonesEmpty")}
        </p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase text-muted-foreground">
              <th className="py-1">
                <SortHeaderButton
                  label={t(lang, "milestonesColName")}
                  active={sort.key === "name"}
                  dir={sort.dir}
                  onClick={() => click("name")}
                />
              </th>
              <th>
                <SortHeaderButton
                  label={t(lang, "milestonesColDate")}
                  active={sort.key === "date"}
                  dir={sort.dir}
                  onClick={() => click("date")}
                />
              </th>
              <th>{t(lang, "milestonesColStatus")}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((m) => {
              const s = milestoneStatus(m, tasksById, today, holidaySet);
              return (
                <tr key={m.id} className="border-t border-line">
                  <td className="py-1">
                    <button
                      type="button"
                      className="hover:underline"
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
    </ReportCard>
  );
}
