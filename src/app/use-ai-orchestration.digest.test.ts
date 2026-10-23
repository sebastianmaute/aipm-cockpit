// §772 — the Action Center's "Analyze with AI" sends the WIDE per-project digest (task status and due
// date, every open entity, the budget line), built by the same `buildProjectAnalysisInput` a scheduled
// report uses. The weight-suggestion call keeps the compact title-only digest.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

const analyze = vi.hoisted(() => vi.fn());
vi.mock("./use-action-analysis", () => ({
  useActionAnalysis: () => ({ analyze, busy: false, error: null, result: null, clear: vi.fn(), cancel: vi.fn() }),
}));
vi.mock("./use-scheduled-job-runner", () => ({ useScheduledJobRunner: () => {} }));
const workspaceSlices = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
vi.mock("./workspace-context", () => ({ useWorkspace: () => workspaceSlices.value }));

import { useAiOrchestration, type AiOrchestrationDeps } from "./use-ai-orchestration";
import { defaultSettings } from "./settings-types";
import { emptyWorkspace, type Workspace } from "./workspace";
import type { Task } from "./types";

const task = {
  id: 7, taskName: "Ship the thing", assignee: "Ada", assigneeEmail: "", dueDate: "2026-11-05",
  lastUpdateDate: "2026-10-01", priority: "High", status: "In Progress", blockers: "", description: "",
} as Task;

const plan = { startDate: "2026-01-01", endDate: "2026-12-31", granularity: "month", currency: "EUR" } as Workspace["plan"];
const bucket = {
  id: 1, name: "Delivery", type: "fixed", currency: "EUR", fixedPriceAmount: 50000,
  startDate: "2026-01-01", endDate: "2026-12-31", status: "open", allocations: [],
} as unknown as NonNullable<Workspace["budgets"]>[number];

function deps(): AiOrchestrationDeps {
  return {
    isPopout: false,
    settings: { ...defaultSettings, ai: { ...defaultSettings.ai, enabled: true, apiKey: "sk-ant-k" } },
    guides: [],
    guidesReady: true,
    lang: "en-US",
    today: "2026-10-23",
    project: undefined,
    tasks: [task], raid: [], milestones: [], changes: [], stakeholders: [], nextActions: [],
    learning: { state: {} as never },
    trendsActive: false,
    actionTrends: undefined,
    tursoConfig: null,
    requestOpen: vi.fn(),
    requestChat: vi.fn(),
  };
}

const analyzeContext = (): string => {
  const { result } = renderHook(() => useAiOrchestration(deps()));
  result.current.aiAnalysisBundle.onAnalyze();
  return analyze.mock.calls[0][0] as string;
};

describe("useAiOrchestration — wide digest for Analyze with AI (§772)", () => {
  beforeEach(() => {
    analyze.mockClear();
    workspaceSlices.value = { ...emptyWorkspace(), plan, budgets: [] };
  });

  it("sends a task's status and due date to Analyze with AI", () => {
    const context = analyzeContext();
    expect(context).toContain("open-points#7: Ship the thing");
    expect(context).toContain("In Progress");
    expect(context).toContain("due 2026-11-05");
  });

  it("sends the budget line when the workspace has budgets", () => {
    workspaceSlices.value = { ...emptyWorkspace(), plan, budgets: [bucket] };
    expect(analyzeContext()).toContain("Budget (EUR): planned 50000");
  });

  it("sends no budget line when the workspace has none", () => {
    expect(analyzeContext()).not.toContain("Budget (");
  });

  it("keeps the weight-suggestion context on the compact digest", () => {
    const { result } = renderHook(() => useAiOrchestration(deps()));
    const context = result.current.buildWeightSuggestionContext("weights");
    expect(context).toContain("Ship the thing");
    expect(context).not.toContain("due 2026-11-05");
  });
});
