# Activity Log Clear — Confirm Before Execution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gate `handleClearActivityLog` in `src/app/task-manager.tsx` behind a `window.confirm` prompt so accidental "Clear log" clicks cannot silently wipe the activity history. Spec: `docs/superpowers/specs/2026-05-19-activity-log-clear-confirm-design.md`.

**Architecture:** Three additive edits in three existing files — one new i18n key in each of `src/app/i18n.ts` and `src/app/i18n.de.ts`, and a four-line change inside `handleClearActivityLog` in `src/app/task-manager.tsx` to early-return on empty log and gate the destructive action on a `window.confirm` result. Mirrors the existing precedent `handleClearAll` (`task-manager.tsx:1861-1867`) and `handleDelete` (`task-manager.tsx:384`).

**Tech Stack:** React 19 + Next 16 + TypeScript. No new dependencies, no new files, no test changes.

---

## File Structure

| File | Role |
|---|---|
| `src/app/i18n.ts` | Modified — add `confirmClearActivityLog` key after `confirmClearAll` at line 77 |
| `src/app/i18n.de.ts` | Modified — add matching German `confirmClearActivityLog` key after line 82 |
| `src/app/task-manager.tsx` | Modified — rewrite the `handleClearActivityLog` `useCallback` at lines 311-314 to add empty-log guard, confirm gate, and updated deps |

No new tests. The two existing confirm sites (`handleClearAll`, `handleDelete`) are not unit-tested either; mocking `window.confirm` for a single call adds little value over the manual smoke check at the end.

---

## Task 1: Add i18n keys, gate handleClearActivityLog with window.confirm, verify, commit

**Files:**
- Modify: `src/app/i18n.ts` (add line after 77)
- Modify: `src/app/i18n.de.ts` (add line after 82)
- Modify: `src/app/task-manager.tsx:311-314` (rewrite `handleClearActivityLog`)

This is the entire feature in one atomic commit. The change is small enough that splitting it across multiple commits would obscure the diff rather than aid review.

- [ ] **Step 1: Add the English i18n key**

Open `src/app/i18n.ts` and locate line 77:

```ts
  confirmClearAll: "Delete all {0} tasks? This cannot be undone.",
```

Insert one line immediately after it (becomes new line 78):

```ts
  confirmClearActivityLog: "Clear all {0} activity log entries? This cannot be undone.",
```

The result around lines 76-79 should read:

```ts
  confirmDelete: "Delete task #{0}? This cannot be undone.",
  confirmClearAll: "Delete all {0} tasks? This cannot be undone.",
  confirmClearActivityLog: "Clear all {0} activity log entries? This cannot be undone.",
  promptEmail: "No email saved for {0}. Enter their email address:",
```

- [ ] **Step 2: Add the German i18n key**

Open `src/app/i18n.de.ts` and locate line 82:

```ts
  confirmClearAll: "Alle {0} Aufgaben löschen? Dies kann nicht rückgängig gemacht werden.",
```

Insert one line immediately after it (becomes new line 83):

```ts
  confirmClearActivityLog: "Alle {0} Aktivitätsprotokoll-Einträge löschen? Dies kann nicht rückgängig gemacht werden.",
```

The result around lines 81-84 should read:

```ts
  confirmDelete: "Aufgabe #{0} löschen? Dies kann nicht rückgängig gemacht werden.",
  confirmClearAll: "Alle {0} Aufgaben löschen? Dies kann nicht rückgängig gemacht werden.",
  confirmClearActivityLog: "Alle {0} Aktivitätsprotokoll-Einträge löschen? Dies kann nicht rückgängig gemacht werden.",
  promptEmail: "Keine E-Mail-Adresse für {0} gespeichert. Bitte E-Mail-Adresse eingeben:",
```

- [ ] **Step 3: TypeScript check after i18n edits**

Run: `npx tsc --noEmit`

Expected: zero errors. The `TranslationKey` union type in `i18n.ts` is derived from the keys of the English dictionary, so once the new key exists in both `i18n.ts` and `i18n.de.ts`, the type-check will accept it at every `t(lang, ...)` call site.

If `tsc` reports an error like *"Property 'confirmClearActivityLog' is missing in type ..."* on the German file, double-check that Step 2 saved the file with the new line. The German dictionary must contain every key the English dictionary defines.

- [ ] **Step 4: Replace handleClearActivityLog body in task-manager.tsx**

Open `src/app/task-manager.tsx`. Find the current `handleClearActivityLog` definition at lines 311-314:

```ts
  const handleClearActivityLog = useCallback(() => {
    setActivityLog([]);
    clearActivityLogStorage();
  }, []);
```

Replace it with:

```ts
  const handleClearActivityLog = useCallback(() => {
    if (activityLog.length === 0) return;
    if (!window.confirm(t(lang, "confirmClearActivityLog", activityLog.length))) return;
    setActivityLog([]);
    clearActivityLogStorage();
  }, [activityLog.length, lang]);
```

Three changes inside the callback:
1. Empty-log early return — mirrors `handleClearAll` at line 1862 (defensive against future callers like keyboard shortcuts or the chat dispatcher; the rendered button is already gated on `entries.length > 0`).
2. `window.confirm` gate — uses the new `confirmClearActivityLog` i18n key with the current count.
3. Deps array grows from `[]` to `[activityLog.length, lang]` because both are now read inside the callback. `setActivityLog` (a `useState` setter) and `clearActivityLogStorage` (a top-level imported function) are stable references and stay out of the deps.

> Note: `t`, `lang`, `activityLog`, `setActivityLog`, and `clearActivityLogStorage` are all already in scope at this point in `TaskManagerInner` — no new imports are required.

- [ ] **Step 5: TypeScript check after the handler edit**

Run: `npx tsc --noEmit`

Expected: zero errors. If `tsc` flags `activityLog` or `lang` as missing, verify the rewritten block is inside `TaskManagerInner` (not in a separate scope) by checking the surrounding context — `handleClearActivityLog` sits between the `setActivityLog` `useState` (around line 305) and `const [error, setError]` (around line 316).

- [ ] **Step 6: Full Vitest suite**

Run: `npx vitest run`

Expected: 69 tests across 11 files, all green (no test touches `handleClearActivityLog`, so the suite is unaffected). The exact baseline before this change is 69 tests; if you see a different number, do not commit — investigate first.

- [ ] **Step 7: Manual smoke**

Start the dev server (`npm run dev`) and verify:

1. With at least one task created so the activity log is non-empty, open the activity panel.
2. Click "Clear log" → a native browser confirm appears with the message `"Clear all N activity log entries? This cannot be undone."` (N matches the visible entry count).
3. Press Cancel → the panel still shows the same entries, no change.
4. Click "Clear log" again → press OK → the entries disappear and the "Clear log" button itself hides (the panel's `entries.length > 0` guard removes it).
5. Switch the language to German (settings menu or language toggle). Re-add some entries by performing actions (creating a task, etc.). Click "Clear log" → confirm message is `"Alle N Aktivitätsprotokoll-Einträge löschen? Dies kann nicht rückgängig gemacht werden."`.

If any of these steps fails, do not commit — the most likely cause is a missing or misplaced i18n key (the confirm dialog would show `confirmClearActivityLog` as raw text instead of the translated message).

- [ ] **Step 8: Commit**

```bash
git add src/app/i18n.ts src/app/i18n.de.ts src/app/task-manager.tsx
git commit -m "feat(activity-log): confirm before clear"
```

The commit message intentionally stays short — the diff is three small additive edits and the spec already documents the rationale.

---

## Final verification (after Task 1)

- [ ] **Type check is clean** — `npx tsc --noEmit` exits 0.
- [ ] **Test suite is green** — `npx vitest run` reports 69/69 across 11 files.
- [ ] **Manual smoke in both languages** — completed in Step 7 above.
- [ ] **Commit log** — `git log --oneline -1` shows the new `feat(activity-log): confirm before clear` commit at HEAD.
