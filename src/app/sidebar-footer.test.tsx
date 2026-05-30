import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { SidebarFooter } from "./sidebar-footer";

const base = {
  lang: "en-US" as const,
  collapsed: false,
  storageDescription: "Local file: lop.json",
  storageReady: true,
  accountName: null as string | null,
  isSignedIn: false,
  onSignOut: () => {},
};

describe("SidebarFooter", () => {
  it("renders the theme control label and the storage description", () => {
    render(<SidebarFooter {...base} />);
    expect(screen.getByText("Local file: lop.json")).toBeTruthy();
    expect(screen.getAllByText("Theme").length).toBeGreaterThanOrEqual(1);
  });

  it("shows the account name and a sign-out button when signed in", () => {
    const onSignOut = vi.fn();
    render(<SidebarFooter {...base} isSignedIn accountName="alex@example.com" onSignOut={onSignOut} />);
    expect(screen.getByText("alex@example.com")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(onSignOut).toHaveBeenCalled();
  });

  it("hides the storage description when collapsed (keeps the theme control compact)", () => {
    render(<SidebarFooter {...base} collapsed />);
    expect(screen.queryByText("Local file: lop.json")).toBeNull();
  });
});
