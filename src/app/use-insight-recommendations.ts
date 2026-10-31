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
import { aiFailureMessageKey } from "./ai-key-status";
import type { Task, RaidItem, Milestone, ChangeItem, Stakeholder, Resource, ProjectMeta } from "./types";
import {
  aiKeyIfEnabled,
  isAiBackgroundEnabled,
  DEFAULT_INSIGHT_REC_INTERVAL_MIN,
  type Settings,
} from "./settings-types";
import type { Insight, InsightActions, InsightRecommendation } from "./insights/insight";
import { ALLOWED_REC_TOOLS, baselineHistoryDigest, recommendationPredatesSwitch } from "./insights/insight";
import type { BaselineEntry } from "./baseline-currency";
import { metricAtActionPatch } from "./insights/outcome";
import type { ScopeEpochReader } from "./scope-epoch";
import { useInsightRecommend } from "./use-insight-recommend";
import { useInsightRecommendRunner } from "./use-insight-recommend-runner";
import { buildRecommendContext, recommendPeople } from "./insights/recommend-context";
import { isTaskClosed } from "./task-closed";
import { describeRecommendationPlan, recommendationCallsToApply, type RecommendSnapshot } from "./insights/recommend-plan";
import type { RecCallProblemFormat } from "./insights/recommend-schema";
import { stripRejectedFields } from "./inline-ai-edit/plan";
import { buildGroundingIndex } from "./action-ai";
import { runTool, type ToolDispatcher } from "./chat-tools";
import { ConcurrencyTokenError } from "./chat-tools-updates";
import { PeopleToolRefusedError } from "./chat-tool-defs";
import { stampRecommendationTokens } from "./insights/recommend-tokens";
import { logDiag } from "./diagnostics";
import { descriptionText } from "./rich-text-projection";
import { effectivePersonName, resourceDisplayName } from "./resource-foundation";
import type { ToastKind } from "./use-toast";
import type { LogActivityAsFn } from "./activity-log-context";
import { type OperatingGuide } from "./operating-guide";
import { useGuideTextFrom } from "./action-guides-context";
import { useOpenProjectPeopleProtected, usePeopleProtected } from "./ai-privacy-context";

// Cap on any free-text field folded into the linked-entity digest of an insight
// recommendation prompt — the digest rides a billed call, so an unbounded
// description must not blow up the token count (SP3).
const ENTITY_DIGEST_TEXT_CAP = 200;

/** §782 round 3 — a refused call's reason in the UI language, for the review
 *  modal. Tool and argument names are identifiers and stay as they are. */
function recCallProblemText(lang: Lang): RecCallProblemFormat {
  return (p) => {
    if (p.kind === "required") return t(lang, "insightRecommendationCallArgsRequired", p.tool, p.args.join(", "));
    if (p.kind === "date") return t(lang, "insightRecommendationCallArgDate", p.tool, p.arg);
    return t(lang, "insightRecommendationCallNotAllowed", p.tool);
  };
}

/** Live render-scope values the insight recommendation cluster reads each render. */
export interface InsightRecommendationDeps {
  isPopout: boolean;
  /** §548 — a load or project swap is still in flight (`useStorageBackend`). A recommendation stored
   *  meanwhile would be replaced when the load lands. */
  loadPending: boolean;
  /** §548 — `useStorageBackend`'s stable scope-epoch reader, threaded into both AI hooks below.
   *  `loadPending` covers a result landing DURING the hold; this covers one landing after the swap
   *  FINISHED, when `loadPending` is false again. See `scope-epoch.ts`. Required, so tsc proves the
   *  call site hands it over. */
  getScopeEpoch: ScopeEpochReader;
  settings: Settings;
  /** §701 — the operating-guide library. This hook runs in task-manager's own body, ABOVE the
   *  `AiProviders` it renders, so `useActionGuideText` would read no provider here; the guide
   *  text is resolved from this list instead. Required, so tsc proves the call site hands it over. */
  guides: readonly OperatingGuide[];
  /** §701 — whether the guide library has loaded. The recommendation RUNNER is
   *  unattended, so it waits for it while grounding is on; the on-demand path
   *  does not wait. */
  guidesReady: boolean;
  lang: Lang;
  today: string;
  project: ProjectMeta | undefined;
  tasks: readonly Task[];
  raid: readonly RaidItem[];
  milestones: readonly Milestone[];
  changes: readonly ChangeItem[];
  stakeholders: readonly Stakeholder[];
  /** §476 — the baseline-currency history; a recommendation generated before a switch is not
   *  replayed when it carries money (`recommendationPredatesSwitch`). */
  baselineHistory: readonly BaselineEntry[];
  resourcesById: ReadonlyMap<number, Resource>;
  insights: readonly Insight[] | undefined;
  setInsights: Dispatch<SetStateAction<readonly Insight[] | undefined>>;
  dispatcher: ToolDispatcher;
  showToast: (kind: ToastKind, text: string) => void;
  logActivityAs: LogActivityAsFn;
  onAcknowledgeInsight: (id: number) => void;
  onActInsight: (id: number) => void;
  onDismissInsight: (id: number) => void;
  /** "Log as RAID" opener (§515); undefined in popouts. */
  onLogAsRaid?: (insight: Insight) => void;
}

export function useInsightRecommendations(deps: InsightRecommendationDeps) {
  const {
    isPopout,
    loadPending,
    getScopeEpoch,
    settings,
    guides,
    guidesReady,
    lang,
    today,
    project,
    tasks,
    raid,
    milestones,
    changes,
    stakeholders,
    baselineHistory,
    resourcesById,
    insights,
    setInsights,
    dispatcher,
    showToast,
    logActivityAs,
    onAcknowledgeInsight,
    onActInsight,
    onDismissInsight,
    onLogAsRaid,
  } = deps;
  const recommendGuideText = useGuideTextFrom(guides, settings.ai?.groundInGuides === true, "insightRecommend");

  // --- Insights → Action Loop (#6B SP2) ---------------------------------
  // Generate/apply/reject handlers for an insight's AI recommendation. Apply
  // replays the recommendation's proposed tool calls through the SAME
  // dispatcher the chat/inline-edit tools use (runTool re-sanitizes per
  // entity — the security boundary — and throws `not found` for a stale id), so
  // these live here, after `dispatcher` exists.
  const buildInsightGroundingIndex = useCallback(
    () => buildGroundingIndex({ tasks, raid, milestones, changes, stakeholders }),
    [tasks, raid, milestones, changes, stakeholders],
  );
  // Resolve an insight's entityRef to a compact title + field digest for the
  // recommendation context. Resolvers exist for the `milestones`, `raid` and
  // `resources` views, so an insight gets a digest exactly when its ref points at
  // one of those. Everything else falls through to undefined and is recommended on
  // `insight.data` alone: a portfolio-level detection carries no ref. The
  // `resources` arm (§360, by owner decision) serves the TimeLog guardrails,
  // whose sentence names the person and the numbers but not who they are in the
  // organisation. Bounded: a short fixed field list per view, never
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
      // §360 — the TimeLog guardrails carry `view: "resources"`. The three text fields are capped like
      // every other digest field: load trims them but bounds nothing (`optText`). Their sentence already names the person
      // and the numbers, so the digest carries only what it lacks: role-adjacent profile fields. NOT
      // `notes`: free text about a person can hold personal details that must not ride a billed prompt.
      if (ref.view === "resources") {
        const p = resourcesById.get(ref.id);
        if (!p) return undefined;
        return {
          view: ref.view,
          id: p.id,
          title: resourceDisplayName(p),
          fields: [
            `jobTitle: ${p.title?.trim().slice(0, ENTITY_DIGEST_TEXT_CAP) || "(unset)"}`,
            `department: ${p.department?.trim().slice(0, ENTITY_DIGEST_TEXT_CAP) || "(unset)"}`,
            `company: ${p.company?.trim().slice(0, ENTITY_DIGEST_TEXT_CAP) || "(unset)"}`,
            `external: ${p.isExternal ? "yes" : "no"}`,
            `active: ${p.active === false ? "no" : "yes"}`,
          ].join("\n"),
        };
      }
      return undefined;
    },
    [milestones, raid, resourcesById],
  );
  // AI people protection: read when the context is BUILT (on demand or by the background runner), so the
  // project's setting at run time decides.
  const peopleProtectedNow = useOpenProjectPeopleProtected();
  const buildInsightRecommendContext = useCallback(
    (insight: Insight) => {
      const entity = resolveInsightEntity(insight);
      return buildRecommendContext({
        peopleProtected: peopleProtectedNow(),
        projectName: project?.name ?? "",
        today,
        insightType: insight.type,
        severity: insight.severity,
        data: insight.data,
        ...(entity ? { entity } : {}),
        relatedTasks: tasks.map((tk) => ({ id: tk.id, title: tk.taskName })),
        // §782 — create_task REQUIRES an assignee, and before this the digest
        // named nobody the model could give. Active people only: an archived
        // resource is not someone to hand new work to. ★ Round 3: then the
        // assignees of OPEN tasks, which are free text — with resources alone a
        // project without a directory could never get a valid create_task. A
        // closed task's assignee is not offered, and an archived resource's
        // name is dropped even when an open task still carries it.
        people: recommendPeople(
          [...resourcesById.values()].filter((r) => r.active !== false).map(resourceDisplayName),
          tasks.filter((tk) => !isTaskClosed(tk)).map((tk) => tk.assignee ?? ""),
          [...resourcesById.values()].filter((r) => r.active === false).map(resourceDisplayName),
        ),
      });
    },
    [project, today, tasks, resolveInsightEntity, resourcesById, peopleProtectedNow],
  );
  // ★★ THE SINGLE CHOKE POINT FOR STORING A GENERATED RECOMMENDATION — both the
  // on-demand `useInsightRecommend` and the background
  // `useInsightRecommendRunner` write through this one callback, so stamping the
  // concurrency tokens here covers both paths with no change to either hook.
  // ★ Its identity now moves whenever any of the five entity lists does. Safe by
  // construction at both consumers: `useInsightRecommend` mirrors its args into
  // a ref every render and `useInsightRecommendRunner` mirrors each arg into its
  // own ref, so neither re-subscribes a listener or re-arms an interval on it.
  // §350 — what a generate reads beside its prompt. Plain arrays, already
  // immutable state, so the "snapshot" is five references and no copy.
  // §476 — the baseline-history length rides the same snapshot, so a switch made while the
  // model was answering still counts as AFTER the recommendation (`recommendationPredatesSwitch`).
  const historyLength = baselineHistory.length;
  const historyDigest = useMemo(() => baselineHistoryDigest(baselineHistory), [baselineHistory]);
  const snapshotEntities = useCallback(
    (): RecommendSnapshot => ({ tasks, raid, changes, milestones, stakeholders, historyLength, historyDigest }),
    [tasks, raid, changes, milestones, stakeholders, historyLength, historyDigest],
  );
  const applyInsightRecommendation = useCallback(
    (id: number, rec: InsightRecommendation, snapshot?: RecommendSnapshot) => {
      // §548 — this is the ONE store both the background runner and the on-demand generate write
      // through, so the hold lives here: a result stored while a load or swap is pending would be
      // replaced when it lands. Dropped, not queued — the runner's next tick regenerates it.
      if (loadPending) return;
      // §350 — stamp from the PROMPT-TIME snapshot both generators hand in, so an
      // edit made while the model was answering reads as a change and the confirm
      // refuses. The live arrays are the fallback for a caller that passed none.
      // §476 — both history stamps come from ONE source: the snapshot when given, else the live
      // values. Mixing them would pair a prompt-time length with a later history.
      const historyStamp = snapshot ?? { historyLength, historyDigest };
      const stamped = {
        ...stampRecommendationTokens(rec, snapshot ?? { tasks, raid, changes, milestones, stakeholders }),
        historyLength: historyStamp.historyLength,
        historyDigest: historyStamp.historyDigest,
      };
      setInsights((prev) => (prev ?? []).map((i) => (i.id === id ? { ...i, recommendation: stamped } : i)));
    },
    [setInsights, tasks, raid, changes, milestones, stakeholders, loadPending, historyLength, historyDigest],
  );
  const {
    generatingId: insightGeneratingId,
    generate: generateInsightRecommendation,
    cancel: cancelInsightRecommendation,
  } = useInsightRecommend({
    insights: insights ?? [],
    ai: { apiKey: aiKeyIfEnabled(settings.ai), model: settings.ai?.model ?? "claude-sonnet-5", guideText: recommendGuideText },
    today,
    buildIndex: buildInsightGroundingIndex,
    buildContextFor: buildInsightRecommendContext,
    applyRecommendation: applyInsightRecommendation,
    snapshotEntities,
    getScopeEpoch,
    isPopout,
    onError: (kind, error) => {
      // §650 — a refused key (401/403) is named as the key problem.
      const failureKey = aiFailureMessageKey(error);
      showToast("error", t(lang, kind === "limit" ? "aiUsageLimitReached" : failureKey ?? "insightRecommendationError"));
    },
  });
  useInsightRecommendRunner({
    // §548 F1 item 9 — the RUNNER itself must not tick while a load/swap is pending, not just its
    // store (`applyInsightRecommendation` above): without this a billed AI call still runs during the
    // hold and its result is simply discarded when it lands.
    // Unattended and billed: needs the BACKGROUND consent on top of the interactive one (AI-10).
    enabled: isAiBackgroundEnabled(settings.ai) && settings.ai.insightRecommendations === true && !isPopout && !loadPending,
    guidesReady: settings.ai.groundInGuides !== true || guidesReady,
    insights: insights ?? [],
    ai: { apiKey: aiKeyIfEnabled(settings.ai), model: settings.ai?.model ?? "claude-sonnet-5", guideText: recommendGuideText },
    today,
    intervalMinutes: settings.ai.insightRecommendationIntervalMinutes ?? DEFAULT_INSIGHT_REC_INTERVAL_MIN,
    buildIndex: buildInsightGroundingIndex,
    buildContextFor: buildInsightRecommendContext,
    applyRecommendation: applyInsightRecommendation,
    snapshotEntities,
    getScopeEpoch,
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
      ...(onLogAsRaid ? { onLogAsRaid } : {}),
    }),
    [onAcknowledgeInsight, onActInsight, onDismissInsight, onGenerateRecommendationInsight,
      onApplyRecommendationInsight, onRejectRecommendationInsight, onLogAsRaid],
  );

  // The insight currently under review + a live preview of its recommendation's
  // proposed calls (re-grounded against the CURRENT workspace, since a
  // background-generated recommendation can be stale by the time it's reviewed).
  const reviewInsight = (insights ?? []).find((i) => i.id === reviewInsightId) ?? null;
  // Review 3, R6: the RENDER-REACTIVE answer from the same source as `peopleProtectedNow`. The getter is stable,
  // so as a memo input it never told the preview that the project's protection flipped; this boolean does, so
  // the preview strips (or shows) person fields exactly as the confirm will.
  const peopleProtectedLive = usePeopleProtected();
  const reviewPlan = useMemo(
    () =>
      reviewInsight?.recommendation
        ? describeRecommendationPlan(reviewInsight.recommendation.proposedCalls, {
            tasks, raid, changes, milestones, stakeholders,
          }, recCallProblemText(lang), peopleProtectedLive)
        : null,
    [reviewInsight, tasks, raid, changes, milestones, stakeholders, lang, peopleProtectedLive],
  );
  // ★ No plan-level entity is derived any more: every `FieldDiff`/`LinkDiff`
  // carries the register it belongs to, so the modal labels each row from the
  // row itself and a plan merged across entities no longer degrades to raw
  // property names (§393).
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
    // AI people protection (R4): the SAME calls the review showed — person fields stripped when the project
    // protects its people (`recommendationCallsToApply`), so a create lands unassigned.
    const peopleProtected = peopleProtectedNow();
    const calls = recommendationCallsToApply(rec.proposedCalls.filter((c) => ALLOWED_REC_TOOLS.has(c.name)), peopleProtected);
    // §476 — a recommendation generated before a baseline-currency switch holds money in the
    // OLD currency; replayed now it would write `costImpact: 5000` as 5000 of the new one. The
    // whole apply is refused (nothing written, the insight stays `proposed`) like the stale
    // refusal below, so the user regenerates it. Calls without money are not affected.
    if (recommendationPredatesSwitch({ ...rec, proposedCalls: calls }, baselineHistory)) {
      showToast("error", t(lang, "insightRecommendationCurrencyChanged"));
      return;
    }
    // ★★ §548 — NO scope-epoch guard here, and NOT because closing the modal cancels anything: it
    // does not, this function runs to completion after the unmount. It is safe because every
    // `ALLOWED_REC_TOOLS` dispatcher writes local state only, so each `await runTool` below resolves
    // in the MICROTASK queue and the whole loop finishes inside one macrotask — no swap can
    // interleave. That condition is stated on `ALLOWED_REC_TOOLS` itself, where a tool author will
    // meet it; a dispatcher that gains I/O must bring `dropStaleScopeWrite` with it.
    // Per-call, NON-transactional apply. Each runTool is its own try/catch so one
    // call that THROWS (e.g. an enum/date the entity's sanitizer rejects) can't
    // abort the remaining calls. (An update whose target row is GONE never gets
    // here: the review shows it as an unknown-id rejection, so the loop refuses
    // it below. Dispatched, `runTool` would throw `not found`.) We ALWAYS advance the insight to
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
    // ★★ §534 — calls whose every written field the review modal rejected. They
    //  are sent NOWHERE, so like a stale refusal they wrote nothing.
    let refused = 0;
    // §782 — each hard failure's tool and reason, for the toast. Before this the
    // catch below only counted, so a user (and the demo recorder) saw "couldn't
    // be applied" with no way to tell which change or why.
    const failures: string[] = [];
    for (const call of calls) {
      // ★★★ §534 — strip against this call's OWN plan, from the SAME slices
      //  the modal's `reviewPlan` reads. That plan is the concatenation of these
      //  per-call plans (pinned in recommend-plan.test.ts), so what the modal
      //  showed as rejected is exactly what is not sent.
      const plan = describeRecommendationPlan([call], { tasks, raid, changes, milestones, stakeholders }, undefined, peopleProtected);
      // ★★ §782 — a WHOLE-CALL rejection (no `field`) is refused too: a call
      //  missing an argument its writer requires (`recommendationCallProblem`,
      //  run inside the plan) or an update whose row is gone. Either would only
      //  throw. It is judged HERE, on the stored calls, because a replay never
      //  passes through `parseRecommendation`. (Chat Apply still dispatches a
      //  whole-call rejection; `stripRejectedFields` is unchanged for it.)
      if (plan.rejected.some((r) => r.field === undefined)) {
        refused++;
        continue;
      }
      const sent = stripRejectedFields(call.input, plan);
      if (sent.writesNothing) {
        refused++;
        continue;
      }
      try {
        await runTool(dispatcher, call.name, sent.input);
        committed++;
      } catch (e) {
        if (e instanceof ConcurrencyTokenError) {
          stale++;
          continue;
        }
        // AI people protection: a people tool refused by the executor's gate wrote NOTHING (it throws before
        // any handler), so it is a refusal like a review-rejected call, never a hard failure that would mark
        // the insight applied. Matched on the TYPE, as the stale refusal above is.
        if (e instanceof PeopleToolRefusedError) {
          refused++;
          continue;
        }
        failed++;
        const message = e instanceof Error ? e.message : String(e);
        failures.push(`${call.name}: ${message}`);
        // Argument NAMES only, never their values. Joined, because `redactFields`
        // keeps scalars alone and would drop an array without a sound.
        logDiag("error", "insight.recommendation.callFailed", { tool: call.name, message, keys: Object.keys(sent.input).join(",") });
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
    // ★ A refused call wrote nothing either, so it joins the no-write case.
    //   The stale message still wins when both kinds occurred.
    // ★★ Final review Minor 4: this branch is also the ALL-REFUSED case (no
    //   committed, no hard failure, nothing stale) — nothing was applied at
    //   all, so the generic partial-failure wording ("Some changes … couldn't
    //   be applied") overstated it. `insightRecommendationAllRejected` says
    //   nothing landed, mirroring the chat card's `chatProposalFailedRejected`.
    if (committed === 0 && failed === 0 && (stale > 0 || refused > 0)) {
      const key = stale > 0 ? "insightRecommendationStale" : "insightRecommendationAllRejected";
      showToast("error", t(lang, key));
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
              // §351: record the calls that did not land, so a partly-landed
              // plan stays distinguishable from a full one after the toast is
              // gone. ★ §782 — a call that THREW counts too: the card must not
              // read "applied" beside a failure. The early return above is
              // deliberately NOT widened — a hard failure may have written, and
              // the creates that did commit would be created twice by a
              // re-confirm. Regenerating replaces `proposedCalls`, so the
              // card's Generate offer replays nothing.
              recommendation: {
                ...rec,
                status: "applied" as const,
                appliedAt: today,
                appliedSummary: rec.summary,
                ...(stale + refused + failed > 0 ? { refusedCalls: stale + refused + failed } : {}),
              },
            }
          : i,
      ),
    );
    logActivityAs("ai", "ai.insightRecommendation", insight.id, rec.summary);
    // ★ The stale message wins over the generic one when both kinds occurred:
    // "some of this was refused because the data moved — generate a new one" is
    // actionable, where "couldn't be applied" leaves the user with no next step.
    // ★ §782 round 3 — when a call also THREW, its reason rides along: before
    //  this the stale toast returned first and the reason was only logged.
    if (stale > 0) {
      showToast(
        "error",
        failed > 0
          ? t(lang, "insightRecommendationStalePartialDetail", failures.join("; "))
          : t(lang, "insightRecommendationStalePartial"),
      );
      return;
    }
    // §782 — a hard failure is named with the dispatcher's own reason, as the
    // chat card's failed rows are (`chat-proposal-apply.ts`). The detail string
    // opens with the generic sentence, so its meaning is unchanged.
    if (failed > 0) {
      showToast("error", t(lang, "insightRecommendationApplyFailedDetail", failures.join("; ")));
      return;
    }
    showToast(
      refused > 0 ? "error" : "info",
      t(lang, refused > 0 ? "insightRecommendationApplyFailed" : "insightRecommendationApplied"),
    );
  }, [insights, reviewInsightId, dispatcher, setInsights, setReviewInsightId, today, logActivityAs, showToast, lang, tasks, raid, changes, milestones, stakeholders, baselineHistory, peopleProtectedNow]);

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
