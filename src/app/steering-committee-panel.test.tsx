import { describe, it, expect, beforeAll, vi } from "vitest";
import { render, renderHook, screen, fireEvent, within, waitFor } from "@testing-library/react";
import { SteeringCommitteePanel } from "./steering-committee-panel";
import { Modal } from "./modal";
import { useUndoHotkey } from "./use-undo-hotkey";
import { loadI18n, t } from "./i18n";
import type { Resource, SteeringCommittee } from "./types";
import type { MeetingReportBag } from "./use-meeting-report-actions";
import { expectRowUniqueNames } from "../test/row-unique-names";
import { splitSections } from "./committee-report/report-sections";

const reportBag: MeetingReportBag = {
  m365Configured: false,
  aiConfigured: false,
  tursoActive: false,
  onSaveReport: () => true,
  onRestorePrevious: () => {},
  onSendReport: () => {},
  sendBusyMeetingId: null,
  onGenerateReport: () => {},
  getProposal: () => undefined,
  markTaken: () => {},
  discardProposal: () => {},
  onCancelGenerateReport: () => {},
  generateBusyMeetingId: null,
  loadVersions: async () => [],
  onRestore: () => {},
  restoreBusyId: null,
};

function res(id: number, firstName: string, lastName: string): Resource {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { id, firstName, lastName } as any;
}

const RESOURCES: Resource[] = [res(1, "Ada", "Lovelace"), res(2, "Alan", "Turing")];

const committee: SteeringCommittee = {
  name: "SteerCo",
  memberResourceIds: [1, 99], // 99 is dangling (no live resource)
  meetings: [
    { id: 1, date: "2026-07-01", title: "Kickoff" },
    { id: 2, date: "2026-08-01", title: "Review" },
  ],
  infoSchedules: [{ id: 1, label: "Board pack", leadDays: 3 }],
};

const TODAY = "2026-06-20";

describe("SteeringCommitteePanel", () => {
  it("uses the standard resizable content-pane shell with a reset-size control", () => {
    const { container } = render(
      <SteeringCommitteePanel
        lang="en-US"
        committee={committee}
        onChange={() => {}}
        resources={RESOURCES}
        today={TODAY}
      />,
    );
    const root = container.firstChild as HTMLElement;
    // VIEW_PANE_RESIZABLE_CLASS hallmarks (see view-styles.ts).
    expect(root.className).toContain("resize");
    expect(root.className).toContain("min-h-[300px]");
    // Reset-size control present with its accessible name.
    expect(
      screen.getByRole("button", { name: t("en-US", "tableResetSizeHint") }),
    ).toBeInTheDocument();
  });

  it("renders the committee name in the name field", () => {
    render(
      <SteeringCommitteePanel
        lang="en-US"
        committee={committee}
        onChange={() => {}}
        resources={RESOURCES}
        today={TODAY}
      />,
    );
    expect(screen.getByLabelText(t("en-US", "committeeName"))).toHaveValue("SteerCo");
  });

  it("renders members that match a live resource and drops dangling ids", () => {
    render(
      <SteeringCommitteePanel
        lang="en-US"
        committee={committee}
        onChange={() => {}}
        resources={RESOURCES}
        today={TODAY}
      />,
    );
    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
    // The dangling member (id 99) has no live resource -> not rendered.
    const removeButtons = screen.getAllByRole("button", { name: new RegExp(t("en-US", "remove")) });
    expect(removeButtons).toHaveLength(1);
  });

  it("stashes a deleted meeting's pushed event id into pendingDeleteEventIds", () => {
    const onChange = vi.fn();
    const withEvent: SteeringCommittee = {
      ...committee,
      meetings: [{ id: 1, date: "2026-07-01", title: "Kickoff", outlookEventId: "ev-1" }],
    };
    render(
      <SteeringCommitteePanel
        lang="en-US"
        committee={withEvent}
        onChange={onChange}
        resources={RESOURCES}
        today={TODAY}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: `${t("en-US", "delete")} – Kickoff` }));
    const next = onChange.mock.calls.at(-1)![0] as SteeringCommittee;
    expect(next.meetings).toHaveLength(0);
    expect(next.pendingDeleteEventIds).toEqual(["ev-1"]);
  });

  it("adds a meeting immutably and calls onChange with a new object", () => {
    const onChange = vi.fn();
    render(
      <SteeringCommitteePanel
        lang="en-US"
        committee={committee}
        onChange={onChange}
        resources={RESOURCES}
        today={TODAY}
      />,
    );
    // The add-meeting title input is the standalone draft input (placeholder).
    const titleDraft = screen
      .getAllByLabelText(t("en-US", "committeeMeetingTitle"))
      .find((el) => (el as HTMLInputElement).placeholder === t("en-US", "committeeMeetingTitle"))!;
    fireEvent.change(titleDraft, { target: { value: "Steering #3" } });
    fireEvent.click(screen.getByRole("button", { name: new RegExp(t("en-US", "committeeAddMeeting")) }));

    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0][0] as SteeringCommittee;
    expect(next).not.toBe(committee); // immutable
    expect(next.meetings).toHaveLength(3);
    expect(next.meetings.some((m) => m.title === "Steering #3")).toBe(true);
    // Original untouched.
    expect(committee.meetings).toHaveLength(2);
  });

  it("gives each meeting row's delete control a row-unique accessible name", () => {
    render(
      <SteeringCommitteePanel
        lang="en-US"
        committee={committee}
        onChange={() => {}}
        resources={RESOURCES}
        today={TODAY}
      />,
    );
    expect(screen.getByRole("button", { name: `${t("en-US", "delete")} – Kickoff` })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: `${t("en-US", "delete")} – Review` })).toBeInTheDocument();
    expectRowUniqueNames({ minControls: 9 });
  });

  it("keeps meeting, schedule and member controls apart when their names repeat (§316)", () => {
    // A recurring committee meeting usually keeps one title; two schedules and
    // two people can share a name too.
    const repeated: SteeringCommittee = {
      ...committee,
      memberResourceIds: [1, 3],
      meetings: [
        { id: 1, date: "2026-07-01", title: "SteerCo" },
        { id: 2, date: "2026-08-01", title: "SteerCo" },
      ],
      infoSchedules: [
        { id: 1, label: "Board pack", leadDays: 3 },
        { id: 2, label: "Board pack", leadDays: 7 },
      ],
    };
    render(
      <SteeringCommitteePanel
        lang="en-US"
        committee={repeated}
        onChange={() => {}}
        resources={[...RESOURCES, res(3, "Ada", "Lovelace")]}
        today={TODAY}
        report={reportBag}
      />,
    );
    expect(screen.getByRole("button", { name: `${t("en-US", "delete")} – SteerCo (2)` })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: `${t("en-US", "reportStatusReport")} – SteerCo (2)` })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: `${t("en-US", "delete")} – Board pack (2)` })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: `${t("en-US", "remove")} – Ada Lovelace (2)` })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: `${t("en-US", "committeeMeetingTitle")} – SteerCo (2)` })).toBeInTheDocument();
    expectRowUniqueNames({ minControls: 9, requireCollisionSeed: true });
    expectRowUniqueNames({ minControls: 6, roles: ["textbox", "spinbutton"], requireCollisionSeed: true });
  });

  it("shows a due info reminder", () => {
    // Board pack for Kickoff (2026-07-01) is well within range -> a reminder appears.
    render(
      <SteeringCommitteePanel
        lang="en-US"
        committee={committee}
        onChange={() => {}}
        resources={RESOURCES}
        today={TODAY}
      />,
    );
    const remindersHeading = screen.getByText(t("en-US", "committeeReminders"));
    const section = remindersHeading.closest("section")!;
    expect(within(section).queryByText(t("en-US", "committeeRemindersNone"))).toBeNull();
    expect(within(section).getAllByText(/Board pack/).length).toBeGreaterThan(0);
  });

  it("hides the Outlook push button when no outlookPush prop is given", () => {
    render(
      <SteeringCommitteePanel
        lang="en-US"
        committee={committee}
        onChange={() => {}}
        resources={RESOURCES}
        today={TODAY}
      />,
    );
    expect(screen.queryByRole("button", { name: t("en-US", "committeePushOutlook") })).toBeNull();
  });

  it("pushes a single meeting row via onPushRow with a meeting-scoped target", () => {
    const onPushRow = vi.fn();
    render(
      <SteeringCommitteePanel
        lang="en-US"
        committee={committee}
        onChange={() => {}}
        resources={RESOURCES}
        today={TODAY}
        outlookPush={{ onPush: () => {}, pushingTarget: null, onPushRow }}
      />,
    );
    // Row-unique accessible name: "Push to Outlook – <meeting>".
    fireEvent.click(
      screen.getByRole("button", { name: `${t("en-US", "committeePushOutlook")} – Kickoff` }),
    );
    expect(onPushRow).toHaveBeenCalledWith({ kind: "meeting", id: 1 });
    // Distinct control per meeting row (WCAG 2.4.6).
    expect(
      screen.getByRole("button", { name: `${t("en-US", "committeePushOutlook")} – Review` }),
    ).toBeInTheDocument();
  });

  it("pushes a single info-schedule row via onPushRow with a schedule-scoped target", () => {
    const onPushRow = vi.fn();
    render(
      <SteeringCommitteePanel
        lang="en-US"
        committee={committee}
        onChange={() => {}}
        resources={RESOURCES}
        today={TODAY}
        outlookPush={{ onPush: () => {}, pushingTarget: null, onPushRow }}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: `${t("en-US", "committeePushOutlook")} – Board pack` }),
    );
    expect(onPushRow).toHaveBeenCalledWith({ kind: "schedule", id: 1 });
  });

  it("hides per-row push buttons when onPushRow is absent", () => {
    render(
      <SteeringCommitteePanel
        lang="en-US"
        committee={committee}
        onChange={() => {}}
        resources={RESOURCES}
        today={TODAY}
        outlookPush={{ onPush: () => {}, pushingTarget: null }}
      />,
    );
    expect(
      screen.queryByRole("button", { name: `${t("en-US", "committeePushOutlook")} – Kickoff` }),
    ).toBeNull();
  });

  it("shows the Outlook push button (disabled while busy) when the prop is provided", () => {
    render(
      <SteeringCommitteePanel
        lang="en-US"
        committee={committee}
        onChange={() => {}}
        resources={RESOURCES}
        today={TODAY}
        outlookPush={{ onPush: () => {}, pushingTarget: "all" }}
      />,
    );
    const btn = screen.getByRole("button", { name: t("en-US", "committeePushBusy") });
    expect(btn).toBeDisabled();
  });

  it("disables every push affordance during an in-flight push; only the in-flight row shows busy", () => {
    const onPushRow = vi.fn();
    render(
      <SteeringCommitteePanel
        lang="en-US"
        committee={committee}
        onChange={() => {}}
        resources={RESOURCES}
        today={TODAY}
        // Meeting id 1 ("Kickoff") is pushing. To avoid the concurrent-click
        // silent no-op (the hook's inFlightRef guard bails without feedback),
        // ALL push buttons are disabled — only the in-flight one shows busy.
        outlookPush={{ onPush: () => {}, pushingTarget: "m:1", onPushRow }}
      />,
    );
    const kickoff = screen.getByRole("button", { name: `${t("en-US", "committeePushOutlook")} – Kickoff` });
    const review = screen.getByRole("button", { name: `${t("en-US", "committeePushOutlook")} – Review` });
    const pushAll = screen.getByRole("button", { name: t("en-US", "committeePushOutlook") });
    // Every affordance is disabled (not silently clickable) while any push runs.
    expect(kickoff).toBeDisabled();
    expect(review).toBeDisabled();
    expect(pushAll).toBeDisabled();
    // Busy label is TARGET-SCOPED: only the in-flight Kickoff row shows it.
    expect(kickoff).toHaveTextContent(t("en-US", "committeePushBusy"));
    expect(review).toHaveTextContent(t("en-US", "committeePushRow"));
  });

  it("wraps the status-report surface in resize/reset/print/cancel chrome; cancel closes it", async () => {
    render(
      <SteeringCommitteePanel
        lang="en-US"
        committee={committee}
        onChange={() => {}}
        resources={RESOURCES}
        today={TODAY}
        report={reportBag}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: `${t("en-US", "reportStatusReport")} – Kickoff` }),
    );
    const dialog = await screen.findByRole("dialog");
    // Resizable content-pane container (native CSS `resize`).
    const heading = within(dialog).getByRole("heading", {
      name: `${t("en-US", "reportStatusReport")} – Kickoff`,
    });
    expect(heading.closest("div.resize")).not.toBeNull();
    // Print + reset-size + cancel controls present, scoped to the dialog.
    expect(within(dialog).getByRole("button", { name: t("en-US", "printHint") })).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: t("en-US", "tableResetSizeHint") }),
    ).toBeInTheDocument();
    const cancel = within(dialog).getByRole("button", { name: t("en-US", "cancel") });
    fireEvent.click(cancel);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("the status-report panel carries a default height and min-height under its 85vh cap", async () => {
    // Same defect class as the shared edit-modal shell and the budget/shift
    // modals: useResizable needs a class-based default height or a dragged
    // height opens dead space. The content div here already has
    // min-h-0 flex-1 overflow-auto, so this is a panel-only fix — the 85vh
    // cap stays (it must fit alongside the print/reset/cancel header on a
    // laptop viewport, not the 95vh most edit modals use).
    render(
      <SteeringCommitteePanel
        lang="en-US"
        committee={committee}
        onChange={() => {}}
        resources={RESOURCES}
        today={TODAY}
        report={reportBag}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: `${t("en-US", "reportStatusReport")} – Kickoff` }),
    );
    const dialog = await screen.findByRole("dialog");
    const heading = within(dialog).getByRole("heading", {
      name: `${t("en-US", "reportStatusReport")} – Kickoff`,
    });
    const panel = heading.closest("div.resize") as HTMLElement;
    expect(panel.className).toContain("h-[600px]");
    expect(panel.className).toContain("min-h-[320px]");
    expect(panel.className).toContain("max-h-[85vh]");
  });

  // AI-04 — the proposal lives in the report hook, not in the dialog: closing and reopening the
  // dialog shows the same proposal. A section counts as taken once its text is SAVED (I-1).
  function renderWithStatefulProposal() {
    const sections = splitSections("<h2>Risks</h2><p>ai risks</p><h2>Next steps</h2><p>ai next</p>");
    let taken = new Set<number>();
    const markTaken = vi.fn((_id: number, indices: readonly number[]) => {
      taken = new Set([...taken, ...indices]);
    });
    const getProposal = vi.fn((id: number) => (id === 1 ? { sections, taken, createdAt: "2026-10-30T09:00:00.000Z" } : undefined));
    render(
      <SteeringCommitteePanel
        lang="en-US"
        committee={committee}
        onChange={() => {}}
        resources={RESOURCES}
        today={TODAY}
        report={{ ...reportBag, getProposal, markTaken }}
      />,
    );
    const open = async () => {
      fireEvent.click(screen.getByRole("button", { name: `${t("en-US", "reportStatusReport")} – Kickoff` }));
      return screen.findByRole("dialog");
    };
    return { markTaken, open };
  }

  it("a take left unsaved is not taken: closing and reopening shows the row untaken", async () => {
    const { markTaken, open } = renderWithStatefulProposal();
    let dialog = await open();
    fireEvent.click(within(dialog).getByRole("button", { name: "Take – Next steps" }));
    await waitFor(() => expect(within(dialog).getAllByRole("listitem")[1]).toHaveTextContent("Taken"));
    fireEvent.click(within(dialog).getByRole("button", { name: t("en-US", "cancel") }));
    expect(screen.queryByRole("dialog")).toBeNull();
    dialog = await open();
    expect(within(dialog).getAllByRole("listitem")[1]).not.toHaveTextContent("Taken");
    expect(within(dialog).getByRole("button", { name: "Take – Next steps" })).toBeEnabled();
    expect(markTaken).not.toHaveBeenCalled();
  });

  it("closing and reopening the report dialog after a saved take shows the same proposal with its taken marks", async () => {
    const { markTaken, open } = renderWithStatefulProposal();
    let dialog = await open();
    fireEvent.click(within(dialog).getByRole("button", { name: "Take – Next steps" }));
    await waitFor(() => expect(within(dialog).getAllByRole("listitem")[1]).toHaveTextContent("Taken"));
    expect(markTaken).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: t("en-US", "reportSave") }));
    expect(markTaken).toHaveBeenCalledWith(1, [1]);
    fireEvent.click(within(dialog).getByRole("button", { name: t("en-US", "cancel") }));
    expect(screen.queryByRole("dialog")).toBeNull();
    dialog = await open();
    const rows = within(dialog).getAllByRole("listitem");
    expect(rows[0]).not.toHaveTextContent("Taken");
    expect(rows[1]).toHaveTextContent("Taken");
    // Taken, but still takeable again (final review item 2).
    expect(within(dialog).getByRole("button", { name: "Take – Next steps" })).toBeEnabled();
  });

  it("the report dialog's content switches the app undo hotkey off", async () => {
    render(
      <SteeringCommitteePanel
        lang="en-US"
        committee={committee}
        onChange={() => {}}
        resources={RESOURCES}
        today={TODAY}
        report={reportBag}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: `${t("en-US", "reportStatusReport")} – Kickoff` }));
    const dialog = await screen.findByRole("dialog");
    const save = within(dialog).getByRole("button", { name: t("en-US", "reportSave") });
    expect(save.closest('[data-app-undo="off"]')).not.toBeNull();
  });

  // Final review item 3 — the dialog ROOT (tabIndex -1, focused by a click on non-focusable content) is in the
  // zone too, so Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y there never run the app undo or redo.
  it("Ctrl+Z, Ctrl+Shift+Z and Ctrl+Y on the report dialog root do not run the app undo or redo", async () => {
    const undo = vi.fn();
    const redo = vi.fn();
    renderHook(() => useUndoHotkey(undo, redo));
    render(
      <SteeringCommitteePanel
        lang="en-US"
        committee={committee}
        onChange={() => {}}
        resources={RESOURCES}
        today={TODAY}
        report={reportBag}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: `${t("en-US", "reportStatusReport")} – Kickoff` }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.keyDown(dialog, { key: "z", ctrlKey: true });
    fireEvent.keyDown(dialog, { key: "Z", ctrlKey: true, shiftKey: true });
    fireEvent.keyDown(dialog, { key: "y", ctrlKey: true });
    expect(undo).not.toHaveBeenCalled();
    expect(redo).not.toHaveBeenCalled();
  });

  it("another modal's root is not in the zone: Ctrl+Z and Ctrl+Y there still run the app undo and redo", () => {
    const undo = vi.fn();
    const redo = vi.fn();
    renderHook(() => useUndoHotkey(undo, redo));
    render(
      <Modal open onClose={() => {}} ariaLabel="Other">
        <button type="button">Inside</button>
      </Modal>,
    );
    const dialog = screen.getByRole("dialog", { name: "Other" });
    expect(dialog.closest('[data-app-undo="off"]')).toBeNull();
    fireEvent.keyDown(dialog, { key: "z", ctrlKey: true });
    fireEvent.keyDown(dialog, { key: "y", ctrlKey: true });
    expect(undo).toHaveBeenCalledTimes(1);
    expect(redo).toHaveBeenCalledTimes(1);
  });
});

describe("SteeringCommitteePanel (DE)", () => {
  beforeAll(async () => {
    await loadI18n("de");
  });

  it("renders German labels with real umlauts", () => {
    render(
      <SteeringCommitteePanel
        lang="de"
        committee={committee}
        onChange={() => {}}
        resources={RESOURCES}
        today={TODAY}
      />,
    );
    expect(screen.getByLabelText(t("de", "committeeAddMember"))).toBeInTheDocument();
    expect(t("de", "committeeAddMember")).toBe("Mitglied hinzufügen");
  });
});
