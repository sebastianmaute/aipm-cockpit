# Seed allow-listing and handle-commit ordering — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close open-followups §286, §287 and §288 — three places where a write commits before the decision that authorises it, or a policy runs at one caller instead of at the shared choke point.

**Architecture:** Three independent units, executed smallest-blast-radius first. Unit 3 moves four allow-list passes from `applyTemplate` into the `appendSeed` tail both seed branches already share. Unit 2 extracts a DOM-free note-log core parameterised by its two DOM-dependent steps, so the canonical and seed validators stop diverging. Unit 1 changes `LocalFileBackend.openFile()` to return a handle instead of persisting it, so the caller commits only after the user accepts.

**Tech Stack:** TypeScript, React 19, Next.js 16.2.11, vitest 4.1.8, Playwright. No new dependencies.

---

## Read before starting

- `docs/superpowers/specs/2026-08-30-seed-and-handle-commit-design.md` — the approved design, including the three rejected alternatives for Unit 1 and the reason each was rejected.
- `docs/AGENTS/rich-text.md` — the seven rich fields, the DOM-free vs browser-only split, and the `sanitizeRichText` / `sanitizeAiRichText` write boundaries.
- `docs/open-followups.md` §286, §287, §288.

## Environment rules that will bite you

These are not style preferences. Each one has cost this repo a build or a false result.

1. **Never read a gate's exit code through a pipe.** `npm run test:run | tail -8` reports `tail`'s status, so a failing suite reads as green. Redirect, check unpiped, then read the file:
   ```bash
   npm run test:run > "$LOG/suite.log" 2>&1; echo "EXIT=$?"
   grep -E "Test Files|Tests " "$LOG/suite.log"
   ```
2. **Logs go in the session scratchpad, never `/tmp`.** `/tmp` is shared across sessions; a peer's log has overwritten one of ours and been read as our own result. Set `LOG` to this session's scratchpad directory once, at the start.
3. **Every `src/app/*.ts(x)` is CRLF.** Use the **Edit** tool on them. The **Write** tool re-lines a CRLF file to LF, which `git diff` hides because `core.autocrlf=true` normalises it back on the way in. `docs/**` and `CHANGELOG.md` are LF and safe for Write. Never touch `src/app/i18n.de.ts` with Edit — it corrupts umlauts; patch it with an anchored node utf8 write matching `\r\n`.
4. **Never run two vitest processes at once.** A red run carrying `Failed to start forks worker` is machine contention, not a defect — re-run it, do not debug it.
5. **`npx tsc --noEmit` exits 2 on diagnostics, not 1.** Test for non-zero.
6. **The full unit suite exceeds a 10-minute local cap.** Use the named risk surface in Task 13. CI owns the full suite and the coverage floors.
7. **`npm run lint` exits 1 from gitignored `.worktrees/` and `.demo-tmp/` leftovers.** Use `npx eslint --max-warnings=0 src scripts e2e`.

## File structure

| File | Change | Responsibility after |
|---|---|---|
| `src/app/template-apply.ts` | modify | `appendSeed` becomes the allow-listing choke point; `applyTemplate` keeps only `sanitizeSeedTask` |
| `src/app/new-project-workspace.test.ts` | modify (append — it already exists) | Unit 3 behaviour: hostile payload through the AI branch, idempotency, template branch unchanged |
| `src/app/note-log-policy.ts` | create | DOM-free note-log validation core, parameterised by injected html ops |
| `src/app/note-log-policy.test.ts` | create | Table-driven divergence suite + DOM-free source scan |
| `src/app/note-log.ts` | modify | Canonical caller; passes `sanitizeRichHtml` / `htmlToText` |
| `src/app/templates.ts` | modify | Seed caller; passes `sanitizeRichText` / `htmlPlainProjection`, stays DOM-free |
| `src/app/template-note-carry.test.ts` | modify | One test flips from drop to mint |
| `src/app/local-file-backend.ts` | modify | `openFile()` returns a handle; new `loadFrom(handle)`; `load()` delegates |
| `src/app/storage.ts` | modify | `openFileForBackend` returns `Promise<FsHandle> | null` |
| `src/app/use-storage-backend.ts` | modify | Commits the handle only on accept. **At exactly 800 lines — see Task 11** |
| `src/app/use-storage-file-ops.ts` | modify | Commits immediately (adoption is the intent there) |
| `src/app/local-file-backend.test.ts` | modify | `loadFrom` / `openFile` contract |
| `src/app/use-storage-backend.test.tsx` | modify | The decline-path probe §287 says has never existed |
| `docs/open-followups.md` | modify | Close §286, §287, §288 |
| `CHANGELOG.md`, `src/app/version.ts` | modify | Release |

## Non-goals — do not do these

- The four write paths that skip load-time rich-field sanitising (CSV, Markdown, both Turso layouts). §288 explicitly warns against leaning on load-time normalisation; widening to fix it is a separate entry.
- §152's deliberately inverted decline-path guard clause in `onOpenStorageFile`.
- `onPickStorageFile` — the write half of the same ordering pair.
- `evaluateSaveGuard`, the note-log caps themselves, or `remapSeed`.
- Any new gate for UI-surface delete-route completeness (that is §293, filed not built).

---

# UNIT 3 — §288: the allow-list moves into the shared tail

### Task 1: Prove the gap exists (the red step)

**Files:**
- Modify: `src/app/new-project-workspace.test.ts` — ★★★ **IT ALREADY EXISTS.** 99 lines, carrying `describe("buildNewProjectWorkspace")` and `describe("buildNewProjectWorkspace aiSeed")`. **APPEND** a new describe block with the **Edit** tool. Do not recreate it, and never use the Write tool on it.

- [ ] **Step 1: Set the log directory for this session**

```bash
export LOG="<session scratchpad path>"   # NOT /tmp
mkdir -p "$LOG"
```

- [ ] **Step 2: Write the failing test**

Confirm the file's current shape before touching it:

```bash
wc -l src/app/new-project-workspace.test.ts
grep -n "^describe\|^import" src/app/new-project-workspace.test.ts
```

Expected: 99 lines, two describe blocks, the second named `buildNewProjectWorkspace aiSeed`, and existing imports of `buildNewProjectWorkspace`, `ProjectTemplate`, `TemplateSeed` and `ProjectMeta`. **Append** the block below with the Edit tool, reusing those imports rather than redeclaring them, and check whether the existing `aiSeed` fixtures already give you a usable meta object before adding another.

```ts
import { describe, expect, it } from "vitest";
import { buildNewProjectWorkspace } from "./new-project-workspace";
import type { ProjectMeta } from "./types";

const META = { id: "p1", name: "P" } as unknown as ProjectMeta;
const HOSTILE = "<p>ok</p><script>alert(1)</script>";

/** A seed shaped like one `proposalToSeed` returns, carrying a hostile rich
 *  field on each of the three entities that reach the workspace without an
 *  allow-list pass today. */
function hostileSeed() {
  return {
    raid: [{ id: 1, title: "R", description: HOSTILE, mitigation: HOSTILE }],
    changes: [{ id: 1, title: "C", description: HOSTILE, impactDescription: HOSTILE, resolutionNotes: HOSTILE }],
    milestones: [{ id: 1, name: "M", description: HOSTILE }],
  } as never;
}

describe("buildNewProjectWorkspace — the AI-seed branch is allow-listed (§288)", () => {
  it("strips a script element from a seeded RAID description", () => {
    const ws = buildNewProjectWorkspace(META, { aiSeed: hostileSeed(), includeSeed: true });
    expect(ws.raid[0].description).not.toContain("<script");
  });

  it("strips a script element from a seeded RAID mitigation", () => {
    // ★ SEPARATE it() ON PURPOSE. vitest aborts at the first failing hard
    // assertion, so a second expect in the block above would be UNPROVED on a
    // tree where the first one fails — which is exactly the tree this suite is
    // written against.
    const ws = buildNewProjectWorkspace(META, { aiSeed: hostileSeed(), includeSeed: true });
    expect(ws.raid[0].mitigation).not.toContain("<script");
  });

  it("strips a script element from a seeded change's three rich fields", () => {
    const ws = buildNewProjectWorkspace(META, { aiSeed: hostileSeed(), includeSeed: true });
    const c = ws.changes![0];
    expect([c.description, c.impactDescription, c.resolutionNotes].join("")).not.toContain("<script");
  });

  it("strips a script element from a seeded milestone description", () => {
    const ws = buildNewProjectWorkspace(META, { aiSeed: hostileSeed(), includeSeed: true });
    expect(ws.milestones![0].description).not.toContain("<script");
  });

  it("seeds the rows at all (anti-vacuity)", () => {
    // ★★ WITHOUT THIS, every assertion above passes on an empty workspace. A
    // seed branch that silently dropped all three entities would satisfy
    // "does not contain <script>" perfectly.
    const ws = buildNewProjectWorkspace(META, { aiSeed: hostileSeed(), includeSeed: true });
    expect(ws.raid).toHaveLength(1);
    expect(ws.changes).toHaveLength(1);
    expect(ws.milestones).toHaveLength(1);
  });
});
```

- [ ] **Step 3: Run it and confirm it fails for the right reason**

```bash
npx vitest run --reporter=dot src/app/new-project-workspace.test.ts > "$LOG/u3-red.log" 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests |not to contain" "$LOG/u3-red.log"
```

Expected: EXIT non-zero. The four `<script>` tests FAIL; the anti-vacuity test PASSES. If the anti-vacuity test also fails, the fixture shape is wrong — fix the fixture before going on, because the four failures would then be proving nothing.

- [ ] **Step 4: Commit the red test**

```bash
git add src/app/new-project-workspace.test.ts
git commit --only src/app/new-project-workspace.test.ts -m "test(seed): pin the AI branch's missing allow-list pass, red against today's tree"
```

---

### Task 2: Move the four passes into `appendSeed`

**Files:**
- Modify: `src/app/template-apply.ts` (`appendSeed`, `applyTemplate`)

- [ ] **Step 1: Read the current tail of `applyTemplate`**

```bash
grep -n "seed.raid.map(allowListRaid)\|seed.changes.map(allowListChange)\|seed.milestones.map(allowListRich)\|return appendSeed" src/app/template-apply.ts
```

Expected: four lines. The last is `return appendSeed(base, remapSeed(ws, seed));`.

- [ ] **Step 2: Add the allow-list pass to `appendSeed`**

Using the **Edit** tool (this file is CRLF), replace the opening of `appendSeed`:

```ts
export function appendSeed(ws: Workspace, seed: TemplateSeed): Workspace {
  return {
    ...ws,
```

with:

```ts
/** ★★★ THE ALLOW-LIST RUNS HERE, not in `applyTemplate`, and that placement is
 *  the whole of open-followups §288. `applyTemplate` and the AI-seed branch of
 *  `buildNewProjectWorkspace` end in the IDENTICAL `appendSeed(…, remapSeed(…))`
 *  tail; the four passes used to sit above only the template one, so a seed the
 *  model produced reached a workspace with no allow-list pass at all.
 *  ★★ Fixing it at the PRODUCER (`proposalToSeed`) was rejected for the reason
 *  the §228 comment in this same file already gives about fixing at save: apply
 *  is the only ingress into a workspace, so a producer-side fix leaves every
 *  other seed source — including one added tomorrow — unprotected.
 *  ★★ The passes are IDEMPOTENT and must stay so: an AI task already met
 *  `sanitizeAiRichText` in `buildSeedTask` and now meets `allowListRich` too.
 *  `allowListNoteLog` re-derives `text` from the html at every boundary, so it
 *  is idempotent by construction; `sanitizeRichHtml` is idempotent under its
 *  default configuration. Both are pinned by tests — do not assume either. */
export function appendSeed(ws: Workspace, seed: TemplateSeed): Workspace {
  const allowed = allowListSeed(seed);
  return {
    ...ws,
```

- [ ] **Step 3: Point the spread at the allow-listed seed**

Within the same `return` object, replace every `seed.` with `allowed.` — there are seven properties (`tasks`, `milestones`, `raid`, `changes`, `stakeholders`, `budgets`, `resources`). The body becomes:

```ts
    tasks: allowed.tasks ? [...ws.tasks, ...allowed.tasks] : ws.tasks,
    milestones: allowed.milestones
      ? [...(ws.milestones ?? []), ...allowed.milestones]
      : ws.milestones,
    raid: allowed.raid ? [...ws.raid, ...allowed.raid] : ws.raid,
    changes: allowed.changes
      ? [...(ws.changes ?? []), ...allowed.changes]
      : ws.changes,
    stakeholders: allowed.stakeholders
      ? [...(ws.stakeholders ?? []), ...allowed.stakeholders]
      : ws.stakeholders,
    budgets: allowed.budgets ? [...(ws.budgets ?? []), ...allowed.budgets] : ws.budgets,
    resources: allowed.resources ? [...(ws.resources ?? []), ...allowed.resources] : ws.resources,
```

- [ ] **Step 4: Add `allowListSeed` immediately above `appendSeed`**

```ts
/** The four allow-list passes, applied to a whole seed. Tasks and milestones
 *  share `allowListRich` (description + note log); RAID adds `mitigation` and
 *  changes add `impactDescription` + `resolutionNotes`.
 *  ★ Stakeholders, budgets and resources carry no rich HTML field, so they are
 *  deliberately absent rather than overlooked — see AI_RICH_FIELDS in
 *  `ai-rich-text.ts`, whose entity list is the same three. */
function allowListSeed(seed: TemplateSeed): TemplateSeed {
  let out = seed;
  if (out.tasks) out = { ...out, tasks: out.tasks.map(allowListRich) };
  if (out.raid) out = { ...out, raid: out.raid.map(allowListRaid) };
  if (out.changes) out = { ...out, changes: out.changes.map(allowListChange) };
  if (out.milestones) out = { ...out, milestones: out.milestones.map(allowListRich) };
  return out;
}
```

- [ ] **Step 5: Remove the now-duplicated passes from `applyTemplate`**

Delete these four blocks from `applyTemplate`, keeping `sanitizeSeedTask` (validation, not allow-listing) and keeping the explanatory comments about milestones being the fourth seeded entity by relocating them to `allowListSeed`:

```ts
  if (seed.raid) {
    seed = { ...seed, raid: seed.raid.map(allowListRaid) };
  }
  if (seed.changes) {
    seed = { ...seed, changes: seed.changes.map(allowListChange) };
  }
  if (seed.milestones) {
    seed = { ...seed, milestones: seed.milestones.map(allowListRich) };
  }
```

and drop the trailing `.map(allowListRich)` from the tasks chain so it reads:

```ts
  const seed = tpl.seed.tasks
    ? {
        ...tpl.seed,
        tasks: tpl.seed.tasks
          .map(sanitizeSeedTask)
          .filter((x): x is Task => x !== null),
      }
    : tpl.seed;
```

Note `seed` becomes `const` — it is no longer reassigned. `eslint` will fail on a `let` that is never reassigned.

- [ ] **Step 6: Run the unit-3 test and confirm it now passes**

```bash
npx vitest run --reporter=dot src/app/new-project-workspace.test.ts src/app/template-apply.test.ts src/app/template-note-carry.test.ts > "$LOG/u3-green.log" 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " "$LOG/u3-green.log"
```

Expected: EXIT=0. If `template-apply.test.ts` fails, read the failure before changing anything — a template-path assertion breaking means the move changed template behaviour, which it must not.

- [ ] **Step 7: Typecheck**

```bash
npx tsc --noEmit > "$LOG/u3-tsc.log" 2>&1; echo "EXIT=$?"
```

Expected: EXIT=0 (remember: 2 means diagnostics, not 1).

- [ ] **Step 8: Commit**

```bash
git add src/app/template-apply.ts
git commit --only src/app/template-apply.ts -m "fix(seed): allow-list in appendSeed, the tail both seed branches share

open-followups 288. applyTemplate and the AI-seed branch of
buildNewProjectWorkspace end in the identical appendSeed(remapSeed(...)) tail.
The four allow-list passes sat above only the template one, so a model-produced
seed reached the workspace with no allow-list pass at all.

Fixing it at the producer (proposalToSeed) was rejected on the grounds this file
already records for 228: apply is the only ingress into a workspace, so a
producer-side fix leaves every other seed source unrepaired."
```

---

### Task 3: Verify the two consequences, rather than assuming them

**Files:**
- Modify: `src/app/new-project-workspace.test.ts`

- [ ] **Step 1: Verify `remapSeed` does not touch rich fields**

The passes used to run BEFORE `remapSeed` and now run after it. Prove the reorder is inert:

```bash
sed -n "$(grep -n 'function remapSeed' src/app/template-apply.ts | cut -d: -f1),+45p" src/app/template-apply.ts | grep -nE "description|noteLog|mitigation|impactDescription|resolutionNotes"
```

Expected: no output. `remapSeed` rewrites ids and foreign keys only. If this prints anything, STOP and report — the reorder is not inert and the design needs revisiting.

- [ ] **Step 2: Add the idempotency and template-unchanged tests**

Append to `src/app/new-project-workspace.test.ts`:

```ts
import { appendSeed } from "./template-apply";

describe("appendSeed — the allow-list is idempotent (§288)", () => {
  // ★★★ THIS IS A PRECONDITION OF THE FIX, NOT A NICE-TO-HAVE. An AI-seeded
  // task already met `sanitizeAiRichText` in `buildSeedTask` and now meets
  // `allowListRich` as well. If a second pass altered the bytes, seeding would
  // corrupt exactly the content it is meant to protect.
  const seeded = () =>
    ({ raid: [{ id: 1, title: "R", description: "<p>ok</p><script>alert(1)</script>" }] }) as never;

  it("produces identical bytes on a second application", () => {
    const base = { ...emptyLike(), raid: [] } as never;
    const once = appendSeed(base, seeded());
    const twice = appendSeed(base, { raid: once.raid } as never);
    expect(twice.raid[0].description).toBe(once.raid[0].description);
  });

  it("actually changed something on the FIRST application (anti-vacuity)", () => {
    // ★★ Without this, a no-op allow-list would satisfy the idempotency test
    // perfectly — two identical no-ops agree.
    const base = { ...emptyLike(), raid: [] } as never;
    const once = appendSeed(base, seeded());
    expect(once.raid[0].description).not.toContain("<script");
  });
});
```

Define `emptyLike()` in the file as a minimal `Workspace` with the seven arrays `appendSeed` reads, so the test does not depend on `emptyWorkspace()`'s full shape.

- [ ] **Step 3: Add the template-branch regression pin**

```ts
it("leaves the template branch's output unchanged", () => {
  // The passes MOVED; template behaviour must not. This is the pin that a
  // template-path regression would trip.
  const tpl = { fieldVisibility: {}, seed: { raid: [{ id: 1, title: "R", description: "<p>ok</p><script>x</script>" }] } } as never;
  const ws = buildNewProjectWorkspace(META, { template: tpl, includeSeed: true });
  expect(ws.raid[0].description).not.toContain("<script");
  expect(ws.raid).toHaveLength(1);
});
```

- [ ] **Step 4: Run**

```bash
npx vitest run --reporter=dot src/app/new-project-workspace.test.ts > "$LOG/u3-verify.log" 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " "$LOG/u3-verify.log"
```

Expected: EXIT=0.

- [ ] **Step 5: Mutation-test the move, and record which mutant backs which block**

Revert `allowListSeed`'s `raid` line to a pass-through (`if (out.raid) out = { ...out, raid: out.raid };`), re-run, and record which tests go red. Then restore it with an anchored inverse edit and prove the tree is clean:

```bash
git diff --stat src/app/template-apply.ts   # must be EMPTY after restoring
```

Add the mutation record as a comment at the top of the describe block, naming the mutant and the exact assertions it killed. **If one mutant kills several assertions, say so** — it then proves none of them in isolation.

- [ ] **Step 6: Commit**

```bash
git add src/app/new-project-workspace.test.ts
git commit --only src/app/new-project-workspace.test.ts -m "test(seed): pin idempotency, the template branch, and the remap reorder"
```

---

# UNIT 2 — §286: one note-log policy, canonical semantics

### Task 4: Extract the DOM-free core

**Files:**
- Create: `src/app/note-log-policy.ts`
- Test: `src/app/note-log-policy.test.ts`

- [ ] **Step 1: Write the core**

Create `src/app/note-log-policy.ts`. It must import nothing that reaches `./sanitize-html`.

```ts
import type { NoteLogEntry } from "./types";

/**
 * The note-log validation policy, shared by the canonical validator
 * (`sanitizeNoteLog`, note-log.ts) and the template seed's
 * (`sanitizeSeedNoteLog`, templates.ts).
 *
 * ★★★ THIS FILE IS DOM-FREE BY CONTRACT and its test enforces that with a
 * comment-stripped source scan. `templates.ts` sits in the sample generator's
 * import graph and cannot reach DOMPurify; that is the ONE forced difference
 * between the two validators. Every other difference was unforced, and
 * open-followups §286 records the six that had accumulated.
 *
 * The DOM-dependent steps are injected. Everything else — entry cap, byte html
 * cap, control-char stripping, timestamp validation, mint-and-dedupe — lives
 * here once, with the CANONICAL semantics.
 */
export interface NoteLogHtmlOps {
  /** Clean an html fragment. Canonical: `sanitizeRichHtml`. Seed:
   *  `sanitizeRichText` against `RICH_SINK`. */
  sanitizeHtml: (raw: string) => string;
  /** Project cleaned html to plain text. Canonical: `htmlToText`. Seed:
   *  `htmlPlainProjection`. */
  toText: (html: string) => string;
}

export const MAX_NOTE_ENTRIES = 500;
export const MAX_NOTE_TEXT = 4000;
export const MAX_AUTHOR_NAME = 200;
export const MAX_NOTE_HTML = 20000;

const NEWLINE_TAB = /[\r\n\t]+/g;
const CONTROL_CHARS = /[\x00-\x1f]/g;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isValidTimestamp(v: unknown): v is string {
  return typeof v === "string" && v !== "" && !Number.isNaN(Date.parse(v));
}

function cleanText(v: unknown, cap: number): string {
  return (typeof v === "string" ? v : "")
    .replace(NEWLINE_TAB, " ")
    .replace(CONTROL_CHARS, "")
    .trim()
    .slice(0, cap);
}

/** Minimal escape for wrapping legacy plain text in a synthetic paragraph. */
function escapeForHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Accept only well-formed note entries from untrusted JSON.
 *
 * ★★ A missing or duplicate `id` is MINTED, never dropped. Legacy entries with
 * no id exist — that is what the canonical repair was written for — and the
 * notes window edits and deletes BY id, so two entries sharing one id leave the
 * other unaddressable. §168's heading is "template import drops every
 * register's note log"; dropping here would leave it fixed except for exactly
 * the entries it was filed about.
 */
export function sanitizeNoteLogWith(raw: unknown, ops: NoteLogHtmlOps): NoteLogEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: NoteLogEntry[] = [];
  const usedIds = new Set<number>();
  let nextMintId = 1;

  for (const entry of raw) {
    if (out.length >= MAX_NOTE_ENTRIES) break;
    if (!isPlainObject(entry)) continue;
    if (!isValidTimestamp(entry.timestamp)) continue;

    let text = cleanText(entry.text, MAX_NOTE_TEXT);

    const htmlSource = typeof entry.html === "string" ? entry.html.trim() : "";
    const hasHtml = htmlSource !== "";
    const html = (hasHtml
      ? ops.sanitizeHtml(htmlSource)
      : ops.sanitizeHtml(`<p>${escapeForHtml(text)}</p>`)
    ).slice(0, MAX_NOTE_HTML);

    if (hasHtml && !text) text = cleanText(ops.toText(html), MAX_NOTE_TEXT);
    if (!text) continue;

    const rawId = typeof entry.id === "number" ? entry.id : NaN;
    let id: number;
    if (Number.isFinite(rawId) && rawId > 0 && !usedIds.has(Math.floor(rawId))) {
      id = Math.floor(rawId);
    } else {
      id = nextMintId;
      while (usedIds.has(id)) id++;
    }
    usedIds.add(id);
    nextMintId = Math.max(nextMintId, id + 1);

    const item: NoteLogEntry = { id, timestamp: entry.timestamp, html, text };

    const authorId = typeof entry.authorResourceId === "number" ? entry.authorResourceId : NaN;
    if (Number.isFinite(authorId) && authorId > 0) item.authorResourceId = Math.floor(authorId);

    const name = cleanText(entry.authorName, MAX_AUTHOR_NAME);
    if (name) item.authorName = name;

    const editedAt = typeof entry.editedAt === "string" ? entry.editedAt.trim() : "";
    if (editedAt) item.editedAt = editedAt;

    out.push(item);
  }
  return out;
}
```

- [ ] **Step 2: Confirm the file has no DOM-reaching import**

```bash
grep -n "^import" src/app/note-log-policy.ts
```

Expected: one line, `import type { NoteLogEntry } from "./types";`. A `type`-only import erases at compile time and reaches nothing.

- [ ] **Step 3: Write the divergence suite**

Create `src/app/note-log-policy.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { stripComments } from "../test/strip-comments";
import { sanitizeNoteLogWith, MAX_NOTE_ENTRIES, type NoteLogHtmlOps } from "./note-log-policy";

/** A DOM-free stand-in: strips tags the way an allow-list would, without a DOM.
 *  The point of these tests is the POLICY, not the html step. */
const OPS: NoteLogHtmlOps = {
  sanitizeHtml: (raw) => raw.replace(/<script[\s\S]*?<\/script>/gi, ""),
  toText: (html) => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim(),
};

const ts = "2026-08-30T00:00:00.000Z";

describe("sanitizeNoteLogWith — the six behaviours that used to diverge (§286)", () => {
  it("caps the entry count", () => {
    const raw = Array.from({ length: MAX_NOTE_ENTRIES + 10 }, (_, i) => ({ id: i + 1, timestamp: ts, text: "t" }));
    expect(sanitizeNoteLogWith(raw, OPS)).toHaveLength(MAX_NOTE_ENTRIES);
  });

  it("MINTS an id when one is missing, instead of dropping the entry", () => {
    // ★★★ THE ROW THAT BITES. The seed validator used to drop these, so §168
    // was fixed except for exactly the legacy entries the canonical repair was
    // written for.
    const out = sanitizeNoteLogWith([{ timestamp: ts, text: "kept" }], OPS);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBeGreaterThan(0);
  });

  it("de-dupes two entries sharing one id", () => {
    const out = sanitizeNoteLogWith(
      [{ id: 1, timestamp: ts, text: "a" }, { id: 1, timestamp: ts, text: "b" }],
      OPS,
    );
    expect(out).toHaveLength(2);
    expect(out[0].id).not.toBe(out[1].id);
  });

  it("rejects a timestamp that does not parse as a date", () => {
    expect(sanitizeNoteLogWith([{ id: 1, timestamp: "not-a-date", text: "t" }], OPS)).toHaveLength(0);
  });

  it("accepts a timestamp that does parse (positive control)", () => {
    // ★★ Without this, a validator that rejected EVERY timestamp would satisfy
    // the assertion above.
    expect(sanitizeNoteLogWith([{ id: 1, timestamp: ts, text: "t" }], OPS)).toHaveLength(1);
  });

  it("strips control characters from text", () => {
    const out = sanitizeNoteLogWith([{ id: 1, timestamp: ts, text: "ab" }], OPS);
    expect(out[0].text).toBe("ab");
  });

  it("strips control characters from authorName", () => {
    const out = sanitizeNoteLogWith([{ id: 1, timestamp: ts, text: "t", authorName: "xy" }], OPS);
    expect(out[0].authorName).toBe("xy");
  });

  it("caps a long authorName", () => {
    const out = sanitizeNoteLogWith([{ id: 1, timestamp: ts, text: "t", authorName: "a".repeat(500) }], OPS);
    expect(out[0].authorName!.length).toBeLessThanOrEqual(200);
  });
});

describe("note-log-policy.ts is DOM-free", () => {
  const PATH = "src/app/note-log-policy.ts";
  const src = readFileSync(PATH, "utf8");
  const codeOnly = stripComments(src, PATH);

  it("still contains the function body after stripping (anti-vacuity)", () => {
    // ★★ A stripper that ate everything would make the scan below vacuously
    // green. Anchor on something the scan must be able to see.
    expect(codeOnly).toContain("sanitizeNoteLogWith");
  });

  it("imports nothing that reaches DOMPurify", () => {
    expect(codeOnly).not.toContain("sanitize-html");
    expect(codeOnly).not.toContain("dompurify");
  });
});
```

- [ ] **Step 4: Run**

```bash
npx vitest run --reporter=dot src/app/note-log-policy.test.ts > "$LOG/u2-core.log" 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " "$LOG/u2-core.log"
```

Expected: EXIT=0, 10 tests passed.

- [ ] **Step 5: Commit**

```bash
git add src/app/note-log-policy.ts src/app/note-log-policy.test.ts
git commit --only src/app/note-log-policy.ts src/app/note-log-policy.test.ts -m "feat(note-log): extract the DOM-free validation policy both validators will share"
```

---

### Task 5: Both callers adopt the core

**Files:**
- Modify: `src/app/note-log.ts`, `src/app/templates.ts`

- [ ] **Step 1: Rewrite the canonical validator as a call into the core**

In `src/app/note-log.ts`, using **Edit**, replace the whole body of `sanitizeNoteLog` with:

```ts
export function sanitizeNoteLog(raw: unknown): NoteLogEntry[] {
  return sanitizeNoteLogWith(raw, { sanitizeHtml: sanitizeRichHtml, toText: htmlToText });
}
```

Add the import, and delete the now-unused local `MAX_NOTE_*` constants, `NEWLINE_TAB`, `CONTROL_CHARS`, `isValidTimestamp`, `cleanText` and `escapeForHtml` **only if nothing else in the file uses them** — check first:

```bash
grep -n "MAX_NOTE_TEXT\|MAX_NOTE_HTML\|MAX_AUTHOR_NAME\|cleanText\|escapeForHtml\|isValidTimestamp\|NEWLINE_TAB\|CONTROL_CHARS" src/app/note-log.ts
```

Anything still referenced elsewhere in the file stays. `eslint --max-warnings=0` makes an unused local fatal, so leaving a dead one fails the gate.

- [ ] **Step 2: Rewrite the seed validator as a call into the core**

In `src/app/templates.ts`, replace `sanitizeSeedNoteLog`'s body with:

```ts
function sanitizeSeedNoteLog(raw: unknown): NoteLogEntry[] | undefined {
  // ★★ Same policy as the canonical validator — only the two html steps differ,
  // because this file is DOM-free by contract (sample-generator import graph).
  // The six unforced divergences open-followups §286 recorded are gone; the
  // policy lives once, in note-log-policy.ts.
  const out = sanitizeNoteLogWith(raw, {
    sanitizeHtml: (h) => sanitizeRichText(h, TEXTAREA_MAX, RICH_SINK),
    toText: htmlPlainProjection,
  });
  return out.length ? out : undefined;
}
```

The `undefined`-when-empty return is this caller's own contract and is preserved deliberately — callers distinguish "no note log" from "an empty one".

- [ ] **Step 3: Confirm `templates.ts` still does not import `note-log.ts`**

```bash
grep -n "from \"./note-log\"" src/app/templates.ts
```

Expected: no output. It must import from `./note-log-policy` only. If this prints a line, the DOM-free contract is broken.

- [ ] **Step 4: Run both callers' suites**

```bash
npx vitest run --reporter=dot src/app/note-log.test.ts src/app/templates.test.ts src/app/note-log-policy.test.ts > "$LOG/u2-adopt.log" 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests |×" "$LOG/u2-adopt.log" | head -20
```

Expected: some failures — the seed validator's behaviour changed on purpose. Read each one and classify it before touching anything: a failure asserting the OLD divergence is expected and its test flips in Task 6; any other failure is a real regression.

- [ ] **Step 5: Commit**

```bash
git add src/app/note-log.ts src/app/templates.ts
git commit --only src/app/note-log.ts src/app/templates.ts -m "fix(note-log): route both validators through the shared policy

open-followups 286. The two validators diverged in six ways and only one — the
DOM dependency — was forced. Both now call sanitizeNoteLogWith with their own
html ops; the seed validator gains the canonical entry cap, byte html cap,
control-char stripping, timestamp validation and mint-and-dedupe."
```

---

### Task 6: Flip the test that certified the drop

**Files:**
- Modify: `src/app/template-note-carry.test.ts`

- [ ] **Step 1: Read the test as it stands**

```bash
sed -n '25,50p' src/app/template-note-carry.test.ts
```

- [ ] **Step 2: Flip it**

Rename `drops an entry with no usable id or timestamp, keeping its siblings` to `mints an id for an entry that has none, and drops one with no usable timestamp` and rewrite its assertions so an id-less entry is KEPT with a minted id while a bad-timestamp entry is still dropped. Add above it:

```ts
// ★★★ THIS TEST WAS FLIPPED, and that is the fix rather than a retreat. It
// certified the seed validator's DROP of an id-less entry as intended
// behaviour — but §168's heading is "template import drops every register's
// note log", and dropping here left it fixed except for exactly the legacy
// entries the canonical repair was written for. The canonical validator MINTS,
// and open-followups §286 records the decision that canonical wins.
```

- [ ] **Step 3: Run**

```bash
npx vitest run --reporter=dot src/app/template-note-carry.test.ts src/app/templates.test.ts src/app/note-log.test.ts > "$LOG/u2-flip.log" 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " "$LOG/u2-flip.log"
```

Expected: EXIT=0.

- [ ] **Step 4: Commit, saying plainly that a test changed**

```bash
git add src/app/template-note-carry.test.ts
git commit --only src/app/template-note-carry.test.ts -m "test(templates): flip the assertion that certified dropping an id-less note entry

The test encoded the behaviour being corrected, not a property worth keeping.
It asserted that the seed validator DROPS an entry with no usable id; the
canonical validator MINTS one, because legacy entries without an id are exactly
what that repair was written for. Recorded here rather than weakened quietly."
```

---

# UNIT 1 — §287: the caller commits the handle

### Task 7: Extract `loadFrom` without adding an exit

**Files:**
- Modify: `src/app/local-file-backend.ts`

- [ ] **Step 1: Read `load()` in full and count its exits**

```bash
sed -n "$(grep -n 'async load(' src/app/local-file-backend.ts | head -1 | cut -d: -f1),+75p" src/app/local-file-backend.ts
```

Note the two diagnostic mechanisms the method's own comment describes: a `finally` publishing `lastLoadTruncation`, and an import-flag reset placed ABOVE the first possible exit. The comment warns that a new early return is the shape that broke `sharepoint-backend.load()`. **This extraction must add no exit.**

- [ ] **Step 2: Rename and re-sign**

Change the signature from `async load(): Promise<Workspace> {` to:

```ts
  /**
   * Load from an EXPLICIT handle, without consulting or touching stored state.
   *
   * ★★★ THIS IS THE READ HALF OF THE COMMIT-ON-ACCEPT SPLIT (§287). A caller
   * that has picked a file but not yet been authorised to adopt it reads
   * through here; nothing it does can re-point the backend. `load()` is the
   * thin wrapper that supplies the STORED handle.
   * ★★ Both diagnostic mechanisms live in this body unchanged — the `finally`
   * publishing `lastLoadTruncation`, and the import-flag reset above the first
   * possible exit. Adding an early return here is the shape that broke
   * `sharepoint-backend.load()`; do not add one.
   */
  async loadFrom(handle: FsHandle | null): Promise<Workspace> {
```

and inside the body replace `const handle = await this.getHandle();` with nothing — the parameter now supplies it. The `if (!handle) throw new StorageNotReadyError("local-file-not-picked");` line stays exactly where it is.

- [ ] **Step 3: Add the thin `load()` wrapper directly beneath**

```ts
  async load(): Promise<Workspace> {
    return this.loadFrom(await this.getHandle());
  }
```

- [ ] **Step 4: Confirm the exit count is unchanged**

```bash
sed -n "$(grep -n 'async loadFrom(' src/app/local-file-backend.ts | cut -d: -f1),$(grep -n 'async requestWriteAccess(' src/app/local-file-backend.ts | cut -d: -f1)p" src/app/local-file-backend.ts | grep -cE "^\s*(return|throw)"
```

Record the number. It must equal the count from the pre-change body — compare against `git show HEAD:src/app/local-file-backend.ts` run through the same filter.

- [ ] **Step 5: Run and commit**

```bash
npx vitest run --reporter=dot src/app/local-file-backend.test.ts > "$LOG/u1-loadfrom.log" 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " "$LOG/u1-loadfrom.log"
```

Expected: EXIT=0 — this step is a pure refactor and every existing test must pass untouched.

```bash
git add src/app/local-file-backend.ts
git commit --only src/app/local-file-backend.ts -m "refactor(storage): split loadFrom(handle) out of load(), adding no exit"
```

---

### Task 8: `openFile()` returns the handle instead of persisting it

**Files:**
- Modify: `src/app/local-file-backend.ts`, `src/app/storage.ts`

- [ ] **Step 1: Change `openFile`**

```ts
  /**
   * Pick a file and return its handle WITHOUT persisting it.
   *
   * ★★★ THE CALLER COMMITS (§287). This used to end `idbSet(this.idbKey,
   * handle)`, which pointed the ACTIVE backend at the picked file BEFORE the
   * caller asked the user whether to overwrite their live tasks — so declining
   * kept the workspace and re-pointed storage anyway, and the next debounced
   * save wrote the live project over a file the user had just refused. The
   * `idbKey` is derived from the backend KIND, not the instance, so it really
   * was the active slot.
   * ★★ `tryGrantPermission` STAYS here: it must run inside the user-gesture
   * context that opened the picker.
   * ★ Commit with `setHandle(handle)` once the user has accepted.
   */
  async openFile(): Promise<FsHandle> {
    const handle = await pickOpenFile(this.format);
    await tryGrantPermission(handle, "readwrite");
    return handle;
  }
```

- [ ] **Step 2: Widen the facade signature**

In `src/app/storage.ts`:

```ts
export function openFileForBackend(
  backend: StorageBackend,
): Promise<FsHandle> | null {
  if (backend instanceof LocalFileBackend) return backend.openFile();
  return null;
}
```

- [ ] **Step 3: Typecheck to find every caller the change breaks**

```bash
npx tsc --noEmit > "$LOG/u1-tsc-callers.log" 2>&1; echo "EXIT=$?"
grep -E "error TS" "$LOG/u1-tsc-callers.log" | head
```

Expected: errors naming `use-storage-backend.ts` and `use-storage-file-ops.ts` only. Anything else is a caller this plan did not anticipate — report it rather than fixing it silently.

---

### Task 9: The two callers commit deliberately

**Files:**
- Modify: `src/app/use-storage-file-ops.ts`, `src/app/use-storage-backend.ts`

- [ ] **Step 1: The adoption caller commits immediately**

In `src/app/use-storage-file-ops.ts`, replace:

```ts
        const open = openFileForBackend(targetBackend);
        if (!open) return;
        await open;
```

with:

```ts
        const open = openFileForBackend(targetBackend);
        if (!open) return;
        // ★ Adoption IS the intent on this path — there is no confirm to lose,
        //   so the handle is committed straight away. Contrast
        //   `onOpenStorageFile`, which must wait for the user (§287).
        await targetBackend.setHandle(await open);
```

- [ ] **Step 2: The confirm caller commits only on accept**

In `src/app/use-storage-backend.ts`, replace:

```ts
    const promise = openFileForBackend(backend);
    if (!promise) return;
    await promise;
    try {
      const loaded = await backend.load();
```

with:

```ts
    const promise = openFileForBackend(backend);
    if (!promise) return;
    const picked = await promise;
    try {
      const loaded = await backend.loadFrom(picked);
```

and inside the accept branch, as the first statement after `suppressNextSaveRef.current = true;`:

```ts
        await backend.setHandle(picked); // ★ commit the pick ONLY now (§287)
```

- [ ] **Step 3: Rewrite the long stale comment above the confirm**

The comment beginning `★★★ A GUARD CLAUSE INVERTED ON PURPOSE` asserts that `openFileForBackend` has already run `idbSet` and that the re-point "is NOT fixed here". That is now false, and it is also the line budget's offset. Replace it with a shorter one that keeps the §152 half (still true) and drops the §287 half:

```ts
      // ★★★ A GUARD CLAUSE INVERTED ON PURPOSE, so ONE report below covers BOTH
      //   exits: the decline path needs the import report and the quoting hold
      //   every bit as much as the apply path does, and an early `return` above
      //   would have silently exempted it (§152). The re-point that used to
      //   happen on BOTH exits is gone — the handle is committed inside the
      //   accept branch now (§287).
```

- [ ] **Step 4: Typecheck**

```bash
npx tsc --noEmit > "$LOG/u1-tsc.log" 2>&1; echo "EXIT=$?"
```

Expected: EXIT=0.

---

### Task 10: The decline-path probe §287 says has never existed

**Files:**
- Modify: `src/app/use-storage-backend.test.tsx`

- [ ] **Step 1: Write the negative — declining must not re-point**

Add to `src/app/use-storage-backend.test.tsx` (CRLF — use **Edit**):

```tsx
  it("does not commit the picked handle when the user declines the overwrite", async () => {
    // ★★★ THE PROBE §287 RECORDS AS NEVER HAVING EXISTED. Before the fix,
    // openFile() persisted the handle before this confirm ran, so declining
    // kept the live workspace AND re-pointed storage — the next debounced save
    // then wrote the live project over a file the user had just refused.
    const backend = useOpenableBackend();
    // ★ `confirmSpy` is created PER TEST in this file — there is no shared
    //   file-level spy to reuse. Verify with:
    //   grep -n 'vi.spyOn(window, "confirm")' src/app/use-storage-backend.test.tsx
    vi.spyOn(window, "confirm").mockReturnValue(false);   // the user declines
    const { result } = renderBackend();
    await act(async () => { await Promise.resolve(); });

    await act(async () => { await result.current.onOpenStorageFile(); });

    expect(backend.setHandle).not.toHaveBeenCalled();
  });

  it("commits the picked handle when the user accepts (positive control)", async () => {
    // ★★ WITHOUT THIS, a backend that refused every open would satisfy the
    // assertion above perfectly. Separate it() — vitest aborts at the first
    // failing hard assertion, so folding these together leaves one unproved.
    const backend = useOpenableBackend();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { result } = renderBackend();
    await act(async () => { await Promise.resolve(); });

    await act(async () => { await result.current.onOpenStorageFile(); });

    expect(backend.setHandle).toHaveBeenCalledTimes(1);
  });
```

Define `useOpenableBackend()` beside the existing `useReloadableBackend()` helper, mocking `openFile` to resolve a sentinel handle and `loadFrom` to resolve a workspace with enough tasks that the confirm is actually reached (the code short-circuits the confirm when `tasks.length === 0`).

- [ ] **Step 2: Add the second half — the label and the handle agree**

```tsx
  it("leaves the storage description naming the file still in use after a decline", async () => {
    // §287's second half: refreshBackendStatus() ran only in the accept branch,
    // so the UI kept naming the PREVIOUS file while the handle pointed at the
    // picked one. With the commit moved, both now describe the same file.
    const backend = useOpenableBackend();
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const { result } = renderBackend();
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await result.current.onOpenStorageFile(); });

    expect(backend.setHandle).not.toHaveBeenCalled();
    expect(backend.describe).not.toHaveBeenCalledWith(expect.anything());
  });
```

- [ ] **Step 3: Run**

```bash
# ★★ `use-storage-file-ops.test.tsx` is deliberately ABSENT from this list — it
#    does not exist. vitest exits 0 on a path that matches nothing, so naming it
#    would make this run report green while testing that file not at all. The
#    hook is covered indirectly through use-storage-backend.test.tsx.
npx vitest run --reporter=dot src/app/use-storage-backend.test.tsx src/app/local-file-backend.test.ts > "$LOG/u1-tests.log" 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " "$LOG/u1-tests.log"
```

Expected: EXIT=0.

- [ ] **Step 4: Mutation-test the fix**

Move `await backend.setHandle(picked);` from inside the accept branch to directly after `const picked = await promise;` — reproducing the old bug. Re-run. The decline test must go RED and the accept test must stay GREEN. Restore with an anchored inverse edit, then prove the tree is clean:

```bash
git diff --stat src/app/use-storage-backend.ts   # must be EMPTY
```

Record the mutant and the assertion it killed as a comment above the decline test.

---

### Task 11: The line budget for `use-storage-backend.ts`

**Files:**
- Verify only: `src/app/use-storage-backend.ts`

- [ ] **Step 1: Measure, with the gate's own arithmetic**

The gate is `const LIMIT = 800` and `if (n <= LIMIT) continue`, counting `readFileSync().split("\n").length` — which for a newline-terminated file is `wc -l` **plus one**. So 800 passes and 801 fails as a NEW file over the limit. The file measured **exactly 800** before this slice: zero headroom.

```bash
node -e "console.log(require('fs').readFileSync('src/app/use-storage-backend.ts','utf8').split('\n').length)"
```

- [ ] **Step 2: If it exceeds 800, take the offset from the comment, not from code**

Task 9 Step 3 already shortens the stale `★★★ A GUARD CLAUSE INVERTED ON PURPOSE` comment, which is the intended offset. If the file is still over, shorten that comment further — never delete a guard, a test hook or an explanatory comment about a live hazard to buy lines.

- [ ] **Step 3: Confirm the gate agrees**

```bash
npm run size:check > "$LOG/u1-size.log" 2>&1; echo "EXIT=$?"
```

Expected: EXIT=0. **Do this before committing, not at gate time** — §229 records this file shipping a build failure by sitting exactly at its limit.

- [ ] **Step 4: Commit Unit 1**

```bash
git add src/app/local-file-backend.ts src/app/storage.ts src/app/use-storage-backend.ts src/app/use-storage-file-ops.ts src/app/use-storage-backend.test.tsx
git commit --only src/app/local-file-backend.ts src/app/storage.ts src/app/use-storage-backend.ts src/app/use-storage-file-ops.ts src/app/use-storage-backend.test.tsx -m "fix(storage): commit the picked file handle only after the user accepts

open-followups 287. LocalFileBackend.openFile() ended by persisting the picked
handle under the ACTIVE backend's key, and the confirm asking whether to
overwrite the live tasks ran afterwards. Declining therefore kept the current
workspace while storage pointed at the picked file, and the next debounced save
wrote the live project over it — behind a UI still naming the previous file,
because refreshBackendStatus() ran only in the accept branch.

openFile() now returns the handle, a new loadFrom(handle) reads without touching
stored state, and setHandle() runs inside the accept branch. There is no window
in which storage points somewhere the user has not agreed to, so no crash or
second tab can widen it.

Staging the handle in memory was rejected: it would reintroduce the same defect
through a save firing during the confirm, safe today only because window.confirm
blocks timers. The add-existing-project flow commits immediately, because
adoption is the intent there and it has no confirm to lose."
```

---

# CLOSE-OUT

### Task 12: Close the three register entries

**Files:**
- Modify: `docs/open-followups.md` (LF — Write/heredoc safe)

- [ ] **Step 1: Understand the four-place edit**

Closing one entry means editing FOUR places, and missing one leaves the register self-contradictory:
1. the `## NNN.` heading (append ` — CLOSED 2026-08-30`)
2. the summary table's status cell
3. the summary table's anchor link, which encodes the heading text
4. the `**Status:**` witness line

**A body line must never contain the word CLOSED** — the `isClosed` witness scans for it and a stray mention in prose makes an open entry read as closed.

- [ ] **Step 2: Note the anchor rule**

GitHub anchor slugs lowercase the text, drop punctuation and turn each space into a hyphen — so an em dash surrounded by spaces yields a **double** hyphen (`only--a-new`). Runs are NOT collapsed. Build the new anchor from the new heading mechanically and verify it against an existing closed entry's anchor before trusting it.

- [ ] **Step 3: Write each Status witness with a real command**

Each must carry an ISO date and either a backticked command or the literal `never machine-verified`. Use the actual verification, for example for §288:

```
**Status:** CLOSED 2026-08-30 — the allow-list moved into `appendSeed`, the tail both
seed branches share. Verified by `npx vitest run src/app/new-project-workspace.test.ts`,
whose hostile-payload assertions were RED against the parent commit.
```

Do not invent a verification. If something was reasoned rather than measured, say so.

- [ ] **Step 4: Cite symbols, never `path:LINE`**

`docs/open-followups.md` is in `doc-claims-check`'s scan set and that gate is a ratchet — a NEW `path:LINE` citation fails it. Write `` `appendSeed` (`template-apply.ts`) ``, never `template-apply.ts:243`.

- [ ] **Step 5: Verify heading/table parity and run the gates**

```bash
npm run followups:status:check > "$LOG/close-followups.log" 2>&1; echo "EXIT=$?"
npm run docs:claims:check > "$LOG/close-claims.log" 2>&1; echo "EXIT=$?"
npm run docs:symbols:check > "$LOG/close-symbols.log" 2>&1; echo "EXIT=$?"
```

Expected: all EXIT=0.

- [ ] **Step 6: Commit**

```bash
git add docs/open-followups.md
git commit --only docs/open-followups.md -m "docs: close 286, 287 and 288"
```

---

### Task 13: Full local gate chain

- [ ] **Step 1: Static gates, each exit code read unpiped**

```bash
npx tsc --noEmit > "$LOG/g-tsc.log" 2>&1; echo "TSC=$?"
npx eslint --max-warnings=0 src scripts e2e > "$LOG/g-lint.log" 2>&1; echo "LINT=$?"
npm run docs:symbols:check > "$LOG/g-symbols.log" 2>&1; echo "SYMBOLS=$?"
npm run docs:claims:check > "$LOG/g-claims.log" 2>&1; echo "CLAIMS=$?"
npm run followups:status:check > "$LOG/g-followups.log" 2>&1; echo "FOLLOWUPS=$?"
npm run size:check > "$LOG/g-size.log" 2>&1; echo "SIZE=$?"
npm run dup:check > "$LOG/g-dup.log" 2>&1; echo "DUP=$?"
```

All must be 0. Use `npx eslint` scoped rather than `npm run lint`, which exits 1 on gitignored `.worktrees/` and `.demo-tmp/` leftovers CI will not have.

- [ ] **Step 2: The risk surface — one vitest process, never two**

```bash
npx vitest run --reporter=dot \
  src/app/new-project-workspace.test.ts \
  src/app/note-log-policy.test.ts \
  src/app/note-log.test.ts \
  src/app/templates.test.ts \
  src/app/template-apply.test.ts \
  src/app/template-note-carry.test.ts \
  src/app/local-file-backend.test.ts \
  src/app/use-storage-backend.test.tsx \
  src/app/storage.test.ts \
  src/app/ai-project-proposal.test.ts \
  src/app/workspace.test.ts \
  > "$LOG/g-vitest.log" 2>&1; echo "VITEST=$?"
grep -E "Test Files|Tests |Failed to start forks" "$LOG/g-vitest.log"
```

A red run carrying `Failed to start forks worker` is machine contention — re-run it, do not debug it.

- [ ] **Step 3: The same surface, shuffled at CI's pinned seed**

```bash
npx vitest run --sequence.shuffle --sequence.seed=1 --reporter=dot \
  src/app/new-project-workspace.test.ts \
  src/app/note-log-policy.test.ts \
  src/app/note-log.test.ts \
  src/app/templates.test.ts \
  src/app/template-apply.test.ts \
  src/app/template-note-carry.test.ts \
  src/app/local-file-backend.test.ts \
  src/app/use-storage-backend.test.tsx \
  src/app/storage.test.ts \
  src/app/ai-project-proposal.test.ts \
  src/app/workspace.test.ts \
  > "$LOG/g-shuffle.log" 2>&1; echo "SHUFFLE=$?"
grep -E "Test Files|Tests " "$LOG/g-shuffle.log"
```

This is the only local reproduction of the `unit-tests-shuffled` gate, and this slice adds test files. It covers intra-file order dependence in the files touched; cross-file leakage across the whole suite is CI's job.

- [ ] **Step 4: State the coverage honestly in the report**

The full suite and the coverage floors do NOT run locally — they exceed the ten-minute cap. Say so rather than reporting "all tests pass".

---

### Task 14: Version bump and CHANGELOG

**Files:**
- Modify: `src/app/version.ts`, `CHANGELOG.md` (both LF-safe for the changelog; `version.ts` is CRLF — use Edit)

- [ ] **Step 1: Bump `version.ts`**

Set `APP_VERSION` to `"0.265.0"`, `APP_BUILD_DATE` to `"2026-08-30"` with a trailing comment naming the slice, and `APP_MILESTONE` to the next codename. This slice bumps because Unit 1 is a user-visible data-loss fix.

- [ ] **Step 2: Propagate to the other five places**

```bash
npm run version:sync > "$LOG/v-sync.log" 2>&1; echo "SYNC=$?"
npm run version:check > "$LOG/v-check.log" 2>&1; echo "CHECK=$?"
```

Never hand-edit the satellites. `version-sync-check` is blocking, and its exit codes differ in meaning: **1 is drift** (run `version:sync`), **2 is the gate unable to scan** (a missing file or moved regex — a gate that scans nothing passes everything).

- [ ] **Step 3: Write the CHANGELOG entry — Unit 1 only, in user language**

Add a `## [0.265.0] - 2026-08-30 "<codename>"` section above the 0.264.1 one, with a single `### Fixed` bullet covering Unit 1:

```markdown
- **Declining the "replace your tasks?" prompt when opening a file could still point the app at
  that file, and your current project would then be saved over it.** Opening a project file asks
  whether to replace the tasks you have open. Answering no kept your work, as it should — but the
  app had already switched to the file you picked, while still showing the previous file's name.
  The next automatic save then wrote your current project over a file you had just declined to
  open. The app now switches only after you say yes.
```

**Units 2 and 3 get no CHANGELOG bullet.** Neither has a user-visible symptom to describe: §286 is a validator alignment and §288 is at-rest hardening with no live XSS. Naming them here would sell hardening as a fixed user-facing bug. They are recorded in the register and in their commit messages.

- [ ] **Step 4: Confirm no session URL reached the changelog**

```bash
grep -c "[session link removed]" CHANGELOG.md; echo "EXIT=$?"
```

Expected: `0` printed, grep exit 1. A session URL must never appear in `CHANGELOG.md` or an MR description.

- [ ] **Step 5: Commit**

```bash
git add CHANGELOG.md src/app/version.ts package.json package-lock.json README.md docs/CODEMAPS
git commit -m "chore(release): 0.265.0"
```

---

### Task 15: Release — GATED

> ★★★ **DO NOT START THIS TASK UNTIL THE USER SAYS "release".**
> This plan does not authorise a push, an MR, or a merge. Finishing Task 14 means
> the branch is *ready*; it does not mean it ships. Stop after Task 13's report
> and wait.

- [ ] **Step 1: Run a code review first**

`review-before-release` is standing: dispatch a cold reviewer over `origin/main...HEAD` before pushing. Verify each finding with your own command before acting on it — a reviewer's claim is a hypothesis, not a result.

- [ ] **Step 2: Push and open the MR**

```bash
git push -u origin fix/seed-and-handle-commit
glab mr create --source-branch fix/seed-and-handle-commit --target-branch main \
  --title "<title>" --description "$(cat "$LOG/mr-body.md")" --yes
```

The description must contain **no** `[session link removed]` URL.

- [ ] **Step 3: Poll the pipeline to a terminal state**

Watch for `Pipeline state: success`. The jobs that matter most are the ones that cannot run locally: `unit-tests` (full suite + coverage floors), `unit-tests-shuffled` (whole-suite shuffle) and `prod-smoke` (the only gate that sees the production CSP). `dast-zap` stays manual and non-blocking on an MR pipeline.

- [ ] **Step 4: Merge only on green, with auto-merge explicitly off**

```bash
glab mr merge <id> --auto-merge=false --yes
```

`glab mr merge` **defaults `--auto-merge=true`**, so omitting the flag is not opting out — it must be passed explicitly. Merge only after the pipeline is green; if anything is red, report it rather than merging.

- [ ] **Step 5: Verify the merge introduced nothing neither parent had**

```bash
git fetch origin && git checkout main && git pull --ff-only
git diff-tree --cc HEAD | grep -c "^++"
```

Expected: `0`.
