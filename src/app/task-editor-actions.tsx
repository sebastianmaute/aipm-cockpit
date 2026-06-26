import { type Lang, t } from "./i18n";
import { INTERACTIVE } from "./interaction-styles";
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
 * Action buttons for the task editor (modern TaskEditView footer + classic
 * TaskFormModal). Only rendered for an EXISTING task and never in popouts —
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
      className={`rounded-md border border-AIPM-pink/40 bg-surface px-4 py-1.5 text-sm font-medium text-AIPM-pink-strong hover:bg-AIPM-pink/10 disabled:cursor-not-allowed disabled:opacity-50 dark:border-AIPM-pink/50 ${INTERACTIVE}`}
    >
      {t(lang, "delete")}
    </button>
  );
}
