import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { JiraReadOnlyBanner } from "./jira-readonly-banner";

describe("JiraReadOnlyBanner", () => {
  it("names the project and warns edits won't save", () => {
    render(<JiraReadOnlyBanner lang="en-US" projectName="Ops" />);
    expect(screen.getByText(/Ops/)).toBeInTheDocument();
    expect(screen.getByRole("note")).toBeInTheDocument();
  });
});
