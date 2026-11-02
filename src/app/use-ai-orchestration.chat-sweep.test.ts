// The app-start saved-chat retention sweep is called from this hook (task-manager has no room for it).
// It must receive the live Turso config and load hold, and run with the AI switched off too.
import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";

const sweep = vi.hoisted(() => vi.fn());
vi.mock("./use-chat-retention-sweep", () => ({ useChatRetentionSweep: (...a: unknown[]) => sweep(...a) }));
vi.mock("./use-action-analysis", () => ({
  useActionAnalysis: () => ({ analyze: vi.fn(), busy: false, error: null, result: null, clear: vi.fn(), cancel: vi.fn() }),
}));
vi.mock("./use-scheduled-job-runner", () => ({ useScheduledJobRunner: () => {} }));
vi.mock("./use-scheduled-jobs", () => ({ useScheduledJobs: () => ({ jobs: [], jobsSource: null }) }));
vi.mock("./workspace-context", () => ({ useWorkspace: () => ({}) }));
vi.mock("./ai-privacy-context", () => ({ useOpenProjectPeopleProtected: () => () => false }));

import { useAiOrchestration, type AiOrchestrationDeps } from "./use-ai-orchestration";
import { defaultSettings } from "./settings-types";
import type { TursoConfig } from "./turso-config";

const config: TursoConfig = { httpUrl: "https://a.example", authToken: "t" };

function deps(loadPending: boolean): AiOrchestrationDeps {
  return {
    isPopout: false,
    settings: { ...defaultSettings, ai: { ...defaultSettings.ai, enabled: false } },
    guides: [], guidesReady: true, lang: "en-US", today: "2026-11-01", project: undefined,
    tasks: [], raid: [], milestones: [], changes: [], stakeholders: [], nextActions: [],
    learning: { state: {} as never }, trendsActive: false, actionTrends: undefined, tursoConfig: config, loadPending,
    requestOpen: vi.fn(), requestChat: vi.fn(),
  };
}

describe("useAiOrchestration — saved-chat retention sweep", () => {
  it("hands the sweep the Turso config and the load hold, with the AI switched off", () => {
    const h = renderHook((p: { loadPending: boolean }) => useAiOrchestration(deps(p.loadPending)), { initialProps: { loadPending: true } });
    expect(sweep).toHaveBeenLastCalledWith({ tursoConfig: config, loadPending: true });
    h.rerender({ loadPending: false });
    expect(sweep).toHaveBeenLastCalledWith({ tursoConfig: config, loadPending: false });
  });
});
