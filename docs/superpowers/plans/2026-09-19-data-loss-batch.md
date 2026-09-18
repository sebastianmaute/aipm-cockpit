# Data-loss batch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close register entries §567, §534, §546 and §548, four places where user data is silently lost, with one bounded fix each.

**Architecture:** §567 derives the two hardcoded secret-id lists from `SECRET_IDS`. §534 records which field each card rejection refuses (`Rejected.field`) and strips those fields before chat Apply and insight-recommendation confirm dispatch. §546 makes one function the source of both the other-granularity keys a dated TimeLog Apply deletes and the removal rows the confirm dialog lists. §548 publishes one signal, `loadPending`, from `useStorageBackend` (a load or project swap is still in flight). The main window renders the existing `PanelSkeleton` instead of the app tree while it is true, and the background writers that do not unmount gate on it.

**Tech Stack:** Next.js (App Router, pinned), React 19, TypeScript, vitest 4 + Testing Library, fast-check, fake-indexeddb.

**Spec:** `docs/superpowers/specs/2026-09-19-data-loss-batch-design.md` (binding authority; deviations are ruled on in "Spec corrections" below).

## Global Constraints

- No hand-rolled UI controls; reuse existing primitives and existing notice paths. Ask if none fits.
- Only the gates each task needs, run per task, sequentially, exit codes read unpiped. vitest: `--maxWorkers=1 --reporter=dot`, never two runs at once. No full suite locally.
- `src/app/*.ts(x)` are CRLF (Edit tool only, never `sed -i`); docs are LF. Never edit `src/app/i18n.de.ts` with Edit/Write — patch it via a node utf8 write matching `\r\n`, and keep EN/DE key parity.
- New i18n strings need both EN and DE (real umlauts).
- Commits cite §N; `Closes #NN` only in the MR description. Explicit-path staging; never `--amend`.
- Every "this is covered" claim is backed by a mutation that turns the test red, named in the task report.
- Work in `C:/Projects/aipm-wt-a` on `fix/data-loss-batch`. Use absolute paths in every tool call. Do not touch other worktrees.
- Tasks run in this order: 1 (§567) → 2 (§534) → 3 (§546) → 4a → 4b → 4c (§548). Each task folds in its own docs and register closure.

---

## Spec corrections (ruled — plan against the code, not the spec)

1. **§548: "guardEdit + four named writers" is not the UI writer set.** `guardEdit` wraps exactly the 33 `workspaceProps` handlers in `task-manager.tsx` (`grep -c "guardEdit(" src/app/task-manager.tsx` → 33). The writer inventory (Task 4) finds **39 further UI writer entry points** outside it: task rows, the task modal, bulk ops, voice, roles, knowledge, milestones, dashboard status, settings, notes, action center, documents, the steering committee and more. The popout "read-only" never covered them either. It is leaky by design, because a popout never saves. **Ruling:** do not gate writers one at a time. While `loadPending` is true, the main window renders the existing `PanelSkeleton` in place of the app tree. That is the primitive and pattern `showTursoListLoading` already uses for the Turso list-load window. It means no UI control that writes exists, and it covers future writers automatically. `guardEdit`/`makeEditGuard` stay unchanged. No new i18n string is needed, because the skeleton's `role="status"` carries the existing `loading` string, which is the notice. The four spec-named writers (template apply, chat Apply, insight-recommendation confirm, AI tool dispatch) are UI-only (`grep -rn "runTool(" src/app --include=*.ts --include=*.tsx | grep -v "\.test\.\|^src/app/chat-tools.ts"` → four files: `chat-panel.tsx`, `chat-proposal-apply.ts`, `use-inline-entity-edit.ts` (three calls) and `use-insight-recommendations.ts`, all reached from a rendered control), so the hold covers them. The rejected alternative, per-writer guards on 72 entry points each with its own test, would decay the way the popout guards did.
2. **§548 signal: `loadedBackend`/`workspaceLoaded` does not mean "the first load landed" for editing purposes.** The load effect leaves it unstamped on the empty-load refusal branch and on the `catch` (by design, §77). Holding edits on it would lock the app for the whole session after any load error: `local-file-not-picked`, a misconfigured Turso project, or signed-out SharePoint. **Ruling:** add `settledBackend`, an identity state like `loadedBackend` that every terminal branch of the load effect stamps. Add `swapsInFlight`, a counter held by the project-swap ops. Publish `loadPending = !(settledBackend === backend) || swapsInFlight > 0`. It is named `loadPending`, not the spec's `firstLoadDone`, because it also covers reloads and swaps.
3. **§548: a project switch opens the same window, and is included.** (a) A backend change from Settings, or a `tursoProjectId` change without the suppress flag, re-runs the load effect. The identity derivation covers this for free. (b) The ops path is `switchToProject`, `createProject`, `loadProjectFromFile`, `createDemoProject`, `onOpenStorageFile`, `switchToTursoProject`, `createTursoProject`, `migrateCurrentProjectToTurso` and `reloadCurrentProject`. Each op awaits, then replaces the workspace (or reloads the page). The outgoing flush runs before the await. An edit made during the await re-arms the debounced save, and the apply's re-render clears that timer (`scheduleDebouncedSave`'s cleanup calls `clearTimeout`) and sets `suppressNextSaveRef`, so the edit is never saved and is replaced in memory. **Ruling:** wrap exactly these nine in `holdDuring` at the hook's `return`.
4. **§567 docs: the spec names AGENTS.md only.** `docs/AGENTS/integrations.md` (the `timelogApiToken` bullet) and `docs/CODEMAPS/data.md` ("Secrets at rest") also say the two lists are hardcoded, and both become false. **Ruling:** fix all three in Task 1. AGENTS.md also lists "`SecretId` union" as a lockstep edit, but since §560 the union is derived from `SECRET_IDS`. The rewrite says so.
5. **§534: `Rejected` carries no field.** Its `detail` is display text: `field=value`, or `firstName+lastName=empty` for a group. **Ruling:** add optional `Rejected.field`, set by the update branch's `bad()` guards and by the row-link merge-site guard in `pushLinkDiffs`. Whole-call rejections (an unknown or unsupported id, and `set_task_dependencies`' per-link rejections) carry no field and strip nothing. This breaks 9 exact-equality assertions, which Task 2 migrates.
6. **§534: "the row reports as rejected" has no existing outcome.** **Ruling:** add the exported `ALL_FIELDS_REJECTED_ERROR` and a fifth `ProposalFailureKind`, `"rejected"`, with card string `chatProposalFailedRejected` (EN + DE). On the recommendation route, a fully stripped call counts as refused. If nothing committed and nothing hard-failed, the insight is not advanced (the same rule as a stale refusal) and the toast is `insightRecommendationApplyFailed`.
7. **§534: the recommendation modal renders one MERGED plan for all calls,** so stripping needs per-call attribution. **Ruling:** `confirmInsightRecommendation` recomputes `describeRecommendationPlan([call], …)` per call, from the same render-scope slices the modal used. A parity test pins merged-rejections ≡ the concatenation of per-call rejections.
8. **§546: `describeApplyRows` needs no change.** It spreads each row, so the new `removal` flag rides through. Only `buildApplyPlan` emits the flag. A removal row now counts in `rows.length`, which `timelog-reapply.ts` and `canApplyToBudget` read. So an Apply whose only change is a removal is now pending work, which is correct: the write deletes that key.
9. **New register entries:** none are filed by this plan. The open risk in "Open risks" below is reported to the lead, not filed.

---

## Global section R — register closure recipe (used by Tasks 1, 2, 3 and 4c)

The register's conventions, measured on the most recent closures (§558, §560, §539): the `##` heading's ` — OPEN` becomes ` — CLOSED <date>`. The `**Status:**` paragraph is replaced by one `**Status:** CLOSED <date> by \`fix/data-loss-batch\`: …` line. The `**Work item:** #NN` line is **deleted**, because `followups:workitems:check` fails a closed entry that still carries one. The index row gets the new anchor, its Item cell loses ` — OPEN`, and its State cell becomes `**CLOSED** <date>`. That is the format the in-file REBUILD recipe generates. Origin and Size are kept. The GitLab side is the MR's `Closes #NN` line, not this recipe.

Use the date the task is committed (`date +%F`). The examples below say `2026-09-19`, so replace every occurrence if the commit lands on a later day.

Create `$SCRATCH/close-followup.cjs` with the Write tool if it does not exist. `$SCRATCH` is your session scratchpad directory.

```js
// close-followup.cjs — close ONE docs/open-followups.md entry in place.
// Usage (from the repo root): node close-followup.cjs <n> <YYYY-MM-DD> <status-file>
"use strict";
const fs = require("fs");
const P = "docs/open-followups.md";
const [n, date, statusFile] = process.argv.slice(2);
if (!/^\d+$/.test(n || "") || !/^\d{4}-\d{2}-\d{2}$/.test(date || "") || !statusFile) {
  throw new Error("usage: <n> <YYYY-MM-DD> <status-file>");
}
const status = fs.readFileSync(statusFile, "utf8").trim();
if (!status.startsWith("**Status:** CLOSED ")) throw new Error("status must start with **Status:** CLOSED");
if (status.includes("\n")) throw new Error("status must be ONE line");
const src = fs.readFileSync(P, "utf8");
if (src.includes("\r\n")) throw new Error("register is expected to be LF");
const L = src.split("\n");
const h = L.findIndex((l) => l.startsWith(`## ${n}. `));
if (h < 0) throw new Error(`no heading for §${n}`);
if (!L[h].endsWith(" — OPEN")) throw new Error(`§${n} heading does not end in " — OPEN": ${L[h]}`);
L[h] = L[h].slice(0, -" — OPEN".length) + ` — CLOSED ${date}`;
const sectionEnd = () => {
  const i = L.findIndex((l, j) => j > h && /^## \d+\. /.test(l));
  return i < 0 ? L.length : i;
};
// 1. Replace the Status paragraph: the first **Status:** line of the section through the line before the next blank.
const s = L.findIndex((l, j) => j > h && j < sectionEnd() && l.startsWith("**Status:**"));
if (s < 0) throw new Error(`§${n} has no **Status:** line`);
let e = s;
while (e + 1 < L.length && L[e + 1] !== "") e++;
L.splice(s, e - s + 1, status);
// 2. Delete the Work item line and the blank line after it.
const w = L.findIndex((l, j) => j > h && j < sectionEnd() && l.startsWith("**Work item:**"));
if (w < 0) throw new Error(`§${n} has no **Work item:** line`);
if (L[w + 1] !== "") throw new Error(`§${n}: the line after Work item is not blank`);
L.splice(w, 2);
// 3. Rewrite the index row with the REBUILD recipe's own slug rule.
const slug = L[h].slice(3).replace(/`|~~|\*\*/g, "").toLowerCase().replace(/[^a-z0-9 _-]/g, "").replace(/ /g, "-");
const r = L.findIndex((l) => l.startsWith(`| [§${n}](#`));
if (r < 0) throw new Error(`no index row for §${n}`);
const cells = L[r].slice(2, -2).split(" | ");
if (cells.length !== 5) throw new Error(`index row for §${n} has ${cells.length} cells, expected 5`);
cells[0] = `[§${n}](#${slug})`;
cells[1] = cells[1].replace(/ — OPEN$/, "");
cells[4] = `**CLOSED** ${date}`;
L[r] = `| ${cells.join(" | ")} |`;
fs.writeFileSync(P, L.join("\n"));
console.log(`closed §${n}\n  heading: ${L[h]}\n  anchor:  #${slug}`);
```

Expected anchors, computed from the current headings with the recipe's slug rule:

| § | anchor after closing on 2026-09-19 |
|---|---|
| 567 | `#567-issealedsecret-and-readstore-still-hardcode-their-own-secretid-lists-and-a-missed-id-is-silent-data-loss--closed-2026-09-19` |
| 534 | `#534-the-chat-review-card-can-reject-one-field-while-apply-replays-the-whole-call-so-the-fields-it-shows-as-landing-are-lost--closed-2026-09-19` |
| 546 | `#546-a-dated-timelog-applys-other-granularity-delete-removes-hand-typed-hours-from-days-it-never-routed-and-the-confirm-dialog-never-discloses-it--closed-2026-09-19` |
| 548 | `#548-an-edit-made-during-a-projects-first-backend-load-is-overwritten-when-that-load-lands--closed-2026-09-19` |

Register gates. Run each one unpiped and read `EXIT` (1 = drift; 2 = the gate could not scan, which demands the opposite response):

```bash
cd /c/Projects/aipm-wt-a
npm run followups:index:check; echo "EXIT=$?"
npm run followups:status:check; echo "EXIT=$?"
npm run followups:workitems:check; echo "EXIT=$?"
npm run docs:claims:check; echo "EXIT=$?"
```

Expected: every `EXIT=0`.

## Global section V — how to run a gate

```bash
cd /c/Projects/aipm-wt-a
LOG="$(mktemp)"
npx vitest run <files…> --maxWorkers=1 --reporter=dot > "$LOG" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " "$LOG"
npx tsc --noEmit > "$LOG" 2>&1; echo "EXIT=$?"; grep -c "error TS" "$LOG"
npx eslint --max-warnings=0 <touched source and test files…>; echo "EXIT=$?"
```

- vitest passes only on `EXIT=0` **and** `Test Files  N passed (N)` with the N the task states. A missing path mixed with real ones is dropped at exit 0.
- tsc passes only on `EXIT=0` **and** a `0` error count. Run it after every test edit: vitest never typechecks.
- Never pipe a gate to read its exit code.

## Global section C — how to commit

```bash
cd /c/Projects/aipm-wt-a
MSG="$(mktemp)"
cat > "$MSG" <<'EOF'
<subject line given in the task>

<body given in the task>

Claude-Session: https://[session link removed]
EOF
git add -- <NEW files only, if any>
git commit -F "$MSG" --only -- <every path the task lists>
git show --stat HEAD
```

Never `git add -A`, never `--amend`. `git show --stat HEAD` must list exactly the task's paths.

---

### Task 1: §567 — derive both secret-id checks from `SECRET_IDS`

**Files:**
- Modify: `src/app/secrets.ts` (`isSealedSecret`)
- Modify: `src/app/secrets-store.ts` (the import, and `readStore`)
- Test: `src/app/secrets.test.ts`, `src/app/secrets-store.test.ts`
- Docs: `AGENTS.md` ("Secrets at rest" bullet), `docs/AGENTS/integrations.md` (the `timelogApiToken` bullet), `docs/CODEMAPS/data.md` ("Secrets at rest"), `docs/open-followups.md` (§567)

**Interfaces:**
- Consumes: `SECRET_IDS` (a readonly tuple) and `SecretId` from `secrets.ts`.
- Produces: no new API. `isSealedSecret(x: unknown): x is SealedSecret` and `readStore()` keep their signatures and shape checks.

- [ ] **Step 1: Write the tests**

In `src/app/secrets.test.ts`, change the import to:

```ts
import { sealDevice, openDevice, sealPassphrase, openPassphrase, SecretUnlockError, isSealedSecret, SECRET_IDS } from "./secrets";
```

Then append inside `describe("secrets", …)`, after the tamper test:

```ts
  // §567 — the id check is DERIVED from `SECRET_IDS`: every member is accepted
  // and nothing else is. Generated from the list, so a sixth id is covered here
  // without being named.
  it.each(SECRET_IDS)("isSealedSecret accepts a well-formed sealed record for %s", async (id) => {
    expect(isSealedSecret(await sealDevice(id, "x"))).toBe(true);
  });

  it("isSealedSecret rejects an id outside SECRET_IDS, and a non-string id", async () => {
    const sealed = await sealDevice("anthropicApiKey", "x");
    // Control: the unmodified record is accepted, so each refusal below is the id's doing.
    expect(isSealedSecret(sealed)).toBe(true);
    expect(isSealedSecret({ ...sealed, id: "notASecret" })).toBe(false);
    expect(isSealedSecret({ ...sealed, id: 7 })).toBe(false);
  });
```

In `src/app/secrets-store.test.ts`, change the two imports to:

```ts
import { sealDevice, sealPassphrase, SECRET_IDS } from "./secrets";
import { saveSealed, loadSealed, removeSealed, readDeviceSecret, isPassphraseLocked, migratePlaintextSecrets, probeDeviceSecretReadable, SECRETS_KEY } from "./secrets-store";
```

Then append inside `describe("secrets-store", …)`:

```ts
  // §567 — ONE seal → store → read round-trip per id, generated from
  // `SECRET_IDS`, so an id added to the list is covered without being named.
  // A missed id in either derivation fails its own row here.
  it.each(SECRET_IDS)("seals, stores and reads back %s", async (id) => {
    saveSealed(await sealDevice(id, `value-for-${id}`));
    expect(loadSealed(id)?.id).toBe(id);
    expect(await readDeviceSecret(id)).toBe(`value-for-${id}`);
  });

  it("reads back every SECRET_IDS entry when all are stored together", async () => {
    for (const id of SECRET_IDS) saveSealed(await sealDevice(id, id));
    // Control: all of them really are on disk, so a null below is a READ drop.
    const onDisk = JSON.parse(localStorage.getItem(SECRETS_KEY) ?? "{}") as Record<string, unknown>;
    expect(Object.keys(onDisk).sort()).toEqual([...SECRET_IDS].sort());
    for (const id of SECRET_IDS) expect(loadSealed(id), id).not.toBeNull();
  });
```

- [ ] **Step 2: Run the tests. They are green by design.**

Both lists are complete today, so these tests pass against the current code. Their job is to fail when a list drifts, and Steps 3 and 6 prove that.

Run (Global section V): `npx vitest run src/app/secrets.test.ts src/app/secrets-store.test.ts --maxWorkers=1 --reporter=dot`
Expected: `EXIT=0`, `Test Files  2 passed (2)`.

- [ ] **Step 3: Mutation M1. The tests catch the §567 defect on the OLD code.**

In `src/app/secrets-store.ts`, delete the line `      "sttApiKey",` from the `readStore` literal (Edit tool). Re-run Step 2's command.
Expected: `EXIT=1`, with `seals, stores and reads back sttApiKey` and `reads back every SECRET_IDS entry when all are stored together` failing.
Revert with the inverse Edit. Then run `git diff --stat -- src/app/secrets-store.ts`. Expected: empty.

- [ ] **Step 4: Implement both derivations**

In `src/app/secrets.ts`, replace:

```ts
    s.v === 1 &&
    (s.id === "anthropicApiKey" ||
      s.id === "tursoAuthToken" ||
      s.id === "jiraApiToken" ||
      s.id === "timelogApiToken" ||
      s.id === "sttApiKey") &&
```

with:

```ts
    s.v === 1 &&
    // ★★ §567 — membership in `SECRET_IDS`, never a restated list. A hand-kept
    //   copy that missed an id made this return false for a correctly sealed
    //   secret, and `readStore` then dropped it on read with nothing reported.
    typeof s.id === "string" &&
    (SECRET_IDS as readonly string[]).includes(s.id) &&
```

In `src/app/secrets-store.ts`, replace the import line with:

```ts
import { type SealedSecret, type SecretId, SECRET_IDS, openDevice, sealDevice, isSealedSecret } from "./secrets";
```

and replace:

```ts
    for (const id of [
      "anthropicApiKey",
      "tursoAuthToken",
      "jiraApiToken",
      "timelogApiToken",
      "sttApiKey",
    ] as const) {
```

with:

```ts
    // §567 — every sealed id, from the one runtime list (see `isSealedSecret`).
    for (const id of SECRET_IDS) {
```

- [ ] **Step 5: Run the tests**

Run Step 2's command. Expected: `EXIT=0`, `Test Files  2 passed (2)`.

- [ ] **Step 6: Mutations M2 and M3. Each derivation is pinned.**

- M2: in `readStore`, change `for (const id of SECRET_IDS)` to `for (const id of SECRET_IDS.slice(0, -1))`. Expected: red on the `sttApiKey` round-trip row and the all-together test. Revert.
- M3: in `isSealedSecret`, change `(SECRET_IDS as readonly string[])` to `(SECRET_IDS.slice(0, -1) as readonly string[])`. Expected: red on `isSealedSecret accepts … for sttApiKey` and on the `sttApiKey` round-trip. Revert.

After both, `git diff -- src/app/secrets.ts src/app/secrets-store.ts` shows only the Step 4 changes.

- [ ] **Step 7: Update the three docs (all LF, Edit tool)**

`AGENTS.md`, "Secrets at rest" bullet. Replace:

```
  lives under `settings.dictation`, browser→same-origin `/api/stt` SSRF proxy). Use the ID spellings
  above for the hardcoded allowlists below — earlier text here listed the field names as if they were
  the ids. All five are
```

with:

```
  lives under `settings.dictation`, browser→same-origin `/api/stt` SSRF proxy). Use the ID spellings
  above wherever an id is named — earlier text here listed the field names as if they were the ids.
  All five are
```

and replace:

```
  optional per-secret PBKDF2 passphrase — Jira is device-only so far, no passphrase UI). ★ Adding a
  SecretId means SIX edits in lockstep: `SecretId` union, `isSealedSecret` id allowlist + `readStore`
  allowlist loop (both HARDCODE the id list — a missed one silently drops the ciphertext on read),
  `migratePlaintextSecrets` (seal + return), `writeSettings` blank, `hydrateSecretsInto` restore +
  the load-effect migrate/hydrate/re-merge block, and a seal-on-edit call in the field's settings
  section (`saveSecretValue(id,…,"device")`). ★ `jira` lives at TOP-LEVEL `settings.jira` (NOT under
```

with:

```
  optional per-secret PBKDF2 passphrase — Jira is device-only so far, no passphrase UI). ★ Adding a
  SecretId starts at the runtime list `SECRET_IDS` in `secrets.ts`. The `SecretId` union, the
  `isSealedSecret` id check and the `readStore` loop (`secrets-store.ts`) all DERIVE from it (§567 —
  a hand-kept copy that missed an id silently dropped the ciphertext on read), and
  `SECRET_SETTINGS_PATHS` is a total record, so tsc demands its entry. The edits that remain by hand:
  `migratePlaintextSecrets` (seal + return), `writeSettings` blank, `hydrateSecretsInto` restore +
  the load-effect migrate/hydrate/re-merge block, and a seal-on-edit call in the field's settings
  section (`saveSecretValue(id,…,"device")`). ★ `jira` lives at TOP-LEVEL `settings.jira` (NOT under
```

`docs/AGENTS/integrations.md`. In the `timelogApiToken` bullet, replace:

```
(device-sealed only; the 6-edit lockstep applies — `SecretId` union, `isSealedSecret` allowlist, `readStore` allowlist loop, `migratePlaintextSecrets`, `writeSettings` blank, `hydrateSecretsInto`, + `saveSecretValue` seal-on-edit in `timelog-settings.tsx`)
```

with:

```
(device-sealed only; the AGENTS.md "Secrets at rest" lockstep applies — `isSealedSecret` and `readStore` derive from `SECRET_IDS` since §567, so the hand edits are `migratePlaintextSecrets`, `writeSettings` blank, `hydrateSecretsInto`, + `saveSecretValue` seal-on-edit in `timelog-settings.tsx`)
```

`docs/CODEMAPS/data.md`. Replace:

```
iters). ★ Adding one means six edits in lockstep, two of which hardcode the id list
(`isSealedSecret` and the `readStore` loop) — a miss silently drops the ciphertext on read.
```

with:

```
iters). ★ Adding one starts at `SECRET_IDS`; since §567 `isSealedSecret` and the `readStore` loop
derive from it rather than restating the id list (the lockstep itself: AGENTS.md "Secrets at rest").
```

- [ ] **Step 8: Close §567 (Global section R)**

Write `$SCRATCH/status-567.txt` (one line):

```
**Status:** CLOSED 2026-09-19 by `fix/data-loss-batch`: `isSealedSecret` (`secrets.ts`) checks the id by membership in `SECRET_IDS` and `readStore` (`secrets-store.ts`) iterates `SECRET_IDS`, so neither carries its own id list any more; pinned by a seal → store → read round-trip per id generated from `SECRET_IDS` in `secrets-store.test.ts`, and by `isSealedSecret` accepting every member and rejecting an unknown id in `secrets.test.ts`.
```

Run `node "$SCRATCH/close-followup.cjs" 567 2026-09-19 "$SCRATCH/status-567.txt"`. Check that the printed anchor matches the table in Global section R.

- [ ] **Step 9: Gates**

- vitest: Step 2's command → `EXIT=0`, `Test Files  2 passed (2)`.
- tsc → `EXIT=0`, `0`.
- `npx eslint --max-warnings=0 src/app/secrets.ts src/app/secrets-store.ts src/app/secrets.test.ts src/app/secrets-store.test.ts` → `EXIT=0`.
- `npm run docs:symbols:check; echo "EXIT=$?"` → `EXIT=0`.
- The four register gates in Global section R → all `EXIT=0`.

- [ ] **Step 10: Commit (Global section C)**

Subject: `fix(secrets): §567 — derive the sealed-id checks from SECRET_IDS`
Body: `isSealedSecret and readStore each kept a five-id list; a missed id dropped a correctly sealed secret on read with nothing reported. Both now derive from SECRET_IDS, pinned by a round-trip per id generated from the list. Mutations: M1 (drop sttApiKey from the old readStore literal), M2 and M3 (slice the derived lists) each turn the tests red.`
Paths: `src/app/secrets.ts src/app/secrets-store.ts src/app/secrets.test.ts src/app/secrets-store.test.ts AGENTS.md docs/AGENTS/integrations.md docs/CODEMAPS/data.md docs/open-followups.md`

---

### Task 2: §534 — Apply sends only the fields the card showed

**Files:**
- Modify: `src/app/inline-ai-edit/plan.ts` (`Rejected`, `pushLinkDiffs`, the `bad` closure in `describeEntityCalls`, two comments, the new `stripRejectedFields`)
- Modify: `src/app/chat-proposal-apply.ts` (`ALL_FIELDS_REJECTED_ERROR`, `ProposalFailureKind`, `failureKindOf`, the dispatch in `applyProposal`)
- Modify: `src/app/use-insight-recommendations.ts` (`confirmInsightRecommendation`)
- Modify: `src/app/chat-proposal-block.tsx` (the failure-label ternary)
- Modify: `src/app/i18n.ts`, `src/app/i18n.de.ts` (`chatProposalFailedRejected`, by node script only)
- Test: `src/app/inline-ai-edit/plan.test.ts`, `src/app/inline-ai-edit/emails-roundtrip.test.ts`, `src/app/inline-ai-edit/emails-write-parity.test.ts`, `src/app/chat-proposal-apply.test.tsx`, `src/app/chat-proposal-block.test.tsx`, `src/app/use-insight-recommendations.test.tsx`, `src/app/insights/recommend-plan.test.ts`
- Docs: `docs/AGENTS/ai-assistant.md` (the "WHICH CONSUMER LOSES DATA" paragraph), `docs/open-followups.md` (§534)

**Interfaces:**
- Produces (in `inline-ai-edit/plan.ts`):
  - `Rejected` gains `field?: string`.
  - `export interface StrippedInput { readonly input: Record<string, unknown>; readonly stripped: readonly string[]; readonly writesNothing: boolean }`
  - `export function stripRejectedFields(input: Readonly<Record<string, unknown>>, plan: EditPlan): StrippedInput`. The plan must describe exactly THIS one call.
- Produces (in `chat-proposal-apply.ts`): `export const ALL_FIELDS_REJECTED_ERROR: string`; `ProposalFailureKind` gains `"rejected"`.

- [ ] **Step 1: Write the failing tests**

`src/app/inline-ai-edit/plan.test.ts`. Change the import to:

```ts
import { describeToolCalls, describeEntityCalls, isEmptyPlan, stripRejectedFields, type EditPlan, type ToolUseLike } from "./plan";
```

Then append at the end of the file:

```ts
// §534 — the replaying consumers (chat Apply, insight-recommendation confirm)
// send a call minus every field the card rejected. The strip reads the SAME
// plan the card renders, so card and write cannot disagree about a field.
describe("stripRejectedFields (§534)", () => {
  it("records the refused field on a field-level rejection", () => {
    const plan = describeToolCalls([block("update_task", { id: 42, taskName: "Renamed", assigneeEmail: "not-an-email" })], { task, ws });
    expect(plan.rejected).toEqual([
      { toolName: "update_task", reason: "bad-input", detail: "assigneeEmail=not-an-email", field: "assigneeEmail" },
    ]);
  });

  it("removes exactly the rejected fields and keeps the id, the token and every landing sibling", () => {
    const input = { id: 42, taskName: "Renamed", assigneeEmail: "not-an-email", expectedToken: "t" };
    const plan = describeToolCalls([block("update_task", input)], { task, ws });
    expect(plan.updates.map((u) => u.field)).toEqual(["taskName"]);
    expect(stripRejectedFields(input, plan)).toEqual({
      input: { id: 42, taskName: "Renamed", expectedToken: "t" },
      stripped: ["assigneeEmail"],
      writesNothing: false,
    });
  });

  it("reports writesNothing when every field the call writes was rejected", () => {
    const input = { id: 42, assigneeEmail: "not-an-email", expectedToken: "t" };
    const plan = describeToolCalls([block("update_task", input)], { task, ws });
    expect(stripRejectedFields(input, plan)).toEqual({
      input: { id: 42, expectedToken: "t" },
      stripped: ["assigneeEmail"],
      writesNothing: true,
    });
  });

  it("strips nothing for a whole-call rejection, which names no field", () => {
    const input = { id: 999, taskName: "x" };
    const plan = describeToolCalls([block("update_task", input)], { task, ws });
    expect(plan.rejected).toEqual([{ toolName: "update_task", reason: "unknown-id", detail: "999" }]);
    expect(stripRejectedFields(input, plan)).toEqual({ input, stripped: [], writesNothing: false });
  });

  // Parity: every landing field survives the strip, every rejected field is gone,
  // and `stripped` is exactly the plan's field list — over several rejection kinds.
  it.each([
    { input: { id: 42, status: "Frobnicate", dueDate: "2026-08-15" } },
    { input: { id: 42, dueDate: "", priority: "High" } },
    { input: { id: 42, assigneeEmail: "a,b@x.com", taskName: "N" } },
    { input: { id: 42, assigneeEmail: "a@b.co", taskName: "N" } },
  ])("keeps every landing field and drops every rejected one: $input", ({ input }) => {
    const plan = describeToolCalls([block("update_task", input)], { task, ws });
    const sent = stripRejectedFields(input, plan);
    for (const u of plan.updates) if (u.field in input) expect(sent.input).toHaveProperty(u.field);
    for (const r of plan.rejected) if (r.field) expect(sent.input).not.toHaveProperty(r.field);
    expect(sent.stripped).toEqual(plan.rejected.flatMap((r) => (r.field ? [r.field] : [])));
  });
});
```

`src/app/chat-proposal-apply.test.tsx`. Change the imports to:

```ts
import {
  ALL_FIELDS_REJECTED_ERROR,
  applyProposal,
  failureKindOf,
  NEW_ROW_TOKEN_UNAVAILABLE_ERROR,
  PENDING_MINT_ERROR,
  TOKEN_REQUIRED_TOOLS,
  TOKEN_ROW_SOURCE,
  type FailedAppliedRow,
} from "./chat-proposal-apply";
```

and `import { DEFAULT_TASK_STATUS, type Milestone, type Resource, type Task } from "./types";`. Add this helper beside `seedMilestone`:

```ts
function seedResource(id: number): Resource {
  return { id, firstName: "Ada", lastName: "Lovelace", roleId: null, utilizationMode: "percent", utilization: {} };
}
```

Append inside `describe("failureKindOf", …)`:

```ts
  test("calls a row whose every field the card rejected 'rejected', not a plain error", () => {
    expect(failureKindOf({ index: 0, ok: false, error: ALL_FIELDS_REJECTED_ERROR })).toBe("rejected");
  });
```

Append at the end of the file:

```ts
// §534 — Apply used to replay the model's WHOLE call, so a field the card
// rejected made the dispatcher throw and took every sibling the card showed as
// landing down with it. Real undo stack, real dispatcher, real providers.
describe("§534 — Apply sends only what the card showed", () => {
  test("a task update whose assigneeEmail the card rejected still lands its taskName", async () => {
    const { result } = renderApply();
    const calls: ProposedCall[] = [
      { name: "update_task", input: { id: 2, taskName: "After", assigneeEmail: "not-an-email" } },
    ];
    // Parity: the card's verdict, computed from the same plan the apply strips.
    const rows = describeProposal(calls, seedWorkspace());
    expect(rows[0].plan.rejected.map((r) => r.field)).toEqual(["assigneeEmail"]);
    expect(rows[0].plan.updates.map((u) => u.field)).toEqual(["taskName"]);

    const outcome = await applyAll(result, calls);
    expect(outcome.rows).toEqual([{ index: 0, ok: true }]);
    expect(result.current.dispatcher.getTask(2)?.taskName).toBe("After");
    expect(result.current.dispatcher.getTask(2)?.assigneeEmail).toBe("");
  });

  test("a resource update whose emails the card rejected still lands its title (the §422 instance)", async () => {
    const seed: TestSeed = { ...SEED, resources: [seedResource(2)] };
    const { result } = renderApply(seed);
    // ★ The token is derived from the row AS STORED, so read it back rather than
    //   trusting the literal — the seeder may normalise it.
    const live = result.current.dispatcher.getResourceRow(2) as Resource | null;
    expect(live).not.toBeNull();
    const ws: Workspace = { ...seedWorkspace(seed), resources: [live as Resource] };
    const calls: ProposedCall[] = [
      { name: "update_resource", input: { id: 2, title: "Lead", emails: ["new;x@y.com"] } },
    ];
    const rows = describeProposal(calls, ws);
    expect(rows[0].plan.rejected.map((r) => r.field)).toEqual(["emails"]);
    expect(rows[0].plan.updates.map((u) => u.field)).toEqual(["title"]);

    const outcome = await applyAll(result, calls, ws);
    expect(outcome.rows).toEqual([{ index: 0, ok: true }]);
    const after = result.current.dispatcher.getResourceRow(2) as Resource;
    expect(after.title).toBe("Lead");
    expect(after.emails).toBeUndefined();
  });

  test("a call whose every written field the card rejected is not sent, and reports as rejected", async () => {
    const { result } = renderApply();
    const calls: ProposedCall[] = [{ name: "update_task", input: { id: 2, assigneeEmail: "not-an-email" } }];
    const outcome = await applyAll(result, calls);
    expect(outcome.rows).toEqual([{ index: 0, ok: false, error: ALL_FIELDS_REJECTED_ERROR }]);
    expect(failureKindOf(outcome.rows[0] as FailedAppliedRow)).toBe("rejected");
    expect(result.current.dispatcher.getTask(2)?.assigneeEmail).toBe("");
  });
});
```

`src/app/chat-proposal-block.test.tsx`. In the `it.each` of failure kinds, add a fifth row after `["error", "Not applied"],`:

```ts
    ["rejected", "Not applied — every change in it was rejected"],
```

In the ★★★ comment below it, change `All four labels open with "Not applied"` to `All five labels open with "Not applied"`.

`src/app/use-insight-recommendations.test.tsx`. Append at the end of the file:

```ts
// §534 — confirm used to replay the stored call whole, so a field the review
// modal showed as rejected was still sent. It now strips it, from the SAME
// per-call plan the modal's merged plan is made of.
describe("§534 — confirm sends only what the review modal showed", () => {
  it("lands the valid sibling and omits a rejected assigneeEmail", async () => {
    const store = mkStore([mkInsight({ recommendation: mkRec({ id: 42, status: "In Progress", assigneeEmail: "not-an-email", expectedToken: entityToken("task", task) }) })]);
    const d = mkDispatcher();
    const deps = mkDeps({ insights: store.read(), setInsights: store.setInsights, dispatcher: d.dispatcher });
    const { result } = renderHook(() => useInsightRecommendations(deps));
    act(() => { result.current.setReviewInsightId(1); });
    // Parity: the modal names the same field the confirm will strip.
    expect(result.current.reviewPlan?.rejected.map((r) => r.field)).toEqual(["assigneeEmail"]);
    await act(async () => { await result.current.confirmInsightRecommendation(); });
    expect(d.read().status).toBe("In Progress");
    expect(d.read()).not.toHaveProperty("assigneeEmail");
    expect(store.read()[0].recommendation?.status).toBe("applied");
    expect(deps.showToast).toHaveBeenCalledWith("info", t("en-US", "insightRecommendationApplied"));
  });

  it("sends nothing for a call whose every field was rejected, and leaves the insight where it was", async () => {
    const store = mkStore([mkInsight({ recommendation: mkRec({ id: 42, assigneeEmail: "not-an-email", expectedToken: entityToken("task", task) }) })]);
    const d = mkDispatcher();
    const deps = mkDeps({ insights: store.read(), setInsights: store.setInsights, dispatcher: d.dispatcher });
    const { result } = renderHook(() => useInsightRecommendations(deps));
    act(() => { result.current.setReviewInsightId(1); });
    await act(async () => { await result.current.confirmInsightRecommendation(); });
    expect(d.read()).not.toHaveProperty("assigneeEmail");
    expect(store.calls).not.toHaveBeenCalled();
    expect(deps.showToast).toHaveBeenCalledWith("error", t("en-US", "insightRecommendationApplyFailed"));
    expect(deps.logActivityAs).not.toHaveBeenCalled();
  });
});
```

`src/app/insights/recommend-plan.test.ts`. Append inside `describe("describeRecommendationPlan", …)`:

```ts
  // §534 — `confirmInsightRecommendation` strips each call against
  // describeRecommendationPlan([call]); the modal renders
  // describeRecommendationPlan(allCalls). They agree only while the merged
  // plan's rejections are exactly the per-call ones, in order.
  test("the merged plan's rejections are the concatenation of each call's own (§534)", () => {
    const calls = [
      { name: "update_task", input: { id: 12, assigneeEmail: "not-an-email", dueDate: "2026-08-01" } },
      { name: "update_task", input: { id: 999 } },
    ];
    const perCall = calls.flatMap((c) => describeRecommendationPlan([c], ws()).rejected);
    expect(perCall.map((r) => r.field)).toEqual(["assigneeEmail", undefined]); // anti-vacuity: both kinds present
    expect(describeRecommendationPlan(calls, ws()).rejected).toEqual(perCall);
  });
```

`src/app/inline-ai-edit/emails-write-parity.test.ts`. Change `import { describeEntityCalls } from "./plan";` to `import { describeEntityCalls, stripRejectedFields } from "./plan";`. In the header comment, replace the line `//  • chat Apply, which replays the ORIGINAL call into \`updateResource\`,` with:

```ts
//  • the raw dispatcher write, `updateResource` on the ORIGINAL call (what chat
//    Apply sent before §534),
```

and after the `(iii)` bullet add:

```ts
//  (iv) §534 — chat Apply's STRIPPED call never throws, lands `title`, and
//      never carries a rejected `emails`.
```

At the end of the `it.each(CELLS)` body, after the `(iii)` block, add:

```ts
    // (iv) §534 — chat Apply sends the STRIPPED call.
    const sent = stripRejectedFields(fields, plan);
    expect("emails" in sent.input).toBe(inc.present && !planRejects);
    const stripped = mount(s.list);
    expect(write(stripped, sent.input)).toBeUndefined();
    expect(storedRow(stripped)?.title).toBe("Lead");
    if (!planRejects) expect(storedRow(stripped)?.emails).toEqual(storedRow(chat)?.emails);
```

- [ ] **Step 2: Migrate the exact-equality assertions the new `field` member invalidates**

Each of these compares a whole field-level `Rejected` object with `toEqual`. Add the `field` shown. Find each by its `detail` string.

| file | `detail` | add |
|---|---|---|
| `inline-ai-edit/plan.test.ts` | `status=Frobnicate` | `field: "status"` |
| `inline-ai-edit/plan.test.ts` | `priority=Critical` | `field: "priority"` |
| `inline-ai-edit/plan.test.ts` | `dueDate=empty` | `field: "dueDate"` |
| `inline-ai-edit/plan.test.ts` | `probability=1` (the `toEqual`, not the `toMatchObject` ones) | `field: "probability"` |
| `inline-ai-edit/plan.test.ts` | `description=true` | `field: "description"` |
| `inline-ai-edit/plan.test.ts` | `lastUpdateDate=02/02/2026` | `field: "lastUpdateDate"` |
| `inline-ai-edit/plan.test.ts` | `attendeeResourceIds=7, 9` | `field: "attendeeResourceIds"` |
| `inline-ai-edit/plan.test.ts` | `resourceId=9` | `field: "resourceId"` |
| `inline-ai-edit/plan.test.ts` | `startDate=2026-01-32` | `field: "startDate"` |
| `inline-ai-edit/emails-roundtrip.test.ts` | `emails=a,b@x.com, c;d@y.com` | `field: "emails"` |

Example. `{ toolName: "update_task", reason: "bad-input", detail: "dueDate=empty" }` becomes `{ toolName: "update_task", reason: "bad-input", detail: "dueDate=empty", field: "dueDate" }`.

Do NOT touch the `toMatchObject` assertions, the fixtures in `chat-proposal-block.test.tsx` / `inline-ai-edit-popover.test.tsx` (inputs, and `field` is optional), or the `set_task_dependencies` rows in `chat-proposal-describe.test.ts`, which carry no field by design.

- [ ] **Step 3: Run the tests and verify they fail**

Run (Global section V) on these 25 files: `src/app/inline-ai-edit` (16 test files), `src/app/chat-proposal-apply.test.tsx src/app/chat-proposal-block.test.tsx src/app/chat-proposal-describe.test.ts src/app/chat-panel.test.tsx src/app/use-insight-recommendations.test.tsx src/app/insights/recommend-plan.test.ts src/app/insights/recommendation-review-modal.test.tsx src/app/i18n-encoding.test.ts src/app/i18n.test.ts`.
Expected: `EXIT=1`. Failures: `stripRejectedFields` is not exported, and `ALL_FIELDS_REJECTED_ERROR` is undefined.

- [ ] **Step 4: Implement the plan half (`inline-ai-edit/plan.ts`)**

Replace the one-line interface:

```ts
export interface Rejected { toolName: string; reason: "unknown-id" | "bad-input" | "unsupported"; detail: string }
```

with:

```ts
export interface Rejected {
  toolName: string;
  reason: "unknown-id" | "bad-input" | "unsupported";
  detail: string;
  /** §534 — the input FIELD this rejection refuses. Set only where the verdict
   *  is about ONE field of a call whose other fields still land: the update
   *  branch's field guards and the row-link merge-site guard. Absent on a
   *  whole-call rejection (an unknown or unsupported id). `stripRejectedFields`
   *  removes exactly these from a replayed call; `detail` stays display text. */
  field?: string;
}
```

In `pushLinkDiffs`, replace:

```ts
      if (toolName) plan.rejected.push({ toolName, reason: "bad-input", detail: `${f}=${str(input[f])}` });
```

with:

```ts
      if (toolName) plan.rejected.push({ toolName, reason: "bad-input", detail: `${f}=${str(input[f])}`, field: f });
```

In `describeEntityCalls`, replace:

```ts
        const bad = (detail: string) => plan.rejected.push({ toolName: name, reason: "bad-input", detail });
```

with:

```ts
        // ★ `field: f` for EVERY field-level refusal, the group one included: its
        //  detail names the whole group, but the field under judgement is `f`.
        const bad = (detail: string) => plan.rejected.push({ toolName: name, reason: "bad-input", detail, field: f });
```

Replace the comment lines:

```ts
        // the halves separately previewed it as REJECTED while the write went
        // through: the two REPLAYING consumers resend the original tool input
        // and never read this plan (§384).
```

with:

```ts
        // the halves separately previewed it as REJECTED while the write went
        // through: the two REPLAYING consumers resent the original tool input
        // and never read this plan (§384). Since §534 they strip every field
        // `plan.rejected` names, so a false rejection here now DROPS a legal edit.
```

Replace:

```ts
      //  ★★★ A REJECTION WOULD BE THE WRONG FIX, and it was the first option on
      //   the table. The write SUCCEEDS — and the two REPLAYING consumers
      //   (`chat-proposal-apply.ts`, `use-insight-recommendations.ts`) resend the
      //   original tool input and never read this plan, so a "refused" card sits
      //   in front of a write that lands: the §384 shape this module exists to
      //   prevent, reintroduced by the fix. Disclosing the swap is the only
      //   answer that is true for BOTH consumer kinds.
```

with:

```ts
      //  ★★★ A REJECTION WOULD BE THE WRONG FIX, and it was the first option on
      //   the table. The write SUCCEEDS. When this was written the two REPLAYING
      //   consumers (`chat-proposal-apply.ts`, `use-insight-recommendations.ts`)
      //   resent the original tool input, so a "refused" card sat in front of a
      //   write that landed; since §534 they strip every field `plan.rejected`
      //   names, so a rejection would instead REFUSE an edit the sanitizer
      //   accepts. Disclosing the swap is the only answer true for every consumer.
```

After `isEmptyPlan` at the end of the file, append:

```ts
/** Keys a tool input carries that ADDRESS the write rather than make one. */
const ADDRESS_KEYS: ReadonlySet<string> = new Set(["id", "expectedToken"]);

/** What a replaying consumer may send for ONE call (§534). */
export interface StrippedInput {
  /** The call's input minus every field the plan refused. */
  readonly input: Record<string, unknown>;
  /** The fields removed, in input order. */
  readonly stripped: readonly string[];
  /** Stripping removed every field the call writes — dispatch nothing. */
  readonly writesNothing: boolean;
}

/**
 * §534 — the call's input with every field `plan.rejected` names removed, so
 * chat Apply and insight-recommendation confirm send only what the card showed
 * as landing. The dispatcher throws for a whole call on one bad field, so
 * replaying the model's input verbatim lost every sibling the card promised.
 *
 * ★★ `plan` MUST describe exactly this one call. A plan merged across calls
 *   attributes a field to no particular call, and stripping by it would remove
 *   one call's rejected field from another call that sent it legally.
 * ★ A whole-call rejection names no field, so it strips nothing: that call is
 *   still dispatched and fails exactly as it did before.
 */
export function stripRejectedFields(input: Readonly<Record<string, unknown>>, plan: EditPlan): StrippedInput {
  const refused = new Set(plan.rejected.flatMap((r) => (r.field === undefined ? [] : [r.field])));
  const kept: Record<string, unknown> = {};
  const stripped: string[] = [];
  for (const [key, value] of Object.entries(input)) {
    if (refused.has(key)) stripped.push(key);
    else kept[key] = value;
  }
  const writesNothing = stripped.length > 0 && Object.keys(kept).every((key) => ADDRESS_KEYS.has(key));
  return { input: kept, stripped, writesNothing };
}
```

- [ ] **Step 5: Implement the chat Apply half (`chat-proposal-apply.ts`)**

Add the import after `import type { DescribedRow } from "./chat-proposal-describe";`:

```ts
import { stripRejectedFields } from "./inline-ai-edit/plan";
```

After the `NEW_ROW_TOKEN_UNAVAILABLE_ERROR` declaration, add:

```ts
/** `AppliedRow.error` for a row NOT SENT because the review card rejected every
 *  field it writes (§534). Exported, like its two siblings above, so the card
 *  and a test recognise the outcome without matching prose. */
export const ALL_FIELDS_REJECTED_ERROR =
  "every field this call writes was rejected on the review card, so nothing was sent";
```

Replace `export type ProposalFailureKind = "conflict" | "dependency" | "unreadable" | "error";` with:

```ts
export type ProposalFailureKind = "conflict" | "dependency" | "unreadable" | "rejected" | "error";
```

In the doc comment immediately above `export type ProposalFailureKind`, change `/** Which of the four not-ok outcomes a row hit` to `/** Which of the five not-ok outcomes a row hit`.

In `failureKindOf`, add a line after the `NEW_ROW_TOKEN_UNAVAILABLE_ERROR` check:

```ts
  if (row.error === ALL_FIELDS_REJECTED_ERROR) return "rejected";
```

In `applyProposal`, replace:

```ts
        const result = await runTool(dispatcher, guarded.name, guarded.input);
```

with:

```ts
        // ★★★ §534 — SEND ONLY WHAT THE CARD SHOWED AS LANDING. The dispatcher
        //  throws for the whole call on one field it refuses, so replaying the
        //  model's input verbatim lost every sibling the card promised. Stripped
        //  AFTER the remap and the token stamp, which only touch `id` and
        //  `expectedToken`, and against this row's OWN one-call plan. A pending
        //  row's plan is empty, so it strips nothing.
        const sent = stripRejectedFields(guarded.input, row.plan);
        if (sent.writesNothing) {
          applied.push({ index, ok: false, error: ALL_FIELDS_REJECTED_ERROR });
          continue;
        }
        const result = await runTool(dispatcher, guarded.name, sent.input);
```

- [ ] **Step 6: Implement the card label and i18n**

`chat-proposal-block.tsx`. Replace:

```tsx
                : row.failedKind === "error"
                  ? "chatProposalFailedError"
                  : "chatProposalFailed",
```

with:

```tsx
                : row.failedKind === "rejected"
                  ? "chatProposalFailedRejected"
                  : row.failedKind === "error"
                    ? "chatProposalFailedError"
                    : "chatProposalFailed",
```

i18n. Do NOT use Edit or Write on either dictionary. Write `$SCRATCH/patch-i18n-534.cjs` with the Write tool, using `\u` escapes so the script's bytes are ASCII and the dictionary receives real characters:

```js
// patch-i18n-534.cjs — run from the repo root.
"use strict";
const fs = require("fs");
function insertAfter(path, anchor, line) {
  const src = fs.readFileSync(path, "utf8");
  const hits = src.split(anchor).length - 1;
  if (hits !== 1) throw new Error(`${path}: anchor found ${hits} times, expected 1`);
  if (src.includes(line)) throw new Error(`${path}: already patched`);
  fs.writeFileSync(path, src.replace(anchor, () => anchor + line), "utf8");
}
insertAfter(
  "src/app/i18n.ts",
  '  chatProposalFailedError: "Not applied",\r\n',
  '  chatProposalFailedRejected: "Not applied \u2014 every change in it was rejected",\r\n',
);
insertAfter(
  "src/app/i18n.de.ts",
  '  chatProposalFailedError: "Nicht \u00fcbernommen",\r\n',
  '  chatProposalFailedRejected: "Nicht \u00fcbernommen \u2013 jede \u00c4nderung darin wurde abgelehnt",\r\n',
);
console.log("patched");
```

Run `node "$SCRATCH/patch-i18n-534.cjs"`, then verify:

```bash
cd /c/Projects/aipm-wt-a
node -e "for (const f of ['src/app/i18n.ts','src/app/i18n.de.ts']) { const l = require('fs').readFileSync(f,'utf8').split('\r\n').find((x) => x.includes('chatProposalFailedRejected')); console.log(f, JSON.stringify(l)); }"
git ls-files --eol src/app/i18n.ts src/app/i18n.de.ts
```

Expected: the DE line prints `Nicht übernommen – jede Änderung darin wurde abgelehnt` with real ü, – and Ä. Both files show `w/crlf`.

- [ ] **Step 7: Implement the recommendation half (`use-insight-recommendations.ts`)**

Add the import after `import { describeRecommendationPlan } from "./insights/recommend-plan";`:

```ts
import { stripRejectedFields } from "./inline-ai-edit/plan";
```

In `confirmInsightRecommendation`, replace:

```ts
    let failed = 0;
    let stale = 0;
    let committed = 0;
    for (const call of calls) {
      try {
        await runTool(dispatcher, call.name, call.input as Record<string, unknown>);
        committed++;
```

with:

```ts
    let failed = 0;
    let stale = 0;
    let committed = 0;
    // ★★ §534 — calls whose every written field the review modal rejected. They
    //  are sent NOWHERE, so like a stale refusal they wrote nothing.
    let refused = 0;
    for (const call of calls) {
      // ★★★ §534 — strip against this call's OWN plan, from the SAME slices
      //  the modal's `reviewPlan` reads. That plan is the concatenation of these
      //  per-call plans (pinned in recommend-plan.test.ts), so what the modal
      //  showed as rejected is exactly what is not sent.
      const sent = stripRejectedFields(
        call.input,
        describeRecommendationPlan([call], { tasks, raid, changes, milestones, stakeholders }),
      );
      if (sent.writesNothing) {
        refused++;
        continue;
      }
      try {
        await runTool(dispatcher, call.name, sent.input);
        committed++;
```

Replace:

```ts
    if (committed === 0 && failed === 0 && stale > 0) {
      showToast("error", t(lang, "insightRecommendationStale"));
      return;
    }
```

with:

```ts
    // ★ A refused call wrote nothing either, so it joins the no-write case.
    //   The stale message still wins when both kinds occurred.
    if (committed === 0 && failed === 0 && (stale > 0 || refused > 0)) {
      showToast("error", t(lang, stale > 0 ? "insightRecommendationStale" : "insightRecommendationApplyFailed"));
      return;
    }
```

Replace:

```ts
    showToast(
      failed > 0 ? "error" : "info",
      t(lang, failed > 0 ? "insightRecommendationApplyFailed" : "insightRecommendationApplied"),
    );
  }, [insights, reviewInsightId, dispatcher, setInsights, setReviewInsightId, today, logActivityAs, showToast, lang]);
```

with:

```ts
    showToast(
      failed + refused > 0 ? "error" : "info",
      t(lang, failed + refused > 0 ? "insightRecommendationApplyFailed" : "insightRecommendationApplied"),
    );
  }, [insights, reviewInsightId, dispatcher, setInsights, setReviewInsightId, today, logActivityAs, showToast, lang, tasks, raid, changes, milestones, stakeholders]);
```

- [ ] **Step 8: Run the tests**

Run Step 3's command. Expected: `EXIT=0`, `Test Files  25 passed (25)`.

- [ ] **Step 9: Mutations**

Revert each mutant before the next, then check `git diff --stat` against the implemented state:

- MA (chat consumer): in `applyProposal`, change `runTool(dispatcher, guarded.name, sent.input)` to `runTool(dispatcher, guarded.name, guarded.input)`. Expected red: the §534 task and resource tests in `chat-proposal-apply.test.tsx`.
- MB (recommendation consumer): in `confirmInsightRecommendation`, change `runTool(dispatcher, call.name, sent.input)` to `runTool(dispatcher, call.name, call.input)`. Expected red: `lands the valid sibling and omits a rejected assigneeEmail`.
- MC (helper): in the `bad` closure, delete `, field: f`. Expected red: every `stripRejectedFields (§534)` test, plus row (iv) of `emails-write-parity.test.ts`.
- MD (writesNothing): in `applyProposal`, delete the `if (sent.writesNothing) { … }` block. Expected red: `a call whose every written field the card rejected is not sent`.

Name each mutant and its red tests in the task report.

- [ ] **Step 10: Docs**

`docs/AGENTS/ai-assistant.md`. Replace:

```
  reconstructs its patch from `plan.updates`) is the one that misfires; for a preview that REJECTS
  what apply stores, it is the two REPLAYING consumers (`chat-proposal-apply.ts`,
  `use-insight-recommendations.ts`), which resend the original `ProposedCall.input` and never read
  the plan. Neither is "the" data-loss path, and assuming one is how §384 was mis-scoped.
```

with:

```
  reconstructs its patch from `plan.updates`) is the one that misfires. The two REPLAYING consumers
  (`chat-proposal-apply.ts`, `use-insight-recommendations.ts`) resend the original
  `ProposedCall.input` minus every field the plan put in `plan.rejected` (`stripRejectedFields`,
  §534), so a preview that rejects a value the writer would ACCEPT now drops a legal edit, and a call
  whose every field was rejected is not sent at all. Neither is "the" data-loss path, and assuming one
  is how §384 was mis-scoped.
```

Close §534 (Global section R). Write `$SCRATCH/status-534.txt`:

```
**Status:** CLOSED 2026-09-19 by `fix/data-loss-batch`: `describeEntityCalls` now records the refused field on every field-level rejection, and `stripRejectedFields` (`inline-ai-edit/plan.ts`) removes those fields from a call before `applyProposal` and `confirmInsightRecommendation` dispatch it; a call left with nothing to write is not sent and reports as rejected (`chatProposalFailedRejected` on the card). Pinned by the §534 blocks in `chat-proposal-apply.test.tsx`, `use-insight-recommendations.test.tsx` and `plan.test.ts`, the merged-plan parity test in `recommend-plan.test.ts`, and row (iv) of the `emails-write-parity.test.ts` matrix.
```

Run `node "$SCRATCH/close-followup.cjs" 534 2026-09-19 "$SCRATCH/status-534.txt"`.

- [ ] **Step 11: Gates**

- vitest: Step 3's command → `EXIT=0`, `Test Files  25 passed (25)`.
- tsc → `EXIT=0`, `0`. This also enforces EN/DE key parity.
- `npx eslint --max-warnings=0 src/app/inline-ai-edit/plan.ts src/app/chat-proposal-apply.ts src/app/use-insight-recommendations.ts src/app/chat-proposal-block.tsx src/app/inline-ai-edit/plan.test.ts src/app/inline-ai-edit/emails-roundtrip.test.ts src/app/inline-ai-edit/emails-write-parity.test.ts src/app/chat-proposal-apply.test.tsx src/app/chat-proposal-block.test.tsx src/app/use-insight-recommendations.test.tsx src/app/insights/recommend-plan.test.ts` → `EXIT=0`.
- `npm run docs:symbols:check; echo "EXIT=$?"` → `EXIT=0`.
- The four register gates → all `EXIT=0`.

- [ ] **Step 12: Commit (Global section C)**

Subject: `fix(chat): §534 — Apply sends only the fields the card showed`
Body: `A card rejection now records the field it refuses; chat Apply and insight-recommendation confirm strip those fields before dispatch, so a sibling the card showed as landing is no longer lost to a whole-call throw. A call left with nothing to write is not sent and reports as rejected. Mutations MA-MD each turn a named test red.`
Paths: `src/app/inline-ai-edit/plan.ts src/app/chat-proposal-apply.ts src/app/use-insight-recommendations.ts src/app/chat-proposal-block.tsx src/app/i18n.ts src/app/i18n.de.ts src/app/inline-ai-edit/plan.test.ts src/app/inline-ai-edit/emails-roundtrip.test.ts src/app/inline-ai-edit/emails-write-parity.test.ts src/app/chat-proposal-apply.test.tsx src/app/chat-proposal-block.test.tsx src/app/use-insight-recommendations.test.tsx src/app/insights/recommend-plan.test.ts docs/AGENTS/ai-assistant.md docs/open-followups.md`

---

### Task 3: §546 — the confirm dialog discloses the other-granularity delete

**Files:**
- Modify: `src/app/timelog-apply.ts` (`ApplyDiffRow`, the new `otherGranularityRemovals`, `buildApplyPlan`, `writeAllocations`)
- Modify: `src/app/timelog-apply-confirm.tsx` (removal label)
- Modify: `src/app/i18n.ts`, `src/app/i18n.de.ts` (`timelogApplyRemoval`, by node script only)
- Test: `src/app/timelog-apply.test.ts`, `src/app/timelog-apply-confirm.test.tsx`
- Docs: `docs/AGENTS/integrations.md` (the "A dated Apply also removes" bullet), `docs/open-followups.md` (§546)

**Interfaces:**
- Produces: `ApplyDiffRow` gains `removal?: true`, which `ApplyDiffLabel` inherits. A removal row is `{ bucketId, allocIndex, period: <other-granularity key>, current: <its hours>, next: 0, removal: true }`.

- [ ] **Step 1: Write the failing tests**

`src/app/timelog-apply.test.ts`. Inside `describe("dated apply", …)`, after `keeps an other-granularity key that no applied day falls in (§543)`, add:

```ts
  it("lists the removal of a hand-typed month key that overlaps a weekly dated apply (§546)", () => {
    const agg = aggregateActuals([tItem(1, 9, "2026-06-10", 4)], links);
    const rows = planApply([bucketWith({ "2026-06": 10 })], bucketOverlay(agg, "week"), resources, roles);
    expect(rows).toContainEqual({ bucketId: 7, allocIndex: 0, period: "2026-06", current: 10, next: 0, removal: true });
    // Control: the routed week row is still listed beside it, unflagged.
    expect(rows).toContainEqual({ bucketId: 7, allocIndex: 0, period: "2026-W24", current: 0, next: 4 });
  });

  // §546 — the keys the dialog lists as removals ≡ the other-granularity keys
  // the write deletes. ONE function feeds both, and this is what pins it.
  it.each([
    { name: "weekly apply over a month key", hours: { "2026-06": 10, "2026-07": 8 }, g: "week" as const, days: ["2026-06-10"] },
    { name: "monthly apply over a week key", hours: { "2026-W24": 10, "2026-W30": 3 }, g: "month" as const, days: ["2026-06-10"] },
    { name: "weekly apply spanning two month keys", hours: { "2026-06": 5, "2026-07": 6 }, g: "week" as const, days: ["2026-06-30", "2026-07-01"] },
  ])("shows exactly the other-granularity keys it deletes: $name (§546)", ({ hours, g, days }) => {
    const agg = aggregateActuals(days.map((day, i) => tItem(i + 1, 9, day, 4)), links);
    const ov = bucketOverlay(agg, g);
    const before = [bucketWith(hours)];
    const shown = planApply(before, ov, resources, roles).filter((r) => r.removal).map((r) => r.period).sort();
    const after = applyActualsToBuckets(before, ov, resources, roles)[0].allocations[0].actualHours;
    const deleted = Object.keys(hours).filter((k) => !(k in after)).sort();
    expect(shown.length).toBeGreaterThan(0); // anti-vacuity
    expect(shown).toEqual(deleted);
  });
```

`src/app/timelog-apply-confirm.test.tsx`. Append inside `describe("TimelogApplyConfirm", …)`:

```tsx
  // §546 — a removal row is LABELLED as one, beside an ordinary row that is not.
  it("labels an other-granularity removal row, and only that row", () => {
    const removal: ApplyDiffLabel = { ...ROW, period: "2026-06", current: 6, next: 0, removal: true };
    render(<TimelogApplyConfirm lang="en-US" rows={[ROW, removal]} onApply={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "Bucket A · Design · 2026-W30: 10 → 14",
      `Bucket A · Design · 2026-06: 6 → 0 (${t("en-US", "timelogApplyRemoval")})`,
    ]);
  });
```

- [ ] **Step 2: Run the tests and verify they fail**

Run (Global section V) on these 8 files: `src/app/timelog-apply.test.ts src/app/timelog-apply-confirm.test.tsx src/app/timelog-reapply.test.ts src/app/timelog-guards.test.ts src/app/timelog-panel.test.tsx src/app/budget-unapplied-notice.test.tsx src/app/i18n-encoding.test.ts src/app/i18n.test.ts`
Expected: `EXIT=1`. The new §546 tests fail: there are no removal rows, and `timelogApplyRemoval` is missing.

- [ ] **Step 3: Implement `timelog-apply.ts`**

In `ApplyDiffRow`, after `next: number;` add:

```ts
  /** §546 — this row DELETES an other-granularity bare period key (the §543
   *  rule) instead of rewriting a routed period. `next` is always 0. Absent on
   *  every routed row. */
  removal?: true;
```

After `function indexes(…) { … }`, add:

```ts
/**
 * §546 — the OTHER-granularity bare period keys a dated Apply deletes from ONE
 * line (the §543 rule: a dated Apply owns every covered day, so a bare key of
 * the other granularity containing one of those days is stale hand input).
 *
 * ★★★ ONE FUNCTION, TWO READERS. `writeAllocations` deletes exactly these and
 * `buildApplyPlan` lists exactly these as removal rows, so the confirm dialog and
 * the write cannot drift. The whole lump sum goes, not a share of it: a bare
 * period key has no day breakdown, so splitting it would be a guess shown as data.
 * ★ Keys absent from the line are omitted — deleting one is a no-op, and listing
 * it would disclose the removal of nothing.
 */
function otherGranularityRemovals(
  actualHours: Readonly<Record<string, number>>,
  routed: Routed,
  allocIndex: number,
): string[] {
  const days = routed.perAllocDays.get(allocIndex);
  const keys = new Set<string>();
  for (const period of routed.periods) {
    if (routed.undatedPeriods.has(period)) continue;
    const own = granularityOfPeriodKey(period);
    const other = own === "month" ? "week" : own === "week" ? "month" : null;
    if (!other) continue;
    for (const day of Object.keys(days?.[period] ?? {})) {
      const key = periodKeyForDate(day, other);
      if (Object.prototype.hasOwnProperty.call(actualHours, key)) keys.add(key);
    }
  }
  return [...keys];
}
```

In `buildApplyPlan`, replace:

```ts
        if (current !== next) rows.push({ bucketId: b.id, allocIndex: i, period, current, next });
      }
    });
```

with:

```ts
        if (current !== next) rows.push({ bucketId: b.id, allocIndex: i, period, current, next });
      }
      // §546 — every other-granularity key the write deletes, from the SAME
      // function `writeAllocations` deletes by, so the dialog discloses it.
      for (const key of otherGranularityRemovals(a.actualHours, routed, i)) {
        rows.push({ bucketId: b.id, allocIndex: i, period: key, current: round2(a.actualHours[key]), next: 0, removal: true });
      }
    });
```

In `writeAllocations`, replace:

```ts
    let nextActual: Record<string, number> = { ...a.actualHours };
    for (const period of routed.periods) {
      // Apply OWNS the period: its hand-typed period key and every day key inside
      // it are replaced, whether or not this line routed anything.
      nextActual = withoutPeriod(nextActual, period);
      if (routed.undatedPeriods.has(period)) {
        nextActual[period] = rec?.[period] ?? 0;
      } else {
        // §543: a dated Apply owns every covered DAY, so a bare period key of
        // the OTHER granularity that contains one of those days is stale hand
        // input and would be summed on top of the day keys after a switch back.
        const own = granularityOfPeriodKey(period);
        const other = own === "month" ? "week" : own === "week" ? "month" : null;
        for (const [day, h] of Object.entries(days?.[period] ?? {})) {
          if (other) delete nextActual[periodKeyForDate(day, other)];
          nextActual[day] = h;
        }
      }
    }
```

with:

```ts
    let nextActual: Record<string, number> = { ...a.actualHours };
    // §543/§546: the other-granularity bare keys this Apply removes. They are
    // exactly the removal rows `buildApplyPlan` showed, because both read
    // `otherGranularityRemovals`. Deleting them up front equals deleting them
    // inside the loop below: `withoutPeriod` and the day writes touch only keys
    // of the routed period's own granularity.
    for (const key of otherGranularityRemovals(a.actualHours, routed, i)) delete nextActual[key];
    for (const period of routed.periods) {
      // Apply OWNS the period: its hand-typed period key and every day key inside
      // it are replaced, whether or not this line routed anything.
      nextActual = withoutPeriod(nextActual, period);
      if (routed.undatedPeriods.has(period)) {
        nextActual[period] = rec?.[period] ?? 0;
      } else {
        for (const [day, h] of Object.entries(days?.[period] ?? {})) nextActual[day] = h;
      }
    }
```

- [ ] **Step 4: Implement the dialog and i18n**

`timelog-apply-confirm.tsx`. At the end of the header comment block, after `// do not reduce this back to a count.`, add:

```tsx
// ★ §546: a dated Apply also DELETES any bare period key of the other
// granularity that one of its routed days falls in. Those keys are listed too,
// as removal rows labelled `timelogApplyRemoval`, so that loss is disclosed here
// before the user confirms.
```

Replace:

```tsx
          {rows.map((r) => (
            <li key={`${r.bucketId}:${r.allocIndex}:${r.period}`} className="tabular-nums">
              {[r.bucketName, r.lineName, r.period].filter(Boolean).join(" · ")}
              {": "}
              {r.current} → <span className="font-medium text-foreground">{r.next}</span>
            </li>
          ))}
```

with:

```tsx
          {rows.map((r) => (
            <li key={`${r.bucketId}:${r.allocIndex}:${r.period}${r.removal ? ":removal" : ""}`} className="tabular-nums">
              {[r.bucketName, r.lineName, r.period].filter(Boolean).join(" · ")}
              {": "}
              {r.current} → <span className="font-medium text-foreground">{r.next}</span>
              {r.removal && <> ({t(lang, "timelogApplyRemoval")})</>}
            </li>
          ))}
```

i18n. Write `$SCRATCH/patch-i18n-546.cjs` with the Write tool:

```js
// patch-i18n-546.cjs — run from the repo root.
"use strict";
const fs = require("fs");
function insertAfter(path, anchor, line) {
  const src = fs.readFileSync(path, "utf8");
  const hits = src.split(anchor).length - 1;
  if (hits !== 1) throw new Error(`${path}: anchor found ${hits} times, expected 1`);
  if (src.includes(line)) throw new Error(`${path}: already patched`);
  fs.writeFileSync(path, src.replace(anchor, () => anchor + line), "utf8");
}
insertAfter(
  "src/app/i18n.ts",
  '  timelogApplyConfirm: "Apply {0} bucket changes to budget actual hours?",\r\n',
  '  timelogApplyRemoval: "removed: a hand-entered total for the other period type",\r\n',
);
insertAfter(
  "src/app/i18n.de.ts",
  '  timelogApplyConfirmOne: "1 Bucket-\u00c4nderung auf die Ist-Stunden des Budgets anwenden?",\r\n',
  '  timelogApplyRemoval: "entfernt: eine von Hand eingetragene Summe f\u00fcr den anderen Zeitraumtyp",\r\n',
);
console.log("patched");
```

Run it. Then verify with the same `node -e` / `git ls-files --eol` pair as in Task 2 Step 6, with `timelogApplyRemoval` as the key. Expected: a real `ü` in `für`, and `w/crlf` on both files.

- [ ] **Step 5: Run the tests**

Run Step 2's command. Expected: `EXIT=0`, `Test Files  8 passed (8)`.

The existing §543 test `removes a hand-typed month key that overlaps a weekly dated apply (§543)` stays unchanged and green.

- [ ] **Step 6: Mutations**

- ME (emission): in `buildApplyPlan`, delete the `for (const key of otherGranularityRemovals(…)) { rows.push(…) }` loop. Expected red: `lists the removal…` and all three parity rows (anti-vacuity). Revert.
- MF (drift): in `writeAllocations`, change the delete loop's source to `otherGranularityRemovals({}, routed, i)`. The write then deletes nothing while the plan still lists removals. Expected red: the three parity rows (`shown` non-empty, `deleted` empty) and the existing §543 removal tests. Revert.
- MG (label): delete `{r.removal && <> ({t(lang, "timelogApplyRemoval")})</>}`. Expected red: `labels an other-granularity removal row…`. Revert.

- [ ] **Step 7: Docs**

`docs/AGENTS/integrations.md`. In the `★ A dated Apply also removes the OTHER granularity's bare period key` bullet, replace:

```
`TimelogApplyConfirm` itemizes only the routed role-line diffs (`describeApplyRows`); it does NOT list this key's removal, so nothing in the confirm dialog tells the user the other-granularity figure is about to disappear.
```

with:

```
Since §546 the removal is DISCLOSED: `otherGranularityRemovals` (`timelog-apply.ts`) is the one list that `writeAllocations` deletes and `buildApplyPlan` emits as removal rows (current hours → 0), and `TimelogApplyConfirm` renders those rows labelled `timelogApplyRemoval` — so the dialog and the write cannot drift. The lump sum itself is still deleted whole: re-keying it into days would be a guess shown as data.
```

Close §546 (Global section R). Write `$SCRATCH/status-546.txt`:

```
**Status:** CLOSED 2026-09-19 by `fix/data-loss-batch`: option (a) — `otherGranularityRemovals` (`timelog-apply.ts`) is now the single source of the other-granularity keys a dated Apply deletes; `writeAllocations` deletes exactly those and `buildApplyPlan` lists exactly those as removal rows, which `TimelogApplyConfirm` renders labelled `timelogApplyRemoval`. Option (b), re-keying the total into days, stays ruled out. Pinned by the §546 tests in `timelog-apply.test.ts` (the removal row, and shown-removals ≡ deleted keys over three shapes) and `timelog-apply-confirm.test.tsx`.
```

Run `node "$SCRATCH/close-followup.cjs" 546 2026-09-19 "$SCRATCH/status-546.txt"`.

- [ ] **Step 8: Gates**

- vitest: Step 2's command → `EXIT=0`, `Test Files  8 passed (8)`.
- tsc → `EXIT=0`, `0`.
- `npx eslint --max-warnings=0 src/app/timelog-apply.ts src/app/timelog-apply-confirm.tsx src/app/timelog-apply.test.ts src/app/timelog-apply-confirm.test.tsx` → `EXIT=0`.
- `npm run docs:symbols:check; echo "EXIT=$?"` → `EXIT=0`.
- The four register gates → all `EXIT=0`.

- [ ] **Step 9: Commit (Global section C)**

Subject: `fix(timelog): §546 — the apply dialog discloses the other-granularity removal`
Body: `A dated Apply deleted a hand-typed other-granularity period key the confirm dialog never listed. One function now yields those keys for both the write and the dialog, which shows them as labelled removal rows. Mutations ME, MF and MG each turn a named test red.`
Paths: `src/app/timelog-apply.ts src/app/timelog-apply-confirm.tsx src/app/i18n.ts src/app/i18n.de.ts src/app/timelog-apply.test.ts src/app/timelog-apply-confirm.test.tsx docs/AGENTS/integrations.md docs/open-followups.md`

---

### Task 4: §548 — no edits while a load or project swap is pending

#### 4.0 Writer inventory (read-only survey, done while planning, at `0efaf771`)

**Survey commands.** Run these from `C:/Projects/aipm-wt-a` to reproduce the table:

```bash
# (1) The 29 workspace-context setters. Prints 29.
N=$(grep -oE "^\s+set[A-Za-z]+: Dispatch<" src/app/workspace-context.tsx | sed -E 's/^\s+set([A-Za-z]+):.*/\1/' | paste -sd'|'); echo "$N" | tr '|' '\n' | wc -l
# (2) Files that CALL one of them outside tests. Prints 43 at 0efaf771, including the three local-state
#     false positives named below.
grep -rlE "\bset($N)\(" src/app --include=*.ts --include=*.tsx | grep -v "\.test\.\|test-providers" | wc -l
# (3) Every call site, with its nearest enclosing declaration.
node - $(grep -rlE "\bset($N)\(" src/app --include=*.ts --include=*.tsx | grep -v "\.test\.\|test-providers") <<'SCAN'
const fs = require("fs");
const N = "Tasks|Raid|Absences|Shifts|Resources|Roles|Disciplines|Grades|Plan|Budgets|FxRates|Status|Project|FieldVisibility|Features|Milestones|Changes|Stakeholders|SteeringCommittee|TimelogLinks|KnowledgeItems|Insights|Documents|DocumentVersions|SettingsOverrides|CalendarEvents|DocumentAssets|ActivityLog|BudgetHistory";
const CALL = new RegExp(`\\bset(${N})\\(`);
const DECL = /^\s*(?:export\s+)?(?:const|let|function|async function)\s+([A-Za-z0-9_]+)|^\s{2,6}([A-Za-z0-9_]+):\s*(?:guardEdit\(|\(|async|useCallback)/;
for (const f of process.argv.slice(2)) {
  let fn = "?";
  fs.readFileSync(f, "utf8").split(/\r?\n/).forEach((l, i) => {
    const d = DECL.exec(l); if (d) fn = d[1] ?? d[2];
    if (/^\s*(\/\/|\*)/.test(l)) return;
    const m = CALL.exec(l); if (m) console.log(`${f}:${i + 1} [${fn}] set${m[1]}`);
  });
}
SCAN
# (4) Setters passed as VALUES (undo `setter:` captures, props) — the scan in (3) cannot see these.
grep -rnE "(=|:|\()\s*(ws\.)?set($N)\b\s*[,}\)]|=\{(ws\.)?set($N)\}" src/app --include=*.ts --include=*.tsx | grep -v "\.test\.\|test-providers\|Dispatch<\|workspace-context.tsx"
# (5) Setter calls lexically inside useEffect / setTimeout / setInterval — BACKGROUND triggers.
#     Prints exactly one hit at 0efaf771: task-manager.tsx's insight reconcile timer.
node - $(grep -rlE "\bset($N)\(" src/app --include=*.ts --include=*.tsx | grep -v "\.test\.\|test-providers") <<'SCAN'
const fs = require("fs");
const N = "Tasks|Raid|Absences|Shifts|Resources|Roles|Disciplines|Grades|Plan|Budgets|FxRates|Status|Project|FieldVisibility|Features|Milestones|Changes|Stakeholders|SteeringCommittee|TimelogLinks|KnowledgeItems|Insights|Documents|DocumentVersions|SettingsOverrides|CalendarEvents|DocumentAssets|ActivityLog|BudgetHistory";
const CALL = new RegExp(`\\bset(${N})\\(`), OPEN = /\b(useEffect|useLayoutEffect|setTimeout|setInterval)\(/;
for (const f of process.argv.slice(2)) {
  const stack = []; let depth = 0;
  fs.readFileSync(f, "utf8").split(/\r?\n/).forEach((l, i) => {
    const code = l.replace(/\/\/.*$/, "");
    if (OPEN.test(code)) stack.push({ depth, line: i + 1 });
    if (CALL.test(code) && stack.length) console.log(`${f}:${i + 1} inside opener @${stack[stack.length - 1].line}`);
    for (const ch of code) { if (ch === "{" || ch === "(") depth++; else if (ch === "}" || ch === ")") depth--; }
    while (stack.length && depth <= stack[stack.length - 1].depth) stack.pop();
  });
}
SCAN
# (6) Indirect background triggers: hooks with intervals, visibility/message listeners, broadcast channels.
grep -rlE "setInterval\(|addEventListener\(\"(message|storage|visibilitychange)\"|BroadcastChannel" src/app --include=*.ts --include=*.tsx | grep -v "\.test\."
grep -rln "addEventListener(\"keydown\"" src/app --include=*.ts --include=*.tsx | grep -v "\.test\."
# (7) The guardEdit rows, the AI tool-dispatch sites, the document mutation path, the load funnel.
grep -n "guardEdit(" src/app/task-manager.tsx
grep -rn "runTool(" src/app --include=*.ts --include=*.tsx | grep -v "\.test\.\|^src/app/chat-tools.ts"
grep -rn "mutateDocuments(" src/app --include=*.ts --include=*.tsx | grep -v "\.test\."
grep -rn "applyWorkspace(" src/app --include=*.ts | grep -v "\.test\."
```

Scan false positives, which are not workspace writers: `setFeatures` in `create-project-wizard.tsx`, `setStatus` in `jira-settings.tsx`, and `setPlan` in `use-inline-entity-edit.ts` are each component-local `useState` setters with the same name.

**Popout windows are out of scope.** Their edits never persist, because the save effect returns for `args.isPopout` and `canSend` is false.

**The reference write is not a row.** The load effect's `applyWorkspace(workspace, "reset", "merge")` in `use-storage-backend.ts` is the write every row below races. The §548 window is defined by it.

**The signal, proved by reading the load effect.** One run of the load effect (`useEffect(…, [backend, args.hydrated])`) ends in exactly one of these branches:

| branch | `loadedBackend` today | `settledBackend` (new) | why |
|---|---|---|---|
| `!args.hydrated` early return | — | — | a load will start; still pending |
| suppress branch (`suppressNextLoadRef`) | stamped | stamped | an op already put this backend's workspace in scope |
| success (`applyWorkspace` → stamps inside it) | stamped | stamped | landed |
| `cancelled` after `await backend.load()` | — | — | superseded; the newer run stamps |
| empty-load refusal (`isWorkspaceEmpty` guard) | — | stamped | nothing applied, but nothing is in flight |
| `catch` | — | stamped | nothing is in flight; holding would lock the session |

**Legend (exactly one label per row).**
- `guardEdit`: already wrapped by `guardEdit` at the `workspaceProps` site. It is UI-reachable only, and while `loadPending` is true it is unmounted by the hold like every other UI writer. `makeEditGuard` itself is unchanged (Spec correction 1).
- `gate-new`: gated by this task. **H** means the render hold (4b): the entry point is reachable only from a control inside the held tree. **E** means an explicit `loadPending` check (4b/4c): a background writer that does not unmount. **S** means the swap hold, `holdDuring` (4a).
- `starts-after-load`: shown to start only after the load, with evidence.
- `not-a-workspace-writer`: writes nothing the pending load can discard. It either writes non-workspace state, writes a slice the load MERGES rather than replaces, only mirrors another window's already-persisting state, or cannot run before the load with anything to lose (evidence given).

**guardEdit rows (33).** Each is one `guardEdit(` site in `task-manager.tsx`'s `workspaceProps`:

| # | prop | wrapped handler |
|---|---|---|
| G01 | `handleGanttBarUpdate` | `handleGanttBarUpdate` (`use-gantt-handlers.ts`) |
| G02 | `handleSaveRaidItem` | `use-resource-planner.ts` |
| G03 | `handleDeleteRaidItem` | `use-resource-planner.ts` |
| G04 | `handleSaveChange` | `use-change-log.ts` |
| G05 | `handleDeleteChange` | `use-change-log.ts` |
| G06 | `handleChangeStatusChange` | `use-change-log.ts` |
| G07 | `handleSaveStakeholder` | `use-stakeholders.ts` |
| G08 | `handleDeleteStakeholder` | `use-stakeholders.ts` |
| G09 | `handleCreateMitigationTaskFromRaid` | `use-resource-planner.ts` |
| G10 | `handleClearActivityLog` | `use-activity-log.ts` |
| G11 | `handleOpenAddAbsence` | opener (`use-resource-planner.ts`) |
| G12 | `handleEditAbsence` | opener (`use-resource-planner.ts`) |
| G13 | `handleMoveAbsence` | `buildMoveAbsenceHandler` (`absence-move-handler.ts`) |
| G14 | `handleOpenAddCalendarEvent` | opener (`use-calendar-events.ts`) |
| G15 | `handleEditCalendarEvent` | opener (`use-calendar-events.ts`) |
| G16 | `handleSaveCalendarEvent` | `use-calendar-events.ts` (band drag path) |
| G17 | `handleOpenShiftEditor` | opener (`use-resource-planner.ts`) |
| G18 | `onAssignRoleById` | `handleAssignRoleById` (`use-reference-data.ts`) |
| G19 | `onSetUtilization` | `handleSetUtilization` |
| G20 | `onReassignTask` | inline `setTasks` (task-manager) |
| G21 | `onRescheduleTask` | inline `setTasks` (task-manager) |
| G22 | `onClearUnlinked` | inline `setTasks`/`setRaid`/`setAbsences`/`setShifts` (task-manager) |
| G23 | `onSetAllUtilizationMode` | `handleSetAllUtilizationMode` |
| G24 | `onSetAbsenceOverride` | `handleSetAbsenceOverride` |
| G25 | `onSetPlanWindow` | `handleSetPlanWindow` |
| G26 | `onSetBudgetFollowsPlan` | `handleSetBudgetFollowsPlan` |
| G27 | `onEditResource` | `handleEditResource` (`use-resource-directory.ts`) |
| G28 | `onBulkEditResources` | `handleBulkEditResources` |
| G29 | `onBulkDeleteResources` | `handleBulkDeleteResources` |
| G30 | `onAddResource` | `handleOpenAddResource` |
| G31 | `onImportOutlook` | `handleOpenOutlookImport` |
| G32 | `onImportOutlookCalendar` | `handleOpenCalendarImport` |
| G33 | `onChangeBudgets` | `commitBuckets` (`use-budget-buckets.ts`) |

**All other writers (63).**

| # | writer (entry point) | file | writes | trigger | label |
|---|---|---|---|---|---|
| W01 | `handleApplyTemplate` (template apply) | `task-manager.tsx` | fieldVisibility, features, tasks, milestones, raid, changes, stakeholders, budgets | shell-chrome menu | gate-new H |
| W02 | `handleCommitFeatures` | `task-manager.tsx` | features | Settings mode / modules | gate-new H |
| W03 | `onAcknowledgeInsight` / `onActInsight` / `onInsightLoggedAsRaid` / `onDismissInsight` | `task-manager.tsx` | insights | insight cards | gate-new H |
| W04 | `applyRestoredWorkspace` (version restore) | `task-manager.tsx` | 24 slices | version-history view | gate-new H |
| W05 | `handleCreateResource` | `task-manager.tsx` | resources | resource picker "create" | gate-new H |
| W06 | `applyRaidFromTask` / `applyLinkFromTask` / `handleCreateLinkedTask` | `task-manager.tsx` | raid, tasks | task editor | gate-new H |
| W07 | `cacheFxRates` via `onRefreshFx` | `task-manager.tsx` | fxRates | FX refresh button (`useFxRates` has no effect) | gate-new H |
| W08 | `handleUpdateCurrentProject` / `handleUpdateCurrentProjectByMode` | `task-manager.tsx`, `use-turso-projects.ts` | project | projects panel edit | gate-new H |
| W09 | `onTimelogLinksChange` | `task-manager.tsx` (`settingsViewEl`) | timelogLinks | Settings policy | gate-new H |
| W10 | `handleSubmit` | `use-task-submit.ts` | tasks, raid | task modal | gate-new H |
| W11 | row handlers (status, delete, swimlane drop, inquiry, inline commits) | `use-task-row-handlers.ts` | tasks | Open Points rows / board | gate-new H |
| W12 | `onInlinePatch` / `onAssignFromCard` / `removeLane` / `setTasksForPush` | `tasks-section.tsx` | tasks | table, board, Outlook task push | gate-new H |
| W13 | `applyBulkEdit` / `handleBulkDelete` / `handleBulkSendInquiry` / `handleClearAll` (bulk ops) | `use-bulk-operations.ts` | tasks | bulk bar, Clear all dialog | gate-new H |
| W14 | `handleCommand` (voice commands) | `use-bulk-operations.ts` via `VoiceCommandProvider` | tasks | voice button (in tree) | gate-new H |
| W15 | dedup `onConfirm` | `use-tasks-dedup.tsx` | tasks | dedup modal (tasks, gantt) | gate-new H |
| W16 | `commitNoteLog` | `use-notes-window.ts` | tasks, raid, changes | notes window | gate-new H |
| W17 | `handleSaveAbsence` / `handleDeleteAbsence` / `handleSaveShift` / `handleDeleteShift` / `handleImportAbsences` / `handleSetPlanGranularity` / `handleSendRaidInquiry` | `use-resource-planner.ts` | absences, shifts, plan, raid | modals, planning grid | gate-new H |
| W18 | roles/disciplines/grades handlers (`handleSaveRole` … `onReorderGrades`, `handleAssignResourceRole`, `handleClearResourceRole`) | `use-reference-data.ts` via `RolesPanel` | roles, disciplines, grades, resources | Manage roles | gate-new H |
| W19 | `handleSaveResource` / `handleDeleteResource` / `handleImportResources` (+ `commitEmailPropagation`) | `use-resource-directory.ts`, `resource-email-propagation-commit.ts` | resources, absences, shifts, tasks, raid, stakeholders, project | resource modal, Outlook import | gate-new H |
| W20 | calendar-event modal save / `handleDeleteCalendarEvent` | `use-calendar-events.ts` | calendarEvents | calendar-event modal | gate-new H |
| W21 | knowledge edits (`patch`, standalone items) | `knowledge-panel.tsx` | tasks, raid, changes, milestones, stakeholders, project, knowledgeItems | Knowledge view | gate-new H |
| W22 | save / delete / `toggleAchieved` / `applyBulk` | `milestones-panel.tsx` | milestones | Milestones view | gate-new H |
| W23 | RAG status + narrative commit/clear | `dashboard-sections/dashboard-hero.tsx`, `dashboard-narrative.tsx` | status | Dashboard | gate-new H |
| W24 | field-visibility controls | `use-modal-visibility.ts` | fieldVisibility | modal field controls | gate-new H |
| W25 | `setPolicy` | `settings-sections/project-overrides-section.tsx` | settingsOverrides | Settings | gate-new H |
| W26 | `setLinks`, managed-projects load, `applyToBudget` | `timelog-panel.tsx` | timelogLinks, budgets | TimeLog view | gate-new H |
| W27 | `commitBuckets` via `useTaskBudgetLink` | `use-budget-buckets.ts` | budgets, budgetHistory | task editor bucket link | gate-new H |
| W28 | action-center handlers (assign, mark done, clear blocker, reschedule, escalate, rebaseline, create task, draft) | `use-action-center-handlers.ts` | tasks, raid, milestones | Next actions | gate-new H |
| W29 | meeting-report actions | `use-meeting-report-actions.ts` | steeringCommittee | steering committee | gate-new H |
| W30 | AI allocation plan `onConfirm` | `use-alloc-plan.tsx` | resources | Resources panel | gate-new H |
| W31 | `handleJiraSync` / `handleResolveConflicts` | `use-jira-sync.ts` | tasks | Jira sync button, conflict modal | gate-new H |
| W32 | manual Outlook push/pull (milestones, committee, task/RAID/change/absence buttons and pulls) | `use-outlook-calendar-push.ts`, `use-milestone-calendar-pull.ts`, `use-committee-outlook-push.ts`, interactive `use-entity-calendar-push/pull.ts` | milestones, steeringCommittee, tasks, raid, changes, absences | calendar sync controls | gate-new H |
| W33 | `mutateDocuments` + document assets | `workspace-context.tsx` via `documents-panel.tsx`, history modal, `workspace-panels.tsx` | documents, documentVersions, documentAssets | Documents view | gate-new H |
| W34 | chat agent loop (AI tool dispatch) | `chat-panel.tsx` → `use-chat-dispatcher.ts` / `use-register-tools.ts` | every register | chat send | gate-new H |
| W35 | chat Apply, `applyProposal` | `chat-proposal-apply.ts` | every register | proposal card Apply | gate-new H |
| W36 | inline AI edit apply | `use-inline-entity-edit.ts` → `runTool` | every register | inline popover | gate-new H |
| W37 | insight-recommendation confirm / reject | `use-insight-recommendations.ts` | registers, insights | review modal | gate-new H |
| W38 | undo/redo from the UI (toast action, undo history) | `undo/use-undo-stack.ts` captured setters | any captured slice | toast / history panel | gate-new H |
| W39 | steering-committee edits | `workspace-section.tsx` (`onChange={setSteeringCommittee}`) | steeringCommittee | Steering committee view | gate-new H |
| W40 | insight reconcile effect (debounced 4 s) | `task-manager.tsx` | insights | `useEffect` + `setTimeout` (hydrated only) | gate-new E (4b) |
| W41 | `applyInsightRecommendation` (background runner + on-demand generate) | `use-insight-recommendations.ts` | insights | `useInsightRecommendRunner` mount tick / interval / visibility | gate-new E (4c) |
| W42 | calendar auto-sync push ×4 (task, RAID, change, absence) | `use-calendar-integrations.ts` → `useCalendarAutoSync` + non-interactive `useEntityCalendarPush` | tasks, raid, changes, absences (`outlookEventId`) | content-key debounce | gate-new E (4c) |
| W43 | calendar auto-pull (4 background pulls + runner) | `use-calendar-integrations.ts` → `useCalendarAutoPull` / background `useEntityCalendarPull` | tasks, raid, changes, absences | mount tick, 15 min interval, visibility | gate-new E (4c) |
| W44 | undo/redo hotkey | `task-manager.tsx` → `useUndoHotkey` (document `keydown`) | any captured slice | Ctrl/Cmd+Z/Y, not unmounted by the hold | gate-new E (4b) |
| W45 | `reloadCurrentProject` | `use-storage-backend.ts` | all (`applyWorkspace` raise/merge) | reload affordance | gate-new S |
| W46 | `switchToProject` | `use-storage-file-ops.ts` | all | project picker | gate-new S |
| W47 | `createProject` | `use-storage-file-ops.ts` | all | create wizard | gate-new S |
| W48 | `loadProjectFromFile` (import) | `use-storage-file-ops.ts` | all | load from file | gate-new S |
| W49 | `createDemoProject` | `use-storage-file-ops.ts` | all | demo | gate-new S |
| W50 | `onOpenStorageFile` (import) | `use-storage-file-ops.ts` | tasks, raid | open storage file | gate-new S |
| W51 | `switchToTursoProject` | `use-storage-turso-ops.ts` | all | project picker | gate-new S |
| W52 | `createTursoProject` | `use-storage-turso-ops.ts` | all | create wizard | gate-new S |
| W53 | `migrateCurrentProjectToTurso` | `use-storage-turso-ops.ts` | copies, then `window.location.reload()` | projects panel | gate-new S |
| S01 | snapshot capture | `use-snapshots.ts` | its own `snapshots` state + the Turso snapshot store, no workspace slice | effect | starts-after-load — `task-manager.tsx` passes `workspaceReady: workspaceLoaded` to `useSnapshots` |
| N01 | 29 broadcast receivers | `use-storage-backend.ts` (`useBroadcastSync(kind, value, setX, canSend)`) | every slice | `BroadcastChannel` message | not-a-workspace-writer — a mirror; the ORIGIN window's save effect persists the edit |
| N02 | activity-log appends (`logActivity`, `logActivityChanges`, `logActivityAs`, `logActivityChangesAs`) | `use-activity-log.ts` | activityLog | called by other rows | not-a-workspace-writer — the first load applies activityLog with `logMode` "merge" (`mergeActivityLogs`), so appends survive; every caller is itself a row |
| N03 | day-basis roles re-derivation (`workdayHoursNow` reconcile) | `task-manager.tsx` | roles | render-time, on a device-setting change | not-a-workspace-writer — before the first load lands `roles` is the empty pre-load list, so it re-derives nothing the load could discard; the only in-app trigger (Settings) is held |
| N04 | scheduled AI jobs | `use-scheduled-job-runner.ts` | the job run log via `recordRun` (`use-scheduled-jobs.ts`) | 5 min tick | not-a-workspace-writer — no tool dispatch (the `runTool` survey in (7) has no hit here) |
| N05 | version-history idle checkpoint | `use-version-history.ts` | Turso versions store | storage outcome | not-a-workspace-writer |
| N06 | `useFeaturesSync` | `task-manager.tsx` | device `settings.features` | effect | not-a-workspace-writer |
| N07 | TimeLog actuals cache (`saveActualsCache`) | `use-timelog-sync.ts` | per-device localStorage | fetch | not-a-workspace-writer |
| N08 | `onRequestStorageSwitch` / `onPickStorageFile` / `onGrantWriteAccess` | `use-storage-file-ops.ts` | the backend or a file handle, never render-scope state | Settings storage controls | not-a-workspace-writer — the switch saves the LIVE workspace to the target, and its follow-up load is suppressed, so nothing replaces an edit |
| N09 | `archiveTursoProject` / `restoreTursoProject` / `hardDeleteTursoProject` | `use-storage-turso-ops.ts` | portfolio registry rows | projects panel | not-a-workspace-writer |

**Counts:** `guardEdit` 33 · `gate-new` 53 (H 39, E 5, S 9) · `starts-after-load` 1 · `not-a-workspace-writer` 9. That is 96 rows.

**Project switch: decided and included** (Spec correction 3). A settings-driven backend change re-runs the load effect, so the identity derivation covers it. The nine op rows W45–W53 are held by `holdDuring`.

---

### Task 4a: §548 — publish `loadPending` from `useStorageBackend`

**Files:**
- Modify: `src/app/use-storage-backend.ts`
- Test: `src/app/use-storage-backend.test.tsx`

**Interfaces:**
- Produces: `useStorageBackend(...).loadPending: boolean`. It is true from mount until the load effect for the CURRENT `backend` reaches a terminal branch, and true while any `holdDuring`-wrapped op is in flight. The nine ops keep their names and signatures in the returned object, now wrapped.

- [ ] **Step 1: Write the failing tests**

Append to `src/app/use-storage-backend.test.tsx`, after the `describe("useStorageBackend — workspaceLoaded (snapshot-capture gate)", …)` block:

```tsx
// §548 — the edit hold's signal. Deliberately NOT `workspaceLoaded`: a failed
// load must RELEASE it (nothing is in flight to overwrite an edit), where the
// snapshot gate correctly stays shut.
describe("useStorageBackend — loadPending (§548 edit hold)", () => {
  // A macrotask flush: one microtask is not always enough for a rejected load's `catch` to run.
  const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

  beforeEach(() => {
    vi.clearAllMocks();
    (storageMod.createBackend as ReturnType<typeof vi.fn>).mockReturnValue(mockBackend);
  });

  it("is true while the first load is in flight", async () => {
    mockBackend.load.mockImplementation(() => new Promise(() => {})); // never resolves
    const { result } = renderBackend();
    await flush();
    expect(mockBackend.load).toHaveBeenCalled(); // control: the load really started
    expect(result.current.loadPending).toBe(true);
  });

  it("drops once the first load has been applied", async () => {
    mockBackend.load.mockResolvedValue({ ...storageMod.emptyWorkspace(), tasks: [{ id: 1, taskName: "Real" }] });
    const { result } = renderBackend();
    await flush();
    expect(result.current.tasks).toHaveLength(1); // control: it dropped BECAUSE data landed
    expect(result.current.loadPending).toBe(false);
  });

  it("drops when the load FAILS — unlike workspaceLoaded, which stays shut", async () => {
    mockBackend.load.mockRejectedValue(new Error("turso down"));
    const onStorageOutcome = vi.fn();
    const { result } = renderBackend(makeArgs({ onStorageOutcome }));
    await flush();
    expect(onStorageOutcome).toHaveBeenCalledWith(expect.any(Error)); // control: the catch ran
    expect(result.current.workspaceLoaded).toBe(false);
    expect(result.current.loadPending).toBe(false);
  });

  it("rises again when the backend changes, until the new load lands", async () => {
    let resolveB: (workspace: unknown) => void = () => {};
    const backendB = {
      load: vi.fn(() => new Promise((resolve) => { resolveB = resolve as (workspace: unknown) => void; })),
      save: vi.fn().mockResolvedValue(undefined),
      isReady: vi.fn().mockResolvedValue(true),
      describe: vi.fn().mockResolvedValue("project-b.json"),
    };
    mockBackend.load.mockResolvedValue({ ...storageMod.emptyWorkspace(), tasks: [{ id: 1, taskName: "A" }] });
    (storageMod.createBackend as ReturnType<typeof vi.fn>).mockReturnValueOnce(mockBackend).mockReturnValue(backendB);
    const argsRef = { current: makeArgs() };
    const { result, rerender } = renderHook(
      () => useStorageBackend(argsRef.current),
      { wrapper: ({ children }) => <TestProviders>{children}</TestProviders> },
    );
    await flush();
    expect(result.current.loadPending).toBe(false);

    argsRef.current = makeArgs({ settings: { storageConfig: { kind: "local-json" } } as unknown as Settings });
    await act(async () => { rerender(); });
    await flush();
    expect(backendB.load).toHaveBeenCalled(); // control: the new load is in flight
    expect(result.current.loadPending).toBe(true);

    await act(async () => { resolveB({ ...storageMod.emptyWorkspace(), tasks: [{ id: 2, taskName: "B" }] }); });
    await flush();
    expect(result.current.loadPending).toBe(false);
  });

  it("is true for the whole of a project-swap op, and drops when it finishes", async () => {
    mockBackend.load.mockResolvedValue({ ...storageMod.emptyWorkspace(), tasks: [{ id: 1, taskName: "Before" }] });
    const { result } = renderBackend();
    await flush();
    expect(result.current.loadPending).toBe(false);

    let resolveReload: (workspace: unknown) => void = () => {};
    mockBackend.load.mockImplementation(() => new Promise((resolve) => { resolveReload = resolve as (workspace: unknown) => void; }));
    let reload: Promise<void> = Promise.resolve();
    act(() => { reload = result.current.reloadCurrentProject(); });
    await flush();
    expect(result.current.loadPending).toBe(true);

    await act(async () => {
      resolveReload({ ...storageMod.emptyWorkspace(), tasks: [{ id: 1, taskName: "After" }] });
      await reload;
    });
    expect((result.current.tasks[0] as { taskName: string }).taskName).toBe("After"); // control: the op ran to the end
    expect(result.current.loadPending).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run (Global section V): `npx vitest run src/app/use-storage-backend.test.tsx --maxWorkers=1 --reporter=dot`
Expected: `EXIT=1`. The five new tests fail because `loadPending` is `undefined`.

- [ ] **Step 3: Implement**

In `src/app/use-storage-backend.ts`, directly after `const workspaceLoaded = loadedBackend !== null && loadedBackend === backend;`, insert:

```ts
  // ★★★ §548 — THE EDIT HOLD'S SIGNAL, and deliberately NOT `workspaceLoaded`.
  //   That gate stays shut after a FAILED load and on the empty-load refusal,
  //   which is right for snapshot capture and wrong for editing: holding edits
  //   on it would lock the app for the session after any load error. This asks
  //   a narrower question — is a load still IN FLIGHT for the current backend? —
  //   so EVERY terminal branch of the load effect stamps it: applied, refused,
  //   suppressed, failed. Same identity-not-latch shape as `loadedBackend` (§77).
  const [settledBackend, setSettledBackend] = useState<ReturnType<typeof createBackend> | null>(null);
  // ★★ §548 — project-swap ops in flight. Each awaits and THEN replaces the
  //   workspace (see `holdDuring`), so an edit made during its await is
  //   discarded exactly like one made during the first load.
  const [swapsInFlight, setSwapsInFlight] = useState(0);
  const loadPending = !(settledBackend !== null && settledBackend === backend) || swapsInFlight > 0;
```

At the end of `applyWorkspace`, replace `    setLoadedBackend(backend);\n  };` (the last two lines of the function) with:

```ts
    setLoadedBackend(backend);
    setSettledBackend(backend); // §548 — see `settledBackend`; the suppress branch re-stamps it for the same reason it re-stamps `loadedBackend`.
  };
```

In the load effect's suppress branch, replace:

```ts
        setLoadedBackend(backend);
        await refreshBackendStatus();
        return;
```

with:

```ts
        setLoadedBackend(backend);
        setSettledBackend(backend); // §548
        await refreshBackendStatus();
        return;
```

In the empty-load refusal branch, replace:

```ts
          recordDataLossEvent({ path: "load", prevCollections: nonEmptyCollectionCount(currentWorkspace()), nextCollections: 0, refused: true });
          emitToast("info", t(langRef.current, "storageKeptCurrentData"));
```

with:

```ts
          recordDataLossEvent({ path: "load", prevCollections: nonEmptyCollectionCount(currentWorkspace()), nextCollections: 0, refused: true });
          setSettledBackend(backend); // §548 — nothing applied, but nothing is still in flight either.
          emitToast("info", t(langRef.current, "storageKeptCurrentData"));
```

In the load effect's `catch`, replace:

```ts
      } catch (err) {
        if (cancelled) return;
        emitOutcome(err);
```

with:

```ts
      } catch (err) {
        if (cancelled) return;
        // §548 — a FAILED load leaves nothing in flight to overwrite an edit. ★ §72:
        //   this branch runs outside any `try`, so the setter is mount-guarded.
        if (mountedRef.current) setSettledBackend(backend);
        emitOutcome(err);
```

Directly above the `// Grouped one line per concern — a plain re-export list` comment before the hook's `return {`, insert:

```ts
  // ★★ §548 — hold edits for the WHOLE of an op that awaits and then REPLACES
  //   the workspace. The op flushes the outgoing project BEFORE its await; an
  //   edit made during the await re-arms the debounced save, and the apply's
  //   re-render clears that timer and sets `suppressNextSaveRef`, so the edit was
  //   never written and was replaced in memory. `finally`, so a throwing op cannot
  //   strand the hold; `mountedRef`, so a teardown cannot throw (§72).
  function holdDuring<A extends unknown[]>(op: (...args: A) => Promise<void>): (...args: A) => Promise<void> {
    return async (...args: A) => {
      setSwapsInFlight((n) => n + 1);
      try {
        await op(...args);
      } finally {
        if (mountedRef.current) setSwapsInFlight((n) => n - 1);
      }
    };
  }
```

In the returned object, replace:

```ts
    storageDescription, storageReady, workspaceLoaded,
    onPickStorageFile, onGrantWriteAccess, onOpenStorageFile, onRequestStorageSwitch,
    reloadCurrentProject, allowDestructiveSave,
```

with:

```ts
    storageDescription, storageReady, workspaceLoaded, loadPending,
    onPickStorageFile, onGrantWriteAccess, onOpenStorageFile: holdDuring(onOpenStorageFile), onRequestStorageSwitch,
    reloadCurrentProject: holdDuring(reloadCurrentProject), allowDestructiveSave,
```

and replace:

```ts
    switchToProject, createProject, createDemoProject, loadProjectFromFile,
    switchToTursoProject, createTursoProject, migrateCurrentProjectToTurso,
```

with:

```ts
    switchToProject: holdDuring(switchToProject), createProject: holdDuring(createProject),
    createDemoProject: holdDuring(createDemoProject), loadProjectFromFile: holdDuring(loadProjectFromFile),
    switchToTursoProject: holdDuring(switchToTursoProject), createTursoProject: holdDuring(createTursoProject),
    migrateCurrentProjectToTurso: holdDuring(migrateCurrentProjectToTurso),
```

Leave `onPickStorageFile`, `onGrantWriteAccess`, `onRequestStorageSwitch` and the archive/restore/hard-delete ops unwrapped. They replace nothing (inventory N08, N09).

- [ ] **Step 4: Run the tests**

Run Step 2's command. Expected: `EXIT=0`, `Test Files  1 passed (1)`.

- [ ] **Step 5: Mutations**

- MH (failure branch): delete the `if (mountedRef.current) setSettledBackend(backend);` line in the `catch`. Expected red: `drops when the load FAILS`. Revert.
- MI (signal source): change `loadPending`'s first term to `!(loadedBackend !== null && loadedBackend === backend)`. Expected red: `drops when the load FAILS`. Revert.
- MJ (swap hold): delete `|| swapsInFlight > 0`. Expected red: `is true for the whole of a project-swap op`. Revert.

- [ ] **Step 6: Gates**

- vitest: Step 2's command → `EXIT=0`, `Test Files  1 passed (1)`.
- tsc → `EXIT=0`, `0`.
- `npx eslint --max-warnings=0 src/app/use-storage-backend.ts src/app/use-storage-backend.test.tsx` → `EXIT=0`.
- Size: `node -e "console.log(require('fs').readFileSync('src/app/use-storage-backend.ts','utf8').split('\n').length)"` must be ≤ 1600.

- [ ] **Step 7: Commit (Global section C)**

Subject: `fix(storage): §548 — publish loadPending for the load and project swaps`
Body: `useStorageBackend now reports whether a load is still in flight for the current backend: every terminal branch of the load effect settles it (a failed load too, unlike workspaceLoaded), and the nine ops that await and then replace the workspace hold it for their whole duration. Mutations MH, MI and MJ each turn a named test red.`
Paths: `src/app/use-storage-backend.ts src/app/use-storage-backend.test.tsx`

---

### Task 4b: §548 — hold the app tree, the reconcile effect and the undo hotkey

**Files:**
- Modify: `src/app/task-manager.tsx` (destructure `loadPending`, render hold, reconcile gate, the undo-hotkey move)
- Create: `src/app/task-manager.load-hold.test.tsx`
- Docs: `AGENTS.md` ("Remount-swallow" bullet)

**Interfaces:**
- Consumes: `loadPending` from Task 4a.
- Produces: no new exports. Every main-window panel now mounts fresh after a hold.

- [ ] **Step 1: Write the failing test file `src/app/task-manager.load-hold.test.tsx`**

```tsx
// §548 — the edit hold, pinned at its only call site. While `loadPending` is
// true the main window renders `PanelSkeleton` instead of the app tree, so no
// UI control that writes workspace state exists to race the load; the writers
// that do NOT unmount — the insight reconcile timer and the undo hotkey — gate
// themselves. The load is held open with a deferred `BrowserBackend.load`, so
// the pending window is observable rather than a race the test would usually lose.
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetMintStateForTests } from "./id-mint-session";
import { t } from "./i18n";
import { BrowserBackend } from "./browser-backend";
import { emptyWorkspace, type Workspace } from "./workspace";
import { DEFAULT_TASK_STATUS, type Task } from "./types";
import { reconcileInsights } from "./insights/reconcile";

const undoCalls = vi.hoisted(() => ({ n: 0 }));

// Count real undo calls without changing `undo`'s identity between renders.
vi.mock("./undo/use-undo-stack", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./undo/use-undo-stack")>();
  const wrapped = new WeakMap<() => void, () => void>();
  return {
    ...actual,
    useUndoStack: (deps: Parameters<typeof actual.useUndoStack>[0]) => {
      const api = actual.useUndoStack(deps);
      let undo = wrapped.get(api.undo);
      if (!undo) {
        const real = api.undo;
        undo = () => { undoCalls.n += 1; real(); };
        wrapped.set(real, undo);
      }
      return { ...api, undo };
    },
  };
});

vi.mock("./insights/reconcile", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./insights/reconcile")>();
  return { ...actual, reconcileInsights: vi.fn(actual.reconcileInsights) };
});

vi.mock("./workspace-section", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./workspace-section")>();
  const { useWorkspace } = await import("./workspace-context");
  return {
    ...actual,
    WorkspaceSection: () => {
      const { tasks } = useWorkspace();
      return <div data-testid="ws-section-mock" data-task-count={tasks.length} />;
    },
  };
});

import TaskManager from "./task-manager";

function task(id: number, taskName: string): Task {
  return {
    id, taskName, assignee: "M. Jordan", assigneeEmail: "", dueDate: "2026-09-30",
    lastUpdateDate: "2026-05-19", priority: "Medium", status: DEFAULT_TASK_STATUS,
    blockers: "", description: "",
  };
}

const LOADED: Workspace = { ...emptyWorkspace(), tasks: [task(1, "Loaded one"), task(2, "Loaded two")] };

/** A deferred `BrowserBackend.load`. `land` resolves EVERY call made so far and
 *  answers any later call at once. ★ Settings hydration can rebuild the backend
 *  memo and re-run the load effect, so there may be more than one call, and a
 *  helper that resolved only the latest could leave the effective run pending. */
function holdLoad() {
  const waiting: Array<(w: Workspace) => void> = [];
  let landed: Workspace | null = null;
  const spy = vi.spyOn(BrowserBackend.prototype, "load").mockImplementation(() =>
    landed !== null ? Promise.resolve(landed) : new Promise<Workspace>((resolve) => { waiting.push(resolve); }),
  );
  return {
    spy,
    land: (w: Workspace) => {
      landed = w;
      for (const resolve of waiting.splice(0)) resolve(w);
    },
  };
}

function mount() {
  window.localStorage.clear();
  window.localStorage.setItem("aipm-cockpit:projects", JSON.stringify({
    projects: [{ id: "p1", name: "Seed", code: "SEED", storageConfig: { kind: "browser" } }],
    currentProjectId: "p1",
  }));
  window.history.replaceState(null, "", "/");
  render(<TaskManager />);
}

beforeEach(() => {
  __resetMintStateForTests();
  undoCalls.n = 0;
  vi.mocked(reconcileInsights).mockClear();
});
afterEach(() => {
  vi.restoreAllMocks();
  window.history.replaceState(null, "", "/");
});

describe("§548 — no edit can start while the load is pending", () => {
  it("renders the loading placeholder instead of the app until the load lands, and the landed load is intact", async () => {
    const load = holdLoad();
    mount();
    await waitFor(() => expect(load.spy).toHaveBeenCalled()); // the hold answers a REAL pending load
    expect(screen.getByRole("status")).toHaveTextContent(t("en-US", "loading"));
    // No app tree, so no control that writes: no pane, no shell navigation, no header menus.
    expect(screen.queryByTestId("ws-section-mock")).toBeNull();
    expect(screen.queryByRole("navigation")).toBeNull();

    await act(async () => { load.land(LOADED); });
    const pane = await screen.findByTestId("ws-section-mock");
    expect(pane.getAttribute("data-task-count")).toBe("2");
  }, 45000);

  it("does not run the insight reconcile while the load is pending, and runs it once the load lands", async () => {
    const load = holdLoad();
    mount();
    await waitFor(() => expect(load.spy).toHaveBeenCalled());
    // Well past INSIGHTS_RECONCILE_DEBOUNCE_MS (4 s), with the load still held.
    await act(async () => { await new Promise((r) => setTimeout(r, 8000)); });
    expect(vi.mocked(reconcileInsights)).not.toHaveBeenCalled();

    await act(async () => { load.land(LOADED); });
    await waitFor(() => expect(vi.mocked(reconcileInsights)).toHaveBeenCalled(), { timeout: 10000 });
  }, 45000);

  it("ignores the undo hotkey while the load is pending, and honours it once the load lands", async () => {
    const load = holdLoad();
    mount();
    await waitFor(() => expect(load.spy).toHaveBeenCalled());
    fireEvent.keyDown(document.body, { key: "z", ctrlKey: true });
    expect(undoCalls.n).toBe(0);

    await act(async () => { load.land(LOADED); });
    await screen.findByTestId("ws-section-mock");
    fireEvent.keyDown(document.body, { key: "z", ctrlKey: true });
    expect(undoCalls.n).toBe(1);
  }, 45000);
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run (Global section V): `npx vitest run src/app/task-manager.load-hold.test.tsx --maxWorkers=1 --reporter=dot`
Expected: `EXIT=1`, and all three tests fail. The app renders during the pending load, the reconcile runs, and the hotkey undoes.

- [ ] **Step 3: Implement in `src/app/task-manager.tsx` (CRLF, Edit tool)**

(a) Destructure the signal. In the `useStorageBackend` destructuring, replace `    restoreTursoProject, hardDeleteTursoProject, tursoProjectId,` with:

```ts
    restoreTursoProject, hardDeleteTursoProject, tursoProjectId, loadPending,
```

(b) Move and gate the undo hotkey. Delete the line `  useUndoHotkey(undoApi.undo, undoApi.redo);` directly after the `const undoApi = useUndoStack(...)` line. In the comment above `allowDestructiveSaveRef`, replace:

```ts
  // `use-document-assets.ts` use for the same one. Moving the `useUndoStack` call
  // down instead would also move `useUndoHotkey`'s listener registration relative
  // to the other hotkey hooks.
```

with:

```ts
  // `use-document-assets.ts` use for the same one. (`useUndoHotkey` itself now
  // sits below `useStorageBackend`, because it reads `loadPending` — §548.)
```

Then, directly after the line `  useEffect(() => { allowDestructiveSaveRef.current = allowDestructiveSave; isPopoutRef.current = isPopout; }, [allowDestructiveSave, isPopout]);`, insert:

```ts
  // ★★ §548 — the one undo path that does NOT unmount with the app tree while a
  //   load or project swap is pending (a document `keydown` listener), and an
  //   undo applied then is overwritten when the load lands. Registered here,
  //   below `useStorageBackend`, and still above `useDictationHotkey`, so the two
  //   document keydown listeners keep their registration order.
  useUndoHotkey(
    () => { if (!loadPending) undoApi.undo(); },
    () => { if (!loadPending) undoApi.redo(); },
  );
```

(c) Gate the insight reconcile effect. Replace:

```ts
  useEffect(() => {
    if (!hydrated || isPopout) return;
    const timer = setTimeout(() => {
```

with:

```ts
  useEffect(() => {
    // §548 — never while a load or swap is pending: its write would be replaced
    // when the load lands. `loadPending` is a dep, so it runs once the load does.
    if (!hydrated || isPopout || loadPending) return;
    const timer = setTimeout(() => {
```

and in that effect's dependency array, replace `holidaySet, holidaysReady, shifts, priorOverdueCount]);` with `holidaySet, holidaysReady, shifts, priorOverdueCount, loadPending]);`.

(d) The render hold. After the `const showTursoListLoading = …;` statement, insert:

```ts
  // ★★★ §548 — THE EDIT HOLD. While `loadPending` (the first load, a
  //   backend-change reload, or a project-swap op is in flight) the main window
  //   renders the same `PanelSkeleton` the Turso list-load window uses INSTEAD of
  //   the app tree, so no control that writes workspace state exists to be used —
  //   an edit made in that window was silently replaced when the load landed.
  //   Every panel therefore mounts FRESH after each hold (AGENTS.md
  //   "Remount-swallow"). Writers that do not unmount gate on `loadPending`
  //   themselves; the writer inventory is in the §548 plan.
```

and replace `            ) : showTursoListLoading ? (` with `            ) : showTursoListLoading || loadPending ? (`.

- [ ] **Step 4: Run the new test**

Run Step 2's command. Expected: `EXIT=0`, `Test Files  1 passed (1)`.

- [ ] **Step 5: Run the 16 existing TaskManager suites**

These render `<TaskManager />` and may now race the hold. Run (Global section V):

`npx vitest run src/app/task-manager.load-hold.test.tsx src/app/task-manager.activity-actor.test.tsx src/app/task-manager.characterization.test.tsx src/app/task-manager.clear-unlinked-arming.test.tsx src/app/task-manager.editor-modal.test.tsx src/app/task-manager.guardrail-reconcile.test.tsx src/app/task-manager.key-facts-cache.test.tsx src/app/task-manager.popout-guard.test.tsx src/app/task-manager.portfolio-mode.test.tsx src/app/task-manager.restore-backfill.test.tsx src/app/task-manager.shell.test.tsx src/app/task-manager.snapshot-gate-failed-load.test.tsx src/app/task-manager.snapshot-gate.test.tsx src/app/task-manager.template-notice.test.tsx src/app/task-manager.timelog-links-blank.test.tsx src/app/task-manager.truncation-banner.test.tsx src/app/task-manager.version-history-wiring.test.tsx --maxWorkers=1 --reporter=dot`

Expected: `EXIT=0`, `Test Files  17 passed (17)`.

**If a suite goes red** because it queried the app (or captured a probe's props) before the first load landed, fix it only by awaiting the load. Wait for the pane with `await screen.findBy…`, or use the `storage.loaded` diag wait that `task-manager.template-notice.test.tsx`'s `mount()` already uses:

```ts
await waitFor(
  () => expect(window.localStorage.getItem("aipm-cockpit:diag-log") ?? "").toContain("storage.loaded"),
  { timeout: 15000 },
);
```

Never weaken or delete an assertion. List every suite you changed, and why, in the task report, and add each changed file to this task's commit paths.

- [ ] **Step 6: Mutations**

- MK (render hold): revert `showTursoListLoading || loadPending` to `showTursoListLoading`. Expected red: `renders the loading placeholder…`. Revert.
- ML (reconcile): delete `|| loadPending` from the reconcile effect's early return. Expected red: `does not run the insight reconcile…`. If it stays GREEN, the 8 s wait is too short on this machine: raise it, and re-prove red. Revert.
- MM (hotkey): change the undo closure to `() => { undoApi.undo(); }`. Expected red: `ignores the undo hotkey…`. Revert.

- [ ] **Step 7: AGENTS.md (LF, Edit tool)**

In the "Remount-swallow" bullet, replace:

```
  monotonically bump the nonce so re-mounts don't re-fire stale. Bit settings-view learning deep-link AND
  milestones-panel `openCreateNonce` (Gantt "Add milestone").
```

with:

```
  monotonically bump the nonce so re-mounts don't re-fire stale. Bit settings-view learning deep-link AND
  milestones-panel `openCreateNonce` (Gantt "Add milestone").
  ★★ **THE WHOLE MAIN-WINDOW TREE UNMOUNTS WHILE `loadPending` IS TRUE (§548)** — the first load, a
  backend-change reload, and every project-swap op render `PanelSkeleton` instead — so EVERY panel,
  the two exceptions below included, mounts fresh after each; the sentinel rule applies to them too.
```

- [ ] **Step 8: Gates**

- vitest: Step 5's command → `EXIT=0`, `Test Files  17 passed (17)`.
- tsc → `EXIT=0`, `0`.
- `npx eslint --max-warnings=0 src/app/task-manager.tsx src/app/task-manager.load-hold.test.tsx <any suite changed in Step 5>` → `EXIT=0`.
- `npm run docs:symbols:check; echo "EXIT=$?"` → `EXIT=0`.
- a11y, since this is a UI change and the unit suite never runs axe: `npx playwright test e2e/a11y.spec.ts --project=chromium -g "Dashboard" --workers=1; echo "EXIT=$?"` → `EXIT=0`. A timeout under local contention is not a violation: re-run once, and report both runs.

- [ ] **Step 9: Commit (Global section C)**

Subject: `fix(shell): §548 — hold the app tree while a load or swap is pending`
Body: `While loadPending, the main window renders the existing PanelSkeleton instead of the app tree, so no UI writer can start inside the window the load would overwrite. The insight reconcile effect and the undo hotkey, which do not unmount, gate on the same signal. Mutations MK, ML and MM each turn a named test red.`
Paths: `src/app/task-manager.tsx src/app/task-manager.load-hold.test.tsx AGENTS.md` plus any suite changed in Step 5. `git add -- src/app/task-manager.load-hold.test.tsx` first.

---

### Task 4c: §548 — gate the background hooks; close §548

**Files:**
- Modify: `src/app/use-insight-recommendations.ts` (`InsightRecommendationDeps.loadPending`, `applyInsightRecommendation`)
- Modify: `src/app/use-calendar-integrations.ts` (`CalendarIntegrationDeps.loadPending`, the four auto-sync flags, the auto-pull runner)
- Modify: `src/app/task-manager.tsx` (pass `loadPending` to both hooks)
- Test: `src/app/use-insight-recommendations.test.tsx`; Create: `src/app/use-calendar-integrations.load-hold.test.ts` (no JSX, so `.ts`); Modify: `src/app/task-manager.load-hold.test.tsx` (wiring)
- Docs: `docs/open-followups.md` (§548)

**Interfaces:**
- Consumes: `loadPending` (Task 4a), threaded by task-manager.
- Produces: `InsightRecommendationDeps.loadPending: boolean` and `CalendarIntegrationDeps.loadPending: boolean`, both required.

- [ ] **Step 1: Write the failing tests**

`src/app/use-insight-recommendations.test.tsx`. In `mkDeps`, add `loadPending: false,` after `isPopout: false,`. Then append:

```ts
// §548 — the recommendation store is the choke point both the background
// runner and the on-demand generate write through; a result stored while a load
// or swap is pending would be replaced when the load lands.
it("does not store a generated recommendation while the project load is pending (§548)", async () => {
  const generate = vi.spyOn(recommendCall, "runInsightRecommendation").mockResolvedValue(mkRec({ id: 42, status: "In Progress" }));
  const store = mkStore([mkInsight()]);
  const { result } = renderHook(() => useInsightRecommendations(mkDeps({ insights: store.read(), setInsights: store.setInsights, loadPending: true })));
  await act(async () => { result.current.insightActions.onGenerateRecommendation(1); });
  expect(generate).toHaveBeenCalled(); // control: the generate really ran to the store point
  expect(store.read()[0].recommendation).toBeUndefined();
});
```

Create `src/app/use-calendar-integrations.load-hold.test.ts`:

```ts
// §548 — the calendar background writers (four auto-sync pushes, four
// background pulls, the auto-pull runner) run on timers and never unmount with
// the app tree, so they gate on `loadPending` themselves. The Graph-facing hooks
// are stubbed; what is pinned is the enable flags this hook hands them.
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Settings } from "./settings-types";

const seen = vi.hoisted(() => ({ autoSync: [] as boolean[], autoPull: [] as boolean[], backgroundPull: [] as boolean[] }));

vi.mock("./use-calendar-auto-sync", () => ({
  useCalendarAutoSync: (a: { active: boolean }) => { seen.autoSync.push(a.active); },
}));
vi.mock("./use-calendar-auto-pull", () => ({
  useCalendarAutoPull: (a: { enabled: boolean }) => { seen.autoPull.push(a.enabled); },
}));
vi.mock("./use-entity-calendar-push", () => ({
  useEntityCalendarPush: () => ({ pushToOutlook: vi.fn(), busy: false }),
}));
vi.mock("./use-entity-calendar-pull", () => ({
  useEntityCalendarPull: (a: { enabled: boolean; background?: boolean }) => {
    if (a.background) seen.backgroundPull.push(a.enabled);
    return { pull: vi.fn(), busy: false, result: null, clearResult: vi.fn(), keepApp: vi.fn(), applyMove: vi.fn() };
  },
}));
vi.mock("./use-outlook-calendar-push", () => ({
  useOutlookCalendarPush: () => ({ pushToOutlook: vi.fn(), busy: false }),
}));
vi.mock("./use-milestone-calendar-pull", () => ({
  useMilestoneCalendarPull: () => ({ pull: vi.fn(), busy: false, result: null, clearResult: vi.fn(), keepApp: vi.fn(), applyMove: vi.fn() }),
}));
vi.mock("./use-committee-outlook-push", () => ({
  useCommitteeOutlookPush: () => ({ pushToOutlook: vi.fn(), pushingTarget: null }),
}));

import { useCalendarIntegrations, type CalendarIntegrationDeps } from "./use-calendar-integrations";

const ON = { enabled: true, auto: true };

function deps(loadPending: boolean): CalendarIntegrationDeps {
  return {
    isPopout: false,
    settings: {
      integrations: { m365: { enabled: true, outlookCalendarPush: true } },
      outlookCalendar: { task: ON, raid: ON, change: ON, absence: ON },
    } as unknown as Settings,
    m365Enabled: true,
    portfolioCurrentId: "p1",
    project: undefined,
    lang: "en-US",
    today: "2026-09-19",
    logActivityAs: vi.fn() as unknown as CalendarIntegrationDeps["logActivityAs"],
    setSettings: vi.fn(),
    milestones: [], setMilestones: vi.fn(),
    steeringCommittee: undefined, setSteeringCommittee: vi.fn(),
    tasks: [], setTasks: vi.fn(),
    raid: [], setRaid: vi.fn(),
    changes: [], setChanges: vi.fn(),
    absences: [], setAbsences: vi.fn(),
    loadPending,
  };
}

function lastRender() {
  return {
    autoSync: seen.autoSync.slice(-4),
    backgroundPull: seen.backgroundPull.slice(-4),
    autoPull: seen.autoPull.slice(-1),
  };
}

describe("useCalendarIntegrations — background writers hold while the load is pending (§548)", () => {
  it("keeps every auto-sync push, background pull and the auto-pull runner OFF while loadPending", () => {
    renderHook(() => useCalendarIntegrations(deps(true)));
    expect(lastRender()).toEqual({
      autoSync: [false, false, false, false],
      backgroundPull: [false, false, false, false],
      autoPull: [false],
    });
  });

  it("control: the same settings switch them ON once the load has landed", () => {
    renderHook(() => useCalendarIntegrations(deps(false)));
    expect(lastRender()).toEqual({
      autoSync: [true, true, true, true],
      backgroundPull: [true, true, true, true],
      autoPull: [true],
    });
  });
});
```

`src/app/task-manager.load-hold.test.tsx` (wiring). Add, after `const undoCalls = …`:

```tsx
const handed = vi.hoisted(() => ({ calendar: [] as boolean[], recs: [] as boolean[] }));

vi.mock("./use-calendar-integrations", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./use-calendar-integrations")>();
  return {
    ...actual,
    useCalendarIntegrations: (d: Parameters<typeof actual.useCalendarIntegrations>[0]) => {
      handed.calendar.push(d.loadPending);
      return actual.useCalendarIntegrations(d);
    },
  };
});

vi.mock("./use-insight-recommendations", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./use-insight-recommendations")>();
  return {
    ...actual,
    useInsightRecommendations: (d: Parameters<typeof actual.useInsightRecommendations>[0]) => {
      handed.recs.push(d.loadPending);
      return actual.useInsightRecommendations(d);
    },
  };
});
```

In `beforeEach`, add `handed.calendar.length = 0; handed.recs.length = 0;`. Inside the `describe`, append:

```tsx
  it("hands loadPending to the background hooks: true while held, false once the load lands", async () => {
    const load = holdLoad();
    mount();
    await waitFor(() => expect(load.spy).toHaveBeenCalled());
    expect(handed.calendar[handed.calendar.length - 1]).toBe(true);
    expect(handed.recs[handed.recs.length - 1]).toBe(true);

    await act(async () => { load.land(LOADED); });
    await screen.findByTestId("ws-section-mock");
    expect(handed.calendar[handed.calendar.length - 1]).toBe(false);
    expect(handed.recs[handed.recs.length - 1]).toBe(false);
  }, 45000);
```

- [ ] **Step 2: Run the tests and verify they fail**

Run (Global section V): `npx vitest run src/app/use-insight-recommendations.test.tsx src/app/use-calendar-integrations.load-hold.test.ts src/app/task-manager.load-hold.test.tsx --maxWorkers=1 --reporter=dot`
Expected: `EXIT=1`. The new tests fail: the recommendation is stored while pending, the flags are `true` while pending, and `handed` records `undefined`. vitest does not typecheck, so the missing `loadPending` member shows up only in Step 7's tsc run.

- [ ] **Step 3: Implement**

`use-insight-recommendations.ts`. In `InsightRecommendationDeps`, after `isPopout: boolean;` add:

```ts
  /** §548 — a load or project swap is still in flight (`useStorageBackend`). A
   *  recommendation stored meanwhile would be replaced when the load lands. */
  loadPending: boolean;
```

In the destructuring, replace `    isPopout,\n    settings,` (the first two names) with:

```ts
    isPopout,
    loadPending,
    settings,
```

In `applyInsightRecommendation`, replace:

```ts
    (id: number, rec: InsightRecommendation) => {
      const stamped = stampRecommendationTokens(rec, { tasks, raid, changes, milestones, stakeholders });
      setInsights((prev) => (prev ?? []).map((i) => (i.id === id ? { ...i, recommendation: stamped } : i)));
    },
    [setInsights, tasks, raid, changes, milestones, stakeholders],
```

with:

```ts
    (id: number, rec: InsightRecommendation) => {
      // §548 — this is the ONE store both the background runner and the
      // on-demand generate write through, so the hold lives here: a result
      // stored while a load or swap is pending would be replaced when it lands.
      // Dropped, not queued — the runner's next tick regenerates it.
      if (loadPending) return;
      const stamped = stampRecommendationTokens(rec, { tasks, raid, changes, milestones, stakeholders });
      setInsights((prev) => (prev ?? []).map((i) => (i.id === id ? { ...i, recommendation: stamped } : i)));
    },
    [setInsights, tasks, raid, changes, milestones, stakeholders, loadPending],
```

`use-calendar-integrations.ts`. In `CalendarIntegrationDeps`, after `isPopout: boolean;` add:

```ts
  /** §548 — a load or project swap is still in flight (`useStorageBackend`).
   *  The BACKGROUND writers below (auto-sync pushes, background pulls, the
   *  auto-pull runner) run on timers and never unmount with the app tree, so
   *  they hold themselves; the manual controls are unmounted by the hold. */
  loadPending: boolean;
```

Add `loadPending,` to the destructuring after `isPopout,`. Then change these five expressions:

- `const taskAutoSyncActive = taskSync.auto && m365Enabled && !isPopout;` → `const taskAutoSyncActive = taskSync.auto && m365Enabled && !isPopout && !loadPending;`
- `const raidAutoSyncActive = raidSync.auto && m365Enabled && !isPopout;` → `const raidAutoSyncActive = raidSync.auto && m365Enabled && !isPopout && !loadPending;`
- `const changeAutoSyncActive = changeSync.auto && m365Enabled && !isPopout;` → `const changeAutoSyncActive = changeSync.auto && m365Enabled && !isPopout && !loadPending;`
- `const absenceAutoSyncActive = absenceSync.auto && m365Enabled && !isPopout;` → `const absenceAutoSyncActive = absenceSync.auto && m365Enabled && !isPopout && !loadPending;`
- in `useCalendarAutoPull({`, `    enabled: m365Enabled && !isPopout,` → `    enabled: m365Enabled && !isPopout && !loadPending,`

`task-manager.tsx`. In the `useInsightRecommendations({` call, replace `    isPopout, settings, lang, today, project,` with `    isPopout, loadPending, settings, lang, today, project,`. In the `useCalendarIntegrations({` call, replace its first line `    isPopout,` with:

```ts
    isPopout,
    loadPending,
```

Edit only this call: the object literal passed to `useCalendarIntegrations`.

- [ ] **Step 4: Run the tests**

Run Step 2's command. Expected: `EXIT=0`, `Test Files  3 passed (3)`.

- [ ] **Step 5: Mutations**

- MN (recommendation store): delete `if (loadPending) return;`. Expected red: `does not store a generated recommendation while the project load is pending (§548)`. Revert.
- MO (auto-sync): delete `&& !loadPending` from `taskAutoSyncActive`. Expected red: `keeps every auto-sync push … OFF`. Revert.
- MP (auto-pull runner): delete `&& !loadPending` from `useCalendarAutoPull`'s `enabled`. Expected red: the same test. Revert.
- MQ (wiring): in task-manager's `useCalendarIntegrations({` call, change `loadPending,` to `loadPending: false,`. Expected red: `hands loadPending to the background hooks`. Revert.

- [ ] **Step 6: Close §548 (Global section R)**

Write `$SCRATCH/status-548.txt`:

```
**Status:** CLOSED 2026-09-19 by `fix/data-loss-batch`: `useStorageBackend` publishes `loadPending` — true until the load effect for the current backend reaches any terminal branch (applied, refused, suppressed or failed) and while a project-swap op held by `holdDuring` is in flight, so a project switch's own window is covered too — and `task-manager.tsx` renders the existing `PanelSkeleton` instead of the app tree while it is true, so no UI edit can start inside the window; the writers that do not unmount (insight reconcile, the recommendation store, calendar auto-sync and auto-pull, the undo hotkey) gate on the same boolean. The writer inventory is in `docs/superpowers/plans/2026-09-19-data-loss-batch.md`. Pinned by `task-manager.load-hold.test.tsx`, the `loadPending` block in `use-storage-backend.test.tsx`, `use-calendar-integrations.load-hold.test.ts` and `use-insight-recommendations.test.tsx`; never machine-verified in a real browser, against a live Turso project or on the file backend.
```

Run `node "$SCRATCH/close-followup.cjs" 548 2026-09-19 "$SCRATCH/status-548.txt"`.

- [ ] **Step 7: Gates**

- vitest: Step 2's command → `EXIT=0`, `Test Files  3 passed (3)`.
- tsc → `EXIT=0`, `0`. This is where a missed `loadPending` at another call site of either hook fails, because the member is required.
- `npx eslint --max-warnings=0 src/app/use-insight-recommendations.ts src/app/use-calendar-integrations.ts src/app/task-manager.tsx src/app/use-insight-recommendations.test.tsx src/app/use-calendar-integrations.load-hold.test.ts src/app/task-manager.load-hold.test.tsx` → `EXIT=0`.
- The four register gates → all `EXIT=0`.

- [ ] **Step 8: Commit (Global section C)**

Subject: `fix(storage): §548 — gate the background writers on loadPending; close §548`
Body: `The recommendation store and the calendar auto-sync pushes, background pulls and auto-pull runner run on timers and never unmount with the held app tree, so they now refuse while loadPending. Mutations MN-MQ each turn a named test red.`
Paths: `src/app/use-insight-recommendations.ts src/app/use-calendar-integrations.ts src/app/task-manager.tsx src/app/use-insight-recommendations.test.tsx src/app/use-calendar-integrations.load-hold.test.ts src/app/task-manager.load-hold.test.tsx docs/open-followups.md`. `git add -- src/app/use-calendar-integrations.load-hold.test.ts` first.

---

## Open risks (reported, not fixed here)

1. **Pre-load autosave (unverified, and possibly worse than §548).** The save effect is not gated on the load. At hydration it schedules a debounced save of the empty pre-load workspace, and only the load's own commit cancels it within `SAVE_DEBOUNCE_MS` (500 ms). A load slower than that, such as a cold Turso connection, may write the empty workspace. No backend-level `isWorkspaceEmpty` refusal was found, and `destructive.evaluate` against zero baselines was not traced. This is outside §548's edit-refusal scope. Probe before the batch ships, and file it at the next free number (§586 or later) on the user's say.
2. **The 16 TaskManager suites may race the new hold** (Task 4b Step 5). The fix recipe is to await the load, and only that.
3. **UX change the user has not seen:** a skeleton on every boot, on each backend change and during every project swap, including behind the OS file picker in `createProject` / `loadProjectFromFile`. The a11y axe gate runs in CI only. Task 4b runs one view locally.
4. **Pre-existing, left alone:** a chat agent loop in flight across a project swap keeps dispatching into the next project, and the undo stack is not cleared on a project switch.
