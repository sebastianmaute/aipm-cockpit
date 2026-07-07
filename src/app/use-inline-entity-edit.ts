// src/app/use-inline-entity-edit.ts
//
// Generic state-machine hook for the inline "Ask Claude" editor, over any
// entity: idle -> thinking -> preview|clarify|error, then apply -> idle. One
// instance lives per pane and manages the single active edit. The per-entity
// descriptor drives which fields diff, how they validate, and how they coerce
// on apply. Task-bound behavior lives in the thin `use-inline-ai-edit` wrapper.
"use client";
import { useCallback, useRef, useState } from "react";
import { type Lang, t } from "./i18n";
import { type Workspace } from "./workspace";
import { type ToolDispatcher, runTool } from "./chat-tools";
import { type AiConfig, isAiEnabled } from "./settings-types";
import { type OperatingGuide } from "./operating-guide";
import { type ActivityKind } from "./activity-log";
import { callInlineEdit } from "./inline-ai-edit-call";
import { describeEntityCalls, isEmptyPlan, type EditPlan } from "./inline-ai-edit/plan";
import { INLINE_DESCRIPTORS, type InlineEntity } from "./inline-ai-edit/entity-descriptor";

export type InlinePhase = "idle" | "thinking" | "preview" | "clarify" | "applying" | "error";
type EntityItem = { id: number; [k: string]: unknown };

export interface InlineEntityEditDeps {
  entity: InlineEntity;
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
  /** Extra per-entity enable clause (task: !jiraKey). MUST be a stable
   *  reference (useCallback / module fn): it feeds the `aiEditEnabled`/`openFor`
   *  useCallbacks, which a caller threads into the task row context value — an
   *  inline arrow here silently rebuilds that value every render and re-renders
   *  every row (the audit #6 regression this hook was fixed to avoid). */
  gate?: (item: EntityItem) => boolean;
  /** False when this entity's pane is not the active view — a left-open edit is
   *  auto-closed (see the render-time reconcile). Undefined ⇒ always active
   *  (the task path, whose pane only mounts when active). */
  active?: boolean;
}

export interface InlineEntityEditApi {
  activeItem: EntityItem | null;
  phase: InlinePhase;
  plan: EditPlan | null;
  clarifyText: string;
  errorText: string;
  aiEditEnabled: (item: EntityItem) => boolean;
  openFor: (item: EntityItem) => void;
  submit: (instruction: string) => Promise<void>;
  apply: () => Promise<void>;
  cancel: () => void;
}

export function useInlineEntityEdit(deps: InlineEntityEditDeps): InlineEntityEditApi {
  const d = INLINE_DESCRIPTORS[deps.entity];
  const [activeItem, setActiveItem] = useState<EntityItem | null>(null);
  const [phase, setPhase] = useState<InlinePhase>("idle");
  const [plan, setPlan] = useState<EditPlan | null>(null);
  const [clarifyText, setClarifyText] = useState("");
  const [errorText, setErrorText] = useState("");
  // Monotonic request generation: bumped on open/cancel/submit so a slow
  // callInlineEdit that resolves after the active item changed can't land its
  // plan on the wrong item (stale-response cross-item overwrite).
  const reqIdRef = useRef(0);
  // AbortController for the in-flight callInlineEdit, so cancel()/openFor() stop
  // the actual (billed) network call — not just discard its result via reqId.
  const abortRef = useRef<AbortController | null>(null);

  // Close a stale edit when this entity's pane is no longer active. Non-mouse
  // nav (global search / deep-link / back-forward / programmatic tab change)
  // doesn't trigger the popover's outside-click dismiss, so without this a
  // left-open edit reappears (and steals focus) on return to the pane.
  // Render-time reconcile — setState only, no ref write, no effect; self-clears
  // once activeItem is null so it can't loop. (An in-flight submit that resolves
  // after this stays invisible: the popover is gated on activeItem, and the next
  // openFor bumps reqId.)
  if (deps.active === false && activeItem !== null) {
    setActiveItem(null);
    setPhase("idle");
    setPlan(null);
    setClarifyText("");
    setErrorText("");
  }

  // Stable identities so consumers threading these through a context value (the
  // task row context) don't rebuild that value — and re-render every row — on
  // every render (audit #6). Hoist the member reads to locals: exhaustive-deps
  // rejects `deps.member` entries in the dep array.
  const { ai, isPopout: aiIsPopout, apiKey, gate } = deps;
  const aiEditEnabled = useCallback(
    (item: EntityItem): boolean =>
      isAiEnabled(ai) && !aiIsPopout && !!apiKey.trim() && (gate?.(item) ?? true),
    [ai, aiIsPopout, apiKey, gate],
  );

  const openFor = useCallback(
    (item: EntityItem) => {
      if (!aiEditEnabled(item)) return;
      abortRef.current?.abort(); // stop the previous item's billed call
      reqIdRef.current++; // supersede any in-flight submit for a previous item
      setActiveItem(item); setPhase("idle"); setPlan(null); setClarifyText(""); setErrorText("");
    },
    [aiEditEnabled],
  );

  // Stable identity so usePopoverDismiss (which depends on onClose) doesn't
  // re-subscribe its listeners on every keystroke.
  const cancel = useCallback(() => {
    abortRef.current?.abort(); // stop the billed call, not just discard its result
    reqIdRef.current++; // supersede any in-flight submit
    setActiveItem(null); setPhase("idle"); setPlan(null); setClarifyText(""); setErrorText("");
  }, []);

  const submit = async (instruction: string) => {
    if (!activeItem || !instruction.trim() || phase === "thinking" || phase === "applying") return;
    const reqId = ++reqIdRef.current;
    const target = activeItem;
    const controller = new AbortController();
    abortRef.current = controller;
    setPhase("thinking"); setErrorText(""); setClarifyText("");
    try {
      const { blocks, text, usage } = await callInlineEdit({
        apiKey: deps.apiKey, model: deps.ai.model, lang: deps.lang,
        entity: deps.entity, item: target, itemLabel: d.titleOf(target),
        instruction, snapshot: deps.dispatcher.getSnapshot(),
        guides: deps.guides, groundInGuides: deps.ai.groundInGuides,
        signal: controller.signal,
      });
      if (reqId !== reqIdRef.current) return; // superseded — discard
      deps.recordUsage?.(usage);
      const next = describeEntityCalls(blocks, { descriptor: d, item: target, ws: deps.ws });
      if (isEmptyPlan(next)) { setClarifyText(text || t(deps.lang, "inlineAiEditNoChanges")); setPhase("clarify"); return; }
      setPlan(next); setPhase("preview");
    } catch {
      if (reqId !== reqIdRef.current) return; // stale failure — don't clobber current state
      setErrorText(t(deps.lang, "inlineAiEditError")); setPhase("error");
    }
  };

  const apply = async () => {
    if (!activeItem || !plan || isEmptyPlan(plan) || phase !== "preview") return;
    setPhase("applying");
    // Non-transactional: each runTool commits + persists immediately. Track how
    // many ops committed so a mid-sequence failure is reported as a partial, not
    // a total failure with a stranded write.
    let applied = 0;
    try {
      if (plan.updates.length > 0) {
        const patch: Record<string, unknown> = { id: activeItem.id };
        for (const diff of plan.updates) patch[diff.field] = coerce(d, diff.field, diff.after);
        await runTool(deps.dispatcher, d.updateTool, patch);
        applied++;
      }
      for (const c of plan.creates) { await runTool(deps.dispatcher, c.toolName, c.input); applied++; }
      for (const del of plan.deletes) { await runTool(deps.dispatcher, del.toolName, { id: del.id }); applied++; }
      deps.logActivity?.("ai.inlineEdit", activeItem.id, d.titleOf(activeItem));
      deps.showToast("info", t(deps.lang, "inlineAiEditApplied", d.titleOf(activeItem)));
      cancel();
    } catch {
      if (applied > 0) {
        deps.logActivity?.("ai.inlineEdit", activeItem.id, d.titleOf(activeItem));
        deps.showToast("error", t(deps.lang, "inlineAiEditPartial"));
        cancel();
      } else {
        setErrorText(t(deps.lang, "inlineAiEditApplyFailed")); setPhase("error");
      }
    }
  };

  return { activeItem, phase, plan, clarifyText, errorText, aiEditEnabled, openFor, submit, apply, cancel };
}

function coerce(d: { arrayFields: ReadonlySet<string>; numberFields: ReadonlySet<string> }, field: string, value: string): unknown {
  if (d.arrayFields.has(field)) return value ? value.split(",").map((s) => s.trim()).filter(Boolean) : [];
  if (d.numberFields.has(field)) return Number(value);
  return value;
}
