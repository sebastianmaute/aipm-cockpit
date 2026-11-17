// §804 — the PROJECT's own rates switch (not only the deployment lock) keeps every rate out of the Plan with AI
// request: the real privacy provider with the open project registered as its source, read at send time.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { type ReactNode, useState } from "react";
import { newConsent } from "./ai-consent";
import { AiPrivacyProvider, useAiPrivacySource } from "./ai-privacy-context";
import { withPeopleAllowed } from "./ai-people-protection";
import { withAiSwitch } from "./ai-project-switches";
import { ToastProvider } from "./toast-context";
import { useAllocPlan } from "./use-alloc-plan";
import { defaultSettings, type Settings } from "./settings-types";
import { type Resource, type ResourcePlan, type Role } from "./types";
import { emptyWorkspace, type Workspace } from "./workspace";
import * as call from "./alloc-plan-call";
import { t } from "./i18n";

vi.mock("./alloc-plan-call");

const AI_ON: Settings = {
  ...defaultSettings,
  ai: { ...defaultSettings.ai, enabled: true, consent: newConsent(new Date(0)), apiKey: "sk-ant-test", model: "claude-x" },
};
const PLAN: ResourcePlan = { startDate: "2026-08-01", endDate: "2026-08-31", granularity: "month", currency: "EUR" };
const RATE_CARD: Role[] = [{ id: 7, disciplineId: 1, gradeId: 1, internalRate: 80, externalRate: 120 }];
const ALICE: Resource = { id: 1, firstName: "Alice", lastName: "Anderson", roleId: 7, utilizationMode: "hours", utilization: {} };

function Source({ ws, children }: { ws: Workspace; children: ReactNode }) {
  useAiPrivacySource("p1", () => ws, () => 0, true);
  return <>{children}</>;
}

function Harness() {
  const [resources, setResources] = useState<readonly Resource[]>([ALICE]);
  const alloc = useAllocPlan({
    settings: AI_ON, isPopout: false, lang: "en-US", resources, setResources, roles: RATE_CARD,
    disciplines: [], grades: [], plan: PLAN, absences: [], workdayHours: 8, holidaySet: new Set<string>(),
    capture: vi.fn() as never, logActivityAs: vi.fn() as never, tasks: [], milestones: [], stakeholders: [],
    today: "2026-08-01", reassignTasks: () => 0, isLoadHeld: () => false,
  });
  return <div>{alloc.button}{alloc.modal}</div>;
}

async function sentContext(overrides: Workspace["settingsOverrides"]): Promise<string> {
  vi.mocked(call.runAllocProposal).mockImplementation(() => new Promise(() => {}));
  const ws: Workspace = { ...emptyWorkspace(), resources: [ALICE], settingsOverrides: overrides };
  render(
    <ToastProvider value={{ showToast: vi.fn(), showToastAction: vi.fn() }}>
      <AiPrivacyProvider>
        <Source ws={ws}>
          <Harness />
        </Source>
      </AiPrivacyProvider>
    </ToastProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: /plan with ai/i }));
  fireEvent.change(screen.getByPlaceholderText(/distribute 200 hours/i), { target: { value: "spread 40 hours across the team" } });
  fireEvent.click(screen.getByRole("button", { name: t("en-US", "allocPlanPropose") }));
  await waitFor(() => expect(call.runAllocProposal).toHaveBeenCalled());
  return vi.mocked(call.runAllocProposal).mock.calls[0][0];
}

afterEach(() => vi.clearAllMocks());

describe("Plan with AI follows the project's own rates switch (§804)", () => {
  const ALLOWED = withPeopleAllowed(undefined, true);

  it("CONTROL: with the switch off the role's internal rate is sent", async () => {
    expect(await sentContext(ALLOWED)).toContain(" rate=80/h");
  });

  it("with the project's switch on no line carries a rate, and the person is still listed", async () => {
    const sent = await sentContext(withAiSwitch(ALLOWED, "ratesWithheld", true));
    expect(sent).toContain("#1 ");
    expect(sent).not.toContain("rate=");
  });
});
