import { describe, test, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SegmentedControl } from "./segmented-control";

const PRIORITIES = [
  { value: "Low", label: "Low" },
  { value: "Medium", label: "Medium" },
  { value: "High", label: "High" },
] as const;

describe("SegmentedControl", () => {
  test("renders a radiogroup with the current value marked as selected", () => {
    render(
      <SegmentedControl
        value="Medium"
        options={PRIORITIES}
        onChange={() => {}}
        ariaLabel="Priority"
      />,
    );
    expect(
      screen.getByRole("radiogroup", { name: "Priority" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Medium" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  test("invokes onChange with the clicked option's value", async () => {
    const onChange = vi.fn();
    render(
      <SegmentedControl
        value="Low"
        options={PRIORITIES}
        onChange={onChange}
        ariaLabel="Priority"
      />,
    );
    await userEvent.click(screen.getByRole("radio", { name: "High" }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("High");
  });

  test("does not fire onChange when disabled", async () => {
    const onChange = vi.fn();
    render(
      <SegmentedControl
        value="Low"
        options={PRIORITIES}
        onChange={onChange}
        disabled
        ariaLabel="Priority"
      />,
    );
    await userEvent.click(screen.getByRole("radio", { name: "High" }));
    expect(onChange).not.toHaveBeenCalled();
  });

  test("optionAriaLabel overrides each radio's accessible name (row-unique)", () => {
    render(
      <SegmentedControl
        value="Low"
        options={PRIORITIES}
        onChange={() => {}}
        ariaLabel="Priority"
        optionAriaLabel={(v) => `Row 1 — ${v}`}
      />,
    );
    expect(screen.getByRole("radio", { name: "Row 1 — High" })).toBeInTheDocument();
    // The plain visible label is no longer the accessible name.
    expect(screen.queryByRole("radio", { name: "High" })).toBeNull();
  });

  test("without optionAriaLabel a radio's accessible name stays the visible label", () => {
    render(
      <SegmentedControl value="Low" options={PRIORITIES} onChange={() => {}} ariaLabel="Priority" />,
    );
    expect(screen.getByRole("radio", { name: "High" })).toBeInTheDocument();
  });

  test("roving tabindex: only the checked radio is a tab-stop", () => {
    render(
      <SegmentedControl value="Medium" options={PRIORITIES} onChange={() => {}} ariaLabel="Priority" />,
    );
    expect(screen.getByRole("radio", { name: "Medium" })).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("radio", { name: "Low" })).toHaveAttribute("tabindex", "-1");
    expect(screen.getByRole("radio", { name: "High" })).toHaveAttribute("tabindex", "-1");
  });

  test("falls back to the first radio as tab-stop when value matches no option", () => {
    render(
      // Deliberately out-of-range value (cast) to prove the group stays reachable.
      <SegmentedControl value={"Nope" as "Low"} options={PRIORITIES} onChange={() => {}} ariaLabel="Priority" />,
    );
    expect(screen.getByRole("radio", { name: "Low" })).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("radio", { name: "Medium" })).toHaveAttribute("tabindex", "-1");
  });

  // ★★ These two were ONE test firing both arrows at a single render. That only
  // worked while the step came from `value`: the first arrow MOVES FOCUS (to
  // "Low"), and against a `vi.fn()` stub `value` stays "High" forever, so a
  // second arrow now correctly steps from the focused radio and wraps to "High"
  // rather than reading "Medium" off the stale value. Split, not weakened —
  // both assertions survive verbatim, each against a fresh mount where focus
  // sits nowhere and the checked radio is the reference.
  test("ArrowRight selects + focuses the next radio, wrapping at the end", () => {
    const onChange = vi.fn();
    render(
      <SegmentedControl value="High" options={PRIORITIES} onChange={onChange} ariaLabel="Priority" />,
    );
    fireEvent.keyDown(screen.getByRole("radiogroup"), { key: "ArrowRight" });
    expect(onChange).toHaveBeenLastCalledWith("Low"); // wrapped from High → Low
    // The "+ focuses" half of the name, which nothing used to assert.
    expect(document.activeElement).toBe(screen.getByRole("radio", { name: "Low" }));
  });

  test("ArrowLeft selects the previous radio", () => {
    const onChange = vi.fn();
    render(
      <SegmentedControl value="High" options={PRIORITIES} onChange={onChange} ariaLabel="Priority" />,
    );
    fireEvent.keyDown(screen.getByRole("radiogroup"), { key: "ArrowLeft" });
    expect(onChange).toHaveBeenLastCalledWith("Medium"); // High − 1
  });

  // ★★★ APG says an arrow key moves relative to the FOCUSED radio. Normally that
  // is the same radio as `value` — only the checked one is tabbable, so focus
  // arrives there — but a portaled auto-focusing panel breaks the tie:
  // `PopoverPanel`'s autofocus effect (`popover-panel.tsx`, cited by SYMBOL —
  // the line moved twice while this comment was being written) picks the first
  // match in DOCUMENT order. It now skips `tabindex="-1"`, so it lands on the
  // checked radio; before that it landed on "Simple" while "Advanced" was
  // checked. Deriving the step from `value` moved TWO positions per keypress
  // from there, silently changing the tier.
  test("ArrowRight moves ONE position from the FOCUSED radio, not from `value`", () => {
    const onChange = vi.fn();
    render(
      <SegmentedControl value="High" options={PRIORITIES} onChange={onChange} ariaLabel="Priority" />,
    );
    const low = screen.getByRole("radio", { name: "Low" });
    low.focus();
    expect(document.activeElement).toBe(low);

    fireEvent.keyDown(low, { key: "ArrowRight" });

    expect(onChange).toHaveBeenCalledWith("Medium"); // focused Low + 1
    expect(onChange).not.toHaveBeenCalledWith("Low"); // value High + 1 (wrapped)
  });

  // ★★ SUCCESSIVE arrows at ONE mount — the sequence the fix actually changes,
  // and the only test in this file that fires more than one. `onChange` is a
  // stub, so `value` NEVER updates: pre-fix, every keypress re-derived from the
  // stale "High" and the control STUCK, emitting the same value forever. The
  // split of the old two-arrow test (see the comment above it) removed the only
  // coverage of this, leaving `segmented-control.tsx`'s own claim that the fix
  // "fixes rapid arrowing" unpinned — a `cur` that consulted focus on the FIRST
  // keypress only would pass every other test here.
  test("successive arrows keep advancing even though `value` never updates", () => {
    const onChange = vi.fn();
    render(
      <SegmentedControl value="High" options={PRIORITIES} onChange={onChange} ariaLabel="Priority" />,
    );
    const low = screen.getByRole("radio", { name: "Low" });
    low.focus();

    fireEvent.keyDown(low, { key: "ArrowRight" });
    expect(onChange).toHaveBeenLastCalledWith("Medium");
    // The control moved focus itself; the next arrow must step from THERE.
    fireEvent.keyDown(document.activeElement!, { key: "ArrowRight" });

    expect(onChange).toHaveBeenLastCalledWith("High"); // Medium + 1
    // Pre-fix both keypresses derived from the stale `value` ("High" + 1 =
    // "Urgent"), so the second emitted Urgent and focus never advanced.
    expect(onChange).not.toHaveBeenCalledWith("Urgent");
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  test("ArrowLeft likewise steps from the FOCUSED radio", () => {
    const onChange = vi.fn();
    render(
      <SegmentedControl value="Low" options={PRIORITIES} onChange={onChange} ariaLabel="Priority" />,
    );
    const high = screen.getByRole("radio", { name: "High" });
    high.focus();

    fireEvent.keyDown(high, { key: "ArrowLeft" });

    expect(onChange).toHaveBeenCalledWith("Medium"); // focused High − 1
    expect(onChange).not.toHaveBeenCalledWith("High"); // value Low − 1 (wrapped)
  });

  // The measured worst case: in "custom" mode `value` matches no option, so a
  // value-derived index is -1 and one ArrowRight selects the FIRST option —
  // discarding a hand-picked field set the user never asked to replace.
  test("with a value matching no option, the step still comes from the focused radio", () => {
    const onChange = vi.fn();
    render(
      <SegmentedControl
        value={"Nope" as "Low"}
        options={PRIORITIES}
        onChange={onChange}
        ariaLabel="Priority"
      />,
    );
    const medium = screen.getByRole("radio", { name: "Medium" });
    medium.focus();

    fireEvent.keyDown(medium, { key: "ArrowRight" });

    expect(onChange).toHaveBeenCalledWith("High"); // focused Medium + 1
    expect(onChange).not.toHaveBeenCalledWith("Low"); // cur === -1 → next === 0
  });

  // The no-op half of the fix: with focus on the checked radio (every ordinary
  // mount, since the checked radio is the sole tab-stop) nothing changes, and
  // with focus outside the group entirely the value-based index still applies.
  test("focus on the checked radio behaves exactly as before", () => {
    const onChange = vi.fn();
    render(
      <SegmentedControl value="Medium" options={PRIORITIES} onChange={onChange} ariaLabel="Priority" />,
    );
    const medium = screen.getByRole("radio", { name: "Medium" });
    medium.focus();
    fireEvent.keyDown(medium, { key: "ArrowRight" });
    expect(onChange).toHaveBeenLastCalledWith("High");
  });

  test("falls back to `value` when focus is outside the group", () => {
    const onChange = vi.fn();
    render(
      <>
        <button type="button">outside</button>
        <SegmentedControl value="Medium" options={PRIORITIES} onChange={onChange} ariaLabel="Priority" />
      </>,
    );
    screen.getByRole("button", { name: "outside" }).focus();
    fireEvent.keyDown(screen.getByRole("radiogroup"), { key: "ArrowRight" });
    expect(onChange).toHaveBeenLastCalledWith("High"); // value Medium + 1
  });

  test("does not rove when disabled", () => {
    const onChange = vi.fn();
    render(
      <SegmentedControl value="Low" options={PRIORITIES} onChange={onChange} disabled ariaLabel="Priority" />,
    );
    fireEvent.keyDown(screen.getByRole("radiogroup"), { key: "ArrowRight" });
    expect(onChange).not.toHaveBeenCalled();
  });

  test("applies the title attribute to the radiogroup root", () => {
    render(
      <SegmentedControl
        value="Low"
        options={[{ value: "Low", label: "Low" }, { value: "High", label: "High" }]}
        onChange={() => {}}
        ariaLabel="Demo"
        title="Helpful hint"
      />,
    );
    expect(screen.getByRole("radiogroup")).toHaveAttribute("title", "Helpful hint");
  });
});

describe("SegmentedControl palette", () => {
  test("uses the green focus-ring accent and no drop shadow", () => {
    render(
      <SegmentedControl
        value="a"
        ariaLabel="test"
        options={[
          { value: "a", label: "A" },
          { value: "b", label: "B" },
        ]}
        onChange={() => {}}
      />,
    );
    const radios = screen.getAllByRole("radio");
    expect(radios[0].className).toContain("ring-ui-green");
    expect(radios[0].className).not.toContain("ring-ui-dark-blue");
    const group = screen.getByRole("radiogroup");
    expect(group.className).not.toContain("shadow");
    expect(group.className).not.toContain("zinc");
  });

  test("active button carries token-driven bg/fg classes; inactive button does not", () => {
    // Arrange
    render(
      <SegmentedControl
        value="a"
        ariaLabel="token-test"
        options={[
          { value: "a", label: "A" },
          { value: "b", label: "B" },
        ]}
        onChange={() => {}}
      />,
    );

    // Act
    const selected = screen.getByRole("radio", { name: "A" });
    const unselected = screen.getByRole("radio", { name: "B" });

    // Assert — selected carries token classes
    expect(selected.className).toContain("bg-[var(--segment-active-bg)]");
    expect(selected.className).toContain("text-[var(--segment-active-fg)]");
    // Assert — unselected does NOT carry them
    expect(unselected.className).not.toContain("bg-[var(--segment-active-bg)]");
    expect(unselected.className).not.toContain("text-[var(--segment-active-fg)]");
    // Assert — wrapper uses track token (not raw bg-surface)
    const group = screen.getByRole("radiogroup");
    expect(group.className).toContain("bg-[var(--segment-track-bg)]");
    expect(group.className).not.toContain("bg-surface");
  });
});
