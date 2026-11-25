// The scheduled-job runner judges this device's answers in the ACTIVE portfolio only: `useAiOrchestration` hands it an
// `isAcceptedHere` scoped to its own Turso config. The runner is mocked to capture that predicate.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { newConsent } from "./ai-consent";

const runnerArgs = vi.hoisted(() => [] as unknown[]);
vi.mock("./use-scheduled-job-runner", () => ({
  useScheduledJobRunner: (args: unknown) => { runnerArgs.push(args); },
}));
vi.mock("./use-action-analysis", () => ({
  useActionAnalysis: () => ({ analyze: vi.fn(), busy: false, error: null, result: null, clear: vi.fn(), cancel: vi.fn() }),
}));
vi.mock("./scheduled-jobs-store", () => ({ loadScheduledJobs: async () => [], saveScheduledJobs: async () => undefined }));
vi.mock("./workspace-context", () => ({ useWorkspace: () => ({ ...emptyWorkspace(), budgets: [] }) }));
import { useAiOrchestration, type AiOrchestrationDeps } from "./use-ai-orchestration";
import { emptyWorkspace } from "./workspace";
import { defaultSettings } from "./settings-types";
import { ACCEPTANCE_KEY, acceptanceScope, acceptJob } from "./scheduled-job-acceptance";
import type { ScheduledJob } from "./scheduled-jobs/types";
import type { TursoConfig } from "./turso-config";

const A = { httpUrl: "https://a.example", authToken: "t" } as unknown as TursoConfig;
const B = { httpUrl: "https://b.example", authToken: "t" } as unknown as TursoConfig;

function deps(tursoConfig: TursoConfig | null): AiOrchestrationDeps {
  return {
    isPopout: false,
    settings: {
      ...defaultSettings,
      ai: { ...defaultSettings.ai, enabled: true, consent: newConsent(new Date(0)), backgroundConsent: newConsent(new Date(0)), apiKey: "sk-ant-k", scheduledJobs: true },
    },
    guides: [],
    guidesReady: true,
    lang: "en-US",
    today: "2026-10-12",
    project: undefined,
    tasks: [], raid: [], milestones: [], changes: [], stakeholders: [], nextActions: [],
    learning: { state: {} as never },
    trendsActive: false,
    actionTrends: undefined,
    tursoConfig, openProjectId: null, loadPending: false,
    requestOpen: vi.fn(),
    requestChat: vi.fn(),
  };
}

const job: ScheduledJob = {
  id: 1, name: "Daily", type: "portfolioAnalysis", cadence: { kind: "daily", timeOfDay: "09:00" }, enabled: true,
  projectId: "p1", timeZone: "UTC", key: "K1", instruction: "x", lastRunAt: null, history: [],
};
const runnerAccepts = (j: ScheduledJob) => (runnerArgs.at(-1) as { isAcceptedHere: (j: ScheduledJob) => boolean }).isAcceptedHere(j);

describe("useAiOrchestration — the runner's acceptance check is scoped to the active portfolio", () => {
  beforeEach(() => {
    runnerArgs.length = 0;
    localStorage.removeItem(ACCEPTANCE_KEY);
  });

  it("a job accepted in the active portfolio runs; the same job accepted only in another portfolio does not", () => {
    acceptJob(job, acceptanceScope(B.httpUrl)); // answered in the other portfolio (a clone with the same key)
    renderHook(() => useAiOrchestration(deps(A)));
    expect(runnerAccepts(job)).toBe(false);
    acceptJob(job, acceptanceScope(A.httpUrl));
    expect(runnerAccepts(job)).toBe(true);
  });

  it("an answer kept for the local list does not count for a Turso portfolio", () => {
    acceptJob(job, acceptanceScope(null));
    renderHook(() => useAiOrchestration(deps(A)));
    expect(runnerAccepts(job)).toBe(false);
  });
});
