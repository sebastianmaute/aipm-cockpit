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
