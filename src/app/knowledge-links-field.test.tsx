import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { KnowledgeLinksField } from "./knowledge-links-field";
import type { KnowledgeLink } from "./document-link";
import { expectRowUniqueNames } from "../test/row-unique-names";

const links: KnowledgeLink[] = [
  { id: "1", name: "Spec.docx", url: "https://c.sharepoint.com/x", kind: "file" },
];
const acquire = vi.fn(async () => "tok");

describe("KnowledgeLinksField", () => {
  it("renders empty state when no links", () => {
    render(<KnowledgeLinksField value={[]} onChange={vi.fn()} lang="en-US" acquireToken={acquire} />);
    expect(screen.getByText(/no linked knowledge/i)).toBeInTheDocument();
  });

  it("renders a link with an open anchor and a remove button", () => {
    render(<KnowledgeLinksField value={links} onChange={vi.fn()} lang="en-US" acquireToken={acquire} />);
    expect(screen.getByText("Spec.docx")).toBeInTheDocument();
    const anchor = screen.getByRole("link", { name: /open in new tab/i });
    expect(anchor).toHaveAttribute("href", "https://c.sharepoint.com/x");
    expect(anchor).toHaveAttribute("target", "_blank");
    // ★ Pins the destructive VARIANT, not the behaviour. `hover:text-ui-pink-strong`
    // is unique to IconButton's `danger` recipe — `ghost` (the conversion plan's
    // stated default) carries `hover:text-foreground`, and `dangerBordered` carries
    // an unprefixed `text-ui-pink-strong`. A silent downgrade to neutral fails here.
    expect(screen.getByRole("button", { name: /remove link/i }).className).toMatch(
      /\bhover:text-ui-pink-strong\b/,
    );
  });

  it("removes a link via onChange", () => {
    const onChange = vi.fn();
    render(<KnowledgeLinksField value={links} onChange={onChange} lang="en-US" acquireToken={acquire} />);
    fireEvent.click(screen.getByRole("button", { name: /remove link/i }));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("does not render an href for an unsafe url", () => {
    render(<KnowledgeLinksField value={[{ id: "1", name: "evil", url: "javascript:alert(1)", kind: "file" }]} onChange={vi.fn()} lang="en-US" acquireToken={acquire} />);
    expect(screen.getByText("evil")).toBeInTheDocument();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("opens the picker when Add is clicked", () => {
    render(<KnowledgeLinksField value={[]} onChange={vi.fn()} lang="en-US" acquireToken={acquire} />);
    fireEvent.click(screen.getByRole("button", { name: /add from sharepoint/i }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("fires onLog on remove", () => {
    const onLog = vi.fn();
    render(<KnowledgeLinksField value={[{ id: "1", name: "Spec.docx", url: "https://c.sharepoint.com/x", kind: "file" }]} onChange={vi.fn()} lang="en-US" acquireToken={acquire} onLog={onLog} />);
    fireEvent.click(screen.getByRole("button", { name: /remove link/i }));
    expect(onLog).toHaveBeenCalledWith("removed", "Spec.docx");
  });

  // §247/§248: the "Open in new tab" anchor carried NO name qualifier at all
  // (its aria-label was the bare verb), and the "Remove link" button was only
  // row-QUALIFIED (`${verb} – ${link.name}`) — both collide identically when
  // two links share a display name. Both now key off a shared token built
  // over `link.url` (the stable identity; two links CAN share a name but
  // never a url). Whole-document scope: the only other control is the
  // trailing "Add from SharePoint" button, which cannot collide with either
  // per-row name.
  //
  // Mutation-proved: anchor -> bare `t(lang,"documentsOpen")` gives "Open in new tab" x2.
  // Mutation-proved: Remove button -> old row-qualified-only shape gives "Remove link – Spec.docx" x2.
  it("keeps every per-row control distinct when two links share a display name", () => {
    const dupes: KnowledgeLink[] = [
      { id: "1", name: "Spec.docx", url: "https://c.sharepoint.com/a", kind: "file" },
      { id: "2", name: "Spec.docx", url: "https://c.sharepoint.com/b", kind: "file" },
    ];
    render(<KnowledgeLinksField value={dupes} onChange={vi.fn()} lang="en-US" acquireToken={acquire} />);
    // Measured (`expectRowUniqueNames` with minControls set high, then read the
    // printed list): 2 "Open in new tab" links + 2 "Remove link" buttons + 1
    // "Add from SharePoint" button = 5.
    expectRowUniqueNames({
      minControls: 5,
      roles: ["link", "button"],
      requireCollisionSeed: true,
    });
  });
});
