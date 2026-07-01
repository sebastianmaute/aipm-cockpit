import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { JiraBadge } from "./task-jira-badge";
import { t } from "./i18n";

describe("JiraBadge", () => {
  it("renders the key text", () => {
    render(<JiraBadge jiraKey="ABC-123" lang="en-US" />);
    expect(screen.getByText("ABC-123")).toBeInTheDocument();
  });

  it("two-way (default) uses the two-way accessible name", () => {
    render(<JiraBadge jiraKey="ABC-123" lang="en-US" />);
    expect(screen.getByLabelText("Synced with Jira (two-way)")).toBeInTheDocument();
  });

  it("read-only project uses the read-only accessible name", () => {
    render(<JiraBadge jiraKey="ABC-123" lang="en-US" readOnlyProject />);
    expect(screen.getByLabelText(/read-only/i)).toBeInTheDocument();
  });

  it("link variant keeps href + accessible name", () => {
    render(
      <JiraBadge jiraKey="ABC-123" lang="en-US" readOnlyProject href="https://x.atlassian.net/browse/ABC-123" />,
    );
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "https://x.atlassian.net/browse/ABC-123");
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

  it("marks the glyph svg as aria-hidden", () => {
    const { container } = render(<JiraBadge jiraKey="ABC-123" lang="en-US" />);
    const svg = container.querySelector("svg");
    expect(svg).toBeTruthy();
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
  });

  it("two-way link carries the two-way string as accessible name + title", () => {
    render(
      <JiraBadge jiraKey="ABC-123" lang="en-US" href="https://x.atlassian.net/browse/ABC-123" issueType="Bug" />,
    );
    const link = screen.getByRole("link");
    expect(link.getAttribute("aria-label")).toBe(t("en-US", "jiraSyncedTwoWay"));
    // Title combines key + issueType + the sync note.
    expect(link.getAttribute("title")).toContain("Bug");
    expect(link.getAttribute("title")).toContain(t("en-US", "jiraSyncedTwoWay"));
  });

  it("keeps the jiraKey in the link title when issueType is absent", () => {
    render(
      <JiraBadge jiraKey="ABC-123" lang="en-US" href="https://x.atlassian.net/browse/ABC-123" />,
    );
    const link = screen.getByRole("link");
    expect(link.getAttribute("title")).toContain("ABC-123");
    expect(link.getAttribute("title")).toContain(t("en-US", "jiraSyncedTwoWay"));
  });
});
