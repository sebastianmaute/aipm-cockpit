import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AssetLibrary } from "./asset-library";
import { ConfirmProvider } from "./confirm-dialog";
import { t } from "./i18n";
import { expectRowUniqueNames } from "../test/row-unique-names";

// ★★★ BOTH ROWS DELIBERATELY SHARE A NAME, AND THE SUITE IS WORTHLESS
//     OTHERWISE. This fixture used to be `chart.png` / `logo.png`, which made
//     the row-unique-name test below pass whether or not production could
//     produce a collision — it asserted a property of the FIXTURE. A same-name
//     pair is a real production state, reachable three ways: upload takes
//     `file.name` verbatim and Chrome names EVERY pasted clipboard image
//     `image.png`; `findDuplicate` is hash-only, so two DIFFERENT images with
//     one filename both get rows; and rename accepts a name already in use.
//     Rows are therefore selected BY ID throughout this file, never by name.
const assets = [
  { id: "a1", name: "image.png", mime: "image/png", size: 2048, width: 800, height: 600, hash: "h1", createdAt: "2026-08-21T10:00:00.000Z" },
  { id: "a2", name: "image.png", mime: "image/png", size: 1024, width: 100, height: 100, hash: "h2", createdAt: "2026-08-21T10:00:00.000Z" },
];

const base = {
  lang: "en-US" as const,
  assets,
  usage: { a1: 3, a2: 0 },
  danglingIds: new Set<string>(),
  busyId: null,
  onRename: vi.fn(),
  onDelete: vi.fn(),
  onInsert: undefined,
  onUpload: vi.fn(),
};

/** The body row for `id`. Located by DOM ORDER (sorting is off, so it matches
 *  the fixture order), deliberately NOT by a control's accessible name — a
 *  helper that reads the label would couple every test in this file to the
 *  very format under test, and a mutation to `rowLabel` would then fail the
 *  LOOKUP rather than the assertion it is supposed to prove. */
function rowFor(id: string): HTMLElement {
  const index = assets.findIndex((a) => a.id === id);
  // getAllByRole("row") includes the header row, hence the +1.
  const row = within(screen.getByRole("table")).getAllByRole("row")[index + 1];
  if (!row) throw new Error(`no row for ${id}`);
  return row;
}

describe("AssetLibrary", () => {
  // ★★★ THE ONLY DETECTOR THAT WILL EVER EXIST. axe cannot see two controls
  //     sharing an accessible name — in ANY view, at ANY seed size — so this
  //     test, rendering two rows THAT SHARE A NAME, is the entire coverage for
  //     WCAG 2.4.6 here. Mutation-proved: make `buildRowTokens` return the
  //     bare name and this goes red.
  it("gives every per-row control a row-unique accessible name", () => {
    render(<AssetLibrary {...base} onInsert={vi.fn()} />);
    for (const verb of [/rename/i, /delete/i, /insert/i]) {
      const names = screen.getAllByRole("button", { name: verb }).map((b) => b.getAttribute("aria-label"));
      expect(names).toHaveLength(2);
      expect(new Set(names).size).toBe(names.length);
      // Both rows carry the SAME asset name, so the name cannot be what
      // disambiguates — the occurrence index is.
      expect(names.every((n) => n?.includes("image.png"))).toBe(true);
      expect(names.some((n) => n?.endsWith("image.png (1)"))).toBe(true);
      expect(names.some((n) => n?.endsWith("image.png (2)"))).toBe(true);
    }
    expectRowUniqueNames({ minControls: 6, requireCollisionSeed: true });
  });

  // ★★★ THE OTHER HALF OF THE SAME GUARD, and it is the half that rots. The
  //     disambiguator is applied ONLY where a name is actually ambiguous, so
  //     the common case must stay CLEAN — a bare "Delete – chart.png". Without
  //     this test, "only when ambiguous" is untested behaviour and the next
  //     reader "simplifies" it to an unconditional suffix with the suite still
  //     green. The exact-string `name` below is a full-string match, so any
  //     appended "(1)" fails it; the regex sweep then covers every control.
  it("adds no disambiguator when a name is unique in the list", () => {
    const distinct = [
      { ...assets[0], name: "chart.png" },
      { ...assets[1], name: "logo.png" },
    ];
    render(<AssetLibrary {...base} assets={distinct} onInsert={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Delete – chart.png" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rename – logo.png" })).toBeInTheDocument();
    for (const control of screen.getAllByRole("button")) {
      expect(control.getAttribute("aria-label") ?? "").not.toMatch(/\(\d+\)$/);
    }
  });

  // ★★ Rename accepts ANY string, so a row can be named literally like a
  //    GENERATED token. Here the pair yields "image.png (1)"/"image.png (2)"
  //    while a third row is already called "image.png (1)" — the naive
  //    occurrence index would re-create the very collision it exists to close.
  //    Mutation-proved: delete the escalation branch in `buildRowTokens` and
  //    this goes red.
  it("stays unique when a row is named like a generated disambiguator", () => {
    const colliding = [
      { ...assets[0], id: "c1", name: "image.png" },
      { ...assets[1], id: "c2", name: "image.png" },
      { ...assets[0], id: "c3", name: "image.png (1)" },
    ];
    render(<AssetLibrary {...base} assets={colliding} usage={{}} />);
    const names = screen
      .getAllByRole("button", { name: /delete/i })
      .map((b) => b.getAttribute("aria-label"));
    expect(names).toHaveLength(3);
    expect(new Set(names).size).toBe(3);
  });

  // ★★ WCAG 2.5.3 — the accessible name must CONTAIN the visible text
  //    (containment, case-insensitive; NOT prefix). axe ships
  //    `label-content-name-mismatch` but it is `experimental` and excluded by
  //    the gate's default tagExclude, so this is the only detector too. It
  //    pins that the id/name suffix stays a SUFFIX and the verb stays first.
  it("keeps each row control's visible text inside its accessible name", () => {
    render(<AssetLibrary {...base} onInsert={vi.fn()} />);
    // Body rows only — the header's sort buttons carry no aria-label, so
    // their accessible name IS their visible text and 2.5.3 holds trivially.
    const controls = ["a1", "a2"].flatMap((id) => within(rowFor(id)).getAllByRole("button"));
    expect(controls).toHaveLength(6); // insert + rename + delete, twice
    for (const control of controls) {
      const visible = (control.textContent ?? "").trim();
      expect(visible).not.toBe("");
      const name = control.getAttribute("aria-label");
      expect(name).not.toBeNull();
      expect(name?.toLowerCase()).toContain(visible.toLowerCase());
    }
  });

  it("shows how many documents use each asset", () => {
    render(<AssetLibrary {...base} />);
    expect(within(rowFor("a1")).getByText("3")).toBeInTheDocument();
    expect(within(rowFor("a2")).getByText("0")).toBeInTheDocument();
  });

  // ★★ Not colour alone: the dangling state carries a non-colour marker, the
  //    same rule ResourcePicker's data-dangling-marker follows.
  it("marks a dangling asset with a non-colour cue", () => {
    render(<AssetLibrary {...base} danglingIds={new Set(["a1"])} />);
    expect(rowFor("a1").querySelector("[data-dangling-marker]")).not.toBeNull();
  });

  // ★★★ The glyph is sighted-only and `title` on a non-interactive,
  //     non-focusable span exposes NO accessible name — so without this text a
  //     screen-reader user cannot tell a broken asset from a healthy one.
  //     Mutation-proved: delete the sr-only span and this goes red.
  it("announces the dangling state to assistive tech", () => {
    render(<AssetLibrary {...base} danglingIds={new Set(["a1"])} />);
    const label = t("en-US", "assetLibraryDangling");
    expect(within(rowFor("a1")).getByText(label)).toBeInTheDocument();
    // ★ sr-only, never display:none — a display:none node is out of the a11y
    //   tree and would announce nothing.
    expect(within(rowFor("a1")).getByText(label).className).toContain("sr-only");
    expect(within(rowFor("a2")).queryByText(label)).toBeNull();
  });

  it("does not mark a healthy asset", () => {
    render(<AssetLibrary {...base} />);
    expect(rowFor("a2").querySelector("[data-dangling-marker]")).toBeNull();
  });

  it("renders no insert control when no insert handler is supplied", () => {
    render(<AssetLibrary {...base} onInsert={undefined} />);
    expect(screen.queryByRole("button", { name: /insert/i })).toBeNull();
  });

  it("disables that row's controls while it is busy, and only that row", () => {
    render(<AssetLibrary {...base} busyId="a1" />);
    expect(screen.getByRole("button", { name: /delete.*\(1\)/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /delete.*\(2\)/i })).toBeEnabled();
  });

  // ★★★ WCAG 2.4.3 — leaving rename mode unmounts the focused Confirm/Cancel
  //     button, dropping focus to <body>. `.focus()` in a test never proves
  //     focusability, so these drive the real interaction with userEvent and
  //     assert on document.activeElement. Mutation-proved: drop either
  //     `restoreFocusId.current = asset.id` and the matching test goes red.
  it("returns focus to the row's rename button after committing a rename", async () => {
    const user = userEvent.setup();
    const onRename = vi.fn();
    render(<AssetLibrary {...base} onRename={onRename} />);
    await user.click(screen.getByRole("button", { name: /rename.*\(1\)/i }));
    const field = screen.getByRole("textbox", { name: /rename.*\(1\)/i });
    await user.clear(field);
    await user.type(field, "renamed.png");
    await user.click(screen.getByRole("button", { name: /confirm.*\(1\)/i }));
    expect(onRename).toHaveBeenCalledWith("a1", "renamed.png");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: /rename.*\(1\)/i }));
  });

  it("returns focus to the row's rename button after cancelling a rename", async () => {
    const user = userEvent.setup();
    const onRename = vi.fn();
    render(<AssetLibrary {...base} onRename={onRename} />);
    await user.click(screen.getByRole("button", { name: /rename.*\(2\)/i }));
    await user.click(screen.getByRole("button", { name: /cancel.*\(2\)/i }));
    expect(onRename).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: /rename.*\(2\)/i }));
  });

  // ★ Delete is confirm-gated INSIDE AssetLibrary (see the component's own
  // docstring) — the confirm message needs the usage count, and this
  // component is the one place that already holds both `assets` and `usage`
  // together, so the gate cannot live one layer out without duplicating that
  // text-building logic at both mounting sites (Tasks 16-17). Driving the
  // confirmation is therefore part of exercising this call, mirroring how
  // `activity-log-panel.test.tsx` drives the branded ConfirmProvider for its
  // own confirm-gated Clear button.
  it("calls onDelete with the asset id once the confirm dialog is accepted", async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn();
    render(
      <ConfirmProvider lang="en-US">
        <AssetLibrary {...base} onDelete={onDelete} />
      </ConfirmProvider>,
    );
    await user.click(screen.getByRole("button", { name: /delete.*\(1\)/i }));
    expect(onDelete).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: t("en-US", "confirm") }));
    expect(onDelete).toHaveBeenCalledWith("a1");
  });

  it("does not call onDelete when the confirm dialog is cancelled", async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn();
    render(
      <ConfirmProvider lang="en-US">
        <AssetLibrary {...base} onDelete={onDelete} />
      </ConfirmProvider>,
    );
    await user.click(screen.getByRole("button", { name: /delete.*\(1\)/i }));
    await user.click(screen.getByRole("button", { name: t("en-US", "cancel") }));
    expect(onDelete).not.toHaveBeenCalled();
  });

  it("shows a total size disclosure", () => {
    render(<AssetLibrary {...base} />);
    expect(screen.getByText(/3(\.0)? KB|3072/)).toBeInTheDocument();
  });

  // ★★★ i18n — `toFixed(1)` hard-codes a `.`, so German rendered "3.0 KB"
  //     where "3,0 KB" is correct. The separator comes from Intl, never from a
  //     hand-rolled swap. Mutation-proved: restore `toFixed(1)` and the German
  //     assertions go red while the English ones stay green — which is exactly
  //     why the English row alone could never have caught this.
  it("formats sizes with the active language's decimal separator", () => {
    const { unmount } = render(<AssetLibrary {...base} />);
    expect(within(rowFor("a1")).getByText("2.0 KB")).toBeInTheDocument();
    expect(within(rowFor("a2")).getByText("1.0 KB")).toBeInTheDocument();
    unmount();

    // ★ Only the NUMBER is asserted — the DE dictionary is lazy and never
    //   loaded here, so the surrounding strings stay on the EN fallback. The
    //   separator does not come from the dictionary.
    render(<AssetLibrary {...base} lang="de" />);
    expect(within(rowFor("a1")).getByText("2,0 KB")).toBeInTheDocument();
    expect(within(rowFor("a2")).getByText("1,0 KB")).toBeInTheDocument();
    expect(screen.getByText(/3,0 KB/)).toBeInTheDocument();
  });

  it("renders an empty state rather than a headerless table", () => {
    render(<AssetLibrary {...base} assets={[]} usage={{}} />);
    expect(screen.queryByRole("table")).toBeNull();
  });
});
