# Tiptap CSP nonce — design

**Status:** approved 2026-08-09. Baseline: `main` `66e44712`, 0.226.0 "Emshwiller".

**Goal:** close `docs/open-followups.md` §54 — in a production build every rich-text
editor renders without ProseMirror's base stylesheet, because the prod CSP refuses the
`<style>` element Tiptap injects at runtime.

**Approach:** pass the per-request CSP nonce into Tiptap's supported `injectNonce`
editor option, so the injected `<style>` carries the nonce the existing policy already
accepts. `src/proxy.ts` is not modified; the CSP is not weakened.

**Tech stack:** Next.js `^16.2.11` · React `19.2.4` · `@tiptap/react` +
`@tiptap/starter-kit` `^3.27.1` · Playwright · vitest 4.1.8 · GitLab CI ( (GitLab)).

★ `@tiptap/core` is a TRANSITIVE dependency, not a direct one — the `injectNonce` option
is surfaced through `useEditor`'s options type, which `@tiptap/react` re-exports from
core. Every `node_modules/@tiptap/core/...` path cited below is therefore evidence about
a package this repo does not name in `package.json`, and a StarterKit major upgrade can
move it without any direct-dependency change showing in the diff.

---

## 1. Scope

This spec covers §54 ONLY.

The roadmap's *(before S3b)* row (`docs/open-followups.md` §113) bundles §54 with a
second item — splitting the `HTML_START` classifier so each sink derives its own tag
set. The two share no code: §54 is CSP / build / a dependency's runtime behaviour, the
classifier is the text pipeline. They were deliberately separated into two specs, and
§54 goes first because it was the item whose fix was unknown.

The classifier split gets its own spec. One finding from this session's exploration
belongs in it and is recorded here so it is not lost: §107 describes `HTML_START` as
having two consumers; it measurably has five sink groups, and `sanitizeRichText` — which
calls `descriptionHtml` internally — is itself multi-sink, serving both the template and
document lists. See §7 below.

## 2. What was measured

Everything in this section was established by running a command on `main` `66e44712` on
2026-08-09. It is recorded here because it **corrects** §54's own mechanism section.

### 2.1 The injector is Tiptap, not the bundler

§54 concludes: *"The editor loads via `next/dynamic`, so Turbopack ships that CSS inside
a lazily-loaded client chunk which injects it at runtime with no nonce."* That is an
inference, and it is wrong.

The real injector is `@tiptap/core`'s own `Editor`:

```
node_modules/@tiptap/core/src/Editor.ts:255-257
  private injectCSS(): void {
    if (this.options.injectCSS && typeof document !== 'undefined') {
      this.css = createStyleTag(style, this.options.injectNonce)
```

`style` is a **JavaScript string constant**, not a CSS file:
`node_modules/@tiptap/core/src/style.ts`.

Reproduce the identification:

```bash
node -e 'const s=require("fs").readFileSync("node_modules/@tiptap/core/src/style.ts","utf8");const m=s.match(/^export const style = `([\s\S]*)`\s*$/);console.log(Buffer.byteLength(m[1],"utf8"));'
# -> 1329
```

**1329 bytes is a byte-exact match** for the `<style>` element §54 measured in the live
prod DOM (§54: *"Exactly one `<style>` element: 1329 bytes, no nonce"*). That closes the
identification by measurement rather than inference.

### 2.2 Two candidate mechanisms ruled out

**prosemirror-view does not inject.** It only warns:

```bash
sed -n '4900,4912p' node_modules/prosemirror-view/dist/index.js
# checkCSS() -> console.warn("ProseMirror expects the CSS white-space property to be
# set ... It is recommended to load style/prosemirror.css from the prosemirror-view package.")
```

**`prosemirror.css` is a different file and nothing imports it.**

```bash
wc -c < node_modules/prosemirror-view/style/prosemirror.css     # -> 1243
grep -rn "prosemirror.css\|style/prosemirror" node_modules/@tiptap   # -> no matches
```

1243 != 1329. §54 read `grep -rn "prosemirror.css" src/` returning nothing as *support*
for the bundler theory. It is evidence **against** it: nothing imports that file because
the CSS never travels as CSS at all.

### 2.3 The library already ships the fix

```
node_modules/@tiptap/core/src/types.ts:309   injectCSS: boolean
node_modules/@tiptap/core/src/types.ts:313   injectNonce: string | undefined
node_modules/@tiptap/core/src/Editor.ts:90-91   defaults: injectCSS true, injectNonce undefined
```

`createStyleTag` sets the attribute when given a value:

```
node_modules/@tiptap/core/src/utilities/createStyleTag.ts
  if (nonce) { styleNode.setAttribute('nonce', nonce) }
```

### 2.4 Two injection points, one option

```bash
grep -rn "createStyleTag(" node_modules/@tiptap/*/src/**/*.ts node_modules/@tiptap/*/src/*.ts
# @tiptap/core/src/Editor.ts:257                    createStyleTag(style, this.options.injectNonce)
# @tiptap/extensions/src/selection/selection.ts:39  createStyleTag(selectionStyle, editor.options.injectNonce, 'selection')
```

Both read `editor.options.injectNonce`. `@tiptap/extensions` is not imported directly by
this app today and §54 found exactly one `<style>`, so the selection tag is absent or
inactive — but if a StarterKit upgrade ever activates it, `injectNonce` covers it with no
further work. `injectCSS: false` would not.

### 2.5 One mount site

```bash
grep -rn "useEditor\|new Editor(" src/app --include="*.ts" --include="*.tsx" | grep -v "\.test\."
```

Exactly one call: `src/app/rich-text-editor.tsx:126`, the shared primitive. Every
rich-text surface in the app goes through it.

This matters because `createStyleTag` **dedupes** on `style[data-tiptap-style]` and
returns the existing tag if one is present. With more than one mount site, a single
un-nonced mount would poison every later one. With one site, that hazard is structurally
absent in the app — but not in tests (see §5).

## 3. Options considered

| | Option | Verdict |
|---|---|---|
| **A** | `injectNonce` — pass the per-request nonce into `useEditor` | **CHOSEN** |
| B | `injectCSS: false` + own the 1329 bytes in `globals.css` | rejected |
| C | `'unsafe-inline'` in prod `style-src-elem` (§54's recorded option 2) | rejected |

**A** is the smallest diff, copies no dependency CSS, changes no policy, uses the
library's own supported API, and is the only option covering both injection points.

**B** was rejected on three counts: it copies a dependency's stylesheet (drift on every
upgrade); `injectCSS` gates only `Editor.injectCSS()` and not the selection extension's
tag, so it is incomplete by construction; and the gapcursor rule it would import carries
`border-top: 1px solid black`, an off-palette literal the palette-sweep test scans for.

**C** would extend the single documented low-risk residual in
`docs/security/threat-model.md:71` from style *attributes* to style *elements*. Not
warranted when a supported API exists.

## 4. Architecture

### 4.1 `csp-nonce.ts` (new)

One exported function:

```ts
/** The per-request CSP nonce, read off a nonced <script>'s IDL property. */
export function readCspNonce(): string | undefined
```

Implementation reads `document.querySelector<HTMLScriptElement>("script[nonce]")?.nonce`
and returns `undefined` for an empty or missing value.

**Why the IDL property and not a threaded prop.** The HTML spec empties the `nonce`
*content attribute* once the element is inserted and moves the value to an internal slot
exposed as the `.nonce` IDL property — specifically so a CSS or selector-based attack
cannot exfiltrate it. The presence selector `[nonce]` still matches (the attribute is
present, its value emptied); the value comes off the IDL. Threading the nonce through RSC
props or a React context would put the real value back into readable DOM, which is
strictly worse than reading it where the platform already keeps it.

**Why a nonced `<script>` is always present.** `src/app/layout.tsx:30-34` reads the
`x-nonce` header `src/proxy.ts:77` sets and applies it to a hand-authored inline script,
and `src/proxy.ts:55` nonces `script-src` in **both** dev and prod.

**Degradation.** No nonce found returns `undefined`, which is `injectNonce`'s default —
i.e. exactly today's behaviour. The function never throws and never blocks a mount.

**Placement.** Its own module rather than three lines inside `rich-text-editor.tsx`, so
it is directly testable. It is a new `.ts` file and therefore coverage-gated
(`vitest.config.ts`); three tests reach the floors. It touches `document` and is
browser-only — it must NOT be imported by any DOM-free module.

### 4.2 `rich-text-editor.tsx` (modified)

Add `injectNonce: readCspNonce()` to the existing `useEditor` options object at
`rich-text-editor.tsx:126`. No other change.

`immediatelyRender: false` is already set, so the `Editor` is constructed client-side and
`document` exists when `readCspNonce()` runs.

## 5. Testing

### 5.1 `csp-nonce.test.ts`

Three cases: a nonced script present (returns its value); no script at all (returns
`undefined`); a script whose nonce is the empty string (returns `undefined`, not `""`).

### 5.2 `rich-text-editor.test.tsx` — the wiring

Seed a `<script nonce="test-nonce">` into `document.head`, mount `RichTextEditor`, assert
`document.querySelector("style[data-tiptap-style]")` carries `nonce="test-nonce"`.

**★★ The landmine, and the reason this test needs a `beforeEach`.** `createStyleTag`
appends to `document.head` and dedupes on `style[data-tiptap-style]`, returning the
existing tag when it finds one. RTL's `cleanup()` unmounts the render container and does
**not** touch `document.head`. So the first editor mounted anywhere in the file wins, and
every later assertion in that file reads the *first* mount's tag — a test written the
obvious way passes with `injectNonce` deleted. The `beforeEach` removes any
`style[data-tiptap-style]` (and any seeded script) before each case.

**The guard is mutation-tested:** delete `injectNonce` from the options object, confirm
the test goes red, restore. A test that stays green under that mutation is not testing
this fix.

### 5.3 What unit tests cannot cover

Neither test observes the CSP. jsdom enforces no policy, and dev already permits the tag,
so **the fix is invisible in dev by construction**. The only thing that can observe it
working is a prod smoke run — which is why §6 exists rather than being optional polish.

**★★★ A GREEN jsdom TEST DOES NOT PROVE THE BROWSER PATH, AND THIS IS THE RISK THAT CAN
SINK OPTION A.** `readCspNonce` rests on a real-browser property: that nonce hiding
empties the `nonce` *content attribute* while leaving it present, so the presence
selector `[nonce]` still matches and `.nonce` still returns the value. In jsdom the
attribute is very likely NOT emptied, which means the unit test passes whether or not the
browser behaves as designed — it cannot distinguish "reads the IDL property correctly"
from "reads an attribute the browser would have emptied".

So the first prod-smoke run (§6.4) must also confirm, in a real browser, that
`readCspNonce()` returns a non-empty value and that the resulting `style[data-tiptap-style]`
carries a nonce. Concretely: assert in that run that the tag's nonce is non-empty, not
merely that the CSP violation disappeared — a violation can also disappear for the wrong
reason.

**If the presence selector turns out not to match in a real browser**, the fallback
within option A is to have `layout.tsx` — which already reads `x-nonce` server-side —
render the nonce somewhere the client can read without a selector, and accept the
readable-DOM cost that §4.1 argues against. That is a delivery change only; the
`injectNonce` decision stands either way.

## 6. Prod smoke — script and CI job

### 6.1 Why this is in scope

§54's own process lesson: `npm run e2e:smoke` starts no server. Its header says so. In
practice it is only ever pointed at a dev server somebody already had running, and the
dev CSP is the permissive branch — so a prod-only defect of this size was structurally
invisible to the suite most likely to catch it. That is the reason the bug is old and
unnoticed. Fixing §54 without closing that gap leaves the next prod-only regression just
as invisible.

### 6.2 `scripts/e2e-smoke-prod.mjs` -> `npm run e2e:smoke:prod`

Spawns `next start` on a dedicated port, polls until the server answers, runs
`scripts/e2e-smoke.mjs` against that URL, and stops the server on every exit path
(including failure), reusing the port-scoped kill in `scripts/stop-dev.mjs` — which
already handles win32 (`netstat`/`taskkill`) and posix (`lsof`/`kill`). Never a blanket
`taskkill /IM node.exe`.

It requires `.next/` to exist and fails with a clear message naming `npm run build` if it
does not; it does not build implicitly.

Its exit code is `e2e-smoke.mjs`'s exit code, unpiped.

**★ A new script needs a `scriptsDescriptions` entry in `package.json`** or the prebuild
`docs:scripts:check` fails.

### 6.3 The `prod-smoke` CI job

Stage `e2e`, `needs: [build]`, the same playwright image the `e2e` job pins, the same
`rules:` as `e2e` (merge requests + the default branch). It consumes the `.next/`
artifact `build` already publishes and runs its own `npm ci` plus
`npx playwright install chromium`.

★ The existing `e2e` job sets `dependencies: []` to avoid reusing glibc-mismatched
`node_modules`. That precaution does not apply here: `build` publishes only `.next/`,
which is not `node_modules`, and this job installs fresh anyway.

### 6.4 The one open unknown, and how it is resolved

`e2e-smoke.mjs` exits non-zero on **any** console error or warning, not only a CSP
violation. §54 measured the CSP violation as the *only* issue — on 2026-08-03, on
`13b518db` — and that entry's own rule is to re-measure rather than treat a dated
measurement as a property.

If a clean prod run on current `main` surfaces unrelated prod-only console noise, the job
cannot start blocking without either fixing that noise or absorbing unrelated scope.

**Resolution: run the prod smoke on unmodified `main` as the first step of
implementation, before any code changes.** That run re-establishes §54's dated
measurement on the current baseline, and its issue list decides the job's blocking
status. The matching run AFTER the fix carries the extra obligation from §5.3 — confirm
the injected tag's nonce is non-empty in a real browser, not merely that the violation
went away.

The baseline run's issue list decides:

- **Only the CSP violation** -> the job lands blocking, and the same command re-run after
  the fix is the proof the fix works.
- **Other issues too** -> the job lands with `allow_failure: true`, each additional issue
  is filed as its own numbered register entry, and flipping the job to blocking becomes a
  follow-up. The §54 fix itself is unaffected either way.

This ordering is not a formality. Running the check first is the step whose absence
created this bug.

## 7. Recorded for the classifier spec, not built here

Exploration for this spec turned up a fact that materially changes the *other* half of
the roadmap row. Recording it so the next spec starts from it rather than rediscovering
it.

§107 states the fix shape as *"`descriptionHtml` takes the tag set as a parameter (or
gains a sibling); narrative keeps deriving from `NOTE_ALLOWED_TAGS`"* — describing two
consumers. Measured, `HTML_START` / `descriptionHtml` serve **five** sink groups:

| # | Sink | Tags | Consumers |
|---|---|---|---|
| 1 | `sanitizeNoteHtml` (`KEEP_CONTENT: false`) | 8 | `narrativeToHtml` |
| 2 | `sanitizeNoteHtml` (same) | 8 | `note-log.ts:157` — `sanitizeNoteHtml(descriptionHtml(value))` |
| 3 | `sanitizeTemplateHtml` | 11 | 3 edit modals · `use-resource-planner.ts:427` · `sanitizeAiRichText` · `sanitize-records.ts` (6 fields) |
| 4 | `sanitizeDocumentHtml` | 20 | `sanitizeAiDocumentRichText` · `document-model` |
| 5 | **no sink at all** | — | `rich-text-projection.ts`'s two projections, feeding 16 consumer files |

Counts measured 2026-08-09, not derived: `ALLOWED_TAGS` 11 + `DOCUMENT_ALLOWED_TAGS`'s 9
extras = **20** (an earlier draft of this table said 21); `NOTE_ALLOWED_TAGS` holds 9
entries of which one is the `#text` pseudo-entry, hence 8 real tags — which is exactly
what `HTML_START` mirrors. Group 5's figure is 16 consumers; the bare `grep -l` returns
19 because three of the hits are the defining and commenting modules themselves
(`rich-text-plain.ts`, `rich-text-projection.ts`, `sanitize-html.ts`).

Two consequences the classifier spec has to design around:

- **Group 2 is not mentioned by §107** and is already correctly served by the narrow
  list — a second narrow consumer, not a drifted one.
- **Group 5 has no allow-list to derive from.** "Derive per sink" has nothing to derive
  from for a projection to plain text, so that group needs a decided rule rather than a
  derivation.
- **`sanitizeRichText` is itself multi-sink.** It calls `descriptionHtml` internally and
  serves groups 3 and 4, so parameterising `descriptionHtml` alone does not reach it; the
  set threads through `sanitizeRichText` too, and that function is DOM-free by contract
  with six entity-sanitizer callers.

Reproduce:

```bash
grep -rn "descriptionHtml\|sanitizeRichText" src/app --include="*.ts" --include="*.tsx" | grep -v "\.test\."
```

## 8. Documentation changes

- **`docs/open-followups.md` §54** — REWRITE the "What is established" section, do not
  append. Its mechanism attribution (Turbopack / a lazily-loaded CSS chunk) is wrong, and
  its `grep` evidence points the opposite way from how it is read. Replace with §2 above,
  record option A as chosen with its reasoning, and close the entry once the prod smoke
  confirms it green.
- **`AGENTS.md`** — add `e2e:smoke:prod` to Commands, including the note that it is the
  only local reproduction of the prod CSP; add `prod-smoke` to the CI pipeline bullet
  (the bullet's own closing line requires this).
- **`package.json`** — `scriptsDescriptions` entry for the new script.
- **`CHANGELOG.md` + `src/app/version.ts`** — a user-visible fix, so a version bump, a
  changelog entry, a new `versionHighlight*` key appended to `APP_HIGHLIGHT_KEYS` with EN
  and DE strings, and the five other version-bearing places AGENTS.md lists (none of
  which is gated).

## 9. Out of scope

- The `HTML_START` classifier split (§107 / §114 / §118) — its own spec, per §1.
- Any other prod-only console issue the first smoke run surfaces — filed, not fixed here
  (§6.4).
- Whether any *other* lazily-loaded dependency injects an un-nonced `<style>` on a route
  the smoke does not reach. §54 lists this as not established and it stays that way; the
  `prod-smoke` job narrows it over time rather than settling it now.
