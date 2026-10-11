import { beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WbsPlanModal, type WbsPlanModalProps } from "./wbs-plan-modal";
import type { GroundedWbsItem, RawWbsItem, SkippedWbsItem } from "./wbs-plan/wbs-plan";
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
    const reasons = [
      "unknownTask", "closedTask", "jiraTask", "outOfScope", "badPieces", "overCap", "emptyName", "badDate",
      "badEstimate", "hasEstimate", "duplicateRef", "selfLink", "duplicateLink", "unresolvedRef", "cycle", "staleTask",
    ] as const;
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
      "Build API → Design API · estimate none",
      "Implement API · estimate none",
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

  it("fires onApply and onCancel", async () => {
    const props = render5();
    await userEvent.click(screen.getByRole("button", { name: "Apply 3 changes" }));
    expect(props.onApply).toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(props.onCancel).toHaveBeenCalled();
  });
});
