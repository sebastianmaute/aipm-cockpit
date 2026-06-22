import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GlobalSearchBox } from "./global-search-box";
import { t } from "./i18n";
import type { Task, RaidItem, ChangeItem, Milestone, Stakeholder } from "./types";

// Minimal fixtures — the engine only reads a subset of fields; cast keeps the
// test focused (the engine itself is unit-tested separately).
const tasks = [
  { id: 1, taskName: "Build login page", assignee: "Alice" },
  { id: 2, taskName: "Write docs", assignee: "Bob" },
] as unknown as Task[];
const raid = [{ id: 5, title: "Vendor risk", owner: "Carol" }] as unknown as RaidItem[];
const changes = [] as unknown as ChangeItem[];
const milestones = [] as unknown as Milestone[];
const stakeholders = [] as unknown as Stakeholder[];

function renderBox(onSelect = vi.fn()) {
  render(
    <GlobalSearchBox
      lang="en-US"
      tasks={tasks}
      raid={raid}
      changes={changes}
      milestones={milestones}
      stakeholders={stakeholders}
      onSelect={onSelect}
    />,
  );
  return { onSelect, input: screen.getByRole("combobox") };
}

describe("GlobalSearchBox", () => {
  it("opens a listbox of options whose accessible name carries the type label + title", async () => {
    const { input } = renderBox();
    await userEvent.type(input, "login");
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    const options = screen.getAllByRole("option");
    expect(options.length).toBeGreaterThan(0);
    // The option's button is named "Task – Build login page".
    expect(
      screen.getByRole("button", { name: /Task – Build login page/i }),
    ).toBeInTheDocument();
  });

  it("ArrowDown then Enter selects the highlighted result", async () => {
    const { onSelect, input } = renderBox();
    await userEvent.type(input, "build");
    await userEvent.keyboard("{ArrowDown}{Enter}");
    expect(onSelect).toHaveBeenCalledTimes(1);
    const arg = onSelect.mock.calls[0][0];
    expect(arg.view).toBe("open-points");
    expect(arg.id).toBe(1);
  });

  it("clicking an option fires onSelect with that result", async () => {
    const { onSelect, input } = renderBox();
    await userEvent.type(input, "vendor");
    const btn = screen.getByRole("button", { name: /RAID – Vendor risk/i });
    await userEvent.click(btn);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0][0]).toMatchObject({ view: "raid", id: 5 });
  });

  it("Escape closes the listbox and clears the query", async () => {
    const { input } = renderBox();
    await userEvent.type(input, "login");
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("option")).not.toBeInTheDocument();
    expect((input as HTMLInputElement).value).toBe("");
  });

  it("1-char free-text stays closed; a ≥2-char query with no match shows the no-results message", async () => {
    const { input } = renderBox();
    await userEvent.type(input, "z");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    await userEvent.type(input, "zzz");
    expect(screen.queryByRole("option")).not.toBeInTheDocument();
    expect(screen.getByText(t("en-US", "searchNoResults"))).toBeInTheDocument();
  });

  it("exposes role=combobox with the searchLabel aria-label", () => {
    const { input } = renderBox();
    expect(input).toHaveAttribute("aria-label", t("en-US", "searchLabel"));
  });
});
