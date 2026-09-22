import { render, screen, fireEvent, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ShiftEditModal } from "./shift-edit-modal";
import { t } from "./i18n";
import type { Resource, Shift } from "./types";

const SHIFT: Shift = {
  id: 7,
  assignee: "Alice",
  hoursPerWeekday: [0, 8, 8, 8, 8, 8, 0],
};

const RESOURCES: Resource[] = [
  {
    id: 1,
    firstName: "Sofia",
    lastName: "Ramirez",
    email: "sofia@x.com",
    roleId: null,
    utilizationMode: "percent",
    utilization: {},
  },
];

function setup(over: Partial<React.ComponentProps<typeof ShiftEditModal>> = {}) {
  const onSave = vi.fn();
  render(
    <ShiftEditModal
      lang="en-US"
      shift={SHIFT}
      isNew={false}
      existingAssigneeKeys={new Set()}
      resources={RESOURCES}
      contacts={[]}
      onCreateResource={vi.fn(() => 1)}
      onSave={onSave}
      onDelete={vi.fn()}
      onClose={vi.fn()}
      {...over}
    />,
  );
  return { onSave };
}

describe("ShiftEditModal — assignee ResourcePicker", () => {
  it("picking a registry resource stamps resourceId on save", () => {
    const { onSave } = setup();

    // The assignee field is now a ResourcePicker combobox. Focus + type to
    // surface the "Sofia Ramirez" registry suggestion, then pick it.
    const picker = within(
      screen.getByRole("dialog", { name: t("en-US", "shiftEditItem", 7) }),
    ).getByRole("combobox");
    fireEvent.focus(picker);
    fireEvent.change(picker, { target: { value: "Sofia" } });
    fireEvent.mouseDown(screen.getByText("Sofia Ramirez"));

    fireEvent.click(screen.getByRole("button", { name: t("en-US", "shiftSave") }));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ resourceId: 1, assignee: "Sofia Ramirez" }),
    );
  });
});

describe("shift assignee email follows the changed-only write rule", () => {
  it("refuses a CHANGED malformed email", () => {
    const onSave = vi.fn();
    setup({ onSave, isNew: false, shift: { id: 1, assignee: "Ada", assigneeEmail: "old@x.com", hoursPerWeekday: [8, 8, 8, 8, 8, 0, 0] } as Shift });
    fireEvent.change(screen.getByLabelText(t("en-US", "shiftAssigneeEmail")), { target: { value: "nope" } });
    fireEvent.submit(screen.getByDisplayValue("nope").closest("form")!);
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getAllByRole("alert").map((a) => a.textContent)).toContain(t("en-US", "errorInvalidEmail"));
  });

  // M-C4 — the editor stores the `Name <addr>`-unwrapped address, as every
  //  load does, and judges (and flags) that same value.
  it("M-C4: a typed Name <addr> email saves as addr, unflagged", () => {
    const onSave = vi.fn();
    setup({ onSave, isNew: false, shift: { id: 1, assignee: "Ada", assigneeEmail: "old@x.com", hoursPerWeekday: [8, 8, 8, 8, 8, 0, 0] } as Shift });
    fireEvent.change(screen.getByLabelText(t("en-US", "shiftAssigneeEmail")), { target: { value: "Ann Lee <ann@x.com>" } });
    expect(screen.queryByText(t("en-US", "errorInvalidEmail"))).toBeNull();
    fireEvent.submit(screen.getByDisplayValue("Ann Lee <ann@x.com>").closest("form")!);
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0].assigneeEmail).toBe("ann@x.com");
  });

  it("M-C4: a shape-only email edit saves the unchanged address", () => {
    const onSave = vi.fn();
    setup({ onSave, isNew: false, shift: { id: 1, assignee: "Ada", assigneeEmail: "ada@x.com", hoursPerWeekday: [8, 8, 8, 8, 8, 0, 0] } as Shift });
    fireEvent.change(screen.getByLabelText(t("en-US", "shiftAssigneeEmail")), { target: { value: "Ada<ada@x.com>" } });
    fireEvent.submit(screen.getByDisplayValue("Ada<ada@x.com>").closest("form")!);
    expect(onSave.mock.calls[0][0].assigneeEmail).toBe("ada@x.com");
  });

  it("saves while an unchanged stored email is unsafe", () => {
    const onSave = vi.fn();
    setup({ onSave, isNew: false, shift: { id: 1, assignee: "Ada", assigneeEmail: "a,b@x.com", hoursPerWeekday: [8, 8, 8, 8, 8, 0, 0] } as Shift });
    fireEvent.submit(screen.getByDisplayValue("a,b@x.com").closest("form")!);
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  // Fix round 1, IMPORTANT 3 — the copy-source exemption was unpinned: the
  // fixture's linked resource always carried a SAFE email, so a real unsafe
  // one was never actually exercised as a copy source.
  it("exempts a copy of the linked resource's stored email", () => {
    const onSave = vi.fn();
    const linked: Resource = {
      id: 2, firstName: "Bo", lastName: "X", email: "a,b@x.com",
      roleId: null, utilizationMode: "percent", utilization: {},
    };
    setup({
      onSave,
      isNew: false,
      resources: [linked],
      shift: { id: 1, assignee: "Bo", assigneeEmail: "old@x.com", resourceId: 2, hoursPerWeekday: [8, 8, 8, 8, 8, 0, 0] } as Shift,
    });
    fireEvent.change(screen.getByLabelText(t("en-US", "shiftAssigneeEmail")), { target: { value: "a,b@x.com" } });
    fireEvent.submit(screen.getByDisplayValue("a,b@x.com").closest("form")!);
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  // Positive control: the SAME unsafe value with no resource link is refused.
  it("positive control: the identical value with no link is refused", () => {
    const onSave = vi.fn();
    setup({
      onSave,
      isNew: false,
      resources: [],
      shift: { id: 1, assignee: "Bo", assigneeEmail: "old@x.com", hoursPerWeekday: [8, 8, 8, 8, 8, 0, 0] } as Shift,
    });
    fireEvent.change(screen.getByLabelText(t("en-US", "shiftAssigneeEmail")), { target: { value: "a,b@x.com" } });
    fireEvent.submit(screen.getByDisplayValue("a,b@x.com").closest("form")!);
    expect(onSave).not.toHaveBeenCalled();
  });

  // Fix round 2, MINOR — an UNRELATED banner error (blank assignee) must
  // never hide the flag: the stored unsafe email is untouched.
  it("keeps the flag visible while an unrelated banner error is showing", () => {
    const onSave = vi.fn();
    setup({
      onSave,
      isNew: false,
      shift: { id: 1, assignee: "", assigneeEmail: "a,b@x.com", hoursPerWeekday: [8, 8, 8, 8, 8, 0, 0] } as Shift,
    });
    fireEvent.submit(screen.getByDisplayValue("a,b@x.com").closest("form")!);
    expect(onSave).not.toHaveBeenCalled();
    const alerts = screen.getAllByRole("alert").map((a) => a.textContent);
    expect(alerts).toContain(t("en-US", "shiftErrorAssigneeRequired"));
    expect(alerts).toContain(t("en-US", "errorEmailDelimiter"));
    expect(alerts).toHaveLength(2);
  });
});

describe("ShiftEditModal — panel sizing", () => {
  it("the panel carries a default height and min-height, not just a max, and the form can shrink to scroll", () => {
    // Same class of defect as the shared edit-modal shell and the budget
    // bucket modal: useResizable needs a class-based default height or a
    // dragged height opens dead space. The form also needs min-h-0 flex-1
    // so it is the flex child that actually shrinks and scrolls, rather
    // than the fixed-height panel clipping it.
    setup();
    const panel = document.querySelector("[data-modal-panel]") as HTMLElement;
    expect(panel.className).toContain("h-[560px]");
    expect(panel.className).toContain("min-h-[400px]");
    expect(panel.className).toContain("max-h-[95vh]");
    const form = panel.querySelector("form") as HTMLFormElement;
    expect(form.className).toContain("min-h-0");
    expect(form.className).toContain("flex-1");
  });
});
