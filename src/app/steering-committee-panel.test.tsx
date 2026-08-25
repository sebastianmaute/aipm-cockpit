import { describe, it, expect, beforeAll, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { SteeringCommitteePanel } from "./steering-committee-panel";
import { loadI18n, t } from "./i18n";
import type { Resource, SteeringCommittee } from "./types";
import type { MeetingReportBag } from "./use-meeting-report-actions";
import { expectRowUniqueNames } from "../test/row-unique-names";

const reportBag: MeetingReportBag = {
  m365Configured: false,
  aiConfigured: false,
  tursoActive: false,
  onSaveReport: () => {},
  onSendReport: () => {},
  sendBusyMeetingId: null,
  onGenerateReport: () => {},
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
    expectRowUniqueNames({ minRows: 9 });
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
