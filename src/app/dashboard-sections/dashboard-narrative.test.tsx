import { describe, it, expect, beforeAll, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState, type ReactNode } from "react";
import { t } from "../i18n";
import type { ProjectStatus } from "../types";
import { useDismissable } from "../use-dismissable";
import { NarrativeSummary, NarrativeEditor } from "./dashboard-narrative";

// ProseMirror (the lean RichTextEditor) touches layout APIs jsdom lacks; stub
// them so the editor mounts. Mirrors notes-window.test.tsx.
beforeAll(() => {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore jsdom polyfill
  Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} });
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore jsdom polyfill
  Range.prototype.getBoundingClientRect = () => ({ width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON: () => ({}) });
  // userEvent's pointer press calls document.elementFromPoint (absent in jsdom).
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore jsdom polyfill
  if (!document.elementFromPoint) document.elementFromPoint = () => null;
});

// The read-only rendering tests never write, so a no-op setter is enough. The
// editing tests below use SummaryHost, which owns real ProjectStatus state.
function Summary({ status, readOnly = false }: { status: ProjectStatus; readOnly?: boolean }) {
  return <NarrativeSummary lang="en-US" status={status} setStatus={() => {}} readOnly={readOnly} />;
}

// ★ Hardcoded expected names, not `t(lang, key)`: `t` echoes an unknown key, so a
//   `t`-based query would still find a button whose string had been deleted.
const EDIT = "Edit status summary";
const ADD = "Add status summary";

describe("NarrativeSummary", () => {
  it("renders a legacy plain-text narrative + updated date", () => {
    render(<Summary status={{ narrative: "All on track", narrativeUpdatedAt: "2026-06-20T10:00:00.000Z" }} />);
    expect(screen.getByText("All on track")).toBeInTheDocument();
    expect(screen.getByText(/Updated/)).toBeInTheDocument();
  });

  it("renders stored rich text as markup, not as escaped source", () => {
    const { container } = render(<Summary status={{ narrative: "<p>Ship <strong>R3</strong></p>" }} />);
    expect(container.querySelector("strong")?.textContent).toBe("R3");
  });

  it("strips a script tag at the render sink", () => {
    const { container } = render(<Summary status={{ narrative: "<p>ok</p><script>alert(1)</script>" }} />);
    expect(container.querySelector("script")).toBeNull();
    expect(container.textContent).toContain("ok");
  });

  // ★★ INVERTED from "renders nothing when the narrative is empty or blank
  //   markup". With the bottom editor gone this summary is the only way in, so a
  //   summary that hid itself when empty left no way to write a first narrative.
  it.each([
    ["no narrative", {}],
    ["blank markup", { narrative: "<p></p>" }],
  ])("offers Add, and no Edit, when there is %s", (_label, status: ProjectStatus) => {
    render(<Summary status={status} />);
    expect(screen.getByRole("button", { name: ADD })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: EDIT })).toBeNull();
  });

  it("offers Edit, and no Add, beside a stored narrative", () => {
    render(<Summary status={{ narrative: "<p>All on track</p>" }} />);
    expect(screen.getByText("All on track")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: EDIT })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: ADD })).toBeNull();
  });

  // ★ Edit is an icon in the card's top-right corner, beside the text — it no
  //   longer takes a line of its own under it. The name stays the full
  //   "Edit status summary" (aria-label + tooltip), since nothing visible says it.
  it("shows Edit as a pencil icon at the top right, beside the text, not on a line below", () => {
    render(<Summary status={{ narrative: "<p>All on track</p>", narrativeUpdatedAt: "2026-06-20T10:00:00.000Z" }} />);
    const edit = screen.getByRole("button", { name: EDIT });
    expect(edit.textContent).toBe("");                               // icon only
    expect(edit.querySelector("svg")).not.toBeNull();                // positive control: there IS a glyph
    expect(edit).toHaveAttribute("title", EDIT);
    const row = edit.parentElement!;
    expect(row).toHaveClass("flex", "items-start");                  // top-aligned beside the text
    expect(row.lastElementChild).toBe(edit);                         // right end of the row
    expect(within(row).getByText("All on track")).toBeInTheDocument(); // same row as the text
    expect(within(row).getByText(/Updated/)).toBeInTheDocument();
  });

  it("keeps Add as a text button when there is nothing to edit", () => {
    render(<Summary status={{}} />);
    expect(screen.getByRole("button", { name: ADD }).textContent).toBe(ADD);
  });

  it("renders no Edit button in a read-only popout", () => {
    render(<Summary status={{ narrative: "<p>All on track</p>" }} readOnly />);
    expect(screen.getByText("All on track")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: EDIT })).toBeNull();
  });

  // ★ Read-only AND empty is the one case with nothing to show and nothing to
  //   do, so it renders nothing rather than a blank card — the old behaviour.
  it("renders nothing, and no Add button, when read-only with no narrative", () => {
    const { container } = render(<Summary status={{}} readOnly />);
    expect(container.firstChild).toBeNull();
    expect(screen.queryByRole("button", { name: ADD })).toBeNull();
  });

  // ★★ End-to-end for the vanished-narrative defect, through the REAL pipeline
  // (narrativeToHtml -> sanitizeRichHtml -> RichTextView). These tags were treated
  // as ready-to-render HTML while the sink stripped them WITH their text
  // (the retired sanitizeNoteHtml ran KEEP_CONTENT: false), so the stored words
  // were simply deleted on screen: the h1 case rendered "All good" alone, the div
  // and blockquote cases rendered an empty card. Reachable by anyone who pasted
  // HTML into the old plain textarea to fake formatting.
  // ★★ THE ASSERTION IS UNCHANGED AND THE ROUTE UNDERNEATH IT IS NOT — the test
  // pins that the WORDS are visible, never how. h1/h3/blockquote are on
  // RICH_ALLOWED_TAGS now, so those three survive as real markup; div is not, so
  // narrativeToHtml still escapes that value whole and the words show as text.
  // Both routes satisfy this test, which is the point of asserting on the words.
  it.each([
    ["<h1>Q3 status</h1><p>All good</p>", ["Q3 status", "All good"]],
    ["<div>Status text</div>", ["Status text"]],
    ["<blockquote>Quoted</blockquote>", ["Quoted"]],
    ["<h3>Deep heading</h3>", ["Deep heading"]],
  ])("keeps the text of a legacy %s narrative visible", (narrative, expected) => {
    const { container } = render(<Summary status={{ narrative }} />);
    for (const word of expected) expect(container.textContent).toContain(word);
  });

  // The other half: a value that DOES open with a recognised tag but sanitises to
  // nothing. Judging emptiness on the stored value called this non-empty and
  // rendered a card holding nothing but the "Updated <date>" line — a blank status
  // card with a timestamp.
  // ★★★ THE FIXTURE CHANGED AND THE PROPERTY DID NOT. It was
  // "<p><u>underlined only</u></p>", a Word/Outlook paste that collapsed to
  // "<p></p>" because `sanitizeNoteHtml` omitted `u` AND ran KEEP_CONTENT: false.
  // `u` is on RICH_ALLOWED_TAGS now and that value renders in full — measured, as
  // a real failure of this test before it was re-aimed. An element carrying no
  // text of its own is what still empties a wrapper: measured 2026-08-11,
  // sanitizeRichHtml("<p><script>x</script></p>") === "<p></p>", isNarrativeEmpty
  // true. The divergence between stored and sanitised is narrower now, not gone.
  // ★★ INVERTED from "renders nothing when …": the property kept is the one that
  //   mattered — no "Updated <date>" line over an empty narrative — and the card
  //   now offers Add where it used to vanish.
  it("offers Add, with no Updated line, when the narrative sanitises away to nothing", () => {
    const { container } = render(
      <Summary status={{ narrative: "<p><script>x</script></p>", narrativeUpdatedAt: "2026-06-20T10:00:00.000Z" }} />,
    );
    expect(screen.getByRole("button", { name: ADD })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: EDIT })).toBeNull();
    expect(container.textContent).not.toMatch(/Updated/);
  });
});

// A host that owns ProjectStatus state so NarrativeSummary's edit path runs
// against a real setState, plus a focusable control OUTSIDE the editor region
// for the close-on-leave tests.
function SummaryHost({ initial = "" }: { initial?: string }) {
  const [status, setStatus] = useState<ProjectStatus>({ narrative: initial });
  return (
    <>
      <NarrativeSummary lang="en-US" status={status} setStatus={setStatus} readOnly={false} />
      <button type="button">outside</button>
      <span data-testid="stored">{status.narrative ?? ""}</span>
    </>
  );
}

const surfaceName = () => t("en-US", "dashboardNarrativePlaceholder");

// A dismissal-stack layer that is open before the editor, standing in for
// whatever surface the Dashboard sits in.
function OuterLayer({ onDismiss, children }: { onDismiss: () => void; children: ReactNode }) {
  useDismissable({ open: true, kind: "layer", onDismiss });
  return <>{children}</>;
}

describe("NarrativeSummary inline editing", () => {
  it.each([
    ["Edit", "<p>All on track</p>", EDIT],
    ["Add", "", ADD],
  ])("%s swaps the summary for the editor in place, and focuses it", async (_label, initial, name) => {
    const user = userEvent.setup();
    render(<SummaryHost initial={initial} />);
    await user.click(screen.getByRole("button", { name }));
    const surface = await screen.findByRole("textbox", { name: surfaceName() });
    expect(screen.queryByRole("button", { name: EDIT })).toBeNull();
    expect(screen.queryByRole("button", { name: ADD })).toBeNull();
    // `autoFocus`: the editor focuses itself once its Tiptap instance exists.
    await waitFor(() => expect(surface.contains(document.activeElement)).toBe(true));
  });

  // The editor's own toolbar is INSIDE the region, so focus moving to Bold must
  // keep the editor open — closing on that blur would unmount it mid-click.
  it("keeps the editor open when its Bold button is clicked", async () => {
    const user = userEvent.setup();
    render(<SummaryHost />);
    await user.click(screen.getByRole("button", { name: ADD }));
    const surface = await screen.findByRole("textbox", { name: surfaceName() });
    await user.click(surface);
    await user.keyboard("hello world");
    await user.keyboard("{Control>}a{/Control}");
    await user.click(screen.getByRole("button", { name: /bold/i }));
    const after = screen.getByRole("textbox", { name: surfaceName() });
    expect(after).toBe(surface);
    expect(after.querySelector("strong")?.textContent).toBe("hello world");
  });

  // ★★ THESE, not the Bold click, pin the `relatedTarget` rule. A toolbar
  //   button does not take focus on mousedown, so a Bold CLICK never blurs the
  //   editor and passes even with a close-on-every-blur rule (measured by
  //   mutation). Keyboard focus moving to the toolbar or to Save DOES blur it.
  it("stays open when Shift+Tab moves focus from the text into the toolbar", async () => {
    const user = userEvent.setup();
    render(<SummaryHost initial="<p>Old</p>" />);
    await user.click(screen.getByRole("button", { name: EDIT }));
    const surface = await screen.findByRole("textbox", { name: surfaceName() });
    await waitFor(() => expect(surface.contains(document.activeElement)).toBe(true));
    await user.tab({ shift: true });
    const toolbar = screen.getByRole("toolbar", { name: surfaceName() });
    expect(toolbar.contains(document.activeElement)).toBe(true);
    expect(screen.getByRole("textbox", { name: surfaceName() })).toBe(surface);
  });

  it("stays open when Tab moves focus from the text to Save", async () => {
    const user = userEvent.setup();
    render(<SummaryHost initial="<p>Old</p>" />);
    await user.click(screen.getByRole("button", { name: EDIT }));
    const surface = await screen.findByRole("textbox", { name: surfaceName() });
    await waitFor(() => expect(surface.contains(document.activeElement)).toBe(true));
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: t("en-US", "dashboardStatusSave") }));
    expect(screen.getByRole("textbox", { name: surfaceName() })).toBe(surface);
  });

  // ★★ The heading menu is a PopoverPanel PORTALED to document.body and it
  //   autofocuses its first item, so opening it moves focus OUTSIDE the region's
  //   DOM. A `contains`-only close rule unmounted the editor under the menu.
  it("stays open while the heading menu is used, and applies the picked level", async () => {
    const user = userEvent.setup();
    render(<SummaryHost />);
    await user.click(screen.getByRole("button", { name: ADD }));
    const surface = await screen.findByRole("textbox", { name: surfaceName() });
    // §619: let the editor's rAF-deferred autofocus land first, or it can
    //   fire after the menu has focused and pull focus back out of it.
    await waitFor(() => expect(surface.contains(document.activeElement)).toBe(true));
    await user.click(surface);
    await user.keyboard("Title");
    await user.click(screen.getByRole("button", { name: "Text style" }));
    const menu = await screen.findByRole("dialog", { name: "Text style" });
    await waitFor(() => expect(menu.contains(document.activeElement)).toBe(true));
    await user.click(within(menu).getByRole("button", { name: "Heading 2" }));
    const after = screen.getByRole("textbox", { name: surfaceName() });
    expect(after).toBe(surface);
    expect(after.querySelector("h2")?.textContent).toBe("Title");
    expect(screen.queryByRole("button", { name: EDIT })).toBeNull();
    expect(screen.queryByRole("button", { name: ADD })).toBeNull();
  });

  // ★★ Alt-Tab, the address bar or devtools fire focusout with a null
  //   relatedTarget while the DOCUMENT loses focus. That is leaving the window,
  //   not leaving the editor, and must not close it. Driven by a raw focusout
  //   because no user-event gesture can take focus away from the window.
  it.each([false, true])("a null-relatedTarget focusout with document.hasFocus()=%s closes only when true", async (hasFocus) => {
    const user = userEvent.setup();
    render(<SummaryHost initial="<p>Old</p>" />);
    await user.click(screen.getByRole("button", { name: EDIT }));
    const surface = await screen.findByRole("textbox", { name: surfaceName() });
    const spy = vi.spyOn(document, "hasFocus").mockReturnValue(hasFocus);
    try {
      act(() => {
        surface.dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: null }));
      });
    } finally {
      spy.mockRestore();
    }
    if (hasFocus) {
      expect(screen.queryByRole("textbox", { name: surfaceName() })).toBeNull();
      expect(screen.getByRole("button", { name: EDIT })).toBeInTheDocument();
    } else {
      expect(screen.getByRole("textbox", { name: surfaceName() })).toBe(surface);
      expect(screen.queryByRole("button", { name: EDIT })).toBeNull();
    }
  });

  // ★ A click on non-focusable content INSIDE the region (its heading, its
  //   padding) must not read as leaving it. The region's `tabIndex={-1}` makes
  //   it the focus target of such a click; without it focus falls to <body>,
  //   `relatedTarget` is null, and the editor closes under the user.
  it("stays open when the region's own heading is clicked", async () => {
    const user = userEvent.setup();
    render(<SummaryHost initial="<p>Old</p>" />);
    await user.click(screen.getByRole("button", { name: EDIT }));
    const surface = await screen.findByRole("textbox", { name: surfaceName() });
    await user.click(surface);
    await user.click(screen.getByText("Status summary"));
    expect(screen.getByRole("textbox", { name: surfaceName() })).toBe(surface);
  });

  it("Save returns to the read-only summary showing the saved text, focus on Edit", async () => {
    const user = userEvent.setup();
    render(<SummaryHost />);
    await user.click(screen.getByRole("button", { name: ADD }));
    const surface = await screen.findByRole("textbox", { name: surfaceName() });
    await user.click(surface);
    await user.keyboard("Fresh status");
    await user.click(screen.getByRole("button", { name: t("en-US", "dashboardStatusSave") }));
    expect(screen.queryByRole("textbox", { name: surfaceName() })).toBeNull();
    expect(screen.getByText("Fresh status")).toBeInTheDocument();
    const edit = screen.getByRole("button", { name: EDIT });
    await waitFor(() => expect(document.activeElement).toBe(edit));
  });

  // ★★ A click on non-focusable tile text far down the Dashboard closes the
  //   editor with focus on <body>, so the toggle is refocused — and a plain
  //   focus() scrolls the page back up to it, away from where the user clicked.
  it("returns focus to Edit without scrolling the page", async () => {
    const user = userEvent.setup();
    render(<SummaryHost />);
    await user.click(screen.getByRole("button", { name: ADD }));
    const surface = await screen.findByRole("textbox", { name: surfaceName() });
    await user.click(surface);
    await user.keyboard("Fresh status");
    const focus = vi.spyOn(HTMLElement.prototype, "focus");
    try {
      await user.click(screen.getByRole("button", { name: t("en-US", "dashboardStatusSave") }));
      const edit = screen.getByRole("button", { name: EDIT });
      await waitFor(() => expect(document.activeElement).toBe(edit));
      const onEdit = focus.mock.calls.filter((_args, i) => focus.mock.contexts[i] === edit);
      expect(onEdit).toEqual([[{ preventScroll: true }]]);
    } finally {
      focus.mockRestore();
    }
  });

  // ★ The focus return is deferred a frame; a Dashboard that unmounts inside
  //   that frame must not leave the callback queued against a dead tree.
  it("cancels the pending focus return when it unmounts before the frame", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<SummaryHost initial="<p>Old</p>" />);
    await user.click(screen.getByRole("button", { name: EDIT }));
    await screen.findByRole("textbox", { name: surfaceName() });
    const issued: number[] = [];
    let next = 9000;
    const raf = vi.spyOn(window, "requestAnimationFrame").mockImplementation(() => {
      issued.push(++next);
      return next;
    });
    const cancel = vi.spyOn(window, "cancelAnimationFrame");
    try {
      await user.click(screen.getByRole("button", { name: t("en-US", "dashboardStatusSave") }));
      expect(issued.length).toBeGreaterThan(0);
      const cancelledBefore = cancel.mock.calls.length;
      unmount();
      const cancelledOnUnmount = cancel.mock.calls.slice(cancelledBefore).map(([id]) => id);
      expect(cancelledOnUnmount).toContain(issued[issued.length - 1]);
    } finally {
      raf.mockRestore();
      cancel.mockRestore();
    }
  });

  // ★★ Escape leaves the editor the way focus leaving it does: the draft is
  //   COMMITTED, never discarded, and focus goes back to Edit. The key is
  //   marked `defaultPrevented` so an element-scoped handler outside the
  //   dismissal stack reads it as consumed.
  it("Escape commits the draft, closes the editor and returns focus to Edit", async () => {
    const user = userEvent.setup();
    render(<SummaryHost initial="<p>Old</p>" />);
    await user.click(screen.getByRole("button", { name: EDIT }));
    const surface = await screen.findByRole("textbox", { name: surfaceName() });
    await user.click(surface);
    await user.keyboard(" and new");
    let prevented: boolean | null = null;
    const probe = (e: KeyboardEvent) => { if (e.key === "Escape") prevented = e.defaultPrevented; };
    window.addEventListener("keydown", probe);
    try {
      await user.keyboard("{Escape}");
    } finally {
      window.removeEventListener("keydown", probe);
    }
    expect(prevented).toBe(true);
    expect(screen.queryByRole("textbox", { name: surfaceName() })).toBeNull();
    expect(screen.getByTestId("stored").textContent).toContain("and new");
    const edit = screen.getByRole("button", { name: EDIT });
    await waitFor(() => expect(document.activeElement).toBe(edit));
  });

  // ★★ The editor takes the Escape through the dismissal stack, so a layer
  //   opened BEFORE it (the surface the Dashboard sits in) is left alone. The
  //   next Escape, with the editor gone, reaches that layer as normal.
  it("Escape closes only the editor, not a layer opened beneath it", async () => {
    const user = userEvent.setup();
    const outer = vi.fn();
    render(<OuterLayer onDismiss={outer}><SummaryHost initial="<p>Old</p>" /></OuterLayer>);
    await user.click(screen.getByRole("button", { name: EDIT }));
    const surface = await screen.findByRole("textbox", { name: surfaceName() });
    await waitFor(() => expect(surface.contains(document.activeElement)).toBe(true));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("textbox", { name: surfaceName() })).toBeNull();
    expect(outer).not.toHaveBeenCalled();
    await user.keyboard("{Escape}");
    expect(outer).toHaveBeenCalledTimes(1);
  });

  // ★ The heading menu opens AFTER the editor, so it sits above it on the
  //   dismissal stack: the first Escape closes the menu alone.
  it("Escape with the heading menu open closes the menu, not the editor", async () => {
    const user = userEvent.setup();
    render(<SummaryHost initial="<p>Old</p>" />);
    await user.click(screen.getByRole("button", { name: EDIT }));
    const surface = await screen.findByRole("textbox", { name: surfaceName() });
    // §619: without this wait the editor's rAF-deferred autofocus can fire
    //   AFTER the menu takes focus and pull it back into the text for good.
    await waitFor(() => expect(surface.contains(document.activeElement)).toBe(true));
    await user.click(screen.getByRole("button", { name: "Text style" }));
    const menu = await screen.findByRole("dialog", { name: "Text style" });
    await waitFor(() => expect(menu.contains(document.activeElement)).toBe(true));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Text style" })).toBeNull();
    expect(screen.getByRole("textbox", { name: surfaceName() })).toBe(surface);
  });

  // ★★ §619, made deterministic. Tiptap's focus command calls view.focus()
  //   inside requestAnimationFrame, while the heading menu focuses its first
  //   item in an effect. A test that opens the menu before that frame runs
  //   loses focus to the late editor frame. Frames are QUEUED here and drained
  //   by hand, so the order is fixed rather than left to the jsdom interval.
  //   Mutation: delete the two lines marked PRE-MENU WAIT and this goes red.
  it("keeps focus in the heading menu when a queued editor frame runs after it opens", async () => {
    const user = userEvent.setup();
    const queued = new Map<number, FrameRequestCallback>();
    let nextId = 0;
    const flushFrames = () => {
      for (let round = 0; round < 10 && queued.size > 0; round++) {
        const batch = [...queued.values()];
        queued.clear();
        for (const cb of batch) cb(0);
      }
    };
    const raf = vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      nextId += 1;
      queued.set(nextId, cb);
      return nextId;
    });
    const cancel = vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
      queued.delete(id);
    });
    try {
      render(<SummaryHost initial="<p>Old</p>" />);
      await user.click(screen.getByRole("button", { name: EDIT }));
      const surface = await screen.findByRole("textbox", { name: surfaceName() });
      // PRE-MENU WAIT (1/2): run the editor's pending autofocus frame.
      act(() => flushFrames());
      // PRE-MENU WAIT (2/2): the same wait the tests above carry.
      await waitFor(() => expect(surface.contains(document.activeElement)).toBe(true));
      await user.click(screen.getByRole("button", { name: "Text style" }));
      const menu = await screen.findByRole("dialog", { name: "Text style" });
      await waitFor(() => expect(menu.contains(document.activeElement)).toBe(true));
      act(() => flushFrames());
      expect(menu.contains(document.activeElement)).toBe(true);
      expect(screen.getByRole("textbox", { name: surfaceName() })).toBe(surface);
    } finally {
      raf.mockRestore();
      cancel.mockRestore();
    }
  });

  // ★ Focus goes back to the toggle ONLY when the close left it nowhere. A
  //   user who clicked another control meant to go there.
  it("closes when focus moves to a control outside the region, and leaves focus there", async () => {
    const user = userEvent.setup();
    render(<SummaryHost initial="<p>Old</p>" />);
    await user.click(screen.getByRole("button", { name: EDIT }));
    const surface = await screen.findByRole("textbox", { name: surfaceName() });
    await user.click(surface);
    await user.keyboard(" and new");
    const outside = screen.getByRole("button", { name: "outside" });
    await user.click(outside);
    expect(screen.queryByRole("textbox", { name: surfaceName() })).toBeNull();
    expect(screen.getByTestId("stored").textContent).toContain("and new");
    await new Promise((r) => requestAnimationFrame(r));
    expect(document.activeElement).toBe(outside);
  });

  it("closes when Tab walks focus out of the region", async () => {
    const user = userEvent.setup();
    render(<SummaryHost initial="<p>Old</p>" />);
    await user.click(screen.getByRole("button", { name: EDIT }));
    const surface = await screen.findByRole("textbox", { name: surfaceName() });
    await waitFor(() => expect(surface.contains(document.activeElement)).toBe(true));
    const outside = screen.getByRole("button", { name: "outside" });
    for (let i = 0; i < 40 && document.activeElement !== outside; i++) await user.tab();
    expect(document.activeElement).toBe(outside);
    expect(screen.queryByRole("textbox", { name: surfaceName() })).toBeNull();
  });

  // ★★ Review Focus 4. Clear deletes the stored narrative; once the editor
  //   closes, the read-only area must offer Add — not a blank card, not nothing.
  it("after Clear, the read-only area shows the Add button", async () => {
    const user = userEvent.setup();
    render(<SummaryHost initial="<p>Something</p>" />);
    await user.click(screen.getByRole("button", { name: EDIT }));
    await screen.findByRole("textbox", { name: surfaceName() });
    await user.click(screen.getByRole("button", { name: /clear/i }));
    expect(screen.getByTestId("stored").textContent).toBe("");
    await user.click(screen.getByRole("button", { name: "outside" }));
    expect(screen.queryByRole("textbox", { name: surfaceName() })).toBeNull();
    expect(screen.getByRole("button", { name: ADD })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: EDIT })).toBeNull();
    expect(screen.queryByText("Something")).toBeNull();
  });

  // ★★ Clear on the ADD path: nothing is stored, so Clear writes nothing and
  //   the nonce is the only thing that empties the surface. Every other Clear
  //   test starts from a stored narrative, where the status write happens too.
  it("Clear on the Add path empties the surface and stores nothing", async () => {
    const user = userEvent.setup();
    render(<SummaryHost />);
    await user.click(screen.getByRole("button", { name: ADD }));
    const surface = await screen.findByRole("textbox", { name: surfaceName() });
    await user.click(surface);
    await user.keyboard("Draft only");
    expect(surface.textContent).toBe("Draft only");
    expect(screen.getByTestId("stored").textContent).toBe("");
    await user.click(screen.getByRole("button", { name: /clear/i }));
    expect(screen.getByRole("textbox", { name: surfaceName() }).textContent).toBe("");
    expect(screen.getByTestId("stored").textContent).toBe("");
  });

  // ★★ The editor region is print:hidden, and a print from the browser menu
  //   leaves the editor open (a window switch does not close it). The stored
  //   summary must still be in the print markup, in a print-only copy that the
  //   screen never shows.
  it("keeps a print-only copy of the stored summary while editing", async () => {
    const user = userEvent.setup();
    render(<SummaryHost initial="<p>Printed status</p>" />);
    await user.click(screen.getByRole("button", { name: EDIT }));
    await screen.findByRole("textbox", { name: surfaceName() });
    const copy = screen.getByTestId("narrative-print-copy");
    expect(copy.textContent).toContain("Printed status");
    expect(copy.className.split(" ")).toEqual(expect.arrayContaining(["hidden", "print:block"]));
    expect(copy.className).not.toContain("print:hidden");
    expect(copy.closest('[class~="print:hidden"]')).toBeNull();
  });

  it("renders no print-only copy while editing when nothing is stored", async () => {
    const user = userEvent.setup();
    render(<SummaryHost />);
    await user.click(screen.getByRole("button", { name: ADD }));
    await screen.findByRole("textbox", { name: surfaceName() });
    expect(screen.queryByTestId("narrative-print-copy")).toBeNull();
  });
});

// A host that owns ProjectStatus state so the editor's commit/clear + the
// render-time reconcile run against a real setState (mirrors WorkspaceProvider).
function EditorHost({ initial = "", externalNarrative }: { initial?: string; externalNarrative?: string }) {
  const [status, setStatus] = useState<ProjectStatus>({ narrative: initial });
  return (
    <>
      <button type="button" onClick={() => setStatus({ narrative: externalNarrative ?? "" })}>
        external reload
      </button>
      {/* The STORED value, so a test can tell "the editor looks empty" apart from
          "the narrative was actually cleared" — the two diverged in the defect
          this host's Clear tests cover. */}
      <span data-testid="stored">{status.narrative ?? ""}</span>
      <NarrativeEditor lang="en-US" status={status} setStatus={setStatus} />
    </>
  );
}

// ★★ The surface is queried BY ROLE, not by label text. `RichTextEditor`'s
// `label` names two elements — the contenteditable AND the toolbar's
// `role="group"` wrapper, which is what tells its fifteen repeated control
// names apart when a form mounts several editors (rich-text-toolbar.tsx). A
// label-text query matches both and throws "Found multiple elements".
describe("NarrativeEditor", () => {
  // The editor is on screen only while editing, so the `<details>` fold it used
  // to sit in would be a second open/close control for the same state.
  it("renders the editor in a plain group named Status summary, with no fold", () => {
    const { container } = render(<EditorHost />);
    expect(screen.getByRole("group", { name: "Status summary" })).toBeInTheDocument();
    expect(container.querySelector("details")).toBeNull();
  });

  it("mounts the lean rich-text editor with an accessible name", async () => {
    render(<EditorHost />);
    expect(await screen.findByRole("textbox", { name: t("en-US", "dashboardNarrativePlaceholder") })).toBeTruthy();
    expect(screen.getByRole("button", { name: /bold/i })).toBeTruthy();
  });

  it("seeds the editor with the stored narrative, upgrading legacy plain text", async () => {
    render(<EditorHost initial="Legacy plain note" />);
    const surface = await screen.findByRole("textbox", { name: t("en-US", "dashboardNarrativePlaceholder") });
    expect(surface.textContent).toContain("Legacy plain note");
  });

  it("Clear is disabled when the narrative is already empty", () => {
    render(<EditorHost />);
    expect(screen.getByRole("button", { name: /clear/i })).toBeDisabled();
  });

  // ★★ Assert the EDITOR SURFACE, not just the disabled Clear button: that button
  // is disabled by `storedHtml === "" && isNarrativeEmpty(draft)`, both of which
  // were already true in the broken implementation that wiped the stored value
  // while leaving the old text on screen. The surface is the only thing that
  // distinguishes the two.
  it("Clear empties the editor surface, not just the stored value", async () => {
    const user = userEvent.setup();
    render(<EditorHost initial="<p>Something</p>" />);
    const before = await screen.findByRole("textbox", { name: t("en-US", "dashboardNarrativePlaceholder") });
    expect(before.textContent).toContain("Something");
    await user.click(screen.getByRole("button", { name: /clear/i }));
    const surface = screen.getByRole("textbox", { name: t("en-US", "dashboardNarrativePlaceholder") });
    expect(surface.textContent).toBe("");
    expect(screen.getByTestId("stored").textContent).toBe("");
    expect(screen.getByRole("button", { name: /clear/i })).toBeDisabled();
  });

  // The other half of the same defect: an editor still holding the cleared text
  // merges it back into the next commit, so the deleted narrative reappears.
  it("typing after Clear does not resurrect the cleared narrative", async () => {
    const user = userEvent.setup();
    render(<EditorHost initial="<p>Something</p>" />);
    await user.click(screen.getByRole("button", { name: /clear/i }));
    // ★★ `findByRole`, not `getByRole`: the editor arrives through
    //   `rich-text-editor-lazy.tsx`, so the FIRST test in this file to reach it
    //   waits on a `dynamic()` import. Every sibling after that is warm, which is
    //   what makes a synchronous query here look safe — it is safe only while
    //   some other test happens to run first. `test:shuffle` reorders WITHIN a
    //   file, so this is a latent order dependence, not a style point.
    const surface = await screen.findByRole("textbox", { name: t("en-US", "dashboardNarrativePlaceholder") });
    await user.click(surface);
    await user.keyboard("X");
    // Blur out of the editor: commit-on-blur stores the draft.
    await user.click(screen.getByText("Status summary"));
    const stored = screen.getByTestId("stored").textContent ?? "";
    expect(stored).not.toContain("Something");
    expect(stored).toContain("X");
  });

  it("re-seeds the draft when status.narrative changes externally (workspace reload)", async () => {
    const user = userEvent.setup();
    render(<EditorHost externalNarrative="<p>External status from reload</p>" />);
    await user.click(screen.getByRole("button", { name: /external reload/i }));
    const surface = await screen.findByRole("textbox", { name: t("en-US", "dashboardNarrativePlaceholder") });
    expect(surface.textContent).toContain("External status from reload");
  });

  // ★ This used to assert the OPPOSITE: on the retired "lean" variant, the
  // heading input rule was switched off (see rich-text-editor.tsx:39) precisely
  // so "# " stayed literal text, working around the old note sanitizer's
  // KEEP_CONTENT:false dropping an unlisted element's content wholesale. There
  // is one editor now, markdown input rules are deliberately back on, and every
  // surface sanitizes with sanitizeRichHtml's default KEEP_CONTENT (unwrap, keep
  // the words) — so "# " now safely becomes a real heading and the assertion is
  // inverted to match.
  it("stores a narrative typed with a markdown '# ' shortcut", async () => {
    const user = userEvent.setup();
    render(<EditorHost />);
    const surface = await screen.findByRole("textbox", { name: t("en-US", "dashboardNarrativePlaceholder") });
    await user.click(surface);
    await user.keyboard("# Q3 highlights");
    await user.click(screen.getByText("Status summary")); // blur -> commit
    expect(screen.getByTestId("stored").textContent).toContain("<h1>Q3 highlights</h1>");
  });

  // The toolbar was dead: mousedown on Bold blurred the editor -> committed ->
  // changed status.narrative -> the render-time reconcile bumped the remount
  // nonce -> the `key` swap replaced the editor node BETWEEN mousedown and
  // mouseup, so no click was ever dispatched and the format command never ran.
  it("applies Bold to the selection instead of losing the click to a remount", async () => {
    const user = userEvent.setup();
    render(<EditorHost />);
    const surface = await screen.findByRole("textbox", { name: t("en-US", "dashboardNarrativePlaceholder") });
    await user.click(surface);
    await user.keyboard("hello world");
    await user.keyboard("{Control>}a{/Control}");
    await user.click(screen.getByRole("button", { name: /bold/i }));
    const after = screen.getByRole("textbox", { name: t("en-US", "dashboardNarrativePlaceholder") });
    expect(after).toBe(surface); // same node: the editor was NOT remounted
    expect(after.querySelector("strong")?.textContent).toBe("hello world");
  });

  it("keeps the editor instance when a commit re-seeds it with its own content", async () => {
    const user = userEvent.setup();
    render(<EditorHost />);
    const surface = await screen.findByRole("textbox", { name: t("en-US", "dashboardNarrativePlaceholder") });
    await user.click(surface);
    await user.keyboard("committed text");
    // Blur out of the editor: commit-on-blur fires and stores the draft.
    await user.click(screen.getByText("Status summary"));
    const after = screen.getByRole("textbox", { name: t("en-US", "dashboardNarrativePlaceholder") });
    expect(after).toBe(surface);
    expect(after.textContent).toContain("committed text");
  });

  // ★ "Clear" sits beside "Save", where it reads as "clear the draft". It is
  //   not: `clearNarrative` also DELETES the stored narrative whenever
  //   `storedHtml !== ""`. The title states the destructive half.
  // ★★ Hardcoded expected text, not `t(lang, key)` — `t` echoes an unknown key,
  //   so a `t`-based assertion would still pass if the string were deleted.
  it("titles Clear with the fact that it deletes the STORED narrative", async () => {
    render(<EditorHost />);
    expect(screen.getByRole("button", { name: t("en-US", "dashboardStatusClear") })).toHaveAttribute(
      "title",
      "Delete the saved status narrative, not just this draft",
    );
  });
});
