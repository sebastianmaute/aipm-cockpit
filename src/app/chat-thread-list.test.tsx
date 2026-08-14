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
});
