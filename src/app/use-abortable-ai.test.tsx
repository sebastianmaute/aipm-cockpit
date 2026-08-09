import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAbortableAi } from "./use-abortable-ai";

const abortError = () => Object.assign(new Error("aborted"), { name: "AbortError" });

describe("useAbortableAi", () => {
  it("is idle before a run and busy during one", async () => {
    const { result } = renderHook(() => useAbortableAi());
    expect(result.current.busy).toBe(false);
    let release!: (v: string) => void;
    const pending = new Promise<string>((r) => { release = r; });
    let done!: Promise<string | null>;
    act(() => { done = result.current.run(() => pending); });
    expect(result.current.busy).toBe(true);
    await act(async () => { release("ok"); await done; });
    expect(result.current.busy).toBe(false);
  });

  it("resolves to the call's value on success", async () => {
    const { result } = renderHook(() => useAbortableAi());
    let out: string | null = null;
    await act(async () => { out = await result.current.run(() => Promise.resolve("value")); });
    expect(out).toBe("value");
    expect(result.current.error).toBeNull();
  });

  it("returns null and surfaces NO error when the call aborts", async () => {
    const { result } = renderHook(() => useAbortableAi());
    let out: string | null = "unset";
    await act(async () => { out = await result.current.run(() => Promise.reject(abortError())); });
    expect(out).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.busy).toBe(false);
  });

  it("surfaces a non-abort error and returns to idle", async () => {
    const { result } = renderHook(() => useAbortableAi());
    await act(async () => { await result.current.run(() => Promise.reject(new Error("boom"))); });
    expect(result.current.error).toBe("boom");
    expect(result.current.busy).toBe(false);
  });

  it("clears a previous error when a new run starts", async () => {
    const { result } = renderHook(() => useAbortableAi());
    await act(async () => { await result.current.run(() => Promise.reject(new Error("boom"))); });
    expect(result.current.error).toBe("boom");
    await act(async () => { await result.current.run(() => Promise.resolve("ok")); });
    expect(result.current.error).toBeNull();
  });

  it("stringifies a non-Error rejection", async () => {
    const { result } = renderHook(() => useAbortableAi());
    await act(async () => { await result.current.run(() => Promise.reject("plain string")); });
    expect(result.current.error).toBe("plain string");
  });

  it("cancel() aborts the in-flight signal", async () => {
    const { result } = renderHook(() => useAbortableAi());
    const seen: AbortSignal[] = [];
    act(() => {
      void result.current.run((signal) => { seen.push(signal); return new Promise<string>(() => {}); });
    });
    expect(seen[0].aborted).toBe(false);
    act(() => { result.current.cancel(); });
    expect(seen[0].aborted).toBe(true);
  });

  it("starting a new run aborts the previous one", async () => {
    const { result } = renderHook(() => useAbortableAi());
    const seen: AbortSignal[] = [];
    const never = (signal: AbortSignal) => { seen.push(signal); return new Promise<string>(() => {}); };
    act(() => { void result.current.run(never); });
    act(() => { void result.current.run(never); });
    expect(seen[0].aborted).toBe(true);
    expect(seen[1].aborted).toBe(false);
  });

  // The superseded run settles LAST, so its `finally` must touch NEITHER the
  // controller nor `busy` the successor owns. Clearing the controller would make
  // cancel() a silent no-op for every run started while an older one was still
  // unwinding; clearing `busy` reports idle while the successor is still billed —
  // and `run` has no in-flight guard, so superseding is an ordinary path.
  it("a superseded run settling late does not disarm the new run's cancel or its busy flag", async () => {
    const { result } = renderHook(() => useAbortableAi());
    const seen: AbortSignal[] = [];
    let rejectFirst!: (e: unknown) => void;
    act(() => {
      void result.current.run((signal) => {
        seen.push(signal);
        return new Promise<string>((_, rej) => { rejectFirst = rej; });
      });
    });
    act(() => {
      void result.current.run((signal) => { seen.push(signal); return new Promise<string>(() => {}); });
    });
    await act(async () => {
      rejectFirst(Object.assign(new Error("aborted"), { name: "AbortError" }));
      await Promise.resolve();
    });
    // The successor is still in flight, so the hook must still report busy.
    expect(result.current.busy).toBe(true);
    act(() => { result.current.cancel(); });
    expect(seen[1].aborted).toBe(true);
  });

  // ★★ THE `setError` GUARD — nothing else in the repo pins it. The superseded
  // test above rejects with an AbortError, so it returns at `isAbortError(e)`
  // and never reaches `setError`; every other error test is a single or
  // strictly sequential run, where `abortRef.current === controller` holds
  // anyway. So deleting the guard changed no assertion until this test existed.
  // Here the LOSER rejects with a genuine NON-ABORT error — a real shape: a
  // network failure that lands a tick before its own abort does, since the
  // catch's abort branch tests the THROWN VALUE, not `signal.aborted`. It
  // therefore walks into the `setError` arm while the successor is in flight
  // with a freshly cleared `error`.
  it("a superseded run failing with a non-abort error does not clobber the successor's cleared error", async () => {
    const { result } = renderHook(() => useAbortableAi());
    const seen: AbortSignal[] = [];
    let rejectLoser!: (e: unknown) => void;
    let rejectWinner!: (e: unknown) => void;
    let loserDone!: Promise<string | null>;
    let winnerDone!: Promise<string | null>;
    act(() => {
      loserDone = result.current.run((signal) => {
        seen.push(signal);
        return new Promise<string>((_, rej) => { rejectLoser = rej; });
      });
    });
    act(() => {
      winnerDone = result.current.run((signal) => {
        seen.push(signal);
        return new Promise<string>((_, rej) => { rejectWinner = rej; });
      });
    });
    // CONTROL — the setup really happened: BOTH runs started, and the first was
    // really superseded (a test where only one run ran would pass vacuously).
    expect(seen).toHaveLength(2);
    expect(seen[0].aborted).toBe(true);
    expect(seen[1].aborted).toBe(false);

    let loserOut: string | null = "unset";
    await act(async () => {
      rejectLoser(new Error("loser boom"));
      loserOut = await loserDone;
    });
    // CONTROL — the loser's rejection was OBSERVED, not merely scheduled: `run`
    // resolves only after its catch has run to completion, and a plain Error is
    // not an AbortError, so the guarded `setError` line WAS reached and declined.
    expect(loserOut).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.busy).toBe(true);

    // CONTROL — the error channel is live in this exact arrangement: the
    // successor's own failure still surfaces, so the null above is the guard
    // working, not a dead path that could never have written.
    let winnerOut: string | null = "unset";
    await act(async () => {
      rejectWinner(new Error("winner boom"));
      winnerOut = await winnerDone;
    });
    expect(winnerOut).toBeNull();
    expect(result.current.error).toBe("winner boom");
    expect(result.current.busy).toBe(false);
  });

  // ★ DEFENCE IN DEPTH, and deliberately labelled as such: no live caller can
  //   reach this today (`ai-forced-call.ts` has no retry/backoff/streaming, so a
  //   Stop cannot land between the response resolving and the return). It pins
  //   the guard that keeps a cancelled result from being applied once one does.
  it("returns null when the signal was aborted while the call was still settling", async () => {
    const { result } = renderHook(() => useAbortableAi());
    let release!: (v: string) => void;
    const pending = new Promise<string>((r) => { release = r; });
    let done!: Promise<string | null>;
    act(() => { done = result.current.run(() => pending); });
    act(() => { result.current.cancel(); });
    let out: string | null = "unset";
    await act(async () => { release("late value"); out = await done; });
    expect(out).toBeNull();
  });

  it("aborts an in-flight call on unmount", () => {
    const { result, unmount } = renderHook(() => useAbortableAi());
    const seen: AbortSignal[] = [];
    act(() => {
      void result.current.run((signal) => { seen.push(signal); return new Promise<string>(() => {}); });
    });
    expect(seen[0].aborted).toBe(false);
    unmount();
    expect(seen[0].aborted).toBe(true);
  });
});
