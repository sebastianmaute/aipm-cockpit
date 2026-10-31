import "fake-indexeddb/auto";
// AI people protection, Layer 3 — proof on the wire (spec "Layer 3", R2, R4, P8).
//
// Every row of `AI_DATA_PATHS` is driven through its feature's REAL request builder and call function, over the
// REAL transport, with only `fetch` stubbed; every request body is captured. With protection on, no name, email or
// phone of the fictional project (`src/test/people-protection-fixture.ts`) may appear in any body (compared
// case-insensitively, diacritics folded). The privacy is the real one: `aiPrivacyFor` over the fixture, or for the
// features that read it themselves, the real `AiPrivacyProvider` with the fixture registered as the open project.
//
// ★★ THE DRIVER TABLE IS KEYED BY ROW ID. A new `AI_DATA_PATHS` row without a driver fails `every row has a driver`
//    with its id, and a driver's kind must match the row's `whenProtected`, so a reclassified row is red too.
// ★★ ANTI-VACUITY: the same drivers with protection OFF must send at least one fixture person, for every row that
//    sends people today (`sendsPeople: true`). A row that legitimately sends none says why in its driver.
import { renderHook, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AI_DATA_PATHS, type AiProtectedState } from "./ai-disclosure";
import { aiPrivacyFor, type AiPrivacy } from "./ai-privacy";
import { isPeopleProtected } from "./ai-people-protection";
import { newConsent, publishAiConsentState, publishBackgroundCapState } from "./ai-consent";
import { setDisabledIntegrations } from "./integration-switches";
import { PERSON_FIELD_PATHS } from "./ai-people-dictionary";
import { defaultAiConfig, defaultSettings, resolveNextActionsConfig, type Settings } from "./settings-types";
import type { Workspace } from "./workspace";
import type { TursoConfig } from "./turso-config";
import { runMeetingReport } from "./committee-report/report-call";
import { buildDigest } from "./digest/digest-model";
import { runDigestNarrative } from "./digest/digest-narrative";
import { runForecastImportCall } from "./forecast-import-call";
import { callInlineEdit } from "./inline-ai-edit-call";
import { buildRecommendContext, recommendPeople } from "./insights/recommend-context";
import { runInsightRecommendation } from "./insights/recommend-call";
import { buildAnalysisContext, buildGroundingIndex } from "./action-ai";
import { buildProjectAnalysisInput } from "./project-analysis-input";
import { buildProjectDigest } from "./project-digest";
import { runJobAnalysis } from "./scheduled-job-analysis";
import { buildSuggestionContext } from "./weight-suggestion-ai";
import { runWeightSuggestion } from "./weight-suggestion-call";
import { buildDedupContext } from "./task-dedup/dedup";
import { runDedupProposal } from "./task-dedup-call";
import { buildWbsContext } from "./wbs-plan/wbs-plan";
import { runWbsProposal } from "./wbs-plan-call";
import { buildAllocContext } from "./alloc-plan/alloc-plan";
import { runAllocProposal } from "./alloc-plan-call";
import { buildRaciContext } from "./raci-suggest/raci-suggest";
import { runRaciSuggestion } from "./raci-suggest-call";
import { useProjectProposal } from "./use-project-proposal";
import { runScheduledJob } from "./scheduled-job-run";
import { resourceDisplayName } from "./resource-foundation";
import type { ScheduledJob } from "./scheduled-jobs/types";
import {
  FIXTURE_INSIGHT, FIXTURE_PEOPLE_TERMS, FIXTURE_PHONE, FIXTURE_PHONES, KNOWN_EMAILS, FIXTURE_PROJECT_KEY, FIXTURE_TODAY, FORMER_MEMBER, LOWERCASE_PEOPLE, MAIL_EML,
  MAIL_PERSON, RESOURCE_ID, RESOURCE_NAME_TOKENS, SEEDED_PERSON_FIELDS, STAKEHOLDER_ID, TASK_ID, UNKNOWN_PHONE, VARIANT_SPELLINGS,
  peopleFixture,
} from "../test/people-protection-fixture";
import { dashboardOf, peopleFeatureOffered, renderChat, type PeopleFeature } from "../test/people-protection-harness";

vi.mock("./chat-threads-store", () => ({
  loadThreads: vi.fn(async () => []),
  saveThread: vi.fn(async () => undefined),
  deleteThread: vi.fn(async () => undefined),
}));
vi.mock("./scheduled-reports-store", () => ({
  hasReportAtOrAfter: vi.fn(async () => false),
  claimReport: vi.fn(async () => true),
  releaseClaim: vi.fn(async () => undefined),
  finishReport: vi.fn(async () => undefined),
}));

// ---------------------------------------------------------------------------------------------------------------
// The wire: every Messages request body, and a scripted reply.
// ---------------------------------------------------------------------------------------------------------------

type Body = { messages: { role: string; content: unknown }[]; tools?: { name: string }[]; tool_choice?: { name?: string } };
type Reply = (body: Body) => unknown;

const USAGE = { input_tokens: 1, output_tokens: 1 };
const sent: string[] = [];
let script: Reply[] = [];

const toolUse = (calls: readonly { name: string; input: Record<string, unknown> }[]) => ({
  content: calls.map((c, i) => ({ type: "tool_use", id: `tu_${sent.length}_${i}`, name: c.name, input: c.input })),
  stop_reason: "tool_use",
  usage: USAGE,
});
const text = (t: string) => ({ content: [{ type: "text", text: t }], stop_reason: "end_turn", usage: USAGE });

/** A forced call gets its forced tool with an empty input (the caller's parse refuses it, after the send); any
 *  other call gets a closing text. The body is what this test is about, not the reply. */
function genericReply(body: Body): unknown {
  const forced = body.tool_choice?.name ?? (body.tools?.length === 1 ? body.tools[0]!.name : undefined);
  return forced ? toolUse([{ name: forced, input: {} }]) : text("Done.");
}

beforeAll(() => publishBackgroundCapState(false));
beforeEach(() => {
  // Published per test: a rendered chat's settings hook republishes the stored consent, and that module state
  // outlives the test that rendered it.
  publishAiConsentState(aiSettings().ai);
  sent.length = 0;
  script = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: unknown, init?: RequestInit) => {
    const raw = String(init?.body ?? "");
    sent.push(raw);
    const body = JSON.parse(raw) as Body;
    const reply = (script.shift() ?? genericReply)(body);
    return new Response(JSON.stringify(reply), { status: 200 });
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  setDisabledIntegrations([]);
});

// ---------------------------------------------------------------------------------------------------------------
// The check: fixture people in the captured bodies.
// ---------------------------------------------------------------------------------------------------------------

// Two folds, and a term counts when EITHER finds it (review 4, I1): the redactor's own (NFC first, ä/ö/ü -> ae/oe/ue,
// ß -> ss, apostrophe variants -> '), so a leak spelled "Brandtmueller" or written in NFD is seen; and marks stripped
// (ü -> u), so a leak whose marks were dropped is seen too.
const APOSTROPHES = /[’‘ʼ′]/g;
const UMLAUT_FOLD: Readonly<Record<string, string>> = { ä: "ae", ö: "oe", ü: "ue", ß: "ss" };
const stripMarks = (s: string): string => s.normalize("NFD").replace(/\p{M}/gu, "");
const FOLDS: readonly ((s: string) => string)[] = [
  (s) => stripMarks(s.normalize("NFC").toLowerCase().replace(/[äöüß]/g, (c) => UMLAUT_FOLD[c]!)).replace(APOSTROPHES, "'"),
  (s) => stripMarks(s).toLowerCase().replace(APOSTROPHES, "'"),
];
const digitsOf = (s: string): string => s.replace(/[^\d+]/g, "");

/** The fixture terms found in `bodies`: full names and emails folded, the phone also with its spacing ignored, and
 *  the resource's two name tokens as written (see `RESOURCE_NAME_TOKENS`). */
function peopleIn(bodies: readonly string[]): string[] {
  const raw = bodies.join("\n");
  const hays = FOLDS.map((fold) => fold(raw));
  const hayDigits = digitsOf(hays[1]!);
  return [
    ...FIXTURE_PEOPLE_TERMS.filter((term) =>
      FOLDS.some((fold, i) => hays[i]!.includes(fold(term))) || (FIXTURE_PHONES.includes(term) && hayDigits.includes(digitsOf(term)))),
    ...RESOURCE_NAME_TOKENS.filter((token) => new RegExp(`\\b${token}\\b`).test(raw)),
  ];
}

// ---------------------------------------------------------------------------------------------------------------
// The drivers, one per AI_DATA_PATHS row.
// ---------------------------------------------------------------------------------------------------------------

const KEY = "sk-ant-wire-test";
const MODEL = "claude-wire";
const NOW = new Date(`${FIXTURE_TODAY}T09:00:00.000Z`);

function aiSettings(): Settings {
  return {
    ...defaultSettings,
    ai: { ...defaultAiConfig, enabled: true, consent: newConsent(new Date(0)), backgroundConsent: newConsent(new Date(0)), apiKey: KEY, model: MODEL },
  };
}

interface Ctx {
  ws: Workspace;
  /** What the feature's hook would hand its call: the privacy of the open (or target) project. */
  privacy: AiPrivacy;
  /** What the feature's context builder reads at build time (`useOpenProjectPeopleProtected`). */
  peopleProtected: boolean;
}

function ctxFor(ws: Workspace): Ctx {
  return {
    ws,
    privacy: aiPrivacyFor([{ key: FIXTURE_PROJECT_KEY, ws }]),
    peopleProtected: isPeopleProtected(ws.settingsOverrides),
  };
}

/** Awaits a call whose reply the stub cannot satisfy (the generic reply's empty tool input): the send happened,
 *  the parse refused it. Any OTHER failure is re-thrown, so a driver that never reached the wire is not silent. */
/** What a call function throws when it refuses the stub's empty reply, after sending. */
const AFTER_SEND_REFUSALS: ReadonlySet<string> = new Set(["parse", "bad-mapping"]);

async function sendAndIgnoreParse(run: () => Promise<unknown>): Promise<void> {
  try {
    await run();
  } catch (e) {
    if (e instanceof Error && AFTER_SEND_REFUSALS.has(e.message)) return;
    throw e;
  }
}

type SendDriver = {
  kind: "redacted";
  run: (c: Ctx) => Promise<void>;
  /** True when the path sends people with protection OFF; otherwise the reason it sends none. */
  sendsPeople: true | string;
};
type HiddenDriver = {
  kind: "hidden" | "off";
  feature: PeopleFeature;
  /** The send that is hidden (protection off), for the anti-vacuity check; null when it sends no text. */
  run: ((c: Ctx) => Promise<void>) | null;
  sendsPeople: true | string;
};
type Driver = SendDriver | HiddenDriver;

const AGENDA = `1. Licence keys: ${MAIL_PERSON} to report. 2. Data centre change.`;

// The chat: an .eml naming a known person is attached, and the model calls EVERY read tool, people tools included
// (`search_history` among them). Their results ride in the second request.
const READ_INPUTS: Readonly<Record<string, Record<string, unknown>>> = {
  get_task: { id: TASK_ID }, get_resource: { id: RESOURCE_ID }, get_document: { id: 1 },
  get_contact_email: { kind: "stakeholder", id: STAKEHOLDER_ID }, search_chats: { query: "staging" },
  search_history: { query: "staging" },
};
const READ_TOOLS = [
  "get_app_state", "get_contact_email", "get_dashboard_snapshot", "get_document", "get_forecast", "get_project",
  "get_resource", "get_task", "list_absences", "list_allocations", "list_budget_buckets", "list_calendar_events",
  "list_changes", "list_documents", "list_knowledge_items", "list_milestones", "list_raid", "list_resources",
  "list_stakeholders", "list_tasks", "search_chats", "search_history",
];
const hasToolResult = (body: Body): boolean => {
  const last = body.messages[body.messages.length - 1];
  return Array.isArray(last?.content) && (last.content as { type: string }[]).some((b) => b.type === "tool_result");
};

/** Type `prompt`, press Send until the chat takes it (a send that is still finishing ignores the press, and the
 *  box keeps its text), then wait for the scripted closing reply. */
async function sendChat(prompt: string, doneText: string): Promise<void> {
  const box = screen.getByPlaceholderText("Ask Claude about your tasks…") as HTMLTextAreaElement;
  fireEvent.change(box, { target: { value: prompt } });
  await waitFor(() => {
    if (box.value === "") return;
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    throw new Error("the chat has not taken the prompt yet");
  });
  try {
    await screen.findByText(doneText, undefined, { timeout: 8000 });
  } catch (e) {
    throw new Error(`chat never showed "${doneText}" after ${sent.length} request(s)`, { cause: e });
  }
}

async function driveChat(c: Ctx): Promise<void> {
  const { container } = renderChat(c.ws, aiSettings());
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  await userEvent.upload(input, new File([MAIL_EML], "licence.eml", { type: "message/rfc822" }));
  await screen.findByText("licence.eml");
  script = [
    (body) => (hasToolResult(body) ? text("Done.") : toolUse(READ_TOOLS.map((name) => ({ name, input: READ_INPUTS[name] ?? {} })))),
    () => text("Done."),
  ];
  await sendChat("Summarise the mail and the state of the project.", "Done.");
  expect(sent.length).toBeGreaterThanOrEqual(2); // the tool results went out in a second request
}

function insightContext(c: Ctx): string {
  const { ws } = c;
  return buildRecommendContext({
    peopleProtected: c.peopleProtected, projectName: ws.project?.name ?? "", today: FIXTURE_TODAY,
    insightType: FIXTURE_INSIGHT.type, severity: FIXTURE_INSIGHT.severity, data: FIXTURE_INSIGHT.data,
    relatedTasks: ws.tasks.map((t) => ({ id: t.id, title: t.taskName })),
    people: recommendPeople(ws.resources.map(resourceDisplayName), ws.tasks.map((t) => t.assignee), []),
  });
}
const groundingOf = (ws: Workspace) =>
  buildGroundingIndex({ tasks: ws.tasks, raid: ws.raid, milestones: ws.milestones ?? [], changes: ws.changes ?? [], stakeholders: ws.stakeholders ?? [] });
const SHEET = {
  name: "Forecast", truncated: false,
  rows: [["Person", "Role", "2026-11"], ["Rosalind Quenby", "Engineer", "80"], [MAIL_PERSON, "Sponsor", "4"]],
};

const JOB: ScheduledJob = {
  id: 1, name: "Daily", type: "portfolioAnalysis", cadence: { kind: "daily", timeOfDay: "09:00" }, enabled: true,
  projectId: FIXTURE_PROJECT_KEY, timeZone: "UTC", key: "job-key", lastRunAt: null, history: [],
  instruction: `Check what ${MAIL_PERSON} still owes the steering committee.`,
};

const DRIVERS: Readonly<Record<string, Driver>> = {
  chat: { kind: "redacted", run: driveChat, sendsPeople: true },
  "inline-edit": {
    kind: "redacted", sendsPeople: true,
    run: async (c) => {
      const task = c.ws.tasks[0]!;
      await callInlineEdit({
        apiKey: KEY, model: MODEL, privacy: c.privacy, lang: "en-US", entity: "task",
        item: task as unknown as Record<string, unknown>, itemLabel: task.taskName,
        instruction: `Make this urgent and mention ${MAIL_PERSON} in the description.`,
        snapshot: {
          today: FIXTURE_TODAY, language: "en-US", holidayCountries: [], storageKind: "memory", taskCount: c.ws.tasks.length,
          knownGroups: ["Platform"], knownLabels: [], mode: "advanced", enabledModules: [], currentView: "open-points",
        } as unknown as Parameters<typeof callInlineEdit>[0]["snapshot"],
        guides: [], groundInGuides: false,
      });
    },
  },
  "committee-report": {
    kind: "redacted", sendsPeople: true,
    run: (c) => sendAndIgnoreParse(() => runMeetingReport(dashboardOf(c.ws), AGENDA, { apiKey: KEY, model: MODEL, privacy: c.privacy, lang: "en-US" })),
  },
  "digest-narrative": {
    kind: "redacted",
    // Its only text is milestone names; the fixture's overdue milestone names the sponsor in free text.
    sendsPeople: true,
    run: (c) => sendAndIgnoreParse(() => runDigestNarrative(
      buildDigest({ model: dashboardOf(c.ws), raid: [...c.ws.raid], prior: null }, NOW.toISOString()),
      { apiKey: KEY, model: MODEL, privacy: c.privacy, lang: "en-US" },
    )),
  },
  "digest-narrative-scheduled": {
    kind: "redacted",
    sendsPeople: true,
    run: (c) => sendAndIgnoreParse(() => runDigestNarrative(
      buildDigest({ model: dashboardOf(c.ws), raid: [...c.ws.raid], prior: null }, NOW.toISOString()),
      { apiKey: KEY, model: MODEL, privacy: c.privacy, lang: "en-US", level: "background" },
    )),
  },
  "forecast-import": {
    kind: "redacted", sendsPeople: true,
    run: (c) => sendAndIgnoreParse(() => runForecastImportCall(SHEET, { apiKey: KEY, model: MODEL, privacy: c.privacy })),
  },
  "insight-recommendation": {
    kind: "redacted", sendsPeople: true,
    run: (c) => sendAndIgnoreParse(() => runInsightRecommendation({
      apiKey: KEY, model: MODEL, privacy: c.privacy, context: insightContext(c), index: groundingOf(c.ws), today: FIXTURE_TODAY,
    })),
  },
  "insight-recommendation-auto": {
    kind: "redacted", sendsPeople: true,
    run: (c) => sendAndIgnoreParse(() => runInsightRecommendation({
      apiKey: KEY, model: MODEL, privacy: c.privacy, context: insightContext(c), index: groundingOf(c.ws), today: FIXTURE_TODAY,
      cacheGuides: true, level: "background",
    })),
  },
  "action-analysis": {
    kind: "redacted", sendsPeople: true,
    run: (c) => {
      const { digestInput } = buildProjectAnalysisInput({ workspace: c.ws, deviceSettings: aiSettings(), lang: "en-US", now: NOW });
      return sendAndIgnoreParse(() => runJobAnalysis(buildProjectDigest(digestInput), { apiKey: KEY, model: MODEL, privacy: c.privacy }));
    },
  },
  "weight-suggestion": {
    kind: "redacted", sendsPeople: true,
    run: (c) => {
      const { ws } = c;
      const current = resolveNextActionsConfig(undefined);
      const context = buildSuggestionContext({
        workspaceDigest: buildAnalysisContext({
          peopleProtected: c.peopleProtected, projectName: ws.project?.name ?? "", today: FIXTURE_TODAY, mode: "advanced",
          enabledModules: [], taskCount: ws.tasks.length, tasks: ws.tasks.map((x) => ({ id: x.id, title: x.taskName })),
          raid: ws.raid.map((x) => ({ id: x.id, title: x.title })), milestones: (ws.milestones ?? []).map((x) => ({ id: x.id, title: x.name })),
          changes: (ws.changes ?? []).map((x) => ({ id: x.id, title: x.title })),
          stakeholders: (ws.stakeholders ?? []).map((x) => ({ id: x.id, name: x.name })), queue: [],
        }),
        current, scope: "weights", learning: "(no history)", trends: "(no snapshots)", learningEnabled: true,
      });
      return sendAndIgnoreParse(() => runWeightSuggestion(context, { apiKey: KEY, model: MODEL, privacy: c.privacy }, current, "weights"));
    },
  },
  "task-dedup": {
    kind: "redacted", sendsPeople: true,
    run: (c) => sendAndIgnoreParse(() => runDedupProposal(buildDedupContext(c.ws.tasks), { apiKey: KEY, model: MODEL, privacy: c.privacy })),
  },
  "wbs-plan": {
    kind: "redacted", sendsPeople: true,
    run: (c) => sendAndIgnoreParse(() => runWbsProposal(
      buildWbsContext({ tasks: c.ws.tasks, scopeIds: new Set(c.ws.tasks.map((t) => t.id)), milestones: c.ws.milestones ?? [], project: c.ws.project }),
      { apiKey: KEY, model: MODEL, privacy: c.privacy },
      `Split the platform work; ${MAIL_PERSON} wants a review step.`,
    )),
  },
  "scheduled-job": {
    kind: "redacted", sendsPeople: true,
    // The REAL run builds the TARGET project's digest and privacy itself (`aiPrivacyFor` over the loaded
    // workspace); `c.privacy` is not used, so the setting under test is the stored one.
    run: async (c) => {
      await runScheduledJob(JOB, NOW, {
        config: { httpUrl: "https://wire.example.test", authToken: "t" } as TursoConfig,
        listProjects: async () => ({ active: [{ id: FIXTURE_PROJECT_KEY, name: "Project Lighthouse" }], archived: [] }),
        stillRunnable: () => true, confirmDeployment: async () => undefined, confirmBackgroundGate: () => undefined,
        loadWorkspace: async () => c.ws,
        analyse: (context, privacy) => runJobAnalysis(context, { apiKey: KEY, model: MODEL, privacy, cacheGuides: true, level: "background" }),
        deviceSettings: aiSettings(), lang: "en-US", now: () => NOW, newId: () => "report-1", deviceLabel: "wire",
        clearProject: async () => undefined, disableJob: async () => undefined, recordRun: async () => undefined, notify: () => undefined,
      });
      expect(sent.length).toBeGreaterThan(0);
    },
  },
  "alloc-plan": {
    kind: "hidden", feature: "alloc-plan", sendsPeople: true,
    run: (c) => sendAndIgnoreParse(() => runAllocProposal(
      buildAllocContext({
        resources: c.ws.resources, roles: c.ws.roles, disciplines: c.ws.disciplines, grades: c.ws.grades, plan: c.ws.plan,
        absences: c.ws.absences, workdayHours: 8, holidaySet: new Set<string>(), tasks: c.ws.tasks, milestones: c.ws.milestones ?? [],
        stakeholders: c.ws.stakeholders ?? [], instruction: "Plan November.", today: FIXTURE_TODAY,
      }),
      { apiKey: KEY, model: MODEL, privacy: c.privacy }, "Plan November.",
    )),
  },
  "raci-suggest": {
    kind: "hidden", feature: "raci-suggest", sendsPeople: true,
    run: (c) => sendAndIgnoreParse(() => runRaciSuggestion(buildRaciContext(c.ws.stakeholders ?? [], c.ws.milestones ?? []), { apiKey: KEY, model: MODEL, privacy: c.privacy })),
  },
  dictation: {
    kind: "off", feature: "dictation", run: null,
    sendsPeople: "it sends audio to the speech service, never a request body this test can read; protection switches it off",
  },
  "project-proposal": {
    kind: "redacted",
    // Review 3, R3: the wizard ALWAYS sends through a session over an empty dictionary, whatever the setting.
    sendsPeople: "a new project has no workspace, so no fixture person is in it; the brief's email address and phone are pattern-redacted even with protection off (names cannot be, so the brief names none)",
    run: async () => { await generateProposal(); },
  },
};

/** The create-project wizard over the wire: a brief carrying a fixture email address and an unknown phone, and a
 *  scripted proposal full of people. */
async function generateProposal(): Promise<unknown> {
  script = [() => toolUse([{
    name: "propose_project",
    input: {
      meta: { name: "Warehouse platform", sponsor: "Sébastien Oakenfold", projectManager: "Philippa Underhay", customer: "Acme" },
      features: [],
      seed: {
        tasks: [{ taskName: "Kick-off", dueDate: "2026-11-05", assignee: "Tobias Kranewitter" }],
        raid: [{ title: "Vendor late", category: "R", owner: "Ottilie Marchbanks", ownerEmail: "o.marchbanks@example.test" }],
        stakeholders: [{ name: MAIL_PERSON, title: "Sponsor" }],
        resources: [{ firstName: "Rosalind", lastName: "Quenby" }],
        milestones: [{ name: "Go-live", date: "2026-12-01" }],
      },
    },
  }])];
  const { result } = renderHook(() => useProjectProposal({ apiKey: KEY, model: MODEL, timeZone: "UTC" }));
  return result.current.generate(`Plan a warehouse platform rollout for Acme. Questions to ${KNOWN_EMAILS[0]} or ${UNKNOWN_PHONE}.`);
}

const KIND_OF: Readonly<Record<AiProtectedState, Driver["kind"]>> = {
  redacted: "redacted", hidden: "hidden", off: "off",
};

// ---------------------------------------------------------------------------------------------------------------
// The tests.
// ---------------------------------------------------------------------------------------------------------------

describe("the wire-test fixture", () => {
  it("seeds a fictional person in every person field the dictionary reads (R2)", () => {
    expect(Object.keys(SEEDED_PERSON_FIELDS).sort()).toEqual([...PERSON_FIELD_PATHS].sort());
  });
});

describe("every AI path is driven", () => {
  it("every row has a driver whose kind matches the row's protected state", () => {
    const missing = AI_DATA_PATHS.filter((r) => !(r.id in DRIVERS)).map((r) => r.id);
    expect(missing, "rows without a driver").toEqual([]);
    const stale = Object.keys(DRIVERS).filter((id) => !AI_DATA_PATHS.some((r) => r.id === id));
    expect(stale, "drivers without a row").toEqual([]);
    const mismatched = AI_DATA_PATHS.filter((r) => DRIVERS[r.id]!.kind !== KIND_OF[r.whenProtected]).map((r) => r.id);
    expect(mismatched, "driver kind differs from whenProtected").toEqual([]);
  });
});

const ROWS = AI_DATA_PATHS.map((r) => [r.id, DRIVERS[r.id]] as const);
const SENDING = ROWS.filter((r): r is readonly [string, SendDriver] => r[1]?.kind === "redacted");
const HIDDEN = ROWS.filter((r): r is readonly [string, HiddenDriver] => r[1]?.kind === "hidden" || r[1]?.kind === "off");

describe("with protection on, no fixture person reaches a request body", () => {
  it.each(SENDING)("%s", async (_id, driver) => {
    await driver.run(ctxFor(peopleFixture(false)));
    expect(sent.length, "the path sent nothing").toBeGreaterThan(0);
    expect(peopleIn(sent)).toEqual([]);
  });

  it.each(HIDDEN)("%s is not offered", (_id, driver) => {
    expect(peopleFeatureOffered(driver.feature, peopleFixture(false), aiSettings())).toBe(false);
    expect(sent).toEqual([]);
  });

  it("project-proposal: sends no workspace, pattern-redacts its brief, and applies its result without people", async () => {
    const proposal = (await generateProposal()) as { meta: Record<string, unknown>; seed?: Record<string, unknown> } | null;
    expect(sent).toHaveLength(1);
    expect(peopleIn(sent)).toEqual([]); // no Workspace is passed, and the brief's email and phone are redacted
    expect(sent[0]).toContain("[email 1]");
    expect(sent[0]).toContain("[phone 1]");
    expect(proposal).not.toBeNull();
    expect(proposal!.meta).not.toHaveProperty("sponsor");
    expect(proposal!.meta).not.toHaveProperty("projectManager");
    expect(proposal!.seed?.stakeholders).toBeUndefined();
    expect(proposal!.seed?.resources).toBeUndefined();
    expect(JSON.stringify(proposal)).not.toMatch(/Kranewitter|Marchbanks|marchbanks/);
  });
});

describe("anti-vacuity: with protection off, the same drivers send people", () => {
  it.each(SENDING)("%s", async (_id, driver) => {
    await driver.run(ctxFor(peopleFixture(true)));
    expect(sent.length).toBeGreaterThan(0);
    if (driver.sendsPeople === true) expect(peopleIn(sent).length).toBeGreaterThan(0);
    else expect(peopleIn(sent)).toEqual([]);
  });

  it.each(HIDDEN)("%s is offered, and sends people", async (_id, driver) => {
    expect(peopleFeatureOffered(driver.feature, peopleFixture(true), aiSettings())).toBe(true);
    if (driver.run) {
      await driver.run(ctxFor(peopleFixture(true)));
      expect(peopleIn(sent).length).toBeGreaterThan(0);
    }
  });

  it("chat: the former member reaches the wire only through search_history", async () => {
    await driveChat(ctxFor(peopleFixture(true)));
    expect(peopleIn(sent)).toContain(FORMER_MEMBER);
    expect(peopleIn(sent)).toContain(MAIL_PERSON);
  });

  // Review 3, R1: the lower-case one-word assignee and user-id owner ride in list_tasks / list_raid. With protection
  // on, the generic check above already demands none of them; this pins that they DO reach the wire unprotected.
  it.each([["allowed", true], ["protected", false]] as const)("chat, %s: the lower-case one-word people", async (_mode, allowed) => {
    await driveChat(ctxFor(peopleFixture(allowed)));
    const found = peopleIn(sent).filter((t) => LOWERCASE_PEOPLE.includes(t));
    expect(found).toEqual(allowed ? [...LOWERCASE_PEOPLE] : []);
  });

  // Review 4, I1: a genitive, an NFD spelling and a straight apostrophe for a curly-stored name ride in task 1's
  // description. Each one's LAST word is checked byte for byte (a first name redacted alone would hide a whole-variant
  // check while the surname leaks): present when people are allowed, absent when protected.
  it.each([["allowed", true], ["protected", false]] as const)("chat, %s: the variant spellings of known names", async (_mode, allowed) => {
    await driveChat(ctxFor(peopleFixture(allowed)));
    const raw = sent.join("\n");
    const surnames = VARIANT_SPELLINGS.map((v) => v.split(" ").at(-1)!);
    expect(surnames).toHaveLength(3);
    expect(surnames.filter((v) => raw.includes(v))).toEqual(allowed ? surnames : []);
  });

  // The phone half of the check: both phones ride in a task description that get_task / list_tasks return, the
  // known one (matched from the dictionary) and one the project does not know (matched by the phone pattern).
  it.each([["allowed", true], ["protected", false]] as const)("chat, %s: the task description's phones", async (_mode, allowed) => {
    await driveChat(ctxFor(peopleFixture(allowed)));
    const phones = peopleIn(sent).filter((t) => t === FIXTURE_PHONE || t === UNKNOWN_PHONE);
    expect(phones).toEqual(allowed ? [FIXTURE_PHONE, UNKNOWN_PHONE] : []);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Refused writes (spec Layer 3, second test; R4): a chat reply that acts on a person applies nothing person-related.
// ---------------------------------------------------------------------------------------------------------------

/** The `expectedToken` of row `id` in the last request's tool results, or "none". */
function tokenFor(body: Body, id: number): string {
  const last = body.messages[body.messages.length - 1];
  const blocks = Array.isArray(last?.content) ? (last.content as { type: string; content?: unknown }[]) : [];
  let found = "none";
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) { v.forEach(walk); return; }
    if (v === null || typeof v !== "object") return;
    const o = v as Record<string, unknown>;
    if (o.id === id && typeof o.expectedToken === "string" && found === "none") found = o.expectedToken;
    Object.values(o).forEach(walk);
  };
  for (const b of blocks) {
    if (b.type !== "tool_result" || typeof b.content !== "string") continue;
    try { walk(JSON.parse(b.content)); } catch { /* an error result */ }
  }
  return found;
}

/** Every tool result the bodies carried, for a failure message. */
const toolResultsOf = (bodies: readonly string[]): string =>
  bodies.flatMap((raw) => (JSON.parse(raw) as Body).messages.flatMap((m) =>
    Array.isArray(m.content)
      ? (m.content as { type: string; content?: unknown }[]).filter((b) => b.type === "tool_result").map((b) => String(b.content))
      : [])).join("\n");

/** Three sends: assign the task by placeholder, move the resource ("allocation"), rate and RACI the stakeholder. */
async function driveRefusedWrites(ws: Workspace) {
  const view = renderChat(ws, aiSettings());
  script = [
    () => toolUse([{ name: "get_task", input: { id: TASK_ID } }]),
    (b) => toolUse([{ name: "update_task", input: { id: TASK_ID, expectedToken: tokenFor(b, TASK_ID), assignee: "[Person 1]", assigneeEmail: "new.owner@example.test", priority: "Urgent" } }]),
    () => text("Done 1."),
  ];
  await sendChat(`Give task ${TASK_ID} to ${MAIL_PERSON} and make it urgent.`, "Done 1.");
  script = [
    () => toolUse([{ name: "list_resources", input: {} }]),
    (b) => toolUse([{ name: "update_resource", input: { id: RESOURCE_ID, expectedToken: tokenFor(b, RESOURCE_ID), title: "Architect", utilization: { "2026-11": 10 } } }]),
    () => text("Done 2."),
  ];
  await sendChat("Move Rosalind Quenby's November hours to someone else.", "Done 2.");
  script = [
    () => toolUse([{ name: "list_stakeholders", input: {} }]),
    (b) => toolUse([{ name: "update_stakeholder", input: { id: STAKEHOLDER_ID, expectedToken: tokenFor(b, STAKEHOLDER_ID), influence: "Low", raci: { "1": "R" } } }]),
    () => text("Done 3."),
  ];
  await sendChat(`Rate ${MAIL_PERSON} low and make them Responsible for Staging ready.`, "Done 3.");
  return view.live.current!;
}

describe("refused writes: a reply that acts on a person applies nothing person-related (R4)", () => {
  it("protection on: the assignee, the resource and the stakeholder are untouched; the rest of the task write applies", async () => {
    const live = await driveRefusedWrites(peopleFixture(false));
    const task = live.tasks.find((t) => t.id === TASK_ID)!;
    expect(task.priority).toBe("Urgent"); // strip and apply: the call reached the writer
    expect(task.assignee).toBe("Tobias Kranewitter");
    expect(task.assigneeEmail).toBe("t.kranewitter@example.test");
    const resource = live.resources.find((r) => r.id === RESOURCE_ID)!;
    expect(resource.title).toBe("Platform engineer");
    expect(resource.utilization).toEqual({ "2026-11": 80 });
    const stakeholder = live.stakeholders.find((s) => s.id === STAKEHOLDER_ID)!;
    expect(stakeholder.influence).toBe("High");
    expect(stakeholder.raci).toEqual({ "1": "A" });
    expect(peopleIn(sent)).toEqual([]);
  });

  // The positive control: the same replies DO write when the project allows people, so the assertions above are
  // the protection's refusal and not a token or fixture failure.
  it("protection off: the same replies write", async () => {
    const live = await driveRefusedWrites(peopleFixture(true));
    const task = live.tasks.find((t) => t.id === TASK_ID)!;
    expect(task.priority, toolResultsOf(sent)).toBe("Urgent");
    expect(task.assignee).toBe("[Person 1]"); // unprotected, nothing is restored: the placeholder is written as sent
    expect(task.assigneeEmail).toBe("new.owner@example.test");
    expect(live.resources.find((r) => r.id === RESOURCE_ID)!.title).toBe("Architect");
    const stakeholder = live.stakeholders.find((s) => s.id === STAKEHOLDER_ID)!;
    expect(stakeholder.influence).toBe("Low");
    // The chat has no RACI or allocation writer at all (`update_stakeholder` says so; `update_resource` has no
    // utilization field): those two writes exist only behind RACI suggestions and Plan with AI, which protection
    // hides (the `raci-suggest` and `alloc-plan` rows above).
    expect(stakeholder.raci).toEqual({ "1": "A" });
    expect(live.resources.find((r) => r.id === RESOURCE_ID)!.utilization).toEqual({ "2026-11": 80 });
  });
});

// ---------------------------------------------------------------------------------------------------------------
// The deployment lock (P8): `ai-people` disabled forces protection, whatever the project stores.
// ---------------------------------------------------------------------------------------------------------------

describe("the deployment lock", () => {
  it.each(SENDING)("%s: a project that stores peopleAllowed: true still sends redacted bodies", async (_id, driver) => {
    setDisabledIntegrations(["ai-people"]);
    const ws = peopleFixture(true);
    expect(ws.settingsOverrides?.ai?.peopleAllowed).toBe(true);
    await driver.run(ctxFor(ws));
    expect(sent.length).toBeGreaterThan(0);
    expect(peopleIn(sent)).toEqual([]);
  });

  it.each(HIDDEN)("%s stays hidden under the lock", (_id, driver) => {
    setDisabledIntegrations(["ai-people"]);
    expect(peopleFeatureOffered(driver.feature, peopleFixture(true), aiSettings())).toBe(false);
  });
});
