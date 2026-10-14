import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { DemoBanner } from "./demo-banner";
import { DEMO_BANNER_DONE_KEY, markDemoBannerDone, readDemoBannerDone } from "./demo-banner-state";
import { loadI18n, t } from "./i18n";
import { DEMO_SAMPLE_NAME } from "./demo-project";
import { addProject, emptyRegistry, saveRegistry, type ProjectRegistryEntry } from "./projects-registry";

const BROWSER_PROJECT: ProjectRegistryEntry = { id: "p1", name: "Acme", code: "AC", storageConfig: { kind: "browser" } };

const EXPLORE = t("en-US", "demoBannerExplore");
const HIDE = t("en-US", "demoBannerDismiss");

describe("DemoBanner", () => {
  afterEach(() => window.localStorage.clear());

  it("shows the suggestion text, the Explore button and a named dismiss control by default", () => {
    render(<DemoBanner lang="en-US" tursoUsable={false} onExplore={vi.fn()} />);
    expect(screen.getByText(t("en-US", "demoBannerText"))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Explore the demo" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hide demo suggestion" })).toBeInTheDocument();
  });

  it("hides on dismiss and a fresh mount stays hidden", () => {
    const { unmount } = render(<DemoBanner lang="en-US" tursoUsable={false} onExplore={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: HIDE }));
    expect(screen.queryByText(t("en-US", "demoBannerText"))).toBeNull();
    expect(readDemoBannerDone()).toBe(true);
    unmount();
    render(<DemoBanner lang="en-US" tursoUsable={false} onExplore={vi.fn()} />);
    expect(screen.queryByText(t("en-US", "demoBannerText"))).toBeNull();
  });

  it("Explore calls onExplore but does NOT spend the banner (loadDemo marks it on success)", () => {
    const onExplore = vi.fn();
    const { unmount } = render(<DemoBanner lang="en-US" tursoUsable={false} onExplore={onExplore} />);
    fireEvent.click(screen.getByRole("button", { name: EXPLORE }));
    expect(onExplore).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem(DEMO_BANNER_DONE_KEY)).toBeNull();
    expect(readDemoBannerDone()).toBe(false);
    unmount();
    // A refused or failed load leaves the banner for the next visit.
    render(<DemoBanner lang="en-US" tursoUsable={false} onExplore={vi.fn()} />);
    expect(screen.getByText(t("en-US", "demoBannerText"))).toBeInTheDocument();
  });

  it("is hidden when the demo cannot open: no usable Turso and a browser-backed project in the registry", () => {
    saveRegistry(addProject(emptyRegistry(), BROWSER_PROJECT, true));
    const { container } = render(<DemoBanner lang="en-US" tursoUsable={false} onExplore={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
    // Not spent either: it comes back once the blocker is gone.
    expect(readDemoBannerDone()).toBe(false);
  });

  it("is shown for a browser-backed registry when Turso is usable (the demo goes to Turso)", () => {
    saveRegistry(addProject(emptyRegistry(), BROWSER_PROJECT, true));
    render(<DemoBanner lang="en-US" tursoUsable onExplore={vi.fn()} />);
    expect(screen.getByText(t("en-US", "demoBannerText"))).toBeInTheDocument();
  });

  it("renders nothing when the demo was already opened on this device", () => {
    markDemoBannerDone();
    const { container } = render(<DemoBanner lang="en-US" tursoUsable={false} onExplore={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("disappears when the demo is opened elsewhere while it is mounted", () => {
    const { rerender } = render(<DemoBanner lang="en-US" tursoUsable={false} onExplore={vi.fn()} />);
    markDemoBannerDone(); // e.g. the Help entry, which goes through loadDemo
    rerender(<DemoBanner lang="en-US" tursoUsable={false} onExplore={vi.fn()} />);
    expect(screen.queryByText(t("en-US", "demoBannerText"))).toBeNull();
  });

  it("M3: is hidden on the demo project itself, named in either language", async () => {
    await loadI18n("de");
    for (const lang of ["en-US", "de"] as const) {
      const name = t(lang, "demoProjectName", DEMO_SAMPLE_NAME);
      const { container, unmount } = render(<DemoBanner lang="en-US" tursoUsable projectName={name} onExplore={vi.fn()} />);
      expect(container).toBeEmptyDOMElement();
      unmount();
    }
    render(<DemoBanner lang="en-US" tursoUsable projectName="Acme" onExplore={vi.fn()} />);
    expect(screen.getByText(t("en-US", "demoBannerText"))).toBeInTheDocument();
  });
});
