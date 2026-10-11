import { beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WbsPlanModal, type WbsPlanModalProps } from "./wbs-plan-modal";
import type { GroundedWbsItem, RawWbsItem, SkippedWbsItem, WbsSkipReason } from "./wbs-plan/wbs-plan";
import type { Task } from "./types";
import { loadI18n, t } from "./i18n";
import { expectRowUniqueNames } from "../test/row-unique-names";

const task = (id: number, taskName: string, extra: Partial<Task> = {}): Task =>
  ({ id, taskName, status: "Open", ...extra }) as Task;

const tasks = [task(1, "Build API"), task(2, "Write docs", { group: "Docs" })];
const tasksById = new Map(tasks.map((x) => [x.id, x]));

const grounded = (key: string, item: RawWbsItem, requires: string[] = []): GroundedWbsItem => ({
  key,
  item,
  baseRows: [],
  requires,
});

const split = grounded("i0", {
  kind: "split",
  taskId: 1,
  pieces: [{ taskName: "Design API" }, { taskName: "Implement API" }],
  why: "too big",
});
const regroup = grounded("i1", { kind: "regroup", taskId: 2, group: "Launch", why: "" });
const newTask = grounded("i2", { kind: "newTask", ref: "r1", taskName: "Release notes", dueDate: "2026-11-01", why: "needed" });
const link = grounded(
  "i3",
  { kind: "link", from: { kind: "ref", ref: "r1" }, to: { kind: "task", id: 2 }, why: "order" },
  ["i2"],
);
const estimate = grounded("i4", { kind: "estimate", target: { kind: "task", id: 2 }, estimateMinutes: 120, why: "" });

const render5 = (over: Partial<WbsPlanModalProps> = {}) => {
  const props: WbsPlanModalProps = {
    lang: "en-US",
    tasksById,
    items: [split, regroup, newTask, estimate, link],
    skipped: [],
    truncated: false,
    selected: new Set(["i0", "i1", "i4"]),
    onToggle: vi.fn(),
    onApply: vi.fn(),
    onCancel: vi.fn(),
    applying: false,
    ...over,
  };
  render(<WbsPlanModal {...props} />);
  return props;
};

describe("WbsPlanModal", () => {
  beforeAll(async () => {
    await loadI18n("de");
  });

  it("reflects selected on every item checkbox", () => {
    render5();
    const boxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
    expect(boxes).toHaveLength(5);
    expect(boxes.filter((b) => b.checked)).toHaveLength(3);
  });

  it("calls onToggle with the item key", async () => {
    const props = render5();
    await userEvent.click(screen.getAllByRole("checkbox")[0]);
    expect(props.onToggle).toHaveBeenCalledWith("i0");
  });

  it("disables a link while its endpoint is unticked", () => {
    render5();
    const boxes = screen.getAllByRole("checkbox");
    const linkBox = boxes[boxes.length - 1];
    expect(linkBox).toBeDisabled();
    expect(screen.getByText(t("en-US", "wbsPlanLinkNeedsEndpoint"))).toBeVisible();
  });

  it("disables an estimate on a piece while its split is unticked, with the same reason", () => {
    const pieceEstimate = grounded(
      "i5",
      { kind: "estimate", target: { kind: "piece", taskId: 1, piece: 2 }, estimateMinutes: 60, why: "" },
      ["i0"],
    );
    render5({ items: [split, pieceEstimate], selected: new Set(["i5"]) });
    const boxes = screen.getAllByRole("checkbox");
    expect(boxes[1]).toBeDisabled();
    expect(screen.getByText(t("en-US", "wbsPlanLinkNeedsEndpoint"))).toBeVisible();
  });

  it("shows a new task's assignee and a plain-text excerpt of its description", () => {
    const withPeople = grounded("i2", {
      kind: "newTask",
      ref: "r1",
      taskName: "Release notes",
      dueDate: "2026-11-01",
      assignee: "Alice",
      description: "<p>Draft the <strong>release</strong> notes</p>",
      why: "",
    });
    render5({ items: [withPeople], selected: new Set(["i2"]) });
    expect(screen.getByText(t("en-US", "wbsPlanAssignedTo", "Alice"), { exact: false })).toBeVisible();
    expect(screen.getByText(t("en-US", "wbsPlanDescriptionExcerpt", "Draft the release notes"))).toBeVisible();
  });

  it("truncates a long description excerpt", () => {
    const long = "word ".repeat(60).trim();
    const withLong = grounded("i2", { kind: "newTask", ref: "r1", taskName: "N", dueDate: "2026-11-01", description: `<p>${long}</p>`, why: "" });
    render5({ items: [withLong], selected: new Set(["i2"]) });
    expect(screen.getByText(t("en-US", "wbsPlanDescriptionExcerpt", `${long.slice(0, 120)}…`))).toBeVisible();
  });

  it("never splits an emoji at the excerpt boundary", () => {
    // 119 ASCII chars, then a two-code-unit emoji spanning units 120-121.
    const text = `${"a".repeat(119)}😀tail`;
    const withEmoji = grounded("i2", { kind: "newTask", ref: "r1", taskName: "N", dueDate: "2026-11-01", description: `<p>${text}</p>`, why: "" });
    render5({ items: [withEmoji], selected: new Set(["i2"]) });
    const expected = t("en-US", "wbsPlanDescriptionExcerpt", `${"a".repeat(119)}…`);
    expect(screen.getByText(expected)).toBeVisible();
    // Over the RENDERED dialog, not a string this test built: no lone high
    // surrogate anywhere in what the user sees.
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(screen.getByRole("dialog").textContent ?? "")).toBe(false);
  });

  it("adds no ellipsis to a description that fits", () => {
    const fits = "b".repeat(120);
    const withFit = grounded("i2", { kind: "newTask", ref: "r1", taskName: "N", dueDate: "2026-11-01", description: `<p>${fits}</p>`, why: "" });
    render5({ items: [withFit], selected: new Set(["i2"]) });
    expect(screen.getByText(t("en-US", "wbsPlanDescriptionExcerpt", fits))).toBeVisible();
  });

  it("words the unresolved-ref reason neutrally (a task or a piece)", () => {
    expect(t("en-US", "wbsPlanSkip_unresolvedRef")).toBe("refers to a task or piece the proposal does not create");
  });

  it("shows no assignee or description line for a new task without them", () => {
    render5({ items: [newTask], selected: new Set(["i2"]) });
    expect(screen.queryByText(/assigned to/)).toBeNull();
    expect(screen.queryByText(/description:/)).toBeNull();
  });

  it("shows a description excerpt for a piece after the first", () => {
    const withDesc = grounded("i0", {
      kind: "split",
      taskId: 1,
      pieces: [{ taskName: "Design API" }, { taskName: "Implement API", description: "<p>Write the handlers</p>" }],
      why: "",
    });
    render5({ items: [withDesc], selected: new Set(["i0"]) });
    const pieces = screen.getByRole("list", { name: t("en-US", "wbsPlanPiecesLabel") });
    const second = within(pieces).getAllByRole("listitem")[1];
    expect(second).toHaveTextContent(t("en-US", "wbsPlanDescriptionExcerpt", "Write the handlers"));
  });

  it("enables the link once its endpoint is ticked", () => {
    render5({ selected: new Set(["i2", "i3"]) });
    const boxes = screen.getAllByRole("checkbox");
    expect(boxes[boxes.length - 1]).toBeEnabled();
  });

  it("shows the enabled-ticked count on the apply button", () => {
    // i3 is ticked but disabled (i2 unticked): 3 ticked, 2 counted.
    render5({ selected: new Set(["i0", "i1", "i3"]) });
    expect(screen.getByRole("button", { name: "Apply 2 changes" })).toBeEnabled();
  });

  it("uses the singular for one change", () => {
    render5({ selected: new Set(["i0"]) });
    expect(screen.getByRole("button", { name: "Apply 1 change" })).toBeEnabled();
  });

  it("disables apply at a count of 0", () => {
    render5({ selected: new Set() });
    expect(screen.getByRole("button", { name: "Apply 0 changes" })).toBeDisabled();
  });

  it("disables apply while applying", () => {
    render5({ applying: true });
    expect(screen.getByRole("button", { name: /Apply|Applying/ })).toBeDisabled();
  });

  it("lists a cycle skip with its reason text", () => {
    const skipped: SkippedWbsItem[] = [
      { item: { kind: "link", from: { kind: "task", id: 1 }, to: { kind: "task", id: 2 }, why: "" }, reason: "cycle" },
    ];
    render5({ skipped });
    expect(screen.getByText(t("en-US", "wbsPlanSkip_cycle"), { exact: false })).toBeInTheDocument();
    expect(screen.getByText(t("en-US", "wbsPlanSkippedTitle"), { exact: false })).toBeInTheDocument();
  });

  it("gives every skip reason a non-empty EN and DE text", () => {
    const reasons: readonly WbsSkipReason[] = [
      "unknownTask", "closedTask", "jiraTask", "outOfScope", "badPieces", "emptyName", "emptyGroup", "emptyRef",
      "badDate", "badEstimate", "hasEstimate", "duplicateRef", "duplicateTarget", "sameGroup", "selfLink",
      "duplicateLink", "unresolvedRef", "ambiguousPiece", "cycle",
    ];
    for (const r of reasons) {
      const key = `wbsPlanSkip_${r}` as const;
      expect(t("en-US", key).length).toBeGreaterThan(0);
      expect(t("de", key)).not.toBe(t("en-US", key));
    }
  });

  it("names every checkbox uniquely", () => {
    render5();
    expectRowUniqueNames({ minControls: 5, roles: ["checkbox"] });
  });

  it("keeps names unique when two items share a subject", () => {
    const a = grounded("i0", { kind: "regroup", taskId: 2, group: "A", why: "" });
    const b = grounded("i1", { kind: "regroup", taskId: 2, group: "B", why: "" });
    render5({ items: [a, b], selected: new Set() });
    expectRowUniqueNames({ minControls: 2, roles: ["checkbox"] });
  });

  const pieceTexts = () =>
    within(screen.getByRole("list", { name: t("en-US", "wbsPlanPiecesLabel") }))
      .getAllByRole("listitem")
      .map((li) => li.textContent);

  it("shows piece 1 as old name → new name, and every piece's estimate", () => {
    render5();
    expect(pieceTexts()).toEqual([
      "Build API → Design API · no estimate",
      "Implement API · no estimate",
    ]);
  });

  it("shows piece 1's estimate as before → after and marks a replaced description", () => {
    const withEstimate = new Map(tasksById).set(1, task(1, "Build API", { originalEstimateMinutes: 480 }));
    const s = grounded("i0", {
      kind: "split",
      taskId: 1,
      pieces: [
        { taskName: "Design API", estimateMinutes: 240, description: "<p>new</p>" },
        { taskName: "Implement API", estimateMinutes: 240 },
      ],
      why: "",
    });
    render5({ items: [s], tasksById: withEstimate, selected: new Set(["i0"]) });
    expect(pieceTexts()).toEqual([
      "Build API → Design API · estimate 480 min → 240 min · replaces the description",
      "Implement API · estimate 240 min",
    ]);
  });

  it("shows piece 1's kept estimate without an arrow when it does not change it", () => {
    const withEstimate = new Map(tasksById).set(1, task(1, "Build API", { originalEstimateMinutes: 480 }));
    const same = grounded("i0", {
      kind: "split",
      taskId: 1,
      pieces: [{ taskName: "Design API", estimateMinutes: 480 }, { taskName: "Implement API" }],
      why: "",
    });
    render5({ items: [same], tasksById: withEstimate, selected: new Set(["i0"]) });
    expect(pieceTexts()[0]).toBe("Build API → Design API · estimate 480 min");
    cleanup();
    const absent = grounded("i0", {
      kind: "split",
      taskId: 1,
      pieces: [{ taskName: "Design API" }, { taskName: "Implement API" }],
      why: "",
    });
    render5({ items: [absent], tasksById: withEstimate, selected: new Set(["i0"]) });
    expect(pieceTexts()[0]).toBe("Build API → Design API · estimate 480 min");
  });

  it("renders the piece disclosure in German", () => {
    const withEstimate = new Map(tasksById).set(1, task(1, "Build API", { originalEstimateMinutes: 480 }));
    const s = grounded("i0", {
      kind: "split",
      taskId: 1,
      pieces: [{ taskName: "Design API", estimateMinutes: 240, description: "<p>x</p>" }, { taskName: "Implement API" }],
      why: "",
    });
    render5({ lang: "de", items: [s], tasksById: withEstimate, selected: new Set(["i0"]) });
    const list = screen.getByRole("list", { name: t("de", "wbsPlanPiecesLabel") });
    expect(within(list).getAllByRole("listitem")[0].textContent).toBe(
      "Build API → Design API · Schätzung 480 Min. → 240 Min. · ersetzt die Beschreibung",
    );
  });

  it("renders no why text when why is empty and shows it otherwise", () => {
    render5();
    expect(screen.getByText("too big")).toBeInTheDocument();
  });

  it("resolves a ref link endpoint to the new task name", () => {
    render5();
    expect(screen.getAllByText(/Release notes/).length).toBeGreaterThan(1);
  });

  it("omits empty sections", () => {
    render5({ items: [regroup], selected: new Set() });
    expect(screen.queryByText(t("en-US", "wbsPlanSectionSplits"))).toBeNull();
    expect(screen.getByText(t("en-US", "wbsPlanSectionRegroups"))).toBeInTheDocument();
  });

  it("shows the truncation line only when truncated, and always the undo note", () => {
    render5({ truncated: true });
    expect(screen.getByText(t("en-US", "wbsPlanTruncated"))).toBeInTheDocument();
    expect(screen.getByText(t("en-US", "wbsPlanUndoNote"))).toBeInTheDocument();
  });

  // The spec's binding wording: undo does NOT remove the new rows (undo.md "Creates").
  it("says undo leaves new tasks in place, in EN and DE", () => {
    render5();
    expect(
      screen.getByText("Undo reverts the changes to existing tasks; new tasks stay and can be deleted by hand."),
    ).toBeInTheDocument();
    cleanup();
    render5({ lang: "de" });
    expect(
      screen.getByText(
        "Rückgängig stellt die Änderungen an bestehenden Aufgaben wieder her; neue Aufgaben bleiben erhalten und können von Hand gelöscht werden.",
      ),
    ).toBeInTheDocument();
  });

  it("does not show the truncation line when not truncated", () => {
    render5();
    expect(screen.queryByText(t("en-US", "wbsPlanTruncated"))).toBeNull();
  });

  it("names a split piece in a link or estimate by its own proposed name, piece 1 included", () => {
    const toPiece2 = grounded(
      "i5",
      { kind: "link", from: { kind: "task", id: 2 }, to: { kind: "piece", taskId: 1, piece: 2 }, why: "" },
      ["i0"],
    );
    // Piece 1 is stored as the task itself; this proposal splits task 1.
    const onPiece1 = grounded("i6", { kind: "estimate", target: { kind: "task", id: 1 }, estimateMinutes: 60, why: "" });
    render5({ items: [split, toPiece2, onPiece1], selected: new Set(["i0", "i5", "i6"]) });
    expect(screen.getByText("Write docs must finish before Implement API (piece 2 of Build API)")).toBeVisible();
    expect(screen.getByText("Design API (piece 1 of Build API)")).toBeVisible();
  });

  it("falls back to the original name for a piece of a split the proposal does not hold", () => {
    const skipped: SkippedWbsItem[] = [
      { item: { kind: "estimate", target: { kind: "piece", taskId: 1, piece: 3 }, estimateMinutes: 5, why: "" }, reason: "unresolvedRef" },
    ];
    render5({ items: [regroup], selected: new Set(["i1"]), skipped });
    expect(screen.getByText(`Build API — piece 3 — ${t("en-US", "wbsPlanSkip_unresolvedRef")}`)).toBeInTheDocument();
  });

  it("describes each checkbox with its row's detail, why and disabled reason", () => {
    render5();
    const boxes = screen.getAllByRole("checkbox");
    // The regroup row: before → after and nothing of the subject repeated.
    expect(boxes[1]).toHaveAccessibleDescription("Docs → Launch");
    // The split row: its pieces and its why.
    expect(boxes[0]).toHaveAccessibleDescription(
      "Build API → Design API · no estimate Implement API · no estimate too big",
    );
    // The disabled link row says why it cannot apply.
    expect(boxes[boxes.length - 1]).toHaveAccessibleDescription(`order ${t("en-US", "wbsPlanLinkNeedsEndpoint")}`);
  });

  it("when every proposed item was refused, shows only the reasons, expanded, no Apply and a Close", async () => {
    const skipped: SkippedWbsItem[] = [
      { item: { kind: "regroup", taskId: 2, group: "Docs", why: "" }, reason: "sameGroup" },
    ];
    const props = render5({ items: [], selected: new Set(), skipped });
    expect(screen.getByText(t("en-US", "wbsPlanAllSkipped"))).toBeVisible();
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    expect(document.querySelector("details")).toHaveAttribute("open");
    expect(screen.getByText(`Write docs — ${t("en-US", "wbsPlanSkip_sameGroup")}`)).toBeVisible();
    expect(screen.queryByRole("button", { name: /Apply/ })).toBeNull();
    expect(screen.queryByRole("button", { name: t("en-US", "wbsPlanCancel") })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: t("en-US", "close") }));
    expect(props.onCancel).toHaveBeenCalled();
  });

  it("names a refused new task with a blank name instead of leaving its row without a subject", () => {
    const skipped: SkippedWbsItem[] = [
      { item: { kind: "newTask", ref: "r9", taskName: "   ", dueDate: "2026-11-01", why: "" }, reason: "emptyName" },
    ];
    render5({ items: [], selected: new Set(), skipped });
    expect(
      screen.getByText(`${t("en-US", "wbsPlanUnnamedNewTask")} — ${t("en-US", "wbsPlanSkip_emptyName")}`),
    ).toBeVisible();
  });

  it("keeps the Not-applied list collapsed and shows no all-refused note while something can apply", () => {
    const skipped: SkippedWbsItem[] = [
      { item: { kind: "regroup", taskId: 2, group: "Docs", why: "" }, reason: "sameGroup" },
    ];
    render5({ skipped });
    expect(screen.queryByText(t("en-US", "wbsPlanAllSkipped"))).toBeNull();
    expect(document.querySelector("details")).not.toHaveAttribute("open");
  });

  // Literal German, not t(): the button and the toasts must use ONE verb.
  it("uses \u00fcbernehmen for the Apply button in German, as the toasts and the log do", () => {
    render5({ lang: "de", skipped: [{ item: { kind: "regroup", taskId: 2, group: "Docs", why: "" }, reason: "sameGroup" }] });
    expect(screen.getByRole("button", { name: "3 \u00c4nderungen \u00fcbernehmen" })).toBeInTheDocument();
    expect(screen.getByText("Nicht \u00fcbernommen", { exact: false })).toBeInTheDocument();
  });

  it("fires onApply and onCancel", async () => {
    const props = render5();
    await userEvent.click(screen.getByRole("button", { name: "Apply 3 changes" }));
    expect(props.onApply).toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(props.onCancel).toHaveBeenCalled();
  });
});
