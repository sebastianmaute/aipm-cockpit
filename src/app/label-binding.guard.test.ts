import { describe, it, expect } from "vitest";
import { stripComments } from "../test/strip-comments";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Guard: no `<label>` may wrap a widget whose first labelable descendant is a
// BUTTON, unless the label says explicitly what it labels via `htmlFor`.
// ---------------------------------------------------------------------------
//
// ★★★ A `<label>` with no `for` binds to its FIRST LABELABLE DESCENDANT — among
// the elements this app uses, button · input · meter · output · progress ·
// select · textarea (an `<input type="hidden">` is NOT labelable and a
// form-associated custom element IS; the repo has neither). Chip rows,
// radiogroups and contenteditables are NOT labelable, so such a label adopts a
// BUTTON inside instead: hovering the caption paints that button's hover state
// and clicking the caption forwards a synthetic click to it — which UNLINKS an
// entity on a link picker and WRITES data on a `SegmentedControl`.
//
// ★★ WHY A SOURCE SCAN AND NOT ONLY RENDER TESTS. The runtime helper
// (`src/test/label-binding.ts`) is the stronger check — it asks an actual
// implementation of the association algorithm (jsdom's, under vitest) rather
// than pattern-matching — but it is blind to two whole classes under jsdom:
// the dictation mic never renders (`voice.ts` `getCtor()` returns null) and
// `KnowledgeLinksFieldGated` renders a bare `<p>` while SharePoint is off. Both
// classes shipped this defect and neither was catchable from a unit render.
// This scan sees the SOURCE, so it sees them.
//
// ★★★ IT IS A NAMED-WIDGET SCAN, NOT A GENERAL ONE, AND THAT IS ITS CEILING.
// It cannot know that some other component renders a button first — only the
// widgets listed below. A new button-first component is invisible to it until
// someone adds it here. Do NOT read a green run as "no label is mis-bound".
const BUTTON_FIRST: readonly { readonly what: string; readonly re: RegExp }[] = [
  // Toolbar (Bold/Italic/…) renders before the contenteditable, which is not
  // labelable at all.
  { what: "RichTextEditor", re: /<RichTextEditor\b/ },
  // Radio-like buttons inside a `role="radiogroup"` div.
  { what: "SegmentedControl", re: /<SegmentedControl\b/ },
  // Chips (each with an unlink ✕) render ABOVE the search box.
  { what: "TaskLinkPicker", re: /<TaskLinkPicker\b/ },
  { what: "EntityLinkPicker", re: /<EntityLinkPicker\b/ },
  { what: "StakeholderChipPicker", re: /<StakeholderChipPicker\b/ },
  // Label chips, each with a remove ×, render before the free-text input.
  { what: "LabelsInput", re: /<LabelsInput\b/ },
  // Per-link ✕ buttons and an Add button, and no input at all.
  { what: "KnowledgeLinksField", re: /<KnowledgeLinksField\w*\b/ },
  // Dependency chips, each with a remove ✕ (`IconButton`), render ABOVE the
  // type `<Select>` — so a task with at least one dependency adopts that ✕ and
  // clicking the caption calls the remove handler.
  // ★★ RENAMED with the component (`DependenciesEditor` → `DependencyLinkGroup`,
  // now rendered TWICE — once per direction). The entry has to be renamed WITH
  // it: a stale name matches nothing, so both new `<Field>`s would have been
  // unguarded while this list still looked complete. The inner
  // `EntityLinkPicker` entry above does NOT cover them — this is a per-FILE
  // source scan, and the caller's `<Field>` body names only this component.
  { what: "DependencyLinkGroup", re: /<DependencyLinkGroup\b/ },
  // `useDictationMic` returns an OBJECT whose `mic` property is the node, and
  // call sites destructure it and interpolate that node — so this matches the
  // interpolation rather than a tag: `{titleMic}`, `{descriptionMic}`, `{mic}`.
  { what: "dictation mic", re: /\{\s*\w*[Mm]ic\s*\}/ },
  // ★★ A BARE button — the LITERAL-SOURCE case, which is NOT the general case
  // the entries above are instances of. It matches `<button` written in the
  // block's own text, so a COMPONENT that renders a button first stays invisible
  // until it is named here; that is the ceiling restated, not an escape from it.
  // The dependency-picker entry above (then named `DependenciesEditor`, now
  // `DependencyLinkGroup`) was found by a cold review as a live counterexample
  // sitting in the tree while this list looked complete.
  // Measured 2026-08-06, both directions, with
  // `npx vitest run src/app/label-binding.guard.test.ts --reporter=dot`:
  // delete `group` from the task form's HEALTH field (`label={t(lang,"health")}`
  // — a row of `<button aria-pressed>` chips and nothing labelable) and this
  // file goes RED with `<Field> leads with a bare <button> and lacks \`group\``;
  // comment this ENTRY out as well and the same file is GREEN — so without it
  // the one site fixed by hand was pinned by nothing.
  // ★ Cited by FIELD NAME, not `file:line`: the first version of this comment
  // said :511, and the Dependencies comment added in the same change pushed the
  // field to :513 — the citation was stale before it was ever read.
  { what: "a bare <button>", re: /<[Bb]utton\b/ },
];

// ★★★ THE RULE IS POSITIONAL — "first labelable descendant" — so the scan must
// be too. A mic AFTER its `<Input>` is harmless: the input already won the
// association. Only a widget standing BEFORE every labelable element can be
// adopted.
// ★★ THE WORKED EXAMPLE IS GONE, AND THE RULE IS UNCHANGED. task-form-fields'
// title field WAS that trailing mic — flagging it was this guard's first false
// positive — but it no longer trails: it moved into the caption as
// `captionAction`, which forces `Field` into `group` mode (a `<div
// role="group">`, never a binding `<label>`), so that field is now safe for a
// DIFFERENT reason than the one this paragraph states. Re-enumerating every mic
// render site under src/app leaves NO trailing-mic call site anywhere: each
// survivor is a LEADING mic rescued by an explicit `htmlFor`/`id` (change,
// milestone, RAID, the four stakeholder fields), or is not a label-binding case
// at all (the note-log mics sit beside buttons in a flex row; the task
// description mic's caption is a plain `<span>`, not a `<label>`). So the
// trailing half of the rule is pinned ONLY by the synthetic assertions below —
// do not delete them for want of a live example, and do not go looking for one.
// ★★ This set holds only elements that ARE labelable, or components that
// certainly render one FIRST. `<button>`/`<Button>` are deliberately ABSENT: a
// button getting in front IS the defect, so treating it as safe would silence
// exactly what this scans for.
// ★★ `ResourcePicker` and `ComboInput` are here because they were MEASURED to
// open with an `<input>` — `resource-picker.tsx:172` (its clear ✕ is at :219,
// after) and `combo-input.tsx:87`. That is a real coupling: if either ever
// renders a button ahead of its input, this entry silences the scan at every
// site using it. Re-check the order before trusting it, and add nothing here on
// the strength of its NAME.
// ★ Omitting a wrapper component instead is the safe direction — it reads as
// "not labelable" and produces a loud FALSE POSITIVE, never a miss. That is not
// hypothetical: adding the bare-`<button>` rule below immediately flagged the
// task form's Assignee field, whose `ResourcePicker` does lead with an input.
const LABELABLE = /<(input|select|textarea|Input|Select|Textarea|Checkbox|ResourcePicker|ComboInput)\b/;

// ★★ Why stripping exists at all — measured against the pre-strip scanner: a JSX
// comment inside a label body that merely NAMES a labelable tag (a landmine line
// such as "mirrors the `<Input>` pattern") made a real button-first widget after
// it read as trailing, a SILENT miss; and a comment containing `<label>` re-paired
// the tokenizer's stack, so the block it emitted carried the comment's (empty)
// attrs and a correctly-`htmlFor`'d label read as unnamed. This repo's house style
// is landmine comments full of backticked tag names, so both are realistic rather
// than contrived.
//
// ★★ The local stripper this replaced was ALSO CORRUPTING THIS SCAN'S INPUT, which
// nothing noticed for as long as it existed. Its `{\s*/\*…\*/\s*}` rule matched from
// an unrelated `{` to a much later `*/}` and blanked REAL CODE — whole `import`
// blocks among it — so the tokenizer below was reading a mangled file. Still
// reproducible: the regexes are at `git show
// 333f1dd3:src/app/label-binding.guard.test.ts`, and the measurement compares, per
// position, what they blank against the comment ranges `src/test/strip-comments.ts`
// reports. ★★ No total is quoted here, and one was removed: see the note in that
// module on why a whole-tree aggregate cannot survive the commit that quotes it.
// ★★★ THE GUARANTEE IS ONE-SIDED, AND AN EARLIER REVISION HERE CLAIMED BOTH HALVES
// ("zero characters blanked that are not in a comment, zero comment characters left
// readable"). The second half was FALSE when written — the stripper parsed every
// file as TSX, so `workspace.ts`'s non-comma generic arrow opened a JSX element and
// left 8,250 comment characters readable — and the check could not see it, because
// its reference shared the same misparse. What holds today, measured against an
// INDEPENDENT reference — the union of every significant token's span, EXCLUDING
// nodes between `FirstJSDocNode` and `LastJSDocNode`: zero over-blanking across
// every `.ts`/`.tsx` file in `src`.
// ★★★ THAT EXCLUSION IS THE MEASUREMENT, NOT A DETAIL, and an earlier revision of
// this sentence omitted it — so anyone re-deriving the claim the way it was written
// would have DISPROVED a true statement. TypeScript hangs JSDoc nodes off the
// declaration they document, so a leaf walk masks the identifiers inside every
// `/** … */` block as "significant", i.e. as code the stripper must not touch. Run
// the reference without the exclusion and it reports over-blanking across most of
// `src` on a tree where the real answer is zero.
// That is the direction that matters — over-blanking DELETES code from the text
// this scan reads, while a comment left readable merely restores the behaviour
// every earlier cut had. Nothing that shares the parser can prove the other half,
// so it is not claimed.
// ★ The label count this scan reads is unchanged either way; no figure is quoted
// here because it moves with every form edit, and the floors in the suite below are
// what actually pin it.
// ★ Still length-preserving, for the same reason the local one was: `standsFirst`
// compares match INDEXES and the tokenizer reports line numbers off this output.

/** Balanced `<tag …> … </tag>` bodies, self-closing tags skipped (no children
 *  means nothing can be adopted). A stack, not a lazy `.*?`, so a nested tag of
 *  the same name cannot close its parent early. */
function blocks(src: string, tag: string): { attrs: string; body: string; line: number }[] {
  const token = new RegExp(`<(/?)${tag}\\b([^>]*?)(/?)>`, "gs");
  const out: { attrs: string; body: string; line: number }[] = [];
  const open: { attrs: string; end: number; line: number }[] = [];
  for (let m = token.exec(src); m !== null; m = token.exec(src)) {
    const [full, closing, attrs, selfClosing] = m;
    if (closing === "/") {
      const start = open.pop();
      if (start) out.push({ attrs: start.attrs, body: src.slice(start.end, m.index), line: start.line });
      continue;
    }
    if (selfClosing === "/") continue;
    // ★ Line of the OPENING tag — a bare "somewhere in this file" cost a real
    // hunt the first time this gate fired on a file with 16 `<Field>`s.
    open.push({ attrs, end: m.index + full.length, line: src.slice(0, m.index).split("\n").length });
  }
  return out;
}

function sourceFiles(): string[] {
  // Recursive: `src/app` is flat by convention but not in fact (settings-sections
  // and the pure-engine subdirs), and a scan that missed a subdir would be a
  // silent hole rather than a failure.
  return readdirSync(__dirname, { recursive: true, encoding: "utf8" })
    .filter((f) => f.endsWith(".tsx") && !f.endsWith(".test.tsx"))
    .map((f) => join(__dirname, f));
}

/**
 * Attribute text with every `{…}` expression removed, innermost first.
 *
 * ★★ Without this the `group` check reads the VALUES too, and `<Field
 * label={t(lang, "group")}>` — the task form's real "Group" field — exempts
 * itself from the scan by naming the prop it does not pass. Found by mutation
 * testing this guard, not by review.
 */
function bareAttrs(attrs: string): string {
  // ★★ Quoted values go FIRST and for the same reason as the braces: without
  // this, `label="user group"` / `aria-describedby="group-hint"` / a className
  // containing the word exempt a block that renders a real `<label>`. Measured
  // — all three returned `true` before this line existed. Latent, not live: no
  // `<Field>` in `src/app` carries a quoted attribute containing "group".
  let out = attrs.replace(/"[^"]*"|'[^']*'/g, "");
  for (let prev = ""; prev !== out; ) {
    prev = out;
    out = out.replace(/\{[^{}]*\}/g, "");
  }
  return out;
}

/**
 * Whether a `<Field>` actually renders the `role="group"` wrapper.
 *
 * ★★ Not just `/\bgroup\b/` over `bareAttrs`: that strips the VALUE, so
 * `group={false}` collapses to `group=` and exempts a block that still renders a
 * real `<label>` — an exemption granted by the presence of the prop rather than
 * by what it is set to. No call site does this today (checked all 43 `<Field>`
 * blocks); the hole was found by review, so it is latent, not live.
 * ★ A non-literal `group={cond}` cannot be resolved from source, so it counts as
 * ABSENT. That is the loud direction: a genuinely-conditional caller gets a false
 * positive and has to say so here, rather than a silent pass.
 */
function hasGroupProp(attrs: string): boolean {
  if (/\bgroup\s*=\s*\{\s*true\s*\}/.test(attrs)) return true;
  return /\bgroup\b/.test(bareAttrs(attrs.replace(/\bgroup\s*=\s*\{[^{}]*\}/g, "")));
}

/** True when `re` matches inside `body` AHEAD of the first labelable element. */
function standsFirst(body: string, re: RegExp): boolean {
  const hit = re.exec(body);
  if (!hit) return false;
  const labelable = LABELABLE.exec(body);
  return labelable === null || hit.index < labelable.index;
}

/**
 * Every offending block in ONE already-comment-stripped source string.
 *
 * ★★★ Split out from `offenders()` so the rules can be fed SYNTHETIC source. A
 * self-test that re-states a rule's regex pins the regex, not the scan: delete
 * the loop that uses it and such a test stays green. This function is the thing
 * the real assertion runs, so a test that feeds it markup pins the whole path.
 * Measured before the split: breaking the nested-`<label>` regex in both loops
 * left this file green 8/8, because 0 blocks match the live tree either way.
 */
export function scanSource(src: string, rel: string): string[] {
  const found: string[] = [];
  {
    for (const { what, re } of BUTTON_FIRST) {
      // A `<label>` is allowed to lead with one of these ONLY when it names its
      // control explicitly — that is the second sanctioned fix (used where the
      // caption legitimately names a real input a mic merely got in front of).
      for (const b of blocks(src, "label")) {
        if (standsFirst(b.body, re) && !/\bhtmlFor=/.test(b.attrs)) {
          found.push(`${rel}:${b.line}: <label> leads with ${what} and has no htmlFor`);
        }
      }
      // `Field` renders a `<label>` unless `group` is passed.
      for (const b of blocks(src, "Field")) {
        if (standsFirst(b.body, re) && !hasGroupProp(b.attrs)) {
          found.push(`${rel}:${b.line}: <Field> leads with ${what} and lacks \`group\``);
        }
      }
    }
    // ★★★ THE NON-BUTTON CASE, AND BOTH OTHER GUARDS ARE STRUCTURALLY BLIND TO IT.
    // A caption wrapping a GRID OF CHECKBOXES adopts the first checkbox: clicking
    // "Regulatory requirements" ticked the first box. The source scan above cannot
    // see it (a leading `<input>` is what `LABELABLE` treats as PROOF of correct
    // binding) and the DOM helper cannot either (`labelsBoundToButtons` filters on
    // `tagName === "BUTTON"`), so the class had no coverage at all.
    // The tell is the nested `<label>` each checkbox carries — which is also
    // invalid HTML, since a label may not contain another label. Measured across
    // `src/app`: exactly 2 blocks match, and both were real offenders, so this
    // rule is precise rather than a heuristic that needs an allow-list.
    // ★ Deliberately NOT keyed on "contains several inputs": a multi-input block
    // is legitimate when the caption names one of them via `htmlFor`.
    for (const b of blocks(src, "Field")) {
      if (/<label\b/.test(b.body) && !hasGroupProp(b.attrs)) {
        found.push(`${rel}:${b.line}: <Field> wraps a nested <label> and lacks \`group\``);
      }
    }
    // ★★ NO `htmlFor` EXEMPTION HERE, unlike the button-first loop above. A
    // nested `<label>` is invalid HTML whether or not the outer one names a
    // control, and exempting it would make this rule DISAGREE with its DOM twin
    // `labelsContainingLabels`, which has no such escape — the same markup would
    // pass the source gate and throw in all nine render call sites.
    for (const b of blocks(src, "label")) {
      if (/<label\b/.test(b.body)) {
        found.push(`${rel}:${b.line}: <label> wraps a nested <label>`);
      }
    }
  }
  return found;
}

/** `"<file>: <label|Field> wraps <widget>"` for every offending block in src/app. */
function offenders(): string[] {
  return sourceFiles().flatMap((path) =>
    scanSource(stripComments(readFileSync(path, "utf8"), path), path.slice(__dirname.length + 1).replace(/\\/g, "/")),
  );
}

describe("label binding guard", () => {
  it("finds the source files to scan", () => {
    // Vacuity guard: a broken glob would make every assertion below pass.
    const files = sourceFiles();
    expect(files.length).toBeGreaterThan(100);
    expect(files.some((f) => f.endsWith("knowledge-panel.tsx"))).toBe(true);
    // A SUBDIRECTORY file — pins the recursion, which a flat readdir would drop
    // silently while every other assertion here stayed green.
    expect(files.some((f) => f.includes("settings-sections"))).toBe(true);
    expect(files.every((f) => !f.endsWith(".test.tsx"))).toBe(true);
  });

  it("actually finds blocks in the REAL tree, not just in synthetic strings", () => {
    // ★★★ The gap this closes: every other assertion here pins the tokenizer on
    // hand-written strings. If it silently stopped matching real multiline JSX,
    // `offenders()` would return [] and the suite would go green while scanning
    // nothing. Floors, not exact counts — measured at 212 labels / 43 Fields on
    // 2026-08-06, left loose so ordinary edits don't fail the build.
    let labels = 0;
    let fields = 0;
    for (const path of sourceFiles()) {
      const src = stripComments(readFileSync(path, "utf8"), path);
      labels += blocks(src, "label").length;
      fields += blocks(src, "Field").length;
    }
    expect(labels).toBeGreaterThan(150);
    expect(fields).toBeGreaterThan(30);
  });

  it("parses a balanced block and skips self-closing tags", () => {
    // Pins the tokenizer itself — the assertion below is only as good as this.
    expect(blocks(`<label a="1"><b/></label>`, "label")).toEqual([
      { attrs: ' a="1"', body: "<b/>", line: 1 },
    ]);
    expect(blocks(`<Field group />`, "Field")).toEqual([]);
    // The reported line is the OPENING tag's, not the closing one's.
    expect(blocks(`x\n\n<label>\n<b/>\n</label>`, "label")[0].line).toBe(3);
    // A nested same-name tag must not close the outer one early.
    expect(blocks(`<label x><label y>i</label>o</label>`, "label").map((b) => b.body)).toEqual([
      "i",
      "<label y>i</label>o",
    ]);
  });

  it("does not let a COMMENT silence or misattribute a block", () => {
    // ★★★ Both directions were measured against the pre-fix scanner.
    // (1) This repo's house style is landmine comments that backtick tag names,
    //     so a comment naming `<Input>` inside a label body made the real
    //     button-first widget after it read as "trailing" — a SILENT miss.
    const silenced = `<label>{/* mirrors the <Input> pattern */}<SegmentedControl/></label>`;
    const [b1] = blocks(stripComments(silenced), "label");
    expect(standsFirst(b1.body, /<SegmentedControl\b/)).toBe(true);
    // (2) A comment containing `<label>` re-paired the stack LIFO, so the block
    //     emitted carried the COMMENT's attrs ("") and a correctly-htmlFor'd
    //     label read as unnamed — a loud false positive, but on the wrong tag.
    const misattributed = `<label htmlFor="a">{/* not a <label> */}{titleMic}<Input id="a"/></label>`;
    const got = blocks(stripComments(misattributed), "label");
    expect(got).toHaveLength(1);
    expect(got[0].attrs).toContain('htmlFor="a"');
    // Length is preserved so line numbers stay honest after stripping.
    expect(stripComments(silenced)).toHaveLength(silenced.length);
    expect(stripComments("a\n{/* x\ny */}\nb").split("\n")).toHaveLength(4);
  });

  it("detects a button-first widget inside a label (self-test)", () => {
    // Proves the matcher fires — without this the real assertion could be
    // green because nothing is ever detected.
    const bad = `<label className="block"><span>Cap</span><TaskLinkPicker lang={lang} /></label>`;
    expect(blocks(bad, "label")).toHaveLength(1);
    const [b] = blocks(bad, "label");
    expect(BUTTON_FIRST.some(({ re }) => standsFirst(b.body, re))).toBe(true);
    expect(/\bhtmlFor=/.test(b.attrs)).toBe(false);
  });

  it("detects a caption wrapping a checkbox grid (self-test)", () => {
    // ★★★ Same purpose as the button-first self-test above, and it was MISSING
    // when this rule shipped: because 0 blocks match the live tree today, the
    // real assertion returns `[]` whether the rule works or not. Measured —
    // breaking the rule's own regex left this file green 8/8. So the newest
    // rule, the one covering the class both other guards are blind to, was
    // pinned by nothing.
    // ★ Runs the REAL scan over synthetic source, not a restatement of its
    // regex — a test that re-states the rule stays green when the loop USING it
    // is deleted, which is the exact hole this replaced.
    const grid = `<Field lang={lang} label={t(lang,"projectRegulatory")}><div className="grid"><label><input type="checkbox"/>GDPR</label></div></Field>`;
    expect(scanSource(grid, "synthetic.tsx")).toEqual([
      "synthetic.tsx:1: <Field> wraps a nested <label> and lacks `group`",
    ]);
    // …and the fixed spelling is reported by nothing.
    const fixed = grid.replace('label={t(lang,"projectRegulatory")}', 'label={t(lang,"projectRegulatory")} group');
    expect(scanSource(fixed, "synthetic.tsx")).toEqual([]);
    // A nested label is invalid HTML even when the outer one names a control,
    // so `htmlFor` must NOT buy an exemption here (it does for button-first).
    const withFor = `<label htmlFor="a"><span>Cap</span><label><input type="checkbox"/>x</label></label>`;
    expect(scanSource(withFor, "synthetic.tsx")).toEqual([
      "synthetic.tsx:1: <label> wraps a nested <label>",
    ]);
  });

  it("reads the `group` PROP, not a `group` mentioned inside an attribute value", () => {
    // `<Field label={t(lang, "group")}>` is a real field in task-form-fields.
    // Reading raw attrs would exempt it from the scan permanently.
    expect(/\bgroup\b/.test(bareAttrs(' label={t(lang, "group")} hint={x}'))).toBe(false);
    expect(/\bgroup\b/.test(bareAttrs(' label={t(lang, "priority")} group'))).toBe(true);
    // Nested braces collapse too — the `a=` stub is left behind, which is
    // harmless: only the presence of the bare word `group` is read.
    expect(bareAttrs(" a={f({group: 1})} group")).toBe(" a= group");
    // ★ Quoted values are stripped for the same reason — each of these exempted
    // a real `<label>` before `bareAttrs` handled string literals.
    expect(/\bgroup\b/.test(bareAttrs(' label="user group"'))).toBe(false);
    expect(/\bgroup\b/.test(bareAttrs(' aria-describedby="group-hint"'))).toBe(false);
  });

  it("ignores a widget that TRAILS a labelable element, and only that", () => {
    // The positional half of the rule, both directions. Trailing mic = the
    // input already won the association; leading mic = the mic is adopted
    // instead.
    // ★ SYNTHETIC BY NECESSITY, not by preference. task-form-fields' title
    // field used to be the live trailing example; it moved into the caption as
    // `captionAction` and no trailing-mic call site remains anywhere in
    // src/app, so these assertions are the ONLY thing pinning the trailing
    // half of the rule. Deleting them because "nothing does this" would retire
    // the guard against the defect coming back.
    const mic = /\{\s*\w*[Mm]ic\s*\}/;
    expect(standsFirst(`<Input value={v} />{titleMic}`, mic)).toBe(false);
    expect(standsFirst(`{titleMic}<Input value={v} />`, mic)).toBe(true);
    // No labelable element at all — nothing can outrank the widget.
    expect(standsFirst(`<span>Cap</span>{titleMic}`, mic)).toBe(true);
  });

  it("no label or Field in src/app wraps a button-first widget unnamed", () => {
    expect(offenders()).toEqual([]);
  });
});
