import { describe, it, expect, vi, beforeEach } from "vitest";
import { useEffect, useRef, type ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ToolBlock } from "./chat-tool-block";
import { WorkspaceProvider, useWorkspace } from "./workspace-context";
import { WorkspaceTabProvider, useWorkspaceTab } from "./workspace-tab-context";
import { FiltersProvider } from "./filters-context";
import type { ProjectDocument } from "./document-model";
import { downloadDocument } from "./document-download";

// The real one opens tabs / triggers Blob downloads — neither is meaningful in
// jsdom, and the module has its own suite (mirrors documents-panel.test.tsx's
// own mock of this same module for the same reason).
vi.mock("./document-download", () => ({ downloadDocument: vi.fn() }));

const NOW = "2026-08-07T00:00:00.000Z";

function doc(id: number, title: string, blockCount: number): ProjectDocument {
  return {
    id,
    title,
    blocks: Array.from({ length: blockCount }, () => ({ type: "pageBreak" as const })),
    createdAt: NOW,
    updatedAt: NOW,
  };
}

/** Seeds `documents` into the real WorkspaceProvider via its own setter — the
 *  same Seeder-effect shape test-providers.tsx uses for `tasks`. DocumentCard
 *  reads `useWorkspace()` directly (it is not prop-driven like DocumentsPanel),
 *  so a real provider + a real seed is the only way to put a "live document"
 *  in front of it. */
function SeedDocuments({ documents }: { documents: ProjectDocument[] }) {
  const { setDocuments } = useWorkspace();
  const seededRef = useRef(false);
  useEffect(() => {
    if (seededRef.current) return;
    seededRef.current = true;
    setDocuments(documents);
    // Seed once on mount; a `documents` prop change mid-test is not a
    // supported case for any of these tests.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

/** Reads the tab state the card's Open button drives. `requestOpen(view, id)`
 *  is the ONLY writer of both halves shown here (workspace-tab-context.tsx), so
 *  `documents:documents#4` is the observable form of "requestOpen was called
 *  with ("documents", 4)". A real provider rather than a `vi.mock` of the hook,
 *  matching knowledge-panel.test.tsx's own requestOpen assertion. */
function TabProbe() {
  const { activeTab, pendingOpen } = useWorkspaceTab();
  return (
    <div data-testid="tab-probe">
      {activeTab}:{pendingOpen ? `${pendingOpen.view}#${pendingOpen.id}` : "none"}
    </div>
  );
}

function renderTree(documents: ProjectDocument[], children: ReactNode) {
  return render(
    <FiltersProvider>
      <WorkspaceProvider>
        <WorkspaceTabProvider>
          <SeedDocuments documents={documents} />
          <TabProbe />
          {children}
        </WorkspaceTabProvider>
      </WorkspaceProvider>
    </FiltersProvider>,
  );
}

function renderTool(
  name: string,
  result: string,
  error: boolean,
  documents: ProjectDocument[] = [],
) {
  return renderTree(
    documents,
    <ToolBlock name={name} input={{}} result={result} error={error} lang="en-US" />,
  );
}

/** The card's two accessible names, spelled out rather than built from `t(...)`
 *  — the EN strings are pinned here on purpose. `documentsGoToDocument` ("Open
 *  in Documents") and `documentsOpen` ("Open in new tab") are different keys in
 *  the same `documents*` prefix, and only the first one means "navigate to the
 *  Documents view"; a `t(lang, key)` on both sides would let that swap through. */
const openName = (title: string, id: number) => `Open in Documents – ${title} · #${id}`;
const downloadName = (title: string, id: number) => `Download – ${title} · #${id}`;

/** Matches EITHER card action whatever its qualifier — so a "no card here"
 *  assertion still fails if a card renders, which an exact bare-verb name would
 *  no longer do now that both names are qualified. */
const ANY_CARD_ACTION = /^(Download|Open in Documents)/;

/** The plain tool block's OWN content — asserted in every fallback test as the
 *  positive observable that proves the component actually rendered something,
 *  not just that a card/button happens to be absent. A `queryByRole(...)`
 *  returning null is vacuous on its own: it passes just as well if ToolBlock
 *  rendered nothing at all. */
function expectPlainToolBlock(name: string) {
  expect(screen.getByText(new RegExp(`Used ${name}`))).toBeInTheDocument();
}

beforeEach(() => {
  vi.mocked(downloadDocument).mockClear();
});

describe("ToolBlock — document file card", () => {
  it("renders a document card for a document tool result", () => {
    const result = JSON.stringify({ id: 4, title: "Steering deck", blockCount: 12 });
    renderTool("create_document", result, false, [doc(4, "Steering deck", 12)]);

    expect(screen.getByText("Steering deck")).toBeInTheDocument();
    expect(screen.getByText("12 Blocks")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: downloadName("Steering deck", 4) })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: openName("Steering deck", 4) })).toBeInTheDocument();
    // The plain block must NOT also be present — a card is a replacement, not
    // an addition.
    expect(screen.queryByText(/Used create_document/)).not.toBeInTheDocument();
  });

  it("keeps each button's visible label at the head of its accessible name", () => {
    const result = JSON.stringify({ id: 4, title: "Steering deck", blockCount: 12 });
    renderTool("create_document", result, false, [doc(4, "Steering deck", 12)]);

    // WCAG 2.5.3 Label in Name: speech input says what it sees, so the visible
    // text must be a prefix of the accessible name — the qualifier is a
    // suffix, never a replacement.
    for (const visible of ["Download", "Open in Documents"]) {
      const button = screen.getByRole("button", { name: new RegExp(`^${visible} – `) });
      expect(button).toHaveTextContent(visible);
    }
  });

  it("falls back to the plain tool block for a non-document tool", () => {
    const result = JSON.stringify({ id: 4, title: "Steering deck", blockCount: 12 });
    renderTool("list_tasks", result, false);

    expectPlainToolBlock("list_tasks");
    expect(screen.queryByRole("button", { name: ANY_CARD_ACTION })).not.toBeInTheDocument();
    expect(screen.queryByText("Steering deck")).not.toBeInTheDocument();
  });

  it("renders no card when the tool errored", () => {
    const result = JSON.stringify({ id: 4, title: "Steering deck", blockCount: 12 });
    renderTool("create_document", result, true, [doc(4, "Steering deck", 12)]);

    expectPlainToolBlock("create_document");
    expect(screen.queryByRole("button", { name: ANY_CARD_ACTION })).not.toBeInTheDocument();
  });

  describe("malformed tool results fall back to the plain block, never throw", () => {
    const cases: Array<[string, string]> = [
      ["not JSON at all", "not json"],
      ["a bare number", "42"],
      ["a bare string", JSON.stringify("Steering deck")],
      ["a bare array (list_documents shape)", JSON.stringify([{ id: 1, title: "a", blockCount: 1 }])],
      ["null", "null"],
      ["missing id", JSON.stringify({ title: "x", blockCount: 1 })],
      ["missing title", JSON.stringify({ id: 1, blockCount: 1 })],
      ["missing blockCount", JSON.stringify({ id: 1, title: "x" })],
      ["id as a string", JSON.stringify({ id: "4", title: "x", blockCount: 1 })],
      ["id zero", JSON.stringify({ id: 0, title: "x", blockCount: 1 })],
      ["id negative", JSON.stringify({ id: -1, title: "x", blockCount: 1 })],
      ["id non-integer", JSON.stringify({ id: 1.5, title: "x", blockCount: 1 })],
      ["blank title", JSON.stringify({ id: 1, title: "   ", blockCount: 1 })],
      ["title as a number", JSON.stringify({ id: 1, title: 4, blockCount: 1 })],
      ["blockCount negative", JSON.stringify({ id: 1, title: "x", blockCount: -1 })],
      ["blockCount non-integer", JSON.stringify({ id: 1, title: "x", blockCount: 1.5 })],
      ["blockCount as a string", JSON.stringify({ id: 1, title: "x", blockCount: "1" })],
      // delete_document's plausible result: the id survives, nothing else does.
      ["delete_document shape", JSON.stringify({ id: 1, deleted: true })],
    ];

    it.each(cases)("%s", (_label, result) => {
      renderTool("update_document", result, false);
      expectPlainToolBlock("update_document");
      expect(screen.queryByRole("button", { name: ANY_CARD_ACTION })).not.toBeInTheDocument();
    });
  });

  // The shapes above are hypotheticals; these are the exact values the landed
  // dispatcher returns (use-document-tools.ts), rendered the way chat-panel
  // renders them — `stringifyResult` = JSON.stringify(value, null, 2).
  describe("the real dispatcher return shapes", () => {
    it("cards a create_document result", () => {
      const real = JSON.stringify({ id: 4, title: "Steering deck", blockCount: 12 }, null, 2);
      renderTool("create_document", real, false, [doc(4, "Steering deck", 12)]);
      expect(screen.getByRole("button", { name: openName("Steering deck", 4) })).toBeInTheDocument();
    });

    it("cards an update_document result despite its extra fields", () => {
      // DocumentUpdateResult is a SUPERSET of the card shape; the parser reads
      // the three fields it needs and ignores applied/rejected/removed.
      const real = JSON.stringify(
        { id: 4, title: "Steering deck", blockCount: 12, applied: 2, rejected: [], removed: 0 },
        null,
        2,
      );
      renderTool("update_document", real, false, [doc(4, "Steering deck", 12)]);
      expect(screen.getByRole("button", { name: openName("Steering deck", 4) })).toBeInTheDocument();
    });

    it("falls back for a list_documents result (an array of summaries)", () => {
      const real = JSON.stringify(
        [{ id: 4, title: "Steering deck", blockCount: 12, updatedAt: NOW }],
        null,
        2,
      );
      renderTool("list_documents", real, false, [doc(4, "Steering deck", 12)]);
      expectPlainToolBlock("list_documents");
      expect(screen.queryByRole("button", { name: ANY_CARD_ACTION })).not.toBeInTheDocument();
    });

    it("falls back for a delete_document result", () => {
      const real = JSON.stringify({ deleted: true, restorableVersionId: 9 }, null, 2);
      renderTool("delete_document", real, false, [doc(4, "Steering deck", 12)]);
      expectPlainToolBlock("delete_document");
      expect(screen.queryByRole("button", { name: ANY_CARD_ACTION })).not.toBeInTheDocument();
    });

    it("falls back for a get_document result (a whole ProjectDocument, no blockCount)", () => {
      const real = JSON.stringify(doc(4, "Steering deck", 12), null, 2);
      renderTool("get_document", real, false, [doc(4, "Steering deck", 12)]);
      expectPlainToolBlock("get_document");
      expect(screen.queryByRole("button", { name: ANY_CARD_ACTION })).not.toBeInTheDocument();
    });
  });

  it("prefers the LIVE document over a stale tool-result snapshot", () => {
    // The tool result is what create_document returned at call time; the
    // workspace has since moved on (a later edit in this same conversation).
    const result = JSON.stringify({ id: 4, title: "Steering deck", blockCount: 12 });
    renderTool("create_document", result, false, [doc(4, "Steering deck v2", 3)]);

    expect(screen.getByText("Steering deck v2")).toBeInTheDocument();
    expect(screen.getByText("3 Blocks")).toBeInTheDocument();
    expect(screen.queryByText("Steering deck")).not.toBeInTheDocument();
    expect(screen.queryByText("12 Blocks")).not.toBeInTheDocument();
  });

  it("disables both actions and falls back to the tool's own numbers when the document no longer exists", () => {
    const result = JSON.stringify({ id: 4, title: "Steering deck", blockCount: 12 });
    // No matching document seeded — e.g. it was deleted after the tool ran.
    renderTool("create_document", result, false, []);

    expect(screen.getByText("Steering deck")).toBeInTheDocument();
    expect(screen.getByText("12 Blocks")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: downloadName("Steering deck", 4) })).toBeDisabled();
    // Nothing for the Documents view to select on arrival, so Open would be a
    // false affordance.
    expect(screen.getByRole("button", { name: openName("Steering deck", 4) })).toBeDisabled();
  });

  it("downloads the live document when Download is clicked", async () => {
    const user = userEvent.setup();
    const result = JSON.stringify({ id: 4, title: "Steering deck", blockCount: 12 });
    const seeded = doc(4, "Steering deck", 12);
    renderTool("create_document", result, false, [seeded]);

    await user.click(screen.getByRole("button", { name: downloadName("Steering deck", 4) }));

    expect(downloadDocument).toHaveBeenCalledTimes(1);
    const [calledDoc, calledFormat, , calledLang] = vi.mocked(downloadDocument).mock.calls[0];
    expect(calledDoc).toEqual(seeded);
    expect(calledFormat).toBe("docx");
    expect(calledLang).toBe("en-US");
  });

  it("navigates to the Documents view with this document's id when Open is clicked", async () => {
    const user = userEvent.setup();
    const result = JSON.stringify({ id: 4, title: "Steering deck", blockCount: 12 });
    renderTool("create_document", result, false, [doc(4, "Steering deck", 12)]);

    // Positive proof the click had somewhere to go FROM — without this, a probe
    // reading "documents#4" could in principle have started there.
    expect(screen.getByTestId("tab-probe")).toHaveTextContent("dashboard:none");

    await user.click(screen.getByRole("button", { name: openName("Steering deck", 4) }));

    // requestOpen("documents", 4): the active tab AND the pendingOpen the
    // Documents panel consumes to select the row. Selecting that row is
    // documents-panel.tsx's half of the feature, not this card's.
    expect(screen.getByTestId("tab-probe")).toHaveTextContent("documents:documents#4");
  });

  it("gives every card in one transcript a unique name for both actions", () => {
    // DELIBERATELY THE SAME TITLE on both cards — the realistic collision (the
    // same document touched twice in one conversation, or two documents named
    // alike). Only the id can tell them apart.
    const result = (id: number) => JSON.stringify({ id, title: "Weekly report", blockCount: 3 });
    renderTree(
      [doc(4, "Weekly report", 3), doc(7, "Weekly report", 3)],
      <>
        <ToolBlock name="create_document" input={{}} result={result(4)} error={false} lang="en-US" />
        <ToolBlock name="update_document" input={{}} result={result(7)} error={false} lang="en-US" />
      </>,
    );

    const names = screen
      .getAllByRole("button", { name: ANY_CARD_ACTION })
      .map((b) => b.getAttribute("aria-label"));
    // ★★ NON-ZERO FIRST. `new Set(names).size === names.length` is trivially
    // true for an empty list, so the uniqueness assertion below is vacuous
    // unless the count is pinned: two cards × two actions.
    expect(names).toHaveLength(4);
    expect(new Set(names).size).toBe(4);
  });
});
