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
    await user.selectOptions(screen.getByRole("combobox", { name: "Predecessor dependency type" }), "SS");
    await user.type(screen.getByRole("combobox", { name: "Search predecessor tasks" }), "api");
    await user.click(screen.getByRole("option", { name: /Draft the API spec/ }));
    expect(onChange).toHaveBeenCalledWith([{ taskId: 2, type: "SS" }]);
  });

  it("excludes the owning task and anything already linked from the options", async () => {
    const user = userEvent.setup();
    render(
      <DependencyLinkGroup lang="en-US" direction="predecessor" links={[{ taskId: 2, type: "FS" }]} allTasks={TASKS} ownTaskId={1} onChange={vi.fn()} />,
    );
    await user.type(screen.getByRole("combobox", { name: "Search predecessor tasks" }), "task");
    expect(screen.queryByRole("option", { name: /Own task/ })).not.toBeInTheDocument();
    await user.clear(screen.getByRole("combobox", { name: "Search predecessor tasks" }));
    await user.type(screen.getByRole("combobox", { name: "Search predecessor tasks" }), "api");
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

  it("removes only the clicked link", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <DependencyLinkGroup lang="en-US" direction="predecessor" links={[{ taskId: 2, type: "FS" }, { taskId: 3, type: "SS" }]} allTasks={TASKS} ownTaskId={1} onChange={onChange} />,
    );
    await user.click(screen.getByRole("button", { name: /Remove predecessor FS #2/ }));
    expect(onChange).toHaveBeenCalledWith([{ taskId: 3, type: "SS" }]);
  });

  it("offers every task on the create path, where no cycle is possible", async () => {
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
