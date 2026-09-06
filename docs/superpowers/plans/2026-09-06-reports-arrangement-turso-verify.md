# Reports arrangement + Turso confirm-gate — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gate Settings' Move-to-Turso on a confirmed connection test, and give the Reports view full Dashboard-parity arrangement (drag-reorder, hide/restore, per-block resize, reset) by extracting a neutral arrangement core that both surfaces adapt.

**Architecture:** Two independent phases. Phase A touches one component plus i18n. Phase F extracts seven `dashboard-*` modules into id-generic `arrangement-*` modules with the catalogue and storage key injected, leaves every `dashboard-*` module in place as a thin adapter with its current export signature so `dashboard-panel.tsx` is never edited, then builds a Reports catalogue and adapter on top.

**Tech Stack:** Next.js 16 / React / TypeScript, Tailwind v4, vitest + Testing Library, Playwright for e2e.

**Spec:** `docs/superpowers/specs/2026-09-06-reports-arrangement-turso-verify-design.md` — the source of truth. Read it before Task 1.

**Branch:** `feat/reports-arrangement-turso-verify`, at `5c40f16a` = `origin/main` (`3aef0e01`, 0.288.0 "Duchamp") + one spec/register commit.

---

## Standing constraints — read before touching anything

These are not suggestions. Each has cost real work in this repo.

- **Every `src/app/*.ts(x)` file is CRLF.** Use the **Edit tool only**. Never `Write`, never `sed -i` — both silently re-line the file to LF, which `git diff` hides under `core.autocrlf=true`. Check with `git ls-files --eol <file>`; healthy is `i/lf w/crlf`.
- **`src/app/i18n.de.ts` must never be touched with the Edit tool.** It corrupts umlauts and curls double-quotes. Patch it with an anchored node UTF-8 write matching `\r\n`, using real umlauts (`prüfen`, not `pruefen` — the `i18n-encoding` test bans ASCII substitutions). Assert the anchor is unique in **both** directions and that the lone-LF count and curly-quote count are unchanged.
- **`docs/open-followups.md` and `docs/superpowers/**` are LF-only.**
- **Never read a gate's exit code through a pipe.** `npm run test:run | tail -8` reports `tail`'s status. Redirect to the session scratchpad, echo `$?` unpiped, then grep the file. **Grep for `Errors` alongside every tally** — a mutant that makes a listener throw prints `Tests N passed` plus `Errors 1` at a nonzero exit.
- **Never run two vitest processes at once.**
- **`npx tsc --noEmit` exits 2** on diagnostics, not 1. `npm run lint` exits 1 from gitignored leftovers — use `npx eslint --max-warnings=0 <files>`.
- **Never stage `sample-workspace-huge.json`** (a foreign writer edits it) or **`not-in-use.env.local.bak`** (untracked, NOT gitignored, holds live Turso credentials — never open, print or stage it). Never `git add -A` or `git add .`. Commit with `git commit --only <explicit paths>`.
- **Never echo, log, paste or commit the Turso URL or auth token.** Phase A touches both fields.
- **`git checkout -- <file>` is deny-blocked.** Revert a mutation with an inverse anchored write, asserting uniqueness both directions, ending on an empty `git diff --stat`.
- **`git stash` must never be run in this worktree.** `rm -rf` is gate-blocked — use PowerShell `Remove-Item -Recurse -Force`.
- **Never `--amend`** — a shared worktree has other writers. New commits only.
- **Close every task on the SCOPED form** `git diff HEAD --stat -- <that task's own paths>` (expect empty) plus `git show --stat HEAD` as the positive half. A bare `git diff HEAD --stat` shows other writers' work and proves nothing.
- **Do not disturb the dev server on port 3000.** Use `PORT=3100 npm run dev`, stop with `PORT=3100 npm run stop`.
- **No version bump, no CHANGELOG entry, no push, no MR.** This slice ships separately on explicit say.

**Gates after every task:**

```bash
SP="$SCRATCHPAD"                      # the session scratchpad dir, never /tmp
npx tsc --noEmit > "$SP/tsc.log" 2>&1; echo "TSC_EXIT=$?"   # 2 means diagnostics
npx eslint --max-warnings=0 <files touched>; echo "ESLINT_EXIT=$?"
npx vitest run <touched test files> > "$SP/v.log" 2>&1; echo "VITEST_EXIT=$?"
grep -E "Test Files|Tests |Errors" "$SP/v.log"
npm run size:check > "$SP/size.log" 2>&1; echo "SIZE_EXIT=$?"
```

Run the full `npm run test:run` and `npm run test:shuffle` at the end of each phase, not after every task.

---

## File structure

### Phase A

| File | Responsibility | Change |
|---|---|---|
| `src/app/settings-sections/integrations-section.tsx` | Settings → Integrations surface | Modify: fingerprinted test state, gated Move button |
| `src/app/settings-sections/integrations-section.test.tsx` | its tests | Modify: the confirm-gate matrix |
| `src/app/i18n.ts` / `i18n.de.ts` | EN / DE dictionaries | Modify: two new keys |

### Phase F — new generic core

| File | Responsibility |
|---|---|
| `src/app/arrangement-layout.ts` | Pure, i18n-free, DOM-free layout engine generic over `Id`. Catalogue is a parameter. |
| `src/app/arrangement-store.ts` | Per-device, per-project persistence. Storage key is a parameter. |
| `src/app/use-arrangement.ts` | load → reconcile → mutate → debounced persist, generic over `Id`. |
| `src/app/arrangement-grid.tsx` | The dense grid + `W_CLASS`/`H_CLASS`. Row and gap classes are props. |
| `src/app/arrangement-tile.tsx` | One block's chrome: grip, title, ⋮ trigger. |
| `src/app/arrangement-block-menu.tsx` | The ⋮ menu content. Takes span bounds as props — **no catalogue lookup**. |
| `src/app/arrangement-shelf.tsx` | The hidden-blocks disclosure and its drop target. |

### Phase F — adapters (signatures unchanged, so `dashboard-panel.tsx` is never edited)

`dashboard-layout.ts` · `dashboard-layout-store.ts` · `use-dashboard-layout.ts` · `dashboard-grid.tsx` · `dashboard-tile.tsx` · `dashboard-tile-menu.tsx` · `dashboard-shelf.tsx`

### Phase F — Reports

| File | Responsibility |
|---|---|
| `src/app/report-blocks.ts` | The Reports catalogue: `ReportBlockId`, `REPORT_BLOCKS`, `REPORTS_LAYOUT_KEY`, `REPORTS_DEFAULT_LAYOUT`. |
| `src/app/use-reports-arrangement.ts` | Reports adapter over `useArrangement`, including the one-time `settings.reports.extra` migration. |
| `src/app/reports-blocks.tsx` | The nine built-in block bodies, presentational. |
| `src/app/reports.tsx` | Orchestrator: catalogue → grid → tiles, shelf, reset. |

---

# PHASE A — the Turso confirm-gate

## Task 1: Replace the test result with a fingerprinted record

**Files:**
- Modify: `src/app/settings-sections/integrations-section.tsx`
- Test: `src/app/settings-sections/integrations-section.test.tsx`

**Context.** Today `tursoTestResult` is a `string | null` holding a **translated display string**. Success is therefore only readable by comparing against a localized literal, which is why the Move button cannot be gated on it. The fix carries the tested values alongside the verdict so "still confirmed" is *derived*, never written — an `onChange` that clears a flag can be forgotten by a future edit path, and nothing would report it.

- [ ] **Step 1: Write the failing test**

Add to `integrations-section.test.tsx`. Use the file's existing render helper and mocks — read the top of the file first; do not invent a new harness.

```tsx
it("drops the confirmed result when the URL is edited after a passing test", async () => {
  const user = userEvent.setup();
  renderIntegrations({ turso: { databaseUrl: "libsql://a.turso.io", authToken: "tok" } });

  await user.click(screen.getByRole("button", { name: /test connection/i }));
  expect(await screen.findByText("Connected.")).toBeInTheDocument();

  await user.type(screen.getByLabelText(/database url/i), "x");

  expect(screen.queryByText("Connected.")).toBeNull();
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run src/app/settings-sections/integrations-section.test.tsx -t "drops the confirmed result" > "$SP/v.log" 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests |Errors" "$SP/v.log"
```
Expected: FAIL — the message is still in the document, because nothing invalidates it.

- [ ] **Step 3: Replace the state (Edit tool — the file is CRLF)**

Replace the `tursoTestResult` declaration:

```tsx
  const [tursoTesting, setTursoTesting] = useState(false);
  // ★★ FINGERPRINTED, and the fingerprint is the whole point. This holds the
  // URL and token the verdict was obtained FOR, so "is the test still valid?"
  // is DERIVED below rather than written by an invalidation handler. A written
  // invalidation has to be remembered at every edit path, including ones added
  // later; a derived one cannot be forgotten, and the stale-confirmed state is
  // simply unrepresentable.
  // ★ TRANSIENT BY DESIGN — resets on reload, exactly like the Jira and Timelog
  // test results. Persisting it would be a new Settings field and therefore the
  // six-write-paths case (open-followups §408).
  // ★ The URL and token are already in component state; holding a copy here
  // adds no exposure. Neither is ever rendered, logged or thrown.
  const [tursoTest, setTursoTest] = useState<
    { kind: "ok" | "fail"; message: string; url: string; token: string } | null
  >(null);

  const tursoTestFresh =
    tursoTest !== null &&
    tursoTest.url === turso.databaseUrl &&
    tursoTest.token === turso.authToken;
  const tursoTestConfirmed = tursoTestFresh && tursoTest?.kind === "ok";
```

- [ ] **Step 4: Rewrite the two writes in `runTursoTest`**

Keep the whole existing `★★★ CLASSIFY, NEVER INTERPOLATE` comment block and the `★ NO null-config branch` block — both record measured defects. Change only the writes:

```tsx
    setTursoTesting(true);
    setTursoTest(null);
    try {
      await testTursoConnection(getTursoConfig(turso.databaseUrl, turso.authToken));
      setTursoTest({
        kind: "ok",
        message: t(lang, "integrationsTursoTestOk"),
        url: turso.databaseUrl,
        token: turso.authToken,
      });
    } catch (e) {
      const kind = tursoErrorKind(e);
      setTursoTest({
        kind: "fail",
        message: t(
          lang,
          kind === "auth"
            ? "integrationsTursoTestAuth"
            : kind === "unreachable"
              ? "integrationsTursoTestUnreachable"
              : "integrationsTursoTestFailGeneric",
        ),
        url: turso.databaseUrl,
        token: turso.authToken,
      });
    } finally {
      setTursoTesting(false);
    }
```

- [ ] **Step 5: Gate the rendered message on freshness**

```tsx
          <p role="status" className="text-xs text-muted-foreground">
            {tursoTestFresh ? tursoTest?.message : null}
          </p>
```

Keep `role="status"`. It is the live region added when the probe shipped; removing it silently un-announces every result.

- [ ] **Step 6: Run the test and the whole file**

```bash
npx vitest run src/app/settings-sections/integrations-section.test.tsx > "$SP/v.log" 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests |Errors" "$SP/v.log"
npx tsc --noEmit > "$SP/tsc.log" 2>&1; echo "TSC_EXIT=$?"
npx eslint --max-warnings=0 src/app/settings-sections/integrations-section.tsx; echo "ESLINT_EXIT=$?"
```
Expected: all pass, `TSC_EXIT=0`, `ESLINT_EXIT=0`.

- [ ] **Step 7: Commit**

```bash
git commit --only src/app/settings-sections/integrations-section.tsx src/app/settings-sections/integrations-section.test.tsx \
  -m "fix(settings): make the Turso test verdict fingerprinted, not a display string"
git diff HEAD --stat -- src/app/settings-sections/integrations-section.tsx src/app/settings-sections/integrations-section.test.tsx
git show --stat HEAD
```
The scoped diff must be empty.

---

## Task 2: Gate Move-to-Turso on the confirmed verdict

**Files:**
- Modify: `src/app/settings-sections/integrations-section.tsx`
- Test: `src/app/settings-sections/integrations-section.test.tsx`

**Context.** The button carries **no `disabled=` at all** today — `canMoveToTurso` is a *render* gate. `canMoveToTurso` stays as the render gate (with no project on Turso there is nothing to migrate, and a permanently disabled control is noise); `disabled` carries the new condition.

- [ ] **Step 1: Write the failing tests — the full matrix**

```tsx
describe("Move to Turso is gated on a confirmed connection", () => {
  const CONFIGURED = { databaseUrl: "libsql://a.turso.io", authToken: "tok" };

  it("is disabled before any test has run", () => {
    renderIntegrations({ turso: CONFIGURED, onMigrateToTurso: migrate });
    expect(screen.getByRole("button", { name: /move to turso/i })).toBeDisabled();
    expect(migrate).not.toHaveBeenCalled();
  });

  it("is enabled after a passing test", async () => {
    const user = userEvent.setup();
    renderIntegrations({ turso: CONFIGURED, onMigrateToTurso: migrate });
    await user.click(screen.getByRole("button", { name: /test connection/i }));
    await screen.findByText("Connected.");
    expect(screen.getByRole("button", { name: /move to turso/i })).toBeEnabled();
  });

  it("stays disabled after a failing test", async () => {
    const user = userEvent.setup();
    probe.mockRejectedValueOnce(new Error("boom"));
    renderIntegrations({ turso: CONFIGURED, onMigrateToTurso: migrate });
    await user.click(screen.getByRole("button", { name: /test connection/i }));
    await screen.findByText("Connection failed.");
    expect(screen.getByRole("button", { name: /move to turso/i })).toBeDisabled();
  });

  it("re-disables when the URL changes after a pass", async () => {
    const user = userEvent.setup();
    renderIntegrations({ turso: CONFIGURED, onMigrateToTurso: migrate });
    await user.click(screen.getByRole("button", { name: /test connection/i }));
    await screen.findByText("Connected.");
    await user.type(screen.getByLabelText(/database url/i), "x");
    expect(screen.getByRole("button", { name: /move to turso/i })).toBeDisabled();
  });

  it("re-disables when the token changes after a pass", async () => {
    const user = userEvent.setup();
    renderIntegrations({ turso: CONFIGURED, onMigrateToTurso: migrate });
    await user.click(screen.getByRole("button", { name: /test connection/i }));
    await screen.findByText("Connected.");
    await user.type(screen.getByLabelText(/auth token/i), "x");
    expect(screen.getByRole("button", { name: /move to turso/i })).toBeDisabled();
  });

  it("describes why it is disabled, reachably", () => {
    renderIntegrations({ turso: CONFIGURED, onMigrateToTurso: migrate });
    const btn = screen.getByRole("button", { name: /move to turso/i });
    expect(btn).toHaveAccessibleDescription(
      "Run Test connection first — Move to Turso stays disabled until the connection is confirmed.",
    );
  });
});
```

★★ **Assert the disabled state directly.** Do **not** write a test that clicks the button and awaits a message. A `disabled` element dispatches no events, so that test **times out at 15 s** (`vitest.setup.ts` sets `asyncUtilTimeout: 15000`) rather than failing an assertion — which reads like a broken suite, not a red test. `toBeDisabled()` plus `expect(migrate).not.toHaveBeenCalled()` is the assertable form.

- [ ] **Step 2: Run and watch them fail**

```bash
npx vitest run src/app/settings-sections/integrations-section.test.tsx -t "Move to Turso is gated" > "$SP/v.log" 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests |Errors" "$SP/v.log"
```
Expected: FAIL — the button has no `disabled` and no description.

- [ ] **Step 3: Add the hint id beside the existing `tursoUrlEnvNoticeId`**

```tsx
  const tursoMoveHintId = `${useId()}-turso-move`;
```

- [ ] **Step 4: Replace the Move-to-Turso block**

```tsx
          {/* Primary action: carry the current project into Turso. */}
          {canMoveToTurso && (
            <div className="mt-2 border-t border-line pt-2">
              {/* ★★ Same wrapper contract as `projects-panel.tsx`'s disabled
                  Turso buttons — read the block comment there. The short of it:
                  a disabled control is NOT focusable, so `title` is unreachable
                  by keyboard and on touch, while `aria-describedby` IS exposed
                  on a disabled control AND OUTRANKS `title` as the accessible
                  description. The sr-only node is what actually reaches AT; the
                  `title` stays for the sighted mouse user.
                  ★★★ The hint cannot be gated on interacting with the button:
                  a disabled element dispatches no events, so "click it and find
                  out why" is an unreachable path. */}
              <span
                className={`inline-flex${tursoTestConfirmed ? "" : " cursor-not-allowed"}`}
                title={
                  tursoTestConfirmed
                    ? t(lang, "projectMigrateToTursoHint")
                    : t(lang, "integrationsTursoMoveNeedsTest")
                }
              >
                <Button
                  size="sm"
                  disabled={!tursoTestConfirmed}
                  onClick={onMigrateToTurso}
                  aria-describedby={tursoMoveHintId}
                  className="disabled:pointer-events-none"
                >
                  {t(lang, "projectMigrateToTurso")}
                </Button>
                <span id={tursoMoveHintId} className="sr-only">
                  {tursoTestConfirmed
                    ? t(lang, "projectMigrateToTursoHint")
                    : t(lang, "integrationsTursoMoveNeedsTest")}
                </span>
              </span>
              <FieldHint className="mt-1">{t(lang, "projectMigrateToTursoHint")}</FieldHint>
            </div>
          )}
```

- [ ] **Step 5: Run the tests**

```bash
npx vitest run src/app/settings-sections/integrations-section.test.tsx > "$SP/v.log" 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests |Errors" "$SP/v.log"
```
Expected: PASS. (The two new i18n keys land in Task 3; until then `t()` returns the key name and the accessible-description test fails on its exact string — write that one test in Task 3 instead, or accept one red test until Task 3 and say so in the commit.)

- [ ] **Step 6: Mutation-prove the gate**

Weaken the derivation to ignore the fingerprint, using an inverse anchored write to revert:

```tsx
  const tursoTestConfirmed = tursoTest?.kind === "ok";
```

```bash
npx vitest run src/app/settings-sections/integrations-section.test.tsx > "$SP/mut.log" 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests |Errors" "$SP/mut.log"
```
Expected: the **URL-changed** and **token-changed** rows go red — record the exact `N failed / M passed`, and check the sum equals the file's runtime test count. If only one goes red, the other assertion is not doing its job. Revert with an inverse anchored write, then prove `git diff --stat` is empty.

★ A test that exercises only the never-tested row passes under this mutant. That row alone is not the proof.

- [ ] **Step 7: Commit**

```bash
git commit --only src/app/settings-sections/integrations-section.tsx src/app/settings-sections/integrations-section.test.tsx \
  -m "feat(settings): gate Move to Turso on a confirmed connection test"
git diff HEAD --stat -- src/app/settings-sections/integrations-section.tsx src/app/settings-sections/integrations-section.test.tsx
git show --stat HEAD
```

---

## Task 3: The two i18n keys

**Files:**
- Modify: `src/app/i18n.ts`, `src/app/i18n.de.ts`

**Context.** A peer session also writes these dictionaries. Do this task **last within Phase A** and re-read both files immediately before editing. EN/DE key parity is enforced by `tsc`.

- [ ] **Step 1: Add the EN keys (Edit tool — `i18n.ts` is CRLF)**

Beside the existing `integrationsTursoTest*` keys:

```ts
  integrationsTursoMoveNeedsTest:
    "Run Test connection first — Move to Turso stays disabled until the connection is confirmed.",
```

★ **One key, not two.** The *confirmed* branch reuses the existing `projectMigrateToTursoHint`,
which already describes what the action does. A second "connection confirmed" key would be dead
the moment it was written — nothing in Task 2 reads it — and a dead i18n key is invisible to
every gate in this repo.

- [ ] **Step 2: Add the DE keys — anchored node script, NEVER the Edit tool**

Write the script to the scratchpad, not the repo. It must: match `\r\n`; assert the anchor is unique in both directions; use **real umlauts**; and compare lone-LF and curly-quote counts before and after.

```js
import fs from "node:fs";
const P = "src/app/i18n.de.ts";
const buf = fs.readFileSync(P);
const before = buf.toString("utf8");
const lfBefore = (before.match(/(?<!\r)\n/g) || []).length;
const curlyBefore = (before.match(/[“”‘’]/g) || []).length;

const ANCHOR = '  integrationsTursoTestFailGeneric: "Verbindung fehlgeschlagen.",\r\n';
if (before.split(ANCHOR).length - 1 !== 1) throw new Error("anchor not unique");

const ADD =
  '  integrationsTursoMoveNeedsTest:\r\n' +
  '    "Zuerst Verbindung testen — Zu Turso verschieben bleibt deaktiviert, bis die Verbindung bestätigt ist.",\r\n' +
  '  integrationsTursoMoveConfirmed: "Verbindung bestätigt. Zu Turso verschieben ist verfügbar.",\r\n';
if (/[“”‘’]/.test(ADD)) throw new Error("replacement carries curly quotes");
if (/fuer|druecken|ae\b|oe\b|ue\b/.test(ADD)) throw new Error("ASCII umlaut substitution");

const out = before.replace(ANCHOR, ANCHOR + ADD);
if (out === before) throw new Error("no change");
if (out.split(ADD).length - 1 !== 1) throw new Error("addition not unique");
fs.writeFileSync(P, out, "utf8");

const after = fs.readFileSync(P, "utf8");
console.log("lone LF before/after:", lfBefore, (after.match(/(?<!\r)\n/g) || []).length);
console.log("curly before/after:", curlyBefore, (after.match(/[“”‘’]/g) || []).length);
```

Both printed pairs must be **identical**. `i18n.de.ts` legitimately contains curly quotes, so guard the *replacement* for them and compare *file counts* — a whole-file "no curly quotes" assertion is a false positive.

- [ ] **Step 3: Verify parity, encoding and the tests**

```bash
npx tsc --noEmit > "$SP/tsc.log" 2>&1; echo "TSC_EXIT=$?"     # enforces EN/DE key parity
npx vitest run src/app/i18n-encoding.test.ts src/app/settings-sections/integrations-section.test.tsx > "$SP/v.log" 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests |Errors" "$SP/v.log"
git ls-files --eol src/app/i18n.de.ts     # expect i/lf w/crlf
```

- [ ] **Step 4: Commit**

```bash
git commit --only src/app/i18n.ts src/app/i18n.de.ts \
  -m "i18n: explain why Move to Turso is disabled until the connection is confirmed"
git diff HEAD --stat -- src/app/i18n.ts src/app/i18n.de.ts
git show --stat HEAD
```

- [ ] **Step 5: Close Phase A**

```bash
npm run test:run > "$SP/suite.log" 2>&1; echo "SUITE_EXIT=$?"
grep -E "Test Files|Tests |Errors" "$SP/suite.log"
npm run size:check > "$SP/size.log" 2>&1; echo "SIZE_EXIT=$?"
```

---

# PHASE F — Reports arrangement

**Sequencing rule for the whole phase:** every adapter must keep its current export signature, so **`dashboard-panel.tsx` is never edited** and the Dashboard's own tests pass **unmodified**. If a Dashboard test needs editing, the extraction is wrong — stop and fix the adapter instead of the test.

## Task 4: Extract the generic layout engine

**Files:**
- Create: `src/app/arrangement-layout.ts`
- Modify: `src/app/dashboard-layout.ts` (becomes an adapter)
- Test: `src/app/arrangement-layout.test.ts` (create)

**Context.** `dashboard-layout.ts` reads `DASHBOARD_TILES` as a **free variable** in `reconcile` (three reads) and via `tileById` inside `restoreTile` and `resizeTile`; `DEFAULT_LAYOUT` is a module constant returned **by reference** from `reconcile(null)` and set by `reset()`. Preserve that reference identity per surface — the mutators' documented "same object on a no-op" contract depends on it.

- [ ] **Step 1: Write the failing test over a synthetic catalogue**

```ts
import { describe, expect, it } from "vitest";
import {
  defaultLayout, moveBlock, hideBlock, restoreBlock, resizeBlock, reconcile,
  type BlockSpec, type ArrangementLayout,
} from "./arrangement-layout";

type TestId = "a" | "b" | "c";
const CAT: readonly BlockSpec<TestId>[] = [
  { id: "a", labelKey: "cancel", w: 2, h: 2, minW: 1, maxW: 4, minH: 1, maxH: 4 },
  { id: "b", labelKey: "cancel", w: 1, h: 1, minW: 1, maxW: 2, minH: 1, maxH: 2 },
  { id: "c", labelKey: "cancel", w: 4, h: 2, minW: 4, maxW: 4, minH: 2, maxH: 4 },
];
const DEF = defaultLayout(CAT);

it("places every catalogue block at its default size", () => {
  expect(DEF.board.map((p) => p.id)).toEqual(["a", "b", "c"]);
  expect(DEF.hidden).toEqual([]);
});

it("returns the same object on a no-op move", () => {
  expect(moveBlock(DEF, "a", "a")).toBe(DEF);
});

it("clamps a stored span to the block's own bounds, per axis", () => {
  const stored: ArrangementLayout<TestId> = {
    v: 1, board: [{ id: "c", w: 1, h: 3 }], hidden: [],
  };
  const out = reconcile(CAT, stored, DEF);
  expect(out.board[0].w).toBe(4);   // clamped up to minW
  expect(out.board[0].h).toBe(3);   // already legal, survives
});

it("de-duplicates the hidden list as well as the board", () => {
  const stored = { v: 1 as const, board: [], hidden: ["a", "a", "zz"] as TestId[] };
  expect(reconcile(CAT, stored, DEF).hidden).toEqual(["a"]);
});

it("inserts a new catalogue block after its nearest present predecessor", () => {
  const stored: ArrangementLayout<TestId> = {
    v: 1, board: [{ id: "a", w: 2, h: 2 }, { id: "c", w: 4, h: 2 }], hidden: [],
  };
  expect(reconcile(CAT, stored, DEF).board.map((p) => p.id)).toEqual(["a", "b", "c"]);
});

it("returns the supplied default by reference for a null blob", () => {
  expect(reconcile(CAT, null, DEF)).toBe(DEF);
});
```

- [ ] **Step 2: Run and watch it fail**

```bash
npx vitest run src/app/arrangement-layout.test.ts > "$SP/v.log" 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests |Errors" "$SP/v.log"
```
Expected: FAIL — `Cannot find module './arrangement-layout'`.

- [ ] **Step 3: Create `arrangement-layout.ts`**

Copy `dashboard-layout.ts` **including every `★` comment block** — they record measured defects and are the reason the code is shaped as it is. Then apply exactly these changes:

- Add `<Id extends string>` to every type and function.
- `PlacedTile` → `PlacedBlock<Id>`; `DashboardLayout` → `ArrangementLayout<Id>`; `TileSpec` → `BlockSpec<Id>` carrying **only** `id, labelKey, w, h, minW, maxW, minH, maxH` (no `gate` — see Task 9).
- `DEFAULT_LAYOUT` constant → `export function defaultLayout<Id extends string>(catalogue: readonly BlockSpec<Id>[]): ArrangementLayout<Id>`.
- `tileById(id)` → `export function specById<Id extends string>(catalogue: readonly BlockSpec<Id>[], id: Id)`.
- `moveTile`/`hideTile` → `moveBlock`/`hideBlock`, signatures otherwise unchanged (neither reads the catalogue).
- `restoreTile`/`resizeTile` → `restoreBlock(catalogue, layout, …)` / `resizeBlock(catalogue, layout, …)`.
- `reconcile(stored)` → `reconcile(catalogue, stored, fallback)`, where `fallback` is returned **by reference** for a null blob and used for nothing else.

Update the module docstring's `reconcile` paragraph: its production call site is now `readLayout` inside `use-arrangement.ts`, and there are two surfaces.

- [ ] **Step 4: Run the new test**

```bash
npx vitest run src/app/arrangement-layout.test.ts > "$SP/v.log" 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests |Errors" "$SP/v.log"
```
Expected: PASS.

- [ ] **Step 5: Write the property tests**

Create `src/app/arrangement-layout.property.test.ts`, mirroring `dashboard-layout.property.test.ts` — read that file first and follow its `fc` idioms.

```ts
import fc from "fast-check";

const idArb = fc.constantFrom<TestId>("a", "b", "c");
const opArb = fc.oneof(
  fc.record({ kind: fc.constant("move" as const), a: idArb, b: idArb }),
  fc.record({ kind: fc.constant("hide" as const), a: idArb }),
  fc.record({ kind: fc.constant("restore" as const), a: idArb }),
  fc.record({ kind: fc.constant("resize" as const), a: idArb,
              axis: fc.constantFrom("w" as const, "h" as const), v: fc.integer({ min: -3, max: 9 }) }),
);

it("keeps every block exactly once across board + hidden", () => {
  fc.assert(fc.property(fc.array(opArb, { maxLength: 40 }), (ops) => {
    let l = DEF;
    for (const op of ops) {
      if (op.kind === "move") l = moveBlock(l, op.a, op.b);
      else if (op.kind === "hide") l = hideBlock(l, op.a);
      else if (op.kind === "restore") l = restoreBlock(CAT, l, op.a);
      else l = resizeBlock(CAT, l, op.a, op.axis, op.v);
    }
    const seen = [...l.board.map((b) => b.id), ...l.hidden].sort();
    expect(seen).toEqual(["a", "b", "c"]);
  }));
});

it("never lets a span escape that block's own bounds", () => {
  fc.assert(fc.property(idArb, fc.constantFrom("w" as const, "h" as const),
    fc.integer({ min: -9, max: 99 }), (id, axis, v) => {
      const out = resizeBlock(CAT, DEF, id, axis, v);
      const p = out.board.find((b) => b.id === id)!;
      const spec = CAT.find((s) => s.id === id)!;
      const [lo, hi] = axis === "w" ? [spec.minW, spec.maxW] : [spec.minH, spec.maxH];
      expect(p[axis]).toBeGreaterThanOrEqual(lo);
      expect(p[axis]).toBeLessThanOrEqual(hi);
    }));
});
```

★★ **fast-check is UNSEEDED here**, so `--sequence.seed` does not govern it and a green shuffle run proves nothing about reproducibility. If one of these goes red intermittently, do **not** bisect — read the counterexample fast-check prints and fix the logic.

★ The "exactly once" property is the one that found a real defect on the Dashboard: `reconcile` de-duplicated the board but not the shelf, so a stored `["kpi","kpi"]` rendered the same tile twice with duplicate React keys. Review did not catch it; this property did.

```bash
npx vitest run src/app/arrangement-layout.property.test.ts > "$SP/v.log" 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests |Errors" "$SP/v.log"
```

- [ ] **Step 6: Reduce `dashboard-layout.ts` to an adapter**

Replace its whole body, keeping the file:

```ts
/**
 * The Dashboard's binding of the shared arrangement engine.
 *
 * ★★ THIS FILE IS AN ADAPTER, NOT AN ENGINE. Every landmine that used to live
 * here now lives in `arrangement-layout.ts` — read it there before changing
 * anything. What stays here is exactly the Dashboard-specific binding: the
 * catalogue, and ONE memoized default so `reconcile(null)` and `reset()` keep
 * returning the SAME OBJECT, which the mutators' no-op contract relies on.
 */
import {
  defaultLayout, moveBlock, hideBlock, restoreBlock, resizeBlock,
  reconcile as reconcileWith,
  type ArrangementLayout, type PlacedBlock,
} from "./arrangement-layout";
import { DASHBOARD_TILES, type DashboardTileId } from "./dashboard-tiles";

export type PlacedTile = PlacedBlock<DashboardTileId>;
export type DashboardLayout = ArrangementLayout<DashboardTileId>;

/** ★ ONE instance, module-level. A factory called per use would break the
 *  reference identity that `reconcile(null)` and `reset()` both depend on. */
export const DEFAULT_LAYOUT: DashboardLayout = defaultLayout(DASHBOARD_TILES);

export const moveTile = (l: DashboardLayout, dragId: DashboardTileId, targetId: DashboardTileId) =>
  moveBlock(l, dragId, targetId);
export const hideTile = (l: DashboardLayout, id: DashboardTileId) => hideBlock(l, id);
export const restoreTile = (l: DashboardLayout, id: DashboardTileId, index?: number) =>
  restoreBlock(DASHBOARD_TILES, l, id, index);
export const resizeTile = (l: DashboardLayout, id: DashboardTileId, axis: "w" | "h", value: number) =>
  resizeBlock(DASHBOARD_TILES, l, id, axis, value);
export const reconcile = (stored: DashboardLayout | null) =>
  reconcileWith(DASHBOARD_TILES, stored, DEFAULT_LAYOUT);
```

`DASHBOARD_TILES` is `readonly TileSpec[]` and `TileSpec` structurally satisfies `BlockSpec<DashboardTileId>` (it has every field plus `gate`), so this typechecks with no cast.

- [ ] **Step 7: The Dashboard's existing tests must pass UNMODIFIED**

```bash
npx vitest run src/app/dashboard-layout.test.ts src/app/dashboard-layout.property.test.ts > "$SP/v.log" 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests |Errors" "$SP/v.log"
git diff --stat -- src/app/dashboard-layout.test.ts src/app/dashboard-layout.property.test.ts
```
Expected: PASS, and the diff **empty**. If a test needed editing, revert it and fix the adapter.

- [ ] **Step 8: Commit**

```bash
git add src/app/arrangement-layout.ts src/app/arrangement-layout.test.ts src/app/arrangement-layout.property.test.ts
git commit --only src/app/arrangement-layout.ts src/app/arrangement-layout.test.ts src/app/arrangement-layout.property.test.ts src/app/dashboard-layout.ts \
  -m "refactor(arrangement): extract the layout engine, generic over the block id"
git diff HEAD --stat -- src/app/arrangement-layout.ts src/app/arrangement-layout.test.ts src/app/arrangement-layout.property.test.ts src/app/dashboard-layout.ts
git show --stat HEAD
```

---

## Task 5: Extract the store

**Files:**
- Create: `src/app/arrangement-store.ts`
- Modify: `src/app/dashboard-layout-store.ts` (adapter)
- Test: `src/app/arrangement-store.test.ts` (create)

- [ ] **Step 1: Write the failing test**

```ts
import { beforeEach, expect, it } from "vitest";
import { loadArrangement, saveArrangement, MAX_PROJECTS } from "./arrangement-store";

const KEY_A = "aipm-cockpit:test-layout-a";
const KEY_B = "aipm-cockpit:test-layout-b";
const L = { v: 1 as const, board: [{ id: "x", w: 1, h: 1 }], hidden: [] };

beforeEach(() => localStorage.clear());

it("keeps two surfaces' layouts in separate keys", () => {
  saveArrangement(KEY_A, "p1", L);
  expect(loadArrangement(KEY_B, "p1")).toBeNull();
  expect(loadArrangement(KEY_A, "p1")).toEqual(L);
});

it("evicts the least recently saved project past the cap", () => {
  for (let i = 0; i <= MAX_PROJECTS; i += 1) saveArrangement(KEY_A, `p${i}`, L);
  expect(loadArrangement(KEY_A, "p0")).toBeNull();
  expect(loadArrangement(KEY_A, `p${MAX_PROJECTS}`)).toEqual(L);
});

it("re-saving an existing project moves it to newest", () => {
  saveArrangement(KEY_A, "keep", L);
  for (let i = 0; i < MAX_PROJECTS - 1; i += 1) saveArrangement(KEY_A, `p${i}`, L);
  saveArrangement(KEY_A, "keep", L);
  saveArrangement(KEY_A, "overflow", L);
  expect(loadArrangement(KEY_A, "keep")).toEqual(L);
});

it("reads a corrupt blob as absent rather than throwing", () => {
  localStorage.setItem(KEY_A, "{not json");
  expect(loadArrangement(KEY_A, "p1")).toBeNull();
});
```

- [ ] **Step 2: Run and watch it fail**

```bash
npx vitest run src/app/arrangement-store.test.ts > "$SP/v.log" 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests |Errors" "$SP/v.log"
```
Expected: FAIL — module not found.

- [ ] **Step 3: Create `arrangement-store.ts`**

Copy `dashboard-layout-store.ts` whole, **keeping every `★` block** — the not-a-Workspace-field rationale, the insertion-order recency rule, the integer-like-id warning and the downgrade round-trip note all still apply, now to two keys. Changes:

- `loadLayout(projectId)` → `loadArrangement(key: string, projectId: string)`.
- `saveLayout(projectId, layout)` → `saveArrangement(key: string, projectId: string, layout: ArrangementLayout<string>)`.
- `readMap()` → `readMap(key: string)`.
- Drop `DASHBOARD_LAYOUT_KEY`; keep `MAX_PROJECTS` exported.
- `isPlacedTile`/`isLayout` are already id-agnostic (`typeof id === "string"`). Leave them, and keep the `★ Deliberately loose` comment.
- Add to the docstring: the cap and the recency rule apply **per key, independently** — two surfaces do not share a budget.

- [ ] **Step 4: Reduce `dashboard-layout-store.ts` to an adapter**

```ts
import { loadArrangement, saveArrangement } from "./arrangement-store";
import type { DashboardLayout } from "./dashboard-layout";

export const DASHBOARD_LAYOUT_KEY = "aipm-cockpit:dashboard-layout";
export { MAX_PROJECTS } from "./arrangement-store";

export const loadLayout = (projectId: string): DashboardLayout | null =>
  loadArrangement(DASHBOARD_LAYOUT_KEY, projectId) as DashboardLayout | null;
export const saveLayout = (projectId: string, layout: DashboardLayout): void =>
  saveArrangement(DASHBOARD_LAYOUT_KEY, projectId, layout);
```

- [ ] **Step 5: Run both suites; the Dashboard store test must be unmodified**

```bash
npx vitest run src/app/arrangement-store.test.ts src/app/dashboard-layout-store.test.ts > "$SP/v.log" 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests |Errors" "$SP/v.log"
git diff --stat -- src/app/dashboard-layout-store.test.ts
```
Expected: PASS; diff empty.

- [ ] **Step 6: Commit**

```bash
git add src/app/arrangement-store.ts src/app/arrangement-store.test.ts
git commit --only src/app/arrangement-store.ts src/app/arrangement-store.test.ts src/app/dashboard-layout-store.ts \
  -m "refactor(arrangement): extract the layout store, storage key injected"
git diff HEAD --stat -- src/app/arrangement-store.ts src/app/arrangement-store.test.ts src/app/dashboard-layout-store.ts
git show --stat HEAD
```

---

## Task 6: Extract the hook

**Files:**
- Create: `src/app/use-arrangement.ts`
- Modify: `src/app/use-dashboard-layout.ts` (adapter)

**Context.** This file carries four ★★★-level rules: the lazy `useState` initial read (because `react-hooks/set-state-in-effect` is **banned and fatal**); the **render-body** storage read on a project switch and the argument for why it is acceptable; the project-id-and-layout-as-**one** state object (which fixes a real cross-project write); and the separate flush-on-unmount effect. **Copy all four comment blocks verbatim.** Losing any one reintroduces a shipped bug.

- [ ] **Step 1: Create `use-arrangement.ts`**

```ts
export interface ArrangementApi<Id extends string> {
  layout: ArrangementLayout<Id>;
  move: (dragId: Id, targetId: Id) => void;
  hide: (id: Id) => void;
  restore: (id: Id, index?: number) => void;
  resize: (id: Id, axis: "w" | "h", value: number) => void;
  reset: () => void;
  /** Arrangement is read-only here (popout). Render no grips, menus or shelf. */
  readOnly: boolean;
}

export function useArrangement<Id extends string>({
  catalogue, storageKey, fallback, projectId, isPopout = false, seed,
}: {
  catalogue: readonly BlockSpec<Id>[];
  storageKey: string;
  /** The surface's ONE default instance — returned by reference for a null blob. */
  fallback: ArrangementLayout<Id>;
  projectId: string;
  isPopout?: boolean;
  /**
   * ★ Optional one-time seed, used ONLY when storage holds nothing for this
   * project. Reports uses it to carry `settings.reports.extra` forward; the
   * Dashboard passes nothing. It is reconciled like any stored blob, so a stale
   * or malformed seed cannot corrupt the board.
   */
  seed?: () => ArrangementLayout<Id> | null;
}): ArrangementApi<Id>
```

Body is `use-dashboard-layout.ts` verbatim with: the generic parameter threaded; `readLayout` becoming

```ts
  const readLayout = (pid: string): ArrangementLayout<Id> => {
    if (typeof window === "undefined") return fallback;
    const stored = loadArrangement(storageKey, pid) as ArrangementLayout<Id> | null;
    return reconcile(catalogue, stored ?? seed?.() ?? null, fallback);
  };
```

and `reset` using `fallback` in place of `DEFAULT_LAYOUT`. Keep `LAYOUT_PERSIST_MS` exported at 400.

★ `readLayout` closes over props, so it must be declared **inside** the hook, not at module scope as it is today.

- [ ] **Step 2: Reduce `use-dashboard-layout.ts` to an adapter**

```ts
import { useArrangement, type ArrangementApi } from "./use-arrangement";
import { DEFAULT_LAYOUT } from "./dashboard-layout";
import { DASHBOARD_LAYOUT_KEY } from "./dashboard-layout-store";
import { DASHBOARD_TILES, type DashboardTileId } from "./dashboard-tiles";

export { LAYOUT_PERSIST_MS } from "./use-arrangement";
export type DashboardLayoutApi = ArrangementApi<DashboardTileId>;

export function useDashboardLayout({
  projectId, isPopout = false,
}: { projectId: string; isPopout?: boolean }): DashboardLayoutApi {
  return useArrangement<DashboardTileId>({
    catalogue: DASHBOARD_TILES,
    storageKey: DASHBOARD_LAYOUT_KEY,
    fallback: DEFAULT_LAYOUT,
    projectId,
    isPopout,
  });
}
```

- [ ] **Step 3: Run the Dashboard hook tests unmodified**

```bash
npx vitest run src/app/use-dashboard-layout.test.tsx > "$SP/v.log" 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests |Errors" "$SP/v.log"
git diff --stat -- src/app/use-dashboard-layout.test.tsx
npx eslint --max-warnings=0 src/app/use-arrangement.ts src/app/use-dashboard-layout.ts; echo "ESLINT_EXIT=$?"
```
Expected: PASS, diff empty, `ESLINT_EXIT=0`. ★ eslint matters here specifically: `react-hooks/exhaustive-deps` rejects an `obj.member` dependency, and `react-hooks/set-state-in-effect` is fatal. Both are severity 1, and `--max-warnings=0` makes them errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/use-arrangement.ts
git commit --only src/app/use-arrangement.ts src/app/use-dashboard-layout.ts \
  -m "refactor(arrangement): extract the layout hook, catalogue and key injected"
git diff HEAD --stat -- src/app/use-arrangement.ts src/app/use-dashboard-layout.ts
git show --stat HEAD
```

---

## Task 7: Extract the grid and the tile chrome

**Files:**
- Create: `src/app/arrangement-grid.tsx`, `src/app/arrangement-tile.tsx`
- Modify: `src/app/dashboard-grid.tsx`, `src/app/dashboard-tile.tsx` (adapters)

- [ ] **Step 1: Create `arrangement-grid.tsx`**

Move `W_CLASS` and `H_CLASS` **verbatim**, with their `★★★ THESE MUST STAY WHOLE LITERAL STRINGS` comment. Tailwind v4 scans source for class candidates, so an interpolated `col-span-${w}` emits no CSS and **jsdom cannot see the result**.

```tsx
export function ArrangementGrid({
  rowClass, gapClass, testId, children,
}: { rowClass: string; gapClass: string; testId: string; children: ReactNode }) {
  return (
    <div
      data-testid={testId}
      className={`grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-4 grid-flow-row-dense ${rowClass} ${gapClass}`}
    >
      {children}
    </div>
  );
}
```

Carry the `★★★ THIS RENDERS NO SCROLLER OF ITS OWN` block across intact — the real scroller is the enclosing `ReportCard`'s `contentRef`, and a nested one sizes to its content so drag autoscroll silently stops working.

- [ ] **Step 2: `dashboard-grid.tsx` becomes an adapter**

```tsx
import { ArrangementGrid } from "./arrangement-grid";
export { W_CLASS, H_CLASS } from "./arrangement-grid";

export function DashboardGrid({ dc, children }: { dc: DensityClasses; children: ReactNode }) {
  return (
    <ArrangementGrid rowClass={dc.tileRow} gapClass={dc.sectionGap} testId="dashboard-grid">
      {children}
    </ArrangementGrid>
  );
}
```

- [ ] **Step 3: Create `arrangement-tile.tsx`**

`dashboard-tile.tsx` verbatim with `id: string`, a `testIdPrefix: string` prop used as `` `${testIdPrefix}-${id}` ``, and the component renamed `ArrangementTile`. **Keep the `★★ EVERY CONTROL'S NAME IS QUALIFIED WITH THE TILE TITLE` block** — it is the only record of why the grip and ⋮ names carry the title, and axe cannot catch a regression.

- [ ] **Step 4: `dashboard-tile.tsx` becomes an adapter**

Re-export `TileDragProps` and `TileHandleProps`, and wrap:

```tsx
export function DashboardTile(props: Omit<ArrangementTileProps, "testIdPrefix"> & { id: DashboardTileId }) {
  return <ArrangementTile {...props} testIdPrefix="tile" />;
}
```

`data-testid="tile-${id}"` is unchanged, so every Dashboard test still finds its tiles.

- [ ] **Step 5: Run the Dashboard component tests unmodified**

```bash
npx vitest run src/app/dashboard-tile.test.tsx src/app/dashboard-panel.test.tsx > "$SP/v.log" 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests |Errors" "$SP/v.log"
git diff --stat -- src/app/dashboard-tile.test.tsx src/app/dashboard-panel.test.tsx
```
Expected: PASS, diff empty.

- [ ] **Step 6: Commit**

```bash
git add src/app/arrangement-grid.tsx src/app/arrangement-tile.tsx
git commit --only src/app/arrangement-grid.tsx src/app/arrangement-tile.tsx src/app/dashboard-grid.tsx src/app/dashboard-tile.tsx \
  -m "refactor(arrangement): extract the grid and tile chrome"
git diff HEAD --stat -- src/app/arrangement-grid.tsx src/app/arrangement-tile.tsx src/app/dashboard-grid.tsx src/app/dashboard-tile.tsx
git show --stat HEAD
```

---

## Task 8: Extract the block menu and the shelf

**Files:**
- Create: `src/app/arrangement-block-menu.tsx`, `src/app/arrangement-shelf.tsx`
- Modify: `src/app/dashboard-tile-menu.tsx`, `src/app/dashboard-shelf.tsx` (adapters)

**Context — this task is not in the spec's file table.** The spec listed five extracted files; these two make **seven**. `dashboard-tile-menu.tsx` calls `tileById(tileId)` from module scope, and `dashboard-shelf.tsx` types its props on `DashboardTileId`. Both must be generalised or Reports cannot render a ⋮ menu or a shelf.

- [ ] **Step 1: Create `arrangement-block-menu.tsx`**

`dashboard-tile-menu.tsx` verbatim, with `blockId: string` and — the one real design change — **the span bounds arrive as props instead of a catalogue lookup**:

```tsx
export function ArrangementBlockMenu({
  lang, blockId, title, w, h, minW, maxW, minH, maxH, index, count,
  onResize, onMove, onHide, onClose,
}: { /* … same as today, plus the four bounds, minus the lookup … */ })
```

The `const spec = tileById(tileId); if (!spec) return null;` pair goes away — the caller already holds the spec, so the lookup was a second source of truth and a null branch that could silently render nothing.

Keep all four ★ blocks: independent axes, the `min === max` static line, why out-of-range values are not rendered at all (`SegmentedControl` has no per-option `disabled`), and the `optionAriaLabel` WCAG 2.4.6 note — **both axes offer an option labelled "2", so the axis and the block title must both be in each option's name**. Export `TileAxisGroup` as `AxisGroup` for its own test; the `lo === hi` branch is unreachable through the menu.

- [ ] **Step 2: Create `arrangement-shelf.tsx`**

`dashboard-shelf.tsx` verbatim with `hidden: { id: string; title: string }[]` and `onRestore: (id: string) => void`. It reads no catalogue, so this is a type change only.

- [ ] **Step 3: Both `dashboard-*` files become adapters**

```tsx
export function DashboardTileMenu(props: { lang: Lang; tileId: DashboardTileId; /* … */ }) {
  const spec = tileById(props.tileId);
  if (!spec) return null;
  return (
    <ArrangementBlockMenu
      {...props}
      blockId={props.tileId}
      minW={spec.minW} maxW={spec.maxW} minH={spec.minH} maxH={spec.maxH}
    />
  );
}
```

The `tileById` lookup and its null branch move **here**, so `dashboard-panel.tsx`'s call site is byte-identical. `DashboardShelf` re-exports `ArrangementShelf` with the narrowed id type.

- [ ] **Step 4: Run the Dashboard tests unmodified**

```bash
npx vitest run src/app/dashboard-tile-menu.test.tsx src/app/dashboard-shelf.test.tsx src/app/dashboard-panel.test.tsx > "$SP/v.log" 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests |Errors" "$SP/v.log"
git diff --stat -- src/app/dashboard-tile-menu.test.tsx src/app/dashboard-shelf.test.tsx src/app/dashboard-panel.test.tsx
git diff --stat -- src/app/dashboard-panel.tsx
```
Expected: PASS; **all four diffs empty**, including `dashboard-panel.tsx`, which this plan never edits.

- [ ] **Step 5: Commit**

```bash
git add src/app/arrangement-block-menu.tsx src/app/arrangement-shelf.tsx
git commit --only src/app/arrangement-block-menu.tsx src/app/arrangement-shelf.tsx src/app/dashboard-tile-menu.tsx src/app/dashboard-shelf.tsx \
  -m "refactor(arrangement): extract the block menu and shelf; the menu takes bounds, not a lookup"
git show --stat HEAD
```

---

## Task 9: The Reports catalogue

**Files:**
- Create: `src/app/report-blocks.ts`
- Test: `src/app/report-blocks.test.ts` (create)

- [ ] **Step 1: Write the failing test**

```ts
import { expect, it } from "vitest";
import { REPORT_BLOCKS, REPORTS_LAYOUT_KEY, type ReportBlockId } from "./report-blocks";
import { ADDABLE_REPORTS } from "./addable-reports";

it("declares every addable report as a block", () => {
  const ids = new Set<string>(REPORT_BLOCKS.map((b) => b.id));
  for (const r of ADDABLE_REPORTS) expect(ids.has(r.id)).toBe(true);
});

it("has no duplicate ids", () => {
  const ids = REPORT_BLOCKS.map((b) => b.id);
  expect(new Set(ids).size).toBe(ids.length);
});

// ★★★ THE LOAD-BEARING ONE. jsdom has no layout, so nothing else in the suite
// can tell a squeezed table from a readable one. These seven carry
// column-resizable tables or a whole embedded report panel; at minW 1 they are
// a quarter of a four-column grid and unusable. This test is the only guard.
it("pins the table-bearing blocks to full width", () => {
  const FULL: ReportBlockId[] = [
    "byAssignee", "byGroup", "byLabel",
    "raid-report", "budget-report", "resource-report", "stakeholder-report",
  ];
  for (const id of FULL) {
    const b = REPORT_BLOCKS.find((x) => x.id === id)!;
    expect(b.minW, `${id} must not be narrowable`).toBe(4);
  }
});

it("keeps every span within its own bounds", () => {
  for (const b of REPORT_BLOCKS) {
    expect(b.minW).toBeLessThanOrEqual(b.w);
    expect(b.w).toBeLessThanOrEqual(b.maxW);
    expect(b.minH).toBeLessThanOrEqual(b.h);
    expect(b.h).toBeLessThanOrEqual(b.maxH);
  }
});

it("keys its storage under the app prefix, so clearAppConfig sweeps it", () => {
  expect(REPORTS_LAYOUT_KEY.startsWith("aipm-cockpit:")).toBe(true);
  expect(REPORTS_LAYOUT_KEY).not.toBe("aipm-cockpit:dashboard-layout");
});
```

- [ ] **Step 2: Run and watch it fail**

```bash
npx vitest run src/app/report-blocks.test.ts > "$SP/v.log" 2>&1; echo "EXIT=$?"
```
Expected: FAIL — module not found.

- [ ] **Step 3: Create `report-blocks.ts`**

Pure and i18n-free: it carries i18n **keys**, never strings, so it stays importable from a bare node process. The `TranslationKey` import must be **type-only** — a value import from `./i18n` would break that.

```ts
import type { TranslationKey } from "./i18n";
import type { BlockSpec } from "./arrangement-layout";
import type { FeatureModuleId } from "./feature-modules";
import { ADDABLE_REPORTS, type AddableReportId } from "./addable-reports";

export type ReportBuiltinId =
  | "stats" | "groupHealth" | "openByStatus" | "completionOutcomes"
  | "inquiries" | "byAssignee" | "byPriority" | "byGroup" | "byLabel";

export type ReportBlockId = ReportBuiltinId | AddableReportId;

/** ★ The Reports analogue of `TileGateInput`. A gate decides what RENDERS,
 *  never what is STORED — a gated-off block keeps its position, so switching a
 *  module off and on again does not lose it. `reconcile` takes no gate. */
export interface ReportBlockSpec extends BlockSpec<ReportBlockId> {
  gate?: (features: readonly FeatureModuleId[]) => boolean;
}

export const REPORTS_LAYOUT_KEY = "aipm-cockpit:reports-layout";

/**
 * ★★ Reports blocks are far taller than Dashboard tiles, so Reports passes a
 * 120px row unit (see `reports.tsx`) rather than the Dashboard's 80px. `TileSpan`
 * caps at 4, so an embedded report at the Dashboard's unit would get a 320px box.
 * ★★★ The seven `minW: 4` rows are LOAD-BEARING and no layout test can check
 * them — jsdom has no layout. `report-blocks.test.ts` pins them by value; the
 * visual result is owed to a browser eye-verify.
 */
export const REPORT_BLOCKS: readonly ReportBlockSpec[] = [
  { id: "stats",              labelKey: "reportsHeadline",            w: 4, h: 1, minW: 2, maxW: 4, minH: 1, maxH: 2 },
  { id: "groupHealth",        labelKey: "reportsGroupHealth",         w: 4, h: 2, minW: 2, maxW: 4, minH: 2, maxH: 4 },
  { id: "openByStatus",       labelKey: "reportsOpenByStatus",        w: 2, h: 2, minW: 2, maxW: 4, minH: 2, maxH: 3 },
  { id: "completionOutcomes", labelKey: "reportsCompletionOutcomes",  w: 2, h: 2, minW: 2, maxW: 4, minH: 2, maxH: 3 },
  { id: "inquiries",          labelKey: "reportsInquiries",           w: 4, h: 3, minW: 2, maxW: 4, minH: 2, maxH: 4 },
  { id: "byAssignee",         labelKey: "reportsByAssignee",          w: 4, h: 3, minW: 4, maxW: 4, minH: 2, maxH: 4 },
  { id: "byPriority",         labelKey: "reportsByPriority",          w: 2, h: 1, minW: 1, maxW: 4, minH: 1, maxH: 2 },
  { id: "byGroup",            labelKey: "reportsByGroup",             w: 4, h: 3, minW: 4, maxW: 4, minH: 2, maxH: 4 },
  { id: "byLabel",            labelKey: "reportsByLabel",             w: 4, h: 3, minW: 4, maxW: 4, minH: 2, maxH: 4 },
  ...ADDABLE_REPORTS.map((r) => ({
    id: r.id,
    labelKey: r.titleKey,
    w: 4 as const, h: 4 as const, minW: 4 as const, maxW: 4 as const, minH: 2 as const, maxH: 4 as const,
  })),
];

export function reportBlockById(id: ReportBlockId): ReportBlockSpec | undefined {
  return REPORT_BLOCKS.find((b) => b.id === id);
}

/** ★ ONE instance, module-level — the same reason as the Dashboard's:
 *  `reconcile(null)` and `reset()` both return it BY REFERENCE, and a factory
 *  called per use would break the mutators' no-op contract. */
export const REPORTS_DEFAULT_LAYOUT: ArrangementLayout<ReportBlockId> =
  defaultLayout(REPORT_BLOCKS);
```

- [ ] **Step 3b: Add `reportsHeadline` to both dictionaries FIRST**

`labelKey` is `TranslationKey`, so `report-blocks.ts` does not compile until the key exists in
`i18n.ts`. Do this before Step 4, not in Task 14.

**Do not widen `labelKey` to `string` to dodge it** — that type is exactly the typo protection the
catalogue exists to get, and widening it means a mistyped key becomes a silently title-less block
instead of a build error.

EN (`i18n.ts`, Edit tool — the file is CRLF):

```ts
  reportsHeadline: "Headline",
```

DE (`i18n.de.ts`, **anchored node script only** — see Task 3 Step 2 for the exact script shape,
including the `\r\n` anchor, the both-directions uniqueness assertion and the before/after
lone-LF and curly-quote counts):

```ts
  reportsHeadline: "Überblick",
```

The other eight built-in blocks reuse the section-title keys that already exist
(`reportsGroupHealth`, `reportsOpenByStatus`, `reportsCompletionOutcomes`, `reportsInquiries`,
`reportsByAssignee`, `reportsByPriority`, `reportsByGroup`, `reportsByLabel`), and the four
addable reports reuse `ADDABLE_REPORTS[].titleKey`. Only the headline strip has no key today.

```bash
npx tsc --noEmit > "$SP/tsc.log" 2>&1; echo "TSC_EXIT=$?"   # enforces EN/DE parity
npx vitest run src/app/i18n-encoding.test.ts > "$SP/v.log" 2>&1; echo "EXIT=$?"
```

- [ ] **Step 4: Run the test**

```bash
npx vitest run src/app/report-blocks.test.ts > "$SP/v.log" 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests |Errors" "$SP/v.log"
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/report-blocks.ts src/app/report-blocks.test.ts
git commit --only src/app/report-blocks.ts src/app/report-blocks.test.ts src/app/i18n.ts src/app/i18n.de.ts \
  -m "feat(reports): declare the arrangeable report block catalogue"
git diff HEAD --stat -- src/app/report-blocks.ts src/app/report-blocks.test.ts src/app/i18n.ts src/app/i18n.de.ts
git show --stat HEAD
```

---

## Task 10: The Reports adapter hook and the one-time migration

**Files:**
- Create: `src/app/use-reports-arrangement.ts`, `src/app/use-reports-arrangement.test.tsx`

**Context.** `settings.reports.extra` retires as the owner of order and visibility. When storage holds nothing for this project, seed a layout in which every addable report **absent from** `resolveExtraReports(settings.reports?.extra)` starts in `hidden`. The existence of the `aipm-cockpit:reports-layout` key is itself the migration marker, so this runs exactly once.

- [ ] **Step 1: Write the failing test**

```tsx
it("seeds hidden from settings.reports.extra on first load", () => {
  const { result } = renderHook(() =>
    useReportsArrangement({ projectId: "p1", extraReports: ["raid-report"] }));
  expect(result.current.layout.hidden).toEqual(
    expect.arrayContaining(["budget-report", "resource-report", "stakeholder-report"]),
  );
  expect(result.current.layout.board.map((b) => b.id)).toContain("raid-report");
});

// ★ The whole point of the marker. If this fails, the migration is running on
// every load and a user's arrangement is silently reverted on each visit.
it("ignores settings.reports.extra once a layout is stored", () => {
  const first = renderHook(() =>
    useReportsArrangement({ projectId: "p1", extraReports: ["raid-report"] }));
  act(() => first.result.current.hide("byPriority"));
  act(() => vi.advanceTimersByTime(500));
  first.unmount();

  const second = renderHook(() =>
    useReportsArrangement({ projectId: "p1", extraReports: [] }));
  expect(second.result.current.layout.board.map((b) => b.id)).toContain("raid-report");
  expect(second.result.current.layout.hidden).toContain("byPriority");
});

it("never persists from a popout", () => {
  const { result } = renderHook(() =>
    useReportsArrangement({ projectId: "p1", extraReports: [], isPopout: true }));
  act(() => result.current.hide("byPriority"));
  act(() => vi.advanceTimersByTime(500));
  expect(localStorage.getItem(REPORTS_LAYOUT_KEY)).toBeNull();
  expect(result.current.readOnly).toBe(true);
});
```

- [ ] **Step 2: Run and watch it fail**

```bash
npx vitest run src/app/use-reports-arrangement.test.tsx > "$SP/v.log" 2>&1; echo "EXIT=$?"
```

- [ ] **Step 3: Implement**

`REPORTS_DEFAULT_LAYOUT` is imported from `report-blocks.ts` (Task 9), not re-derived here — one instance per surface, because `reconcile(null)` and `reset()` both return it by reference.

```ts
import { REPORT_BLOCKS, REPORTS_DEFAULT_LAYOUT, REPORTS_LAYOUT_KEY, type ReportBlockId } from "./report-blocks";

export function useReportsArrangement({
  projectId, extraReports, isPopout = false,
}: {
  projectId: string;
  extraReports: readonly AddableReportId[];
  isPopout?: boolean;
}): ArrangementApi<ReportBlockId> {
  // ★★ ONE-TIME MIGRATION off `settings.reports.extra`. Called ONLY when
  // storage holds nothing for this project, so the presence of the layout key
  // IS the marker and this cannot re-run and revert a user's arrangement.
  // ★ The result is reconciled like any stored blob, so a stale or malformed
  // setting cannot corrupt the board.
  const seed = useCallback((): ArrangementLayout<ReportBlockId> => {
    const kept = new Set<string>(extraReports);
    const hidden = ADDABLE_REPORTS.filter((r) => !kept.has(r.id)).map((r) => r.id);
    return {
      v: 1,
      board: REPORTS_DEFAULT_LAYOUT.board.filter((b) => !hidden.includes(b.id as AddableReportId)),
      hidden: hidden as ReportBlockId[],
    };
  }, [extraReports]);

  return useArrangement<ReportBlockId>({
    catalogue: REPORT_BLOCKS,
    storageKey: REPORTS_LAYOUT_KEY,
    fallback: REPORTS_DEFAULT_LAYOUT,
    projectId,
    isPopout,
    seed,
  });
}
```

- [ ] **Step 4: Run, then mutation-prove the marker**

```bash
npx vitest run src/app/use-reports-arrangement.test.tsx > "$SP/v.log" 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests |Errors" "$SP/v.log"
```

Then mutate `readLayout` in `use-arrangement.ts` so the seed wins over stored data — `reconcile(catalogue, seed?.() ?? stored ?? null, fallback)`. The **"ignores settings.reports.extra once a layout is stored"** test must go red. Record `N failed / M passed`; revert with an inverse anchored write and prove `git diff --stat` empty.

- [ ] **Step 5: Commit**

```bash
git add src/app/use-reports-arrangement.ts src/app/use-reports-arrangement.test.tsx
git commit --only src/app/use-reports-arrangement.ts src/app/use-reports-arrangement.test.tsx \
  -m "feat(reports): bind the arrangement engine and migrate settings.reports.extra once"
git show --stat HEAD
```

---

## Task 11: Split the block bodies out of `reports.tsx`

**Files:**
- Create: `src/app/reports-blocks.tsx`
- Modify: `src/app/reports.tsx`

**Context.** Pure move, no behaviour change — do it as its own commit so the wiring in Task 12 has a readable diff. `reports.tsx` is 618 lines and Task 12 grows it; the ratchet limit is 1600, so neither file is near it.

- [ ] **Step 1: Move the nine block bodies**

Export one presentational component per built-in block — `StatsBlock`, `GroupHealthBlock`, `OpenByStatusBlock`, `CompletionOutcomesBlock`, `InquiriesBlock`, `ByAssigneeBlock`, `ByPriorityBlock`, `ByGroupBlock`, `ByLabelBlock` — each taking exactly the data and handlers it uses today as props. Take **only** what each block reads; do not pass a bag.

Leave in `reports.tsx`: all `useState`/`useColumnResize` state, `computeStats`, the `driverKey` map, `reportsViewState`/`applyReportsView`, and `renderEmbedded`.

- [ ] **Step 2: Verify nothing changed**

```bash
npx vitest run src/app/reports.test.tsx > "$SP/v.log" 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests |Errors" "$SP/v.log"
npx tsc --noEmit > "$SP/tsc.log" 2>&1; echo "TSC_EXIT=$?"
git diff --stat -- src/app/reports.test.tsx
```
Expected: PASS with the test file **unmodified** — a pure move must not need a test change.

- [ ] **Step 3: Commit**

```bash
git add src/app/reports-blocks.tsx
git commit --only src/app/reports-blocks.tsx src/app/reports.tsx \
  -m "refactor(reports): extract the block bodies, leaving reports.tsx as orchestrator"
git show --stat HEAD
```

---

## Task 12: Render Reports through the arrangement grid

**Files:**
- Modify: `src/app/reports.tsx`
- Test: `src/app/reports.test.tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
it("renders every visible block as an arrangement tile", () => {
  renderReports();
  expect(screen.getByTestId("reports-grid")).toBeInTheDocument();
  expect(screen.getByTestId("report-block-byAssignee")).toBeInTheDocument();
});

it("reorders a block by keyboard from its grip", async () => {
  const user = userEvent.setup();
  renderReports();
  const grip = screen.getByRole("button", { name: /reorder.*By assignee/i });
  grip.focus();
  await user.keyboard("{ArrowUp}");
  const ids = screen.getAllByTestId(/^report-block-/).map((n) => n.dataset.testid);
  expect(ids.indexOf("report-block-byAssignee")).toBeLessThan(ids.indexOf("report-block-inquiries"));
});

// ★ One mechanism, not two. The old extra-card reorder must be gone.
it("no longer renders the legacy extra-report card wrapper", () => {
  renderReports({ extraReports: ["raid-report"] });
  expect(screen.queryAllByTestId("extra-report-card")).toHaveLength(0);
});
```

- [ ] **Step 2: Run and watch them fail**

```bash
npx vitest run src/app/reports.test.tsx > "$SP/v.log" 2>&1; echo "EXIT=$?"
```

- [ ] **Step 3a: Thread `projectId` and `isPopout` into `ReportsPanel` — they do not exist today**

`ReportsPanel`'s prop list has **neither**, so the hook cannot be called without adding them
first. Verify before editing:

```bash
grep -n "projectId\|isPopout" src/app/reports.tsx        # expect no hits
grep -n "<ReportsPanel" src/app/workspace-section.tsx
```

Add to the props type and destructuring:

```tsx
  projectId?: string;
  isPopout?: boolean;
```

and pass them from `workspace-section.tsx`'s `<ReportsPanel …>` call site, taking the same values
`dashboard-panel.tsx` already receives — read that call site rather than inventing a source.

★ `projectId` defaults to the literal `"default"` when absent, which is what `DashboardPanel`
passes when it has no project id. That literal matters: the store's recency rule assumes keys are
never integer-like, and `"default"` and every UUID satisfy that. **Do not default it to `""` or a
number.**

★ `isPopout` must reach this from the real popout signal, not be hardcoded `false` — otherwise a
popout window persists its arrangement and cross-writes the main window's.

- [ ] **Step 3b: Wire it up**

Replace the `space-y-6` children of `ReportCard` with the arrangement render. **Delete** the old `useListReorderDnd<AddableReportId>` block, the whole `visibleExtra.map(...)` wrapper — its `data-drop-edge`, its border classes and its own `DragHandle` — and the `removeReportControl`. One arrangement mechanism, not two.

```tsx
  const arrangement = useReportsArrangement({ projectId, extraReports, isPopout });
  const reorder = useListReorderDnd<ReportBlockId>({
    ids: arrangement.layout.board.map((b) => b.id),
    onMove: arrangement.move,
    scrollRef: cardsScrollRef,
    disabled: arrangement.readOnly,
  });

  // ★★ ONE predicate, shared by the board AND the shelf. Two copies drifted on
  // the Dashboard; the shelf must never offer a block that restoring cannot
  // render, and a gated-off block must reappear the moment its module returns.
  const isRenderable = (id: ReportBlockId): boolean => {
    const spec = reportBlockById(id);
    return !!spec && (spec.gate ? spec.gate(features) : true);
  };
```

Render `arrangement.layout.board` filtered by `isRenderable`, each in an `ArrangementTile` with `testIdPrefix="report-block"`, inside:

```tsx
  <ArrangementGrid rowClass="auto-rows-[120px]" gapClass="gap-4" testId="reports-grid">
```

★ `auto-rows-[120px]` and `gap-4` are **literal strings**, not interpolated — Tailwind scans source.

Keep the `ActionChips` block for the addable-report ids, and keep `cardsScrollRef` passed to **both** `ReportCard`'s `contentRef` and the reorder hook's `scrollRef`. The grid must not introduce a scroller of its own.

- [ ] **Step 4: Run**

```bash
npx vitest run src/app/reports.test.tsx > "$SP/v.log" 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests |Errors" "$SP/v.log"
npx tsc --noEmit > "$SP/tsc.log" 2>&1; echo "TSC_EXIT=$?"
npx eslint --max-warnings=0 src/app/reports.tsx; echo "ESLINT_EXIT=$?"
```

- [ ] **Step 5: Commit**

```bash
git commit --only src/app/reports.tsx src/app/reports.test.tsx src/app/workspace-section.tsx \
  -m "feat(reports): render the report blocks through the arrangement grid"
git diff HEAD --stat -- src/app/reports.tsx src/app/reports.test.tsx src/app/workspace-section.tsx
git show --stat HEAD
```

★ `workspace-section.tsx` is in this commit only for the two new props. If the diff shows
anything else in that file, another writer's work has been swept in — unstage and redo with
`--only`.

---

## Task 13: Shelf, block menu and the reset-layout button

**Files:**
- Modify: `src/app/reports.tsx`, `src/app/reports.test.tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
it("hides a block from its menu and offers it back on the shelf", async () => {
  const user = userEvent.setup();
  renderReports();
  await user.click(screen.getByRole("button", { name: /more actions.*By priority/i }));
  await user.click(screen.getByRole("button", { name: /hide/i }));
  expect(screen.queryByTestId("report-block-byPriority")).toBeNull();
  await user.click(screen.getByRole("button", { name: /hidden/i }));
  expect(screen.getByRole("button", { name: /By priority/i })).toBeInTheDocument();
});

it("restores the default arrangement", async () => {
  const user = userEvent.setup();
  renderReports();
  await user.click(screen.getByRole("button", { name: /more actions.*By priority/i }));
  await user.click(screen.getByRole("button", { name: /hide/i }));
  await user.click(screen.getByRole("button", { name: /reset layout/i }));
  expect(screen.getByTestId("report-block-byPriority")).toBeInTheDocument();
});

// ★ Popout is read-only by design; a working reset there would be a live
// control on a surface with no grips, no menus and no shelf.
it("offers no arrangement controls in a popout", () => {
  renderReports({ isPopout: true });
  expect(screen.queryByRole("button", { name: /reset layout/i })).toBeNull();
  expect(screen.queryByRole("button", { name: /reorder/i })).toBeNull();
});
```

- [ ] **Step 2: Run and watch them fail**

```bash
npx vitest run src/app/reports.test.tsx -t "shelf|reset|popout" > "$SP/v.log" 2>&1; echo "EXIT=$?"
```

- [ ] **Step 3: Add the shelf, the menu and the reset button**

Render `ArrangementShelf` (Task 8) for `arrangement.layout.hidden` filtered by the **same**
`isRenderable` predicate the board uses, and `ArrangementBlockMenu` (Task 8) as the ⋮ popover's
content, wrapped in `PopoverPanel` — which owns the shared Escape/Tab dismissal protocol
(`use-dismissable.ts` → `dismissal-stack.ts`). Nothing here improvises a dismissal and nothing
here portals.

Pass the menu its bounds from the spec directly — `minW`/`maxW`/`minH`/`maxH` off
`reportBlockById(id)` — since `ArrangementBlockMenu` takes bounds rather than doing a lookup.

Model the rest of the wiring on `dashboard-panel.tsx` — read its arrangement region first. Carry
across in particular:

- the `shelfToggleRef` + `focusShelfToggle()` pattern, so hiding a block does not strand focus on a removed node;
- the `triggerRefs` map so the ⋮ trigger can be re-focused **after** a move has re-rendered the board (a node captured before the reorder is detached, and focusing it is a silent no-op);
- `shelfDropProps`, so dropping a block on the shelf hides it, with the **grid** decoding the drag — the shelf never inspects a `dataTransfer` itself.

The reset button goes through `ReportCard`'s **`toolbarExtra`**, not into `ReportCard` itself — that toolbar is shared by every report panel, so adding a member there gives every consumer a reset it has no engine for.

```tsx
  toolbarExtra={
    <>
      <ReportsViewsControl … />
      {!arrangement.readOnly && <ResetLayoutButton onClick={arrangement.reset} lang={lang} />}
    </>
  }
```

★ Toolbar order: the trailing group stays **Print · reset-columns · reset-pane-size**, contiguous, with reset-layout immediately before it — mirroring the Dashboard's Print · reset-layout · reset-size. Pin it with `expectButtonOrder` from `src/test/toolbar-order.ts` using `contiguous: true`; never a hand-rolled `compareDocumentPosition` walk, which silently takes the first match when a key is ambiguous.

- [ ] **Step 4: Run**

```bash
npx vitest run src/app/reports.test.tsx > "$SP/v.log" 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests |Errors" "$SP/v.log"
```

- [ ] **Step 5: Commit**

```bash
git commit --only src/app/reports.tsx src/app/reports.test.tsx \
  -m "feat(reports): add the hidden-block shelf, block menu and reset layout"
git show --stat HEAD
```

---

## Task 14: Row-unique names, i18n, and the full gate run

**Files:**
- Modify: `src/app/reports.test.tsx`, `src/app/i18n.ts`, `src/app/i18n.de.ts`

- [ ] **Step 1: Write the row-unique-names test**

Thirteen grips and thirteen ⋮ menus. **The axe gate cannot catch a collision here at any seed size** — no rule under the four tags `e2e/a11y.spec.ts` requests flags two controls sharing an accessible name — so this unit test is the only possible detector, in either layer.

```tsx
import { expectRowUniqueNames } from "../test/row-unique-names";

it("gives every block's grip and menu a block-unique accessible name", () => {
  renderReports();
  expectRowUniqueNames({
    scope: screen.getByTestId("reports-grid"),
    roles: ["button"],
    minControls: 4,
    requireCollisionSeed: false,
  });
});
```

★ Use the shared helper, never a hand-rolled enumeration: `buildRowTokens`/`rowLabel` semantics and the `minControls` floor are why it throws on an empty or narrowed scope. Set `minControls` to the **measured** value for this scope — a loose floor lets a silently narrowed `roles` array back in. `requireCollisionSeed` stays **false** here: this is a distinct-name regression pin, not a collision-coverage claim, and the helper strips only a ` (N)` suffix so it would red against correctly-distinct names.

- [ ] **Step 2: Add the i18n keys**

EN in `i18n.ts` (Edit tool), DE in `i18n.de.ts` (**anchored node script only**, real umlauts, `\r\n` anchors, counts compared before and after — see Task 3 Step 2 for the exact script shape):

```ts
  reportsHiddenBlocks: "Hidden reports",
```

★ `reportsHeadline` was already added in **Task 9 Step 3b** — the catalogue does not compile
without it. Do not add it twice.

★ **Check before adding a reset-layout key.** `ResetLayoutButton` (`task-manager-ui.tsx`) already
owns its own name via `dashboardResetLayout`, and its docstring records that this name must stay
distinct from `ResetSizeButton`'s. Reuse the button as-is; only mint a Reports-specific key if
rendering it here produces a WCAG 2.4.6 collision with the Dashboard's — which it cannot, since the
two never render in one view.

Reuse the existing `reorderHandle` and `actionMoreActions` keys for the grip and ⋮ — that is the
established convention in `dashboard-tile.tsx` and `task-row.tsx`.

- [ ] **Step 3: Full gate run**

```bash
npx tsc --noEmit > "$SP/tsc.log" 2>&1; echo "TSC_EXIT=$?"
npx eslint --max-warnings=0 src/app; echo "ESLINT_EXIT=$?"
npm run test:run > "$SP/suite.log" 2>&1; echo "SUITE_EXIT=$?"
grep -E "Test Files|Tests |Errors" "$SP/suite.log"
npm run test:shuffle > "$SP/shuffle.log" 2>&1; echo "SHUFFLE_EXIT=$?"
grep -E "Test Files|Tests |Errors" "$SP/shuffle.log"
npm run size:check > "$SP/size.log" 2>&1; echo "SIZE_EXIT=$?"
npm run dup:check > "$SP/dup.log" 2>&1; echo "DUP_EXIT=$?"
npm run docs:symbols:check > "$SP/sym.log" 2>&1; echo "SYM_EXIT=$?"
```

★ `test:shuffle` is not optional — this slice adds test files, and it is the only local reproduction of CI's `unit-tests-shuffled` job. ★ `dup:check` matters specifically here: seven adapters that thinly wrap seven generic modules is exactly the shape that moves the duplicated-line percentage. If it goes red, **collapse the duplication — never raise the threshold.**

- [ ] **Step 4: The axe check on a FRESH isolated server**

```bash
PORT=3100 npm run dev &
curl -o /dev/null -s -w "%{time_total}\n" http://localhost:3100/    # warm until well under 1s
npx playwright test e2e/a11y.spec.ts --project=chromium -g "Reports" --workers=1
npx playwright test e2e/a11y.spec.ts --project=chromium -g "Dashboard" --workers=1
PORT=3100 npm run stop
```

★ `--workers=1` is mandatory whenever more than one view is matched: `playwright.config.ts` sets `workers: process.env.CI ? 1 : undefined`, so local runs go at CPU count and over-subscribe into `Test timeout of 60000ms exceeded` inside `page.evaluate` — which prints as a failure with **no violation text**. Read the failure body, never the summary line: a real violation names a rule id and an impact. ★ Never point this at the long-running server on port 3000.

- [ ] **Step 5: Commit**

```bash
git commit --only src/app/reports.test.tsx src/app/i18n.ts src/app/i18n.de.ts \
  -m "test(reports): pin block-unique control names; add the arrangement strings"
git diff HEAD --stat -- src/app/reports.test.tsx src/app/i18n.ts src/app/i18n.de.ts
git show --stat HEAD
```

- [ ] **Step 6: Record the owed eye-verifies**

Append a follow-up entry to `docs/open-followups.md` (**LF-only**; mint a number above the current max, which is **418** on this branch — check with
`grep -oE "^## [0-9]+\." docs/open-followups.md | grep -oE "[0-9]+" | sort -n | tail -1`).

The entry records three things no gate can check, each measured only by eye:

1. the seven `minW: 4` blocks are readable at `xl` and do not squeeze below it;
2. the 120px row unit gives embedded reports a usable height;
3. Reports still prints sanely under `print-root print-landscape` with a dense grid.

Every OPEN entry needs a `**Status:**` line carrying an ISO date that either cites a runnable command or says `never machine-verified`. For an unrun eye-verify, **`never machine-verified` is the conforming and honest answer** — do not invent a verification. Add the summary-table row before `<!-- INDEX:END -->`, anchoring the match at `^`: the file quotes that marker inside a recipe further up, so a bare substring search finds two.

```bash
npm run followups:status:check > "$SP/f.log" 2>&1; echo "FOLLOWUPS_EXIT=$?"
npm run docs:claims:check > "$SP/c.log" 2>&1; echo "CLAIMS_EXIT=$?"
git commit --only docs/open-followups.md -m "docs(followups): file the Reports arrangement eye-verifies"
```

---

## Definition of done

- [ ] `npm run test:run` and `npm run test:shuffle` both green; `Errors` absent from both logs.
- [ ] `npx tsc --noEmit` exits 0; `npx eslint --max-warnings=0 src/app` exits 0.
- [ ] `size:check`, `dup:check`, `docs:symbols:check`, `docs:claims:check`, `followups:status:check` all exit 0.
- [ ] **`git diff origin/main --stat -- src/app/dashboard-panel.tsx` is EMPTY.** This plan never edits it.
- [ ] Every Dashboard test file is unmodified: `git diff origin/main --stat -- 'src/app/dashboard-*.test.*' 'src/app/use-dashboard-layout.test.tsx'` is empty.
- [ ] Axe green on Reports and Dashboard at `--workers=1` on a fresh `PORT=3100` server.
- [ ] `git ls-files --eol` reports `i/lf w/crlf` for every touched `src/app` file and `i/lf w/lf` for `docs/open-followups.md`.
- [ ] `git status --short` shows only `M sample-workspace-huge.json` and `?? not-in-use.env.local.bak` — neither ever staged.
- [ ] No version bump, no CHANGELOG entry, nothing pushed.
