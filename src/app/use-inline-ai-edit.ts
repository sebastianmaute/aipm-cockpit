// src/app/use-inline-ai-edit.ts
//
// State-machine hook tying the inline "Ask Claude" task editor together:
// idle -> thinking -> preview|clarify|error, then apply -> idle. One instance
// lives in the tasks pane and manages the single active edit.
"use client";
import { useCallback, useRef, useState } from "react";
import { type Lang, t } from "./i18n";
import { type Task } from "./types";
import { type Workspace } from "./workspace";
import { type ToolDispatcher, runTool } from "./chat-tools";
import { type AiConfig, isAiEnabled } from "./settings-types";
import { type OperatingGuide } from "./operating-guide";
import { type ActivityKind } from "./activity-log";
import { callInlineEdit } from "./inline-ai-edit-call";
import { describeToolCalls, isEmptyPlan, type EditPlan } from "./inline-ai-edit/plan";

export type InlinePhase = "idle" | "thinking" | "preview" | "clarify" | "applying" | "error";

export interface InlineAiEditDeps {
  dispatcher: ToolDispatcher;
  ai: AiConfig;
  apiKey: string;
  isPopout: boolean;
  lang: Lang;
  logActivity?: (kind: ActivityKind, ...args: (string | number)[]) => void;
  showToast: (kind: "info" | "error", text: string) => void;
  ws: Workspace;
  guides: readonly OperatingGuide[];
  recordUsage?: (u: { input_tokens: number; output_tokens: number }) => void;
}

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
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [phase, setPhase] = useState<InlinePhase>("idle");
  const [plan, setPlan] = useState<EditPlan | null>(null);
  const [clarifyText, setClarifyText] = useState("");
  const [errorText, setErrorText] = useState("");
  // Monotonic request generation: bumped on open/cancel/submit so a slow
  // callInlineEdit that resolves after the active task changed can't land its
  // plan on the wrong task (stale-response cross-task overwrite).
  const reqIdRef = useRef(0);

  const aiEditEnabled = (task: Task): boolean =>
    isAiEnabled(deps.ai) && !deps.isPopout && !task.jiraKey && !!deps.apiKey.trim();

  const openFor = (task: Task) => {
    if (!aiEditEnabled(task)) return;
    reqIdRef.current++; // supersede any in-flight submit for a previous task
    setActiveTask(task);
    setPhase("idle");
    setPlan(null);
    setClarifyText("");
    setErrorText("");
  };

  // Stable identity so usePopoverDismiss (which depends on onClose) doesn't
  // re-subscribe its listeners on every keystroke.
  const cancel = useCallback(() => {
    reqIdRef.current++; // supersede any in-flight submit
    setActiveTask(null);
    setPhase("idle");
    setPlan(null);
    setClarifyText("");
    setErrorText("");
  }, []);

  const submit = async (instruction: string) => {
    if (!activeTask || !instruction.trim() || phase === "thinking" || phase === "applying") return;
    const reqId = ++reqIdRef.current; // this submit's generation
    const target = activeTask;        // capture — activeTask may change while awaiting
    setPhase("thinking");
    setErrorText("");
    setClarifyText("");
    try {
      const { blocks, text, usage } = await callInlineEdit({
        apiKey: deps.apiKey,
        model: deps.ai.model,
        lang: deps.lang,
        task: target,
        instruction,
        snapshot: deps.dispatcher.getSnapshot(),
        guides: deps.guides,
        groundInGuides: deps.ai.groundInGuides,
      });
      if (reqId !== reqIdRef.current) return; // superseded (cancel / new open / new submit) — discard
      deps.recordUsage?.(usage);
      const next = describeToolCalls(blocks, { task: target, ws: deps.ws });
      if (isEmptyPlan(next)) {
        setClarifyText(text || t(deps.lang, "inlineAiEditNoChanges"));
        setPhase("clarify");
        return;
      }
      setPlan(next);
      setPhase("preview");
    } catch {
      if (reqId !== reqIdRef.current) return; // stale failure — don't clobber the current task's state
      setErrorText(t(deps.lang, "inlineAiEditError"));
      setPhase("error");
    }
  };

  const apply = async () => {
    if (!activeTask || !plan || isEmptyPlan(plan) || phase !== "preview") return;
    setPhase("applying");
    // The apply sequence is NON-transactional (each runTool commits + persists
    // immediately). Track how many ops committed so a mid-sequence failure isn't
    // misreported as a total failure with a stranded write.
    let applied = 0;
    try {
      if (plan.updates.length > 0) {
        const patch: Record<string, unknown> = { id: activeTask.id };
        for (const d of plan.updates) patch[d.field] = coerceField(d.field, d.after);
        await runTool(deps.dispatcher, "update_task", patch);
        applied++;
      }
      for (const c of plan.creates) { await runTool(deps.dispatcher, c.toolName, c.input); applied++; }
      for (const del of plan.deletes) { await runTool(deps.dispatcher, del.toolName, { id: del.id }); applied++; }
      deps.logActivity?.("ai.inlineEdit", activeTask.id, activeTask.taskName);
      deps.showToast("info", t(deps.lang, "inlineAiEditApplied", activeTask.taskName));
      cancel();
    } catch {
      if (applied > 0) {
        // Earlier ops already committed — log them and close with an honest
        // partial notice instead of the misleading "couldn't reach Claude".
        deps.logActivity?.("ai.inlineEdit", activeTask.id, activeTask.taskName);
        deps.showToast("error", t(deps.lang, "inlineAiEditPartial"));
        cancel();
      } else {
        // Nothing was written (e.g. the first op failed validation).
        setErrorText(t(deps.lang, "inlineAiEditApplyFailed"));
        setPhase("error");
      }
    }
  };

  return { activeTask, phase, plan, clarifyText, errorText, aiEditEnabled, openFor, submit, apply, cancel };
}

function coerceField(field: string, value: string): unknown {
  if (field === "labels") return value ? value.split(",").map((s) => s.trim()).filter(Boolean) : [];
  return value;
}
