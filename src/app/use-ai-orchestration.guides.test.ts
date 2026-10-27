// §701 — `useAiOrchestration` runs in task-manager's own body, above the
// `AiProviders` it renders, so it resolves the jobAnalysis guide text from its
// `guides` dep and hands it to both of its callers: the on-demand "Analyze with
// AI" hook and the scheduled-job runner. The two are mocked to capture their args.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { newConsent } from "./ai-consent";
import { renderHook } from "@testing-library/react";

const analysisArgs = vi.hoisted(() => [] as unknown[]);
const runnerArgs = vi.hoisted(() => [] as unknown[]);
vi.mock("./use-action-analysis", () => ({
  useActionAnalysis: (ai: unknown) => {
    analysisArgs.push(ai);
    return { analyze: vi.fn(), busy: false, error: null, result: null, clear: vi.fn(), cancel: vi.fn() };
  },
}));
vi.mock("./use-scheduled-job-runner", () => ({
  useScheduledJobRunner: (args: unknown) => { runnerArgs.push(args); },
}));

vi.mock("./workspace-context", () => ({ useWorkspace: () => ({ ...emptyWorkspace(), budgets: [] }) }));
import { useAiOrchestration, type AiOrchestrationDeps } from "./use-ai-orchestration";
import { emptyWorkspace } from "./workspace";
import { actionGuideText, type OperatingGuide } from "./operating-guide";
import { defaultSettings } from "./settings-types";

const guide: OperatingGuide = {
  id: "g-job", name: "Job guide", content: "JOB-GUIDE-701", enabled: true,
  priority: 1, scope: { targets: ["jobAnalysis"] }, builtIn: false,
};

function deps(groundInGuides: boolean, guidesReady = true, scheduledJobs = false, backgroundConsent = true): AiOrchestrationDeps {
  return {
    isPopout: false,
    settings: { ...defaultSettings, ai: { ...defaultSettings.ai, enabled: true, consent: newConsent(new Date(0)), backgroundConsent: backgroundConsent ? newConsent(new Date(0)) : undefined, apiKey: "sk-ant-k", groundInGuides, scheduledJobs } },
    guides: [guide],
    guidesReady,
    lang: "en-US",
    today: "2026-10-12",
    project: undefined,
    tasks: [], raid: [], milestones: [], changes: [], stakeholders: [], nextActions: [],
    learning: { state: {} as never },
    trendsActive: false,
    actionTrends: undefined,
    tursoConfig: null,
    requestOpen: vi.fn(),
    requestChat: vi.fn(),
  };
}

const guideTextOf = (args: unknown[]) => (args.at(-1) as { guideText?: string }).guideText;
const runnerGuideTextOf = () => (runnerArgs.at(-1) as { ai: { guideText?: string } }).ai.guideText;

describe("useAiOrchestration — operating guides (§701)", () => {
  beforeEach(() => { analysisArgs.length = 0; runnerArgs.length = 0; });

  it("hands the jobAnalysis guide text to Analyze with AI and to the scheduled-job runner", () => {
    renderHook(() => useAiOrchestration(deps(true)));
    const expected = actionGuideText([guide], true, "jobAnalysis");
    expect(expected).toContain("JOB-GUIDE-701");
    expect(guideTextOf(analysisArgs)).toBe(expected);
    expect(runnerGuideTextOf()).toBe(expected);
  });

  it("hands both of them no guide text when grounding is off", () => {
    renderHook(() => useAiOrchestration(deps(false)));
    expect(guideTextOf(analysisArgs)).toBe("");
    expect(runnerGuideTextOf()).toBe("");
  });

  // The runner is unattended: while grounding is on it is told the guides are
  // not ready (it holds its tick, then ticks once they arrive). It stays
  // enabled throughout, so the hold is the guide gate alone.
  const runnerArg = <K extends "enabled" | "guidesReady">(k: K) => (runnerArgs.at(-1) as Record<K, boolean>)[k];
  it("tells the scheduled-job runner the guides are not ready while they load", () => {
    renderHook(() => useAiOrchestration(deps(true, false, true)));
    expect(runnerArg("enabled")).toBe(true);
    expect(runnerArg("guidesReady")).toBe(false);
  });
  // AI-10: the runner fires without a click, so interactive consent alone leaves it disabled; its own
  // behaviour when disabled (no claim, no run) is pinned in use-scheduled-job-runner.test.tsx.
  it("keeps the scheduled-job runner disabled with interactive consent only, enabled with both (AI-10)", () => {
    renderHook(() => useAiOrchestration(deps(false, true, true, false)));
    expect(runnerArg("enabled")).toBe(false);
    renderHook(() => useAiOrchestration(deps(false, true, true, true)));
    expect(runnerArg("enabled")).toBe(true);
  });
  it("tells it they are ready once loaded, and always when grounding is off", () => {
    renderHook(() => useAiOrchestration(deps(true, true, true)));
    expect(runnerArg("guidesReady")).toBe(true);
    renderHook(() => useAiOrchestration(deps(false, false, true)));
    expect(runnerArg("guidesReady")).toBe(true);
  });
});
