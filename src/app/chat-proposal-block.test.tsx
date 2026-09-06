import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChatProposalBlock, proposalRowTitle, type ProposalCardRow } from "./chat-proposal-block";
import type { EditPlan } from "./inline-ai-edit/plan";
import type { ProposedCall } from "./chat-proposal";
import { expectRowUniqueNames } from "../test/row-unique-names";
import { loadI18n, t } from "./i18n";

const emptyPlan = (): EditPlan => ({ updates: [], creates: [], deletes: [], rejected: [], links: [] });

const updatePlan = (field: string, before: string, after: string): EditPlan => ({
  ...emptyPlan(),
  updates: [{ field, before, after }],
});

function row(
  over: Partial<ProposalCardRow> & Pick<ProposalCardRow, "index" | "title">,
): ProposalCardRow {
  return { call: { name: "update_task", input: { id: over.index } }, plan: emptyPlan(), ...over };
}

/**
 * The fixture the a11y assertion needs: rows 0 and 1 share a display name, so
 * `buildRowTokens` must qualify BOTH with an occurrence index. Row 2 is a
 * `create_document` and row 3 a `delete_all_tasks` — both descriptor-less, so
 * their plans are empty and the card has only `call.name` to render.
 */
const ROWS: readonly ProposalCardRow[] = [
  row({
    index: 0,
    title: "Migrate database",
    call: { name: "update_task", input: { id: 7 } },
    plan: updatePlan("status", "To Do", "Done"),
  }),
  row({
    index: 1,
    title: "Migrate database",
    call: { name: "update_raid_item", input: { id: 3 } },
    plan: updatePlan("owner", "", "Ada"),
  }),
  row({
    index: 2,
    title: "Q3 status report",
    call: { name: "create_document", input: { title: "Q3 status report" } },
  }),
  row({ index: 3, title: "delete_all_tasks", call: { name: "delete_all_tasks", input: {} } }),
];

function renderCard(
  rows: readonly ProposalCardRow[] = ROWS,
  over: Partial<Parameters<typeof ChatProposalBlock>[0]> = {},
) {
  const onToggleRow = vi.fn(),
    onApply = vi.fn(),
    onDiscard = vi.fn();
  const result = render(
    <ChatProposalBlock
      lang="en-US"
      rows={rows}
      selected={new Set(rows.filter((r) => !r.cascaded).map((r) => r.index))}
      onToggleRow={onToggleRow}
      onApply={onApply}
      onDiscard={onDiscard}
      {...over}
    />,
  );
  return { ...result, onToggleRow, onApply, onDiscard };
}

describe("ChatProposalBlock", () => {
  // ★★★ THIS IS THE ONLY DETECTOR THAT CAN EXIST for two row controls sharing
  // an accessible name here. axe flags none, under any tag the e2e gate
  // requests, at any seed size — and this card only renders after a live model
  // turn, so no e2e seed reaches it either. `requireCollisionSeed` is
  // mandatory: without it the assertion passes against a fixture whose titles
  // do not collide, the documented vacuity trap in
  // `src/test/row-unique-names.ts`.
  //
  // `minControls` is MEASURED, not rounded — the explicit querySelectorAll
  // below is that measurement, kept in the test so the floor cannot drift away
  // from what the fixture actually renders. Four rows, one checkbox each, and
  // the card renders no other checkbox anywhere. A loose floor would let a
  // silently narrowed `roles` array back in.
  it("gives every row control a row-unique accessible name", () => {
    const { container } = renderCard();

    expect(container.querySelectorAll('input[type="checkbox"]')).toHaveLength(4);
    expectRowUniqueNames({
      minControls: 4,
      roles: ["checkbox"],
      scope: container,
      requireCollisionSeed: true,
    });
  });

  it("qualifies both colliding rows and leaves a unique row bare", () => {
    renderCard();
    expect(screen.getByRole("checkbox", { name: "Include – Migrate database (1)" })).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "Include – Migrate database (2)" })).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "Include – Q3 status report" })).toBeTruthy();
  });

  // ★★ The rows that most need to be visible: document writes take NO undo
  // capture, so a blank or missing row here is a write the user cannot refuse.
  it("renders a descriptor-less row with its tool name rather than blank", () => {
    renderCard();
    expect(screen.getByText("create_document")).toBeTruthy();
    expect(screen.getAllByText("delete_all_tasks")).toHaveLength(2); // title + tool name
    // And it is a real, selectable row — not a stub.
    expect(
      (screen.getByRole("checkbox", { name: "Include – Q3 status report" }) as HTMLInputElement)
        .disabled,
    ).toBe(false);
  });

  it("marks a cascaded row and makes it unselectable", () => {
    renderCard([ROWS[0], { ...ROWS[1], cascaded: true }, ROWS[2], ROWS[3]]);
    expect(screen.getByText("Needs a change you rejected")).toBeTruthy();
    const cb = screen.getByRole("checkbox", {
      name: "Include – Migrate database (2)",
    }) as HTMLInputElement;
    expect(cb.disabled).toBe(true);
    expect(cb.checked).toBe(false);
  });

  it("marks a row that failed at apply", () => {
    renderCard([{ ...ROWS[0], failed: true }, ROWS[1]]);
    expect(screen.getByText("Not applied — changed since you reviewed")).toBeTruthy();
  });

  // §381 — the card used to render the identical "changed since you reviewed"
  // string for every not-ok row. Each `failedKind` now gets its own truthful
  // string; an absent kind still falls back to the pre-existing conflict copy.
  it.each([
    ["conflict", "Not applied — changed since you reviewed"],
    ["dependency", "Not applied — a row it depends on was not created"],
    ["unreadable", "Not applied — its target could not be read back"],
    ["error", "Not applied"],
  ] as const)("labels a %s failure with its own string", (kind, expected) => {
    render(
      <ChatProposalBlock
        lang="en-US"
        rows={[
          {
            index: 0,
            call: { name: "update_task", input: { id: 1 } },
            plan: emptyPlan(),
            title: "A task",
            failed: true,
            failedKind: kind,
          },
        ]}
        selected={new Set()}
        onToggleRow={() => {}}
        onApply={() => {}}
        onDiscard={() => {}}
      />,
    );
    // ★★★ THE WHOLE STRING, NOT A SUBSTRING, AND THAT IS THE POINT. All four
    //  labels open with "Not applied", and the `conflict` fallback contains the
    //  distinguishing clause of none of the others — so a `new RegExp(...)`
    //  substring match let the `error` case PASS AGAINST THE UNFIXED CODE, where
    //  every kind still rendered `chatProposalFailed`. Measured: with the render
    //  branch reverted to the single key, a substring assertion left 2 of 4 green.
    //  An RTL string matcher is a normalised WHOLE-STRING match, which is what
    //  makes each kind's assertion able to fail.
    expect(screen.getByText(expected)).toBeInTheDocument();
  });

  it("reports the selected count on Apply and calls the handlers it was given", async () => {
    const user = userEvent.setup();
    const { onApply, onDiscard } = renderCard();
    await user.click(screen.getByRole("button", { name: "Apply (4 selected)" }));
    expect(onApply).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "Discard" }));
    expect(onDiscard).toHaveBeenCalledTimes(1);
  });

  it("disables Apply when nothing is selected", () => {
    renderCard(ROWS, { selected: new Set<number>() });
    expect(
      (screen.getByRole("button", { name: "Apply (0 selected)" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("toggles a row through the handler it was given", async () => {
    const user = userEvent.setup();
    const { onToggleRow } = renderCard();
    await user.click(screen.getByRole("checkbox", { name: "Include – Migrate database (2)" }));
    expect(onToggleRow).toHaveBeenCalledWith(1);
  });

  it("collapses a long list behind a disclosure and keeps tokens stable when it opens", async () => {
    const user = userEvent.setup();
    renderCard(ROWS, { collapseAfter: 2 });

    expect(screen.getAllByRole("checkbox")).toHaveLength(2);
    // The token map is built over EVERY row, so the two visible rows are
    // already numbered before the hidden ones appear.
    expect(screen.getByRole("checkbox", { name: "Include – Migrate database (1)" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Show all" }));
    expect(screen.getAllByRole("checkbox")).toHaveLength(4);
    expect(screen.queryByRole("button", { name: "Show all" })).toBeNull();
    expect(screen.getByRole("checkbox", { name: "Include – Migrate database (1)" })).toBeTruthy();
  });

  it("shows every row when the list is at the threshold", () => {
    renderCard(ROWS, { collapseAfter: 4 });
    expect(screen.getAllByRole("checkbox")).toHaveLength(4);
    expect(screen.queryByRole("button", { name: "Show all" })).toBeNull();
  });

  it("counts the whole plan in the header, not just the visible slice", () => {
    renderCard(ROWS, { collapseAfter: 2 });
    expect(screen.getByText("4 writes")).toBeTruthy();
  });

  it("renders each described change beneath its row", () => {
    renderCard();
    // ★★ The READABLE name. This read `getByText("status")` — the raw property
    // — and the label is resolved per row from that row's OWN tool name, so
    // row 0 (`update_task`) and row 1 (`update_raid_item`) go through different
    // entities.
    expect(screen.getByText("Status")).toBeTruthy();
    expect(screen.getByText("Owner")).toBeTruthy();
    expect(screen.getByText(/To Do/)).toBeTruthy();
  });

  // ★★★ A staged proposal MIXES entities, so one card-wide entity would
  // mislabel every row but the first. The SAME `title` property is a change's
  // summary and a stakeholder's role, and the two registers label it
  // differently — so this reddens if the entity is taken from the card rather
  // than from each row's own tool name.
  // ★ NOT resource-vs-change: `resourceJobTitle` and `changeFieldTitle` are
  // both "Title" in EN, so that pairing asserts nothing (it was tried, and it
  // failed on ambiguity rather than on a wrong label).
  it("labels each row's fields through that row's own tool entity", () => {
    renderCard([
      row({
        index: 0,
        title: "Scope change",
        call: { name: "update_change", input: { id: 1 } },
        plan: updatePlan("title", "Old", "New"),
      }),
      row({
        index: 1,
        title: "Ada Lovelace",
        call: { name: "update_stakeholder", input: { id: 2 } },
        plan: updatePlan("title", "Engineer", "Architect"),
      }),
    ]);
    expect(screen.getByText("Title")).toBeInTheDocument();
    expect(screen.getByText("Title / role")).toBeInTheDocument();
  });

  // ★★ A tool with no `INLINE_DESCRIPTORS` entity (every `*_document` tool)
  // yields `undefined`, and the fallback is the raw property name — legible if
  // ugly. A blank label on an approval card would be strictly worse.
  it("falls back to the raw property name for a descriptor-less tool", () => {
    renderCard([
      row({
        index: 0,
        title: "Q3 status report",
        call: { name: "update_document", input: { id: 1 } },
        plan: updatePlan("someDocField", "a", "b"),
      }),
    ]);
    expect(screen.getByText("someDocField")).toBeInTheDocument();
  });

  // ★★★ Before this, `plan.links` and `plan.rejected` were rendered by NO
  // surface — the only occurrence of "rejected" in the card was a comment. A
  // missing LINK line is not merely under-disclosure: relationship writes
  // REPLACE, so supplying one link drops the rest and nothing reconstructs
  // them. The user has to be able to see that before approving it.
  it("renders a link change and a rejected field", () => {
    renderCard([
      row({
        index: 0,
        title: "Migrate database",
        // ★ `update_raid_item`, not the `row()` default `update_task` — TASKS
        // HAVE NO `linkFields`, so a `task.linkedTaskIds` label does not exist
        // and the row would fall back to the raw name, passing this assertion
        // for the wrong reason.
        call: { name: "update_raid_item", input: { id: 7 } },
        plan: {
          ...emptyPlan(),
          links: [
            { field: "linkedTaskIds", before: "Draft brief, Review", after: "Ship", rawIds: [2] },
          ],
          rejected: [
            { toolName: "update_raid_item", reason: "bad-input", detail: "targetDate=nope" },
          ],
        },
      }),
    ]);
    expect(screen.getByText("Linked tasks")).toBeInTheDocument();
    expect(screen.queryByText("linkedTaskIds")).not.toBeInTheDocument();
    expect(screen.getByText(/Draft brief, Review/)).toBeInTheDocument();
    expect(screen.getByText(/Ship/)).toBeInTheDocument();
    expect(screen.getByText("Not applied: targetDate=nope")).toBeInTheDocument();
  });

  // §406 — the describer built `${title} dependencies` and it reached this card
  // verbatim, because `set_task_dependencies` is absent from `TOOL_ENTITY` by
  // design and `fieldLabel` passes an entity-less row's field through unchanged.
  // A German user read "C dependencies". The subject is DATA on the diff now and
  // the card composes it around a TRANSLATED field label.
  it("composes a link subject around a translated field label", async () => {
    // The DE dictionary is lazy — a DE assertion without this reads the EN
    // fallback and passes for the wrong reason.
    await loadI18n("de");
    const de = t("de", "dependencies");
    // Proves the load above really happened: without it this key falls back to
    // the EN string, which is the raw field name the fix is removing.
    expect(de).not.toBe("dependencies");
    renderCard(
      [
        row({
          index: 0,
          title: "set_task_dependencies",
          call: { name: "set_task_dependencies", input: { id: 3 } },
          plan: {
            ...emptyPlan(),
            links: [
              { field: "dependencies", subject: "C", before: "A (FS)", after: "B (SS)", rawIds: [2] },
            ],
          },
        }),
      ],
      { lang: "de" },
    );
    expect(screen.getByText(`C – ${de}`)).toBeInTheDocument();
    expect(screen.queryByText("C dependencies")).not.toBeInTheDocument();
  });

  // A diff with no subject keeps the bare label — the subject exists for the one
  // tool whose ROW TITLE cannot carry the task's name, and qualifying every link
  // on a card that already names its row would read "Migrate database – Migrate
  // database".
  it("leaves a subject-less link label bare", () => {
    renderCard([
      row({
        index: 0,
        title: "Migrate database",
        call: { name: "update_raid_item", input: { id: 7 } },
        plan: {
          ...emptyPlan(),
          links: [{ field: "linkedTaskIds", before: "Draft brief", after: "Ship", rawIds: [2] }],
        },
      }),
    ]);
    expect(screen.getByText("Linked tasks")).toBeInTheDocument();
  });

  // ★★ `isEmptyPlan` deliberately EXCLUDES `rejected` — a rejected call writes
  // nothing, and the flag gates Apply. So a guard of `isEmptyPlan` alone makes
  // the rejection renderer unreachable for the commonest shape a rejection
  // arrives in: a row where the ONLY outcome is that nothing will land.
  it("renders a rejection on a row whose plan writes nothing", () => {
    renderCard([
      row({
        index: 0,
        title: "Migrate database",
        plan: {
          ...emptyPlan(),
          rejected: [{ toolName: "update_task", reason: "unknown-id", detail: "99" }],
        },
      }),
    ]);
    expect(screen.getByText("Not applied: 99")).toBeInTheDocument();
  });

  // ★★ `after` can legitimately be "" — a cleared FK, or a list emptied to
  // nothing. That is the most destructive change this card can show, so the
  // `|| "—"` fallback is load-bearing: a bare `{l.after}` renders NOTHING for
  // "every link removed", and the row then reads as if it kept them.
  it("renders a cleared link list as an em dash rather than as nothing", () => {
    renderCard([
      row({
        index: 0,
        title: "Migrate database",
        plan: {
          ...emptyPlan(),
          links: [{ field: "linkedTaskIds", before: "Draft brief", after: "", rawIds: [] }],
        },
      }),
    ]);
    expect(screen.getByText(/Draft brief → —/)).toBeInTheDocument();
  });

  it("goes inert while an apply is in flight", () => {
    renderCard(ROWS, { busy: true });
    expect((screen.getByRole("button", { name: "Discard" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(
      (screen.getByRole("checkbox", { name: "Include – Q3 status report" }) as HTMLInputElement)
        .disabled,
    ).toBe(true);
  });

  // ★ No string in this card may promise undo: an applied plan's CREATES have
  // no undo op and its DOCUMENT writes take no undo capture at all.
  it("promises no undo anywhere in its copy", () => {
    const { container } = renderCard();
    expect(container.textContent?.toLowerCase()).not.toContain("undo");
  });
});

describe("proposalRowTitle", () => {
  const call = (name: string, input: Record<string, unknown> = {}): ProposedCall => ({
    name,
    input,
  });

  it("prefers the plan's created title", () => {
    const plan: EditPlan = {
      ...emptyPlan(),
      creates: [{ entity: "task", title: "Ship it", toolName: "create_task", input: {} }],
    };
    expect(proposalRowTitle(call("create_task", { taskName: "other" }), plan)).toBe("Ship it");
  });

  it("falls back to the plan's delete label", () => {
    const plan: EditPlan = {
      ...emptyPlan(),
      deletes: [{ entity: "task", label: "Old task", toolName: "delete_task", id: 1 }],
    };
    expect(proposalRowTitle(call("delete_task", { id: 1 }), plan)).toBe("Old task");
  });

  it("falls back to a title-ish input field, ignoring a blank one", () => {
    expect(proposalRowTitle(call("create_document", { title: "  ", name: "Doc" }), emptyPlan())).toBe(
      "Doc",
    );
  });

  // ★ An update carries only FieldDiffs, so this is the shape with no derivable
  // title — the reason `ProposalCardRow.title` is a REQUIRED prop rather than
  // silently defaulting to a tool name.
  it("falls back to the tool name when nothing identifies the row", () => {
    expect(proposalRowTitle(call("update_task", { id: 4, status: "Done" }), emptyPlan())).toBe(
      "update_task",
    );
  });
});
