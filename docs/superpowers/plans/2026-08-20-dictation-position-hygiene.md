# Dictation insert position + register hygiene — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make where a dictated line lands deterministic — today it depends on whether Tiptap's chunk had arrived — and close five smaller register items that live in the same files.

**Architecture:** `RichTextEditorHandle.appendText` currently lets `opts.focus` decide BOTH the insert position and whether to focus. This splits them: position comes from a new `everFocused` ref (set by a Tiptap `onFocus` handler), focus keeps coming from `opts`. A queued line is dictated before the editor existed, so on replay the ref is false and both routes agree on `appendPos`. The lazy wrapper's source is untouched.

**Tech Stack:** React 19, Tiptap 3, vitest 4 + Testing Library, Next.js (forked).

**Spec:** `docs/superpowers/specs/2026-08-20-dictation-position-hygiene-design.md`

**Branch:** `feat/dictation-position-hygiene`, already created off `origin/main` (`efad123f`).

---

## File Structure

| File | Change | Task |
|---|---|---|
| `src/app/document-block-editors.test.tsx` | remove 3 `{ timeout: 15_000 }` | 1 |
| `src/app/document-editor.test.tsx` | remove 2 | 1 |
| `src/app/note-log-panel.dictation.test.tsx` | remove 1 | 1 |
| `src/app/note-log-panel.dictation-live.test.tsx` | remove 1 | 1 |
| `src/app/note-log-panel.dictation-cancel.test.tsx` | remove 1 | 1 |
| `src/app/rich-text-editor-lazy.queue.test.tsx` | remove 1 · repair mutant comment · add focus + agreement assertions | 1, 6 |
| `vitest.setup.ts` | comment now says the explicit copies are gone | 1 |
| `src/app/change-panel.tsx` | correct the `ChangePanelMemo` docblock | 2 |
| `src/app/chat-recap.test.ts` | new test bounding `buildChatPointerBlock` | 3 |
| `src/app/chat-search.test.ts` | new test pinning cap-then-flatten | 4 |
| `src/app/rich-text-editor.tsx` | `everFocused` ref · `onFocus` · the split | 5 |
| `src/app/rich-text-editor.test.tsx` | two tests updated, one added | 5 |
| `src/app/rich-text-editor-lazy.strictmode.test.tsx` | NEW — attach-sequence test | 7 |
| `docs/open-followups.md` | close §170, §175, §176, §192, §193, §194 | 8 |
| `src/app/version.ts`, `CHANGELOG.md`, `package.json`, `package-lock.json`, `README.md`, `docs/CODEMAPS/*.md` | 0.251.0 "Larson" | 9 |

**Two open questions the plan resolves, both recorded so the implementer does not re-litigate them:**

1. **§175's wording asks for something its own neighbour forbids.** The entry says "feeds `buildChatPointerBlock` an over-long title directly and asserts the block stays bounded", but the function does no clipping and `inlineTitle`'s docstring says in capitals **"Do not re-add a clip here."** A direct-feed test that asserted boundedness could only pass by adding the clip the docstring forbids. Task 3 therefore tests the COMPOSITION — producer through renderer — which is the property that actually holds. Note the discrepancy when closing §175.
2. **Codename.** `Larson` (Rich Larson), verified unused: `grep -c '"Larson"' CHANGELOG.md` → 0. Re-verify before writing it.

---

### Task 1: §193 — remove all nine redundant `{ timeout: 15_000 }`

**Files:**
- Modify: `src/app/document-block-editors.test.tsx`, `src/app/document-editor.test.tsx`, `src/app/note-log-panel.dictation.test.tsx`, `src/app/note-log-panel.dictation-live.test.tsx`, `src/app/note-log-panel.dictation-cancel.test.tsx`, `src/app/rich-text-editor-lazy.queue.test.tsx`
- Modify: `vitest.setup.ts`

★★★ **ALL NINE IN ONE COMMIT OR NONE.** 0.250.0 removed exactly one and a cold review caught the result: eight sites carrying the literal and one not reads as a deliberate exception. It was reverted.

- [ ] **Step 1: Re-derive the population at THIS tree**

Run:
```bash
grep -rn "{ timeout: 15_000 }" src --include=*.tsx --include=*.ts | sed 's/:.*//' | sort | uniq -c
```
Expected: 3 + 2 + 1 + 1 + 1 + 1 = 9 across the six files listed above. If the numbers differ, the tree moved — use what the command prints, not this plan.

- [ ] **Step 2: Delete every occurrence**

Each is the third argument to a `findBy*` call. `screen.findByRole("textbox", { name: "Note" }, { timeout: 15_000 })` becomes `screen.findByRole("textbox", { name: "Note" })`. Delete the trailing `, { timeout: 15_000 }` only — do not touch the option object before it.

Where a comment above the call explains the timeout (the queue suite has one), delete the comment too. In `rich-text-editor-lazy.queue.test.tsx` that is the whole block reading "15s because a cold Tiptap transform can outlast RTL's 5s default…".

- [ ] **Step 3: Update the `vitest.setup.ts` comment**

The block above `configure({ asyncUtilTimeout: 15000 })` currently reads:

```
// ★★ 15s matches what the Tiptap-mounting suites already pass explicitly at their
// own waits, so there is one number rather than two. NO COUNT OF THOSE SUITES IS
// GIVEN: a cold review found the number here had already rotted, and those explicit
// copies are now redundant with this line anyway (docs/open-followups.md §193).
```

Replace with:

```
// ★★ 15s is the ONLY place this number is written. The Tiptap-mounting suites used
// to restate it at each wait; all nine copies were removed together in 0.251.0
// because every one of them merely re-stated this line (docs/open-followups.md
// §193, closed). ★★★ DO NOT REINTRODUCE A COUNT HERE. The wording this replaced
// named one ("the four lazy-editor suites") and it had already rotted: the suites
// were not four and were not all lazy-editor suites. The set moves whenever a
// Tiptap-mounting test is added, so any number written here is wrong on a schedule.
```

- [ ] **Step 4: Verify none remain, and that the suites still pass**

Run:
```bash
grep -rn "timeout: 15_000" src ; echo "EXIT=$?"
```
Expected: no output, `EXIT=1` (grep found nothing).

Then:
```bash
npx vitest run src/app/document-block-editors.test.tsx src/app/document-editor.test.tsx src/app/note-log-panel.dictation.test.tsx src/app/note-log-panel.dictation-live.test.tsx src/app/note-log-panel.dictation-cancel.test.tsx src/app/rich-text-editor-lazy.queue.test.tsx --reporter=dot > /tmp/t1.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t1.log
```
Expected: EXIT=0, all files passing. ★ `--reporter=basic` does not exist in vitest 4 — use `dot`. ★ Never read the exit code through a pipe.

- [ ] **Step 5: Commit**

```bash
git add -A src vitest.setup.ts
git commit -F - <<'MSG'
test: one place says 15s, not ten

All nine explicit `{ timeout: 15_000 }` arguments merely restated
vitest.setup.ts's global asyncUtilTimeout. Removing one alone (0.250.0) left
a split that read as a deliberate exception and was reverted, so they go
together or not at all.

Closes docs/open-followups.md §193.
MSG
```

---

### Task 2: §170 — the `ChangePanelMemo` docblock claims an optimisation that has never run

**Files:**
- Modify: `src/app/change-panel.tsx` (the comment above `const ChangePanelMemo = memo(ChangePanelBody);`)

- [ ] **Step 1: Confirm the claim is still false**

Run:
```bash
grep -n "memo(ChangePanelBody)" -B 4 src/app/change-panel.tsx
grep -n "guardEdit" src/app/task-manager.tsx | head
```
Expected: the comment claims the parent wraps handlers in `useCallback`; `task-manager.tsx` builds `guardEdit(handler)` unmemoized during render. If `guardEdit` has since been memoized, STOP — the finding is stale and needs re-deciding, not re-wording.

- [ ] **Step 2: Replace the comment**

From:
```tsx
// memo-wrap so the panel skips re-render when the parent re-renders for
// unrelated reasons. Relies on handler props being stable refs (the parent
// wraps them in useCallback).
```
To:
```tsx
// memo-wrap so the panel COULD skip re-render when the parent re-renders for
// unrelated reasons.
//
// ★★★ IT DOES NOT CURRENTLY BAIL, and this comment used to claim it did ("the
// parent wraps them in useCallback" — it does not). `task-manager.tsx` builds
// `guardEdit(handler)` unmemoized during render, so a fresh identity arrives on
// every parent render and the memo compares unequal every time. Do NOT cite this
// memo as the reason anything is fast.
//
// ★ Memoizing `guardEdit` is not the fix on its own — it is one unstable family
// among several, the same finding AGENTS.md records for the `ResourcesPanel` memo,
// which is honestly labelled aspirational. Either stabilise every handler prop
// (measure first) or delete the memo. docs/open-followups.md §170.
```

- [ ] **Step 3: Verify nothing else changed**

Run:
```bash
git diff --stat src/app/change-panel.tsx
```
Expected: one file, comment lines only — no change to `memo(` itself.

- [ ] **Step 4: Commit**

```bash
git add src/app/change-panel.tsx
git commit -F - <<'MSG'
docs(change-panel): the memo does not bail, and the comment said it did

The docblock claimed the parent wraps handler props in useCallback.
task-manager.tsx builds guardEdit(handler) unmemoized during render, so the
memo compares unequal on every parent render. Labelled aspirational, matching
how AGENTS.md already describes the ResourcesPanel memo.

Closes docs/open-followups.md §170.
MSG
```

---

### Task 3: §175 — make `buildChatPointerBlock`'s boundedness checkable

**Files:**
- Modify: `src/app/chat-recap.test.ts`

Read the discrepancy note in **File Structure** above before writing this: the register entry asks for a direct feed, `inlineTitle`'s docstring forbids adding the clip that would make a direct feed pass, so this pins the COMPOSITION instead.

- [ ] **Step 1: Write the failing test**

Append to `src/app/chat-recap.test.ts` (adjust the existing import line rather than adding a second one):

```ts
describe("buildChatPointerBlock is bounded only because threadTitle bounds it", () => {
  // ★★★ THIS TESTS THE COMPOSITION ON PURPOSE. `buildChatPointerBlock` clips
  //   nothing and must not start: `inlineTitle`'s docstring says the cap lives at
  //   the PRODUCER (`threadTitle`), one point for all three emitters, "Do not
  //   re-add a clip here." So a test feeding this function an unbounded title
  //   directly could only pass by adding the clip that comment forbids.
  //   docs/open-followups.md §175 asks for the direct feed; its own neighbouring
  //   text rules it out. What is worth pinning is that the ONLY producer really
  //   does bound what reaches the sink — the property is true today by
  //   single-producer accident, and this is what makes it checkable.
  // ★★ The mutant: drop the `sanitizeMultiline(raw, THREAD_NAME_MAX)` clip from
  //   `threadTitle` and this goes red. Nothing else in the suite does.
  it("clips a 5000-character thread name before it can reach the system prompt", () => {
    const th: ChatThread = {
      id: "t1",
      projectId: "default",
      name: "x".repeat(5000),
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
      history: [],
      display: [],
    };
    const title = threadTitle(th);
    const block = buildChatPointerBlock(
      { count: 1, recent: [{ title, at: "2026-08-20" }] },
      new Set<string>(),
    );
    // THREAD_NAME_MAX units plus at most one appended ellipsis.
    expect(title.length).toBeLessThanOrEqual(THREAD_NAME_MAX + 1);
    expect(block).toContain(`"${"x".repeat(THREAD_NAME_MAX)}…"`);
    expect(block.length).toBeLessThan(200);
  });
});
```

`chat-recap.test.ts` has no thread fixture helper (`chat-search.test.ts`'s `thread()` is local to that file and is NOT worth exporting for one use), so the literal above is written out. Imports needed: `threadTitle` from `./chat-search`, `THREAD_NAME_MAX` and `type ChatThread` from `./chat-threads`, `buildChatPointerBlock` from `./chat-recap`.

★ The expected numbers: `clipText` slices to `max` and appends nothing; `threadTitle` adds the `…` itself when the clip removed anything. So a 5000-character name yields exactly 60 `x` plus one `…` — 61 units, which is why the assertion is `<= THREAD_NAME_MAX + 1` and not `<= THREAD_NAME_MAX`.

- [ ] **Step 2: Run it — it must PASS immediately**

Run:
```bash
npx vitest run src/app/chat-recap.test.ts --reporter=dot > /tmp/t3.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t3.log
```
Expected: EXIT=0. This is a characterization test of an existing property, so green-on-arrival is correct. **Its value is proved by the mutant, not by a red-first run** — do step 3 or this task is not done.

- [ ] **Step 3: Mutation-prove it**

In `src/app/chat-search.ts`, temporarily change `threadTitle`'s body from
`const clipped = sanitizeMultiline(raw, THREAD_NAME_MAX);` to `const clipped = raw;`.

Run the same command. Expected: **RED**, on the new test. Then revert the mutant:
```bash
git checkout-index -f -- src/app/chat-search.ts
git diff --stat src/app/chat-search.ts
```
Expected: no output from the second command — the mutant is gone. (`git checkout --` and `git restore` are deny-listed in this environment.)

- [ ] **Step 4: Commit**

```bash
git add src/app/chat-recap.test.ts
git commit -F - <<'MSG'
test(chat): pin that the single producer really does bound the pointer block

buildChatPointerBlock accepts an arbitrary ChatPointer and clips nothing. Every
value it can receive is bounded today only because summarizeChatThreads is its
sole producer and caps each title at THREAD_NAME_MAX. Nothing enforced that.

Tests the composition rather than feeding the renderer directly: inlineTitle's
docstring forbids a second clip at this sink, so a direct-feed test could only
pass by adding it.

Closes docs/open-followups.md §175.
MSG
```

---

### Task 4: §176 — pin cap-then-flatten at `threadTitle`

**Files:**
- Modify: `src/app/chat-search.test.ts`

- [ ] **Step 1: Write the test**

```ts
// ★★★ PINS AN ORDER, NOT A LENGTH. When the cap moved to its producer the path
//   flipped from flatten-then-cap to cap-then-flatten: `threadTitle` clips first
//   and `inlineTitle` (chat-recap.ts) collapses whatever survives. A title with a
//   long INTERIOR whitespace run therefore yields FEWER visible characters than it
//   used to, because the run is spent against the cap before it is collapsed.
//   Deliberate and bounded either way, but nothing pinned it, so a future edit
//   could reverse it in silence. docs/open-followups.md §176.
// ★★ The fixture is built so the two orders produce DIFFERENT strings — that is
//   the whole point. Flatten-then-cap would keep ~29 trailing "b"s; cap-then-
//   flatten keeps 10. A fixture without a long interior run cannot tell them apart.
it("clips before flattening, so an interior whitespace run is spent against the cap", () => {
  const name = `${"a".repeat(30)}${" ".repeat(20)}${"b".repeat(30)}`;
  const title = threadTitle(thread({ id: "t1", name }));
  // 60 units of clip: 30 "a" + 20 spaces + 10 "b", then the appended ellipsis.
  expect(title).toBe(`${"a".repeat(30)}${" ".repeat(20)}${"b".repeat(10)}…`);
});
```

`thread()` is the fixture helper this file already defines at its top — it defaults `name` to `""` and takes an override, so `thread({ id: "t1", name })` is all that is needed. `threadTitle` and `THREAD_NAME_MAX` are already imported there.

- [ ] **Step 2: Run it**

Run:
```bash
npx vitest run src/app/chat-search.test.ts --reporter=dot > /tmp/t4.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t4.log
```
Expected: EXIT=0. If the string is off, print the actual value and use it — the point is to pin what the code does, not what this plan predicted. Do NOT change `threadTitle` to match the plan.

- [ ] **Step 3: Mutation-prove it**

Temporarily reverse the order inside `threadTitle`: apply `.replace(/\s+/g, " ")` to `raw` BEFORE `sanitizeMultiline`. Re-run. Expected: **RED**. Revert with `git checkout-index -f -- src/app/chat-search.ts` and confirm `git diff --stat src/app/chat-search.ts` is empty.

- [ ] **Step 4: Commit**

```bash
git add src/app/chat-search.test.ts
git commit -F - <<'MSG'
test(chat): pin cap-then-flatten, which nothing held

Moving the title cap to its producer flipped the path from flatten-then-cap to
cap-then-flatten. Bounded either way and deliberately shipped, but no test
pinned either ordering, so a future edit could reverse it silently.

Closes docs/open-followups.md §176.
MSG
```

---

### Task 5: §192 — split position from focus

**Files:**
- Modify: `src/app/rich-text-editor.tsx`
- Test: `src/app/rich-text-editor.test.tsx`

- [ ] **Step 1: Write the failing tests FIRST**

In `src/app/rich-text-editor.test.tsx`, change the first "appendText lands" test's expectation and its name, and add a third. The second test (`{ focus: false }`) is unchanged.

Rename test 1 to `"appendText lands at the END of the document when nobody has focused the editor"` and change its last line from

```ts
    expect(onChange.mock.calls.at(-1)![0]).toBe("<p> appendedexisting</p>");
```
to
```ts
    // ★★★ THIS STRING IS THE §192 FIX. It used to be "<p> appendedexisting</p>":
    //   the default branch inserted at the SELECTION, which on an editor nobody
    //   has clicked into is the START of the document, so dictating into an
    //   existing note without clicking it first PREPENDED the transcript. Worse,
    //   the queued route appended, so which one a user got was decided by whether
    //   Tiptap's chunk had landed. Position now comes from `everFocused`, so both
    //   routes agree here. docs/open-followups.md §192.
    expect(onChange.mock.calls.at(-1)![0]).toBe("<p>existing appended</p>");
```

Add after test 2:

```ts
  it("appendText lands at the caret once the editor has been focused", async () => {
    const onChange = vi.fn();
    function Harness() {
      const ref = useRef<RichTextEditorHandle>(null);
      return (
        <>
          <RichTextEditor value="<p>existing</p>" onChange={onChange} label="Note" lang="en-US" editorRef={ref} />
          <button type="button" onClick={() => ref.current?.appendText(" appended")}>go</button>
        </>
      );
    }
    render(<Harness />);
    const box = await screen.findByRole("textbox", { name: "Note" });
    // ★★ FOCUS IS THE WHOLE FIXTURE. A ProseMirror EditorState initialises its
    //   selection at the document start, so focusing without moving the caret
    //   leaves it there — and inserting at the caret then PREPENDS. That is
    //   correct and deliberate: a user who has been in this editor gets the text
    //   where their caret is. The contrast with the test above (same call, no
    //   focus, appends) is what pins the branch.
    fireEvent.focus(box);
    await userEvent.click(screen.getByRole("button", { name: "go" }));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(onChange.mock.calls.at(-1)![0]).toBe("<p> appendedexisting</p>");
  });
```

Add `fireEvent` to the `@testing-library/react` import if it is not already there.

★ **If `fireEvent.focus` does not trip Tiptap's `onFocus`** (it routes through ProseMirror's `handleDOMEvents`, and jsdom's focus behaviour on `contenteditable` is not guaranteed), use `await userEvent.click(box)` instead and re-check the expected string — a click may also move the caret. Whichever fires, keep the assertion pinned to what the code actually produces and say in the comment which mechanism was used. Step 2 is where this is decided.

- [ ] **Step 2: Run the tests — they must FAIL**

Run:
```bash
npx vitest run src/app/rich-text-editor.test.tsx --reporter=dot > /tmp/t5.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests |AssertionError" /tmp/t5.log
```
Expected: **EXIT=1**. Test 1 fails (still prepends), test 3 fails (no `everFocused` yet, so the default branch prepends — which happens to be what test 3 wants, so test 3 may PASS here for the wrong reason). That is expected and is exactly why test 1 carries the weight; note it and continue.

- [ ] **Step 3: Add the ref and the focus handler**

In `src/app/rich-text-editor.tsx`, beside the other refs (near `commitOnEnterRef` / `onChangeRef`):

```tsx
  // ★★★ POSITION, NOT FOCUS. `appendText` used to let `opts.focus` decide BOTH
  //   where the text goes and whether to focus, which made the insert position a
  //   function of whether Tiptap's chunk had loaded — see the handle below and
  //   docs/open-followups.md §192. This ref carries the only question that should
  //   decide position: has the user ever been in this editor?
  // ★★ It lives HERE, in the editor that remounts per editing session, not in the
  //   lazy wrapper. A fresh mount has never been focused, which is exactly the
  //   state a queued replay arrives in — so both routes agree on "end of document"
  //   without the wrapper having to know anything about it.
  const everFocused = useRef(false);
```

In the `useEditor({...})` config, beside `onUpdate`:

```tsx
    // Sets the ref above. Fires for a user click AND for our own chained
    // `.focus()`, which is correct: after we focus, the caret is meaningful, so
    // the NEXT append should go there.
    onFocus: () => {
      everFocused.current = true;
    },
```

- [ ] **Step 4: Split position from focus in the handle**

Replace the body of `appendText` after the `if (!editor) return false;` guard. The existing comment block from `★★★ THE TWO BRANCHES INSERT IN DIFFERENT PLACES` down to the `.run();` goes; the replacement is:

```tsx
        // ★★★ POSITION AND FOCUS ARE SEPARATE QUESTIONS, and conflating them was
        // §192. `opts.focus` used to select both, so a dictated line landed at the
        // END when the queue replayed it (`{focus:false}`) and at the START when the
        // live path ran (no `opts`, selection at doc start on an unfocused editor) —
        // and which route ran was decided by whether Tiptap's chunk had arrived when
        // the user pressed the mic. Same note, same call, two results, nothing on
        // screen to say which.
        //   · position <- `everFocused`: the caret if the user has ever been in this
        //     editor, otherwise the end of the last textblock.
        //   · focus    <- `opts.focus`: unchanged meaning.
        // A queued line is BY DEFINITION dictated before the editor existed, so on
        // replay `everFocused` is false and both routes now agree.
        // ★★ READ THE REF BEFORE BUILDING THE CHAIN. Our own `.focus()` fires
        // `onFocus`, so a read taken later would let this call's focus decide this
        // call's position. ★ REASONED, NOT PINNED: chain commands do not run until
        // `.run()`, so a read placed after `chain.focus()` still observes the
        // pre-call value, and no mutant this suite can express distinguishes the
        // two orderings. Do not read the tests below as covering it.
        const atCaret = everFocused.current;
        let chain = editor.chain();
        if (opts?.focus !== false) chain = chain.focus();
        // ★★ RETURN the chain's verdict rather than an unconditional true.
        // `insertContentAt` returns false on a content error (it catches, emits
        // `contentError`, and the chain no-ops), and the wrapper's queue treats
        // this return as "the text landed" — so reporting true drops it. That is
        // the exact silent-loss class the queue exists to close.
        return (
          atCaret
            ? chain.insertContent({ type: "text", text })
            : chain.insertContentAt(appendPos(editor.state.doc), { type: "text", text })
        ).run();
```

- [ ] **Step 5: Run the tests — they must PASS**

Run the same command as step 2. Expected: **EXIT=0**, all three tests green.

- [ ] **Step 6: Mutation-prove all three mutants**

Apply each mutant, run the file, confirm RED, then revert with `git checkout-index -f -- src/app/rich-text-editor.tsx` and confirm `git diff --stat src/app/rich-text-editor.tsx` prints nothing.

| # | Mutant | Must kill |
|---|---|---|
| 1 | `useRef(true)` instead of `useRef(false)` | test 1 |
| 2 | delete the whole `onFocus` handler | test 3 |
| 3 | swap the ternary arms | tests 1 and 3 |

★★ Apply them **one at a time**, and confirm each mutant actually LANDED (`git diff --stat` shows the file changed) before trusting a red run — a mutant that failed to apply produces a green run that reads as a surviving mutant.

- [ ] **Step 7: Typecheck and lint**

```bash
npx tsc --noEmit; echo "EXIT=$?"
npx eslint --max-warnings=0 src/app; echo "EXIT=$?"
```
Both must print `EXIT=0`. ★ `let chain = editor.chain()` then reassigning from `chain.focus()` typechecks — both are `ChainedCommands`. If eslint objects to `let`, use a ternary for the chain rather than reverting the split.

- [ ] **Step 8: Commit**

```bash
git add src/app/rich-text-editor.tsx src/app/rich-text-editor.test.tsx
git commit -F - <<'MSG'
fix(rich-text): where a dictated line lands no longer depends on the network

appendText let opts.focus decide both the insert position and whether to focus.
Through the lazy editor that made position a function of whether Tiptap's chunk
had arrived: a queued transcript appended, a live one prepended, same note, same
call, nothing on screen to say which.

Position now comes from a first-focus ref: the caret if the user has ever been
in this editor, the end of the document if not. Focus still comes from opts. A
queued line is by definition dictated before the editor existed, so both routes
agree.

Behaviour change: dictating into an existing note without clicking into it now
appends instead of prepending. Dictating with the caret placed is unchanged.

Closes docs/open-followups.md §192.
MSG
```

---

### Task 6: repair the queue test, whose documented mutant Task 5 just killed

**Files:**
- Modify: `src/app/rich-text-editor-lazy.queue.test.tsx`

★★★ `rich-text-editor-lazy.queue.test.tsx` documents two mutants it kills. The second — *"dropping `{ focus: false }` … inserts at the SELECTION … i.e. it PREPENDS"* — is no longer observable by position after Task 5, because position no longer comes from `opts`. The comment is now FALSE and the assertion it justifies no longer earns its place. Dropping `{ focus: false }` is still a real defect (the replay would steal focus at a moment the network chose), so the assertion moves from position to focus.

- [ ] **Step 1: Confirm the mutant really is dead**

In `src/app/rich-text-editor-lazy.tsx`, temporarily change the `flushPending` call site from `handle.appendText(queued[i], { focus: false })` to `handle.appendText(queued[i])`. Run:

```bash
npx vitest run src/app/rich-text-editor-lazy.queue.test.tsx --reporter=dot > /tmp/t6.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t6.log
```
Expected: **EXIT=0 — the mutant SURVIVES.** That is the finding this task exists for. If it goes red, stop and re-read: the position assertion is still doing work and this task's premise is wrong.

Leave the mutant in place for step 3.

- [ ] **Step 2: Replace the stale comment and add the focus assertion**

Delete the second bullet of the `★★★ ASSERT THE BLOCK STRUCTURE` comment (the one beginning "dropping `{ focus: false }` routes the replay through `focus()`") and replace the block's tail with:

```tsx
    // ★★★ THE SECOND MUTANT THIS BLOCK USED TO NAME IS DEAD, and it was killed
    //   deliberately. It read: "dropping `{ focus: false }` routes the replay
    //   through focus() + insertContent, which inserts at the SELECTION — i.e. it
    //   PREPENDS." §192 split position from focus, so `opts` no longer decides
    //   position and that mutant now changes NOTHING about the HTML. Measured, not
    //   assumed: with the argument dropped this file stayed GREEN.
    // ★★ Dropping it is still a real defect — the replay would FOCUS the editor at
    //   a moment the NETWORK chose, stealing the caret from wherever the user
    //   actually is. So the assertion moved from position to focus. This is the
    //   only thing in the suite that kills that mutant now.
    expect(document.activeElement).not.toBe(editor);
```

Keep the first bullet (the `doc.content.size` / `appendPos` mutant) — it is untouched by §192.

- [ ] **Step 3: Confirm the NEW assertion kills the mutant**

With the mutant from step 1 still applied, re-run the command from step 1. Expected: **EXIT=1**, failing on the `activeElement` assertion. Then revert:

```bash
git checkout-index -f -- src/app/rich-text-editor-lazy.tsx
git diff --stat src/app/rich-text-editor-lazy.tsx
```
Expected: the second command prints nothing.

- [ ] **Step 4: Add the §192 agreement assertion**

This test is the only place both routes can be observed against one fixture, and it is test #1 in its file so the warm-module rule still holds. After the existing assertions, append:

```tsx
    // ★★★ THE TWO ROUTES AGREE — this is what §192 is actually about. Above, the
    //   text went through the QUEUE (appended before the chunk resolved, replayed
    //   on arrival). Here the same call runs LIVE against the same never-focused
    //   editor. Before the fix these produced different documents and which one a
    //   user got was decided by network timing; now they cannot diverge.
    // ★★ Do not split this into a second `it` in this file: only the FIRST test in
    //   a file gets an unresolved `dynamic()` import, so a second one would resolve
    //   the chunk up front and never exercise the queued half at all.
    act(() => {
      ref.current?.appendText(" live");
    });
    await waitFor(() => expect(html.at(-1)).toBe("<p>existingqueued while loading live</p>"));
```

★ If the exact string differs (spacing around the concatenation), print the actual value and pin THAT. The property being asserted is that the live append lands at the END, same as the queued one — not a particular spacing.

- [ ] **Step 5: Run the file**

```bash
npx vitest run src/app/rich-text-editor-lazy.queue.test.tsx --reporter=dot > /tmp/t6b.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t6b.log
```
Expected: EXIT=0.

- [ ] **Step 6: Commit**

```bash
git add src/app/rich-text-editor-lazy.queue.test.tsx
git commit -F - <<'MSG'
test(rich-text): the queue suite's second mutant died with the fix, so replace it

Splitting position from focus made "drop { focus: false }" unobservable by
position — measured: with the argument dropped this file stayed green. Dropping
it is still a defect (the replay would steal focus at a network-chosen moment),
so the assertion moved to document.activeElement, which does kill it.

Also adds the agreement assertion §192 asks for: the queued and live routes now
produce the same document from the same fixture. This file is the only place
both can be observed, because only its first test gets an unresolved dynamic
import.
MSG
```

---

### Task 7: §194 — StrictMode coverage of the attach sequence

**Files:**
- Create: `src/app/rich-text-editor-lazy.strictmode.test.tsx`

★★★ **Read `src/app/strictmode.meta.test.tsx` before writing a line of this.** Do not restate the placement-flag rule from memory. The short version — StrictMode double-invokes only at the topmost fiber flagged for PLACEMENT, so `wrapper: StrictMode` and RTL's `reactStrictMode: true` work while composing `<StrictMode>` inside a wrapper function does NOT — is a COROLLARY of the mount case, and three earlier wordings of it shipped over-general. The meta test states it in full.

A file of the same name was DELETED in 0.250.0 because its only assertion was final HTML and `attach` returns early on an empty queue, so a second live attach produced byte-identical output. This is a different test, not a re-add.

- [ ] **Step 1: Write the test**

```tsx
import { act, render, screen } from "@testing-library/react";
import { createRef, StrictMode } from "react";
import { describe, it, expect, vi } from "vitest";

// Mock the heavy editor so the handle is ours and every appendText is recorded.
// The real editor cannot serve here: its result is the DOCUMENT, and the document
// is what the deleted version of this file asserted — identically in both the
// passing and the failing case.
const appendCalls: Array<{ text: string; opts: unknown }> = [];
vi.mock("./rich-text-editor", () => ({
  RichTextEditor: ({ editorRef, label }: { editorRef?: (h: unknown) => void; label: string }) => {
    // Mirrors what `useImperativeHandle` does for the real editor: hand the
    // parent a handle on mount and null it on cleanup.
    return (
      <div
        role="textbox"
        aria-label={label}
        ref={() => {
          editorRef?.({
            appendText: (text: string, opts?: unknown) => {
              appendCalls.push({ text, opts });
              return true;
            },
          });
          return () => editorRef?.(null);
        }}
      />
    );
  },
}));

const { RichTextEditor } = await import("./rich-text-editor-lazy");
type Handle = { appendText: (t: string, o?: { focus?: boolean }) => boolean };

describe("the lazy editor's append queue under StrictMode", () => {
  // ★★★ TEST #1 IN THIS FILE, AND IT MUST STAY THAT WAY. Only the first test in a
  //   file gets an UNRESOLVED `dynamic()` import; any earlier test that awaits the
  //   editor resolves the chunk for the whole module, and this test then never
  //   queues anything. A second queue-dependent case needs its own file.
  // ★★★ StrictMode is supplied as `wrapper`, NOT composed inside one. See
  //   `strictmode.meta.test.tsx`: the double-invoke fires at the topmost fiber
  //   flagged for placement, so a StrictMode nested inside a wrapper component is
  //   single-invoked on mount and the guard is vacuous-but-green.
  it("flushes a queued append exactly once across the double-attach", async () => {
    appendCalls.length = 0;
    const ref = createRef<Handle>();
    render(
      <RichTextEditor value="<p>existing</p>" onChange={() => {}} label="Description" lang="en-US" editorRef={ref} />,
      { wrapper: StrictMode },
    );

    act(() => {
      ref.current?.appendText("queued while loading");
    });

    await screen.findByRole("textbox", { name: "Description" });

    // ★★★ THE ORDERED CALL LOG IS THE POINT. The deleted version of this file
    //   asserted final HTML, which `attach`'s early return on an empty queue makes
    //   identical whether the queue is flushed once or twice — so it could not
    //   observe the condition it existed to guard.
    // ★★ The mutant: delete `pending.current = []` from `attach` in
    //   `rich-text-editor-lazy.tsx`. The same queue then flushes on the second
    //   attach too and this array holds the text TWICE. That mutant dies ONLY under
    //   StrictMode — a single attach never re-enters — which is what makes the
    //   wrapper above load-bearing rather than decorative. Verify BOTH halves:
    //   the mutant must go red here and SURVIVE with the wrapper removed.
    expect(appendCalls.map((c) => c.text)).toEqual(["queued while loading"]);
    expect(appendCalls[0].opts).toEqual({ focus: false });
  });
});
```

★ The mock's `ref` callback shape above is one way to reach "hand the parent a handle, then null it on cleanup". If React's cleanup-returning ref callback is awkward here, use a `useEffect` inside a small mock component instead — what matters is that the handle is attached on mount and detached on cleanup, so StrictMode produces attach → detach → attach.

- [ ] **Step 2: Run it — it must PASS**

```bash
npx vitest run src/app/rich-text-editor-lazy.strictmode.test.tsx --reporter=dot > /tmp/t7.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t7.log
```
Expected: EXIT=0, 1 test.

- [ ] **Step 3: Prove the mutant dies HERE**

In `src/app/rich-text-editor-lazy.tsx`, delete the line `pending.current = [];` inside `attach`. Re-run. Expected: **EXIT=1**, with `appendCalls` holding the text twice.

- [ ] **Step 4: Prove the mutant SURVIVES without StrictMode — this is the half that matters**

Keep the mutant applied. Remove `, { wrapper: StrictMode }` from the `render` call. Re-run. Expected: **EXIT=0 — the mutant survives.**

That is the evidence that StrictMode is load-bearing here rather than decoration. Without it, this test is the deleted one wearing a different assertion.

Restore both:
```bash
git checkout-index -f -- src/app/rich-text-editor-lazy.tsx
git diff --stat src/app/rich-text-editor-lazy.tsx
```
and put `{ wrapper: StrictMode }` back. Re-run and confirm EXIT=0.

- [ ] **Step 5: Record the measurement in the file**

Append to the `★★` mutant comment the result actually observed in steps 3 and 4, in the form "measured <date>: red under StrictMode, green without it". A mutation claim with no measurement behind it is exactly what §194 was opened about.

- [ ] **Step 6: Typecheck**

```bash
npx tsc --noEmit; echo "EXIT=$?"
```
Must be `EXIT=0`. ★ vitest never typechecks and `next build` skips `*.test.tsx`, so a test-only type error passes both and fails CI.

- [ ] **Step 7: Commit**

```bash
git add src/app/rich-text-editor-lazy.strictmode.test.tsx
git commit -F - <<'MSG'
test(rich-text): StrictMode coverage of the queue, asserting the attach sequence

The file deleted in 0.250.0 asserted final HTML, and attach returns early on an
empty queue, so a second live attach produced byte-identical output — the
tripwire could not observe the condition it guarded.

This asserts the ordered appendText call log instead. Deleting the
`pending.current = []` swap makes the queue flush twice across StrictMode's
double-attach; measured red here and green with the StrictMode wrapper removed,
which is what makes the wrapper load-bearing.

Closes docs/open-followups.md §194.
MSG
```

---

### Task 8: close the six register entries

**Files:**
- Modify: `docs/open-followups.md`

- [ ] **Step 1: Mark each entry closed**

For §170, §175, §176, §192, §193, §194: change the heading's trailing state to `— CLOSED 2026-08-20` (matching the file's existing convention — read two nearby closed entries first and copy their exact shape, including whether they keep a `**Status:**` line).

Each closure note states what was done and, where it applies, what was NOT:

- **§170** — comment corrected; the memo is kept and now labelled aspirational. The optimisation still does not bail.
- **§175** — pinned as a COMPOSITION test. ★★ Record that the entry's own wording ("feeds `buildChatPointerBlock` an over-long title directly") could only be satisfied by adding the clip `inlineTitle`'s docstring forbids, so the property was pinned one level up instead.
- **§176** — pinned at `threadTitle` with a fixture whose two orderings differ.
- **§192** — option 3 taken. Note the behaviour delta.
- **§193** — all nine removed together; no count reintroduced in `vitest.setup.ts`.
- **§194** — replaced by an attach-sequence test, with the two-sided mutation result recorded.

- [ ] **Step 2: Add a note to §192's closure about the queue test**

The queue suite lost one of its two documented mutants to this fix. Record that the replacement is a focus assertion, and that the position mutant was measured surviving before the swap — so a future reader does not re-add the position assertion thinking it still guards something.

- [ ] **Step 3: Verify the doc gates**

```bash
npm run docs:symbols:check > /tmp/sym.log 2>&1; echo "EXIT=$?"; tail -3 /tmp/sym.log
npm run docs:claims:check > /tmp/claims.log 2>&1; echo "EXIT=$?"; tail -6 /tmp/claims.log
```
Both must be `EXIT=0`. ★ `docs:claims:check` is a RATCHET — it fails on a NEW `path:LINE` citation. Cite SYMBOLS in the closure notes, not line numbers. If it fails, remove the citation; do NOT re-baseline.

- [ ] **Step 4: Commit**

```bash
git add docs/open-followups.md
git commit -F - <<'MSG'
docs(followups): close §170, §175, §176, §192, §193, §194
MSG
```

---

### Task 9: release 0.251.0 "Larson"

**Files:**
- Modify: `src/app/version.ts`, `CHANGELOG.md`, `package.json`, `package-lock.json`, `README.md`, `docs/CODEMAPS/*.md` (five files)

★★ Five of these carry the version and **no gate checks any of them**. They have drifted for eleven releases before. Bump them in the SAME commit or the drift restarts.

- [ ] **Step 1: Re-verify the codename is unused**

```bash
grep -c '"Larson"' CHANGELOG.md
```
Expected: `0`. If not, pick another sci-fi/fantasy author surname and re-check.

- [ ] **Step 2: `src/app/version.ts`**

Set `APP_VERSION = "0.251.0"`, `APP_BUILD_DATE = "2026-08-20"` with its trailing comment updated to describe this release, and the milestone codename to `Larson`. Read the file's existing comments first — it carries a warning about `APP_VERSION` and `APP_MILESTONE` drifting apart.

- [ ] **Step 3: `CHANGELOG.md`**

Add a `## 0.251.0 "Larson"` entry at the top, matching the file's existing format. Lead with the behaviour change, since it is the only user-visible item:

- where a dictated line lands no longer depends on whether the editor had finished loading; dictating into an existing note without clicking into it now appends rather than prepending
- StrictMode coverage of the lazy editor's append queue
- test and comment hygiene: §170, §175, §176, §193

★★★ **NO `[session link removed]...` URL in `CHANGELOG.md`.**

- [ ] **Step 4: The four unchecked places**

- `package.json` `version` → `0.251.0`
- `package-lock.json` → BOTH occurrences (the root `version` and the `packages[""]` one)
- `README.md` shields badge → version AND codename
- all five `docs/CODEMAPS/*.md` → the `<!-- Generated: … | App <version> "<codename>" … -->` header

Verify:
```bash
grep -rn "0\.250\.0" package.json package-lock.json README.md docs/CODEMAPS/ src/app/version.ts; echo "EXIT=$?"
```
Expected: no output, `EXIT=1`.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -F - <<'MSG'
chore(release): 0.251.0 "Larson"
MSG
```

---

### Final gates (after Task 9)

- [ ] **Full unit suite**

```bash
npm run test:run > /tmp/suite.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/suite.log
```
★★★ Never through a pipe. ★ If it runs past ~10 minutes, shard it in the foreground rather than backgrounding — a backgrounded run gets killed and the notification reports the trailing command's exit code.

- [ ] **Shuffled suite** — this slice adds a test file, so this gate is the one that catches order dependence:

```bash
npm run test:shuffle > /tmp/shuffle.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/shuffle.log
```

★★ Never run two vitest processes at once — machine saturation is the load-sensitive-flake condition.

- [ ] **The rest**

```bash
npx tsc --noEmit; echo "EXIT=$?"
npx eslint --max-warnings=0 src/app; echo "EXIT=$?"
npm run size:check > /tmp/size.log 2>&1; echo "EXIT=$?"; tail -3 /tmp/size.log
npm run dup:check > /tmp/dup.log 2>&1; echo "EXIT=$?"; tail -5 /tmp/dup.log
```

All must print `EXIT=0`. `prod-smoke` is not implicated — no CSP, layout or dependency change.

- [ ] **Cold review before release**

Dispatch a fresh reviewer over the whole branch (`git diff efad123f...HEAD`), given ZERO premises from this plan. The last three slices each found their worst material inside the PREVIOUS round's fixes, so scope any second round to the FIX round itself and spawn a NEW agent — reusing the first reviewer is not cold.

- [ ] **Sweep for live mutants**

Tasks 3, 4, 5, 6 and 7 all apply temporary mutants. Before reporting done:

```bash
git status --porcelain -uall
git diff --stat
```
Both must be empty. A report is a claim about the WORK, not about the tree — check the tree.

- [ ] **STOP.** No push, no MR, no merge without an explicit instruction. "Release" means push → MR → poll pipeline → merge on green, and each step needs its own go-ahead.
