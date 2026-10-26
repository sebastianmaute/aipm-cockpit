import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ViewCallout } from "./view-callout";
import { loadI18n, t } from "./i18n";
import { HELP_VIDEO_CATALOGUE, youtubeWatchUrl } from "./help-videos";
import { expectLabelInName } from "../test/label-in-name";
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

  it.each(["en-US", "de"] as const)(
    "links the view's own video guide on YouTube, after Learn more, in a new tab (%s)",
    async (lang) => {
      await loadI18n(lang);
      // Gantt's Learn more goes to the dependency concept, but its video is the Gantt's own.
      render(<ViewCallout view="gantt" lang={lang} showHints isPopout={false} onLearnMore={vi.fn()} />);
      const video = HELP_VIDEO_CATALOGUE["f-gantt"];
      const link = screen.getByRole("link", { name: t(lang, "viewHintWatchVideoLabel", video.title) });
      expect(link).toHaveAttribute("href", youtubeWatchUrl(video));
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", "noopener noreferrer");
      expectLabelInName(link);
      const learnMore = screen.getByRole("button", { name: new RegExp(t(lang, "viewHintLearnMore")) });
      expect(learnMore.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    },
  );
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
