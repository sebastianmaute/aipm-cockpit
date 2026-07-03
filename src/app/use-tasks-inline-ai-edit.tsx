"use client";

// Tasks-pane glue for the inline "Ask Claude" editor (SP1). Wraps useInlineAiEdit
// with the pane's context adapters (toast, AI-usage naming, effective key) and
// owns the popover element, so tasks-section stays lean. Pure render glue — no
// logic worth unit-testing here (the hook + popover have their own tests); this
// file is excluded from the coverage gate.

import { type ReactNode } from "react";
import { type Lang } from "./i18n";
import { type Settings, aiKeyIfEnabled } from "./settings-types";
import { type ToolDispatcher } from "./chat-tools";
import { type ActivityKind } from "./activity-log";
import { type Task } from "./types";
import { useWorkspace } from "./workspace-context";
import { useToastContext } from "./toast-context";
import { useAiUsageContext } from "./ai-usage-context";
import { useInlineAiEdit } from "./use-inline-ai-edit";
import { InlineAiEditPopover } from "./inline-ai-edit-popover";

type WorkspaceCtx = ReturnType<typeof useWorkspace>;

export interface TasksInlineAiEditDeps {
  dispatcher: ToolDispatcher;
  settings: Settings;
  isPopout: boolean;
  lang: Lang;
  logActivity?: (kind: ActivityKind, ...args: (string | number)[]) => void;
  /** The live workspace context (structural superset of Workspace). */
  workspaceCtx: WorkspaceCtx;
}

export interface TasksInlineAiEdit {
  onAiEdit: (task: Task) => void;
  aiEditEnabled: (task: Task) => boolean;
  /** The active-edit popover element (null when no edit is open). */
  popover: ReactNode;
}

export function useTasksInlineAiEdit(deps: TasksInlineAiEditDeps): TasksInlineAiEdit {
  const showToast = useToastContext();
  const { record } = useAiUsageContext();
  const inlineEdit = useInlineAiEdit({
    dispatcher: deps.dispatcher,
    ai: deps.settings.ai,
    apiKey: aiKeyIfEnabled(deps.settings.ai),
    isPopout: deps.isPopout,
    lang: deps.lang,
    logActivity: deps.logActivity,
    showToast,
    ws: deps.workspaceCtx,
    guides: [],
    recordUsage: (u) => record({ input: u.input_tokens, output: u.output_tokens }),
  });
  // Hoisted locals (not `inlineEdit.member`) so the caller's useMemo dep arrays
  // stay exhaustive-deps clean.
  const { openFor: onAiEdit, aiEditEnabled } = inlineEdit;
  const popover = inlineEdit.activeTask ? (
    <InlineAiEditPopover
      lang={deps.lang}
      task={inlineEdit.activeTask}
      phase={inlineEdit.phase}
      plan={inlineEdit.plan}
      clarifyText={inlineEdit.clarifyText}
      errorText={inlineEdit.errorText}
      onSubmit={inlineEdit.submit}
      onApply={inlineEdit.apply}
      onCancel={inlineEdit.cancel}
    />
  ) : null;
  return { onAiEdit, aiEditEnabled, popover };
}
