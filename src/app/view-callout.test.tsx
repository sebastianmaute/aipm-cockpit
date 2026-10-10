import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ViewCallout } from "./view-callout";
import { t } from "./i18n";
import { TextButton } from "./text-button";
import { primitiveClassFor } from "../test/primitive-class";

describe("ViewCallout", () => {
  beforeEach(() => localStorage.clear());

  it("renders the callout for a view that has one", () => {
    render(<ViewCallout view="raid" lang="en-US" showHints isPopout={false} onLearnMore={vi.fn()} />);
    expect(screen.getByText(t("en-US", "viewHintRaid"))).toBeInTheDocument();
  });

  it("renders nothing for a view without a callout", () => {
    const { container } = render(
      <ViewCallout view="dashboard" lang="en-US" showHints isPopout={false} onLearnMore={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when hints are off", () => {
    const { container } = render(
      <ViewCallout view="raid" lang="en-US" showHints={false} isPopout={false} onLearnMore={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("deep-links the concept on Learn more", () => {
    const onLearnMore = vi.fn();
    render(<ViewCallout view="raid" lang="en-US" showHints isPopout={false} onLearnMore={onLearnMore} />);
    fireEvent.click(screen.getByRole("button", { name: /learn more/i }));
    expect(onLearnMore).toHaveBeenCalledWith("concept-raid");
  });

  it("dismisses and persists, hiding the callout", () => {
    const { container } = render(
      <ViewCallout view="raid" lang="en-US" showHints isPopout={false} onLearnMore={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "viewHintDismiss") }));
    expect(container).toBeEmptyDOMElement();
    expect(localStorage.getItem("aipm-cockpit:view-hints")).toContain("raid");
  });

  it("renders nothing in a popout", () => {
    const { container } = render(
      <ViewCallout view="raid" lang="en-US" showHints isPopout onLearnMore={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

// §693 — Learn more is the shared TextButton.
describe("ViewCallout Learn more", () => {
  it("renders the shared TextButton", () => {
    localStorage.clear();
    render(<ViewCallout view="raid" lang="en-US" showHints isPopout={false} onLearnMore={vi.fn()} />);
    expect(screen.getByRole("button", { name: /learn more/i }).className).toBe(
      primitiveClassFor(<TextButton className="shrink-0">x</TextButton>),
    );
  });
});
