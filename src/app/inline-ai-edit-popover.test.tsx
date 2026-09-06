import { it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { InlineAiEditPopover } from "./inline-ai-edit-popover";
import { describeEntityCalls } from "./inline-ai-edit/plan";
import { INLINE_DESCRIPTORS } from "./inline-ai-edit/entity-descriptor";
import { type Workspace } from "./workspace";

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

// A merged plan can hold TWO `update_*` blocks touching the same field, so a
// bare `key={d.field}` collides. React drops one of the two <li>s and warns —
// so the user reads a preview that is missing a line the write will make, on the
// one surface whose Apply writes exactly what it renders.
// ★★ WHAT A COLLISION COSTS DEPENDS ON WHICH PATH REACHES IT, and an earlier
//   wording of this comment asserted a mount behaviour its own next sentence
//   contradicted ("React renders ONE row" — beside a passing `toHaveLength(2)`).
//   On a FIRST MOUNT `reconcileChildrenArray` creates a fiber for every child
//   regardless of duplicate keys, which is why React's own warning says the
//   children "may be duplicated and/or omitted" rather than that one is
//   dropped. Both <li>s reach the DOM here. Dropping a row is the UPDATE path,
//   where the next render matches by key — and a line the write WILL make then
//   silently leaves the preview, on the one surface whose Apply writes exactly
//   what it renders.
// ★★★ SO THE WARNING IS THE ONLY DETECTOR ON THIS PATH, which makes the
//   assertion below an ABSENCE — and nothing about `.toBe(false)` proves the
//   spy CAN fire. A React wording change, or a setup that intercepts
//   console.error ahead of this spy, would leave it green forever. The ARMING
//   render is the positive observable that gives the negative its meaning; it
//   is measured here, in this file, rather than asserted from React's source.
// ★ `getAllByText` is a different guard and is NOT that control: it is the
//   anti-vacuity floor for the subject render, proving two rows were asked for
//   at all so the absence is not an absence over an empty list. It survives the
//   `key={d.field}` mutant, for the mount reason above.
it("gives each update row a key of its own when two touch the same field", () => {
  const warn = vi.spyOn(console, "error").mockImplementation(() => {});
  // ★ `finally`, because `vitest.config.ts` sets no `restoreMocks`: a failing
  //  assertion below would otherwise leak a silenced console.error into every
  //  later test in this file.
  try {
    render(<ul>{["dup", "dup"].map((k) => <li key={k}>{k}</li>)}</ul>);
    expect(warn.mock.calls.some((c) => String(c[0]).includes("same key"))).toBe(true);
    warn.mockClear();

    render(
      <InlineAiEditPopover
        {...base}
        phase="preview"
        plan={{
          updates: [
            { entity: "raid", field: "title", before: "Old", after: "Mid", raw: "Mid" },
            { entity: "raid", field: "title", before: "Mid", after: "New", raw: "New" },
          ],
          creates: [], deletes: [], rejected: [], links: [],
        }}
      />,
    );
    expect(screen.getAllByText("Title")).toHaveLength(2);
    expect(warn.mock.calls.some((c) => String(c[0]).includes("same key"))).toBe(false);
  } finally {
    warn.mockRestore();
  }
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
        links: [{ entity: "raid", target: "row", field: "linkedTaskIds", before: "Draft brief, Review", after: "Ship", rawIds: [2] }],
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

// §420. `plan.links` is ONE flat bucket and this list renders it as flat <li>s
// in ONE <ul>, with nothing — no nesting, no separator — between a line
// projected off a `create_*` call (DISCLOSURE only; the create replays its own
// input) and one that rewrites the OPEN row. Unqualified, the create's line is
// read as a statement about the open row, and in this mixed shape both lines
// carry the byte-identical label with different values, so the reader cannot
// tell which is which. `target` cannot fix that: it is invisible on the card.
//
// ★★★ THE PLAN IS BUILT BY THE ENGINE, not hand-written, because the fix lives
//  in `pushLinkDiffs`. A hand-written plan carrying `subject` would keep
//  passing with the producer no longer setting one — a seam test that cannot
//  see the break above it.
it("tells a create's link line apart from the open row's", () => {
  const openRow = { id: 4, category: "R", title: "Risk A", status: "Open", linkedTaskIds: [1, 3] };
  const ws = {
    tasks: [
      { id: 1, taskName: "Draft brief" }, { id: 3, taskName: "Review" },
      { id: 7, taskName: "Task Seven" }, { id: 9, taskName: "Task Nine" },
    ],
    raid: [openRow], changes: [], milestones: [], stakeholders: [], resources: [],
  } as unknown as Workspace;
  const plan = describeEntityCalls(
    [
      { type: "tool_use", name: "update_raid_item", input: { id: 4, linkedTaskIds: [7] } },
      { type: "tool_use", name: "create_raid_item", input: { category: "R", title: "Risk B", linkedTaskIds: [9] } },
    ],
    { descriptor: INLINE_DESCRIPTORS.raid, item: openRow, ws },
  );
  render(<InlineAiEditPopover {...base} phase="preview" plan={plan} />);
  // ★★ An exact-STRING `getByText` throws on a second match, so this line is
  //  also the assertion that the create's label is NOT bare: with the subject
  //  dropped, both labels read "Linked tasks" and this fails on "found multiple
  //  elements" rather than on the qualified assertion below.
  expect(screen.getByText("Linked tasks")).toBeInTheDocument();
  expect(screen.getByText("Risk B – Linked tasks")).toBeInTheDocument();
  // Which values belong to which row — the half a label check alone cannot say,
  // and the half that makes the unqualified render actively false rather than
  // merely vague ("— → Task Seven" claims the open row is losing both links).
  expect(screen.getByText(/Draft brief, Review → Task Seven/)).toBeInTheDocument();
  expect(screen.getByText(/— → Task Nine/)).toBeInTheDocument();
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
        updates: [{ entity: "raid", field: "status", before: "Open", after: "Closed" }],
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
//
// ★★★ BOTH IN ONE PLAN, which is what the per-diff `entity` bought (§393).
// This used to render the same one-row plan TWICE under two different
// plan-level `entity` props — a shape that could not distinguish "labels each
// row from its own register" from "labels the whole plan from one prop". A
// single render holding both is only satisfiable by the former.
it("labels each field through its own entity", () => {
  const plan = {
    updates: [
      { entity: "raid" as const, field: "title", before: "Old", after: "New" },
      { entity: "stakeholder" as const, field: "title", before: "Engineer", after: "Architect" },
    ],
    creates: [], deletes: [], rejected: [], links: [],
  };
  render(<InlineAiEditPopover {...base} phase="preview" plan={plan} />);
  expect(screen.getByText("Title")).toBeInTheDocument();
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
        links: [{ entity: "raid", target: "row", field: "linkedTaskIds", before: "Draft brief", after: "", rawIds: [] }],
      }}
    />,
  );
  expect(screen.getByText(/Draft brief → —/)).toBeInTheDocument();
});

it("shows the diff and an Apply button in preview", () => {
  render(<InlineAiEditPopover {...base} phase="preview" plan={{ updates: [{ entity: "raid", field: "status", before: "To Do", after: "Done" }], creates: [], deletes: [], rejected: [], links: [] }} />);
  expect(screen.getByText(/status/i)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /^apply$/i }));
  expect(base.onApply).toHaveBeenCalled();
});
