// src/app/chat-thread-sidebar.test.tsx — unit coverage for the Turso chat
// panel's sidebar column: the save/fetch-failure banner (+ retry) above the
// ChatThreadList. Presentational leaf (AGENTS.md panel-split convention) —
// these tests stub every prop, mirroring chat-thread-list.test.tsx's style.
import { describe, it, expect, vi } from "vitest";
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

describe("ChatThreadSidebar", () => {
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
});
