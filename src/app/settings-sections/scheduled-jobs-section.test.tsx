import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ScheduledJobsSection } from "./scheduled-jobs-section";
import { defaultSettings, type Settings } from "../settings-types";
import { t } from "../i18n";
import type { ScheduledJob } from "../scheduled-jobs/types";

// Mock the persistence hook — these are pure UI tests (mirrors how
// comm-templates-section.test mocks use-comm-template-versions).
const createJob = vi.fn(async () => {});
const updateJob = vi.fn(async () => {});
const deleteJob = vi.fn(async () => {});
let mockJobs: ScheduledJob[] = [];

vi.mock("../use-scheduled-jobs", () => ({
  useScheduledJobs: () => ({
    jobs: mockJobs,
    busy: false,
    ready: true,
    createJob,
    updateJob,
    deleteJob,
    recordRun: vi.fn(),
    refresh: vi.fn(),
  }),
}));

beforeEach(() => {
  createJob.mockClear();
  updateJob.mockClear();
  deleteJob.mockClear();
  mockJobs = [];
});

const KEY = "sk-test";

function withKey(over: Partial<Settings["ai"]> = {}): Settings {
  return { ...defaultSettings, ai: { ...defaultSettings.ai, apiKey: KEY, ...over } };
}

function job(over: Partial<ScheduledJob> = {}): ScheduledJob {
  return {
    id: 1,
    name: "Weekly review",
    type: "portfolioAnalysis",
    cadence: { kind: "daily", timeOfDay: "09:00" },
    enabled: true,
    lastRunAt: null,
    history: [],
    ...over,
  };
}

function setup(settings: Settings, onChange = vi.fn()) {
  render(<ScheduledJobsSection lang="en-US" settings={settings} onChange={onChange} config={null} />);
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

  it("toggling the master switch updates ai.scheduledJobs", () => {
    const onChange = vi.fn();
    setup(withKey({ scheduledJobs: false }), onChange);
    fireEvent.click(screen.getByLabelText(t("en-US", "scheduledJobsToggle")));
    const last = onChange.mock.calls.at(-1)?.[0] as Settings;
    expect(last.ai.scheduledJobs).toBe(true);
  });

  it("Add job calls createJob", () => {
    setup(withKey({ scheduledJobs: true }));
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
    });
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
    expect(deleteJob).toHaveBeenCalledWith(7);
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
    expect(screen.getByText(/2026-06-18T09:00:00Z/)).toBeInTheDocument();
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
});
