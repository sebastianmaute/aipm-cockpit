import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { createRef } from "react";
import { DocumentsList, DOCUMENTS_COL_DEFAULTS } from "./documents-list";
import { t } from "./i18n";
import type { ProjectDocument } from "./document-model";

function doc(id: number, title: string): ProjectDocument {
  return { id, title, blocks: [], createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-02T00:00:00.000Z" };
}

function renderList(overrides: Partial<Parameters<typeof DocumentsList>[0]> = {}) {
  return render(
    <DocumentsList
      lang="en-US"
      documents={[]}
      selectedId={null}
      onSelect={vi.fn()}
      sortKey="title"
      sortDir="off"
      onSort={vi.fn()}
      colWidths={{ ...DOCUMENTS_COL_DEFAULTS }}
      onResize={vi.fn()}
      onRename={vi.fn()}
      onDuplicate={vi.fn()}
      onDelete={vi.fn()}
      onDownload={vi.fn()}
      onOpenHistory={vi.fn()}
      flashId={null}
      containerRef={createRef<HTMLDivElement>()}
      {...overrides}
    />,
  );
}

describe("DocumentsList — the empty-state create box", () => {
  it("offers the box when a create handler is supplied and the pane is writable", () => {
    renderList({ onCreate: vi.fn() });
    expect(
      screen.getByRole("button", { name: t("en-US", "documentsCreateFirst") }),
    ).toBeInTheDocument();
  });

  // ★★ THE CASE THE PANEL CANNOT REACH. A caller that threads `onCreate` while
  // the pane is read-only must still get the passive message — the component
  // does not trust its caller to have made that decision already.
  it("suppresses the box when read-only, even with a create handler threaded in", () => {
    renderList({ onCreate: vi.fn(), isReadOnly: true });
    expect(
      screen.queryByRole("button", { name: t("en-US", "documentsCreateFirst") }),
    ).toBeNull();
    // ★ Proves the empty branch actually rendered, so the absence above is
    // evidence about the guard rather than about a component that threw.
    expect(screen.getByText(t("en-US", "documentsNoneYet"))).toBeInTheDocument();
  });

  it("shows the passive message when no create handler is supplied", () => {
    renderList();
    expect(
      screen.queryByRole("button", { name: t("en-US", "documentsCreateFirst") }),
    ).toBeNull();
    expect(screen.getByText(t("en-US", "documentsNoneYet"))).toBeInTheDocument();
  });

  // ★ Guards the whole file against passing for the wrong reason: if the
  // populated branch ever stopped rendering, all three assertions above would
  // still hold vacuously.
  it("renders the table, not the box, once the register has a document", () => {
    renderList({ documents: [doc(1, "Alpha")], onCreate: vi.fn() });
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: t("en-US", "documentsCreateFirst") }),
    ).toBeNull();
  });
});

describe("DocumentsList — the open row's disclosure state", () => {
  it("marks the open document's title button expanded, and only that one", () => {
    renderList({ documents: [doc(1, "Alpha"), doc(2, "Beta")], selectedId: 1, collapsed: false });
    expect(screen.getByRole("button", { name: "Alpha" })).toHaveAttribute("aria-expanded", "true");
    // A row that is not open is not a disclosure at all — it must carry no
    // aria-expanded, rather than aria-expanded="false", which would announce
    // every closed row as a collapsed section.
    expect(screen.getByRole("button", { name: "Beta" })).not.toHaveAttribute("aria-expanded");
  });

  it("marks the open document's title button collapsed when the body is collapsed", () => {
    renderList({ documents: [doc(1, "Alpha")], selectedId: 1, collapsed: true });
    expect(screen.getByRole("button", { name: "Alpha" })).toHaveAttribute("aria-expanded", "false");
  });
});
