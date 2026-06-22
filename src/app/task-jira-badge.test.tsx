import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { JiraBadge } from "./task-jira-badge";
import { t } from "./i18n";

describe("JiraBadge", () => {
  it("renders the jiraKey text", () => {
    render(<JiraBadge jiraKey="ABC-123" lang="en-US" />);
    expect(screen.getByText("ABC-123")).toBeTruthy();
  });

  it("renders an <a> with href + target=_blank + rel includes noopener when href is set", () => {
    render(
      <JiraBadge jiraKey="ABC-123" lang="en-US" href="https://example.atlassian.net/browse/ABC-123" />,
    );
    const link = screen.getByRole("link");
    expect(link.getAttribute("href")).toBe("https://example.atlassian.net/browse/ABC-123");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
  });

  it("renders a <span> (no link) when no href is set", () => {
    render(<JiraBadge jiraKey="ABC-123" lang="en-US" />);
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("marks the lock svg as aria-hidden", () => {
    const { container } = render(<JiraBadge jiraKey="ABC-123" lang="en-US" />);
    const svg = container.querySelector("svg");
    expect(svg).toBeTruthy();
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
  });

  it("carries the jiraSyncedReadOnly string as accessible name (no href)", () => {
    render(<JiraBadge jiraKey="ABC-123" lang="en-US" />);
    expect(screen.getByLabelText(t("en-US", "jiraSyncedReadOnly"))).toBeTruthy();
  });

  it("carries the jiraSyncedReadOnly string as accessible name (with href)", () => {
    render(
      <JiraBadge jiraKey="ABC-123" lang="en-US" href="https://x.atlassian.net/browse/ABC-123" issueType="Bug" />,
    );
    const link = screen.getByRole("link");
    expect(link.getAttribute("aria-label")).toBe(t("en-US", "jiraSyncedReadOnly"));
    // Title combines key + issueType + the read-only note.
    expect(link.getAttribute("title")).toContain("Bug");
    expect(link.getAttribute("title")).toContain(t("en-US", "jiraSyncedReadOnly"));
  });
});
