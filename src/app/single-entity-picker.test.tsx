import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SingleEntityPicker, type SingleEntityOption } from "./single-entity-picker";

const OPTIONS: SingleEntityOption[] = [
  { value: "task:1", code: "Task", label: "Ship the release" },
  { value: "raid:2", code: "RAID", label: "Vendor delay" },
];

function renderPicker(overrides: Partial<Parameters<typeof SingleEntityPicker>[0]> = {}) {
  const props = {
    value: "",
    options: OPTIONS,
    query: "",
    onQueryChange: vi.fn(),
    onSelect: vi.fn(),
    searchLabel: "Attach to",
    placeholder: "Search…",
    clearLabel: "Clear – Attach to",
    emptyLabel: "—",
    ...overrides,
  };
  return { props, ...render(<SingleEntityPicker {...props} />) };
}

describe("SingleEntityPicker", () => {
  it("names its search box and exposes the combobox role", () => {
    renderPicker();
    // A placeholder is NOT an accessible name — it fails the axe gate.
    expect(screen.getByRole("combobox", { name: "Attach to" })).toBeInTheDocument();
  });

  // ★★ THE THREE ATTRIBUTES NOTHING ELSE PINNED. `aria-autocomplete`, `type`
  // and the `size` variant now live in the shared `EntityComboboxSearch`
  // (`entity-combobox-search.tsx`), so ONE deletion there strips them from
  // BOTH pickers at once, and nothing else would say so: no other unit test
  // greps for them and the axe gate cannot help — neither picker is reachable
  // from an `A11Y_VIEWS` scan.
  //
  // ★★ THE TWO `size` RENDERS ARE NOT REDUNDANT, and dropping either leaves a
  // live mutant. `fieldClass` (`form-controls.tsx`) DEFAULTS to `md`, so a
  // deleted `size={inputSize}` still renders `md` — invisible here and caught
  // only by the `xs` render. Conversely a HARDCODED `size="xs"` is invisible
  // to the `xs` render and caught only by the non-default `md` one, which is
  // what proves the prop is threaded rather than merely present.
  it("wires the search input's autocomplete, type and size variant", () => {
    const { props, rerender } = renderPicker({ inputSize: "md" });
    const box = screen.getByRole("combobox");
    expect(box).toHaveAttribute("aria-autocomplete", "list");
    expect(box).toHaveAttribute("type", "text");
    // FIELD_SIZE: md is `px-3 py-2 text-sm`, xs is `px-2 py-1 text-xs`.
    expect(box.className).toContain("text-sm");
    rerender(<SingleEntityPicker {...props} inputSize="xs" />);
    expect(screen.getByRole("combobox").className).toContain("text-xs");
  });

  // ★★ The other half of `EntityComboboxSearch` that carries a written reason
  // and nothing enforcing it here. `pr-8` is ~2rem of padding reserving room
  // for the overlaid ✕, so it rides the SAME condition the ✕ does — applied
  // unconditionally it shaves that much off the visible placeholder in the
  // EMPTY state, which is the common one (the TableFilter / PaneSearchInput
  // precedent).
  // ★ BOTH branches, deliberately: asserting only the presence passes against
  // an unconditional class, which is the exact mutant.
  it("reserves the clear gutter only while there is something to clear", () => {
    const { unmount } = renderPicker({ query: "a" });
    expect(screen.getByRole("combobox").className).toContain("pr-8");
    unmount();

    renderPicker({ query: "" });
    expect(screen.getByRole("combobox").className).not.toContain("pr-8");
    expect(screen.queryByRole("button", { name: /clear/i })).not.toBeInTheDocument();
  });

  it("keeps the listbox closed while the query is blank", () => {
    renderPicker();
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(screen.getByRole("combobox")).toHaveAttribute("aria-expanded", "false");
  });

  it("opens the listbox once a query has options", () => {
    renderPicker({ query: "ship" });
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    expect(screen.getAllByRole("option")).toHaveLength(2);
  });

  it("selects with a click", async () => {
    const user = userEvent.setup();
    const { props } = renderPicker({ query: "ship" });
    await user.click(screen.getByRole("option", { name: /Ship the release/ }));
    expect(props.onSelect).toHaveBeenCalledWith("task:1");
  });

  it("arrows to an option and commits it with Enter", async () => {
    const user = userEvent.setup();
    const { props } = renderPicker({ query: "a" });
    const box = screen.getByRole("combobox");
    box.focus();
    await user.keyboard("{ArrowDown}");
    expect(box).toHaveAttribute("aria-activedescendant", screen.getAllByRole("option")[0].id);
    await user.keyboard("{Enter}");
    expect(props.onSelect).toHaveBeenCalledWith("task:1");
  });

  // ★★ THE WIRING ASSERTION. `entity-combobox.test.tsx` proves the shared hook
  // is correct; it cannot prove THIS component calls it — a seam test cannot see
  // a break above it. Without this, the hook call could be deleted and a local
  // copy reinstated with every other test in this file still green.
  // ★ TWO ArrowDowns, and the SECOND option is what must commit: a test that
  // commits the FIRST passes against an implementation where ArrowDown does
  // nothing at all.
  it("routes the keyboard path through the shared combobox hook", async () => {
    const user = userEvent.setup();
    const { props } = renderPicker({ query: "a" });
    const box = screen.getByRole("combobox");
    box.focus();
    await user.keyboard("{ArrowDown}{ArrowDown}");
    expect(box).toHaveAttribute("aria-activedescendant", screen.getAllByRole("option")[1].id);
    await user.keyboard("{Enter}");
    expect(props.onSelect).toHaveBeenCalledWith("raid:2");
  });

  // ★ Enter must NOT be swallowed unless an option is actually armed. This
  // control sits inside forms where a bare Enter submits; claiming Enter merely
  // because a dropdown is open would silently break submitting from this field.
  it("leaves Enter alone when no option is armed", async () => {
    const user = userEvent.setup();
    const { props } = renderPicker({ query: "a" });
    const box = screen.getByRole("combobox");
    box.focus();
    await user.keyboard("{Enter}");
    expect(props.onSelect).not.toHaveBeenCalled();
    // ★★ `onSelect` staying uncalled is only HALF the claim, and it is the half
    // a broken guard satisfies for the wrong reason: without the armed check,
    // `options[-1].value` THROWS before onSelect is ever reached, so the
    // assertion above passes while React reports an unhandled error and the
    // suite summary still reads green. The claim that matters is that Enter is
    // not CLAIMED — `defaultPrevented` on a hand-built event is the direct
    // observable for "a bare Enter still reaches the enclosing form", and it is
    // the spelling the multi-select sibling uses throughout.
    const bare = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    fireEvent(box, bare);
    expect(bare.defaultPrevented).toBe(false);
  });

  it("closes on Escape without clearing the query", async () => {
    const user = userEvent.setup();
    const { props } = renderPicker({ query: "a" });
    screen.getByRole("combobox").focus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(props.onQueryChange).not.toHaveBeenCalled();
  });

  // ★★ Deliberately Escape-FREE. Escape clears the highlight itself, so folding
  // this into the test above would pass with the render-time reconcile's own
  // `setHighlight(-1)` deleted. This is the reconcile's real job: a new query
  // whose option list is the SAME LENGTH, where the clamp on read cannot help
  // because the index is still in range but now names a DIFFERENT entity.
  it("drops a stale highlight when the query changes, with no Escape involved", () => {
    const others: SingleEntityOption[] = [
      { value: "task:9", code: "Task", label: "Vendor delay" },
      { value: "raid:8", code: "RAID", label: "Late sign-off" },
    ];
    const { rerender, props } = renderPicker({ query: "a" });
    const box = screen.getByRole("combobox");
    fireEvent.keyDown(box, { key: "ArrowDown" });
    expect(box).toHaveAttribute("aria-activedescendant");

    rerender(<SingleEntityPicker {...props} options={others} query="ven" />);
    expect(screen.getAllByRole("option")).toHaveLength(2); // same length, new entities
    expect(box).not.toHaveAttribute("aria-activedescendant");

    // The consequence if the reconcile is dropped, and the reason this is a
    // data-correctness test rather than a cosmetic one: the user types on, hits
    // Enter, and an entity they never highlighted is committed.
    fireEvent.keyDown(box, { key: "Enter" });
    expect(props.onSelect).not.toHaveBeenCalled();
  });

  // The caller re-filters `options` on every keystroke, so an index kept across
  // a shrink would point past the end of the new list.
  it("drops an active option that the shrinking option list no longer has", () => {
    const { rerender, props } = renderPicker({ query: "a" });
    const box = screen.getByRole("combobox");
    fireEvent.keyDown(box, { key: "ArrowDown" });
    fireEvent.keyDown(box, { key: "ArrowDown" });
    expect(box).toHaveAttribute("aria-activedescendant", screen.getAllByRole("option")[1].id);

    rerender(<SingleEntityPicker {...props} options={[OPTIONS[0]]} query="a" />);
    expect(box).not.toHaveAttribute("aria-activedescendant");
    expect(screen.getAllByRole("option")[0]).toHaveAttribute("aria-selected", "false");
    fireEvent.keyDown(box, { key: "Enter" });
    expect(props.onSelect).not.toHaveBeenCalled();
  });

  // ★★ The case NEITHER of the two above can see: the list GROWS under a
  // standing query, so the stale index stays in RANGE and the reconcile never
  // fires. On the multi-select sibling this was a shipped defect — every caller
  // derives `options` by excluding its selected set, `filterPickerOptions`
  // preserves source order, so unlinking a chip put the entity back at its
  // source position and Enter re-added the entity just removed. The identical
  // mechanism is pinned here too. The grow is driven by `rerender` rather than
  // by a chip, matching the two tests above.
  const GROWN: SingleEntityOption[] = [
    { value: "task:0", code: "Task", label: "Earlier arrival" },
    ...OPTIONS,
  ];

  it("does not commit an option the growing list shifted under the highlight", () => {
    const { rerender, props } = renderPicker({ query: "a" });
    const box = screen.getByRole("combobox");
    fireEvent.keyDown(box, { key: "ArrowDown" });
    fireEvent.keyDown(box, { key: "ArrowDown" });
    // Armed: index 1 of OPTIONS == raid:2. Load-bearing anti-vacuity — without
    // these a fixture whose armed index happened not to shift would pass for
    // the wrong reason.
    expect(screen.getAllByRole("option")[1]).toHaveAttribute("aria-selected", "true");
    expect(screen.getAllByRole("option")[1]).toHaveTextContent("Vendor delay");

    rerender(<SingleEntityPicker {...props} options={GROWN} query="a" />);
    // Index 1 now names task:1 — an option the user never armed.
    expect(screen.getAllByRole("option")).toHaveLength(3);
    expect(screen.getAllByRole("option")[1]).toHaveTextContent("Ship the release");

    fireEvent.keyDown(box, { key: "Enter" });
    // Before the identity check this committed `task:1`. The highlight is now
    // disarmed instead, so Enter falls through to the enclosing form exactly as
    // it does when nothing was ever armed. It does NOT follow raid:2 to its new
    // index 2 — re-tracking would make the ring jump rows on someone else's
    // edit, and the test below pins the same disarm on the VISIBLE channel.
    expect(props.onSelect).not.toHaveBeenCalled();
  });

  it("drops the highlight the moment a growing option list shifts it", () => {
    // The half that needs no further keystroke: `aria-selected` and
    // `aria-activedescendant` would name the wrong row as soon as the list
    // re-rendered, misleading a mouse user who clicks the ringed row.
    const { rerender, props } = renderPicker({ query: "a" });
    const box = screen.getByRole("combobox");
    fireEvent.keyDown(box, { key: "ArrowDown" });
    fireEvent.keyDown(box, { key: "ArrowDown" });
    expect(box).toHaveAttribute("aria-activedescendant", screen.getAllByRole("option")[1].id);

    rerender(<SingleEntityPicker {...props} options={GROWN} query="a" />);
    expect(screen.getAllByRole("option")).toHaveLength(3);
    expect(screen.getAllByRole("option")[1]).toHaveTextContent("Ship the release");
    expect(box).not.toHaveAttribute("aria-activedescendant");
    for (const option of screen.getAllByRole("option")) {
      expect(option).toHaveAttribute("aria-selected", "false");
    }
  });

  it("claims Escape only while the list is open", () => {
    // ★★ Asserts `defaultPrevented`, NOT that a document listener went unheard.
    // The enclosing Modal is contained by bailing on `e.defaultPrevented`,
    // because stopPropagation cannot reach it: React 19 delegates on
    // `document` — the same node Modal listens on — and stopPropagation does not
    // suppress a co-registered listener there. A "no document listener fired"
    // assertion would pass here for the wrong reason, since RTL renders into a
    // div under body, a topology the real app never has.
    // ★★ ORDERING IS LOAD-BEARING: the FIRST Escape is the open case and
    // dismisses the list, so the SECOND is the already-closed one. Asserting on
    // the wrong one pins the exact opposite of the claim.
    renderPicker({ query: "a" });
    const box = screen.getByRole("combobox");

    const whileOpen = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    fireEvent(box, whileOpen);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(box).toHaveAttribute("aria-expanded", "false");
    expect(whileOpen.defaultPrevented).toBe(true);

    // Closed already: this Escape is not ours, so it must be left for the
    // enclosing modal to act on.
    const whileClosed = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    fireEvent(box, whileClosed);
    expect(whileClosed.defaultPrevented).toBe(false);
  });

  // ★ The POSITIVE half of the reopen: Escape used to leave the list
  // unreachable until the query changed, so clicking back into a field with
  // text in it showed no matches. `fireEvent.click` deliberately, not
  // `userEvent.click` — the latter focuses first, which would satisfy an
  // onFocus implementation too and stop this pair discriminating.
  it("reopens a dismissed dropdown when the field is clicked again", () => {
    const { rerender, props } = renderPicker({ query: "a" });
    const box = screen.getByRole("combobox");
    fireEvent.keyDown(box, { key: "Escape" });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();

    fireEvent.click(box);
    rerender(<SingleEntityPicker {...props} query="a" />);
    expect(screen.getByRole("listbox")).toBeInTheDocument();
  });

  // ★★ THE NEGATIVE HALF, and the reason the reopen rides onCLICK rather than
  // onFocus — a mechanism `entity-combobox-search.tsx` states in a comment and
  // that nothing in THIS file enforced. Escape must STICK: tabbing away to fix
  // something else and coming back is not a request to reopen, and if it were,
  // a dismissed list would pop back over the rest of the form with no way to
  // shut it but clearing the query.
  // ★★ Both spellings are fired and NEITHER is load-bearing on its own — the
  // OBSERVATION is measured (with `onClick` swapped to `onFocus`, deleting
  // either line still turned this red, 2026-09-07), but the reason is NOT the
  // one an earlier revision of this comment gave. It concluded "so RTL's
  // `fireEvent.focus` does reach the handler in this React/RTL pair", which is
  // false and would produce a DEAD focus test wherever someone reused it.
  // ★★★ `fireEvent.focus` NEVER DISPATCHES A LONE `focus`. RTL overrides it to
  // fire the bubbling event first (`@testing-library/react/dist/fire-event.js`,
  // the `fireEvent.focus = (...args) => { fireEvent.focusIn(...args); … }`
  // shim, added for React PR 19186). So React 17+'s `onFocus`-rides-`focusin`
  // premise is intact; both deletions survive because EITHER line alone still
  // delivers a `focusin`. Consequently `fireEvent.focusIn` below is strictly
  // redundant, not belt-and-braces. It stays because the claim being pinned is
  // that no focus round-trip of ANY spelling reopens — read it as two spellings
  // of one event, never as evidence that React catches a bare `focus`.
  it("keeps Escape sticky across a focus round-trip", () => {
    const { rerender, props } = renderPicker({ query: "a" });
    const box = screen.getByRole("combobox");
    fireEvent.keyDown(box, { key: "Escape" });

    fireEvent.focus(box);
    fireEvent.focusIn(box);
    rerender(<SingleEntityPicker {...props} query="a" />);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();

    // ...but the keyboard is never stuck behind an Escape: ArrowDown reopens,
    // which is the APG affordance.
    fireEvent.keyDown(box, { key: "ArrowDown" });
    expect(screen.getByRole("listbox")).toBeInTheDocument();
  });

  it("renders the current selection's label when one is set", () => {
    renderPicker({ value: "raid:2", selectedLabel: "RAID: Vendor delay" });
    expect(screen.getByText("RAID: Vendor delay")).toBeInTheDocument();
  });

  it("shows the empty label when nothing is selected", () => {
    renderPicker({ value: "" });
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});
