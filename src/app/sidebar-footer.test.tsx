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

  describe("saving-paused indicator", () => {
    // ★★★ This control is the DOOR BACK. `SavingPausedBanner` is dismissable
    // and is the only surface carrying "Save anyway", so without a control that
    // re-shows it a single ✕ leaves the user editing into a session that saves
    // nothing. Everything below pins that the door exists and opens.
    it("is absent while saving is running", () => {
      render(<SidebarFooter {...base} />);
      expect(screen.queryByRole("button", { name: /saving paused/i })).toBeNull();
    });

    it("names the paused state in TEXT, not by colour alone, and re-opens the notice", () => {
      const onRestoreSavingNotice = vi.fn();
      render(<SidebarFooter {...base} savingPaused onRestoreSavingNotice={onRestoreSavingNotice} />);
      const btn = screen.getByRole("button", { name: /saving paused/i });
      // WCAG 1.4.1: an amber dot alone would be the only cue.
      expect(btn.textContent).toMatch(/saving paused/i);
      fireEvent.click(btn);
      expect(onRestoreSavingNotice).toHaveBeenCalledTimes(1);
    });

    it("stays reachable in the COLLAPSED rail, where everything else is hidden", () => {
      // A lockout whose only exit disappears when you narrow the sidebar is the
      // same defect with an extra step.
      const onRestoreSavingNotice = vi.fn();
      render(<SidebarFooter {...base} collapsed savingPaused onRestoreSavingNotice={onRestoreSavingNotice} />);
      // Control: the rest of the footer really is suppressed here.
      expect(screen.queryByText("Local file: lop.json")).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: /saving paused/i }));
      expect(onRestoreSavingNotice).toHaveBeenCalledTimes(1);
    });

    it("carries a SHAPE, not just a colour, when collapsed", () => {
      // ★★ Collapsed there is no text, so without a glyph the only cue is an
      // amber dot. `title` does not rescue that — hover-only, no keyboard focus,
      // unreachable on touch (this repo records the same conclusion for
      // ResourcePicker) — and the dot's contrast on the dark sidebar is a
      // question jsdom cannot answer. A glyph survives both.
      render(<SidebarFooter {...base} collapsed savingPaused onRestoreSavingNotice={vi.fn()} />);
      expect(screen.getByRole("button", { name: /saving paused/i }).textContent).toContain("⏸");
    });

    it("renders no dead control when there is nowhere to go back to", () => {
      // A button with no handler would draw a false affordance.
      render(<SidebarFooter {...base} savingPaused />);
      expect(screen.queryByRole("button", { name: /saving paused/i })).toBeNull();
    });
  });
});
