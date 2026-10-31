// src/test/people-protection-harness.tsx — the React side of the AI people protection wire test
// (`src/app/ai-people-protection.wire.test.ts`). JSX lives here so the test itself stays a `.ts` file.
//
// Every harness registers the project's privacy source exactly as task-manager does (`useAiPrivacySource`) under
// the real `AiPrivacyProvider`, so the features read the REAL protection setting of the given workspace — no mock of
// `ai-privacy-context`.
import { render } from "@testing-library/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { vi } from "vitest";
import { AiPrivacyProvider, useAiPrivacySource } from "../app/ai-privacy-context";
import { ChatPanel } from "../app/chat-panel";
import { computeDashboard, buildDashboardInput, type DashboardModel } from "../app/dashboard";
import { useDictationMic } from "../app/dictation-mic";
import type { Settings } from "../app/settings-types";
import { writeSettings } from "../app/use-settings";
import { TestProviders } from "../app/test-providers";
import { ToastProvider } from "../app/toast-context";
import { useAllocPlan } from "../app/use-alloc-plan";
import { useChatDispatcher } from "../app/use-chat-dispatcher";
import { useRaciSuggest } from "../app/use-raci-suggest";
import { useWorkspace } from "../app/workspace-context";
import type { Workspace } from "../app/workspace";
import { makeDispatcherArgs } from "./chat-dispatcher-fixture";
import { FIXTURE_PROJECT_KEY, FIXTURE_TODAY } from "./people-protection-fixture";

/** The dashboard model the app builds for a workspace (task-manager's live model, without trends). */
export function dashboardOf(ws: Workspace): DashboardModel {
  return computeDashboard(buildDashboardInput(
    {
      tasks: ws.tasks, raid: ws.raid, budgets: ws.budgets ?? [], plan: ws.plan, roles: ws.roles, resources: ws.resources,
      absences: ws.absences, fxRates: ws.fxRates ?? null, milestones: ws.milestones, changes: ws.changes,
      disciplines: ws.disciplines, grades: ws.grades, budgetHistory: ws.budgetHistory, baselineHistory: ws.baselineHistory,
    },
    { workdayHours: 8, holidaySet: new Set<string>(), status: ws.status ?? {}, activity: ws.activityLog ?? [], today: FIXTURE_TODAY },
  ));
}

function PrivacySource({ ws, children }: { ws: Workspace; children: ReactNode }) {
  useAiPrivacySource(FIXTURE_PROJECT_KEY, () => ws, () => 0);
  return <>{children}</>;
}

/** The slices `TestProviders` does not seed: the activity log (what `search_history` reads) and the insights. */
function ExtraSeed({ ws }: { ws: Workspace }) {
  const { setActivityLog, setInsights } = useWorkspace();
  const seededRef = useRef(false);
  useEffect(() => {
    if (seededRef.current) return;
    seededRef.current = true;
    if (ws.activityLog?.length) setActivityLog(ws.activityLog);
    if (ws.insights?.length) setInsights(ws.insights);
    // Seed once on mount, as `TestProviders` does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

type LiveWorkspace = ReturnType<typeof useWorkspace>;

/** Exposes the live workspace, so a test can read what a chat turn applied. */
function Probe({ outRef }: { outRef: { current: LiveWorkspace | null } }) {
  const live = useWorkspace();
  useEffect(() => {
    outRef.current = live;
  }, [outRef, live]);
  return null;
}

function ChatWithDispatcher({ ws, settings }: { ws: Workspace; settings: Settings }) {
  const [args] = useState(() => makeDispatcherArgs({ settings, getDashboardModel: () => dashboardOf(ws) }));
  const dispatcher = useChatDispatcher(args);
  return (
    <ChatPanel
      lang="en-US" ai={settings.ai} dispatcher={dispatcher} projectId={FIXTURE_PROJECT_KEY}
      getScopeEpoch={() => 0} isSwapInFlight={() => false}
    />
  );
}

/** The chat with the REAL tool dispatcher over `ws`, under the real privacy provider. */
export function renderChat(ws: Workspace, settings: Settings) {
  // The stored settings: the workspace provider's settings hook loads them and publishes their consent state, so
  // they must carry the same consent the test publishes, or the first load would revoke it mid-test.
  writeSettings(settings, ["enabled", "consent", "backgroundConsent"]);
  const live: { current: LiveWorkspace | null } = { current: null };
  const view = render(
    <AiPrivacyProvider>
      <PrivacySource ws={ws}>
        <TestProviders
          seed={{
            tasks: [...ws.tasks], resources: [...ws.resources], raid: [...ws.raid], changes: [...(ws.changes ?? [])],
            milestones: [...(ws.milestones ?? [])], stakeholders: [...(ws.stakeholders ?? [])], absences: [...ws.absences],
            shifts: [...ws.shifts], project: ws.project, settingsOverrides: ws.settingsOverrides,
          }}
        >
          <ExtraSeed ws={ws} />
          <Probe outRef={live} />
          <ChatWithDispatcher ws={ws} settings={settings} />
        </TestProviders>
      </PrivacySource>
    </AiPrivacyProvider>,
  );
  return { ...view, live };
}

const toast = { showToast: vi.fn(), showToastAction: vi.fn() };

function AllocHarness({ ws, settings }: { ws: Workspace; settings: Settings }) {
  const alloc = useAllocPlan({
    settings, isPopout: false, lang: "en-US", resources: ws.resources, setResources: () => undefined,
    roles: ws.roles, disciplines: ws.disciplines, grades: ws.grades, plan: ws.plan, absences: ws.absences, workdayHours: 8,
    holidaySet: new Set<string>(), tasks: ws.tasks, milestones: ws.milestones ?? [], stakeholders: ws.stakeholders ?? [],
    today: FIXTURE_TODAY, reassignTasks: () => 0, isLoadHeld: () => false,
  });
  return <div>{alloc.button}{alloc.modal}</div>;
}

function RaciHarness({ ws, settings }: { ws: Workspace; settings: Settings }) {
  const suggest = useRaciSuggest({
    settings, isPopout: false, lang: "en-US", stakeholders: ws.stakeholders ?? [], milestones: ws.milestones ?? [],
    tasks: [], raid: [], changes: [], resources: [], roles: [], disciplines: [], grades: [], documents: [],
    onSave: () => undefined,
  });
  return <div>{suggest.button}{suggest.modal}</div>;
}

function MicHarness() {
  const { mic } = useDictationMic({ lang: "en-US", dictation: undefined, aiConsented: true, label: "Notes", onAppendFinal: () => undefined });
  return <div>{mic}</div>;
}

export type PeopleFeature = "alloc-plan" | "raci-suggest" | "dictation";

const FEATURE: Readonly<Record<PeopleFeature, { trigger: RegExp; node: (ws: Workspace, s: Settings) => ReactNode }>> = {
  "alloc-plan": { trigger: /plan with ai/i, node: (ws, s) => <AllocHarness ws={ws} settings={s} /> },
  "raci-suggest": { trigger: /suggest raci/i, node: (ws, s) => <RaciHarness ws={ws} settings={s} /> },
  dictation: { trigger: /hold to dictate/i, node: () => <MicHarness /> },
};

/** Whether the feature's trigger is offered for `ws` (rendered, then unmounted). */
export function peopleFeatureOffered(feature: PeopleFeature, ws: Workspace, settings: Settings): boolean {
  const spec = FEATURE[feature];
  // The mic is offered only where the browser can recognise speech.
  const w = window as unknown as Record<string, unknown>;
  w.webkitSpeechRecognition = class {};
  const view = render(
    <ToastProvider value={toast}>
      <AiPrivacyProvider>
        <PrivacySource ws={ws}>{spec.node(ws, settings)}</PrivacySource>
      </AiPrivacyProvider>
    </ToastProvider>,
  );
  const offered = view.queryByRole("button", { name: spec.trigger }) !== null;
  view.unmount();
  delete w.webkitSpeechRecognition;
  return offered;
}
