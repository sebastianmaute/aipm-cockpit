// src/app/chat-thread-list.test.tsx — unit coverage for the Turso chat-thread
// sidebar. This surface is NOT scanned by the e2e axe gate (Turso-only, and
// the seed is file-mode), so these tests are the only coverage for the
// row-unique accessible names (WCAG 2.4.6) and non-colour active-state cue
// (WCAG 1.4.1) this component owns. See AGENTS.md's a11y hard-constraint
// bullet — axe has NO rule that flags two controls sharing an accessible
// name, at any seed size; a unit test rendering >=2 rows is the only
// possible detector, which is why test 1 renders both threads.
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ChatThreadList } from "./chat-thread-list";
import type { ChatThread } from "./chat-threads";

const threadA: ChatThread = {
  id: "a",
  projectId: "p",
  name: "Q1 budget",
  createdAt: "c",
  updatedAt: "u2",
  history: [],
  display: [],
};

const threadB: ChatThread = {
  id: "b",
  projectId: "p",
  name: "",
  createdAt: "c",
  updatedAt: "u1",
  history: [],
  display: [],
};

describe("ChatThreadList", () => {
  it("renders each thread with a row-unique accessible name (blank name falls back to Untitled chat)", () => {
    render(
      <ChatThreadList
        lang="en-US"
        threads={[threadA, threadB]}
        activeThreadId={threadA.id}
        onSelect={vi.fn()}
        onNew={vi.fn()}
        onRename={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    // A getByRole match against >1 element THROWS — this doubles as the
    // collision detector: if the row-select buttons ever shared one name,
    // either lookup below would fail with "found multiple elements".
    expect(screen.getByRole("button", { name: 'Open "Q1 budget"' })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: 'Open "Untitled chat"' })).toBeInTheDocument();
    // The blank-name fallback also shows in the visible row text.
    expect(screen.getByText("Untitled chat")).toBeInTheDocument();
  });

  it("renders the thread rows inside a role=list container (Tailwind Preflight strips native list semantics)", () => {
    render(
      <ChatThreadList
        lang="en-US"
        threads={[threadA]}
        activeThreadId={null}
        onSelect={vi.fn()}
        onNew={vi.fn()}
        onRename={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getByRole("list")).toBeInTheDocument();
  });

  it("calls onSelect with the clicked thread's id", () => {
    const onSelect = vi.fn();
    render(
      <ChatThreadList
        lang="en-US"
        threads={[threadA]}
        activeThreadId={null}
        onSelect={onSelect}
        onNew={vi.fn()}
        onRename={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: 'Open "Q1 budget"' }));
    expect(onSelect).toHaveBeenCalledWith("a");
  });

  it("calls onNew when the New chat button is clicked", () => {
    const onNew = vi.fn();
    render(
      <ChatThreadList
        lang="en-US"
        threads={[threadA]}
        activeThreadId={null}
        onSelect={vi.fn()}
        onNew={onNew}
        onRename={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "New chat" }));
    expect(onNew).toHaveBeenCalledOnce();
  });

  it("renders the empty state when threads is empty", () => {
    render(
      <ChatThreadList
        lang="en-US"
        threads={[]}
        activeThreadId={null}
        onSelect={vi.fn()}
        onNew={vi.fn()}
        onRename={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getByText("No chats yet")).toBeInTheDocument();
    expect(screen.getByText("Start a new chat to begin.")).toBeInTheDocument();
  });

  it("calls onDelete with the thread's id and involves no confirmation dialog", () => {
    const onDelete = vi.fn();
    render(
      <ChatThreadList
        lang="en-US"
        threads={[threadA]}
        activeThreadId={null}
        onSelect={vi.fn()}
        onNew={vi.fn()}
        onRename={vi.fn()}
        onDelete={onDelete}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: 'Delete "Q1 budget"' }));
    expect(onDelete).toHaveBeenCalledWith("a");
    // No dialog role should appear — confirmation is the caller's job.
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("reveals a rename input on click and commits the trimmed name on Enter", () => {
    const onRename = vi.fn();
    render(
      <ChatThreadList
        lang="en-US"
        threads={[threadA]}
        activeThreadId={null}
        onSelect={vi.fn()}
        onNew={vi.fn()}
        onRename={onRename}
        onDelete={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: 'Rename "Q1 budget"' }));
    const input = screen.getByRole("textbox", { name: 'Rename "Q1 budget"' });
    fireEvent.change(input, { target: { value: "  Q2 budget  " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onRename).toHaveBeenCalledWith("a", "Q2 budget");
  });

  it("does not double-commit when blur fires after an Enter commit (real-browser node-removal blur)", () => {
    // jsdom does not fire a native blur when the focused element is removed
    // from the DOM (unlike real browsers, per the HTML spec's unfocusing
    // steps), so this cannot reproduce the browser hazard end-to-end here.
    // It instead pins the GUARD directly: fire Enter (which commits and
    // unmounts the input), then fire blur explicitly on the same node and
    // assert onRename still only fired once. This fails against the
    // unguarded code and passes against the guarded code.
    const onRename = vi.fn();
    render(
      <ChatThreadList
        lang="en-US"
        threads={[threadA]}
        activeThreadId={null}
        onSelect={vi.fn()}
        onNew={vi.fn()}
        onRename={onRename}
        onDelete={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: 'Rename "Q1 budget"' }));
    const input = screen.getByRole("textbox", { name: 'Rename "Q1 budget"' });
    fireEvent.change(input, { target: { value: "Q2 budget" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.blur(input);
    expect(onRename).toHaveBeenCalledTimes(1);
    expect(onRename).toHaveBeenCalledWith("a", "Q2 budget");
  });

  it("cancels the rename on Escape without calling onRename", () => {
    const onRename = vi.fn();
    render(
      <ChatThreadList
        lang="en-US"
        threads={[threadA]}
        activeThreadId={null}
        onSelect={vi.fn()}
        onNew={vi.fn()}
        onRename={onRename}
        onDelete={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: 'Rename "Q1 budget"' }));
    const input = screen.getByRole("textbox", { name: 'Rename "Q1 budget"' });
    fireEvent.change(input, { target: { value: "Q2 budget" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onRename).not.toHaveBeenCalled();
    expect(screen.queryByRole("textbox", { name: 'Rename "Q1 budget"' })).not.toBeInTheDocument();
  });

  it("falls back to Untitled chat for a whitespace-only name, in both the visible text and every control's accessible name", () => {
    const whitespaceThread: ChatThread = { ...threadA, id: "c", name: "   " };
    render(
      <ChatThreadList
        lang="en-US"
        threads={[whitespaceThread]}
        activeThreadId={null}
        onSelect={vi.fn()}
        onNew={vi.fn()}
        onRename={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getByText("Untitled chat")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: 'Open "Untitled chat"' })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: 'Rename "Untitled chat"' })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: 'Delete "Untitled chat"' })).toBeInTheDocument();
  });

  it("keeps the active-state marker out of the accessibility tree", () => {
    // The marker (Dot with no `label`) must stay aria-hidden — it renders
    // role="img" ONLY when Dot receives a `label`, so asserting no "img" role
    // exists anywhere pins that this call site never adds one. Mutation-
    // proved: giving the Dot a `label` (or any change that drops its
    // aria-hidden) turns this red.
    render(
      <ChatThreadList
        lang="en-US"
        threads={[threadA, threadB]}
        activeThreadId={threadA.id}
        onSelect={vi.fn()}
        onNew={vi.fn()}
        onRename={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("marks the active row with aria-current and leaves it off the inactive row", () => {
    render(
      <ChatThreadList
        lang="en-US"
        threads={[threadA, threadB]}
        activeThreadId={threadA.id}
        onSelect={vi.fn()}
        onNew={vi.fn()}
        onRename={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    const activeButton = screen.getByRole("button", { name: 'Open "Q1 budget"' });
    const inactiveButton = screen.getByRole("button", { name: 'Open "Untitled chat"' });
    expect(activeButton).toHaveAttribute("aria-current", "true");
    expect(inactiveButton).not.toHaveAttribute("aria-current");
  });

  it("gives the Rename and Delete controls row-unique accessible names across two threads", () => {
    // Tests 5/6 above render a single thread each, so a name collision on
    // Rename/Delete would go undetected there — a getByRole exact-name match
    // THROWS on multiple matches, which is what makes this a collision
    // detector, so resolving both names for both threads is the assertion.
    render(
      <ChatThreadList
        lang="en-US"
        threads={[threadA, threadB]}
        activeThreadId={null}
        onSelect={vi.fn()}
        onNew={vi.fn()}
        onRename={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: 'Rename "Q1 budget"' })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: 'Rename "Untitled chat"' })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: 'Delete "Q1 budget"' })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: 'Delete "Untitled chat"' })).toBeInTheDocument();
  });
});
