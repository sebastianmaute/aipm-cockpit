import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { fireEvent } from "@testing-library/react";
import { JiraSettingsSection } from "./jira-settings";
import { defaultJiraConfig, type JiraConfig } from "./settings-types";
import { listProjects } from "./jira-api";
import { ToastProvider } from "./toast-context";
import { readDiagLog, clearDiagLog } from "./diagnostics";

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

describe("JiraSettingsSection — project-list load failure after a successful test", () => {
  const showToastSpy = vi.fn();

  beforeEach(() => {
    clearDiagLog();
    showToastSpy.mockClear();
  });

  it("surfaces a rejected follow-up project-list load as a logged event + error toast, while the auth test still reports Connected", async () => {
    vi.mocked(listProjects).mockRejectedValueOnce(new Error("network down"));
    const config: JiraConfig = {
      ...defaultJiraConfig,
      enabled: true,
      siteUrl: "https://acme.atlassian.net",
      email: "pm@acme.com",
      apiToken: "ATATT-token",
    };
    render(
      <ToastProvider value={showToastSpy}>
        <JiraSettingsSection lang="en-US" config={config} onChange={vi.fn()} alwaysOpen />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: /test connection/i }));

    // The auth test itself succeeded — status still shows Connected.
    expect(await screen.findByText(/connected as test user/i)).toBeInTheDocument();

    await waitFor(() => {
      expect(
        readDiagLog().some((ev) => ev.code === "jira.projectListLoadFailed"),
      ).toBe(true);
    });
    expect(showToastSpy).toHaveBeenCalledWith("error", expect.any(String));
  });
});

describe("JiraSettingsSection — extra projects block", () => {
  const baseConfig: JiraConfig = {
    ...defaultJiraConfig,
    enabled: true,
    siteUrl: "https://acme.atlassian.net",
    email: "pm@acme.com",
    apiToken: "ATATT-token",
    projectKey: "LOP",
    projectName: "LOP",
    extraProjects: [],
  };

  async function renderWithProjects(config: JiraConfig, onChange = vi.fn()) {
    vi.mocked(listProjects).mockResolvedValueOnce([
      { id: "1", key: "LOP", name: "LOP" },
      { id: "2", key: "OPS", name: "Ops" },
      { id: "3", key: "DEV", name: "Dev" },
    ]);
    render(
      <JiraSettingsSection
        lang="en-US"
        config={config}
        onChange={onChange}
        alwaysOpen
      />,
    );
    // Drive the connection-test flow that populates `projects`.
    fireEvent.click(screen.getByRole("button", { name: /test connection/i }));
    // Wait on a project checkbox from the POPULATED list, not the section
    // heading — the heading also renders in the degraded-state fallback (shown
    // when `extraProjects` exist but the project list hasn't loaded yet), so
    // `findByText(heading)` can resolve before `listProjects` mounts the
    // checkboxes, leaving the tests' synchronous `getByRole` queries to race
    // the mock resolution (flakes only under full-suite load).
    await screen.findByRole("checkbox", { name: /include – ops \(ops\)/i });
    return { onChange };
  }

  it("shows the heading and offers only non-primary projects", async () => {
    await renderWithProjects(baseConfig);
    expect(
      screen.getByText(/also sync from other projects/i),
    ).toBeInTheDocument();
    // Non-primary projects are offered…
    expect(
      screen.getByRole("checkbox", { name: /include – ops \(ops\)/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: /include – dev \(dev\)/i }),
    ).toBeInTheDocument();
    // …but the primary project (LOP) is excluded from the list.
    expect(
      screen.queryByRole("checkbox", { name: /include – lop \(lop\)/i }),
    ).not.toBeInTheDocument();
  });

  it("including a project appends it read-only", async () => {
    const { onChange } = await renderWithProjects(baseConfig);
    fireEvent.click(
      screen.getByRole("checkbox", { name: /include – ops \(ops\)/i }),
    );
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        extraProjects: [{ key: "OPS", name: "Ops", readOnly: true }],
      }),
    );
  });

  it("unchecking an included project removes it from extraProjects", async () => {
    const seeded: JiraConfig = {
      ...baseConfig,
      extraProjects: [{ key: "OPS", name: "Ops", readOnly: true }],
    };
    const { onChange } = await renderWithProjects(seeded);
    fireEvent.click(
      screen.getByRole("checkbox", { name: /include – ops \(ops\)/i }),
    );
    const lastCall = onChange.mock.calls.at(-1)?.[0] as JiraConfig;
    expect(lastCall.extraProjects).not.toContainEqual(
      expect.objectContaining({ key: "OPS" }),
    );
  });

  it("toggling read-only flips the entry's readOnly flag", async () => {
    const seeded: JiraConfig = {
      ...baseConfig,
      extraProjects: [{ key: "OPS", name: "Ops", readOnly: true }],
    };
    const { onChange } = await renderWithProjects(seeded);
    const readOnlyToggle = screen.getByRole("checkbox", {
      name: /read-only – ops \(ops\)/i,
    });
    expect(readOnlyToggle).toBeChecked();
    fireEvent.click(readOnlyToggle);
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        extraProjects: [{ key: "OPS", name: "Ops", readOnly: false }],
      }),
    );
  });
});
