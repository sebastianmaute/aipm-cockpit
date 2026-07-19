"use client";

// Presentational field sections for the RAID edit modal: the linked-tasks
// chip picker and the "caused by" / "items caused by this" chip picker. The
// modal owns the draft, query state, derived option lists, and add/remove
// handlers, and threads them in — these only render.
import { type Lang, t } from "./i18n";
import { InfoTooltip } from "./info-tooltip";
import { type RaidItem, type Task } from "./types";
import { INTERACTIVE } from "./interaction-styles";
import { Input } from "./form-controls";
import { TaskLinkPicker } from "./task-link-picker";

export function RaidLinkedTasksField({
  lang,
  linkedTaskIds,
  tasks,
  isNew,
  onCreateMitigationTask,
  addLinked,
  removeLinked,
}: {
  lang: Lang;
  linkedTaskIds: readonly number[];
  tasks: readonly Task[];
  isNew: boolean;
  onCreateMitigationTask: () => void;
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
          className={`rounded-md border border-ui-dark-blue bg-surface px-2 py-1 text-xs font-medium text-ui-dark-blue hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-50 dark:border-ui-blue dark:text-ui-blue ${INTERACTIVE}`}
        >
          {t(lang, "raidCreateMitigationTask")}
        </button>
      </div>
      <TaskLinkPicker
        lang={lang}
        tasks={tasks}
        selectedIds={linkedTaskIds}
        onAdd={addLinked}
        onRemove={removeLinked}
        label={t(lang, "raidLinkedTasks")}
      />
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
                className={`inline-flex items-center gap-1 hover:underline ${INTERACTIVE}`}
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
                className={`text-muted-foreground hover:text-ui-pink ${INTERACTIVE}`}
              >
                ×
              </button>
            </span>
          ))}
        </div>
        <div className="relative">
          <Input
            type="text"
            value={causePickerQuery}
            onChange={(e) => setCausePickerQuery(e.target.value)}
            placeholder={t(lang, "raidCausedByPlaceholder")}
            className="w-full"
          />
          {causePickerQuery.trim() !== "" && availableCauses.length > 0 && (
            <ul className="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-md border border-line bg-surface">
              {availableCauses.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => addCausedBy(r.id)}
                    className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-surface-muted ${INTERACTIVE}`}
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
                className={`inline-flex items-center gap-1 rounded bg-ui-purple/10 px-2 py-0.5 text-xs text-ui-purple hover:bg-ui-purple/20 dark:bg-ui-purple/15 dark:hover:bg-ui-purple/25 ${INTERACTIVE}`}
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
