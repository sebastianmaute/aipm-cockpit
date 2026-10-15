import { describe, it, expect } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { BurndownChainChip, BurndownChainWarning } from "./budget-chain-warning";

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

// The dashboard tile's compact form: a chip that opens the full sentence.
describe("BurndownChainChip", () => {
  const broken = (n: number) => ({
    kind: "broken" as const, reason: "multiple-roots" as const,
    offenders: Array.from({ length: n }, (_, i) => ({ id: i + 1, name: `B${i + 1}` })),
  });

  it("renders nothing for a resolved chain, unchained buckets, no offenders or no chain", () => {
    for (const chain of [
      { kind: "chain" as const, start: "2026-01-01", end: "2026-03-31", order: [1] },
      { kind: "unchained" as const },
      { kind: "broken" as const, reason: "unreachable" as const, offenders: [] },
      null,
    ]) {
      const { container, unmount } = render(<BurndownChainChip lang="en-US" chain={chain} />);
      expect(container.firstChild).toBeNull();
      unmount();
    }
  });

  it("counts the buckets to check, singular and plural", () => {
    const { unmount } = render(<BurndownChainChip lang="en-US" chain={broken(1)} />);
    expect(screen.getByRole("button", { name: (n: string) => n.startsWith("1 bucket to check") })).toBeInTheDocument();
    unmount();
    render(<BurndownChainChip lang="en-US" chain={broken(5)} />);
    expect(screen.getByRole("button", { name: (n: string) => n.startsWith("5 buckets to check") })).toBeInTheDocument();
  });

  // The sentence is only on screen in the bubble, so the trigger's name carries it for a screen
  // reader; the visible chip text comes first (WCAG 2.5.3 label-in-name).
  it("names the chip with its text and then the full warning", () => {
    render(<BurndownChainChip lang="en-US" chain={broken(2)} />);
    const name = screen.getByRole("button").getAttribute("aria-label")!;
    expect(name.startsWith("2 buckets to check: ")).toBe(true);
    expect(name).toContain("not linked into one chain (B1, B2)");
  });

  it("opens the full warning, naming the buckets, on focus", () => {
    render(<BurndownChainChip lang="en-US" chain={broken(2)} />);
    expect(screen.queryByText(/not linked into one chain \(B1, B2\)/)).toBeNull();
    act(() => screen.getByRole("button", { name: (n: string) => n.startsWith("2 buckets to check") }).focus());
    expect(screen.getByText(/not linked into one chain \(B1, B2\)/)).toBeInTheDocument();
  });
});
