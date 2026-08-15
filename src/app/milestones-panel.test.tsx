import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { __resetMintStateForTests } from "./id-mint-session";
import { useEffect, type ReactNode } from "react";
import { FiltersProvider } from "./filters-context";
import { WorkspaceProvider, useWorkspace } from "./workspace-context";
import { WorkspaceTabProvider, useWorkspaceTab } from "./workspace-tab-context";
import { indexDocumentsByEntity, type DocEntityRef } from "./document-ref";
import type { ProjectDocument } from "./document-model";
import { ToastProvider } from "./toast-context";
import { MilestonesPanel } from "./milestones-panel";
import { t } from "./i18n";
import type { Milestone } from "./types";

// Milestone ids are minted from session-scoped state; reset it before each test
// so the id-mint-race draft ("nextId([1]) = 2") stays deterministic.
beforeEach(() => {
  __resetMintStateForTests();
});

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

  it("surfaces a toast when the edited milestone was concurrently deleted", () => {
    const showToast = vi.fn();
    const seeded = (ms: readonly Milestone[]) => (
      <ToastProvider value={{ showToast, showToastAction: showToast }}>
        <Seed milestones={ms} />
        <MilestonesPanel {...baseProps} />
      </ToastProvider>
    );
    const doomed = m("Doomed", "2026-06-10", { id: 1 });
    const { rerender } = render(seeded([doomed]), { wrapper });
    // Open the milestone's editor (isNew=false).
    fireEvent.click(screen.getByRole("button", { name: "Doomed" }));
    // A concurrent writer deletes it while the modal is open.
    rerender(seeded([]));
    // Save → the row is gone; the edit must surface a toast, not vanish silently.
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "milestoneSave") }));
    expect(showToast).toHaveBeenCalledWith("error", expect.any(String));
  });

  it("renders the New milestone button at the left, styled like Gantt (solid dark-blue)", () => {
    // Render WITH a milestone so the empty-state clickable box (which also
    // contains "+ New milestone…") isn't present to make the query ambiguous.
    renderMilestones({ milestones: [m("Alpha", "2026-06-10")] });
    const btn = screen.getByRole("button", { name: /new milestone/i });
    expect(btn.className).toContain("bg-ui-dark-blue");
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
    expect(btn.className).toContain("hover:border-ui-dark-blue");
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

  it("captures a per-field undo entry when a milestone's name is edited and saved", () => {
    const captureFieldEdit = vi.fn();
    const seeded = m("Original", "2026-06-10", { id: 1 });
    render(
      <>
        <Seed milestones={[seeded]} />
        <MilestonesPanel {...baseProps} captureFieldEdit={captureFieldEdit} />
      </>,
      { wrapper },
    );
    // Open the milestone's editor (isNew=false).
    fireEvent.click(screen.getByRole("button", { name: "Original" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getAllByRole("textbox")[0], {
      target: { value: "Renamed" },
    });
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "milestoneSave") }));

    expect(captureFieldEdit).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "milestone.updated",
        id: 1,
        before: { name: "Original" },
        after: { name: "Renamed" },
      }),
    );
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

describe("achieved toggle", () => {
  // ★★ Two milestones in the first test, not one — but NOT because a generic
  //    label would be ambiguous: `getByRole` with a STRING name is an exact
  //    full-name match, so a generic `aria-label="Achieved"` already fails at
  //    one row. What the second row buys is killing a HARDCODED suffix — an
  //    `aria-label={`${t(lang,"milestoneAchieved")} – Kickoff`}` baked into the
  //    cell passes a one-row fixture and fails here on "Go live".
  it("renders a toggle button with a row-unique name", () => {
    renderMilestones({
      milestones: [
        m("Kickoff", "2026-01-15"),
        m("Go live", "2026-06-30", { achievedDate: "2026-06-28" }),
      ],
    });

    const kickoff = screen.getByRole("button", {
      name: `${t("en-US", "milestoneAchieved")} – Kickoff`,
    });
    const golive = screen.getByRole("button", {
      name: `${t("en-US", "milestoneAchieved")} – Go live`,
    });

    expect(kickoff).toHaveAttribute("aria-pressed", "false");
    expect(golive).toHaveAttribute("aria-pressed", "true");
    // ★ The old markup was a checkbox; assert that role is gone so a revert fails.
    expect(screen.queryByRole("checkbox", { name: /achieved/i })).toBeNull();
  });

  // ★ Asserts the RENDERED state flips, not that a setter was called.
  //   `renderMilestones` seeds through the workspace provider, so a spy on the
  //   setter would pin the wiring rather than the behaviour.
  it("flips to pressed when clicked", () => {
    renderMilestones({ milestones: [m("Kickoff", "2026-01-15")] });
    const name = `${t("en-US", "milestoneAchieved")} – Kickoff`;
    fireEvent.click(screen.getByRole("button", { name }));
    expect(screen.getByRole("button", { name })).toHaveAttribute("aria-pressed", "true");
  });

  // ★★ The other direction. Without this, `toggleAchieved` (milestones-panel.tsx)
  //    setting `achievedDate: today` UNCONDITIONALLY — i.e. dropping the
  //    `x.achievedDate ? undefined :` branch — survives the whole suite, so
  //    "un-achieve a milestone" could be entirely broken and the gate green.
  it("flips back to unpressed when an achieved milestone is clicked", () => {
    renderMilestones({
      milestones: [m("Go live", "2026-06-30", { achievedDate: "2026-06-28" })],
    });
    const name = `${t("en-US", "milestoneAchieved")} – Go live`;
    expect(screen.getByRole("button", { name })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name }));
    expect(screen.getByRole("button", { name })).toHaveAttribute("aria-pressed", "false");
  });
});

// --- linked-documents badge ------------------------------------------------

describe("MilestonesPanel linked-documents badge", () => {
  /** Renders `activeTab` so the badge click is asserted on OBSERVABLE STATE —
   *  the view the app actually switched to — not on a spied callback. */
  function ActiveTabProbe() {
    const { activeTab, pendingDocEntityFilter } = useWorkspaceTab();
    return (
      <>
        <span data-testid="active-tab">{activeTab}</span>
        {/* ★★ The KIND matters and was unpinned: asserting only that the view
            became "documents" is green even when a panel passes the WRONG kind
            (the copy-paste available across three near-identical call sites
            written in one sitting), which would filter the pane to nothing. */}
        <span data-testid="pending-doc-filter">
          {pendingDocEntityFilter ? `${pendingDocEntityFilter.kind}:${pendingDocEntityFilter.id}` : "none"}
        </span>
      </>
    );
  }

  function doc(id: number, links: DocEntityRef[]): ProjectDocument {
    return { id, title: `Doc ${id}`, blocks: [], createdAt: "2026-06-01T00:00:00.000Z", updatedAt: "2026-06-01T00:00:00.000Z", linkedEntities: links };
  }

  // THREE rows on purpose. Two carry a badge, so a name that omitted the row
  // qualifier would collide (WCAG 2.4.6) — a unit test rendering >=2 rows is the
  // ONLY detector, axe has no rule for it at any seed size. Their counts DIFFER
  // (2 vs 1) so a hardcoded count cannot pass, and the third row is unreferenced
  // so a lookup ignoring the key would badge it too.
  const milestones = [
    m("Alpha gate", "2026-07-01", { id: 1 }),
    m("Beta gate", "2026-07-02", { id: 2 }),
    m("Gamma gate", "2026-07-03", { id: 3 }),
  ];
  const documentsByEntity = indexDocumentsByEntity([
    doc(10, [{ kind: "milestone", id: 1 }, { kind: "milestone", id: 2 }]),
    doc(11, [{ kind: "milestone", id: 1 }]),
    // Same numeric id, different kind: ids collide across kinds, so a key built
    // from the id alone would inflate Alpha's count to 3.
    doc(12, [{ kind: "raid", id: 1 }]),
  ]);

  function renderWithProbe() {
    return render(
      <>
        <Seed milestones={milestones} />
        <ActiveTabProbe />
        <MilestonesPanel
          lang="en-US"
          today="2026-06-02"
          holidaySet={new Set()}
          documentsByEntity={documentsByEntity}
        />
      </>,
      { wrapper },
    );
  }

  it("badges only the referenced rows, with the real count and a row-unique name", () => {
    renderWithProbe();
    const badges = screen.getAllByRole("button", { name: /^Referenced by/ });
    expect(badges.map((b) => b.getAttribute("aria-label"))).toEqual([
      "Referenced by 2 document(s) – Alpha gate",
      "Referenced by 1 document(s) – Beta gate",
    ]);
  });

  it("clicking the badge switches the app to the Documents view", () => {
    renderWithProbe();
    expect(screen.getByTestId("active-tab").textContent).toBe("dashboard");
    fireEvent.click(screen.getByRole("button", { name: "Referenced by 2 document(s) – Alpha gate" }));
    expect(screen.getByTestId("active-tab").textContent).toBe("documents");
    expect(screen.getByTestId("pending-doc-filter").textContent).toBe("milestone:1");
  });
});
