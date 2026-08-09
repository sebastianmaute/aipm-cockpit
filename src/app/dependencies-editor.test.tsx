import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DependencyLinkGroup } from "./dependencies-editor";
import type { Task, TaskDependency } from "./types";

function task(id: number, name: string, dependencies: TaskDependency[] = []): Task {
  return {
    id,
    taskName: name,
    assignee: "",
    assigneeEmail: "",
    dueDate: "2026-01-01",
    lastUpdateDate: "2026-01-01",
    priority: "Medium",
    status: "To Do",
    blockers: "",
    description: "",
    group: "",
    labels: [],
    inquiriesSent: 0,
    createdDate: "2026-01-01",
    dependencies,
  } as Task;
}

const TASKS = [task(1, "Own task"), task(2, "Draft the API spec"), task(3, "Ship the release")];

describe("DependencyLinkGroup", () => {
  it("adds the picked task with the currently selected type", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <DependencyLinkGroup lang="en-US" direction="predecessor" links={[]} allTasks={TASKS} ownTaskId={1} onChange={onChange} />,
    );
    await user.selectOptions(screen.getByRole("combobox", { name: "Predecessor type for next link" }), "SS");
    await user.type(screen.getByRole("combobox", { name: "Search predecessor tasks" }), "api");
    await user.click(screen.getByRole("option", { name: /Draft the API spec/ }));
    expect(onChange).toHaveBeenCalledWith([{ taskId: 2, type: "SS" }]);
  });

  it("excludes the owning task and anything already linked from the options", async () => {
    const user = userEvent.setup();
    render(
      <DependencyLinkGroup lang="en-US" direction="predecessor" links={[{ taskId: 2, type: "FS" }]} allTasks={TASKS} ownTaskId={1} onChange={vi.fn()} />,
    );
    // `*` lists everything (wildcardMatcher turns it into /.*/), so ONE query
    // puts all three tasks in front of the filter and the two exclusions are
    // measured against a live control rather than against an empty list.
    // A text query cannot do that here: "task" matches only "Own task", so the
    // list would be legitimately empty and both absences below would pass for
    // the trivial reason.
    await user.type(screen.getByRole("combobox", { name: "Search predecessor tasks" }), "*");
    // CONTROL: neither the owning task nor already linked ⇒ MUST be offered.
    // Without it, any mutation that simply empties `options` passes this test.
    expect(screen.getByRole("option", { name: /Ship the release/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Own task/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Draft the API spec/ })).not.toBeInTheDocument();
  });

  // ★★★ Same collision shape as the engine test. Own(1) depends on 2, so
  // offering 2 as a SUCCESSOR would close 1 -> 2 -> 1. A guard written the
  // predecessor way round still offers it.
  it("filters successor options with the cycle guard run reversed", async () => {
    const user = userEvent.setup();
    const tasks = [task(1, "Own task", [{ taskId: 2, type: "FS" }]), task(2, "Draft the API spec")];
    // ★★★ UNMOUNT between the two directions — do NOT `rerender` with a changed
    // `direction`. The component owns its `query` state and the element type is
    // unchanged, so a rerender KEEPS it: the second `user.type` APPENDS, the
    // query becomes "apiapi", and the absence assertion below then passes
    // because nothing matches the text — whatever the cycle guard does.
    // Measured, not reasoned: written with `rerender`, this test stayed GREEN
    // with the successor arm mutated to the predecessor form.
    const { unmount } = render(
      <DependencyLinkGroup lang="en-US" direction="predecessor" links={[]} allTasks={tasks} ownTaskId={1} onChange={vi.fn()} />,
    );
    // CONTROL: as a predecessor candidate the same task IS offered, so the
    // assertion below cannot pass for the trivial reason that nothing matches.
    await user.type(screen.getByRole("combobox", { name: "Search predecessor tasks" }), "api");
    expect(screen.getByRole("option", { name: /Draft the API spec/ })).toBeInTheDocument();
    unmount();

    render(
      <DependencyLinkGroup lang="en-US" direction="successor" links={[]} allTasks={tasks} ownTaskId={1} onChange={vi.fn()} />,
    );
    const successorSearch = screen.getByRole("combobox", { name: "Search successor tasks" });
    // Guards the fresh mount: a leftover query would defeat the assertion.
    expect(successorSearch).toHaveValue("");
    await user.type(successorSearch, "api");
    expect(screen.queryByRole("option", { name: /Draft the API spec/ })).not.toBeInTheDocument();
  });

  it("names each remove button for its direction and its link", () => {
    render(
      <DependencyLinkGroup lang="en-US" direction="successor" links={[{ taskId: 2, type: "FS" }, { taskId: 3, type: "SS" }]} allTasks={TASKS} ownTaskId={1} onChange={vi.fn()} />,
    );
    expect(screen.getByRole("button", { name: "Remove successor FS #2 Draft the API spec" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove successor SS #3 Ship the release" })).toBeInTheDocument();
  });

  // ★★ Clicks the SECOND chip on purpose. Clicking the first, `filter(l =>
  // l.taskId !== 2)` and a plain `links.slice(1)` both yield [{3,SS}], so that
  // spelling of the test passes against removal-by-position and pins nothing.
  it("removes the clicked link by id, not by position", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <DependencyLinkGroup lang="en-US" direction="predecessor" links={[{ taskId: 2, type: "FS" }, { taskId: 3, type: "SS" }]} allTasks={TASKS} ownTaskId={1} onChange={onChange} />,
    );
    await user.click(screen.getByRole("button", { name: /Remove predecessor SS #3/ }));
    expect(onChange).toHaveBeenCalledWith([{ taskId: 2, type: "FS" }]);
  });

  // ★★ `sanitizeDependencies` dedupes on the (taskId, type) PAIR, so this is a
  // legal STORED shape — it arrives via the AI `update_task` tool, a CSV/JSON
  // import or a hand-edited file, never from this picker. Rendered raw it was
  // two chips sharing one React key, and either ✕ removed both.
  it("renders one chip per task for a duplicated link, and its ✕ clears both", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <DependencyLinkGroup lang="en-US" direction="predecessor" links={[{ taskId: 2, type: "FS" }, { taskId: 2, type: "SS" }, { taskId: 3, type: "SS" }]} allTasks={TASKS} ownTaskId={1} onChange={onChange} />,
    );
    // First link wins, so the surviving chip is the FS one — and the SS
    // duplicate contributes no second chip and no second ✕.
    expect(screen.getByRole("button", { name: "Remove predecessor FS #2 Draft the API spec" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Remove predecessor SS #2/ })).not.toBeInTheDocument();
    // CONTROL: the unrelated link still renders its own chip, so the assertion
    // above is not passing because the chip list collapsed altogether.
    expect(screen.getByRole("button", { name: /Remove predecessor SS #3/ })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Remove predecessor FS #2/ }));
    // Removal is by taskId, so BOTH stored links to task 2 go.
    expect(onChange).toHaveBeenCalledWith([{ taskId: 3, type: "SS" }]);
  });

  // ★★ WCAG 2.5.3 (label-in-name): the visible caption above the type select is
  // shared by both groups, while the accessible name must stay direction-unique
  // (2.4.6) — so the name has to CONTAIN the caption rather than equal it.
  // ★★ Nothing else can catch a drift here. axe DOES ship
  // `label-content-name-mismatch` tagged `wcag21a` — one of the four tags
  // e2e/a11y.spec.ts requests — so a rule listing reads as coverage, but three
  // separate things stop it reaching these controls, and the third means
  // enabling the rule explicitly would not help. The measurement and its
  // reproduce command live beside the markup in dependencies-editor.tsx; this
  // test is what that comment calls the only detector.
  it("keeps each type select's accessible name containing its visible caption", () => {
    const { container } = render(
      <div>
        <DependencyLinkGroup lang="en-US" direction="predecessor" links={[]} allTasks={TASKS} ownTaskId={1} onChange={vi.fn()} />
        <DependencyLinkGroup lang="en-US" direction="successor" links={[]} allTasks={TASKS} ownTaskId={1} onChange={vi.fn()} />
      </div>,
    );
    // ★★★ STRUCTURAL lookup and BOTH sides read from the DOM — no wording
    // literal appears in this test at all. An earlier spelling compared a loop
    // literal against the DOM, which made the containment line UNREACHABLE as a
    // failure: reword one string and the hardcoded lookup throws first; reword
    // BOTH consistently and the literals get updated to match, so nothing
    // re-checks that the new pair still satisfies containment. That is the only
    // case this test exists for.
    // The two type selects are the only `<select>`s here — the search boxes are
    // `<input role="combobox">` — so this needs no text to find them.
    const selects = [...container.querySelectorAll("select")];
    expect(selects).toHaveLength(2); // vacuity guard: an empty set must not pass

    // ★★★ DISTINCTNESS, checked ACROSS the two selects — the per-select
    // `for === id` check below cannot see this. Replace `useId()` with one
    // hardcoded literal and every pairwise check still passes: both labels get
    // `for="x"` and both selects `id="x"`. What breaks is duplicate DOM ids —
    // `getElementById` and label activation both resolve to whichever rendered
    // first, so clicking the SUCCESSOR caption focuses the PREDECESSOR select.
    // Nothing else detects it: axe's `duplicate-id` is deprecated in 4.x, and
    // the task modal is in none of the 17 A11Y_VIEWS anyway.
    const ids = selects.map((s) => s.id);
    expect(new Set(ids).size).toBe(2);

    for (const select of selects) {
      const label = select.parentElement?.querySelector("label") ?? null;
      expect(label).not.toBeNull();
      // Pins the htmlFor binding — that is what makes the caption clickable.
      expect(select.id).not.toBe("");
      expect(label!.getAttribute("for")).toBe(select.id);

      const caption = label!.textContent?.trim() ?? "";
      const name = select.getAttribute("aria-label") ?? "";
      expect(caption).not.toBe("");
      expect(name).not.toBe("");
      // Case-insensitive BY THE SPEC, not by our leniency — Understanding SC
      // 2.5.3, "Punctuation and capitalization": "differences in capitalization
      // and punctuation are not relevant when evaluating this criterion".
      // https://www.w3.org/WAI/WCAG22/Understanding/label-in-name.html
      expect(name.toLowerCase()).toContain(caption.toLowerCase());
    }
  });

  // ★ The query "task" matches ONLY "Own task" in this fixture, so this pins one
  // thing and one thing only: with ownTaskId null there is no graph to walk and
  // the owning task is NOT filtered out. It is deliberately not a claim about
  // "every task" — the exclusion arms are covered by the `*` test above.
  it("does not exclude the owning task when ownTaskId is null", async () => {
    const user = userEvent.setup();
    render(
      <DependencyLinkGroup lang="en-US" direction="successor" links={[]} allTasks={TASKS} ownTaskId={null} onChange={vi.fn()} />,
    );
    await user.type(screen.getByRole("combobox", { name: "Search successor tasks" }), "task");
    expect(screen.getByRole("option", { name: /Own task/ })).toBeInTheDocument();
  });

  // ★★ axe CANNOT detect duplicate accessible names, at any seed size, in any
  // view — and the task modal is not reached by the view scan at all. This is
  // the only detector for the six fixed controls the two groups contribute.
  it("gives the two groups' controls six distinct accessible names", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <div>
        <DependencyLinkGroup lang="en-US" direction="predecessor" links={[]} allTasks={TASKS} ownTaskId={1} onChange={vi.fn()} />
        <DependencyLinkGroup lang="en-US" direction="successor" links={[]} allTasks={TASKS} ownTaskId={1} onChange={vi.fn()} />
      </div>,
    );
    // The clear ✕ renders only once its field has a value, so both fields have
    // to be typed into before all six controls exist.
    await user.type(screen.getByRole("combobox", { name: "Search predecessor tasks" }), "a");
    await user.type(screen.getByRole("combobox", { name: "Search successor tasks" }), "a");

    const names = [
      ...within(container).getAllByRole("combobox"), // 2 search inputs + 2 type selects
      ...within(container).getAllByRole("button", { name: /^Clear/ }), // 2 clears
    ].map((el) => el.getAttribute("aria-label") ?? el.textContent);

    expect(names).toHaveLength(6);
    expect(new Set(names).size).toBe(6);
  });
});
