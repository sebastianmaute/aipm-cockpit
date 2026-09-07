import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TaskLinkPicker } from "./task-link-picker";
import { expectRowUniqueNames } from "../test/row-unique-names";
import type { Task } from "./types";

// TaskLinkPicker's own job is small and entirely UNWRAPPING: it owns the query
// state, maps tasks to flat `LinkPickerEntry` values for the shared
// `EntityLinkPicker`, and unwraps the entry the picker hands back to the bare
// task ID its callers expect. Everything it renders belongs to
// `EntityLinkPicker` (covered by `entity-link-picker.test.tsx`), so the
// assertions here are deliberately about the SEAM: which value crosses it, and
// what survives the round trip. Until this file existed the component was
// reached only through the four surfaces that mount it.
const LABEL = "Linked tasks – Kickoff deck";

const task = (id: number, taskName: string): Task => ({
  id,
  taskName,
  assignee: "Ada",
  assigneeEmail: "ada@example.com",
  dueDate: "2026-07-01",
  lastUpdateDate: "2026-06-01",
  status: "To Do",
  priority: "Medium",
  blockers: "",
  description: "",
});

type PickerProps = React.ComponentProps<typeof TaskLinkPicker>;

function renderPicker(overrides: Partial<PickerProps> = {}) {
  const props: PickerProps = {
    lang: "en-US",
    tasks: [],
    selectedIds: [],
    onAdd: vi.fn(),
    onRemove: vi.fn(),
    label: LABEL,
    ...overrides,
  };
  return render(<TaskLinkPicker {...props} />);
}

const searchBox = (label = LABEL) => screen.getByRole("combobox", { name: label });

describe("TaskLinkPicker", () => {
  it("offers the caller's tasks as options, filtered by the query", async () => {
    const user = userEvent.setup();
    renderPicker({ tasks: [task(41, "Ship the API"), task(42, "Ship the docs")] });

    // The dropdown only exists once the query is non-blank, so the query is
    // also what proves the option list came from `useTaskPickerOptions` rather
    // than from the raw `tasks` array.
    await user.type(searchBox(), "api");
    expect(screen.getByRole("option", { name: /Ship the API/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Ship the docs/ })).not.toBeInTheDocument();
  });

  it("commits the task ID, not the entry, and clears its own query", async () => {
    // ★ `toHaveBeenCalledWith(41)` is the whole point of this test. The
    // component's contract is `onAdd: (taskId: number) => void`, but what the
    // shared picker hands its own `onAdd` is the `LinkPickerEntry`. Asserting
    // on the entry — or merely on `toHaveBeenCalledTimes(1)` — would pass
    // against a straight passthrough that hands every caller an object where a
    // number is typed, which is exactly the unwrapping this component exists
    // to do.
    const user = userEvent.setup();
    const onAdd = vi.fn();
    renderPicker({ tasks: [task(41, "Ship the API")], onAdd });

    await user.type(searchBox(), "api");
    await user.click(screen.getByRole("option", { name: /Ship the API/ }));

    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onAdd).toHaveBeenCalledWith(41);
    // The query state is the component's OWN, so clearing it after a commit is
    // its responsibility and nothing above it can do the job: leaving the text
    // in place holds the dropdown open over the rest of the form with the
    // just-added task now filtered out of it.
    expect(searchBox()).toHaveValue("");
    expect(screen.queryByRole("option")).not.toBeInTheDocument();
  });

  it("unlinks by task ID, not by the entry the chip was built from", () => {
    const onRemove = vi.fn();
    renderPicker({ tasks: [task(41, "Ship the API")], selectedIds: [41], onRemove });

    fireEvent.click(screen.getByRole("button", { name: "Unlink #41 Ship the API" }));
    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(onRemove).toHaveBeenCalledWith(41);
  });

  it("keeps every chip's control distinct when two linked tasks share a name", () => {
    // The fixture seeds the collision this cares about — two SELECTED tasks
    // with the same `taskName` — and the `#id` code is what keeps the two
    // unlink buttons apart (WCAG 2.4.6). axe has no rule that flags two
    // controls sharing an accessible name, so a unit test is the only detector
    // that can exist here.
    //
    // ★ `requireCollisionSeed` is deliberately OFF despite this being a
    // genuine collision fixture: it certifies a seed by stripping the ` (N)`
    // occurrence suffix `buildRowTokens` appends, and this surface
    // disambiguates the OTHER way — a leading `#41`/`#42` code — so the guard
    // THROWS against correct code here. Measured, not assumed: turning it on
    // fails this test with "no two of the 2 rendered name(s) match once the
    // "(N)" occurrence suffix is stripped". The seed is asserted by hand below
    // instead: both names end in the same shared task name.
    const { container } = renderPicker({
      tasks: [task(41, "Deploy"), task(42, "Deploy")],
      selectedIds: [41, 42],
    });

    // minControls is the MEASURED count for this scope: two chips, one unlink
    // button each, and no clear button because the query is empty. A looser
    // floor would let a silently narrowed scope read as a pass.
    expectRowUniqueNames({ minControls: 2, scope: container });
    expect(screen.getByRole("button", { name: "Unlink #41 Deploy" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Unlink #42 Deploy" })).toBeInTheDocument();
  });

  it("qualifies its clear button so two pickers on one surface do not collide", async () => {
    // The real fixture, not a hypothetical: Knowledge renders one of these per
    // library card, so the unqualified "Clear" the shared picker would
    // otherwise announce appears N times on one screen. That is why
    // `clearLabel` interpolates the caller's row-unique `label` — and it is
    // invisible to any single-picker test, because one "Clear" collides with
    // nothing.
    const user = userEvent.setup();
    const other = "Linked tasks – Risk log";
    const { container } = render(
      <>
        <TaskLinkPicker
          lang="en-US"
          tasks={[task(41, "Ship the API")]}
          selectedIds={[]}
          onAdd={vi.fn()}
          onRemove={vi.fn()}
          label={LABEL}
        />
        <TaskLinkPicker
          lang="en-US"
          tasks={[task(41, "Ship the API")]}
          selectedIds={[]}
          onAdd={vi.fn()}
          onRemove={vi.fn()}
          label={other}
        />
      </>,
    );

    // The ✕ renders only while there is something to clear, so both fields get
    // a query.
    await user.type(searchBox(), "a");
    await user.type(searchBox(other), "a");

    // Two clear buttons, measured — nothing else is rendered in this scope.
    expectRowUniqueNames({ minControls: 2, scope: container });
    // ★ Exact names, not /clear/i: a loose regex passes just as happily
    // against the unqualified string this test exists to reject. The separator
    // is an EN DASH (U+2013).
    expect(screen.getByRole("button", { name: `Clear – ${LABEL}` })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: `Clear – ${other}` })).toBeInTheDocument();
  });

  it("keeps a chip for a linked task that no longer exists, and still unlinks it", () => {
    // The source states this and nothing pinned it: a selected id whose task is
    // gone still renders (with an empty name) so the stale link stays visible
    // and unlinkable. Dropping the chip would hide a dangling reference the
    // user can no longer clear — the link would go on being persisted with no
    // surface anywhere that admits it exists.
    const onRemove = vi.fn();
    const { container } = renderPicker({
      tasks: [task(41, "Ship the API")],
      selectedIds: [41, 99],
      onRemove,
    });

    // The name collapses to just the code, because the label is the empty
    // string the missing task yields.
    const stale = screen.getByRole("button", { name: "Unlink #99" });
    // Both chips render — the live one and the dangling one.
    expect(screen.getAllByRole("button", { name: /^Unlink/ })).toHaveLength(2);
    expectRowUniqueNames({ minControls: 2, scope: container });

    fireEvent.click(stale);
    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(onRemove).toHaveBeenCalledWith(99);
  });
});
