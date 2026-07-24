"use client";

import { useMemo, useState } from "react";
import { type Lang, type TranslationKey, t } from "./i18n";
import type { ConflictFieldKey, ConflictItem } from "./jira-api";
import { Modal } from "./modal";
import { ModalHeader } from "./modal-header";
import { useDraggable } from "./use-draggable";
import { useResizable } from "./use-resizable";
import { useColumnResize } from "./use-column-resize";
import { ColumnResizeHandle } from "./task-manager-ui";
import { DataTable } from "./data-table";
import { Button } from "./button";

const JIRA_CONFLICTS_COL_WIDTHS = {
  field: 128,
  local: 200,
  remote: 200,
} as const;
type JiraConflictsCol = keyof typeof JIRA_CONFLICTS_COL_WIDTHS;

export type ConflictResolution = {
  taskId: number;
  jiraKey: string;
  /** key → side picked. Assignee is always forced to "remote". */
  picks: Record<ConflictFieldKey, "local" | "remote">;
};

type Side = "local" | "remote";

const fieldLabelKey: Record<ConflictFieldKey, TranslationKey> = {
  taskName: "taskName",
  assignee: "assignee",
  assigneeEmail: "email",
  dueDate: "dueDate",
  priority: "priority",
  labels: "labels",
  description: "description",
  completedDate: "completed",
};

/** Renders any value as a short display string. */
function fmt(value: string | string[] | undefined): string {
  if (value === undefined || value === null) return "—";
  if (Array.isArray(value)) {
    if (value.length === 0) return "—";
    return value.join(", ");
  }
  const s = String(value);
  return s.length === 0 ? "—" : s;
}

export function JiraConflictsModal({
  lang,
  conflicts,
  onResolve,
  onClose,
}: {
  lang: Lang;
  conflicts: ConflictItem[];
  onResolve: (resolutions: ConflictResolution[]) => void;
  onClose: () => void;
}) {
  // Picks state, keyed by taskId then field key. Default: assignee → remote, others → remote
  // (the conservative choice — user explicitly opts into pushing local).
  const initial = useMemo<Record<number, ConflictResolution>>(() => {
    const out: Record<number, ConflictResolution> = {};
    for (const c of conflicts) {
      const picks = {} as Record<ConflictFieldKey, "local" | "remote">;
      for (const f of c.fields) {
        picks[f.key] = "remote";
      }
      out[c.taskId] = {
        taskId: c.taskId,
        jiraKey: c.jiraKey,
        picks,
      };
    }
    return out;
  }, [conflicts]);

  const [picks, setPicks] = useState(initial);
  const [prevInitial, setPrevInitial] = useState(initial);
  if (prevInitial !== initial) {
    setPrevInitial(initial);
    setPicks(initial);
  }

  // Escape and backdrop-click are owned by <Modal>.

  function setPick(
    taskId: number,
    key: ConflictFieldKey,
    side: "local" | "remote",
  ) {
    setPicks((prev) => ({
      ...prev,
      [taskId]: {
        ...prev[taskId],
        picks: { ...prev[taskId].picks, [key]: side },
      },
    }));
  }

  function applyAll(side: Side) {
    setPicks(() => {
      const next: Record<number, ConflictResolution> = {};
      for (const c of conflicts) {
        const fieldPicks = {} as Record<ConflictFieldKey, "local" | "remote">;
        for (const f of c.fields) {
          // Assignee always stays remote (managed by Jira).
          fieldPicks[f.key] = f.key === "assignee" ? "remote" : side;
        }
        next[c.taskId] = {
          taskId: c.taskId,
          jiraKey: c.jiraKey,
          picks: fieldPicks,
        };
      }
      return next;
    });
  }

  function handleResolve() {
    onResolve(Object.values(picks));
  }

  const { colWidths, startColResize } = useColumnResize<JiraConflictsCol>(
    "jiraConflicts",
    JIRA_CONFLICTS_COL_WIDTHS,
  );
  const startResize = startColResize as (col: string, e: React.MouseEvent) => void;

  const { offset, reset: dragReset, handleProps } = useDraggable(
    conflicts.length > 0,
    "aipm-cockpit:modal-pos:jira-conflicts",
  );
  // Pre-existing size key kept as-is (not the `aipm-cockpit:modal-size:*`
  // convention) to preserve users' already-persisted panel sizes — don't rename.
  const { ref: panelRef, reset: sizeReset } = useResizable("aipm-cockpit:conflicts-modal-size");

  return (
    <Modal open onClose={onClose} ariaLabel={t(lang, "jiraConflictTitle")}>
      <div
        ref={panelRef}
        data-modal-panel
        style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }}
        className="relative h-[680px] max-h-[95vh] min-h-[320px] w-[768px] min-w-[400px] max-w-[95vw] resize overflow-y-auto rounded-xl border border-line bg-surface"
      >
        <ModalHeader
          lang={lang}
          title={t(lang, "jiraConflictTitle")}
          onClose={onClose}
          dragHandleProps={handleProps}
          onResetLayout={() => {
            dragReset();
            sizeReset();
          }}
        />
        <p className="bg-surface px-6 pb-2 text-xs text-foreground dark:text-muted-foreground">
          {t(lang, "jiraConflictSubtitle", conflicts.length)}
        </p>

        <div className="flex flex-wrap items-center gap-2 border-b border-line bg-surface-muted px-6 py-2 text-xs">
          <span className="text-muted-foreground">
            {t(lang, "jiraConflictQuickPicks")}
          </span>
          <Button variant="secondary" size="xs" onClick={() => applyAll("local")}>
            {t(lang, "jiraConflictAllLocal")}
          </Button>
          <Button variant="secondary" size="xs" onClick={() => applyAll("remote")}>
            {t(lang, "jiraConflictAllRemote")}
          </Button>
        </div>

        <ul className="divide-y divide-line">
          {conflicts.map((c) => (
            <li key={c.taskId} className="px-6 py-4">
              <div className="mb-2 flex flex-wrap items-baseline gap-2">
                <span className="font-mono text-xs text-muted-foreground">
                  #{c.taskId}
                </span>
                <span className="rounded bg-surface-muted px-1.5 py-0.5 text-[10px] font-medium text-ui-dark-blue">
                  {c.jiraKey}
                </span>
                {c.jiraIssueType && (
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    {c.jiraIssueType}
                  </span>
                )}
              </div>
              <DataTable
                className="w-full text-xs"
                head={<>
                  <tr>
                    <th className="relative px-2 py-1 text-left font-medium" style={{ width: colWidths.field, minWidth: colWidths.field }}>
                      {t(lang, "jiraConflictField")}
                      <ColumnResizeHandle col="field" onMouseDown={startResize} />
                    </th>
                    <th className="relative px-2 py-1 text-left font-medium" style={{ width: colWidths.local, minWidth: colWidths.local }}>
                      {t(lang, "jiraConflictLocal")}
                      <ColumnResizeHandle col="local" onMouseDown={startResize} />
                    </th>
                    <th className="relative px-2 py-1 text-left font-medium" style={{ width: colWidths.remote, minWidth: colWidths.remote }}>
                      {t(lang, "jiraConflictRemote")}
                      <ColumnResizeHandle col="remote" onMouseDown={startResize} />
                    </th>
                  </tr>
                </>}
              >
                  {c.fields.map((f) => {
                    const lockedRemote = f.key === "assignee";
                    const pick = picks[c.taskId]?.picks[f.key] ?? "remote";
                    return (
                      <tr
                        key={f.key}
                        className="border-t border-line"
                      >
                        <td className="px-2 py-2 align-top font-medium text-foreground">
                          {t(lang, fieldLabelKey[f.key])}
                          {lockedRemote && (
                            <span className="ml-1 text-muted-foreground">
                              🔒
                            </span>
                          )}
                        </td>
                        <td className="px-2 py-2 align-top">
                          <label
                            className={`flex cursor-pointer items-start gap-2 ${lockedRemote ? "cursor-not-allowed opacity-50" : ""}`}
                          >
                            <input
                              type="radio"
                              name={`pick-${c.taskId}-${f.key}`}
                              checked={pick === "local"}
                              onChange={() => setPick(c.taskId, f.key, "local")}
                              disabled={lockedRemote}
                              className="mt-0.5"
                            />
                            <span className="whitespace-pre-wrap break-words text-foreground">
                              {fmt(f.localValue)}
                            </span>
                          </label>
                        </td>
                        <td className="px-2 py-2 align-top">
                          <label className="flex cursor-pointer items-start gap-2">
                            <input
                              type="radio"
                              name={`pick-${c.taskId}-${f.key}`}
                              checked={pick === "remote"}
                              onChange={() =>
                                setPick(c.taskId, f.key, "remote")
                              }
                              className="mt-0.5"
                            />
                            <span className="whitespace-pre-wrap break-words text-foreground">
                              {fmt(f.remoteValue)}
                            </span>
                          </label>
                        </td>
                      </tr>
                    );
                  })}
              </DataTable>
            </li>
          ))}
        </ul>

        <footer className="sticky bottom-0 flex items-center justify-end gap-2 border-t border-line bg-surface px-6 py-3">
          <Button variant="secondary" size="sm" onClick={onClose}>
            {t(lang, "jiraConflictDefer")}
          </Button>
          <Button variant="primary" size="sm" onClick={handleResolve}>
            {t(lang, "jiraConflictApply")}
          </Button>
        </footer>
      </div>
    </Modal>
  );
}
