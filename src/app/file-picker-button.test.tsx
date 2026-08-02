import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FilePickerButton } from "./file-picker-button";

function renderPicker(over: Partial<React.ComponentProps<typeof FilePickerButton>> = {}) {
  const onFile = vi.fn();
  const { container } = render(
    <FilePickerButton label="Load theme file…" accept="application/json,.json" onFile={onFile} {...over} />,
  );
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  return { onFile, input };
}

describe("FilePickerButton", () => {
  it("clicking the button opens the file input", async () => {
    const user = userEvent.setup();
    const { input } = renderPicker();
    const click = vi.spyOn(input, "click");
    await user.click(screen.getByRole("button", { name: "Load theme file…" }));
    expect(click).toHaveBeenCalled();
  });

  // ★ The input is sr-only, NOT display:none — a hidden input cannot be
  //   clicked in every browser. So it must be removed from the tab order
  //   explicitly, or it is a SECOND tab stop announcing the same accessible
  //   name as the Button. axe reports missing accessible names, never
  //   duplicated ones, so nothing automated would catch that.
  it("the input is not a tab stop", async () => {
    const user = userEvent.setup();
    const { input } = renderPicker();
    const button = screen.getByRole("button", { name: "Load theme file…" });
    // ★ .focus() proves nothing — it succeeds on tabIndex={-1}. Only a real
    //   tab walk proves the input is out of the sequential order.
    await user.tab();
    expect(document.activeElement).toBe(button);
    await user.tab();
    expect(document.activeElement).not.toBe(input);
  });

  it("does not use display:none", () => {
    const { input } = renderPicker();
    expect(input.className).toContain("sr-only");
    expect(input.className).not.toContain("hidden");
  });

  // ★ The other half of the duplicate-name defense. `tabIndex={-1}` removes the
  //   tab stop (pinned above); `aria-hidden` removes the duplicate accessible
  //   name from the AT tree. user-event's tab walk does NOT filter aria-hidden,
  //   so the test above cannot cover this one.
  it("hides the input from assistive tech", () => {
    const { input } = renderPicker();
    expect(input).toHaveAttribute("aria-hidden", "true");
  });

  it("calls onFile with the picked file", async () => {
    const user = userEvent.setup();
    const { onFile, input } = renderPicker();
    await user.upload(input, new File(["{}"], "a.json", { type: "application/json" }));
    expect(onFile).toHaveBeenCalledTimes(1);
    expect(onFile.mock.calls[0][0].name).toBe("a.json");
  });

  // ★ Without the value reset the browser fires no change event for a
  //   re-pick of the SAME file, so "remove, then re-add the same logo"
  //   silently does nothing.
  //   ★★ ONE File instance, uploaded twice — not two equal ones. user-event's
  //   upload() skips the change event by OBJECT IDENTITY
  //   (`files.every((f, i) => f === input.files.item(i))`), so two distinct
  //   File objects with identical name and content always fire, and a version
  //   of this test that mints a fresh File per call stays green with the reset
  //   deleted. It shipped that way in 0.211.1 and guarded nothing.
  it("fires again when the same file is picked twice", async () => {
    const user = userEvent.setup();
    const { onFile, input } = renderPicker();
    const file = new File(["{}"], "a.json", { type: "application/json" });
    await user.upload(input, file);
    await user.upload(input, file);
    expect(onFile).toHaveBeenCalledTimes(2);
  });

  it("disables the button when asked", () => {
    renderPicker({ disabled: true });
    expect(screen.getByRole("button", { name: "Load theme file…" })).toBeDisabled();
  });
});
