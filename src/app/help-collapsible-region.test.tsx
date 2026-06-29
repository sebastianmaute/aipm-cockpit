import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { HelpCollapsibleRegion } from "./help-collapsible-region";

function setup() {
  return render(
    <HelpCollapsibleRegion
      lang="en-US"
      panels={[
        { key: "tours", titleKey: "helpGuidedToursTitle", body: <div>TOURS BODY</div> },
        { key: "connects", titleKey: "helpRelationsTitle", body: <div>CONNECTS BODY</div> },
        { key: "flows", titleKey: "navHelp", body: <div>FLOWS BODY</div> },
      ]}
    />,
  );
}

describe("HelpCollapsibleRegion", () => {
  it("selects the first panel by default; others mounted but hidden", () => {
    setup();
    // All bodies stay in the DOM (so aria-controls targets exist) but only the
    // selected one is visible.
    expect(screen.getByText("TOURS BODY")).toBeVisible();
    expect(screen.getByText("CONNECTS BODY")).not.toBeVisible();
  });

  it("is exclusive: selecting a tab shows its panel and hides the others", () => {
    setup();
    const tabs = screen.getAllByRole("tab");
    const connectsTab = tabs.find((tb) => /connect|how it/i.test(tb.textContent || ""));
    expect(connectsTab).toBeTruthy();
    fireEvent.click(connectsTab!);
    expect(connectsTab!.getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText("CONNECTS BODY")).toBeVisible();
    expect(screen.getByText("TOURS BODY")).not.toBeVisible();
  });

  it("each tab's aria-controls points at a mounted panel", () => {
    setup();
    for (const tab of screen.getAllByRole("tab")) {
      const id = tab.getAttribute("aria-controls");
      expect(id).toBeTruthy();
      expect(document.getElementById(id!)).not.toBeNull();
    }
  });
});
