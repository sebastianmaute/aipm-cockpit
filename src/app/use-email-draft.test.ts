import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useState } from "react";
import { useEmailDraft } from "./use-email-draft";

// Mirrors the two settings components: `stored` is live parent state, threaded
// in every render, exactly like `config.email`.
function harness(initial: string) {
  return renderHook(() => {
    const [stored, setStored] = useState(initial);
    const draft = useEmailDraft(stored);
    return { stored, setStored, draft };
  });
}

describe("useEmailDraft", () => {
  it("adopts an external stored change into the draft", () => {
    const { result, rerender } = harness("ada@x.com");
    expect(result.current.draft.value).toBe("ada@x.com");
    act(() => result.current.setStored("grace@x.com"));
    rerender();
    expect(result.current.draft.value).toBe("grace@x.com");
    expect(result.current.draft.refusal).toBeNull();
  });

  it("keeps an in-progress invalid draft across a re-render at the same stored value", () => {
    const { result, rerender } = harness("ada@x.com");
    act(() => result.current.draft.setValue("nope"));
    expect(result.current.draft.value).toBe("nope");
    // Re-render with `stored` unchanged (e.g. an unrelated sibling field
    // edit) — must NOT reset the in-progress draft back to `stored`.
    rerender();
    expect(result.current.draft.value).toBe("nope");
    expect(result.current.draft.refusal).toBe("invalid");
  });

  it("refusal is null for an unchanged stored unsafe value, non-null for a changed one", () => {
    // `stored` itself is delimiter-unsafe (a legacy/torn value) — re-sending
    // it verbatim must not be refused (emailWriteRefusal's changed-only rule).
    const { result } = harness("a,b@x.com");
    expect(result.current.draft.refusal).toBeNull();
    act(() => result.current.draft.setValue("still,bad@x.com"));
    expect(result.current.draft.refusal).toBe("delimiter");
  });
});
