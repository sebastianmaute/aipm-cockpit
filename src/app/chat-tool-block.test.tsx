import { describe, it, expect, vi, beforeEach } from "vitest";
import { useEffect, useRef } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ToolBlock } from "./chat-tool-block";
import { WorkspaceProvider, useWorkspace } from "./workspace-context";
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

function renderTool(
  name: string,
  result: string,
  error: boolean,
  documents: ProjectDocument[] = [],
) {
  return render(
    <FiltersProvider>
      <WorkspaceProvider>
        <SeedDocuments documents={documents} />
        <ToolBlock name={name} input={{}} result={result} error={error} lang="en-US" />
      </WorkspaceProvider>
    </FiltersProvider>,
  );
}

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
    expect(screen.getByRole("button", { name: "Download" })).toBeInTheDocument();
    // The plain block must NOT also be present — a card is a replacement, not
    // an addition.
    expect(screen.queryByText(/Used create_document/)).not.toBeInTheDocument();
  });

  it("falls back to the plain tool block for a non-document tool", () => {
    const result = JSON.stringify({ id: 4, title: "Steering deck", blockCount: 12 });
    renderTool("list_tasks", result, false);

    expectPlainToolBlock("list_tasks");
    expect(screen.queryByRole("button", { name: "Download" })).not.toBeInTheDocument();
    expect(screen.queryByText("Steering deck")).not.toBeInTheDocument();
  });

  it("renders no card when the tool errored", () => {
    const result = JSON.stringify({ id: 4, title: "Steering deck", blockCount: 12 });
    renderTool("create_document", result, true, [doc(4, "Steering deck", 12)]);

    expectPlainToolBlock("create_document");
    expect(screen.queryByRole("button", { name: "Download" })).not.toBeInTheDocument();
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
      expect(screen.queryByRole("button", { name: "Download" })).not.toBeInTheDocument();
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

  it("disables Download and falls back to the tool's own numbers when the document no longer exists", () => {
    const result = JSON.stringify({ id: 4, title: "Steering deck", blockCount: 12 });
    // No matching document seeded — e.g. it was deleted after the tool ran.
    renderTool("create_document", result, false, []);

    expect(screen.getByText("Steering deck")).toBeInTheDocument();
    expect(screen.getByText("12 Blocks")).toBeInTheDocument();
    const button = screen.getByRole("button", { name: "Download" });
    expect(button).toBeDisabled();
  });

  it("downloads the live document when Download is clicked", async () => {
    const user = userEvent.setup();
    const result = JSON.stringify({ id: 4, title: "Steering deck", blockCount: 12 });
    const seeded = doc(4, "Steering deck", 12);
    renderTool("create_document", result, false, [seeded]);

    await user.click(screen.getByRole("button", { name: "Download" }));

    expect(downloadDocument).toHaveBeenCalledTimes(1);
    const [calledDoc, calledFormat, , calledLang] = vi.mocked(downloadDocument).mock.calls[0];
    expect(calledDoc).toEqual(seeded);
    expect(calledFormat).toBe("docx");
    expect(calledLang).toBe("en-US");
  });
});
