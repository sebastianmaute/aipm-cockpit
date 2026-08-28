// Enumeration of row-name surfaces: places where a per-row control's accessible
// name is composed, and whether a unit test asserts those names are distinct.
//
// ★★★ THIS IS A REPORT, NOT A GATE, AND IT MUST NOT BECOME ONE. A real gate
// would have to RENDER each panel against a collision fixture — a shared title,
// a repeated assignee — and read the accessible names off the tree. Nothing
// static can do that: whether two names collide depends on the DATA, and the
// data is not in the source. What this file does is narrower and honest: it
// finds the places where the question is worth asking, and says which of them a
// test already answers.
//
// ★★★ A CLEAN LINE HERE IS NOT EVIDENCE OF CORRECTNESS. `COVERED` means "some
// test file that mentions this module also contains a row-unique assertion" —
// not that the assertion covers THIS control, that its fixture can express a
// collision, or that it is not vacuous. `src/test/row-unique-names.ts` records
// at three stars how a floor-guarded assertion still passed against a ZERO-row
// fixture. Read a COVERED as "someone has been here", never as "this is safe".
//
// Pure: no `process.exit`, no `console`, no IO except `collectSources`, which is
// the one function the CLI needs and the tests point at the real tree. Mirrors
// `followup-claims-lib.mjs` and `doc-claims-lib.mjs`.
//
// ★★★ NO SHEBANG ON THIS FILE. A `#!` on an IMPORTED `.mjs` makes vitest throw a
// SyntaxError naming the WRONG file, while node, `node --check` and esbuild all
// accept it — so the failure reads as a broken test rather than a broken import.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/** Lowercase tags whose elements are controls for WCAG 2.4.6 purposes.
 *  ★ `a` is included whether or not it carries an `href`; an anchor without one
 *  is not a link, so a reviewer has to judge that case. Reporting the TAG on
 *  every site is what makes that judgement possible. */
export const CONTROL_TAGS = ["a", "button", "input", "select", "summary", "textarea"];

/** Capitalised component tags treated as controls by NAME. ★★ A heuristic, and
 *  the weakest rule in this file: a component called `Foo` that renders a
 *  `<button>` internally is invisible here, and its own file is scanned
 *  separately — which is exactly what leg (3) is for. */
export const CONTROL_COMPONENT_RE =
  /(Button|Link|Toggle|Checkbox|Radio|Switch|Input|Select|Chip|Tab|MenuItem|Picker|Handle)$/;

/** Roles that make an arbitrary element a control. */
export const INTERACTIVE_ROLES = [
  "button",
  "checkbox",
  "link",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "option",
  "radio",
  "switch",
  "tab",
];

/** Names that mean "this name was routed through the row-token machinery".
 *  ★★ `token`/`tokens` are deliberately loose — a local called `token` that has
 *  nothing to do with rows reads as TOKENIZED here. The direction of that error
 *  is under-reporting, which is why every TOKENIZED site is still listed rather
 *  than dropped. */
export const ROW_TOKEN_MARKERS = [
  "buildRowTokens",
  "useRowTokens",
  "rowLabel",
  "rowToken",
  "rowTokens",
  "token",
  "tokens",
];

/** What makes a test file count as asserting the property. Matched on CONTENT,
 *  never on the test file's NAME — the name-grep bound is precisely what this
 *  scanner exists to replace.
 *  ★★ They are not equally strong. `expectRowUniqueNames` is the shared helper
 *  and is near-conclusive that someone meant this property; a bare `unique` can
 *  be about a unique id. The matched marker is reported on every line so the
 *  reader can discount it. */
export const COVERAGE_MARKERS = [
  { name: "expectRowUniqueNames", re: /\bexpectRowUniqueNames\b/ },
  { name: "accessible name", re: /accessible name/i },
  { name: "row-unique", re: /row-unique/i },
  { name: "unique", re: /\bunique\b/i },
];

/** The one marker that is near-conclusive: a file calling the shared assertion
 *  helper meant THIS property. `byStrongStatus` is the report recomputed
 *  against this marker alone. */
export const STRONG_MARKER = "expectRowUniqueNames";

const PAIRS = { "(": ")", "{": "}", "[": "]" };

/** Index of the delimiter closing the one at `open`, or -1 when unbalanced.
 *  ★ -1 rather than end-of-file: a truncated scope that silently ran to EOF
 *  would drag every later control in the file into one "repeat". */
export function matchDelimiters(text, open) {
  const stack = [];
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (PAIRS[ch]) stack.push(PAIRS[ch]);
    else if (ch === ")" || ch === "}" || ch === "]") {
      if (stack.pop() !== ch) return -1;
      if (stack.length === 0) return i;
    }
  }
  return -1;
}

/** Walk a JSX opening tag from its `<`, returning where the tag ends.
 *  ★★★ THE WHOLE REASON THIS IS NOT A REGEX. `<button[^>]*>` terminates on the
 *  `>` inside `onClick={() => open(row)}`, which truncates the attribute list
 *  and silently loses every attribute after it — including the `aria-label`.
 *  A first cut of this scanner did exactly that and reported ZERO sites.
 *
 *  ★★★ COMMENTS ARE SKIPPED BEFORE QUOTES, AND THAT ORDER IS THE FIX. A `//`
 *  comment sitting between two attributes is ordinary in this repo — the
 *  attribute list is where a reviewer explains a class name. One in
 *  `combobox-shared.tsx` ends "…under 1.4.11's 3:1)." and that APOSTROPHE opened
 *  a string literal that never closed, so the walk ran to end of file and
 *  returned null — and `findSurfaces` reads a null as "not a tag" and drops the
 *  control silently. Measured: the `<button role=option>` at that site was
 *  absent from the report entirely, while its parent `<li>` was present, so the
 *  file LOOKED enumerated. Nothing about the output said a tag had failed to
 *  parse. A `/>` is safe here — the character after the `/` is `>`, not `/` or
 *  `*` — and a regex literal cannot reach this loop, because it can only appear
 *  inside a `{…}` expression, which is consumed whole above. */
export function scanOpenTag(text, lt) {
  let i = lt + 1;
  while (i < text.length) {
    const ch = text[i];
    if (ch === "/" && (text[i + 1] === "/" || text[i + 1] === "*")) {
      if (text[i + 1] === "/") {
        const nl = text.indexOf("\n", i);
        if (nl < 0) return null;
        i = nl + 1;
      } else {
        const end = text.indexOf("*/", i + 2);
        if (end < 0) return null;
        i = end + 2;
      }
      continue;
    }
    if (ch === "{") {
      const end = matchDelimiters(text, i);
      if (end < 0) return null;
      i = end + 1;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      i++;
      while (i < text.length && text[i] !== quote) {
        if (text[i] === "\\") i++;
        i++;
      }
      i++;
      continue;
    }
    if (ch === ">") return { end: i, selfClosing: text[i - 1] === "/" };
    i++;
  }
  return null;
}

/** ★★★ THE THIRD ALTERNATIVE IS LOAD-BEARING AND WAS MISSING FOR A RELEASE.
 *  The first two require an IDENTIFIER after `.map(`, so the mainstream React
 *  idiom `rows.map(({ key, labelKey }) => …)` matched NEITHER — `repeatScopes`
 *  returned 0, every control inside fell to the `!inRepeat` branch of
 *  `findSurfaces`, and the whole file was dropped from the enumeration. Measured
 *  blast radius when it was found: nine files absent from the report outright,
 *  among them `column-config-popover.tsx` — the file the row-unique-names branch
 *  edited to CLOSE a 2.4.6 defect contributed zero sites to the enumeration
 *  built to find that class. `[{[]` catches object AND array destructuring. */
const MAP_RE = /\.map\(\s*(?:\(\s*(?:([A-Za-z_$][\w$]*)|[{[])|([A-Za-z_$][\w$]*)\s*=>)/g;

/** Every `.map(callback)` body in the file, delimiter-matched.
 *  ★ `.map` only, and only the arrow forms `(x) =>` / `x =>` / `({…}) =>` /
 *  `([…]) =>`. `flatMap`, a `for` loop pushing JSX, a `.map(function (x) {…})`,
 *  or a list built by a helper in another module are all invisible — real
 *  limitations the report states rather than hides.
 *  ★★ `param` is `null` for a DESTRUCTURED callback parameter, because there is
 *  no single binding to name: `({ key, labelKey })` introduces two names and
 *  `([id, row])` two more, and picking one of them would invent an item name the
 *  source never had. Nothing in this file reads `param` — the scope's START and
 *  END are what `findSurfaces` uses to decide "is this control inside a repeat" —
 *  so a null there costs no detection. It is reported for the reader. */
export function repeatScopes(text) {
  const scopes = [];
  MAP_RE.lastIndex = 0;
  let m;
  while ((m = MAP_RE.exec(text))) {
    const openParen = text.indexOf("(", m.index);
    const end = matchDelimiters(text, openParen);
    if (end < 0) continue;
    scopes.push({ param: m[1] ?? m[2] ?? null, start: openParen, end });
  }
  return scopes;
}

const T_CALL_RE = /\bt\(\s*[A-Za-z_$][\w$]*\s*,\s*("[^"]*"|'[^']*')\s*\)/g;
const STRING_RE = /"[^"]*"|'[^']*'/g;
const TOKEN_RE = new RegExp(`\\b(${ROW_TOKEN_MARKERS.join("|")})\\b`);

/** How much a name can vary from row to row.
 *
 *  FIXED     — nothing per-row survives once translation calls and string
 *              literals are removed. Every row announces the SAME name, so two
 *              rows collide unconditionally.
 *  TOKENIZED — routed through the row-token machinery, which appends an
 *              occurrence index to colliding names.
 *  DATA      — some other value reaches the name. It varies when the value
 *              varies and COLLIDES when the value repeats, which for free text
 *              (a title, a person's name) it can.
 *
 *  ★★ A `t(lang, key, item.field)` call is DATA, not FIXED. AGENTS.md: the
 *  discriminator is "can this value repeat in one rendered list", never the call
 *  FORM — a positional interpolation proves the name differs when the field
 *  differs and proves nothing when the field repeats. */
export function nameClass(expr) {
  if (TOKEN_RE.test(expr)) return "TOKENIZED";
  const residue = expr
    .replace(T_CALL_RE, "S")
    .replace(STRING_RE, "S")
    .replace(/[{}`$\s]/g, "");
  return residue === "S" || residue === "" ? "FIXED" : "DATA";
}

const PARAM_RE = /(?:function\s+[A-Za-z_$][\w$]*\s*|=\s*)\(\s*\{([^)}]*)\}/g;

/** Identifiers destructured out of a component's props. Used only by leg (3),
 *  to tell a name built from something the component was HANDED (which its
 *  siblings may share) from one built out of its own local state. */
export function componentParamNames(text) {
  const names = new Set();
  PARAM_RE.lastIndex = 0;
  let m;
  while ((m = PARAM_RE.exec(text))) {
    for (const part of m[1].split(/[,:]/)) {
      const id = part.trim().match(/^[A-Za-z_$][\w$]*/);
      if (id) names.add(id[0]);
    }
  }
  return names;
}

const TAG_RE = /<([A-Za-z][\w.$]*)(?=[\s/>])/g;
const ARIA_LABEL_RE = /\baria-?[Ll]abel\s*=\s*/;
/** ★★★ THE THIRD SPELLING, AND IT IS THE ONE THAT BIT THIS SCANNER. A shared
 *  primitive renames the prop: `IconButton` takes `label` and forwards it to
 *  `aria-label` on the real `<button>`. Without this rule the site reads as
 *  having no attribute at all, falls through to the CONTENT leg, finds an
 *  icon-only child, and reports FIXED — i.e. it reports "every row announces the
 *  same name" over a correctly qualified per-row label. Measured against
 *  `knowledge-panel.tsx`, whose two `IconButton` rows did exactly that.
 *  ★ COMPONENT TAGS ONLY. On a plain `<label>`-adjacent DOM element the
 *  attribute means something else entirely. */
const COMPONENT_LABEL_RE = /\blabel\s*=\s*/;
const ARIA_LABELLEDBY_RE = /\baria-?[Ll]abelled[Bb]y\s*=/;
const ROLE_RE = /\brole\s*=\s*"([a-z]+)"/;

function attributeValue(attrs, at) {
  if (attrs[at] === "{") {
    const end = matchDelimiters(attrs, at);
    return end < 0 ? null : attrs.slice(at, end + 1);
  }
  if (attrs[at] === '"') {
    const end = attrs.indexOf('"', at + 1);
    return end < 0 ? null : attrs.slice(at, end + 1);
  }
  return null;
}

/** What a run of JSX children contributes to an accessible name: the `{...}`
 *  interpolations joined, and whether any literal TEXT is in there.
 *
 *  ★★ NESTED TAGS ARE SKIPPED WHOLE, attributes included. Collecting every brace
 *  naively pulls a nested element's ATTRIBUTE expressions into the name — an
 *  icon's `className={x}`, a checkbox's `checked={row.on}` — and the site then
 *  reports DATA over a name that is the same on every row. The nested element's
 *  own children still count, because they are announced (`<span>{row.title}</span>`).
 *
 *  ★★ `hasText` is what separates "this control's name is a literal" from "this
 *  control has NO name at all". Both used to yield an empty expression, so an
 *  icon-only `<button><TrashIcon /></button>` was reported FIXED with an empty
 *  name — a real defect, but the UNLABELLED-control one, which this report says
 *  in the same breath is out of scope for the self-closing spelling of the very
 *  same thing. See `findSurfaces`. */
function childInterpolations(children) {
  const parts = [];
  let hasText = false;
  for (let i = 0; i < children.length; i++) {
    const ch = children[i];
    if (ch === "<") {
      const tag = scanOpenTag(children, i);
      if (!tag) break;
      i = tag.end;
      continue;
    }
    if (ch === "{") {
      const end = matchDelimiters(children, i);
      if (end < 0) break;
      parts.push(children.slice(i, end + 1));
      i = end;
      continue;
    }
    if (!/\s/.test(ch)) hasText = true;
  }
  return { expr: parts.join(" "), hasText };
}

/** The name an element's own children compose.
 *  ★ The close tag is found by plain search, so a same-tag element NESTED inside
 *  this one ends the children early or late. That over- or under-captures the
 *  name string; the error direction is over-reporting a FIXED name as DATA,
 *  which is the safe one for a report whose findings are questions. */
function contentExpression(text, from, tag) {
  const close = text.indexOf(`</${tag}>`, from);
  if (close < 0) return { expr: "", hasText: false };
  return childInterpolations(text.slice(from, close));
}

const LABEL_OPEN_RE = /<label(?=[\s/>])/g;

/** The innermost `<label>…</label>` enclosing the element that opens at `at`,
 *  or null.
 *
 *  ★★★ THE HALF OF LEG (2) THAT USED TO BE DROPPED SILENTLY. A self-closing
 *  control with no `aria-label` was dismissed as "an unlabelled control, a
 *  different defect" — true of a bare `<Checkbox />`, and FALSE of
 *  `<label><Checkbox … />{text}</label>`, which is not unlabelled at all: it is
 *  named by the wrapping label, and that name repeats per row exactly like any
 *  other. It is also the PRE-FIX shape of this branch's own
 *  `column-config-popover.tsx`, so the scanner would have missed the defect it
 *  was built to enumerate by a second independent mechanism.
 *
 *  ★ Innermost, not first: nested labels are invalid HTML but a truncated scan
 *  should still attribute the control to the label closest to it.
 *  ★ The `</label>` is found by plain search, the same approximation
 *  `contentExpression` makes and for the same reason. */
function enclosingLabel(text, at) {
  let found = null;
  LABEL_OPEN_RE.lastIndex = 0;
  let m;
  while ((m = LABEL_OPEN_RE.exec(text)) && m.index < at) {
    const open = scanOpenTag(text, m.index);
    if (!open || open.selfClosing) continue;
    const close = text.indexOf("</label>", open.end);
    if (close > at) found = { start: open.end + 1, close };
  }
  return found;
}

/** Tags a wrapping `<label>` actually names. The HTML "labelable elements" set,
 *  minus the ones that are not controls here (`meter`, `output`, `progress`).
 *  ★ `a` and a role-bearing `<div role="button">` are deliberately ABSENT: a
 *  `<label>` around either names nothing, so reading the label's text as their
 *  accessible name would invent a name the browser never computes. */
const LABELABLE_TAGS = ["button", "input", "select", "textarea"];

function isLabelable(tag) {
  return LABELABLE_TAGS.includes(tag) || /^[A-Z]/.test(tag);
}

/** The name a wrapping `<label>` gives a control that has none of its own, or
 *  null when there is no such label or the label composes no name either. */
function wrappingLabelName(text, tag, at) {
  if (!isLabelable(tag)) return null;
  const wrap = enclosingLabel(text, at);
  if (!wrap) return null;
  const name = childInterpolations(text.slice(wrap.start, wrap.close));
  return name.expr || name.hasText ? name : null;
}

function isControl(tag, attrs) {
  if (CONTROL_TAGS.includes(tag)) return true;
  if (/^[A-Z]/.test(tag) && CONTROL_COMPONENT_RE.test(tag)) return true;
  const role = attrs.match(ROLE_RE);
  return Boolean(role && INTERACTIVE_ROLES.includes(role[1]));
}

/**
 * Every row-name surface in one source file, by the three legs AGENTS.md
 * prescribes — because a field-name grep alone has repeatedly missed real
 * collisions.
 *
 *   leg "attribute"  — (1) an `aria-label` / `ariaLabel` / a component's `label`
 *                      prop, with whitespace tolerated around the `=`. A
 *                      `grep 'aria-label="'` sees none of the three variants.
 *   leg "content"    — (2) a control with NO `aria-label` at all, whose name
 *                      falls back to its rendered CONTENT. Invisible to any
 *                      attribute-matching grep BY CONSTRUCTION: there is no
 *                      attribute to match, so the only way to see it is to
 *                      notice the attribute is absent.
 *   leg "wrapping-label"
 *                    — (2), other half: a control with no name of its OWN,
 *                      wrapped in a `<label>` that names it implicitly. Same
 *                      invisibility, and the same collision: the label's text
 *                      repeats per row like any other name. ★★ This leg did not
 *                      exist for a release and the docstring above claimed its
 *                      class anyway — see `enclosingLabel`.
 *   leg "delegated"  — (3) a per-item component handed a whole entity, which
 *                      composes the name inside its OWN file where no grep over
 *                      the panel that renders it will ever see the string. It
 *                      has no sibling visibility, so it cannot disambiguate
 *                      itself: the token has to be threaded in as a prop.
 *   leg "labelledby" — an `aria-labelledby`. The name lives in another element,
 *                      so nothing static can classify it. Listed, never judged.
 *
 * ★★ Leg (3) is the approximate one and is deliberately conservative: it fires
 * only when the name is DATA and its base identifier is a destructured PROP.
 * A component that reads the entity off a context, or off a prop it never
 * destructures, is missed.
 */
export function findSurfaces(text) {
  const scopes = repeatScopes(text);
  const props = componentParamNames(text);
  const sites = [];
  const seen = new Set();
  TAG_RE.lastIndex = 0;
  let m;
  while ((m = TAG_RE.exec(text))) {
    const tag = m[1];
    const open = scanOpenTag(text, m.index);
    if (!open) continue;
    const attrs = text.slice(m.index, open.end);
    if (!isControl(tag, attrs)) continue;
    if (seen.has(m.index)) continue;

    // `aria-label` first: on `ToggleButton` both props exist and `ariaLabel` is
    // the documented override, so reading `label` ahead of it would report the
    // VISIBLE label as the accessible name.
    const labelAt =
      attrs.match(ARIA_LABEL_RE) ?? (/^[A-Z]/.test(tag) ? attrs.match(COMPONENT_LABEL_RE) : null);
    let leg;
    let expr;
    if (labelAt) {
      leg = "attribute";
      expr = attributeValue(attrs, labelAt.index + labelAt[0].length);
      if (expr === null) continue;
    } else if (ARIA_LABELLEDBY_RE.test(attrs)) {
      leg = "labelledby";
      expr = "";
    } else {
      // Its own children first, then a wrapping `<label>`, then nothing.
      const own = open.selfClosing
        ? { expr: "", hasText: false }
        : contentExpression(text, open.end + 1, tag);
      if (own.expr || own.hasText) {
        leg = "content";
        expr = own.expr;
      } else {
        const wrapped = wrappingLabelName(text, tag, m.index);
        // ★★ No name source ANYWHERE — an icon-only control with no label of any
        // kind. That is an axe-visible defect of a different kind (an unlabelled
        // control), not a 2.4.6 collision, so it is out of scope. The rule is now
        // the SAME for `<Checkbox />` and for `<button><TrashIcon /></button>`:
        // the self-closing spelling was skipped here while the open/close one was
        // reported FIXED with an empty name, which put one defect class on both
        // sides of the scope line and padded the FIXED headline with sites no
        // reader could act on.
        if (!wrapped) continue;
        leg = "wrapping-label";
        expr = wrapped.expr;
      }
    }

    const cls = leg === "labelledby" ? "UNRESOLVED" : nameClass(expr);
    const inRepeat = scopes.some((s) => m.index > s.start && m.index < s.end);
    if (!inRepeat) {
      if (cls !== "DATA") continue;
      const bases = [...expr.matchAll(/([A-Za-z_$][\w$]*)\s*\./g)].map((x) => x[1]);
      if (!bases.some((b) => props.has(b))) continue;
      leg = "delegated";
    }

    seen.add(m.index);
    sites.push({
      line: text.slice(0, m.index).split("\n").length,
      tag,
      leg,
      nameClass: cls,
      name: expr.replace(/\s+/g, " ").trim().slice(0, 90),
    });
  }
  return sites;
}

/** Which coverage markers a test file's CONTENT carries, strongest first. */
export function coverageMarkersIn(text) {
  return COVERAGE_MARKERS.filter((m) => m.re.test(text)).map((m) => m.name);
}

const IMPORT_RE = /(?:from|import|mock|requireActual)\s*\(?\s*["'](\.[^"']*)["']/g;

/** Module keys a file pulls in by RELATIVE specifier. Bare package specifiers
 *  are not repo modules and are dropped. */
export function relativeImportsIn(text) {
  const out = [];
  IMPORT_RE.lastIndex = 0;
  let m;
  while ((m = IMPORT_RE.exec(text))) out.push(moduleKey(m[1]));
  return out;
}

/** A file path reduced to the key an import specifier resolves to. */
export function moduleKey(file) {
  const base = file.split(/[\\/]/).pop();
  return base.replace(/\.(tsx|ts|jsx|js|mjs)$/, "");
}

function walk(dir, out) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    // An absent directory must reach the caller as "the scan found nothing",
    // not as an ENOENT stack trace that reads like a broken repository.
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

/** The corpus: `.tsx` sources that can hold JSX, and every test file that could
 *  assert over them. Paths are repo-relative with forward slashes so the report
 *  reads the same on either platform.
 *
 *  ★ This scanner's own three files live in `scripts/` and the walk covers `src`
 *  only, so it structurally cannot judge itself — the hazard the sibling gates
 *  need an explicit exclusion list for does not arise here. */
export function collectSources(repoRoot) {
  const sources = new Map();
  const tests = new Map();
  for (const full of walk(path.join(repoRoot, "src"), [])) {
    const rel = path.relative(repoRoot, full).split(path.sep).join("/");
    if (/\.test\.tsx?$/.test(rel)) {
      tests.set(rel, readFileSync(full, "utf8"));
    } else if (/\.tsx$/.test(rel)) {
      sources.set(rel, readFileSync(full, "utf8"));
    }
  }
  return { sources, tests };
}

/**
 * Cross-reference every surface against the tests.
 *
 * `COVERED`            — an asserting test imports this module directly.
 * `COVERED_VIA_PARENT` — an asserting test imports a module that imports this
 *                        one. ★★ ONE HOP ONLY, and it is a weaker claim: the
 *                        parent's assertion may never reach this component's
 *                        controls at all.
 * `GAP`                — neither. ★★ Read as "nothing was found", not as
 *                        "nothing exists": a test that renders this surface
 *                        through a grandparent, or asserts the property without
 *                        any of the marker phrases, lands here too.
 *
 * ★★★ THE HEADLINE IS COMPUTED TWICE, AND THE SECOND NUMBER IS THE HONEST ONE.
 * `COVERAGE_MARKERS` counts the bare phrase `accessible name` — anywhere in the
 * file, a comment included, and these test files are dense with it — as evidence
 * that a test asserts. Measured when that was found: under all four markers the
 * split was COVERED 59 | VIA_PARENT 34 | GAP 13, and under `expectRowUniqueNames`
 * alone it was 27 | 23 | 56. The gap count a reader quotes was 4.3x optimistic,
 * and the per-file `[marker]` that would have discounted it never reached the
 * summary line. So `byStatus` (all markers) and `byStrongStatus`
 * (`expectRowUniqueNames` only) are both computed here and both printed: the
 * strong number is now impossible to quote away.
 */
export function buildReport({ sources, tests }) {
  const asserting = [];
  for (const [file, text] of tests) {
    const markers = coverageMarkersIn(text);
    if (markers.length === 0) continue;
    asserting.push({
      file,
      markers,
      // Rank by the STRONGEST marker the file carries. Several tests can import
      // one module; crediting whichever came first in directory order would let
      // a bare `unique` — which can be about a unique id — stand in front of a
      // file that actually calls the shared assertion helper, and the reported
      // marker list is the only thing a reader has to discount a COVERED with.
      strength: COVERAGE_MARKERS.findIndex((m) => m.name === markers[0]),
      imports: new Set(relativeImportsIn(text)),
    });
  }
  asserting.sort((a, b) => a.strength - b.strength);
  const strongOnly = asserting.filter((a) => a.markers.includes(STRONG_MARKER));

  // module -> modules that import it, one hop, over the source corpus.
  const importers = new Map();
  for (const [file, text] of sources) {
    const from = moduleKey(file);
    for (const target of relativeImportsIn(text)) {
      if (!importers.has(target)) importers.set(target, new Set());
      importers.get(target).add(from);
    }
  }

  /** Which of `pool`'s tests reaches `key`, directly or one hop up. */
  const attributeCoverage = (key, pool) => {
    const direct = pool.find((a) => a.imports.has(key));
    if (direct) return { status: "COVERED", via: direct.file, markers: direct.markers };
    const parents = importers.get(key) ?? new Set();
    const indirect = pool.find((a) => [...parents].some((p) => a.imports.has(p)));
    if (!indirect) return { status: "GAP", via: null, markers: [] };
    return {
      status: "COVERED_VIA_PARENT",
      via: `${indirect.file} -> ${[...parents].find((p) => indirect.imports.has(p))}`,
      markers: indirect.markers,
    };
  };

  const surfaces = [];
  for (const [file, text] of sources) {
    const sites = findSurfaces(text);
    if (sites.length === 0) continue;
    const key = moduleKey(file);
    surfaces.push({
      file,
      module: key,
      sites,
      ...attributeCoverage(key, asserting),
      strongStatus: attributeCoverage(key, strongOnly).status,
    });
  }

  const summary = {
    sourceFiles: sources.size,
    testFiles: tests.size,
    assertingTests: asserting.length,
    strongAssertingTests: strongOnly.length,
    surfaceFiles: surfaces.length,
    sites: surfaces.reduce((n, s) => n + s.sites.length, 0),
    byLeg: { attribute: 0, content: 0, "wrapping-label": 0, delegated: 0, labelledby: 0 },
    byClass: { FIXED: 0, DATA: 0, TOKENIZED: 0, UNRESOLVED: 0 },
    byStatus: { COVERED: 0, COVERED_VIA_PARENT: 0, GAP: 0 },
    byStrongStatus: { COVERED: 0, COVERED_VIA_PARENT: 0, GAP: 0 },
    // Covered files by the STRONGEST marker their crediting test carries. The
    // three weak rows are the distance between the two status lines above.
    byMarker: Object.fromEntries(COVERAGE_MARKERS.map((m) => [m.name, 0])),
  };
  for (const surface of surfaces) {
    summary.byStatus[surface.status]++;
    summary.byStrongStatus[surface.strongStatus]++;
    if (surface.markers.length > 0) summary.byMarker[surface.markers[0]]++;
    for (const site of surface.sites) {
      summary.byLeg[site.leg]++;
      summary.byClass[site.nameClass]++;
    }
  }
  surfaces.sort((a, b) => a.file.localeCompare(b.file));
  return { surfaces, summary };
}
