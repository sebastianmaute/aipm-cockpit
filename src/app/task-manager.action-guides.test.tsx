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
const seen: { wbs: OperatingGuide[][]; report: OperatingGuide[][] } = { wbs: [], report: [] };
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

import TaskManager from "./task-manager";

const TEAM: OperatingGuide = {
  id: "guide-team", name: "Team rules", content: "Split anything over 3 days.", enabled: true,
  priority: 50, scope: { targets: ["wbs", "committeeReport"] }, builtIn: false,
};

describe("task-manager feeds the guide library to its body-level AI hooks (§701)", () => {
  it("hands the stored guides to Optimize with AI and the committee report", async () => {
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
    });
  }, 45000);
});
