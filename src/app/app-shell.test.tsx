import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AppShell } from "./app-shell";

describe("AppShell", () => {
  it("renders the classic tree when layout is classic", () => {
    render(<AppShell layout="classic" classic={<div data-testid="classic" />} modern={<div data-testid="modern" />} />);
    expect(screen.getByTestId("classic")).toBeTruthy();
    expect(screen.queryByTestId("modern")).toBeNull();
  });
  it("renders the modern shell when layout is modern", () => {
    render(<AppShell layout="modern" classic={<div data-testid="classic" />} modern={<div data-testid="modern" />} />);
    expect(screen.getByTestId("modern")).toBeTruthy();
    expect(screen.queryByTestId("classic")).toBeNull();
  });
});
