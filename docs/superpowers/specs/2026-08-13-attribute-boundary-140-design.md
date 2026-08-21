# The attribute boundary — §140 · design

Branch `feat/attribute-boundary-140`, cut from `main` at `2263a19b` (0.236.0 "Sheldon").
Designed 2026-08-13.

★★★ **This file is gitignored** (`.gitignore:76`, `/docs/superpowers/`). On any other machine it
does not exist. Every decision that must outlive it is reproduced in `docs/open-followups.md` §140
before the branch merges — the same rule §113 records for the documents roadmap.

---

## 1. What this slice is, and what it is not

The user's request was a four-arrow chain: §140 → §28 → §141 → documents S3b/S3c. That is four to
five separate releases, one of which is a security boundary with its own review. **This spec covers
the first one only.** The rest are mapped in §9 below so the ordering argument is not re-derived.

§140 ships:

1. **Task list** — `data-type="taskList"` / `data-type="taskItem"` + `data-checked`.
2. **Text alignment** — via `data-align`, NOT `style` and NOT `class` (§3).
3. **A value allow-list** enforced by a DOMPurify `uponSanitizeAttribute` hook. Nothing of this shape
   exists in the repo today.
4. **`ALLOW_DATA_ATTR: false` on `sanitizeRichHtml`** — which closes **§115**.
5. **`data-asset-id` value validation** — which closes **§117(b)**.
6. A security review of the result.

It does NOT ship: the §28 codec load boundary; DOCX/PPTX fidelity (§7.4 — explicitly owed, written
into §141(b)); the §141(a) un-escape repair pass; the §146 `PopoverPanel` focus restore (avoided by
design, §5.3); documents S3b/S3c.

---

## 2. Measured design inputs

Every number below was measured on this checkout on 2026-08-13, not carried from the register. Each
carries its reproduce command. **A claim without a command in this file is a claim I did not check.**

### 2.1 The tree

```bash
node -p "const p=require('./package.json');JSON.stringify(Object.entries(p.dependencies).filter(([k])=>/tiptap|purify/.test(k)))"
```
→ every `@tiptap/*` at `^3.27.1`; `dompurify` at `^3.4.10` (installed 3.4.13).

### 2.2 `DOMPurify.addHook` is undefined with no DOM — the SSR-500 landmine

```bash
node -e "const d=require('dompurify'); console.log(typeof d.sanitize, typeof d.addHook, d.isSupported); try{d.addHook('uponSanitizeAttribute',()=>{})}catch(e){console.log('THREW:',e.message)}"
```
→ `undefined undefined false` · `THREW: d.addHook is not a function`.

`sanitize-html.ts` is module-eval-reachable with no DOM: `templates-builtin.ts:1` imports
`plainToHtml` from it, and that function's own docstring records that it is called at module-eval by
the built-in templates and must stay SSR-safe. **So `DOMPurify.addHook` at module top level is a
Next SSR 500.** Registration must be lazy (§4.2).

★ The sample generator is NOT the victim here, and assuming it was would have produced the wrong
guard. `scripts/generate-sample-workspace.ts:53` installs JSDOM onto `globalThis` and only then does
`await import("../src/app/storage")` — a dynamic import, deliberately, with a comment saying exactly
that. DOMPurify is bound by the time `sanitize-html.ts` evaluates there. SSR is the exposed path.

### 2.3 The prod CSP permits inline `style` attributes — so the `style` route was NOT excluded on CSP grounds

```bash
grep -n "style-src-attr" src/proxy.ts
```
→ TWO lines: `:20` is a COMMENT describing the policy, `:74` is the live directive
`"style-src-attr 'unsafe-inline'",`. ★ Stated separately because this repo has already been bitten
by a grep whose hits were mostly prose (§115's bare `ALLOW_DATA_ATTR` returns comment lines and a
first revision asserted "exactly one line" against it). The DIRECTIVE is what settles the question.

The obvious objection to `style="text-align:…"` does not hold;
it was rejected on the grammar argument in §3, not this one. Recorded so nobody re-opens the fork
believing CSP settles it.

### 2.4 Tailwind emits no `.text-justify` — the `class` route's hidden cost

```bash
for c in text-left text-center text-right text-justify; do printf "%s: " "$c"; grep -rno "\b$c\b" src --include=*.tsx --include=*.ts --include=*.css | grep -v "\.test\." | wc -l; done
```
→ `text-left: 121 · text-center: 35 · text-right: 131 · text-justify: 0`. Tailwind v4 scans repo
files for candidates, so a class-based alignment silently has no rule for `justify` until someone
hand-writes one — at which point `data-align` is strictly better anyway.

### 2.5 `TaskItem`'s default `renderHTML` needs four tags the allow-list does not have

```bash
node -e "const s=require('fs').readFileSync('node_modules/@tiptap/extension-list/dist/index.js','utf8'); const i=s.indexOf('var TaskItem'); console.log(s.slice(i,i+3400))"
```
★ `i+3400`, not a shorter window, and the number is load-bearing: `renderHTML` sits at about `+800`
but `addNodeView` is at **`+2645`** and its `ariaLabel` at **`+3087`** (reproduce with
`node -e "const s=require('fs').readFileSync('node_modules/@tiptap/extension-list/dist/index.js','utf8');const i=s.indexOf('var TaskItem');console.log(s.indexOf('addNodeView',i)-i, s.indexOf('ariaLabel',i)-i)"`).
A first draft of this section used `i+1800`, which shows the `renderHTML` half and NOT the nodeView
half — while the paragraph below it said "the same scan shows" both. The command has to reach the
evidence the sentence rests on.

The stock `renderHTML` emits:

```html
<li data-type="taskItem" data-checked="true">
  <label><input type="checkbox" checked><span></span></label>
  <div>content</div>
</li>
```

That is `label` · `input` · `span` · `div` beyond `RICH_ALLOWED_TAGS`, plus attrs `type` and
`checked` — on the SHARED list, which spreads into `DOCUMENT_ALLOWED_TAGS`. And an
`<input type=checkbox>` whose only sibling is an empty `<span>` has no accessible name, which is an
axe-critical failure in Documents — one of the 17 `A11Y_VIEWS`.

★★★ **The same scan shows it is avoidable at zero cost, and the register never noticed.** `TaskItem`
also declares `addNodeView`, which builds the checkbox in the EDITING DOM and already sets
`checkbox.ariaLabel` (default `"Task item checkbox for …"`, overridable via an `a11y.checkboxLabel`
option). NodeViews are editor-only; `getHTML()` serializes through `renderHTML`. So overriding
`renderHTML` alone gives clean stored markup **while keeping Tiptap's interactive labelled
checkbox** in the editor. See §5.2.

### 2.6 `@tiptap/extension-text-align` must be pinned EXACT

```bash
npm view @tiptap/extension-text-align version           # 3.30.0   (2026-08-13)
npm view @tiptap/extension-text-align peerDependencies  # { '@tiptap/core': '3.30.0' }
```
The peer is an exact pin, not a range, against our installed 3.27.1 — so `^3.27.1` breaks the
install. This already bit Task 1 of the §137 slice.

★★★ **§140 records this as 3.29.2 and that number is now STALE — I re-ran the command and got
3.30.0.** The registry moves independently of this repo, so it will be stale again by the time
anyone implements this. **The durable claim is the SHAPE, not the version: latest > installed, and
the peer is an EXACT pin rather than a range, so any caret range breaks the install.** Re-run the
two commands at implementation time; do not trust either number.
★ Recording this because I made the mistake first: the initial draft of this section copied §140's
3.29.2 and presented it as measured. Running the embedded command refuted the sentence it was
attached to — which is precisely what §8 says to do, and why it says it.

Task list needs **no** new package: `@tiptap/extension-list` is already a `starter-kit` dependency
(`node -p "Object.keys(require('./node_modules/@tiptap/starter-kit/package.json').dependencies)"`),
merely unregistered.

### 2.7 `TextAlign`'s source — read, not assumed

Unpacked from `npm pack @tiptap/extension-text-align@3.27.1` into the scratchpad. It is an
`Extension` whose `addGlobalAttributes` returns one `textAlign` attribute with:

- `parseHTML: (el) => el.style.textAlign` (filtered against `options.alignments`)
- `renderHTML: (attrs) => ({ style: \`text-align: ${attrs.textAlign}\` })`
- `addOptions: { types: [], alignments: ["left","center","right","justify"], defaultAlignment: null }`

Three things come free and are used as-is: `toggleTextAlign(a)` already **unsets** when the caret is
already at `a` (exactly 4-toggle-button semantics); `editor.isActive({ textAlign })` is the active
query; `Mod-Shift-l/e/r/j` are registered. ★ `types` defaults to `[]`, i.e. the extension is INERT
unless configured — `types: ["heading","paragraph"]`.

### 2.8 One dompurify importer; 14 PopoverPanel consumers

```bash
grep -rn "from \"dompurify\"" src scripts e2e --include=*.ts --include=*.tsx | grep -v "\.test\."
grep -rln "<PopoverPanel" src/app --include=*.tsx | grep -v "\.test\." | wc -l
```
→ **1** (`sanitize-html.ts:48`) and **14**. The first bounds the "DOMPurify hooks are instance-global"
objection to §4.2. The second is why §146 keeps its own slice (§5.3).

### 2.9 File sizes, real count

```bash
node -e "console.log(require('fs').readFileSync('<file>','utf8').split('\n').length)"
```
→ `rich-text-toolbar.tsx` **464** · `sanitize-html.ts` **255** · `rich-text-editor.tsx` **192**.
None is in `docs/baselines/file-sizes.json`; all stay far under the 800 cap after this slice.
(This is `wc -l` + 1 — the gate's own convention. Budgeting from `wc -l` overstates headroom by one.)

---

## 3. Decision: alignment is `data-align`

Three routes were priced. **Chosen: `data-align="left|center|right|justify"`.**

| | grammar | cost |
|---|---|---|
| **`data-align`** ✅ | set membership over 4 strings | custom `renderHTML`/`parseHTML`; a `globals.css` attribute-selector rule; the standalone HTML export must carry that rule |
| `style="text-align:…"` | **CSS** | opens the `style` attribute NAME across all seven rich fields AND documents, permanently, with a CSS-declaration parser as the only guard |
| `class="text-center"` | set membership over 4 strings | shares a namespace with the app's entire utility set; plus §2.4's scan gap |

The deciding argument is the **grammar**, not the attribute name. §140 measured that an admitted
`style` passes `position:fixed;inset:0;z-index:99999` verbatim because DOMPurify does not parse CSS
values at all — and these fields are AI-writable. A guard over CSS is a guard that can be widened one
declaration at a time (`+ color`, `+ font-size`) until it is a CSS allow-list; a guard over a 4-member
string set cannot drift in that direction. `class` has the same tiny grammar but sits in a namespace
with obvious gravity to grow.

`data-align` also **reuses the exact mechanism task list already forces** — `ALLOW_DATA_ATTR: false`
plus re-admit-by-name plus `ADD_URI_SAFE_ATTR` — so one mechanism serves both features and
`data-asset-id` is the worked precedent already in the file.

★ No stored values exist in either representation today, so there is no migration and no repair pass.

---

## 4. The boundary

### 4.1 One table

`sanitize-html.ts` gains ONE literal holding the whole policy:

```
ATTR_VALUES
  data-align     ∈ {left, center, right, justify}       lower-case only
  data-type      ∈ {taskList, taskItem}
  data-checked   ∈ {true, false}
  data-asset-id  /^[A-Za-z0-9_-]{1,64}$/                closes §117(b)
```

★ Lower-case only is deliberate and tighter than the SC requires: Tiptap emits lower-case, so
accepting `CENTER` buys nothing and widens the set.

★ `data-asset-id`'s grammar is deliberately permissive about FORMAT (it admits uuid, ulid, nanoid, a
content hash, an integer) and strict about CHARSET and LENGTH. It cannot constrain whatever id S3c
mints, and it rejects empty, whitespace, quotes, angle brackets, path separators and 65+ chars.

### 4.2 One lazily-registered hook

```
let hooked = false;
function ensureAttrHook() {
  if (hooked) return;                       // idempotent
  hooked = true;
  DOMPurify.addHook("uponSanitizeAttribute", (_node, data) => {
    const ok = ATTR_VALUES[data.attrName];
    if (!ok) return;                        // INERT for everything else
    if (!ok(data.attrValue)) data.keepAttr = false;
  });
}
```

Called at the top of `sanitizeRichHtml` and `sanitizeDocumentHtml`. **Never at module eval** — §2.2.

Two properties are load-bearing:

- **Inert by default.** The hook fires for every attribute of every `DOMPurify.sanitize` call in the
  file — including the `ALLOWED_TAGS: []` projection — and does nothing unless the name is in the
  table. That is what makes one global hook safe for four call sites.
- **One shared `ALLOWED_ATTR` literal.** The existing comment says the two sanitizers share it "so
  the two cannot drift". The three new names go into that same literal, preserving the property.

### 4.3 Config changes

```
sanitizeRichHtml                          sanitizeDocumentHtml
  ALLOW_DATA_ATTR: false      ← §115        ALLOW_DATA_ATTR: false   (already)
  ALLOWED_ATTR      + the 3                 ALLOWED_ATTR      + the 3 (via the shared literal)
  ADD_URI_SAFE_ATTR   the 3                 ADD_URI_SAFE_ATTR + the 3, keeps data-asset-id
  ensureAttrHook()                          ensureAttrHook()
```

Why each piece is required, in order — this chain is the design and skipping a link silently breaks
the next one:

1. With `ALLOW_DATA_ATTR` at its default `true`, `data-*` hits a **short-circuit** that skips the
   whole remaining chain, name test and value test alike. The hook would never see a `data-checked`.
   So turning it off is simultaneously the §115 fix and the precondition for the table to be
   reachable at all.
2. Turning it off drops the three names into the value chain, where `SAFE_URI_REGEXP`
   (`/^(?:https?|mailto):[^<>"]*$/i`) is tested against EVERY attribute value and rejects any
   non-URI. So each kept name needs `ADD_URI_SAFE_ATTR` as well as `ALLOWED_ATTR`.
3. `ADD_URI_SAFE_ATTR` exempts from the VALUE test entirely — which is precisely why §117(b) was
   open, and why the hook has to exist. The exemption and the table are two halves of one mechanism.

★ `KEEP_CONTENT` is untouched. Flipping it re-creates §137.

---

## 5. Editor and toolbar

### 5.1 TextAlign, rewired to `data-align`

`TextAlign.extend({ addGlobalAttributes: … })`, copying the stock spec (§2.7) with two swaps:

- `parseHTML` — `element.style.textAlign` → `element.getAttribute("data-align")`, keeping the
  `options.alignments.includes(...)` filter so a junk value falls back to `defaultAlignment`.
- `renderHTML` — `{ style: \`text-align: ${…}\` }` → `{ "data-align": attributes.textAlign }`.

Configured `types: ["heading", "paragraph"]` (the default `[]` is inert).

### 5.2 TaskList / TaskItem, serialized clean

Register `TaskList` and `TaskItem` from `@tiptap/extension-list`. Override `TaskItem.renderHTML` ONLY:

```html
<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>…</p></li></ul>
```

The nodeView is untouched, so the editor keeps the interactive labelled checkbox (§2.5). Wire
`a11y.checkboxLabel` to `t(lang, …)` so that accessible name is translated rather than hardcoded
English.

Net effect on the allow-list: **zero new tags, zero new non-`data-` attributes, no form control in
stored workspace HTML.**

### 5.3 Toolbar: five `ControlSpec` entries, four of them inline toggles

Alignment renders as **four inline `ToggleButton`s**, not a popover menu. Reason: a second
`PopoverPanel` in this row would double the reach of **§146** (Escape from a menu drops focus at
`document.body`) on the exact surface §144(a) just built the keyboard contract for — and §146's own
entry argues it wants a dedicated slice with a sweep of all 14 consumers (§2.8), which this
security-boundary slice should not absorb. The heading menu stays the row's only popover.

All five go into `CONTROLS`, which is the **automatic** path: `LINK_INDEX`, `UNLINK_INDEX` and
`TOOLBAR_CONTROL_COUNT` all derive from `CONTROLS.length`, and the `tabIndex={activeIndex === index +
CONTROLS_OFFSET ? 0 : -1}` wiring comes from the existing `.map`. No hand-written JSX button, so the
manual-`tabIndex` failure mode AGENTS.md warns about is never entered.

`CONTROLS` 12 → 17; `TOOLBAR_CONTROL_COUNT` **15 → 20**. `GROUP_DIVIDER_BEFORE` indices shift.

**One contained widening.** `ControlSpec.name` feeds `live.isActive(spec.name)`, but alignment is an
ATTRIBUTE query (`isActive({ textAlign })`). Add an optional `active?: (e: Editor) => boolean`
defaulting to `e.isActive(spec.name)`.

★★★ It must be evaluated INSIDE the `useEditorState` selector. That file's own ★★★ note records why:
the selector scopes re-render to a change in the SELECTED value, so any render-time `editor.` read
left outside is refreshed only when some already-selected value happened to move, and is stale
otherwise — with the suite green, because a fixture that moves a selected value hides it.

### 5.4 i18n

Five new control labels (task list · align left/center/right/justify) plus the task-item checkbox
label, EN + DE. `i18n.de.ts` is CRLF and the Edit tool corrupts umlauts there — patch via a node utf8
write and re-verify.

---

## 6. Rendering

### 6.1 In-app and standalone HTML — CSS only

`globals.css` gains attribute-selector rules; `doc-render-html.ts`'s standalone `<style>` gains the
same rules (PDF is that renderer's print path, so one edit covers both).

```css
[data-align="left"]{text-align:left}      /* … right, center, justify */
ul[data-type="taskList"]{list-style:none;padding-left:0}
li[data-type="taskItem"]{display:flex;gap:…}
li[data-type="taskItem"]::before{content:"☐"}
li[data-type="taskItem"][data-checked="true"]::before{content:"☑"}
```

No Tailwind utilities → no scan dependency (§2.4). No colour, no shadow, no gradient → no palette
impact.

### 6.2 A STATED LIMIT, not a solved problem

Read-only surfaces render raw HTML through `dangerouslySetInnerHTML`, and with `<input>`
deliberately excluded (§5.2) the checked state lives only in the `data-checked` attribute plus a
`::before` glyph. Browsers do expose generated content to the accessibility tree, so it is
announced as a character name rather than as "checked" — weaker than a real checkbox. CSS
`content: "☑" / "checked"` alt-text syntax is the possible upgrade, but support is uneven.

**Record this in the register as a known limit.** Do not let a later reader infer from "we chose the
a11y-safe markup" that read-only announcement is solved; the choice avoided an axe-critical
*unlabeled control*, which is a different property.

### 6.3 Flat exports — the `[x]` / `[ ]` prefix

`richCell` routes every rich column through `descriptionTextWithBreaks`, so one change reaches
XLSX / CSV / HTML-table / PDF at once.

★★★ The hazard is that the projection has TWO implementations — the DOM-free regex
`htmlPlainProjection` (`rich-text-plain.ts`) and the browser `htmlToText` path
(`rich-text-projection.ts`) — and a prefix added to one and not the other is exactly the drift class
AGENTS.md documents. **Constraint: the prefix strings come from ONE exported constant, and a test
asserts both paths yield identical output for the same task-list input.**

★ Byte-stability suites are unaffected: no fixture carries a task list or an alignment, and this
slice deliberately does NOT add either to `sample-workspace-small.json`. No golden regeneration.

---

## 7. Testing

### 7.1 At the boundary, never against the table

A predicate test proves the predicate; only a real `sanitizeRichHtml(...)` / `sanitizeDocumentHtml(...)`
call proves the wiring. Cases:

- each of the four attributes kept at a legal value;
- each dropped at an illegal one;
- `data-align="justify;position:fixed"` dropped (the compound-value case the CSS route could not
  have guarded so cheaply);
- an unlisted `data-foo` dropped — **that assertion IS the §115 fix**;
- `data-asset-id` still surviving `sanitizeDocumentHtml`;
- serialized task-list output contains no `<input>` and no `<label>`.

### 7.2 Mutation-proof each guard; report the count

Four independent guards, each must turn something red when removed:

| mutation | expected red |
|---|---|
| drop `ALLOW_DATA_ATTR: false` | `data-foo` survives |
| drop `ADD_URI_SAFE_ATTR` | `data-align` stripped by `SAFE_URI_REGEXP` |
| drop the hook | an illegal value survives |
| revert `TaskItem.renderHTML` | `<input>` appears in serialized output |

★★ A surviving mutant is a QUESTION, not a pass — "equivalent mutant" and "missing test" look
identical from the harness. Go find the input the suite lacks.

### 7.3 One source-scan test

Assert `addHook` is never called at module top level — the SSR-500 guard from §2.2. Matches the
existing DOM-free-guard pattern in this area (comment-stripped source scan: comments may name the
API, code may not). Nothing else in the repo can see this.

### 7.4 Toolbar tests

`TOOLBAR_CONTROL_COUNT` is already pinned against the real DOM by a unit test — update to 20, and
that test is what catches a missed `tabIndex` wiring. Order test updated. The multi-editor
name-collision test is unaffected.

### 7.5 tsc trap — flagged before it bites

`setTextAlign` / `toggleTextAlign` / `toggleTaskList` are typed by `declare module '@tiptap/core'`
INSIDE their own packages. A toolbar calling them while only the editor imports the extensions works
at runtime and passes vitest, and fails `npx tsc --noEmit` only. Run tsc after touching either file.

### 7.6 axe is silent here — on the record

Documents IS in `A11Y_VIEWS`, but `e2e/seed.ts` seeds no task list and no alignment, so the scan
renders neither. The unit tests are the only detector, in this view and every other. A green axe run
says nothing about this slice.

### 7.7 Gates

- `npx eslint --max-warnings=0 src/app` (the bare `npm run lint` exits 0 with warnings present).
- `npx tsc --noEmit`.
- `npm run test:run` then `npm run test:shuffle` — never through a pipe; redirect, echo `$?`, read
  the file.
- `npm run dup:check`, `npm run size:check`, `npm run docs:symbols:check`, `npm run docs:claims:check`.
- `dependency-audit` — one new dependency.
- `npm run e2e:smoke:prod` — a new Tiptap extension is exactly the class of change §54 hid behind.
  `TextAlign`'s source injects no CSS (§2.7), which is an argument for EXPECTING green, not for
  skipping the run.
- axe: `npx playwright test e2e/a11y.spec.ts --project=chromium --workers=1` for the views touched.

### 7.8 Review

`security-reviewer` on the sanitizer diff, plus a cold reviewer briefed to REFUTE this spec. §140
asks for a security review by name and this is the one slice in the chain that earns it.

---

## 8. Doc decay this slice causes

Three live claims go false the moment it lands, all in ungated prose, all saying the same thing in
three places:

| Where | Claim that breaks |
|---|---|
| `AGENTS.md` (the ★★★ "three differences, exactly ONE widens" bullet) | becomes TWO differences (`img`, cap). Its measured example `rich('<p data-foo="1">a</p>')` → keeps-attribute is falsified |
| `docs/AGENTS/ai-assistant.md` | second copy of the same claim |
| `docs/CODEMAPS/data.md` (`ai-rich-text.ts` row) | third copy, with its own measured example |

Plus counts: AGENTS.md's "`RichTextToolbar` renders FIFTEEN controls" → twenty. The neighbouring
"it cost 15 tab stops per editor" is HISTORICAL (it describes the pre-§144(a) state) and stays —
read it in context rather than blind-editing every 15 in the file.

★★★ **Every replacement sentence gets its own command run against IT, not against the error it
replaces.** A correction is a NEW claim and inherits none of the verification of the thing it
corrects. The last three branches each shipped correction rounds that introduced fresh falsehoods,
in every case because the author had run a command — just not against the sentence they ended up
writing.

Register: **§140, §115, §117(b) close.** **§141(b) gains the DOCX/PPTX deliverable** (§9).
§6.2's read-only-checkbox limit gets its own recorded note.

Release: `src/app/version.ts` + `CHANGELOG.md` + the five ungated version places — `package.json`,
BOTH `package-lock.json` occurrences, the README shields badge (version AND codename), and the
`<!-- Generated: … -->` header on all five `docs/CODEMAPS/*.md`.

---

## 9. What stays owed, and in what order

★★★ **DOCX/PPTX is the item most at risk of being silently dropped, and it is written into the
register by this slice, not left in this gitignored file.**

| Slice | Owns | Blocked by |
|---|---|---|
| **B — §28 codec load boundary** | post-decode hook in `csvToWorkspace` / `markdownToWorkspace` / `TursoBackend.load()`. The DOM-free constraint is the whole problem; needs its own golden-stability answer | — |
| **C — §141(b) export fidelity** | wire the seven rich entity fields onto `htmlToRichLines`; heading LEVEL and list NUMBERING are lost today. **Plus, added by this slice:** alignment needs a new LINE-level property (runs cannot carry a paragraph property) and task items need `[x]`-equivalent handling, in BOTH `doc-render-docx.ts` and `doc-render-pptx.ts`. Also §141(d)'s one `<STRONG>` test | A (this slice) |
| **D — documents S3b** | the block editor; gutter carries kind chip + ⋮ and NO drag handle | A |
| **E — documents S3c** | images end to end, Turso-gated | D, **plus the unmeasured Turso request-size limit** (a 5 MB image is ~6.7 MB of base64 in one string `SqlArg`; §95 means CI cannot measure it). Planning S3c before that number is wasted work |
| §141(a) | the un-escape repair pass — a SEPARATE decision, and its own entry says to price doing nothing | — |
| §146 | `PopoverPanel.onClose(reason)` + focus restore on `"escape"` only, swept across all 14 consumers | — |
