import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ReadOnlyMirrorBanner } from "./read-only-mirror-banner";

describe("ReadOnlyMirrorBanner", () => {
  it("renders the read-only mirror message in English", () => {
    render(<ReadOnlyMirrorBanner lang="en-US" />);
    expect(screen.getByText(/read-only mirror/i)).toBeInTheDocument();
  });

  it("exposes a status role for assistive tech", () => {
    render(<ReadOnlyMirrorBanner lang="en-US" />);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });
});
