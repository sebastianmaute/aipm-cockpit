import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TemplatesSection } from "./templates-section";
import { t } from "../i18n";

afterEach(() => window.localStorage.clear());

describe("TemplatesSection", () => {
  it("lists the three built-in templates", () => {
    render(<TemplatesSection lang="en-US" />);
    expect(screen.getByText("Minimal")).toBeInTheDocument();
    expect(screen.getByText("Standard PM")).toBeInTheDocument();
    expect(screen.getByText("Full delivery")).toBeInTheDocument();
  });
  it("duplicating a built-in adds a user template row", () => {
    render(<TemplatesSection lang="en-US" />);
    const dup = screen.getAllByRole("button", { name: t("en-US", "templatesDuplicate") });
    fireEvent.click(dup[0]);
    expect(screen.getByText(/copy/i)).toBeInTheDocument();
  });
});
