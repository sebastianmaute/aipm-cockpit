import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { fireEvent } from "@testing-library/react";
import { JiraSettingsSection } from "./jira-settings";
import { defaultJiraConfig } from "./settings-types";

// Stub out Jira API calls — tests are pure UI
vi.mock("./jira-api", () => ({
  classifyJiraError: vi.fn(),
  formatJiraError: vi.fn(() => "error"),
  listIssueTypes: vi.fn(() => Promise.resolve([])),
  listProjects: vi.fn(() => Promise.resolve([])),
  searchUsers: vi.fn(() => Promise.resolve([])),
  testConnection: vi.fn(() => Promise.resolve({ displayName: "Test User" })),
}));

function renderSection() {
  return render(
    <JiraSettingsSection
      lang="en-US"
      config={defaultJiraConfig}
      onChange={vi.fn()}
    />,
  );
}

describe("JiraSettingsSection — InfoTooltip affordances", () => {
  it("renders InfoTooltip help in Jira settings", () => {
    renderSection();
    // Open the collapsible section
    fireEvent.click(screen.getByRole("button", { name: /jira integration/i }));

    // jiraEnableTooltip is always visible once section is open
    expect(
      screen.getByRole("button", { name: /connect a jira project to sync tasks/i }),
    ).toBeInTheDocument();
  });
});

describe("JiraSettingsSection — alwaysOpen", () => {
  it("with alwaysOpen, the body is visible and no collapse toggle renders", () => {
    render(
      <JiraSettingsSection
        lang="en-US"
        config={defaultJiraConfig}
        onChange={vi.fn()}
        alwaysOpen
      />,
    );
    // Body is shown without any click.
    expect(
      screen.getByRole("button", { name: /connect a jira project to sync tasks/i }),
    ).toBeInTheDocument();
    // The collapse/expand toggle is gone.
    expect(
      screen.queryByRole("button", { name: /jira integration/i }),
    ).not.toBeInTheDocument();
  });

  it("without alwaysOpen, the section starts collapsed behind the toggle", () => {
    renderSection();
    expect(
      screen.getByRole("button", { name: /jira integration/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /connect a jira project to sync tasks/i }),
    ).not.toBeInTheDocument();
  });
});
