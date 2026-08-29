import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within, waitFor } from "@testing-library/react";
import { __resetMintStateForTests } from "./id-mint-session";
import { useEffect, type ReactNode } from "react";
import { FiltersProvider } from "./filters-context";
import { WorkspaceProvider, useWorkspace } from "./workspace-context";
import { WorkspaceTabProvider, useWorkspaceTab } from "./workspace-tab-context";
import { ConfirmProvider } from "./confirm-dialog";
import { indexDocumentsByEntity, type DocEntityRef } from "./document-ref";
import type { ProjectDocument } from "./document-model";
import { ToastProvider } from "./toast-context";
import { MilestonesPanel } from "./milestones-panel";
import { useUndoStack } from "./undo/use-undo-stack";
import { t } from "./i18n";
import type { Milestone } from "./types";
import { expectRowUniqueNames } from "../test/row-unique-names";

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
  allowDestructiveSave,
}: {
  milestones?: readonly Milestone[];
  today?: string;
  allowDestructiveSave?: () => void;
} = {}) {
  return render(
    <ConfirmProvider lang="en-US">
      <Seed milestones={milestones} />
      <MilestonesPanel
        lang="en-US"
        today={today}
        holidaySet={new Set()}
        allowDestructiveSave={allowDestructiveSave}
      />
    </ConfirmProvider>,
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

  /** Select every seeded row, open the bulk panel, tick "Achieved date" and
   *  apply — leaving the date input BLANK, which is the CLEAR case.
   *  `dateField`'s `default` is `""` and the panel maps a blank through
   *  `changes.achievedDate || undefined`, so ticking the box alone IS the
   *  clear; there is no value to type. */
  function bulkClearAchievedDate(names: readonly string[]) {
    for (const name of names) {
      fireEvent.click(screen.getByRole("checkbox", { name: t("en-US", "selectItem", name) }));
    }
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "bulkEdit") }));
    fireEvent.click(screen.getByRole("checkbox", { name: t("en-US", "achievedDate") }));
    fireEvent.click(
      screen.getByRole("button", { name: t("en-US", "bulkApplyCount", String(names.length)) }),
    );
  }

  // The PAYLOAD milestones hand the undo stack was unpinned. The three sibling
  // registers each got this test (`change-panel.test.tsx`, `raid-panel.test.tsx`,
  // `stakeholders-panel.test.tsx` all assert the `onCaptureBulk` argument) and
  // this file got none. ★ Not for want of the prop — `RealUndoHarness` below
  // wires the REAL `captureFieldRows` — but that test drives undo end-to-end and
  // never looks at the argument, so nothing here described the patch's shape.
  // The CLEAR case is the shape worth describing: it is the only milestone patch
  // whose `after` value is `undefined`.
  it("hands captureFieldRows a patch whose cleared side carries an explicit undefined, not an absent key", () => {
    const captureFieldRows = vi.fn();
    render(
      <>
        <Seed
          milestones={[
            m("Alpha", "2026-06-10", { id: 1, achievedDate: "2026-06-01" }),
            m("Beta", "2026-06-20", { id: 2, achievedDate: "2026-06-05" }),
          ]}
        />
        <MilestonesPanel {...baseProps} captureFieldRows={captureFieldRows} />
      </>,
      { wrapper },
    );

    bulkClearAchievedDate(["Alpha", "Beta"]);

    expect(captureFieldRows).toHaveBeenCalledTimes(1);
    const arg = captureFieldRows.mock.calls[0][0];
    expect(arg.kind).toBe("bulk.edit");
    // `bulk.edit` is entity-AMBIGUOUS — one shared kind across tasks/raid/
    // change/… — so unlike every other kind the undo label cannot be derived
    // from it and each capture site must name its entity explicitly.
    expect(arg.entityKey).toBe("milestone");
    expect(arg.edits.map((e: { id: number }) => e.id)).toEqual([1, 2]);

    for (const e of arg.edits as { id: number; before: Partial<Milestone>; after: Partial<Milestone> }[]) {
      // The patch is the DELTA: `date`, `name` and `linkedTaskIds` are copied
      // through by `{...item}` unchanged, so only the cleared key is captured.
      expect(Object.keys(e.before)).toEqual(["achievedDate"]);
      // ★ ANTI-VACUITY: assert the KEY's presence, not the value. `toEqual`
      // treats `{achievedDate: undefined}` and `{}` as equal, so an assertion
      // written that way passes against a patch that omits the key — and the key
      // is exactly what carries the clear. `captureFieldPart` applies a patch as
      // `{...row, ...pick(edit)}`, and a spread only overwrites keys it HAS: with
      // the key absent, REDO would leave the pre-undo date standing and the redo
      // of a clear would silently do nothing.
      expect(Object.keys(e.after)).toEqual(["achievedDate"]);
      expect(e.after.achievedDate).toBeUndefined();
    }
    expect(arg.edits.find((e: { id: number }) => e.id === 1).before).toEqual({ achievedDate: "2026-06-01" });
    expect(arg.edits.find((e: { id: number }) => e.id === 2).before).toEqual({ achievedDate: "2026-06-05" });
  });

  // ★★★ THE OBSERVABLE HERE IS NOT `localModifiedAt`. Unlike the three other
  // converted registers, `save` in this panel never writes that field at all
  // (`{...next, id}` and nothing else), so an assertion on it would hold whether
  // or not the panel wrote the row. What an unwanted save DOES leave behind is a
  // `milestone.updated` activity entry carrying an EMPTY `diffFields` — an audit
  // row for an edit that changed nothing — plus a map-replace into a fresh array
  // that dirties the workspace and triggers an autosave. The activity call is the
  // one of those two a unit test can name a row from.
  it("neither captures nor logs a selected milestone that already has no achieved date to clear", () => {
    const captureFieldRows = vi.fn();
    const logActivityChanges = vi.fn();
    render(
      <>
        <Seed
          milestones={[
            m("Alpha", "2026-06-10", { id: 1, achievedDate: "2026-06-01" }),
            // Beta has NO `achievedDate`. Clearing it sets the key to `undefined`
            // on a row that already reads `undefined` there, and `{...item}`
            // copies every other key by reference — so Beta's diff is empty and
            // `buildBulkFieldEdits` drops the row.
            m("Beta", "2026-06-20", { id: 2 }),
          ]}
        />
        <MilestonesPanel
          {...baseProps}
          captureFieldRows={captureFieldRows}
          logActivityChanges={logActivityChanges}
        />
      </>,
      { wrapper },
    );

    bulkClearAchievedDate(["Alpha", "Beta"]);

    // Captured: Alpha only.
    expect(captureFieldRows).toHaveBeenCalledTimes(1);
    expect(captureFieldRows.mock.calls[0][0].edits.map((e: { id: number }) => e.id)).toEqual([1]);

    // Written: Alpha only. Reading the ids off EVERY call is what makes this
    // able to fail — with the panel's `wrote.has(after.id)` guard removed the
    // list reads `[1, 2]`, and the extra entry's `changes` is `[]`.
    expect(logActivityChanges.mock.calls.map((c: unknown[]) => c[2])).toEqual([1]);
    expect(logActivityChanges).toHaveBeenCalledWith(
      "milestone.updated",
      [{ field: "achievedDate", from: "2026-06-01", to: "" }],
      1,
    );
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
    expectRowUniqueNames({ minControls: 13 });
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

// --- row-unique names (WCAG 2.4.6, §247/§248) ------------------------------

describe("row-unique names", () => {
  function rowUniqueDoc(id: number, links: DocEntityRef[]): ProjectDocument {
    return { id, title: `Doc ${id}`, blocks: [], createdAt: "2026-06-01T00:00:00.000Z", updatedAt: "2026-06-01T00:00:00.000Z", linkedEntities: links };
  }

  // Two rows sharing a name — the checkbox / name button / Ask-Claude button /
  // DocumentBadge / Achieved toggle all key on m.name, so without a per-row
  // token every one of them would render twice with the identical accessible
  // name. `renderMilestones` cannot exercise all five: InlineAiEditButton is
  // gated on onAiEdit/aiEditEnabled and DocumentBadge returns null at count 0,
  // so this renders inline with those wired, rather than growing the shared
  // helper with parameters no other caller needs.
  it("keeps every per-row control distinct when two rows share a name", () => {
    const milestones = [
      { id: 1, name: "Go live", date: "2026-06-10", linkedTaskIds: [] },
      { id: 2, name: "Go live", date: "2026-06-20", linkedTaskIds: [] },
    ];
    const documentsByEntity = indexDocumentsByEntity([
      rowUniqueDoc(10, [{ kind: "milestone", id: 1 }]),
      rowUniqueDoc(11, [{ kind: "milestone", id: 2 }]),
    ]);
    const { container } = render(
      <>
        <Seed milestones={milestones} />
        <MilestonesPanel
          lang="en-US"
          today="2026-06-02"
          holidaySet={new Set()}
          documentsByEntity={documentsByEntity}
          onAiEdit={vi.fn()}
          aiEditEnabled={() => true}
        />
      </>,
      { wrapper },
    );
    expectRowUniqueNames({
      minControls: 20,
      scope: container,
      roles: ["button", "checkbox"],
      requireCollisionSeed: true,
    });
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
    expectRowUniqueNames({ minControls: 17 });
  });

  it("clicking the badge switches the app to the Documents view", () => {
    renderWithProbe();
    expect(screen.getByTestId("active-tab").textContent).toBe("dashboard");
    fireEvent.click(screen.getByRole("button", { name: "Referenced by 2 document(s) – Alpha gate" }));
    expect(screen.getByTestId("active-tab").textContent).toBe("documents");
    expect(screen.getByTestId("pending-doc-filter").textContent).toBe("milestone:1");
  });
});

// --- bulk-edit undo (open-followups §50, milestones half) -------------------

describe("Milestones bulk edit undo", () => {
  // Reads live workspace state directly rather than the rendered table — the
  // table never shows `outlookEventId`, and reading it off DOM text would
  // also depend on row order, which the date change can perturb.
  function MilestoneProbe({ id }: { id: number }) {
    const { milestones } = useWorkspace();
    const ms = milestones.find((x) => x.id === id);
    return (
      <>
        <span data-testid={`date-${id}`}>{ms?.date ?? ""}</span>
        <span data-testid={`event-${id}`}>{ms?.outlookEventId ?? ""}</span>
        <span data-testid={`name-${id}`}>{ms?.name ?? ""}</span>
      </>
    );
  }

  // Mounts a REAL useUndoStack beside the panel (rather than a mocked
  // capture/captureFieldRows) so undo actually reverts through the live
  // setter — needed to prove a concurrent write survives it, not merely that
  // the right args were passed. Mirrors use-change-log.test.tsx's
  // renderChangeLogWithRealUndo.
  function RealUndoHarness({ milestones }: { milestones: readonly Milestone[] }) {
    const logActivity = vi.fn();
    const showToast = vi.fn();
    const showToastAction = vi.fn();
    const undoApi = useUndoStack({ lang: "en-US", logActivity, showToast, showToastAction });
    const { setMilestones } = useWorkspace();
    return (
      <>
        <Seed milestones={milestones} />
        <MilestonesPanel
          {...baseProps}
          capture={undoApi.capture}
          captureFieldRows={undoApi.captureFieldRows}
        />
        <MilestoneProbe id={1} />
        <MilestoneProbe id={2} />
        {/* Stands in for the background calendar push stamping the id Graph
            handed back — fired AFTER the bulk apply, through the same
            `setMilestones` setter a real push would use. Seeding it before
            the apply would pass against the unfixed whole-row capture too
            (the §48 trap use-change-log.test.tsx also calls out). */}
        <button
          type="button"
          onClick={() =>
            setMilestones((prev) =>
              prev.map((ms) => (ms.id === 1 ? { ...ms, outlookEventId: "AAMkAG-evt-9" } : ms)),
            )
          }
        >
          TEST_STAMP_EVENT_ID
        </button>
        {/* An ORDINARY concurrent field write on the same row — a rename from
            the edit modal, a second tab, or the AI dispatcher — fired AFTER
            the bulk apply too. `name` is on NEITHER backstop list, which is
            what makes it the assertion that discriminates the field-patch
            capture from the whole-row one (see the test's own note). */}
        <button
          type="button"
          onClick={() =>
            setMilestones((prev) =>
              prev.map((ms) => (ms.id === 1 ? { ...ms, name: "Alpha (renamed)" } : ms)),
            )
          }
        >
          TEST_CONCURRENT_RENAME
        </button>
        <button type="button" onClick={() => undoApi.undo()}>
          TEST_UNDO
        </button>
      </>
    );
  }

  // ★★★ open-followups §50, milestones half. Milestones carry no note log, but
  //   they DO carry `outlookEventId`, stamped by the Outlook calendar PUSH
  //   (`use-outlook-calendar-push.ts` — the milestone calendar PULL only reads
  //   the field and CLEARS it on a deleted event, it never stamps). A whole-row
  //   bulk-edit undo would make the row forget an event that still exists in
  //   Outlook, and the next push would then create a SECOND meeting for the
  //   same milestone.
  //   ★★★ ANTI-VACUITY: the `outlookEventId` assertion ALONE cannot fail. That
  //   key is on `WRITE_THROUGH_FIELDS` (undo/use-undo-stack.ts), so even a
  //   whole-row restore preserves it — that is Part A, the backstop, and it
  //   holds with the field-patch capture (Part B) reverted. `name` is an
  //   ordinary `Milestone` field on NEITHER backstop list AND is not one of
  //   the two bulk-editable fields (`date`/`achievedDate`), so a whole-row
  //   restore reverts it to the pre-apply snapshot ("Alpha") while the
  //   field-patch capture merges back only `date` and leaves it at
  //   "Alpha (renamed)". It is the assertion that distinguishes Part B from
  //   Part A.
  it("undoing a milestone bulk edit keeps an outlookEventId (and any other concurrent field write) stamped since the apply", () => {
    render(
      <RealUndoHarness
        milestones={[m("Alpha", "2026-01-01", { id: 1 }), m("Beta", "2026-01-01", { id: 2 })]}
      />,
      { wrapper },
    );

    // select both rows
    fireEvent.click(screen.getByRole("checkbox", { name: t("en-US", "selectItem", "Alpha") }));
    fireEvent.click(screen.getByRole("checkbox", { name: t("en-US", "selectItem", "Beta") }));
    // open the bulk panel and apply a target-date change to both
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "bulkEdit") }));
    fireEvent.click(screen.getByRole("checkbox", { name: t("en-US", "milestoneDate") }));
    const dateInput = document.getElementById("bulk-date") as HTMLInputElement;
    fireEvent.change(dateInput, { target: { value: "2026-02-01" } });
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "bulkApplyCount", "2") }));

    // sanity: the bulk apply actually landed before we stamp/undo it
    expect(screen.getByTestId("date-1").textContent).toBe("2026-02-01");
    expect(screen.getByTestId("date-2").textContent).toBe("2026-02-01");

    // THEN — after the apply — the background calendar push stamps an event id,
    // and an ordinary concurrent write renames the same row.
    fireEvent.click(screen.getByRole("button", { name: "TEST_STAMP_EVENT_ID" }));
    fireEvent.click(screen.getByRole("button", { name: "TEST_CONCURRENT_RENAME" }));

    fireEvent.click(screen.getByRole("button", { name: "TEST_UNDO" }));

    // the bulk date edit WAS reverted...
    expect(screen.getByTestId("date-1").textContent).toBe("2026-01-01");
    expect(screen.getByTestId("date-2").textContent).toBe("2026-01-01");
    // ...but the event id stamped since the apply survived the undo...
    expect(screen.getByTestId("event-1").textContent).toBe("AAMkAG-evt-9");
    // ...and so did the concurrent rename, which no backstop protects.
    expect(screen.getByTestId("name-1").textContent).toBe("Alpha (renamed)");
    expect(screen.getByTestId("name-2").textContent).toBe("Beta");
  });
});

describe("MilestonesPanel — delete arms the destructive-save bypass", () => {
  it("arms once for a milestone that exists", async () => {
    const allowDestructiveSave = vi.fn();
    renderMilestones({ milestones: [m("Kickoff", "2026-01-15")], allowDestructiveSave });
    fireEvent.click(screen.getByRole("button", { name: "Kickoff" }));
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "delete") }));
    fireEvent.click(await screen.findByRole("button", { name: /^confirm$/i }));
    await waitFor(() => expect(allowDestructiveSave).toHaveBeenCalledTimes(1));
    expect(screen.queryByText("Kickoff")).toBeNull();
  });

  it("does not throw when no bypass is supplied", async () => {
    renderMilestones({ milestones: [m("Kickoff", "2026-01-15")] });
    fireEvent.click(screen.getByRole("button", { name: "Kickoff" }));
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "delete") }));
    fireEvent.click(await screen.findByRole("button", { name: /^confirm$/i }));
    await waitFor(() => expect(screen.queryByText("Kickoff")).toBeNull());
  });

  // ★★ THE NEGATIVE CASE — a no-op delete must NOT spend the one-shot bypass,
  // matching every other delete route on this branch. Staged by opening the
  // edit modal for a milestone and then re-seeding the workspace WITHOUT it:
  // the panel re-renders, so the `onDelete` the still-open modal now holds is
  // a `del` closed over an array the id has left, and its `if (doomed)` guard
  // misses. Hoisting `allowDestructiveSave?.()` above that guard turns this red.
  // ★ The re-seed must land BEFORE the Delete click — clicking first captures
  //   the pre-reseed `del` in the pending `await confirm(...)`, which still
  //   finds the milestone and legitimately arms.
  it("does not arm when the milestone left the workspace under an open modal", async () => {
    const allowDestructiveSave = vi.fn();
    const kickoff = m("Kickoff", "2026-01-15");
    const handover = m("Handover", "2026-03-01");
    const tree = (milestones: readonly Milestone[]) => (
      <ConfirmProvider lang="en-US">
        <Seed milestones={milestones} />
        <MilestonesPanel
          lang="en-US"
          today="2026-06-02"
          holidaySet={new Set()}
          allowDestructiveSave={allowDestructiveSave}
        />
      </ConfirmProvider>
    );
    const { rerender } = render(tree([kickoff, handover]), { wrapper });
    fireEvent.click(screen.getByRole("button", { name: "Kickoff" }));
    expect(await screen.findByRole("button", { name: t("en-US", "delete") })).toBeTruthy();
    rerender(tree([handover]));
    // The row is gone from the list while the modal for it stays open.
    await waitFor(() => expect(screen.queryByRole("button", { name: "Kickoff" })).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "delete") }));
    fireEvent.click(await screen.findByRole("button", { name: /^confirm$/i }));
    // POSITIVE OBSERVABLE — `del` ends in setEditing(null), so both dialogs
    // closing proves the delete path really ran and the assertion below is
    // about the guard rather than about a confirm that never resolved.
    await waitFor(() => expect(screen.queryAllByRole("dialog")).toHaveLength(0));
    expect(allowDestructiveSave).not.toHaveBeenCalled();
  });
});
