// src/app/use-chat-threads-publish.test.ts — what useChatThreads publishes to the registry the AI
// dispatcher reads: the threads only in Turso mode and for the live project, "available" only once that
// project's load has settled without failing, and nothing left behind after unmount.
import { describe, it, expect, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useChatThreadsPublish, type UseChatThreadsPublishDeps } from "./use-chat-threads-publish";
import { publishChatThreads, readChatThreads } from "./chat-threads-registry";
import type { ChatThread } from "./chat-threads";

function thread(id: string): ChatThread {
  return {
    id, projectId: "p", ownerId: "me", name: `Thread ${id}`, createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z", history: [], display: [],
  };
}

const THREADS = [thread("a"), thread("b")];
const BASE: UseChatThreadsPublishDeps = {
  tursoMode: true, projectId: "p", threads: THREADS, activeThreadId: "a", threadsMatchProject: true, loadFailed: false,
};

function render(over: Partial<UseChatThreadsPublishDeps> = {}) {
  return renderHook((deps: UseChatThreadsPublishDeps) => useChatThreadsPublish(deps), { initialProps: { ...BASE, ...over } });
}

beforeEach(() => {
  publishChatThreads("none", { threads: [], activeThreadId: null, available: false });
});

describe("useChatThreadsPublish", () => {
  it("publishes the live project's threads, the active one and available once its load has settled", () => {
    render();
    expect(readChatThreads("p")).toEqual({ threads: THREADS, activeThreadId: "a", available: true });
  });

  it("publishes nothing, and not available, outside Turso mode", () => {
    render({ tursoMode: false });
    expect(readChatThreads("p")).toEqual({ threads: [], activeThreadId: null, available: false });
  });

  it("publishes nothing while the threads are another project's (the load for the live one is in flight)", () => {
    render({ threadsMatchProject: false });
    expect(readChatThreads("p")).toEqual({ threads: [], activeThreadId: null, available: false });
  });

  it("keeps the rows but says not available after a failed load", () => {
    render({ loadFailed: true });
    expect(readChatThreads("p")).toEqual({ threads: THREADS, activeThreadId: "a", available: false });
  });

  it("re-publishes under the new project id and clears the slot on unmount", () => {
    const h = render();
    h.rerender({ ...BASE, projectId: "q", threadsMatchProject: false });
    expect(readChatThreads("p").available).toBe(false);
    expect(readChatThreads("q")).toEqual({ threads: [], activeThreadId: null, available: false });
    h.rerender({ ...BASE, projectId: "q" });
    expect(readChatThreads("q").available).toBe(true);
    h.unmount();
    expect(readChatThreads("q")).toEqual({ threads: [], activeThreadId: null, available: false });
  });
});
