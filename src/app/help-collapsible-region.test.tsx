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
  it("opens the first panel by default", () => {
    setup();
    expect(screen.getByText("TOURS BODY")).toBeTruthy();
    expect(screen.queryByText("CONNECTS BODY")).toBeNull();
  });

  it("is exclusive: opening one collapses the others", () => {
    setup();
    const bars = screen.getAllByRole("button");
    const connectsBar = bars.find((b) => b.getAttribute("aria-expanded") === "false" && /connect|how it/i.test(b.textContent || b.getAttribute("aria-label") || ""));
    fireEvent.click(connectsBar!);
    expect(screen.getByText("CONNECTS BODY")).toBeTruthy();
    expect(screen.queryByText("TOURS BODY")).toBeNull();
  });
});
