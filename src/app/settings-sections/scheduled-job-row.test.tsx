import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { JobRow } from "./scheduled-job-row";
import { t } from "../i18n";
import type { ScheduledJob } from "../scheduled-jobs/types";
import {
  __resetEditedHereForTests, ACCEPTANCE_KEY, acceptanceState, acceptJob, declineJob, isEditedHere, jobFingerprint, markEditedHere,
} from "../scheduled-job-acceptance";

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
  saving = false,
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
        saving={saving}
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

  describe("while a save of the job is in flight", () => {
    const saving = (j: ScheduledJob, onAccept: (job: ScheduledJob) => void) => renderRow(j, onAccept, null, false, true);

    it("both answer buttons read Saving…, are aria-disabled and ignore clicks", () => {
      const onAccept = vi.fn();
      saving(job(), onAccept);
      const main = screen.getByRole("button", { name: "Saving… Accept: Weekly review" });
      const decline = screen.getByRole("button", { name: "Saving… Not on this device: Weekly review" });
      for (const b of [main, decline]) {
        expect(b).toHaveTextContent(t("en-US", "scheduledJobSaving"));
        expect(b).toHaveAttribute("aria-disabled", "true");
        fireEvent.click(b);
      }
      expect(onAccept).not.toHaveBeenCalled();
      expect(acceptanceState(job())).toBe("none");
      expect(screen.getByText(t("en-US", "scheduledJobNeedsOk"))).toBeInTheDocument(); // the status text stays
    });

    it("an accepted job's Stop ignores clicks while saving", () => {
      acceptJob(job());
      saving(job(), vi.fn());
      fireEvent.click(screen.getByRole("button", { name: "Saving… Stop on this device: Weekly review" }));
      expect(acceptanceState(job())).toBe("accepted");
    });

    it("when the save ends the focused button keeps focus and its name becomes the answer again", () => {
      const view = saving(job(), vi.fn());
      const main = screen.getByRole("button", { name: "Saving… Accept: Weekly review" });
      main.focus();
      view.rerender(
        <ul>
          <JobRow lang="en-US" job={job()} token="Weekly review" busy={false} tz="UTC" projects={[{ id: "p1", name: "Alpha" }]}
            archivedProjects={[]} projectsLoaded zones={["UTC"]} defaultZone="UTC" onUpdate={vi.fn()} onAssign={vi.fn()}
            onDelete={vi.fn()} onAccept={vi.fn()} saving={false} />
        </ul>,
      );
      expect(main).toHaveAccessibleName("Accept: Weekly review");
      expect(main).not.toHaveAttribute("aria-disabled");
      expect(document.activeElement).toBe(main);
    });

    it("a mouse press does not take focus from the field being edited", () => {
      renderRow(job());
      const field = screen.getByRole("textbox", { name: `${t("en-US", "scheduledJobInstruction")} – Weekly review` });
      field.focus();
      const pressed = fireEvent.mouseDown(screen.getByRole("button", { name: "Accept: Weekly review" }));
      expect(pressed).toBe(false); // default prevented: the browser keeps focus in the field
      expect(fireEvent.mouseDown(screen.getByRole("button", { name: "Not on this device: Weekly review" }))).toBe(false);
    });

    it("a press is ignored when the job's version changed between press and release", () => {
      acceptJob(job());
      const onAccept = vi.fn();
      const view = renderRow(job(), onAccept);
      const main = screen.getByRole("button", { name: "Stop on this device: Weekly review" });
      fireEvent.pointerDown(main);
      view.rerender(
        <ul>
          <JobRow lang="en-US" job={job({ instruction: "Changed" })} token="Weekly review" busy={false} tz="UTC"
            projects={[{ id: "p1", name: "Alpha" }]} archivedProjects={[]} projectsLoaded zones={["UTC"]} defaultZone="UTC"
            onUpdate={vi.fn()} onAssign={vi.fn()} onDelete={vi.fn()} onAccept={onAccept} />
        </ul>,
      );
      fireEvent.click(main);
      expect(onAccept).not.toHaveBeenCalled();
      expect(acceptanceState(job())).toBe("accepted");
    });

    it("a press that began while saving does nothing, even when the save ends before the click", () => {
      const onAccept = vi.fn();
      const view = saving(job(), onAccept);
      fireEvent.pointerDown(screen.getByRole("button", { name: "Saving… Accept: Weekly review" }));
      fireEvent.pointerDown(screen.getByRole("button", { name: "Saving… Not on this device: Weekly review" }));
      view.rerender(
        <ul>
          <JobRow lang="en-US" job={job()} token="Weekly review" busy={false} tz="UTC" projects={[{ id: "p1", name: "Alpha" }]}
            archivedProjects={[]} projectsLoaded zones={["UTC"]} defaultZone="UTC" onUpdate={vi.fn()} onAssign={vi.fn()}
            onDelete={vi.fn()} onAccept={onAccept} saving={false} />
        </ul>,
      );
      fireEvent.click(screen.getByRole("button", { name: "Accept: Weekly review" }));
      fireEvent.click(screen.getByRole("button", { name: "Not on this device: Weekly review" }));
      expect(onAccept).not.toHaveBeenCalled();
      expect(acceptanceState(job())).toBe("none");
      // The next press, made after the save, works.
      fireEvent.pointerDown(screen.getByRole("button", { name: "Accept: Weekly review" }));
      fireEvent.click(screen.getByRole("button", { name: "Accept: Weekly review" }));
      expect(onAccept).toHaveBeenCalledTimes(1);
    });
  });

  describe("a job this tab changed", () => {
    afterEach(() => __resetEditedHereForTests());
    const markShown = () => markEditedHere("job-key-1", jobFingerprint(job()));

    it("a job this device had accepted reads You changed this job: accept it again", () => {
      acceptJob(job({ instruction: "Before" }));
      markShown();
      renderRow(job());
      expect(screen.getByText(t("en-US", "scheduledJobChangedHere"))).toBeInTheDocument();
      expect(screen.queryByText(t("en-US", "scheduledJobChanged"))).toBeNull();
    });

    it("a job this device had stopped reads You changed this job: accept it (never 'again')", () => {
      declineJob(job({ instruction: "Before" }));
      markShown();
      renderRow(job());
      expect(screen.getByText(t("en-US", "scheduledJobChangedHereStopped"))).toBeInTheDocument();
      expect(screen.queryByText(t("en-US", "scheduledJobChangedHere"))).toBeNull();
      expect(screen.queryByText(t("en-US", "scheduledJobChangedElsewhere"))).toBeNull();
    });

    it("a later change from another device reads as such again", () => {
      acceptJob(job({ instruction: "Before" }));
      markShown();
      renderRow(job({ instruction: "Changed elsewhere" }));
      expect(screen.getByText(t("en-US", "scheduledJobChanged"))).toBeInTheDocument();
      expect(screen.queryByText(t("en-US", "scheduledJobChangedHere"))).toBeNull();
    });

    it("a later change from another device of a stopped job reads changed on another device again", () => {
      declineJob(job({ instruction: "Before" }));
      markShown();
      renderRow(job({ instruction: "Changed elsewhere" }));
      expect(screen.getByText(t("en-US", "scheduledJobChangedElsewhere"))).toBeInTheDocument();
    });

    it("the mark only changes the wording of a changed job", () => {
      acceptJob(job());
      markShown();
      renderRow(job());
      expect(screen.getByText(t("en-US", "scheduledJobAcceptedHere"))).toBeInTheDocument();
    });

    it("answering ends the mark", () => {
      acceptJob(job({ instruction: "Before" }));
      markShown();
      renderRow(job());
      fireEvent.click(screen.getByRole("button", { name: "Not on this device: Weekly review" }));
      expect(screen.getByText(t("en-US", "scheduledJobStoppedHere"))).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Accept: Weekly review" }));
      expect(screen.getByText(t("en-US", "scheduledJobAcceptedHere"))).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Stop on this device: Weekly review" }));
      expect(isEditedHere(job())).toBe(false);
    });
  });

  describe("Not on this device", () => {
    const decline = { name: "Not on this device: Weekly review" };

    it("from none, by keyboard: declines, drops the button and moves focus to the main button", async () => {
      const user = userEvent.setup();
      renderRow(job());
      screen.getByRole("button", decline).focus();
      await user.keyboard("{Enter}");
      expect(screen.getByText(t("en-US", "scheduledJobStoppedHere"))).toBeInTheDocument();
      expect(screen.queryByRole("button", decline)).toBeNull();
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "Accept: Weekly review" }));
    });

    it("by mouse: declines and leaves focus where it was (the press never took it)", async () => {
      const user = userEvent.setup();
      renderRow(job());
      const name = screen.getByRole("textbox", { name: `${t("en-US", "scheduledJobName")} – Weekly review` });
      name.focus();
      await user.click(screen.getByRole("button", decline));
      expect(screen.getByText(t("en-US", "scheduledJobStoppedHere"))).toBeInTheDocument();
      expect(document.activeElement).toBe(name);
    });

    it("from changed, by keyboard: the same", async () => {
      const user = userEvent.setup();
      acceptJob(job({ instruction: "Something else" }));
      renderRow(job());
      screen.getByRole("button", decline).focus();
      await user.keyboard("{Enter}");
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
