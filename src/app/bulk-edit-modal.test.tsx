import { describe, test, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { useLayoutEffect, type ReactNode } from "react";
import { t } from "./i18n";
import { TaskFormProvider, useTaskForm } from "./task-form-context";
import type { BudgetBucket } from "./types";
import { BulkEditModal } from "./bulk-edit-modal";

function Probe({
  children,
  openBulk,
}: {
  children: ReactNode;
  openBulk: boolean;
}) {
  const { setBulkEditOpen } = useTaskForm();
  useLayoutEffect(() => {
    if (openBulk) setBulkEditOpen(true);
  }, [openBulk, setBulkEditOpen]);
  return <>{children}</>;
}

function defaultProps(
  overrides: Partial<{
    selectedIds: Set<number>;
    selectedJiraCount: number;
    budgetBuckets: readonly BudgetBucket[];
  }> = {},
) {
  return {
    lang: "en-US" as const,
    today: "2026-05-19",
    selectedIds: overrides.selectedIds ?? new Set<number>([1]),
    selectedJiraCount: overrides.selectedJiraCount ?? 0,
    uniqueGroups: [],
    uniqueLabels: [],
    budgetBuckets: overrides.budgetBuckets ?? [],
    onApply: vi.fn(),
    onCancel: vi.fn(),
  };
}

describe("BulkEditModal", () => {
  test("renders nothing when bulkEditOpen is false", () => {
    const { container } = render(
      <TaskFormProvider>
        <Probe openBulk={false}>
          <BulkEditModal {...defaultProps()} />
        </Probe>
      </TaskFormProvider>,
    );
    expect(container.querySelector("h3")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  test("renders nothing when bulkEditOpen is true but selectedIds is empty", () => {
    const { container } = render(
      <TaskFormProvider>
        <Probe openBulk={true}>
          <BulkEditModal {...defaultProps({ selectedIds: new Set() })} />
        </Probe>
      </TaskFormProvider>,
    );
    expect(container.querySelector("h3")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  test("renders the heading when exactly one row is selected", () => {
    render(
      <TaskFormProvider>
        <Probe openBulk={true}>
          <BulkEditModal {...defaultProps({ selectedIds: new Set([1]) })} />
        </Probe>
      </TaskFormProvider>,
    );
    expect(screen.getByRole("heading", { level: 3 })).toBeInTheDocument();
  });

  test("renders the count in the heading when multiple rows are selected", () => {
    render(
      <TaskFormProvider>
        <Probe openBulk={true}>
          <BulkEditModal {...defaultProps({ selectedIds: new Set([1, 2, 3]) })} />
        </Probe>
      </TaskFormProvider>,
    );
    // Plural title interpolates the count in any language. Substring match
    // on "3" is robust to translations of the surrounding phrase.
    expect(
      screen.getByRole("heading", { level: 3 }).textContent ?? "",
    ).toMatch(/3/);
  });

  test("cancel button fires onCancel exactly once", () => {
    const props = defaultProps();
    render(
      <TaskFormProvider>
        <Probe openBulk={true}>
          <BulkEditModal {...props} />
        </Probe>
      </TaskFormProvider>,
    );
    // Resolve by accessible name — the cancel button renders t(lang,"cancel").
    const cancel = screen.getByRole("button", { name: t("en-US", "cancel") });
    cancel.click();
    expect(props.onCancel).toHaveBeenCalledTimes(1);
  });

  test("apply button fires onApply exactly once", () => {
    const props = defaultProps({ selectedIds: new Set([1]) });
    render(
      <TaskFormProvider>
        <Probe openBulk={true}>
          <BulkEditModal {...props} />
        </Probe>
      </TaskFormProvider>,
    );
    const buttons = screen.getAllByRole("button");
    const apply = buttons.find((b) =>
      (b.className ?? "").includes("bg-ui-dark-blue"),
    );
    expect(apply).toBeDefined();
    apply!.click();
    expect(props.onApply).toHaveBeenCalledTimes(1);
  });

  test("toggling the priority row updates bulkEdit.enabled.priority via setBulkEdit", () => {
    const captured: { enabledPriority?: boolean } = {};

    function Spy() {
      const { bulkEdit } = useTaskForm();
      Object.assign(captured, { enabledPriority: bulkEdit.enabled.priority });
      return null;
    }

    render(
      <TaskFormProvider>
        <Probe openBulk={true}>
          <BulkEditModal {...defaultProps()} />
          <Spy />
        </Probe>
      </TaskFormProvider>,
    );

    expect(captured.enabledPriority).toBe(false);

    // BulkEditFieldRow renders an <input type="checkbox" id={id}> toggle.
    // The priority row uses id="bulk-priority".
    const toggle = document.getElementById("bulk-priority") as
      | HTMLInputElement
      | null;
    expect(toggle).not.toBeNull();
    toggle!.click();
    expect(captured.enabledPriority).toBe(true);
  });

  test("the status select keeps an accessible name even with the Jira note sibling present", () => {
    // selectedJiraCount>0 renders a sibling <p> note, making the row's children
    // an array — BulkEditFieldRow's aria-label clone is skipped, so the select
    // carries its own explicit aria-label. Regression guard for that a11y gap.
    render(
      <TaskFormProvider>
        <Probe openBulk={true}>
          <BulkEditModal {...defaultProps({ selectedJiraCount: 1 })} />
        </Probe>
      </TaskFormProvider>,
    );
    expect(
      screen.getByRole("combobox", { name: t("en-US", "colTaskStatus") }),
    ).toBeInTheDocument();
    // The assignee input (same array-children pattern) is also explicitly named.
    expect(
      screen.getByRole("textbox", { name: t("en-US", "assignee") }),
    ).toBeInTheDocument();
  });

  test("caps the field list height and scrolls it, keeping the actions reachable", () => {
    const { container } = render(
      <TaskFormProvider>
        <Probe openBulk={true}>
          <BulkEditModal {...defaultProps({ selectedIds: new Set([1]) })} />
        </Probe>
      </TaskFormProvider>,
    );
    const scroller = container.querySelector("[data-bulk-fields]");
    expect(scroller).not.toBeNull();
    expect(scroller!.className).toContain("overflow-y-auto");
    expect(scroller!.className).toContain("max-h-[60vh]");
    const actions = container.querySelector("[data-bulk-actions]");
    expect(actions).not.toBeNull();
    expect(actions!.className).toContain("sticky");
    // The sticky footer only has an effect relative to a scrolling ancestor —
    // jsdom has no layout engine so the actual scrolling can't be asserted,
    // but containment inside the scroller (not a sibling of it) is what makes
    // "sticky bottom-0" resolve against the right box, so pin it structurally.
    expect(scroller!.contains(actions)).toBe(true);
  });
});
