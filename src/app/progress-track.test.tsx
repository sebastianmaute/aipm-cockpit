import { describe, test, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ProgressTrack } from "./progress-track";

describe("ProgressTrack", () => {
  test("renders the canonical muted rounded rail with its children", () => {
    render(
      <ProgressTrack data-testid="track">
        <div data-testid="fill" />
      </ProgressTrack>,
    );
    const track = screen.getByTestId("track");
    expect(track.className).toContain("w-full");
    expect(track.className).toContain("overflow-hidden");
    expect(track.className).toContain("rounded-full");
    expect(track.className).toContain("bg-surface-muted");
    expect(screen.getByTestId("fill")).toBeInTheDocument();
  });

  test("defaults to h-2.5 and honours a height override", () => {
    const { rerender } = render(
      <ProgressTrack data-testid="t">
        <span />
      </ProgressTrack>,
    );
    expect(screen.getByTestId("t").className).toContain("h-2.5");
    rerender(
      <ProgressTrack data-testid="t" height="h-1.5">
        <span />
      </ProgressTrack>,
    );
    expect(screen.getByTestId("t").className).toContain("h-1.5");
    expect(screen.getByTestId("t").className).not.toContain("h-2.5");
  });

  test("appends className (e.g. flex for a segmented bar) and forwards role/aria", () => {
    render(
      <ProgressTrack data-testid="t" className="flex opacity-60" role="img" aria-label="80%">
        <span />
      </ProgressTrack>,
    );
    const t = screen.getByTestId("t");
    expect(t.className).toContain("flex");
    expect(t.className).toContain("opacity-60");
    expect(t).toHaveAttribute("role", "img");
    expect(t).toHaveAttribute("aria-label", "80%");
  });
});
