import { describe, it, expect, vi } from "vitest";
import { createChatPersistQueue } from "./chat-persist-queue";

function deferred() {
  let resolve!: () => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("createChatPersistQueue", () => {
  it("a landed write clears the banner and runs onLanded as the owner", async () => {
    const setError = vi.fn();
    const queue = createChatPersistQueue(setError);
    const onLanded = vi.fn();
    queue.runPersist("t1", async () => undefined, onLanded);
    expect(queue.inFlight()).toBe(true);
    await flush();
    expect(queue.inFlight()).toBe(false);
    expect(queue.startedCount()).toBe(1);
    expect(queue.landings()).toBe(1);
    expect(queue.landed().get("t1")?.seq).toBe(1);
    expect(onLanded).toHaveBeenCalledWith(true);
    expect(setError).toHaveBeenLastCalledWith(false);
  });

  it("a failed write raises the banner and is retried; a retry that lands clears it", async () => {
    const setError = vi.fn();
    const queue = createChatPersistQueue(setError);
    const action = vi.fn().mockRejectedValueOnce(new Error("down")).mockResolvedValue(undefined);
    queue.runPersist("t1", action);
    await flush();
    expect(setError).toHaveBeenLastCalledWith(true);
    expect(queue.retryFailed()).toBe(true);
    await flush();
    expect(action).toHaveBeenCalledTimes(2);
    expect(setError).toHaveBeenLastCalledWith(false);
    expect(queue.retryFailed()).toBe(false);
  });

  it("an earlier write settling last never settles a later one's key", async () => {
    const setError = vi.fn();
    const queue = createChatPersistQueue(setError);
    const first = deferred();
    queue.runPersist("t1", () => first.promise);
    queue.runPersist("t1", () => Promise.reject(new Error("down")));
    await flush();
    first.resolve();
    await flush();
    expect(setError).toHaveBeenLastCalledWith(true);
    expect(queue.retryFailed()).toBe(true);
  });

  it("forgetting a deleted thread's retry re-derives the banner, and a reset drops every retry", async () => {
    const setError = vi.fn();
    const queue = createChatPersistQueue(setError);
    queue.runPersist("t1", () => Promise.reject(new Error("down")));
    queue.runPersist("t2", () => Promise.reject(new Error("down")));
    await flush();
    queue.forgetRetries(["t1"]);
    expect(setError).toHaveBeenLastCalledWith(true);
    queue.resetForLoad();
    expect(queue.retryFailed()).toBe(false);
  });
});
