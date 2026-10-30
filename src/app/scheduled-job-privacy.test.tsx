import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { useScheduledJobRunner, type ScheduledJobRunnerArgs } from "./use-scheduled-job-runner";
import { AiPrivacyProvider, useAiPrivacySource } from "./ai-privacy-context";
import { withPeopleAllowed } from "./ai-people-protection";
import { newConsent, publishAiConsentState, publishBackgroundCapState } from "./ai-consent";
import { defaultAiConfig, defaultSettings } from "./settings-types";
import { emptyWorkspace, type Workspace } from "./workspace";
import type { Stakeholder } from "./types";
import type { ScheduledJob } from "./scheduled-jobs/types";

// AI people protection, Task 4, Review Focus 5 (spec R3): a scheduled job reports on a STORED project,
// so its request carries that project's privacy — its setting and its people — never the open one's.
// The REAL runner, run, analysis call, forced-tool envelope and transport run here; only the storage
// edges are mocked, and the assertion reads the request body `fetch` was handed.

vi.mock("./turso-portfolio", () => ({ listProjectRefs: vi.fn() }));
const storeState = vi.hoisted(() => ({ jobs: [] as unknown[] }));
vi.mock("./scheduled-jobs-store", () => ({ loadScheduledJobs: vi.fn(async () => storeState.jobs) }));
const loaded = vi.hoisted(() => ({ ws: undefined as unknown }));
vi.mock("./turso-backend", () => ({
  TursoBackend: vi.fn().mockImplementation(function () {
    return { load: async () => loaded.ws, lastDecodeFailures: [], lastLoadTruncation: { entries: 0, blocks: 0 } };
  }),
}));
vi.mock("./scheduled-reports-store", () => ({
  hasReportAtOrAfter: vi.fn(async () => false),
  slotStatus: vi.fn(async () => "none"),
  claimReport: vi.fn(async () => true),
  releaseClaim: vi.fn(async () => undefined),
  finishReport: vi.fn(async () => undefined),
}));
import { listProjectRefs } from "./turso-portfolio";
import { finishReport } from "./scheduled-reports-store";

// The SAME person in both projects, so a request that used the OPEN project's dictionary would redact
// (or keep) her exactly when the target's would not: the two cases below then tell the projects apart.
const PERSON: Stakeholder = {
  id: 1, name: "Rosalind Quenby", title: "Sponsor", category: "Sponsor", influence: "High", interest: "High", raci: {},
};
const workspaceWith = (allowed: boolean): Workspace => ({
  ...emptyWorkspace(),
  stakeholders: [PERSON],
  settingsOverrides: withPeopleAllowed(undefined, allowed),
});

const job: ScheduledJob = {
  id: 1, name: "Daily", type: "portfolioAnalysis", cadence: { kind: "daily", timeOfDay: "09:00" },
  enabled: true, projectId: "project-B", timeZone: "UTC", key: "job-key-B", lastRunAt: null, history: [],
  instruction: "Check what Rosalind Quenby still owes the steering committee.",
};

function args(): ScheduledJobRunnerArgs {
  return {
    enabled: true, guidesReady: true, jobs: [job], jobsSource: "https://example.test",
    recordRun: vi.fn(), config: { httpUrl: "https://example.test", authToken: "t" } as never, available: true,
    deviceSettings: defaultSettings, lang: "en-US",
    clearProject: vi.fn(async () => undefined), disableJob: vi.fn(async () => undefined),
    ai: { apiKey: "sk-test", model: "m" }, notify: vi.fn(), now: () => new Date("2026-10-23T14:00:00.000Z"),
  };
}

/** Project A is open: it registers ITS privacy source, as task-manager does. */
function openProject(ws: Workspace) {
  function Open({ children }: { children: ReactNode }) {
    useAiPrivacySource("project-A", () => ws);
    return <>{children}</>;
  }
  return function Wrapper({ children }: { children: ReactNode }) {
    return <AiPrivacyProvider><Open>{children}</Open></AiPrivacyProvider>;
  };
}

const sentBodies: string[] = [];
beforeEach(() => {
  sentBodies.length = 0;
  storeState.jobs = [job];
  vi.mocked(listProjectRefs).mockResolvedValue({ active: [{ id: "project-B", name: "Beta" }], archived: [] });
  publishAiConsentState({ ...defaultAiConfig, enabled: true, consent: newConsent(new Date(0)), backgroundConsent: newConsent(new Date(0)) });
  publishBackgroundCapState(false);
  vi.stubGlobal("fetch", vi.fn(async (...call: [string, RequestInit?]) => {
    sentBodies.push(String(call[1]?.body));
    return new Response(JSON.stringify({
      content: [{ type: "tool_use", id: "t1", name: "report_analysis", input: { summary: "All fine.", actions: [] } }],
      stop_reason: "tool_use",
      usage: { input_tokens: 1, output_tokens: 1 },
    }), { status: 200 });
  }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  publishAiConsentState(undefined);
});

async function runWith(open: Workspace, target: Workspace): Promise<string> {
  loaded.ws = target;
  renderHook(() => useScheduledJobRunner(args()), { wrapper: openProject(open) });
  await waitFor(() => expect(vi.mocked(finishReport)).toHaveBeenCalled());
  const messages = sentBodies.filter((b) => b.includes("\"messages\""));
  expect(messages).toHaveLength(1);
  return messages[0];
}

describe("a scheduled job sends with the TARGET project's privacy, not the open one's", () => {
  beforeEach(() => vi.mocked(finishReport).mockClear());

  it("open A allowed, target B protected: B's people are redacted", async () => {
    const body = await runWith(workspaceWith(true), workspaceWith(false));
    expect(body).toContain("steering committee"); // the instruction did go out
    expect(body).not.toMatch(/Rosalind|Quenby/);
  });

  it("open A protected, target B allowed: B's people go out as they are", async () => {
    const body = await runWith(workspaceWith(false), workspaceWith(true));
    expect(body).toContain("Rosalind Quenby");
  });
});
