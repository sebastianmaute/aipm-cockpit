import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Input, Select, Textarea, Checkbox, fieldClass } from "./form-controls";

describe("fieldClass", () => {
  it("carries the canonical shell (radius, border, surface, padding)", () => {
    const c = fieldClass();
    expect(c).toContain("rounded-md");
    expect(c).toContain("border-line");
    expect(c).toContain("bg-surface");
    expect(c).toContain("px-3");
    expect(c).toContain("py-2");
  });

  it("uses the canonical ring-2 green focus ring (never ring-1) when valid", () => {
    const c = fieldClass();
    expect(c).toContain("focus:ring-2");
    expect(c).toContain("focus:ring-ui-green");
    expect(c).not.toContain("focus:ring-1");
  });

  it("never applies PRESS to a form field", () => {
    expect(fieldClass()).not.toContain("active:translate-y");
  });

  it("swaps to the pink semantic ring when invalid, dropping the green ring", () => {
    const c = fieldClass(true);
    expect(c).toContain("focus:ring-ui-pink");
    expect(c).toContain("border-ui-pink");
    expect(c).not.toContain("focus:ring-ui-green");
  });

  it("appends caller className last", () => {
    const c = fieldClass(false, "w-32 extra");
    expect(c).toContain("w-32");
    expect(c).toContain("extra");
    expect(c.indexOf("border-line")).toBeLessThan(c.indexOf("extra"));
  });
});

describe("Input", () => {
  it("renders an <input> with the canonical field class", () => {
    render(<Input aria-label="Name" />);
    const el = screen.getByLabelText("Name");
    expect(el.tagName).toBe("INPUT");
    expect(el.className).toContain("focus:ring-ui-green");
    expect(el.className).toContain("border-line");
  });

  it("sets aria-invalid and pink ring in the invalid state", () => {
    render(<Input aria-label="Bad" invalid />);
    const el = screen.getByLabelText("Bad");
    expect(el).toHaveAttribute("aria-invalid", "true");
    expect(el.className).toContain("focus:ring-ui-pink");
    expect(el.className).not.toContain("focus:ring-ui-green");
  });

  it("passes through type, value, onChange, disabled and aria-*", () => {
    const onChange = vi.fn();
    render(<Input type="email" value="a@b.co" onChange={onChange} aria-label="Email" />);
    const el = screen.getByLabelText("Email") as HTMLInputElement;
    expect(el).toHaveAttribute("type", "email");
    expect(el.value).toBe("a@b.co");
    fireEvent.change(el, { target: { value: "c@d.co" } });
    expect(onChange).toHaveBeenCalled();
  });

  it("appends caller className after the base", () => {
    render(<Input aria-label="W" className="w-24" />);
    const cls = screen.getByLabelText("W").className;
    expect(cls).toContain("w-24");
    expect(cls.indexOf("border-line")).toBeLessThan(cls.indexOf("w-24"));
  });
});

describe("Select", () => {
  it("renders a <select> with the canonical field class", () => {
    render(
      <Select aria-label="Pick">
        <option value="a">A</option>
      </Select>,
    );
    const el = screen.getByLabelText("Pick");
    expect(el.tagName).toBe("SELECT");
    expect(el.className).toContain("focus:ring-ui-green");
  });

  it("supports the invalid state", () => {
    render(
      <Select aria-label="PickBad" invalid>
        <option value="a">A</option>
      </Select>,
    );
    const el = screen.getByLabelText("PickBad");
    expect(el).toHaveAttribute("aria-invalid", "true");
    expect(el.className).toContain("focus:ring-ui-pink");
  });
});

describe("Textarea", () => {
  it("renders a <textarea> with resize-none + canonical shell", () => {
    render(<Textarea aria-label="Notes" />);
    const el = screen.getByLabelText("Notes");
    expect(el.tagName).toBe("TEXTAREA");
    expect(el.className).toContain("resize-none");
    expect(el.className).toContain("focus:ring-ui-green");
  });

  it("passes value/onChange through", () => {
    const onChange = vi.fn();
    render(<Textarea aria-label="Body" value="hi" onChange={onChange} />);
    const el = screen.getByLabelText("Body") as HTMLTextAreaElement;
    expect(el.value).toBe("hi");
    fireEvent.change(el, { target: { value: "yo" } });
    expect(onChange).toHaveBeenCalled();
  });

  it("does not throw with autoGrow (jsdom has no layout)", () => {
    expect(() =>
      render(<Textarea aria-label="Grow" autoGrow value="x" onChange={() => {}} />),
    ).not.toThrow();
  });
});

describe("Checkbox", () => {
  it("renders type=checkbox with the ONE canonical accent (dark-blue)", () => {
    render(<Checkbox aria-label="Agree" />);
    const el = screen.getByLabelText("Agree");
    expect(el).toHaveAttribute("type", "checkbox");
    expect(el.className).toContain("accent-ui-dark-blue");
    expect(el.className).toContain("h-4");
    expect(el.className).toContain("w-4");
  });

  it("carries the canonical green focus ring, never PRESS", () => {
    render(<Checkbox aria-label="Ring" />);
    const cls = screen.getByLabelText("Ring").className;
    expect(cls).toContain("focus:ring-2");
    expect(cls).toContain("focus:ring-ui-green");
    expect(cls).not.toContain("active:translate-y");
  });

  it("passes through checked, onChange, disabled", () => {
    const onChange = vi.fn();
    render(<Checkbox aria-label="C" checked onChange={onChange} disabled />);
    const el = screen.getByLabelText("C") as HTMLInputElement;
    expect(el.checked).toBe(true);
    expect(el).toBeDisabled();
  });

  it("appends caller className after the base accent", () => {
    render(<Checkbox aria-label="M" className="mt-0.5" />);
    const cls = screen.getByLabelText("M").className;
    expect(cls).toContain("mt-0.5");
    expect(cls.indexOf("accent-ui-dark-blue")).toBeLessThan(cls.indexOf("mt-0.5"));
  });
});
