import { render } from "@testing-library/react";
import { useRef } from "react";
import { describe, it, expect } from "vitest";
import { useAutogrow } from "./use-autogrow";

// jsdom has no layout engine, so scrollHeight is 0 by default — the tests stub
// it on the live element and re-render to exercise the value-driven resize.
function Harness({ value }: { value: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useAutogrow(ref, value);
  return <textarea ref={ref} data-testid="ta" value={value} readOnly />;
}

describe("useAutogrow", () => {
  it("sets the inline height to the textarea's scrollHeight when the value changes", () => {
    const { getByTestId, rerender } = render(<Harness value="a" />);
    const el = getByTestId("ta") as HTMLTextAreaElement;

    // Stub the measured content height, then change the value to re-run the effect.
    Object.defineProperty(el, "scrollHeight", { configurable: true, value: 120 });
    rerender(<Harness value="ab" />);

    expect(el.style.height).toBe("120px");
  });

  it("grows again when the content grows further", () => {
    const { getByTestId, rerender } = render(<Harness value="a" />);
    const el = getByTestId("ta") as HTMLTextAreaElement;

    Object.defineProperty(el, "scrollHeight", { configurable: true, value: 60 });
    rerender(<Harness value="ab" />);
    expect(el.style.height).toBe("60px");

    Object.defineProperty(el, "scrollHeight", { configurable: true, value: 200 });
    rerender(<Harness value="abc" />);
    expect(el.style.height).toBe("200px");
  });
});
