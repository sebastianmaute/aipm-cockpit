"use client";

import { useMemo, useState } from "react";
import { type Lang, type TranslationKey, t } from "./i18n";
import type { ConflictFieldKey, ConflictItem } from "./jira-api";
import { Modal } from "./modal";
import { useResizable } from "./use-resizable";

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
  notes: "notes",
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

  const { ref: panelRef } = useResizable("lop-app:conflicts-modal-size");

  return (
    <Modal open onClose={onClose} ariaLabel={t(lang, "jiraConflictTitle")}>
      <div
        ref={panelRef}
        className="relative h-[680px] max-h-[95vh] min-h-[320px] w-[768px] min-w-[400px] max-w-[95vw] resize overflow-y-auto rounded-xl border border-AIPM-light-grey bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-950"
      >
        <header className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-AIPM-light-grey bg-white px-6 py-4 dark:border-zinc-800 dark:bg-zinc-950">
          <div>
            <h2 className="text-lg font-semibold text-AIPM-dark-blue dark:text-AIPM-light-grey">
              {t(lang, "jiraConflictTitle")}
            </h2>
            <p className="mt-0.5 text-xs text-AIPM-dark-grey dark:text-AIPM-medium-grey">
              {t(lang, "jiraConflictSubtitle", conflicts.length)}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t(lang, "alertModalClose")}
            className="rounded-md p-2 text-AIPM-dark-grey hover:bg-AIPM-light-grey hover:text-AIPM-dark-blue dark:text-AIPM-medium-grey dark:hover:bg-zinc-800 dark:hover:text-AIPM-light-grey"
          >
            <svg
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden="true"
              className="h-4 w-4"
            >
              <path
                fillRule="evenodd"
                d="M4.28 4.28a.75.75 0 011.06 0L10 8.94l4.66-4.66a.75.75 0 111.06 1.06L11.06 10l4.66 4.66a.75.75 0 11-1.06 1.06L10 11.06l-4.66 4.66a.75.75 0 01-1.06-1.06L8.94 10 4.28 5.34a.75.75 0 010-1.06z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        </header>

        <div className="flex flex-wrap items-center gap-2 border-b border-AIPM-light-grey bg-AIPM-light-grey/40 px-6 py-2 text-xs dark:border-zinc-800 dark:bg-zinc-900">
          <span className="text-AIPM-medium-grey">
            {t(lang, "jiraConflictQuickPicks")}
          </span>
          <button
            type="button"
            onClick={() => applyAll("local")}
            className="rounded-md border border-AIPM-medium-grey/30 bg-white px-2 py-1 font-medium text-AIPM-dark-blue hover:bg-AIPM-light-grey dark:bg-zinc-900 dark:hover:bg-zinc-800"
          >
            {t(lang, "jiraConflictAllLocal")}
          </button>
          <button
            type="button"
            onClick={() => applyAll("remote")}
            className="rounded-md border border-AIPM-medium-grey/30 bg-white px-2 py-1 font-medium text-AIPM-dark-blue hover:bg-AIPM-light-grey dark:bg-zinc-900 dark:hover:bg-zinc-800"
          >
            {t(lang, "jiraConflictAllRemote")}
          </button>
        </div>

        <ul className="divide-y divide-AIPM-light-grey dark:divide-zinc-800">
          {conflicts.map((c) => (
            <li key={c.taskId} className="px-6 py-4">
              <div className="mb-2 flex flex-wrap items-baseline gap-2">
                <span className="font-mono text-xs text-AIPM-medium-grey">
                  #{c.taskId}
                </span>
                <span className="rounded bg-AIPM-light-grey px-1.5 py-0.5 text-[10px] font-medium text-AIPM-dark-blue dark:bg-zinc-800">
                  {c.jiraKey}
                </span>
                {c.jiraIssueType && (
                  <span className="text-[10px] uppercase tracking-wide text-AIPM-medium-grey">
                    {c.jiraIssueType}
                  </span>
                )}
              </div>
              <table className="w-full text-xs">
                <thead className="text-AIPM-medium-grey">
                  <tr>
                    <th className="w-32 px-2 py-1 text-left font-medium">
                      {t(lang, "jiraConflictField")}
                    </th>
                    <th className="px-2 py-1 text-left font-medium">
                      {t(lang, "jiraConflictLocal")}
                    </th>
                    <th className="px-2 py-1 text-left font-medium">
                      {t(lang, "jiraConflictRemote")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {c.fields.map((f) => {
                    const lockedRemote = f.key === "assignee";
                    const pick = picks[c.taskId]?.picks[f.key] ?? "remote";
                    return (
                      <tr
                        key={f.key}
                        className="border-t border-AIPM-light-grey/50 dark:border-zinc-800"
                      >
                        <td className="px-2 py-2 align-top font-medium text-AIPM-dark-grey dark:text-AIPM-light-grey">
                          {t(lang, fieldLabelKey[f.key])}
                          {lockedRemote && (
                            <span className="ml-1 text-AIPM-medium-grey">
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
                            <span className="whitespace-pre-wrap break-words text-AIPM-dark-grey dark:text-AIPM-light-grey">
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
                            <span className="whitespace-pre-wrap break-words text-AIPM-dark-grey dark:text-AIPM-light-grey">
                              {fmt(f.remoteValue)}
                            </span>
                          </label>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </li>
          ))}
        </ul>

        <footer className="sticky bottom-0 flex items-center justify-end gap-2 border-t border-AIPM-light-grey bg-white px-6 py-3 dark:border-zinc-800 dark:bg-zinc-950">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            {t(lang, "jiraConflictDefer")}
          </button>
          <button
            type="button"
            onClick={handleResolve}
            className="rounded-md bg-AIPM-dark-blue px-4 py-2 text-sm font-medium text-white shadow-sm hover:opacity-90"
          >
            {t(lang, "jiraConflictApply")}
          </button>
        </footer>
      <span aria-hidden={true} title={t(lang, "tableResizeHint")}
        className="pointer-events-none absolute bottom-1 right-1 select-none text-zinc-300 dark:text-zinc-600">⠿</span>
      </div>
    </Modal>
  );
}
