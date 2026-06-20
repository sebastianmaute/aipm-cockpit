import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { TzClockStrip } from "./tz-clock-strip";
import { t } from "./i18n";

describe("TzClockStrip", () => {
  it("renders a labeled region with the default + each additional zone", () => {
    render(<TzClockStrip lang="en-US" defaultTz="Europe/Berlin" zones={["America/New_York", "Asia/Kolkata"]} />);
    const region = screen.getByLabelText(t("en-US", "tzClockStripLabel"));
    expect(region).toBeInTheDocument();
    expect(region.textContent).toContain("Europe/Berlin");
    expect(region.textContent).toContain("America/New_York");
    expect(region.textContent).toContain("Asia/Kolkata");
  });
  it("renders nothing when there are no additional zones", () => {
    const { container } = render(<TzClockStrip lang="en-US" defaultTz="Europe/Berlin" zones={[]} />);
    expect(container.firstChild).toBeNull();
  });
});
