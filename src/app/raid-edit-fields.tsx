"use client";

// Presentational field sections for the RAID edit modal: the linked-tasks
// chip picker and the "caused by" / "items caused by this" chip picker. The
// modal owns the draft, query state, derived option lists, and add/remove
// handlers, and threads them in — these only render.
import { type Lang, t } from "./i18n";
import { InfoTooltip } from "./info-tooltip";
import { type RaidItem, type Task } from "./types";

export function RaidLinkedTasksField({
  lang,
  linkedTaskIds,
  tasks,
  isNew,
  onCreateMitigationTask,
  taskPickerQuery,
  setTaskPickerQuery,
  availableTasks,
  addLinked,
  removeLinked,
}: {
  lang: Lang;
  linkedTaskIds: readonly number[];
  tasks: readonly Task[];
  isNew: boolean;
  onCreateMitigationTask: () => void;
  taskPickerQuery: string;
  setTaskPickerQuery: (v: string) => void;
  availableTasks: readonly Task[];
  addLinked: (taskId: number) => void;
  removeLinked: (taskId: number) => void;
}) {
  return (
    <div className="sm:col-span-2">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="flex items-center gap-1 text-sm font-medium text-foreground">
          {t(lang, "raidLinkedTasks")}
          <InfoTooltip text={t(lang, "raidFieldLinkedTasksHint")} />
        </span>
        <button
          type="button"
          onClick={onCreateMitigationTask}
          disabled={isNew}
          title={t(lang, "raidCreateMitigationTaskHint")}
          className="rounded-md border border-AIPM-dark-blue bg-surface px-2 py-1 text-xs font-medium text-AIPM-dark-blue hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-50 dark:border-AIPM-blue dark:text-AIPM-blue"
        >
          {t(lang, "raidCreateMitigationTask")}
        </button>
      </div>
      <div className="mb-2 flex flex-wrap gap-1.5">
        {linkedTaskIds.length === 0 && (
          <span className="text-xs italic text-muted-foreground">—</span>
        )}
        {linkedTaskIds.map((tid) => {
          const tk = tasks.find((task) => task.id === tid);
          return (
            <span
              key={tid}
              className="inline-flex items-center gap-1 rounded bg-surface-muted px-2 py-0.5 text-xs text-foreground"
            >
              <span className="font-mono">#{tid}</span>
              <span className="max-w-[200px] truncate">
                {tk?.taskName ?? ""}
              </span>
              <button
                type="button"
                onClick={() => removeLinked(tid)}
                aria-label={t(lang, "raidUnlinkTask")}
                title={t(lang, "raidUnlinkTask")}
                className="text-muted-foreground hover:text-AIPM-pink"
              >
                ×
              </button>
            </span>
          );
        })}
      </div>
      <div className="relative">
        <input
          type="text"
          value={taskPickerQuery}
          onChange={(e) => setTaskPickerQuery(e.target.value)}
          placeholder={t(lang, "raidLinkPickerPlaceholder")}
          className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm"
        />
        {taskPickerQuery.trim() !== "" && availableTasks.length > 0 && (
          <ul className="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-md border border-line bg-surface">
            {availableTasks.map((tk) => (
              <li key={tk.id}>
                <button
                  type="button"
                  onClick={() => addLinked(tk.id)}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-surface-muted"
                >
                  <span className="font-mono text-xs text-muted-foreground">
                    #{tk.id}
                  </span>
                  <span className="truncate">{tk.taskName}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export function RaidCausedByField({
  lang,
  parentItems,
  causePickerQuery,
  setCausePickerQuery,
  availableCauses,
  addCausedBy,
  removeCausedBy,
  onJumpToRaid,
  causedChildren,
  isNew,
}: {
  lang: Lang;
  parentItems: readonly RaidItem[];
  causePickerQuery: string;
  setCausePickerQuery: (v: string) => void;
  availableCauses: readonly RaidItem[];
  addCausedBy: (parentId: number) => void;
  removeCausedBy: (parentId: number) => void;
  onJumpToRaid: (id: number) => void;
  causedChildren: readonly RaidItem[];
  isNew: boolean;
}) {
  return (
    <>
      {/* Caused by ----------------------------------------------- */}
      <div className="sm:col-span-2">
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="flex items-center gap-1 text-sm font-medium text-foreground">
            {t(lang, "raidCausedBy")}
            <InfoTooltip text={t(lang, "raidFieldCausedByHint")} />
          </span>
        </div>
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          {parentItems.length === 0 && (
            <span className="text-xs italic text-muted-foreground">—</span>
          )}
          {parentItems.map((p) => (
            <span
              key={p.id}
              className="inline-flex items-center gap-1 rounded bg-surface-muted px-2 py-0.5 text-xs text-foreground"
            >
              <button
                type="button"
                onClick={() => onJumpToRaid(p.id)}
                title={p.title}
                className="inline-flex items-center gap-1 hover:underline"
              >
                <span className="font-mono">
                  ↩ {p.category}#{p.id}
                </span>
                <span className="max-w-[220px] truncate">{p.title}</span>
              </button>
              <button
                type="button"
                onClick={() => removeCausedBy(p.id)}
                aria-label={t(lang, "raidCausedByClear")}
                title={t(lang, "raidCausedByClear")}
                className="text-muted-foreground hover:text-AIPM-pink"
              >
                ×
              </button>
            </span>
          ))}
        </div>
        <div className="relative">
          <input
            type="text"
            value={causePickerQuery}
            onChange={(e) => setCausePickerQuery(e.target.value)}
            placeholder={t(lang, "raidCausedByPlaceholder")}
            className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm"
          />
          {causePickerQuery.trim() !== "" && availableCauses.length > 0 && (
            <ul className="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-md border border-line bg-surface">
              {availableCauses.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => addCausedBy(r.id)}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-surface-muted"
                  >
                    <span className="font-mono text-xs text-muted-foreground">
                      {r.category}#{r.id}
                    </span>
                    <span className="truncate">{r.title}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Items caused by this — read-only. The user breaks the link by
          editing the child. Only shown for saved items with children. */}
      {!isNew && causedChildren.length > 0 && (
        <div className="sm:col-span-2">
          <span className="mb-2 block text-sm font-medium text-foreground">
            {t(lang, "raidCausedThis")}
          </span>
          <div className="flex flex-wrap gap-1.5">
            {causedChildren.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => onJumpToRaid(c.id)}
                title={c.title}
                className="inline-flex items-center gap-1 rounded bg-AIPM-purple/10 px-2 py-0.5 text-xs text-AIPM-purple hover:bg-AIPM-purple/20 dark:bg-AIPM-purple/15 dark:hover:bg-AIPM-purple/25"
              >
                <span className="font-mono">{c.category}#{c.id}</span>
                <span className="max-w-[220px] truncate">{c.title}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
