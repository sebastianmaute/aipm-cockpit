import { describe, it, expect, beforeAll, vi } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { Modal } from "./modal";
import { NotesWindow } from "./notes-window";
import { t } from "./i18n";
import { HELP_ENTRIES, MODAL_HELP } from "./help-content";
import type { NoteLogEntry, Resource } from "./types";

// ProseMirror (the composer + inline edit RichTextEditor) touches layout APIs
// jsdom lacks; stub them so the editor mounts. Mirrors rich-text-editor.test.tsx.
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

const RES_BASE = { roleId: null, utilizationMode: "percent" as const, utilization: {} };
const RESOURCES: Resource[] = [
  { id: 1, firstName: "Alice", lastName: "Anders", ...RES_BASE },
  { id: 2, firstName: "Bob", lastName: "Baker", ...RES_BASE },
];

const ENTRIES: NoteLogEntry[] = [
  { id: 1, timestamp: "2026-01-01T10:00:00Z", html: "<p>First note</p>", text: "First note", authorResourceId: 1, authorName: "Alice Anders" },
  { id: 2, timestamp: "2026-01-02T10:00:00Z", html: "<p>Second note</p>", text: "Second note", authorResourceId: 2, authorName: "Bob Baker" },
  { id: 3, timestamp: "2026-01-03T10:00:00Z", html: "<p>Third note</p>", text: "Third note" },
];

function setup(over: Partial<React.ComponentProps<typeof NotesWindow>> = {}) {
  const onClose = vi.fn();
  const onAdd = vi.fn();
  const onEdit = vi.fn();
  const onDelete = vi.fn();
  render(
    <NotesWindow
      open
      onClose={onClose}
      entries={ENTRIES}
      onAdd={onAdd}
      onEdit={onEdit}
      onDelete={onDelete}
      self={1}
      resources={RESOURCES}
      lang="en-US"
      entityLabel="Task ABC"
      // These specs pin window chrome, dismissal and sanitising, not the AI
      // disclosure; `false` keeps that line out of the tree. `over` can raise
      // it for a test that wants it.
      aiReadable={false}
      {...over}
    />,
  );
  return { onClose, onAdd, onEdit, onDelete };
}

const EN = "en-US" as const;

describe("NotesWindow", () => {
  it("renders nothing when closed", () => {
    setup({ open: false });
    expect(screen.queryByText(/Task ABC/)).toBeNull();
    expect(screen.queryByText("First note")).toBeNull();
  });

  it("renders the title with the entity label and every entry body when open", () => {
    setup();
    expect(screen.getByText(`${t(EN, "noteLogTitle")} — Task ABC`)).toBeTruthy();
    expect(screen.getByText("First note")).toBeTruthy();
    expect(screen.getByText("Second note")).toBeTruthy();
    expect(screen.getByText("Third note")).toBeTruthy();
  });

  // The title-bar close goes through the shared IconButton primitive. The
  // hand-rolled button it replaced already composed INTERACTIVE, so the focus
  // ring and `active:translate-y-px` are VACUOUS here — they matched before the
  // conversion too. `cursor-pointer` (IconButton's BASE_CLASS) and `rounded-md`
  // (the bespoke button used bare `rounded`) are the two that discriminate.
  it("renders the window close through the IconButton primitive", () => {
    setup();
    const close = screen.getByRole("button", { name: t(EN, "close") });
    expect(close.className).toMatch(/(^|\s)cursor-pointer(\s|$)/);
    expect(close.className).toMatch(/(^|\s)rounded-md(\s|$)/);
  });

  // Class A tooltip batch: the icon-only close carries a `title` built from the
  // SAME expression as its accessible name, so a mouse user gets the affordance
  // the `aria-label` only ever gave AT. Sampled row — the batch is not fully
  // pinned; see docs/tooltip-inventory.md.
  it("gives the window close a hover title matching its accessible name", () => {
    setup();
    expect(screen.getByRole("button", { name: t(EN, "close") })).toHaveAttribute(
      "title",
      t(EN, "close"),
    );
  });

  it("shows Edit + Delete only for notes the current user may edit", () => {
    setup(); // self = 1
    // Own note (author 1): both controls.
    expect(screen.getByRole("button", { name: `${t(EN, "edit")} – #1` })).toBeTruthy();
    expect(screen.getByRole("button", { name: `${t(EN, "delete")} – #1` })).toBeTruthy();
    // Someone else's note (author 2): neither.
    expect(screen.queryByRole("button", { name: `${t(EN, "edit")} – #2` })).toBeNull();
    expect(screen.queryByRole("button", { name: `${t(EN, "delete")} – #2` })).toBeNull();
    // Authorless note: editable by anyone.
    expect(screen.getByRole("button", { name: `${t(EN, "edit")} – #3` })).toBeTruthy();
    expect(screen.getByRole("button", { name: `${t(EN, "delete")} – #3` })).toBeTruthy();
  });

  it("commits a new note through onAdd(html, text) and clears the composer", async () => {
    const user = userEvent.setup();
    const { onAdd } = setup();
    const surface = await screen.findByRole("textbox", { name: t(EN, "noteLogPlaceholder") });
    await user.click(surface);
    await user.type(surface, "Hello world");
    fireEvent.keyDown(surface, { key: "Enter" });

    expect(onAdd).toHaveBeenCalledTimes(1);
    const [html, text] = onAdd.mock.calls[0];
    expect(text).toBe("Hello world");
    expect(html).toContain("Hello world");
  });

  it("does not commit an empty note", async () => {
    const { onAdd } = setup();
    const surface = await screen.findByRole("textbox", { name: t(EN, "noteLogPlaceholder") });
    fireEvent.keyDown(surface, { key: "Enter" });
    expect(onAdd).not.toHaveBeenCalled();
  });

  it("deletes an editable note through onDelete(id)", () => {
    const { onDelete } = setup();
    fireEvent.click(screen.getByRole("button", { name: `${t(EN, "delete")} – #1` }));
    expect(onDelete).toHaveBeenCalledWith(1);
  });

  it("edits a note: entering edit mode and committing calls onEdit(id, html, text)", async () => {
    const { onEdit } = setup();
    fireEvent.click(screen.getByRole("button", { name: `${t(EN, "edit")} – #1` }));
    // The row swaps into an inline editor seeded with the note body.
    const editor = await screen.findByRole("textbox", { name: t(EN, "edit") });
    expect(editor.textContent).toContain("First note");
    fireEvent.keyDown(editor, { key: "Enter" });

    expect(onEdit).toHaveBeenCalledTimes(1);
    const [id, html, text] = onEdit.mock.calls[0];
    expect(id).toBe(1);
    expect(text).toBe("First note");
    expect(html).toContain("First note");
  });

  it("closes on Escape", () => {
    const { onClose } = setup();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // ★★ This window is NON-modal and mounts at the top level, so it stays open
  // while the user works anywhere else — including inside a modal it is not part
  // of. It registers on the dismissal stack as a `layer` and is therefore
  // TOPMOST while open, so without a focus gate it would claim every Escape in
  // the app: open notes, open the task editor, press Escape to dismiss the
  // editor, and the notes window closes while the editor stays. It may only
  // claim the key when it is the thing being interacted with — which is what
  // `useClaimsWhenFocusWithin` decides, and why a decliner is walked PAST
  // rather than blocking the layers beneath it.
  it("leaves Escape alone when focus is somewhere else entirely", () => {
    const { onClose } = setup();
    const elsewhere = document.createElement("input");
    document.body.appendChild(elsewhere);
    elsewhere.focus();
    try {
      const esc = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
      document.dispatchEvent(esc);
      expect(onClose).not.toHaveBeenCalled();
      // And critically: not consumed, so whatever IS focused still gets it.
      expect(esc.defaultPrevented).toBe(false);
    } finally {
      elsewhere.remove();
    }
  });

  it("still closes on Escape when focus is inside the window", () => {
    const { onClose } = setup();
    const inside = screen.getByRole("button", { name: t(EN, "close") });
    inside.focus();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("re-sanitizes a malicious entry html at the render sink (defense in depth)", () => {
    const evil: NoteLogEntry[] = [
      {
        id: 1,
        timestamp: "2026-01-01T10:00:00Z",
        html: "<img src=x onerror=alert(1)><script>alert(2)</script><p>Safe body</p>",
        text: "Safe body",
      },
    ];
    const { container } = render(
      <NotesWindow
        open
        onClose={vi.fn()}
        entries={evil}
        onAdd={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        self={1}
        resources={RESOURCES}
        lang="en-US"
        entityLabel="Task ABC"
        aiReadable={false}
      />,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
    expect(container.innerHTML).not.toContain("onerror");
    expect(screen.getByText("Safe body")).toBeTruthy();
  });

  it("closes itself, not the editor, when opened from a trigger inside a modal", async () => {
    // ★★★ REGRESSION GUARD for the whole point of this window's focus gate.
    // The "Notes (N)" trigger lives INSIDE the task/RAID editor `Modal`, and
    // clicking a <button> focuses it. So without focus-on-open, focus sat on
    // the trigger — outside this panel — `useClaimsWhenFocusWithin` read false,
    // this window DECLINED the Escape, and the dismissal stack handed it to the
    // editor beneath: the editor closed and took the user's unsaved draft with
    // it, while the window they had just opened stayed. Open a thing, press
    // Escape, lose your work.
    //
    // Press Escape IMMEDIATELY — no typing, no click into the panel. That is
    // the steady state after every single click on that trigger, not a race.
    const { resetDismissalStack } = await import("./dismissal-stack");
    resetDismissalStack();
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {});

    try {
      const closeEditor = vi.fn();
      const closeNotes = vi.fn();
      // ★ Topology matches production: `task-manager.tsx` renders <NotesWindow>
      // as a top-level SIBLING of the editor, not as its child. Only the
      // TRIGGER lives inside the Modal — which is the whole point, since it is
      // the trigger keeping focus that used to make the panel decline.
      function Harness() {
        const [notesOpen, setNotesOpen] = useState(false);
        return (
          <>
            <Modal open onClose={closeEditor} ariaLabel="Task editor">
              <button type="button" onClick={() => setNotesOpen(true)}>
                Notes (0)
              </button>
            </Modal>
            <NotesWindow
              open={notesOpen}
              onClose={() => {
                setNotesOpen(false);
                closeNotes();
              }}
              entries={[]}
              onAdd={vi.fn()}
              onEdit={vi.fn()}
              onDelete={vi.fn()}
              self={1}
              resources={RESOURCES}
              lang="en-US"
              entityLabel="Task ABC"
              aiReadable={false}
            />
          </>
        );
      }
      render(<Harness />);

      const trigger = screen.getByRole("button", { name: "Notes (0)" });
      await act(async () => {
        trigger.focus();
        fireEvent.click(trigger);
      });

      const escape = new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      });
      await act(async () => {
        (document.activeElement ?? document.body).dispatchEvent(escape);
      });

      expect(closeNotes).toHaveBeenCalledTimes(1);
      expect(closeEditor).not.toHaveBeenCalled();
    } finally {
      // ★ try/finally, not a trailing call: vitest.config sets neither
      // `unstubGlobals` nor `restoreMocks`, so a mid-test throw would leak this
      // synchronous rAF into every test appended after it in this file.
      vi.unstubAllGlobals();
    }
  });

  // ★★ THE SOURCE SCAN IN `help-content.test.ts` CANNOT SEE THIS. That test
  // greps non-test `.tsx` for `conceptId={MODAL_HELP.<key>}` — it proves the
  // literal is PRESENT in this file, never that it is RENDERED. The same green
  // would hold with the icon inside a branch nothing reaches. This is the pin
  // that it reaches the DOM.
  it("renders the help trigger, named by this window's own title", async () => {
    const user = userEvent.setup();
    setup();
    const dialogTitle = `${t(EN, "noteLogTitle")} — Task ABC`;
    const trigger = screen.getByRole("button", {
      name: t(EN, "modalHelpAbout", dialogTitle),
    });
    // ★ The `getByRole` ABOVE is the discriminator — it queries by the full
    // qualified name, so a regression to a bare "Help" throws there. This line
    // is a READABILITY restatement of what that query already enforces, kept
    // because the failure it produces names the missing substring instead of
    // dumping every button in the document.
    // ★★ An earlier comment here called this line "the DISCRIMINATOR, not
    // decoration" and said "only naming the expected string can catch a
    // regression" — both false, and in the direction that matters: it credits
    // a redundant assertion with the work the query does, so deleting the
    // query and keeping this line would read as safe. It is not.
    expect(trigger.getAttribute("aria-label")).toContain("Task ABC");

    // ★★★ THE EXPECTED ID IS HARDCODED, AND IT MUST STAY HARDCODED. An
    // earlier revision derived it — `HELP_ENTRIES.find(e => e.id ===
    // MODAL_HELP.notesWindow)` — and its comment claimed that tied the
    // surface to `feature-rich-text` specifically. It did the opposite:
    // expectation and component read the SAME constant, so repointing
    // `notesWindow` at any other real entry moved both together and the test
    // stayed GREEN. That is precisely the "well-spelled wrong id" case the
    // comment named as its reason for existing — a derived assertion cannot
    // falsify the derivation. Cold review caught it by mutation.
    expect(MODAL_HELP.notesWindow).toBe("feature-rich-text");
    // ★★ ANTI-VACUITY, and it pins the MAP not just the wiring: an id that
    // resolved to no entry makes `HelpIconButton` render NOTHING, so the
    // getByRole above would already fail — but a well-spelled wrong id
    // typechecks and renders fine, which the line above is what catches.
    // This second half proves the entry actually REACHES the popover heading.
    const entry = HELP_ENTRIES.find((e) => e.id === "feature-rich-text")!;
    await user.click(trigger);
    expect(screen.getByRole("dialog", { name: t(EN, entry.titleKey) })).toBeTruthy();
  });

  // ★★★ THIS PINS A MEASUREMENT THAT LIVED ONLY IN PROSE. `notes-window.tsx`
  // records two probe arms — a baseline with no help icon where Tab leaves the
  // window, and a treatment with the popover open where it does not — and
  // concludes "this window does NOT contain Tab today, this slice did not
  // change that". Nothing pressed Tab in any test, so that conclusion had no
  // regression guard in either direction: a later change that gave the window
  // a trap, or that stopped `PopoverPanel` containing on a non-`Modal` host,
  // would go unnoticed while the comment went on asserting a measurement
  // nobody could re-run. The component's own docstring states the rule as
  // "MEASURE the baseline before and the treatment after, and record both" —
  // recording it in a comment is not recording it.
  //
  // ★★ THE ASSERTIONS ARE NOT THE PROBE'S NUMBERS, deliberately. The recorded
  // 7-and-8 positions were measured with NO icon in the tree; the icon adds a
  // tab stop, so pinning those ordinals here would fail for a reason that has
  // nothing to do with the property. What is pinned is the SHAPE both arms
  // showed: closed, focus escapes the window within twelve presses; open, it
  // never leaves the popover.
  //
  // ★ A RED HERE IS A QUESTION, NOT A BUG. The escape arm pins today's
  // NON-containment. If someone deliberately gives this window a focus trap
  // that is an improvement, and this test is where they find out they changed
  // a recorded property — go update the measurement in `notes-window.tsx`
  // rather than deleting the assertion.
  it("does not contain Tab when the popover is closed, and does while it is open", async () => {
    const user = userEvent.setup();
    setup();
    // The falsifier: a control OUTSIDE the window. Without it, "focus left the
    // window" is unobservable — every assertion would pass against a tree that
    // simply ran out of focusables.
    const outside = document.createElement("button");
    outside.textContent = "outside";
    document.body.appendChild(outside);
    try {
      const trigger = screen.getByRole("button", {
        name: t(EN, "modalHelpAbout", `${t(EN, "noteLogTitle")} — Task ABC`),
      });

      // ARM 1 — popover CLOSED. Focus must reach the outside button.
      const closed: Element[] = [];
      for (let i = 0; i < 12; i++) {
        await user.tab();
        closed.push(document.activeElement as Element);
      }
      expect(closed).toContain(outside);

      // ARM 2 — popover OPEN. Focus must never leave the popover's close
      // button, which is the panel's only focusable and therefore the whole
      // reason `HelpIconButton` renders one (see its docstring).
      await user.click(trigger);
      const panelClose = screen.getByRole("button", {
        name: `${t(EN, "alertModalClose")} – ${t(EN, HELP_ENTRIES.find((e) => e.id === "feature-rich-text")!.titleKey)}`,
      });
      // ★★★ AWAIT THE autoFocus LANDING BEFORE PRESSING TAB. This is a
      // PRECONDITION, not a relaxed assertion — the twelve presses below still
      // assert exactly what they did. `PopoverPanel` gates its `autoFocus`
      // effect on a MEASURED `pos`, and jsdom has no layout, so under a
      // squeezed worker the focus had not landed when the loop began: press 1
      // hit the TRIGGER instead of the panel and the run went red. Measured
      // 2026-09-10 in CI — pipeline 6819 failed and the SAME commit at the
      // SAME seed passed on retry, which is what rules out an order
      // dependence (eight shuffled seeds are green locally, and vitest
      // isolates per file, so neither intra- nor cross-file order explains it).
      // ★ It also PINS `autoFocus`, which until now was only implicitly pinned
      // by press 1 happening to be correct. Deleting the prop turns this red.
      await waitFor(() => expect(document.activeElement).toBe(panelClose));

      const open: Element[] = [];
      for (let i = 0; i < 12; i++) {
        await user.tab();
        open.push(document.activeElement as Element);
      }
      expect(open).toEqual(Array(12).fill(panelClose));
      expect(open).not.toContain(outside);
    } finally {
      outside.remove();
    }
  });
});
