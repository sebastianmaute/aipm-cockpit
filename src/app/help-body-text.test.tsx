import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HelpBodyText } from "./help-body-text";

describe("HelpBodyText", () => {
  it("renders a marked label in its own element with the given class", () => {
    const { container } = render(
      <HelpBodyText body="Open [[Settings]] to continue" labelClass="font-medium text-foreground" />,
    );
    const label = container.querySelector("span.font-medium");
    expect(label).not.toBeNull();
    expect(label?.textContent).toBe("Settings");
    expect(label?.className).toContain("text-foreground");
    // Positive observable: the surrounding prose rendered too, so a component
    // that emitted ONLY the label could not pass.
    expect(container.textContent).toBe("Open Settings to continue");
  });

  it("renders plain text unmarked when no query is passed", () => {
    const { container } = render(<HelpBodyText body="Plain sentence" labelClass="font-medium" />);
    expect(container.querySelector("mark")).toBeNull();
    expect(container.textContent).toBe("Plain sentence");
  });

  it("highlights the query when one is passed", () => {
    const { container } = render(
      <HelpBodyText body="Plain sentence" labelClass="font-medium" query="sent" />,
    );
    const mark = container.querySelector("mark");
    expect(mark?.textContent).toBe("sent");
    // The unmatched remainder must survive, or "highlight" degraded to "filter".
    expect(container.textContent).toBe("Plain sentence");
  });
});
