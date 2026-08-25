import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EntityLinkPicker, type LinkPickerEntry } from "./entity-link-picker";
import { expectRowUniqueNames } from "../test/row-unique-names";

const entry = (id: number, code: string, label: string): LinkPickerEntry => ({ id, code, label });

function renderPicker(overrides: Partial<React.ComponentProps<typeof EntityLinkPicker>> = {}) {
  const props = {
    selected: [] as readonly LinkPickerEntry[],
    options: [] as readonly LinkPickerEntry[],
    query: "",
    onQueryChange: vi.fn(),
    onAdd: vi.fn(),
    onRemove: vi.fn(),
    searchLabel: "Link items",
    placeholder: "Search…",
    removeLabel: "Unlink",
    clearLabel: "Clear – Link items",
    ...overrides,
  };
  return { ...render(<EntityLinkPicker {...props} />), props };
}

describe("EntityLinkPicker", () => {
  it("gives every chip's remove button a row-unique accessible name", () => {
    // The reason the code is appended rather than reused verbatim: N chips
    // sharing one "Unlink" name is a WCAG 2.4.6 failure that no axe run on a
    // single-chip fixture would ever catch (the collision needs two rows to
    // exist). This was the live state of the RAID caused-by picker.
    renderPicker({
      selected: [entry(3, "Risk#3", "Vendor delay"), entry(7, "Issue#7", "Budget freeze")],
    });
    const removes = screen.getAllByRole("button", { name: /unlink/i });
    expect(removes).toHaveLength(2);
    const names = removes.map((b) => b.getAttribute("aria-label"));
    expect(new Set(names).size).toBe(2);
    // The `code` is what carries uniqueness; the label is what makes the name
    // mean something in the inert branch (see the dedicated test below).
    expect(names).toContain("Unlink Risk#3 Vendor delay");
    expect(names).toContain("Unlink Issue#7 Budget freeze");
    expectRowUniqueNames({ minControls: 2 });
  });

  it("keeps the remove name terse when the chip body already names the entity", () => {
    // With onOpen the chip body is a button carrying "Risk#3 Vendor delay", so
    // repeating the label on the × would announce it twice per chip.
    renderPicker({ selected: [entry(3, "Risk#3", "Vendor delay")], onOpen: vi.fn() });
    expect(screen.getByRole("button", { name: /unlink/i })).toHaveAccessibleName("Unlink Risk#3");
    // ★ An unlink is a remove, so the chip's ✕ takes IconButton's `danger` variant.
    // `hover:text-ui-pink-strong` appears in no other variant, so this fails if the
    // control is ever downgraded to the neutral `ghost` default.
    expect(screen.getByRole("button", { name: /unlink/i }).className).toMatch(
      /\bhover:text-ui-pink-strong\b/,
    );
  });

  it("names the search box for assistive tech rather than relying on the placeholder", () => {
    // A placeholder is not an accessible name — an input carrying only one
    // reads as unlabeled to the axe gate and to a screen reader alike.
    renderPicker();
    const input = screen.getByRole("combobox", { name: "Link items" });
    expect(input).toHaveAttribute("placeholder", "Search…");
  });

  it("clears the query via a labelled button that names the field", () => {
    // ★ Exact name, not /clear/i: the point of the label is that it is
    // QUALIFIED — several of these pickers can render on one surface (one per
    // Knowledge-library card), so N identical "Clear" names is the WCAG 2.4.6
    // collision this exists to avoid, and a loose regex passes against the
    // unqualified string just as happily.
    const onQueryChange = vi.fn();
    renderPicker({ query: "api", onQueryChange, clearLabel: "Clear – Linked tasks" });
    fireEvent.click(screen.getByRole("button", { name: "Clear – Linked tasks" }));
    expect(onQueryChange).toHaveBeenCalledWith("");
  });

  it("reserves the clear gutter only while there is something to clear", () => {
    // pr-8 is ~2rem of padding. Applied unconditionally it shaves the visible
    // placeholder in the EMPTY state, which is the common one — so it rides the
    // same condition the ✕ itself does (the TableFilter/PaneSearchInput
    // precedent). Both states are pinned: asserting only the presence would
    // pass against an unconditional class.
    const { unmount } = renderPicker({ query: "api" });
    expect(screen.getByRole("combobox").className).toContain("pr-8");
    unmount();

    renderPicker({ query: "" });
    expect(screen.getByRole("combobox").className).not.toContain("pr-8");
    expect(screen.queryByRole("button", { name: /clear/i })).not.toBeInTheDocument();
  });

  it("removes the entity the clicked chip belongs to", () => {
    const onRemove = vi.fn();
    renderPicker({ selected: [entry(3, "Risk#3", "A"), entry(7, "Issue#7", "B")], onRemove });
    fireEvent.click(screen.getByRole("button", { name: "Unlink Issue#7 B" }));
    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(onRemove).toHaveBeenCalledWith(entry(7, "Issue#7", "B"));
  });

  // Options are queried by the `option` role, not `button`: a row IS the
  // option now (an interactive child of role="option" is an axe
  // nested-interactive violation, and the keyboard path is
  // aria-activedescendant, so the inner button bought nothing).
  it("shows the dropdown only once the query is non-blank", () => {
    const options = [entry(9, "Risk#9", "Scope creep")];
    const { rerender, props } = renderPicker({ options });
    expect(screen.queryByRole("option", { name: /scope creep/i })).not.toBeInTheDocument();

    // Whitespace is not a query — trimming here is what stops a stray space
    // from dumping the whole option list over the form.
    rerender(<EntityLinkPicker {...props} options={options} query="   " />);
    expect(screen.queryByRole("option", { name: /scope creep/i })).not.toBeInTheDocument();

    rerender(<EntityLinkPicker {...props} options={options} query="scope" />);
    expect(screen.getByRole("option", { name: /scope creep/i })).toBeInTheDocument();
  });

  it("adds the option that was clicked, and does not clear the query itself", () => {
    // Clearing is the caller's call: the RAID cause picker rejects some picks
    // (self-reference, cycle) and deliberately keeps the query on that path.
    const onAdd = vi.fn();
    const onQueryChange = vi.fn();
    renderPicker({ options: [entry(9, "Risk#9", "Scope creep")], query: "scope", onAdd, onQueryChange });
    fireEvent.click(screen.getByRole("option", { name: /scope creep/i }));
    expect(onAdd).toHaveBeenCalledWith(entry(9, "Risk#9", "Scope creep"));
    expect(onQueryChange).not.toHaveBeenCalled();
  });

  it("makes a chip navigable only when there is somewhere to navigate to", () => {
    const onOpen = vi.fn();
    const { unmount } = renderPicker({ selected: [entry(3, "Risk#3", "Vendor delay")], onOpen });
    fireEvent.click(screen.getByRole("button", { name: /risk#3 vendor delay/i }));
    // Takes the ENTRY, not a bare id — a picker spanning several entity kinds
    // has colliding ids across kinds, so the caller needs more than the id.
    expect(onOpen).toHaveBeenCalledWith(entry(3, "Risk#3", "Vendor delay"));
    unmount();

    // Without onOpen the chip body is inert text — not a button that looks
    // clickable and does nothing.
    //
    // ★ Probed via the label node's own ancestry, not "no button is named
    // /vendor delay/i": the remove button in this branch DOES carry the entity
    // label in its name (it is the only focusable thing in the chip, so without
    // it a screen-reader user is never told which entity they are unlinking),
    // so a name-based query cannot distinguish "chip body is inert" from "chip
    // body is a button".
    renderPicker({ selected: [entry(3, "Risk#3", "Vendor delay")] });
    expect(screen.getByText("Vendor delay").closest("button")).toBeNull();
  });

  it("names the remove button after the entity when the chip body is inert", () => {
    // In the onOpen-less branch the × is the chip's ONLY focusable element, so
    // a bare "Unlink Risk#3" leaves a screen-reader user with a code and no
    // idea what it refers to. The visible tooltip stays short.
    renderPicker({ selected: [entry(3, "Risk#3", "Vendor delay")] });
    const remove = screen.getByRole("button", { name: /unlink/i });
    expect(remove).toHaveAccessibleName("Unlink Risk#3 Vendor delay");
    expect(remove).toHaveAttribute("title", "Unlink");
  });

  it("keeps the jump glyph out of the chip's accessible name", () => {
    // Label-bleed guard: the ↩ is decoration next to text that already names
    // the target, so it must not end up announced as part of the name.
    renderPicker({ selected: [entry(3, "Risk#3", "Vendor delay")], onOpen: vi.fn() });
    const chip = screen.getByRole("button", { name: /vendor delay/i });
    expect(chip.textContent).toContain("↩");
    expect(chip).toHaveAccessibleName("Risk#3 Vendor delay");
  });

  it("renders a placeholder dash when nothing is linked yet", () => {
    renderPicker();
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  // The dropdown used to be a bare <ul> of buttons: no combobox semantics, no
  // announcement that results had appeared, no way in from the keyboard except
  // Tab through every option, and no way out but deleting the query (WCAG
  // 4.1.3). global-search-box already models this correctly — same shape here.
  describe("combobox semantics", () => {
    const options = [entry(9, "Risk#9", "Scope creep"), entry(4, "Issue#4", "Late sign-off")];

    it("marks the input as a combobox and tracks its expanded state", () => {
      const { rerender, props } = renderPicker({ options });
      const input = screen.getByRole("combobox", { name: "Link items" });
      expect(input).toHaveAttribute("aria-expanded", "false");
      expect(input).not.toHaveAttribute("aria-controls");

      rerender(<EntityLinkPicker {...props} options={options} query="s" />);
      expect(input).toHaveAttribute("aria-expanded", "true");
      const listId = input.getAttribute("aria-controls");
      expect(listId).toBeTruthy();
      expect(screen.getByRole("listbox").id).toBe(listId);
      expect(screen.getAllByRole("option")).toHaveLength(2);
    });

    it("moves the active option with the arrow keys, wrapping at both ends", () => {
      // ★ THREE options, not two: with two, ArrowUp-from-index-0 lands on index
      // 1 and so does ArrowDown, so `move(delta)` collapsed to `move(1)` would
      // satisfy every assertion. A third makes direction observable.
      const three = [...options, entry(5, "Risk#5", "Third thing")];
      renderPicker({ options: three, query: "s" });
      const input = screen.getByRole("combobox");
      const at = (i: number) => screen.getAllByRole("option")[i];
      expect(input).not.toHaveAttribute("aria-activedescendant");

      fireEvent.keyDown(input, { key: "ArrowDown" });
      expect(at(0)).toHaveAttribute("aria-selected", "true");
      expect(input).toHaveAttribute("aria-activedescendant", at(0).id);

      fireEvent.keyDown(input, { key: "ArrowDown" });
      expect(input).toHaveAttribute("aria-activedescendant", at(1).id);

      // Down from the middle goes to the LAST, not back to the first.
      fireEvent.keyDown(input, { key: "ArrowDown" });
      expect(input).toHaveAttribute("aria-activedescendant", at(2).id);

      // Past the end wraps to the first, never off the list.
      fireEvent.keyDown(input, { key: "ArrowDown" });
      expect(input).toHaveAttribute("aria-activedescendant", at(0).id);

      // Up from the first wraps to the LAST — the direction ArrowDown cannot
      // reach from here.
      fireEvent.keyDown(input, { key: "ArrowUp" });
      expect(input).toHaveAttribute("aria-activedescendant", at(2).id);

      fireEvent.keyDown(input, { key: "ArrowUp" });
      expect(input).toHaveAttribute("aria-activedescendant", at(1).id);
    });

    it("adds the active option on Enter", () => {
      const onAdd = vi.fn();
      renderPicker({ options, query: "s", onAdd });
      const input = screen.getByRole("combobox");
      fireEvent.keyDown(input, { key: "ArrowDown" });
      fireEvent.keyDown(input, { key: "ArrowDown" });
      fireEvent.keyDown(input, { key: "Enter" });
      expect(onAdd).toHaveBeenCalledWith(entry(4, "Issue#4", "Late sign-off"));
    });

    // ★ These pickers live inside <form> edit modals, where a bare Enter
    // submits. Swallowing Enter whenever the list happens to be open would
    // silently break submitting from this field; only an ARMED option claims it.
    it("leaves Enter alone when no option is active", () => {
      const onAdd = vi.fn();
      renderPicker({ options, query: "s", onAdd });
      const input = screen.getByRole("combobox");
      const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
      fireEvent(input, event);
      expect(onAdd).not.toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(false);
    });

    it("dismisses the dropdown on Escape and marks the event consumed", () => {
      // ★★ Asserts defaultPrevented, NOT that a document listener went unheard.
      // The enclosing Modal is contained by bailing on `e.defaultPrevented`,
      // because stopPropagation cannot reach it: React 19 delegates on
      // `document` — the same node Modal listens on — and stopPropagation does
      // not suppress a co-registered listener there.
      // ★ A "no document listener fired" assertion PASSES here for the wrong
      // reason: RTL renders into a div under body, so React's listener sits on
      // a descendant and propagation really does stop. That topology is not the
      // app's, so such a test proves nothing about production. This one pins the
      // property the real mechanism depends on; modal.test.tsx pins the other
      // half (that Modal honours it).
      renderPicker({ options, query: "s" });
      const input = screen.getByRole("combobox");

      const open = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
      fireEvent(input, open);
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
      expect(input).toHaveAttribute("aria-expanded", "false");
      expect(open.defaultPrevented).toBe(true);

      // Closed already: this Escape is not ours, so it must be left for the
      // modal to act on.
      const closed = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
      fireEvent(input, closed);
      expect(closed.defaultPrevented).toBe(false);
    });

    // Named for what it asserts: the REOPEN. Dropping the active option is the
    // dedicated test below, which reaches it without Escape (Escape clears the
    // highlight itself, so asserting both here would prove only the Escape).
    it("reopens a dismissed dropdown when the query changes", () => {
      const { rerender, props } = renderPicker({ options, query: "s" });
      const input = screen.getByRole("combobox");
      fireEvent.keyDown(input, { key: "ArrowDown" });
      fireEvent.keyDown(input, { key: "Escape" });
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();

      rerender(<EntityLinkPicker {...props} options={options} query="sc" />);
      expect(screen.getByRole("listbox")).toBeInTheDocument();
    });

    // ★ Split from the reopen case above deliberately: that one presses Escape
    // first, and Escape ALREADY clears the highlight, so it passes even with
    // the render-time reconcile's own reset deleted. This is the reconcile's
    // real job — a new query with a same-LENGTH option list, where the clamp on
    // read cannot help because the index is still in range but now names a
    // DIFFERENT entity.
    it("drops the active option when the query changes, with no Escape involved", () => {
      const others = [entry(11, "Risk#11", "Vendor delay"), entry(12, "Issue#12", "Late sign-off")];
      const { rerender, props } = renderPicker({ options, query: "s" });
      const input = screen.getByRole("combobox");
      fireEvent.keyDown(input, { key: "ArrowDown" });
      expect(input).toHaveAttribute("aria-activedescendant");

      rerender(<EntityLinkPicker {...props} options={others} query="ven" />);
      expect(screen.getAllByRole("option")).toHaveLength(2); // same length, new entities
      expect(input).not.toHaveAttribute("aria-activedescendant");
    });

    it("does not add a carried-over entity when Enter follows a query change", () => {
      // The consequence of the above if the reconcile is dropped: the user
      // types on and hits Enter, and an entity they never highlighted is added.
      const onAdd = vi.fn();
      const others = [entry(11, "Risk#11", "Vendor delay"), entry(12, "Issue#12", "Late sign-off")];
      const { rerender, props } = renderPicker({ options, query: "s", onAdd });
      const input = screen.getByRole("combobox");
      fireEvent.keyDown(input, { key: "ArrowDown" });
      rerender(<EntityLinkPicker {...props} options={others} query="ven" onAdd={onAdd} />);
      fireEvent.keyDown(input, { key: "Enter" });
      expect(onAdd).not.toHaveBeenCalled();
    });

    // The caller re-filters `options` on every keystroke, so an index kept
    // across a shrink would point past the end (or at a different entity).
    it("drops an active option that the shrinking option list no longer has", () => {
      const { rerender, props } = renderPicker({ options, query: "s" });
      const input = screen.getByRole("combobox");
      fireEvent.keyDown(input, { key: "ArrowDown" });
      fireEvent.keyDown(input, { key: "ArrowDown" });
      expect(input).toHaveAttribute("aria-activedescendant");

      rerender(<EntityLinkPicker {...props} options={[options[0]]} query="s" />);
      expect(input).not.toHaveAttribute("aria-activedescendant");
      expect(screen.getAllByRole("option")[0]).toHaveAttribute("aria-selected", "false");
    });

    it("marks the active option without relying on a text colour", () => {
      // ★ The active row used to be `bg-surface-muted text-ui-dark-blue`. That
      // navy sits on a dark --surface-muted at ~1.0-1.2:1 in every dark scheme,
      // so the arrowed-to option was marked by its own text vanishing — and the
      // background alone cannot carry it either, being ~1.1:1 against the
      // dropdown surface AND the inactive rows' hover colour. Asserting the
      // absence of the colour is the point: a scheme-independent cue is the fix.
      renderPicker({ options, query: "s" });
      const input = screen.getByRole("combobox");
      fireEvent.keyDown(input, { key: "ArrowDown" });
      const active = screen.getAllByRole("option")[0];
      expect(active.className).not.toContain("text-ui-dark-blue");
      expect(active.className).toContain("text-foreground");
      expect(active.className).toContain("font-medium");
      // ★ The ring must be --foreground, never a brand accent. An accent is
      // tuned for one mode: ring-ui-green is 6.0-7.9:1 on the dark row fills but
      // 1.7-2.1:1 on the light ones — under 1.4.11's 3:1 for a non-text state
      // indicator, which would leave light schemes on font-weight alone.
      // --foreground clears 3:1 in every scheme (12-15:1 in the built-ins,
      // 4.79:1 in AIPM/Mockup light). That ratio is pinned per-scheme by
      // scheme-contrast-cues.test.ts; this only pins WHICH token is used.
      expect(active.className).toContain("ring-foreground");
      expect(active.className).not.toMatch(/ring-ui-/);
    });

    it("reopens a dismissed dropdown when the field is clicked again", () => {
      // Escape used to leave the list unreachable until the query changed, so
      // clicking back into a field with text in it showed no matches.
      const { rerender, props } = renderPicker({ options, query: "s" });
      const input = screen.getByRole("combobox");
      fireEvent.keyDown(input, { key: "Escape" });
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
      fireEvent.click(input);
      rerender(<EntityLinkPicker {...props} options={options} query="s" />);
      expect(screen.getByRole("listbox")).toBeInTheDocument();
    });

    it("keeps Escape sticky across a focus round-trip", () => {
      // ★ The reason the reopen rides onClick and not onFocus. Tabbing away and
      // back is not a request to reopen; if it were, a dismissed list would pop
      // back over the form with no way to shut it but clearing the query.
      const { rerender, props } = renderPicker({ options, query: "s" });
      const input = screen.getByRole("combobox");
      fireEvent.keyDown(input, { key: "Escape" });
      fireEvent.focus(input);
      rerender(<EntityLinkPicker {...props} options={options} query="s" />);
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
      // ...but the keyboard is never stuck: ArrowDown reopens (APG).
      fireEvent.keyDown(input, { key: "ArrowDown" });
      expect(screen.getByRole("listbox")).toBeInTheDocument();
    });

    it("keeps the input focused when an option is clicked", () => {
      // Commit-on-blur callers close on blur; without this the add lands on an
      // already-closed editor and is swallowed (the ResourcePicker precedent).
      renderPicker({ options, query: "s" });
      const option = screen.getAllByRole("option")[0];
      const event = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
      fireEvent(option, event);
      expect(event.defaultPrevented).toBe(true);
    });
  });

  it("distinguishes two entries that share an id but not a key", async () => {
    const user = userEvent.setup();
    const onRemove = vi.fn();
    render(
      <EntityLinkPicker
        selected={[
          { key: "task:7", id: 7, code: "#7", label: "Kickoff" },
          { key: "raid:7", id: 7, code: "R#7", label: "Vendor delay" },
        ]}
        options={[]}
        query=""
        onQueryChange={() => {}}
        onAdd={() => {}}
        onRemove={onRemove}
        searchLabel="Search"
        placeholder="Search"
        removeLabel="Unlink"
        clearLabel="Clear"
      />,
    );
    await user.click(screen.getByRole("button", { name: "Unlink R#7 Vendor delay" }));
    expect(onRemove).toHaveBeenCalledWith(expect.objectContaining({ key: "raid:7" }));
  });
});
