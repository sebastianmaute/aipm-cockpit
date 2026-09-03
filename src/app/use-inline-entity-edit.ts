// src/app/use-inline-entity-edit.ts
//
// Generic state-machine hook for the inline "Ask Claude" editor, over any
// entity: idle -> thinking -> preview|clarify|error, then apply -> idle. One
// instance lives per pane and manages the single active edit. The per-entity
// descriptor drives which fields diff, how they validate, and how they coerce
// on apply. Task-bound behavior lives in the thin `use-inline-ai-edit` wrapper.
"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { type Lang, t } from "./i18n";
import { type Workspace } from "./workspace";
import { type ToolDispatcher, runTool } from "./chat-tools";
import { entityToken } from "./ai-entity-token";
import { type AiConfig, isAiEnabled } from "./settings-types";
import { type OperatingGuide } from "./operating-guide";
import { callInlineEdit } from "./inline-ai-edit-call";
import { AiHttpError, classifyAiError } from "./ai-errors";
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
  // ★★★ THE CONCURRENCY TOKEN FOR THE ROW AS THE MODEL SAW IT, and WHEN it is
  // derived is the whole design. It is taken in `submit`, from the same `target`
  // that is serialized into the prompt — so the window it covers is the AI
  // round-trip PLUS the user's read of the preview and their click on Apply. A
  // human (or a background sync, or a second tab) editing the row anywhere in
  // that window makes the write refuse, which is the race this feature actually
  // has: the model reasoned about a row that has since moved.
  // ★★★ DERIVING IT IN `apply` INSTEAD IS VACUOUS BY CONSTRUCTION, and it is
  // the obvious-looking simplification — you would read the row and hand back a
  // token derived from that same read, so the comparison in `requireToken`
  // could never fail. That is not a weaker guard, it is no guard: it would
  // report success while restoring exactly the silent-overwrite behaviour this
  // slice exists to remove. Pinned by the "refuses when the row moved between
  // submit and apply" test.
  // ★ Null until a submit has been ACCEPTED. `apply` forwards it as-is: a null
  // reaches `requireToken` as an absent token and is refused, which is the safe
  // direction — never a silent unguarded write.
  const tokenRef = useRef<string | null>(null);

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

  // The reconcile above only resets UI state — it doesn't stop a billed call
  // that's still in flight when the pane deactivates mid-"thinking". Abort it
  // (and supersede via reqId so its resolution is discarded) in an effect, so
  // no setState happens here (the set-state-in-effect ban). Hoisted scalar dep.
  const paneActive = deps.active;
  useEffect(() => {
    if (paneActive === false) {
      abortRef.current?.abort();
      reqIdRef.current++;
    }
  }, [paneActive]);

  // ★★ A BILLED CALL MUST NEVER OUTLIVE THE SURFACE THAT STARTED IT, and the
  // effect above does NOT cover unmount: it fires only on an `active === false`
  // TRANSITION, and the task path passes no `active` at all (see the prop's own
  // comment), so on that path nothing ever aborted. Navigating away UNMOUNTS the
  // pane rather than flipping the flag — the modern shell renders only the
  // active view, and workspace-section only the active tabpanel, so `active`
  // moves between workspace TABS but not when workspace-section itself goes
  // (Dashboard / Settings / AI Assistant). Without this the in-flight
  // `callInlineEdit` kept running, billed, with no Stop anywhere.
  // ★ Cleanup-ONLY: it sets no state, so it stays clear of the fatal
  //   `react-hooks/set-state-in-effect` ban. Same shape as `use-tasks-dedup` /
  //   `use-alloc-plan` / `use-raci-suggest`.
  useEffect(() => () => abortRef.current?.abort(), []);

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
      tokenRef.current = null; // the previous item's token must never reach this one
      setActiveItem(item); setPhase("idle"); setPlan(null); setClarifyText(""); setErrorText("");
    },
    [aiEditEnabled],
  );

  // Stable identity so usePopoverDismiss (which depends on onClose) doesn't
  // re-subscribe its listeners on every keystroke.
  const cancel = useCallback(() => {
    abortRef.current?.abort(); // stop the billed call, not just discard its result
    reqIdRef.current++; // supersede any in-flight submit
    tokenRef.current = null;
    setActiveItem(null); setPhase("idle"); setPlan(null); setClarifyText(""); setErrorText("");
  }, []);

  const submit = async (instruction: string) => {
    if (!activeItem || !instruction.trim() || phase === "thinking" || phase === "applying") return;
    const reqId = ++reqIdRef.current;
    const target = activeItem;
    // Derived from the SAME object that goes into the prompt below, before the
    // await — see tokenRef's comment for why the derivation point is the design.
    const readToken = entityToken(deps.entity, target);
    const controller = new AbortController();
    abortRef.current = controller;
    setPhase("thinking"); setErrorText(""); setClarifyText("");
    try {
      const { blocks, text, usage } = await callInlineEdit({
        apiKey: deps.apiKey, model: deps.ai.model, lang: deps.lang,
        entity: deps.entity, item: target, itemLabel: d.titleOf(target),
        instruction, snapshot: deps.dispatcher.getSnapshot(),
        guides: deps.guides, groundInGuides: deps.ai.groundInGuides,
        // ★ `historySearch` is NOT forwarded: `callInlineEdit` drops
        //   `search_history` unconditionally, because this path is single-shot
        //   and a search here can only yield an empty plan. Its own comment
        //   carries the reasoning.
        signal: controller.signal,
      });
      if (reqId !== reqIdRef.current) return; // superseded — discard
      deps.recordUsage?.(usage);
      const next = describeEntityCalls(blocks, { descriptor: d, item: target, ws: deps.ws });
      if (isEmptyPlan(next)) { setClarifyText(text || t(deps.lang, "inlineAiEditNoChanges")); setPhase("clarify"); return; }
      // Committed only for the response that WON the reqId check above, so a
      // superseded submit can never leave its item's token behind for another
      // item's apply. Written beside setPlan for that reason: the token and the
      // plan it belongs to are adopted together or not at all.
      tokenRef.current = readToken;
      setPlan(next); setPhase("preview");
    } catch (err) {
      if (reqId !== reqIdRef.current) return; // stale failure — don't clobber current state
      const isLimit = err instanceof AiHttpError && classifyAiError(err.status, err.errorType) === "limit";
      setErrorText(t(deps.lang, isLimit ? "aiUsageLimitReached" : "inlineAiEditError")); setPhase("error");
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
        // `expectedToken` is the control value `requireToken` consumes, not a
        // field of the entity — `buildPatch`/`patchWithoutId` strip it before
        // anything is persisted. It cannot be overwritten by the loop below:
        // every key there comes from the descriptor's `diffFields` whitelist.
        const patch: Record<string, unknown> = { id: activeItem.id, expectedToken: tokenRef.current };
        // ★★★ `raw`, NOT `after`. `after` is forPreview() output, which for any
        // RICH_FIELDS entry is descriptionText(html) — plain text. Applying it
        // wrote the projection over the user's markup, silently flattening every
        // inline "Ask Claude" edit of the seven rich fields. The preview stays
        // projected (it is for reading); the write takes the verbatim value the
        // model proposed.
        //
        // ★ The `?? diff.after` fallback is load-bearing: a sanitizer-INDUCED
        // enum reset carries no `raw`, because its `after` is a default enum
        // value that was never projected in the first place.
        for (const diff of plan.updates) patch[diff.field] = coerce(d, diff.field, diff.raw ?? diff.after);
        await runTool(deps.dispatcher, d.updateTool, patch);
        applied++;
      }
      for (const c of plan.creates) { await runTool(deps.dispatcher, c.toolName, c.input); applied++; }
      for (const del of plan.deletes) { await runTool(deps.dispatcher, del.toolName, { id: del.id }); applied++; }
      // ★★★ NO ACTIVITY ROW HERE — and re-adding one is a regression, not a
      // completion. Every `runTool` above already logs its own entity row
      // stamped `actor: "ai"` (`use-chat-dispatcher`), so an `ai.inlineEdit`
      // summary sat on top of them carrying the SAME id, the SAME title and
      // the SAME actor: a strict subset of what the per-entity rows say, in a
      // 500-entry ring buffer, counted a second time by the AI recap.
      // ★★ MEASURED before deciding, because "N rows per operation" would have
      // been an argument the other way: every field diff folds into ONE
      // `update_*` call, so a realistic inline edit makes N=1 tool calls and
      // the summary DOUBLED the log for the common case. (The insight-
      // recommendation summary is kept, because it names the insight — content
      // that appears in no per-entity row. Redundancy, not row count, is the
      // criterion.)
      // ★ It could also be FALSE: `updateTask` returns null on an id a
      // concurrent writer deleted, without throwing and without logging, while
      // `applied` still counted the call — so the summary asserted an edit
      // nothing had made. The kind stays in `ActivityKind` for stored rows.
      // ★★ THE STRING "NO ACTIVITY ROW HERE" ABOVE IS LOAD-BEARING TEXT, NOT
      // PROSE. `use-inline-entity-edit.test.tsx` strips comments from this file
      // and then asserts that phrase is GONE — its anti-vacuity control that the
      // strip actually ran. Delete or reword the sentinel and that control
      // passes trivially, so a broken comment-strip would no longer be caught
      // and the `ai.inlineEdit` ban beside it would be scanning nothing.
      deps.showToast("info", t(deps.lang, "inlineAiEditApplied", d.titleOf(activeItem)));
      cancel();
    } catch {
      if (applied > 0) {
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
