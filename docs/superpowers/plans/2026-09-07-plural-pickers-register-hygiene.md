# Pluralisation, picker consolidation and register hygiene — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship one release carrying a per-language plural rule across 41 i18n keys, a probed decision on the comma-email round-trip, one shared combobox core behind the two entity pickers, and register/codename-ledger hygiene with a gate that keeps the register's index honest.

**Architecture:** Four file-disjoint workstreams (A i18n · B inline-edit · C pickers · D docs+scripts) on one branch, one bump, one MR. A adds `tPlural` to `i18n.ts` and routes every count-bearing string through it; B probes before it fixes; C extracts a second combobox core deliberately distinct from the existing `combobox-shared`; D repairs the register and adds the gate that would have prevented the §407 collision.

**Tech Stack:** TypeScript, React 19, Next 16.2.11, vitest 4.1.8, Playwright, node ESM scripts, GitLab CI.

---

## Ground rules for every task in this plan

Read these once. They are not optional and several have cost real releases.

1. **`src/app/i18n.de.ts` is NEVER edited with the Edit or Write tool.** Both corrupt umlauts and curl double quotes. Patch it by writing a `.mjs` script with the Write tool and running it with node. The file is **CRLF** — anchors must match `\r\n`, never `\n`, or the replace silently no-ops. Write real umlauts (`ä ö ü ß`), never `\uXXXX` escapes: `i18n-encoding.test.ts` bans both ASCII substitutions and escapes.
2. **`src/app/*.ts(x)` is CRLF.** The Write tool re-lines CRLF to LF; Edit preserves it. Use Edit for existing source files. Check with `git ls-files --eol <file>` — `i/lf w/crlf` is healthy, `i/lf w/lf` means it was re-lined.
3. **Never run two vitest processes at once.** `Failed to start forks worker` is contention, not evidence.
4. **Never read a gate's exit code through a pipe.** Redirect, `echo "EXIT=$?"` unpiped, then grep the file.
5. **Never `git add -A` or `git add .`** — `not-in-use.env.local.bak` is untracked, not gitignored, and holds a live token. Commit with `git commit --only <paths>`.
6. **Never `git commit --amend`** (shared worktree). New commits only.
7. `sample-workspace-big.json` and `sample-workspace-huge.json` show as modified. They are **foreign**. Never commit them, never revert them.
8. Use the session scratchpad for temp files, never `/tmp`.
9. `npx tsc --noEmit` exits **2** on diagnostics. IDE inline diagnostics in this repo are unreliable; only `tsc` and `eslint` decide.
10. `npm run lint` exits 1 from gitignored leftovers — use `npx eslint --max-warnings=0 src`.

---

## File Structure

| File | Responsibility | Workstream |
|---|---|---|
| `src/app/i18n.ts` | EN dictionary; gains `PluralBaseKey` + `tPlural` beside `t()` | A |
| `src/app/i18n.de.ts` | DE dictionary; gains the 31 + 7 singular/renamed keys | A |
| `src/app/i18n-plural.test.ts` | **new** — `tPlural` behaviour across the three langs, plus the reverse-direction pairing test | A |
| 27 call-site files | switch `t(...)` to `tPlural(...)` — the 23 carrying a 415 key, plus the four holding an existing ternary | A |
| `src/app/dashboard-delta-strip.tsx` | splits the two-count greeting into two pluralised halves | A |
| `src/app/inline-ai-edit/entity-descriptor.ts` | `emails` projection; only if the probe implicates it | B |
| `src/app/use-inline-entity-edit.ts` | the patch-build no-op guard | B |
| `src/app/inline-ai-edit/emails-roundtrip.probe.test.ts` | **new, retained** — the §422 trigger probe | B |
| `src/app/entity-combobox.ts` | **new** — the shared keyboard/highlight core for the two ENTITY pickers | C |
| `src/app/entity-combobox-search.tsx` | **new** — the shared search-box block | C |
| `src/app/single-entity-picker.tsx` | consumes both; keeps its own commit call | C |
| `src/app/entity-link-picker.tsx` | consumes both; keeps `entryKey` identity | C |
| `src/app/task-link-picker.tsx` | unchanged code; gains a direct suite | C |
| `scripts/followup-index-lib.mjs` | **new** — pure heading-set vs index-set diff | D |
| `scripts/followup-index-lib.test.mjs` | **new** — unit tests incl. the vacuity control | D |
| `scripts/check-followup-index.mjs` | **new** — CLI wrapper, exit 1 drift / exit 2 cannot scan | D |
| `package.json` | `followups:index:check` script + `scriptsDescriptions` entry | D |
| `.gitlab-ci.yml` | `followups-index-check` quality job | D |
| `docs/open-followups.md` | 8 missing rows, §321 order, §407/§421/§423 closure, §415 narrowing, §422 outcome | A + B + D |
| `src/app/version.ts` | ledger cut; later the version bump | D + release |

**Serialization:** A and D both write `docs/open-followups.md`. Run D's register edits **after** A's §415 narrowing, never concurrently. Everything else is disjoint and may run in parallel.

---

# Workstream A — Pluralisation

## Task A1: The `tPlural` helper

**Files:**
- Modify: `src/app/i18n.ts` (add after the `t()` declaration)
- Test: `src/app/i18n-plural.test.ts` (create)

Context an implementer needs: `t(lang, key, ...args)` picks the dict (`de` when loaded, else `en-GB`, else `en-US`), then substitutes `{0}`, `{1}`, … positionally from `args`. `TranslationKey = keyof typeof enUS`. `localeFor(lang)` already exists in this file and returns `"de-DE" | "en-GB" | "en-US"`.

- [ ] **Step 1: Write the failing test**

Create `src/app/i18n-plural.test.ts`:

```ts
import { describe, expect, it, beforeAll } from "vitest";
import { loadI18n, tPlural } from "./i18n";

describe("tPlural", () => {
  beforeAll(async () => {
    // The DE dictionary is lazy — an assertion on German output before this
    // resolves silently reads the EN fallback and passes for the wrong reason.
    await loadI18n("de");
  });

  it("selects the singular key only for a count of exactly one", () => {
    expect(tPlural("en-US", "activityEntriesLogged", 1, 1)).toBe("1 entry logged");
    expect(tPlural("en-US", "activityEntriesLogged", 2, 2)).toBe("2 entries logged");
  });

  // ★ ZERO is the assertion that discriminates the implementations. A naive
  // `count === 1 ?` and a correct Intl.PluralRules both pass the 1-vs-2 case
  // above; a `count > 1 ?` implementation passes it too and gets ZERO wrong.
  it("treats zero as the plural form, not the singular", () => {
    expect(tPlural("en-US", "activityEntriesLogged", 0, 0)).toBe("0 entries logged");
    expect(tPlural("de", "activityEntriesLogged", 0, 0)).toBe("0 Einträge protokolliert");
  });

  it("selects the German singular, which is a different stem, not a suffix drop", () => {
    expect(tPlural("de", "activityEntriesLogged", 1, 1)).toBe("1 Eintrag protokolliert");
    expect(tPlural("de", "activityEntriesLogged", 2, 2)).toBe("2 Einträge protokolliert");
  });

  it("uses the en-US dictionary for en-GB, matching t()", () => {
    expect(tPlural("en-GB", "activityEntriesLogged", 1, 1)).toBe("1 entry logged");
  });

  // ★ The count is NOT injected as {0}. Three of the converted keys carry the
  // count in another slot, so args are forwarded verbatim and the call site
  // passes the number wherever it belongs.
  it("forwards args verbatim rather than injecting the count", () => {
    expect(tPlural("en-US", "timelogTestOk", 1, 1, "read")).toBe("Connected — 1 user, scope: read");
    expect(tPlural("en-US", "timelogTestOk", 3, 3, "read")).toBe("Connected — 3 users, scope: read");
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
npx vitest run --maxWorkers=1 src/app/i18n-plural.test.ts
```

Expected: FAIL — `tPlural` is not exported from `./i18n`. (`activityEntriesLoggedOne` and `timelogTestOkOne` also do not exist yet; they arrive in A4 and A7. Both keys are added in Step 3 below so this test can go green here — see the note in that step.)

- [ ] **Step 3: Implement `tPlural` and the two keys the test needs**

In `src/app/i18n.ts`, immediately after the `t()` function, add:

```ts
/**
 * The base keys `tPlural` accepts: every key whose `…One` sibling also exists.
 *
 * ★★★ THIS TYPE IS THE GATE. A `tPlural(lang, "foo", n)` whose `fooOne` key is
 * missing is a TYPE ERROR, not a runtime fallback — which is stronger than any
 * source-scanning test could be, and it is why no test in this repo asserts the
 * forward direction. The REVERSE direction (a `…One` key with no plural
 * sibling, i.e. a stranded singular) is invisible to the type system and IS
 * covered by a source test in `i18n-plural.test.ts`.
 */
export type PluralBaseKey = {
  [K in TranslationKey]: `${K}One` extends TranslationKey ? K : never;
}[TranslationKey];

/**
 * Count-aware lookup: renders `<baseKey>One` when the language's plural rules
 * put `count` in the `one` category, and `<baseKey>` otherwise.
 *
 * ★★★ THE TWO FORMS ARE INDEPENDENTLY AUTHORED COMPLETE STRINGS, never a stem
 * plus a suffix. That is the substance of the house rule this helper replaced:
 * German breaks on noun AND adjective AND verb agreement at once, so a singular
 * is a re-worded sentence. What changed in 0.29x is only WHERE the count test
 * lives — one helper instead of a ternary at each call site — so the rule is
 * kept and the duplication is not.
 *
 * ★★ `count` is NOT injected into the args. Three converted keys carry the
 * count in a slot other than `{0}` (`actionCommitteeInfoWhy` at `{2}`,
 * `chatAttachmentSummarySkipped` at `{1}`), so the caller passes the number in
 * whatever position the string uses and `count` is used ONLY to select the
 * form. Injecting it would have worked for 28 of the 31 keys, which is exactly
 * the kind of convenience that reads as correct until the 29th.
 *
 * ★ Written against Intl's CATEGORIES rather than `count === 1` so a future
 * language with a `few`/`many` category is a dictionary change rather than a
 * code change. en-US, en-GB and de all resolve to `one`/`other` today, so the
 * behaviour is identical to the ternary it replaced — including for ZERO,
 * which is `other` in all three and was the case a `count > 1` spelling would
 * have got wrong.
 */
export function tPlural(
  lang: Lang,
  baseKey: PluralBaseKey,
  count: number,
  ...args: (string | number)[]
): string {
  const category = new Intl.PluralRules(localeFor(lang)).select(count);
  const key = (category === "one" ? `${baseKey}One` : baseKey) as TranslationKey;
  return t(lang, key, ...args);
}
```

Then add the two keys this task's test needs. In `src/app/i18n.ts`, beside `activityEntriesLogged`:

```ts
  activityEntriesLoggedOne: "1 entry logged",
```

and beside `timelogTestOk`:

```ts
  timelogTestOkOne: "Connected — 1 user, scope: {1}",
```

The DE halves must land in the same commit or `tsc` fails on key-set parity. Write this script to the scratchpad and run it with node:

```js
// patch-de-a1.mjs — add the two DE singulars. i18n.de.ts is CRLF: anchors use
// \r\n or the replace is a silent no-op.
import { readFileSync, writeFileSync } from "node:fs";
const P = "src/app/i18n.de.ts";
let s = readFileSync(P, "utf8");
const edits = [
  ['  activityEntriesLogged: "{0} Einträge protokolliert",\r\n',
   '  activityEntriesLogged: "{0} Einträge protokolliert",\r\n  activityEntriesLoggedOne: "1 Eintrag protokolliert",\r\n'],
  ['  timelogTestOk: "Verbunden — {0} Benutzer, Bereich: {1}",\r\n',
   '  timelogTestOk: "Verbunden — {0} Benutzer, Bereich: {1}",\r\n  timelogTestOkOne: "Verbunden — 1 Benutzer, Bereich: {1}",\r\n'],
];
for (const [from, to] of edits) {
  const n = s.split(from).length - 1;
  if (n !== 1) throw new Error(`anchor matched ${n} times, expected 1: ${from.slice(0, 40)}`);
  s = s.replace(from, to);
}
writeFileSync(P, s);
console.log("patched 2 DE keys");
```

- [ ] **Step 4: Run the test and typecheck**

```bash
npx vitest run --maxWorkers=1 src/app/i18n-plural.test.ts
npx tsc --noEmit; echo "EXIT=$?"
```

Expected: 5 passed. `EXIT=0`.

- [ ] **Step 5: Verify the DE file was not corrupted**

```bash
git ls-files --eol src/app/i18n.de.ts
grep -n "Eintrag protokolliert" src/app/i18n.de.ts
```

Expected: `i/lf w/crlf`, and the grep prints the line with a real `ä`-free but correctly-encoded German string. Then confirm no escapes crept in:

```bash
npx vitest run --maxWorkers=1 src/app/i18n-encoding.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git commit --only src/app/i18n.ts src/app/i18n.de.ts src/app/i18n-plural.test.ts -m "feat(i18n): add tPlural, a per-language plural selector over authored key pairs"
```

---

## Task A2: The reverse-direction pairing test

`PluralBaseKey` makes a missing `…One` a type error. Nothing catches the opposite: a `…One` key whose plural sibling was renamed or deleted, leaving a singular nothing can ever render.

**Files:**
- Test: `src/app/i18n-plural.test.ts` (modify)

- [ ] **Step 1: Write the failing test**

Append to `src/app/i18n-plural.test.ts`:

```ts
import { readFileSync } from "node:fs";

describe("plural key pairing", () => {
  // ★ Source scan, not a dictionary import: the assertion is about the KEY SET
  // as written, and reading it off the module would make a stranded singular
  // indistinguishable from a live one.
  const src = readFileSync("src/app/i18n.ts", "utf8");
  const keys = [...src.matchAll(/^ {2}([a-zA-Z0-9]+):/gm)].map((m) => m[1]);

  it("gives every singular key a plural sibling", () => {
    const singulars = keys.filter((k) => k.endsWith("One"));
    // Non-vacuity control: if this scan ever returns an empty set the test
    // below passes over nothing, so assert the population first.
    expect(singulars.length).toBeGreaterThan(30);
    const stranded = singulars.filter((k) => !keys.includes(k.slice(0, -3)));
    expect(stranded).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it**

```bash
npx vitest run --maxWorkers=1 src/app/i18n-plural.test.ts
```

Expected at this point in the plan: FAIL. `singulars.length` is 12 (the 10 pre-existing plus A1's 2), which clears the floor, but seven of the ten pre-existing singulars are `…One`/`…Many` pairs with no bare base — so `stranded` lists `bulkApplyOne`, `bulkEditDoneOne`, `bulkEditTitleOne`, `chatAttachmentSummaryOne`, `diagnosticsUnitErrorOne`, `diagnosticsUnitWarnOne`, `trendsGapOne`. That failure is the input to Task A3, not a defect in the test.

- [ ] **Step 3: Do not implement yet — commit the red test behind A3**

Leave the test failing. It is fixed by A3, which is the next task. Do not commit a red test on its own; A3's commit carries both.

---

## Task A3: Standardise the seven `…One`/`…Many` pairs onto `<base>`/`<base>One`

The repo carries two conventions. Three pairs already use `<base>` + `<base>One` (`taskRowChangesBadge`, `documentsVersionBlocks`, `documentsCardRemoved`); seven use `<base>One` + `<base>Many` with no bare base. `tPlural` requires the first. All seven bare names are free — verified: `grep -cE "^  (diagnosticsUnitError|diagnosticsUnitWarn|trendsGap|bulkEditTitle|bulkApply|bulkEditDone|chatAttachmentSummary):" src/app/i18n.ts` returns 0.

**Files:**
- Modify: `src/app/i18n.ts`, `src/app/i18n.de.ts`
- Modify: `src/app/diagnostics-panel.tsx`, `src/app/bulk-edit-modal.tsx`, `src/app/use-bulk-operations.ts`, `src/app/chat-attachment-summary.ts`, `src/app/trends-panel.tsx`

- [ ] **Step 1: Rename the seven `…Many` keys to their bare base in EN**

Edit `src/app/i18n.ts`, renaming the key only (values untouched):

| from | to |
|---|---|
| `diagnosticsUnitErrorMany` | `diagnosticsUnitError` |
| `diagnosticsUnitWarnMany` | `diagnosticsUnitWarn` |
| `bulkEditTitleMany` | `bulkEditTitle` |
| `bulkApplyMany` | `bulkApply` |
| `bulkEditDoneMany` | `bulkEditDone` |
| `chatAttachmentSummaryMany` | `chatAttachmentSummary` |
| `trendsGapMany` | `trendsGap` |

- [ ] **Step 2: Rename the same seven in DE via a script**

Write to the scratchpad and run:

```js
// rename-de-many.mjs
import { readFileSync, writeFileSync } from "node:fs";
const P = "src/app/i18n.de.ts";
let s = readFileSync(P, "utf8");
const names = ["diagnosticsUnitError", "diagnosticsUnitWarn", "bulkEditTitle",
  "bulkApply", "bulkEditDone", "chatAttachmentSummary", "trendsGap"];
for (const n of names) {
  const from = `  ${n}Many:`;
  const count = s.split(from).length - 1;
  if (count !== 1) throw new Error(`${from} matched ${count} times, expected 1`);
  s = s.replace(from, `  ${n}:`);
}
writeFileSync(P, s);
console.log(`renamed ${names.length} DE keys`);
```

- [ ] **Step 3: Convert the call sites to `tPlural`**

`src/app/diagnostics-panel.tsx` — read the `seg` helper first; it takes `(count, oneKey, manyKey)`. Replace it with a `tPlural` call so the pair is resolved by the helper:

```tsx
      seg(summary.error, "diagnosticsUnitError"),
      seg(summary.warn, "diagnosticsUnitWarn"),
```

and change `seg`'s body to `tPlural(lang, base, n, n)`.

`src/app/bulk-edit-modal.tsx:55` — replace the ternary:

```tsx
        {tPlural(lang, "bulkEditTitle", count, count)}
```

`src/app/bulk-edit-modal.tsx:377`:

```tsx
              {tPlural(lang, "bulkApply", count, count)}
```

`src/app/use-bulk-operations.ts:363`:

```ts
          tPlural(lang, "bulkEditDone", n, n)
```

`src/app/chat-attachment-summary.ts:42` — this one keys on `kids`, and the singular takes the file name rather than the count:

```ts
  return tPlural(lang, "chatAttachmentSummary", kids, fileName, kids);
```

Read the surrounding lines before applying: the existing plural call's argument order is the contract, and `fileName` is `{0}` in both forms.

`src/app/trends-panel.tsx:121`:

```ts
  const gapLabel = gaps.length > 0 ? tPlural(lang, "trendsGap", gaps.length, gaps.length) : undefined;
```

Import `tPlural` in each file alongside the existing `t` import.

- [ ] **Step 3b: Convert the three pairs that ALREADY use the base/One convention**

`taskRowChangesBadge`, `documentsVersionBlocks` and `documentsCardRemoved` need no rename — they are
already `<base>` + `<base>One` — but their call sites still hold hand-written ternaries, and leaving
them is the half-converted state this workstream exists to avoid.

`src/app/task-row.tsx` (around line 296) and `src/app/task-kanban-card.tsx` (around line 93), both
currently `count === 1 ? t(lang, "taskRowChangesBadgeOne") : t(lang, "taskRowChangesBadge", n)`:

```tsx
      {tPlural(lang, "taskRowChangesBadge", changeRefs?.length ?? 0, changeRefs?.length ?? 0)}
```

Read each call site before editing — `task-row.tsx` guards with `?? 0` and `task-kanban-card.tsx`
does not, and that difference is not this task's to reconcile.

`src/app/documents-history-modal.tsx` (around line 357):

```tsx
      {tPlural(lang, "documentsVersionBlocks", blocks, blocks)}
```

`src/app/chat-tool-block.tsx` (around line 285):

```tsx
            {tPlural(lang, "documentsCardRemoved", removed, removed)}
```

★★ `task-row.test.tsx` and `task-kanban-card.test.tsx` already pin the singular and the plural for
this badge, one of them in DE. Those tests are the regression evidence for this conversion and must
stay green WITHOUT being edited — if a test needs changing to accommodate `tPlural`, the conversion
changed rendered output and is wrong.

- [ ] **Step 4: Run the affected suites and typecheck**

```bash
npx vitest run --maxWorkers=1 src/app/i18n-plural.test.ts src/app/diagnostics-panel.test.tsx src/app/bulk-edit-modal.test.tsx src/app/trends-panel.test.tsx src/app/chat-attachment-summary.test.ts src/app/task-row.test.tsx src/app/task-kanban-card.test.tsx src/app/documents-history-modal.test.tsx src/app/chat-tool-block.test.tsx > "$SCRATCH/a3.log" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " "$SCRATCH/a3.log"
```

(`$SCRATCH` is the session scratchpad path, spelled in full — `$TMPDIR` is empty in this shell.)

Expected: `EXIT=0`, and A2's pairing test now passes with `stranded` empty.

```bash
npx tsc --noEmit; echo "EXIT=$?"
```

Expected `EXIT=0`. A missed call site surfaces here as an unknown-key error, which is the point of renaming rather than aliasing.

- [ ] **Step 5: Commit**

```bash
git commit --only src/app/i18n.ts src/app/i18n.de.ts src/app/i18n-plural.test.ts src/app/diagnostics-panel.tsx src/app/bulk-edit-modal.tsx src/app/use-bulk-operations.ts src/app/chat-attachment-summary.ts src/app/trends-panel.tsx src/app/task-row.tsx src/app/task-kanban-card.tsx src/app/documents-history-modal.tsx src/app/chat-tool-block.tsx -m "refactor(i18n): put the seven One/Many pairs on the base/One convention tPlural reads"
```

---

## Task A4: Convert the documents and notifications cluster (6 keys)

**Files:**
- Modify: `src/app/i18n.ts`, `src/app/i18n.de.ts`
- Modify: `src/app/use-load-truncation.ts`, `src/app/notifications.tsx`

- [ ] **Step 1: Add the six EN singulars**

In `src/app/i18n.ts`, beside each existing key:

```ts
  documentsTruncatedWarningOne: "1 document entry could not be opened - this project is over the limit. Saving is paused so nothing is overwritten.",
  documentsTruncatedBlocksWarningOne: "1 block in stored documents could not be opened. Saving is paused so nothing is overwritten.",
  documentsTruncatedEntriesCountOne: "1 document entry could not be opened.",
  documentsTruncatedBlocksCountOne: "1 block in stored documents could not be opened.",
  documentsUnreadableWarningOne: "1 kind of saved data could not be read. Saving is paused so nothing is overwritten.",
  documentsUnreadableCountOne: "1 kind of saved data could not be read.",
```

- [ ] **Step 2: Add the six DE singulars via a script**

```js
// patch-de-a4.mjs
import { readFileSync, writeFileSync } from "node:fs";
const P = "src/app/i18n.de.ts";
let s = readFileSync(P, "utf8");
const pairs = [
  ["documentsTruncatedWarning", '"1 Dokumenteintrag konnte nicht geöffnet werden - dieses Projekt überschreitet das Limit. Das Speichern ist pausiert, damit nichts überschrieben wird."'],
  ["documentsTruncatedBlocksWarning", '"1 Block in gespeicherten Dokumenten konnte nicht geöffnet werden. Das Speichern ist pausiert, damit nichts überschrieben wird."'],
  ["documentsTruncatedEntriesCount", '"1 Dokumenteintrag konnte nicht geöffnet werden."'],
  ["documentsTruncatedBlocksCount", '"1 Block in gespeicherten Dokumenten konnte nicht geöffnet werden."'],
  ["documentsUnreadableWarning", '"1 Art gespeicherter Daten konnte nicht gelesen werden. Das Speichern ist pausiert, damit nichts überschrieben wird."'],
  ["documentsUnreadableCount", '"1 Art gespeicherter Daten konnte nicht gelesen werden."'],
];
for (const [base, value] of pairs) {
  const anchor = `  ${base}:`;
  const i = s.indexOf(anchor);
  if (i === -1) throw new Error(`missing ${base}`);
  // The entry may wrap across lines — find the line that closes it.
  const end = s.indexOf('",\r\n', i);
  if (end === -1) throw new Error(`unterminated ${base}`);
  const cut = end + 4;
  s = s.slice(0, cut) + `  ${base}One: ${value},\r\n` + s.slice(cut);
}
writeFileSync(P, s);
console.log(`patched ${pairs.length} DE singulars`);
```

- [ ] **Step 3: Convert the call sites**

In `src/app/use-load-truncation.ts` and `src/app/notifications.tsx`, replace each `t(lang, "<key>", n)` with `tPlural(lang, "<key>", n, n)`. Find them with:

```bash
grep -n "documentsTruncated\|documentsUnreadable" src/app/use-load-truncation.ts src/app/notifications.tsx
```

Add `tPlural` to the existing `t` import in both files.

- [ ] **Step 4: Verify**

```bash
npx vitest run --maxWorkers=1 src/app/use-load-truncation.test.ts src/app/notifications.test.tsx src/app/i18n-encoding.test.ts > "$SCRATCH/a4.log" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " "$SCRATCH/a4.log"
npx tsc --noEmit; echo "EXIT=$?"
```

Expected both `EXIT=0`.

- [ ] **Step 5: Commit**

```bash
git commit --only src/app/i18n.ts src/app/i18n.de.ts src/app/use-load-truncation.ts src/app/notifications.tsx -m "fix(i18n): make the six document-truncation counts agree in EN and DE"
```

---

## Task A5: Convert the RACI, allocation and activity cluster (7 keys)

**Files:**
- Modify: `src/app/i18n.ts`, `src/app/i18n.de.ts`
- Modify: `src/app/raci-suggest-modal.tsx`, `src/app/use-alloc-plan.tsx`, `src/app/activity-log.ts`, `src/app/settings-sections/scheduled-jobs-section.tsx`

- [ ] **Step 1: Add the seven EN singulars**

```ts
  raciSuggestSkippedOne: "1 proposed assignment was refused because it did not match this project.",
  raciSuggestSkippedAccountableOne: "1 proposed assignment was refused because that milestone already has an Accountable.",
  raciSuggestSkippedInvalidRoleOne: "1 proposed assignment was refused because the role letter was not one of R, A, C or I.",
  allocPlanAppliedOne: "Applied 1 allocation change.",
  activityAiAllocationPlanOne: "AI planned 1 allocation cell",
  activityAiRaciSuggestOne: "Applied 1 AI-proposed RACI assignment",
  scheduledJobActionsNOne: "1 suggestion",
```

Note `raciSuggestSkippedOne` also changes "they did not match" to "it did not match" — the pronoun agrees too, which is the whole reason each form is authored rather than derived.

- [ ] **Step 2: Add the seven DE singulars**

Reuse the `patch-de-a4.mjs` shape with these pairs:

```js
const pairs = [
  ["raciSuggestSkipped", '"1 vorgeschlagene Zuordnung wurde abgelehnt, da sie nicht zu diesem Projekt passt."'],
  ["raciSuggestSkippedAccountable", '"1 vorgeschlagene Zuordnung wurde abgelehnt, da dieser Meilenstein bereits einen Rechenschaftspflichtigen hat."'],
  ["raciSuggestSkippedInvalidRole", '"1 vorgeschlagene Zuordnung wurde abgelehnt, da der Rollenbuchstabe nicht R, A, C oder I war."'],
  ["allocPlanApplied", '"1 Planungsänderung angewendet."'],
  ["activityAiAllocationPlan", '"KI hat 1 Planungszelle geplant"'],
  ["activityAiRaciSuggest", '"1 von der KI vorgeschlagene RACI-Zuordnung übernommen"'],
  ["scheduledJobActionsN", '"1 Vorschlag"'],
];
```

★ `raciSuggestSkippedAccountable` and `raciSuggestSkippedInvalidRole` are WRAPPED entries in both dicts — their value starts on the line after the key. The `indexOf('",\r\n', i)` scan in the script handles that correctly because it searches forward from the key for the closing quote-comma; do not "simplify" it to a single-line regex.

- [ ] **Step 3: Convert the call sites**

```bash
grep -n "raciSuggestSkipped\|allocPlanApplied\|activityAiAllocationPlan\|activityAiRaciSuggest\|scheduledJobActionsN" src/app/raci-suggest-modal.tsx src/app/use-alloc-plan.tsx src/app/activity-log.ts src/app/settings-sections/scheduled-jobs-section.tsx
```

Replace each `t(lang, "<key>", n)` with `tPlural(lang, "<key>", n, n)` and add the import.

★ `activity-log.ts` writes strings into stored log entries. Read its surrounding code before editing: if the string is composed at WRITE time it is frozen into stored data at the language current then, which is pre-existing behaviour this task must not change.

- [ ] **Step 4: Verify**

```bash
npx vitest run --maxWorkers=1 src/app/raci-suggest-modal.test.tsx src/app/use-alloc-plan.test.tsx src/app/activity-log.test.ts src/app/i18n-encoding.test.ts > "$SCRATCH/a5.log" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " "$SCRATCH/a5.log"
npx tsc --noEmit; echo "EXIT=$?"
```

- [ ] **Step 5: Commit**

```bash
git commit --only src/app/i18n.ts src/app/i18n.de.ts src/app/raci-suggest-modal.tsx src/app/use-alloc-plan.tsx src/app/activity-log.ts src/app/settings-sections/scheduled-jobs-section.tsx -m "fix(i18n): make the RACI, allocation and activity counts agree in EN and DE"
```

---

## Task A6: Convert the next-actions and insights cluster (6 keys)

**Files:**
- Modify: `src/app/i18n.ts`, `src/app/i18n.de.ts`
- Modify: `src/app/action-reasons.tsx`, `src/app/next-actions/providers/workload.ts`, `src/app/next-actions/providers/raid.ts`, `src/app/next-actions/providers/change-pending.ts`, `src/app/next-actions/providers/committee-info.ts`, `src/app/insights/insight-text.ts`

- [ ] **Step 1: Add the six EN singulars**

```ts
  actionWorkloadWhyOverloadOne: "1 overdue item assigned",
  actionMoreReasonsOne: "+1 more reason",
  actionRaidWhyReviewStaleOne: "Not reviewed in 1 day",
  actionChangeAggTitleOne: "1 change awaiting decision",
  actionCommitteeInfoWhyOne: "Due {0} — {1} (1 day)",
  insightOverdueTrendDetailOne: "1 task overdue — up {1} since your last visit ({2} before).",
  insightStalledWorkDetailOne: "1 active task is stale, blocked, or waiting on a dependency.",
```

★★ `actionCommitteeInfoWhy` carries its count at `{2}`, not `{0}` — the singular therefore keeps `{0}` and `{1}` and hardcodes only the day count. `insightOverdueTrendDetail` carries its count at `{0}` but has two further numeric slots that are NOT counts (a delta and a previous value), so they stay as placeholders in both forms.

- [ ] **Step 2: Add the six DE singulars**

```js
const pairs = [
  ["actionWorkloadWhyOverload", '"1 überfällige Aufgabe zugewiesen"'],
  ["actionMoreReasons", '"+1 weiterer Grund"'],
  ["actionRaidWhyReviewStale", '"Seit 1 Tag nicht überprüft"'],
  ["actionChangeAggTitle", '"1 Änderung wartet auf Entscheidung"'],
  ["actionCommitteeInfoWhy", '"Fällig {0} — {1} (1 Tag)"'],
  ["insightOverdueTrendDetail", '"1 Aufgabe überfällig — {1} mehr seit Ihrem letzten Besuch ({2} zuvor)."'],
  ["insightStalledWorkDetail", '"1 aktive Aufgabe ist veraltet, blockiert oder wartet auf eine Abhängigkeit."'],
];
```

- [ ] **Step 3: Convert the call sites**

For `actionCommitteeInfoWhy` the count is the third argument, so the call becomes:

```ts
  tPlural(lang, "actionCommitteeInfoWhy", days, dueLabel, name, days)
```

— `count` selects the form, then `dueLabel`/`name`/`days` fill `{0}`/`{1}`/`{2}` exactly as the existing `t()` call does. Read the existing call before editing and preserve its argument order verbatim.

Every other key in this task takes `tPlural(lang, "<key>", n, n)`.

- [ ] **Step 4: Verify**

```bash
npx vitest run --maxWorkers=1 src/app/action-reasons.test.tsx src/app/next-actions src/app/insights src/app/i18n-encoding.test.ts > "$SCRATCH/a6.log" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " "$SCRATCH/a6.log"
npx tsc --noEmit; echo "EXIT=$?"
```

- [ ] **Step 5: Commit**

```bash
git commit --only src/app/i18n.ts src/app/i18n.de.ts src/app/action-reasons.tsx src/app/next-actions src/app/insights -m "fix(i18n): make the next-actions and insights counts agree in EN and DE"
```

---

## Task A7: Convert the remaining keys, and split the two-count greeting

**Files:**
- Modify: `src/app/i18n.ts`, `src/app/i18n.de.ts`
- Modify: `src/app/timelog-apply-confirm.tsx`, `src/app/activity-log-panel.tsx`, `src/app/task-manager.tsx`, `src/app/use-storage-file-ops.ts`, `src/app/trends-panel.tsx`, `src/app/use-entity-calendar-pull.ts`, `src/app/use-action-notifications.ts`, `src/app/timelog-settings.tsx`, `src/app/chat-attachment-summary.ts`, `src/app/dashboard-delta-strip.tsx`

- [ ] **Step 1: Add the EN singulars**

```ts
  timelogApplyConfirmOne: "Apply 1 bucket change to budget actual hours?",
  outlookCalImportedNOne: "Imported 1 absence",
  storageConvertConfirmOne: "Convert your current workspace (1 task) to {1} and write it to this storage, overwriting any data already there?",
  storageTursoLeaveWarnOne: "Snapshot trend recording only works on the Turso backend. Switching to {1} stops recording (your one item is still converted). Your recorded snapshots are kept in Turso and recording resumes when you switch back. Continue?",
  snapshotDeleteSelectedConfirmOne: "Delete 1 snapshot?",
  notifySummaryTitleOne: "1 new urgent action",
  calendarPullConflictsPendingOne: "1 calendar conflict — open Pull to resolve",
  chatAttachmentSummarySkippedOne: "{0} — 1 attachment, {2} skipped",
```

(`activityEntriesLoggedOne` and `timelogTestOkOne` already landed in A1.)

Then the greeting split. **Delete** `dashboardGreetingSummary` from `src/app/i18n.ts` and add four keys:

```ts
  dashboardGreetingNeedsYou: "{0} items need you",
  dashboardGreetingNeedsYouOne: "1 item needs you",
  dashboardGreetingMilestonesSoon: "{0} milestones soon",
  dashboardGreetingMilestonesSoonOne: "1 milestone soon",
```

★★★ **`dashboardGreetingSummary` is the one key `tPlural` cannot serve, and splitting it is the whole reason.** Its value is `"{0} items need you · {1} milestones soon"` — TWO independent counts in one string, so a single plural selection cannot make both halves agree. Verified 2026-09-07: it has exactly one call site (`dashboard-delta-strip.tsx`) and no test references it, so the split is safe. The `·` separator moves into the JSX.

- [ ] **Step 2: Add the DE strings**

```js
const pairs = [
  ["timelogApplyConfirm", '"1 Bucket-Änderung auf die Ist-Stunden des Budgets anwenden?"'],
  ["outlookCalImportedN", '"1 Abwesenheit importiert"'],
  ["storageConvertConfirm", '"Aktuellen Workspace (1 Aufgabe) nach {1} konvertieren und in diesen Speicher schreiben? Vorhandene Daten dort werden überschrieben."'],
  ["storageTursoLeaveWarn", '"Die Snapshot-Trendaufzeichnung funktioniert nur mit dem Turso-Backend. Der Wechsel zu {1} stoppt die Aufzeichnung (Ihr Eintrag wird weiterhin konvertiert). Ihre aufgezeichneten Snapshots bleiben in Turso erhalten und die Aufzeichnung wird beim Zurückwechseln fortgesetzt. Fortfahren?"'],
  ["snapshotDeleteSelectedConfirm", '"1 Snapshot löschen?"'],
  ["notifySummaryTitle", '"1 neue dringende Aktion"'],
  ["calendarPullConflictsPending", '"1 Kalenderkonflikt — im Pull auflösen"'],
  ["chatAttachmentSummarySkipped", '"{0} — 1 Anhang, {2} übersprungen"'],
];
```

Then a separate script step for the greeting split — delete `dashboardGreetingSummary` and insert the four:

```js
// patch-de-greeting.mjs
import { readFileSync, writeFileSync } from "node:fs";
const P = "src/app/i18n.de.ts";
let s = readFileSync(P, "utf8");
const from = '  dashboardGreetingSummary: "{0} Einträge brauchen dich · {1} Meilensteine bald",\r\n';
if (s.split(from).length - 1 !== 1) throw new Error("greeting anchor did not match exactly once");
s = s.replace(from,
  '  dashboardGreetingNeedsYou: "{0} Einträge brauchen dich",\r\n' +
  '  dashboardGreetingNeedsYouOne: "1 Eintrag braucht dich",\r\n' +
  '  dashboardGreetingMilestonesSoon: "{0} Meilensteine bald",\r\n' +
  '  dashboardGreetingMilestonesSoonOne: "1 Meilenstein bald",\r\n');
writeFileSync(P, s);
console.log("greeting split");
```

- [ ] **Step 3: Convert the call sites**

All except the greeting take `tPlural(lang, "<key>", n, n)`, with two exceptions read from their existing calls:

- `storageConvertConfirm` / `storageTursoLeaveWarn` — `tPlural(lang, "<key>", n, n, backendLabel)`, preserving the existing second argument.
- `chatAttachmentSummarySkipped` — the count is `{1}`, so: `tPlural(lang, "chatAttachmentSummarySkipped", attachments, fileName, attachments, skipped)`.

The greeting, in `src/app/dashboard-delta-strip.tsx`, replacing the single `t(...)` on line 66:

```tsx
            {tPlural(lang, "dashboardGreetingNeedsYou", greeting.summary.needsYou, greeting.summary.needsYou)}
            {" · "}
            {tPlural(lang, "dashboardGreetingMilestonesSoon", greeting.summary.milestonesSoon, greeting.summary.milestonesSoon)}
```

★ The enclosing `(needsYou > 0 || milestonesSoon > 0)` guard is left exactly as it is. Rendering a zero half is pre-existing behaviour; changing it here would mix a display decision into a plural fix and would need its own reasoning.

- [ ] **Step 4: Verify**

```bash
npx vitest run --maxWorkers=1 src/app/dashboard-delta-strip.test.tsx src/app/timelog-apply-confirm.test.tsx src/app/trends-panel.test.tsx src/app/use-storage-file-ops.test.ts src/app/i18n-encoding.test.ts > "$SCRATCH/a7.log" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " "$SCRATCH/a7.log"
npx tsc --noEmit; echo "EXIT=$?"
```

Expected `EXIT=0` from both. A missed `dashboardGreetingSummary` reference surfaces from tsc as an unknown key, which is why the key is deleted rather than left in place.

- [ ] **Step 5: Commit**

```bash
git commit --only src/app/i18n.ts src/app/i18n.de.ts src/app/timelog-apply-confirm.tsx src/app/activity-log-panel.tsx src/app/task-manager.tsx src/app/use-storage-file-ops.ts src/app/trends-panel.tsx src/app/use-entity-calendar-pull.ts src/app/use-action-notifications.ts src/app/timelog-settings.tsx src/app/chat-attachment-summary.ts src/app/dashboard-delta-strip.tsx -m "fix(i18n): agree the remaining counts, and split the two-count dashboard greeting"
```

---

## Task A8: Rewrite the house-rule comment and narrow §415

**Files:**
- Modify: `src/app/i18n.ts` (the comment above `taskRowChangesBadgeOne`)
- Modify: `docs/open-followups.md` (§415)

- [ ] **Step 1: Replace the stale comment**

The current comment says the house idiom is a call-site ternary "NOT a pluralize() helper", and gives a stale count of nine. Replace it with:

```ts
  // ★★ Singular sibling, resolved by `tPlural` — see its docblock. Both forms
  // are independently authored complete strings, never a stem plus a suffix,
  // because German breaks on noun AND adjective AND verb agreement at once.
  // That rule is unchanged; what moved in 0.29x is only where the count test
  // lives. An earlier revision here mandated a `count === 1 ?` ternary at each
  // call site and forbade a helper outright — it was written before there were
  // 41 such pairs, and quoted a key count that was already stale by one.
```

- [ ] **Step 2: Narrow §415 with the retained membership list**

In `docs/open-followups.md`, §415: keep the heading OPEN, update the Status line to today with the commands actually run, and add a paragraph recording that the 31-key TIER 1 list has now been **converted and retained** — the first time either pass's membership survived. State explicitly that the 45-vs-31 gap is NOT closed, because this work reused the fresh pass's methodology and a reconciliation needs an independent one.

Add the three keys this work found that the table's own framing did not anticipate: `actionCommitteeInfoWhy` and `chatAttachmentSummarySkipped` carry their count outside `{0}`, and `dashboardGreetingSummary` carried two counts and had to be split into two keys.

★ Do NOT quote a total for converted keys inside §415 — the entry sits in the population it counts. Quote the membership and the reproduce.

- [ ] **Step 3: Verify the register gates still pass**

```bash
npm run followups:status:check > "$SCRATCH/a8-status.log" 2>&1; echo "EXIT=$?"
npm run docs:claims:check > "$SCRATCH/a8-claims.log" 2>&1; echo "EXIT=$?"
```

Expected `EXIT=0` from both. ★ `docs:claims:check` is a RATCHET: adding any new `path:LINE` citation fails it. Cite symbols and greps in §415, never line numbers.

- [ ] **Step 4: Commit**

```bash
git commit --only src/app/i18n.ts docs/open-followups.md -m "docs(i18n): state the plural rule that now exists, and retain 415's converted key list"
```

---

# Workstream B — The comma-email round trip (§422)

## Task B1: Probe the actual trigger

§422 claims "applying ANY unrelated edit" destroys a comma-bearing address. That is unverified:
`use-inline-entity-edit.ts` builds its patch from `plan.updates` — the fields the **model proposed**
— not from every `diffField`. Establish which it is before writing any fix.

**Files:**
- Create: `src/app/inline-ai-edit/emails-roundtrip.probe.test.ts`

★★★ **A VITEST PROBE, NOT A PLAYWRIGHT ONE, AND THE CHOICE IS THE POINT.** The previous probe for
this entry was a throwaway Playwright spec that was deleted, so its findings became a dated
observation nothing can re-run — which is exactly why §422 could not be acted on. The question here
is about which fields reach the patch, which is decided in pure code: `describeEntityCalls` builds
`plan.updates` and the hook maps it. A unit probe answers it deterministically, is re-runnable
forever, and needs no browser.

- [ ] **Step 1: Write the probe**

Create `src/app/inline-ai-edit/emails-roundtrip.probe.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { INLINE_DESCRIPTORS } from "./entity-descriptor";

// ★ RETAINED DELIBERATELY — this is 422's reproduce, not a scratch script.
describe("422: does a comma-bearing address survive an inline edit", () => {
  const d = INLINE_DESCRIPTORS.resource;
  const row = { id: 1, firstName: "Ada", lastName: "Lovelace", emails: ["a,b@x.com"] };

  it("projects the stored list as a joined string the writer will re-split", () => {
    const projected = d.fieldSanitizers.emails(row.emails, row);
    expect(projected).toBe("a,b@x.com");
  });

  // THE QUESTION. If `plan.updates` contains `emails` when the model's input
  // names only another field, 422's trigger claim holds and B2 is the fix. If
  // it does not, the claim is refuted and B3 is the outcome.
  it("says whether an edit naming only another field puts emails in the plan", () => {
    // Build the plan for an input that mentions `title` and nothing else, using
    // the same entry point the hook uses. Read `describeEntityCalls`' signature
    // in `plan.ts` and its existing tests in `plan.sanitizer-parity.test.ts`
    // for the exact call shape and fixture conventions.
    // Then assert the observed answer explicitly, e.g.:
    //   expect(plan.updates.map((u) => u.field)).not.toContain("emails");
    // Whichever way it comes out, PIN IT — this test is 422's standing record.
  });
});
```

★ The second test's body is completed against `plan.sanitizer-parity.test.ts`, whose fixture and
call conventions are established and must be followed rather than reinvented. The **assertion** is
the deliverable and it is fixed either way: the field is in the plan, or it is not, and the test says
which.

- [ ] **Step 2: Run the probe**

```bash
npx vitest run --maxWorkers=1 src/app/inline-ai-edit/emails-roundtrip.probe.test.ts > "$SCRATCH/b1.log" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " "$SCRATCH/b1.log"
```

- [ ] **Step 3: Record the result in §422**

Update §422's Status line with today's date, the command above, and the answer. Name the test file so
the next reader can re-run it — the entry's current Status names a probe that no longer exists.

- [ ] **Step 4: Commit**

```bash
git commit --only src/app/inline-ai-edit/emails-roundtrip.probe.test.ts docs/open-followups.md -m "test(inline-edit): pin whether an unrelated edit puts emails in the plan"
```

---

## Task B2: The no-op guard — ONLY IF B1 confirmed the rewrite

**Files:**
- Modify: `src/app/use-inline-entity-edit.ts`
- Test: `src/app/use-inline-entity-edit.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
it("drops an emails field whose proposed value is byte-identical to what was projected", async () => {
  // A resource whose stored emails hold ONE address containing a comma. The
  // model's patch proposes the same joined string the descriptor projected —
  // i.e. it proposes no change at all — so the field must not reach the writer,
  // where sanitizeEmailList's [;,] split would turn one address into two.
  // Assert on the tool input the dispatcher receives: `emails` is absent.
});
```

Complete it against the existing tests in that file; the fixture shape and dispatcher stub are established there.

- [ ] **Step 2: Run it and confirm it fails**

```bash
npx vitest run --maxWorkers=1 src/app/use-inline-entity-edit.test.tsx
```

Expected: FAIL — `emails` is present in the patch.

- [ ] **Step 3: Implement the guard**

In `use-inline-entity-edit.ts`, in the loop that builds `patch` from `plan.updates`:

```ts
        for (const diff of plan.updates) {
          // ★★★ A field whose proposed value is byte-identical to the value the
          // descriptor PROJECTED is a no-op, and sending it is not free: for
          // `emails` the projection is a `", "` join and the writer re-splits
          // on `[;,]`, so a stored address containing a comma is silently torn
          // into two by a patch that changes nothing (422). Dropping the field
          // is the fix; parsing it more cleverly is not, because the delimited
          // format is the writer's own and a second parser is the restatement
          // `fieldSanitizers` forbids.
          if ((diff.raw ?? diff.after) === diff.before) continue;
          patch[diff.field] = coerce(d, diff.field, diff.raw ?? diff.after);
        }
```

★ Read `FieldDiff`'s definition before applying: confirm `before` holds the projected string and not a pre-projection value. If it does not, the comparison must be against whatever the descriptor projected, and the test above is what proves you picked the right one.

- [ ] **Step 4: Run the test and the sibling suites**

```bash
npx vitest run --maxWorkers=1 src/app/use-inline-entity-edit.test.tsx src/app/inline-ai-edit > "$SCRATCH/b2.log" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " "$SCRATCH/b2.log"
npx tsc --noEmit; echo "EXIT=$?"
```

★ This guard changes behaviour for EVERY field, not only `emails` — a no-op patch on any field is now dropped. That is the correct general rule, but the sibling suites are what prove no test depended on a no-op field arriving at the writer.

- [ ] **Step 5: Re-run the B1 probe and update its pinned assertion**

```bash
npx vitest run --maxWorkers=1 src/app/inline-ai-edit/emails-roundtrip.probe.test.ts > "$SCRATCH/b2-probe.log" 2>&1; echo "EXIT=$?"
```

★ The probe pins the PRE-FIX behaviour, so it goes RED here. That red is the fix working. Update
its assertion to the post-fix answer and say in the comment which commit changed it — do not delete
the probe.

- [ ] **Step 6: Close §422 and commit**

Record in §422 what was fixed and what was NOT: a comma inside an address the user **genuinely edits** stays unrepresentable, because the delimited transport is the writer's own storage format. State that closing that residual needs either format validation at `sanitizeEmail`'s ~18 call sites (including Jira and Outlook ingest, which today accept anything) or a non-delimited transport — both their own slice.

```bash
git commit --only src/app/use-inline-entity-edit.ts src/app/use-inline-entity-edit.test.tsx docs/open-followups.md -m "fix(inline-edit): drop a no-op field from the patch so a comma-bearing address survives"
```

---

## Task B3: Correct §422 — ONLY IF B1 refuted the rewrite

If the probe shows no reachable gesture rewrites the address, the honest outcome is a register correction, not code.

- [ ] **Step 1: Rewrite §422's framing**

Keep the entry, retitle it to what is actually true (a comma-bearing address is unrepresentable in the delimited transport when the field IS edited), and add a ★★★ paragraph recording that its original "applying ANY unrelated edit" trigger was **measured and refuted**, with the probe's command. Preserve the original claim verbatim, as the register does elsewhere — a falsified claim is the record of what was believed.

- [ ] **Step 2: Commit**

```bash
git commit --only docs/open-followups.md -m "docs(register): 422's trigger claim was refuted by a probe, and the entry says so"
```

---

# Workstream C — Picker consolidation

## Task C1: Extract the shared entity-combobox core

**Read first, before writing anything:** `src/app/single-entity-picker.tsx` lines 1–40 carry a four-point rationale for rejecting the EXISTING `src/app/combobox-shared.tsx` (`useCombobox` / `ComboboxChevron` / `ComboboxOptions`, used by ComboInput, GlobalSearchBox and LabelsInput). That rationale is correct and this task does not overturn it: the two ENTITY pickers need derived `open`, a `scrollIntoView` the shared hook does not schedule, and `{value, code, label}` triples rather than `string[]`. The new module is a SECOND core for a shape the first cannot serve.

**Files:**
- Create: `src/app/entity-combobox.ts`
- Test: `src/app/entity-combobox.test.tsx` (create)

- [ ] **Step 1: Write the failing test**

```tsx
import { renderHook, act } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useEntityCombobox } from "./entity-combobox";

const OPTS = [
  { value: "a", code: "Task", label: "Alpha" },
  { value: "b", code: "Task", label: "Beta" },
];

describe("useEntityCombobox", () => {
  it("wraps the highlight at both ends", () => {
    const { result } = renderHook(() => useEntityCombobox({ query: "a", options: OPTS, identity: (o) => o.value }));
    act(() => result.current.move(1));
    expect(result.current.active).toBe(0);
    act(() => result.current.move(-1));
    expect(result.current.active).toBe(1);
  });

  it("disarms a highlight whose option changed identity under a standing query", () => {
    const { result, rerender } = renderHook(
      ({ options }) => useEntityCombobox({ query: "a", options, identity: (o: { value: string }) => o.value }),
      { initialProps: { options: OPTS } },
    );
    act(() => result.current.move(1));
    expect(result.current.active).toBe(0);
    // Same index, DIFFERENT option — the range clamp cannot see this.
    rerender({ options: [{ value: "z", code: "Task", label: "Zeta" }, ...OPTS] });
    expect(result.current.active).toBe(-1);
  });

  it("resets on a query change", () => {
    const { result, rerender } = renderHook(
      ({ query }) => useEntityCombobox({ query, options: OPTS, identity: (o) => o.value }),
      { initialProps: { query: "a" } },
    );
    act(() => result.current.move(1));
    rerender({ query: "ab" });
    expect(result.current.active).toBe(-1);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
npx vitest run --maxWorkers=1 src/app/entity-combobox.test.tsx
```

Expected: FAIL — cannot resolve `./entity-combobox`.

- [ ] **Step 3: Implement the hook**

Create `src/app/entity-combobox.ts` by MOVING the mechanics out of `single-entity-picker.tsx` — the `listId`/`listRef`/`highlight`/`armedValue`/`dismissed`/`prevQuery` state, the render-time reconcile, the three-condition `active` derivation, `move()` and `onKeyDown`. Carry the existing comment blocks with them; they are the canonical statement of why each piece is shaped as it is, and this extraction is the first time they have had one home.

The hook takes `{ query, options, identity, onCommit }` where `identity` is how a caller keys an option (`(o) => o.value` for SingleEntityPicker, `entryKey` for EntityLinkPicker) and `onCommit` is called on Enter with the active option.

Its docblock MUST record why it is not `combobox-shared`, restating the four points from `single-entity-picker.tsx`'s header, so a future reader looking at two combobox hooks does not "consolidate" them.

- [ ] **Step 4: Run the test**

```bash
npx vitest run --maxWorkers=1 src/app/entity-combobox.test.tsx
npx tsc --noEmit; echo "EXIT=$?"
```

Expected: 3 passed, `EXIT=0`.

- [ ] **Step 5: Commit**

```bash
git commit --only src/app/entity-combobox.ts src/app/entity-combobox.test.tsx -m "refactor(pickers): extract the entity combobox core the two entity pickers share"
```

---

## Task C2: Wire `SingleEntityPicker` to the hook

**Files:**
- Modify: `src/app/single-entity-picker.tsx`
- Test: `src/app/single-entity-picker.test.tsx`

- [ ] **Step 1: Add the wiring assertion**

A seam test cannot see a break above it: the hook can be correct while the picker never calls it. Add to `single-entity-picker.test.tsx`:

```tsx
it("routes keyboard navigation through the shared hook, not a local copy", async () => {
  // Drive ArrowDown twice and Enter, and assert the SECOND option commits.
  // This is red both if the hook is broken and if the picker stopped calling
  // it, which is the property a hook-only test cannot have.
});
```

- [ ] **Step 2: Replace the local mechanics with the hook call**

Delete the moved state and functions from `single-entity-picker.tsx` and call `useEntityCombobox`. Keep the commit call (`onSelect(options[active].value)`) at this call site — it is not parameterised into the hook.

- [ ] **Step 3: Run the suite**

```bash
npx vitest run --maxWorkers=1 src/app/single-entity-picker.test.tsx src/app/entity-combobox.test.tsx > "$SCRATCH/c2.log" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " "$SCRATCH/c2.log"
```

- [ ] **Step 4: Mutation-prove the wiring test**

Comment out the `useEntityCombobox` call and substitute a local `const active = -1`. Re-run: the wiring test MUST go red. Record the mutant's token span in the commit message. Then revert with an inverse anchored edit and assert `git diff --stat` on that file is empty.

- [ ] **Step 5: Commit**

```bash
git commit --only src/app/single-entity-picker.tsx src/app/single-entity-picker.test.tsx -m "refactor(pickers): route SingleEntityPicker through the shared entity combobox"
```

---

## Task C3: Wire `EntityLinkPicker` to the hook

**Files:**
- Modify: `src/app/entity-link-picker.tsx`
- Test: `src/app/entity-link-picker.test.tsx`

- [ ] **Step 1: Add the same wiring assertion**

Mirror C2's test in `entity-link-picker.test.tsx`, driving ArrowDown twice and Enter and asserting the second option is ADDED (this picker's commit is `onAdd(entry)`, taking the whole entry, not a value string).

- [ ] **Step 2: Replace the local mechanics, passing `entryKey` as the identity**

```tsx
  const combobox = useEntityCombobox({ query, options, identity: entryKey, onCommit: onAdd });
```

Delete the duplicated comment blocks from this file — they now live in the hook. Leave this file's own commit call and React list key alone.

- [ ] **Step 3: Run the suite and mutation-prove**

```bash
npx vitest run --maxWorkers=1 src/app/entity-link-picker.test.tsx src/app/entity-combobox.test.tsx > "$SCRATCH/c3.log" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " "$SCRATCH/c3.log"
```

Then mutate the `identity: entryKey` to `identity: (o) => o.value` and confirm a test goes red — that is the assertion proving the two pickers really do differ in identity and that the difference is threaded, not accidental. Revert and prove `git diff --stat` empty.

- [ ] **Step 4: Commit**

```bash
git commit --only src/app/entity-link-picker.tsx src/app/entity-link-picker.test.tsx -m "refactor(pickers): route EntityLinkPicker through the shared entity combobox"
```

---

## Task C4: Extract the shared search box

The `ClearableSearchInput` + `Input` block diffs clean at exit 0 between the two files today, so this extraction has no behaviour question attached.

**Files:**
- Create: `src/app/entity-combobox-search.tsx`
- Modify: `src/app/single-entity-picker.tsx`, `src/app/entity-link-picker.tsx`

- [ ] **Step 1: Confirm the blocks are still identical**

```bash
strip2() { sed -n '/<div className="relative">/,/^        {open && (/p' "$1" | grep -v '^[[:space:]]*//' | grep -v '^[[:space:]]*{\?/\*' | grep -v '^[[:space:]]*\*' | sed 's/^[[:space:]]*//;/^$/d'; }
diff <(strip2 src/app/single-entity-picker.tsx) <(strip2 src/app/entity-link-picker.tsx); echo "EXIT=$?"
```

Expected `EXIT=0`, no output. If it differs after C2/C3, reconcile before extracting — do not extract a block that has drifted.

- [ ] **Step 2: Create the component and wire both callers**

Move the block verbatim into `entity-combobox-search.tsx`, taking the query, the change handler, the listbox id and the keydown handler as props.

- [ ] **Step 3: Run both suites**

```bash
npx vitest run --maxWorkers=1 src/app/single-entity-picker.test.tsx src/app/entity-link-picker.test.tsx > "$SCRATCH/c4.log" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " "$SCRATCH/c4.log"
npx eslint --max-warnings=0 src/app/entity-combobox-search.tsx src/app/single-entity-picker.tsx src/app/entity-link-picker.tsx; echo "EXIT=$?"
```

- [ ] **Step 4: Commit**

```bash
git commit --only src/app/entity-combobox-search.tsx src/app/single-entity-picker.tsx src/app/entity-link-picker.tsx -m "refactor(pickers): share the entity combobox search box"
```

---

## Task C5: Test the three stated-but-untested rationales (§411)

Three mechanisms in these pickers carry a written justification and no test. A rationale with no test is what §411 records, and each of these is a real regression risk.

**Files:**
- Test: `src/app/entity-combobox.test.tsx`

- [ ] **Step 1: Write the three tests**

1. **Render-time reconcile, not an effect.** Assert that a query change resets the highlight in the SAME render pass — `react-hooks/set-state-in-effect` is fatal in this repo, so an effect-based implementation would not merely be slower, it would not lint.
2. **`next` computed outside the setState updater.** Assert `move()` schedules exactly ONE `requestAnimationFrame` per call under `StrictMode`. Read `src/app/strictmode.meta.test.tsx` before writing this — the wrapper shape rule is exact, and the obvious composition makes a StrictMode test vacuous-but-green.
3. **The `rAF` scroll-into-view.** Assert `scrollIntoView` is called with `{ block: "nearest" }` after a `move()`, with the rAF flushed.

- [ ] **Step 2: Mutation-prove each**

For each of the three, apply the minimal mutant that defeats the mechanism — move the reconcile into a `useEffect`, hoist `next` into an updater, delete the `rAF` — and record `N failed / M passed` for each. The sum must equal the file's runtime test count.

★ A guard test that survives a one-token revert of the line it guards proves nothing. Record the mutant's token span alongside the counts.

- [ ] **Step 3: Update §411 and commit**

```bash
git commit --only src/app/entity-combobox.test.tsx docs/open-followups.md -m "test(pickers): pin the three picker mechanisms 411 records as stated-but-untested"
```

---

## Task C6: Give `TaskLinkPicker` a direct suite (§412)

`src/app/task-link-picker.tsx` is 74 lines with real but entirely indirect coverage.

**Files:**
- Test: `src/app/task-link-picker.test.tsx` (create)

- [ ] **Step 1: Write the suite**

Cover: it renders the options its caller hands it; selecting commits the expected value; and its per-row control names are row-unique. Use the shared `src/test/row-unique-names.ts` for the last one — never a hand-rolled enumeration — and set `requireCollisionSeed: true` only if the test claims to cover a collision, seeding two rows that genuinely share a title.

- [ ] **Step 2: Run and close §412**

```bash
npx vitest run --maxWorkers=1 src/app/task-link-picker.test.tsx
```

- [ ] **Step 3: Commit**

```bash
git commit --only src/app/task-link-picker.test.tsx docs/open-followups.md -m "test(pickers): give TaskLinkPicker the direct suite 412 asks for"
```

---

# Workstream D — Register and ledger hygiene

## Task D1: The heading-vs-index gate (write it RED first)

**Files:**
- Create: `scripts/followup-index-lib.mjs`, `scripts/followup-index-lib.test.mjs`, `scripts/check-followup-index.mjs`

The register's index table lives between `<!-- INDEX:BEGIN -->` and `<!-- INDEX:END -->`. Headings are `^## <n>\. <title>`; rows are `^| [§<n>](#<slug>) | …`.

- [ ] **Step 1: Write the lib test first**

```js
// scripts/followup-index-lib.test.mjs
import { describe, expect, it } from "vitest";
import { diffHeadingsAgainstIndex } from "./followup-index-lib.mjs";

const DOC = [
  "<!-- INDEX:BEGIN -->",
  "| # | Item | Origin | Size | State |",
  "|---|---|---|---|---|",
  "| [§1](#1-first) | First | x | S | open |",
  "<!-- INDEX:END -->",
  "## 1. First",
  "## 2. Second",
].join("\n");

describe("diffHeadingsAgainstIndex", () => {
  it("reports a heading with no index row", () => {
    const r = diffHeadingsAgainstIndex(DOC);
    expect(r.missingRows).toEqual([2]);
    expect(r.orphanRows).toEqual([]);
  });

  it("reports an index row with no heading", () => {
    const r = diffHeadingsAgainstIndex(DOC.replace("## 2. Second", ""));
    expect(r.missingRows).toEqual([]);
    expect(r.orphanRows).toEqual([]);
  });

  // ★★★ THE VACUITY CONTROL, and it is the load-bearing test in this file.
  // A scan that parses nothing reports zero drift and passes forever. This
  // gate is authored against a register that is BROKEN today, so it has no
  // green baseline to inherit and nothing else would catch a dead parser.
  it("refuses to report success when it parsed no headings at all", () => {
    expect(() => diffHeadingsAgainstIndex("no register here")).toThrow(/parsed 0 headings/);
  });

  it("reports the counts it compared, so a caller can prove the sets were non-empty", () => {
    const r = diffHeadingsAgainstIndex(DOC);
    expect(r.headingCount).toBe(2);
    expect(r.rowCount).toBe(1);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
npx vitest run --maxWorkers=1 scripts/followup-index-lib.test.mjs
```

Expected: FAIL — module not found. (`vitest.config.ts` already includes `scripts/**/*.{test,spec}.mjs`.)

- [ ] **Step 3: Implement the lib**

```js
// scripts/followup-index-lib.mjs
// Pure: compares the register's HEADING set against its INDEX-TABLE set.
// ★ No file I/O here — the CLI wrapper reads the file, so this stays testable
// against string fixtures and the vacuity guard below is reachable in a test.

const HEADING = /^## (\d+)\./gm;
const ROW = /^\| \[§(\d+)\]\(#/gm;

/**
 * @param {string} src full text of docs/open-followups.md
 * @returns {{missingRows: number[], orphanRows: number[], headingCount: number, rowCount: number}}
 * @throws when it parsed no headings — a gate that scans nothing passes everything.
 */
export function diffHeadingsAgainstIndex(src) {
  const headings = [...src.matchAll(HEADING)].map((m) => Number(m[1]));
  if (headings.length === 0) throw new Error("followup-index: parsed 0 headings — refusing to report a result");
  const begin = src.indexOf("<!-- INDEX:BEGIN -->");
  const end = src.indexOf("<!-- INDEX:END -->");
  const table = begin === -1 || end === -1 ? "" : src.slice(begin, end);
  const rows = [...table.matchAll(ROW)].map((m) => Number(m[1]));
  const rowSet = new Set(rows), headSet = new Set(headings);
  return {
    missingRows: headings.filter((n) => !rowSet.has(n)).sort((a, b) => a - b),
    orphanRows: rows.filter((n) => !headSet.has(n)).sort((a, b) => a - b),
    headingCount: headings.length,
    rowCount: rows.length,
  };
}
```

- [ ] **Step 4: Run the test**

```bash
npx vitest run --maxWorkers=1 scripts/followup-index-lib.test.mjs
```

Expected: 4 passed.

- [ ] **Step 5: Write the CLI wrapper**

```js
#!/usr/bin/env node
// scripts/check-followup-index.mjs
// Exit 1 = DRIFT (write the missing rows). Exit 2 = the gate could not scan.
// Two codes because they demand opposite responses — same split as
// version-sync-check and followups-status-check.
import { readFileSync } from "node:fs";
import { diffHeadingsAgainstIndex } from "./followup-index-lib.mjs";

const P = "docs/open-followups.md";
let r;
try {
  r = diffHeadingsAgainstIndex(readFileSync(P, "utf8"));
} catch (e) {
  console.error(`SCAN FAILED: ${e.message}`);
  process.exit(2);
}
console.log(`compared ${r.headingCount} headings against ${r.rowCount} index rows`);
if (r.missingRows.length === 0 && r.orphanRows.length === 0) {
  console.log("index is in sync");
  process.exit(0);
}
if (r.missingRows.length) console.error(`headings with no index row: ${r.missingRows.join(", ")}`);
if (r.orphanRows.length) console.error(`index rows with no heading: ${r.orphanRows.join(", ")}`);
process.exit(1);
```

★ No shebang on the LIB — a `#!` on an imported `.mjs` makes vitest throw a SyntaxError naming the wrong file. The shebang belongs on the CLI only.

- [ ] **Step 6: Run it against today's register and confirm it is RED**

```bash
node scripts/check-followup-index.mjs > "$SCRATCH/d1.log" 2>&1; echo "EXIT=$?"; cat "$SCRATCH/d1.log"
```

Expected: `EXIT=1`, listing `407, 408, 409, 410, 411, 412, 413, 414`. The printed heading and row counts are the non-vacuity evidence — a run reporting `0 headings` would have exited 2.

- [ ] **Step 7: Commit the gate while it is still red**

```bash
git commit --only scripts/followup-index-lib.mjs scripts/followup-index-lib.test.mjs scripts/check-followup-index.mjs -m "feat(gates): add the heading-vs-index check for the follow-up register"
```

---

## Task D2: Wire the gate into npm and CI

**Files:**
- Modify: `package.json`, `.gitlab-ci.yml`, `CONTRIBUTING.md`, `README.md`

★★ Adding a script is a THREE-FILE change: `CONTRIBUTING.md` and `README.md` are GENERATED from `scriptsDescriptions`, and `docs:scripts:check` only verifies an entry EXISTS — only the build's prebuild hook catches a reworded one.

- [ ] **Step 1: Add the script and its description**

In `package.json` `scripts`:

```json
    "followups:index:check": "node scripts/check-followup-index.mjs",
```

and in `scriptsDescriptions`:

```json
    "followups:index:check": "Fails when the follow-up register's index table disagrees with its headings (exit 1 drift, exit 2 cannot scan).",
```

- [ ] **Step 2: Regenerate the generated docs**

```bash
npm run docs:scripts
npm run docs:scripts:check; echo "EXIT=$?"
```

Expected `EXIT=0`.

- [ ] **Step 3: Add the CI job**

In `.gitlab-ci.yml`, beside `followups-status-check`:

```yaml
followups-index-check:
  stage: quality
  needs: []
  script:
    - npm run followups:index:check
```

- [ ] **Step 4: Commit**

```bash
git commit --only package.json .gitlab-ci.yml CONTRIBUTING.md README.md -m "ci: make the register index gate blocking"
```

---

## Task D3: Write the eight missing index rows by hand

**Files:**
- Modify: `docs/open-followups.md`

★ The in-file rebuild script would fill these rows' Origin and Size cells with `— | —`. That is not a repair: those cells hold content nobody has written, for entries other slices own. Write them by hand from each entry's own body.

- [ ] **Step 1: Read the eight entries and draft their rows**

```bash
sed -n '/^## 407\./,/^## 415\./p' docs/open-followups.md
```

Each row is:

```
| [§N](#slug) | Item title | Origin | Size | State |
```

The slug is the heading, lowercased, with every character that is not a letter, digit, hyphen, space or underscore stripped, then each space replaced by a hyphen and NO collapsing — so a `" — CLOSED 2026-09-06"` suffix yields TWO hyphens. Derive each slug; never hand-write one.

- [ ] **Step 2: Insert them in numeric order and fix the §321 ordering discrepancy**

- [ ] **Step 3: Run the gate and confirm it is now GREEN**

```bash
node scripts/check-followup-index.mjs > "$SCRATCH/d3.log" 2>&1; echo "EXIT=$?"; cat "$SCRATCH/d3.log"
```

Expected `EXIT=0`, with the heading and row counts now equal.

- [ ] **Step 4: Verify every anchor actually resolves**

The gate compares NUMBERS, not anchors — a row can be present and its link still dead. Derive each row's slug from its heading and compare, reporting BOTH the match and mismatch counts:

```bash
node - <<'ANCHORS'
const fs = require("fs");
const L = fs.readFileSync("docs/open-followups.md", "utf8").split("\n");
const slugs = new Set();
L.forEach((l) => { const m = /^## (\d+)\.\s*(.*)$/.exec(l); if (!m) return;
  slugs.add((m[1] + ". " + m[2]).replace(/`|~~|\*\*/g, "").toLowerCase()
    .replace(/[^a-z0-9 _-]/g, "").replace(/ /g, "-")); });
let match = 0, miss = [];
L.forEach((l) => { const m = /^\| \[§\d+\]\(#([^)]*)\)/.exec(l); if (!m) return;
  if (slugs.has(m[1])) match++; else miss.push(m[1]); });
console.log("MATCH=" + match + " MISMATCH=" + miss.length);
miss.forEach((s) => console.log("  dead: " + s));
ANCHORS
```

★ Read the MATCH count as the control: a `MISMATCH=0` beside a `MATCH=0` means the scan compared two empty sets and proves nothing.

- [ ] **Step 5: Commit**

```bash
git commit --only docs/open-followups.md -m "docs(register): write the eight index rows the table was missing, and fix 321's order"
```

---

## Task D4: Close §407's stale entry

§407 was fixed in code before this branch — `task-row.tsx` and `task-kanban-card.tsx` both branch on `count === 1`, and both carry tests pinning singular and plural, one in DE. Only the entry is stale. (A3 additionally moved that call site onto `tPlural`, so re-read both files before writing the closure.)

**Files:**
- Modify: `docs/open-followups.md`

- [ ] **Step 1: Close it in all the places closure takes**

Closure takes 4–6 places, not one: the heading suffix (` — CLOSED 2026-09-07`), the index row's State cell, the index row's ANCHOR (the slug changes when the heading does), the `**Status:**` line, any body claim the fix falsified, and any cross-reference anchor in another entry. §415 cross-references §407 — update it.

- [ ] **Step 2: Re-run the anchor check and the gate**

```bash
node scripts/check-followup-index.mjs; echo "EXIT=$?"
npm run followups:status:check > "$SCRATCH/d4.log" 2>&1; echo "EXIT=$?"
```

Expected `EXIT=0` from both, plus a re-run of D3 Step 4's anchor script showing MATCH unchanged and MISMATCH 0.

- [ ] **Step 3: Commit**

```bash
git commit --only docs/open-followups.md -m "docs(register): close 407, which the code fixed two releases ago"
```

---

## Task D5: Cut the codename ledger (§423)

**Files:**
- Modify: `src/app/version.ts`

The `APP_MILESTONE` docstring carries 53 hand-maintained `0.NNN.x was "Name" (biography)` lines. Nothing reads them; the uniqueness check the same docstring prescribes greps `CHANGELOG.md`, which already holds every codename in its headers. It has rotted three times.

- [ ] **Step 1: Count the ledger lines before touching them**

```bash
grep -cE '^ \*  0\.[0-9]+\.x (was|WAS)' src/app/version.ts
```

Expected: 53. This is the positive control — a 0 here would mean the pattern is wrong and any subsequent "I removed them" claim would be unfounded.

- [ ] **Step 2: Delete the ledger lines, keeping the two notes that are real knowledge**

Keep, in a short replacement paragraph:
- the reuse/near-collision observation: `0.236.x` is "Sheldon" while `0.287.x` is "Tiptree" — the same person under two names, and the entry deliberately declines to assert a biography for "Sheldon" rather than guess one;
- a pointer to `CHANGELOG.md` as the single home for codenames, per AGENTS.md's doc-set rule;
- the rule that a codename is unique per MINOR LINE, not across history.

Drop every biography. They are what makes a line expensive enough to skip, and the 0.289.0 bump added five attributions from memory alone.

- [ ] **Step 3: Verify**

```bash
grep -cE '^ \*  0\.[0-9]+\.x (was|WAS)' src/app/version.ts
npm run version:check > "$SCRATCH/d5.log" 2>&1; echo "EXIT=$?"
npx tsc --noEmit; echo "EXIT=$?"
```

Expected: 0 ledger lines, `EXIT=0` from both gates. `version:check` exits 1 on drift and 2 when it cannot do its job — read which.

- [ ] **Step 4: Commit**

```bash
git commit --only src/app/version.ts -m "refactor(version): cut the codename ledger, keeping the reuse note CHANGELOG cannot hold"
```

---

## Task D6: Close §421 and §423

**Files:**
- Modify: `docs/open-followups.md`

- [ ] **Step 1: Close both entries in every place closure takes**

For §421, record what actually closed it: the eight rows written by hand, the §321 order fixed, and — the durable half — a gate that now compares the two sets, so the drift cannot recur silently. Name the script and the CI job.

For §423, record the ledger cut and what was kept.

★ §421's body says "no gate can see this". That claim is now FALSE and must be corrected in the same commit, not left as a stale justification for an entry that is closed.

- [ ] **Step 2: Verify**

```bash
node scripts/check-followup-index.mjs; echo "EXIT=$?"
npm run followups:status:check; echo "EXIT=$?"
npm run docs:claims:check; echo "EXIT=$?"
```

All three `EXIT=0`.

- [ ] **Step 3: Commit**

```bash
git commit --only docs/open-followups.md -m "docs(register): close 421 and 423"
```

---

# Release

## Task R1: Full local gate run — ONLY on the user's explicit say-so

The standing instruction is: run only the necessary gates, no full suite unless asked. Do not run this task unprompted.

- [ ] **Step 1: The gates that matter for this branch**

```bash
npx tsc --noEmit; echo "EXIT=$?"
npx eslint --max-warnings=0 src; echo "EXIT=$?"
npm run test:run > "$SCRATCH/r1-suite.log" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " "$SCRATCH/r1-suite.log"
```

★ `test:shuffle` is the only local reproduction of the `unit-tests-shuffled` CI job and this branch ADDS test files, which is exactly when it matters. Run it — but never alongside another vitest process:

```bash
npm run test:shuffle > "$SCRATCH/r1-shuffle.log" 2>&1; echo "SHUFFLE_EXIT=$?"; grep -E "Test Files|Tests " "$SCRATCH/r1-shuffle.log"
```

★★ A backgrounded full suite is killed past ~10 minutes and the notification reports the TRAILING command's exit code. Record `EXIT=$?` into the log and grep it.

## Task R2: Version bump and CHANGELOG

- [ ] **Step 1: Bump**

Edit `src/app/version.ts`: `APP_VERSION` to `0.290.0`, `APP_BUILD_DATE` to the real date of the bump, and a fresh `APP_MILESTONE` codename.

★★ The codename must be unique per MINOR LINE. Mint it against `CHANGELOG.md`'s headers — and note D5 removed the in-file ledger precisely so `CHANGELOG.md` is the only place to check.

- [ ] **Step 2: Propagate to the five satellites**

```bash
npm run version:sync
npm run version:check; echo "EXIT=$?"
```

Never hand-edit the six places.

- [ ] **Step 3: Write the CHANGELOG entry**

★★★ NEVER put a `[session link removed]...` URL in `CHANGELOG.md` or in an MR description. Commit trailers and MR comments are exempt.

Describe what a user can observe: counts now read correctly in both languages, and the register/ledger work as maintenance. Do not describe a comment edit as a behaviour fix.

- [ ] **Step 4: Commit**

```bash
git commit --only src/app/version.ts CHANGELOG.md package.json package-lock.json README.md docs/CODEMAPS -m "chore(release): 0.290.0"
```

## Task R3: Push, MR, merge on green — ONLY on the user's explicit say-so

- [ ] **Step 1: Push and open the MR**

```bash
git push -u origin feat/plural-pickers-register-hygiene
```

Write the MR description to the scratchpad and pass it with `--description-file` — no session URL in it.

- [ ] **Step 2: Poll the pipeline**

Poll until it settles. Confirm the pipeline's SHA equals local HEAD before merging — merge-on-green means nothing if the green run was for a different commit.

- [ ] **Step 3: Merge only after green**

```bash
glab mr merge <N> --auto-merge=false --yes
```

★★★ `--auto-merge` defaults to TRUE in glab. Pass `=false` explicitly, every time.

---

## Self-review notes recorded during planning

Three things were found while writing this plan that the spec did not anticipate, and each changed a task:

1. **The count is not always `{0}`.** `actionCommitteeInfoWhy` carries it at `{2}` and `chatAttachmentSummarySkipped` at `{1}`, so `tPlural` forwards args verbatim instead of injecting the count. The spec's convenience signature would have rendered both wrong.
2. **`dashboardGreetingSummary` holds TWO counts** and cannot be served by any single-selection helper. It is split into two keys (A7), which is the one structural change in workstream A.
3. **The ten existing `*One` keys use two different conventions** — seven are `…One`/`…Many` with no bare base. A3 standardises them, which is why the pairing test in A2 is written red and left for A3 to green.
