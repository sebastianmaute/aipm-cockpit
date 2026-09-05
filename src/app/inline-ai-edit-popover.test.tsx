import { it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { InlineAiEditPopover } from "./inline-ai-edit-popover";

const base = {
  lang: "en-US" as const,
  itemTitle: "Fix login bug",
  entityLabel: "RAID item",
  phase: "idle" as const, plan: null, clarifyText: "", errorText: "",
  onSubmit: vi.fn(), onApply: vi.fn(), onCancel: vi.fn(),
};

it("renders the entity label + item title and submits the instruction", () => {
  render(<InlineAiEditPopover {...base} />);
  expect(screen.getByText("RAID item")).toBeInTheDocument();
  expect(screen.getByText(/Fix login bug/)).toBeInTheDocument();
  const input = screen.getByLabelText(/ask claude to edit this task/i);
  fireEvent.change(input, { target: { value: "mark done" } });
  fireEvent.submit(input.closest("form")!);
  expect(base.onSubmit).toHaveBeenCalledWith("mark done");
});

it("focuses the input on open and restores focus to the trigger on close", () => {
  const trigger = document.createElement("button");
  document.body.appendChild(trigger);
  trigger.focus();
  expect(document.activeElement).toBe(trigger);
  const { unmount } = render(<InlineAiEditPopover {...base} />);
  // Opens with focus in the NL input (aria-modal).
  expect(document.activeElement).toBe(screen.getByLabelText(/ask claude to edit this task/i));
  // Closing restores focus to whatever was focused before (the ✨ trigger).
  unmount();
  expect(document.activeElement).toBe(trigger);
  trigger.remove();
});

it("traps Tab within the dialog (wraps last -> first)", () => {
  render(<InlineAiEditPopover {...base} />);
  const dialog = screen.getByRole("dialog");
  const focusables = Array.from(dialog.querySelectorAll<HTMLElement>("button, input"));
  const last = focusables[focusables.length - 1];
  last.focus();
  fireEvent.keyDown(dialog, { key: "Tab" });
  expect(document.activeElement).toBe(focusables[0]);
});

it("closes via the header ✕, so the focus-trapped dialog stays escapable by pointer", () => {
  // ★ This is an `aria-modal` dialog with a focus trap (see the Tab test above),
  // so a dead close button traps the user with no pointer way out. The control was
  // converted to IconButton in the glyph batch and nothing exercised it until now.
  // ★ `phase` stays "idle" deliberately: in "preview" the footer renders a SECOND
  // button named "Cancel", which would make this getByRole ambiguous and throw.
  // ★ Local mock, not the shared `base.onCancel` — the module has no clearMocks,
  // so a shared spy could carry a call in from another test and pass vacuously.
  const onCancel = vi.fn();
  render(<InlineAiEditPopover {...base} onCancel={onCancel} />);
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(onCancel).toHaveBeenCalled();
});

// ★★★ The inline path APPLIES `plan.links` (it rebuilds the write patch from
// them), so a link change this popover does not render is a silent destructive
// write, not merely an undisclosed one: relationship writes REPLACE.
it("renders a link change in preview", () => {
  render(
    <InlineAiEditPopover
      {...base}
      phase="preview"
      plan={{
        updates: [],
        creates: [],
        deletes: [],
        rejected: [],
        links: [{ field: "linkedTaskIds", before: "Draft brief, Review", after: "Ship", rawIds: [2] }],
      }}
    />,
  );
  expect(screen.getByText("linkedTaskIds")).toBeInTheDocument();
  expect(screen.getByText(/Draft brief, Review → Ship/)).toBeInTheDocument();
});

// ★★ `after` can legitimately be "" (every link removed) — the most
// destructive change this preview can show. A bare `{l.after}` renders nothing
// at all, so the `|| "—"` fallback is load-bearing rather than cosmetic.
it("renders a cleared link list as an em dash rather than as nothing", () => {
  render(
    <InlineAiEditPopover
      {...base}
      phase="preview"
      plan={{
        updates: [],
        creates: [],
        deletes: [],
        rejected: [],
        links: [{ field: "linkedTaskIds", before: "Draft brief", after: "", rawIds: [] }],
      }}
    />,
  );
  expect(screen.getByText(/Draft brief → —/)).toBeInTheDocument();
});

it("shows the diff and an Apply button in preview", () => {
  render(<InlineAiEditPopover {...base} phase="preview" plan={{ updates: [{ field: "status", before: "To Do", after: "Done" }], creates: [], deletes: [], rejected: [], links: [] }} />);
  expect(screen.getByText(/status/i)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /^apply$/i }));
  expect(base.onApply).toHaveBeenCalled();
});
