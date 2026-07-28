"use client";

// Presentational field sections for the RAID edit modal: the linked-tasks
// chip picker and the "caused by" / "items caused by this" chip picker. The
// modal owns the draft, query state, derived option lists, and add/remove
// handlers, and threads them in — these only render.
import { type Lang, t } from "./i18n";
import { InfoTooltip } from "./info-tooltip";
import { type RaidItem, type Task } from "./types";
import { INTERACTIVE } from "./interaction-styles";
import { TaskLinkPicker } from "./task-link-picker";
import { EntityLinkPicker, type LinkPickerEntry } from "./entity-link-picker";

/** RAID items are identified by category + id — the category is the single
 *  letter `R`/`A`/`I`/`D`, so this reads "R#7", not "Risk#7". That composition
 *  is also what makes each chip's remove button row-unique in the shared
 *  picker, and `raid-edit-fields.test.tsx` pins the exact resulting name. */
const raidEntry = (item: RaidItem): LinkPickerEntry => ({
  id: item.id,
  code: `${item.category}#${item.id}`,
  label: item.title,
});

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
        <EntityLinkPicker
          selected={parentItems.map(raidEntry)}
          options={availableCauses.map(raidEntry)}
          query={causePickerQuery}
          onQueryChange={setCausePickerQuery}
          onAdd={addCausedBy}
          onRemove={removeCausedBy}
          onOpen={onJumpToRaid}
          // Was a placeholder alone — which is not an accessible name, so the
          // search box had none. Named now.
          searchLabel={t(lang, "raidCausedBy")}
          clearLabel={`${t(lang, "clear")} – ${t(lang, "raidCausedBy")}`}
          placeholder={t(lang, "raidCausedByPlaceholder")}
          removeLabel={t(lang, "raidCausedByClear")}
          inputSize="md"
        />
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
                // Same label-bleed fix as the picker chips above: adjacent
                // inline spans concatenate with no separator, so
                // name-from-content computes "R#3Downstream slip".
                aria-label={`${c.category}#${c.id} ${c.title}`}
                className={`inline-flex items-center gap-1 rounded bg-ui-purple/10 px-2 py-0.5 text-xs text-ui-purple-strong hover:bg-ui-purple/20 dark:bg-ui-purple/15 dark:hover:bg-ui-purple/25 ${INTERACTIVE}`}
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
