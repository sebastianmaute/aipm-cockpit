import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DocumentBlockGutter, BlockKindMenu } from "./document-block-gutter";
import type { DocBlock } from "./document-model";
import { expectRowUniqueNames } from "../test/row-unique-names";

const P: DocBlock = { type: "paragraph", html: "<p>Real content</p>" };
const BREAK: DocBlock = { type: "pageBreak" };

/** Every kind the menu offers, in `ADDABLE_BLOCK_TYPES` order. Spelled out as
 *  the rendered EN labels rather than derived from the constant — a test that
 *  maps over the same array the component maps over cannot notice the array
 *  changing. Note "List" and "Project data": the i18n labels do not echo the
 *  type names. */
const KIND_LABELS = ["Paragraph", "Heading", "List", "Table", "Project data", "Page break"];

function renderRows(blocks: DocBlock[], handlers: Partial<Parameters<typeof DocumentBlockGutter>[0]> = {}) {
  const onInsert = vi.fn(), onDelete = vi.fn();
  const ui = (
    <>
      {blocks.map((block, index) => (
        <DocumentBlockGutter
          key={index}
          lang="en-US"
          index={index}
          block={block}
          onInsert={onInsert}
          onDelete={onDelete}
          handleProps={{ draggable: true }}
          {...handlers}
        />
      ))}
    </>
  );
  return { ...render(ui), onInsert, onDelete };
}

describe("DocumentBlockGutter", () => {
  // ★★★ TWO ROWS, NOT ONE. A duplicate accessible name is not a property a
  //  single row can have, so no one-row fixture can express this at any
  //  assertion count — and axe cannot see it in ANY view at ANY seed size.
  //  Only a multi-row unit test can ever catch it.
  it("gives every control a row-unique accessible name", () => {
    renderRows([P, P]);
    expect(screen.getByRole("button", { name: "Reorder – Block 1" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reorder – Block 2" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Block actions – Block 1" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Block actions – Block 2" })).toBeInTheDocument();
    expectRowUniqueNames({ minControls: 4 });
  });

  it("renders the block's kind chip", () => {
    renderRows([P, BREAK]);
    expect(screen.getByText("Paragraph")).toBeInTheDocument();
    expect(screen.getByText("Page break")).toBeInTheDocument();
  });

  // ★ `.focus()` never proves focusability — it succeeds on an element the
  //  keyboard can never reach. Tab to it.
  it("puts the drag handle in the tab order", async () => {
    const user = userEvent.setup();
    renderRows([P]);
    await user.tab();
    expect(screen.getByRole("button", { name: "Reorder – Block 1" })).toHaveFocus();
  });

  it("opens the actions menu and swaps to the kind list", async () => {
    const user = userEvent.setup();
    const { onInsert } = renderRows([P]);
    await user.click(screen.getByRole("button", { name: "Block actions – Block 1" }));

    const menu = screen.getByRole("dialog", { name: "Block actions – Block 1" });
    expect(within(menu).getByRole("button", { name: "Add above" })).toBeInTheDocument();
    expect(within(menu).getByRole("button", { name: "Add below" })).toBeInTheDocument();
    expect(within(menu).getByRole("button", { name: "Delete block" })).toBeInTheDocument();

    await user.click(within(menu).getByRole("button", { name: "Add below" }));
    // Same panel, second view — six kinds plus a way back.
    expect(within(menu).getByRole("button", { name: "Heading" })).toBeInTheDocument();
    expect(within(menu).getByRole("button", { name: "Back" })).toBeInTheDocument();

    await user.click(within(menu).getByRole("button", { name: "Heading" }));
    expect(onInsert).toHaveBeenCalledWith(1, "heading");
  });

  it("adds above at the block's own index", async () => {
    const user = userEvent.setup();
    const { onInsert } = renderRows([P, P]);
    await user.click(screen.getByRole("button", { name: "Block actions – Block 2" }));
    const menu = screen.getByRole("dialog", { name: "Block actions – Block 2" });
    await user.click(within(menu).getByRole("button", { name: "Add above" }));
    await user.click(within(menu).getByRole("button", { name: "Paragraph" }));
    expect(onInsert).toHaveBeenCalledWith(1, "paragraph");
  });

  it("asks onDelete for the block's index", async () => {
    const user = userEvent.setup();
    const { onDelete } = renderRows([P, P]);
    await user.click(screen.getByRole("button", { name: "Block actions – Block 2" }));
    const menu = screen.getByRole("dialog", { name: "Block actions – Block 2" });
    await user.click(within(menu).getByRole("button", { name: "Delete block" }));
    expect(onDelete).toHaveBeenCalledWith(1);
  });

  // ★★ The second view offers exactly the SHARED list plus Back. Counting the
  //  buttons is what pins the sharing: a hand-copied second list would satisfy
  //  every by-name assertion above and drift silently from `BlockKindList`.
  it("offers every addable kind in the second view, plus Back", async () => {
    const user = userEvent.setup();
    renderRows([P]);
    await user.click(screen.getByRole("button", { name: "Block actions – Block 1" }));
    const menu = screen.getByRole("dialog", { name: "Block actions – Block 1" });
    await user.click(within(menu).getByRole("button", { name: "Add above" }));
    for (const label of KIND_LABELS) {
      expect(within(menu).getByRole("button", { name: label })).toBeInTheDocument();
    }
    expect(within(menu).getAllByRole("button")).toHaveLength(KIND_LABELS.length + 1);
  });

  it("returns to the first view via Back", async () => {
    const user = userEvent.setup();
    const { onInsert } = renderRows([P]);
    await user.click(screen.getByRole("button", { name: "Block actions – Block 1" }));
    const menu = screen.getByRole("dialog", { name: "Block actions – Block 1" });
    await user.click(within(menu).getByRole("button", { name: "Add below" }));
    await user.click(within(menu).getByRole("button", { name: "Back" }));
    expect(within(menu).getByRole("button", { name: "Add above" })).toBeInTheDocument();
    expect(within(menu).queryByRole("button", { name: "Heading" })).not.toBeInTheDocument();
    expect(onInsert).not.toHaveBeenCalled();
  });

  // ★★ PopoverPanel's autoFocus fires ONCE, on open — its deps are
  //  [autoFocus, open, pos], none of which change when this panel swaps view.
  //  So without the component's own view-change focus move, clicking "Add
  //  below" unmounts the focused button and focus falls to <body>: the user's
  //  next Tab then leaves the portaled panel entirely, which is the exact
  //  outcome PopoverPanel's own autoFocus comment says must never happen.
  it("moves focus into the new view when the panel swaps", async () => {
    const user = userEvent.setup();
    renderRows([P]);
    await user.click(screen.getByRole("button", { name: "Block actions – Block 1" }));
    const menu = screen.getByRole("dialog", { name: "Block actions – Block 1" });
    await user.click(within(menu).getByRole("button", { name: "Add below" }));
    expect(within(menu).getByRole("button", { name: "Paragraph" })).toHaveFocus();
  });

  // ★★ `aria-expanded` alone says a thing is open or shut; it does not say
  //  there is anything to open. The VALUE must match the role the panel
  //  actually renders, which for both panels on this surface is `dialog`, not
  //  `menu`. No axe rule under the gate's four tags evaluates `aria-haspopup`
  //  against the popup it opens, so the gate flags neither the omission nor a
  //  mismatch.
  it("declares that the actions trigger opens a dialog", () => {
    renderRows([P]);
    const trigger = screen.getByRole("button", { name: "Block actions – Block 1" });
    expect(trigger).toHaveAttribute("aria-haspopup", "dialog");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  // ★★★ THE HINT IS THE ONLY DISCLOSURE OF THE ARROW-KEY PATH, and native
  //  HTML5 drag does not fire on touch at all — so for a keyboard or touch
  //  user the arrow keys are not a shortcut, they are the whole feature. It
  //  renders ONCE above the list as a bare `<p>`, which reaches nobody who
  //  tabs straight to a grip: they hear "Reorder – Block 1, button" and are
  //  never told the keys exist. `aria-describedby` is what carries it there.
  //  ★ ONE id serves every row, because the hint renders once.
  it("describes the grip with whatever hint id it is handed", () => {
    renderRows([P, P], { handleDescribedBy: "reorder-hint" });
    for (const n of [1, 2]) {
      expect(screen.getByRole("button", { name: `Reorder – Block ${n}` })).toHaveAttribute(
        "aria-describedby",
        "reorder-hint",
      );
    }
  });

  // ★★ An `aria-describedby` pointing at an id that is not in the DOM is worse
  //  than none — AT resolves it to nothing and the user is told there is a
  //  description they cannot hear. The hint is gated on there being something
  //  to reorder, so the prop must be OMITTED, never passed as an empty string.
  it("omits aria-describedby entirely when no hint id is passed", () => {
    renderRows([P]);
    expect(screen.getByRole("button", { name: "Reorder – Block 1" })).not.toHaveAttribute(
      "aria-describedby",
    );
  });
});

describe("BlockKindMenu", () => {
  it("renders its trigger and opens a named panel of every addable kind", async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    render(<BlockKindMenu lang="en-US" triggerLabel="Add a block" onPick={onPick} />);

    await user.click(screen.getByRole("button", { name: "Add a block" }));
    const menu = screen.getByRole("dialog", { name: "Add a block" });
    for (const label of KIND_LABELS) {
      expect(within(menu).getByRole("button", { name: label })).toBeInTheDocument();
    }
    // ★ Not a second view, so no Back — the count is the positive observable
    //  that makes that absence assertion mean something.
    expect(within(menu).getAllByRole("button")).toHaveLength(KIND_LABELS.length);
  });

  it("calls onPick with the chosen kind and closes", async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    render(<BlockKindMenu lang="en-US" triggerLabel="Add a block" onPick={onPick} />);

    await user.click(screen.getByRole("button", { name: "Add a block" }));
    const menu = screen.getByRole("dialog", { name: "Add a block" });
    await user.click(within(menu).getByRole("button", { name: "Table" }));

    expect(onPick).toHaveBeenCalledWith("table");
    expect(screen.queryByRole("dialog", { name: "Add a block" })).not.toBeInTheDocument();
  });

  // ★★ Same convention as the gutter's actions trigger, and the same reason:
  //  the panel it opens is `role="dialog"`, so `aria-haspopup` must say
  //  `dialog` and not `menu`. Both triggers on this surface were shipping
  //  `aria-expanded` with no `aria-haspopup` at all.
  it("declares that the trigger opens a dialog", () => {
    render(<BlockKindMenu lang="en-US" triggerLabel="Add a block" onPick={vi.fn()} />);
    const trigger = screen.getByRole("button", { name: "Add a block" });
    expect(trigger).toHaveAttribute("aria-haspopup", "dialog");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });
});
