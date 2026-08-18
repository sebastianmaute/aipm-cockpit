// src/app/chat-thread-sidebar.test.tsx — unit coverage for the Turso chat
// panel's sidebar column: the save/fetch-failure banner (+ retry) above the
// ChatThreadList. Presentational leaf (AGENTS.md panel-split convention) —
// these tests stub every prop, mirroring chat-thread-list.test.tsx's style.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ChatThreadSidebar } from "./chat-thread-sidebar";
import type { ChatThread } from "./chat-threads";

const threadA: ChatThread = {
  id: "a",
  projectId: "p",
  name: "Q1 budget",
  createdAt: "c",
  updatedAt: "u",
  history: [],
  display: [],
};

function renderSidebar(overrides: Partial<React.ComponentProps<typeof ChatThreadSidebar>> = {}) {
  return render(
    <ChatThreadSidebar
      lang="en-US"
      threads={[threadA]}
      activeThreadId={null}
      error={false}
      onRetry={vi.fn()}
      onSelect={vi.fn()}
      onNew={vi.fn()}
      onRename={vi.fn()}
      onDelete={vi.fn()}
      {...overrides}
    />,
  );
}

/** The storage key the sidebar hands `useResizable`. Spelled literally here (not
 *  imported) so a rename of the key shows up as a failing test rather than as a
 *  silent loss of every user's saved width. */
const SIZE_KEY = "aipm-cockpit:chat-sidebar-size";

describe("ChatThreadSidebar", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("renders the thread list", () => {
    renderSidebar();
    expect(screen.getByRole("button", { name: 'Open "Q1 budget"' })).toBeInTheDocument();
  });

  it("renders no error banner or retry button when error is false", () => {
    renderSidebar({ error: false });
    expect(screen.queryByText("Couldn't save this chat.")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
  });

  it("renders the error banner and a retry button when error is true", () => {
    renderSidebar({ error: true });
    expect(screen.getByText("Couldn't save this chat.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("calls onRetry exactly once when the retry button is clicked", () => {
    const onRetry = vi.fn();
    renderSidebar({ error: true, onRetry });
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("applies a saved width from localStorage on mount", () => {
    // The shape is useResizable's own `SavedSize` — `{ width, height }`, both
    // nullable — not a guess: the hook only writes an inline dimension for a
    // numeric, positive entry, so the null height below must leave the height
    // untouched (the sidebar stretches to the chat pane instead).
    window.localStorage.setItem(SIZE_KEY, JSON.stringify({ width: 320, height: null }));
    const { container } = renderSidebar();
    const el = container.firstChild as HTMLElement;
    expect(el.style.width).toBe("320px");
    expect(el.style.height).toBe("");
  });

  it("ignores a saved HEIGHT — the column is x-only", () => {
    // ★ The width above uses `height: null`, which the hook would skip anyway,
    //   so it cannot tell `axis: "x"` from the default. This one writes a real
    //   height — the shape a pre-`axis` build persisted on any pointerup in the
    //   corner grabber, dragged or not — and pins that it is not replayed. A
    //   frozen height leaves the column's `border-r` short of the chat pane's
    //   bottom once the pane is grown.
    window.localStorage.setItem(SIZE_KEY, JSON.stringify({ width: 320, height: 333 }));
    const { container } = renderSidebar();
    const el = container.firstChild as HTMLElement;
    expect(el.style.width).toBe("320px");
    expect(el.style.height).toBe("");
  });

  it("is horizontally resizable and bounded", () => {
    const { container } = renderSidebar();
    const el = container.firstChild as HTMLElement;
    // `resize` has no effect on an element whose computed `overflow` is
    // `visible` (CSS UI 4 §5.1), so the non-visible overflow is load-bearing
    // for the drag handle, not decoration. jsdom has no layout, so this is a
    // class assertion — the geometry itself is eye-verify only.
    expect(el.className).toContain("resize-x");
    expect(el.className).toMatch(/overflow-hidden/);
    expect(el.className).toMatch(/min-w-/);
    expect(el.className).toMatch(/max-w-/);
  });

  it("scrolls the thread list WITHOUT the New-chat button inside the scroller", () => {
    // Pairs with the `overflow-hidden` above: the wrapper clips, so the list
    // must scroll itself or a long thread list becomes unreachable.
    //
    // ★ The second assertion is the whole test. The scroll container must start
    //   BELOW the primary action — with the scroller wrapped around both, paging
    //   down to an older thread pushes "New chat" off the top of the column. The
    //   scroller is located by walking UP from the <ul> rather than by naming a
    //   parent depth, so this cannot be satisfied by the broken arrangement:
    //   `closest` finds whichever ancestor actually scrolls, and if that is the
    //   list component's root the button IS inside it.
    renderSidebar();
    const list = screen.getByRole("list");
    const scroller = list.closest(".overflow-y-auto");
    expect(scroller).not.toBeNull();
    expect(scroller!.contains(screen.getByRole("button", { name: "New chat" }))).toBe(false);
  });

  it("resets the saved width from a button with its own accessible name", () => {
    window.localStorage.setItem(SIZE_KEY, JSON.stringify({ width: 320, height: null }));
    const { container } = renderSidebar();
    const el = container.firstChild as HTMLElement;
    // NOT the pane's default "Reset back to the default size." — two reset
    // controls sharing an accessible name while doing different things is a
    // WCAG 2.4.6 failure that axe passes (a name exists).
    expect(screen.queryByRole("button", { name: "Reset back to the default size." })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reset the chat sidebar width" }));
    expect(el.style.width).toBe("");
    expect(window.localStorage.getItem(SIZE_KEY)).toBeNull();
  });
});
