import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { BrandingImageInput } from "./branding-image-input";

describe("BrandingImageInput", () => {
  it("renders a labeled file input and a remove button when a value is set", () => {
    render(
      <BrandingImageInput
        label="Logo"
        value="data:image/png;base64,AAAA"
        onChange={vi.fn()}
        onRemove={vi.fn()}
        error={null}
      />,
    );
    expect(screen.getByLabelText("Logo")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /remove/i })).toBeInTheDocument();
  });

  it("shows an error message when error is set", () => {
    render(
      <BrandingImageInput label="Favicon" value="" onChange={vi.fn()} onRemove={vi.fn()} error="bad file" />,
    );
    expect(screen.getByText("bad file")).toBeInTheDocument();
  });
});
