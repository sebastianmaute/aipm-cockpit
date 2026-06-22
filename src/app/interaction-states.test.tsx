import { describe, expect, test, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FOCUS_RING, PRESS, TRANSITION, INTERACTIVE } from "./interaction-styles";
import { EmptyState } from "./empty-state";
import { PanelSkeleton, Skeleton } from "./skeleton";

describe("interaction-styles atoms", () => {
  test("FOCUS_RING is the canonical app-wide ring", () => {
    expect(FOCUS_RING).toBe("focus:outline-none focus:ring-2 focus:ring-AIPM-green");
  });

  test("INTERACTIVE bundles transition + focus ring + press", () => {
    expect(INTERACTIVE).toContain(TRANSITION);
    expect(INTERACTIVE).toContain(FOCUS_RING);
    expect(INTERACTIVE).toContain(PRESS);
  });

  test("atoms stay palette-safe: no color/gradient/shadow utilities", () => {
    const all = [FOCUS_RING, PRESS, TRANSITION, INTERACTIVE].join(" ");
    expect(all).not.toMatch(/shadow/);
    expect(all).not.toMatch(/gradient/);
    // no background-fill utilities — the only color token is the brand focus ring
    expect(all).not.toContain("bg-");
  });
});

describe("EmptyState", () => {
  test("renders the title and optional description", () => {
    render(<EmptyState title="Nothing here" description="Add an item to begin" />);
    expect(screen.getByText("Nothing here")).toBeInTheDocument();
    expect(screen.getByText("Add an item to begin")).toBeInTheDocument();
  });

  test("renders a button per action and fires its onClick", () => {
    const onClick = vi.fn();
    render(<EmptyState title="Empty" actions={[{ label: "Create", onClick }]} />);
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  test("renders no buttons when actions are absent", () => {
    render(<EmptyState title="Empty" />);
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("Skeleton / PanelSkeleton", () => {
  test("Skeleton block is decorative (aria-hidden, pulsing)", () => {
    const { container } = render(<Skeleton className="h-4" />);
    const el = container.firstChild as HTMLElement;
    expect(el.getAttribute("aria-hidden")).toBe("true");
    expect(el.className).toContain("animate-pulse");
  });

  test("PanelSkeleton with lang is a labeled status region", () => {
    render(<PanelSkeleton lang="en-US" />);
    const status = screen.getByRole("status");
    expect(status).toBeInTheDocument();
    expect(screen.getByText("Loading…")).toBeInTheDocument();
  });

  test("PanelSkeleton without lang is purely decorative (no status role)", () => {
    render(<PanelSkeleton />);
    expect(screen.queryByRole("status")).toBeNull();
  });
});
