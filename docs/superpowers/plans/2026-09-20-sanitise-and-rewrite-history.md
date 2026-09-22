# Sanitise the tree and rewrite history Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove every internal identifier from the working tree and from all history, strip the
session trailers, rewrite the commit identities, and remap the commit citations — ending with a
repository that could safely be made public, without making it public.

**Architecture:** Three phases. Phase A fixes the tree as ordinary reviewed commits with tests,
because the fixture and product changes need a test suite that a history-rewriting tool cannot
run. Phase A ends with the tip carrying **zero** identifier hits. Phase B runs one
`git filter-repo` pass over a throwaway clone to fix what only exists in old commits — blob text,
commit messages, author/committer/tagger identities. Phase C remaps the commit citations from the
rewrite's own commit map and verifies the result with scans that each carry a positive control.

**Tech Stack:** `git filter-repo` (Python, installed separately from git), Node scripts under
`scripts/`, vitest, the existing npm gate scripts.

**Spec:** `docs/superpowers/specs/2026-09-20-github-migration-phase1-design.md` — the source of
truth. Its "The seven classes", "Class 2 in detail", "Phase A", "The diff check" and
"Re-baseline 2026-09-21" sections override anything here that disagrees with them.

**Companion plan:** `docs/superpowers/plans/2026-09-20-brand-rename-and-settings-migration.md`
owns **every brand-trigram occurrence outside `docs/` and `CHANGELOG.md`** (the theme file
included), the Outlook category prefix and event body text, and the deletion of the dead
`CiStyle` member. Nothing here duplicates those. **It must be merged before this plan's history
rewrite task runs**, or the rewrite bakes the old brand spelling into history.

## Re-baselined 2026-09-21

The first version of this plan was written against a tree 119 commits older than release 1.13.0.
A read-only audit on 2026-09-21 found that 1.13.0 had half-shipped the old policy-link task (it
made the policy configurable but kept the employer values as built-in defaults), that four
protocol or outbound values had never been listed, that the tip was expected to reach Phase B
still carrying ~230 employer-name mentions, and that several counts and one whole task were
stale. Every number below that carries a date was re-measured that day; commit-derived counts
grow daily.

- **Old Task 1 (policy link) was stale** — the constant it edited no longer exists. Replaced by
  Task 1 (AI-usage policy: no built-in default, build variables only).
- **New:** Task 2 (export footer default), Task 3 (Timelog tenant default), Task 6 (class-7
  sweep), Task 8 (Electron `appId`), Task 9 (release URLs; the spec had the item, the plan had no
  task).
- **Old Task 5 (README badges) deleted** — the badges were already removed on 2026-09-14 (commit
  5109b5146). The README "Releases page" links fold into Task 9.
- **Fixtures:** 43 addresses across 5 local-parts (not 42), plus 8 employer company/organization
  field values, plus a 44th address in a unit test outside the fixture pipeline. Goldens now
  regenerate through `scripts/regen-golden-fixtures.ts`.
- **Guide:** also carries a copyright line naming the employer; there is a third generated copy
  (the ai-eval rolling-prompt baseline); `prebuild` runs the guide generator.
- **Rewrite:** 3 distinct identities in history (the author, two CI-bot identities that authored
  90 commits), not "90 identities"; 2 remote heads, not ~34; 5 remote tags that must be rewritten
  too; the tip diff must now be **empty**.
- **The substitution list and the leak gate's identifier list are never tracked.** The first
  version committed `replacements.txt`, which would have written every identifier back into the
  tip the rewrite had just cleaned.

## Ordering

- **Phase A may land as several MRs.** Tasks 1–5 are independent of each other. Task 6 follows
  them (it sweeps what they leave) and must not touch register entry 200; Task 7 owns that entry
  and follows Task 6, because it describes the outcome.
- **Tasks 8 and 9 are unblocked (2026-09-22):** the home is `sebastianmaute/aipm-cockpit`, the
  personal-account repository the app already links to — not an organisation. ★ Land Task 9 no
  earlier than the rest of Phase A: until the cut-over the new release link points at a private
  repository, which is no worse than today's internal link but no better either.
- **Task 10 (leak gate) lands LAST in Phase A** — it can only go green once Tasks 1–9 and the
  companion plan are merged.
- **Task 11 (history rewrite) waits for ALL of Phase A plus the companion plan**, merged on
  `main`, and for the preconditions listed in the task.

## Global Constraints

- **Cite symbols, never line numbers, in any doc or plan text.** `npm run docs:claims:check` is a
  ratchet that FAILS on a newly added `path:LINE` citation. This overrides the writing-plans
  template's `path:123-145` form.
- **Never write an identifier literally in tracked text** — not in code, tests, comments, docs,
  commit messages or MR descriptions. Describe it ("the employer name", "the internal GitLab
  host", "the Timelog tenant slug"). Tests use fictional stand-ins (`acme-corp.example`, `Globex`).
- **Never read an exit code through a pipe.** Redirect, echo `$?`, then read the file.
- **`src/app/*.ts(x)` are CRLF; `docs/`, `e2e/`, `scripts/` are LF.** Check `git ls-files --eol`
  before and after every file you touch. Never use `sed -i` — under Git Bash it re-lines a whole
  CRLF file to LF and `core.autocrlf=true` hides it from the diff.
- **Never edit `src/app/i18n.de.ts` with the Edit or Write tool** — it corrupts umlauts and curls
  quotes. Use a node utf8 write whose anchors match `\r\n`.
- **Never `git add -A` or `git add .`** — commit with `git commit --only <paths> -F <msgfile>`.
  Never `--amend`. Never a bare `git stash`. `git checkout --` and `git restore` are deny-blocked:
  revert a mutant by writing the original bytes back and proving `git diff --stat` empty.
- **Never open, print or stage any `.env*` file.** An untracked `.bak` file in this project holds
  a live credential.
- **One vitest process at a time**, scoped to files: `npx vitest run <file> --maxWorkers=1
  --reporter=dot`. Another session shares this machine.
- **Run `npx tsc --noEmit; echo "EXIT=$?"` after editing any test** — vitest never typechecks.
- **This plan does not make anything public and does not push to GitHub.** It also does not touch
  the GitLab project's settings.

## Review Focus

Failure modes the spec implies that no single task's happy path exercises. Each has a test or
check in the task that owns it.

1. **A scan that returns zero because it scanned nothing.** Every verification scan must be shown
   to return a specific nonzero count against the pre-rewrite clone before its zero is believed
   (Tasks 10, 12).
2. **Text replacement matching something nobody predicted.** A blind substitution over ~8,542
   commits can silently alter unrelated content; because Phase A leaves the tip clean, the
   old-tip↔new-tip TREE diff must be empty (Task 11).
3. **A citation remap that silently drops an unmappable entry**, passing a "do they all resolve?"
   check because the dropped one is no longer present to fail (Task 13).
4. **A golden-fixture regen that writes truncated fixtures over full ones and reports success.**
   This has happened in this repo before; compare fixture sizes, not exit codes (Task 4).
5. **A generated file silently reverting the fix** on the next regeneration, because the
   generated artifact was edited instead of its source (Task 5).
6. **An env-precedence test that cannot see the env.** A value read from `process.env` into a
   module-level constant is frozen at import, so `vi.stubEnv` in a test changes nothing and the
   test passes against either behaviour. Follow `ai-policy.ts`: read the env inside a function with
   an injectable `env` parameter (Tasks 1–3).
7. **A protocol value swept up as a mention.** A value written to or read back from something
   outside this repository changes behaviour no local test can see. Every such value is handled
   by its own task (Tasks 3, 8, and the companion plan) and never by the substitution list.

---

## Phase A — ordinary commits

### Task 1: AI-usage policy — no built-in default, build variables only

**Files:**
- Modify: `src/app/ai-policy.ts` (delete `DEFAULT_AI_POLICY_ORG` / `DEFAULT_AI_POLICY_URL`;
  `resolveAiPolicy`)
- Modify: `src/app/settings-sections/ai-policy-fields.tsx` (its `orgValue` fallback and its
  `builtinLinkDropped` note both key off the built-in)
- Modify: `src/app/chat-panel.tsx` (only if the consent screen's docstring still describes a
  built-in)
- Modify: `src/app/i18n.ts`, `src/app/i18n.de.ts` (`aiPolicyOrgHint`, `aiPolicyUrlNoBuiltin` name
  the employer; DE through a node utf8 write)
- Modify: `src/app/settings-types.ts` (the comment on the policy fields)
- Modify: `docs/security.md` (the `NEXT_PUBLIC_AI_POLICY_*` rows), `docs/AGENTS/ai-assistant.md`
  (its `resolveAiPolicy` paragraph)
- Test: `src/app/ai-policy.test.ts`, `src/app/chat-panel.test.tsx`,
  `src/app/settings-sections/ai-policy-fields.test.tsx`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `resolveAiPolicy(settings, env)` with precedence env → Settings → **nothing**. With
  neither set, `org` and `url` are both `null`, and the consent screen drops the policy block
  (its existing `hasPolicy` branch). Task 10's gate relies on the two constants being gone.

1.13.0 made the policy configurable (env `NEXT_PUBLIC_AI_POLICY_ORG`/`_URL`, then Settings
`ai.policyOrgName`/`ai.policyUrl`) but kept the employer name and its wiki URL as the built-in
fallback. The built-in URL is additionally gated on `org === DEFAULT_AI_POLICY_ORG`, a string
equality against the stored owner.

★★ **Decision for a stored owner equal to the old default.** A user who saved the owner field while
it showed the old default has that name stored as ordinary user data, with `policyUrl` usually
still `undefined`. Today that pair resolves to the built-in wiki link; after this task no code
knows the old name, so the pair resolves to `org = <stored name>`, `url = null` — and the consent
screen, which renders the owner only inside the policy block, shows **no policy step at all**.
That is the intended behaviour: a stored value is the user's, it is kept verbatim and shown in
Settings, and a policy step appears only once a link exists. It is **not** surprising on the
consent screen because nothing is rendered there; in Settings the link field shows empty with the
rewritten `aiPolicyUrlNoBuiltin` hint ("no link — the consent screen shows no policy step"). No
migration and no comparison against the old literal (keeping the literal in code to compare
against would itself be a leak). ★ The owner's own deployment keeps its current consent screen
only by setting both build variables — a deployment step outside this repository; say so in the
MR description.

- [ ] **Step 1: Read the current site.** `resolveAiPolicy` and `aiPolicyEnv` in
  `src/app/ai-policy.ts`, `AiPolicyFields` in `ai-policy-fields.tsx`, and `ConsentScreen` in
  `chat-panel.tsx`. List every reader of the two constants: `git grep -n "DEFAULT_AI_POLICY" -- src`.

- [ ] **Step 2: Write the failing tests.** In `ai-policy.test.ts`, following its existing style:

```ts
it("resolves to no policy when neither env nor Settings supplies one", () => {
  const p = resolveAiPolicy({}, { org: undefined, url: undefined });
  expect(p).toMatchObject({ org: null, url: null, orgFromEnv: false, urlFromEnv: false });
});

it("keeps a stored owner verbatim and gives it no link when none is stored", () => {
  // Stand-in for a stored owner equal to the retired built-in: no code may know that name.
  const p = resolveAiPolicy({ policyOrgName: "Globex" }, { org: undefined, url: undefined });
  expect(p.org).toBe("Globex");
  expect(p.url).toBeNull();
});

it("still honours both build variables", () => {
  const p = resolveAiPolicy({}, { org: "Globex", url: "https://globex.example/policy" });
  expect(p).toMatchObject({ org: "Globex", url: "https://globex.example/policy" });
});
```

  In `chat-panel.test.tsx`: with default settings and no env, the consent screen renders **no**
  policy link and **no** policy checkbox, and Accept is enabled — with a positive control that the
  consent screen itself rendered (its title heading), because a bare `queryByRole(...)).toBeNull()`
  also passes when nothing mounted. Replace every existing assertion that pins the old default.

- [ ] **Step 3: Run and watch them fail.**
  `npx vitest run src/app/ai-policy.test.ts --maxWorkers=1 --reporter=dot > /tmp/t.log 2>&1; echo "EXIT=$?"`
  — then the other two files, one at a time. Read the messages: the failures must be the old
  default appearing, not a render or import error.

- [ ] **Step 4: Implement.** Delete both constants; `org` falls back to `null` and `url` to `null`
  when neither env nor Settings supplies them. In `ai-policy-fields.tsx`, `orgValue` falls back to
  `""` and `builtinLinkDropped` becomes "no link stored and none from env". Rewrite
  `aiPolicyOrgHint` and `aiPolicyUrlNoBuiltin` in EN and DE without the employer name (keys keep
  their names; tsc enforces EN/DE parity). Rewrite the stale comments beside each edit.

- [ ] **Step 5: Document the build variables** in `docs/security.md`'s env-var table and in
  `docs/AGENTS/ai-assistant.md`: they are now the only way a deployment gets a policy step.

- [ ] **Step 6: Run the three test files, then tsc,** each unpiped, each 0.

- [ ] **Step 7: Mutation rows.** (a) Restore a non-null fallback for `org` (any literal) — predict
  RED on "resolves to no policy". (b) Make the consent screen render the policy block
  unconditionally — predict RED on the chat-panel absence test. Run each, confirm, revert by
  writing the original bytes back, prove `git diff --stat` empty. Report predicted vs actual.

- [ ] **Step 8: Positive control for the removal.**
  `git grep -c "DEFAULT_AI_POLICY" -- src; echo "EXIT=$?"` must print nothing with EXIT=1, while
  `git grep -c "resolveAiPolicy" -- src` is nonzero.

- [ ] **Step 9: Commit** the source, i18n, tests and both docs with `git commit --only`.

---

### Task 2: Export footer — neutral built-in plus a build variable

**Files:**
- Modify: `src/app/export-footer.ts` (`DEFAULT_EXPORT_FOOTER`, `NEUTRAL_EXPORT_FOOTER`,
  `exportFooterText`)
- Modify: every renderer taking the default as a default parameter — enumerate with
  `git grep -n "DEFAULT_EXPORT_FOOTER" -- src` (on 2026-09-21: `doc-render-html.ts`,
  `doc-render-pptx.ts`, `doc-render-pptx-slides.ts`, `export.ts`, `export-pptx.ts`,
  `ooxml-pptx-primitives.ts` for the PPTX colour-scheme name, `settings-types.ts` re-export,
  `settings-sections/appearance-section.tsx`)
- Modify: `src/app/i18n.ts`, `src/app/i18n.de.ts` (one new key: the "set by build variable" note,
  mirroring `aiPolicyOrgFromEnv`)
- Modify: `docs/security.md` (new env-var row)
- Test: `src/app/settings-types.test.ts`, `src/app/export.test.ts`, `src/app/export-ooxml.test.ts`,
  `src/app/doc-render-html.test.ts`, `src/app/doc-render-pptx.test.ts`,
  `src/app/settings-sections/appearance-section.test.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces: `exportFooterEnv()` and `exportFooterText(branding, env = exportFooterEnv())`, with
  precedence **env → Settings → built-in**, the built-in being the neutral `AI PM Cockpit`. New
  build variable: `NEXT_PUBLIC_EXPORT_FOOTER`.

The footer lands in HTML, print/PDF and PowerPoint exports and names the PPTX theme — an
OUTBOUND DISCLOSURE on every exported file. Its default names the employer.

★★ `DEFAULT_EXPORT_FOOTER` is used as a **default parameter value** in six renderers. A default
parameter is evaluated per call, so replacing it with a call to a resolver works; replacing it
with a module-level constant computed from `process.env` does not survive `vi.stubEnv` (Review
Focus 6). Once the built-in is neutral, `DEFAULT_EXPORT_FOOTER` and `NEUTRAL_EXPORT_FOOTER` are
the same string — collapse them into one constant rather than keeping two names for one value.

★ A user who once saved the footer field has their text stored as ordinary user data; nothing
compares it with anything, so it keeps rendering verbatim. No migration.

- [ ] **Step 1: Read `export-footer.ts` and `ai-policy.ts` side by side**; copy the env-injection
  shape, not a new one.

- [ ] **Step 2: Write the failing tests** in `settings-types.test.ts` (where `exportFooterText` is
  already pinned): never-set with no env → `AI PM Cockpit`; never-set with
  `{ footer: "Globex — Board pack" }` → that text; a stored value with env set → the env value
  (env wins, as in `ai-policy.ts`); blank env → ignored. In `appearance-section.test.tsx`: with the
  env set, the field shows the build-variable note instead of an editable input.

- [ ] **Step 3: Run them, watch them fail** for the stated reason.

- [ ] **Step 4: Implement,** then update the four export test files so none pins the old literal:
  `git grep -c "AI PM Cockpit" -- src/app/export.test.ts src/app/export-ooxml.test.ts
  src/app/doc-render-html.test.ts src/app/doc-render-pptx.test.ts` before and after, and assert the
  employer name is gone from them with the class-7 measure in Task 6 Step 1.

- [ ] **Step 5: Add the env-var row** to `docs/security.md`, beside the AI-policy rows.

- [ ] **Step 6: Run all six test files and tsc**, unpiped, each 0.

- [ ] **Step 7: Mutation rows.** (a) Make `exportFooterText` ignore `env` — predict RED on the
  env-wins test. (b) Turn the resolver into a module-level constant read at import — predict RED on
  the env tests (this is the Review Focus 6 trap; if it stays GREEN the test cannot see the env and
  must be fixed first). Revert each by original bytes; prove `git diff --stat` empty.

- [ ] **Step 8: Commit.**

---

### Task 3: Timelog tenant — build variable, empty built-in

**Files:**
- Modify: `src/app/timelog-types.ts` (`defaultTimelogConfig.tenant` and the comment on the
  `tenant` field, which quotes the slug)
- Modify: `src/app/timelog-sanitize.ts` (`sanitizeTimelogConfig` falls back to the default tenant)
- Modify: `src/app/timelog-panel.tsx` (`isMisconfigured` — see below)
- Modify: `docs/security.md` (new env-var row)
- Modify: the two Timelog docs that quote the slug —
  `docs/superpowers/plans/2026-06-23-timelog-integration.md` and
  `docs/superpowers/specs/2026-06-23-timelog-integration-design.md` (dated records: replace the
  slug with a description, never rewrite content)
- Test: `src/app/api/timelog/_helpers.test.ts`, `src/app/api/timelog/route.test.ts`,
  `src/app/timelog-api.test.ts`, `src/app/use-timelog-sync.test.ts` (all four carry the slug as a
  fixture value today), plus the sanitize and panel tests

**Interfaces:**
- Consumes: nothing.
- Produces: `defaultTimelogTenant(env = timelogEnv())` returning `NEXT_PUBLIC_TIMELOG_TENANT`
  trimmed, else `""`. New build variable: `NEXT_PUBLIC_TIMELOG_TENANT`.

PROTOCOL value: the tenant is sent to the Timelog API as a URL path segment (the proxy's request
builder in `api/timelog/_helpers.ts`) and persisted in `settings.timelog`. A stored tenant is
kept by `sanitizeTimelogConfig` (`str(o.tenant) || <default>`), so existing users keep working;
only a never-configured install changes.

★★ **Measured 2026-09-21 — an empty tenant is not handled today, because it has never been
possible.** The proxy's `parseCreds` rejects an empty tenant (returns `null`), but the panel's
`isMisconfigured` checks `enabled`, `host` and `apiToken` only — so after this change an install
with no tenant would pass the panel's gate and fail at the proxy. Verify that reading before
relying on it, then decide and pin: the expected fix is adding the tenant to `isMisconfigured`
so the panel shows its existing not-configured state instead of a failing request.

- [ ] **Step 1: Read the path end to end.** `defaultTimelogConfig`, `sanitizeTimelogConfig`,
  `isMisconfigured` in `TimelogPanel`, the tenant input in `timelog-settings.tsx`, and `parseCreds`
  in `api/timelog/_helpers.ts`. Write down what each does with `""`.

- [ ] **Step 2: Write the failing tests.** Sanitize: a raw config without a tenant and no env →
  `tenant: ""`; with `{ tenant: "acme" }` in the injected env → `"acme"`; a stored tenant with env
  set → the **stored** one (a stored protocol value is never overridden — this is the one place
  this task deliberately differs from Tasks 1–2; say why in a comment). Panel: enabled, host and
  token set, tenant `""` → the misconfigured state, with a positive control that the panel mounted.

- [ ] **Step 3: Run, watch them fail**, reading the messages.

- [ ] **Step 4: Implement**, then replace the slug in the four existing Timelog tests with a
  fictional tenant (`acme`). ★ Those tests pin URL construction; a replacement that changes the
  assertion and the input in step is only correct if both sides are the same fictional value.

- [ ] **Step 5: Edit the two dated Timelog docs** — replace the slug with "the tenant slug" and
  nothing else.

- [ ] **Step 6: Add the env-var row** to `docs/security.md`.

- [ ] **Step 7: Run every touched test file and tsc**, unpiped.

- [ ] **Step 8: Mutation rows.** (a) Drop the tenant from `isMisconfigured` — predict RED on the
  panel test. (b) Make sanitize prefer the env over a stored tenant — predict RED on the
  stored-wins test. Revert each; prove `git diff --stat` empty.

- [ ] **Step 9: Positive control.** The slug's count across the tree (measure with the leak list
  from Task 10's untracked file, or by hand without printing it) goes from 18 lines in 7 files on
  2026-09-21 to 0.

- [ ] **Step 10: Commit.**

---

### Task 4: Replace the identities in the sample fixtures

**Files:**
- Modify: `sample-workspace-small.json` (the hand-curated master, repo root)
- Regenerate: `sample-workspace-big.json`, `sample-workspace-huge.json` via
  `scripts/generate-sample-workspace.ts`
- Regenerate: `src/app/__fixtures__/golden-workspace.csv` and `golden-workspace.md` via
  `scripts/regen-golden-fixtures.ts`
- Modify: `src/app/project-form-fields.test.tsx` (one employer address, outside the pipeline)
- Test: `src/app/golden-workspace.test.ts` (byte-pinned; it goes green on the NEW bytes)

**Interfaces:**
- Consumes: nothing.
- Produces: fixture data containing no employer address and no employer company/organization
  value.

Measured 2026-09-21: the master carries **43** addresses at the employer's domain across **5**
`firstname.lastname` local-parts, plus **8** non-address employer values (`"company"` ×5,
`"organization"` ×3). A 44th address sits in `project-form-fields.test.tsx`. The rest of the
master is already neutralised (`example.sharepoint.com`, `example.atlassian.net`). Treat the
addresses as real personal data.

- [ ] **Step 1: Enumerate what you are changing,** without printing the values into any tracked
  file:

```bash
grep -oE '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]*consult[A-Za-z0-9.-]*' sample-workspace-small.json | wc -l          # 43
grep -oE '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]*consult' sample-workspace-small.json | sort -u | wc -l             # 5
grep -oiE '"(company|organization)": *"[^"]*consult[^"]*"' sample-workspace-small.json | sed -E 's/: *".*//' | sort | uniq -c   # 5 company, 3 organization
```

- [ ] **Step 2: Record the current fixture sizes** — the baseline for Step 7.

```bash
wc -c sample-workspace-small.json sample-workspace-big.json sample-workspace-huge.json src/app/__fixtures__/golden-workspace.csv src/app/__fixtures__/golden-workspace.md
```

- [ ] **Step 3: Edit the master only.** Replace each local-part with a fictional name at
  `example.com`, keeping five distinct people so the fixture's relationships still hold, and
  replace the 8 company/organization values with a fictional company. Do not hand-edit the
  scaled variants or the goldens.

- [ ] **Step 4: Regenerate the scaled variants.**
  `npx vite-node scripts/generate-sample-workspace.ts; echo "EXIT=$?"`

- [ ] **Step 5: Regenerate the goldens.** Read the header of `scripts/regen-golden-fixtures.ts`
  first — it installs a DOM and asserts a non-empty decode, because a bare run once wrote fixtures
  for a workspace of zero tasks and exited 0. Then
  `npx vite-node scripts/regen-golden-fixtures.ts; echo "EXIT=$?"`.

- [ ] **Step 6: Fix the unit test's address** in `project-form-fields.test.tsx` to `example.com`.

- [ ] **Step 7: Compare sizes, not exit codes.** Re-run Step 2's `wc -c`. ★★★ Each file must be
  within a few percent of its old size; a file that collapsed is a failed regen wearing a green
  exit code.

- [ ] **Step 8: Assert both kinds are gone, with a positive control.**

```bash
grep -c "@example.com" sample-workspace-small.json                               # positive control: nonzero, at least 43
git grep -ciE "consult" -- 'sample-workspace-*.json' src/app/__fixtures__ src/app/project-form-fields.test.tsx; echo "EXIT=$?"   # prints nothing, EXIT=1
```

  The second command covers addresses **and** the company/organization values, which the first
  version's address-only grep could not see.

- [ ] **Step 9: Run the byte-pinned test and the form test**, one at a time, unpiped. Expect PASS
  on the new bytes; a golden failure means the regen did not match the serializers.

- [ ] **Step 10: Commit** the master, both variants, both goldens and the unit test together — one
  logical change; a partial commit leaves the byte-pinned test red.

---

### Task 5: Fix the operating guide at its source, and regenerate both copies

**Files:**
- Modify: `lib/project-leadership-operating-guide.md` (the SOURCE)
- Regenerate: `src/app/operating-guide-builtin.generated.ts` via `scripts/gen-operating-guide.mjs`
- Regenerate: `docs/baselines/ai-eval-rolling-prompt.txt` (see Step 6)
- Test: `src/app/operating-guide-builtin.test.ts`, `scripts/ai-eval.test.ts`

**Interfaces:**
- Consumes: the copyright line `Copyright 2026 Sebastian Maute`, licence EUPL-1.2 (decided
  2026-09-22; publication rights confirmed 2026-09-21). The work address has no replacement
  mailbox: point the reader at the repository (`https://github.com/sebastianmaute/aipm-cockpit`)
  instead.
- Produces: guide content carrying no work address and no employer copyright line.

★★★ Both copies embed the guide verbatim. Editing a copy is the trap: the next regeneration
silently reverts it. Fix the markdown, then regenerate.

★ **"There is no npm script for this generator" is half-true.** No script invokes it by name, but
`prebuild` runs `node scripts/gen-operating-guide.mjs` on every `npm run build` — so an edited
generated file is reverted by the very next build, not just by a deliberate regen.

- [ ] **Step 1: Locate both findings in the source** (the address and the copyright line naming
  the employer as the legal entity):

```bash
grep -nE '[A-Za-z0-9._%+-]+@|©|[Cc]opyright' lib/project-leadership-operating-guide.md
```

- [ ] **Step 2: Baseline the three copies.**

```bash
git grep -ciE 'consult' -- lib/project-leadership-operating-guide.md src/app/operating-guide-builtin.generated.ts docs/baselines/ai-eval-rolling-prompt.txt
wc -c lib/project-leadership-operating-guide.md src/app/operating-guide-builtin.generated.ts docs/baselines/ai-eval-rolling-prompt.txt
```

  On 2026-09-21: 4, 1 and 1. All three must reach 0 while every file stays substantial.

- [ ] **Step 3: Edit the markdown source only.** Replace the address with a neutral contact
  instruction (point at the repository URL; no mailbox) and the copyright line with
  `Copyright 2026 Sebastian Maute` (EUPL-1.2).

- [ ] **Step 4: Regenerate the TS copy.** `node scripts/gen-operating-guide.mjs; echo "EXIT=$?"`

- [ ] **Step 5: Run the guide test**, unpiped.

- [ ] **Step 6: The eval baseline — decide before editing.** `ROLLING_PATH` in
  `scripts/ai-eval.ts` is the PREVIOUS live run's arm-A bytes, verbatim, and the runs log records
  a hash of it (`rollingWrittenHash`), which the harness checks before it will spend. Read that
  logic first. Determine whether a dry run (`npm run ai:eval`, spends nothing) rewrites the file;
  if only a live run does, do NOT hand-edit it silently — either run a live eval with the owner's
  consent, or hand-edit it AND update the recorded hash in the same commit, stating which in the
  commit message. Then run `scripts/ai-eval.test.ts`, unpiped.

- [ ] **Step 7: Re-run Step 2.** All three counts 0, all three sizes substantial (a generator that
  wrote an empty file also scores 0).

- [ ] **Step 8: Commit** the source and both regenerated copies together.

---

### Task 6: Sweep class 7 — the employer name, and the trigram inside `docs/` and `CHANGELOG.md`

**Files:**
- Modify: every remaining file the Step 1 measure reports, **except** register entry 200 (Task 7),
  the files Tasks 1–5 own, and the brand-trigram occurrences outside `docs/`/`CHANGELOG.md`
  (companion plan).
- Known groups on 2026-09-21 (about 230 employer-name mentions across roughly 60 files, before
  Tasks 1–5): the `timelog-*` tests using it as a customer name; export/pptx/html tests; i18n
  prose (DE through a node utf8 write); `src/app/version.ts` comments; `CHANGELOG.md`;
  `docs/**` including dated plans and specs; the stale `branding` comment in
  `src/app/settings-types.ts`.

**Interfaces:**
- Consumes: Tasks 1–5 merged (they own their files' mentions).
- Produces: a tip whose only remaining identifier hits are the ones Tasks 7–9 own.

- [ ] **Step 1: Measure, without printing the name.**

```bash
git grep -ciE "i ?c[- ]?consult" -- . | awk -F: '{n+=$2; f++} END{print n" lines in "f" files"}'
git grep -ciP '(?<![a-z0-9])<trigram>(?![a-z0-9])' -- docs CHANGELOG.md | awk -F: '{n+=$2; f++} END{print n" lines in "f" files"}'
```

  ★ The first regex also matches the employer's domain and the internal hosts; those lines belong
  to Tasks 4, 8 and 9 and to entry 200. Subtract them by file rather than editing them here.

- [ ] **Step 2: Classify each hit** before editing: a code/test **value** (a customer name in a
  Timelog fixture — replace with a fictional one, in input and assertion together), **prose** in a
  living doc (rewrite neutrally), or a **dated record** (plans, specs, CHANGELOG, register
  entries, `docs/security/findings-*` snapshots). ★★ Dated records get their *names* replaced —
  "the employer", "the brand" — and nothing else rewritten. ★★ Label the COMMENTS beside each hit
  too: the `branding` comment in `settings-types.ts` still says exports override "the default …
  logo + subtitle", while the sidebar default is now `/ai-pm-cockpit-banner.svg`; correct it in the
  same commit.

- [ ] **Step 3: Decide the literal-in-docs rule, once.** Default: **describe, never quote.** A doc
  that genuinely cannot avoid a literal keeps it on a line carrying one of the leak gate's absence
  markers (Task 10), and every such line is listed in this task's report. Expected count after
  this task: zero, because every record examined on 2026-09-21 reads correctly with a description.

- [ ] **Step 4: The GitLab project id.** A bare " (GitLab)" in prose (AGENTS.md,
  `docs/AGENTS/ci.md`, two `.gitlab-ci.yml` comments) discloses nothing without the host and is
  **not** in the identifier set; the set matches project-id URL paths (`projects/` plus the numeric id) only, which live in
  three docs (`docs/open-followups.md` among them). Rewrite those URLs. ★ `.gitlab-ci.yml` carries
  neither the host nor the employer name on 2026-09-21, and is retired with GitLab in sub-project
  3, so the leak gate gets **no** path exemption for it — if it ever gains an identifier, that is a
  real finding.

- [ ] **Step 5: Edit in batches by group,** running each touched test file and `tsc` after each
  code/test batch, and the doc gates after each doc batch:

```bash
npm run docs:claims:check; echo "EXIT=$?"
npm run docs:symbols:check; echo "EXIT=$?"
npm run followups:index:check; echo "EXIT=$?"
npm run followups:status:check; echo "EXIT=$?"
```

- [ ] **Step 6: Re-run Step 1.** Both counts must fall to exactly the lines Tasks 7–9 still own,
  listed by file. Positive control: `git grep -c "AI PM Cockpit" -- CHANGELOG.md` is still
  nonzero (the sweep did not blank the changelog).

- [ ] **Step 7: Commit per group** (tests, i18n, comments, docs, CHANGELOG), each with
  `git commit --only`.

---

### Task 7: Neutralise register entry 200's own quoting

**Files:**
- Modify: `docs/open-followups.md` (entry 200 only)

**Interfaces:**
- Consumes: Tasks 1–6 (the entry describes their outcome).
- Produces: an entry that quotes no identifier and so survives the history rewrite intact.

Entry 200 quotes the identifier strings it hunts, inside its own reproduce commands. The rewrite
replaces those strings everywhere, which would turn the entry into instructions to grep for the
replacement string — destroying the record of why the rewrite happened. Measured 2026-09-21 it is
also stale on its own terms: it still describes the retired policy constant, the removed README
badges and "42" addresses, and its reproduce block quotes a spelling of the employer name that
occurs nowhere else in the tree.

- [ ] **Step 1: Read the entry in full**, including its Status line and its reproduce block.

- [ ] **Step 2: Restate the reproduce commands** so they describe what to search for without
  spelling any identifier: point at `npm run leaks:check` (Task 10), which reads the concrete list
  from its untracked file, and name the pattern classes in prose ("the employer's domain", "the
  internal GitLab host"). The entry must still tell a reader exactly how to reproduce.

- [ ] **Step 3: Correct the stale content** — the policy constant (now `resolveAiPolicy`, with no
  built-in since Task 1), the badges (removed 2026-09-14), the fixture counts (43 + 8 + 1).

- [ ] **Step 4: Keep the Status line conforming.** `npm run followups:status:check` requires every
  OPEN entry to carry a `**Status:**` block with an ISO date and either a backticked command
  matching `grep|npm run|npx|node scripts` or the literal words `never machine-verified`.

- [ ] **Step 5: Run the register gates, unpiped.**

```bash
npm run followups:index:check; echo "EXIT=$?"
npm run followups:workitems:check; echo "EXIT=$?"
npm run followups:status:check; echo "EXIT=$?"
npm run docs:claims:check; echo "EXIT=$?"
```

  All four must be 0. ★ `followups:index:check` exit 2 means "could not scan" and is worse than
  exit 1 — report it loudly rather than retrying.

- [ ] **Step 6: Commit.** `git commit --only docs/open-followups.md -F <msgfile>`

---

### Task 8: Rename the Electron `appId`

**Files:**
- Modify: `desktop/electron-builder.yml` (`appId`)
- Modify: `docs/superpowers/plans/2026-09-10-electron-app-bundling.md` (the one other file that
  spells the value — a dated record: replace the name only)

**Interfaces:**
- Consumes: the decided value `io.github.sebastianmaute.aipm-cockpit` (2026-09-22).
- Produces: that `appId`.

PROTOCOL value: electron-builder derives the Windows installer identity and the taskbar
AppUserModelID from `appId`. Renaming it makes the next installer install a **second copy**
beside the old one rather than upgrading it. Decision (2026-09-21): rename anyway — only the
repository owner has an install, and removes the old copy by hand. ★★ That is a point-in-time
fact about the installed base; re-establish it before executing.

- [ ] **Step 1: Check what else keys off `appId`.** On 2026-09-21: nothing in `desktop/src` calls
  `setAppUserModelId`, registers a protocol handler, or derives a path from it; the single-instance
  lock is keyed by the app, and `userData` follows the product name, not `appId`. Re-verify:
  `git grep -nE "setAppUserModelId|setAsDefaultProtocolClient|app\.setName|userData|appId" -- desktop`.
  If anything now depends on it, stop and report.

- [ ] **Step 2: Rename** to `io.github.sebastianmaute.aipm-cockpit`.

- [ ] **Step 3: Replace the name in the dated bundling plan**, nothing else.

- [ ] **Step 4: Positive control.** The old value's count across the tree is 2 lines in 2 files on
  2026-09-21 and must reach 0, while `git grep -c "^appId:" desktop/electron-builder.yml` is 1.

- [ ] **Step 5: Verify on a packaged build** — the only local check that compiles the desktop main
  process is the manual desktop-package job. Record in the MR that the old install must be removed
  by hand.

- [ ] **Step 6: Commit.**

---

### Task 9: Repoint the release URLs and the README release links

**Files:**
- Modify: `src/app/version.ts` (`APP_RELEASES_URL`)
- Modify: `desktop/src/lib/constants.ts` (`RELEASES_URL`)
- Modify: `README.md` (the two "Releases page" links)
- Test: `desktop/src/lib/menu-model.test.ts` (binds the two constants by text comparison),
  `desktop/src/lib/constants.test.ts`, `desktop/src/lib/window-open-policy.test.ts`,
  `scripts/release-publish-lib.test.mjs`, `src/app/version-info.test.tsx`

**Interfaces:**
- Consumes: `https://github.com/sebastianmaute/aipm-cockpit/releases` (decided 2026-09-22).
- Produces: release links pointing at the GitHub releases page.

The app and the desktop shell cannot share a constant, so `menu-model.test.ts` reads
`version.ts` as TEXT and requires `RELEASES_URL` to equal the literal it finds after
`export const APP_RELEASES_URL =`. ★★ Keep that declaration's shape (a single double-quoted
literal after the `=`, whitespace allowed) or the regex misses and the binding test fails for the
wrong reason.

- [ ] **Step 1: Enumerate the internal host across the tree** without printing it — derive it
  from `git remote get-url origin` into a shell variable and `git grep -cF "$H" -- .`. On
  2026-09-21: 27 lines in 10 files; this task owns `version.ts`, `constants.ts`, the three desktop
  and script tests and README; the four docs belong to Task 6.

- [ ] **Step 2: Update the tests first** to expect the new URL, and watch them fail.
  `window-open-policy.test.ts` uses the internal host as an arbitrary external URL — replace it
  with a fictional one; the assertion is about "external", not about the host.

- [ ] **Step 3: Repoint both constants and the README links.** Update the docstring beside
  `APP_RELEASES_URL` and beside `RELEASES_URL` if either names the old host or its auth
  requirements.

- [ ] **Step 4: Run the five test files**, one at a time, unpiped, then `tsc`.

- [ ] **Step 5: Mutation row.** Change only `RELEASES_URL` — predict RED on the binding test in
  `menu-model.test.ts`. Revert; prove `git diff --stat` empty.

- [ ] **Step 6: Re-run Step 1** — the host count in the files this task owns is 0, and README
  still has both "Releases page" links (positive control).

- [ ] **Step 7: Commit.**

---

### Task 10: Add the leak gate — LAST in Phase A

**Files:**
- Create: `scripts/check-identifier-leaks.mjs` (CLI: exit codes and I/O)
- Create: `scripts/identifier-leak-lib.mjs` (pure: pattern building and classification)
- Create: `scripts/identifier-leak-lib.test.mjs`
- Modify: `package.json` (add `leaks:check` and its `scriptsDescriptions` entry), `CONTRIBUTING.md`
  (generated script table), `.gitlab-ci.yml` (a blocking quality job)
- **Never tracked:** the identifier list itself.

**Interfaces:**
- Consumes: Tasks 1–9 and the companion plan merged — it goes green only then.
- Produces: `npm run leaks:check`, used by Task 12 and kept permanently in CI. The lib exports
  `buildPatterns(list)` and `classifyHit(path, line, patterns)`; it **imports** `ABSENCE_MARKERS`
  from `scripts/agents-symbols-lib.mjs` rather than keeping a second copy.

★★★ **The list cannot live in the repository.** A tracked pattern file would disclose, in the
public tree, exactly what the gate exists to keep out of it. The CLI reads the list from a path
given by an environment variable (locally, a file outside the repo; in CI, a masked file-type
variable), and exits **2** when the variable is unset or the file is empty — "could not scan",
never a pass. The list must cover: the employer domain(s), the employer name in both spellings,
the Timelog tenant slug, the internal GitLab host, the wiki host, project-id URL paths, the
old `appId` value, the assistant session URL prefix, and the brand trigram (word-bounded).
Tests use fictional identifiers only.

★★ It must not flag a line that legitimately names what it forbids and carries an absence marker
— but after Task 6 that set is expected to be empty. ★★★ Never widen the marker list to make a
pipeline pass — a defeated gate reports success.

- [ ] **Step 1: Split pure from I/O, following this repo's own precedent.** No shebang on the lib
  (★ a `#!` on an imported `.mjs` makes vitest throw naming the WRONG file); the CLI owns
  `readFileSync`, stdout and exit codes.

- [ ] **Step 2: Write the failing lib test** (`vitest.config.ts`'s `include` already covers
  `scripts/**/*.test.mjs`):

```js
import { describe, it, expect } from "vitest";
import { buildPatterns, classifyHit } from "./identifier-leak-lib.mjs";

const P = buildPatterns(["acme-corp.example", "word:acm"]);

describe("classifyHit", () => {
  it("reports a bare identifier as a leak", () => {
    expect(classifyHit("src/app/foo.ts", 'const h = "acme-corp.example";', P).kind).toBe("leak");
  });

  it("suppresses a mention marked as deliberately absent", () => {
    const line = 'The host "acme-corp.example" was removed. Do NOT reintroduce it.';
    expect(classifyHit("docs/open-followups.md", line, P).kind).toBe("allowed");
  });

  it("does not suppress a leak merely because the file is a doc", () => {
    // The marker, not the file type, is what suppresses.
    expect(classifyHit("docs/whatever.md", "host: acme-corp.example", P).kind).toBe("leak");
  });

  it("matches a word-bounded pattern only as a word", () => {
    expect(classifyHit("a.md", "the acm theme", P).kind).toBe("leak");
    expect(classifyHit("a.md", "acme and acmx", P).kind).toBe("clean");
  });
});
```

  ★ The third case is the one that matters: a first cut that suppresses by file path passes the
  first two and makes every document a blind spot. The fourth pins word-bounding in both
  directions — a trigram matched as a substring flags every word containing it.

- [ ] **Step 3: Run it and watch it fail.** `npx vitest run scripts/identifier-leak-lib.test.mjs
  --maxWorkers=1 --reporter=dot > /tmp/t.log 2>&1; echo "EXIT=$?"`

- [ ] **Step 4: Implement the lib, then the CLI.** Exit **1** on a leak, **2** when it could not
  scan (list variable unset, list empty, no files matched, or fewer files than a minimum floor like
  the register gates use).

- [ ] **Step 5: Prove the vacuity guards.** Unset the variable → exit 2. Empty list file → exit 2.
  Point it at an empty directory → exit 2. None may exit 0.

- [ ] **Step 6: Prove it can fail.** Plant one fictional listed identifier in a scratch copy of a
  tracked file (never commit it) → exit 1. Remove it → exit 0.

- [ ] **Step 7: Run it against the real tree** with the real list. Expect exit 0. A hit is a real
  finding from Tasks 1–9 or the companion plan — fix it there rather than widening the markers.

- [ ] **Step 8: Add the script-description entry.** `npm run build` runs a prebuild check that
  fails when a new script has no description. Read which docs participate rather than assuming:

```bash
git grep -lE "<!-- END AUTO-GENERATED --[>]" -- "*.md"
```

- [ ] **Step 9: Wire it into CI** as a blocking quality job with the list as a masked file-type
  variable, update `docs/AGENTS/ci.md` (new CI gate → that file), then **commit**.

---

## Phase B — one rewrite pass, on a throwaway clone

### Task 11: The history rewrite

**Files:**
- Create: `scripts/rewrite-history/run.sh` (documented, re-runnable; takes the replacement list
  and the mailmap as **path arguments**)
- **Never tracked:** the replacement list and the mailmap. Both name the identifiers (and the
  mailmap the owner's personal address); they live in a scratch directory outside the repository.
  The first version of this plan committed `replacements.txt`, which would have written every
  identifier back into the tip the rewrite had just cleaned.
- **No repository file is modified by the rewrite itself.** It operates on a throwaway clone.

**Interfaces:**
- Consumes: Tasks 1–10 and the companion brand-rename plan merged on `main`, so the tip is clean.
- Produces: a rewritten clone at a known path, plus the commit map
  `.git/filter-repo/commit-map`, which Task 13 consumes.

**PRECONDITIONS — all four, checked on the day, not inherited from this paragraph:**

1. **The companion brand-rename plan is merged**, or the old brand spelling is baked into every
   rewritten commit and this task must be redone from scratch.
2. **`npm run leaks:check` exits 0 on `main`** — the tip is clean, so the diff check in Step 8 can
   require an empty diff.
3. **No unmerged work exists that anyone intends to keep.** A rewrite gives every commit a new
   hash, so any branch not included becomes unmergeable against it. On 2026-09-21 the remote has
   **2** heads; enumerate them and get a live/abandoned verdict for each. A `--mirror` clone
   rewrites all refs together, so branches that ARE present survive; the danger is work in
   someone's local clone or worktree (`git worktree list`), or a branch nobody thought to check.
4. **Every collaborator knows to re-clone**, and has stopped pushing. After the rewrite, an old
   clone shares no history with the new one: a `git pull` either refuses or, worse, succeeds into
   a merge that reintroduces the unsanitised commits. ★★ That is how a rewrite silently undoes
   itself — the identifiers come back through a merge from a stale clone.

```bash
git ls-remote --heads origin > /tmp/heads.txt; echo "EXIT=$?"; wc -l < /tmp/heads.txt     # 2 on 2026-09-21
git ls-remote --tags origin > /tmp/tags.txt; echo "EXIT=$?"; grep -vc '\^{}' /tmp/tags.txt   # 5 on 2026-09-21
```

- [ ] **Step 1: Confirm the tool exists.** `git filter-repo --version` — a separate Python program,
  not part of git. If absent, stop and report; do not substitute `filter-branch`.

- [ ] **Step 2: Make the throwaway clone.** A fresh `git clone --no-local --mirror` into a scratch
  directory outside the working tree, and a second untouched mirror as the ORIGINAL for Task 12.
  ★ `filter-repo` refuses a non-fresh clone by default; do not pass `--force` on a real checkout.

- [ ] **Step 3: Record the before-state.** Commit count (`git rev-list --all --count`), ref list
  (`git for-each-ref`), and `main^{tree}` of the original.

- [ ] **Step 4: Write the replacement list** (untracked) in `filter-repo`'s `literal:old==>new`
  form. ★★ **Derive it from the leak gate's own untracked list (Task 10)** — the same identifier
  set, so the two cannot drift. The first version enumerated candidates with an ad hoc grep that
  missed the concatenated domain spelling, the Outlook body text, `lib/`, `public/`, root JSON and
  README; do not rebuild a list by hand.

  ★★★ **CLASSIFY EVERY CANDIDATE AS *disclosure* OR *protocol* FIRST.** `filter-repo` rewrites the
  TIP as well as history, so a protocol value in this list silently changes product behaviour and
  **no test here can see it**. The known protocol values — the Outlook category prefix
  (companion plan), the Timelog tenant (Task 3) and the `appId` (Task 8) — are all handled in
  Phase A, so on the tip they no longer occur and replacing them in history is correct and
  harmless. If a candidate still occurs on the tip, precondition 2 is false: stop.

  ★★ **Label the COMMENTS near each hit, not just the hit.** A stale comment about a value is what
  talks the next reader out of checking it, and it survives every gate in this repo. Either
  polarity — a comment claiming a rename is "coming later" when it shipped under another name, or
  one asserting a gap is a property — is consulted INSTEAD of re-deriving.

- [ ] **Step 5: Write the mailmap** (untracked). Measured 2026-09-21: **3** distinct identities in
  all of history — the author's work address (8,452 employer-authored commits on `main`) and **2**
  CI-bot identities, which authored 90 commits and both embed the internal host and the project
  id. Map the work address to the personal address supplied by the repository owner at execution
  time, and both bots to one neutral CI identity. ★ Annotated tags carry a **tagger** identity —
  include it; the identity scan in Task 12 reads it.

- [ ] **Step 6: Write the message callback.** It deletes lines beginning with the session trailer
  key (3,144 commits on `main`, 2026-09-21) and lines beginning with the assistant co-author key
  (217). ★★★ It must match the TRAILER LINES, never the assistant's name: commits mention it
  legitimately because a shipped feature is named after it. Re-count those with a measure that
  excludes `CLAUDE.md` before relying on the spec's figure. Separately, 86 tracked plan/spec files
  carry session URLs in their body (347 occurrences) — the blob replacement handles those. All
  these counts drift daily.

- [ ] **Step 7: Run the rewrite** over **every ref, tags included** (a `--mirror` clone and no
  `--refs` restriction). Keep the commit map. Record the after-state: commit count equal to Step 3
  (nothing is dropped), and the same ref names. ★ A rewritten tag points at a new SHA; the GitLab
  releases hanging off the old tags are retired with GitLab itself, not migrated.

- [ ] **Step 8: The diff check — must be EMPTY.**

```bash
git -C <original> rev-parse 'main^{tree}' > /tmp/old-tree.txt
git -C <rewritten> rev-parse 'main^{tree}' > /tmp/new-tree.txt
cmp /tmp/old-tree.txt /tmp/new-tree.txt; echo "EXIT=$?"      # must be 0
```

  Phase A left nothing for the substitution to change on the tip, so any difference is the
  replacement list having matched something nobody predicted. Compare `^{tree}`, not commits —
  SHAs and messages differ by design. Do the same for every other head and tag that points at a
  commit already clean on `main`.

- [ ] **Step 9: Commit `run.sh` only** (not the clone, not the lists), with the paths it expects
  documented in its header.

---

### Task 12: Verify the rewritten history

**Files:**
- Create: `scripts/verify-rewrite.mjs`
- Create: `scripts/verify-rewrite.test.mjs`

**Interfaces:**
- Consumes: the rewritten clone and the original clone from Task 11, and the leak gate's
  untracked list.
- Produces: a pass/fail verdict over three substrates, each with a positive control.

★★★ **Every scan here runs twice: against the ORIGINAL clone, where it must find a specific
nonzero count, and against the REWRITTEN clone, where it must find zero.** A single zero cannot
distinguish "clean" from "scanned nothing", and the exit code is identical in both cases.

- [ ] **Step 1: Blobs.** Walk every object reachable from every ref — `git rev-list --all
  --objects` into `git cat-file --batch` — not the checked-out tree. A `git grep` sees one commit
  and would pass trivially.

- [ ] **Step 2: Messages.** `git log --all --format=%B` across every ref, plus annotated tag
  messages (`git for-each-ref refs/tags --format='%(contents)'`), for the trailer keys, the session
  URL prefix and the identifier list.

- [ ] **Step 3: Identities.** Author, committer **and tagger** addresses across every ref must
  **equal** a one-line allowlist. ★ This is a set-equality check, not a search for known-bad
  values, so an identity nobody predicted still fails it.

- [ ] **Step 4: Record the original-clone counts** for all three scans. Each must be nonzero, and
  the identity scan must report exactly **3** distinct identities (the author and two CI bots —
  re-measure on the day). If any count is zero, the scan is broken — fix it before trusting any
  later zero.

- [ ] **Step 5: Run all three against the rewritten clone.** Blobs and messages zero; the identity
  set equal to the allowlist exactly.

- [ ] **Step 6: Write the lib test** with fixtures: one case per substrate, and one case proving
  each scan fails when handed a planted (fictional) identifier.

- [ ] **Step 7: Commit.**

---

## Phase C — remap citations, then verify

### Task 13: Remap the commit citations

**Files:**
- Create: `scripts/remap-commit-citations.mjs`
- Create: `scripts/remap-commit-citations.test.mjs`
- Modify: tracked `*.md` (the citations themselves, mechanically)

**Interfaces:**
- Consumes: `.git/filter-repo/commit-map` from Task 11, and the rewritten clone.
- Produces: docs whose backticked commit citations resolve in the new history.

Measured 2026-09-21 with the **resolving** definition below: 1,114 backticked 7–40-hex tokens in
tracked `*.md` — 1,105 resolve to a commit, 9 do not; 526 of them in the register (521 + 5).
★ Two of the 9 non-resolving tokens are this plan's own test-fixture tokens in Step 3's snippet —
they are not citations, and the inventory must not "repair" them. (The first version's grep counted
7–10 hex only and gave 1,112; use one definition throughout.)

- [ ] **Step 1: Inventory before touching anything,** with the resolving definition: every
  backticked token matching `[0-9a-f]{7,40}` in tracked `*.md`, each classified by
  `git cat-file -e <token>^{commit}` against the ORIGINAL clone. Record the total, the resolving
  count and the non-resolving list. The total is the count that must be preserved.

- [ ] **Step 2: Classify every citation**: resolvable, or already dangling. ★★ Dangling ones are
  listed and LEFT ALONE, not "repaired" into whatever the map offers — they were already broken and
  inventing a target hides that.

- [ ] **Step 3: Write the failing test** for the remap function: it rewrites resolvable citations,
  leaves dangling ones untouched, and preserves the total count.

```js
it("preserves the citation count even when a citation cannot be mapped", () => {
  const map = new Map([["aaaaaaa", "1111111"]]);
  const out = remap("see `aaaaaaa` and `bbbbbbb`", map);
  expect(out).toContain("1111111");
  expect(out).toContain("bbbbbbb");           // untouched, not dropped
  expect(count(out)).toBe(2);                  // the failure mode that matters
});
```

- [ ] **Step 4: Run it and watch it fail**, then implement.

- [ ] **Step 5: Check abbreviation uniqueness.** For each remapped citation, confirm the
  abbreviated form resolves to exactly one object in the new history; lengthen it if not.

- [ ] **Step 6: Apply, then verify both failure modes.** Every previously resolving citation
  resolves in the new history, AND the total equals Step 1's. The second check catches a silent
  drop, which cannot fail the first.

- [ ] **Step 7: Run the doc gates** — `docs:claims:check`, `followups:index:check`,
  `followups:status:check`, each unpiped, each 0.

- [ ] **Step 8: Commit.**

---

### Task 14: Record the outcome

**Files:**
- Modify: `docs/open-followups.md` (entry 200)

- [ ] **Step 1: Update entry 200** to state what is done and what remains. It stays OPEN: this
  plan sanitises, it does not make anything public, and the entry's own title is about the
  visibility flip. Say which of the spec's seven classes are closed and that the flip is sequenced
  last in the roadmap.

- [ ] **Step 2: Keep the Status line conforming** — ISO date plus a backticked command, and cite
  `npm run leaks:check`, which now exists and is the honest verification.

- [ ] **Step 3: Run the four register/doc gates unpiped**, all 0, then **commit**.
