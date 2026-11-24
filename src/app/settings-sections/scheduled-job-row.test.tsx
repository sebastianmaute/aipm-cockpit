import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { JobRow } from "./scheduled-job-row";
import { t } from "../i18n";
import type { ScheduledJob } from "../scheduled-jobs/types";
import { ACCEPTANCE_KEY, acceptJob } from "../scheduled-job-acceptance";

const deviceLabel = vi.hoisted(() => ({ value: "aaaa1111" }));
vi.mock("../device-label", () => ({
  getDeviceLabel: () => deviceLabel.value,
  peekDeviceLabel: () => deviceLabel.value,
}));

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

function renderRow(
  j: ScheduledJob,
  onAccept: (job: ScheduledJob) => void = acceptJob,
  acceptNotice: "failed" | "changed" | null = null,
) {
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
        acceptNotice={acceptNotice}
      />
    </ul>,
  );
}

afterEach(() => vi.restoreAllMocks());

beforeEach(() => {
  localStorage.removeItem(ACCEPTANCE_KEY);
  deviceLabel.value = "aaaa1111";
});

describe("JobRow acceptance", () => {
  it("an unaccepted job offers Accept, which accepts it", () => {
    renderRow(job());
    expect(screen.getByText(t("en-US", "scheduledJobNeedsOk"))).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Accept Weekly review" }));
    expect(screen.getByText(t("en-US", "scheduledJobAcceptedHere"))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Stop on this device: Weekly review" })).toBeInTheDocument();
  });

  it("an accepted job never claims to run here", () => {
    acceptJob(job());
    renderRow(job());
    expect(screen.getByText(t("en-US", "scheduledJobAcceptedHere"))).toBeInTheDocument();
    expect(screen.queryByText(/Runs on this device/)).toBeNull();
  });

  it("a changed job says so", () => {
    acceptJob(job({ instruction: "Something else" }));
    renderRow(job());
    expect(screen.getByText(t("en-US", "scheduledJobChanged"))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Accept Weekly review" })).toBeInTheDocument();
  });

  it("Stop records a decline: the row says stopped and offers Accept", () => {
    acceptJob(job());
    renderRow(job());
    fireEvent.click(screen.getByRole("button", { name: "Stop on this device: Weekly review" }));
    expect(screen.getByText(t("en-US", "scheduledJobStoppedHere"))).toBeInTheDocument();
    expect(screen.queryByText(t("en-US", "scheduledJobNeedsOk"))).toBeNull();
    expect(screen.getByRole("button", { name: "Accept Weekly review" })).toBeInTheDocument();
  });

  it("keeps focus on the action button when Accept turns into Stop", async () => {
    const user = userEvent.setup();
    renderRow(job());
    await user.tab();
    const accept = screen.getByRole("button", { name: "Accept Weekly review" });
    accept.focus();
    expect(document.activeElement).toBe(accept);
    await user.click(accept);
    const stop = screen.getByRole("button", { name: "Stop on this device: Weekly review" });
    expect(document.activeElement).toBe(stop);
  });

  it("an unassigned job shows no status and no action", () => {
    renderRow(job({ projectId: null }));
    expect(screen.queryByText(t("en-US", "scheduledJobNeedsOk"))).toBeNull();
    expect(screen.queryByRole("button", { name: /^Accept/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Stop on this device/ })).toBeNull();
  });

  it("shows the accept notice inside a status region", () => {
    renderRow(job(), acceptJob, "failed");
    expect(screen.getByRole("status")).toHaveTextContent(t("en-US", "scheduledJobAcceptFailed"));
  });

  it("the status region exists, empty, before any click, and gets the text after a failed Accept", () => {
    const view = renderRow(job());
    const region = screen.getByRole("status");
    expect(region).toBeEmptyDOMElement();
    view.rerender(
      <ul>
        <JobRow
          lang="en-US"
          job={job()}
          token="Weekly review"
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
          onAccept={acceptJob}
          acceptNotice="failed"
        />
      </ul>,
    );
    expect(screen.getByRole("status")).toBe(region);
    expect(region).toHaveTextContent(t("en-US", "scheduledJobAcceptFailed"));
  });

  it("Stop that cannot be recorded says so and keeps the job accepted", () => {
    acceptJob(job());
    renderRow(job());
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    fireEvent.click(screen.getByRole("button", { name: "Stop on this device: Weekly review" }));
    expect(screen.getByRole("status")).toHaveTextContent(t("en-US", "scheduledJobAcceptFailed"));
    expect(screen.getByText(t("en-US", "scheduledJobAcceptedHere"))).toBeInTheDocument();
  });

  it("shows the changed-elsewhere notice", () => {
    renderRow(job(), acceptJob, "changed");
    expect(screen.getByRole("status")).toHaveTextContent(t("en-US", "scheduledJobAcceptChanged"));
  });

  it("does not read the device label's storage while rendering", () => {
    localStorage.removeItem("aipm-cockpit:device-label");
    renderRow(job({ createdBy: "bbbb2222" }));
    expect(screen.getByText("Created on device bbbb2222")).toBeInTheDocument();
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
