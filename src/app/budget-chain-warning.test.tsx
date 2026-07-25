import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { BurndownChainWarning } from "./budget-chain-warning";

describe("BurndownChainWarning", () => {
  it("renders nothing for a resolved chain", () => {
    const { container } = render(
      <BurndownChainWarning lang="en-US" chain={{ kind: "chain", start: "2026-01-01", end: "2026-03-31", order: [1] }} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing for unchained buckets", () => {
    // Parallel workstream buckets are the normal budget model — nothing broke,
    // so there is nothing to explain.
    const { container } = render(<BurndownChainWarning lang="en-US" chain={{ kind: "unchained" }} />);
    expect(container.firstChild).toBeNull();
  });

  it("names the offending bucket for a dangling successor", () => {
    render(
      <BurndownChainWarning
        lang="en-US"
        chain={{ kind: "broken", reason: "dangling", offenders: [{ id: 1, name: "Phase 1" }] }}
      />,
    );
    expect(screen.getByText(/successor that no longer exists \(Phase 1\)/)).toBeInTheDocument();
  });

  it("explains a chain dated outside the plan", () => {
    render(
      <BurndownChainWarning
        lang="en-US"
        chain={{ kind: "broken", reason: "outside-plan", offenders: [{ id: 1, name: "Phase 1" }] }}
      />,
    );
    expect(screen.getByText(/outside the resource plan's date range \(Phase 1\)/)).toBeInTheDocument();
  });

  it("renders nothing when the chain is null", () => {
    const { container } = render(<BurndownChainWarning lang="en-US" chain={null} />);
    expect(container.firstChild).toBeNull();
  });

  it("names the offending buckets for multiple roots", () => {
    render(
      <BurndownChainWarning
        lang="en-US"
        chain={{ kind: "broken", reason: "multiple-roots", offenders: [{ id: 1, name: "Phase 1" }, { id: 2, name: "Phase 2" }] }}
      />,
    );
    expect(screen.getByText(/not linked into one chain \(Phase 1, Phase 2\)/)).toBeInTheDocument();
  });

  it("uses the reason-specific copy for a cycle", () => {
    render(
      <BurndownChainWarning lang="en-US" chain={{ kind: "broken", reason: "cycle", offenders: [{ id: 1, name: "A" }] }} />,
    );
    expect(screen.getByText(/form a loop \(A\)/)).toBeInTheDocument();
  });

  it("renders nothing when there are no offenders (empty workspace)", () => {
    const { container } = render(
      <BurndownChainWarning lang="en-US" chain={{ kind: "broken", reason: "unreachable", offenders: [] }} />,
    );
    expect(container.firstChild).toBeNull();
  });
});
