import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, createEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DragHandle } from "./drag-handle";

describe("DragHandle", () => {
  it("is decorative (aria-hidden, no role, no tab stop) when no ariaLabel is passed", async () => {
    const user = userEvent.setup();
    const { container } = render(<DragHandle />);
    const handle = container.firstElementChild as HTMLElement;
    expect(handle).toHaveAttribute("aria-hidden", "true");
    expect(handle).not.toHaveAttribute("role");
    // ★ The property most at risk from any edit to this file: the decorative
    //  variant must stay OUT of the tab order. `tabIndex` absent is the wiring;
    //  the tab attempt is the observable — a `tabIndex={-1}` regression would
    //  keep the attribute assertion honest but is still not focusable, whereas
    //  a `tabIndex={0}` regression fails BOTH.
    expect(handle).not.toHaveAttribute("tabindex");
    await user.tab();
    expect(handle).not.toHaveFocus();
    expect(document.body).toHaveFocus();
  });

  it("renders role=button with the passed accessible name when ariaLabel is given", () => {
    const { container } = render(<DragHandle ariaLabel="Resize task – Design review" />);
    const handle = container.firstElementChild as HTMLElement;
    expect(handle).toHaveAttribute("role", "button");
    expect(handle).toHaveAttribute("aria-label", "Resize task – Design review");
    expect(handle).not.toHaveAttribute("aria-hidden");
  });

  it("keeps the decorative glyph aria-hidden so it can't bleed into the accessible name", () => {
    const { container } = render(<DragHandle ariaLabel="Resize" />);
    const glyph = container.querySelector("svg");
    expect(glyph).toBeTruthy();
    expect(glyph).toHaveAttribute("aria-hidden", "true");
  });

  it("fires onDragStart when the handle is draggable", () => {
    const onDragStart = vi.fn();
    const { container } = render(<DragHandle draggable onDragStart={onDragStart} />);
    const handle = container.firstElementChild as HTMLElement;
    expect(handle).toHaveAttribute("draggable", "true");
    handle.dispatchEvent(new Event("dragstart", { bubbles: true, cancelable: true }));
    expect(onDragStart).toHaveBeenCalledTimes(1);
  });

  // ★★ The next two pin the other half of `useListReorderDnd().handleProps(id)`.
  //  The primitive carried only `draggable` + `onDragStart`, so a caller
  //  spreading `handleProps` lost `onDragEnd` and `onKeyDown` SILENTLY — a
  //  spread of a wider object is not an excess-property tsc error. Losing
  //  `onDragEnd` strands the hook's `dragId` for the session; losing
  //  `onKeyDown` removes the only mouse-free reorder path.
  it("forwards onDragEnd to the grip", () => {
    const onDragEnd = vi.fn();
    render(<DragHandle ariaLabel="Reorder – Row 1" draggable onDragEnd={onDragEnd} />);
    fireEvent.dragEnd(screen.getByRole("button", { name: "Reorder – Row 1" }));
    expect(onDragEnd).toHaveBeenCalled();
  });

  it("forwards onKeyDown so the arrow-key reorder path works", async () => {
    const onKeyDown = vi.fn();
    const user = userEvent.setup();
    render(<DragHandle ariaLabel="Reorder – Row 1" draggable onKeyDown={onKeyDown} />);
    // ★ `.focus()` never proves focusability — it succeeds on an element the
    //  keyboard can never reach. Tab to it.
    await user.tab();
    expect(screen.getByRole("button", { name: "Reorder – Row 1" })).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(onKeyDown).toHaveBeenCalled();
  });

  // ★★★ SPACE ON A `div role="button"` SCROLLS THE PAGE. A native <button>
  //  swallows Space by construction; this primitive renders a div, and the
  //  five reorder grips that migrated onto it were all native <button>s
  //  before, so the migration silently handed the page-scroll default back.
  //  `useListReorderDnd`'s onKeyDown handles ArrowUp/ArrowDown ONLY, so
  //  neither Space nor Enter has anything to do on a grip — the browser's
  //  default fires anyway and scrolls the page out from under a keyboard
  //  user mid-reorder. Enter goes the same way: it does nothing on a control
  //  announced as a button, so leaving its default live buys nothing.
  //  ★ The caller is still CALLED — only the default is suppressed — so a
  //   future consumer can give either key a meaning without fighting this.
  it.each([[" "], ["Enter"]])(
    "swallows %j on the accessible variant while still calling the caller",
    async (key) => {
      const user = userEvent.setup();
      const onKeyDown = vi.fn();
      render(<DragHandle ariaLabel="Reorder – Row 1" draggable onKeyDown={onKeyDown} />);
      // ★ `.focus()` never proves focusability — tab to it.
      await user.tab();
      const handle = screen.getByRole("button", { name: "Reorder – Row 1" });
      expect(handle).toHaveFocus();
      const event = createEvent.keyDown(handle, { key });
      fireEvent(handle, event);
      expect(event.defaultPrevented).toBe(true);
      expect(onKeyDown).toHaveBeenCalled();
    },
  );

  // ★★ THE ARROW PATH MUST STAY THE CALLER'S. `useListReorderDnd` calls
  //  preventDefault itself on ArrowUp/ArrowDown; this primitive must not, or
  //  a consumer wanting an arrow key to keep its native meaning has no way to
  //  get it back — and a guard widened to every key would be invisible here
  //  unless the assertion names a key it must NOT swallow.
  it("leaves the ArrowDown default alone and forwards it", async () => {
    const user = userEvent.setup();
    const onKeyDown = vi.fn();
    render(<DragHandle ariaLabel="Reorder – Row 1" draggable onKeyDown={onKeyDown} />);
    await user.tab();
    const handle = screen.getByRole("button", { name: "Reorder – Row 1" });
    const event = createEvent.keyDown(handle, { key: "ArrowDown" });
    fireEvent(handle, event);
    expect(event.defaultPrevented).toBe(false);
    expect(onKeyDown).toHaveBeenCalled();
  });

  // ★ The DECORATIVE variant is aria-hidden with no role and no tab stop, so
  //  it is never a button to anyone — suppressing a key default there would
  //  act on an element the user cannot reach. Pins the branch.
  it("does not swallow Space on the decorative variant", () => {
    const { container } = render(<DragHandle />);
    const handle = container.firstElementChild as HTMLElement;
    const event = createEvent.keyDown(handle, { key: " " });
    fireEvent(handle, event);
    expect(event.defaultPrevented).toBe(false);
  });

  it("fires onMouseDown", () => {
    const onMouseDown = vi.fn();
    const { container } = render(<DragHandle onMouseDown={onMouseDown} />);
    const handle = container.firstElementChild as HTMLElement;
    handle.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    expect(onMouseDown).toHaveBeenCalledTimes(1);
  });

  // ★★ Every one of the five reorder grips that migrated onto this primitive
  //  pairs a row-QUALIFIED `ariaLabel` with a SHORT, unqualified `title`, so the
  //  two are deliberately different strings. Both halves matter: the tooltip has
  //  to reach the DOM at all, and it must not displace the accessible name that
  //  carries the WCAG 2.4.6 row qualifier. A fixture passing the SAME string for
  //  both would pass with `title` wired to `aria-label` (or vice versa).
  it("forwards title as the tooltip without disturbing the accessible name", () => {
    render(<DragHandle ariaLabel="Reorder – Row 1" title="Reorder" />);
    const handle = screen.getByRole("button", { name: "Reorder – Row 1" });
    expect(handle).toHaveAttribute("title", "Reorder");
    // The name is still the qualified one, not the tooltip.
    expect(screen.queryByRole("button", { name: "Reorder" })).toBeNull();
  });

  it("omits the title attribute entirely when no title is passed", () => {
    const { container } = render(<DragHandle ariaLabel="Reorder – Row 1" />);
    expect(container.firstElementChild).not.toHaveAttribute("title");
  });

  it("applies a caller className additively, keeping the atom's own base classes", () => {
    const { container } = render(<DragHandle className="cursor-col-resize w-1.5" />);
    const handle = container.firstElementChild as HTMLElement;
    expect(handle.className).toContain("cursor-col-resize");
    expect(handle.className).toContain("w-1.5");
    // Base classes (generic to any drag handle) survive alongside it.
    expect(handle.className).toContain("select-none");
    expect(handle.className).toContain("print:hidden");
  });

  // ★★ A grip is PRESSED and held for the whole gesture, so the accessible
  //  variant deliberately uses a `focus-visible:` ring instead of the shared
  //  `focus:`-based FOCUS_RING — a `focus:` ring would paint for the drag's
  //  entire duration. This mirrors all five hand-rolled reorder grips.
  //  Asserting the ABSENCE of `focus:ring-2` is what makes it a real guard:
  //  reverting to FOCUS_RING keeps a ring but fails here.
  it("gives the accessible variant a focus-visible ring, not a focus: ring", () => {
    const { container } = render(<DragHandle ariaLabel="Reorder – Row 1" />);
    const cls = (container.firstElementChild as HTMLElement).className;
    expect(cls).toContain("focus-visible:ring-2");
    expect(cls).toContain("focus-visible:ring-ui-green");
    expect(cls).not.toContain("focus:ring-2");
    expect(cls).not.toContain("focus:ring-ui-green");
    // outline-none stays on plain `focus:` — matching every other
    // focus-visible ring call site in src/app.
    expect(cls).toContain("focus:outline-none");
  });

  it("gives the decorative variant no focus ring at all", () => {
    const { container } = render(<DragHandle />);
    const cls = (container.firstElementChild as HTMLElement).className;
    expect(cls).not.toContain("ring-2");
    expect(cls).not.toContain("ring-ui-green");
  });
});
