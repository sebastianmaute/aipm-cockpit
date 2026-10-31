// AI people protection, Task 5 review round 1 (I4): "Analyze with AI" and the weight-suggestion context
// hand the Action Center's live queue to the model. Under protection, its people signals (workload,
// stakeholder comms) are filtered out by ONE predicate over the action's SOURCE, never its text.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

const analyze = vi.hoisted(() => vi.fn());
vi.mock("./use-action-analysis", () => ({
  useActionAnalysis: () => ({ analyze, busy: false, error: null, result: null, clear: vi.fn(), cancel: vi.fn() }),
}));
vi.mock("./use-scheduled-job-runner", () => ({ useScheduledJobRunner: () => {} }));
const workspaceSlices = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
vi.mock("./workspace-context", () => ({ useWorkspace: () => workspaceSlices.value }));
const prot = vi.hoisted(() => ({ value: true }));
vi.mock("./ai-privacy-context", () => ({ useOpenProjectPeopleProtected: () => () => prot.value }));

import { useAiOrchestration, type AiOrchestrationDeps } from "./use-ai-orchestration";
import { isPeopleSignalAction } from "./next-actions/people-signals";
import { defaultSettings } from "./settings-types";
import { withPeopleAllowed } from "./ai-people-protection";
import { emptyWorkspace, type Workspace } from "./workspace";
import type { ActionSource, SuggestedAction } from "./next-actions/types";

const plan = { startDate: "2026-01-01", endDate: "2026-12-31", granularity: "month", currency: "EUR" } as Workspace["plan"];

function action(source: ActionSource, marker: string): SuggestedAction {
  return {
    id: `${source}:1:x`, source, title: { key: "actionWorkloadTitle", params: [marker] },
    why: { key: "actionWorkloadTitle", params: [`${marker} why`] }, score: 50, tier: "now", cta: { kind: "snooze", actionId: "x" },
  } as SuggestedAction;
}

const QUEUE = [action("workload", "Alice Anderson"), action("stakeholder-comms", "Bob Baker"), action("raid", "Risk forty-two")];

function deps(): AiOrchestrationDeps {
  return {
    isPopout: false,
    settings: { ...defaultSettings, ai: { ...defaultSettings.ai, enabled: true, apiKey: "sk-ant-k" } },
    guides: [], guidesReady: true, lang: "en-US", today: "2026-10-23", project: undefined,
    tasks: [], raid: [], milestones: [], changes: [], stakeholders: [], nextActions: QUEUE,
    learning: { state: {} as never }, trendsActive: false, actionTrends: undefined, tursoConfig: null,
    requestOpen: vi.fn(), requestChat: vi.fn(),
  };
}

function contexts(): { wide: string; weights: string } {
  analyze.mockClear();
  const { result } = renderHook(() => useAiOrchestration(deps()));
  result.current.aiAnalysisBundle.onAnalyze();
  return { wide: analyze.mock.calls[0]![0] as string, weights: result.current.buildWeightSuggestionContext("weights") };
}

describe("the people-signal predicate", () => {
  it("classifies by source: workload and stakeholder comms are people signals, a RAID item is not", () => {
    expect(isPeopleSignalAction(action("workload", "x"))).toBe(true);
    expect(isPeopleSignalAction(action("stakeholder-comms", "x"))).toBe(true);
    expect(isPeopleSignalAction(action("raid", "x"))).toBe(false);
    expect(isPeopleSignalAction(action("task-due", "x"))).toBe(false);
  });
});

describe("Analyze with AI and weight suggestions under protection", () => {
  beforeEach(() => {
    workspaceSlices.value = { ...emptyWorkspace(), plan, budgets: [] };
  });

  it("protected: neither context carries a people signal, and both keep the rest", () => {
    prot.value = true;
    const { wide, weights } = contexts();
    for (const ctx of [wide, weights]) {
      expect(ctx).not.toContain("Alice Anderson");
      expect(ctx).not.toContain("Bob Baker");
      expect(ctx).toContain("Risk forty-two");
    }
  });

  it("allowed: both contexts carry the whole queue", () => {
    prot.value = false;
    workspaceSlices.value = { ...emptyWorkspace(), plan, budgets: [], settingsOverrides: withPeopleAllowed(undefined, true) };
    const { wide, weights } = contexts();
    for (const ctx of [wide, weights]) {
      expect(ctx).toContain("Alice Anderson");
      expect(ctx).toContain("Bob Baker");
    }
  });
});
