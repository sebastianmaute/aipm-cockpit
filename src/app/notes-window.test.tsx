import { describe, it, expect, beforeAll, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { Modal } from "./modal";
import { NotesWindow } from "./notes-window";
import { t } from "./i18n";
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
  // of. Its Escape listener is document-CAPTURE, which runs before React's
  // delegation, so an unconditional consume swallows EVERY Escape in the app:
  // open notes, open the task editor, press Escape to dismiss the editor, and
  // the notes window closes while the editor stays. It may only claim the key
  // when it is the thing being interacted with.
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
});
