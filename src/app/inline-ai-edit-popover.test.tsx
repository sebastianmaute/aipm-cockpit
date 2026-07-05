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

it("shows the diff and an Apply button in preview", () => {
  render(<InlineAiEditPopover {...base} phase="preview" plan={{ updates: [{ field: "status", before: "To Do", after: "Done" }], creates: [], deletes: [], rejected: [] }} />);
  expect(screen.getByText(/status/i)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /^apply$/i }));
  expect(base.onApply).toHaveBeenCalled();
});
