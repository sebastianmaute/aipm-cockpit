import { beforeAll, describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { TasksToolbar, type TasksToolbarProps } from "./tasks-section-toolbar";
import { TestProviders } from "./test-providers";
import { loadI18n, t, type Lang } from "./i18n";
import { expectRowUniqueNames } from "../test/row-unique-names";

function renderToolbar(lang: Lang) {
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
    effectiveFilters: { assignee: "All", group: "All", label: "All" },
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
