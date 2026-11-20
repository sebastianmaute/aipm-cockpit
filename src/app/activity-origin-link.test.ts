// §799 — an Activity row links to its chat only when that very request is still in a loaded thread.
import { describe, expect, it } from "vitest";
import { resolveOriginLink } from "./activity-origin-link";
import type { AiOrigin } from "./activity-origin";
import type { ChatThread } from "./chat-threads";
import type { PublishedThreads } from "./chat-threads-registry";

function thread(id: string, display: ChatThread["display"]): ChatThread {
  return {
    id, projectId: "p1", ownerId: null, name: "", createdAt: "c", updatedAt: "u", history: [], display,
  };
}

const ORIGIN: AiOrigin = { feature: "chat", threadId: "t1", requestId: "r1" };
const OWN = thread("t1", [
  { kind: "assistant", text: "hello" },
  { kind: "user", text: "mark it done", requestId: "r1" },
]);
const published = (threads: ChatThread[], available = true): PublishedThreads => ({
  threads, activeThreadId: null, available,
});

describe("resolveOriginLink", () => {
  it("links to an own thread that holds the request", () => {
    expect(resolveOriginLink(ORIGIN, published([thread("t0", []), OWN]))).toEqual({ threadId: "t1" });
  });

  it("is null when the thread is not in the list", () => {
    expect(resolveOriginLink(ORIGIN, published([thread("t2", OWN.display)]))).toBeNull();
  });

  it("is null when the thread no longer holds the request (the chat was cleared)", () => {
    const cleared = thread("t1", [{ kind: "user", text: "a new question", requestId: "r2" }]);
    expect(resolveOriginLink(ORIGIN, published([cleared]))).toBeNull();
  });

  it("matches the request on a USER item only", () => {
    const notUser = thread("t1", [{ kind: "notice", text: "r1" }]);
    expect(resolveOriginLink(ORIGIN, published([notUser]))).toBeNull();
  });

  it("is null when the threads are not available", () => {
    expect(resolveOriginLink(ORIGIN, published([OWN], false))).toBeNull();
  });

  it("is null when nothing is published", () => {
    expect(resolveOriginLink(ORIGIN, null)).toBeNull();
  });

  it("is null for an origin without link fields", () => {
    expect(resolveOriginLink({ feature: "chat" }, published([OWN]))).toBeNull();
    expect(resolveOriginLink({ feature: "chat", threadId: "t1" }, published([OWN]))).toBeNull();
    expect(resolveOriginLink({ feature: "chat", requestId: "r1" }, published([OWN]))).toBeNull();
    const blank = thread("", [{ kind: "user", text: "x", requestId: "" }]);
    expect(resolveOriginLink({ feature: "chat", threadId: "", requestId: "" }, published([blank]))).toBeNull();
    expect(resolveOriginLink({ feature: "chat", threadId: "t1", requestId: "" }, published([OWN]))).toBeNull();
  });

  it("is null for link fields that are not strings (an entry that never passed the load boundary)", () => {
    const hostile = { feature: "chat", threadId: 1, requestId: 1 } as unknown as AiOrigin;
    const numeric = thread("1", [{ kind: "user", text: "x", requestId: 1 as unknown as string }]);
    expect(resolveOriginLink(hostile, published([numeric]))).toBeNull();
  });

  it("is null for an undefined origin", () => {
    expect(resolveOriginLink(undefined, published([OWN]))).toBeNull();
  });
});
