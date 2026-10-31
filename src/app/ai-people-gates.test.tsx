import "fake-indexeddb/auto";
import "../test/ai-consent-live";
// AI people protection, Task 5 (spec layer 1): with protection on, the people features are hidden and
// unreachable, the chat loses its people tools on the next send, dictation is off and says why, and the
// context builders drop their people sections.
import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import type { ReactNode } from "react";
import { ChatPanel } from "./chat-panel";
import { AiPrivacyProvider, useAiPrivacySource } from "./ai-privacy-context";
import { withPeopleAllowed } from "./ai-people-protection";
import { newConsent } from "./ai-consent";
import { defaultAiConfig, defaultSettings, type Settings } from "./settings-types";
import { emptyWorkspace, type Workspace } from "./workspace";
import { t } from "./i18n";
import type { ToolDispatcher } from "./chat-tools";
import { PEOPLE_TOOLS } from "./chat-tool-defs";
import { ToastProvider } from "./toast-context";
import { useAllocPlan } from "./use-alloc-plan";
import { useRaciSuggest } from "./use-raci-suggest";
import { useDictationMic } from "./dictation-mic";
import { buildRecommendContext } from "./insights/recommend-context";
import { buildAnalysisContext } from "./action-ai";
import { buildProjectAnalysisInput } from "./project-analysis-input";
import { buildProjectDigest } from "./project-digest";
import type { Milestone, Resource, ResourcePlan, Stakeholder } from "./types";

// Review 3, R6: a RACI proposal the test can reach the preview with, without a request.
vi.mock("./raci-suggest-call", () => ({
  runRaciSuggestion: vi.fn(async () => ({ cells: [{ stakeholderId: 1, milestoneId: 10, role: "R" }], truncated: false })),
}));
vi.mock("./chat-threads-store", () => ({
  loadThreads: vi.fn(async () => []),
  saveThread: vi.fn(async () => undefined),
  deleteThread: vi.fn(async () => undefined),
}));

const ALICE: Stakeholder = { id: 1, name: "Alice Anderson", category: "Sponsor", influence: "High", interest: "High", raci: {} };
const MILESTONES: Milestone[] = [{ id: 10, name: "Go-Live", date: "2026-09-01", linkedTaskIds: [] }];
const PLAN: ResourcePlan = { startDate: "2026-08-01", endDate: "2026-08-31", granularity: "month", currency: "EUR" };
const RESOURCE = { id: 1, firstName: "Alice", lastName: "Anderson", roleId: null, utilizationMode: "hours", utilization: {} } as unknown as Resource;

const allowed = (ws: Workspace): Workspace => ({ ...ws, settingsOverrides: withPeopleAllowed(undefined, true) });
const protectedWs = (ws: Workspace): Workspace => ({ ...ws, settingsOverrides: undefined });
const base = (): Workspace => ({ ...emptyWorkspace(), stakeholders: [ALICE] });

const AI_SETTINGS: Settings = {
  ...defaultSettings,
  ai: { ...defaultSettings.ai, enabled: true, consent: newConsent(new Date(0)), apiKey: "sk-ant-test", model: "claude-x" },
};
const toast = { showToast: vi.fn(), showToastAction: vi.fn() };

/** The open project's privacy source, as task-manager registers it: re-registered on every render. */
function Source({ ws, children }: { ws: () => Workspace; children: ReactNode }) {
  useAiPrivacySource("p1", ws, () => 0);
  return <>{children}</>;
}

afterEach(() => vi.restoreAllMocks());

// ---------------------------------------------------------------------------
// Review Focus 4 — the chat reads protection at SEND time.
// ---------------------------------------------------------------------------

describe("chat: protection switched on mid-thread", () => {
  const SCOPE_PROPS = { getScopeEpoch: () => 0, isSwapInFlight: () => false };
  const AI = { ...defaultAiConfig, enabled: true, consent: newConsent(new Date(0)), apiKey: "sk-test" };
  function makeDispatcher(): ToolDispatcher {
    return {
      getSnapshot: vi.fn(() => ({
        today: "2026-06-04", language: "en-US", holidayCountries: [], storageKind: "memory", taskCount: 0,
        knownGroups: [], knownLabels: [], mode: "advanced" as const, enabledModules: [] as string[],
        currentView: "open-points" as const,
      })),
    } as unknown as ToolDispatcher;
  }
  function send(text: string) {
    fireEvent.change(screen.getByPlaceholderText("Ask Claude about your tasks…"), { target: { value: text } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
  }
  const toolNames = (body: string): string[] =>
    ((JSON.parse(body) as { tools?: { name: string }[] }).tools ?? []).map((d) => d.name);

  it("the next send carries no people tool and its history is redacted", async () => {
    const bodies: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation((_url, init?: RequestInit) => {
      bodies.push(String(init?.body ?? ""));
      return Promise.resolve(new Response(JSON.stringify({
        content: [{ type: "text", text: `Reply ${bodies.length}.` }], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 },
      }), { status: 200 }));
    });
    let current = allowed(base());
    render(
      <AiPrivacyProvider>
        <Source ws={() => current}>
          <ChatPanel {...SCOPE_PROPS} lang="en-US" ai={AI} dispatcher={makeDispatcher()} projectId="p1" />
        </Source>
      </AiPrivacyProvider>,
    );

    send("Is Alice Anderson free next week?");
    expect(await screen.findByText("Reply 1.")).toBeTruthy();
    // The control: allowed, the first send carries the people tools and the name as typed.
    expect(toolNames(bodies[0]!)).toContain("list_resources");
    expect(bodies[0]).toContain("Alice Anderson");

    current = protectedWs(current); // the user switches protection on, same thread
    send("And the week after?");
    expect(await screen.findByText("Reply 2.")).toBeTruthy();
    expect(bodies).toHaveLength(2);
    expect(toolNames(bodies[1]!).filter((n) => PEOPLE_TOOLS.has(n))).toEqual([]);
    expect(toolNames(bodies[1]!).length).toBeGreaterThan(0);
    // The earlier user turn rides in the history, and it goes out redacted.
    expect(bodies[1]).not.toContain("Alice Anderson");
    expect(bodies[1]).toContain("[Person 1]");
  });
});

// ---------------------------------------------------------------------------
// Plan with AI and RACI suggestions: hidden, and unreachable another way.
// ---------------------------------------------------------------------------

function AllocHarness() {
  const alloc = useAllocPlan({
    settings: AI_SETTINGS, isPopout: false, lang: "en-US", resources: [RESOURCE], setResources: () => undefined,
    roles: [], disciplines: [], grades: [], plan: PLAN, absences: [], workdayHours: 8, holidaySet: new Set<string>(),
    tasks: [], milestones: [], stakeholders: [], today: "2026-08-01", reassignTasks: () => 0, isLoadHeld: () => false,
  });
  return <div>{alloc.button}{alloc.modal}</div>;
}

function RaciHarness() {
  const suggest = useRaciSuggest({
    settings: AI_SETTINGS, isPopout: false, lang: "en-US", stakeholders: [ALICE], milestones: MILESTONES, onSave: () => undefined,
  });
  return <div>{suggest.button}{suggest.modal}</div>;
}

/** Renders `children` under a privacy source the test can flip with the returned function. */
function renderWithSource(start: Workspace, children: ReactNode): (next: Workspace) => void {
  const tree = (ws: Workspace) => (
    <ToastProvider value={toast}>
      <AiPrivacyProvider>
        <Source ws={() => ws}>{children}</Source>
      </AiPrivacyProvider>
    </ToastProvider>
  );
  const { rerender } = render(tree(start));
  return (next) => act(() => rerender(tree(next)));
}

describe("Plan with AI and RACI suggestions under protection", () => {
  it("the Plan with AI trigger is absent when protected", () => {
    renderWithSource(protectedWs(base()), <AllocHarness />);
    expect(screen.queryByRole("button", { name: /plan with ai/i })).toBeNull();
  });

  it("an open Plan with AI window closes and cannot be reopened once protection is on", () => {
    const flip = renderWithSource(allowed(base()), <AllocHarness />);
    fireEvent.click(screen.getByRole("button", { name: /plan with ai/i }));
    expect(screen.getByPlaceholderText(/distribute 200 hours/i)).toBeTruthy();
    flip(protectedWs(base()));
    expect(screen.queryByPlaceholderText(/distribute 200 hours/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /plan with ai/i })).toBeNull();
  });

  // Review 3, R6: protection turning on RESETS the window, not just hides it, so a stale proposal cannot come back
  // when protection is turned off again.
  it("an open Plan with AI window does not come back when protection is turned off again", () => {
    const flip = renderWithSource(allowed(base()), <AllocHarness />);
    fireEvent.click(screen.getByRole("button", { name: /plan with ai/i }));
    expect(screen.getByPlaceholderText(/distribute 200 hours/i)).toBeTruthy();
    flip(protectedWs(base()));
    flip(allowed(base()));
    expect(screen.queryByPlaceholderText(/distribute 200 hours/i)).toBeNull();
    expect(screen.getByRole("button", { name: /plan with ai/i })).toBeTruthy();
  });

  it("a RACI preview does not come back when protection is turned off again", async () => {
    const flip = renderWithSource(allowed(base()), <RaciHarness />);
    fireEvent.click(screen.getByRole("button", { name: /suggest raci/i }));
    expect(await screen.findByRole("dialog")).toBeTruthy();
    flip(protectedWs(base()));
    expect(screen.queryByRole("dialog")).toBeNull();
    flip(allowed(base()));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: /suggest raci/i })).toBeTruthy();
  });

  it("the RACI suggestion trigger is absent when protected and present when allowed", () => {
    const flip = renderWithSource(allowed(base()), <RaciHarness />);
    expect(screen.getByRole("button", { name: /suggest raci/i })).toBeTruthy();
    flip(protectedWs(base()));
    expect(screen.queryByRole("button", { name: /suggest raci/i })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Dictation (P9): off, and the control says why.
// ---------------------------------------------------------------------------

function MicHarness() {
  const { mic } = useDictationMic({
    lang: "en-US", dictation: undefined, aiConsented: true, label: "Notes", onAppendFinal: () => undefined,
  });
  return <div data-testid="mic-slot">{mic}</div>;
}

describe("dictation under protection", () => {
  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).webkitSpeechRecognition;
  });

  it("replaces the mic with a compact marker whose tooltip gives the reason, and shows the mic when allowed", () => {
    (window as unknown as Record<string, unknown>).webkitSpeechRecognition = class {};
    const flip = renderWithSource(allowed(base()), <MicHarness />);
    expect(screen.getByRole("button", { name: /hold to dictate/i })).toBeTruthy();
    flip(protectedWs(base()));
    expect(screen.queryByRole("button", { name: /hold to dictate/i })).toBeNull();
    const off = screen.getByTestId("mic-slot").querySelector("[data-dictation-off]");
    expect(off?.getAttribute("title")).toBe(t("en-US", "dictationUnavailablePeopleProtected"));
    // Review rounds 1–2 (I2): no VISIBLE text — the reason rides only in a hidden element a field names in its
    // aria-describedby, so it adds nothing to a surrounding label's name.
    const carrier = screen.getByTestId("mic-slot").querySelector("[hidden]");
    expect(carrier?.textContent).toBe(t("en-US", "dictationUnavailablePeopleProtected"));
    expect(screen.getByTestId("mic-slot").textContent).toBe(carrier?.textContent);
  });
});

// ---------------------------------------------------------------------------
// Context builders drop their people sections.
// ---------------------------------------------------------------------------

describe("context builders under protection", () => {
  const recommendInput = {
    projectName: "P", today: "2026-10-30", insightType: "stalledWork", severity: "high", data: {},
    relatedTasks: [], people: ["Alice Anderson"],
  };

  it("the insight recommendation context has no People section", () => {
    expect(buildRecommendContext(recommendInput)).toContain("## People");
    const prot = buildRecommendContext({ ...recommendInput, peopleProtected: true });
    expect(prot).not.toContain("People");
    expect(prot).not.toContain("Alice Anderson");
  });

  it("the next-actions analysis context has no Stakeholders section", () => {
    const input = {
      projectName: "P", today: "2026-10-30", mode: "advanced", enabledModules: [], taskCount: 0,
      tasks: [], raid: [], milestones: [], changes: [], stakeholders: [{ id: 1, name: "Alice Anderson" }], queue: [],
    };
    expect(buildAnalysisContext(input)).toContain("Alice Anderson");
    const prot = buildAnalysisContext({ ...input, peopleProtected: true });
    expect(prot).not.toContain("## Stakeholders");
    expect(prot).not.toContain("Alice Anderson");
  });

  it("the project digest (Analyze with AI and scheduled jobs) reads the TARGET project's setting", () => {
    const digestOf = (ws: Workspace) =>
      buildProjectDigest(buildProjectAnalysisInput({ workspace: ws, deviceSettings: defaultSettings, lang: "en-US", now: new Date("2026-10-30T12:00:00Z"), queue: [] }).digestInput);
    expect(digestOf(allowed(base()))).toContain("Alice Anderson");
    const prot = digestOf(protectedWs(base()));
    expect(prot).not.toContain("## Stakeholders");
    expect(prot).not.toContain("Alice Anderson");
  });

  // Review round 1 (I5): the scheduled-job path passes NO queue, so the queue is DERIVED from the target
  // workspace — workload alerts included. Protected, no workload signal reaches the digest.
  it("a scheduled job's derived queue carries no workload signal for a protected target", () => {
    const tasks = [1, 2, 3, 4].map((id) => ({
      id, taskName: `Overdue ${id}`, assignee: "Alice Anderson", assigneeEmail: "", resourceId: 1, dueDate: "2026-01-0" + id,
      lastUpdateDate: "2026-01-01", priority: "High", status: "To Do", blockers: "", notes: "",
    })) as unknown as Workspace["tasks"];
    const target = (ws: Workspace): Workspace => ({ ...ws, resources: [RESOURCE], tasks, plan: PLAN });
    const digestOf = (ws: Workspace) =>
      buildProjectDigest(buildProjectAnalysisInput({ workspace: ws, deviceSettings: defaultSettings, lang: "en-US", now: new Date("2026-10-30T12:00:00Z") }).digestInput);
    const why = t("en-US", "actionWorkloadWhyOverload", 4);
    // The control: allowed, the derived queue names the overloaded person.
    expect(digestOf(target(allowed(base())))).toContain(why);
    expect(digestOf(target(protectedWs(base())))).not.toContain(why);
  });
});
