import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { JobRow } from "./scheduled-job-row";
import { t } from "../i18n";
import type { ScheduledJob } from "../scheduled-jobs/types";
import { ACCEPTANCE_KEY, acceptJob } from "../scheduled-job-acceptance";

const deviceLabel = vi.hoisted(() => ({ value: "aaaa1111" }));
vi.mock("../device-label", () => ({ getDeviceLabel: () => deviceLabel.value }));

function job(over: Partial<ScheduledJob> = {}): ScheduledJob {
  return {
    id: 1,
    name: "Weekly review",
    type: "portfolioAnalysis",
    cadence: { kind: "daily", timeOfDay: "09:00" },
    enabled: true,
    projectId: "p1",
    timeZone: "UTC",
    key: "job-key-1",
    instruction: "Look at risks",
    lastRunAt: null,
    history: [],
    ...over,
  };
}

function renderRow(j: ScheduledJob, onAccept: (job: ScheduledJob) => void = acceptJob) {
  return render(
    <ul>
      <JobRow
        lang="en-US"
        job={j}
        token={j.name}
        busy={false}
        tz="UTC"
        projects={[{ id: "p1", name: "Alpha" }]}
        archivedProjects={[]}
        projectsLoaded
        zones={["UTC"]}
        defaultZone="UTC"
        onUpdate={vi.fn()}
        onAssign={vi.fn()}
        onDelete={vi.fn()}
        onAccept={onAccept}
      />
    </ul>,
  );
}

beforeEach(() => {
  localStorage.removeItem(ACCEPTANCE_KEY);
  deviceLabel.value = "aaaa1111";
});

describe("JobRow acceptance", () => {
  it("an unaccepted job offers Accept, which accepts it", () => {
    renderRow(job());
    expect(screen.getByText(t("en-US", "scheduledJobNeedsOk"))).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Accept Weekly review" }));
    expect(screen.getByText(t("en-US", "scheduledJobRunsHere"))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Stop on this device: Weekly review" })).toBeInTheDocument();
  });

  it("an accepted job that cannot run now does not claim to run here", () => {
    acceptJob(job());
    renderRow(job({ enabled: false }));
    expect(screen.getByText(t("en-US", "scheduledJobAcceptedHere"))).toBeInTheDocument();
    expect(screen.queryByText(t("en-US", "scheduledJobRunsHere"))).toBeNull();
    expect(screen.getByRole("button", { name: "Stop on this device: Weekly review" })).toBeInTheDocument();
  });

  it("a changed job says so", () => {
    acceptJob(job({ instruction: "Something else" }));
    renderRow(job());
    expect(screen.getByText(t("en-US", "scheduledJobChanged"))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Accept Weekly review" })).toBeInTheDocument();
  });

  it("Stop forgets the job", () => {
    acceptJob(job());
    renderRow(job());
    fireEvent.click(screen.getByRole("button", { name: "Stop on this device: Weekly review" }));
    expect(screen.getByText(t("en-US", "scheduledJobNeedsOk"))).toBeInTheDocument();
  });

  it("a legacy job has no Accept or Stop", () => {
    renderRow(job({ key: null }));
    expect(screen.queryByRole("button", { name: /^Accept/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Stop on this device/ })).toBeNull();
  });

  it("created-on reads this device or the label", () => {
    const { unmount } = renderRow(job({ createdBy: "aaaa1111" }));
    expect(screen.getByText(t("en-US", "scheduledJobCreatedHere"))).toBeInTheDocument();
    unmount();
    const second = renderRow(job({ createdBy: "bbbb2222" }));
    expect(screen.getByText("Created on device bbbb2222")).toBeInTheDocument();
    second.unmount();
    renderRow(job());
    expect(screen.queryByText(/Created on/)).toBeNull();
  });
});
