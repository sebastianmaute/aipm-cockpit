import type { ReactNode } from "react";
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

/**
 * Action buttons for the task editor (TaskFormModal footer, all layouts).
 * `Button variant="secondary" size="sm"` (§102), the same as the footer's
 * two-way Jira sync button beside them, so the three match.
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
      <Button type="button" variant="secondary" size="sm" onClick={() => onSendInquiry(task)}>
        {t(lang, "sendInquiry")}
      </Button>
      {showPush && (
        <Button type="button" variant="secondary" size="sm" onClick={() => onPushToJira(task.id)}>
          {t(lang, "jiraPushToJira")}
        </Button>
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
 * new-linked-task button, on ONE row. The button is the mini's `trailing`
 * slot, so it lands in whichever row the mini shows: beside the toggle when
 * collapsed, after Add in the bottom-aligned form row when open (with
 * `flex-wrap` dropping it to the next line when the form is wide). It used to
 * sit after the whole mini in an `items-start` row, level with the form's
 * labels (eye check, batch 17). Do NOT reach into the mini's `open` state
 * to place it — the parent has no business knowing.
 * Rendered below the fields in the modal editor; caller gates on `!isPopout`.
 */
export function TaskEditorExtras({
  lang,
  onAddRaid,
  pendingRaid,
  onNewLinkedTask,
}: TaskEditorExtrasProps) {
  return (
    <TaskEditorRaidMini
      lang={lang}
      onAdd={onAddRaid}
      pending={pendingRaid}
      trailing={
        <Button variant="secondary" size="sm" onClick={onNewLinkedTask}>
          {`+ ${t(lang, "taskEditorNewLinkedTask")}`}
        </Button>
      }
    />
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

/** Live render-scope values the task editor's footer chrome reads each render. */
export interface TaskEditorChromeDeps {
  lang: Lang;
  isPopout: boolean;
  /** The task open in the editor, or null in create mode. */
  editingTask: Task | null;
  editingIsJiraLinked: boolean;
  /** The GLOBAL `settings.jira` — only `enabled` and `projectKey` are read. */
  jira: { enabled: boolean; projectKey?: string };
  jiraSyncing: boolean;
  onSendInquiry: (task: Task) => void;
  onPushToJira: (taskId: number) => Promise<unknown>;
  handleJiraSync: () => Promise<unknown>;
  onDelete: (id: number) => void;
  onAddRaid: (spec: RaidSpec) => void;
  pendingRaid: readonly RaidSpec[];
  onNewLinkedTask: () => void;
}

/**
 * §491 step 11 — the task editor's footer chrome, extracted from task-manager
 * (move-only). A plain builder, NOT a hook (no hook calls), like
 * `buildShellChrome`. Returns the three TaskFormModal slots; gates unchanged:
 * the leading actions and Delete need an EXISTING task outside popouts, the
 * two-way Jira sync button a Jira-linked task with Jira enabled, the extras
 * only `!isPopout`.
 */
export function buildTaskEditorChrome(deps: TaskEditorChromeDeps): {
  editorLeadingActions: ReactNode;
  editorDeleteAction: ReactNode;
  editorExtrasEl: ReactNode;
} {
  const { lang, isPopout, editingTask, editingIsJiraLinked, jira, jiraSyncing } = deps;

  // Send inquiry / Push to Jira — only for an EXISTING task, never in popouts
  // (read-only). Push is additionally hidden for unconfigured Jira or an
  // already-synced task.
  const editorActions =
    editingTask && !isPopout ? (
      <TaskEditorActions
        lang={lang}
        task={editingTask}
        jiraConfigured={jira.enabled && !!jira.projectKey}
        onSendInquiry={deps.onSendInquiry}
        onPushToJira={(id) => {
          void deps.onPushToJira(id);
        }}
      />
    ) : null;

  // Footer leading actions: send-inquiry/push-Jira plus the two-way Jira sync
  // button for a Jira-linked task (§102: the shared Button primitive).
  const editorLeadingActions = (
    <>
      {editorActions}
      {editingIsJiraLinked && jira.enabled && (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => { void deps.handleJiraSync(); }}
          disabled={jiraSyncing}
        >
          {t(lang, jiraSyncing ? "jiraSyncing" : "jiraSync")}
        </Button>
      )}
    </>
  );

  // Delete button — left side of footer, only for an EXISTING task, never in popouts.
  const editorDeleteAction =
    editingTask && !isPopout ? (
      <TaskDeleteButton lang={lang} taskId={editingTask.id} onDelete={deps.onDelete} />
    ) : null;

  // Shared editor extras (create-RAID mini-form + new-linked-task button, on
  // one row), mounted below the fields in the modal editor. Never in popouts.
  const editorExtrasEl = !isPopout ? (
    <TaskEditorExtras
      lang={lang}
      onAddRaid={deps.onAddRaid}
      pendingRaid={deps.pendingRaid}
      onNewLinkedTask={deps.onNewLinkedTask}
    />
  ) : null;

  return { editorLeadingActions, editorDeleteAction, editorExtrasEl };
}
