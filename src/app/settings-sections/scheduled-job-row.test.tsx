import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { JobRow } from "./scheduled-job-row";
import { t } from "../i18n";
import type { ScheduledJob } from "../scheduled-jobs/types";
import { ACCEPTANCE_KEY, acceptanceState, acceptJob, declineJob } from "../scheduled-job-acceptance";
import { forgetOwnEdit, noteOwnEdit } from "../scheduled-job-own-edit";

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
  acceptPending = false,
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
        acceptPending={acceptPending}
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
    fireEvent.click(screen.getByRole("button", { name: "Accept: Weekly review" }));
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
    expect(screen.getByRole("button", { name: "Accept: Weekly review" })).toBeInTheDocument();
  });

  it("Stop records a decline: the row says stopped and offers Accept", () => {
    acceptJob(job());
    renderRow(job());
    fireEvent.click(screen.getByRole("button", { name: "Stop on this device: Weekly review" }));
    expect(screen.getByText(t("en-US", "scheduledJobStoppedHere"))).toBeInTheDocument();
    expect(screen.queryByText(t("en-US", "scheduledJobNeedsOk"))).toBeNull();
    expect(screen.getByRole("button", { name: "Accept: Weekly review" })).toBeInTheDocument();
  });

  it("a click runs the action the button showed when it was pressed, even if its label changed before release", () => {
    acceptJob(job());
    const onAccept = vi.fn();
    renderRow(job(), onAccept);
    const main = screen.getByRole("button", { name: "Stop on this device: Weekly review" });
    fireEvent.pointerDown(main);
    act(() => { localStorage.removeItem(ACCEPTANCE_KEY); window.dispatchEvent(new StorageEvent("storage", { key: ACCEPTANCE_KEY })); });
    expect(main).toHaveAccessibleName("Accept: Weekly review"); // the label changed under the pointer
    fireEvent.click(main);
    expect(onAccept).not.toHaveBeenCalled();
    expect(acceptanceState(job())).toBe("declined"); // the Stop it showed at pointerdown
  });

  it("keyboard activation (no pointerdown) runs the live action, and a stale press is dropped", () => {
    acceptJob(job());
    const onAccept = vi.fn();
    renderRow(job(), onAccept);
    const main = screen.getByRole("button", { name: "Stop on this device: Weekly review" });
    fireEvent.pointerDown(main);
    fireEvent.pointerCancel(main);
    act(() => { localStorage.removeItem(ACCEPTANCE_KEY); window.dispatchEvent(new StorageEvent("storage", { key: ACCEPTANCE_KEY })); });
    fireEvent.keyDown(main, { key: "Enter" });
    fireEvent.click(main);
    expect(onAccept).toHaveBeenCalledTimes(1);
  });

  it("keeps focus on the action button when Accept turns into Stop", async () => {
    const user = userEvent.setup();
    renderRow(job());
    await user.tab();
    const accept = screen.getByRole("button", { name: "Accept: Weekly review" });
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
    expect(screen.getByRole("status")).toHaveTextContent(t("en-US", "scheduledJobAnswerSaveFailed"));
    expect(screen.getByText(t("en-US", "scheduledJobAcceptedHere"))).toBeInTheDocument();
  });

  describe("while this tab's own edit of the job saves", () => {
    const edited = job({ instruction: "Look at costs" });
    beforeEach(() => { noteOwnEdit("job-key-1", edited, null, "none"); });
    afterEach(() => forgetOwnEdit("job-key-1"));

    it("reads the answer for the version being saved, and Stop stops that version", () => {
      acceptJob(edited); // what the edit recorded when it was called
      renderRow(job());
      expect(screen.getByText(t("en-US", "scheduledJobAcceptedHere"))).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Stop on this device: Weekly review" }));
      expect(acceptanceState(edited)).toBe("declined");
    });

    it("Not on this device declines the version being saved", () => {
      acceptJob(job({ instruction: "Older" }));
      // An own edit whose answer the user has since replaced is no longer the target: the row reads its own version.
      renderRow(job());
      expect(screen.getByText(t("en-US", "scheduledJobChanged"))).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Not on this device: Weekly review" }));
      expect(acceptanceState(job())).toBe("declined");
    });

    it("a stopped edited version offers Accept and Not on this device is absent", () => {
      declineJob(edited);
      renderRow(job());
      expect(screen.getByText(t("en-US", "scheduledJobStoppedHere"))).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Not on this device: Weekly review" })).toBeNull();
    });
  });

  describe("Not on this device", () => {
    const decline = { name: "Not on this device: Weekly review" };

    it("from none: declines, drops the button and moves focus to the main button", async () => {
      const user = userEvent.setup();
      renderRow(job());
      await user.click(screen.getByRole("button", decline));
      expect(screen.getByText(t("en-US", "scheduledJobStoppedHere"))).toBeInTheDocument();
      expect(screen.queryByRole("button", decline)).toBeNull();
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "Accept: Weekly review" }));
    });

    it("from changed: the same", async () => {
      const user = userEvent.setup();
      acceptJob(job({ instruction: "Something else" }));
      renderRow(job());
      await user.click(screen.getByRole("button", decline));
      expect(screen.getByText(t("en-US", "scheduledJobStoppedHere"))).toBeInTheDocument();
      expect(screen.queryByRole("button", decline)).toBeNull();
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "Accept: Weekly review" }));
    });

    it("a decline that cannot be recorded says so and changes nothing", () => {
      renderRow(job());
      vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw new Error("quota");
      });
      fireEvent.click(screen.getByRole("button", decline));
      expect(screen.getByRole("status")).toHaveTextContent(t("en-US", "scheduledJobAnswerSaveFailed"));
      expect(screen.getByText(t("en-US", "scheduledJobNeedsOk"))).toBeInTheDocument();
      expect(screen.getByRole("button", decline)).toBeInTheDocument();
    });

    it("is absent when accepted, when declined and without a project", () => {
      acceptJob(job());
      const first = renderRow(job());
      expect(screen.queryByRole("button", decline)).toBeNull();
      first.unmount();
      localStorage.removeItem(ACCEPTANCE_KEY);
      declineJob(job());
      const second = renderRow(job());
      expect(screen.queryByRole("button", decline)).toBeNull();
      second.unmount();
      renderRow(job({ projectId: null }));
      expect(screen.queryByRole("button", decline)).toBeNull();
    });
  });

  it("a declined job that changed reads changed elsewhere and offers both buttons", () => {
    declineJob(job({ instruction: "Something else" }));
    renderRow(job());
    expect(screen.getByText(t("en-US", "scheduledJobChangedElsewhere"))).toBeInTheDocument();
    expect(screen.queryByText(t("en-US", "scheduledJobChanged"))).toBeNull();
    expect(screen.getByRole("button", { name: "Accept: Weekly review" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Not on this device: Weekly review" })).toBeInTheDocument();
  });

  it("while an Accept is pending the main button is aria-disabled and ignores clicks", () => {
    const onAccept = vi.fn();
    renderRow(job(), onAccept, null, true);
    const main = screen.getByRole("button", { name: "Accept: Weekly review" });
    expect(main).toHaveAttribute("aria-disabled", "true");
    expect(main).not.toBeDisabled();
    expect(main.className).toContain("aria-disabled:opacity-50");
    expect(main.className).toContain("aria-disabled:cursor-wait");
    fireEvent.click(main);
    expect(onAccept).not.toHaveBeenCalled();
  });

  it("while an Accept is pending the decline button is aria-disabled too and ignores clicks", () => {
    renderRow(job(), acceptJob, null, true);
    const decline = screen.getByRole("button", { name: "Not on this device: Weekly review" });
    expect(decline).toHaveAttribute("aria-disabled", "true");
    expect(decline.className).toContain("aria-disabled:opacity-50");
    fireEvent.click(decline);
    expect(screen.getByText(t("en-US", "scheduledJobNeedsOk"))).toBeInTheDocument();
    expect(screen.queryByText(t("en-US", "scheduledJobStoppedHere"))).toBeNull();
  });

  it("an accepted job shows no stale Accept notice but keeps its status element, empty", () => {
    acceptJob(job());
    renderRow(job(), acceptJob, "changed");
    const region = screen.getByRole("status");
    expect(region).toBeEmptyDOMElement();
    expect(screen.queryByText(t("en-US", "scheduledJobAcceptChanged"))).toBeNull();
  });

  it("an unassigned job with no creator still has its status element and shows a notice", () => {
    renderRow(job({ projectId: null }), acceptJob, "changed");
    expect(screen.getByRole("status")).toHaveTextContent(t("en-US", "scheduledJobAcceptChanged"));
  });

  it("the status element keeps its identity when the project is assigned", () => {
    const el = (j: ScheduledJob) => (
      <ul>
        <JobRow
          lang="en-US"
          job={j}
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
          acceptNotice="changed"
        />
      </ul>
    );
    const view = render(el(job({ projectId: null })));
    const region = screen.getByRole("status");
    expect(region).toHaveTextContent(t("en-US", "scheduledJobAcceptChanged"));
    view.rerender(el(job({ projectId: "p1" })));
    expect(screen.getByRole("status")).toBe(region);
    expect(region).toHaveTextContent(t("en-US", "scheduledJobAcceptChanged"));
  });

  it("the wrapper pulls back the row gap only when there is no line and no notice", () => {
    const bare = renderRow(job({ projectId: null }));
    expect(screen.getByRole("status").parentElement?.className).toContain("-mt-2");
    bare.unmount();
    const noLine = renderRow(job({ projectId: null }), acceptJob, "changed");
    expect(screen.getByRole("status").parentElement?.className ?? "").not.toContain("-mt-2");
    expect(screen.getByRole("status").className).not.toContain("mt-2");
    noLine.unmount();
    const withNotice = renderRow(job(), acceptJob, "changed");
    expect(screen.getByRole("status").parentElement?.className ?? "").not.toContain("-mt-2");
    expect(screen.getByRole("status").className).toContain("mt-2");
    withNotice.unmount();
    renderRow(job());
    expect(screen.getByRole("status").parentElement?.className ?? "").not.toContain("-mt-2");
    expect(screen.getByRole("status").className).not.toContain("mt-2");
  });

  it("the status element is not a direct child of the row and shares the line's wrapper", () => {
    const { container } = renderRow(job());
    const region = screen.getByRole("status");
    const li = container.querySelector("li") as HTMLElement;
    expect(region.parentElement).not.toBe(li);
    expect(region.parentElement?.parentElement).toBe(li);
    expect(screen.getByText(t("en-US", "scheduledJobNeedsOk")).parentElement?.parentElement).toBe(region.parentElement);
  });

  it("without a pending Accept there is no aria-disabled", () => {
    renderRow(job());
    expect(screen.getByRole("button", { name: "Accept: Weekly review" })).not.toHaveAttribute("aria-disabled");
  });

  it("Accept on a switched-off job is secondary, on a running one primary", () => {
    const off = renderRow(job({ enabled: false }));
    expect(screen.getByRole("button", { name: "Accept: Weekly review" }).className).toContain("bg-surface");
    off.unmount();
    renderRow(job());
    expect(screen.getByRole("button", { name: "Accept: Weekly review" }).className).toContain("bg-ui-dark-blue");
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
