# Pin `next` exactly, and write down the rule that already governs three packages

_Opened 2026-08-22 against `main` at 0.255.0 "Bisson" (merge `2296bc7f`). Closes the drift
half of `docs/tech-debt-register.md` **TD-1**; re-scopes the row to the 16.3 bump alone._

Branch base is **`docs/ci-live-turso`**, not `main` — see §6.

---

## 0. Grounding

Measured 2026-08-22, not assumed. Every claim below carries the command that reproduces it.

| Fact | State | Reproduce |
|---|---|---|
| `next` specifier | `^16.2.11` — a caret range | read `dependencies.next` out of `package.json` |
| what is installed | 16.2.11 | read `packages["node_modules/next"].version` out of `package-lock.json` |
| what the range allows | **16.3.2** | `npm outdated next` → Current 16.2.11, Wanted 16.3.2 |
| exact-pinned packages | **3 of 35**: `react`, `react-dom` (both `19.2.4`), `eslint-config-next` (`16.2.6`) | see the counter in §3.1 |
| advisories against 16.2.11 | **none, at every severity** | `npm audit` → all buckets 0 |
| CI install sites | **all four are `npm ci`** | `grep -nE "npm (ci|install)" .gitlab-ci.yml Dockerfile.dast` |

### The release timeline

| Version | Released |
|---|---|
| 16.2.11 | 2026-07-21 — **our lock** |
| 16.2.12 | 2026-07-25 |
| 16.3.0 | 2026-08-03 |
| 16.3.1 | 2026-08-13 |
| 16.3.2 | **2026-08-21** |

Reproduce with `npm view next time --json`. ★★ Note the shape, because getting it wrong
reports the drift as absent: that command returns a **one-element array**, not an object, so
a script that iterates the parsed value directly finds zero versions. It also emits ~3900
keys including `created` and `modified`, which are not versions.

### What TD-1 got wrong, and it makes the row less alarming, not more

The row says "any install that does not honour the lock" moves the version. True, but it
reads as though the pipeline is exposed. **It is not.** All four CI install sites are
`npm ci`, which installs strictly from the lockfile and *errors* when `package.json` and the
lock disagree. The pipeline cannot drift.

The real exposure is narrower and still worth closing:

1. A developer machine — `npm update`, or `npm install <other-package>` re-resolving the tree.
2. A `package-lock.json` merge conflict resolved the wrong way. This is the dangerous one:
   the bad resolution is *committed*, and CI then installs it faithfully and reports green.

Route 2 is why the exact pin is worth having even though `npm ci` already gives reproducible
installs. The lock protects the *install*; the exact spec protects the *lock*.

---

## 1. Scope

**In.** `next` pinned to exactly `16.2.11` · the matching `package-lock.json` spec update ·
a written dependency-pinning policy in `CONTRIBUTING.md` · the required correction to
`AGENTS.md`, which currently states the caret · TD-1 rewritten to own only the 16.3 bump ·
two version errors corrected in `docs/work-inventory.md` · a **patch release as 0.255.1**
across every version carrier, see §8.

**Out.** The 16.3 upgrade itself — its own slice, see §5. The other packages
`npm outdated` reports as drifted (a count deliberately NOT quoted — it moves upstream between
any two runs; read it off `npm outdated --json`). Any change to `react`, `react-dom` or
`eslint-config-next`, all three already correctly pinned. Pinning the other 31 caret
dependencies, considered and rejected in §3.2. A CI gate enforcing the policy, also
considered and rejected in §3.2.

---

## 2. The change

### 2.1 The pin

`package.json`: `"next": "^16.2.11"` becomes `"next": "16.2.11"`.

**Pin at 16.2.11, not 16.2.12.** 16.2.11 is the version every gate in this repo has actually
run against, and `npm audit` is clean at every severity, so there is no security pressure to
take a patch. 16.2.12 is not privileged by the current range either — `^16.2.11` resolves to
16.3.2, not to it. Taking 16.2.12 would be a small upgrade wearing a safety fix's clothes.

### 2.2 The lockfile

Regenerate with `npm install --package-lock-only`.

★★ **The diff must be exactly the `next` spec string under the root package's `dependencies`.**
npm re-resolves opportunistically, and many packages show available drift at any moment, so a stale
lock can pick up unrelated bumps in the same command. Read the whole diff, never just
`--stat`. If anything other than `next` moved: `git checkout -- package-lock.json` and edit
the one spec string by hand.

### 2.3 Why this is not merely cosmetic

`npm ci` already pins the install. What the caret leaves open is the *spec*, and the spec is
what a merge conflict resolves against. Making it exact means the framework version has one
authority instead of two that can disagree.

This matters more here than in most repos: `AGENTS.md` opens by warning that this is not the
Next.js in training data — that APIs, conventions and file structure may all differ. A silent
minor bump moves the codebase off the version that warning is calibrated against, and every
gate stays green while it happens.

---

## 3. The policy

### 3.1 Why a policy and not just a pin

The three existing exact pins are not arbitrary. `react`, `react-dom` and
`eslint-config-next` are precisely the framework-coupled packages — and `next` is the most
framework-coupled of all, so its caret is an omission from a rule, not a different choice.

The rule was never written down. That is why it was possible to miss. Verify the split by
listing every specifier that starts with a digit rather than a range operator:

```bash
node -e "const p=require('./package.json');const all={...p.dependencies,...p.devDependencies};const e=Object.entries(all).filter(function(x){return /^[0-9]/.test(x[1])});console.log('total',Object.keys(all).length,'exact',e.length);console.log(e.map(function(x){return x[0]+'@'+x[1]}).join(', '))"
```

### 3.2 Rejected alternatives

**Pin all 35.** Rejected. `npm ci` already gives byte-reproducible installs from the lock, so
exact pins buy nothing there; what they cost is a manual slice for every security patch to
every dev tool. The caret is doing useful work on the other 31.

**Add a CI gate that fails when a listed package regains a range.** Rejected on YAGNI. The
class has exactly one instance in the repo's history, this slice fixes it, and this repo
already carries a large gate suite whose own documentation warns that a defeated gate is
worse than no gate. Revisit if it recurs.

### 3.3 Where it goes

A new `### Dependencies` subsection in `CONTRIBUTING.md`, under `## Conventions`, saying:

> **Framework-coupled packages are pinned exactly, with no range:** `next`, `react`,
> `react-dom`, `eslint-config-next`. Every other dependency carries a caret so patch
> releases flow without a slice each.
>
> `npm ci` — which is what all four CI install sites use — already installs strictly from
> `package-lock.json`, so the exact pin is not what makes an install reproducible. It
> protects the *specifier*, which is what a lockfile merge conflict resolves against: a
> conflict resolved the wrong way is committed, and CI then installs it faithfully and
> reports green. For `next` specifically, a silent minor bump moves the tree off the version
> `AGENTS.md`'s opening warning is calibrated against.
>
> Adding a framework-coupled dependency? Pin it exactly and add it to this list.

### 3.4 The AGENTS.md edit is required, not optional

`AGENTS.md`'s Commands block annotates `npm run dev` with a parenthetical naming the caret
range. That parenthetical **goes false the moment the pin lands**, so it has to change
whatever we decide about pointers. It becomes the pointer: it states the exact version and
refers to the `CONTRIBUTING.md` rule.

This keeps the doc-set rule intact — the fact lives in one file, and the second mention links
rather than restates. It also puts the rule in the one file loaded into every session, which
`CONTRIBUTING.md` alone would not do.

---

## 4. TD-1 disposition

TD-1 **splits; it does not close.** Two distinct pieces of work sat under one row:

| Half | State after this slice |
|---|---|
| the spec does not hold the version | **done** — pinned exactly, policy written |
| 16.3 is unowned | **still open** — TD-1 is re-scoped to this alone |

The rewritten row records: the release timeline from §0, the correction that CI cannot drift,
and the fact that 16.3.2 shipped on **2026-08-21**. The row's own reproduce commands are
updated, since `npm outdated next` will read `Wanted 16.2.11` once the pin lands and will no
longer show the drift the old text points at.

★ Do not quote a "days old" figure in the register — it rots daily. Quote the release date.

---

## 5. What the 16.3 slice will need (not this slice)

Recorded so the deferral is a decision rather than a gap:

- Read `node_modules/next/dist/docs/` **after** the upgrade — the installed docs ship with
  the installed version, so 16.2.11's copy cannot describe 16.3. The tree currently holds a
  15-to-16 upgrade guide under `01-app/02-guides/upgrading/`, not a 16.2-to-16.3 one.
- Decide whether `eslint-config-next` moves in step. It is pinned at `16.2.6` while `next` is
  at `16.2.11` — already out of step and working, so lockstep is not required, but 16.3.2 is
  available for it too.
- Check the interaction with the ESLint 10 block (`docs/open-followups.md` §53 and §45) —
  that block lives in `eslint-config-next`'s bundled `eslint-plugin-react`, so anything that
  moves that package touches it.
- Full gate chain including e2e, axe and `e2e:smoke:prod`. A framework minor can move
  rendering and CSP behaviour, so unlike this slice it is not exempt from the browser gates.

---

## 6. Fold-ins

Three items ride along, agreed at design time.

### 6.1 Branch base: `docs/ci-live-turso`

That branch holds two commits absent from `origin/main`:

- `0baf5a79` — opens §215 (CI has no live Turso database, so twelve document-image tests skip
  in every pipeline).
- `c6323c74` — ignores `/.demo-tmp/` and the `_archive-slice-docs-*.zip` bundles.

§215 exists **nowhere else and is unpushed**. Cutting from `main` would silently drop it —
the same one-deletion-from-gone failure mode `docs/work-inventory.md` §1 documents for the
298 recovered planning documents. Branching here carries both to origin with this MR.

★★ **That gitignore commit does NOT cover the four root scratch artifacts**, and a first
reading of this slice assumed it did. Its two rules are `/.demo-tmp/` and the zip glob;
`git check-ignore` reports all four PNG/HTML files as not ignored. They are handled by §6.3
instead.

### 6.2 `docs/work-inventory.md`

Three corrections, all the same error: the icon migration is recorded as shipping
**0.254.0 "Bisson"** in §3, §5 and §7. It shipped as **0.255.0**; 0.254.0 was **"Yoshinaga"**.

★ This said "two … §3 and §5" until implementation counted them. The spec was written
from a grep of §3 and §5 alone and never swept the file — the same class of error the
slice is correcting, committed while correcting it.

That is exactly the version-collision class that bit during the icon slice's own review —
`main` shipped 0.254.0 while the branch was in review, and the branch had to renumber. The
error is now written into the file the backlog is navigated by, which is how it propagates.

★ Correct the three version strings only. Do **not** refresh the file's measured figures in the
same pass: the file's own header says every number in it rots and must be re-derived by the
reader, and a partial refresh produces a document that looks freshly measured and is not.

### 6.3 Scratch artifacts

`contact-sheet.png`, `icon-fixes-sheet.html`, `icon-fixes-sheet.png` and
`rectangle-stack-options.png` — glyph contact sheets generated while reviewing icon rows
during 0.255.0. Review scratch with no ongoing value. **Deleted, not ignored**: an ignore rule
for four one-off filenames is permanent clutter for a transient problem.

★ Done before the spec commit, so the worktree was clean when this branch was cut. All four
were confirmed untracked (`git ls-files` returned nothing) before removal.

---

## 7. Verification

| Gate | Why |
|---|---|
| `npm ci` | **The load-bearing one.** It errors on a `package.json`/lock mismatch, so a clean run is direct proof the two agree — not an inference from a diff that looked right. |
| `npx tsc --noEmit` | Same Next version, so this should be unchanged. A failure means the lock moved something. |
| `npm run lint` | As above. |
| `npm run test:run` | As above. |
| `npm run size:check` | Docs are not walked, but the run is cheap and the ratchet is blocking. |
| `npm run dup:check` | Prose added to `CONTRIBUTING.md` and the register could in principle clone. |
| `npm run docs:symbols:check` | `AGENTS.md` is edited — this gate reads it. Backticked mixed-case names must exist in the tree. |
| `npm run docs:claims:check` | `CONTRIBUTING.md`, `AGENTS.md` and the register are all in scope. **Add no `path:LINE` citations** — the gate is a ratchet and fails on a new one. `docs/superpowers/` is excluded, so this spec file itself is not scanned. |

**Not run, deliberately:** `e2e`, the axe gate, `e2e:visual`, `e2e:smoke:prod`. No runtime
code changes, and no dependency version moves — the installed tree is byte-identical before
and after. There is nothing for a browser to observe. (The 16.3 slice in §5 is the opposite
case and needs all of them.)

★★ Read every exit code unpiped. Piping a gate reports the *pipe's* status, not the command's,
and discards the failure diagnostic — a failing suite then reads as green.

---

## 8. Release shape

**Patch bump to 0.255.1, with a `CHANGELOG.md` entry.**

★★ **The codename does NOT change — 0.255.1 is still "Bisson".** Patch releases inherit their
minor series' milestone: 0.211.1 and 0.211.2 are both "Samatar", 0.202.1 through 0.202.4 are
all "Beukes". 122 patch entries in `CHANGELOG.md` follow this, and `APP_MILESTONE`'s own
docstring already states that the 0.255.x *line* is Bisson. So `APP_MILESTONE` is untouched
and no new codename is minted.

★★ **Verify a codename by full-file grep, never by an extracted list.** Building a used-name
list with a regex over the `## [x.y.z] - date "Name"` heading form silently undercounts:
older entries use an **em dash** where recent ones use a hyphen, so a hyphen-only pattern
returned 194 names for 255 releases. `Kowal`, `Kiernan` and `Muir` all read "free" against
that list and are all taken (0.37.0, 0.38.0, 0.35.0). Not needed for this slice — recorded
because the next slice that *does* mint a codename will reach for exactly that method.

### 8.1 The carriers

All are currently consistent at 0.255.0 — the icon slice bumped them correctly, so this slice
starts from a clean base and must not be the one that restarts the drift.

★★★ **DO NOT COUNT THE CARRIERS BY GREPPING THE VERSION STRING, AND DO NOT SED IT.** The
string `0.255.0` occurs **12** times across these files and **two of those must not change**:

```bash
grep -c "0\.255\.0" src/app/version.ts package.json package-lock.json README.md docs/CODEMAPS/*.md
```

- `src/app/version.ts` has 2 — `APP_VERSION`, plus the trailing comment on `APP_BUILD_DATE`.
  That comment is rewritten by hand to describe 0.255.1, not version-substituted.
- `docs/CODEMAPS/dependencies.md` has 2 — the generated header (a carrier) **and a prose
  sentence, "the app's ONLY icon set since 0.255.0", which is a historical fact about the
  icon migration.** Bumping it would assert that lucide became the sole icon set in 0.255.1.
  Leave it alone.

An earlier draft of this section asserted "eight carriers" and then made "eight hits" a
success criterion. Both numbers were invented, neither was measured, and they counted
different things. Edit each carrier deliberately.

| Place | Change |
|---|---|
| `src/app/version.ts` | `APP_VERSION` to `0.255.1`; the `APP_BUILD_DATE` trailing comment re-summarised. `APP_BUILD_DATE` itself stays `2026-08-22` — same day. `APP_MILESTONE` **unchanged**. |
| `CHANGELOG.md` | new entry, heading form `## [0.255.1] - 2026-08-22 "Bisson"` — hyphen, not em dash, matching the recent entries |
| `package.json` | `version` |
| `package-lock.json` | `version` **twice** — the root one and the root package entry |
| `README.md` | the shields badge — **version only**; the codename in it is already Bisson |
| `docs/CODEMAPS/*.md` (5 files) | the `App <version> "<codename>"` field in the generated header |

★ In the codemap headers, change **only** the App version. Those headers also carry a
"counts re-verified <date> at <sha>" clause, and nothing was regenerated and no source file
moved — editing that clause would assert a re-verification that did not happen.

★ **No `versionHighlight*` key.** The Version popover surfaces user-facing highlights; a
dependency pin is not one. `APP_HIGHLIGHT_KEYS` is untouched, which also means no EN/DE
string pair and no `i18n.de.ts` edit — so the umlaut-corruption hazard is not engaged.

★★ Before pushing, `git fetch` and diff `origin/main`'s `src/app/version.ts` against this
branch. The icon slice collided at exactly this step because `main` released while it was in
review, and this branch carries two commits that have been sitting unpushed for longer.

★ Push, MR and merge happen only on an explicit instruction, and merge only on a green
pipeline.

---

## 9. Success criteria

1. The `next` specifier in `package.json` reads `16.2.11` with no caret.
2. `npm ci` exits 0.
3. `git diff` on `package-lock.json` touches the `next` specifier and nothing else.
4. `npm outdated next` reports `Wanted 16.2.11` — the range no longer reaches 16.3.2.
5. No surviving `^16.2` in `AGENTS.md` or `CONTRIBUTING.md`.
6. TD-1 describes the 16.3 bump only, and its reproduce commands work against the pinned tree.
7. `docs/work-inventory.md` contains no `0.254.0 "Bisson"`.
8. Every carrier reads `0.255.1`, and the only surviving `0.255.0` in the tree is the
   historical prose in `docs/CODEMAPS/dependencies.md` — verified by reading the sweep's
   output, not by counting it:
   `grep -n "0\.255\.0" src/app/version.ts package.json package-lock.json README.md docs/CODEMAPS/*.md`
   must return exactly that one line, and the matching `0.255.1` sweep must show
   `package-lock.json` twice and each codemap header once.
9. `APP_MILESTONE` still reads `Bisson`, and `APP_HIGHLIGHT_KEYS` is unchanged.
10. The new `CHANGELOG.md` heading uses a hyphen, matching the recent entries.
11. The full gate chain in §7 is green, each exit code read unpiped.
