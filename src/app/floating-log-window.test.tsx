import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FLOATING_LAYER_ATTR } from "./modal";
import { FloatingLogWindow, NOTES_WINDOW_Z } from "./floating-log-window";
import { MODAL_HELP } from "./help-content";
import { t } from "./i18n";

const EN = "en-US" as const;
const PREFIX = "test-prefix:log-window";

afterEach(() => {
  window.localStorage.clear();
});

function setup(prefix = PREFIX) {
  const onClose = vi.fn();
  render(
    <FloatingLogWindow
      open
      onClose={onClose}
      title="Log — Task ABC"
      storageKeyPrefix={prefix}
      helpConceptId={MODAL_HELP.notesWindow}
      lang={EN}
    >
      <p>body content</p>
    </FloatingLogWindow>,
  );
  return { onClose };
}

describe("FloatingLogWindow", () => {
  it("portals to body with the layer marker and the notes z-index", () => {
    setup();
    const win = screen.getByRole("dialog", { name: "Log — Task ABC" });
    expect(win.parentElement).toBe(document.body);
    expect(win.style.zIndex).toBe(String(NOTES_WINDOW_Z));
    expect(win.hasAttribute(FLOATING_LAYER_ATTR)).toBe(true);
    expect(screen.getByText("body content")).toBeTruthy();
  });

  it("Escape closes only while focus is inside", () => {
    const { onClose } = setup();
    const elsewhere = document.createElement("input");
    document.body.appendChild(elsewhere);
    elsewhere.focus();
    try {
      const esc = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
      document.dispatchEvent(esc);
      expect(onClose).not.toHaveBeenCalled();
      expect(esc.defaultPrevented).toBe(false);
    } finally {
      elsewhere.remove();
    }
    screen.getByRole("button", { name: t(EN, "close") }).focus();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("uses the given storage keys", () => {
    window.localStorage.setItem(`${PREFIX}-pos`, JSON.stringify({ x: 200, y: 150 }));
    window.localStorage.setItem(`${PREFIX}-size`, JSON.stringify({ width: 400, height: 300 }));
    setup();
    const win = screen.getByRole("dialog", { name: "Log — Task ABC" });
    expect(win.style.left).toBe("200px");
    expect(win.style.top).toBe("150px");
    expect(win.style.width).toBe("400px");
    expect(win.style.height).toBe("300px");
  });
});
