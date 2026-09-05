import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { EffortField } from "./effort-field";

const base = { lang: "en-US" as const, label: "Effort" };

describe("EffortField", () => {
  test("seeds a pinned zero as a VALUE, not an empty box", () => {
    // `formatDuration(0)` is "", which renders pixel-identically to "not
    // overridden" — the one distinction this field exists to express
    // (`types.ts`: "Never 0 for 'not overridden': 0 is the real claim 'no work
    // left'"). The undefined control below is what makes this assertion able
    // to tell the two states apart at all.
    render(<EffortField {...base} minutes={0} onChange={vi.fn()} />);
    expect(screen.getByRole("textbox", { name: /effort/i })).toHaveValue("0m");
  });

  test("seeds an absent value as an empty box", () => {
    render(<EffortField {...base} minutes={undefined} onChange={vi.fn()} />);
    expect(screen.getByRole("textbox", { name: /effort/i })).toHaveValue("");
  });

  test("seeds a real duration through formatDuration", () => {
    // The third leg of the seed table — the only one that dies if the seed
    // collapses to a constant. It does NOT pin this commit's `|| "0m"` fix (90
    // formats identically without it), and is not meant to.
    render(<EffortField {...base} minutes={90} onChange={vi.fn()} />);
    expect(screen.getByRole("textbox", { name: /effort/i })).toHaveValue("1h 30m");
  });

  test("reports the crossing into and back out of invalid", async () => {
    // Unparsable text is deliberately NOT pushed through onChange, so the
    // parent keeps its last valid number. This callback is the only signal a
    // caller has that the box no longer says what the number says.
    const onChange = vi.fn();
    const onValidityChange = vi.fn();
    render(
      <EffortField
        {...base}
        minutes={undefined}
        onChange={onChange}
        onValidityChange={onValidityChange}
      />,
    );
    const input = screen.getByRole("textbox", { name: /effort/i });

    await userEvent.type(input, "4 hours");
    expect(onValidityChange).toHaveBeenLastCalledWith(false);
    // THE DEFECT THIS PROP EXISTS FOR, in one pair of assertions: the box says
    // "4 hours" and the parent's number says 240 — the transient "4 h" prefix
    // parsed, and the four keystrokes after it were dropped rather than
    // reported. Nothing but this callback tells the parent the two disagree.
    expect(input).toHaveValue("4 hours");
    expect(onChange).toHaveBeenLastCalledWith(240);

    await userEvent.clear(input);
    await userEvent.type(input, "4h");
    expect(onValidityChange).toHaveBeenLastCalledWith(true);
    expect(onChange).toHaveBeenLastCalledWith(240);
  });

  test("reports the CROSSING, not every keystroke", async () => {
    // A caller wiring this to setState must not be re-rendered per character.
    // Seven characters, one report. ★ NOT "4 hours" — its "4 h" prefix PARSES,
    // so that string crosses three times; the other test pins that shape.
    const onValidityChange = vi.fn();
    render(
      <EffortField
        {...base}
        minutes={undefined}
        onChange={vi.fn()}
        onValidityChange={onValidityChange}
      />,
    );
    await userEvent.type(screen.getByRole("textbox", { name: /effort/i }), "ninety!");
    expect(onValidityChange).toHaveBeenCalledTimes(1);
    expect(onValidityChange).toHaveBeenCalledWith(false);
  });

  test("an emptied box is valid, and reports undefined rather than zero", async () => {
    const onChange = vi.fn();
    const onValidityChange = vi.fn();
    render(
      <EffortField {...base} minutes={90} onChange={onChange} onValidityChange={onValidityChange} />,
    );
    await userEvent.clear(screen.getByRole("textbox", { name: /effort/i }));
    expect(onChange).toHaveBeenLastCalledWith(undefined);
    expect(onValidityChange).not.toHaveBeenCalled();
  });
});
