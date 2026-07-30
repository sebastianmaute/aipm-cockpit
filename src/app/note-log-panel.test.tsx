import { describe, it, expect, beforeAll, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NoteLogPanel } from "./note-log-panel";
import { t } from "./i18n";
import type { NoteLogEntry, Resource } from "./types";

// Force the dictation mic to be "supported" so useDictationMic renders the
// button (mirrors task-form-fields.dictation.test.tsx — jsdom has no
// SpeechRecognition ctor, so getCtor() is null and the button is normally
// suppressed).
vi.mock("./use-push-to-talk", () => ({
  usePushToTalk: () => ({
    listening: false,
    transcribing: false,
    supported: true,
    buttonHandlers: {},
    toggle: () => {},
    press: vi.fn(),
    release: vi.fn(),
  }),
}));

// ProseMirror (the composer + inline edit RichTextEditor) touches layout APIs
// jsdom lacks; stub them so the editor mounts. Mirrors notes-window.test.tsx.
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

const EN = "en-US" as const;

const RES_BASE = { roleId: null, utilizationMode: "percent" as const, utilization: {} };
const RESOURCES: Resource[] = [
  { id: 1, firstName: "Alice", lastName: "Anders", ...RES_BASE },
  { id: 2, firstName: "Bob", lastName: "Baker", ...RES_BASE },
];

// ★ `canEditNote` treats an AUTHORLESS note as claimable, so "someone else's"
// must carry a real, different `authorResourceId` (2) — not `undefined`.
const ENTRIES: NoteLogEntry[] = [
  { id: 1, timestamp: "2026-01-01T10:00:00Z", html: "<p>Mine</p>", text: "Mine", authorResourceId: 1, authorName: "Alice Anders" },
  { id: 2, timestamp: "2026-01-02T10:00:00Z", html: "<p>Theirs</p>", text: "Theirs", authorResourceId: 2, authorName: "Bob Baker" },
];

function setup(over: Partial<React.ComponentProps<typeof NoteLogPanel>> = {}) {
  const onAdd = vi.fn();
  const onEdit = vi.fn();
  const onDelete = vi.fn();
  const view = render(
    <NoteLogPanel
      entries={ENTRIES}
      onAdd={onAdd}
      onEdit={onEdit}
      onDelete={onDelete}
      self={1}
      resources={RESOURCES}
      lang="en-US"
      {...over}
    />,
  );
  return { onAdd, onEdit, onDelete, view };
}

describe("NoteLogPanel", () => {
  it("renders each entry's author, timestamp and body", () => {
    setup();
    expect(screen.getByText("Alice Anders")).toBeTruthy();
    expect(screen.getByText("Bob Baker")).toBeTruthy();
    expect(screen.getByText("Mine")).toBeTruthy();
    expect(screen.getByText("Theirs")).toBeTruthy();
    // The timestamp rides a <time> carrying the raw instant as its dateTime.
    const times = document.querySelectorAll("time");
    expect(Array.from(times).map((el) => el.getAttribute("dateTime"))).toContain("2026-01-01T10:00:00Z");
  });

  it("commits a typed note through onAdd(html, text)", async () => {
    const user = userEvent.setup();
    const { onAdd } = setup();
    const surface = await screen.findByRole("textbox", { name: t(EN, "noteLogPlaceholder") });
    await user.click(surface);
    await user.type(surface, "Fresh note");
    fireEvent.click(screen.getByRole("button", { name: t(EN, "noteLogAdd") }));

    expect(onAdd).toHaveBeenCalledTimes(1);
    const [html, text] = onAdd.mock.calls[0];
    expect(text).toBe("Fresh note");
    expect(html).toContain("Fresh note");
  });

  it("does not call onAdd when the composer is blank", async () => {
    const { onAdd } = setup();
    // Wait for the editor to mount so the click lands on a live composer.
    await screen.findByRole("textbox", { name: t(EN, "noteLogPlaceholder") });
    fireEvent.click(screen.getByRole("button", { name: t(EN, "noteLogAdd") }));
    expect(onAdd).not.toHaveBeenCalled();
  });

  it("edits a note: committing calls onEdit(id, html, text)", async () => {
    const { onEdit } = setup();
    fireEvent.click(screen.getByRole("button", { name: `${t(EN, "edit")} – #1` }));
    const editor = await screen.findByRole("textbox", { name: t(EN, "edit") });
    expect(editor.textContent).toContain("Mine");
    fireEvent.keyDown(editor, { key: "Enter" });

    expect(onEdit).toHaveBeenCalledTimes(1);
    const [id, html, text] = onEdit.mock.calls[0];
    expect(id).toBe(1);
    expect(text).toBe("Mine");
    expect(html).toContain("Mine");
  });

  it("cancelling an edit calls nothing and leaves the row read-only", async () => {
    const { onEdit } = setup();
    fireEvent.click(screen.getByRole("button", { name: `${t(EN, "edit")} – #1` }));
    await screen.findByRole("textbox", { name: t(EN, "edit") });
    fireEvent.click(screen.getByRole("button", { name: t(EN, "cancel") }));

    expect(onEdit).not.toHaveBeenCalled();
    expect(screen.queryByRole("textbox", { name: t(EN, "edit") })).toBeNull();
    expect(screen.getByRole("button", { name: `${t(EN, "edit")} – #1` })).toBeTruthy();
  });

  it("deletes a note through onDelete(id)", () => {
    const { onDelete } = setup();
    fireEvent.click(screen.getByRole("button", { name: `${t(EN, "delete")} – #1` }));
    expect(onDelete).toHaveBeenCalledWith(1);
  });

  it("hides Edit + Delete on a note authored by someone else", () => {
    setup(); // self = 1, entry #2 authored by resource 2
    expect(screen.queryByRole("button", { name: `${t(EN, "edit")} – #2` })).toBeNull();
    expect(screen.queryByRole("button", { name: `${t(EN, "delete")} – #2` })).toBeNull();
    // The body is still rendered — only the controls are withheld.
    expect(screen.getByText("Theirs")).toBeTruthy();
  });

  it("omits the suffix from every control name when labelSuffix is absent", () => {
    setup();
    expect(screen.getByRole("button", { name: t(EN, "noteLogAdd") })).toBeTruthy();
    expect(screen.getByRole("button", { name: `${t(EN, "edit")} – #1` })).toBeTruthy();
    expect(screen.getByRole("button", { name: `${t(EN, "delete")} – #1` })).toBeTruthy();
  });

  it("appends labelSuffix to the Add, Edit and Delete names when passed", () => {
    setup({ labelSuffix: "Task ABC" });
    expect(screen.getByRole("button", { name: `${t(EN, "noteLogAdd")} – Task ABC` })).toBeTruthy();
    expect(screen.getByRole("button", { name: `${t(EN, "edit")} – #1 – Task ABC` })).toBeTruthy();
    expect(screen.getByRole("button", { name: `${t(EN, "delete")} – #1 – Task ABC` })).toBeTruthy();
    // The un-suffixed names must no longer resolve, or two mounts would collide.
    expect(screen.queryByRole("button", { name: `${t(EN, "edit")} – #1` })).toBeNull();
  });

  it("offers a dictation mic beside the note composer", () => {
    setup({ entries: [] });
    expect(
      screen.getByRole("button", { name: new RegExp(t("en-US", "dictationHold")) }),
    ).toBeTruthy();
  });

  it("offers a dictation mic beside the entry editor when editing a note", async () => {
    setup();
    // Entry #1 is authored by `self` (resource 1), so it has an Edit control.
    fireEvent.click(screen.getByRole("button", { name: `${t(EN, "edit")} – #1` }));
    await screen.findByRole("textbox", { name: t(EN, "edit") });
    // Two mics now render: the composer's and the in-place edit row's. Both
    // must be reachable — a duplicate accessible name would collapse to one.
    const mics = screen.getAllByRole("button", { name: new RegExp(t(EN, "dictationHold")) });
    expect(mics.length).toBe(2);
    const editRowMic = screen.getByRole("button", {
      name: new RegExp(`${t(EN, "dictationHold")} – ${t(EN, "edit")}$`),
    });
    expect(editRowMic).toBeTruthy();
  });

  it("appends labelSuffix to BOTH microphone names", async () => {
    // The reason labelSuffix exists: the floating notes window and the task
    // editor's panel can be mounted at once, so without it the two composer
    // mics announce identically and so do the two edit mics (WCAG 2.4.6).
    // The mics were the only controls in this file that ignored the suffix,
    // and the existing mic tests pass no suffix at all — so both of them match
    // identically with the suffix applied or dropped, and neither can observe
    // this. Asserting on the suffixed names is the only thing that can.
    setup({ labelSuffix: "Task ABC" });
    expect(
      screen.getByRole("button", {
        name: `${t(EN, "dictationHold")} – ${t(EN, "noteLogPlaceholder")} – Task ABC`,
      }),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: `${t(EN, "edit")} – #1 – Task ABC` }));
    await screen.findByRole("textbox", { name: t(EN, "edit") });
    expect(
      screen.getByRole("button", {
        name: `${t(EN, "dictationHold")} – ${t(EN, "edit")} – Task ABC`,
      }),
    ).toBeTruthy();
  });
});
