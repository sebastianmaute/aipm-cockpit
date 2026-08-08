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

  // The superseded run settles LAST, so its `finally` must not clear the
  // controller its successor installed — that would make cancel() a silent
  // no-op for every run started while an older one was still unwinding.
  it("a superseded run settling late does not disarm the new run's cancel", async () => {
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
    act(() => { result.current.cancel(); });
    expect(seen[1].aborted).toBe(true);
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
