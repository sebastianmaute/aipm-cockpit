import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DocumentLinksField } from "./document-links-field";

const lookups = {
  task: new Map([[7, "Kickoff"]]),
  milestone: new Map<number, string>(),
  raid: new Map<number, string>(),
  change: new Map<number, string>(),
};
const candidates = [{ kind: "task" as const, id: 7, title: "Kickoff" }, { kind: "raid" as const, id: 3, title: "Vendor delay" }];

describe("DocumentLinksField", () => {
  it("renders a live reference with no dangling marker", () => {
    const { container } = render(
      <DocumentLinksField lang="en-US" refs={[{ kind: "task", id: 7 }]} lookups={lookups} candidates={candidates} onLink={vi.fn()} onUnlink={vi.fn()} onOpenEntity={vi.fn()} />,
    );
    expect(screen.getByText("Kickoff")).toBeInTheDocument();
    expect(container.querySelector("[data-dangling-marker]")).toBeNull();
  });

  it("renders a dangling reference with the tombstone label AND a non-colour marker", () => {
    const { container } = render(
      <DocumentLinksField lang="en-US" refs={[{ kind: "task", id: 99, label: "Deleted task" }]} lookups={lookups} candidates={candidates} onLink={vi.fn()} onUnlink={vi.fn()} onOpenEntity={vi.fn()} />,
    );
    expect(screen.getByText("Deleted task")).toBeInTheDocument();
    expect(container.querySelector("[data-dangling-marker]")).not.toBeNull();
  });

  it("prefers the LIVE title over a stale stored label", () => {
    render(
      <DocumentLinksField lang="en-US" refs={[{ kind: "task", id: 7, label: "Stale name" }]} lookups={lookups} candidates={candidates} onLink={vi.fn()} onUnlink={vi.fn()} onOpenEntity={vi.fn()} />,
    );
    expect(screen.getByText("Kickoff")).toBeInTheDocument();
    expect(screen.queryByText("Stale name")).toBeNull();
  });

  it("unlinks by (kind, id), not by id alone", async () => {
    const user = userEvent.setup();
    const onUnlink = vi.fn();
    render(
      <DocumentLinksField lang="en-US" refs={[{ kind: "task", id: 7 }, { kind: "raid", id: 7, label: "Vendor delay" }]} lookups={lookups} candidates={candidates} onLink={vi.fn()} onUnlink={onUnlink} onOpenEntity={vi.fn()} />,
    );
    // Exact name, not a loose /R#7/ regex: with click-through wired, the chip
    // BODY is also a button named "R#7 Vendor delay" (EntityLinkPicker's
    // onOpen branch), so a substring match would hit two buttons at once.
    // "Unlink R#7" (the terse onOpen-branch remove name) is unique.
    await user.click(screen.getByRole("button", { name: "Unlink R#7" }));
    expect(onUnlink).toHaveBeenCalledWith({ kind: "raid", id: 7 });
  });

  it("links with a tombstone label captured at attach time", async () => {
    const user = userEvent.setup();
    const onLink = vi.fn();
    render(
      <DocumentLinksField lang="en-US" refs={[]} lookups={lookups} candidates={candidates} onLink={onLink} onUnlink={vi.fn()} onOpenEntity={vi.fn()} />,
    );
    await user.type(screen.getByRole("combobox"), "Vendor");
    await user.click(screen.getByRole("option", { name: /Vendor delay/ }));
    expect(onLink).toHaveBeenCalledWith({ kind: "raid", id: 3, label: "Vendor delay" });
  });

  it("excludes already-linked candidates from the dropdown", async () => {
    const user = userEvent.setup();
    render(
      <DocumentLinksField lang="en-US" refs={[{ kind: "raid", id: 3 }]} lookups={lookups} candidates={candidates} onLink={vi.fn()} onUnlink={vi.fn()} onOpenEntity={vi.fn()} />,
    );
    await user.type(screen.getByRole("combobox"), "Vendor");
    expect(screen.queryByRole("option")).toBeNull();
  });
});
