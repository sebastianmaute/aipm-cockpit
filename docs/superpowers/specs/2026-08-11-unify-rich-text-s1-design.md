# Unify rich text — slice 1: one list, one editor, one sanitizer

_Designed 2026-08-11 against 0.231.0 "Sargent" (`33ab5ec3`). Closes `docs/open-followups.md` §137._

★★★ **This file lives in `docs/superpowers/`, which is gitignored.** On any other machine it does not
exist. That is the failure mode §44 and §113 were opened to record. Every decision below that outlives
the slice must be copied into `docs/open-followups.md` or `AGENTS.md` **in the implementing commit** —
not linked to from there, since a link into this tree is dead for everyone but the machine that wrote it.

---

## 1. The problem

Three layers disagree about what markup a rich entity field may hold, and only two of them were ever
compared (§137):

| layer | what it is | tags |
|---|---|---|
| classifier | `SINK_TAGS.template` (`html-start.ts`), derived per sink since §107 | 11 |
| storage | `TEMPLATE_ALLOWED_TAGS` / `sanitizeTemplateHtml` | 11 — `p br strong em u h1 h2 ul ol li a` |
| editor | the lean `RichTextEditor` variant's schema + its `sanitizeNoteHtml` commit | 8 — no `u`, no headings |

`u`, `h1` and `h2` are therefore **write-only**: the allow-list permits them, the AI path produces them,
and the editor a human uses can neither create nor commit one. Worse, `sanitizeNoteHtml` sets
`KEEP_CONTENT: false`, so the narrower layer does not merely reformat the wider layer's output — it
**deletes the words**. §137 measures five losses through the real exported sanitizers, and they occur on
**every load** of every JSON and IndexedDB workspace, with no human and no save involved.

### What the user asked for

One rich text editor, one feature set, used by every rich field — the
[Tiptap Simple template](https://template.tiptap.dev/preview/templates/simple) set:

> Heading 1, 2, 3, 4 · bullet list, ordered list, task list · block quote · code block ·
> bold, italic, strikethrough, underline · code · highlight · link · superscript, subscript ·
> align left, center, justify, right

and **all five content classes** collapse onto it: the seven entity rich fields, note-log entries, the
dashboard narrative, comm templates and meeting reports.

### Why this is slice 1 of 2

Sixteen of the eighteen requested features are pure **tag** markup. Two — **task list** and
**alignment** — require new **attributes**, which is a shared security boundary. They are slice 2.
This slice ships everything else and closes §137.

---

## 2. Measurements this design rests on

All run 2026-08-11 on the installed `dompurify 3.4.13` under jsdom, against the repo's real
`SAFE_URI_REGEXP` and `TEMPLATE_ALLOWED_TAGS`. Reproduce by writing the probe below **inside the project
tree** (module resolution needs the project's `node_modules`; a scratchpad path fails with
`ERR_MODULE_NOT_FOUND`) and running `node <path>`.

### 2a. A ★★★ claim in `AGENTS.md` and §113 is FALSE

> "**Alignment CANNOT be markup, and this generalises.** `sanitize-html.ts` applies
> `ALLOWED_URI_REGEXP` to EVERY attribute value, not only URI-bearing ones — already why `target`/`rel`
> never survive (§38). `style="text-align:center"` and `class="…"` fail identically."

They do not fail identically. Measured, **with controls**:

```
K control target/rel  : <a href="https://x/y">l</a>        target + rel STRIPPED   (control holds)
L control lang attr   : <p>x</p>                           lang STRIPPED           (control holds)
   style  listed -> SURVIVES | <p style="text-align:center">x</p>
   class  listed -> SURVIVES | <p class="text-center">x</p>
   title  listed -> SURVIVES | <p title="plain words">x</p>
   id     listed -> SURVIVES | <p id="abc">x</p>
   lang   listed -> stripped | <p>x</p>
```

`style`, `class`, `title` and `id` are members of DOMPurify's **`DEFAULT_URI_SAFE_ATTRIBUTES`**, so the
`ALLOWED_URI_REGEXP` value test is never applied to them. `target`, `rel` and `lang` are not, which is
why those three die. The mechanism the claim names is real; the conclusion drawn from it is wrong.

★★ The controls are load-bearing. Without `K`/`L` this reads as a probe that failed to configure the
regexp at all. Both controls confirm the value test is armed and biting in the same run.

★★ **Correcting this claim is in scope for this slice** even though the slice does not ship alignment.
A false ★★★ landmine is worse than none: it tells the next reader that slice 2 is impossible.

### 2b. Nothing constrains the VALUE of a surviving `style` / `class`

```
M : <p style="position:fixed;inset:0;z-index:99999;background:#fff">x</p>   full-viewport overlay
J : <p class="fixed inset-0 bg-white z-50">x</p>                            arbitrary Tailwind
N : <p style="background:url(javascript:alert(1))">x</p>                    passed through verbatim
O : <p style="width:expression(alert(1))">x</p>                             passed through verbatim
```

`N` and `O` are inert in modern browsers; `M` and `J` are not — they are a live clickjacking / overlay
surface, and these fields are **AI-writable**. So alignment needs a **value allow-list**
(`text-align: left | center | right | justify`, nothing else) enforced by a `uponSanitizeAttribute` hook
or a post-sanitize pass. That is slice 2's core, and it is why slice 2 gets its own security review.

### 2c. Task list works today only through an open gap

```
G task list, today (ul/li)  : <ul data-type="taskList"><li data-checked="true"><p>done</p></li></ul>
H task list, data attrs off : <ul><li><p>done</p></li></ul>
```

`ALLOW_DATA_ATTR` defaults to **true** on `sanitizeTemplateHtml` and `sanitizeNoteHtml` — that is §115,
an open finding. Task-list markup therefore survives today, but only because arbitrary `data-*` does.
Slice 2 sets `ALLOW_DATA_ATTR: false` on every sanitizer and admits the two names explicitly.

### 2d. The probe

```js
// .demo-tmp/probe-align.mjs — must live inside the project tree
import { JSDOM } from "jsdom";
import createDOMPurify from "dompurify";
const DOMPurify = createDOMPurify(new JSDOM("").window);
const SAFE_URI_REGEXP = /^(?:https?|mailto):[^<>"]*$/i;
const TAGS = ["p","br","strong","em","u","h1","h2","ul","ol","li","a"];
const base = { ALLOWED_TAGS: TAGS, ALLOWED_ATTR: ["href","target","rel"], ALLOWED_URI_REGEXP: SAFE_URI_REGEXP };
console.log("K", DOMPurify.sanitize('<a href="https://x/y" target="_blank" rel="noopener">l</a>', base));
console.log("L", DOMPurify.sanitize('<p lang="de">x</p>', { ...base, ALLOWED_ATTR: [...base.ALLOWED_ATTR, "lang"] }));
const wide = { ...base, ALLOWED_ATTR: [...base.ALLOWED_ATTR, "style", "class"] };
console.log("C", DOMPurify.sanitize('<p style="text-align:center">x</p>', wide));
console.log("D", DOMPurify.sanitize('<p class="text-center">x</p>', wide));
console.log("G", DOMPurify.sanitize('<ul data-type="taskList"><li data-checked="true"><p>d</p></li></ul>', base));
```

### 2e. What is NOT measured

* Whether a human can produce `<u>` by keystroke without the AI path. §137 records a jsdom
  `userEvent.keyboard` probe that produced no `<u>` and flags it as a likely driver artifact. Settling
  it needs a real browser. **This slice does not need the answer** — the AI path alone produces all
  three write-only tags, and the sanitizer half is measured regardless of provenance.
* Bundle-size delta from three new Tiptap extensions. Flagged in §8, not measured here.

---

## 3. Scope

### In

1. One tag allow-list, one sanitizer, one classifier sink, one editor, one toolbar.
2. All five content classes on it.
3. The §137 load-path deletion and the §137 leading-tag escape, both closed.
4. Correction of the false ★★★ alignment claim in `AGENTS.md` and §113.

### Out — and where each goes

| deferred | to | why |
|---|---|---|
| task list, alignment | slice 2 | new attributes; shared security boundary; own review |
| `ALLOW_DATA_ATTR: false` (§115) | slice 2 | same boundary, same review |
| repair of already-escaped stored values | slice 3 | cannot reliably distinguish literal text that looks like markup |
| entity fields onto `htmlToRichLines`; heading level + list numbering in DOCX/PPTX | slice 3 | export fidelity, independent of storage width |
| §31 unbounded markup bytes | slice 3 | pre-existing, worsened marginally |
| §129 static Tiptap imports | own slice | pre-existing, worsened by three extensions |
| §38 `target`/`rel` stripping | own slice | rewrites stored `<a>` markup, moves goldens |

---

## 4. The data layer

### 4a. `RICH_ALLOWED_TAGS`

Replaces both `TEMPLATE_ALLOWED_TAGS` and `NOTE_ALLOWED_TAGS` in `sanitize-html.ts`:

```
p br hr strong em u s code pre blockquote h1 h2 h3 h4 ul ol li mark sub sup a
```

* `hr` is included although it was not requested: `DOCUMENT_ALLOWED_TAGS` already allows it, and a
  unified list that omits it would **silently narrow documents**.
* `h5`/`h6` are excluded — the request is headings 1–4, and `LINE_TAGS` in `rich-text-runs.ts` already
  handles `H5`/`H6` if one ever arrives from legacy data.
* `#text` (present in `NOTE_ALLOWED_TAGS`) is dropped; it is not a tag name and `htmlStartRe` filters it.

### 4b. `sanitizeRichHtml`

```
ALLOWED_TAGS: RICH_ALLOWED_TAGS
ALLOWED_ATTR: ["href", "target", "rel"]     // unchanged; target/rel documented-but-inert per §38
ALLOWED_URI_REGEXP: SAFE_URI_REGEXP          // unchanged, shared literal
KEEP_CONTENT: DOMPurify default (unwrap)     // ← the behavioural change
```

Replaces `sanitizeTemplateHtml` and `sanitizeNoteHtml` at every non-test call site. Sweep:

```bash
grep -rn "sanitizeTemplateHtml\|sanitizeNoteHtml" src/app --include="*.ts" --include="*.tsx" | grep -v "\.test\."
```

Both old names are **removed**, not aliased — an alias is a fourth list waiting to drift, which is the
exact failure §107, §114 and §137 each record.

★★ **The deliberate loss.** `KEEP_CONTENT: false` existed to stop "a stray heading/table body" leaking
into a lean note. After this change an unlisted tag (`<table>`, `<h5>`, `<form>`) unwraps and its text
lands in the note body. That is the safer failure — losing formatting beats losing words — and it is now
one policy across every sink. `sanitizeDocumentHtml` already made this choice and documents its reasoning.

### 4c. `sanitizeDocumentHtml` stays

Documents keep a separate sanitizer for exactly one reason: `img` + `data-asset-id` +
`ALLOW_DATA_ATTR: false` + `ADD_URI_SAFE_ATTR`. Its list becomes `[...RICH_ALLOWED_TAGS, "img"]`.

★ Verify this is a **widening** of the document list, never a narrowing: today's
`DOCUMENT_ALLOWED_TAGS` is `TEMPLATE + s code pre blockquote hr mark sub sup img`, so the delta is
`h3 h4` gained and nothing lost. Assert it with a set-difference test rather than by reading.

### 4d. The classifier

`SINK_TAGS` goes from four derived sinks to three — `note` and `template` merge into `rich`:

```
rich:       RICH_ALLOWED_TAGS
document:   DOCUMENT_ALLOWED_TAGS
projection: DOCUMENT_ALLOWED_TAGS
```

★★★ **`projection` STAYS a separate member and must NOT be folded into `document`.** An earlier
revision of this section said to fold them because the two arrays are equal today. They are equal by
COINCIDENCE, not by derivation: `html-start.ts` documents at length that `projection` is *not* a sink at
all — `descriptionText`/`descriptionTextWithBreaks` strip every tag, so THE RULE ("never recognise less
than your sink keeps") does not bind, and the list is instead a deliberate trade between the §107/§114
under-recognition defect and the §32 over-recognition one, taken by choosing the WIDEST list available.
Folding it deletes the reason and couples a trade to an allow-list that a later slice will widen for an
unrelated reason (`img`, then slice 2's attributes). Keep the member; keep its comment.

`render` is unchanged and stays the one sink with no allow-list behind it. `DerivedSink` and
`RichTextSink` narrow by one member only; every `descriptionHtml(stored, "note" | "template")` call site
moves to `"rich"`, and `sanitizeRichText(raw, max, "template")` inside `ai-rich-text.ts` moves with them.

★★ **THE RULE from `html-start.ts` still governs and now costs nothing to satisfy:** never recognise
LESS than your sink KEEPS. With unwrap semantics everywhere, a classifier that is too WIDE is no longer
dangerous either — the sink keeps the text regardless. That is what makes this slice safe to do in one
move, and it is why §137 says widening the `note` sink *alone* was a trap.

### 4e. `sanitizeRichFields` — where §137 actually closes

`note-log.ts`'s `sanitizeRichFields` applies `sanitizeNoteHtml(descriptionHtml(value, "note"))` to every
rich field it is given, and all four per-entity normalizers (`sanitizeNoteFields`,
`sanitizeRaidRichFields`, `sanitizeChangeRichFields`, `sanitizeMilestoneRichFields`) are that one function
with a different field list. Both whole-object load boundaries — `jsonToWorkspace` and the IndexedDB load
— call all four. Swapping the sanitizer and the sink here is what closes §137 for all seven fields on
every load.

★ Keep the four normalizers as **one-argument** functions. Every call site is `.map(fn)`, which passes the
index as a second argument; a `(entity, fields)` signature would be fed `0, 1, 2…`, normalise nothing, and
leave every `.map`-based test green.

### 4f. `BLOCK_TAG`

`rich-text-plain.ts`'s `BLOCK_TAG` is
`/<\/?(?:p|div|br|li|ul|ol|h[1-6]|blockquote|tr|td|th)\b[^>]*>/gi` — it has no `pre`. A code block would
fuse with its neighbours in both projections. Add `pre`.

★★ `separateBlockBoundaries`' `sep` is typed `" " | "\n"`, not `string`, because it lands in a
`String.replace` REPLACEMENT position where `` $` `` and `$&` are special. Do not widen it.

★★ Every default-path projection is byte-pinned. Adding `pre` to `BLOCK_TAG` **will** move any golden
whose fixture contains a `<pre>`; today none should. Verify by running the goldens, not by reasoning.

---

## 5. The editor

### 5a. Collapse the variants

`RichTextEditorProps.variant` and `RichTextEditorVariant` are removed. `LEAN_EXTENSIONS` and
`FULL_EXTENSIONS` collapse to one array:

```
StarterKit.configure({ heading: { levels: [1, 2, 3, 4] } }),
Highlight,
Subscript,
Superscript,
```

Everything previously disabled on the lean variant — `heading`, `blockquote`, `codeBlock`, `code`,
`strike`, `horizontalRule`, `underline` — is re-enabled. `commitOnEnter`, `mergeFields`, `fieldLabel`,
`labels`, `lang` and `editorRef` all survive as props; only `variant` goes.

New dependencies: `@tiptap/extension-highlight`, `@tiptap/extension-subscript`,
`@tiptap/extension-superscript`, pinned to the installed `3.27.1` line.

★ Verified by reading `node_modules/@tiptap/starter-kit/package.json` at 3.27.1, not assumed —
StarterKit already declares `@tiptap/extension-underline`, `-strike`, `-code`, `-code-block`,
`-blockquote`, `-heading`, `-horizontal-rule`, `-bullet-list`, `-ordered-list`, `-list-item`,
`-list-keymap` and **`-link`**. Only highlight, subscript and superscript are missing. Reproduce:

```bash
node -e "console.log(Object.keys(require('./node_modules/@tiptap/starter-kit/package.json').dependencies).join('\n'))"
```

★★ **Slice 2 needs no new package for task list either** — StarterKit bundles `@tiptap/extension-list`,
which is where `taskList`/`taskItem` live in Tiptap v3. Slice 2's cost is the attribute policy and its
security review, not a dependency. Only alignment (`@tiptap/extension-text-align`) is a new package there.

★★ **`dependency-audit` is a BLOCKING CI gate.** Run `npm audit` after installing and before pushing;
a transitive advisory in a new package fails the pipeline, not the build.

### 5b. Markdown input rules come back on

They were disabled because the lean sanitizer **deleted** what they produced — typing `# Q3 highlights`
stored nothing at all, with no error and no toast, and for the dashboard narrative Save stayed disabled
because `unchanged` was then true. Every tag those rules emit is now allow-listed, so `# `, `> `,
` ``` `, `` `x` ``, `~~x~~` and `--- ` all work and their output survives the commit.

★ Behaviour change worth stating in the CHANGELOG: typing `# ` at the start of a note now makes a
heading rather than leaving literal `# `.

### 5c. `rich-text-toolbar.tsx`

The toolbar moves to its own file — `rich-text-editor.tsx` would otherwise absorb ~15 controls and walk
into the 800-line ratchet. Presentational: editor instance + `lang` + `labels` in, JSX out.

★★ Read the real line count with
`node -e "console.log(require('fs').readFileSync('src/app/rich-text-editor.tsx','utf8').split('\n').length)"`
— the ratchet counts `split("\n").length`, which is `wc -l` **+ 1**. Budgeting from `wc -l` overstates
headroom by exactly one line.

Controls, in order:

| group | controls | element |
|---|---|---|
| block | heading level (Normal · H1 · H2 · H3 · H4) | one labelled `<select>` |
| block | bullet list · ordered list · blockquote · code block | `ToggleButton` |
| mark | bold · italic · underline · strikethrough · code · highlight | `ToggleButton` |
| mark | superscript · subscript | `ToggleButton` |
| link | set/edit link · remove link | `IconButton` / plain button |

★★★ **`ToggleButton`, never a hand-rolled `aria-pressed` button.** The existing `ToolbarButton` in
`rich-text-editor.tsx` is a hand-rolled `aria-pressed` control and is one of §55's thirteen offenders —
its on-state is colour-only, which fails WCAG 1.4.1 in the three dark schemes (measured contrast
1.22 / 1.16 / 1.03:1). `ToggleButton` carries the non-colour `data-pressed-marker` glyph. Retiring
`ToolbarButton` removes several §55 sites as a side effect; say how many in the closing note, counted
not estimated.

★ The `<select>` needs a real `aria-label` — a visible `<span>` is not an accessible name, and the axe
gate scans four of the five surfaces. It must also satisfy WCAG 2.5.3 by **containment**, not prefix.
★★ `label-content-name-mismatch` is `experimental`, so axe's default `tagExclude` means the gate never
runs it — and the rule cannot see a `<select>` at all (`combobox` is not a role supporting
name-from-content). A unit test is the only possible detector.

★ Keep `onMouseDown={(e) => e.preventDefault()}` on every control. Without it, mousedown blurs the
contenteditable, and any commit-on-blur consumer (dashboard narrative, notes window) re-renders or
remounts the editor between mousedown and mouseup, so no `click` is ever dispatched.

★ `flex flex-wrap gap-1`: fifteen controls render inside four modals with tight vertical space.

### 5d. i18n

One EN key + one DE key per control, per `APP_HIGHLIGHT_KEYS` conventions. DE must use real umlauts
(`i18n-encoding` bans ASCII substitutions) and **must be patched via a node utf8 write, not the Edit
tool**, which corrupts umlauts and curls double quotes in `i18n.de.ts`. That file is CRLF — a node
replace whose anchor uses `\n` silently no-ops; match `\r\n`.

### 5e. Call-site sweep

Ten `variant="lean"` sites (7 entity fields + 2 note-log + dashboard narrative) and two implicit-full
sites (comm templates, meeting report) all drop the prop. Sweep:

```bash
grep -rn "<RichTextEditor" src/app --include="*.tsx" | grep -v "\.test\."
```

★ `commitOnEnter` on the note composer and the dashboard narrative now coexists with code blocks and
lists, where Enter would normally insert a newline. This is **pre-existing** — lists were already
reachable on the lean variant — but the surface widens. Do not silently change the Enter contract;
if it needs to change, that is its own decision.

---

## 6. Testing

TDD. Each item below is written red first.

1. **Sanitizer fixtures — the §137 table.** The five measured losses, asserted lossless through the new
   sanitizer, plus the leading-tag escape case asserted to stay real markup through one load and two.
2. **List/classifier derivation.** `SINK_TAGS.rich` is `RICH_ALLOWED_TAGS`; `DOCUMENT_ALLOWED_TAGS ⊇
   RICH_ALLOWED_TAGS`; set-difference against today's document list is exactly `{h3, h4}`.
3. **Per-control emission.** One test per toolbar control: it produces its tag, and the tag survives the
   sanitizer unchanged. **Mutation-proved** — deleting the control turns exactly that test red.
4. **Toggle a11y.** Every toggle renders through `ToggleButton` (pressed marker present in both states,
   `invisible` when off); the heading `<select>` has an accessible name; label containment holds.
5. **Load boundary.** All four per-entity normalizers, all seven fields, mid-value and leading-tag
   shapes. Assert against a **mutated fixture** so the test cannot pass vacuously.
6. **Byte stability.** `golden-workspace.test` unchanged. If a golden moves, the input changed — find
   out why before regenerating.

★★ A test asserting "nothing was deleted" is vacuous unless the fixture would show deletion under the
old code. Pin each with a positive observable: assert the surviving WORD, not the absence of an error.

Gates, all unpiped, exit code read directly:

```bash
npx tsc --noEmit; echo "EXIT=$?"
npx eslint --max-warnings=0 src/app; echo "EXIT=$?"
npm run test:run > /tmp/suite.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/suite.log
npm run test:shuffle; npm run dup:check; npm run size:check
npm run docs:symbols:check; npm run docs:claims:check
npx playwright test e2e/a11y.spec.ts --project=chromium --workers=1
```

★★★ Never read a gate's exit code through a pipe — you get the pipe's status and the diagnostic is
discarded. ★ `--workers=1` is mandatory whenever more than one axe view is matched: CI runs axe
serially, local runs it at CPU count, and over-subscription produces `Test timeout` failures that name
no rule and are not violations.

---

## 7. Docs owed in the implementing commit

| file | change |
|---|---|
| `AGENTS.md` | correct the ★★★ "Alignment CANNOT be markup" claim with §2a's measurement + controls; update the three-sanitizer description; update the rich-text module map |
| `docs/open-followups.md` §137 | CLOSED, with what closed it and what did not (escaped stored values, task list, alignment) |
| `docs/open-followups.md` §113 | correct the same alignment claim in its S3b cell; note the unified editor is now available to S3b |
| `docs/open-followups.md` §115 | still open; note slice 2 owns it |
| `docs/open-followups.md` §55 | count how many hand-rolled toggles this retires; decrement, counted not estimated |
| `docs/AGENTS/*.md` | rich-text bullets that name `sanitizeNoteHtml` / `sanitizeTemplateHtml` / the lean set |
| new register entry | slice 2 (attribute boundary) and slice 3 (fidelity + repair), so neither depends on this gitignored file |

★★ `docs:symbols:check` only proves a backticked **mixed-case** name exists somewhere in `src`. Every
`SCREAMING_CASE` constant named in these docs — `RICH_ALLOWED_TAGS`, `SINK_TAGS`, `BLOCK_TAG` — is
completely ungated. Removing one leaves the docs describing it as current forever.

---

## 8. Risks

| risk | severity | handling |
|---|---|---|
| Comm-template **emails** widen — AI-authored HTML may carry `pre` `mark` `sup` `h3` | medium | accepted; Outlook renders all four. Eye-verify one send preview. |
| `KEEP_CONTENT:false` removal changes note-log behaviour for unlisted tags | low | intended; §4b states it; the failure direction is safer |
| §129 worsens — 3 more extensions ship statically at 6 of 8 call sites | low | flagged, not fixed; measure the delta and record it |
| Markdown input rules become live in notes | low | CHANGELOG entry |
| 15 controls in a tight modal toolbar | medium | `flex-wrap`; **eye-verify all four modals** — jsdom has no layout and axe cannot see overflow |
| A golden moves unexpectedly | high if ignored | never regenerate to mask a diff; find the input change first |
| `size:check` on `rich-text-editor.tsx` | low | toolbar extraction is what prevents it; measure with the `split("\n")` command, not `wc -l` |

---

## 9. Release

Standard chain. `src/app/version.ts` (`APP_VERSION` + `APP_BUILD_DATE` + `APP_MILESTONE`),
`CHANGELOG.md`, any new `versionHighlight*` key appended to `APP_HIGHLIGHT_KEYS` with EN + DE strings,
**plus the five ungated places**: `package.json`, `package-lock.json` (two occurrences), the README
shields badge (version **and** codename), and the `<!-- Generated: … -->` header on all five
`docs/CODEMAPS/*.md`.

★ Codename: pick fresh and verify absence against release **headings** in `CHANGELOG.md` immediately
before use — a name reserved in a gitignored plan is reserved in no sense the next release can see.

★★ `version.ts` is CRLF. An LF-anchored node replace no-ops **silently** while its siblings succeed.

---

## 10. Definition of done

- [ ] one list, one sanitizer, one classifier sink, one editor, one toolbar — old names removed, not aliased
- [ ] all five content classes on the unified editor; `variant` prop gone
- [ ] §137's five measured losses lossless, pinned by mutation-proved tests
- [ ] the false alignment claim corrected in `AGENTS.md` and §113, with the measurement and its controls
- [ ] slices 2 and 3 recorded as numbered register entries, so nothing depends on this file
- [ ] every gate green, each exit code read unpiped
- [ ] eye-verified: four entity modals, the note composer, the dashboard narrative, one comm-template send preview
