# Control-defects follow-through — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the debt the 0.287.0 control-defects batch left behind (§407, §409, §414), plus §337, the defect that blocks §408.

**Architecture:** Five independent items sharing no state. Two touch the Turso config path (`turso-config.ts` + `integrations-section.tsx`), one the documents panel, one the task-row badge, one is a new e2e verification spec. No new persisted `Workspace` or `Settings` field anywhere, so the six-write-paths hard constraint never engages — that is why §408 stores its probe result in transient component state.

**Tech Stack:** Next.js 16 / React / TypeScript / Tailwind v4 / vitest + Testing Library / Playwright.

**Spec:** `docs/superpowers/specs/2026-09-06-control-defects-follow-through-design.md` — the source of truth, and more precise than this plan's summaries. Read spec §4 before touching §407.

**Branch:** `feat/control-defects-follow-through`, at `ce9463eb` = `origin/main` (`33fa149c`, 0.287.0 "Tiptree") + two spec commits.

**NO release and NO version bump in this plan.** The slice ships separately on explicit say.

---

## Before you start — read this once

These are not style preferences. Each one has cost a build, a debug cycle, or a false green.

**Line endings.** Every `src/app/*.ts(x)` is CRLF. Use the **Edit tool only** — never Write, never `sed -i`; both silently re-line the whole file, and `core.autocrlf=true` hides it from `git diff`. `docs/open-followups.md` and the plan/spec files are LF. Verify any file you touched with:

```bash
git ls-files --eol <file>     # src/app/* must read: i/lf w/crlf
```

**`i18n.de.ts` must never be touched with the Edit tool.** It corrupts umlauts and curls double quotes. Patch it with an anchored node utf8 write matching `\r\n`, using real umlauts — the `i18n-encoding` test bans ASCII substitutions like `fuer`/`druecken`. Task 1 gives the exact script.

**Never read a gate's exit code through a pipe.** `npm run test:run | tail -8` exits 0 while tests fail, because that is `tail`'s status. Redirect, check unpiped, then grep the file:

```bash
SP="$CLAUDE_SCRATCHPAD"   # the session scratchpad dir; never /tmp
npm run test:run > "$SP/suite.log" 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests |Errors" "$SP/suite.log"
```

**Always grep for `Errors` beside the tally.** A mutant that makes a listener throw is reported as an unhandled error, not a failure: the run prints `Tests N passed` *and* `Errors 1` at a nonzero exit. Reading the tally alone calls that green.

**Never run two vitest processes at once.** `Failed to start forks worker` is contention, not evidence.

**`npx tsc --noEmit` exits 2 on diagnostics**, not 1. Check for `EXIT=0`, never `EXIT!=1`.

**Use `npx eslint --max-warnings=0 <files>`**, not `npm run lint` — the latter exits 1 from gitignored `.worktrees/` leftovers.

**Git hygiene in this shared tree.** Never `git add -A` or `git add .`. Never stage `sample-workspace-huge.json` (a foreign writer modifies it) or `not-in-use.env.local.bak` (untracked, NOT gitignored, holds live Turso credentials — never open, print, or stage it). Commit with `git commit --only <paths>`; a new untracked file needs `git add <path>` first.

**Never echo, log, paste, or commit the Turso URL or token.** Tasks 3 and 4 touch both fields.

**Closing check for every task** — the scoped form, because a bare `git diff HEAD --stat` is empty for your own files after you commit and shows only other writers' work:

```bash
git diff HEAD --stat -- <the files this task touched>   # expect: NO OUTPUT
git show --stat HEAD                                    # expect: exactly your files
```

**`git checkout -- <file>` is DENY-BLOCKED.** Revert a mutation with an inverse anchored Edit, assert the anchor is unique in both directions, and finish on an empty scoped diff.

**Mutation testing format.** Record every mutant as `N failed / M passed` where **N + M equals the file's runtime test count**. A `failed`-only tally has no sum check and has hidden a vacuous test before.

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `src/app/i18n.ts` | modify | EN strings. Gains 5 keys (Task 1). |
| `src/app/i18n.de.ts` | modify | DE strings. Gains the same 5 keys. Key parity is tsc-enforced. |
| `src/app/turso-config.ts` | modify | Config resolver. Gains an exported usability predicate; env precedence becomes conditional (Task 2). |
| `src/app/turso-config.test.ts` | modify | Resolver tests. Gains the 4-way precedence matrix. |
| `src/app/turso-pipeline.ts` | modify | Network path. Gains `testTursoConnection` (Task 4) — placed here rather than a new `.ts` file, which would be coverage-gated. |
| `src/app/turso-pipeline.test.ts` | modify | Gains probe tests. |
| `src/app/settings-sections/integrations-section.tsx` | modify | Turso settings UI. Gains the unusable-env disclosure (Task 3) and the Test-connection button (Task 4). 756 lines today. |
| `src/app/settings-sections/integrations-section.test.tsx` | modify | Gains disclosure + probe UI tests. |
| `src/app/documents-panel.tsx` | modify | Swaps the collapse from unmount to `hidden` (Task 5). 826 lines today. |
| `src/app/documents-panel.test.tsx` | modify | Gains the no-commit-on-collapse test. |
| `src/app/task-row.tsx` | modify | Hoists a singular/plural changes label (Task 6). |
| `src/app/task-kanban-card.tsx` | modify | Same branch for the card badge. |
| `src/app/task-row.test.tsx` | modify | Gains singular/plural assertions. |
| `e2e/control-defects-eye-verify.spec.ts` | **create** | The §414 measuring spec (Task 7). |
| `docs/open-followups.md` | modify | Files the plural class, corrects §185, closes §284 (Task 8). LF-only. |

No new `.ts` module is created. `testTursoConnection` goes into `turso-pipeline.ts` deliberately: a new `.ts` file is coverage-gated by `vitest.config.ts` and would raise the per-engine floors.

---

## Task 1: The five i18n keys

Done first, not last, because every later task's tests reference these keys. It is one serialized touch of both i18n files, which minimises the window in which a concurrent writer could collide.

**Files:**
- Modify: `src/app/i18n.ts`
- Modify: `src/app/i18n.de.ts`

- [ ] **Step 1: Confirm neither i18n file is dirty before starting**

```bash
git status --short src/app/i18n.ts src/app/i18n.de.ts
```

Expected: no output. If either file is dirty, STOP and report — a peer may be mid-write.

- [ ] **Step 2: Add the five EN keys with the Edit tool**

`src/app/i18n.ts` is CRLF. Use the **Edit tool**, not Write.

Anchor on the existing `taskRowChangesBadge` line and add its singular sibling immediately after:

Find:
```
  taskRowChangesBadge: "{0} changes",
```

Replace with:
```
  taskRowChangesBadge: "{0} changes",
  // ★ Singular sibling. The house idiom is a `*One` key plus a `count === 1 ?`
  // ternary at the call site (nine such keys today) — NOT a pluralize() helper.
  // German breaks on noun AND adjective AND verb agreement at once, so a
  // singular is a re-worded sentence, not a suffix swap on a fragment. That is
  // why this key hardcodes the numeral and takes no placeholder.
  taskRowChangesBadgeOne: "1 change",
```

Then anchor on the existing Turso-from-env hint and add the four remaining keys after it:

Find:
```
  integrationsTursoUrlFromEnv:
```

Read the whole existing entry first (`grep -n -A 2 'integrationsTursoUrlFromEnv:' src/app/i18n.ts`), then add these four keys immediately after that entry's closing line:

```
  // ★ Shown when NEXT_PUBLIC_TURSO_DATABASE_URL is set but is not a usable
  // Turso URL. Before this existed the field was hidden on env-var PRESENCE
  // while the resolver rejected the value on USABILITY, so a typo locked the
  // user out of configuring Turso at all (open-followups §337).
  integrationsTursoUrlEnvUnusable:
    "NEXT_PUBLIC_TURSO_DATABASE_URL is set but is not a usable Turso URL, so the value below is used instead.",
  integrationsTursoTest: "Test connection",
  integrationsTursoTestOk: "Connected.",
  integrationsTursoTestFail: "Connection failed: {0}",
```

- [ ] **Step 3: Add the five DE keys with an anchored node script**

**Do NOT use the Edit tool on `i18n.de.ts`.** Write this script to the session scratchpad and run it. Note the `\r\n` anchors and the real umlauts (`Ä`, `ä`, `ü`).

```js
// scratchpad/de-keys.mjs
import fs from "node:fs";
const P = "src/app/i18n.de.ts";
let s = fs.readFileSync(P, "utf8");

const pairs = [
  [
    '  taskRowChangesBadge: "{0} Änderungen",\r\n',
    '  taskRowChangesBadge: "{0} Änderungen",\r\n  taskRowChangesBadgeOne: "1 Änderung",\r\n',
  ],
];
for (const [from, to] of pairs) {
  const n = s.split(from).length - 1;
  if (n !== 1) throw new Error(`anchor not unique (${n}): ${from.trim()}`);
  s = s.replace(from, to);
}
fs.writeFileSync(P, s, "utf8");
console.log("ok");
```

Run it, then repeat the same anchored-write approach for the four Turso keys, anchoring on the DE `integrationsTursoUrlFromEnv` entry. The DE values are:

```
  integrationsTursoUrlEnvUnusable:
    "NEXT_PUBLIC_TURSO_DATABASE_URL ist gesetzt, ist aber keine verwendbare Turso-URL. Stattdessen wird der Wert unten verwendet.",
  integrationsTursoTest: "Verbindung testen",
  integrationsTursoTestOk: "Verbunden.",
  integrationsTursoTestFail: "Verbindung fehlgeschlagen: {0}",
```

- [ ] **Step 4: Verify encoding and line endings survived**

```bash
git ls-files --eol src/app/i18n.de.ts    # expect i/lf w/crlf
grep -c "Änderung" src/app/i18n.de.ts    # expect >= 2 (real umlaut, not "Aenderung")
grep -c "fuer\|druecken\|Aenderung" src/app/i18n.de.ts   # expect 0
```

- [ ] **Step 5: Typecheck — this is what enforces EN/DE parity**

```bash
SP="$CLAUDE_SCRATCHPAD"
npx tsc --noEmit > "$SP/tsc1.log" 2>&1; echo "EXIT=$?"
```

Expected: `EXIT=0`. A missing DE sibling fails here, which is the point.

- [ ] **Step 6: Run the encoding test**

```bash
SP="$CLAUDE_SCRATCHPAD"
npx vitest run src/app/i18n-encoding.test.ts > "$SP/enc.log" 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests |Errors" "$SP/enc.log"
```

Expected: `EXIT=0`, no `Errors` line.

- [ ] **Step 7: Commit**

```bash
git add src/app/i18n.ts src/app/i18n.de.ts
git commit --only src/app/i18n.ts src/app/i18n.de.ts -F - <<'MSGEOF'
i18n: add the five keys the follow-through slice needs

taskRowChangesBadgeOne closes the "1 changes" wording (§407) using the
house *One idiom rather than a helper — see the spec for why a two-fragment
pluralize() cannot express the German singulars.

integrationsTursoUrlEnvUnusable discloses an env var that is set but not a
usable Turso URL (§337). The three integrationsTursoTest* keys carry the
connection probe's button and its two outcomes (§408).

Claude-Session: https://[session link removed]
MSGEOF
```

- [ ] **Step 8: Closing check**

```bash
git diff HEAD --stat -- src/app/i18n.ts src/app/i18n.de.ts   # expect NO OUTPUT
git show --stat HEAD                                          # expect exactly those 2 files
```

---

## Task 2: §337 — make env precedence conditional on usability

**Files:**
- Modify: `src/app/turso-config.ts`
- Test: `src/app/turso-config.test.ts`

Read spec §1 first. The behaviour change: today `envUrl` outranks `settingsUrl` unconditionally; after this it outranks it **only when usable**.

- [ ] **Step 1: Write the failing tests**

Add to `src/app/turso-config.test.ts` (CRLF — Edit tool). These are the four-way matrix. `process.env.NEXT_PUBLIC_*` is inlined at build time by Next, but under vitest it reads the live object, so assign and restore around each case.

```ts
describe("§337 — env precedence is conditional on usability", () => {
  const ENV_URL = "NEXT_PUBLIC_TURSO_DATABASE_URL";
  let saved: string | undefined;

  beforeEach(() => {
    saved = process.env[ENV_URL];
  });
  afterEach(() => {
    if (saved === undefined) delete process.env[ENV_URL];
    else process.env[ENV_URL] = saved;
  });

  it("a USABLE env url still outranks the settings url", () => {
    process.env[ENV_URL] = "libsql://env-db.turso.io";
    const cfg = getTursoConfig("https://settings-db.turso.io", "tok");
    expect(cfg?.httpUrl).toBe("https://env-db.turso.io");
  });

  it("an UNUSABLE env url falls through to the settings url", () => {
    process.env[ENV_URL] = "postgres://nope";
    const cfg = getTursoConfig("https://settings-db.turso.io", "tok");
    expect(cfg?.httpUrl).toBe("https://settings-db.turso.io");
  });

  it("an UNUSABLE env url with no settings url is still null", () => {
    process.env[ENV_URL] = "postgres://nope";
    expect(getTursoConfig(undefined, "tok")).toBeNull();
  });

  it("an UNUSABLE env url with an equally unusable settings url is null", () => {
    process.env[ENV_URL] = "postgres://nope";
    expect(getTursoConfig("not a url", "tok")).toBeNull();
  });

  it("isUsableTursoUrl agrees with the resolver on both sides", () => {
    expect(isUsableTursoUrl("libsql://db.turso.io")).toBe(true);
    expect(isUsableTursoUrl("https://db.turso.io")).toBe(true);
    expect(isUsableTursoUrl("http://localhost:8080")).toBe(true);
    expect(isUsableTursoUrl("postgres://nope")).toBe(false);
    expect(isUsableTursoUrl("http://example.com")).toBe(false);
    expect(isUsableTursoUrl("")).toBe(false);
  });
});
```

Add `isUsableTursoUrl` to the file's existing import from `./turso-config`.

- [ ] **Step 2: Run to verify they fail**

```bash
SP="$CLAUDE_SCRATCHPAD"
npx vitest run src/app/turso-config.test.ts > "$SP/t2a.log" 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests |Errors" "$SP/t2a.log"
```

Expected: nonzero exit; `isUsableTursoUrl` is not exported yet, so the file fails to resolve the import.

- [ ] **Step 3: Export the predicate and make precedence conditional**

Edit `src/app/turso-config.ts`. Add the exported predicate immediately after `toHttpUrl`'s closing brace:

```ts
/** True when a raw URL string normalises to a usable pipeline base.
 *
 *  ★★ EXPORTED SO THE SETTINGS UI ASKS THE SAME QUESTION THIS FILE ANSWERS.
 *  Before it existed, `integrations-section.tsx` hid the URL input on env-var
 *  PRESENCE (`!!process.env.NEXT_PUBLIC_TURSO_DATABASE_URL`) while the
 *  resolver below rejected the value on USABILITY. A typo'd env var was
 *  therefore present enough to hide the field and unusable enough to yield no
 *  config, locking the user out of configuring Turso from the UI at all
 *  (open-followups §337). Two predicates answering one question is the defect;
 *  do not reintroduce a second one. */
export function isUsableTursoUrl(raw: string): boolean {
  return toHttpUrl(raw) !== null;
}
```

Then change the resolution in `getTursoConfig`. Find:

```ts
  const rawUrl = (envUrl && envUrl !== "" ? envUrl : settingsUrl) ?? "";
```

Replace with:

```ts
  // ★★ THE ENV VALUE WINS ONLY WHEN IT IS USABLE. An unusable one falls
  // through to Settings rather than poisoning the result — see §337 and the
  // predicate above. This is deployment-visible: an operator who set the env
  // var to a deliberately malformed value to force "no Turso" now gets the
  // Settings value instead. Nothing that WORKED before changes, because an
  // unusable env value already resolved to null.
  const envUrlUsable = !!envUrl && envUrl !== "" && isUsableTursoUrl(envUrl);
  const rawUrl = (envUrlUsable ? envUrl : settingsUrl) ?? "";
```

- [ ] **Step 4: Correct the file header — it is now false**

The header at the top of `src/app/turso-config.ts` claims env vars "win when set at build time". Find:

```
// Config resolver for the Turso (libSQL) storage backend. Env vars
// (NEXT_PUBLIC_TURSO_*) win when set at build time; Settings (Integrations
// panel inputs) are the fallback. Returns null when URL or token is missing
// or the URL is unusable — the storage layer surfaces "not ready".
```

Replace with:

```
// Config resolver for the Turso (libSQL) storage backend. A NEXT_PUBLIC_TURSO_*
// env var wins over the Settings (Integrations panel) value ONLY when it is
// usable; an unusable env URL falls through to Settings rather than poisoning
// the result. The TOKEN has no usability test — any non-empty string is a
// plausible token — so an env token still wins unconditionally, and the
// Settings "Test connection" button is what tells a user it is wrong.
// Returns null when the URL or token is missing or the URL is unusable — the
// storage layer surfaces "not ready".
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
SP="$CLAUDE_SCRATCHPAD"
npx vitest run src/app/turso-config.test.ts > "$SP/t2b.log" 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests |Errors" "$SP/t2b.log"
```

Expected: `EXIT=0`, no `Errors` line. Record the runtime test count from the `Tests` line — you need it for the next step's sum check.

- [ ] **Step 6: Mutation-prove the USABLE-env branch**

★ This is the mutation that matters. A test suite exercising only the unusable branch passes whether or not the usable branch still works.

Apply the mutant with an Edit — invert the usability term:

```ts
  const envUrlUsable = !!envUrl && envUrl !== "" && !isUsableTursoUrl(envUrl);
```

Re-run the file. Expected: **at least the "a USABLE env url still outranks the settings url" case fails.** Record `N failed / M passed`, and confirm `N + M` equals the count from Step 5.

Revert with an inverse anchored Edit (drop the `!`), assert the anchor was unique in both directions, then:

```bash
git diff --stat -- src/app/turso-config.ts   # expect only your intended change
```

- [ ] **Step 7: Gates**

```bash
SP="$CLAUDE_SCRATCHPAD"
npx tsc --noEmit > "$SP/t2tsc.log" 2>&1; echo "TSC_EXIT=$?"
npx eslint --max-warnings=0 src/app/turso-config.ts src/app/turso-config.test.ts; echo "LINT_EXIT=$?"
```

Expected: both `0`.

- [ ] **Step 8: Commit**

```bash
git commit --only src/app/turso-config.ts src/app/turso-config.test.ts -F - <<'MSGEOF'
fix(turso): an unusable env URL no longer outranks the Settings value

§337: two predicates disagreed. integrations-section.tsx hid the URL field on
env-var PRESENCE while getTursoConfig resolved on USABILITY, so a typo'd
NEXT_PUBLIC_TURSO_DATABASE_URL was present enough to hide the field and
unusable enough to yield no config — Turso became unconfigurable from the UI
with no route back.

Exports isUsableTursoUrl so the Settings UI can ask the same question this
resolver asks, and makes the env value win only when usable.

Deployment-visible: an operator who set the env var to a deliberately
malformed value to force "no Turso" now gets the Settings value instead.
Nothing that worked before changes — an unusable env value already resolved
to null. Belongs in the CHANGELOG as a behaviour change, not a bug fix.

The file header claimed env vars "win when set at build time"; corrected in
this commit rather than left to read as current.

Claude-Session: https://[session link removed]
MSGEOF
```

- [ ] **Step 9: Closing check**

```bash
git diff HEAD --stat -- src/app/turso-config.ts src/app/turso-config.test.ts   # expect NO OUTPUT
git show --stat HEAD
```

---

## Task 3: §337 — disclose an unusable env URL in Settings

**Files:**
- Modify: `src/app/settings-sections/integrations-section.tsx`
- Test: `src/app/settings-sections/integrations-section.test.tsx`

- [ ] **Step 1: Write the failing tests**

Add to `src/app/settings-sections/integrations-section.test.tsx`. Follow the file's existing render helper and props; if it has one, reuse it rather than building a new harness.

```ts
describe("§337 — an unusable env URL still lets the user configure Turso", () => {
  const ENV_URL = "NEXT_PUBLIC_TURSO_DATABASE_URL";
  let saved: string | undefined;

  beforeEach(() => {
    saved = process.env[ENV_URL];
  });
  afterEach(() => {
    if (saved === undefined) delete process.env[ENV_URL];
    else process.env[ENV_URL] = saved;
  });

  it("renders the URL input AND the disclosure when the env var is set but unusable", () => {
    process.env[ENV_URL] = "postgres://nope";
    renderIntegrations({ turso: { enabled: true } });
    expect(screen.getByText(t("en-US", "integrationsTursoUrlEnvUnusable"))).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText(t("en-US", "integrationsTursoUrlPlaceholder")),
    ).toBeInTheDocument();
  });

  // ★ THE MUTATION-RELEVANT CASE. A suite that only covers the unusable
  // branch passes whether or not the usable branch still hides the field.
  it("keeps the from-env hint and NO input when the env var is usable", () => {
    process.env[ENV_URL] = "libsql://db.turso.io";
    renderIntegrations({ turso: { enabled: true } });
    expect(screen.getByText(t("en-US", "integrationsTursoUrlFromEnv"))).toBeInTheDocument();
    expect(
      screen.queryByPlaceholderText(t("en-US", "integrationsTursoUrlPlaceholder")),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(t("en-US", "integrationsTursoUrlEnvUnusable")),
    ).not.toBeInTheDocument();
  });

  it("shows neither hint nor disclosure when no env var is set", () => {
    delete process.env[ENV_URL];
    renderIntegrations({ turso: { enabled: true } });
    expect(
      screen.queryByText(t("en-US", "integrationsTursoUrlFromEnv")),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(t("en-US", "integrationsTursoUrlEnvUnusable")),
    ).not.toBeInTheDocument();
    expect(
      screen.getByPlaceholderText(t("en-US", "integrationsTursoUrlPlaceholder")),
    ).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify they fail**

```bash
SP="$CLAUDE_SCRATCHPAD"
npx vitest run src/app/settings-sections/integrations-section.test.tsx > "$SP/t3a.log" 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests |Errors" "$SP/t3a.log"
```

Expected: the unusable-env case fails — today the field is hidden on presence alone.

- [ ] **Step 3: Compute usability alongside presence**

Edit `src/app/settings-sections/integrations-section.tsx`. Add `isUsableTursoUrl` to the existing import from `../turso-config` (the file already imports `getTursoConfig` from there).

Find:
```tsx
  const envTursoUrlSet = !!process.env.NEXT_PUBLIC_TURSO_DATABASE_URL;
  const envTursoTokenSet = !!process.env.NEXT_PUBLIC_TURSO_AUTH_TOKEN;
```

Replace with:
```tsx
  const envTursoUrlSet = !!process.env.NEXT_PUBLIC_TURSO_DATABASE_URL;
  // ★★ PRESENCE AND USABILITY ARE DIFFERENT QUESTIONS, and asking only the
  // first is §337: a typo'd env var hid this field while `getTursoConfig`
  // rejected the value, so Turso could not be configured from the UI at all.
  // The predicate is imported rather than re-implemented so the two sites
  // cannot drift apart again.
  const envTursoUrlUsable =
    envTursoUrlSet && isUsableTursoUrl(process.env.NEXT_PUBLIC_TURSO_DATABASE_URL ?? "");
  // ★ The TOKEN gets no equivalent: any non-empty string is a plausible token,
  // so there is nothing to test locally. The "Test connection" button below is
  // what tells a user an env token is wrong.
  const envTursoTokenSet = !!process.env.NEXT_PUBLIC_TURSO_AUTH_TOKEN;
```

- [ ] **Step 4: Switch the two URL branches to usability and add the disclosure**

Find:
```tsx
          {envTursoUrlSet && (
            <div className="block text-xs">
              <span className="inline-flex items-center gap-1 text-muted-foreground">
                {t(lang, "integrationsTursoUrl")}
                <InfoTooltip text={t(lang, "integrationsTursoUrlTooltip")} />
              </span>
              <FieldHint className="mt-1">{t(lang, "integrationsTursoUrlFromEnv")}</FieldHint>
            </div>
          )}
          {!envTursoUrlSet && (
            <label className="block text-xs">
              <span className="inline-flex items-center gap-1 text-muted-foreground">
                {t(lang, "integrationsTursoUrl")}
                <InfoTooltip text={t(lang, "integrationsTursoUrlTooltip")} />
              </span>
              <Input
                size="xs"
                type="text"
                value={turso.databaseUrl ?? ""}
                onChange={(e) => updateTurso({ databaseUrl: e.target.value })}
                placeholder={t(lang, "integrationsTursoUrlPlaceholder")}
                className="mt-1 w-full"
              />
            </label>
          )}
```

Replace with:
```tsx
          {envTursoUrlUsable && (
            <div className="block text-xs">
              <span className="inline-flex items-center gap-1 text-muted-foreground">
                {t(lang, "integrationsTursoUrl")}
                <InfoTooltip text={t(lang, "integrationsTursoUrlTooltip")} />
              </span>
              <FieldHint className="mt-1">{t(lang, "integrationsTursoUrlFromEnv")}</FieldHint>
            </div>
          )}
          {!envTursoUrlUsable && (
            <label className="block text-xs">
              <span className="inline-flex items-center gap-1 text-muted-foreground">
                {t(lang, "integrationsTursoUrl")}
                <InfoTooltip text={t(lang, "integrationsTursoUrlTooltip")} />
              </span>
              <Input
                size="xs"
                type="text"
                value={turso.databaseUrl ?? ""}
                onChange={(e) => updateTurso({ databaseUrl: e.target.value })}
                placeholder={t(lang, "integrationsTursoUrlPlaceholder")}
                className="mt-1 w-full"
              />
              {envTursoUrlSet && (
                <FieldNotice>{t(lang, "integrationsTursoUrlEnvUnusable")}</FieldNotice>
              )}
            </label>
          )}
```

★ `FieldNotice` is already imported at `:7` (`import { FieldNotice } from "../field-feedback";`) and the token field already uses it for `credentialStorageNote` at `:553`. Verified — no import to add here.

- [ ] **Step 5: Run the tests to verify they pass**

```bash
SP="$CLAUDE_SCRATCHPAD"
npx vitest run src/app/settings-sections/integrations-section.test.tsx > "$SP/t3b.log" 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests |Errors" "$SP/t3b.log"
```

Expected: `EXIT=0`, no `Errors`. Record the runtime test count.

- [ ] **Step 6: Mutation-prove the usable branch**

Apply the mutant: change `{envTursoUrlUsable && (` back to `{envTursoUrlSet && (` and `{!envTursoUrlUsable && (` to `{!envTursoUrlSet && (`.

Expected: **the "renders the URL input AND the disclosure" case fails.** Record `N failed / M passed` and confirm the sum matches Step 5.

Now the second mutant, which is the one the spec calls out: leave the branches on `envTursoUrlUsable` but delete the `{envTursoUrlSet && (<FieldNotice…>)}` block. Expected: the disclosure case fails, the usable-branch case still passes. Record both tallies.

Revert each with an inverse anchored Edit and finish on:

```bash
git diff --stat -- src/app/settings-sections/integrations-section.tsx
```

- [ ] **Step 7: Gates**

```bash
SP="$CLAUDE_SCRATCHPAD"
npx tsc --noEmit > "$SP/t3tsc.log" 2>&1; echo "TSC_EXIT=$?"
npx eslint --max-warnings=0 src/app/settings-sections/integrations-section.tsx src/app/settings-sections/integrations-section.test.tsx; echo "LINT_EXIT=$?"
node -e "console.log(require('fs').readFileSync('src/app/settings-sections/integrations-section.tsx','utf8').split('\n').length)"
```

Expected: both `0`; the line count well under the 1600 LIMIT (756 before this task).

- [ ] **Step 8: Commit**

```bash
git commit --only src/app/settings-sections/integrations-section.tsx src/app/settings-sections/integrations-section.test.tsx -F - <<'MSGEOF'
fix(settings): show the Turso URL field when the env var is unusable

§337, the UI half. The field was hidden on env-var PRESENCE while
getTursoConfig resolved on USABILITY. Both sites now share the exported
isUsableTursoUrl, so a set-but-unusable env var renders the input again and
discloses why instead of leaving a dead "comes from the environment" hint.

The TOKEN deliberately keeps its presence check: any non-empty string is a
plausible token, so there is nothing to test locally. The Test-connection
button added next is what tells a user an env token is wrong.

Claude-Session: https://[session link removed]
MSGEOF
```

- [ ] **Step 9: Closing check**

```bash
git diff HEAD --stat -- src/app/settings-sections/integrations-section.tsx src/app/settings-sections/integrations-section.test.tsx   # expect NO OUTPUT
git show --stat HEAD
```

---

## Task 4: §408 — the Turso connection probe

**Files:**
- Modify: `src/app/turso-pipeline.ts`
- Test: `src/app/turso-pipeline.test.ts`
- Modify: `src/app/settings-sections/integrations-section.tsx`
- Test: `src/app/settings-sections/integrations-section.test.tsx`

★ The probe lives in `turso-pipeline.ts`, not a new module: a new `.ts` file is coverage-gated and would raise the per-engine floors.

★★ Never echo, log, or commit a real URL or token while working on this task. Test fixtures use obviously fake values.

- [ ] **Step 1: Write the failing probe tests**

Add to `src/app/turso-pipeline.test.ts`. These use the file's **real** helpers — `stubFetch(impl)` (defined at `:10`) and the shared `cfg` fixture (`:6`, `{ httpUrl: "https://db.example.com", authToken: "tok" }`). Do not invent new mock helpers; do not add a second config fixture.

★★ `StorageNotReadyError` carries a **`hint` field** — the existing network-failure test asserts `.rejects.toMatchObject({ hint: "storage-unreachable" })`, **not** a message match. A `toThrow(/storage-unreachable/)` would fail.

```ts
describe("testTursoConnection", () => {
  it("resolves when the pipeline answers ok", async () => {
    stubFetch(() => new Response(JSON.stringify({ results: [{ type: "ok" }] }), { status: 200 }));
    await expect(testTursoConnection(cfg)).resolves.toBeUndefined();
  });

  it("sends exactly one SELECT 1 statement", async () => {
    const fetchMock = vi.fn();
    fetchMock.mockImplementation(
      () => new Response(JSON.stringify({ results: [{ type: "ok" }] }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await testTursoConnection(cfg);
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(String(init.body)).toContain("SELECT 1");
  });

  it("rejects with StorageNotReadyError on 401", async () => {
    stubFetch(() => new Response("no", { status: 401 }));
    await expect(testTursoConnection(cfg)).rejects.toBeInstanceOf(StorageNotReadyError);
  });

  it("rejects as unreachable on a network failure", async () => {
    stubFetch(() => {
      throw new Error("ECONNREFUSED");
    });
    await expect(testTursoConnection(cfg)).rejects.toMatchObject({
      hint: "storage-unreachable",
    });
  });

  it("rejects when the config is null", async () => {
    await expect(testTursoConnection(null)).rejects.toBeInstanceOf(StorageNotReadyError);
  });
});
```

`StorageNotReadyError` is already imported in this test file (it comes from `./workspace`, where it is declared at `:364`). Add `testTursoConnection` to the existing import from `./turso-pipeline`.

- [ ] **Step 2: Run to verify they fail**

```bash
SP="$CLAUDE_SCRATCHPAD"
npx vitest run src/app/turso-pipeline.test.ts > "$SP/t4a.log" 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests |Errors" "$SP/t4a.log"
```

Expected: nonzero — `testTursoConnection` is not exported.

- [ ] **Step 3: Add the probe**

Edit `src/app/turso-pipeline.ts`. Add after `runTursoPipeline`:

```ts
/** Timeout for the Settings "Test connection" probe. Shorter than
 *  DEFAULT_PIPELINE_TIMEOUT_MS because a human is watching a spinner. */
export const TEST_CONNECTION_TIMEOUT_MS = 10_000;

/** Round-trip the smallest possible statement to prove a URL/token pair
 *  actually connects. Resolves on success; rejects with the error
 *  `runTursoPipeline` already discriminates — StorageNotReadyError for an
 *  absent config, an unreachable host or a rejected token, and a plain Error
 *  carrying the status for anything else.
 *
 *  ★ NOTHING IS PERSISTED FROM THIS. The caller keeps the outcome in transient
 *  component state, exactly as the Jira and Timelog test buttons do. A stored
 *  "connection confirmed" flag would be a new Settings field and therefore the
 *  six-write-paths case (open-followups §408). */
export async function testTursoConnection(config: TursoConfig | null): Promise<void> {
  await runTursoPipeline(config, [{ sql: "SELECT 1" }], TEST_CONNECTION_TIMEOUT_MS);
}
```

Add `TursoConfig` to the file's existing type import from `./turso-config` if it is not already imported.

- [ ] **Step 4: Run the probe tests to verify they pass**

```bash
SP="$CLAUDE_SCRATCHPAD"
npx vitest run src/app/turso-pipeline.test.ts > "$SP/t4b.log" 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests |Errors" "$SP/t4b.log"
```

Expected: `EXIT=0`, no `Errors`.

- [ ] **Step 5: Write the failing UI test**

Add to `src/app/settings-sections/integrations-section.test.tsx`:

```ts
describe("§408 — Turso test connection", () => {
  it("reports success in transient state and stores nothing", async () => {
    const onChange = vi.fn();
    vi.mocked(testTursoConnection).mockResolvedValueOnce(undefined);
    renderIntegrations({
      turso: { enabled: true, databaseUrl: "libsql://db.example.invalid", authToken: "fake" },
      onChange,
    });
    await userEvent.click(screen.getByRole("button", { name: t("en-US", "integrationsTursoTest") }));
    expect(await screen.findByText(t("en-US", "integrationsTursoTestOk"))).toBeInTheDocument();
    // ★ The whole point of the transient shape: a probe must not write settings.
    expect(onChange).not.toHaveBeenCalled();
  });

  it("reports the failure message when the probe rejects", async () => {
    vi.mocked(testTursoConnection).mockRejectedValueOnce(new Error("storage-unreachable"));
    renderIntegrations({
      turso: { enabled: true, databaseUrl: "libsql://db.example.invalid", authToken: "fake" },
    });
    await userEvent.click(screen.getByRole("button", { name: t("en-US", "integrationsTursoTest") }));
    expect(
      await screen.findByText(t("en-US", "integrationsTursoTestFail", "storage-unreachable")),
    ).toBeInTheDocument();
  });

  it("disables the button while a probe is in flight", async () => {
    let release: (() => void) | undefined;
    vi.mocked(testTursoConnection).mockReturnValueOnce(
      new Promise<void>((res) => {
        release = res;
      }),
    );
    renderIntegrations({
      turso: { enabled: true, databaseUrl: "libsql://db.example.invalid", authToken: "fake" },
    });
    const btn = screen.getByRole("button", { name: t("en-US", "integrationsTursoTest") });
    await userEvent.click(btn);
    expect(btn).toBeDisabled();
    release?.();
    await waitFor(() => expect(btn).toBeEnabled());
  });
});
```

Add `vi.mock("../turso-pipeline", ...)` at the top of the file if it does not already mock that module, preserving its other exports with `importActual`.

- [ ] **Step 6: Run to verify it fails**

Expected: no button with that name exists yet.

- [ ] **Step 7: Add the button**

Edit `src/app/settings-sections/integrations-section.tsx`. Add state near the file's other Turso `useState` declarations:

```tsx
  const [tursoTesting, setTursoTesting] = useState(false);
  // ★ TRANSIENT BY DESIGN — resets on reload, exactly like the Jira and
  // Timelog test results. Persisting it would be a new Settings field and
  // therefore the six-write-paths case (open-followups §408).
  const [tursoTestResult, setTursoTestResult] = useState<string | null>(null);

  async function runTursoTest() {
    setTursoTesting(true);
    setTursoTestResult(null);
    try {
      await testTursoConnection(getTursoConfig(turso.databaseUrl, turso.authToken));
      setTursoTestResult(t(lang, "integrationsTursoTestOk"));
    } catch (e) {
      // ★ The message, never the config — a thrown error here must not carry
      // the URL or token into the DOM.
      setTursoTestResult(
        t(lang, "integrationsTursoTestFail", e instanceof Error ? e.message : "unknown"),
      );
    } finally {
      setTursoTesting(false);
    }
  }
```

Then render the button immediately after the token block, inside the same `{turso.enabled && (...)}` container. Find the closing of the passphrase block and add before the container's close:

```tsx
          <button
            type="button"
            onClick={() => void runTursoTest()}
            disabled={tursoTesting || !tursoConfigured}
            className={`self-start rounded-md border border-line bg-surface px-3 py-1 text-xs font-medium text-ui-dark-blue disabled:cursor-not-allowed disabled:opacity-50 dark:text-ui-light-grey ${INTERACTIVE}`}
          >
            {t(lang, "integrationsTursoTest")}
          </button>
          {tursoTestResult && (
            <p className="text-xs text-muted-foreground">{tursoTestResult}</p>
          )}
```

★★ **`INTERACTIVE` is NOT imported in this file today — you must add the import.** It is exported from `interaction-styles`, which from `settings-sections/` is one directory up:

```tsx
import { INTERACTIVE } from "../interaction-styles";
```

`timelog-settings.tsx:18` is the reference (`import { FOCUS_RING, INTERACTIVE } from "./interaction-styles";`) — note the different relative depth. Verify after editing:

```bash
grep -n "interaction-styles" src/app/settings-sections/integrations-section.tsx   # expect 1 hit
```

★ `tursoConfigured` already exists at `:268`, and `FieldNotice` is already imported at `:7` — neither needs adding.

- [ ] **Step 8: Run both test files**

```bash
SP="$CLAUDE_SCRATCHPAD"
npx vitest run src/app/turso-pipeline.test.ts src/app/settings-sections/integrations-section.test.tsx > "$SP/t4c.log" 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests |Errors" "$SP/t4c.log"
```

Expected: `EXIT=0`, no `Errors`. Record the count.

- [ ] **Step 9: Mutation-prove the transient assertion**

Apply the mutant: make `runTursoTest`'s success branch also call `onChange` (e.g. `updateTurso({})`). Expected: **the "stores nothing" case fails.** Record `N failed / M passed`; confirm the sum. Revert with an inverse anchored Edit and an empty scoped diff.

- [ ] **Step 10: Gates and commit**

```bash
SP="$CLAUDE_SCRATCHPAD"
npx tsc --noEmit > "$SP/t4tsc.log" 2>&1; echo "TSC_EXIT=$?"
npx eslint --max-warnings=0 src/app/turso-pipeline.ts src/app/turso-pipeline.test.ts src/app/settings-sections/integrations-section.tsx src/app/settings-sections/integrations-section.test.tsx; echo "LINT_EXIT=$?"
```

```bash
git commit --only src/app/turso-pipeline.ts src/app/turso-pipeline.test.ts src/app/settings-sections/integrations-section.tsx src/app/settings-sections/integrations-section.test.tsx -F - <<'MSGEOF'
feat(settings): a Turso "Test connection" button, at parity with Jira/Timelog

§408, the parity half. testTursoConnection round-trips SELECT 1 through the
existing runTursoPipeline, which already discriminates the three outcomes a
result message needs: unreachable, token rejected, and any other status.

The result lives in transient component state and resets on reload, exactly
as the Jira and Timelog test results do. A persisted "confirmed" flag would
be a new Settings field and therefore the six-write-paths case, which is why
this shape was chosen and why a test pins that nothing is written.

The probe sits in turso-pipeline.ts rather than a new module because a new
.ts file is coverage-gated and would raise the per-engine floors.

What this does NOT close: canMoveToTurso and the two panels' tursoConfigured
still gate on the shape check, so a present-but-wrong credential pair still
yields an enabled control. §408 stays open for that half.

Claude-Session: https://[session link removed]
MSGEOF
```

- [ ] **Step 11: Closing check**

```bash
git diff HEAD --stat -- src/app/turso-pipeline.ts src/app/turso-pipeline.test.ts src/app/settings-sections/integrations-section.tsx src/app/settings-sections/integrations-section.test.tsx   # expect NO OUTPUT
git show --stat HEAD
```

---

## Task 5: §409 — collapsing the body must not commit a draft

**Files:**
- Modify: `src/app/documents-panel.tsx:747`
- Test: `src/app/documents-panel.test.tsx`

Read spec §3. `useBlockDraft` flushes a dirty draft on **any** unmount, so `{!bodyCollapsed && (…)}` turns a gesture whose own comment says "nothing persists it" into a write that can mint a `DocVersion`.

- [ ] **Step 1: Write the failing test**

Add to `src/app/documents-panel.test.tsx`, mirroring the existing "flushes a pending unblurred edit to the OLD document on a switch, never the new one" test's setup:

```ts
it("collapsing the body does NOT commit a pending unblurred edit", async () => {
  const onMutate = vi.fn();
  renderDocumentsPanel({ documents: [docWithOneParagraph], onMutate, editing: true });

  const editor = screen.getByRole("textbox", { name: /paragraph/i });
  await userEvent.click(editor);
  await userEvent.type(editor, " dirty");

  // Collapse by re-clicking the open document's name.
  await userEvent.click(screen.getByRole("button", { name: docWithOneParagraph.title }));

  // ★ THE ASSERTION THAT MAKES THIS TEST NON-VACUOUS. Without it the test
  // passes under BOTH `hidden` and the old conditional render.
  expect(onMutate).not.toHaveBeenCalled();
});

it("the draft survives a collapse/expand round trip", async () => {
  renderDocumentsPanel({ documents: [docWithOneParagraph], editing: true });
  const editor = screen.getByRole("textbox", { name: /paragraph/i });
  await userEvent.click(editor);
  await userEvent.type(editor, " dirty");

  const nameBtn = screen.getByRole("button", { name: docWithOneParagraph.title });
  await userEvent.click(nameBtn); // collapse
  await userEvent.click(nameBtn); // expand

  expect(screen.getByRole("textbox", { name: /paragraph/i })).toHaveTextContent("dirty");
});
```

Use the file's real render helper, document fixture and mutation-spy names — the ones above are placeholders for whatever that file already calls them, and the plan expects you to read it first.

- [ ] **Step 2: Run to verify it fails**

```bash
SP="$CLAUDE_SCRATCHPAD"
npx vitest run src/app/documents-panel.test.tsx > "$SP/t5a.log" 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests |Errors" "$SP/t5a.log"
```

Expected: the no-commit case fails — the unmount flushes today.

- [ ] **Step 3: Swap the conditional render for `hidden`**

Edit `src/app/documents-panel.tsx`. Find:

```tsx
        {!bodyCollapsed && (
          <DocumentEditModeBody lang={lang} doc={selected} ws={ws} editing={editing} narrow={narrowPane} isReadOnly={isReadOnly} onCommitBlock={commitBlock} structural={structural}
            assetsTursoConfig={assetPane?.tursoConfig ?? null} assetsProjectId={assetPane?.projectId} />
        )}
```

Replace with:

```tsx
        {/* ★★★ `hidden`, NEVER a conditional render. `useBlockDraft` flushes a
            dirty draft on ANY unmount, and that commit routes through
            `applyDocMutation` and can mint a DocVersion — so unmounting here
            made a gesture whose own comment says "nothing persists it" write
            persistent history (open-followups §409). Keeping the subtree
            mounted is what makes the gesture actually transient.
            ★★ Same shape as `panel-chat` / `panel-raid` in
            `workspace-section.tsx`, and it inherits that shape's inverted
            hazard: a fresh mount can no longer be relied on to clear anything,
            so `bodyCollapsed`'s reset above must keep firing on its own. */}
        <div hidden={bodyCollapsed}>
          <DocumentEditModeBody lang={lang} doc={selected} ws={ws} editing={editing} narrow={narrowPane} isReadOnly={isReadOnly} onCommitBlock={commitBlock} structural={structural}
            assetsTursoConfig={assetPane?.tursoConfig ?? null} assetsProjectId={assetPane?.projectId} />
        </div>
```

★ The wrapper carries **no** display class. A Tailwind `flex`/`grid` class on it would override the UA stylesheet's `[hidden] { display: none }` and the body would stay visible.

- [ ] **Step 4: Verify the reset still fires**

The render-time reconcile at `documents-panel.tsx:382` is the sole reset for `bodyCollapsed` and keys on `selected?.id`. Confirm the existing test covering it still passes, and if none exists, add:

```ts
it("expands the body again when the selection changes", async () => {
  renderDocumentsPanel({ documents: [docA, docB] });
  await userEvent.click(screen.getByRole("button", { name: docA.title })); // collapse docA
  await userEvent.click(screen.getByRole("button", { name: docB.title })); // select docB
  expect(screen.getByTestId("document-body")).not.toHaveAttribute("hidden");
});
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
SP="$CLAUDE_SCRATCHPAD"
npx vitest run src/app/documents-panel.test.tsx > "$SP/t5b.log" 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests |Errors" "$SP/t5b.log"
```

Expected: `EXIT=0`, no `Errors`. Record the runtime count.

- [ ] **Step 6: Mutation-prove against the conditional-render form**

★ This is the required mutant for this task. Revert the wrapper to `{!bodyCollapsed && (…)}` and re-run.

Expected: **the "does NOT commit a pending unblurred edit" case fails.** If it passes, the test is vacuous — it is not asserting on the absence of the commit, and you must fix the test before proceeding.

Record `N failed / M passed`; confirm the sum equals Step 5's count. Restore `hidden` with an inverse anchored Edit and finish on an empty scoped diff.

- [ ] **Step 7: Gates and commit**

```bash
SP="$CLAUDE_SCRATCHPAD"
npx tsc --noEmit > "$SP/t5tsc.log" 2>&1; echo "TSC_EXIT=$?"
npx eslint --max-warnings=0 src/app/documents-panel.tsx src/app/documents-panel.test.tsx; echo "LINT_EXIT=$?"
```

```bash
git commit --only src/app/documents-panel.tsx src/app/documents-panel.test.tsx -F - <<'MSGEOF'
fix(documents): collapsing the body no longer commits a pending edit

§409. bodyCollapsed wrapped DocumentEditModeBody in a conditional render, so
toggling it unmounted the editor subtree. useBlockDraft flushes a dirty,
unblurred draft on ANY unmount, and that commit routes through
applyDocMutation and can mint a DocVersion — from a gesture whose own comment
says "collapsing is a momentary 'give me room' gesture ... Nothing persists
it."

Hiding instead of unmounting makes that true. Same shape as panel-chat and
panel-raid in workspace-section.tsx, and the wrapper deliberately carries no
display class so [hidden] is not overridden.

This was never data loss — the edit was written, not discarded — so it is a
product correction, not a loss fix. The new test is mutation-proved against
the conditional-render form; without the "not called" assertion it passes
under both shapes.

Claude-Session: https://[session link removed]
MSGEOF
```

- [ ] **Step 8: Closing check**

```bash
git diff HEAD --stat -- src/app/documents-panel.tsx src/app/documents-panel.test.tsx   # expect NO OUTPUT
git show --stat HEAD
```

---

## Task 6: §407 — "1 change", not "1 changes"

**Files:**
- Modify: `src/app/task-row.tsx:282-304` (hoist) and `:374-382` (badge)
- Modify: `src/app/task-kanban-card.tsx:90-93`
- Test: `src/app/task-row.test.tsx`

★★★ **Do NOT build a `pluralize()` helper.** Spec §4 carries the full refutation — a two-fragment API cannot express the German singulars, which re-word noun, adjective and verb together. Use the house `*One` idiom. Re-proposing the helper is a regression.

Worked example of the idiom: `src/app/documents-history-modal.tsx:355-358`.

- [ ] **Step 1: Write the failing tests**

Add to `src/app/task-row.test.tsx`:

```ts
it("renders the singular changes badge for exactly one linked change", () => {
  renderTaskRow({ changeRefs: [changeA] });
  const badge = screen.getByLabelText(t("en-US", "taskRowChangesBadgeOne"));
  expect(badge).toHaveTextContent("1 change");
  expect(badge).not.toHaveTextContent("1 changes");
});

it("renders the plural changes badge for two linked changes", () => {
  renderTaskRow({ changeRefs: [changeA, changeB] });
  expect(
    screen.getByLabelText(t("en-US", "taskRowChangesBadge", 2)),
  ).toHaveTextContent("2 changes");
});

// ★ An EN-only assertion cannot pin this: German needs "1 Änderung", whose
// stem differs from the plural "Änderungen", so the DE branch is where a
// suffix-drop assumption would break.
it("renders the German singular", async () => {
  await loadI18n("de");
  renderTaskRow({ changeRefs: [changeA], lang: "de" });
  expect(screen.getByLabelText("1 Änderung")).toBeInTheDocument();
});
```

`loadI18n("de")` must be awaited before any DE assertion — the DE dictionary is lazy.

- [ ] **Step 2: Run to verify they fail**

Expected: the singular cases fail with "1 changes" / "1 Änderungen".

- [ ] **Step 3: Hoist the label in `task-row.tsx`**

Edit `src/app/task-row.tsx`. Anchor on the unique `const label = isTaskDelivered(task)` block (assert uniqueness first with `grep -c "const label = isTaskDelivered" src/app/task-row.tsx` → expect 1). Find:

```tsx
  const label = isTaskDelivered(task)
    ? t(lang, "completedOn", task.completedDate!)
    : formatHealthTooltip(health, lang);
```

Replace with:

```tsx
  const label = isTaskDelivered(task)
    ? t(lang, "completedOn", task.completedDate!)
    : formatHealthTooltip(health, lang);

  // ★ Hoisted because the badge below uses it three times (title, aria-label,
  // visible text) and all three must agree — WCAG 2.5.3 needs the accessible
  // name to CONTAIN the visible text, which one shared string guarantees by
  // construction. The `*One` sibling is the house idiom, not a helper: German
  // re-words noun, adjective and verb together, so a singular is a different
  // sentence rather than a suffix swap (open-followups §407).
  const changesBadgeLabel =
    changeRefs && changeRefs.length === 1
      ? t(lang, "taskRowChangesBadgeOne")
      : t(lang, "taskRowChangesBadge", changeRefs?.length ?? 0);
```

- [ ] **Step 4: Use it at the three badge sites**

Find:

```tsx
          <span
            title={t(lang, "taskRowChangesBadge", changeRefs.length)}
            aria-label={t(lang, "taskRowChangesBadge", changeRefs.length)}
            className="ml-1 inline-flex items-center whitespace-nowrap rounded bg-ui-blue/15 px-1.5 py-0.5 text-[10px] font-medium text-ui-dark-blue dark:bg-ui-blue/20 dark:text-ui-light-grey"
          >
            {t(lang, "taskRowChangesBadge", changeRefs.length)}
          </span>
```

Replace with:

```tsx
          <span
            title={changesBadgeLabel}
            aria-label={changesBadgeLabel}
            className="ml-1 inline-flex items-center whitespace-nowrap rounded bg-ui-blue/15 px-1.5 py-0.5 text-[10px] font-medium text-ui-dark-blue dark:bg-ui-blue/20 dark:text-ui-light-grey"
          >
            {changesBadgeLabel}
          </span>
```

- [ ] **Step 5: Branch the Kanban card**

Edit `src/app/task-kanban-card.tsx`. Find:

```tsx
  const changesLabel =
    changeRefs && changeRefs.length > 0
      ? t(lang, "taskRowChangesBadge", changeRefs.length)
      : "";
```

Replace with:

```tsx
  const changesLabel =
    changeRefs && changeRefs.length > 0
      ? changeRefs.length === 1
        ? t(lang, "taskRowChangesBadgeOne")
        : t(lang, "taskRowChangesBadge", changeRefs.length)
      : "";
```

- [ ] **Step 6: Run the tests to verify they pass**

```bash
SP="$CLAUDE_SCRATCHPAD"
npx vitest run src/app/task-row.test.tsx > "$SP/t6.log" 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests |Errors" "$SP/t6.log"
```

Expected: `EXIT=0`, no `Errors`. Record the count.

- [ ] **Step 7: Mutation-prove the singular branch**

Apply the mutant: change `changeRefs.length === 1` to `changeRefs.length === 0` in `task-row.tsx`. Expected: **both singular cases fail** (EN and DE). Record `N failed / M passed`; confirm the sum. Revert with an inverse anchored Edit.

- [ ] **Step 8: Gates and commit**

```bash
SP="$CLAUDE_SCRATCHPAD"
npx tsc --noEmit > "$SP/t6tsc.log" 2>&1; echo "TSC_EXIT=$?"
npx eslint --max-warnings=0 src/app/task-row.tsx src/app/task-kanban-card.tsx src/app/task-row.test.tsx; echo "LINT_EXIT=$?"
```

```bash
git commit --only src/app/task-row.tsx src/app/task-kanban-card.tsx src/app/task-row.test.tsx -F - <<'MSGEOF'
fix(tasks): the changes badge reads "1 change", not "1 changes"

§407, the named instance. Both languages were wrong at count 1 — EN
"1 changes", DE "1 Änderungen" where the singular is "1 Änderung".

Uses the house *One idiom (a singular sibling key plus a count === 1 ternary
at the call site), which is live at nine keys today, rather than a
pluralize(lang, count, one, other) helper. A two-fragment API cannot express
the German singulars: German re-words noun, adjective and verb together, so a
singular is a different sentence, not a suffix swap. The spec carries the
full argument.

The label is hoisted in task-row.tsx because the badge uses it three times
and WCAG 2.5.3 needs the accessible name to contain the visible text — one
shared string guarantees that by construction.

§407 stays OPEN for the remaining 45 keys in the class, filed separately.

Claude-Session: https://[session link removed]
MSGEOF
```

- [ ] **Step 9: Closing check**

```bash
git diff HEAD --stat -- src/app/task-row.tsx src/app/task-kanban-card.tsx src/app/task-row.test.tsx   # expect NO OUTPUT
git show --stat HEAD
```

---

## Task 7: §414 — the owed eye-verify, as a measuring spec

**Files:**
- Create: `e2e/control-defects-eye-verify.spec.ts`

Read spec §5. This runs **after** Task 5, because item 4 measures the post-`hidden` reflow.

★★ **Measure, do not look.** A native tooltip's *rendering* is browser chrome and is unobservable. The **hit-test** that decides whether a hover ever reaches the `title`-carrying wrapper is observable, and it is the mechanism item 1 actually doubts.

- [ ] **Step 1: Start a fresh isolated server**

```bash
PORT=3100 npm run dev
```

★ **Never** point this at the long-running server on port 3000. Stop it afterwards with `PORT=3100 npm run stop` — port-scoped, never a blanket `taskkill /IM node.exe`.

- [ ] **Step 2: Write the spec**

Create `e2e/control-defects-eye-verify.spec.ts`:

```ts
import { test, expect } from "@playwright/test";
import { seedWorkspace } from "./seed";

// ★★ THIS SPEC EXISTS BECAUSE NOTHING ELSE CAN SEE ITS SUBJECTS. jsdom has no
// layout and renders no native title tooltip; the axe gate omits Projects and
// Knowledge from A11Y_VIEWS entirely and has no rule for the rest.
// open-followups §414 is the owed-work record.

test.describe("§414 item 1 — the disabled Turso hint is reachable by pointer", () => {
  // ★★★ THE HIGHEST-VALUE ITEM. Three buttons hang their hint on a wrapping
  // <span title=...> and rely on `disabled:pointer-events-none` so the hit
  // test falls through to the wrapper. If it does not, three commits deliver
  // materially less than they claim while their unit tests stay green.
  // We assert the HIT TEST, not the tooltip: the browser painting a tooltip is
  // chrome and unobservable, but which element receives the pointer is not.
  for (const surface of ["projects-panel", "project-empty-state"] as const) {
    test(`${surface}: elementFromPoint reaches a title carrier`, async ({ page }) => {
      await seedWorkspace(page);
      await page.goto(`/#${surface === "projects-panel" ? "projects" : ""}`);

      const buttons = page.locator("button:disabled", { hasText: /Turso/i });
      const count = await buttons.count();
      // ★ A zero-button run would pass every assertion below vacuously.
      expect(count).toBeGreaterThan(0);

      for (let i = 0; i < count; i++) {
        const box = await buttons.nth(i).boundingBox();
        expect(box).not.toBeNull();
        const reaches = await page.evaluate(
          ({ x, y }) => {
            const el = document.elementFromPoint(x, y);
            let node: Element | null = el;
            while (node) {
              const t = node.getAttribute("title");
              if (t && t.trim() !== "") return t;
              node = node.parentElement;
            }
            return null;
          },
          { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 },
        );
        expect(reaches, `disabled Turso button ${i} on ${surface}`).not.toBeNull();
      }
    });
  }
});

test("§414 item 2 — the Ask-Claude glyph sits inside its cell", async ({ page }) => {
  await seedWorkspace(page);
  await page.goto("/#open-points");
  const cell = page.locator("tbody tr").first().locator("td").first();
  const glyph = cell.locator("svg").first();
  const cellBox = await cell.boundingBox();
  const glyphBox = await glyph.boundingBox();
  expect(cellBox).not.toBeNull();
  expect(glyphBox).not.toBeNull();
  expect(glyphBox!.x).toBeGreaterThanOrEqual(cellBox!.x - 0.5);
  expect(glyphBox!.x + glyphBox!.width).toBeLessThanOrEqual(cellBox!.x + cellBox!.width + 0.5);
});

test("§414 item 3 — the ID-column badge run does not wrap", async ({ page }) => {
  await seedWorkspace(page);
  await page.goto("/#open-points");
  const idCell = page.locator("tbody tr").first().locator("td").nth(1);
  const badges = idCell.locator("span[title]");
  const n = await badges.count();
  expect(n).toBeGreaterThan(0);
  const tops = await badges.evaluateAll((els) =>
    els.map((e) => Math.round(e.getBoundingClientRect().top)),
  );
  // All badges share a line => no wrapping inside the ID column.
  expect(new Set(tops).size).toBe(1);
});

test("§414 item 4 — the document body collapses and the panel reflows", async ({ page }) => {
  await seedWorkspace(page);
  await page.goto("/#documents");
  const name = page.getByRole("button", { name: /Kickoff/i }).first();
  await name.click();
  const body = page.locator("[hidden] >> nth=0");
  await name.click(); // collapse
  await expect(body).toBeHidden();
  await name.click(); // expand
  await expect(page.locator("[data-block-row]").first()).toBeVisible();
});
```

★ Items 5 (Knowledge picker keyboard) and 6 (asset name preview) need a Turso-backed seed, which `e2e/seed.ts` does not provide — it seeds FILE mode. Record them in the Step 5 findings as **not covered by this spec and still owed**, rather than writing a test that cannot mount the control.

- [ ] **Step 3: List the spec to prove it loads**

```bash
npx playwright test e2e/control-defects-eye-verify.spec.ts --list
```

Expected: the tests enumerate. This also proves `e2e/seed.ts`'s module-level sample read still resolves.

- [ ] **Step 4: Run it, serially**

```bash
SP="$CLAUDE_SCRATCHPAD"
npx playwright test e2e/control-defects-eye-verify.spec.ts --project=chromium --workers=1 > "$SP/eye.log" 2>&1; echo "EXIT=$?"
tail -30 "$SP/eye.log"
```

★★ `--workers=1` is required. `playwright.config.ts` sets `workers: CI ? 1 : undefined`, so a local run goes to CPU count and over-subscription produces `Test timeout of 60000ms exceeded` failures that name no rule and print no violation — a green branch recorded as red.

★ Item 1 must also be run under Firefox, because it depends on each browser's own `title` lookup walking up from a disabled child:

```bash
npx playwright test e2e/control-defects-eye-verify.spec.ts --project=firefox --workers=1 -g "item 1"
```

- [ ] **Step 5: File what it finds — do NOT fix inline**

For each failing assertion, write a register entry in Task 8's batch. An eye-verify that turns into an unplanned fix round loses the slice's boundaries.

If everything passes, that is the finding: record it, and note explicitly that items 5 and 6 remain owed because the file-mode seed cannot mount their controls.

- [ ] **Step 6: Stop the isolated server**

```bash
PORT=3100 npm run stop
```

- [ ] **Step 7: Commit**

```bash
git add e2e/control-defects-eye-verify.spec.ts
git commit --only e2e/control-defects-eye-verify.spec.ts -F - <<'MSGEOF'
test(e2e): measure what the control-defects batch could only be looked at

§414, the owed verification, executed as measurement rather than inspection.

Item 1 is the one that mattered: three disabled Turso buttons hang their
explanatory hint on a wrapping span and rely on disabled:pointer-events-none
so the hit test falls through. A browser painting a tooltip is chrome and
unobservable, but which element receives the pointer is not — so the spec
asserts elementFromPoint reaches a title carrier, which is the mechanism the
entry actually doubted. Run under Firefox as well as Chromium, because it
depends on each browser's own title lookup walking up from a disabled child.

Items 2-4 compare bounding boxes for the clipping, wrapping and collapse
reflow questions. Item 4 runs against the post-§409 hidden shape.

Items 5 and 6 are NOT covered: both need a Turso-backed seed and e2e/seed.ts
seeds file mode, so the controls never mount. Recorded as still owed rather
than papered over with a test that cannot reach them.

Every assertion carries a non-vacuity guard — a zero-element run fails rather
than passing silently.

Claude-Session: https://[session link removed]
MSGEOF
```

- [ ] **Step 8: Closing check**

```bash
git diff HEAD --stat -- e2e/control-defects-eye-verify.spec.ts   # expect NO OUTPUT
git show --stat HEAD
```

---

## Task 8: Register — file the plural class, correct §185, close §284

**Files:**
- Modify: `docs/open-followups.md` (LF-only — do NOT let any tool re-line it)

- [ ] **Step 1: Derive the number to mint**

```bash
grep -oE "^## [0-9]+\." docs/open-followups.md | grep -oE "[0-9]+" | sort -n | tail -1
```

Mint **above** that number. A number is reserved only once it is on `origin/main`, but a duplicate heading inside one document is worse than a gap, so use the branch max.

- [ ] **Step 2: File the plural-agreement class**

Write the new entry with the call-site-verified content. Required elements:

- Title naming the CLASS, not the instance.
- `**Status:**` line with today's ISO date, citing the reproduce command.
- The counts: **423 placeholder-bearing keys → 46 TIER 1, 6 tier-1-by-shape but count-1 unreachable, 12 dead, 63 dodged with `(s)`, 296 count-safe.** DE also wrong in **45 of 46**.
- The asymmetry: `timelogTestOk` — DE "Benutzer" is invariant in the nominative plural, so **only EN is wrong**; fix that one EN-only.
- The full EN/DE/call-site table for the 45 remaining keys.
- The exclusions, with reasons: the 6 unreachable (`suggestSignalTeam` gated at TEAM_MID=3, `actionTaskWhyStale` at STALE_DAYS=14, `timelogThresholdNeeded` at MAX_HOURS_PER_DAY=24, `assetLibraryMaxPerDocument`=20, `tourStepCount`, `actionChangeAggTitle` — the last is the only one that could become reachable, via an overridable `input.scopePendingRed`), and the 12 dead.
- ★★ **BOTH grep traps**, because each produces a wrong answer that looks right:

```
★★ A single-line call-site grep reports `documentsVersionBlocks` and
`documentsCardRemoved` as broken. They are NOT — both already have `*One`
siblings, but the `=== 1 ?` guard sits on the line ABOVE the matched line
(`documents-history-modal.tsx:356-358`, `chat-tool-block.tsx:284-286`).
Re-scan any candidate with ±5 lines of context; that correction alone moved
the count 48 → 46.

★★ A bare-identifier grep over-reports liveness: `activityCount` matches a
local variable in `dashboard-panel.tsx` and a backticked mention in a comment,
while the i18n key itself is dead. Strip comments and match the QUOTED key
form; that moved the dead count 9 → 12.
```

- Record the mechanism decision as settled with its reason: **the house `*One` idiom, not a `pluralize()` helper** — a two-fragment API cannot express the German singulars. Note that roughly 15 of the 46 read better *reworded* than branched (`evmCoverage` → "estimates on {0} of {1} tasks", `chatProposalCount` → "{0} × write"), so the class is not uniformly mechanical.
- ★ Note the coupling: `storageTursoLeaveWarn` and `storageConvertConfirm` are selected by one `confirmKey` ternary at `use-storage-file-ops.ts:457` and share a positional arg list, so they must be branched together or the `t()` call sites diverge.

- [ ] **Step 3: Correct §185's stale mechanism sentence**

§185 says `capHtmlText`'s truncation branch returns `plainToHtml(text.slice(0, cut))`. It no longer does — §208 moved that into `degradeToPlain`, which now carries images across the flatten.

★ The entry's **user-visible claim** (all marks stripped on overflow) is still true, so **§185 stays OPEN**. Correct the body only. Do not add a CLOSED marker anywhere.

- [ ] **Step 4: Close §284**

§284 is titled "FIXED 2026-08-29, end-to-end proof DISCHARGED 2026-08-29" but carries no CLOSED marker, so every parser counts it open.

★ Closure is a **FOUR-place edit minimum**: the heading marker · the summary-table STATUS cell · the summary-table ANCHOR · the `**Status:**` witness line. Recent closures have taken five and six places — search the whole document for cross-references to §284 and update each. **A body line must never contain the word CLOSED.**

- [ ] **Step 5: Verify the file survived intact**

```bash
git ls-files --eol docs/open-followups.md     # expect i/lf w/lf
node -e "const s=require('fs').readFileSync('docs/open-followups.md','utf8');console.log('CR bytes:',(s.match(/\r/g)||[]).length)"
grep -c "<<<<<<<\|>>>>>>>" docs/open-followups.md    # expect 0
grep -oE "^## [0-9]+\." docs/open-followups.md | grep -oE "[0-9]+" | sort -n | uniq -d   # expect NO OUTPUT (no duplicate numbers)
```

- [ ] **Step 6: Run the register gates**

```bash
SP="$CLAUDE_SCRATCHPAD"
npm run followups:status:check > "$SP/fs.log" 2>&1; echo "EXIT=$?"
tail -5 "$SP/fs.log"
npm run docs:claims:check > "$SP/dc.log" 2>&1; echo "EXIT=$?"
tail -3 "$SP/dc.log"
```

Expected: both `EXIT=0`. ★ `followups:status:check` exits **1 for drift** (a missing Status line) and **2 when it cannot scan at all** — the two demand opposite responses, so read the log rather than just the code. ★ `never machine-verified` is a CONFORMING Status answer and is the honest one for anything nobody has probed; do not invent a verification to satisfy a red run.

- [ ] **Step 7: Commit**

```bash
git commit --only docs/open-followups.md -F - <<'MSGEOF'
docs(followups): file the plural-agreement class, correct §185, close §284

Files the class §407 named one instance of: 423 placeholder-bearing keys in
i18n.ts split 46 TIER 1 / 6 unreachable / 12 dead / 63 dodged / 296
count-safe, with DE also wrong in 45 of the 46. The lone asymmetry is
timelogTestOk, where DE "Benutzer" is invariant and only EN is wrong.

Carries both grep traps, because each gives a wrong answer that reads as
right: a single-line call-site grep reports documentsVersionBlocks and
documentsCardRemoved as broken (their "=== 1 ?" guard sits on the line
ABOVE the match — that correction moved the count 48 -> 46), and a bare
identifier grep over-reports liveness (activityCount matches a local
variable and a comment while the key is dead — 9 -> 12).

Records the mechanism as settled: the house *One idiom, not a pluralize()
helper, because a two-fragment API cannot express the German singulars.

§185's mechanism sentence described code §208 moved into degradeToPlain. Its
user-visible claim still holds, so only the body is corrected and the entry
stays OPEN. §284 was titled FIXED with no CLOSED marker, so every parser
counted it open; closed as bookkeeping.

Claude-Session: https://[session link removed]
MSGEOF
```

- [ ] **Step 8: Closing check**

```bash
git diff HEAD --stat -- docs/open-followups.md   # expect NO OUTPUT
git show --stat HEAD
```

---

## Task 9: Full-suite verification

Run once, after every other task. **Do not run two vitest processes at once.**

- [ ] **Step 1: Typecheck**

```bash
SP="$CLAUDE_SCRATCHPAD"
npx tsc --noEmit > "$SP/final-tsc.log" 2>&1; echo "EXIT=$?"
```

Expected: `EXIT=0`. It exits **2** on diagnostics.

- [ ] **Step 2: Lint every touched file**

```bash
npx eslint --max-warnings=0 \
  src/app/i18n.ts src/app/i18n.de.ts \
  src/app/turso-config.ts src/app/turso-config.test.ts \
  src/app/turso-pipeline.ts src/app/turso-pipeline.test.ts \
  src/app/settings-sections/integrations-section.tsx src/app/settings-sections/integrations-section.test.tsx \
  src/app/documents-panel.tsx src/app/documents-panel.test.tsx \
  src/app/task-row.tsx src/app/task-kanban-card.tsx src/app/task-row.test.tsx \
  e2e/control-defects-eye-verify.spec.ts
echo "EXIT=$?"
```

- [ ] **Step 3: Full unit suite**

```bash
SP="$CLAUDE_SCRATCHPAD"
npm run test:run > "$SP/final-suite.log" 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests |Errors" "$SP/final-suite.log"
```

Expected: `EXIT=0` and **no `Errors` line**.

- [ ] **Step 4: Shuffled suite — new tests were added, so this is required**

```bash
SP="$CLAUDE_SCRATCHPAD"
npm run test:shuffle > "$SP/final-shuffle.log" 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests |Errors" "$SP/final-shuffle.log"
```

This is the only local reproduction of the `unit-tests-shuffled` CI gate, and it catches intra-file order dependence, not just cross-file leakage.

- [ ] **Step 5: Size ratchet**

```bash
SP="$CLAUDE_SCRATCHPAD"
npm run size:check > "$SP/final-size.log" 2>&1; echo "EXIT=$?"
```

★ **NEVER run `node scripts/check-file-sizes.mjs --update`**, even though the gate's own failure message recommends it — it discards the baseline doubling and deletes rows.

- [ ] **Step 6: Register and doc gates**

```bash
SP="$CLAUDE_SCRATCHPAD"
npm run followups:status:check > "$SP/final-fs.log" 2>&1; echo "EXIT=$?"
npm run docs:claims:check > "$SP/final-dc.log" 2>&1; echo "EXIT=$?"
npm run docs:symbols:check > "$SP/final-ds.log" 2>&1; echo "EXIT=$?"
```

- [ ] **Step 7: Report, do not release**

Report the tallies. **Do not push, do not open an MR, do not bump the version** — the slice ships separately on explicit say.

---

## Self-review notes

**Spec coverage.** §337 → Tasks 2 (resolver) + 3 (UI). §408 → Task 4. §409 → Task 5. §407 → Tasks 1 + 6, with the class filed in Task 8. §414 → Task 7. The two bookkeeping corrections (§185, §284) → Task 8. i18n keys for all of the above → Task 1. Nothing in the spec is unimplemented.

**Deliberately out**, per the spec: §410–412 (the picker extraction — a refactor must not ride with four behaviour changes), §413 (already an accepted cost), cluster A (the peer slice's eleven entries).

**Three defects found in this plan's own recipes during self-review, and fixed.** Recorded because a plan's commands inherit none of the verification of its facts, and all three would have cost the implementer a cycle:

1. **`INTERACTIVE` is not imported in `integrations-section.tsx`.** Task 4's button code uses it, so the plan originally emitted an undefined variable. Task 4 now instructs the import explicitly, with the correct `../` depth — `timelog-settings.tsx` imports it as `./interaction-styles` from one level up, which is the easy thing to copy wrongly.
2. **`turso-pipeline.test.ts` has no `mockPipelineOk`/`mockPipelineStatus`/`mockPipelineNetworkError`.** Those names were invented. The real helpers are `stubFetch(impl)` at `:10` and `stubHangingFetch()` at `:14`, plus a shared `cfg` fixture at `:6`. Task 4's tests are rewritten against them.
3. **`StorageNotReadyError` carries a `hint` field.** The plan's first draft asserted `rejects.toThrow(/storage-unreachable/)`; the existing suite asserts `rejects.toMatchObject({ hint: "storage-unreachable" })`, and the message match would have failed.

**Known soft spots that remain, stated rather than hidden.** Task 3's and Task 5's test snippets use placeholder helper names (`renderIntegrations`, `renderDocumentsPanel`, `docWithOneParagraph`); the implementer must read each test file and use its real helpers — I did not verify those, unlike the three above. Task 7's selectors are written against the seeded fixture and will likely need adjusting to the real DOM; every assertion there carries a non-vacuity guard so a mis-aimed selector fails loudly instead of passing over an empty set.

**Verified while writing:** `FieldNotice` imported at `integrations-section.tsx:7`; `tursoConfigured` at `:268`; all four target test files exist; the `*One` idiom live at nine EN keys with `documents-history-modal.tsx:355-358` as the worked example; `workspace-section.tsx:358-362` and `:450` as the `hidden` precedent.
