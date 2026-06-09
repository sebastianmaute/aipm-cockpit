import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { InformationFlowsSection } from "./information-flows-section";

describe("InformationFlowsSection", () => {
  it("renders the diagram with an accessible name (en-US)", () => {
    render(<InformationFlowsSection lang="en-US" />);
    expect(
      screen.getByRole("img", { name: /information flows/i })
    ).toBeInTheDocument();
  });

  it("renders the diagram with an accessible name (de)", () => {
    render(<InformationFlowsSection lang="de" />);
    // aria-label falls back to en-US until de dict is loaded; either is acceptable
    expect(
      screen.getByRole("img", {
        name: /informationsfl[uü]sse|information flows/i,
      })
    ).toBeInTheDocument();
  });

  it("shows all five legend entries in the dl list", () => {
    const { container } = render(<InformationFlowsSection lang="en-US" />);
    const dl = container.querySelector("dl");
    expect(dl).not.toBeNull();
    const legend = within(dl!);
    // Each label appears exactly once inside the <dl>
    expect(legend.getByText("Jira")).toBeInTheDocument();
    expect(legend.getByText("Microsoft 365")).toBeInTheDocument();
    expect(legend.getByText("Turso (libSQL)")).toBeInTheDocument();
    expect(legend.getByText("Anthropic API")).toBeInTheDocument();
    expect(legend.getByText("Local storage")).toBeInTheDocument();
  });

  it("shows the Jira description in the legend", () => {
    const { container } = render(<InformationFlowsSection lang="en-US" />);
    const dl = container.querySelector("dl")!;
    expect(within(dl).getByText(/\/api\/jira/i)).toBeInTheDocument();
  });

  it("shows the Microsoft 365 description in the legend", () => {
    const { container } = render(<InformationFlowsSection lang="en-US" />);
    const dl = container.querySelector("dl")!;
    expect(within(dl).getByText(/Graph API.*MSAL/i)).toBeInTheDocument();
  });

  it("shows the Turso description in the legend", () => {
    const { container } = render(<InformationFlowsSection lang="en-US" />);
    const dl = container.querySelector("dl")!;
    expect(within(dl).getByText(/cloud database/i)).toBeInTheDocument();
  });

  it("shows the Anthropic description in the legend", () => {
    const { container } = render(<InformationFlowsSection lang="en-US" />);
    const dl = container.querySelector("dl")!;
    expect(within(dl).getByText(/claude ai/i)).toBeInTheDocument();
  });

  it("shows the local storage description in the legend", () => {
    const { container } = render(<InformationFlowsSection lang="en-US" />);
    const dl = container.querySelector("dl")!;
    expect(within(dl).getByText(/IndexedDB/i)).toBeInTheDocument();
  });
});
