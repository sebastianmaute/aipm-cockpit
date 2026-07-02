// src/app/use-ai-orchestration.ts
//
// AI advisory orchestration extracted from task-manager: the Action-Center
// "Analyze with AI" call (useActionAnalysis) + its context/grounding builders,
// the weight-suggestion context builder, and the SP5 scheduled-job runner.
// Follows the use-storage-file-ops pattern: called unconditionally with the
// live closure values via a typed `deps` object; the inline `useCallback`/
// `useMemo` preserve the exact memoization the code had inline. Move-only.
//
// These hooks live ABOVE the view (in task-manager, via this hook) so their
// in-memory results survive view remounts — the extraction keeps them mounted
// in task-manager, NOT moved into any view component. Public surface is two
// values: `aiAnalysisBundle` (Action-Center prop) + `buildWeightSuggestionContext`
// (SettingsView prop). Everything else is internal.
import { useCallback, useMemo } from "react";
import { type Lang, t } from "./i18n";
import {
  aiKeyIfEnabled,
  isAiEnabled,
  resolveNextActionsConfig,
  defaultNextActionsLearning,
  type Settings,
} from "./settings-types";
import type { Task, RaidItem, Milestone, ChangeItem, Stakeholder, ProjectMeta } from "./types";
import type { SuggestedAction } from "./next-actions";
import type { AppView } from "./nav-config";
import type { LearningState } from "./action-learning";
import { summarizeTrendsForPrompt, type ActionTrends } from "./next-actions/trends";
import type { TursoConfig } from "./turso-config";
import { buildAnalysisContext, buildGroundingIndex, groundEntity, type AiAction } from "./action-ai";
import { buildSuggestionContext } from "./weight-suggestion-ai";
import type { SuggestionScope } from "./next-actions-tuning";
import { deriveMode } from "./feature-modules";
import { useActionAnalysis } from "./use-action-analysis";
import { useScheduledJobs } from "./use-scheduled-jobs";
import { useScheduledJobRunner } from "./use-scheduled-job-runner";

const MAX_LEARNING_SUMMARY_ENTRIES = 20;

/** Live render-scope values the AI orchestration cluster reads each render. */
export interface AiOrchestrationDeps {
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
  nextActions: readonly SuggestedAction[];
  learning: { state: LearningState };
  trendsActive: boolean;
  actionTrends: ActionTrends | undefined;
  tursoConfig: TursoConfig | null;
  requestOpen: (view: AppView, id: number) => void;
  requestChat: (prompt: string, autoSend: boolean) => void;
}

export function useAiOrchestration(deps: AiOrchestrationDeps) {
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
    nextActions,
    learning,
    trendsActive,
    actionTrends,
    tursoConfig,
    requestOpen,
    requestChat,
  } = deps;

  // Action Center "Analyze with AI": one forced-tool Anthropic call (no agentic
  // loop). Reuses the live in-memory key; surfaced via the aiAnalysisBundle prop.
  const actionAnalysis = useActionAnalysis({
    apiKey: aiKeyIfEnabled(settings.ai),
    model: settings.ai?.model ?? "claude-sonnet-4-6",
  });
  // Hoisted member reads (exhaustive-deps rejects `obj.member` deps; the hook
  // returns a fresh object each render so depending on the whole thing defeats
  // every downstream memo).
  const aiAnalyze = actionAnalysis.analyze;
  const groundingIndex = useMemo(
    () => buildGroundingIndex({ tasks, raid, milestones, changes, stakeholders }),
    [tasks, raid, milestones, changes, stakeholders],
  );
  // Shared workspace digest builder — used by the Action Center "Analyze with
  // AI" button AND the SP5 scheduled-job runner (both feed the same SP4 call).
  const buildAiContext = useCallback(
    () =>
      buildAnalysisContext({
        projectName: project?.name ?? "",
        today,
        mode: deriveMode(settings.features),
        enabledModules: settings.features,
        taskCount: tasks.length,
        tasks: tasks.map((x) => ({ id: x.id, title: x.taskName })),
        raid: raid.map((x) => ({ id: x.id, title: x.title })),
        milestones: milestones.map((x) => ({ id: x.id, title: x.name })),
        changes: changes.map((x) => ({ id: x.id, title: x.title })),
        stakeholders: stakeholders.map((x) => ({ id: x.id, name: x.name })),
        queue: nextActions.map((a) => ({
          title: t(lang, a.title.key, ...(a.title.params ?? [])),
          why: t(lang, a.why.key, ...(a.why.params ?? [])),
          tier: a.tier,
        })),
      }),
    [project, today, settings.features, tasks, raid, milestones, changes, stakeholders, nextActions, lang],
  );
  const runActionAnalysis = useCallback(() => {
    void aiAnalyze(buildAiContext());
  }, [aiAnalyze, buildAiContext]);
  // SP-C: compact, token-bounded context for the AI weight-suggestion call.
  // The workspace digest is reused from the SP4/SP5 builder; the learning
  // summary is one line per signal kind (act/snooze/dismiss counts). Trends
  // are a compact direction summary of the live snapshot trends when active
  // (Turso); otherwise a "(no snapshots)" sentinel.
  const learningState = learning.state;
  const learningEnabled = (settings.nextActionsLearning ?? defaultNextActionsLearning).enabled;
  const buildWeightSuggestionContext = useCallback(
    (scope: SuggestionScope) => {
      const kinds = Object.entries(learningState);
      const learningSummary = !learningEnabled
        ? "(learning disabled)"
        : kinds.length === 0
          ? "(no history)"
          : kinds
              .slice(0, MAX_LEARNING_SUMMARY_ENTRIES)
              .map(([kind, s]) => `- ${kind}: acted ${s.acted}, snoozed ${s.snoozed}, dismissed ${s.dismissed}`)
              .join("\n");
      return buildSuggestionContext({
        workspaceDigest: buildAiContext(),
        current: resolveNextActionsConfig(settings.nextActions),
        scope,
        learning: learningSummary,
        trends: trendsActive && actionTrends ? summarizeTrendsForPrompt(actionTrends) : "(no snapshots)",
        learningEnabled,
      });
    },
    [buildAiContext, settings.nextActions, learningState, learningEnabled, trendsActive, actionTrends],
  );
  const onActAi = useCallback(
    (a: AiAction) => {
      const g = groundEntity(a.entity, groundingIndex);
      if (g) requestOpen(g.view as AppView, g.id);
      else requestChat(`${a.title}\n\n${a.why}`, true);
    },
    [groundingIndex, requestOpen, requestChat],
  );
  // Hoisted member reads (exhaustive-deps rejects `obj.member` deps).
  const aiClear = actionAnalysis.clear;
  const aiCancel = actionAnalysis.cancel;
  const aiBusy = actionAnalysis.busy;
  const aiError = actionAnalysis.error;
  const aiResult = actionAnalysis.result;
  const aiEnabled = isAiEnabled(settings.ai) && settings.ai?.actionSuggestions !== false;
  const aiAnalysisBundle = useMemo(
    () => ({ enabled: aiEnabled, busy: aiBusy, error: aiError, result: aiResult, onAnalyze: runActionAnalysis, onCancel: aiCancel, onClear: aiClear, onActAi }),
    [aiEnabled, aiBusy, aiError, aiResult, runActionAnalysis, aiCancel, aiClear, onActAi],
  );

  // SP5 scheduled jobs: recurring advisory analysis runs (due-on-open / tick).
  // Opt-in (default OFF), key required, never in popouts. Reuses the SP4
  // context builder + analysis call; results surface as a desktop notification
  // and in the Settings "Scheduled jobs" run history.
  const scheduledJobs = useScheduledJobs({ config: tursoConfig });
  const notifyScheduledJob = useCallback(
    (jobName: string, summary: string) => {
      if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
      try {
        new Notification(t(lang, "scheduledJobNotifyTitle", jobName), {
          body: t(lang, "scheduledJobNotifyBody", summary),
        });
      } catch {
        /* notification fire is best-effort */
      }
    },
    [lang],
  );
  useScheduledJobRunner({
    enabled: !isPopout && isAiEnabled(settings.ai) && settings.ai?.scheduledJobs === true,
    jobs: scheduledJobs.jobs,
    recordRun: scheduledJobs.recordRun,
    buildContext: buildAiContext,
    ai: { apiKey: aiKeyIfEnabled(settings.ai), model: settings.ai?.model ?? "claude-sonnet-4-6" },
    notify: notifyScheduledJob,
  });

  return { aiAnalysisBundle, buildWeightSuggestionContext };
}
