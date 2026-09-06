import { it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { InlineAiEditPopover } from "./inline-ai-edit-popover";

const base = {
  lang: "en-US" as const,
  itemTitle: "Fix login bug",
  entityLabel: "RAID item",
  // ★ Must agree with `entityLabel` — the field labels below are resolved as
  // `raid.<field>`, and a mismatched pair would silently label a RAID preview
  // with another register's strings.
  entity: "raid" as const,
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
  // ★★ The READABLE name, not the property. This assertion USED to read
  // `getByText("linkedTaskIds")` — a test that pinned the defect it was written
  // alongside: the surface that APPLIES this write named the field
  // `linkedTaskIds` to the user.
  expect(screen.getByText("Linked tasks")).toBeInTheDocument();
  expect(screen.queryByText("linkedTaskIds")).not.toBeInTheDocument();
  expect(screen.getByText(/Draft brief, Review → Ship/)).toBeInTheDocument();
});

// ★★★ THE PARTS THAT WILL NOT LAND WERE RENDERED BY NOTHING HERE, on the
// surface whose Apply writes what it shows. A user approving a preview reads the
// lines it shows as the whole change, so a field the sanitizer refused simply
// disappeared.
it("renders a rejected field in preview", () => {
  render(
    <InlineAiEditPopover
      {...base}
      phase="preview"
      plan={{
        updates: [{ field: "status", before: "Open", after: "Closed" }],
        creates: [],
        deletes: [],
        rejected: [{ toolName: "update_raid_item", reason: "bad-input", detail: "targetDate=nope" }],
        links: [],
      }}
    />,
  );
  expect(screen.getByText("Not applied: targetDate=nope")).toBeInTheDocument();
});

// ★★ A plan whose ONLY outcome is a rejection, rendered through the PREVIEW
// block. This popover has no `isEmptyPlan` guard of its own — it gates on
// `phase === "preview"` — so the renderer is correct for this shape too.
// ★ It used to be unreachable in the live app: `use-inline-entity-edit.ts`
// routed such a plan to "clarify" (`isEmptyPlan` does not count `rejected`), so
// the user was told "no changes" rather than which field was refused. That
// defect one layer up is CLOSED — the hook now routes it to the "rejected"
// phase, pinned by the test immediately below and by "routes a rejection-only
// plan to the rejected phase, not to clarify" in
// `use-inline-entity-edit.test.tsx`. This case stays, because the preview block
// still renders `rejected` alongside real writes and must keep doing so when
// every write in the plan is later removed.
it("renders a rejection on a plan that writes nothing", () => {
  render(
    <InlineAiEditPopover
      {...base}
      phase="preview"
      plan={{ updates: [], creates: [], deletes: [], rejected: [{ toolName: "update_raid_item", reason: "unknown-id", detail: "99" }], links: [] }}
    />,
  );
  expect(screen.getByText("Not applied: 99")).toBeInTheDocument();
});

// ★★★ THE PHASE A REFUSAL-ONLY PLAN NOW LANDS IN (§392), and the ABSENCE of an
// Apply button is the half that makes the phase worth having. Routing such a
// plan to "preview" instead was measured as WORSE, not equivalent: `apply()`
// guards on `isEmptyPlan(plan)`, which does not count `rejected`, so the button
// would be live and would silently no-op on every click.
it("names the refused field and offers no Apply in the rejected phase", () => {
  render(
    <InlineAiEditPopover
      {...base}
      phase="rejected"
      plan={{
        updates: [], creates: [], deletes: [], links: [],
        rejected: [{ toolName: "update_raid_item", reason: "bad-input", detail: "probability=9" }],
      }}
    />,
  );
  expect(screen.getByText("Not applied: probability=9")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /^apply$/i })).not.toBeInTheDocument();
  // Positive control for the negative above: the phase really did render its
  // own block, so the missing Apply is an absence and not an unrendered branch.
  expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
});

// ★★ The label is keyed `${entity}.${field}`, so the SAME property name must
// read differently per register. `title` is a RAID item's summary and a
// stakeholder's role — a bare field-name map would collapse them.
it("labels a field through its own entity", () => {
  const plan = {
    updates: [{ field: "title", before: "Old", after: "New" }],
    creates: [], deletes: [], rejected: [], links: [],
  };
  const { unmount } = render(<InlineAiEditPopover {...base} phase="preview" plan={plan} />);
  expect(screen.getByText("Title")).toBeInTheDocument();
  unmount();
  render(<InlineAiEditPopover {...base} entity="stakeholder" phase="preview" plan={plan} />);
  expect(screen.getByText("Title / role")).toBeInTheDocument();
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
