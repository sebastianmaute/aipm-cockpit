import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DocumentLinksField } from "./document-links-field";
import type { DocumentLink } from "./document-link";

const links: DocumentLink[] = [
  { id: "1", name: "Spec.docx", url: "https://c.sharepoint.com/x", kind: "file" },
];
const acquire = vi.fn(async () => "tok");

describe("DocumentLinksField", () => {
  it("renders empty state when no links", () => {
    render(<DocumentLinksField value={[]} onChange={vi.fn()} lang="en-US" acquireToken={acquire} />);
    expect(screen.getByText(/no linked documents/i)).toBeInTheDocument();
  });

  it("renders a link with an open anchor and a remove button", () => {
    render(<DocumentLinksField value={links} onChange={vi.fn()} lang="en-US" acquireToken={acquire} />);
    expect(screen.getByText("Spec.docx")).toBeInTheDocument();
    const anchor = screen.getByRole("link", { name: /open in new tab/i });
    expect(anchor).toHaveAttribute("href", "https://c.sharepoint.com/x");
    expect(anchor).toHaveAttribute("target", "_blank");
  });

  it("removes a link via onChange", () => {
    const onChange = vi.fn();
    render(<DocumentLinksField value={links} onChange={onChange} lang="en-US" acquireToken={acquire} />);
    fireEvent.click(screen.getByRole("button", { name: /remove link/i }));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("does not render an href for an unsafe url", () => {
    render(<DocumentLinksField value={[{ id: "1", name: "evil", url: "javascript:alert(1)", kind: "file" }]} onChange={vi.fn()} lang="en-US" acquireToken={acquire} />);
    expect(screen.getByText("evil")).toBeInTheDocument();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("opens the picker when Add is clicked", () => {
    render(<DocumentLinksField value={[]} onChange={vi.fn()} lang="en-US" acquireToken={acquire} />);
    fireEvent.click(screen.getByRole("button", { name: /add from sharepoint/i }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
