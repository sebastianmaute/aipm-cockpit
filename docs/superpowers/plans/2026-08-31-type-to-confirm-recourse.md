# Type-to-confirm and destructive-refusal recourse — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every destructive confirmation completable in German, tell screen-reader users whether storage is ready, and stop the forensic log recording one data-loss event twice.

**Architecture:** Six independent units over five source files plus the two i18n dictionaries. All i18n keys are added FIRST, in one commit, so the later UI tasks only consume keys and never contend on `i18n.de.ts`. No new modules, no new dependencies, no e2e.

**Tech Stack:** Next.js 16 / React / TypeScript, vitest + @testing-library/react, EN+DE i18n with tsc-enforced key parity.

**Spec:** `docs/superpowers/specs/2026-08-31-type-to-confirm-recourse-design.md`
**Branch:** `fix/type-to-confirm-recourse`, currently at `5e88a626`, off `62d84fa3`.

---

## Two spec corrections, established while writing this plan

Read these before Task 4 and Task 5 — the spec is wrong on both points and this plan is right.

1. **§302 needs NO threading.** The spec says to thread `ready` through to the footer.
   `SidebarFooterProps` already declares `storageReady: boolean` and the component already uses
   it for the dot. Only the spoken text is missing.
2. **`isNewMagnitude` does NOT belong on `SaveGuardVerdict`.** `save-guard.ts` is explicitly PURE
   and knows nothing about a standing refusal. It goes on the return type of the HOOK's
   `evaluate`, as a wider type. `save-guard.ts` is not edited at all.

A third fact that changes Task 4's wording: `storageReady` is COMPOUND. `task-manager.tsx`
computes it as `storageOk && !loadWasIncomplete && destructiveRefusal === null`, so a false value
can mean a not-ready backend, a truncated load, OR a withheld deletion. The spoken string must not
claim more than "storage is not ready".

---

## File structure

| File | Change | Unit |
|---|---|---|
| `src/app/i18n.ts` | 1 key reworded, 6 keys added | all |
| `src/app/i18n.de.ts` | same, mirrored | all |
| `src/app/type-to-confirm-dialog.tsx` | trim, blur-gated mismatch, `invalid` wiring | §300 |
| `src/app/type-to-confirm-dialog.test.tsx` | 4 tests added | §300 |
| `src/app/settings-sections/general-section.tsx` | constant → i18n key | §301 |
| `src/app/settings-sections/general-section.test.tsx` | typed phrase updated | §301 |
| `src/app/tasks-section.tsx` | constant → key; bulk-delete literal → fixed key | §301 |
| `src/app/tasks-section.test.tsx` | typed phrase updated | §301 |
| `src/app/sidebar-footer.tsx` | sr-only readiness sentence | §302 |
| `src/app/sidebar-footer.test.tsx` | 2 tests added | §302 |
| `src/app/use-destructive-save-guard.ts` | `evaluate` returns `isNewMagnitude` | §303 |
| `src/app/use-storage-backend.ts` | gate the forensic write | §303 |
| `src/app/use-storage-backend.test.tsx` | 2 tests added | §303 |
| `src/app/use-bulk-operations.ts` | 2 stale comments | sweep |
| `docs/open-followups.md` | 5 closures, 1 rewrite, 1 new entry | register |

**NOT edited:** `src/app/save-guard.ts` (stays pure), `e2e/**` (no spec types these phrases —
verified: `grep -rn "yes, reset everything\|yes, clear all tasks" e2e` returns nothing).

---

## Environment facts you need

- **Every `src/app/*.ts(x)` file is CRLF in the working tree** (`git ls-files --eol` → `i/lf w/crlf`).
  A node script anchoring on `\n` alone silently matches nothing. Match `\r\n`.
- **`src/app/i18n.de.ts` must NEVER be touched with the Edit tool** — it corrupts umlauts and curls
  quotes. Patch it with the node scripts given below.
- **The `i18n-encoding` test bans ASCII substitutions (`fuer`, `druecken`) and `\u00XX` escapes.**
  Write real `ä ö ü` and real `„ “` characters.
- **EN/DE key parity is enforced by `npx tsc --noEmit`**, not by a test. A key in one file only
  fails the BUILD.
- **`npx tsc --noEmit` exits 2 on diagnostics, not 1.**
- **Never read a gate's exit code through a pipe.** Redirect, echo `$?` unpiped, then grep the file.

Set this once per shell:

```bash
SCRATCH="C:/Users/SEBAST~1.MAU/AppData/Local/Temp/claude/C--Projects-aipm-cockpit/628bd54e-9e78-4bdb-86f3-b2e46f1a8c77/scratchpad"
mkdir -p "$SCRATCH"
```

---

### Task 1: Add every i18n key, both languages, one commit

**Files:**
- Modify: `src/app/i18n.ts` (anchor: line with `typeToConfirmPrompt`)
- Modify: `src/app/i18n.de.ts` (anchor: line with `typeToConfirmPrompt`)

Six new keys plus one reworded. Doing this first means Tasks 2-5 only READ keys.

| Key | EN | DE |
|---|---|---|
| `typeToConfirmPrompt` (reworded) | `Type “{0}” to confirm` | `Geben Sie „{0}“ zur Bestätigung ein` |
| `typeToConfirmMismatch` | `That does not match the phrase above.` | `Das stimmt nicht mit der Angabe oben überein.` |
| `settingsResetConfirmValue` | `yes, reset everything` | `ja, alles zurücksetzen` |
| `tasksClearAllConfirmValue` | `yes, clear all tasks` | `ja, alle Aufgaben löschen` |
| `tasksDeleteSelectedConfirmValue` | `yes, delete the selected tasks` | `ja, ausgewählte Aufgaben löschen` |
| `sidebarStorageReady` | `Storage ready` | `Speicher bereit` |
| `sidebarStorageNotReady` | `Storage not ready` | `Speicher nicht bereit` |

- [ ] **Step 1: Write the EN patch script**

Create `$SCRATCH/i18n-en.mjs`:

```js
import { readFileSync, writeFileSync } from "node:fs";
const F = "src/app/i18n.ts";
const s = readFileSync(F, "utf8");
const OLD = '  typeToConfirmPrompt: "Type {0} to confirm",\r\n';
const NEW =
  '  typeToConfirmPrompt: "Type \u201C{0}\u201D to confirm",\r\n' +
  '  typeToConfirmMismatch: "That does not match the phrase above.",\r\n' +
  '  settingsResetConfirmValue: "yes, reset everything",\r\n' +
  '  tasksClearAllConfirmValue: "yes, clear all tasks",\r\n' +
  '  tasksDeleteSelectedConfirmValue: "yes, delete the selected tasks",\r\n' +
  '  sidebarStorageReady: "Storage ready",\r\n' +
  '  sidebarStorageNotReady: "Storage not ready",\r\n';
const n = s.split(OLD).length - 1;
if (n !== 1) { console.error("ABORT: anchor matched " + n + " times, want 1"); process.exit(1); }
writeFileSync(F, s.replace(OLD, NEW), "utf8");
console.log("OK");
```

★ The `\u201C` escapes are in the SCRIPT, which produces real characters in the FILE. That is
allowed — the ban is on escapes surviving into `i18n*.ts`. Step 3 proves they did not.

- [ ] **Step 2: Run it**

```bash
node "$SCRATCH/i18n-en.mjs"; echo "EXIT=$?"
```
Expected: `OK` then `EXIT=0`. On `ABORT`, stop — the anchor is wrong, do not loosen it.

- [ ] **Step 3: Write and run the DE patch script**

Create `$SCRATCH/i18n-de.mjs`:

```js
import { readFileSync, writeFileSync } from "node:fs";
const F = "src/app/i18n.de.ts";
const s = readFileSync(F, "utf8");
const OLD = '  typeToConfirmPrompt: "Geben Sie {0} zur Best\u00E4tigung ein",\r\n';
const NEW =
  '  typeToConfirmPrompt: "Geben Sie \u201E{0}\u201C zur Best\u00E4tigung ein",\r\n' +
  '  typeToConfirmMismatch: "Das stimmt nicht mit der Angabe oben \u00FCberein.",\r\n' +
  '  settingsResetConfirmValue: "ja, alles zur\u00FCcksetzen",\r\n' +
  '  tasksClearAllConfirmValue: "ja, alle Aufgaben l\u00F6schen",\r\n' +
  '  tasksDeleteSelectedConfirmValue: "ja, ausgew\u00E4hlte Aufgaben l\u00F6schen",\r\n' +
  '  sidebarStorageReady: "Speicher bereit",\r\n' +
  '  sidebarStorageNotReady: "Speicher nicht bereit",\r\n';
const n = s.split(OLD).length - 1;
if (n !== 1) { console.error("ABORT: anchor matched " + n + " times, want 1"); process.exit(1); }
writeFileSync(F, s.replace(OLD, NEW), "utf8");
console.log("OK");
```

```bash
node "$SCRATCH/i18n-de.mjs"; echo "EXIT=$?"
```
Expected: `OK` then `EXIT=0`.

- [ ] **Step 4: Verify the bytes — this is the step that catches the corruption class**

```bash
node -e "
const s=require('fs').readFileSync('src/app/i18n.de.ts','utf8');
const bad=[];for(let i=0;i<s.length;i++){const c=s.codePointAt(i);if(c<9||(c>10&&c<32)||c===127)bad.push(c);}
console.log('control bytes:',bad.length);
console.log('escape leak:',/\\\\u00/.test(s));
console.log('ascii sub leak:',/fuer|druecken/.test(s));
for(const k of ['zurücksetzen','löschen','überein','ausgewählte','Speicher bereit','„{0}“'])
  console.log(k, s.includes(k));
"
git ls-files --eol src/app/i18n.de.ts
```
Expected: `control bytes: 0`, both leaks `false`, every key `true`, and `i/lf w/crlf`.
★ If `w/lf` appears, the file was re-lined — revert and redo with the node script.

- [ ] **Step 5: Typecheck (this is what enforces parity)**

```bash
npx tsc --noEmit > "$SCRATCH/tsc1.log" 2>&1; echo "EXIT=$?"
```
Expected: `EXIT=0`. A parity error names the missing key and the file lacking it.

- [ ] **Step 6: Commit**

```bash
git add src/app/i18n.ts src/app/i18n.de.ts
git commit --only src/app/i18n.ts src/app/i18n.de.ts -m "i18n: keys for confirm phrases, mismatch feedback and storage readiness"
```

---

### Task 2: §300 — delimit, trim, and give mismatch feedback

**Files:**
- Modify: `src/app/type-to-confirm-dialog.tsx`
- Test: `src/app/type-to-confirm-dialog.test.tsx`

- [ ] **Step 1: Write the four failing tests**

Append inside the existing `describe("TypeToConfirmDialog", ...)` in
`src/app/type-to-confirm-dialog.test.tsx`:

```tsx
  it("accepts a trailing space, which copy-paste adds", () => {
    render(<TypeToConfirmDialog {...base} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Apollo " } });
    expect(screen.getByRole("button", { name: "Delete" })).not.toBeDisabled();
  });

  // Pins a DELIBERATE choice: confirmValue is sometimes a project NAME, and
  // case-folding would both weaken a destructive gate and make two projects
  // differing only in case indistinguishable here.
  it("does NOT accept a case difference", () => {
    render(<TypeToConfirmDialog {...base} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "apollo" } });
    expect(screen.getByRole("button", { name: "Delete" })).toBeDisabled();
  });

  it("stays silent about a mismatch until the field is blurred", () => {
    render(<TypeToConfirmDialog {...base} />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "Apoll" } });
    expect(screen.queryByText(/does not match/i)).not.toBeInTheDocument();
    fireEvent.blur(input);
    expect(screen.getByText(/does not match/i)).toBeInTheDocument();
  });

  it("marks the field invalid and points at the message when mismatched", () => {
    render(<TypeToConfirmDialog {...base} />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "Apoll" } });
    fireEvent.blur(input);
    expect(input).toHaveAttribute("aria-invalid", "true");
    const id = input.getAttribute("aria-describedby");
    expect(id).toBeTruthy();
    expect(document.getElementById(id as string)).toHaveTextContent(/does not match/i);
  });
```

- [ ] **Step 2: Run them and confirm they fail**

```bash
npx vitest run src/app/type-to-confirm-dialog.test.tsx > "$SCRATCH/t2.log" 2>&1; echo "EXIT=$?"
grep -E "Tests |✓|×" "$SCRATCH/t2.log" | head -20
```
Expected: `EXIT=1`, with the trailing-space, blur and aria tests failing. The case test should
already PASS (bare equality is case-sensitive today) — that is correct, it is a regression pin.

- [ ] **Step 3: Change the component**

In `src/app/type-to-confirm-dialog.tsx`, add the module constant beside `TITLE_ID`:

```tsx
const TITLE_ID = "type-to-confirm-title";
const MISMATCH_ID = "type-to-confirm-mismatch";
```

Replace the state line:

```tsx
  const [typed, setTyped] = useState("");
  const matched = typed === confirmValue;
```

with:

```tsx
  const [typed, setTyped] = useState("");
  const [touched, setTouched] = useState(false);
  // ★ Trim, do NOT case-fold. A trailing space arrives whenever the phrase is
  // copied out of the prompt above, and a dead button with no explanation is
  // the same silent failure this dialog's mismatch message exists to end.
  // Case-folding would weaken a deliberate destructive gate, and `confirmValue`
  // is sometimes a project NAME, where case is meaningful.
  const matched = typed.trim() === confirmValue;
  // ★ Blur-gated on purpose: a message rendered per keystroke makes a screen
  // reader narrate one failure per character of a 30-character phrase.
  const showMismatch = touched && typed.trim() !== "" && !matched;
```

Replace the `<Input .../>` element with:

```tsx
            <Input
              type="text"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onBlur={() => setTouched(true)}
              aria-label={t(lang, "typeToConfirmPrompt", confirmValue)}
              invalid={showMismatch}
              aria-describedby={showMismatch ? MISMATCH_ID : undefined}
              autoComplete="off"
            />
            {/* ★ ALWAYS mounted, content swapped — a live region added to the DOM
                at the same moment it gains text is not reliably announced. */}
            <span id={MISMATCH_ID} role="status" className="text-xs text-ui-pink">
              {showMismatch ? t(lang, "typeToConfirmMismatch") : ""}
            </span>
```

★ `invalid` is an existing `Input` prop that sets both the error styling and `aria-invalid`
(`form-controls.tsx`). Do not hand-roll `aria-invalid`.

- [ ] **Step 4: Run the tests**

```bash
npx vitest run src/app/type-to-confirm-dialog.test.tsx > "$SCRATCH/t2b.log" 2>&1; echo "EXIT=$?"
grep -E "Tests " "$SCRATCH/t2b.log"
```
Expected: `EXIT=0`, 7 passed.

- [ ] **Step 5: Commit**

```bash
git add src/app/type-to-confirm-dialog.tsx src/app/type-to-confirm-dialog.test.tsx
git commit --only src/app/type-to-confirm-dialog.tsx src/app/type-to-confirm-dialog.test.tsx -m "fix: delimit the confirm phrase, trim it, and say so when it does not match (§300)"
```

---

### Task 3: §301 — the three English confirm phrases become i18n

**Files:**
- Modify: `src/app/settings-sections/general-section.tsx`, `src/app/tasks-section.tsx`
- Test: `src/app/settings-sections/general-section.test.tsx`, `src/app/tasks-section.test.tsx`

- [ ] **Step 1: Update the two existing tests that type the old phrases**

`src/app/settings-sections/general-section.test.tsx` line 66 — replace:

```tsx
    fireEvent.change(input, { target: { value: "yes, reset everything" } });
```
with:
```tsx
    fireEvent.change(input, { target: { value: t("en-US", "settingsResetConfirmValue") } });
```
Ensure `t` is imported in that file: `import { t } from "../i18n";`

`src/app/tasks-section.test.tsx` lines 343-344 — replace:

```tsx
      screen.getByLabelText(t("en-US", "typeToConfirmPrompt", "yes, clear all tasks")),
      { target: { value: "yes, clear all tasks" } },
```
with:
```tsx
      screen.getByLabelText(
        t("en-US", "typeToConfirmPrompt", t("en-US", "tasksClearAllConfirmValue")),
      ),
      { target: { value: t("en-US", "tasksClearAllConfirmValue") } },
```

- [ ] **Step 2: Run them and confirm they fail**

```bash
npx vitest run src/app/settings-sections/general-section.test.tsx src/app/tasks-section.test.tsx > "$SCRATCH/t3.log" 2>&1; echo "EXIT=$?"
```
Expected: `EXIT=1` — the dialogs still compare against the old module constants.

- [ ] **Step 3: Replace the constants with keys**

`src/app/settings-sections/general-section.tsx` — delete the constant and its docstring:

```tsx
/** The exact phrase the user must type to confirm a full reset. Deliberately a
 *  fixed English phrase (a friction gate), not localized. */
const RESET_CONFIRM_PHRASE = "yes, reset everything";
```

and change the dialog prop:

```tsx
          confirmValue={t(lang, "settingsResetConfirmValue")}
```

`src/app/tasks-section.tsx` — delete:

```tsx
/** Fixed English friction phrase to confirm clearing all tasks (mirrors the
 *  factory-reset dialog). Deliberately not localized. */
const CLEAR_TASKS_CONFIRM_PHRASE = "yes, clear all tasks";
```

and change the clear-all dialog prop:

```tsx
          confirmValue={t(lang, "tasksClearAllConfirmValue")}
```

and the bulk-delete dialog prop:

```tsx
          confirmValue={t(lang, "tasksDeleteSelectedConfirmValue")}
```

★ The bulk-delete MESSAGE keeps its count — `t(lang, "tasksDeleteSelectedDialogMessage",
selectedIds.size)` is unchanged. The count is now read, not transcribed; that is the point.

- [ ] **Step 4: Run the tests**

```bash
npx vitest run src/app/settings-sections/general-section.test.tsx src/app/tasks-section.test.tsx > "$SCRATCH/t3b.log" 2>&1; echo "EXIT=$?"
grep -E "Tests " "$SCRATCH/t3b.log"
```
Expected: `EXIT=0`.

- [ ] **Step 5: Prove no English phrase survives in a confirmValue**

```bash
grep -rn "confirmValue" src/app --include=*.tsx | grep -v "\.test\.tsx:"
```
Expected: 6 lines. Two pass a `.name`, four pass a `t(lang, ...)` call. No string literal.

- [ ] **Step 6: Commit**

```bash
git add src/app/settings-sections/general-section.tsx src/app/tasks-section.tsx src/app/settings-sections/general-section.test.tsx src/app/tasks-section.test.tsx
git commit --only src/app/settings-sections/general-section.tsx src/app/tasks-section.tsx src/app/settings-sections/general-section.test.tsx src/app/tasks-section.test.tsx -m "fix: localise all three English confirm phrases (§301)"
```

---

### Task 4: §302 — speak storage readiness

**Files:**
- Modify: `src/app/sidebar-footer.tsx`
- Test: `src/app/sidebar-footer.test.tsx`

★ `storageReady` is ALREADY a prop. Nothing is threaded.

- [ ] **Step 1: Write the failing tests**

Add to `src/app/sidebar-footer.test.tsx` (match the file's existing render-helper style; if it
has none, render `<SidebarFooter {...base} storageReady={false} />` directly):

```tsx
  it("speaks the not-ready state, which the dot only shows in colour", () => {
    render(<SidebarFooter {...base} storageReady={false} storageDescription="IndexedDB" />);
    expect(screen.getByText(t("en-US", "sidebarStorageNotReady"))).toBeInTheDocument();
  });

  it("speaks the ready state too", () => {
    render(<SidebarFooter {...base} storageReady storageDescription="IndexedDB" />);
    expect(screen.getByText(t("en-US", "sidebarStorageReady"))).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run and confirm failure**

```bash
npx vitest run src/app/sidebar-footer.test.tsx > "$SCRATCH/t4.log" 2>&1; echo "EXIT=$?"
```
Expected: `EXIT=1`, both new tests failing on "Unable to find an element with the text".

- [ ] **Step 3: Add the sr-only sentence**

In `src/app/sidebar-footer.tsx`, immediately after the `{storageDescription}` expression and
before the trailing `⚠` marker span, insert:

```tsx
          {/* ★ The dot and the trailing marker are BOTH aria-hidden, so this is
              the only readiness disclosure a screen reader gets on this line.
              ★★ Deliberately says no more than "not ready": `storageReady` is
              compound (`storageOk && !loadWasIncomplete && destructiveRefusal
              === null` in task-manager.tsx), so naming a CAUSE here would be
              wrong two times out of three. SavingPausedButton above names the
              cause when there is one. */}
          <span className="sr-only">
            {" "}
            {t(lang, storageReady ? "sidebarStorageReady" : "sidebarStorageNotReady")}
          </span>
```

★ Leave the dot and the `⚠` `aria-hidden`. Once the state is spoken, exposing all three would
announce the same fact three times.

- [ ] **Step 4: Run the tests**

```bash
npx vitest run src/app/sidebar-footer.test.tsx > "$SCRATCH/t4b.log" 2>&1; echo "EXIT=$?"
grep -E "Tests " "$SCRATCH/t4b.log"
```
Expected: `EXIT=0`.

- [ ] **Step 5: Correct the stale comment above the paragraph**

The block comment above this `<p>` currently ends by saying the assistive-tech half is NOT closed
("IT DOES NOT CLOSE THE ASSISTIVE-TECH HALF, and nothing here does"). That is now false. Replace
that sentence with:

```tsx
        // ★★ THE ASSISTIVE-TECH HALF IS CLOSED by the sr-only readiness text
        // below (§302). The dot and marker stay aria-hidden deliberately — the
        // state is spoken once, not three times. The COLOUR half is unchanged:
        // the dot alone is still not a sufficient visual channel, which is what
        // the trailing marker is for.
```

★ This is the sweep-prose rule applied in place: a comment that says a defect is open, left
standing after the fix, reads as an open TODO and gets re-derived.

- [ ] **Step 6: Commit**

```bash
git add src/app/sidebar-footer.tsx src/app/sidebar-footer.test.tsx
git commit --only src/app/sidebar-footer.tsx src/app/sidebar-footer.test.tsx -m "fix: speak storage readiness, which was colour-only to AT (§302)"
```

---

### Task 5: §303 — record a refusal once per magnitude, not once per effect run

**Files:**
- Modify: `src/app/use-destructive-save-guard.ts`, `src/app/use-storage-backend.ts`
- Test: `src/app/use-storage-backend.test.tsx`
- NOT modified: `src/app/save-guard.ts`

- [ ] **Step 1: Write the two failing tests**

First add the two imports the file does not yet have, beside its existing imports:

```tsx
import { readDataLossLog } from "./dataloss-forensics";
import { clearDiagLog } from "./diagnostics";
```

★★ `clearDiagLog()` at the top of each test is LOAD-BEARING, not tidiness. The diagnostic ring is
module-level state that survives across tests in a file, so without it an earlier test's refusal
is counted here and the assertion reads a number this test did not produce. That is the same
shared-mock-state shape that made `chat-panel.test.tsx` fail under `unit-tests-shuffled`.

Add both tests after `"keeps refusing every later save while a refusal stands"`. They reuse that
test's exact boot idiom (`useReloadableBackend` seeds 20 tasks in one collection):

```tsx
  // Case A — the §303 duplicate. An unrelated edit while a refusal stands
  // re-refuses the SAME magnitude, so it is ONE data-loss event, not two.
  it("records a standing refusal ONCE, however many saves re-refuse it", async () => {
    clearDiagLog();
    useReloadableBackend();
    const { result } = renderBackend();
    await act(async () => { await Promise.resolve(); });
    await act(async () => { vi.advanceTimersByTime(600); });
    await act(async () => { await Promise.resolve(); });

    // An UNARMED 19-of-20 deletion: refused, and recorded.
    await act(async () => { result.current.setTasks([{ id: 1, taskName: "T" }] as unknown as Task[]); });
    await act(async () => { vi.advanceTimersByTime(600); });
    await act(async () => { await Promise.resolve(); });
    expect(readDataLossLog().filter((e) => e.refused)).toHaveLength(1);

    // An unrelated edit. Baselines still say 20, so this re-refuses the same
    // magnitude (prevRecords 20, curRecords 1) — no second event happened.
    await act(async () => { result.current.setTasks([{ id: 1, taskName: "renamed" }] as unknown as Task[]); });
    await act(async () => { vi.advanceTimersByTime(600); });
    await act(async () => { await Promise.resolve(); });
    expect(result.current.destructiveRefusal).toMatchObject({ prevRecords: 20, curRecords: 1 });
    expect(readDataLossLog().filter((e) => e.refused)).toHaveLength(1);
  });

  // Case B — NOT a duplicate. Deleting further while paused makes the loss
  // WORSE, and forensics must capture the new magnitude separately. This is
  // what gating on `refusalWasStanding` would silently drop.
  it("records again when the magnitude worsens while a refusal stands", async () => {
    clearDiagLog();
    useReloadableBackend();
    const { result } = renderBackend();
    await act(async () => { await Promise.resolve(); });
    await act(async () => { vi.advanceTimersByTime(600); });
    await act(async () => { await Promise.resolve(); });

    await act(async () => { result.current.setTasks([{ id: 1, taskName: "T" }] as unknown as Task[]); });
    await act(async () => { vi.advanceTimersByTime(600); });
    await act(async () => { await Promise.resolve(); });
    expect(readDataLossLog().filter((e) => e.refused)).toHaveLength(1);

    // Now delete the LAST task while the refusal stands: curRecords 1 -> 0.
    // A different, worse magnitude, so `sameRefusal` is false.
    await act(async () => { result.current.setTasks([] as unknown as Task[]); });
    await act(async () => { vi.advanceTimersByTime(600); });
    await act(async () => { await Promise.resolve(); });
    expect(result.current.destructiveRefusal).toMatchObject({ prevRecords: 20, curRecords: 0 });
    expect(readDataLossLog().filter((e) => e.refused)).toHaveLength(2);
  });
```

★ Do NOT bind `useReloadableBackend()`'s return to a variable here — neither test uses it, and an
unused local is FATAL under `--max-warnings=0` (there is no ignore pattern).

★★ Case B is NOT a regression pin — nothing constrains this behaviour today in either direction.
It must be seen FAILING against a build where the gate is present but wrong (Step 6 proves this),
or it certifies nothing.

- [ ] **Step 2: Run and confirm Case A fails**

```bash
npx vitest run src/app/use-storage-backend.test.tsx -t "records a standing refusal" > "$SCRATCH/t5.log" 2>&1; echo "EXIT=$?"
```
Expected: `EXIT=1`, Case A failing with `expected length 1, received 2`. Case B should PASS
already (today's unconditional write records both).

- [ ] **Step 3: Return the discriminator from the hook**

In `src/app/use-destructive-save-guard.ts`, add above `DestructiveSaveGuard`:

```ts
/** What `evaluate` answers: the pure verdict plus whether this refusal is a
 *  NEW magnitude rather than the standing one re-asserting itself.
 *
 *  ★★★ `isNewMagnitude` is NOT on `SaveGuardVerdict`. `save-guard.ts` is pure
 *  and has no idea a refusal is standing; novelty is a property of THIS hook's
 *  state. Putting it there would drag the standing refusal into a pure module. */
export interface DestructiveEvaluation extends SaveGuardVerdict {
  /** True when no refusal stood, or the standing one described a different
   *  magnitude. False when this is the same loss re-refusing — the case that
   *  must not be recorded twice (§303). Always false when `refuse` is false. */
  isNewMagnitude: boolean;
}
```

Change the `evaluate` member's type in the `DestructiveSaveGuard` interface:

```ts
  evaluate: (curCollections: number, curRecords: number, armed: boolean) => DestructiveEvaluation;
```

Replace the `evaluate` implementation:

```ts
  const evaluate = (curCollections: number, curRecords: number, armed: boolean): DestructiveEvaluation => {
    const prevCollections = prevCollectionCountRef.current;
    const prevRecords = prevRecordCountRef.current;
    const verdict = evaluateSaveGuard({ prevCollections, prevRecords, curCollections, curRecords, allowDestructive: armed });
    if (!verdict.refuse) return { ...verdict, isNewMagnitude: false };
    const next: DestructiveRefusal = { prevCollections, prevRecords, curCollections, curRecords, fullWipe: verdict.refusedBy === "full-wipe" };
    // ★ Read the CLOSURE's refusal, not the functional setter's `cur`: the
    // updater runs at commit time and cannot return a value to this caller.
    // This is the same render-time value `use-storage-backend.ts` reads as
    // `refusalWasStanding`, so the two can never disagree about what stood.
    const isNewMagnitude = refusal === null || !sameRefusal(refusal, next);
    setRefusal((cur) => (cur !== null && sameRefusal(cur, next) ? cur : next));
    return { ...verdict, isNewMagnitude };
  };
```

- [ ] **Step 4: Gate the forensic write**

In `src/app/use-storage-backend.ts`, inside `if (verdict.refuse) {`, replace the unconditional
`recordDataLossEvent(...)` call with:

```ts
      // ★★★ ONLY on a NEW MAGNITUDE, and NOT on `!refusalWasStanding` — those
      // differ, and the difference is a real record. `refusalWasStanding`
      // answers "was any refusal up", so gating on it would silently DROP the
      // case where the user deletes further while paused and the loss gets
      // WORSE (§303). `isNewMagnitude` compares the counts, so it suppresses
      // the re-refusal of one unchanged loss and keeps the second real event.
      // ★ It matters because the diagnostic ring is capped and `capRing` evicts
      // `info` first: a `dataloss.refused` write is `warn`, so duplicates evict
      // real history rather than being evicted.
      if (verdict.isNewMagnitude) {
        recordDataLossEvent({ path: "save-effect", prevCollections: destructive.readBaselines().collections, nextCollections: curCollections, refused: true });
      }
```

★ Leave the `if (!refusalWasStanding)` toast guard exactly as it is. The toast is about the
BANNER already being visible; that is a different question from whether the loss is new.

- [ ] **Step 5: Run the tests**

```bash
npx vitest run src/app/use-storage-backend.test.tsx > "$SCRATCH/t5b.log" 2>&1; echo "EXIT=$?"
grep -E "Tests " "$SCRATCH/t5b.log"
```
Expected: `EXIT=0`, both new tests passing and every pre-existing test still passing —
especially `"keeps refusing every later save while a refusal stands"`, which pins the identity
stability the infinite-loop comment protects.

- [ ] **Step 6: Mutate, to prove Case B is not decorative**

Temporarily change the gate to the WRONG discriminator — the fix a reasonable engineer would
have written:

```ts
      if (!refusalWasStanding) {
```

```bash
npx vitest run src/app/use-storage-backend.test.tsx -t "magnitude worsens" > "$SCRATCH/t5m.log" 2>&1; echo "MUTANT_EXIT=$?"
```
Expected: `MUTANT_EXIT=1` — Case B fails. If it PASSES, the test does not discriminate and must
be rewritten before proceeding.

Then revert the mutant by writing `if (verdict.isNewMagnitude) {` back, and prove the tree is
clean of it:

```bash
grep -n "if (!refusalWasStanding) {" src/app/use-storage-backend.ts
```
Expected: exactly ONE line — the toast guard. If two, the mutant is still live.

- [ ] **Step 7: Typecheck and commit**

```bash
npx tsc --noEmit > "$SCRATCH/tsc5.log" 2>&1; echo "EXIT=$?"
git add src/app/use-destructive-save-guard.ts src/app/use-storage-backend.ts src/app/use-storage-backend.test.tsx
git commit --only src/app/use-destructive-save-guard.ts src/app/use-storage-backend.ts src/app/use-storage-backend.test.tsx -m "fix: record a refusal once per magnitude, not once per effect run (§303)"
```

---

### Task 6: Sweep the prose the behaviour change falsified

**Files:**
- Modify: `src/app/use-bulk-operations.ts` (2 comments)

- [ ] **Step 1: Find every mention of a phrase that no longer exists**

```bash
grep -rnE "yes, clear all tasks|yes, reset everything|delete \\\$\{|Deliberately not localized|fixed English phrase|not localized" src docs AGENTS.md --include=*.ts --include=*.tsx --include=*.md
```

- [ ] **Step 2: Fix every hit**

`src/app/use-bulk-operations.ts` lines 63 and 538 both quote the literal `"yes, clear all tasks"`
as the phrase the user types. Replace the quoted literal in both with a key reference, e.g.
`(type the `tasksClearAllConfirmValue` phrase)`. Do not restate the English text — that is what
rots.

Any hit calling a phrase "deliberately not localized" is now false and must be deleted or
corrected, including in the deleted docstrings from Task 3 if any survived.

- [ ] **Step 3: Re-run the grep and confirm every survivor is correct-as-written**

```bash
grep -rnE "yes, clear all tasks|yes, reset everything|Deliberately not localized" src docs AGENTS.md --include=*.ts --include=*.tsx --include=*.md
```
Expected: only hits inside `docs/superpowers/` (the spec and this plan, which are dated records)
and `docs/open-followups.md` entries describing the OLD state, which Task 7 rewrites.

- [ ] **Step 4: Commit**

```bash
git add src/app/use-bulk-operations.ts
git commit --only src/app/use-bulk-operations.ts -m "docs: sweep the comments that named the removed English confirm phrases"
```

---

### Task 7: Register — close four, rewrite one, file one

**Files:**
- Modify: `docs/open-followups.md` (LF file — do not re-line it)

★ Closure is a FOUR-PLACE edit per entry: the `##` heading marker, the summary-table STATUS cell,
the summary-table ANCHOR, and the `**Status:**` witness — PLUS every cross-reference elsewhere in
the file, because anchors change when a heading changes.
★★ Do NOT run the register's own index-rebuild recipe (§319). It destroys hand-written State-cell
parentheticals.
★ An OPEN entry's Status line must never contain the word CLOSED. A CLOSED entry's may.

- [ ] **Step 1: Read the six entries before editing any of them**

```bash
grep -nE "^## (300|301|302|303|307|319)\." docs/open-followups.md
grep -nE "§(300|301|302|303|307)" docs/open-followups.md
```
The second command finds the CROSS-REFERENCES, which are the places a four-place edit misses.

- [ ] **Step 2: Close §300, §301, §302, §303**

For each, append ` — CLOSED 2026-08-31` to the `##` heading, update its summary-table status cell
and anchor, and rewrite its `**Status:**` line to name what was done and the command that shows
it. Example for §300:

★ Do NOT write a VERSION number into these lines. The release (Task 9) is gated on the user's
say-so and may never happen, or may land at a different number — a Status line naming an
unreleased version is a false claim, and nothing would catch it. The date plus a reproduce command
is the durable form.

```
**Status:** CLOSED 2026-08-31. The prompt now delimits the phrase in both locales and the dialog
reports a mismatch after blur. Verify: `npx vitest run src/app/type-to-confirm-dialog.test.tsx`
(7 tests).
```

★ §302 is ALSO listed under slice 7 of the roadmap. Add to its body: `Reachable from slice 3 and
slice 7; closed by slice 3 — slice 7 must not re-close it.`

- [ ] **Step 3: Rewrite §307 and close it as not-a-defect**

Replace its body with the finding, not a fix:

```
The premise is true and is not a gap. The refusal predicate is
`(fullWipe || massDelete) && !allowDestructive`, and every legitimate bulk path arms
(`allowDestructiveSave`), so a refusal fires ONLY on data loss that nothing in the app explains.
An e2e could therefore stage one only by manufacturing corruption. Covered at unit level instead,
where the state is directly constructible.

★ Residual, stated rather than hidden: the recourse path is still never exercised in a real
browser, so a prod-only CSP- or focus-class defect in it would not be caught here.

★ Rejected: a dev-only injector global. A global that forces a destructive-save state is a
security surface, the production strip would have to be proven rather than assumed, and a hook
stripped in prod means the e2e exercises a path users never run.
```

Heading gets ` — CLOSED 2026-08-31, not a defect`.

- [ ] **Step 4: File §323 as a NEW OPEN entry**

Confirm the number is still free before writing it:

```bash
grep -oE "^## [0-9]+\." docs/open-followups.md | grep -oE "[0-9]+" | sort -n | tail -1
```
Expected: `322`. If it returns 323 or more, someone else minted it — take the next free number and
tell the user, do not overwrite.

Body: the unarmed `use-task-row-handlers.ts` `onDelete` against every other entity's arming single
delete; why it is filed and not fixed (unreachable — two callers, both single-id, never looped, so
it cannot cross the mass-delete floor of 5-removed-in-one-commit; and not-arming is the SAFER
side, since arming SUPPRESSES the guard). Its Status line must say `never machine-verified` unless
you actually probe it, and must NOT contain the word CLOSED.

- [ ] **Step 5: Verify the four-place edit mechanically**

```bash
node -e "
const s=require('fs').readFileSync('docs/open-followups.md','utf8');
for (const n of [300,301,302,303,307,323]) {
  const m = s.match(new RegExp('^## '+n+'\\\\.[^\\\\n]*','m'));
  console.log(n, m ? (/CLOSED/.test(m[0]) ? 'HEADING:CLOSED' : 'HEADING:OPEN') : 'HEADING:MISSING');
}
const bad=[];for(let i=0;i<s.length;i++){const c=s.codePointAt(i);if(c<9||(c>10&&c<32)||c===127)bad.push(c);}
console.log('control bytes:', bad.length);
console.log('CRLF:', (s.match(/\r\n/g)||[]).length, '(want 0)');
"
npm run followups:status:check > "$SCRATCH/fu.log" 2>&1; echo "EXIT=$?"
tail -5 "$SCRATCH/fu.log"
```
Expected: 300/301/302/303/307 `HEADING:CLOSED`, 323 `HEADING:OPEN`, `control bytes: 0`, `CRLF: 0`,
and `EXIT=0`. ★ Exit 1 is DRIFT (write the Status line); exit 2 means the gate could not scan at
all — a gate that scans nothing passes everything.

- [ ] **Step 6: Commit**

```bash
git add docs/open-followups.md
git commit --only docs/open-followups.md -m "docs: close 300-303, rewrite 307 as not-a-defect, file 323"
```

---

### Task 8: Full gate run

- [ ] **Step 1: Typecheck, lint, docs gates — each unpiped**

```bash
npx tsc --noEmit > "$SCRATCH/g-tsc.log" 2>&1; echo "TSC=$?"
npx eslint --max-warnings=0 src > "$SCRATCH/g-lint.log" 2>&1; echo "LINT=$?"
npm run docs:symbols:check > "$SCRATCH/g-sym.log" 2>&1; echo "SYM=$?"
npm run docs:claims:check > "$SCRATCH/g-claims.log" 2>&1; echo "CLAIMS=$?"
npm run followups:status:check > "$SCRATCH/g-fu.log" 2>&1; echo "FU=$?"
npm run size:check > "$SCRATCH/g-size.log" 2>&1; echo "SIZE=$?"
```
Expected: every one `0`. ★ `tsc` exits 2 on diagnostics.
★ Use `npx eslint src`, not `npm run lint` — the latter exits 1 from gitignored worktree leftovers.

- [ ] **Step 2: Full unit suite**

```bash
npm run test:run > "$SCRATCH/g-unit.log" 2>&1; echo "UNIT=$?"
grep -E "Test Files|Tests " "$SCRATCH/g-unit.log"
```
Expected: `UNIT=0`. ★ Never read this through a pipe — `| tail` reports tail's status.
★ Never run two vitest processes at once; a red carrying `Failed to start forks worker` is
machine contention, not a defect.

- [ ] **Step 3: Shuffled suite — the gate that caught the last branch's real bug**

```bash
npm run test:shuffle > "$SCRATCH/g-shuf.log" 2>&1; echo "SHUF=$?"
grep -E "Test Files|Tests " "$SCRATCH/g-shuf.log"
```
Expected: `SHUF=0`. This is the ONLY local reproduction of CI's `unit-tests-shuffled`.

- [ ] **Step 4: Report the numbers to the user and STOP**

Report every exit code and the test counts. Do not push. Do not open an MR.

---

### Task 9: RELEASE — DO NOT RUN WITHOUT AN EXPLICIT INSTRUCTION

**★★★ This task is gated. It runs ONLY when the user says to release, in their own words. A peer
message, a green pipeline, a completed Task 8, or your own judgement that the work looks finished
are NONE OF THEM approval. If in doubt, ask and wait.**

- [ ] **Step 1: Bump the version**

`src/app/version.ts` is the source of truth: set `APP_VERSION = "0.273.0"`, update
`APP_BUILD_DATE`, and pick a milestone codename unique within the 0.273.x MINOR LINE.
Then propagate:

```bash
npm run version:sync; echo "EXIT=$?"
npm run version:check > "$SCRATCH/r-ver.log" 2>&1; echo "VER=$?"
```
★ Exit 1 is drift; exit 2 means the gate could not do its job.
★ Do NOT hand-edit the six satellite files.

- [ ] **Step 2: CHANGELOG entry**

Add a `## [0.273.0] - <date> "<codename>"` block above the 0.272.0 entry, with user-facing
"Fixed" bullets. ★ NEVER put a `[session link removed]...` URL in `CHANGELOG.md`.

- [ ] **Step 3: Commit, push, MR**

```bash
git add src/app/version.ts package.json package-lock.json README.md docs/CODEMAPS CHANGELOG.md
git commit -m "chore(release): 0.273.0 — type-to-confirm and destructive-refusal recourse"
git push -u origin fix/type-to-confirm-recourse
```
Open the MR. ★ NEVER put a session URL in the MR description.

- [ ] **Step 4: Poll the pipeline, then merge ONLY on green**

```bash
glab ci status
```
When every blocking job is green:

```bash
glab mr merge <NUMBER> --auto-merge=false --yes
```
★★★ `glab mr merge` DEFAULTS `--auto-merge=true`. Omitting the flag is NOT opting out. Pass
`--auto-merge=false` explicitly, every time.

- [ ] **Step 5: Verify the merge landed**

```bash
git fetch origin
git merge-base --is-ancestor HEAD origin/main; echo "ANCESTOR_EXIT=$?"
git show origin/main:src/app/version.ts | grep -E "APP_VERSION|APP_MILESTONE"
```
Expected: `ANCESTOR_EXIT=0` and 0.273.0 on main.

---

## Self-review

**Spec coverage:** §300 → Task 2. §301 → Task 3. §302 → Task 4. §303 → Task 5. §307 → Task 7
Step 3. §323 → Task 7 Step 4. i18n landmines → Task 1. Prose sweep → Task 6. Release gating →
Task 9. No spec section is unimplemented.

**Two spec statements this plan deliberately contradicts**, both corrected at the top and at the
task: §302 needs no threading, and `isNewMagnitude` goes on the hook's return type rather than on
the pure `SaveGuardVerdict`.

**Type consistency:** `DestructiveEvaluation extends SaveGuardVerdict` is declared in Task 5 Step
3 and is the only new type. `evaluate`'s signature is changed in the same step as the interface.
Key names are identical between Task 1's table and every consuming task.

**Placeholder scan:** one real hit, fixed. Task 5's tests originally named two helpers
(`renderRefusedHarness`, `deleteFurtherWhileRefused`) that do not exist anywhere — an engineer
reading that task out of order would have written them from scratch or stalled. Replaced with the
real boot idiom (`useReloadableBackend()` + `renderBackend()` + `vi.advanceTimersByTime(600)`)
read out of the existing `"keeps refusing every later save while a refusal stands"` test, plus the
two imports the file lacks and the `clearDiagLog()` call the module-level ring requires.

**Known residual risks, stated rather than hidden:**

1. Task 4's tests assume `sidebar-footer.test.tsx` has a `base` props object. If it does not,
   build the props inline from `SidebarFooterProps`; the assertions are unaffected.
2. FIXED during this review, recorded because the class recurs: Task 7 Step 2 originally told the
   engineer to stamp `0.273.0` into four Status lines, in a task that runs BEFORE the gated
   release that mints that number. Had the release not been taken, the register would have
   asserted a version that does not exist, and no gate reads Status-line version numbers. Task 7
   now writes a date plus a reproduce command, and `0.273.0` appears only inside Task 9.
3. Case B's second refusal assumes the debounced save effect re-runs on `setTasks([])` while a
   refusal stands. The standing-refusal test relies on exactly that re-run, so this is sound, but
   if Case B reports 1 rather than 2 the cause is the effect not re-running — not the gate.
