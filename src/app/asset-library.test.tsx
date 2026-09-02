import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AssetLibrary } from "./asset-library";
import { ConfirmProvider } from "./confirm-dialog";
import { loadI18n, t } from "./i18n";
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

  // ★★★ §230 — the bytes are PRESENT for a refused mime, so this row is not
  //     dangling and the diff that builds `danglingIds` will never flag it.
  //     Without this the library reports the row healthy while the document
  //     preview renders it as a broken frame: one asset, two panes, opposite
  //     answers. The mime is visible ONLY in the metadata this component
  //     already holds, so this is the one place the state can be derived.
  it("marks a row whose stored mime is no longer supported, and says so distinctly", () => {
    const stale = [{ ...assets[0], name: "old.svg", mime: "image/svg+xml" }];
    render(<AssetLibrary {...base} assets={stale} danglingIds={new Set<string>()} />);
    expect(screen.getByText(t("en-US", "assetLibraryBlocked"))).toBeInTheDocument();
    // ★ Distinct from the dangling wording, not a shared "broken" catch-all —
    //   the two states have different causes and different remedies.
    expect(screen.queryByText(t("en-US", "assetLibraryDangling"))).toBeNull();
    // Non-colour cue, the same rule the dangling marker follows (WCAG 1.4.1),
    // under its OWN attribute so a test cannot confuse the two states.
    expect(rowFor("a1").querySelector("[data-blocked-marker]")).not.toBeNull();
    expect(rowFor("a1").querySelector("[data-dangling-marker]")).toBeNull();
    // ★ §230 — DISCLOSURE ONLY, and this is what pins that decision. The
    //   marker adds no per-row CONTROL: deliberately NO re-upload affordance,
    //   because a healthy duplicate matched by content hash returns early with
    //   no metadata write, so the stale mime would never be corrected and the
    //   button would silently do nothing. It is also why the marker owes no
    //   row-unique accessible name — a non-focusable span is not a control.
    expect(within(rowFor("a1")).getAllByRole("button")).toHaveLength(2); // rename + delete
  });

  it("still reports a dangling row as missing data, not as an unsupported format", () => {
    const ok = [{ ...assets[0], name: "chart.png", mime: "image/png" }];
    render(<AssetLibrary {...base} assets={ok} danglingIds={new Set(["a1"])} />);
    expect(screen.getByText(t("en-US", "assetLibraryDangling"))).toBeInTheDocument();
    expect(screen.queryByText(t("en-US", "assetLibraryBlocked"))).toBeNull();
  });

  // ★★★ PRECEDENCE, and it is the reason the `!isDangling` guard exists. A row
  //     can be both — a refused mime whose bytes ALSO went missing — and it
  //     must report the missing bytes, the more actionable of the two; a row
  //     cannot usefully say both at once. Mutation-proved: drop `!isDangling &&`
  //     from the `isBlocked` line and this test alone goes red, so without it
  //     the guard can be deleted with the suite green.
  it("reports a row that is both dangling and unsupported as missing data only", () => {
    const stale = [{ ...assets[0], name: "old.svg", mime: "image/svg+xml" }];
    render(<AssetLibrary {...base} assets={stale} danglingIds={new Set(["a1"])} />);
    expect(screen.getByText(t("en-US", "assetLibraryDangling"))).toBeInTheDocument();
    expect(screen.queryByText(t("en-US", "assetLibraryBlocked"))).toBeNull();
    expect(rowFor("a1").querySelector("[data-dangling-marker]")).not.toBeNull();
    expect(rowFor("a1").querySelector("[data-blocked-marker]")).toBeNull();
  });

  // ★★★ THE TWO MARKERS MUST NOT SHARE A GLYPH, AND NOTHING ELSE PINS THIS.
  //     They share a COLOUR deliberately — colour is never the discriminator
  //     (WCAG 1.4.1) — which leaves SHAPE as the only channel a sighted user
  //     has for telling a refused format from missing bytes. Give both the same
  //     triangle and the library reproduces, one pane over, the very
  //     can't-tell-these-apart defect §230 was filed for; the first cut of this
  //     row did exactly that, and both states still read identically without
  //     hovering. Compared by RENDERED SVG CONTENT, not by class or component
  //     name: `icons.ts` re-exports lucide under the old heroicons names and
  //     lucide prepends its own `lucide-*` classes, so a rename or a re-alias
  //     must not be able to make this vacuous.
  it("draws a different glyph for a blocked row than for a dangling one", () => {
    const stale = [{ ...assets[0], name: "old.svg", mime: "image/svg+xml" }];
    const first = render(<AssetLibrary {...base} assets={stale} danglingIds={new Set<string>()} />);
    const blockedGlyph = rowFor("a1").querySelector("[data-blocked-marker] svg")?.innerHTML;
    first.unmount();
    render(<AssetLibrary {...base} assets={[{ ...assets[0] }]} danglingIds={new Set(["a1"])} />);
    const danglingGlyph = rowFor("a1").querySelector("[data-dangling-marker] svg")?.innerHTML;
    // Both must actually be present — otherwise `undefined !== undefined` is
    // false and the comparison below would "pass" on two missing markers.
    expect(blockedGlyph).toBeTruthy();
    expect(danglingGlyph).toBeTruthy();
    expect(blockedGlyph).not.toBe(danglingGlyph);
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

describe("AssetLibrary — image preview", () => {
  const TINY_GIF = "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

  it("opens the preview from a row and starts on that row's image", async () => {
    const user = userEvent.setup();
    render(<AssetLibrary {...base} loadImage={vi.fn(async () => TINY_GIF)} />);
    const openers = screen.getAllByRole("button", { name: /^Preview – / });
    expect(openers.length).toBe(base.assets.length);
    await user.click(openers[1]);
    const dialog = await screen.findByRole("dialog");
    // ★ Both fixture rows share the display name "image.png" (see this file's
    //   own note at the top), so the dialog's NAME cannot distinguish which
    //   row opened — both would match. The position indicator can: the
    //   SECOND row's preview control must open on index 1, i.e. "2 of 2".
    expect(within(dialog).getByText(t("en-US", "assetPreviewPosition", 2, 2))).toBeInTheDocument();
  });

  // ★★★ THE SORTED-ORDER CONTRACT, WHICH NOTHING ELSE IN THIS FILE PINS. The
  //     component's own comment says the index is "kept as an index rather
  //     than an id so next/prev walk the SAME order these rows render in" —
  //     but the default sort dir is "off", so `sorted === assets` by identity
  //     in every other test here, and `assets={sorted}` → `assets={assets}`
  //     on the modal was undetectable by the entire suite.
  // ★★ IT MUST ASSERT IDENTITY, NOT POSITION. Both fixture rows are named
  //     "image.png" on purpose, so the dialog heading cannot say which asset
  //     opened and "1 of 2" is a position that is true either way. The loader
  //     argument is the only observable that names the asset — hence
  //     `toHaveBeenCalledWith("a2")`.
  // ★ Sorting by size ASC puts a2 (1024) before a1 (2048), inverting the
  //     fixture order, so row 0 is a2 under sort and a1 without it.
  it("walks the SORTED order, not the incoming asset order", async () => {
    const user = userEvent.setup();
    const loadImage = vi.fn(async () => TINY_GIF);
    render(<AssetLibrary {...base} loadImage={loadImage} />);

    await user.click(screen.getByRole("button", { name: /size/i }));
    // Anti-vacuity: if the click did not sort, row 0 is still a1 and the
    // assertion below would pass against the unsorted list it is meant to
    // rule out. ★ a2's 1024 bytes render as "1.0 KB", NOT "1,024 B" —
    // `formatBytes` branches on `bytes < 1024`, which 1024 fails, so it takes
    // the KB path. a1's 2048 would render "2.0 KB".
    const firstRow = within(screen.getByRole("table")).getAllByRole("row")[1];
    expect(within(firstRow).getByText(/1\.0 KB/)).toBeInTheDocument();

    await user.click(
      within(firstRow).getAllByRole("button").filter((b) => b.textContent?.trim() === t("en-US", "documentsPreview"))[0],
    );
    await screen.findByRole("dialog");
    expect(loadImage).toHaveBeenCalledWith("a2");
  });

  // ★ Without a loader there is nothing to show, so no false affordance.
  it("offers no preview control when no loader is supplied", () => {
    render(<AssetLibrary {...base} />);
    expect(screen.queryByRole("button", { name: /^Preview – / })).toBeNull();
  });

  // ★★★ Row-unique naming (WCAG 2.4.6) is mandatory here and axe cannot
  //     detect a violation in any view at any seed size (see AGENTS.md) — a
  //     unit test is the only possible detector. This checks the preview
  //     control specifically, alongside every other per-row control AND the
  //     toolbar's own Upload/sort-header buttons, so a naming scheme that
  //     collides the preview verb with an unrelated control would still be
  //     caught.
  it("keeps the preview control's accessible name row-unique from every other control", () => {
    const { container } = render(
      <AssetLibrary {...base} onInsert={vi.fn()} loadImage={vi.fn(async () => TINY_GIF)} />,
    );
    expectRowUniqueNames({ scope: container, minControls: 11, requireCollisionSeed: true });
  });

  // ★★★ THE ONLY DETECTOR THIS DEFECT WILL EVER HAVE, AND AN EN-ONLY TEST
  //     CANNOT BE IT. The shipped code read `aria-label={t(lang,
  //     "assetPreviewOpen", token)}` against a visible `documentsPreview`, and
  //     those are two INDEPENDENTLY AUTHORED keys. In EN they happen to
  //     contain one another ("Preview" ⊂ "Preview image – …") so every test in
  //     this file passed; in DE they do not ("Vorschau" ⊄ "Bild anzeigen – …")
  //     and the control was a straight WCAG 2.5.3 failure — a German speech-
  //     input user saying the label printed on the button could not activate
  //     it. Rendering in `de` is what makes this test able to fail at all.
  // ★★ NO GATE AS CONFIGURED CATCHES IT. axe ships `label-content-name-mismatch` and
  //     it carries `wcag21a`, so a rule listing reads as coverage — but it is
  //     also tagged `experimental` and axe's default tagExclude is
  //     `experimental,deprecated`, so the tag-only runOnly in `e2e/a11y.spec.ts`
  //     never RUNS it. This surface is Turso-gated besides, so the gate never
  //     renders it in any view at any seed size.
  // ★★ 2.5.3 containment is case-INSENSITIVE and position-INDEPENDENT
  //     (Understanding SC 2.5.3, "Punctuation and capitalization"), so this
  //     asserts containment, NOT a prefix — a prefix test is STRICTER than the
  //     SC and would flag conformant code.
  // ★ Both languages are asserted so a future edit cannot fix one and break
  //     the other silently. Mutation: restore `t(lang, "assetPreviewOpen",
  //     token)` as the aria-label and the `de` case goes red while `en-US`
  //     stays green — which is precisely the shape that shipped.
  it.each(["en-US", "de"] as const)(
    "contains the visible label inside the preview control's accessible name (%s)",
    async (lang) => {
      await loadI18n(lang);
      render(<AssetLibrary {...base} lang={lang} loadImage={vi.fn(async () => TINY_GIF)} />);
      const visible = t(lang, "documentsPreview");
      // Anti-vacuity: a blank visible label is contained in everything.
      expect(visible.trim().length).toBeGreaterThan(0);
      // ★★★ LOCATED BY VISIBLE TEXT, NEVER BY THE ACCESSIBLE NAME'S FORMAT.
      //     The first cut of this test selected on `^${visible} – `, and that
      //     made it a LABEL-FORMAT test wearing a containment test's name:
      //     under the mutant below the selector matched nothing, so BOTH
      //     languages died at this length check and the `toContain` assertion
      //     — the only line that is actually about 2.5.3 — never ran. It also
      //     failed EN, which genuinely CONFORMS. `getByRole`'s `name` reads the
      //     accessible name, so it cannot be used here at all; the visible
      //     string is the one thing the SC compares that is independent of how
      //     the name is built.
      const openers = screen
        .getAllByRole("button")
        .filter((b) => b.textContent?.trim() === visible);
      expect(openers).toHaveLength(base.assets.length);
      for (const b of openers) {
        const accessible = b.getAttribute("aria-label") ?? "";
        expect(accessible.toLowerCase()).toContain(visible.toLowerCase());
      }
    },
  );

  // ★ This is expected to pass with NO implementation change here: the shared
  // `Modal` (`modal.tsx`) already captures the previously-focused element on
  // open and restores it on close — `AssetLibrary` does not need to do
  // anything of its own. Pinning it at THIS call site is still worth doing —
  // it is the behaviour a real user depends on, and nothing else in this
  // file exercises the open→close focus round-trip.
  it("returns focus to the row control that opened the preview", async () => {
    render(<AssetLibrary {...base} loadImage={vi.fn(async () => TINY_GIF)} />);
    const opener = screen.getAllByRole("button", { name: /^Preview – / })[0];
    await userEvent.click(opener);
    await screen.findByRole("dialog");
    await userEvent.keyboard("{Escape}");
    expect(opener).toHaveFocus();
  });
});

describe("AssetLibrary — the upload empty-state box", () => {
  it("offers the upload box when the library is empty", () => {
    render(<AssetLibrary {...base} assets={[]} />);
    expect(
      screen.getByRole("button", { name: t("en-US", "assetLibraryUploadFirst") }),
    ).toBeInTheDocument();
  });

  // ★★ Assert the DIALOG opens, not that a File arrives — jsdom cannot produce
  // a real file-picker selection, so asserting `onUpload` fired would assert
  // something the harness cannot cause.
  //
  // ★★★ TWO inputs on this surface by design: the toolbar FilePickerButton's
  // (first in DOM order) and the box's own (second). A bare `querySelector`
  // would grab the toolbar's and go red against correct code.
  it("opens its OWN file dialog when the box is clicked", async () => {
    const user = userEvent.setup();
    render(<AssetLibrary {...base} assets={[]} />);
    const inputs = document.querySelectorAll<HTMLInputElement>('input[type="file"]');
    expect(inputs).toHaveLength(2);
    const toolbarClick = vi.spyOn(inputs[0], "click");
    const boxClick = vi.spyOn(inputs[1], "click");

    await user.click(
      screen.getByRole("button", { name: t("en-US", "assetLibraryUploadFirst") }),
    );

    expect(boxClick).toHaveBeenCalled();
    // The box owns its own picker rather than reaching for the toolbar's.
    expect(toolbarClick).not.toHaveBeenCalled();
  });

  it("does not offer the box once the library has an asset", () => {
    render(<AssetLibrary {...base} />); // `base.assets` is the 2-item fixture
    // ★★ THE POSITIVE OBSERVABLE, and it is not decoration. The table is the
    // else-branch of the very ternary under test, so it proves the populated
    // branch actually ran — the absence below is then evidence about the
    // branch rather than about the fixture.
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: t("en-US", "assetLibraryUploadFirst") }),
    ).toBeNull();
  });

  // ★ The two pickers must agree, and since they now read one pair of consts
  // this is cheap insurance rather than a real risk — it goes red if someone
  // re-inlines either expression at one site only.
  it("gives both file inputs the same accept list", () => {
    render(<AssetLibrary {...base} assets={[]} />);
    const inputs = document.querySelectorAll<HTMLInputElement>('input[type="file"]');
    expect(inputs).toHaveLength(2);
    expect(inputs[1].accept).toBe(inputs[0].accept);
    expect(inputs[0].accept).not.toBe("");
  });
});
