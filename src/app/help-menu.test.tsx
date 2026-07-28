import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { HelpMenu } from "./help-menu";
import { loadI18n, t } from "./i18n";

function openPanel() {
  // The toggle button's accessible name is the translated "help" key ("Help").
  fireEvent.click(screen.getByRole("button", { name: "Help" }));
}

describe("HelpMenu floating panel", () => {
  // The close button's aria-label was the hardcoded English "Close", so German
  // users got an untranslated control. The EN value is unchanged, so only a DE
  // assertion can catch a regression here.
  it("translates the close button (DE dict is lazy — must be loaded first)", async () => {
    await loadI18n("de");
    render(<HelpMenu lang="de" />);
    fireEvent.click(screen.getByRole("button", { name: t("de", "help") }));
    expect(screen.getByRole("button", { name: t("de", "close") })).toBeInTheDocument();
    expect(t("de", "close")).toBe("Schließen");
  });

  it("renders the toggle button when closed", () => {
    render(<HelpMenu lang="en-US" />);
    expect(screen.getByRole("button", { name: "Help" })).toBeInTheDocument();
  });

  it("opens a content-pane panel with a search box and grouped help content", () => {
    render(<HelpMenu lang="en-US" />);
    openPanel();
    expect(screen.getByRole("dialog", { name: "Help" })).toBeInTheDocument();
    expect(screen.getByRole("searchbox")).toBeInTheDocument();
    // Grouped Help content renders (no tabs — content-pane only).
    expect(screen.getAllByText("Concepts").length).toBeGreaterThan(0);
    expect(screen.queryByRole("tablist")).toBeNull();
  });

  // The panel is drag-resizable and persists its size, so a dragged-oversize
  // window had no way back to the default — every other resizable surface
  // carries this control.
  it("offers a reset-size control in the title bar that clears the dragged size", () => {
    render(<HelpMenu lang="en-US" />);
    openPanel();
    const panel = screen.getByRole("dialog", { name: "Help" });
    // Simulate a user-dragged size: useResizable persists an inline width/height.
    panel.style.width = "1200px";
    panel.style.height = "900px";
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "modalResetSize") }));
    // Presence alone would pass for a button wired to a no-op, which IS the
    // defect ("no way back to the default once dragged").
    expect(panel.style.width).toBe("");
    expect(panel.style.height).toBe("");
  });

  // The title bar owns window-drag, so a press on any control in it must not
  // arm the drag — a no-op guard would let click-and-drag from the button move
  // the window instead of operating the control.
  it("does not start a window drag when a title-bar button is pressed", () => {
    render(<HelpMenu lang="en-US" />);
    openPanel();
    const panel = screen.getByRole("dialog", { name: "Help" });
    const before = { left: panel.style.left, top: panel.style.top };
    fireEvent.mouseDown(screen.getByRole("button", { name: t("en-US", "modalResetSize") }), { clientX: 10, clientY: 10 });
    fireEvent.mouseMove(window, { clientX: 300, clientY: 260 });
    fireEvent.mouseUp(window);
    expect(panel.style.left).toBe(before.left);
    expect(panel.style.top).toBe(before.top);
  });

  it("filters content to the empty message on a no-match search", () => {
    render(<HelpMenu lang="en-US" />);
    openPanel();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "zzzznomatchxyz" } });
    expect(screen.getByText("No help topics match your search.")).toBeInTheDocument();
  });

  it("takes focus on open, so Escape closes it and not the layer beneath", async () => {
    // ★★ This panel gates its own render on `{open && pos && …}`, and `pos`
    // arrives a tick AFTER open — so it is the awkward shape for focus-on-open,
    // and the one the hook's first version got wrong (it captured a null root
    // and never focused). Without focus moving in, `useClaimsWhenFocusWithin`
    // reads false, this panel declines its own Escape, and the dismissal stack
    // hands the key to whatever is beneath.
    const { resetDismissalStack } = await import("./dismissal-stack");
    resetDismissalStack();
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {});

    try {
      const beneath = vi.fn();
      const token = Symbol("layer beneath");
      const { pushDismissal, popDismissal, escapeOwner } = await import("./dismissal-stack");
      pushDismissal(token, "layer", () => {
        beneath();
        return true;
      });

      render(<HelpMenu lang="en-US" />);
      const toggle = screen.getByRole("button", { name: "Help" });
      await act(async () => {
        toggle.focus();
        fireEvent.click(toggle);
      });

      const panel = screen.getByRole("dialog", { name: "Help" });
      // Equality, not `.contains()` — a superset check would also pass if some
      // future child self-focused, which is not what this guards.
      expect(document.activeElement).toBe(panel);
      // Focus is inside, so this panel — not the layer beneath — owns Escape.
      expect(escapeOwner()).not.toBe(token);

      popDismissal(token);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

// The floating Help window can be open ON TOP of the in-pane Help view, so with
// a shared name both fields — and both clears — would appear twice, identically
// named, in one accessibility tree (WCAG 2.4.6). The window's field therefore
// carries its own `helpSearchPanelLabel` name while the PLACEHOLDER stays the
// shared "Search help".
describe("HelpMenu search clear", () => {
  it("names the window's field distinctly and clears it from the overlaid X", () => {
    render(<HelpMenu lang="en-US" />);
    openPanel();
    const field = screen.getByLabelText("Search help (window)") as HTMLInputElement;
    fireEvent.change(field, { target: { value: "milestone" } });
    expect(field.value).toBe("milestone");
    fireEvent.click(
      screen.getByRole("button", { name: "Clear – Search help (window)" }),
    );
    expect(field.value).toBe("");
  });
});
