import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PrintButton, ResetSizeButton, ColumnResizeHandle, Th } from "./task-manager-ui";
import { t } from "./i18n";

describe("PrintButton", () => {
  it("renders the icon only — no visible Print label — but keeps its accessible name", () => {
    render(<PrintButton lang="en-US" />);
    const btn = screen.getByRole("button", { name: t("en-US", "printHint") });
    expect(btn.textContent).toBe("");
  });

  it("calls a passed onClick when clicked", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<PrintButton lang="en-US" onClick={onClick} />);
    await user.click(screen.getByRole("button", { name: /print/i }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("falls back to window.print when no onClick is passed", async () => {
    const user = userEvent.setup();
    const printSpy = vi.spyOn(window, "print").mockImplementation(() => {});
    try {
      render(<PrintButton lang="en-US" />);
      await user.click(screen.getByRole("button", { name: /print/i }));
      expect(printSpy).toHaveBeenCalledTimes(1);
    } finally {
      printSpy.mockRestore();
    }
  });

  // Stub the UA by shadowing the prototype accessor, then restore exactly
  // what was there. Replacing the whole `navigator` (vi.stubGlobal) would
  // take RTL's and userEvent's own navigator APIs down with it.
  function withUserAgent(userAgent: string, run: () => void): void {
    const original = Object.getOwnPropertyDescriptor(navigator, "userAgent");
    Object.defineProperty(navigator, "userAgent", { value: userAgent, configurable: true });
    try {
      run();
    } finally {
      if (original) Object.defineProperty(navigator, "userAgent", original);
      else delete (navigator as unknown as Record<string, unknown>).userAgent;
    }
  }

  const ELECTRON_UA =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) " +
    "aipm-cockpit/1.0.0 Chrome/152.0.7977.78 Electron/44.3.0 Safari/537.36";

  it("renders nothing inside the desktop shell, where printing cannot work", () => {
    // ★★★ THE POINT OF THE CHANGE. Electron refuses a renderer-initiated
    // window.print(), so in the packaged app this button did nothing at all
    // at every call site. Printing there is File → Print… / Ctrl+P.
    // (No count: the source file forbids one, because call sites are not
    // rendered controls and neither number is derivable from the other.)
    //
    // Mutants this kills: deleting the `if (isDesktopShell) return null`
    // early return; inverting it; and swapping the server snapshot in for
    // the client one in the useSyncExternalStore call (the server snapshot is
    // a constant `false`, so that mutant renders the button everywhere).
    withUserAgent(ELECTRON_UA, () => {
      const { container } = render(<PrintButton lang="en-US" />);
      expect(screen.queryByRole("button", { name: /print/i })).toBeNull();
      // Nothing at all, not merely an unnamed element: a hidden-but-present
      // control would still occupy the toolbar's flex gap.
      expect(container.innerHTML).toBe("");
    });
  });

  it("still renders for a browser user agent", () => {
    // The other half — without this, the test above passes just as happily
    // against a PrintButton that returns null unconditionally.
    withUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) " +
        "Chrome/130.0.0.0 Safari/537.36",
      () => {
        render(<PrintButton lang="en-US" />);
        expect(screen.getByRole("button", { name: t("en-US", "printHint") })).toBeTruthy();
      },
    );
  });
});


describe("ResetSizeButton", () => {
  it("calls onClick when clicked", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<ResetSizeButton onClick={onClick} lang="en-US" />);
    await user.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("has correct aria-label and title from tableResetSizeHint", () => {
    render(<ResetSizeButton onClick={vi.fn()} lang="en-US" />);
    const button = screen.getByRole("button");
    expect(button).toHaveAttribute("aria-label", "Reset back to the default size.");
    expect(button).toHaveAttribute("title", "Reset back to the default size.");
  });
});

describe("ColumnResizeHandle", () => {
  function renderHandle(onMouseDown = vi.fn()) {
    const result = render(
      <table><thead><tr><th>
        <ColumnResizeHandle col="title" onMouseDown={onMouseDown} />
      </th></tr></thead></table>,
    );
    const handle = result.container.querySelector(".cursor-col-resize") as HTMLElement;
    return { handle, onMouseDown };
  }

  it("renders an always-visible grip (an aria-hidden svg)", () => {
    const { handle } = renderHandle();
    expect(handle).toBeTruthy();
    const svg = handle.querySelector("svg");
    expect(svg).toBeTruthy();
    expect(svg).toHaveAttribute("aria-hidden", "true");
    // Under lucide, EllipsisVertical is three <circle> dots and no <path> —
    // assert the grip drew geometry at all, not a <path> specifically.
    expect(svg!.children.length).toBeGreaterThan(0);
    // ★★ children.length alone is vacuous — a <title> child satisfies it, and a
    // grip returning <svg aria-hidden><title/></svg> survived as a mutant. Pin
    // that every child is a real shape element.
    expect(
      Array.from(svg!.children).every((c) =>
        /^(path|line|circle|rect|polyline|polygon|ellipse)$/.test(c.tagName),
      ),
    ).toBe(true);
    // ★★★ AND PIN WHICH GLYPH. Shape alone cannot tell EllipsisVertical from
    // Trash, nor from the HORIZONTAL Ellipsis (also three <circle>s) — both
    // survived as mutants against the shape check alone. lucide's
    // `lucide-<kebab>` class is the only thing in the DOM that identifies the
    // glyph, and a grip that silently became a horizontal ellipsis would read
    // as a drag affordance pointing the wrong way.
    expect(Array.from(svg!.classList)).toContain("lucide-ellipsis-vertical");
  });

  it("is decorative and 6px wide with the col-resize cursor", () => {
    const { handle } = renderHandle();
    expect(handle).toHaveAttribute("aria-hidden", "true");
    expect(handle.className).toContain("w-1.5");
    expect(handle.className).toContain("cursor-col-resize");
    expect(handle.className).toContain("print:hidden");
  });

  it("uses palette tokens for rest + hover/drag accent, not off-palette white", () => {
    const { handle } = renderHandle();
    expect(handle.className).toContain("text-table-head-fg/40");
    expect(handle.className).toContain("hover:text-table-head-accent");
    expect(handle.className).toContain("active:text-table-head-accent");
    expect(handle.className).not.toContain("bg-white/30");
  });

  it("invokes onMouseDown with the column id", () => {
    const { handle, onMouseDown } = renderHandle();
    fireEvent.mouseDown(handle);
    expect(onMouseDown).toHaveBeenCalledTimes(1);
    expect(onMouseDown.mock.calls[0][0]).toBe("title");
  });
});

describe("Th", () => {
  it("defaults to normal px-4 padding", () => {
    const { container } = render(
      <table><thead><tr><Th>x</Th></tr></thead></table>,
    );
    const th = container.querySelector("th")!;
    expect(th.className).toContain("px-4");
  });

  it("supports a tight padding variant for icon-width columns", () => {
    const { container } = render(
      <table><thead><tr><Th padding="tight">x</Th></tr></thead></table>,
    );
    const th = container.querySelector("th")!;
    expect(th.className).toContain("px-1");
    expect(th.className).not.toContain("px-4");
  });
});
