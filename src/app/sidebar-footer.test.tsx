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
  it("renders the storage description (theme control moved to Settings → Appearance)", () => {
    render(<SidebarFooter {...base} />);
    expect(screen.getByText("Local file: lop.json")).toBeTruthy();
    expect(screen.queryByText("Theme")).toBeNull();
  });

  it("shows the account name and a sign-out button when signed in", () => {
    const onSignOut = vi.fn();
    render(<SidebarFooter {...base} isSignedIn accountName="alex@example.com" onSignOut={onSignOut} />);
    expect(screen.getByText("alex@example.com")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(onSignOut).toHaveBeenCalled();
  });

  it("renders nothing when collapsed", () => {
    const { container } = render(<SidebarFooter {...base} collapsed />);
    expect(screen.queryByText("Local file: lop.json")).toBeNull();
    expect(container).toBeEmptyDOMElement();
  });
});
