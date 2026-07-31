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
