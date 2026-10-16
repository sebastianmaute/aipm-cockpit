import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SimPlaceholder, SimValue } from "./sim-value";

describe("SimValue", () => {
  it("exposes the accessible name '<label>, simulated'", () => {
    render(<SimValue lang="en-US" label="Chance on time" value="72 %" />);
    expect(screen.getByRole("group", { name: "Chance on time, simulated" })).toBeInTheDocument();
  });

  it("renders the sim badge as aria-hidden text", () => {
    render(<SimValue lang="en-US" label="Chance on time" value="72 %" />);
    expect(screen.getByText("sim")).toHaveAttribute("aria-hidden", "true");
  });

  it("marks its container with data-sim and shows value and hint", () => {
    render(<SimValue lang="en-US" label="Chance on time" value="72 %" hint="P80" />);
    const group = screen.getByRole("group", { name: "Chance on time, simulated" });
    expect(group).toHaveAttribute("data-sim", "true");
    expect(group).toHaveTextContent("72 %");
    expect(group).toHaveTextContent("P80");
  });

  it("renders no explainer trigger unless one is given", () => {
    render(<SimValue lang="en-US" label="Chance on time" value="72 %" />);
    expect(screen.queryByRole("button", { name: "How to read this" })).not.toBeInTheDocument();
  });

  it("renders the explainer trailing and forwards onOpenHelp", async () => {
    const user = userEvent.setup();
    const onOpenHelp = vi.fn();
    render(
      <SimValue
        lang="en-US"
        label="Finish"
        value="12 Nov"
        onOpenHelp={onOpenHelp}
        explainer={{ windowDays: 60, distribution: [5, 6, 7], trials: 3, markers: { p50: 6, p80: 7, p95: 7 } }}
      />,
    );
    await user.click(screen.getByRole("button", { name: "How to read this" }));
    await user.click(screen.getByRole("button", { name: "Learn more in Help" }));
    expect(onOpenHelp).toHaveBeenCalledWith("concept-forecast-simulation");
  });
});

describe("SimPlaceholder", () => {
  it("is an empty, aria-hidden, fixed-height marker with no text", () => {
    const { container } = render(<SimPlaceholder />);
    const el = container.querySelector("[data-sim-placeholder]")!;
    expect(el).toHaveAttribute("aria-hidden", "true");
    expect(el).toBeEmptyDOMElement();
    expect(el.className).toContain("h-6");
  });
});
