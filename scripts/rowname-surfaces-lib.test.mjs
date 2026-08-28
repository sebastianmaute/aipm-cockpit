// Unit tests for the row-name surface scanner's parsing layer.
//
// Same discipline as `doc-claims-lib.test.mjs` and `followup-claims-lib.test.mjs`:
// every regex defect the sibling gates ever shipped was found by RUNNING the lib
// against real inputs, never by reading it. So the fixtures below are small and
// exact, and the last describe block runs the whole pipeline over the real tree.
//
// Each `regression:` test names the mutant it kills. A test with no mutant named
// is pinning shape, not behaviour, and should be read as the weaker claim it is.
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

import { describe, expect, it } from "vitest";
import {
  CONTROL_TAGS,
  STRONG_MARKER,
  buildReport,
  collectSources,
  componentParamNames,
  coverageMarkersIn,
  findSurfaces,
  matchDelimiters,
  moduleKey,
  nameClass,
  relativeImportsIn,
  repeatScopes,
  scanOpenTag,
} from "./rowname-surfaces-lib.mjs";

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const REPO = path.join(HERE, "..");

// ── Fixtures ────────────────────────────────────────────────────────────────
// Written as line arrays rather than template literals so the JSX inside them
// can carry its own backticks and `${}` without escaping — the escaping is
// exactly where this repo has lost bytes before.

/** Leg (1), done right: the name is routed through a row token, so two rows
 *  sharing a title still get distinct names. */
const TOKENIZED_LIST = [
  "export function List({ rows, lang }) {",
  "  const tokens = useRowTokens(rows);",
  "  return rows.map((row) => (",
  '    <button aria-label={rowLabel(t(lang, "edit"), tokens.get(row.id))}>x</button>',
  "  ));",
  "}",
].join("\n");

/** Leg (1), the defect shape: a raw entity field interpolated straight into the
 *  name. Also carries `onClick={() => open(row)}` — the `>` inside an attribute
 *  expression that a naive `<button[^>]*>` tag regex terminates the tag on. */
const RAW_FIELD_LIST = [
  "export function List({ rows, lang }) {",
  "  return rows.map((row) => (",
  '    <button aria-label={`${t(lang, "edit")} - ${row.name}`} onClick={() => open(row)}>x</button>',
  "  ));",
  "}",
].join("\n");

/** Leg (1), the worst shape: one translation key, no per-row part at all, so
 *  every row announces the same name. */
const FIXED_LIST = [
  "export function List({ rows, lang }) {",
  '  return rows.map((row) => <button aria-label={t(lang, "edit")}>x</button>);',
  "}",
].join("\n");

/** Leg (2): NO `aria-label` anywhere, so the accessible name falls back to the
 *  rendered content. Invisible to any attribute-matching grep by construction —
 *  there is no attribute to match. This is the shape the Gantt name buttons had. */
const CONTENT_LIST = [
  "export function List({ rows }) {",
  "  return rows.map((row) => <button onClick={() => open(row)}>{row.title}</button>);",
  "}",
].join("\n");

/** Leg (3): a per-item component handed the WHOLE entity. It composes the name
 *  from a raw field inside its own file, where no grep over the panel that
 *  renders it will ever see the string — and it cannot disambiguate itself,
 *  because it has no sibling visibility. */
const DELEGATED_ROW = [
  "export function Row({ task, lang }: RowProps) {",
  '  return <button aria-label={`${t(lang, "edit")} - ${task.title}`}>x</button>;',
  "}",
].join("\n");

/** Leg (1)'s two spelling variants in one fixture: the camelCase COMPONENT prop
 *  and whitespace around the `=`. A `grep aria-label="` sees neither. */
const SPACED_CAMEL_LIST = [
  "export function List({ rows, lang }) {",
  "  return rows.map((row) => (",
  '    <IconButton ariaLabel = {`${t(lang, "open")} - ${row.name}`} />',
  "  ));",
  "}",
].join("\n");

/** Leg (1) again, but the callback parameter is DESTRUCTURED. The mainstream
 *  React idiom, and `MAP_RE` was blind to it for a release: neither identifier
 *  alternative matched, so `repeatScopes` returned 0 and every control inside
 *  fell out of the enumeration. */
const DESTRUCTURED_LIST = [
  "export function List({ cols, lang }) {",
  "  return cols.map(({ key, labelKey }) => (",
  '    <button aria-label={t(lang, labelKey)}>{key}</button>',
  "  ));",
  "}",
].join("\n");

/** Leg (2)'s OTHER half: a self-closing control with no name of its own,
 *  wrapped in a `<label>` that names it implicitly. Not an unlabelled control —
 *  it has a name, and that name repeats per row like any other. This is the
 *  PRE-FIX shape of `column-config-popover.tsx`. */
const LABEL_WRAPPED_LIST = [
  "export function List({ cols, lang }) {",
  "  return cols.map((col) => (",
  "    <label><Checkbox checked={col.on} onChange={() => go(col)} />{col.title}</label>",
  "  ));",
  "}",
].join("\n");

/** A `//` comment in the ATTRIBUTE list whose text ends in an apostrophe. Taken
 *  from `combobox-shared.tsx`, where it made `scanOpenTag` run to end of file. */
const COMMENTED_ATTRS = [
  "rows.map((row) => (",
  "  <button",
  "    // the ring must clear 1.4.11's 3:1 — this apostrophe is the whole test",
  "    className={x}",
  "  >{row.title}</button>",
  "))",
].join("\n");

const ASSERTING_TEST = [
  'import { expectRowUniqueNames } from "../test/row-unique-names";',
  'import { List } from "./widget-list";',
  'it("gives every row control a unique accessible name", () => {',
  "  expectRowUniqueNames({ container, minControls: 4 });",
  "});",
].join("\n");

const NON_ASSERTING_TEST = [
  'import { List } from "./widget-list";',
  'it("renders a row per document", () => {',
  "  expect(rows).toHaveLength(2);",
  "});",
].join("\n");

// ── Delimiter and tag scanning ──────────────────────────────────────────────

describe("matchDelimiters", () => {
  it("returns the index of the matching closer", () => {
    const text = "f(a, (b), c)!";
    expect(matchDelimiters(text, 1)).toBe(text.indexOf(")!"));
  });

  it("regression: an unbalanced opener returns -1 rather than the end of file", () => {
    expect(matchDelimiters("f(a, (b)", 1)).toBe(-1);
  });
});

describe("scanOpenTag", () => {
  it("★★★ regression: a `>` inside an attribute expression does not end the tag", () => {
    const text = "<button onClick={() => open(row)} id=\"a\">x</button>";
    const tag = scanOpenTag(text, 0);
    expect(text.slice(0, tag.end + 1).endsWith('id="a">')).toBe(true);
  });

  it("regression: a `>` inside a quoted attribute does not end the tag", () => {
    const text = '<button title="a > b" id="c">x</button>';
    const tag = scanOpenTag(text, 0);
    expect(text.slice(0, tag.end + 1).endsWith('id="c">')).toBe(true);
  });

  it("reports a self-closing tag", () => {
    // ★ Also the guard on the comment branch below: the `/` of a `/>` is
    // followed by `>`, not by `/` or `*`, so it is not read as a comment.
    expect(scanOpenTag("<input value={v} />", 0).selfClosing).toBe(true);
    expect(scanOpenTag("<button>x</button>", 0).selfClosing).toBe(false);
  });

  it("★★★ regression: an apostrophe inside a `//` comment does not swallow the tag", () => {
    // MUTANT: delete the comment-skip branch (or flip its `text[i + 1] === "/"`
    // to `"*"`, which kills the line-comment half alone).
    // Measured in the tree, not theorised. `combobox-shared.tsx` explains a ring
    // colour inside the attribute list and the sentence ends "…under 1.4.11's
    // 3:1)." — that apostrophe opened a string literal that never closed, the
    // walk ran to end of file and returned null, and `findSurfaces` reads a null
    // as "not a tag" and DROPS the control. Its `<button>` was missing from the
    // report while its parent `<li>` was present, so the file looked enumerated
    // and nothing in the output said a tag had failed to parse.
    const sites = findSurfaces(COMMENTED_ATTRS);
    expect(sites).toHaveLength(1);
    expect(sites[0].name).toBe("{row.title}");
  });

  it("regression: a block comment in the attribute list is skipped too", () => {
    // MUTANT: change the branch condition to `text[i + 1] === "/"`, dropping
    // the `/*` half.
    // ★★ THE APOSTROPHE AND THE `>` IN THIS FIXTURE ARE THE TEST. A first cut
    // used a bland `/* fine */` and that mutant SURVIVED: with no block-comment
    // skip the walk simply steps over harmless characters and still finds the
    // `aria-label` and the closing `>`. The skip only earns its place on a
    // comment carrying a character the walk otherwise treats as syntax — a
    // quote that never closes, or a `>` that ends the tag early. A surviving
    // mutant is a question; this one was a missing INPUT, not an equivalent.
    const text = "rows.map((row) => <button /* it's > fine */ aria-label={row.name}>x</button>)";
    expect(findSurfaces(text)[0].nameClass).toBe("DATA");
  });
});

describe("repeatScopes", () => {
  it("finds the callback body and its parameter", () => {
    const scopes = repeatScopes(RAW_FIELD_LIST);
    expect(scopes).toHaveLength(1);
    expect(scopes[0].param).toBe("row");
    expect(RAW_FIELD_LIST.slice(scopes[0].start, scopes[0].end)).toContain("aria-label");
  });

  it("accepts a bare single parameter without parentheses", () => {
    expect(repeatScopes("rows.map(row => <button />)")[0].param).toBe("row");
  });

  it("regression: the scope ends at the callback, not at end of file", () => {
    const text = "rows.map((row) => <button />)\nconst after = 1;";
    expect(repeatScopes(text)[0].end).toBeLessThan(text.indexOf("const after"));
  });

  it("★★★ regression: sees a DESTRUCTURED callback parameter", () => {
    // MUTANT: delete the `|[{[]` alternative from `MAP_RE`. That is how this
    // shipped, and nothing here went red, because not one of the three
    // `repeatScopes` tests used a destructured parameter.
    // `rows.map(({ key, labelKey }) => …)` matched neither identifier
    // alternative, so `repeatScopes` returned 0, every control inside fell to
    // the `!inRepeat` branch of `findSurfaces`, and the whole file dropped out
    // of the enumeration — `column-config-popover.tsx`, edited on this very
    // branch to CLOSE a 2.4.6 defect, contributed ZERO sites to the report
    // built to find that class.
    const scopes = repeatScopes(DESTRUCTURED_LIST);
    expect(scopes).toHaveLength(1);
    expect(DESTRUCTURED_LIST.slice(scopes[0].start, scopes[0].end)).toContain("aria-label");
    // ★ `null`, not an invented name. `({ key, labelKey })` binds two names and
    // `([id, row])` two more; picking one would name an item the source never
    // named. Nothing reads `param` — start/end are what detection uses — so the
    // null costs no coverage, and asserting it pins the deliberate choice.
    expect(scopes[0].param).toBeNull();
    // The point of the scope: the control inside it is now enumerated.
    expect(findSurfaces(DESTRUCTURED_LIST)).toHaveLength(1);
  });

  it("regression: an ARRAY-destructured parameter counts too", () => {
    // MUTANT: narrow the character class `[{[]` to `[{]`. This is the
    // `Object.entries(x).map(([key, value]) => …)` shape.
    const text = "rows.map(([id, row]) => <button aria-label={row.name}>x</button>)";
    expect(repeatScopes(text)).toHaveLength(1);
    expect(findSurfaces(text)).toHaveLength(1);
  });
});

// ── Name classification ─────────────────────────────────────────────────────

describe("nameClass", () => {
  it("calls a lone translation call FIXED — every row announces the same name", () => {
    expect(nameClass('{t(lang, "edit")}')).toBe("FIXED");
  });

  it("calls a string literal FIXED", () => {
    expect(nameClass('"Edit"')).toBe("FIXED");
  });

  it("★★ calls a raw interpolated field DATA, not FIXED", () => {
    expect(nameClass('{`${t(lang, "edit")} - ${row.name}`}')).toBe("DATA");
  });

  it("★★ a per-row value passed POSITIONALLY through t() is still DATA", () => {
    // AGENTS.md: the discriminator is "can this value repeat in one rendered
    // list", never the call FORM. `t(lang, key, item.field)` proves nothing
    // when the field repeats.
    expect(nameClass('{t(lang, "openItem", c.title)}')).toBe("DATA");
  });

  it("calls a row-token-routed name TOKENIZED", () => {
    expect(nameClass('{rowLabel(t(lang, "edit"), token)}')).toBe("TOKENIZED");
  });
});

// ── The three legs ──────────────────────────────────────────────────────────

describe("findSurfaces — leg (1), the aria-label attribute", () => {
  it("classifies a row-token-routed name as TOKENIZED", () => {
    const [site] = findSurfaces(TOKENIZED_LIST);
    expect(site.leg).toBe("attribute");
    expect(site.nameClass).toBe("TOKENIZED");
  });

  it("flags a raw entity field interpolated into the name", () => {
    const [site] = findSurfaces(RAW_FIELD_LIST);
    expect(site.leg).toBe("attribute");
    expect(site.nameClass).toBe("DATA");
    expect(site.tag).toBe("button");
  });

  it("★★ flags a per-row control whose name carries no per-row part at all", () => {
    const [site] = findSurfaces(FIXED_LIST);
    expect(site.nameClass).toBe("FIXED");
  });

  it("★★★ regression: sees the camelCase spelling and whitespace around the `=`", () => {
    // The mutant this kills: narrowing the attribute pattern to `aria-label="`,
    // which is the enumeration method §245 records as provably incomplete.
    const sites = findSurfaces(SPACED_CAMEL_LIST);
    expect(sites).toHaveLength(1);
    expect(sites[0].leg).toBe("attribute");
    expect(sites[0].nameClass).toBe("DATA");
  });

  it("★★★ regression: reads a shared primitive's renamed `label` prop", () => {
    // `IconButton` takes `label` and forwards it to `aria-label` on the real
    // <button>. Without this the site falls through to the CONTENT leg, finds an
    // icon-only child, and reports FIXED over a correctly qualified per-row name.
    const text = [
      "rows.map((row) => (",
      '  <IconButton label={`${t(lang, "remove")} - ${row.name}`}><TrashIcon /></IconButton>',
      "))",
    ].join("\n");
    const [site] = findSurfaces(text);
    expect(site.leg).toBe("attribute");
    expect(site.nameClass).toBe("DATA");
  });

  it("★★ `aria-label` wins over `label` on the same element", () => {
    // On `ToggleButton` both props exist and `ariaLabel` is the documented
    // override; reading `label` first would report the VISIBLE label instead.
    const text =
      'rows.map((row) => <ToggleButton label={t(lang, "compact")} ariaLabel={row.name} />)';
    expect(findSurfaces(text)[0].nameClass).toBe("DATA");
  });

  it("★★ a lowercase element's `label` attribute is NOT an accessible name", () => {
    const text = 'rows.map((row) => <input label={row.id} aria-labelledby="x" />)';
    expect(findSurfaces(text)[0].leg).toBe("labelledby");
  });

  it("regression: does not read `aria-labelledby` as an `aria-label`", () => {
    const text = 'rows.map((row) => <button aria-labelledby={row.id}>x</button>)';
    const [site] = findSurfaces(text);
    expect(site.leg).toBe("labelledby");
    expect(site.nameClass).toBe("UNRESOLVED");
  });
});

describe("findSurfaces — leg (2), the name that comes from CONTENT", () => {
  it("★★★ detects a control with NO aria-label whose name falls back to its content", () => {
    // Leg (b). Invisible to any attribute-matching grep by construction: there
    // is no attribute to match, so the only way to see it is to notice the
    // attribute is ABSENT.
    const sites = findSurfaces(CONTENT_LIST);
    expect(sites).toHaveLength(1);
    expect(sites[0].leg).toBe("content");
    expect(sites[0].nameClass).toBe("DATA");
  });

  it("regression: an aria-label WINS over the content, so the site is not double-counted", () => {
    const text = 'rows.map((row) => <button aria-label={row.id}>{row.title}</button>)';
    const sites = findSurfaces(text);
    expect(sites).toHaveLength(1);
    expect(sites[0].leg).toBe("attribute");
  });

  it("does not report a content name that is the same on every row", () => {
    const text = 'rows.map((row) => <button onClick={() => go(row)}>{t(lang, "open")}</button>)';
    expect(findSurfaces(text)[0].nameClass).toBe("FIXED");
  });

  it("★★ a nested element's ATTRIBUTES are not part of the name", () => {
    // MUTANT: delete the `if (ch === "<")` skip in `childInterpolations`.
    // Collecting every brace naively pulls an icon's `className={…}` and a
    // checkbox's `checked={row.on}` into the name, and the site then reports
    // DATA over a name that is identical on every row. Measured: two `<li>` in
    // `combobox-shared.tsx` and one wrapper in `gantt-chrome.tsx` were reported
    // as DATA surfaces whose entire "name" was a nested tag's event handlers.
    // The nested element's own CHILDREN still count — they are announced.
    const text = "rows.map((row) => <button><Icon className={cls} />{row.title}</button>)";
    expect(findSurfaces(text)[0].name).toBe("{row.title}");
  });
});

describe("findSurfaces — leg (2), the other half: a wrapping <label>", () => {
  it("★★★ detects a self-closing control named by an enclosing <label>", () => {
    // MUTANT: restore the old `if (open.selfClosing) continue;` — i.e. drop the
    // `wrappingLabelName` fallback. That branch dismissed every self-closing
    // control as "an unlabelled control, a different defect, out of scope",
    // which is true of a bare `<Checkbox />` and FALSE here: this control has a
    // name, the label's text, and it repeats per row like any other. It is also
    // the PRE-FIX shape of `column-config-popover.tsx`, so the scanner would
    // have missed this branch's own defect by a SECOND mechanism, independent
    // of the `MAP_RE` one above.
    const sites = findSurfaces(LABEL_WRAPPED_LIST);
    expect(sites).toHaveLength(1);
    expect(sites[0].leg).toBe("wrapping-label");
    expect(sites[0].tag).toBe("Checkbox");
    // The checkbox's own `checked={col.on}` must NOT reach the name.
    expect(sites[0].name).toBe("{col.title}");
  });

  it("detects the plain-DOM spelling of the same shape", () => {
    // MUTANT: drop `input` from `LABELABLE_TAGS`.
    const text = [
      "rows.map((row) => (",
      '  <label><input type="checkbox" checked={row.on} />{row.title}</label>',
      "))",
    ].join("\n");
    const [site] = findSurfaces(text);
    expect(site.leg).toBe("wrapping-label");
    expect(site.tag).toBe("input");
  });

  it("★★ a <label> around an anchor names nothing, so no site is reported", () => {
    // MUTANT: add "a" to `LABELABLE_TAGS`. A `<label>` does not name an anchor,
    // and reporting the label's text as its accessible name would invent a name
    // the browser never computes — a false finding sends someone to "fix" a
    // control that is fine.
    const text = 'rows.map((row) => <label><a href={row.url} />{row.title}</label>)';
    expect(findSurfaces(text)).toHaveLength(0);
  });

  it("★★ an aria-label on the control still wins over the wrapping label", () => {
    const text = "rows.map((row) => <label><Checkbox aria-label={row.id} />{row.title}</label>)";
    const [site] = findSurfaces(text);
    expect(site.leg).toBe("attribute");
    expect(site.name).toBe("{row.id}");
  });

  it("★★★ a control with NO name source anywhere is SKIPPED, both spellings", () => {
    // MUTANT: change `if (!wrapped) continue;` to `if (false) continue;`.
    // The two spellings of ONE defect used to get two verdicts: the
    // self-closing `<Checkbox />` was skipped as out of scope, while the
    // open/close `<button><TrashIcon /></button>` was reported FIXED with an
    // empty name — padding the FIXED headline with sites no reader could act
    // on. Both are the UNLABELLED-control defect, which the axe gate does
    // catch, and which is a different question from 2.4.6. Skip both.
    expect(findSurfaces("rows.map((row) => <button onClick={() => go(row)}><TrashIcon /></button>)")).toEqual([]);
    expect(findSurfaces("rows.map((row) => <Checkbox checked={row.on} />)")).toEqual([]);
  });

  it("★★ a literal text name is NOT the same thing, and is still reported FIXED", () => {
    // MUTANT: drop the `hasText` half of `childInterpolations` and skip on an
    // empty expression alone. `<button>Edit</button>` composes no
    // interpolation either, but it HAS a name and every row announces the same
    // one — the textbook 2.4.6 collision. Conflating the two would delete the
    // FIXED class from the report.
    const [site] = findSurfaces("rows.map((row) => <button onClick={() => go(row)}>Edit</button>)");
    expect(site.leg).toBe("content");
    expect(site.nameClass).toBe("FIXED");
  });
});

describe("findSurfaces — leg (3), the delegated per-item component", () => {
  it("★★★ flags a component that composes a name from a whole entity it was handed", () => {
    const sites = findSurfaces(DELEGATED_ROW);
    expect(sites).toHaveLength(1);
    expect(sites[0].leg).toBe("delegated");
    expect(sites[0].nameClass).toBe("DATA");
  });

  it("★★ does not flag an ordinary control outside any list", () => {
    // A name built from nothing per-item cannot collide with a sibling row,
    // because there are no sibling rows. Over-reporting these would bury the
    // findings that matter.
    const text = 'export function Bar({ lang }) { return <button aria-label={t(lang, "save")} />; }';
    expect(findSurfaces(text)).toHaveLength(0);
  });

  it("★★★ regression: a per-item component that ALREADY threads a row token is not flagged", () => {
    // This is the input that separates a missing test from an equivalent mutant.
    // Deleting the `cls !== "DATA"` guard survived the first suite: every other
    // fixture reaching that branch had no member access at all, so the prop
    // check filtered it out anyway. A TOKENIZED name that DOES read a member off
    // a prop is the one shape where the two guards disagree — and it is the
    // correctly-fixed shape, so reporting it would send someone to re-fix a
    // surface that is already right.
    const text = [
      "export function Row({ task, tokens, lang }: RowProps) {",
      '  return <button aria-label={rowLabel(t(lang, "edit"), tokens.get(task.id))}>x</button>;',
      "}",
    ].join("\n");
    expect(findSurfaces(text)).toHaveLength(0);
  });

  it("regression: a name built from a LOCAL, non-prop value is not called delegated", () => {
    const text = [
      "export function Bar({ lang }) {",
      "  const meta = useMeta();",
      "  return <button aria-label={meta.label} />;",
      "}",
    ].join("\n");
    expect(findSurfaces(text)).toHaveLength(0);
  });
});

describe("componentParamNames", () => {
  it("collects destructured props from a function declaration and an arrow", () => {
    const names = componentParamNames(
      ["function A({ task, lang }: P) {}", "const B = ({ doc, onPick }: Q) => null;"].join("\n"),
    );
    expect([...names].sort()).toEqual(["doc", "lang", "onPick", "task"]);
  });
});

describe("findSurfaces — the control set", () => {
  it("★★ reports the tag, so a reviewer can judge whether it is really a control", () => {
    const text = 'rows.map((row) => <select aria-label={row.name}><option /></select>)';
    expect(findSurfaces(text)[0].tag).toBe("select");
  });

  it("★★ counts a role-bearing non-control element", () => {
    const text = 'rows.map((row) => <div role="button" aria-label={row.name}>x</div>)';
    expect(findSurfaces(text)).toHaveLength(1);
  });

  it("ignores an element that is neither a control tag, a control component, nor role-bearing", () => {
    expect(findSurfaces('rows.map((row) => <span title={row.name}>x</span>)')).toHaveLength(0);
  });

  it("CONTROL_TAGS names the lowercase tags, so the report can say what it looked at", () => {
    expect(CONTROL_TAGS).toContain("button");
    expect(CONTROL_TAGS).toContain("select");
  });
});

// ── Test cross-reference ────────────────────────────────────────────────────

describe("coverageMarkersIn", () => {
  it("recognises the shared assertion helper", () => {
    expect(coverageMarkersIn(ASSERTING_TEST)).toContain("expectRowUniqueNames");
  });

  it("★★★ matches on CONTENT, never on the test file NAME", () => {
    // §245 records the name-grep bound as provably incomplete. A test that
    // asserts the property is recognised by what it CONTAINS.
    expect(coverageMarkersIn('it("keeps every name unique", () => {})')).toContain("unique");
    expect(coverageMarkersIn('expect(names).toEqual(["accessible name"])')).toContain(
      "accessible name",
    );
  });

  it("returns nothing for a test that asserts something else entirely", () => {
    expect(coverageMarkersIn(NON_ASSERTING_TEST)).toHaveLength(0);
  });
});

describe("relativeImportsIn", () => {
  it("returns the module keys a file imports relatively", () => {
    expect(relativeImportsIn(ASSERTING_TEST)).toContain("widget-list");
  });

  it("regression: ignores a bare package specifier", () => {
    expect(relativeImportsIn('import { x } from "react";')).toHaveLength(0);
  });
});

describe("buildReport", () => {
  const sources = new Map([
    ["src/app/widget-list.tsx", RAW_FIELD_LIST],
    ["src/app/other-list.tsx", CONTENT_LIST],
  ]);

  it("★★★ a surface with a matching asserting test is COVERED", () => {
    const report = buildReport({
      sources,
      tests: new Map([["src/app/widget-list.test.tsx", ASSERTING_TEST]]),
    });
    const covered = report.surfaces.find((s) => s.module === "widget-list");
    expect(covered.status).toBe("COVERED");
    expect(covered.via).toBe("src/app/widget-list.test.tsx");
  });

  it("★★★ a surface with no asserting test is a GAP", () => {
    const report = buildReport({
      sources,
      tests: new Map([["src/app/widget-list.test.tsx", NON_ASSERTING_TEST]]),
    });
    expect(report.surfaces.find((s) => s.module === "widget-list").status).toBe("GAP");
    expect(report.surfaces.find((s) => s.module === "other-list").status).toBe("GAP");
  });

  it("★★ credits a parent module's asserting test, and says it was indirect", () => {
    const withParent = new Map(sources);
    withParent.set(
      "src/app/widget-panel.tsx",
      'import { List } from "./widget-list";\nexport const P = () => <List />;',
    );
    const report = buildReport({
      sources: withParent,
      tests: new Map([
        [
          "src/app/widget-panel.test.tsx",
          'import { P } from "./widget-panel";\nexpectRowUniqueNames({ container });',
        ],
      ]),
    });
    const s = report.surfaces.find((x) => x.module === "widget-list");
    expect(s.status).toBe("COVERED_VIA_PARENT");
    expect(s.via).toContain("widget-panel");
  });

  it("★★ prefers the test carrying the STRONGEST marker, not the first one seen", () => {
    // Several tests can import one module. Crediting whichever came first in
    // directory order lets a bare `unique` — which can be about a unique id —
    // stand in front of a file that calls the shared assertion helper, and the
    // reported marker is the only thing a reader has to discount a COVERED with.
    const report = buildReport({
      sources,
      tests: new Map([
        ["src/app/a-weak.test.tsx", 'import { List } from "./widget-list";\n// unique ids only'],
        [
          "src/app/z-strong.test.tsx",
          'import { List } from "./widget-list";\nexpectRowUniqueNames({ container });',
        ],
      ]),
    });
    const s = report.surfaces.find((x) => x.module === "widget-list");
    expect(s.via).toBe("src/app/z-strong.test.tsx");
    expect(s.markers[0]).toBe("expectRowUniqueNames");
  });

  it("counts each leg, so the summary can state what it found", () => {
    const report = buildReport({ sources, tests: new Map() });
    expect(report.summary.byLeg.attribute).toBe(1);
    expect(report.summary.byLeg.content).toBe(1);
  });

  it("★★★ the summary carries the STRONG-marker split, not just the four-marker one", () => {
    // MUTANT: drop the `.filter(...)` from `strongOnly`, so `byStrongStatus`
    // becomes a copy of `byStatus`.
    // `COVERAGE_MARKERS` counts the bare phrase `accessible name` — anywhere in
    // a test file, a COMMENT included, and these files are dense with it — as
    // evidence that a test asserts. The per-file `[marker]` already said so;
    // the SUMMARY line, the one a reader quotes, did not, so the quotable GAP
    // count understated the risk. Both are now computed and both are printed.
    const report = buildReport({
      sources,
      tests: new Map([
        ["src/app/widget-list.test.tsx", 'import { List } from "./widget-list";\n// accessible name'],
      ]),
    });
    expect(report.summary.byStatus.COVERED).toBe(1);
    expect(report.summary.byStrongStatus.COVERED).toBe(0);
    expect(report.summary.byStrongStatus.GAP).toBe(2);
    // ...and the covered file is attributed to the WEAK marker that credited it.
    expect(report.summary.byMarker["accessible name"]).toBe(1);
    expect(report.summary.byMarker[STRONG_MARKER]).toBe(0);
  });

  it("★★ the strong split agrees with the four-marker one when the marker IS strong", () => {
    // The other side of the mutant above: a filter that dropped everything
    // would make `byStrongStatus.COVERED` permanently 0 and the test above
    // would still pass.
    const report = buildReport({
      sources,
      tests: new Map([["src/app/widget-list.test.tsx", ASSERTING_TEST]]),
    });
    expect(report.summary.byStatus.COVERED).toBe(1);
    expect(report.summary.byStrongStatus.COVERED).toBe(1);
    expect(report.summary.byMarker[STRONG_MARKER]).toBe(1);
  });

  it("★★ a file with no surface at all does not appear in the report", () => {
    const report = buildReport({
      sources: new Map([["src/app/plain.tsx", "export const A = () => <div>hi</div>;"]]),
      tests: new Map(),
    });
    expect(report.surfaces).toHaveLength(0);
  });
});

// ── Against the real tree ───────────────────────────────────────────────────
// The house lesson: every regex defect these gates ever shipped was found by
// running the lib against real inputs. A fixture-only suite is worth less than
// it looks.

describe("against the real repository", () => {
  const { sources, tests } = collectSources(REPO);

  it("reads a non-trivial corpus — a scan that finds no files passes everything", () => {
    expect(sources.size).toBeGreaterThan(100);
    expect(tests.size).toBeGreaterThan(100);
  });

  it("★★ every reported line number exists in its file", () => {
    const report = buildReport({ sources, tests });
    const bad = [];
    for (const surface of report.surfaces) {
      const lines = sources.get(surface.file).split("\n").length;
      for (const site of surface.sites) {
        if (site.line < 1 || site.line > lines) bad.push(`${surface.file}:${site.line}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("★★ finds surfaces the attribute leg alone cannot see", () => {
    // If this ever drops to zero, either the app really has none left or leg (2)
    // and leg (3) have silently stopped matching. Check before assuming the first.
    const report = buildReport({ sources, tests });
    const nonAttribute = report.surfaces.flatMap((s) =>
      s.sites.filter((x) => x.leg !== "attribute"),
    );
    expect(nonAttribute.length).toBeGreaterThan(0);
  });

  it("★★ the strong-marker GAP over the real tree is never SMALLER than the loose one", () => {
    // An invariant, not a number: `strongOnly` is a subset of `asserting`, so
    // every file the strict pass covers the loose pass covers too. If this ever
    // inverts, the two passes have stopped reading the same corpus. Deliberately
    // no figures here — every one of them moves with the next test added.
    const { summary } = buildReport({ sources, tests });
    expect(summary.byStrongStatus.GAP).toBeGreaterThanOrEqual(summary.byStatus.GAP);
    expect(summary.strongAssertingTests).toBeLessThanOrEqual(summary.assertingTests);
    expect(summary.strongAssertingTests).toBeGreaterThan(0);
  });

  it("★★ recognises the shared assertion helper in the tests that adopted it", () => {
    const adopters = [...tests].filter(([, text]) =>
      coverageMarkersIn(text).includes("expectRowUniqueNames"),
    );
    // Reproduce: grep -rl "expectRowUniqueNames" src --include=*.test.tsx | wc -l
    expect(adopters.length).toBeGreaterThan(20);
  });

  it("moduleKey strips the directory and the extension", () => {
    expect(moduleKey("src/app/documents-list.tsx")).toBe("documents-list");
    expect(moduleKey(path.join("src", "app", "documents-list.tsx"))).toBe("documents-list");
  });

  it("★ the scanner's own files are not part of the corpus it judges", () => {
    expect([...sources.keys()].some((f) => f.includes("rowname-surfaces"))).toBe(false);
  });

  it("★ the fixture files it reads still exist on disk", () => {
    expect(fs.existsSync(path.join(REPO, "src", "test", "row-unique-names.ts"))).toBe(true);
  });
});
