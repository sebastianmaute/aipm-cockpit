# Follow-up triage, resolver widening, and two ownership decisions

_Opened 2026-08-21 against `origin/main` at `98ee220a`. Branch
`chore/followups-triage-and-gate-resolution`. **No version bump** — no user-facing behaviour
changes, and the one gate this touches runs in no CI job._

Picked from `docs/work-inventory.md` §7 items 4, 5 and 6 — the "cheapest closures available" group.

---

## 0. Grounding

Every figure below was produced by the command beside it, run in this worktree at `98ee220a`.
Re-run before trusting any of them.

| Fact | Command | Value |
|---|---|---|
| follow-up register open entries | `node scripts/check-followup-claims.mjs` | **131** |
| its tally | same | `CLEAN=113 NO_MACHINE_CLAIM=1 SYMBOL_MISSING=13 PATH_THIRD_PARTY=1 PATH_MISSING=3` |
| exit code | `node scripts/check-followup-claims.mjs; echo $?` | **0** — reporting only, gates nothing |
| `@types/node` declared | `node -e "console.log(require('./package.json').devDependencies['@types/node'])"` | `^20` |
| `engines.node` | same file | `>=24` |
| CI image | `grep -n "image:" .gitlab-ci.yml` | `node:24-bookworm-slim` |
| heroicons surface | `grep -rln "@heroicons/react" src/app \| wc -l` | **78** |
| lucide surface | `grep -rln "lucide-react" src/app --include="*.tsx" --include="*.ts" \| wc -l` | **1** |
| distinct heroicons actually imported | see §6 — count the names inside `@heroicons/react` import lists | **70** |

★ That last row was **102** on first measure and the first measure was wrong. `\b[A-Z][A-Za-z0-9]+Icon\b`
over `src` counts every identifier *shaped* like an icon name — local components, lucide aliases,
type names — not the heroicons import surface. Counting names inside the import lists themselves
returns 70. The 32-name gap is the whole difference between "how big is the migration" and "how many
things end in `Icon`".

★★★ **`docs/work-inventory.md` §4 misdiagnoses this gate and the misdiagnosis is load-bearing.**
It says the resolver *"walks `src`/`scripts`/`e2e` ONLY, so every `docs/` path it meets is reported
PATH_MISSING"*. False since the widening recorded at `check-followup-claims.mjs:76-98`: that file
already builds a `docs/**` asset index and already merges `collectDocs()`. Acting on the inventory's
version would rewrite code that is already correct and leave all four real causes standing. The
inventory itself warns that every number in it rots; this is the same failure applied to a diagnosis
rather than a count.

---

## 1. Four defect classes behind the 17 flags

Measured, not inferred. A sweep of all 21 flagged symbols against the tree
(`for s in …; do grep -rl "\b$s\b" src scripts e2e | wc -l; done`) returns 0 for eighteen of them
and **non-zero for three** — and that split is what separates the classes.

| Class | Flags | Root cause | Fix lives in |
|---|---|---|---|
| **A — planning corpus unresolvable** | §145 | `doc-claims-lib.mjs:112` `SKIP_DIRS = ["docs/superpowers"]`, applied inside `collectDocs()` | resolution index |
| **B — extension-blind paths** | §200 `golden-workspace.md` | file exists at `src/app/__fixtures__/golden-workspace.md`; `SOURCE_EXT` (`doc-claims-lib.mjs:27`) carries no `md`, and `ROOT_DOCS` excludes it deliberately | resolution index |
| **C — the sweep's self-exclusion** | §138 | `markedNear` (5 files), `toArgv` (3), `collectIdentifiers` (5) **all exist**, every one inside `SWEEP_SELF_FILES`, which `check-followup-claims.mjs:59` excludes on purpose | report shape |
| **D — prose fragments** | §131 `foo.tsx`, §200 `.generated.ts` | example filenames written as if they were citations | the prose |

★★ **Class A must not be fixed by deleting `SKIP_DIRS`.** That constant has two consumers, and the
other one is `check-doc-claims.mjs`, which **does** block, as CI job `doc-claims-check`
(`.gitlab-ci.yml:265`). Its own comment states the reason the skip outlived the un-ignore:

> citations describe the tree as it stood when the slice was written, so gating them would fail on
> every historical document the moment the code moved

Deleting the constant drags the entire planning corpus into a blocking gate — `ls -1
docs/superpowers/specs | wc -l` and the same for `plans` today return **219** and **238**, and that
population grows by one per slice, **including this file**. Re-derive it; do not quote this pair.
The distinction the code
does not yet draw is **scanning versus resolving**: a spec under `docs/superpowers/` must stay out
of the claim-scan corpus and must be found by an existence check. Same tree, two questions.

★★★ **Class C must not be fixed by weakening the self-exclusion.** It exists so that
`followup-claims-lib.test.mjs` — whose method is quoting register prose verbatim — cannot vouch for
the very names the tool checks. Removing it makes §138 CLEAN by making the gate circular. The
symbol is genuinely present; only the *label* is wrong.

---

## 2. Gate changes

Scope: `scripts/check-followup-claims.mjs`, `scripts/followup-claims-lib.mjs`,
`scripts/doc-claims-lib.mjs` (signature only). **No behaviour change to `check-doc-claims.mjs`.**

**A.** Parameterise the walk — `collectDocs(skipDirs = SKIP_DIRS)`. The claim-scan caller keeps the
default; the resolution index passes `[]`. One constant, one definition, two callers stating their
own intent. Not a second copy of the path list.

**B.** Add an extension-blind **path** index over `src`/`scripts`/`e2e` for resolution only.
`collectSources()` stays exactly as it is — it is the *citation* index, and citations legitimately
point only at code.

**C.** New status `SYMBOL_SELF_EXCLUDED`, reported when a symbol is absent from `knownSymbols` but
present in a `SWEEP_SELF_FILES` member. Distinct from `SYMBOL_MISSING` in the tally line, so the
"probe this first" list stops carrying an entry no probe can ever resolve.

### Tests, each with the mutant it must survive

| Assertion | Mutant it kills |
|---|---|
| a tracked `docs/superpowers/**/*.md` path resolves | reverting A |
| a **deleted** `docs/superpowers/` path still reports `PATH_MISSING` | A implemented as "resolve everything" |
| `src/app/__fixtures__/golden-workspace.md` resolves | reverting B |
| a path with a real extension that is genuinely absent still reports `PATH_MISSING` | B implemented as "resolve everything" |
| a symbol present only in a self-file reports `SELF_EXCLUDED` | reverting C |
| a symbol present nowhere still reports `SYMBOL_MISSING` | C implemented as "never report missing" |
| `collectDocs()` with no argument still excludes `docs/superpowers` | A leaking into the claim-scan corpus |

★ Rows 2, 4 and 6 are the anti-vacuity half. Each names the *permissive* implementation of its own
fix, which is the failure mode a widening invites and the one the script's existing
"WIDER, NOT UNCONDITIONAL" comment already warns about.

---

## 3. Probe the thirteen `SYMBOL_MISSING`

Two are answered before any reading starts:

- **§138** — cured by change C. It also carries a sentence that is now false: it describes
  `docs/superpowers/` as *"gitignored — so they exist on one machine and this entry is the only
  durable record"*. The tree was un-ignored in `0.253.0 "Schroeder"`. Correct it; the entry's P2–P4
  scope stays open.
- **§44** — `eventToGraphEvent`, `exceptionPlan`, `afterPush`, `replayExceptions` and
  `calendar-event-attendees.ts` are **S6's planned surface**, named in
  `specs/2026-07-29-s6-calendar-event-push-design.md` and unbuilt. Correctly open. Annotate so the
  next reader stops re-probing it.

The remaining **eleven** — §36, §51, §53, §82, §88, §90, §156, §157, §187, §189, §201 — each get one
read and one verdict line: **open**, **closed**, or **corrected**, with the command that shows it.

★★ No bulk closure. An absent symbol distinguishes "never built" from "built under another name"
not at all, and the script's own footer says it *rules claims out, never in*. A verdict of "closed"
requires a positive observation that the behaviour is gone, not the absence of a name.

★ Verdicts are recorded in whichever status convention the entry already uses — struck-through
heading, or a bolded Status line. Do **not** convert an entry between the two conventions while
triaging; that is a separate, larger job (`work-inventory.md` §4 measures the twelve-entry
disagreement it causes).

---

## 4. Prose fragments

§131 and §200 are reworded so their example filenames stop parsing as citations. No new register
syntax — the file already carries two incompatible status conventions, and a third convention that
only a script reads would be worse than the two flags it removes.

§200's `golden-workspace.md` flag needs no prose edit; change B covers it.

---

## 5. `@types/node` — measure, then decide

The precondition recorded in `docs/tech-debt-register.md` is met: the runtime is off node 20
(`engines: >=24`, CI on `node:24-bookworm-slim`), while the type package is still specified `^20`
and resolved at `20.19.43`.

Procedure, in this order:

1. `npm i -D @types/node@^24`
2. `npx tsc --noEmit`
3. **Report the error count and shape before deciding anything.**

| Outcome | Action |
|---|---|
| zero errors | land it |
| small and mechanical | land it, listing every fix |
| anything else | `git checkout -- package.json package-lock.json && npm ci`; record in the tech-debt register that the precondition is met **and what the bump actually costs**; it becomes its own slice |

★ The measurement is the deliverable either way. A recorded "costs N errors of shape X" is worth
more than an unbounded fix session inside a batch scoped as cheap.

---

## 6. TD-8 — the migration is SCHEDULED, and the default flips today

The decision: **run the app-wide `@heroicons/react` → `lucide-react` migration.** It does not run in
this slice — 78 files and 70 distinct imported icon names is a slice of its own. Re-derive both:

```bash
grep -rln "@heroicons/react" src/app | wc -l          # 78
grep -rhzoE 'import \{[^}]*\} from "@heroicons/react[^"]*"' src --include=*.tsx --include=*.ts \
  | tr '\0' '\n' | grep -oE "\b[A-Za-z0-9]+Icon\b" | sort -u | wc -l   # 70
```

Two consequences, and the second is the one that matters:

**6a. Ownership.** `docs/tech-debt-register.md` TD-8 moves from *"nobody owns the migration
question"* to *owned, scheduled, not started*, carrying the measured surface and the commands that
re-derive it. `docs/work-inventory.md` §3 gains a fifth designed-but-not-built row. No spec yet;
that is its own brainstorm.

**6b. The default for new code flips to `lucide-react`.** Every heroicons import added between now
and the migration is one more file to convert, so leaving the documented default pointing at the
package being retired makes the debt grow on purpose. Rewrites needed:

- `docs/CODEMAPS/dependencies.md:23` — currently *"Heroicons is still the app-wide icon set … do not
  reach for lucide elsewhere without deciding to switch"*. The switch is now decided. The row must
  state the target, the direction of travel, and that the 78 are pending conversion rather than
  correct.
- `docs/open-followups.md` §145 — currently *"Only **(b)**: whether to run the app-wide migration at
  all. Nothing has been brainstormed, specced, planned or scheduled for it."* (b) is answered.
  The entry closes as a decision and points at TD-8 for the scheduled work.

★★ This creates a deliberate mixed state: 78 files on the retired package, new code on the target,
and no gate enforcing either. That is the accepted cost of deciding before executing — record it in
TD-8 explicitly so the next reader does not file it as a defect.

★ `lucide-react` is `^1.31.0` with 1.33.0 available. Irrelevant while the blast radius is one file;
it stops being irrelevant the moment the migration slice opens. Note it in TD-8, do not bump it here.

---

## 7. Out of scope

- The migration itself (§6). Decision only.
- Converting register entries between the two status conventions (§3).
- Re-deriving `work-inventory.md` §4's hand-classified 118/57/9/7/1 split. It covered 192 sections,
  was never redone, and a heading regex disagrees with it by twelve — reconciling the two measures
  is its own job, and doing it inside a round that edits the entries it counts would restale it.
- `check-doc-claims.mjs` behaviour. Its output is a verification input here, not a target.

---

## 8. Verification

| Check | Passing means |
|---|---|
| `node scripts/check-followup-claims.mjs`, tally diffed against §0 | `SYMBOL_MISSING` and `PATH_MISSING` fell by exactly the entries §2 and §3 claim, and nothing else moved |
| `npm run docs:claims:check` output **byte-identical** to the branch point | `SKIP_DIRS` really did stay put — the single highest-risk regression in this slice |
| `npx vitest run scripts/` | the seven table rows in §2 pass, and each was seen to fail against its own mutant |
| `npx tsc --noEmit` | clean, including after any §5 outcome |
| `npm run lint` (`--max-warnings=0`) | clean |
| `npm run size:check` | clean |

★ The `docs:claims:check` row is a **byte comparison against the branch point**, not "it passes".
A widening that leaked into the claim-scan corpus would still exit 0 while scanning 456 extra
documents; only the output diff shows it.
