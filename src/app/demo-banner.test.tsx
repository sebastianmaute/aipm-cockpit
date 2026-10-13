import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { DemoBanner } from "./demo-banner";
import { DEMO_BANNER_DONE_KEY, markDemoBannerDone, readDemoBannerDone } from "./demo-banner-state";
import { t } from "./i18n";

const EXPLORE = t("en-US", "demoBannerExplore");
const HIDE = t("en-US", "demoBannerDismiss");

describe("DemoBanner", () => {
  afterEach(() => window.localStorage.clear());

  it("shows the suggestion text, the Explore button and a named dismiss control by default", () => {
    render(<DemoBanner lang="en-US" onExplore={vi.fn()} />);
    expect(screen.getByText(t("en-US", "demoBannerText"))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Explore the demo" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hide demo suggestion" })).toBeInTheDocument();
    expect(EXPLORE).toBe("Explore the demo");
    expect(HIDE).toBe("Hide demo suggestion");
  });

  it("hides on dismiss and a fresh mount stays hidden", () => {
    const { unmount } = render(<DemoBanner lang="en-US" onExplore={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: HIDE }));
    expect(screen.queryByText(t("en-US", "demoBannerText"))).toBeNull();
    expect(readDemoBannerDone()).toBe(true);
    unmount();
    render(<DemoBanner lang="en-US" onExplore={vi.fn()} />);
    expect(screen.queryByText(t("en-US", "demoBannerText"))).toBeNull();
  });

  it("Explore marks the banner done and then calls onExplore", () => {
    const onExplore = vi.fn(() => {
      // The mark lands BEFORE the (async) demo load starts.
      expect(window.localStorage.getItem(DEMO_BANNER_DONE_KEY)).not.toBeNull();
    });
    render(<DemoBanner lang="en-US" onExplore={onExplore} />);
    fireEvent.click(screen.getByRole("button", { name: EXPLORE }));
    expect(onExplore).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(t("en-US", "demoBannerText"))).toBeNull();
  });

  it("renders nothing when the demo was already opened on this device", () => {
    markDemoBannerDone();
    const { container } = render(<DemoBanner lang="en-US" onExplore={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("disappears when the demo is opened elsewhere while it is mounted", () => {
    const { rerender } = render(<DemoBanner lang="en-US" onExplore={vi.fn()} />);
    markDemoBannerDone(); // e.g. the Help entry, which goes through loadDemo
    rerender(<DemoBanner lang="en-US" onExplore={vi.fn()} />);
    expect(screen.queryByText(t("en-US", "demoBannerText"))).toBeNull();
  });
});
