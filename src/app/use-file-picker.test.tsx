import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, render, fireEvent } from "@testing-library/react";
import { useFilePicker } from "./use-file-picker";

afterEach(() => {
  document.body.innerHTML = "";
});

// Renders the hook, then mounts a real <input> spread with its inputProps so
// the hook's internal ref actually attaches to a DOM node — the hook itself
// renders nothing, so a test that never mounts the input can only ever
// inspect the returned object shape, never the wired-up behaviour (open(),
// the change handler, the value reset).
function setup(onFile: (file: File) => void = vi.fn(), accept = "application/json", disabled = false) {
  const { result } = renderHook(() => useFilePicker(onFile, accept, disabled));
  const { container } = render(<input {...result.current.inputProps} />);
  const input = container.querySelector("input") as HTMLInputElement;
  return { result, input };
}

describe("useFilePicker", () => {
  it("inputProps carries the load-bearing sr-only + focus-suppression + type properties", () => {
    const onFile = vi.fn();
    const { result } = renderHook(() => useFilePicker(onFile, "application/json,.json", false));
    const { inputProps } = result.current;
    // ★ Exact string, not a substring check — a display:none regression would
    //   still contain "sr-only" if merely appended, so pin the whole value.
    expect(inputProps.className).toBe("sr-only");
    expect(inputProps.tabIndex).toBe(-1);
    expect(inputProps["aria-hidden"]).toBe("true");
    expect(inputProps.type).toBe("file");
    expect(inputProps.accept).toBe("application/json,.json");
    expect(inputProps.disabled).toBe(false);
  });

  it("forwards disabled through to inputProps", () => {
    const { result } = renderHook(() => useFilePicker(vi.fn(), "application/json", true));
    expect(result.current.inputProps.disabled).toBe(true);
  });

  it("open() clicks the input the ref is attached to", () => {
    const { result, input } = setup();
    const click = vi.spyOn(input, "click");
    result.current.open();
    expect(click).toHaveBeenCalledTimes(1);
  });

  // ★ THE UNCOVERED BRANCH: user-event's upload() does not dispatch at all for
  //   an empty selection — its fileDialog handler compares the new list against
  //   `input.files` by length and object identity and returns early when they
  //   match, so an empty upload is a silent no-op rather than a refusal. A raw
  //   change event with an empty files list is the only way to reach
  //   `if (!file) return`.
  it("does not call onFile when the change event carries no file", () => {
    const onFile = vi.fn();
    const { input } = setup(onFile);
    fireEvent.change(input, { target: { files: [] } });
    expect(onFile).not.toHaveBeenCalled();
  });

  // ★★★ NO TEST HERE PINS `e.target.value = ""`, AND NONE CAN — do not add one.
  //   jsdom's HTMLInputElement.value getter derives from the IMPL's FileList,
  //   while fireEvent shadows `files` as an own property on the WRAPPER, so
  //   `input.value` reads "" in every state: before the event, after a no-file
  //   event, and after a successful pick (measured against jsdom 29.1.1 with a
  //   real File attached). An `expect(input.value).toBe("")` therefore cannot
  //   fail, and a test built on it reads as protection while guarding nothing.
  //   The reset IS pinned, by behaviour rather than by value: see
  //   `file-picker-button.test.tsx`'s "fires again when the same file is picked
  //   twice", which carries its own note about the fresh-File variant that
  //   shipped green against the deleted reset in 0.211.1.

  it("calls onFile with the picked file on a real change event", () => {
    const onFile = vi.fn();
    const { input } = setup(onFile);
    const file = new File(["{}"], "a.json", { type: "application/json" });
    fireEvent.change(input, { target: { files: [file] } });
    expect(onFile).toHaveBeenCalledTimes(1);
    expect(onFile.mock.calls[0][0]).toBe(file);
  });
});
