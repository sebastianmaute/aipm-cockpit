import { type Lang, t } from "./i18n";
import { Button } from "./button";
import { INTERACTIVE } from "./interaction-styles";
import { TaskEditorRaidMini } from "./task-editor-raid-mini";
import type { RaidSpec } from "./use-task-editor-buffer";
import type { Task } from "./types";

interface TaskEditorActionsProps {
  lang: Lang;
  /** The existing task being edited. */
  task: Task;
  /** settings.jira.enabled && !!settings.jira.projectKey */
  jiraConfigured: boolean;
  onSendInquiry: (task: Task) => void;
  /** Fire-and-forget wrapper around the async push. */
  onPushToJira: (taskId: number) => void;
}

const ACTION_BUTTON_CLASS =
  `rounded-md border border-line bg-surface px-4 py-1.5 text-sm font-medium text-foreground hover:bg-surface-muted dark:border-line dark:bg-surface dark:text-foreground dark:hover:bg-surface-muted ${INTERACTIVE}`;

/**
 * Action buttons for the task editor (TaskFormModal footer, all layouts).
 * Only rendered for an EXISTING task and never in popouts —
 * the caller gates on `editingTask !== null && !isPopout`. Push to Jira is
 * additionally hidden for already-synced tasks or when Jira is unconfigured.
 */
export function TaskEditorActions({
  lang,
  task,
  jiraConfigured,
  onSendInquiry,
  onPushToJira,
}: TaskEditorActionsProps) {
  const showPush = jiraConfigured && !task.jiraKey;
  return (
    <>
      <button
        type="button"
        onClick={() => onSendInquiry(task)}
        className={ACTION_BUTTON_CLASS}
      >
        {t(lang, "sendInquiry")}
      </button>
      {showPush && (
        <button
          type="button"
          onClick={() => onPushToJira(task.id)}
          className={ACTION_BUTTON_CLASS}
        >
          {t(lang, "jiraPushToJira")}
        </button>
      )}
    </>
  );
}

interface TaskEditorExtrasProps {
  lang: Lang;
  /** Forwarded to TaskEditorRaidMini's `onAdd`. */
  onAddRaid: (spec: RaidSpec) => void;
  /** Forwarded to TaskEditorRaidMini's `pending` (create-mode staged specs). */
  pendingRaid: readonly RaidSpec[];
  onNewLinkedTask: () => void;
}

/**
 * The task editor's extra actions: the create-RAID mini-form and the
 * new-linked-task button, on ONE row. `flex-wrap` is what handles the RAID
 * mini expanding in place into a wide category+title form — the linked-task
 * button then drops to the next line on its own. Do NOT reach into the
 * mini's `open` state to size this row — the parent has no business knowing.
 * Rendered below the fields in the modal editor; caller gates on `!isPopout`.
 */
export function TaskEditorExtras({
  lang,
  onAddRaid,
  pendingRaid,
  onNewLinkedTask,
}: TaskEditorExtrasProps) {
  return (
    <div className="flex flex-wrap items-start gap-2">
      <TaskEditorRaidMini lang={lang} onAdd={onAddRaid} pending={pendingRaid} />
      <Button variant="secondary" size="sm" onClick={onNewLinkedTask}>
        {`+ ${t(lang, "taskEditorNewLinkedTask")}`}
      </Button>
    </div>
  );
}

/** Pink destructive Delete button for the task editor footer left side. */
export function TaskDeleteButton({
  lang,
  taskId,
  onDelete,
}: {
  lang: Lang;
  taskId: number;
  onDelete: (id: number) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onDelete(taskId)}
      className={`rounded-md border border-ui-pink/40 bg-surface px-4 py-1.5 text-sm font-medium text-ui-pink-strong hover:bg-ui-pink/10 disabled:cursor-not-allowed disabled:opacity-50 dark:border-ui-pink/50 dark:hover:bg-ui-pink/5 ${INTERACTIVE}`}
    >
      {t(lang, "delete")}
    </button>
  );
}
