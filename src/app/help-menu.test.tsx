import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
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
});
