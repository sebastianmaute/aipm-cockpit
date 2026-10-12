// §701 — task-manager hands the loaded guide library to the AI hooks it calls in
// ITS OWN BODY. Those hooks sit above `AiProviders` (rendered in task-manager's
// returned JSX, so it wraps the children only), so a hook-level test that mounts
// a provider around the hook passes even when the real wiring sends nothing.
// Only a mount of the real TaskManager sees which library reaches them.
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { __resetMintStateForTests } from "./id-mint-session";
import { LOCAL_KEY } from "./operating-guide-store";
import type { OperatingGuide } from "./operating-guide";

beforeEach(() => {
  __resetMintStateForTests();
});

vi.mock("./workspace-section", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./workspace-section")>()),
  WorkspaceSection: () => <div data-testid="ws-section-mock" />,
}));

// Pass-through spies: the real hooks run; the deps task-manager hands them are
// recorded on every render.
// The guidesReady each runner-owning hook was handed, render by render.
const readySeen: Record<"orchestration" | "insights", boolean[]> = { orchestration: [], insights: [] };
const seen: Record<"wbs" | "report" | "orchestration" | "insights", OperatingGuide[][]> = {
  wbs: [], report: [], orchestration: [], insights: [],
};
vi.mock("./use-wbs-plan", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./use-wbs-plan")>();
  return {
    ...actual,
    useWbsPlan: (deps: Parameters<typeof actual.useWbsPlan>[0]) => {
      seen.wbs.push([...deps.guides]);
      return actual.useWbsPlan(deps);
    },
  };
});
vi.mock("./use-meeting-report-actions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./use-meeting-report-actions")>();
  return {
    ...actual,
    useMeetingReportActions: (deps: Parameters<typeof actual.useMeetingReportActions>[0]) => {
      seen.report.push([...deps.guides]);
      return actual.useMeetingReportActions(deps);
    },
  };
});

vi.mock("./use-ai-orchestration", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./use-ai-orchestration")>();
  return {
    ...actual,
    useAiOrchestration: (deps: Parameters<typeof actual.useAiOrchestration>[0]) => {
      seen.orchestration.push([...deps.guides]);
      readySeen.orchestration.push(deps.guidesReady);
      return actual.useAiOrchestration(deps);
    },
  };
});
vi.mock("./use-insight-recommendations", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./use-insight-recommendations")>();
  return {
    ...actual,
    useInsightRecommendations: (deps: Parameters<typeof actual.useInsightRecommendations>[0]) => {
      seen.insights.push([...deps.guides]);
      readySeen.insights.push(deps.guidesReady);
      return actual.useInsightRecommendations(deps);
    },
  };
});

import TaskManager from "./task-manager";

const TEAM: OperatingGuide = {
  id: "guide-team", name: "Team rules", content: "Split anything over 3 days.", enabled: true,
  priority: 50, scope: { targets: ["wbs", "committeeReport", "jobAnalysis", "insightRecommend"] }, builtIn: false,
};

describe("task-manager feeds the guide library to its body-level AI hooks (§701)", () => {
  it("hands the stored guides to every AI hook it calls in its own body", async () => {
    window.localStorage.clear();
    window.localStorage.setItem(
      "aipm-cockpit:projects",
      JSON.stringify({
        projects: [{ id: "p1", name: "Seed", code: "SEED", storageConfig: { kind: "browser" } }],
        currentProjectId: "p1",
      }),
    );
    window.localStorage.setItem(LOCAL_KEY, JSON.stringify([TEAM]));
    render(<TaskManager />);
    await screen.findByTestId("ws-section-mock", undefined, { timeout: 30000 });
    await waitFor(() => {
      expect(seen.wbs.at(-1)?.some((g) => g.id === TEAM.id)).toBe(true);
      expect(seen.report.at(-1)?.some((g) => g.id === TEAM.id)).toBe(true);
      expect(seen.orchestration.at(-1)?.some((g) => g.id === TEAM.id)).toBe(true);
      expect(seen.insights.at(-1)?.some((g) => g.id === TEAM.id)).toBe(true);
    });
    // The runners are handed the REAL load state: not ready before the guides
    // load, ready after. A hard-coded `true` at the call site could not show the false.
    await waitFor(() => {
      for (const k of ["orchestration", "insights"] as const) {
        expect(readySeen[k]).toContain(false);
        expect(readySeen[k].at(-1)).toBe(true);
      }
    });
  }, 45000);
});
