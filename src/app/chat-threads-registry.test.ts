import { afterEach, describe, expect, it } from "vitest";
import {
  clearChatThreads,
  publishChatThreads,
  readChatThreads,
} from "./chat-threads-registry";
import type { ChatThread } from "./chat-threads";

const T: ChatThread = {
  id: "t1",
  projectId: "p1",
  name: "",
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
  history: [],
  display: [],
};

afterEach(() => {
  clearChatThreads();
});

describe("chat threads registry", () => {
  it("returns an unavailable empty value before anything is published", () => {
    expect(readChatThreads("p1")).toEqual({
      threads: [],
      activeThreadId: null,
      available: false,
    });
  });

  it("round-trips a published value for its own project", () => {
    publishChatThreads("p1", { threads: [T], activeThreadId: "t1", available: true });
    expect(readChatThreads("p1")).toEqual({
      threads: [T],
      activeThreadId: "t1",
      available: true,
    });
  });

  it("does not hand one project's threads to another", () => {
    // ★ The single slot is what makes this true by construction: publishing for
    //   a new project REPLACES the slot, so a stale project can never be read.
    publishChatThreads("p1", { threads: [T], activeThreadId: "t1", available: true });
    expect(readChatThreads("p2").available).toBe(false);
    expect(readChatThreads("p2").threads).toEqual([]);
  });

  it("replaces the slot rather than accumulating projects", () => {
    publishChatThreads("p1", { threads: [T], activeThreadId: "t1", available: true });
    publishChatThreads("p2", { threads: [], activeThreadId: null, available: true });
    expect(readChatThreads("p1").available).toBe(false);
    expect(readChatThreads("p2").available).toBe(true);
  });

  it("clears", () => {
    publishChatThreads("p1", { threads: [T], activeThreadId: "t1", available: true });
    clearChatThreads();
    expect(readChatThreads("p1").available).toBe(false);
  });
});
