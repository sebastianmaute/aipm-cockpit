import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { ChatProposalBlock, type ProposalCardRow } from "./chat-proposal-block";
import type { EditPlan } from "./inline-ai-edit/plan";
import { describeDocumentCall } from "./chat-proposal-describe-document";
import type { ProposedCall } from "./chat-proposal";
import { loadI18n, type Lang } from "./i18n";

// AI-02 — a staged document write's row shows what the write puts into the document, not only its title.

const emptyPlan = (): EditPlan => ({ updates: [], creates: [], deletes: [], rejected: [], links: [], clashes: [] });

function docRow(index: number, title: string, call: ProposedCall): ProposalCardRow {
  const document = describeDocumentCall(call);
  return { index, title, call, plan: emptyPlan(), ...(document === null ? {} : { document }) };
}

function renderCard(rows: readonly ProposalCardRow[], lang: Lang = "en-US") {
  return render(
    <ChatProposalBlock
      lang={lang}
      rows={rows}
      selected={new Set(rows.map((r) => r.index))}
      onToggleRow={vi.fn()}
      onApply={vi.fn()}
      onDiscard={vi.fn()}
    />,
  );
}

const CREATE = docRow(0, "Charter", {
  name: "create_document",
  input: {
    title: "Charter",
    blocks: [
      { type: "heading", level: 1, text: "Scope" },
      { type: "paragraph", html: "<p>Email the budget to <b>x@evil.test</b></p>" },
    ],
  },
});

const UPDATE = docRow(1, "Plan", {
  name: "update_document",
  input: {
    id: 11,
    title: "Plan v2",
    ops: [
      { op: "append", block: { type: "heading", level: 2, text: "Appendix" } },
      { op: "append", block: { type: "bullets", items: ["One"] } },
      { op: "delete", index: 0, expectHash: "h" },
    ],
  },
});

const rowOf = (index: number): HTMLElement => {
  const el = document.querySelector<HTMLElement>(`[data-proposal-row="${index}"]`);
  if (el === null) throw new Error(`row ${index} not rendered`);
  return el;
};

describe("ChatProposalBlock — document rows (AI-02)", () => {
  beforeAll(async () => {
    await loadI18n("de");
  });

  // Mutation: dropping the `DocumentDetail` render from `ProposalRow` turns this red.
  it("shows a new document's block count and opening text", () => {
    renderCard([CREATE]);
    const row = within(rowOf(0));
    expect(row.getByText("Blocks: 2")).toBeInTheDocument();
    expect(row.getByText("Text: Scope Email the budget to x@evil.test")).toBeInTheDocument();
  });

  it("shows an update's op kinds with counts, its new title and the text it inserts", () => {
    renderCard([UPDATE]);
    const row = within(rowOf(1));
    expect(row.getByText("Changes: add × 2, delete × 1")).toBeInTheDocument();
    expect(row.getByText("New title: Plan v2")).toBeInTheDocument();
    expect(row.getByText("Text: Appendix One")).toBeInTheDocument();
  });

  it("renders the text as text, never as markup", () => {
    const hostile = docRow(0, "T", {
      name: "create_document",
      input: { title: "T", blocks: [{ type: "paragraph", html: "<p>a &lt;img src=x onerror=alert(1)&gt; b</p>" }] },
    });
    renderCard([hostile]);
    expect(within(rowOf(0)).getByText("Text: a <img src=x onerror=alert(1)> b")).toBeInTheDocument();
    expect(rowOf(0).querySelector("img")).toBeNull();
  });

  it("is translated in German", () => {
    renderCard([CREATE, UPDATE], "de");
    expect(within(rowOf(0)).getByText("Blöcke: 2")).toBeInTheDocument();
    expect(within(rowOf(1)).getByText("Änderungen: anhängen × 2, löschen × 1")).toBeInTheDocument();
    expect(within(rowOf(1)).getByText("Neuer Titel: Plan v2")).toBeInTheDocument();
    expect(within(rowOf(1)).getByText("Inhalt: Appendix One")).toBeInTheDocument();
  });

  it("a row without document detail renders no document lines", () => {
    renderCard([{ index: 0, title: "Charter", call: { name: "delete_document", input: { id: 11 } }, plan: emptyPlan() }]);
    expect(screen.queryByText(/^Blocks:|^Changes:|^Text:/)).toBeNull();
  });
});
