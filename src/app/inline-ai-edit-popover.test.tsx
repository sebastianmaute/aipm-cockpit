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

it("shows the diff and an Apply button in preview", () => {
  render(<InlineAiEditPopover {...base} phase="preview" plan={{ updates: [{ field: "status", before: "To Do", after: "Done" }], creates: [], deletes: [], rejected: [], links: [] }} />);
  expect(screen.getByText(/status/i)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /^apply$/i }));
  expect(base.onApply).toHaveBeenCalled();
});
