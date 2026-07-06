import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { fireEvent } from "@testing-library/react";
import { GlobalSearchBox } from "./global-search-box";
import { saveRecents } from "./search-recents";
import { t } from "./i18n";
import type {
  Task,
  RaidItem,
  ChangeItem,
  Milestone,
  Stakeholder,
  BudgetBucket,
  Resource,
} from "./types";

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
const budgets = [{ id: 8, name: "Phase 1 PO", poNumber: "PO-99" }] as unknown as BudgetBucket[];
const resources = [
  { id: 9, firstName: "Grace", lastName: "Hopper", email: "grace@x.io" },
] as unknown as Resource[];

beforeEach(() => {
  localStorage.clear();
  // jsdom has no layout engine — stub scrollIntoView so highlight nav doesn't throw.
  Element.prototype.scrollIntoView = vi.fn();
});

function renderBox(onSelect = vi.fn()) {
  render(
    <GlobalSearchBox
      lang="en-US"
      tasks={tasks}
      raid={raid}
      changes={changes}
      milestones={milestones}
      stakeholders={stakeholders}
      budgets={budgets}
      resources={resources}
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
    // The option element itself is named "Task – Build login page" — no nested
    // interactive descendant (ARIA listbox pattern).
    const opt = screen.getByRole("option", { name: /Task – Build login page/i });
    expect(opt).toBeInTheDocument();
    for (const o of options) expect(o.querySelector("button")).toBeNull();
  });

  it("surfaces budget and resource results and deep-links them (#16)", async () => {
    const { onSelect, input } = renderBox();
    // Resource by composed name.
    await userEvent.type(input, "hopper");
    expect(
      screen.getByRole("option", { name: /Resource – Grace Hopper/i }),
    ).toBeInTheDocument();
    await userEvent.clear(input);
    // Budget by name → routes to the budget view.
    await userEvent.type(input, "Phase 1 PO");
    const opt = screen.getByRole("option", { name: /Budget – Phase 1 PO/i });
    expect(opt).toBeInTheDocument();
    fireEvent.click(opt);
    const arg = onSelect.mock.calls.at(-1)?.[0];
    expect(arg.type).toBe("budget");
    expect(arg.view).toBe("budget");
    expect(arg.id).toBe(8);
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

  it("Enter with no ArrowDown selects the FIRST result", async () => {
    const { onSelect, input } = renderBox();
    await userEvent.type(input, "page");
    await userEvent.keyboard("{Enter}");
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0][0]).toMatchObject({ view: "open-points", id: 1 });
  });

  it("clicking an option fires onSelect with that result", async () => {
    const { onSelect, input } = renderBox();
    await userEvent.type(input, "vendor");
    const opt = screen.getByRole("option", { name: /RAID – Vendor risk/i });
    await userEvent.click(opt);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0][0]).toMatchObject({ view: "raid", id: 5 });
  });

  it("ArrowDown sets aria-activedescendant on the input to the highlighted option's id", async () => {
    const { input } = renderBox();
    await userEvent.type(input, "login");
    await userEvent.keyboard("{ArrowDown}");
    const activeId = input.getAttribute("aria-activedescendant");
    expect(activeId).toBeTruthy();
    const opt = screen.getByRole("option", { name: /Task – Build login page/i });
    expect(opt.id).toBe(activeId);
    expect(opt).toHaveAttribute("aria-selected", "true");
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

  it("renders a decorative aria-hidden shortcut hint when empty and hides it while typing", async () => {
    const { input } = renderBox();
    const kbd = document.querySelector("kbd");
    expect(kbd).not.toBeNull();
    // Decorative: must NOT pollute the combobox accessible name.
    expect(kbd).toHaveAttribute("aria-hidden", "true");
    expect(kbd?.textContent).toMatch(/K/);
    // Once the user types a query, the hint disappears so it can't sit under text.
    await userEvent.type(input, "login");
    expect(document.querySelector("kbd")).toBeNull();
  });

  it("⌘K (or Ctrl+K) focuses the search input", () => {
    const { input } = renderBox();
    expect(document.activeElement).not.toBe(input);
    fireEvent.keyDown(document, { key: "k", metaKey: true });
    expect(document.activeElement).toBe(input);
  });

  it("'/' focuses the search input when no editable element is focused", () => {
    const { input } = renderBox();
    expect(document.activeElement).toBe(document.body);
    fireEvent.keyDown(document, { key: "/" });
    expect(document.activeElement).toBe(input);
  });

  it("'/' does NOT steal focus from another editable element", () => {
    const { input } = renderBox();
    const other = document.createElement("textarea");
    document.body.appendChild(other);
    other.focus();
    expect(document.activeElement).toBe(other);
    fireEvent.keyDown(document, { key: "/" });
    expect(document.activeElement).toBe(other);
    expect(document.activeElement).not.toBe(input);
    other.remove();
  });

  it("shows recent items (that still exist) on empty focus and selects on click", async () => {
    saveRecents([
      { type: "task", id: 1, view: "open-points", title: "Recent A", subtitle: "Alice" },
    ]);
    const { onSelect, input } = renderBox();
    fireEvent.focus(input);
    expect(screen.getByText(t("en-US", "searchRecent"))).toBeInTheDocument();
    const opt = screen.getByRole("option", { name: /Recent A/i });
    expect(opt).toBeInTheDocument();
    await userEvent.click(opt);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0][0]).toMatchObject({ type: "task", id: 1 });
  });

  it("filters out a recent item whose id no longer exists in the workspace", () => {
    saveRecents([
      { type: "task", id: 999, view: "open-points", title: "Ghost task", subtitle: "" },
    ]);
    const { input } = renderBox();
    fireEvent.focus(input);
    expect(screen.queryByText(t("en-US", "searchRecent"))).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Ghost task/i })).not.toBeInTheDocument();
  });

  it("highlights the matched substring in results with a <mark>", async () => {
    const { input } = renderBox();
    await userEvent.type(input, "log");
    const listbox = screen.getByRole("listbox");
    const mark = listbox.querySelector("mark");
    expect(mark).not.toBeNull();
    expect(mark?.textContent?.toLowerCase()).toBe("log");
  });
});
