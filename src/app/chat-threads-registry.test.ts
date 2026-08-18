import { afterEach, describe, expect, it } from "vitest";
import {
  clearChatThreads,
  clearChatThreadsFor,
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

  it("returns a FROZEN miss value, so one consumer cannot corrupt every later miss", () => {
    // ★★ The same object answers every miss for the process lifetime, and
    //   `readonly` on `threads` is a TYPE-level guarantee only — `available`
    //   and `activeThreadId` never had even that. A single stray assignment
    //   would therefore make every subsequent miss report the wrong answer,
    //   with nothing in the type system to catch it. Mutating a frozen object
    //   is a silent no-op outside strict mode and a TypeError inside it (ES
    //   modules are always strict, which is why this is wrapped).
    const miss = readChatThreads("nobody");
    expect(Object.isFrozen(miss)).toBe(true);
    expect(Object.isFrozen(miss.threads)).toBe(true);
    try {
      (miss as { available: boolean }).available = true;
      (miss as { activeThreadId: string | null }).activeThreadId = "hijacked";
      (miss.threads as ChatThread[]).push(T);
    } catch {
      // strict-mode TypeError — the assignment was rejected, which is the point.
    }
    expect(readChatThreads("someone-else")).toEqual({
      threads: [],
      activeThreadId: null,
      available: false,
    });
  });

  it("clearChatThreadsFor drops only its OWN project's slot", () => {
    // ★ The unmount cleanup is scoped so a late teardown for a project the
    //   publisher has already left cannot wipe the CURRENT project's value.
    publishChatThreads("p2", { threads: [T], activeThreadId: "t1", available: true });
    clearChatThreadsFor("p1");
    expect(readChatThreads("p2").available).toBe(true);
    clearChatThreadsFor("p2");
    expect(readChatThreads("p2").available).toBe(false);
  });

  it("clears", () => {
    publishChatThreads("p1", { threads: [T], activeThreadId: "t1", available: true });
    clearChatThreads();
    expect(readChatThreads("p1").available).toBe(false);
  });
});
