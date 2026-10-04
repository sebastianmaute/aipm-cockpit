// @vitest-environment node
import { describe, expect, it } from "vitest";
import { compareToBaseline, scanTsx, untitledIconOnly } from "./tooltip-scan-lib.mjs";

const one = (jsx) => {
  const rows = scanTsx(`export const X = () => (\n${jsx}\n);\n`);
  expect(rows).toHaveLength(1);
  return rows[0];
};

describe("scanTsx — what counts as icon-only", () => {
  it("an IconButton is icon-only by contract, whatever its children", () => {
    expect(one(`<IconButton aria-label="Close">x y z</IconButton>`).iconOnly).toBe(true);
  });

  it("a self-closing control has no visible content", () => {
    expect(one(`<Button aria-label="Add" />`).iconOnly).toBe(true);
  });

  it("an icon child and an aria-hidden span do not count as visible text", () => {
    expect(one(`<button aria-label="Remove"><TrashIcon className="h-4" /><span aria-hidden="true">{"x y"}</span></button>`).iconOnly).toBe(true);
  });

  it("a lone glyph still reads as icon-only", () => {
    expect(one(`<button aria-label="Remove">×</button>`).iconOnly).toBe(true);
    expect(one(`<button aria-label="Remove">{"×"}</button>`).iconOnly).toBe(true);
  });

  it("visible text, a translated label or a nested element is not icon-only", () => {
    expect(one(`<button>Save</button>`).iconOnly).toBe(false);
    expect(one(`<Button>{t(lang, "save")}</Button>`).iconOnly).toBe(false);
    expect(one(`<button><strong>Go</strong></button>`).iconOnly).toBe(false);
  });

  it("a JSX comment child is ignored", () => {
    expect(one(`<button aria-label="Menu">{/* the glyph */}<Bars2Icon /></button>`).iconOnly).toBe(true);
  });
});

describe("scanTsx — names and titles", () => {
  it("reads title, aria-label and label", () => {
    expect(one(`<button title="Close" aria-label="Close"><XIcon /></button>`)).toMatchObject({ hasTitle: true, named: true });
    expect(one(`<Button label="Close" />`)).toMatchObject({ hasTitle: false, named: true });
    expect(one(`<button><XIcon /></button>`)).toMatchObject({ hasTitle: false, named: false });
  });

  it("treats a spread as possibly carrying the title (a primitive's own element)", () => {
    expect(one(`<button className={c} {...props} />`).hasTitle).toBe(true);
  });

  it("does not take data-title or aria-labelledby for a title or name", () => {
    expect(one(`<button data-title="x" aria-labelledby="y"><XIcon /></button>`)).toMatchObject({ hasTitle: false, named: false });
  });

  it("reports the tag and the 1-based line of the opening tag", () => {
    expect(one(`<ToggleButton pressed>{t(lang, "x")}</ToggleButton>`)).toMatchObject({ tag: "ToggleButton", line: 2 });
  });
});

describe("scanTsx — the two failures of the old character scanner", () => {
  // docs/tooltip-inventory.md, "Reproduce": an apostrophe in a `//` comment inside
  // an opening tag opened a string that never closed.
  it("an apostrophe in a comment inside the tag neither drops the control nor swallows the next one", () => {
    const rows = scanTsx(`const X = () => (
  <div>
    <Button
      // mirrors the table editor's remove-row bounds
      aria-label="Remove item"
    >
      <span aria-hidden="true">{"×"}</span>
    </Button>
    <button>{t(lang, "save")}</button>
  </div>
);`);
    expect(rows.map((r) => [r.tag, r.iconOnly, r.hasTitle])).toEqual([
      ["Button", true, false],
      ["button", false, false],
    ]);
  });

  it("does not count the word <button written in a comment", () => {
    const rows = scanTsx(`// a <button> here would be wrong\n/* <IconButton /> */\nconst X = () => <div />;\n`);
    expect(rows).toEqual([]);
  });
});

describe("untitledIconOnly and compareToBaseline", () => {
  it("keeps icon-only rows with no title", () => {
    const rows = [
      { tag: "button", line: 1, hasTitle: false, named: true, iconOnly: true },
      { tag: "button", line: 2, hasTitle: true, named: true, iconOnly: true },
      { tag: "button", line: 3, hasTitle: false, named: false, iconOnly: false },
    ];
    expect(untitledIconOnly(rows).map((r) => r.line)).toEqual([1]);
  });

  it("flags a file that grew, and a new file with any untitled control", () => {
    const { grew, shrank } = compareToBaseline({ "a.tsx": 2, "b.tsx": 1, "c.tsx": 0 }, { "a.tsx": 1, "c.tsx": 0 });
    expect(grew).toEqual([
      { file: "a.tsx", count: 2, allowed: 1 },
      { file: "b.tsx", count: 1, allowed: 0 },
    ]);
    expect(shrank).toEqual([]);
  });

  it("reports a file that shrank or vanished, and passes an equal count", () => {
    const { grew, shrank } = compareToBaseline({ "a.tsx": 1, "eq.tsx": 2 }, { "a.tsx": 2, "gone.tsx": 1, "eq.tsx": 2 });
    expect(grew).toEqual([]);
    expect(shrank).toEqual([
      { file: "a.tsx", count: 1, allowed: 2 },
      { file: "gone.tsx", count: 0, allowed: 1 },
    ]);
  });
});
