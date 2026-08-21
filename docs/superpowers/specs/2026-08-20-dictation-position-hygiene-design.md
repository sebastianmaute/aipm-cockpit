# Dictation insert position + register hygiene — design

**Date:** 2026-08-20
**Branch:** `feat/dictation-position-hygiene` off `efad123f` (0.250.0 "McAuley")
**Closes:** §170, §175, §176, §192, §193, §194

## Why

0.250.0 moved Tiptap behind a `next/dynamic` boundary and gave the editor's
`appendText` a second branch. The two branches insert in **different places**, and
which one runs is decided by whether the chunk had landed when the user pressed the
mic:

| chunk state at the call | route | result on `<p>existing</p>` |
|---|---|---|
| not yet arrived | queued, replayed with `{focus:false}` → `appendPos` | `<p>existing dictated</p>` (APPENDED) |
| already arrived | live path, no `opts` → `chain().focus().insertContent` | `<p> dictatedexisting</p>` (PREPENDED) |

Same note, same call, two results, nothing on screen to say which. That is the
defect this slice exists to remove. `docs/open-followups.md` §192 carries the full
measurement and the three options; **option 3** is the one taken here.

Five smaller register items ride along because four of them are in the same two
files and the fifth is a two-line docblock. They are passengers, not the point.

## Scope

**In:** §192 (behaviour), §194 (test), §193, §175, §176, §170.

**Out, and why:**

- **§136** (`sanitizeInlinePatch`'s `dependencies` branch has no caller) — already a
  recorded DECISION, not work. The branch is a sanitizer left deliberately in place
  so a future inline affordance cannot be reintroduced unsanitised. Closing it means
  writing nothing.
- **§151** ("runs under bare node" is false in eight places) — not hygiene. Two of
  the asserting sites (§36(a), §49) are the stated reason an allow-list pass is NOT
  applied to a model-writable field. If the rationale is dead there, those are live
  security gaps rather than accepted ones, and neither has ever been probed. Needs
  its own slice with a security review. **A rule with a false rationale can still be
  a correct rule.**

## 1. §192 — the insert position

### Where the state lives

`src/app/rich-text-editor.tsx`, not the lazy wrapper. The real editor remounts per
editing session, so a ref there resets exactly when it should: a fresh mount has
never been focused, which is the condition the queue replay depends on.

- `const everFocused = useRef(false);`
- an `onFocus` handler in the `useEditor` config setting it true. There is no focus
  handler there today — this adds one.

### The split

Today `opts.focus` selects **both** the position and whether to focus. Option 3
separates the two concerns:

- **position** ← `everFocused.current` — caret if the user has ever been in this
  editor, `appendPos` if not
- **focus** ← `opts.focus !== false` — unchanged meaning

```ts
const atCaret = everFocused.current;          // read BEFORE building the chain
let chain = editor.chain();
if (opts?.focus !== false) chain = chain.focus();
return (atCaret
  ? chain.insertContent({ type: "text", text })
  : chain.insertContentAt(appendPos(editor.state.doc), { type: "text", text })
).run();
```

★★ `everFocused` is read BEFORE the chain is built. Our own `.focus()` fires
Tiptap's `onFocus`, so a read taken later would let this call's focus decide this
call's position. ★★★ **REFUTED — AN EARLIER REVISION OF THIS PARAGRAPH LICENSED DELETING
THE READ.** It said: "Reasoned, not pinned: `.focus()` is queued until `.run()`, so a
read placed after `chain.focus()` still observes the pre-call value and no mutant
exists." Both halves are FALSE against @tiptap/core 3.x. `createChain` runs each
command's BODY at call time — `const callback = command(...args)(props)` — and defers
only `view.dispatch`; and `focus` calls `view.dom.focus()` SYNCHRONOUSLY under
`isiOS() || isAndroid()` and under `isSafari() && !isiOS() && !isAndroid()`. So on
those three platforms a read taken after `chain.focus()` DOES observe `true`, and the
line is load-bearing rather than stylistic.
★★ What IS true is the narrower claim: no test in THIS repo can catch a regression,
because jsdom matches none of those user-agent checks and Playwright runs chromium
here, which takes the rAF path. That is a gap with a named cause, not an absence of
consequence — `docs/open-followups.md` §195. Say THAT at the site, and do not tidy
the read down into the ternary.

### Why the race dies

A replay runs at `attach`, where `everFocused` is still false, so the deferred route
takes `appendPos`. The live route on
that same never-focused editor now **also** takes `appendPos`. Both routes agree,
and which one runs stops mattering.

★ NOT "a queued line is by definition dictated before the editor existed" — that was
this spec's original premise and it is false: a line is ALSO queued when a LIVE handle's
`appendText` returns false, by which point the user may have focused. The conclusion
holds on the replay's TIMING instead, which is the wording above.

### Consequence: the queue test's documented mutant dies

★★★ `rich-text-editor-lazy.queue.test.tsx` records two mutants it kills. One is
"dropping `{ focus: false }` routes the replay through `focus()` + `insertContent`,
which inserts at the SELECTION — i.e. it PREPENDS." **The split makes that mutant
unobservable by position**, because position now comes from `everFocused` and no
longer from `opts`. Left alone, the comment becomes false and the test quietly
weaker.

Dropping `{ focus: false }` is still a real defect — the replay would steal focus at
a moment the NETWORK chose. So the assertion moves from position to focus: after the
replay, the editor must NOT be `document.activeElement`.

That same test also gains the §192 agreement assertion, because it is the one place
both routes can be observed against one fixture: it already exercises the QUEUED
route, and a second `appendText` after the chunk has resolved exercises the LIVE
route in the same test. Still test #1, so the warm-module rule holds.

### The lazy wrapper does not change

`rich-text-editor-lazy.tsx`'s replay already passes `{focus: false}`, which under the
split still means "do not focus" and no longer also means "position differently".
The fix lands entirely in the module that owns the editor.

### Behaviour delta

Dictating into an existing note **without clicking into it** goes from prepending to
appending. Dictating with the caret placed mid-sentence is unchanged — still at the
caret. User-visible, so: version bump + `CHANGELOG.md`.

### Consumers

Two, both dictation, both no-opts: `note-log-panel.tsx:79` and `:197`. Nothing else
in the app calls `appendText`. Re-derive rather than trusting this line:

```bash
grep -rn "appendText(" src/app --include=*.ts --include=*.tsx | grep -v "\.test\."
```

### Tests

`src/app/rich-text-editor.test.tsx`, the two existing "appendText lands" tests:

1. never-focused + no opts — expected string flips from `<p> appendedexisting</p>`
   to `<p>existing appended</p>`
2. `{focus:false}` — unchanged
3. **new** — place the caret, then no-opts, assert it lands at the caret
4. **new** — same fixture and same call through BOTH routes (live, and queued
   replay) assert identical HTML. This is the assertion §192 actually asks for: it
   observes the agreement, not either branch alone.

**Mutants that must go red:**

| mutant | killed by |
|---|---|
| `useRef(true)` instead of `useRef(false)` | test 1 |
| delete the `onFocus` handler | test 3 |
| swap the ternary arms | tests 1 and 3 |

## 2. §194 — StrictMode coverage of the queue

New file `src/app/rich-text-editor-lazy.strictmode.test.tsx`. This is a **different
test**, not a re-add: the file 0.250.0 deleted asserted final HTML, and `attach`
returns early on an empty queue, so a second live attach produced byte-identical
output and the tripwire could not observe the condition it guarded.

### Shape

- mock `./rich-text-editor` with a component that calls `editorRef(handle)`, where
  `handle.appendText` is a `vi.fn()` recording `(text, opts)`
- StrictMode at the correct fiber. ★★★ **Read `src/app/strictmode.meta.test.tsx`
  before writing this** — do not restate the placement-flag rule from memory. A test
  composing StrictMode inside a wrapper passes with the line it claims to pin
  DELETED.
- assert the **ordered call log**: the queued text flushes exactly once, not twice

### Why it is not vacuous

Delete the `pending.current = []` swap in `attach` and the same queue flushes twice
under a double-attach, which the ordered log sees as a duplicated append. **That
mutant dies only under StrictMode** — a single attach never re-enters — which is
what proves the wrapper is load-bearing rather than decorative.

### Warm-module constraint

★★★ Only the FIRST test in a file gets an UNRESOLVED `dynamic()` import. The
queue-before-chunk scenario must be test #1. A second queue-dependent case needs its
own file — placed later in this one it passes with the queue deleted.

## 3. Passengers

### §193 — nine redundant `{ timeout: 15_000 }`

`vitest.setup.ts` sets `configure({ asyncUtilTimeout: 15000 })` globally. Nine
`findBy*` calls restate it. Re-derived at `efad123f`:

```bash
grep -rn "{ timeout: 15_000 }" src --include=*.tsx --include=*.ts | sed 's/:.*//' | sort | uniq -c
```

→ `document-block-editors.test.tsx` 3 · `document-editor.test.tsx` 2 ·
`note-log-panel.dictation.test.tsx` 1 · `note-log-panel.dictation-live.test.tsx` 1 ·
`note-log-panel.dictation-cancel.test.tsx` 1 · `rich-text-editor-lazy.queue.test.tsx` 1.

★★★ **ALL NINE IN ONE COMMIT OR NONE.** 0.250.0 removed exactly one and a cold
review caught the result: eight sites carrying the literal and one not reads as a
deliberate exception. It was reverted.

Do NOT re-introduce a count into `vitest.setup.ts`. Its comment once read "the four
lazy-editor suites"; the suites were not four, were not all lazy-editor suites, and
the set moves whenever a Tiptap-mounting test is added. It names no number today and
that is the state to keep.

### §175 — bound `buildChatPointerBlock`

One test feeding it an over-long title directly and asserting the block stays
bounded. It accepts an arbitrary `ChatPointer` and clips nothing; every value it can
receive is bounded today only because `summarizeChatThreads` is its single producer.
The cap belongs where it is — this makes the single-producer property **checkable**
instead of merely true.

### §176 — pin cap-then-flatten

One test at `threadTitle`, where the clip now lives. The path flipped from
flatten-then-cap to cap-then-flatten when the cap moved to its producer; the change
was deliberate and bounded either way, but nothing pins the order, so a future edit
can reverse it silently.

### §170 — the `ChangePanelMemo` docblock

The comment above `memo(ChangePanelBody)` says the memo "relies on handler props
being stable refs (the parent wraps them in `useCallback`)". It does not:
`task-manager.tsx` builds `guardEdit(handler)` unmemoized during render, so a fresh
identity arrives every parent render and the memo cannot bail. Correct the comment
to `ResourcesPanel`'s honest wording — the memo does not currently bail, do not cite
it as a reason anything is fast, and memoizing `guardEdit` is not the fix on its own
(one unstable family among several). Keep the memo.

## 4. Register + release

Close §170, §175, §176, §192, §193, §194 in `docs/open-followups.md`.

Version: bump `src/app/version.ts` (APP_VERSION + APP_BUILD_DATE + milestone), add a
`CHANGELOG.md` entry, and update the five ungated places in the SAME commit —
`package.json` `version`, `package-lock.json` (root + `packages[""]`), the README
shields badge (version AND codename), and the `<!-- Generated: … -->` header on all
five `docs/CODEMAPS/*.md`.

No new i18n strings. No markup change, so no new axe surface.

## 5. Gates

`npx tsc --noEmit` · `npx eslint --max-warnings=0 src/app` (bare `npm run lint` exits
0 on warnings and does not reproduce the CI gate) · targeted vitest per task ·
`npm run test:shuffle` (this slice adds a test file) · full `npm run test:run` at the
end · `size:check` · `dup:check` · `docs:symbols:check` · `docs:claims:check`.

`prod-smoke` is not implicated — no CSP, layout or dependency change.

★★★ Never read a gate's exit code through a pipe. Redirect, check unpiped, then read
the file.

## Risks

| Risk | Mitigation |
|---|---|
| The §194 test ships green and vacuous | Mutation-test it against the `pending.current = []` deletion, and confirm the same mutant SURVIVES without the StrictMode wrapper — that is the proof the wrapper matters |
| A later queue test in the same file is warm-module vacuous | Queue scenario is test #1; any second one gets its own file |
| §192's ordering guard is claimed as covered | It is not. Comment says reasoned-not-pinned |
| The behaviour delta surprises a user mid-sentence | It does not change that case — caret insert is unchanged when the editor has been focused |
