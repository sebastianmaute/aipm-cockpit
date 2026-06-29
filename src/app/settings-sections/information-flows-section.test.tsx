import { describe, it, expect, beforeAll } from "vitest";
import { render, screen } from "@testing-library/react";
import { InformationFlowsSection } from "./information-flows-section";
import { loadI18n } from "../i18n";

beforeAll(async () => {
  await loadI18n("de");
});

describe("InformationFlowsSection", () => {
  it("renders the new storage + service nodes (File storage, SharePoint, Outlook)", () => {
    const { container } = render(<InformationFlowsSection lang="en-US" />);
    const txt = container.textContent ?? "";
    expect(txt).toContain("File storage");
    expect(txt).toContain("SharePoint");
    expect(txt).toContain("Outlook");
    expect(txt).not.toContain("Microsoft 365"); // split
  });

  it("keeps an accessible img-role diagram", () => {
    render(<InformationFlowsSection lang="en-US" />);
    expect(screen.getByRole("img")).toBeTruthy();
  });

  it("renders both zone labels", () => {
    const { container } = render(<InformationFlowsSection lang="en-US" />);
    expect(container.textContent).toContain("Your data");
    expect(container.textContent).toContain("Connected services");
  });
});
