import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useActionAnalysis } from "./use-action-analysis";
import * as jobAnalysis from "./scheduled-job-analysis";

afterEach(() => vi.restoreAllMocks());

describe("useActionAnalysis — a cancel is not an error", () => {
  // ★ A PLAIN OBJECT, not a DOMException. This is the cross-boundary shape;
  //   with an `instanceof DOMException` gate the hook falls through to the
  //   generic arm and sets an error for something the user did on purpose.
  it("sets no error when the call rejects with a plain AbortError shape", async () => {
    vi.spyOn(jobAnalysis, "runJobAnalysis").mockRejectedValue({ name: "AbortError" });
    const { result } = renderHook(() => useActionAnalysis({ apiKey: "sk-ant-x", model: "claude-opus-5" }));
    await act(async () => { await result.current.analyze("ctx"); });
    expect(result.current.error).toBeNull();
    expect(result.current.busy).toBe(false);
  });

  it("still sets an error for a genuine failure", async () => {
    vi.spyOn(jobAnalysis, "runJobAnalysis").mockRejectedValue(new Error("parse"));
    const { result } = renderHook(() => useActionAnalysis({ apiKey: "sk-ant-x", model: "claude-opus-5" }));
    await act(async () => { await result.current.analyze("ctx"); });
    expect(result.current.error).toBe("parse");
  });
});

// A billed Anthropic call must never outlive the surface that started it, and
// the current-run guard is the same one `use-abortable-ai` / `use-timelog-sync`
// already carry. The guard is DEFENCE IN DEPTH — the Action Center's
// `AiTriggerButton` becomes a Stop button while `busy`, so no live path can
// overlap two `analyze` calls today; these pin the hook's own contract, which is
// where a second trigger would land.
describe("useActionAnalysis — lifecycle", () => {
  /** Never settles; records the signal it was handed. */
  const hang = (seen: (AbortSignal | undefined)[]) =>
    vi.spyOn(jobAnalysis, "runJobAnalysis").mockImplementation(
      (...args: Parameters<typeof jobAnalysis.runJobAnalysis>) => {
        seen.push(args[2]);
        return new Promise<never>(() => {});
      },
    );

  it("aborts the in-flight call on unmount", () => {
    const seen: (AbortSignal | undefined)[] = [];
    hang(seen);
    const { result, unmount } = renderHook(() =>
      useActionAnalysis({ apiKey: "sk-ant-x", model: "claude-opus-5" }),
    );
    act(() => { void result.current.analyze("ctx"); });
    // Control: without this the assertion below could pass on a signal that was
    // never live in the first place.
    expect(seen[0]?.aborted).toBe(false);
    unmount();
    expect(seen[0]?.aborted).toBe(true);
  });

  it("a superseded analyze settling late leaves the successor's cancel armed and busy set", async () => {
    const seen: (AbortSignal | undefined)[] = [];
    let rejectFirst!: (e: unknown) => void;
    vi.spyOn(jobAnalysis, "runJobAnalysis").mockImplementation(
      (...args: Parameters<typeof jobAnalysis.runJobAnalysis>) => {
        seen.push(args[2]);
        return seen.length === 1
          ? new Promise<never>((_, rej) => { rejectFirst = rej; })
          : new Promise<never>(() => {});
      },
    );
    const { result } = renderHook(() =>
      useActionAnalysis({ apiKey: "sk-ant-x", model: "claude-opus-5" }),
    );
    act(() => { void result.current.analyze("first"); });
    act(() => { void result.current.analyze("second"); });
    // Control: two distinct runs really did start.
    expect(seen).toHaveLength(2);
    await act(async () => {
      rejectFirst(Object.assign(new Error("aborted"), { name: "AbortError" }));
      await Promise.resolve();
    });
    // Unguarded, the loser's `finally` reports idle while the winner is billed…
    expect(result.current.busy).toBe(true);
    // …and nulls the ref, making this cancel a silent no-op.
    act(() => { result.current.cancel(); });
    expect(seen[1]?.aborted).toBe(true);
  });
});
