import { describe, expect, it } from "vitest";
import { createLoadLimiter } from "./asset-load-limiter";

/** A promise plus its resolver, so a test decides when each task finishes. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Lets queued microtasks (the limiter's hand-offs) run. */
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("createLoadLimiter", () => {
  it("runs at most `max` tasks at once and starts the next as one finishes", async () => {
    const limiter = createLoadLimiter(2);
    const gates = [deferred<string>(), deferred<string>(), deferred<string>()];
    const started: number[] = [];
    const results = gates.map((g, i) =>
      limiter.run(() => {
        started.push(i);
        return g.promise;
      }),
    );
    await flush();
    expect(started).toEqual([0, 1]);

    gates[0].resolve("a");
    await flush();
    expect(started).toEqual([0, 1, 2]);

    gates[1].resolve("b");
    gates[2].resolve("c");
    await expect(Promise.all(results)).resolves.toEqual(["a", "b", "c"]);
  });

  it("frees the slot when a task rejects, and passes the rejection through", async () => {
    const limiter = createLoadLimiter(1);
    const failing = deferred<string>();
    const first = limiter.run(() => failing.promise);
    let secondStarted = false;
    const second = limiter.run(async () => {
      secondStarted = true;
      return "ok";
    });
    await flush();
    expect(secondStarted).toBe(false);

    failing.reject(new Error("boom"));
    await expect(first).rejects.toThrow("boom");
    await expect(second).resolves.toBe("ok");
    expect(secondStarted).toBe(true);
  });

  it("frees the slot when a task throws synchronously", async () => {
    const limiter = createLoadLimiter(1);
    const first = limiter.run(() => {
      throw new Error("sync");
    });
    await expect(first).rejects.toThrow("sync");
    await expect(limiter.run(async () => 1)).resolves.toBe(1);
  });

  it("treats a max below 1 as 1 rather than never running anything", async () => {
    const limiter = createLoadLimiter(0);
    await expect(limiter.run(async () => "ran")).resolves.toBe("ran");
  });
});
