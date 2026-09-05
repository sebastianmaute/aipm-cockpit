// src/app/use-insight-recommendations.ts
//
// Deps-object hook factory extracted from task-manager.tsx (Phase 3 convention).
// Holds the Insights → Action Loop (#6B SP2) wiring: the generate/apply/reject
// handlers for an insight's AI recommendation, the background recommendation
// runner, and the review-modal state. Follows the use-storage-file-ops pattern:
// called unconditionally with the live closure values via a typed `deps` object;
// the inline `useCallback`/`useMemo` preserve the exact memoization the code had
// inline. Move-only — no behaviour change.
//
// ★★ CALL SITE PLACEMENT IS LOAD-BEARING. This block's original comment said it
// lived "after `dispatcher` exists" — confirmInsightRecommendation replays proposed
// tool calls through the useChatDispatcher result. The call must stay AFTER
// useChatDispatcher and BEFORE the first CONSUMER of this hook's return values.
// ★ `insightActions` is this hook's OWN return value, destructured out of the
// `useInsightRecommendations({...})` call itself — naming it as the boundary (as
// an earlier revision here did) makes the window read as zero-width. The real
// boundary is the first place a returned value is READ, which today is the
// `insightActions: isPopout ? undefined : insightActions` prop in
// `task-manager.tsx`'s shell props. Derive today's window rather than trusting
// line numbers:
//   grep -n "useChatDispatcher\|useInsightRecommendations\|insightActions" src/app/task-manager.tsx
import { useCallback, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { type Lang, t } from "./i18n";
import type { Task, RaidItem, Milestone, ChangeItem, Stakeholder, Resource, ProjectMeta } from "./types";
import {
  aiKeyIfEnabled,
  isAiEnabled,
  DEFAULT_INSIGHT_REC_INTERVAL_MIN,
  type Settings,
} from "./settings-types";
import type { Insight, InsightActions, InsightRecommendation } from "./insights/insight";
import { ALLOWED_REC_TOOLS } from "./insights/insight";
import { metricAtActionPatch } from "./insights/outcome";
import { useInsightRecommend } from "./use-insight-recommend";
import { useInsightRecommendRunner } from "./use-insight-recommend-runner";
import { buildRecommendContext } from "./insights/recommend-context";
import { describeRecommendationPlan } from "./insights/recommend-plan";
import { buildGroundingIndex } from "./action-ai";
import { runTool, type ToolDispatcher } from "./chat-tools";
import { ConcurrencyTokenError } from "./chat-tools-updates";
import { stampRecommendationTokens } from "./insights/recommend-tokens";
import { descriptionText } from "./rich-text-projection";
import { effectivePersonName } from "./resource-foundation";
import type { ToastKind } from "./use-toast";
import type { LogActivityAsFn } from "./activity-log-context";

// Cap on any free-text field folded into the linked-entity digest of an insight
// recommendation prompt — the digest rides a billed call, so an unbounded
// description must not blow up the token count (SP3).
const ENTITY_DIGEST_TEXT_CAP = 200;

/** Live render-scope values the insight recommendation cluster reads each render. */
export interface InsightRecommendationDeps {
  isPopout: boolean;
  settings: Settings;
  lang: Lang;
  today: string;
  project: ProjectMeta | undefined;
  tasks: readonly Task[];
  raid: readonly RaidItem[];
  milestones: readonly Milestone[];
  changes: readonly ChangeItem[];
  stakeholders: readonly Stakeholder[];
  resourcesById: ReadonlyMap<number, Resource>;
  insights: readonly Insight[] | undefined;
  setInsights: Dispatch<SetStateAction<readonly Insight[] | undefined>>;
  dispatcher: ToolDispatcher;
  showToast: (kind: ToastKind, text: string) => void;
  logActivityAs: LogActivityAsFn;
  onAcknowledgeInsight: (id: number) => void;
  onActInsight: (id: number) => void;
  onDismissInsight: (id: number) => void;
}

export function useInsightRecommendations(deps: InsightRecommendationDeps) {
  const {
    isPopout,
    settings,
    lang,
    today,
    project,
    tasks,
    raid,
    milestones,
    changes,
    stakeholders,
    resourcesById,
    insights,
    setInsights,
    dispatcher,
    showToast,
    logActivityAs,
    onAcknowledgeInsight,
    onActInsight,
    onDismissInsight,
  } = deps;

  // --- Insights → Action Loop (#6B SP2) ---------------------------------
  // Generate/apply/reject handlers for an insight's AI recommendation. Apply
  // replays the recommendation's proposed tool calls through the SAME
  // dispatcher the chat/inline-edit tools use (runTool re-sanitizes per
  // entity — the security boundary — and no-ops a stale id gracefully), so
  // these live here, after `dispatcher` exists.
  const buildInsightGroundingIndex = useCallback(
    () => buildGroundingIndex({ tasks, raid, milestones, changes, stakeholders }),
    [tasks, raid, milestones, changes, stakeholders],
  );
  // Resolve an insight's entityRef to a compact title + field digest for the
  // recommendation context. Resolvers exist for the `milestones` and `raid`
  // views ONLY, so an insight gets a digest exactly when its ref points at one
  // of those. Everything else falls through to undefined and is recommended on
  // `insight.data` alone: a portfolio-level detection carries no ref, and the
  // TimeLog guardrails DO carry one — view `resources` — for which there is no
  // resolver here. That is a gap, not a category: the guardrail sentence
  // already names the person and the numbers, so the digest would add little,
  // and adding a `resources` arm is the way to close it if it ever earns its
  // place on a billed prompt. Bounded: a short fixed field list per view, never
  // the whole row, and free text is capped — this text rides that prompt. The
  // fields chosen EXCLUDE what `insight.data` already carries (name/date/
  // daysOverdue, title/targetDate/daysSinceUpdate) so the digest adds signal
  // rather than repeating it.
  const resolveInsightEntity = useCallback(
    (insight: Insight) => {
      const ref = insight.entityRef;
      if (!ref) return undefined;
      if (ref.view === "milestones") {
        const m = milestones.find((x) => x.id === ref.id);
        if (!m) return undefined;
        return {
          view: ref.view,
          id: m.id,
          title: m.name,
          fields: [
            `achieved: ${m.achievedDate ?? "no"}`,
            `linkedTasks: ${m.linkedTaskIds.length}`,
            `description: ${descriptionText(m.description).slice(0, ENTITY_DIGEST_TEXT_CAP) || "(none)"}`,
          ].join("\n"),
        };
      }
      if (ref.view === "raid") {
        const r = raid.find((x) => x.id === ref.id);
        if (!r) return undefined;
        // Owner via the shared live-name helper — the cached `owner` string can
        // be stale after a rename/re-link (same rule every other surface uses).
        const owner = effectivePersonName(r.owner ?? "", r.ownerResourceId, resourcesById);
        return {
          view: ref.view,
          id: r.id,
          title: r.title,
          fields: [
            `category: ${r.category}`,
            `status: ${r.status}`,
            `severity: ${r.severity ?? "(unset)"}`,
            `owner: ${owner || "(unassigned)"}`,
            // Worth the extra field despite the free text: it tells the model what
            // has ALREADY been tried, so it stops re-proposing the existing plan.
            `mitigation: ${descriptionText(r.mitigation).slice(0, ENTITY_DIGEST_TEXT_CAP) || "(none)"}`,
          ].join("\n"),
        };
      }
      return undefined;
    },
    [milestones, raid, resourcesById],
  );
  const buildInsightRecommendContext = useCallback(
    (insight: Insight) => {
      const entity = resolveInsightEntity(insight);
      return buildRecommendContext({
        projectName: project?.name ?? "",
        today,
        insightType: insight.type,
        severity: insight.severity,
        data: insight.data,
        ...(entity ? { entity } : {}),
        relatedTasks: tasks.map((tk) => ({ id: tk.id, title: tk.taskName })),
      });
    },
    [project, today, tasks, resolveInsightEntity],
  );
  // ★★ THE SINGLE CHOKE POINT FOR STORING A GENERATED RECOMMENDATION — both the
  // on-demand `useInsightRecommend` and the background
  // `useInsightRecommendRunner` write through this one callback, so stamping the
  // concurrency tokens here covers both paths with no change to either hook.
  // ★ Its identity now moves whenever any of the five entity lists does. Safe by
  // construction at both consumers: `useInsightRecommend` mirrors its args into
  // a ref every render and `useInsightRecommendRunner` mirrors each arg into its
  // own ref, so neither re-subscribes a listener or re-arms an interval on it.
  const applyInsightRecommendation = useCallback(
    (id: number, rec: InsightRecommendation) => {
      const stamped = stampRecommendationTokens(rec, { tasks, raid, changes, milestones, stakeholders });
      setInsights((prev) => (prev ?? []).map((i) => (i.id === id ? { ...i, recommendation: stamped } : i)));
    },
    [setInsights, tasks, raid, changes, milestones, stakeholders],
  );
  const {
    generatingId: insightGeneratingId,
    generate: generateInsightRecommendation,
    cancel: cancelInsightRecommendation,
  } = useInsightRecommend({
    insights: insights ?? [],
    ai: { apiKey: aiKeyIfEnabled(settings.ai), model: settings.ai?.model ?? "claude-sonnet-4-6" },
    today,
    buildIndex: buildInsightGroundingIndex,
    buildContextFor: buildInsightRecommendContext,
    applyRecommendation: applyInsightRecommendation,
    isPopout,
    onError: (kind) => {
      showToast("error", t(lang, kind === "limit" ? "aiUsageLimitReached" : "insightRecommendationError"));
    },
  });
  useInsightRecommendRunner({
    enabled: isAiEnabled(settings.ai) && settings.ai.insightRecommendations === true && !isPopout,
    insights: insights ?? [],
    ai: { apiKey: aiKeyIfEnabled(settings.ai), model: settings.ai?.model ?? "claude-sonnet-4-6" },
    today,
    intervalMinutes: settings.ai.insightRecommendationIntervalMinutes ?? DEFAULT_INSIGHT_REC_INTERVAL_MIN,
    buildIndex: buildInsightGroundingIndex,
    buildContextFor: buildInsightRecommendContext,
    applyRecommendation: applyInsightRecommendation,
  });

  const onGenerateRecommendationInsight = useCallback(
    (id: number) => { void generateInsightRecommendation(id); },
    [generateInsightRecommendation],
  );
  // Opens the review modal; the modal's Confirm button runs the actual apply
  // (confirmInsightRecommendation, below — it needs the live insight + its
  // recommendation, read at confirm time so a stale id is a safe no-op).
  const [reviewInsightId, setReviewInsightId] = useState<number | null>(null);
  const onApplyRecommendationInsight = useCallback((id: number) => { setReviewInsightId(id); }, [setReviewInsightId]);
  const onRejectRecommendationInsight = useCallback(
    (id: number) => {
      if (isPopout) return;
      setInsights((prev) =>
        (prev ?? []).map((i) =>
          i.id === id && i.recommendation
            ? { ...i, recommendation: { ...i.recommendation, status: "rejected" as const } }
            : i,
        ),
      );
    },
    [isPopout, setInsights],
  );
  const insightActions: InsightActions = useMemo(
    () => ({
      onAcknowledge: onAcknowledgeInsight, onAct: onActInsight, onDismiss: onDismissInsight,
      onGenerateRecommendation: onGenerateRecommendationInsight,
      onApplyRecommendation: onApplyRecommendationInsight,
      onRejectRecommendation: onRejectRecommendationInsight,
    }),
    [onAcknowledgeInsight, onActInsight, onDismissInsight, onGenerateRecommendationInsight,
      onApplyRecommendationInsight, onRejectRecommendationInsight],
  );

  // The insight currently under review + a live preview of its recommendation's
  // proposed calls (re-grounded against the CURRENT workspace, since a
  // background-generated recommendation can be stale by the time it's reviewed).
  const reviewInsight = (insights ?? []).find((i) => i.id === reviewInsightId) ?? null;
  const reviewPlan = useMemo(
    () =>
      reviewInsight?.recommendation
        ? describeRecommendationPlan(reviewInsight.recommendation.proposedCalls, {
            tasks, raid, changes, milestones, stakeholders,
          })
        : null,
    [reviewInsight, tasks, raid, changes, milestones, stakeholders],
  );
  const confirmInsightRecommendation = useCallback(async () => {
    const insight = (insights ?? []).find((i) => i.id === reviewInsightId);
    const rec = insight?.recommendation;
    // Close the modal FIRST (before any await) — this is also the re-entrancy
    // guard: a rapid double-click on Confirm finds reviewInsightId already null
    // on the second fire and early-returns, so the same recommendation can't be
    // applied twice (which would duplicate create_* entities). The insight/rec
    // needed for the apply are already captured in this closure.
    setReviewInsightId(null);
    if (!insight || !rec) return;
    // Security: re-enforce the allow-set at apply — a persisted/imported blob must
    // never drive a destructive tool (delete_*/update_settings) through runTool,
    // even if it slipped a stale load path. Load-time sanitize also strips these.
    const calls = rec.proposedCalls.filter((c) => ALLOWED_REC_TOOLS.has(c.name));
    // Per-call, NON-transactional apply. Each runTool is its own try/catch so one
    // call that THROWS (e.g. an enum/date the entity's sanitizer rejects) can't
    // abort the remaining calls. (A stale update id does NOT throw — the
    // dispatcher's id-based find no-ops it — so `failed` counts hard errors, not
    // silently-skipped stale updates.) We ALWAYS advance the insight to
    // acted/applied afterwards (even on partial failure) so a retry can never
    // re-run the calls that DID commit — that would duplicate create_* entities.
    //
    // ★★★ A STALENESS REFUSAL IS COUNTED SEPARATELY, AND IT IS THE ONE FAILURE
    // THE UNCONDITIONAL ADVANCE ABOVE MUST NOT SWALLOW. The rule's whole
    // justification is that a failed call MAY have committed, so re-running it
    // could duplicate `create_*` entities. A `ConcurrencyTokenError` is thrown
    // by `requireToken` BEFORE the dispatcher is reached, so that call wrote
    // nothing — and folding it into `failed` would mark the insight applied,
    // making a recommendation that was correctly refused as stale unretryable
    // and, to the user, indistinguishable from one that partly landed. That is
    // strictly worse than the overwrite the token exists to prevent.
    // ★★ MATCHED ON THE ERROR TYPE, never its message: both messages are
    // model-facing recovery instructions and may be reworded at any time.
    let failed = 0;
    let stale = 0;
    let committed = 0;
    for (const call of calls) {
      try {
        await runTool(dispatcher, call.name, call.input as Record<string, unknown>);
        committed++;
      } catch (e) {
        if (e instanceof ConcurrencyTokenError) stale++;
        else failed++;
      }
    }
    // ★★★ THE ONE BEHAVIOUR CHANGE, AND IT IS DELIBERATELY THE NARROWEST THAT
    // CLOSES THE DROP: nothing committed AND every failure was a refusal ⇒ no
    // write happened at all, so the duplicate-create hazard that forces the
    // advance does not exist and the insight is left exactly where it was. The
    // recommendation stays `proposed`, so the user can regenerate it against
    // the moved data. Any run with a HARD failure, or with even one committed
    // call, still advances exactly as before — a hard failure may have written
    // something, and this task is not the place to re-open that rule.
    if (committed === 0 && failed === 0 && stale > 0) {
      showToast("error", t(lang, "insightRecommendationStale"));
      return;
    }
    setInsights((prev) =>
      (prev ?? []).map((i) =>
        i.id === insight.id
          ? {
              ...i,
              status: "acted" as const,
              actedAt: today,
              // SP3: same shared baseline capture as the manual Act path.
              ...metricAtActionPatch(i),
              recommendation: { ...rec, status: "applied" as const, appliedAt: today, appliedSummary: rec.summary },
            }
          : i,
      ),
    );
    logActivityAs("ai", "ai.insightRecommendation", insight.id, rec.summary);
    // ★ The stale message wins over the generic one when both kinds occurred:
    // "some of this was refused because the data moved — generate a new one" is
    // actionable, where "couldn't be applied" leaves the user with no next step.
    if (stale > 0) {
      showToast("error", t(lang, "insightRecommendationStalePartial"));
      return;
    }
    showToast(
      failed > 0 ? "error" : "info",
      t(lang, failed > 0 ? "insightRecommendationApplyFailed" : "insightRecommendationApplied"),
    );
  }, [insights, reviewInsightId, dispatcher, setInsights, setReviewInsightId, today, logActivityAs, showToast, lang]);

  return {
    insightActions,
    insightGeneratingId,
    cancelInsightRecommendation,
    confirmInsightRecommendation,
    reviewInsight,
    reviewPlan,
    setReviewInsightId,
  };
}
