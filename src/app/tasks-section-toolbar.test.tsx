import { beforeAll, describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { TasksToolbar, TasksSelectionBar, type TasksToolbarProps } from "./tasks-section-toolbar";
import { buttonClassFor } from "../test/button-variant";
import { TestProviders } from "./test-providers";
import { loadI18n, t, type Lang } from "./i18n";
import { expectRowUniqueNames } from "../test/row-unique-names";
import { FILTER_ALL } from "./task-filters";

function renderToolbar(lang: Lang, over: Partial<TasksToolbarProps> = {}) {
  const props: TasksToolbarProps = {
    lang,
    onAdd: vi.fn(),
    jiraEnabled: false,
    handleJiraSync: vi.fn(),
    jiraSyncing: false,
    jiraProjectKey: "",
    dedupButton: null,
    hideFinished: false,
    onToggleHideFinished: vi.fn(),
    hideExternal: false,
    onToggleHideExternal: vi.fn(),
    tasksViewMode: "table",
    setTasksViewMode: vi.fn(),
    assignableResources: [],
    laneIds: [],
    addLane: vi.fn(),
    search: "",
    setSearch: vi.fn(),
    priorityFilter: "All",
    setPriorityFilter: vi.fn(),
    effectiveFilters: { assignee: FILTER_ALL, group: FILTER_ALL, label: FILTER_ALL },
    setAssigneeFilter: vi.fn(),
    setGroupFilter: vi.fn(),
    setLabelFilter: vi.fn(),
    // `uniqueAssignees` keeps a blank, which the select labels as "no assignee".
    uniqueAssignees: ["", "Ada Lovelace", "Grace Hopper"],
    uniqueGroups: ["Backend", "Frontend"],
    uniqueLabels: ["API", "Docs", "Release 2"],
    healthFilter: "all",
    setHealthFilter: vi.fn(),
    hiddenCols: new Set(),
    setHiddenCols: vi.fn(),
    calendarControls: null,
    onClearAll: vi.fn(),
    clearDisabled: false,
    resetColWidths: vi.fn(),
    resetTableSize: vi.fn(),
    ...over,
  };
  render(<TasksToolbar {...props} />, { wrapper: TestProviders });
  return props;
}

describe("TasksToolbar — every filter option has its own name (§672)", () => {
  beforeAll(() => loadI18n("de"));

  // The assignee, group and label filters list one option per value found on the tasks, after a
  // fixed "all" option. The group filter also has a fixed "No group" option; the assignee
  // filter's "No assignee" is not fixed, it is the label of the blank entry `uniqueAssignees`
  // keeps. Each select's options are scanned on their own, and the selects themselves are scanned
  // too, since they are named only by their hint text.

  // Without the German dictionary the de case would silently re-run en-US, so pin that it loaded.
  test("renders real German for the de case", () => {
    expect(t("de", "assigneeNone")).not.toBe(t("en-US", "assigneeNone"));
  });

  test.each(["en-US", "de"] as const)("names every filter select and every option in it distinctly in %s", (lang) => {
    const props = renderToolbar(lang);
    const select = (key: "assigneeFilterHint" | "tasksGroupFilterHint" | "tasksLabelFilterHint") =>
      screen.getByRole("combobox", { name: t(lang, key) });
    expectRowUniqueNames({ minControls: props.uniqueAssignees.length + 1, scope: select("assigneeFilterHint"), roles: ["option"] });
    expectRowUniqueNames({ minControls: props.uniqueGroups.length + 2, scope: select("tasksGroupFilterHint"), roles: ["option"] });
    expectRowUniqueNames({ minControls: props.uniqueLabels.length + 1, scope: select("tasksLabelFilterHint"), roles: ["option"] });
    // The toolbar's six selects, measured; kept exact so a lost select fails here.
    expectRowUniqueNames({ minControls: 6, roles: ["combobox"] });
  });
});

describe("TasksToolbar — a value named like a fixed option stays its own option (§676)", () => {
  beforeAll(() => loadI18n("de"));

  // Free text can read exactly like a fixed option: a group named "No group",
  // a label named "All labels", an assignee named "No assignee" beside the
  // blank one. Such a value is shown quoted, so no two options share a name,
  // and a value named "All" no longer shares the "no filter" sentinel.
  const seeded = (lang: Lang): Partial<TasksToolbarProps> => ({
    uniqueAssignees: ["", t(lang, "assigneeNone"), "Ada"],
    uniqueGroups: ["All", t(lang, "allGroups"), t(lang, "groupNone").toUpperCase()],
    uniqueLabels: ["All", t(lang, "allLabels")],
  });

  test.each(["en-US", "de"] as const)("names every option distinctly and quotes the look-alikes in %s", (lang) => {
    const props = renderToolbar(lang, seeded(lang));
    const select = (key: "assigneeFilterHint" | "tasksGroupFilterHint" | "tasksLabelFilterHint") =>
      screen.getByRole("combobox", { name: t(lang, key) });
    expectRowUniqueNames({ minControls: props.uniqueAssignees.length + 1, scope: select("assigneeFilterHint"), roles: ["option"] });
    expectRowUniqueNames({ minControls: props.uniqueGroups.length + 2, scope: select("tasksGroupFilterHint"), roles: ["option"] });
    expectRowUniqueNames({ minControls: props.uniqueLabels.length + 1, scope: select("tasksLabelFilterHint"), roles: ["option"] });
    const quoted = (v: string) => t(lang, "filterQuotedValue", v);
    expect(screen.getByRole("option", { name: quoted(t(lang, "assigneeNone")) })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: quoted(t(lang, "allGroups")) })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: quoted(t(lang, "groupNone").toUpperCase()) })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: quoted(t(lang, "allLabels")) })).toBeInTheDocument();
    // A value that only shares a word with a fixed option is left as it is.
    expect(screen.getAllByRole("option", { name: "All" })).toHaveLength(2);
  });

  test("picking a group named All filters by it, and the fixed option still clears the filter", () => {
    const props = renderToolbar("en-US", seeded("en-US"));
    const groups = screen.getByRole("combobox", { name: t("en-US", "tasksGroupFilterHint") });
    fireEvent.change(groups, { target: { value: "All" } });
    expect(props.setGroupFilter).toHaveBeenLastCalledWith("All");
    fireEvent.change(groups, { target: { value: FILTER_ALL } });
    expect(props.setGroupFilter).toHaveBeenLastCalledWith(FILTER_ALL);
  });
});

// §691 — Send inquiries is the accent Button at sm.
describe("TasksSelectionBar Send inquiries", () => {
  test("draws the accent Button", () => {
    render(
      <TasksSelectionBar
        lang="en-US"
        selectedCount={2}
        handleBulkSendInquiry={vi.fn()}
        bulkEditOpen={false}
        onToggleBulkEdit={vi.fn()}
        onDeleteSelected={vi.fn()}
        clearSelection={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: t("en-US", "bulkSendInquiries") }).className).toBe(
      buttonClassFor({ variant: "accent", size: "sm" }),
    );
  });
});
