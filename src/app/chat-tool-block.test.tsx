import { describe, it, expect, vi, beforeEach } from "vitest";
import { useEffect, useRef, type ReactNode } from "react";
import { render, screen, within } from "@testing-library/react";
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

/** The notices strip's two headings, spelled out rather than built from
 *  `t(...)`. Both end in a colon / a specific word order, and asserting the
 *  literal is what keeps a key swap inside the crowded `documents*` prefix
 *  from passing. */
const NOT_APPLIED = "Not applied:";

/** The notices strip CONTAINER, or null. Queried structurally because its mere
 *  PRESENCE is a claim — it carries a `border-t` rule, so an empty one draws a
 *  stray line across a perfectly successful card. A contents-only check cannot
 *  see that: an unconditionally-rendered empty strip has no text to find. */
function noticesStrip(): HTMLElement | null {
  return document.querySelector<HTMLElement>("[data-doc-notices]");
}

/** The rejection list, or null when no strip drew one. The card renders no
 *  other `<ul>`, so `role="list"` names this one unambiguously. */
function reasonList(): HTMLElement | null {
  return screen.queryByRole("list");
}

/** Reads the rendered rejection reasons. Asserting on this ARRAY rather than on
 *  the container's textContent is what stops a superstring passing: three
 *  reasons concatenated would satisfy `toHaveTextContent(oneOfThem)`, but a
 *  length + exact-string comparison cannot. */
function reasonTexts(): string[] {
  const list = reasonList();
  if (!list) return [];
  return within(list)
    .getAllByRole("listitem")
    .map((li) => li.textContent ?? "");
}

/** ★★ THE NEGATIVE CONTROL, and it is only worth anything because every test
 *  that calls it is paired with a positive one in the same describe that makes
 *  the SAME queries return something. On its own "no strip rendered" is
 *  satisfied by a component that rendered nothing at all — which is why each
 *  caller also asserts the card itself is present. */
function expectNoNotices() {
  // The CONTAINER first — the only assertion here that an empty-but-rendered
  // strip cannot satisfy.
  expect(noticesStrip()).toBeNull();
  expect(reasonList()).toBeNull();
  expect(screen.queryByText(NOT_APPLIED)).not.toBeInTheDocument();
  // Anchored: `/removed/` alone would also match a reason string that happens
  // to contain the word, and `"0 blocks removed"` must not render either.
  expect(screen.queryByText(/blocks? removed$/)).not.toBeInTheDocument();
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
      // the three fields it needs and takes `rejected`/`removed` as optional
      // extras (`applied` is for the model only and is never drawn). Empty
      // extras here — the disclosure they drive has its own describe below.
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

// ---------------------------------------------------------------------------
// What the write did NOT do. Before this, `update_document` returning
// `rejected`/`removed` rendered a CLEAN SUCCESS card: the refusal reached the
// model and never the person.
// ---------------------------------------------------------------------------
describe("ToolBlock — document card discloses rejections and removals", () => {
  const LIVE = [doc(4, "Steering deck", 12)];

  /** The real `DocumentUpdateResult` shape, serialized the way chat-panel does
   *  (`stringifyResult` = JSON.stringify(v, null, 2)). `extras` is typed
   *  loosely on purpose — the malformed cases below feed it values the real
   *  type forbids, which is exactly the input this guard exists for. */
  function renderUpdate(extras: Record<string, unknown>, documents = LIVE) {
    const result = JSON.stringify(
      { id: 4, title: "Steering deck", blockCount: 12, applied: 1, ...extras },
      null,
      2,
    );
    return renderTool("update_document", result, false, documents);
  }

  /** The card itself — asserted alongside every notices assertion so neither
   *  direction can pass by the component having rendered nothing. */
  function expectCard() {
    expect(screen.getByRole("button", { name: openName("Steering deck", 4) })).toBeInTheDocument();
  }

  it("lists every reason when part of the edit was refused", () => {
    renderUpdate({
      rejected: ["op 0: index 7 out of range", "op 1: unsupported block type"],
      removed: 0,
    });

    expectCard();
    // The same handle `expectNoNotices` asserts absent, proved present here —
    // so that negative control is checking something that can exist.
    expect(noticesStrip()).not.toBeNull();
    expect(screen.getByText(NOT_APPLIED)).toBeInTheDocument();
    // Length FIRST — a per-item `toContain` sweep over an empty list passes
    // vacuously. Exact strings, so a truncated or concatenated render fails.
    const reasons = reasonTexts();
    expect(reasons).toHaveLength(2);
    expect(reasons).toEqual(["op 0: index 7 out of range", "op 1: unsupported block type"]);
  });

  it("discloses a non-zero removal count", () => {
    renderUpdate({ rejected: [], removed: 9 });

    expectCard();
    expect(noticesStrip()).not.toBeNull();
    // Anchored on BOTH ends: `toHaveTextContent("9 blocks removed")` would pass
    // on "19 blocks removed", and an unanchored tail would pass on
    // "9 blocks removed from the appendix".
    expect(screen.getByText("9 blocks removed")).toBeInTheDocument();
    // A removal is not a rejection — the reasons heading must stay absent.
    expect(screen.queryByText(NOT_APPLIED)).not.toBeInTheDocument();
    expect(reasonList()).toBeNull();
  });

  it("uses the singular for exactly one removed block", () => {
    renderUpdate({ rejected: [], removed: 1 });

    expectCard();
    expect(screen.getByText("1 block removed")).toBeInTheDocument();
    // The plural template with {0} substituted would read "1 blocks removed".
    expect(screen.queryByText("1 blocks removed")).not.toBeInTheDocument();
  });

  it("shows both a removal count and the reasons together", () => {
    renderUpdate({ rejected: ["op 2: block index 99 out of range"], removed: 4 });

    expectCard();
    expect(screen.getByText("4 blocks removed")).toBeInTheDocument();
    expect(reasonTexts()).toEqual(["op 2: block index 99 out of range"]);
  });

  it("adds NO second live region — the transcript list is already one", () => {
    // chat-panel.tsx renders these blocks inside `<ul role="log"
    // aria-relevant="additions">`, so the strip is announced when the tool
    // block is appended. A `role="status"` here would announce it twice.
    // POSITIVE CONTROL FIRST: prove a strip actually rendered, or "no status
    // role" is trivially true.
    renderUpdate({ rejected: ["op 0: index 7 out of range"], removed: 3 });

    expect(reasonTexts()).toHaveLength(1);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("draws nothing at all for a clean success", () => {
    // The exact shape a fully-applied edit returns. This must look EXACTLY as
    // it did before the strip existed — an empty warning on every success is
    // how a user learns to ignore the one that matters.
    renderUpdate({ rejected: [], removed: 0 });

    expectCard();
    expect(screen.getByText("Steering deck")).toBeInTheDocument();
    expect(screen.getByText("12 Blocks")).toBeInTheDocument();
    expectNoNotices();
  });

  it("draws nothing when the extras are absent entirely (create_document)", () => {
    // create_document returns `{id, title, blockCount}` — no channel for
    // either field. Absent must be indistinguishable from empty.
    const result = JSON.stringify({ id: 4, title: "Steering deck", blockCount: 12 }, null, 2);
    renderTool("create_document", result, false, LIVE);

    expect(screen.getByRole("button", { name: openName("Steering deck", 4) })).toBeInTheDocument();
    expectNoNotices();
  });

  it("still discloses what it can when the document has since been deleted", () => {
    // What was refused is a fact about the CALL. A document deleted afterwards
    // does not un-refuse it, so the strip is independent of the live lookup.
    renderUpdate({ rejected: ["op 0: index 7 out of range"], removed: 2 }, []);

    expect(screen.getByRole("button", { name: openName("Steering deck", 4) })).toBeDisabled();
    expect(screen.getByText("2 blocks removed")).toBeInTheDocument();
    expect(reasonTexts()).toEqual(["op 0: index 7 out of range"]);
  });

  describe("a malformed extra degrades to 'not shown' — never a throw, never a lost card", () => {
    const cases: Array<[string, Record<string, unknown>]> = [
      ["rejected as a string", { rejected: "everything failed", removed: 0 }],
      ["rejected as an object", { rejected: { 0: "a" }, removed: 0 }],
      ["rejected as a number", { rejected: 3, removed: 0 }],
      ["rejected null", { rejected: null, removed: 0 }],
      ["rejected holding non-strings", { rejected: [1, 2, 3], removed: 0 }],
      ["rejected holding blanks only", { rejected: ["", "   "], removed: 0 }],
      ["removed as a string", { rejected: [], removed: "9" }],
      ["removed negative", { rejected: [], removed: -3 }],
      ["removed fractional", { rejected: [], removed: 2.5 }],
      ["removed null (a serialized NaN)", { rejected: [], removed: null }],
      ["removed as an object", { rejected: [], removed: { count: 9 } }],
      ["both malformed", { rejected: 7, removed: "many" }],
    ];

    it.each(cases)("%s", (_label, extras) => {
      renderUpdate(extras);
      // THE CARD SURVIVES — a bad extra must never cost the user the card its
      // three required fields earned.
      expectCard();
      expect(screen.getByText("Steering deck")).toBeInTheDocument();
      expectNoNotices();
    });

    it("keeps the readable reasons out of a MIXED array", () => {
      // Partial degradation, not total: showing two of three reasons discloses
      // more than showing none. Paired with the drop-everything cases above,
      // so neither behaviour can be mistaken for the other.
      renderUpdate({ rejected: ["op 0: index 7 out of range", 5, null, "op 2: bad block"], removed: 0 });

      expectCard();
      expect(reasonTexts()).toEqual(["op 0: index 7 out of range", "op 2: bad block"]);
    });
  });

  // -------------------------------------------------------------------------
  // ★★ The reason strings are MODEL-INFLUENCEABLE: document-mutations.ts builds
  // `op ${i}: unknown op ${JSON.stringify(op.op)}`, interpolating the model's own
  // value, and the model reads ingested PDF / SharePoint / Confluence content.
  // React escapes them (measured — `<img src=x onerror=…>` renders as text, so
  // this was never XSS), but uncapped they flooded the transcript: one 200 019-
  // character bullet from a single op, 5000 bullets / 133 890 characters from a
  // bogus batch.
  //
  // ★★★ THE VACUITY TRAP IN THIS DESCRIBE: a truncated string is a PREFIX of the
  // untruncated one, so every containment assertion — `toContain`,
  // `toHaveTextContent`, `stringContaining` — PASSES WITH THE CAP REMOVED.
  // Every assertion below is exact equality or an exact length. Both caps are
  // mutation-proved; do not relax one to a containment check.
  //
  // ★ The cap VALUES are spelled out here rather than imported. They are not
  // exported, and a cap test that reads its own expectation from the constant it
  // is testing can only ever prove self-consistency: change 120 to 4 and such a
  // test stays green while every reason turns to mush.
  // -------------------------------------------------------------------------
  describe("caps the attacker-influenceable reason text it renders", () => {
    const MAX_LEN = 120;
    const MAX_COUNT = 12;
    const ELLIPSIS = "…";

    /** N distinct, realistically-shaped reasons — distinct so an assertion on
     *  the array cannot be satisfied by the wrong slice of it. */
    const reasons = (n: number) =>
      Array.from({ length: n }, (_, i) => `op ${i}: unsupported block type`);

    it("leaves a reason exactly at the length cap untouched", () => {
      const atCap = `op 0: ${"x".repeat(MAX_LEN - 6)}`;
      expect(atCap).toHaveLength(MAX_LEN);
      renderUpdate({ rejected: [atCap], removed: 0 });

      expectCard();
      const shown = reasonTexts();
      expect(shown).toEqual([atCap]);
      // The boundary is `<=`, so nothing is marked here — an off-by-one cap
      // would append the marker to a string that fits.
      expect(shown[0]).not.toContain(ELLIPSIS);
    });

    it("truncates a reason one code unit over the cap", () => {
      const overCap = `op 0: ${"x".repeat(MAX_LEN - 5)}`;
      expect(overCap).toHaveLength(MAX_LEN + 1);
      renderUpdate({ rejected: [overCap], removed: 0 });

      expectCard();
      const shown = reasonTexts();
      // EXACT — `toContain(overCap.slice(0, MAX_LEN))` would pass on the
      // uncapped render, since the prefix is a substring of the whole.
      expect(shown).toEqual([`${overCap.slice(0, MAX_LEN)}${ELLIPSIS}`]);
      expect(shown[0]).toHaveLength(MAX_LEN + 1);
      expect(shown[0]).not.toBe(overCap);
    });

    it("truncates the measured 200 000-character flood to the cap", () => {
      // The exact shape the engine emits for an unknown op, with the model's
      // own value interpolated — the measured 200 019-character bullet.
      const flood = `op 0: unknown op ${JSON.stringify("A".repeat(200000))}`;
      expect(flood.length).toBeGreaterThan(200000);
      renderUpdate({ rejected: [flood], removed: 0 });

      expectCard();
      const shown = reasonTexts();
      expect(shown).toHaveLength(1);
      expect(shown[0]).toHaveLength(MAX_LEN + 1);
      expect(shown[0]).toBe(`${flood.slice(0, MAX_LEN)}${ELLIPSIS}`);
      // The whole strip, not just the one bullet — a cap that bounded the
      // string but rendered the raw value somewhere else would still flood.
      expect(noticesStrip()!.textContent!.length).toBeLessThan(500);
    });

    it("drops a whole astral character rather than splitting its surrogate pair", () => {
      // 119 ASCII + a 2-code-unit emoji: a naive `slice(0, 120)` cuts BETWEEN
      // the halves and keeps a lone high surrogate, which is not a character.
      const head = "a".repeat(MAX_LEN - 1);
      const reason = `${head}\u{1F600}${"z".repeat(50)}`;
      expect(reason.charCodeAt(MAX_LEN - 1)).toBeGreaterThanOrEqual(0xd800);
      renderUpdate({ rejected: [reason], removed: 0 });

      expectCard();
      const shown = reasonTexts();
      // Backed off by one: the emoji is gone WHOLE, so the result is one code
      // unit shorter than the over-cap case above.
      expect(shown).toEqual([`${head}${ELLIPSIS}`]);
      expect(shown[0]).toHaveLength(MAX_LEN);
      // Positive proof of the property itself, independent of the exact string:
      // no high surrogate unfollowed by a low one.
      expect(/[\ud800-\udbff](?![\udc00-\udfff])/.test(shown[0])).toBe(false);
    });

    it("leaves a list exactly at the count cap whole, with no marker", () => {
      const twelve = reasons(MAX_COUNT);
      renderUpdate({ rejected: twelve, removed: 0 });

      expectCard();
      // Exact array equality: no extra element, nothing reordered, nothing cut.
      expect(reasonTexts()).toEqual(twelve);
    });

    it("caps an over-long list and marks that it continues", () => {
      const thirty = reasons(30);
      renderUpdate({ rejected: thirty, removed: 0 });

      expectCard();
      const shown = reasonTexts();
      // 12 real reasons PLUS the marker bullet.
      expect(shown).toHaveLength(MAX_COUNT + 1);
      expect(shown).toEqual([...thirty.slice(0, MAX_COUNT), ELLIPSIS]);
      // The dropped ones are genuinely gone, not merely pushed down the list.
      expect(shown).not.toContain(thirty[MAX_COUNT]);
      expect(shown).not.toContain(thirty[29]);
    });

    it("bounds the measured 5000-reason flood", () => {
      const flood = Array.from(
        { length: 5000 },
        (_, i) => `op ${i}: unknown op ${JSON.stringify("A".repeat(200))}`,
      );
      renderUpdate({ rejected: flood, removed: 0 });

      expectCard();
      const shown = reasonTexts();
      expect(shown).toHaveLength(MAX_COUNT + 1);
      // BOTH caps at once: every kept reason is truncated AND the list is short.
      for (const line of shown.slice(0, MAX_COUNT)) {
        expect(line).toHaveLength(MAX_LEN + 1);
      }
      expect(shown[MAX_COUNT]).toBe(ELLIPSIS);
      // Measured uncapped at 133 890 characters.
      expect(noticesStrip()!.textContent!.length).toBeLessThan(2000);
    });

    it("spends the count budget on real reasons, not on junk entries", () => {
      // 20 dropped blanks + 5 real ones. Filtering runs FIRST, so the blanks
      // must not consume the budget real disclosure needs — a cap applied to
      // the RAW array would show nothing at all here.
      const real = reasons(5);
      renderUpdate({ rejected: [...Array.from({ length: 20 }, () => "   "), ...real], removed: 0 });

      expectCard();
      expect(reasonTexts()).toEqual(real);
    });

    it("still renders the card, and no marker, for a flood of junk entries", () => {
      // Malformed at scale: nothing survives the filter, so there is nothing to
      // cap and nothing to mark — and the card its three required fields earned
      // must survive regardless.
      renderUpdate({ rejected: Array.from({ length: 5000 }, (_, i) => i), removed: 0 });

      expectCard();
      expect(screen.getByText("Steering deck")).toBeInTheDocument();
      expectNoNotices();
    });

    it("caps nothing on an ordinary refusal", () => {
      // THE REGRESSION GUARD for every normal case: two short reasons render
      // verbatim, with no truncation marker and no extra bullet.
      const ordinary = ["op 0: index 7 out of range", "op 1: unsupported block type"];
      renderUpdate({ rejected: ordinary, removed: 3 });

      expectCard();
      expect(reasonTexts()).toEqual(ordinary);
      expect(screen.getByText("3 blocks removed")).toBeInTheDocument();
    });
  });
});
