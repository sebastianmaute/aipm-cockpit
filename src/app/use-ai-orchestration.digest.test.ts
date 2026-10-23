// §772 — the Action Center's "Analyze with AI" sends the WIDE per-project digest (task status and due
// date, every open entity), the same one a scheduled report sends. The weight-suggestion call keeps the
// compact title-only digest.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

const analyze = vi.hoisted(() => vi.fn());
vi.mock("./use-action-analysis", () => ({
  useActionAnalysis: () => ({ analyze, busy: false, error: null, result: null, clear: vi.fn(), cancel: vi.fn() }),
}));
vi.mock("./use-scheduled-job-runner", () => ({ useScheduledJobRunner: () => {} }));

import { useAiOrchestration, type AiOrchestrationDeps } from "./use-ai-orchestration";
import { defaultSettings } from "./settings-types";
import type { Task } from "./types";

const task = {
  id: 7, taskName: "Ship the thing", assignee: "Ada", assigneeEmail: "", dueDate: "2026-11-05",
  lastUpdateDate: "2026-10-01", priority: "High", status: "In Progress", blockers: "", description: "",
} as Task;

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

describe("useAiOrchestration — wide digest for Analyze with AI (§772)", () => {
  beforeEach(() => analyze.mockClear());

  it("sends a task's status and due date to Analyze with AI", () => {
    const { result } = renderHook(() => useAiOrchestration(deps()));
    result.current.aiAnalysisBundle.onAnalyze();
    const context = analyze.mock.calls[0][0] as string;
    expect(context).toContain("open-points#7: Ship the thing");
    expect(context).toContain("In Progress");
    expect(context).toContain("due 2026-11-05");
  });

  it("keeps the weight-suggestion context on the compact digest", () => {
    const { result } = renderHook(() => useAiOrchestration(deps()));
    const context = result.current.buildWeightSuggestionContext("weights");
    expect(context).toContain("Ship the thing");
    expect(context).not.toContain("due 2026-11-05");
  });
});
