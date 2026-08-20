import { useState } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DocumentEditor } from "./document-editor";
import { ConfirmProvider } from "./confirm-dialog";
import { t } from "./i18n";
import type { DocBlock, ProjectDocument } from "./document-model";
import { htmlTextLength } from "./rich-text-plain";

const LANG = "en-US" as const;

/** A fresh set of structural spies per render. `structural` is REQUIRED on
 *  `DocumentEditorProps` — a wiring regression that drops it would otherwise
 *  remove every structural control with nothing failing — so the many fixtures
 *  here that never exercise it still have to supply one. FRESH rather than a
 *  shared module-level object: a shared spy accumulates calls across tests and
 *  a "was not called" assertion then depends on file order. */
const stubStructural = () => ({ insert: vi.fn(), remove: vi.fn(), move: vi.fn() });

/** The heading editor's accessible names, 0-based block index in, en-dash
 *  qualified name out. Spelled once so a convention change is one edit. */
const headingTextName = (index: number) =>
  `${t(LANG, "documentsHeadingText")} – ${t(LANG, "documentsBlockN", String(index + 1))}`;

const doc: ProjectDocument = {
  id: 7,
  title: "Status report",
  blocks: [
    { type: "heading", level: 1, text: "Summary" },
    { type: "paragraph", html: "<p>All good</p>" },
    { type: "pageBreak" },
  ],
  createdAt: "2026-08-18T10:00:00.000Z",
  updatedAt: "2026-08-18T10:00:00.000Z",
};

describe("DocumentEditor", () => {
  it("renders one row per block, including blocks with no editor", () => {
    render(<DocumentEditor lang={LANG} structural={stubStructural()} doc={doc} onCommitBlock={vi.fn()} />);
    expect(screen.getByText(t(LANG, "documentsBlockHeading"))).toBeInTheDocument();
    expect(screen.getByText(t(LANG, "documentsBlockParagraph"))).toBeInTheDocument();
    // The page break is still listed — a block that vanishes reads as data loss.
    expect(screen.getByText(t(LANG, "documentsBlockPageBreak"))).toBeInTheDocument();
  });

  it("passes the block INDEX through to the commit handler", async () => {
    const onCommitBlock = vi.fn();
    render(<DocumentEditor lang={LANG} structural={stubStructural()} doc={doc} onCommitBlock={onCommitBlock} />);
    const text = screen.getByRole("textbox", { name: headingTextName(0) });
    await userEvent.type(text, "!");
    text.blur();
    expect(onCommitBlock).toHaveBeenCalledWith(0, expect.objectContaining({ type: "heading" }), expect.anything());
  });

  // ★★★ REVERSES an S3b test that asserted NO drag handle exists ("a handle
  //  that does nothing is worse than no handle"). It does something now, so
  //  the assertion is the positive one — and it is ROW-UNIQUE, which is the
  //  half no gate can check: axe 4.12.1 has no rule under the four tags
  //  e2e/a11y.spec.ts requests that flags two controls sharing an accessible
  //  name, at any seed size. A fixture with several rows is the only detector.
  it("gives every row a block-unique reorder handle", () => {
    render(<DocumentEditor lang={LANG} structural={stubStructural()} doc={doc} onCommitBlock={vi.fn()} />);
    const names = screen
      .getAllByRole("button", { name: new RegExp(t(LANG, "documentsBlockReorder")) })
      .map((b) => b.getAttribute("aria-label"));
    expect(names).toEqual([
      `${t(LANG, "documentsBlockReorder")} – ${t(LANG, "documentsBlockN", "1")}`,
      `${t(LANG, "documentsBlockReorder")} – ${t(LANG, "documentsBlockN", "2")}`,
      `${t(LANG, "documentsBlockReorder")} – ${t(LANG, "documentsBlockN", "3")}`,
    ]);
    expect(new Set(names).size).toBe(names.length);
  });

  describe("at a narrow pane", () => {
    // ★★★ THREE BLOCKS, TWO OF THEM PARAGRAPHS. With a single-paragraph
    //  fixture the toolbar count is satisfied by the WIDE branch as well —
    //  one paragraph mounts one editor and therefore one toolbar either way —
    //  so it passed with the narrow branch deleted outright. A count
    //  assertion needs a fixture in which the two branches DISAGREE. The
    //  leading heading also keeps the first PARAGRAPH off block index 0, so a
    //  selection compared against the block's own index cannot pass by luck.
    const threeBlocks: ProjectDocument = {
      ...doc,
      blocks: [
        { type: "heading", level: 1, text: "Summary" },
        { type: "paragraph", html: "<p>First</p>" },
        { type: "paragraph", html: "<p>Second</p>" },
      ],
    };

    it("docks ONE toolbar instead of one per block", () => {
      const { rerender } = render(
        <DocumentEditor lang={LANG} structural={stubStructural()} doc={threeBlocks} onCommitBlock={vi.fn()} narrow />,
      );
      // jsdom has no layout, so the narrow branch is driven by an injected
      // flag, never by a measured width.
      expect(screen.getAllByRole("toolbar")).toHaveLength(1);
      // The wide branch is what proves the fixture can tell the two apart.
      rerender(<DocumentEditor lang={LANG} structural={stubStructural()} doc={threeBlocks} onCommitBlock={vi.fn()} />);
      expect(screen.getAllByRole("toolbar")).toHaveLength(2);
    });

    // ★★ THE DOCK IS ABOVE THE DOCUMENT, which is both the spec's wording and
    //  what keeps the portal from breaking Tab: content moved BELOW its
    //  logical position is the recorded failure mode.
    it("renders the docked toolbar before the block list in DOM order", () => {
      const { container } = render(
        <DocumentEditor lang={LANG} structural={stubStructural()} doc={threeBlocks} onCommitBlock={vi.fn()} narrow />,
      );
      const toolbar = screen.getByRole("toolbar");
      const firstRow = container.querySelectorAll("[data-block-row]")[0];
      expect(toolbar.compareDocumentPosition(firstRow)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    });

    // ★★★ THE SILENT COLLAPSE WAS THE DEFECT, not the collapse itself. An
    //  unselected paragraph rendering read-only with no reason and no way back
    //  is the "disabled control with no reason reads as broken" failure this
    //  slice states two files away for the image case.
    it("says why an unselected paragraph is read-only, and offers a way in", async () => {
      render(<DocumentEditor lang={LANG} structural={stubStructural()} doc={threeBlocks} onCommitBlock={vi.fn()} narrow />);
      expect(screen.getByText(t(LANG, "documentsBlockCollapsedNarrow"))).toBeInTheDocument();
      const select = screen.getByRole("button", {
        name: `${t(LANG, "documentsBlockSelect")} – ${t(LANG, "documentsBlockN", "3")}`,
      });
      await userEvent.click(select);
      // Selection MOVED: the second paragraph is now live and the first is not.
      expect(
        screen.getByRole("textbox", { name: t(LANG, "documentsParagraphLabel", "3") }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("textbox", { name: t(LANG, "documentsParagraphLabel", "2") }),
      ).toBeNull();
    });

    // ★★★ BLOCK-UNIQUE NAMES. Two "Edit this block" buttons sharing one
    //  accessible name is a WCAG 2.4.6 failure NO axe rule under the four tags
    //  e2e/a11y.spec.ts requests can see, at any seed size — a unit test
    //  rendering two of them is the only detector that can exist. The two
    //  paragraphs above cannot express it (only ONE is ever unselected), so
    //  this fixture carries three.
    it("gives each unselected paragraph a block-unique select button", () => {
      const fourBlocks: ProjectDocument = {
        ...doc,
        blocks: [
          { type: "heading", level: 1, text: "Summary" },
          { type: "paragraph", html: "<p>First</p>" },
          { type: "paragraph", html: "<p>Second</p>" },
          { type: "paragraph", html: "<p>Third</p>" },
        ],
      };
      render(<DocumentEditor lang={LANG} structural={stubStructural()} doc={fourBlocks} onCommitBlock={vi.fn()} narrow />);
      const names = screen
        .getAllByRole("button", { name: new RegExp(t(LANG, "documentsBlockSelect")) })
        .map((b) => b.getAttribute("aria-label"));
      expect(names).toEqual([
        `${t(LANG, "documentsBlockSelect")} – ${t(LANG, "documentsBlockN", "3")}`,
        `${t(LANG, "documentsBlockSelect")} – ${t(LANG, "documentsBlockN", "4")}`,
      ]);
      expect(new Set(names).size).toBe(names.length);
    });

    // ★★★ THE IMAGE BUG. `firstParagraphIndex` had no image test, so a first
    //  paragraph holding one made ParagraphBlockEditor return its read-only
    //  notice and left the document with NO editable paragraph anywhere.
    it("leaves another paragraph reachable when the first holds an image", async () => {
      const withImage: ProjectDocument = {
        ...doc,
        blocks: [
          { type: "paragraph", html: '<p>Chart</p><img data-asset-id="a1" alt="chart">' },
          { type: "paragraph", html: "<p>Editable</p>" },
        ],
      };
      render(<DocumentEditor lang={LANG} structural={stubStructural()} doc={withImage} onCommitBlock={vi.fn()} narrow />);
      const select = screen.getByRole("button", {
        name: `${t(LANG, "documentsBlockSelect")} – ${t(LANG, "documentsBlockN", "2")}`,
      });
      // ★★ REACHABLE means the click WORKS, not merely that a button is drawn.
      //  Asserting only its presence leaves the test green with the selection
      //  state dropped (`selected` pinned to the first paragraph) — measured:
      //  that mutant killed the sibling test and survived this one.
      await userEvent.click(select);
      expect(
        screen.getByRole("textbox", { name: t(LANG, "documentsParagraphLabel", "2") }),
      ).toBeInTheDocument();
    });

    // Non-paragraph editors carry no rich toolbar, so there is nothing to dock
    // and nothing to crowd — they stay live at every width.
    it("leaves non-paragraph editors live", () => {
      render(<DocumentEditor lang={LANG} structural={stubStructural()} doc={threeBlocks} onCommitBlock={vi.fn()} narrow />);
      expect(screen.getByRole("textbox", { name: headingTextName(0) })).toBeEnabled();
    });
  });

  // ★ `doc` above has its ONE paragraph as the first-in-document — the exact
  //  block the narrow branch does NOT collapse — so no existing test reaches
  //  the collapsed render's own `sanitizeDocumentHtml` sink. This fixture
  //  carries a SECOND paragraph so it collapses, and asserts on the rendered
  //  DOM (not the input string): the image survives, the script does not.
  it("sanitizes a collapsed paragraph's stored html at the render sink — keeps the image, drops the script", () => {
    const twoParagraphDoc: ProjectDocument = {
      id: 8,
      title: "Two paragraphs",
      blocks: [
        { type: "paragraph", html: "<p>First</p>" },
        {
          // ★ `src` is NOT on `DOCUMENT_ALLOWED_ATTR` (sanitize-html.ts) —
          //  an image is referenced by `data-asset-id`, not a URL, since the
          //  asset store this feeds is inert until S3c. `alt` and
          //  `data-asset-id` are what a sanitized `<img>` can carry.
          type: "paragraph",
          html: '<p>Second</p><img data-asset-id="a1" alt="chart"><script>alert(1)</script>',
        },
      ],
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    };
    const { container } = render(
      <DocumentEditor lang={LANG} structural={stubStructural()} doc={twoParagraphDoc} onCommitBlock={vi.fn()} narrow />,
    );
    // Only the SECOND paragraph collapses (the first keeps its live editor),
    // so its rendered image and dropped script are unambiguous either way.
    const images = container.querySelectorAll("img");
    expect(images).toHaveLength(1);
    expect(images[0].getAttribute("alt")).toBe("chart");
    expect(images[0].getAttribute("data-asset-id")).toBe("a1");
    expect(container.querySelector("script")).toBeNull();
  });

  // ★★★ Pins the doc-id-keyed row fix directly: two documents each carry a
  //  same-type (heading) block at index 0, so BEFORE the fix React would
  //  reuse the SAME BlockEditor instance across the switch (same position,
  //  same type) and go on showing document A's stale draft.
  describe("switching the selected document while edit mode is open", () => {
    const docA: ProjectDocument = {
      id: 201,
      title: "Doc A",
      blocks: [{ type: "heading", level: 1, text: "Alpha" }],
      createdAt: "2026-08-18T10:00:00.000Z",
      updatedAt: "2026-08-18T10:00:00.000Z",
    };
    const docB: ProjectDocument = {
      id: 202,
      title: "Doc B",
      blocks: [{ type: "heading", level: 1, text: "Beta" }],
      createdAt: "2026-08-18T10:00:00.000Z",
      updatedAt: "2026-08-18T10:00:00.000Z",
    };

    it("shows the new document's content, not the old one's, and commits nothing on an untouched switch", () => {
      const onCommitBlock = vi.fn();
      const { rerender } = render(<DocumentEditor lang={LANG} structural={stubStructural()} doc={docA} onCommitBlock={onCommitBlock} />);
      const textBefore = screen.getByRole("textbox", { name: headingTextName(0) });
      expect(textBefore).toHaveValue("Alpha");

      rerender(<DocumentEditor lang={LANG} structural={stubStructural()} doc={docB} onCommitBlock={onCommitBlock} />);
      const textAfter = screen.getByRole("textbox", { name: headingTextName(0) });
      expect(textAfter).toHaveValue("Beta");
      expect(textAfter).not.toBe(textBefore); // a NEW element — the row really remounted

      textAfter.focus();
      textAfter.blur();
      expect(onCommitBlock).not.toHaveBeenCalled();
    });

    it("does not carry an unblurred edit from the old document into the DOM after a switch", async () => {
      const onCommitBlock = vi.fn();
      const { rerender } = render(<DocumentEditor lang={LANG} structural={stubStructural()} doc={docA} onCommitBlock={onCommitBlock} />);
      const text = screen.getByRole("textbox", { name: headingTextName(0) });
      await userEvent.type(text, "!"); // dirty, unblurred

      rerender(<DocumentEditor lang={LANG} structural={stubStructural()} doc={docB} onCommitBlock={onCommitBlock} />);
      // The remounted field reflects B's stored content, never the stray "!".
      expect(screen.getByRole("textbox", { name: headingTextName(0) })).toHaveValue("Beta");
    });
  });

  describe("a document with no blocks", () => {
    const empty: ProjectDocument = {
      id: 11,
      title: "Empty",
      blocks: [],
      createdAt: "2026-08-18T10:00:00.000Z",
      updatedAt: "2026-08-18T10:00:00.000Z",
    };

    // ★★ An empty <div> with no message and no affordance reads as broken — the
    //  same principle this slice states for the image case and for the collapsed
    //  narrow-pane paragraph.
    it("says the document has no blocks yet", () => {
      render(
        <DocumentEditor lang={LANG} structural={stubStructural()} doc={empty} onCommitBlock={vi.fn()} />,
      );
      expect(screen.getByText(t(LANG, "documentsNoBlocks"))).toBeInTheDocument();
    });

    // ★★★ THE FIRST BLOCK CARRIES SEEDED TEXT, NOT AN EMPTY ONE.
    //  document-model.ts drops a paragraph whose visible text length is 0, so an
    //  empty seed would create a block that renders now and is GONE on the next
    //  load — the exact failure Task 7 of this round exists to prevent.
    //  ★★ It goes through `structural.insert(0, …)`, NOT a prop of its own. The
    //   empty state is the ONLY path into a zero-block document, so routing it
    //   through the optional `onAppendBlock` it used to have meant a wiring
    //   regression could leave an empty document permanently uneditable with the
    //   menu still rendering, and nothing — not tsc, not this suite — would say
    //   so. `structural` is required, so that shape is now a type error.
    it("inserts a first paragraph carrying real text at index 0", async () => {
      const structural = stubStructural();
      render(
        <DocumentEditor lang={LANG} structural={structural} doc={empty} onCommitBlock={vi.fn()} />,
      );
      await userEvent.click(screen.getByRole("button", { name: t(LANG, "documentsAddBlock") }));
      await userEvent.click(screen.getByRole("button", { name: t(LANG, "documentsBlockParagraph") }));
      expect(structural.insert).toHaveBeenCalledTimes(1);
      const [at, block] = structural.insert.mock.calls[0] as [number, { type: string; html: string }];
      expect(at).toBe(0);
      expect(block.type).toBe("paragraph");
      expect(htmlTextLength(block.html)).toBeGreaterThan(0);
      expect(block.html).toContain(t(LANG, "documentsNewBlockText"));
    });

    // ★★ THE EMPTY STATE OFFERS EVERY KIND, not just a paragraph. Starting a
    //  document with a heading is the obvious first move, and the old
    //  paragraph-only button made it a two-step one.
    it("offers every addable kind from the empty state", async () => {
      render(
        <DocumentEditor lang={LANG} structural={stubStructural()} doc={empty} onCommitBlock={vi.fn()} />,
      );
      await userEvent.click(screen.getByRole("button", { name: t(LANG, "documentsAddBlock") }));
      const menu = screen.getByRole("dialog", { name: t(LANG, "documentsAddBlock") });
      expect(within(menu).getAllByRole("button")).toHaveLength(6);
    });

    // ★★★ REVERSES an S3b test asserting NO add-block control exists once the
    //  document has a block ("a general add-block affordance is the structural
    //  slice"). This IS that slice. The count matters as much as the presence:
    //  the empty state's menu and the trailing one are mutually exclusive, so
    //  two controls sharing the name "Add a block" would be a WCAG 2.4.6
    //  failure no axe rule can see.
    it("renders exactly ONE add-block control once the document has a block", () => {
      render(<DocumentEditor lang={LANG} structural={stubStructural()} doc={doc} onCommitBlock={vi.fn()} />);
      expect(screen.getAllByRole("button", { name: t(LANG, "documentsAddBlock") })).toHaveLength(1);
      expect(screen.queryByText(t(LANG, "documentsNoBlocks"))).toBeNull();
    });
  });
});

// ★★★ THE STRUCTURAL SLICE. Every assertion here is against the `structural`
//  bag, never against a re-rendered list: `DocumentEditor` is controlled — it
//  owns no blocks — so the ops it EMITS are the whole of its contract. The
//  engine's own arithmetic is pinned in document-ops.test.ts.
describe("DocumentEditor — structural editing", () => {
  const structDoc: ProjectDocument = {
    id: 31,
    title: "Doc",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    blocks: [
      { type: "heading", level: 1, text: "One" },
      { type: "paragraph", html: "<p>Two</p>" },
      { type: "pageBreak" },
    ],
  };

  const reorderName = (index: number) =>
    `${t(LANG, "documentsBlockReorder")} – ${t(LANG, "documentsBlockN", String(index + 1))}`;
  const actionsName = (index: number) =>
    `${t(LANG, "documentsBlockActions")} – ${t(LANG, "documentsBlockN", String(index + 1))}`;

  function setup() {
    const structural = stubStructural();
    render(
      <DocumentEditor
        lang={LANG}
        doc={structDoc}
        onCommitBlock={vi.fn()}
        structural={structural}
      />,
    );
    return { structural };
  }

  /** Same fixture inside a real `ConfirmProvider`. Without one `useConfirm()`
   *  resolves FALSE by default, so an unwrapped render can only ever exercise
   *  the cancel branch — and a "confirm was honoured" test would be vacuous. */
  function setupConfirmable() {
    const structural = stubStructural();
    render(
      <ConfirmProvider lang={LANG}>
        <DocumentEditor
          lang={LANG}
          doc={structDoc}
          onCommitBlock={vi.fn()}
          structural={structural}
        />
      </ConfirmProvider>,
    );
    return { structural };
  }

  /** Open a row's actions menu and return the panel. */
  async function openActions(user: ReturnType<typeof userEvent.setup>, index: number) {
    await user.click(screen.getByRole("button", { name: actionsName(index) }));
    return screen.getByRole("dialog", { name: actionsName(index) });
  }

  it("moves a block down when ArrowDown is pressed on its handle", async () => {
    const user = userEvent.setup();
    const { structural } = setup();
    screen.getByRole("button", { name: reorderName(0) }).focus();
    await user.keyboard("{ArrowDown}");
    // ★ The third argument is the baseline the engine's `expect` precondition
    //  checks — the block the user picked up, not the one now at that index.
    expect(structural.move).toHaveBeenCalledWith(0, 1, structDoc.blocks[0]);
  });

  it("moves a block up when ArrowUp is pressed on its handle", async () => {
    const user = userEvent.setup();
    const { structural } = setup();
    screen.getByRole("button", { name: reorderName(2) }).focus();
    await user.keyboard("{ArrowUp}");
    expect(structural.move).toHaveBeenCalledWith(2, 1, structDoc.blocks[2]);
  });

  /** ★★★ A CONTROLLED PARENT THAT ACTUALLY REORDERS, and the ONLY fixture in
   *  this file that can express the defect the two tests below pin. Every
   *  other fixture here holds `doc` STATIC, so nothing re-renders after a move
   *  and the focused grip stays on the row it started on WHETHER OR NOT focus
   *  follows the block — a second ArrowDown then reads as a correct second
   *  move either way. Only a parent that re-renders in the NEW order can tell
   *  "the block moved twice" from "the same pair toggled".
   *  ★ `structural` is rebuilt every render deliberately: `DocumentEditor`
   *   calls its members from event handlers and never as a hook dependency, so
   *   a stable identity would buy nothing here and would hide the re-render
   *   this fixture exists to produce. */
  function Controlled({ onMoveSpy }: { onMoveSpy: (from: number, to: number) => void }) {
    const [blocks, setBlocks] = useState<readonly DocBlock[]>(structDoc.blocks);
    return (
      <DocumentEditor
        lang={LANG}
        doc={{ ...structDoc, blocks }}
        onCommitBlock={vi.fn()}
        structural={{
          insert: vi.fn(),
          remove: vi.fn(),
          move: (from: number, to: number) => {
            onMoveSpy(from, to);
            setBlocks((prev) => {
              const next = [...prev];
              const [moved] = next.splice(from, 1);
              next.splice(to, 0, moved);
              return next;
            });
            return undefined;
          },
        }}
      />
    );
  }

  /** The kind chip of every row, in DOM order — the only observable this
   *  component offers for "which block sits where" (it is controlled and owns
   *  no list, so the emitted ops are the rest of its contract). */
  const kindOrder = () =>
    Array.from(document.querySelectorAll("[data-block-row]")).map(
      (row) => row.querySelector("span")?.textContent ?? "",
    );

  // ★★★ THE ARROW KEYS USED TO TOGGLE, NOT MOVE. The rows are index-keyed, so a
  //  move leaves the key SET unchanged and React reconciles IN PLACE — without
  //  focus following the block, the grip that had focus still belongs to row
  //  `from`, which now holds whatever was displaced. On [heading, paragraph,
  //  pageBreak] that made press 1 emit move(0,1) and press 2 emit move(0,1)
  //  AGAIN, putting the list straight back: no block could travel more than one
  //  position by keyboard, and native HTML5 drag does not fire on touch, so for
  //  a touch or keyboard user that was the whole feature.
  //  ★ Every pre-existing reorder test in this file presses ArrowDown exactly
  //   ONCE, which is why this shipped.
  it("moves a block TWO positions on two ArrowDown presses", async () => {
    const user = userEvent.setup();
    const onMoveSpy = vi.fn();
    render(<Controlled onMoveSpy={onMoveSpy} />);
    expect(kindOrder()).toEqual([
      t(LANG, "documentsBlockHeading"),
      t(LANG, "documentsBlockParagraph"),
      t(LANG, "documentsBlockPageBreak"),
    ]);

    screen.getByRole("button", { name: reorderName(0) }).focus();
    await user.keyboard("{ArrowDown}");
    await user.keyboard("{ArrowDown}");

    // The SECOND call is the one the defect got wrong — it emitted (0, 1) again.
    expect(onMoveSpy.mock.calls).toEqual([
      [0, 1],
      [1, 2],
    ]);
    expect(kindOrder()).toEqual([
      t(LANG, "documentsBlockParagraph"),
      t(LANG, "documentsBlockPageBreak"),
      t(LANG, "documentsBlockHeading"),
    ]);
  });

  // ★★ THE HALF THAT ACTUALLY PINS THE FIX. The grip labels are POSITIONAL
  //  (`Reorder – Block N` is built from the row index, not the block), so this
  //  asserts focus sits on row 1's grip — where the moved block now is —
  //  rather than on row 0's, where it started. Deleting the focus effect in
  //  document-editor.tsx turns this red on its own.
  it("moves focus onto the grip of the block that just moved", async () => {
    const user = userEvent.setup();
    render(<Controlled onMoveSpy={vi.fn()} />);
    const first = screen.getByRole("button", { name: reorderName(0) });
    first.focus();
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: reorderName(1) }));
    expect(document.activeElement).not.toBe(first);
  });

  it("does not move the first block up", async () => {
    const user = userEvent.setup();
    const { structural } = setup();
    screen.getByRole("button", { name: reorderName(0) }).focus();
    await user.keyboard("{ArrowUp}");
    expect(structural.move).not.toHaveBeenCalled();
  });

  it("does not move the last block down", async () => {
    const user = userEvent.setup();
    const { structural } = setup();
    screen.getByRole("button", { name: reorderName(2) }).focus();
    await user.keyboard("{ArrowDown}");
    expect(structural.move).not.toHaveBeenCalled();
  });

  // ★★★ Firefox will not START a drag unless `dragstart` sets transfer data.
  //  The payload is never read back — the reorder uses the hook's own state —
  //  so reorder is simply DEAD there with no other symptom, and jsdom
  //  dispatches the whole sequence regardless. Three of the primitive's four
  //  original call sites shipped without it. Only a spy can catch its absence.
  it("sets drag transfer data on dragstart", () => {
    setup();
    const setData = vi.fn();
    fireEvent.dragStart(screen.getByRole("button", { name: reorderName(0) }), {
      dataTransfer: { setData, effectAllowed: "" },
    });
    expect(setData).toHaveBeenCalled();
  });

  // ★★ THE ROW IS THE DROP TARGET, not the grip. A gesture releasable only
  //  over a 24px grip is one nobody can complete, and `itemProps` spread on
  //  the wrong element fails silently — the drop just does nothing.
  it("reorders on a drop anywhere in the target row", () => {
    const { structural } = setup();
    const rows = document.querySelectorAll("[data-block-row]");
    fireEvent.dragStart(screen.getByRole("button", { name: reorderName(0) }), {
      dataTransfer: { setData: vi.fn(), effectAllowed: "" },
    });
    fireEvent.dragOver(rows[2]);
    fireEvent.drop(rows[2]);
    expect(structural.move).toHaveBeenCalledWith(0, 2, structDoc.blocks[0]);
  });

  // ★★★ A DROP WITH NO DRAG IN FLIGHT MUST REORDER NOTHING. `dragId` is an
  //  INDEX here, so a stale one does not merely repeat the last move — it
  //  names whichever block now sits at that position, and the user picked up
  //  none of them. This is what the hook's `endDrag` (called from its own
  //  `onDrop`, and by `onDragEnd` on the grip) exists to guarantee; the rows
  //  are keyed by the same indices the reorder uses, so a move re-renders them
  //  IN PLACE and the grip survives to receive its `dragend`.
  it("does not reorder on a drop when no drag is in flight", () => {
    const { structural } = setup();
    const rows = document.querySelectorAll("[data-block-row]");
    const handle = screen.getByRole("button", { name: reorderName(0) });
    fireEvent.dragStart(handle, { dataTransfer: { setData: vi.fn(), effectAllowed: "" } });
    fireEvent.drop(rows[2]);
    expect(structural.move).toHaveBeenCalledTimes(1);
    // Second drop, no second dragstart: the first one is spent.
    fireEvent.drop(rows[1]);
    expect(structural.move).toHaveBeenCalledTimes(1);
  });

  it("inserts a seeded block of the chosen kind below", async () => {
    const user = userEvent.setup();
    const { structural } = setup();
    const menu = await openActions(user, 0);
    await user.click(within(menu).getByRole("button", { name: t(LANG, "documentsBlockAddBelow") }));
    await user.click(within(menu).getByRole("button", { name: t(LANG, "documentsBlockBullets") }));
    expect(structural.insert).toHaveBeenCalledWith(1, {
      type: "bullets",
      items: [t(LANG, "documentsNewItemText")],
    });
  });

  // ★ "Above" and "below" differ ONLY by the index, so a fixture that opened
  //  the menu on row 0 could not tell an off-by-one from a correct one — both
  //  land on 0 or 1. Row 1 separates them.
  it("inserts above at the row's own index", async () => {
    const user = userEvent.setup();
    const { structural } = setup();
    const menu = await openActions(user, 1);
    await user.click(within(menu).getByRole("button", { name: t(LANG, "documentsBlockAddAbove") }));
    await user.click(within(menu).getByRole("button", { name: t(LANG, "documentsBlockPageBreak") }));
    expect(structural.insert).toHaveBeenCalledWith(1, { type: "pageBreak" });
  });

  // ★ A pageBreak is trivial, so it deletes with no confirm — and it carries
  //  its baseline for the engine's precondition all the same.
  it("deletes a trivial block without confirming", async () => {
    const user = userEvent.setup();
    const { structural } = setup();
    const menu = await openActions(user, 2);
    await user.click(within(menu).getByRole("button", { name: t(LANG, "documentsBlockDelete") }));
    expect(structural.remove).toHaveBeenCalledWith(2, structDoc.blocks[2]);
  });

  // ★★★ THE CONFIRM GATE. Content is recoverable only by restoring an earlier
  //  version of the WHOLE document, discarding every other edit since — so a
  //  one-click delete of a heading the user has written into is the expensive
  //  mistake. Without this pair the gate is unpinned and
  //  `documentsBlockDeleteConfirm` is a dead string in both dictionaries.
  it("asks before deleting a block holding content", async () => {
    const user = userEvent.setup();
    const { structural } = setupConfirmable();
    const menu = await openActions(user, 0);
    await user.click(within(menu).getByRole("button", { name: t(LANG, "documentsBlockDelete") }));
    // The prompt is up and NOTHING has been removed yet.
    expect(screen.getByText(t(LANG, "documentsBlockDeleteConfirm"))).toBeInTheDocument();
    expect(structural.remove).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: t(LANG, "cancel") }));
    expect(structural.remove).not.toHaveBeenCalled();
  });

  it("deletes a block holding content once confirmed", async () => {
    const user = userEvent.setup();
    const { structural } = setupConfirmable();
    const menu = await openActions(user, 0);
    await user.click(within(menu).getByRole("button", { name: t(LANG, "documentsBlockDelete") }));
    // ★ The confirm button carries the ACTION's own label, not a generic
    //  "Confirm", so it is queried by the same key the menu item uses.
    const dialog = screen.getByRole("dialog", { name: t(LANG, "documentsBlockDelete") });
    await user.click(within(dialog).getByRole("button", { name: t(LANG, "documentsBlockDelete") }));
    expect(structural.remove).toHaveBeenCalledWith(0, structDoc.blocks[0]);
  });

  it("appends a chosen kind from the trailing add control", async () => {
    const user = userEvent.setup();
    const { structural } = setup();
    await user.click(screen.getByRole("button", { name: t(LANG, "documentsAddBlock") }));
    await user.click(screen.getByRole("button", { name: t(LANG, "documentsBlockPageBreak") }));
    expect(structural.insert).toHaveBeenCalledWith(3, { type: "pageBreak" });
  });

  // ★★ The hint is the ONLY place the arrow-key path is disclosed. Native
  //  HTML5 drag does not fire on touch at all, so for a touch or keyboard user
  //  the arrow keys are not a shortcut — they are the whole feature.
  it("states the reorder hint once, not per row", () => {
    setup();
    expect(screen.getAllByText(t(LANG, "documentsBlockReorderHint"))).toHaveLength(1);
  });

  it("omits the reorder hint when there is nothing to reorder", () => {
    render(
      <DocumentEditor
        lang={LANG}
        doc={{ ...structDoc, blocks: [{ type: "pageBreak" }] }}
        onCommitBlock={vi.fn()}
        structural={stubStructural()}
      />,
    );
    expect(screen.queryByText(t(LANG, "documentsBlockReorderHint"))).toBeNull();
  });
});
