// src/app/use-inline-ai-edit.ts
//
// Thin task-bound wrapper over the generic useInlineEntityEdit, preserving SP1's
// public API (activeTask + the task-only !jiraKey gate) so the tasks pane and
// its tests are unchanged.
"use client";
import { type Task } from "./types";
import { useInlineEntityEdit, type InlineEntityEditDeps, type InlinePhase } from "./use-inline-entity-edit";
import { type EditPlan } from "./inline-ai-edit/plan";

export type { InlinePhase };

// A type alias (NOT `interface … extends … {}`) — an empty extending interface
// trips @typescript-eslint/no-empty-object-type under max-warnings=0.
export type InlineAiEditDeps = Omit<InlineEntityEditDeps, "entity" | "gate">;

export interface InlineAiEditApi {
  activeTask: Task | null;
  phase: InlinePhase;
  plan: EditPlan | null;
  clarifyText: string;
  errorText: string;
  aiEditEnabled: (task: Task) => boolean;
  openFor: (task: Task) => void;
  submit: (instruction: string) => Promise<void>;
  apply: () => Promise<void>;
  cancel: () => void;
}

export function useInlineAiEdit(deps: InlineAiEditDeps): InlineAiEditApi {
  const api = useInlineEntityEdit({
    ...deps,
    entity: "task",
    gate: (item) => !(item as Task).jiraKey,
  });
  return {
    activeTask: api.activeItem as Task | null,
    phase: api.phase, plan: api.plan, clarifyText: api.clarifyText, errorText: api.errorText,
    aiEditEnabled: api.aiEditEnabled as (task: Task) => boolean,
    openFor: api.openFor as (task: Task) => void,
    submit: api.submit, apply: api.apply, cancel: api.cancel,
  };
}
