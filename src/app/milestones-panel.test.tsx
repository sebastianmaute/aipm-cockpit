import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { useEffect, type ReactNode } from "react";
import { FiltersProvider } from "./filters-context";
import { WorkspaceProvider, useWorkspace } from "./workspace-context";
import { WorkspaceTabProvider } from "./workspace-tab-context";
import { MilestonesPanel } from "./milestones-panel";
import { t } from "./i18n";
import type { Milestone } from "./types";

vi.mock("./activity-log", async (orig) => ({
  ...(await orig<typeof import("./activity-log")>()),
  loadActivityLog: () => [],
}));

function wrapper({ children }: { children: ReactNode }) {
  return (
    <FiltersProvider>
      <WorkspaceProvider>
        <WorkspaceTabProvider>{children}</WorkspaceTabProvider>
      </WorkspaceProvider>
    </FiltersProvider>
  );
}

const baseProps = {
  lang: "en-US" as const,
  today: "2026-06-02",
  holidaySet: new Set<string>(),
};

// --- Test helpers -----------------------------------------------------------

/** Milestone factory — produces a valid Milestone with sensible defaults. */
function m(name: string, date: string, extra: Partial<Milestone> = {}): Milestone {
  return { id: extra.id ?? Math.abs(hashId(name)), name, date, linkedTaskIds: [], ...extra };
}

function hashId(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h || 1;
}

/** Seeds the workspace with milestones via the real setter on mount. */
function Seed({ milestones }: { milestones: readonly Milestone[] }) {
  const { setMilestones } = useWorkspace();
  useEffect(() => {
    setMilestones([...milestones]);
  }, [milestones, setMilestones]);
  return null;
}

function renderMilestones({
  milestones = [],
  today = "2026-06-02",
}: {
  milestones?: readonly Milestone[];
  today?: string;
} = {}) {
  return render(
    <>
      <Seed milestones={milestones} />
      <MilestonesPanel lang="en-US" today={today} holidaySet={new Set()} />
    </>,
    { wrapper },
  );
}

describe("MilestonesPanel", () => {
  it("renders empty milestones without crashing", () => {
    const { container } = render(
      <MilestonesPanel
        lang="en-US"
        today="2026-06-02"
        holidaySet={new Set()}
      />,
      { wrapper },
    );
    expect(container).toBeTruthy();
  });

  it("shows empty state message when there are no milestones", () => {
    const { getByText } = render(
      <MilestonesPanel
        lang="en-US"
        today="2026-06-02"
        holidaySet={new Set()}
      />,
      { wrapper },
    );
    // The milestonesEmpty i18n key should be visible
    expect(getByText("No milestones yet.")).toBeTruthy();
  });

  it("opens the create modal when openCreateNonce increments, not on a 0 mount", () => {
    const { rerender } = render(
      <MilestonesPanel {...baseProps} openCreateNonce={0} />,
      { wrapper },
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    rerender(<MilestonesPanel {...baseProps} openCreateNonce={1} />);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("opens the create modal when it mounts with a positive nonce (Gantt → Milestones)", () => {
    // The Gantt 'Add milestone' click bumps the nonce AND switches the tab, so
    // this panel mounts fresh with the nonce already > 0. It must still open and
    // report the request consumed (so a stale nonce does not re-open on remount).
    const onCreateConsumed = vi.fn();
    render(
      <MilestonesPanel {...baseProps} openCreateNonce={1} onCreateConsumed={onCreateConsumed} />,
      { wrapper },
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(onCreateConsumed).toHaveBeenCalled();
  });

  it("re-mints a create whose open-time id was taken by a concurrent commit — no clobber (id-mint race)", () => {
    const seeded = (extra: readonly Milestone[]) => (
      <>
        <Seed milestones={[m("Existing", "2026-06-10", { id: 1 }), ...extra]} />
        <MilestonesPanel {...baseProps} />
      </>
    );
    const { rerender } = render(seeded([]), { wrapper });
    // Open the create modal — it drafts id nextId([1]) = 2.
    fireEvent.click(screen.getByRole("button", { name: /new milestone/i }));
    const dialog = screen.getByRole("dialog");
    // A concurrent writer commits a milestone at id 2 while the modal is open.
    rerender(seeded([m("Concurrent", "2026-06-11", { id: 2 })]));
    // Name and save the new milestone.
    fireEvent.change(within(dialog).getAllByRole("textbox")[0], { target: { value: "Fresh" } });
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "milestoneSave") }));
    // All three survive: the create got a fresh id instead of clobbering id 2.
    expect(screen.getByText("Existing")).toBeInTheDocument();
    expect(screen.getByText("Concurrent")).toBeInTheDocument();
    expect(screen.getByText("Fresh")).toBeInTheDocument();
  });

  it("renders the New milestone button at the left, styled like Gantt (solid dark-blue)", () => {
    // Render WITH a milestone so the empty-state clickable box (which also
    // contains "+ New milestone…") isn't present to make the query ambiguous.
    renderMilestones({ milestones: [m("Alpha", "2026-06-10")] });
    const btn = screen.getByRole("button", { name: /new milestone/i });
    expect(btn.className).toContain("bg-AIPM-dark-blue");
    expect(btn.className).toContain("text-white");
  });

  it("filters milestones by name search", () => {
    renderMilestones({ milestones: [m("Alpha", "2026-06-10"), m("Beta", "2026-06-11")] });
    fireEvent.change(
      screen.getByPlaceholderText(t("en-US", "milestonesFilterName")),
      { target: { value: "alpha" } },
    );
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.queryByText("Beta")).not.toBeInTheDocument();
  });

  it("filters milestones by status", () => {
    renderMilestones({
      today: "2026-06-05",
      milestones: [m("Future", "2026-06-10"), m("Late", "2026-06-01")],
    });
    fireEvent.change(
      screen.getByLabelText(t("en-US", "milestonesFilterStatus")),
      { target: { value: "overdue" } },
    );
    expect(screen.getByText("Late")).toBeInTheDocument();
    expect(screen.queryByText("Future")).not.toBeInTheDocument();
  });

  it("name button uses the workload hover style", () => {
    renderMilestones({ milestones: [m("Alpha", "2026-06-10")] });
    const btn = screen.getByRole("button", { name: "Alpha" });
    expect(btn.className).toContain("hover:border-AIPM-dark-blue");
  });

  it("renders resizable column headers", () => {
    const { container } = renderMilestones({ milestones: [m("Alpha", "2026-06-10")] });
    expect(container.querySelectorAll(".cursor-col-resize").length).toBeGreaterThan(0);
  });

  it("root fills the pane full-width (VIEW_PANE_RESIZABLE_CLASS: h-full, w-full, resize)", () => {
    const { container } = renderMilestones();
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain("h-full");
    expect(root.className).toContain("w-full");
    expect(root.className).toContain("resize");
    expect(root.className).not.toContain("w-[50%]");
  });

  it("renders a Push-to-Outlook button when onPushToOutlook is provided and calls it on click", () => {
    const onPushToOutlook = vi.fn();
    render(
      <>
        <Seed milestones={[m("Alpha", "2026-06-10")]} />
        <MilestonesPanel
          {...baseProps}
          onPushToOutlook={onPushToOutlook}
        />
      </>,
      { wrapper },
    );
    const btn = screen.getByRole("button", {
      name: t("en-US", "calendarPush"),
    });
    fireEvent.click(btn);
    expect(onPushToOutlook).toHaveBeenCalledTimes(1);
  });

  it("does not render a Push-to-Outlook button when onPushToOutlook is absent", () => {
    renderMilestones({ milestones: [m("Alpha", "2026-06-10")] });
    expect(
      screen.queryByRole("button", { name: t("en-US", "calendarPush") }),
    ).not.toBeInTheDocument();
  });

  it("shows the busy label and disables the Push-to-Outlook button when calendarPushBusy", () => {
    render(
      <>
        <Seed milestones={[m("Alpha", "2026-06-10")]} />
        <MilestonesPanel
          {...baseProps}
          onPushToOutlook={vi.fn()}
          calendarPushBusy
        />
      </>,
      { wrapper },
    );
    const btn = screen.getByRole("button", {
      name: t("en-US", "calendarPushing"),
    });
    expect(btn).toBeDisabled();
  });

  it("renders a Pull-from-Outlook button when onPullFromOutlook is provided and calls it on click", () => {
    const onPullFromOutlook = vi.fn();
    render(
      <>
        <Seed milestones={[m("Alpha", "2026-06-10")]} />
        <MilestonesPanel
          {...baseProps}
          onPullFromOutlook={onPullFromOutlook}
        />
      </>,
      { wrapper },
    );
    const btn = screen.getByRole("button", {
      name: t("en-US", "calendarPull"),
    });
    fireEvent.click(btn);
    expect(onPullFromOutlook).toHaveBeenCalledTimes(1);
  });

  it("does not render a Pull-from-Outlook button when onPullFromOutlook is absent", () => {
    renderMilestones({ milestones: [m("Alpha", "2026-06-10")] });
    expect(
      screen.queryByRole("button", { name: t("en-US", "calendarPull") }),
    ).not.toBeInTheDocument();
  });

  it("shows the busy label and disables the Pull-from-Outlook button when calendarPullBusy", () => {
    render(
      <>
        <Seed milestones={[m("Alpha", "2026-06-10")]} />
        <MilestonesPanel
          {...baseProps}
          onPullFromOutlook={vi.fn()}
          calendarPullBusy
        />
      </>,
      { wrapper },
    );
    const btn = screen.getByRole("button", {
      name: t("en-US", "calendarPulling"),
    });
    expect(btn).toBeDisabled();
  });

  it("renders a per-row Ask-Claude button when onAiEdit + aiEditEnabled(true) and calls onAiEdit with the milestone", () => {
    const onAiEdit = vi.fn();
    render(
      <>
        <Seed milestones={[m("Alpha", "2026-06-10", { id: 1 })]} />
        <MilestonesPanel
          {...baseProps}
          onAiEdit={onAiEdit}
          aiEditEnabled={() => true}
        />
      </>,
      { wrapper },
    );
    // Row-unique accessible name: "Ask Claude – Alpha".
    const btn = screen.getByRole("button", {
      name: `${t("en-US", "inlineAiEdit")} – Alpha`,
    });
    fireEvent.click(btn);
    expect(onAiEdit).toHaveBeenCalledTimes(1);
    expect(onAiEdit.mock.calls[0][0]).toMatchObject({ id: 1, name: "Alpha" });
  });

  it("does not render the per-row Ask-Claude button when aiEditEnabled returns false", () => {
    render(
      <>
        <Seed milestones={[m("Alpha", "2026-06-10", { id: 1 })]} />
        <MilestonesPanel
          {...baseProps}
          onAiEdit={vi.fn()}
          aiEditEnabled={() => false}
        />
      </>,
      { wrapper },
    );
    expect(
      screen.queryByRole("button", { name: /ask claude/i }),
    ).not.toBeInTheDocument();
  });
});

describe("Milestones bulk edit", () => {
  it("applies a bulk target-date change to the selected row via setMilestones", () => {
    renderMilestones({ milestones: [m("Alpha", "2026-06-10", { id: 1 })] });

    // select the row
    fireEvent.click(
      screen.getByRole("checkbox", { name: t("en-US", "selectItem", "Alpha") }),
    );
    // open the bulk panel
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "bulkEdit") }));
    // enable Target date (checkbox name = the date label) + set a new date.
    // The date input shares its aria-label with the column header sort button,
    // so disambiguate the input by the bulk control's id.
    fireEvent.click(
      screen.getByRole("checkbox", { name: t("en-US", "milestoneDate") }),
    );
    const dateInput = document.getElementById("bulk-date") as HTMLInputElement;
    fireEvent.change(dateInput, { target: { value: "2026-07-15" } });
    fireEvent.click(
      screen.getByRole("button", { name: t("en-US", "bulkApplyCount", "1") }),
    );

    // The new date is persisted through the same setMilestones save path.
    expect(screen.getByText("2026-07-15")).toBeInTheDocument();
    expect(screen.queryByText("2026-06-10")).not.toBeInTheDocument();
  });
});
