import { describe, it, expect, vi, beforeEach } from "vitest";
import { newConsent } from "../ai-consent";
import { render, screen, fireEvent, waitFor, act, within } from "@testing-library/react";
import { ScheduledJobsSection } from "./scheduled-jobs-section";
import { defaultSettings, type Settings } from "../settings-types";
import { t } from "../i18n";
import type { ScheduledJob } from "../scheduled-jobs/types";
import { expectRowUniqueNames } from "../../test/row-unique-names";
import { buttonClassFor } from "../../test/button-variant";
import { DisplayTimezoneProvider } from "../display-timezone-context";
import { formatDisplayTimestamp } from "../tz-display";
import { resolveTimezone, tzZones } from "../timezone";
import type { TursoConfig } from "../turso-config";

// Mock the persistence hook — these are pure UI tests (mirrors how
// comm-templates-section.test mocks use-comm-template-versions).
const createJob = vi.fn(async () => {});
const updateJob = vi.fn(async () => {});
const deleteJob = vi.fn(async () => {});
const assignProject = vi.fn(async () => {});
const listProjectsMock = vi.hoisted(() => vi.fn());
const listArchivedMock = vi.hoisted(() => vi.fn());
const portfolioMode = vi.hoisted(() => ({ value: "turso" as "turso" | "file", openProject: null as string | null }));
let mockJobs: ScheduledJob[] = [];

vi.mock("../use-scheduled-jobs", () => ({
  useScheduledJobs: () => ({
    jobs: mockJobs,
    busy: false,
    ready: true,
    createJob,
    updateJob,
    deleteJob,
    assignProject,
    recordRun: vi.fn(),
    refresh: vi.fn(),
  }),
}));

// The section reads both lists through ONE call (`listProjectRefs`); the two mocks keep feeding it entries.
vi.mock("../turso-portfolio", () => ({
  listProjectRefs: async (config: unknown) => {
    const toRef = (e: { id: string; meta: { name: string } }) => ({ id: e.id, name: e.meta.name });
    const [active, archived] = await Promise.all([listProjectsMock(config), listArchivedMock(config)]);
    return { active: (active as { id: string; meta: { name: string } }[]).map(toRef), archived: (archived as { id: string; meta: { name: string } }[]).map(toRef) };
  },
}));
vi.mock("../portfolio-mode", () => ({
  loadPortfolioMode: () => portfolioMode.value,
  loadCurrentTursoProjectId: () => portfolioMode.openProject,
}));

beforeEach(() => {
  assignProject.mockClear();
  portfolioMode.value = "turso";
  portfolioMode.openProject = null;
  listProjectsMock.mockReset();
  listArchivedMock.mockReset();
  listProjectsMock.mockResolvedValue([]);
  listArchivedMock.mockResolvedValue([]);
  createJob.mockClear();
  updateJob.mockClear();
  deleteJob.mockClear();
  mockJobs = [];
});

const KEY = "sk-test";
const TURSO = { httpUrl: "https://x.example", authToken: "t" } as unknown as TursoConfig;

function withKey(over: Partial<Settings["ai"]> = {}): Settings {
  return { ...defaultSettings, ai: { ...defaultSettings.ai, apiKey: KEY, enabled: true, consent: newConsent(new Date(0)), backgroundConsent: newConsent(new Date(0)), ...over } };
}

function job(over: Partial<ScheduledJob> = {}): ScheduledJob {
  return {
    id: 1,
    name: "Weekly review",
    type: "portfolioAnalysis",
    cadence: { kind: "daily", timeOfDay: "09:00" },
    enabled: true,
    projectId: null, timeZone: null, key: null,
    lastRunAt: null,
    history: [],
    ...over,
  };
}

function setup(settings: Settings, onChange = vi.fn()) {
  render(<ScheduledJobsSection lang="en-US" settings={settings} onChange={onChange} config={TURSO} />);
  return { onChange };
}

describe("ScheduledJobsSection", () => {
  it("renders the no-key empty-state when no API key is configured", () => {
    setup(defaultSettings);
    expect(screen.getByText(t("en-US", "emptyStateConfigAi"))).toBeInTheDocument();
    // job toggle is gated away
    expect(screen.queryByLabelText(t("en-US", "scheduledJobsToggle"))).not.toBeInTheDocument();
  });

  it("reflects the ai.scheduledJobs toggle state and the cost note when a key is present", () => {
    setup(withKey({ scheduledJobs: true }));
    const toggle = screen.getByLabelText(t("en-US", "scheduledJobsToggle")) as HTMLInputElement;
    expect(toggle.checked).toBe(true);
    expect(screen.getByText(t("en-US", "scheduledJobsCostNote"))).toBeInTheDocument();
  });

  it("disables the toggle and says why while only the interactive consent is current (AI-10)", () => {
    setup(withKey({ scheduledJobs: false, backgroundConsent: undefined }));
    expect(screen.getByLabelText(t("en-US", "scheduledJobsToggle"))).toBeDisabled();
    expect(screen.getByText(t("en-US", "aiBackgroundConsentNeeded"))).toBeInTheDocument();
  });

  it("links the reason to the disabled toggle as its accessible description (AI-10)", () => {
    setup(withKey({ scheduledJobs: false, backgroundConsent: undefined }));
    expect(screen.getByLabelText(t("en-US", "scheduledJobsToggle"))).toHaveAccessibleDescription(
      t("en-US", "aiBackgroundConsentNeeded"),
    );
  });

  it("a toggle left on from before can be switched off without the background consent (AI-01)", () => {
    const onChange = vi.fn();
    setup(withKey({ scheduledJobs: true, backgroundConsent: undefined }), onChange);
    const toggle = screen.getByLabelText(t("en-US", "scheduledJobsToggle")) as HTMLInputElement;
    expect(toggle).toBeEnabled();
    expect(toggle.checked).toBe(true);
    expect(toggle).not.toHaveAttribute("aria-describedby");
    expect(screen.getByText(t("en-US", "aiBackgroundConsentNeeded"))).toBeInTheDocument(); // why it will not run
    fireEvent.click(toggle);
    expect((onChange.mock.calls.at(-1)?.[0] as Settings).ai.scheduledJobs).toBe(false);
  });

  it("enables the toggle and shows no hint with the background consent current (AI-10)", () => {
    setup(withKey({ scheduledJobs: false }));
    expect(screen.getByLabelText(t("en-US", "scheduledJobsToggle"))).toBeEnabled();
    expect(screen.getByLabelText(t("en-US", "scheduledJobsToggle"))).not.toHaveAttribute("aria-describedby");
    expect(screen.queryByText(t("en-US", "aiBackgroundConsentNeeded"))).not.toBeInTheDocument();
  });

  it("toggling the master switch updates ai.scheduledJobs", () => {
    const onChange = vi.fn();
    setup(withKey({ scheduledJobs: false }), onChange);
    fireEvent.click(screen.getByLabelText(t("en-US", "scheduledJobsToggle")));
    const last = onChange.mock.calls.at(-1)?.[0] as Settings;
    expect(last.ai.scheduledJobs).toBe(true);
  });

  it("Add job calls createJob", async () => {
    setup(withKey({ scheduledJobs: true }));
    await waitFor(() => expect(screen.getByRole("button", { name: t("en-US", "scheduledJobsAdd") })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "scheduledJobsAdd") }));
    expect(createJob).toHaveBeenCalledTimes(1);
  });

  it("switching cadence to weekly surfaces the weekday select; daily hides it", () => {
    mockJobs = [job({ id: 1, name: "Alpha", cadence: { kind: "daily", timeOfDay: "09:00" } })];
    setup(withKey({ scheduledJobs: true }));
    const cadenceSelect = screen.getByLabelText(`${t("en-US", "scheduledJobsTitle")} – Alpha`);
    // weekday select absent while daily
    expect(screen.queryByLabelText(`${t("en-US", "cadenceDay")} – Alpha`)).not.toBeInTheDocument();
    fireEvent.change(cadenceSelect, { target: { value: "weekly" } });
    expect(updateJob).toHaveBeenCalledWith(1, {
      cadence: { kind: "weekly", dayOfWeek: 0, timeOfDay: "09:00" },
    }, undefined);
  });

  it("renders the weekday select for an existing weekly job", () => {
    mockJobs = [job({ id: 1, name: "Alpha", cadence: { kind: "weekly", dayOfWeek: 1, timeOfDay: "09:00" } })];
    setup(withKey({ scheduledJobs: true }));
    expect(screen.getByLabelText(`${t("en-US", "cadenceDay")} – Alpha`)).toBeInTheDocument();
  });

  it("delete calls deleteJob with the job id", () => {
    mockJobs = [job({ id: 7, name: "Alpha" })];
    setup(withKey({ scheduledJobs: true }));
    fireEvent.click(screen.getByLabelText(`${t("en-US", "delete")} – Alpha`));
    expect(deleteJob).toHaveBeenCalledWith(7, undefined);
  });

  it("gives per-row controls job-name-qualified accessible names (WCAG 2.4.6)", () => {
    mockJobs = [job({ id: 1, name: "Alpha" }), job({ id: 2, name: "Beta" })];
    setup(withKey({ scheduledJobs: true }));
    // Two distinct delete labels — guards the duplicate-label trap.
    expect(screen.getByLabelText(`${t("en-US", "delete")} – Alpha`)).toBeInTheDocument();
    expect(screen.getByLabelText(`${t("en-US", "delete")} – Beta`)).toBeInTheDocument();
    expect(screen.getByLabelText(`${t("en-US", "scheduledJobEnabled")} – Alpha`)).toBeInTheDocument();
    expect(screen.getByLabelText(`${t("en-US", "scheduledJobEnabled")} – Beta`)).toBeInTheDocument();
  });

  it("keeps the controls of two same-named jobs apart (§316)", () => {
    // A new job starts with the default name, so two unedited jobs collide.
    mockJobs = [job({ id: 1, name: "Weekly review" }), job({ id: 2, name: "Weekly review" })];
    setup(withKey({ scheduledJobs: true }));
    expect(screen.getByLabelText(`${t("en-US", "delete")} – Weekly review (2)`)).toBeInTheDocument();
    expect(screen.getByLabelText(`${t("en-US", "scheduledJobName")} – Weekly review (1)`)).toBeInTheDocument();
    expectRowUniqueNames({ minControls: 2, requireCollisionSeed: true });
    expectRowUniqueNames({ minControls: 4, roles: ["textbox", "checkbox", "combobox"], requireCollisionSeed: true });
  });

  it("shows 'never run' when a job has no history", () => {
    mockJobs = [job({ id: 1, name: "Alpha", history: [] })];
    setup(withKey({ scheduledJobs: true }));
    expect(screen.getByText(t("en-US", "scheduledJobNeverRun"))).toBeInTheDocument();
  });

  it("shows the last-run summary and suggestion count for a successful run", () => {
    mockJobs = [
      job({
        id: 1,
        name: "Alpha",
        history: [{ ranAt: "2026-06-18T09:00:00Z", summary: "ok", actionCount: 3, ok: true }],
      }),
    ];
    setup(withKey({ scheduledJobs: true }));
    expect(screen.queryByText(/2026-06-18T09:00:00Z/)).toBeNull();
    const shown = formatDisplayTimestamp("2026-06-18T09:00:00Z", Intl.DateTimeFormat().resolvedOptions().timeZone, "en-US");
    expect(screen.getByText((_, el) => el?.tagName === "SPAN" && !!el.textContent?.startsWith(`Last run: ${shown}`))).toBeInTheDocument();
    expect(screen.getByText(/3 suggestions/)).toBeInTheDocument();
  });

  it("shows the failed label for a failed run", () => {
    mockJobs = [
      job({
        id: 1,
        name: "Alpha",
        history: [{ ranAt: "2026-06-18T09:00:00Z", summary: "", actionCount: 0, ok: false, error: "429" }],
      }),
    ];
    setup(withKey({ scheduledJobs: true }));
    expect(screen.getByText(/Run failed \(429\)/)).toBeInTheDocument();
  });

  it.each([
    ["401", "aiKeyRejected"],
    ["403", "aiKeyForbidden"],
  ] as const)("§650 a run that failed with %s shows %s, not the bare status", (token, key) => {
    mockJobs = [
      job({
        id: 1,
        name: "Alpha",
        history: [{ ranAt: "2026-06-18T09:00:00Z", summary: "", actionCount: 0, ok: false, error: token }],
      }),
    ];
    setup(withKey({ scheduledJobs: true }));
    expect(screen.getByText(t("en-US", key), { exact: false })).toBeInTheDocument();
    expect(screen.queryByText(t("en-US", "scheduledJobFailed", token), { exact: false })).toBeNull();
  });
});

// §102 (batch 23): a job's Delete is the shared destructive Button at xs.
describe("ScheduledJobsSection delete on the shared Button", () => {
  it("draws Delete as destructive xs", () => {
    mockJobs = [job({ id: 7, name: "Alpha" })];
    setup(withKey({ scheduledJobs: true }));
    expect(screen.getByRole("button", { name: `${t("en-US", "delete")} – Alpha` }).className).toBe(
      buttonClassFor({ variant: "destructive", size: "xs" }),
    );
  });
});

// §102 (batch 23, owner decision 2026-10-09): the near-size buttons moved to the shared `xs`.
describe("ScheduledJobsSection Show more on the shared Button", () => {
  it("draws a job's Show more as secondary xs", () => {
    mockJobs = [
      job({
        id: 7,
        name: "Alpha",
        history: [
          { ranAt: "2026-06-18T09:00:00Z", summary: "ok", actionCount: 3, ok: true },
          { ranAt: "2026-06-17T09:00:00Z", summary: "ok", actionCount: 1, ok: true },
        ],
      }),
    ];
    setup(withKey({ scheduledJobs: true }));
    expect(screen.getByRole("button", { name: `${t("en-US", "showMore")} – Alpha` }).className).toBe(
      buttonClassFor({ variant: "secondary", size: "xs" }),
    );
  });
});

// §691 — Add job is the accent Button at xs.
describe("ScheduledJobsSection Add job", () => {
  it("draws the accent Button", () => {
    setup(withKey({ scheduledJobs: true }));
    expect(screen.getByRole("button", { name: t("en-US", "scheduledJobsAdd") }).className).toBe(
      buttonClassFor({ variant: "accent", size: "xs", className: "self-start" }),
    );
  });
});

// §715 — a run's time is shown in the display timezone, never as the stored UTC string ("2026-09-21T07:05:…Z").
describe("§715 — scheduled-job run times in the display timezone", () => {
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // A zone other than the machine's, so a read of the browser zone instead of the provider's fails.
  const ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone === "Asia/Tokyo" ? "America/New_York" : "Asia/Tokyo";
  it("the last run and an earlier one read in the project's zone", () => {
    mockJobs = [
      job({
        id: 3,
        name: "Morning check",
        history: [
          { ranAt: "2026-09-21T07:05:12.345Z", summary: "ok", actionCount: 2, ok: true },
          { ranAt: "2026-09-20T07:05:00.000Z", summary: "ok", actionCount: 1, ok: true },
        ],
      }),
    ];
    render(
      <DisplayTimezoneProvider effectiveTz={ZONE}>
        <ScheduledJobsSection lang="en-US" settings={withKey({ scheduledJobs: true })} onChange={vi.fn()} config={TURSO} />
      </DisplayTimezoneProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: `${t("en-US", "showMore")} – Morning check` }));
    expect(screen.queryByText(/T07:05/)).toBeNull();
    for (const iso of ["2026-09-21T07:05:12.345Z", "2026-09-20T07:05:00.000Z"]) {
      expect(screen.getByText(new RegExp(esc(formatDisplayTimestamp(iso, ZONE, "en-US"))))).toBeInTheDocument();
    }
  });
});

// §772 — a scheduled report is about ONE stored project, so the section needs the Turso portfolio and
// lets each job pick its project, zone and standing instruction.
describe("§772 — project, time zone and instruction", () => {
  const entry = (id: string, name: string, archived = false) =>
    ({ id, meta: { name }, archived }) as unknown as import("../turso-tenant-schema").ProjectListEntry;
  const tz = resolveTimezone(defaultSettings.timezone, undefined);
  const nameOf = (key: Parameters<typeof t>[1], token: string) => `${t("en-US", key)} – ${token}`;

  beforeEach(() => {
    listProjectsMock.mockResolvedValue([entry("p1", "Apollo"), entry("p2", "Borealis")]);
    listArchivedMock.mockResolvedValue([entry("p9", "Old one", true)]);
  });

  it("without a Turso config shows only the need-portfolio text and no job controls", () => {
    render(<ScheduledJobsSection lang="en-US" settings={withKey({ scheduledJobs: true })} onChange={vi.fn()} config={null} />);
    expect(screen.getByText(t("en-US", "scheduledJobsNeedPortfolio"))).toBeInTheDocument();
    expect(screen.queryByLabelText(t("en-US", "scheduledJobsToggle"))).toBeNull();
    expect(screen.queryByRole("button", { name: t("en-US", "scheduledJobsAdd") })).toBeNull();
  });

  it("with a config but file-mode portfolio shows the same text", () => {
    portfolioMode.value = "file";
    setup(withKey({ scheduledJobs: true }));
    expect(screen.getByText(t("en-US", "scheduledJobsNeedPortfolio"))).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: t("en-US", "scheduledJobsAdd") })).toBeNull();
  });

  it("lists active projects only and assigns the chosen one with the default zone", async () => {
    mockJobs = [job({ id: 4, name: "Alpha" })];
    setup(withKey({ scheduledJobs: true }));
    const select = await screen.findByRole("combobox", { name: nameOf("scheduledJobProject", "Alpha") });
    await screen.findByRole("option", { name: "Apollo" });
    expect(screen.queryByRole("option", { name: "Old one" })).toBeNull();
    fireEvent.change(select, { target: { value: "p2" } });
    expect(assignProject).toHaveBeenCalledWith(4, "p2", tz, undefined);
  });

  it("keeps a job's own zone when assigning its project", async () => {
    mockJobs = [job({ id: 4, name: "Alpha", timeZone: "Asia/Tokyo" })];
    setup(withKey({ scheduledJobs: true }));
    await screen.findByRole("option", { name: "Apollo" });
    fireEvent.change(screen.getByRole("combobox", { name: nameOf("scheduledJobProject", "Alpha") }), { target: { value: "p1" } });
    expect(assignProject).toHaveBeenCalledWith(4, "p1", "Asia/Tokyo", undefined);
  });

  it("a legacy job shows 'Choose a project' where its next run would be", async () => {
    mockJobs = [job({ id: 1, name: "Alpha", projectId: null })];
    setup(withKey({ scheduledJobs: true }));
    await screen.findByRole("option", { name: "Apollo" });
    expect(screen.getByText(t("en-US", "scheduledJobChooseProject"), { selector: "span" })).toBeInTheDocument();
  });

  it("an assigned job does not show 'Choose a project'", async () => {
    mockJobs = [job({ id: 1, name: "Alpha", projectId: "p1", timeZone: "UTC", key: "k" })];
    setup(withKey({ scheduledJobs: true }));
    await screen.findByRole("option", { name: "Apollo" });
    expect(screen.queryByText(t("en-US", "scheduledJobChooseProject"), { selector: "span" })).toBeNull();
  });

  it("a switched-off job whose project is archived says so", async () => {
    mockJobs = [job({ id: 1, name: "Alpha", enabled: false, projectId: "p9", timeZone: "UTC", key: "k" })];
    setup(withKey({ scheduledJobs: true }));
    expect(await screen.findByText(t("en-US", "scheduledJobArchived"))).toBeInTheDocument();
  });

  it("an enabled job on an active project does not say archived", async () => {
    mockJobs = [job({ id: 1, name: "Alpha", enabled: true, projectId: "p1", timeZone: "UTC", key: "k" })];
    setup(withKey({ scheduledJobs: true }));
    await screen.findByRole("option", { name: "Apollo" });
    expect(screen.queryByText(t("en-US", "scheduledJobArchived"))).toBeNull();
  });

  it("an enabled job on an archived project is not called switched off", async () => {
    mockJobs = [job({ id: 1, name: "Alpha", enabled: true, projectId: "p9", timeZone: "UTC", key: "k" })];
    setup(withKey({ scheduledJobs: true }));
    await screen.findByRole("option", { name: "Apollo" });
    expect(screen.queryByText(t("en-US", "scheduledJobArchived"))).toBeNull();
  });

  it("saves the trimmed instruction on blur, and nothing when it is unchanged", async () => {
    mockJobs = [job({ id: 3, name: "Alpha", instruction: "keep" })];
    setup(withKey({ scheduledJobs: true }));
    const box = await screen.findByRole("textbox", { name: nameOf("scheduledJobInstruction", "Alpha") });
    fireEvent.blur(box);
    expect(updateJob).not.toHaveBeenCalled();
    fireEvent.change(box, { target: { value: "  focus on risks  " } });
    expect(updateJob).not.toHaveBeenCalled();
    fireEvent.blur(box);
    expect(updateJob).toHaveBeenCalledWith(3, { instruction: "focus on risks" }, undefined);
  });

  it("saves the time zone through updateJob and lists the IANA zones", async () => {
    mockJobs = [job({ id: 3, name: "Alpha", timeZone: "Europe/Berlin", projectId: "p1", key: "k" })];
    setup(withKey({ scheduledJobs: true }));
    const select = await screen.findByRole("combobox", { name: nameOf("scheduledJobTimeZone", "Alpha") });
    expect((select as HTMLSelectElement).options.length).toBeGreaterThanOrEqual(tzZones().length);
    fireEvent.change(select, { target: { value: "Asia/Tokyo" } });
    expect(updateJob).toHaveBeenCalledWith(3, { timeZone: "Asia/Tokyo" }, "k");
  });

  it("shows the upgrade note once while any job has no project, and not otherwise", async () => {
    mockJobs = [job({ id: 1, name: "A", projectId: null }), job({ id: 2, name: "B", projectId: null })];
    const { unmount } = render(<ScheduledJobsSection lang="en-US" settings={withKey({ scheduledJobs: true })} onChange={vi.fn()} config={TURSO} />);
    await screen.findAllByRole("option", { name: "Apollo" });
    expect(screen.getAllByText(t("en-US", "scheduledJobsUpgradeNote"))).toHaveLength(1);
    unmount();
    mockJobs = [job({ id: 1, name: "A", projectId: "p1", timeZone: "UTC", key: "k" })];
    setup(withKey({ scheduledJobs: true }));
    await screen.findAllByRole("option", { name: "Apollo" });
    expect(screen.queryByText(t("en-US", "scheduledJobsUpgradeNote"))).toBeNull();
  });

  it("keeps the new controls of two same-named jobs apart", async () => {
    mockJobs = [job({ id: 1, name: "Weekly review" }), job({ id: 2, name: "Weekly review" })];
    setup(withKey({ scheduledJobs: true }));
    await screen.findAllByRole("option", { name: "Apollo" });
    expect(screen.getByRole("combobox", { name: nameOf("scheduledJobProject", "Weekly review (2)") })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: nameOf("scheduledJobInstruction", "Weekly review (1)") })).toBeInTheDocument();
    expectRowUniqueNames({ minControls: 6, roles: ["textbox", "checkbox", "combobox"], requireCollisionSeed: true });
  });

  it("does not show the upgrade note for a job added now: it has a key, only no project", async () => {
    mockJobs = [job({ id: 1, name: "Fresh", projectId: null, timeZone: "UTC", key: "k" })];
    setup(withKey({ scheduledJobs: true }));
    await screen.findAllByRole("option", { name: "Apollo" });
    expect(screen.queryByText(t("en-US", "scheduledJobsUpgradeNote"))).toBeNull();
    expect(screen.getByText(t("en-US", "scheduledJobChooseProject"), { selector: "span" })).toBeInTheDocument();
  });

  it("shows the upgrade note for a job without a key, even while the master toggle is off", async () => {
    mockJobs = [job({ id: 1, name: "Old", projectId: null, key: null })];
    setup(withKey({ scheduledJobs: false }));
    expect(await screen.findByText(t("en-US", "scheduledJobsUpgradeNote"))).toBeInTheDocument();
  });

  const created = () => (createJob.mock.calls as unknown[][])[0][0] as { projectId?: string };

  it("creates a new job on the project open in the portfolio", async () => {
    portfolioMode.openProject = "p2";
    setup(withKey({ scheduledJobs: true }));
    await screen.findByText(t("en-US", "scheduledJobsAdd"));
    await waitFor(() => expect(listProjectsMock).toHaveBeenCalled());
    await act(async () => {});
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "scheduledJobsAdd") }));
    expect(created().projectId).toBe("p2");
  });

  it("falls back to the first active project when the open one is not active", async () => {
    portfolioMode.openProject = "p9";
    setup(withKey({ scheduledJobs: true }));
    await waitFor(() => expect(listProjectsMock).toHaveBeenCalled());
    await act(async () => {});
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "scheduledJobsAdd") }));
    expect(created().projectId).toBe("p1");
  });

  it("creates the job without a project when there is no active project", async () => {
    listProjectsMock.mockResolvedValue([]);
    portfolioMode.openProject = "p1";
    setup(withKey({ scheduledJobs: true }));
    await waitFor(() => expect(listProjectsMock).toHaveBeenCalled());
    await act(async () => {});
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "scheduledJobsAdd") }));
    expect("projectId" in created()).toBe(false);
  });

  it("creates a new job in the device's time zone", async () => {
    setup({ ...withKey({ scheduledJobs: true }), timezone: "Asia/Kolkata" });
    await waitFor(() => expect(screen.getByRole("button", { name: t("en-US", "scheduledJobsAdd") })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "scheduledJobsAdd") }));
    expect((createJob.mock.calls as unknown[][])[0][0]).toMatchObject({ timeZone: "Asia/Kolkata" });
  });

  it("assigns with the device-settings zone, not the browser's", async () => {
    mockJobs = [job({ id: 4, name: "Alpha" })];
    setup({ ...withKey({ scheduledJobs: true }), timezone: "Asia/Kolkata" });
    await screen.findByRole("option", { name: "Apollo" });
    fireEvent.change(screen.getByRole("combobox", { name: nameOf("scheduledJobProject", "Alpha") }), { target: { value: "p1" } });
    expect(assignProject).toHaveBeenCalledWith(4, "p1", "Asia/Kolkata", undefined);
  });

  it("saves an emptied instruction as undefined", async () => {
    mockJobs = [job({ id: 3, name: "Alpha", instruction: "keep" })];
    setup(withKey({ scheduledJobs: true }));
    const box = await screen.findByRole("textbox", { name: nameOf("scheduledJobInstruction", "Alpha") });
    fireEvent.change(box, { target: { value: "   " } });
    fireEvent.blur(box);
    expect(updateJob).toHaveBeenCalledWith(3, { instruction: undefined }, undefined);
  });

  it("saves a typed instruction when the section unmounts before the field is blurred", async () => {
    mockJobs = [job({ id: 3, name: "Alpha" })];
    const { unmount } = render(<ScheduledJobsSection lang="en-US" settings={withKey({ scheduledJobs: true })} onChange={vi.fn()} config={TURSO} />);
    const box = await screen.findByRole("textbox", { name: nameOf("scheduledJobInstruction", "Alpha") });
    fireEvent.change(box, { target: { value: "  watch the budget " } });
    expect(updateJob).not.toHaveBeenCalled();
    unmount();
    expect(updateJob).toHaveBeenCalledWith(3, { instruction: "watch the budget" }, undefined);
  });

  it("does not write on unmount when nothing was typed", async () => {
    mockJobs = [job({ id: 3, name: "Alpha", instruction: "keep" })];
    const { unmount } = render(<ScheduledJobsSection lang="en-US" settings={withKey({ scheduledJobs: true })} onChange={vi.fn()} config={TURSO} />);
    await screen.findByRole("textbox", { name: nameOf("scheduledJobInstruction", "Alpha") });
    unmount();
    expect(updateJob).not.toHaveBeenCalled();
  });

  it("says so when the project list cannot be read", async () => {
    listProjectsMock.mockRejectedValue(new Error("down"));
    setup(withKey({ scheduledJobs: true }));
    expect(await screen.findByText(t("en-US", "tursoPickerError"))).toBeInTheDocument();
  });

  it("does not offer another portfolio's projects while the new config's read is in flight", async () => {
    const OTHER = { httpUrl: "https://other.example", authToken: "t" } as unknown as TursoConfig;
    mockJobs = [job({ id: 1, name: "Alpha" })];
    const props = { lang: "en-US" as const, settings: withKey({ scheduledJobs: true }), onChange: vi.fn() };
    const { rerender } = render(<ScheduledJobsSection {...props} config={TURSO} />);
    await screen.findByRole("option", { name: "Apollo" });
    listProjectsMock.mockReturnValue(new Promise(() => {}));
    rerender(<ScheduledJobsSection {...props} config={OTHER} />);
    expect(screen.queryByRole("option", { name: "Apollo" })).toBeNull();
  });

  it("shows no raw project id as an option label before the lists are read", () => {
    listProjectsMock.mockReturnValue(new Promise(() => {}));
    mockJobs = [job({ id: 1, name: "Alpha", projectId: "3f9c-raw-uuid", timeZone: "UTC", key: "k" })];
    setup(withKey({ scheduledJobs: true }));
    expect(screen.queryByRole("option", { name: "3f9c-raw-uuid" })).toBeNull();
    expect(screen.getByRole("option", { name: "…" })).toBeInTheDocument();
  });

  it("tells a user in file mode with no key about the portfolio requirement first", () => {
    portfolioMode.value = "file";
    setup(defaultSettings);
    expect(screen.getByText(t("en-US", "scheduledJobsNeedPortfolio"))).toBeInTheDocument();
    expect(screen.queryByText(t("en-US", "emptyStateConfigAi"))).toBeNull();
  });

  it("switches a job back on when its archived project is replaced by an active one", async () => {
    mockJobs = [job({ id: 5, name: "Alpha", enabled: false, projectId: "p9", timeZone: "UTC", key: "k" })];
    setup(withKey({ scheduledJobs: true }));
    await screen.findByText(t("en-US", "scheduledJobArchived"));
    fireEvent.change(screen.getByRole("combobox", { name: nameOf("scheduledJobProject", "Alpha") }), { target: { value: "p1" } });
    expect(assignProject).toHaveBeenCalledWith(5, "p1", "UTC", "k");
    expect(updateJob).toHaveBeenCalledWith(5, { enabled: true }, "k");
  });

  it("leaves a job the user switched off switched off when it is reassigned", async () => {
    mockJobs = [job({ id: 5, name: "Alpha", enabled: false, projectId: "p1", timeZone: "UTC", key: "k" })];
    setup(withKey({ scheduledJobs: true }));
    await screen.findByRole("option", { name: "Apollo" });
    fireEvent.change(screen.getByRole("combobox", { name: nameOf("scheduledJobProject", "Alpha") }), { target: { value: "p2" } });
    expect(assignProject).toHaveBeenCalledWith(5, "p2", "UTC", "k");
    expect(updateJob).not.toHaveBeenCalled();
  });

  it("labels the instruction field with the spec's prompt", async () => {
    mockJobs = [job({ id: 3, name: "Alpha" })];
    setup(withKey({ scheduledJobs: true }));
    expect(await screen.findByPlaceholderText("What should this job look for, and what should it ignore?")).toBeInTheDocument();
  });
});

describe("§772 final review: Settings run history, Add job, keyed writes", () => {
  const entry = (id: string, name: string) =>
    ({ id, meta: { name }, archived: false }) as unknown as import("../turso-tenant-schema").ProjectListEntry;
  const failedRun = (error: string) => [{ ranAt: "2026-06-18T09:00:00Z", summary: "", actionCount: 0, ok: false, error }];

  it.each([
    ["project-missing", "scheduledReportsErrProjectMissing"],
    ["turso", "scheduledReportsErrTurso"],
    ["storage-unreachable", "scheduledReportsErrStorage"],
  ] as const)("a failed run with the token %s reads as its translation, not the raw token", (token, key) => {
    mockJobs = [job({ id: 1, name: "Alpha", history: failedRun(token) })];
    setup(withKey({ scheduledJobs: true }));
    const msg = t("en-US", key);
    expect(screen.getByText((_, el) => el?.tagName === "SPAN" && !!el.textContent?.includes(msg))).toBeInTheDocument();
    expect(screen.queryByText(new RegExp(token))).toBeNull();
  });

  it("keeps the generic failed line for an unknown historic error string", () => {
    mockJobs = [job({ id: 1, name: "Alpha", history: failedRun("weird") })];
    setup(withKey({ scheduledJobs: true }));
    expect(screen.getByText(/Run failed \(weird\)/)).toBeInTheDocument();
  });

  it("disables Add job until the project lists have been read, then enables it", async () => {
    let release: (v: unknown[]) => void = () => {};
    listProjectsMock.mockReturnValue(new Promise((r) => { release = r; }));
    setup(withKey({ scheduledJobs: true }));
    const add = screen.getByRole("button", { name: t("en-US", "scheduledJobsAdd") });
    expect(add).toBeDisabled();
    await act(async () => { release([entry("p1", "Apollo")]); });
    await waitFor(() => expect(add).toBeEnabled());
  });

  it("enables Add job when the project read failed, so the job can still be made", async () => {
    listProjectsMock.mockRejectedValue(new Error("down"));
    setup(withKey({ scheduledJobs: true }));
    await waitFor(() => expect(screen.getByRole("button", { name: t("en-US", "scheduledJobsAdd") })).toBeEnabled());
  });

  it("passes the job's permanent key to every write, so another portfolio's same-id job is never reached", async () => {
    listProjectsMock.mockResolvedValue([entry("p1", "Apollo")]);
    mockJobs = [job({ id: 3, name: "Alpha", key: "key-abc", projectId: "p1", timeZone: "UTC" })];
    setup(withKey({ scheduledJobs: true }));
    await screen.findByRole("option", { name: "Apollo" });
    const box = screen.getByRole("textbox", { name: `${t("en-US", "scheduledJobInstruction")} – Alpha` });
    fireEvent.change(box, { target: { value: "x" } });
    fireEvent.blur(box);
    expect(updateJob).toHaveBeenCalledWith(3, { instruction: "x" }, "key-abc");
    fireEvent.click(screen.getByLabelText(`${t("en-US", "delete")} – Alpha`));
    expect(deleteJob).toHaveBeenCalledWith(3, "key-abc");
  });
});

describe("§772 review wave 2: time field and restored-project note", () => {
  const entry = (id: string, name: string) =>
    ({ id, meta: { name }, archived: false }) as unknown as import("../turso-tenant-schema").ProjectListEntry;
  const archivedRun = [{ ranAt: "2026-06-18T09:00:00Z", summary: "", actionCount: 0, ok: false, error: "project-archived" }];

  // KILLED BY: removing the empty-value guard in setTime.
  it("clearing the time field writes nothing (an empty time would read as 00:00 and run at once)", async () => {
    listProjectsMock.mockResolvedValue([entry("p1", "Apollo")]);
    mockJobs = [job({ id: 3, name: "Alpha", key: "k", projectId: "p1", timeZone: "UTC" })];
    setup(withKey({ scheduledJobs: true }));
    await screen.findByRole("option", { name: "Apollo" });
    const time = screen.getByLabelText(`${t("en-US", "cadenceTime")} – Alpha`);
    fireEvent.change(time, { target: { value: "" } });
    expect(updateJob).not.toHaveBeenCalled();
    fireEvent.change(time, { target: { value: "10:15" } });
    expect(updateJob).toHaveBeenCalledWith(3, { cadence: { kind: "daily", timeOfDay: "10:15" } }, "k");
  });

  // KILLED BY: removing the restored-project note.
  it("explains why a job is off once its archived project is active again", async () => {
    listProjectsMock.mockResolvedValue([entry("p1", "Apollo")]);
    mockJobs = [job({ id: 3, name: "Alpha", key: "k", projectId: "p1", timeZone: "UTC", enabled: false, history: archivedRun })];
    setup(withKey({ scheduledJobs: true }));
    await screen.findByRole("option", { name: "Apollo" });
    expect(screen.getByText(t("en-US", "scheduledJobRestoredOff"))).toBeInTheDocument();
  });

  it("shows no such note for a job the user switched off themselves", async () => {
    listProjectsMock.mockResolvedValue([entry("p1", "Apollo")]);
    mockJobs = [job({ id: 3, name: "Alpha", key: "k", projectId: "p1", timeZone: "UTC", enabled: false })];
    setup(withKey({ scheduledJobs: true }));
    await screen.findByRole("option", { name: "Apollo" });
    expect(screen.queryByText(t("en-US", "scheduledJobRestoredOff"))).toBeNull();
  });
});

describe("§772 cr2: the zone select does not misstate a legacy job", () => {
  const entry = (id: string, name: string) =>
    ({ id, meta: { name }, archived: false }) as unknown as import("../turso-tenant-schema").ProjectListEntry;
  const zoneName = `${t("en-US", "scheduledJobTimeZone")} – Alpha`;

  // KILLED BY: showing the default zone as if it were stored.
  it("shows an unset placeholder for a job without a stored zone", async () => {
    listProjectsMock.mockResolvedValue([entry("p1", "Apollo")]);
    mockJobs = [job({ id: 3, name: "Alpha", timeZone: null })];
    setup(withKey({ scheduledJobs: true }));
    await screen.findByRole("option", { name: "Apollo" });
    const select = screen.getByLabelText(zoneName) as HTMLSelectElement;
    expect(select.value).toBe("");
    expect(within(select).getByRole("option", { name: t("en-US", "scheduledJobZoneUnset") })).toBeDisabled();
  });

  it("shows the stored zone, with no placeholder, once the job has one", async () => {
    listProjectsMock.mockResolvedValue([entry("p1", "Apollo")]);
    mockJobs = [job({ id: 3, name: "Alpha", timeZone: "Asia/Tokyo", projectId: "p1", key: "k" })];
    setup(withKey({ scheduledJobs: true }));
    await screen.findByRole("option", { name: "Apollo" });
    const select = screen.getByLabelText(zoneName) as HTMLSelectElement;
    expect(select.value).toBe("Asia/Tokyo");
    expect(screen.queryByRole("option", { name: t("en-US", "scheduledJobZoneUnset") })).toBeNull();
  });
});

describe("§772 cr3: foreign jobs and failed writes", () => {
  const entry = (id: string, name: string) =>
    ({ id, meta: { name }, archived: false }) as unknown as import("../turso-tenant-schema").ProjectListEntry;
  const foreign = (over: Partial<ScheduledJob> = {}) =>
    job({ id: 8, name: "From the future", foreign: { raw: { id: 8, type: "future" } }, ...over });

  // KILLED BY: rendering a foreign job with the ordinary editable row.
  it("lists a foreign job read-only with a note, and offers only Delete", async () => {
    listProjectsMock.mockResolvedValue([entry("p1", "Apollo")]);
    mockJobs = [foreign(), job({ id: 3, name: "Alpha", key: "k", projectId: "p1", timeZone: "UTC" })];
    setup(withKey({ scheduledJobs: true }));
    await screen.findByRole("option", { name: "Apollo" });
    expect(screen.getByText("From the future")).toBeInTheDocument();
    expect(screen.getByText(t("en-US", "scheduledJobForeign"))).toBeInTheDocument();
    for (const role of ["textbox", "checkbox", "combobox"] as const) expect(screen.queryByRole(role, { name: /From the future/ })).toBeNull();
    fireEvent.click(screen.getByLabelText(`${t("en-US", "delete")} – From the future`));
    expect(deleteJob).toHaveBeenCalledWith(8, undefined);
  });

  it("does not show the upgrade note for a foreign job (it has no key and is not a legacy job)", async () => {
    mockJobs = [foreign()];
    setup(withKey({ scheduledJobs: true }));
    await screen.findByText("From the future");
    expect(screen.queryByText(t("en-US", "scheduledJobsUpgradeNote"))).toBeNull();
  });

  // KILLED BY: dropping the rejection handler (a failed write would look as if it worked).
  it("says so when a write fails, and clears the message after the next success", async () => {
    listProjectsMock.mockResolvedValue([entry("p1", "Apollo")]);
    mockJobs = [job({ id: 3, name: "Alpha", key: "k", projectId: "p1", timeZone: "UTC" })];
    setup(withKey({ scheduledJobs: true }));
    await screen.findByRole("option", { name: "Apollo" });
    updateJob.mockRejectedValueOnce(new Error("down"));
    const box = screen.getByLabelText(`${t("en-US", "scheduledJobName")} – Alpha`);
    fireEvent.change(box, { target: { value: "Alpha 2" } });
    expect(await screen.findByRole("alert")).toHaveTextContent(t("en-US", "scheduledJobsWriteFailed"));
    fireEvent.change(box, { target: { value: "Alpha 3" } });
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });
});
