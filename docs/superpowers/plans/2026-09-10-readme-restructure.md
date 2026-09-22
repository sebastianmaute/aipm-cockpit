# README Restructure Implementation Plan (Part A)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `README.md` from a 35 KB searchable reference into a ~9 KB entry point, moving six technical sections into files that own their subject.

**Architecture:** Create the destination files first, each carrying its section verbatim; then rewrite README once rather than editing it six times. Finish with an anchor check that is itself proved able to fail.

**Tech Stack:** Markdown only. No application code changes.

**Source spec:** `docs/superpowers/specs/2026-09-10-readme-and-releases-design.md` (commit `f02c9013`), sections 5.1–5.4 and the part of section 8 that applies to the docs move.

**Scope:** Part A only. Part B (release publishing, spec section 6) is a separate plan. **Write no task** for the CI job, tagging, the tag/version guard, `artifactName`, or the Releases API.

---

## Ground rules for every task

Read once. These are repo constraints; violating them produces green-looking failures.

- **Never read a gate's exit code through a pipe.** `npm run x | tail -5` reports `tail`'s status and discards the diagnostic. Redirect to a file, `echo $?` unpiped, then grep the file.
- **Line endings.** Every file this plan touches is LF-pinned by `.gitattributes` (`attr/text eol=lf`): `README.md`, `CONTRIBUTING.md`, `AGENTS.md`, `docs/RUNBOOK.md`, and everything under `docs/`. Confirm with `git ls-files --eol <file>` before editing. **Never `sed -i`** — under git-bash it re-lines a file and `core.autocrlf` can hide that from `git diff`.
- **Never write helper scripts with a bash heredoc or inline `node -e`.** This session measured backslashes being silently halved that way, corrupting a regex into a syntax error. **Use the Write tool** for every helper script, and prefer `split`/`join` over building a RegExp from an escaped string.
- **Any scripted write must assert its anchor matched exactly once** and throw rather than write on zero matches. A `\n` anchor against an unexpected file silently no-ops otherwise.
- **Never** `git add -A` or `git add .`. Stage explicit paths. **Never** stage `sample-workspace-huge.json` or `not-in-use.env.local.bak`.
- `git checkout -- <file>` and `git restore` are deny-blocked. **Never run `git stash`** in this worktree (the stash stack is shared). **Never `--amend`**.
- Use PowerShell `Remove-Item -Recurse -Force`, never `rm -rf`.
- Scratchpad for logs and helper scripts, **not** `/tmp` (shared with peer sessions):
  `C:\Users\SEBAST~1.MAU\AppData\Local\Temp\claude\C--Projects-aipm-cockpit\628bd54e-9e78-4bdb-86f3-b2e46f1a8c77\scratchpad`
- **Do not disturb the dev server on port 3000. Do not clean or rebuild `.next/`.**
- **No version bump, no CHANGELOG entry, no push, no MR.**
- Every commit ends with the trailer:
  the session trailer

### The badge is a blocking gate, not decoration

`README.md` is a registered `version:sync` satellite — the entry is labelled **"README shields badge"** in `scripts/version-sync-lib.mjs`, and it carries **both** the version and the codename, with `encode`/`decode` hooks because a codename containing a space has to be URL-encoded inside a markdown link.

The badge line must survive **byte-for-byte**. `version-sync-check` is BLOCKING, and it has two failure modes with opposite responses: **exit 1 is drift** (fix with `npm run version:sync`), **exit 2 means the gate could not scan at all** — and a gate that scans nothing passes everything.

---

## File structure

**New files (all LF, all under `docs/`):**

| File | Owns |
|---|---|
| `docs/storage.md` | Storage backends: the file/Turso/IndexedDB options, browser support, multi-tab editing, emergency recovery |
| `docs/integrations.md` | Jira, Microsoft 365 (incl. the `how-sign-in-works` heading), Timelog |
| `docs/automation.md` | Scheduled reminders: task due dates, RAID review, stakeholder communication, birthdays, Jira token expiry |
| `docs/ai-cost.md` | Prompt caching: the layout, what it bought and cost, the prompt-quality harness |
| `docs/security.md` | Environment variables **merged with** the security model: what is stored where, what leaves the browser, recommendations |

**Modified:**

| File | Change |
|---|---|
| `README.md` | Six sections removed; Prerequisites deleted; Deploying moved out; *Why* trimmed; new **Get started**; expanded documentation map |
| `CONTRIBUTING.md` | Gains the **Sample Workspace** section |
| `docs/RUNBOOK.md` | Gains README's **Deploying** subsection |
| `AGENTS.md` | Corrects the false claim that README is generated from `scriptsDescriptions` |

**Helper scripts (scratchpad only — deliberately NOT repo scripts):**

`check-anchors.mjs` verifies every cross-file and intra-file heading link. It stays in the scratchpad because adding a script to `package.json` requires a matching `scriptsDescriptions` entry or the `prebuild` docs-sync check fails — a ripple this plan does not need. The spec says plainly that nothing checks anchors automatically; this is a one-off verification, not a new gate.

---

## The six anchors are THREE classes, not one

`README.md` contains six intra-document links today. After the move, **source and target do not always land in different files**, so a blanket "make them cross-file links" would break three of the six. Measured with `grep -n "](#" README.md`:

| README line | Link | Source lands in | Target lands in | Must become |
|---|---|---|---|---|
| 44 | `](#security-model)` | README (*Built to be trusted*) | `docs/security.md` | `](docs/security.md#security-model)` |
| 87 | `](#environment-variables--security)` | README (*Get started*) | `docs/security.md` | `](docs/security.md#environment-variables)` |
| 182 | `](#security-model)` | `docs/integrations.md` (Jira) | `docs/security.md` | `](security.md#security-model)` — sibling |
| 199 | `](#how-sign-in-works)` | `docs/integrations.md` (M365) | `docs/integrations.md` | **unchanged** — same file |
| 218 | `](#security-model)` | `docs/integrations.md` (Timelog) | `docs/security.md` | `](security.md#security-model)` — sibling |
| 335 | `](#security-model)` | `docs/security.md` (env vars) | `docs/security.md` | **unchanged** — same file |

★★ Note line 87's target slug **changes**. Today's heading is `## Environment Variables & Security`, whose GitHub slug is `environment-variables--security` — a **double hyphen**, because `&` is stripped and the surrounding spaces both become hyphens. In `docs/security.md` that content becomes `## Environment variables`, slug `environment-variables`. Never hand-write either; Task 9 derives them.

---

## Task 1: Record the baseline, so a lost section cannot go unnoticed

**Files:**
- Create: `<scratchpad>/readme-baseline.txt`

⚠️ This task exists because "the content moved" is exactly the claim nobody checks. Every later task compares against these numbers.

- [ ] **Step 1: Record per-section byte counts**

```bash
awk '/^## /{if(n)printf "%7d  %s\n",b,n; n=$0; b=0; next} {b+=length($0)+1} END{if(n)printf "%7d  %s\n",b,n}' README.md > <scratchpad>/readme-baseline.txt
wc -c README.md >> <scratchpad>/readme-baseline.txt
cat <scratchpad>/readme-baseline.txt
```

Expected — these are the numbers this plan was written against, so **report any disagreement rather than proceeding**:

```
   1804  (head, before the first ##)
   3803  ## Why AI PM Cockpit
    458  ## Full capability reference
    180  ## Features
   2296  ## Quick Start
   3658  ## Storage Backends
   7408  ## Integrations
   2467  ## Automation / Notifications
    944  ## Sample Workspace
    347  ## Tech Stack
   6555  ## AI Cost & Prompt Caching
   1294  ## Environment Variables & Security
   2702  ## Security Model
   1072  ## Further reading
    226  ## License
  35214  README.md
```

(The head figure is `35214` minus the sum of the sections and is not printed by the `awk` above; compute it only if you want the cross-check.)

The seven moving sections total **25 028 bytes**: 3658 + 7408 + 2467 + 944 + 6555 + 1294 + 2702.

★★★ **THESE FIGURES EXCLUDE EACH SECTION'S OWN `## ` HEADING LINE, AND TASKS 2-7 ASK
YOU TO `sed` A RANGE THAT INCLUDES IT.** The `awk` above `next`s the heading line
before it starts accumulating, so every one of the seven baselines is the BODY
alone. A Task 2-7 Step 1 that extracts `sed -n '<first>,<last>p'` therefore measures
exactly one heading line MORE, and reads as a mismatch against the number printed
beside it. This was not caught while writing the plan; it was caught 2026-09-10 by
the Task 4 agent, which stopped at Step 1 on a 30-byte disagreement rather than
guessing — the correct response, and the reason that stop-and-report rule is there.

Both numbers, measured — use the left column to check an extraction that keeps the
heading and the right one for what actually gets written into the new file:

| Section | `sed` range | With heading | Body only |
|---|---|---|---|
| Storage Backends | 117-162 | 3678 | 3658 |
| Integrations | 163-221 | 7424 | 7408 |
| Automation / Notifications | 222-254 | 2497 | 2467 |
| Sample Workspace | 255-264 | 964 | 944 |
| AI Cost & Prompt Caching | 274-323 | 6583 | 6555 |
| Environment Variables & Security | 324-336 | 1330 | 1294 |
| Security Model | 337-364 | 2720 | 2702 |

Reproduce the pair yourself rather than trusting the table — a heading's length is
the whole discrepancy, so the check is worth one command:

```bash
for r in "117 162" "163 221" "222 254" "255 264" "274 323" "324 336" "337 364"; do set -- $r; b=$(sed -n "$1,$2p" README.md | wc -c); h=$(sed -n "$1p" README.md | wc -c); echo "$1-$2 withHeading=$b heading=$h body=$((b-h))"; done
```

★ Task 7 is the one that wants the **with-heading** figure (964): it keeps
`## Sample Workspace` when inserting into CONTRIBUTING. The other five drop their
heading in favour of a new `#` title, so they want the body figure.

- [ ] **Step 2: Confirm the line ranges**

```bash
grep -n "^#\{1,4\} " README.md
```

Expected, and used by every later task:

| Section | Lines |
|---|---|
| Storage Backends | 117–162 |
| Integrations | 163–221 |
| Automation / Notifications | 222–254 |
| Sample Workspace | 255–264 |
| AI Cost & Prompt Caching | 274–323 |
| Environment Variables & Security | 324–336 |
| Security Model | 337–364 |

- [ ] **Step 3: No commit**

This task produces only a scratchpad file. Nothing to stage.

---

## Task 2: `docs/storage.md`

**Files:**
- Create: `docs/storage.md`

- [ ] **Step 1: Extract the section verbatim**

```bash
sed -n '117,162p' README.md > <scratchpad>/storage-body.md
wc -c <scratchpad>/storage-body.md
```

Expected: **3658** bytes, matching Task 1's baseline for `## Storage Backends`.

⚠️ If the byte count differs, stop. Either the line range moved or the extraction is wrong; do not write a file whose content you have not accounted for.

- [ ] **Step 2: Write the file**

Create `docs/storage.md` (LF) with this header, then the extracted body with its `##`/`###` headings **demoted by one level** (`## Storage Backends` becomes the `#` title; `### Browser support` becomes `## Browser support`, and so on):

```markdown
# Storage backends

Where a workspace lives, which browsers can hold one, what happens when two
tabs edit at once, and how to recover a workspace that will not load.

This file owns the subject. `README.md` links here rather than summarising it.
```

The remaining content is lines 118–162 of README (everything after the `## Storage Backends` heading line), with `###` → `##`.

- [ ] **Step 3: Verify nothing was dropped**

```bash
wc -c docs/storage.md
grep -c "^## " docs/storage.md
```

Expected: a byte count of **at least 3658** (the baseline body) plus the new header — so roughly **3900–4000** — and **3** second-level headings (Browser support, Multi-tab editing, Emergency recovery), each demoted from `###`.

Report the actual byte count. A count near 3658 means the header is missing; a count well under it means prose was dropped in the move.

- [ ] **Step 4: Confirm line endings**

```bash
git ls-files --eol docs/storage.md
node -e "const s=require('fs').readFileSync('docs/storage.md','utf8');console.log('CR:',(s.match(/\r/g)||[]).length)"
```

Expected: `CR: 0`. (`git ls-files --eol` reports nothing until the file is staged; stage it in Step 5 and re-run if you want the index view.)

- [ ] **Step 5: Commit**

```bash
git add docs/storage.md
git commit --only docs/storage.md -F - <<'EOF'
docs: give storage backends their own file

Moved verbatim from README, which was carrying 35 KB of reference material
and said so itself. Headings demoted one level; no prose rewritten.
EOF
echo "EXIT=$?"
```

---

## Task 3: `docs/integrations.md`

**Files:**
- Create: `docs/integrations.md`

⚠️ This file contains **both** ends of the `how-sign-in-works` link (README lines 199 and 203). That link stays intra-file and its slug must not change — do not reword the `#### How sign-in works` heading.

⚠️ It also contains **two** links to `#security-model` (lines 182 and 218) whose target lands in a **sibling** file. Those become `](security.md#security-model)` — a relative sibling path, not `docs/security.md#…`, because both files sit in `docs/`.

- [ ] **Step 1: Extract the section verbatim**

```bash
sed -n '163,221p' README.md > <scratchpad>/integrations-body.md
wc -c <scratchpad>/integrations-body.md
grep -n "](#" <scratchpad>/integrations-body.md
```

Expected: **7408** bytes, and three anchor links — two `#security-model`, one `#how-sign-in-works`.

- [ ] **Step 2: Write the file**

Create `docs/integrations.md` (LF) with this header, then the extracted body with headings demoted one level (`### Jira` → `## Jira`, `#### How sign-in works` → `### How sign-in works`):

```markdown
# Integrations

Jira, Microsoft 365 and Timelog: what each one connects to, how to configure
it, and where its credentials are kept.

This file owns the subject. `README.md` links here rather than summarising it.
```

- [ ] **Step 3: Repoint the two cross-file anchors, leave the third alone**

Change **only** the two `](#security-model)` links to `](security.md#security-model)`.

**Leave `](#how-sign-in-works)` exactly as it is** — its target heading is in this same file, so an intra-file link is correct and a `docs/`-prefixed one would be wrong.

⚠️ Demoting `#### How sign-in works` to `### How sign-in works` does **not** change its slug: the slug derives from the heading text, not its level. Task 9 verifies this rather than trusting it.

- [ ] **Step 4: Verify**

```bash
grep -n "](security.md#security-model)" docs/integrations.md
grep -n "](#how-sign-in-works)" docs/integrations.md
grep -n "^### How sign-in works" docs/integrations.md
node -e "const s=require('fs').readFileSync('docs/integrations.md','utf8');console.log('CR:',(s.match(/\r/g)||[]).length)"
```

Expected: two sibling links, one intra-file link, one matching heading, `CR: 0`.

- [ ] **Step 5: Commit**

```bash
git add docs/integrations.md
git commit --only docs/integrations.md -F - <<'EOF'
docs: give integrations their own file

Moved verbatim from README. The two Security Model links become sibling
links into security.md; the How-sign-in-works link stays intra-file because
both ends moved into this file together.
EOF
echo "EXIT=$?"
```

---

## Task 4: `docs/automation.md`

**Files:**
- Create: `docs/automation.md`

- [ ] **Step 1: Extract**

```bash
sed -n '222,254p' README.md > <scratchpad>/automation-body.md
wc -c <scratchpad>/automation-body.md
```

Expected: **2467** bytes.

- [ ] **Step 2: Write the file**

Create `docs/automation.md` (LF), headings demoted one level, with this header:

```markdown
# Automation and notifications

The scheduled reminders the app raises on its own: task due dates, RAID
review, stakeholder communication, birthdays, and Jira token expiry.

This file owns the subject. `README.md` links here rather than summarising it.
```

- [ ] **Step 3: Verify**

```bash
node -e "const s=require('fs').readFileSync('docs/automation.md','utf8');console.log('CR:',(s.match(/\r/g)||[]).length)"
grep -c "^## " docs/automation.md
```

Expected: `CR: 0`, and **5** second-level headings (the five reminder types).

- [ ] **Step 4: Commit**

```bash
git add docs/automation.md
git commit --only docs/automation.md -F - <<'EOF'
docs: give automation and notifications their own file

Moved verbatim from README. Headings demoted one level; no prose rewritten.
EOF
echo "EXIT=$?"
```

---

## Task 5: `docs/ai-cost.md`

**Files:**
- Create: `docs/ai-cost.md`

- [ ] **Step 1: Extract**

```bash
sed -n '274,323p' README.md > <scratchpad>/ai-cost-body.md
wc -c <scratchpad>/ai-cost-body.md
```

Expected: **6555** bytes.

- [ ] **Step 2: Write the file**

Create `docs/ai-cost.md` (LF), headings demoted one level, with this header:

```markdown
# AI cost and prompt caching

How the prompt is laid out so the cacheable prefix stays stable, what that
layout bought and what it cost, and the harness that measures prompt quality.

This file owns the subject. `README.md` links here rather than summarising it.
```

- [ ] **Step 3: Verify**

```bash
node -e "const s=require('fs').readFileSync('docs/ai-cost.md','utf8');console.log('CR:',(s.match(/\r/g)||[]).length)"
grep -c "^## " docs/ai-cost.md
```

Expected: `CR: 0`, and **3** second-level headings.

- [ ] **Step 4: Commit**

```bash
git add docs/ai-cost.md
git commit --only docs/ai-cost.md -F - <<'EOF'
docs: give AI cost and prompt caching their own file

Moved verbatim from README. Headings demoted one level; no prose rewritten.
EOF
echo "EXIT=$?"
```

---

## Task 6: `docs/security.md` — the merge

**Files:**
- Create: `docs/security.md`

⚠️ This is the one destination built from **two** README sections, and it is the target of **four** links. Both halves are one subject split across two headings today; merging gives it a single owner.

⚠️ The env-vars half contains a `](#security-model)` link (README line 335) whose target lands in **this same file**. It stays intra-file — do not prefix it.

- [ ] **Step 1: Extract both halves**

```bash
sed -n '324,336p' README.md > <scratchpad>/security-env.md
sed -n '337,364p' README.md > <scratchpad>/security-model.md
wc -c <scratchpad>/security-env.md <scratchpad>/security-model.md
```

Expected: **1294** and **2702** bytes.

- [ ] **Step 2: Write the merged file**

Create `docs/security.md` (LF) in this order — env vars first, because it is the shorter operational half and the model reads as its justification:

```markdown
# Security

What the app stores, where it stores it, what leaves the browser, and the
build-time environment variables that change any of that.

This file owns the subject. `README.md` links here rather than summarising it.

## Environment variables

<body of security-env.md, minus its own heading line>

## Security model

<body of security-model.md, minus its own heading line, with its ### headings kept at ###>
```

★ `## Environment variables` is deliberately **not** `## Environment Variables & Security`. The `&` produced the double-hyphen slug `environment-variables--security`, and the "& Security" half is redundant inside a file already called Security. The new slug is `environment-variables`, which Task 9 derives rather than assumes.

★ `## Security model` keeps the slug `security-model`, which is what the four inbound links target. **Do not reword this heading.**

- [ ] **Step 3: Leave the intra-file link alone**

The `](#security-model)` inside the env-vars body now points at a heading in its own file. Correct as-is.

- [ ] **Step 4: Verify**

```bash
grep -n "^## Environment variables$" docs/security.md
grep -n "^## Security model$" docs/security.md
grep -n "](#security-model)" docs/security.md
node -e "const s=require('fs').readFileSync('docs/security.md','utf8');console.log('CR:',(s.match(/\r/g)||[]).length)"
wc -c docs/security.md
```

Expected: both headings present, one intra-file link, `CR: 0`, and a byte count of **at least 3996** (1294 + 2702) plus the header.

- [ ] **Step 5: Commit**

```bash
git add docs/security.md
git commit --only docs/security.md -F - <<'EOF'
docs: merge environment variables and the security model into one file

They were one subject split across two README headings. The merged file owns
it outright, which is what lets README link rather than restate.

The env-vars heading loses its "& Security" suffix -- redundant inside a file
called Security, and the ampersand was producing a double-hyphen slug. The
Security model heading is unchanged because four inbound links target it.
EOF
echo "EXIT=$?"
```

---

## Task 7: Sample Workspace into CONTRIBUTING, Deploying into RUNBOOK

**Files:**
- Modify: `CONTRIBUTING.md`
- Modify: `docs/RUNBOOK.md`

⚠️ `CONTRIBUTING.md`'s script table is **generated** from `package.json` `scriptsDescriptions`. Adding a hand-written section is fine, but `npm run docs:scripts:check` must still pass afterwards — verify it in Step 4 rather than assuming.

- [ ] **Step 1: Extract both**

```bash
sed -n '255,264p' README.md > <scratchpad>/sample-workspace.md
sed -n '89,97p' README.md > <scratchpad>/deploying.md
wc -c <scratchpad>/sample-workspace.md <scratchpad>/deploying.md
```

Expected: **944** bytes for Sample Workspace. Deploying is part of the 2296-byte Quick Start and has no baseline of its own; record whatever it reports.

- [ ] **Step 2: Append Sample Workspace to CONTRIBUTING**

Insert the section into `CONTRIBUTING.md` after its **Project layout** section (it describes fixture files and a generator script, which is what that section is about). Keep the `## Sample Workspace` heading at `##` — CONTRIBUTING uses `##` for top-level sections.

Use the Edit tool, anchoring on the heading that follows Project layout. Assert the anchor matched once.

- [ ] **Step 3: Append Deploying to RUNBOOK**

Insert README's Deploying body into `docs/RUNBOOK.md` under its existing deployment material, as `## Deploying from a production build` (RUNBOOK already owns hosting, so this becomes a subsection of what is there rather than a competing top-level heading).

⚠️ Read RUNBOOK's existing deploy section first. If it already says the same thing, **do not duplicate it** — report that instead, and delete README's copy without adding a second one. The doc-set rule is that a fact lives in one place; two copies is the failure this whole plan is fixing.

- [ ] **Step 4: Verify both gates**

```bash
npm run docs:scripts:check > <scratchpad>/ds1.log 2>&1; echo "SCRIPTS_EXIT=$?"
cat <scratchpad>/ds1.log
npm run docs:claims:check > <scratchpad>/dc1.log 2>&1; echo "CLAIMS_EXIT=$?"
tail -1 <scratchpad>/dc1.log
```

Expected: `SCRIPTS_EXIT=0`, and `CLAIMS_EXIT=0` reporting **none added**.

- [ ] **Step 5: Commit**

```bash
git add CONTRIBUTING.md docs/RUNBOOK.md
git commit --only CONTRIBUTING.md docs/RUNBOOK.md -F - <<'EOF'
docs: move the sample workspace and deploy notes to their owners

Sample Workspace documents a generator script and a source-of-truth fixture,
which is developer-facing, so it belongs beside the project layout rather
than in a product README. Deploying belongs with the rest of hosting.
EOF
echo "EXIT=$?"
```

---

## Task 8: Rewrite README as the entry point

**Files:**
- Modify: `README.md`

⚠️ **The badge block (lines 3–6) is untouched.** Line 5 is the `version:sync` satellite. Copy it byte-for-byte; do not reformat, reorder or re-indent the badge block.

⚠️ README is edited **once**, here — not six times across Tasks 2–7 — so there is a single before/after to check rather than six intermediate states.

- [ ] **Step 1: Delete the seven moved sections**

Remove, by heading: `## Storage Backends`, `## Integrations`, `## Automation / Notifications`, `## Sample Workspace`, `## AI Cost & Prompt Caching`, `## Environment Variables & Security`, `## Security Model`.

Also remove `### Prerequisites` (lines 65–70) — `CONTRIBUTING.md` carries the same content verbatim — and `### Deploying` (lines 89–97), now in RUNBOOK.

- [ ] **Step 2: Fold the two pointer sections into the documentation map**

`## Full capability reference` (458 B) and `## Features` (180 B) are pointers at `docs/features.md`. The expanded map in Step 4 covers that, so delete both headings and their bodies.

- [ ] **Step 3: Rewrite Quick Start as Get started**

Replace `## Quick Start` with:

```markdown
## Get started

### Install the desktop app

Most people should use the desktop build: it installs per-user, needs no
admin rights, and requires neither Node.js nor a terminal.

Two things surprise people on a first run, and both are expected:

- Windows shows a **"Windows protected your PC"** box, because the app is not
  code-signed. Choose **More info → Run anyway**.
- The app **starts empty even if you have used it in your browser**. The
  desktop build keeps its own data store; nothing has been lost, and the
  browser version still has its own copy.

[docs/desktop-rollout.md](docs/desktop-rollout.md) has the full first-run
walkthrough, including which settings you need to re-enter and where the log
file lives if it does not start.

### Run from source

For development, or to run it without installing anything:

```bash
npm install        # install dependencies
npm run dev        # start the development server
```

Open [http://localhost:3000](http://localhost:3000).

No environment variables are required — every integration is configured in-app
via Settings. See [docs/security.md](docs/security.md#environment-variables)
for the optional build-time overrides.

For a production build, and for prerequisites and the full script table, see
[CONTRIBUTING.md](CONTRIBUTING.md).
```

Then keep the existing `### Development Scripts` table **as-is**, moved under `## Get started`.

★ It stays because it is getting-started material and already disclaims its own duplication in its closing paragraph — it names CONTRIBUTING as the authoritative copy and calls itself "a starting point, not a second inventory to keep in sync." That is the doc-set rule being followed, not broken.

- [ ] **Step 4: Replace Further reading with the documentation map**

```markdown
## Documentation

This README is the entry point. Each document below owns its subject outright
rather than restating this one.

| Document | What it owns |
|----------|--------------|
| [docs/features.md](docs/features.md) | The complete feature list — every capability the app ships, one row each, with the full description behind an expandable **Details** block. |
| [docs/storage.md](docs/storage.md) | Storage backends: file, Turso and IndexedDB; browser support; multi-tab editing; emergency recovery. |
| [docs/integrations.md](docs/integrations.md) | Jira, Microsoft 365 and Timelog — configuration, sign-in, and where credentials are kept. |
| [docs/automation.md](docs/automation.md) | The scheduled reminders the app raises on its own. |
| [docs/ai-cost.md](docs/ai-cost.md) | Prompt caching: the layout, what it bought and cost, and the prompt-quality harness. |
| [docs/security.md](docs/security.md) | What is stored where, what leaves the browser, and the build-time environment variables. |
| [docs/desktop-rollout.md](docs/desktop-rollout.md) | Installing the desktop app: what to expect on a first run and what to send when reporting a problem. |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Setup, the full script table, project layout, conventions, the testing layers, and the pull-request checklist. |
| [docs/RUNBOOK.md](docs/RUNBOOK.md) | Operations: build and deploy, hosting, security headers, rollback, secrets, monitoring, and a symptom-indexed list of common issues. |
| [docs/CODEMAPS/](docs/CODEMAPS/) | Five layered overviews of the codebase — architecture, frontend, backend, data, dependencies. |
| [AGENTS.md](AGENTS.md) | The always-loaded engineering reference: hard CI-enforced constraints and the landmines that have already cost someone a debugging session. |
```

- [ ] **Step 5: Repoint the two anchors that stay in README**

- Line 44 (*Built to be trusted*): `](#security-model)` → `](docs/security.md#security-model)`
- Line 87 was inside Quick Start and is replaced wholesale by Step 3's text, which already carries `](docs/security.md#environment-variables)`.

⚠️ Trim `## Why AI PM Cockpit` only by removing sentences, never by rewording claims. Several of them are measured statements about gates and coverage; a paraphrase can turn a true claim false.

- [ ] **Step 6: Prove the badge survived and the gate still reads it**

```bash
sed -n '1,8p' README.md
npm run version:check > <scratchpad>/vc-readme.log 2>&1; echo "EXIT=$?"
grep -i "readme" <scratchpad>/vc-readme.log
```

Expected: `EXIT=0` **and** the output naming `README.md`. **If the gate no longer mentions README, it has stopped reading it** — a satellite that is silently skipped passes forever. Do not proceed on a bare exit 0.

⚠️ `EXIT=2` is not drift, it is the gate failing to scan. Stop and report.

- [ ] **Step 7: Check the size landed**

```bash
wc -c README.md
awk '/^## /{if(n)printf "%7d  %s\n",b,n; n=$0; b=0; next} {b+=length($0)+1} END{if(n)printf "%7d  %s\n",b,n}' README.md
```

Expected: roughly **9 000–11 000** bytes, down from 35 214. Report the actual number. A result near 35 000 means a deletion did not apply; a result under 6 000 means something was removed that should have stayed.

- [ ] **Step 8: Commit**

```bash
git add README.md
git commit --only README.md -F - <<'EOF'
docs: make README an entry point

It was 35 KB across fourteen sections and said so itself -- "written to be
searched for the one section you need rather than read end to end." That is a
reference manual. Seven sections now live in files that own their subject.

Get started carries both audiences, desktop first: colleagues install a
signed-nothing per-user build and are told the two things that surprise them,
developers get three commands. Prerequisites is deleted because CONTRIBUTING
had it verbatim; Deploying moved to RUNBOOK.

The shields badge is untouched -- it is a version:sync satellite carrying
version and codename, and version:check was re-run to confirm it still NAMES
README rather than merely exiting 0.
EOF
echo "EXIT=$?"
```

---

## Task 9: Verify every anchor — and prove the check can fail

**Files:**
- Create: `<scratchpad>/check-anchors.mjs`

⚠️ **Nothing in this repo checks anchors.** A rotted `](file.md#slug)` renders as a working link that lands at the top of the page, so it fails silently and forever. This task is the only detector, which is why Step 3 proves it is not vacuous.

- [ ] **Step 1: Write the checker with the Write tool**

Do **not** write this with a heredoc. Create `<scratchpad>/check-anchors.mjs`:

```js
import { readFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";

// Every markdown link carrying a #fragment, in the files we touched.
const FILES = [
  "README.md",
  "CONTRIBUTING.md",
  "docs/storage.md",
  "docs/integrations.md",
  "docs/automation.md",
  "docs/ai-cost.md",
  "docs/security.md",
];

// GitHub's slug rule, applied to heading TEXT: lowercase, strip anything that
// is not word/space/hyphen, then spaces to hyphens.
//
// Derived, never hand-written. "Environment Variables & Security" yields
// "environment-variables--security" -- a DOUBLE hyphen, because the ampersand
// vanishes and both surrounding spaces become hyphens. An em dash does the
// same. Guessing that slug by eye is how these links rot.
function slug(headingText) {
  return headingText
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

function headingSlugs(file) {
  const out = new Set();
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = /^#{1,6}\s+(.*?)\s*$/.exec(line);
    if (m) out.add(slug(m[1]));
  }
  return out;
}

const cache = new Map();
function slugsFor(file) {
  if (!cache.has(file)) cache.set(file, headingSlugs(file));
  return cache.get(file);
}

let checked = 0;
const bad = [];

for (const file of FILES) {
  const text = readFileSync(file, "utf8");
  // ](path#frag) and ](#frag)
  const re = /\]\(([^)\s#]*)#([^)\s]+)\)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const [, path, frag] = m;
    const target = path === "" ? file : normalize(join(dirname(file), path));
    checked += 1;
    let slugs;
    try {
      slugs = slugsFor(target);
    } catch {
      bad.push(`${file}: target file missing -> ${target}`);
      continue;
    }
    if (!slugs.has(frag)) bad.push(`${file}: #${frag} not found in ${target}`);
  }
}

// ★★ A checker that examined nothing would pass. This floor is what makes a
// green run mean something: we know there are at least this many fragment
// links across these files.
const FLOOR = 6;
if (checked < FLOOR) {
  console.error(`VACUOUS: only ${checked} fragment links examined, expected >= ${FLOOR}`);
  process.exit(2);
}

for (const b of bad) console.error(b);
console.log(`checked ${checked} fragment links, ${bad.length} broken`);
process.exit(bad.length === 0 ? 0 : 1);
```

- [ ] **Step 2: Run it — expect green**

```bash
node <scratchpad>/check-anchors.mjs; echo "ANCHOR_EXIT=$?"
```

Expected: `ANCHOR_EXIT=0`, and a line reporting **at least 6** links checked and **0** broken. Report the actual count.

⚠️ `ANCHOR_EXIT=2` means the checker found almost no links and refused to certify anything — a different failure from a broken link, and the more dangerous one.

- [ ] **Step 3: Prove it fails on a bad link**

A check that cannot fail is not a check. Point one link at a heading that does not exist, observe the failure, then restore.

```bash
node <scratchpad>/break-anchor.mjs apply
node <scratchpad>/check-anchors.mjs; echo "MUTANT_EXIT=$?"
node <scratchpad>/break-anchor.mjs revert
node <scratchpad>/check-anchors.mjs; echo "RESTORED_EXIT=$?"
git diff --stat -- README.md
```

Write `<scratchpad>/break-anchor.mjs` with the Write tool:

```js
import { readFileSync, writeFileSync } from "node:fs";

const P = "README.md";
const mode = process.argv[2];
if (mode !== "apply" && mode !== "revert") throw new Error("pass apply|revert");

const GOOD = "](docs/security.md#security-model)";
const BAD = "](docs/security.md#security-model-typo)";

const s = readFileSync(P, "utf8");
if ((s.match(/\r/g) || []).length !== 0) throw new Error("expected an LF file, found CR bytes");

const from = mode === "apply" ? GOOD : BAD;
const to = mode === "apply" ? BAD : GOOD;

// Refuse to write on a miss: a silent no-op would make the mutation look
// survived, i.e. it would report the checker as vacuous when it is fine.
const hits = s.split(from).length - 1;
if (hits !== 1) throw new Error("anchor matched " + hits + " times, expected 1");

const out = s.replace(from, to);
if (out === s) throw new Error("replacement was a no-op");
if ((out.match(/\r/g) || []).length !== 0) throw new Error("output gained CR bytes");
writeFileSync(P, out, "utf8");
console.log("OK " + mode);
```

Expected: `MUTANT_EXIT=1` naming `#security-model-typo`, then `RESTORED_EXIT=0`, and an **empty** `git diff --stat` proving the revert was byte-exact.

⚠️ README is tracked and already committed by Task 8, so the empty diff is meaningful here. (It would not be for an untracked file — `git diff` says nothing about those.)

- [ ] **Step 4: No commit**

The helpers live in the scratchpad by design; nothing is staged.

---

## Task 10: Correct the generated-README claim — REWRITTEN 2026-09-10

⚠️ **This task as originally written was wrong twice over, and both errors were in
the plan rather than in the tree.** It was rewritten after measurement, before any
of it was executed. The original text is preserved in git at `a5a742cd`.

**What the original got wrong:**

1. **`AGENTS.md` does not carry the claim.** The only match for
   `grep -n "docs:scripts\|sync-script-docs\|GENERATED" AGENTS.md` is line 363,
   "New script → also add a `scriptsDescriptions` entry or docs:scripts:check
   fails" — which is **true** and names no second file. The false claim lives in
   the session memory file `scriptsdescriptions-is-a-three-file-change.md`, whose
   description reads "CONTRIBUTING.md and README.md are GENERATED". Correcting
   AGENTS.md would have meant editing a true statement.
2. **The prescribed verification could never answer the question.** The plan said
   to run `grep -n "README" scripts/sync-script-docs.mjs` and read an empty result
   as proof. But that script takes **no file list**: `findDocs()` walks top-level
   `*.md` plus `docs/**/*.md`, and `syncFile` includes a file only if it carries
   the **marker pair** `<!-- AUTO-GENERATED from package.json scripts -->` …
   `<!-- END` + `AUTO-GENERATED -->`. Participation is **discovered, never named**,
   so that grep returns nothing whether the claim is true or false. It is the
   grep-granularity failure: a command that confirms whatever you already believed.

   ★★★ **The end marker is split above on purpose, and this file is why.** Written
   whole, it made THIS PLAN a participant: `findDocs` walks `docs/**/*.md`, which
   includes `docs/superpowers/`, and `syncFile` matches `START[\s\S]*?END` — so the
   generator wanted to overwrite the span between the two quoted markers with the
   scripts table. `docs:scripts:check` caught it, reporting
   `would-update: docs/superpowers/plans/2026-09-10-readme-restructure.md`. A
   document that quotes a marker-based mechanism becomes subject to it; `AGENTS.md`
   escapes the same fate only because its end marker happens to wrap across a line.
   Split any further mention, and re-run the gate after writing about this at all.

**What is actually true, measured 2026-09-10:**

- Only `CONTRIBUTING.md` carries the marker pair (`grep -rn "AUTO-GENERATED from
  package.json scripts" --include=*.md .` → one hit, `CONTRIBUTING.md:29`). So it
  is a **two**-file change today (`package.json` + `CONTRIBUTING.md`), not three.
- The memory was **true when written and was falsified by a later commit.**
  `git log --oneline -S"AUTO-GENERATED from package.json scripts" -- README.md`
  returns `43c0d5f4` (initial commit, markers added) and `be21ebf3`
  ("docs(readme): … curate the scripts table", markers removed). README's table
  is now a hand-curated six-command subset that disclaims itself in its own
  closing paragraph.

**Files:**
- Modify: `AGENTS.md` (add the marker-pair mechanism — a *new* fact, not a correction)
- Modify: the session memory file + its `MEMORY.md` index line (the actual correction)

- [ ] **Step 1: Re-derive both facts rather than trusting the prose above**

```bash
grep -rn "AUTO-GENERATED from package.json scripts" --include=*.md . | grep -v node_modules
grep -n "findDocs\|walkMd\|no-marker" scripts/sync-script-docs.mjs
git log --oneline -S"AUTO-GENERATED from package.json scripts" -- README.md
```

Expected: exactly one marker hit, in `CONTRIBUTING.md`; the discovery functions
present in the script; and the two commits above.

⚠️ If a **second** file carries the marker pair, this task's arithmetic changes —
report the count rather than writing "two".

- [ ] **Step 2: Add the mechanism to AGENTS.md**

The `npm run stop` bullet's trailing sentence stays as it is; it is true. Append
the fact that makes the trap avoidable next time — that participation is by marker
pair, so no filename grep over the script can enumerate it:

```
★★ WHICH docs it regenerates is DISCOVERED, never named: `findDocs` walks
top-level `*.md` + `docs/**/*.md` and `syncFile` skips any file lacking the
marker pair `<!-- AUTO-GENERATED from package.json scripts -->` … `<!-- END
AUTO-GENERATED -->`. So `grep README scripts/sync-script-docs.mjs` returns
nothing whether README participates or not — it CANNOT answer the question, and
was read as proof that it does not (2026-09-10). Enumerate the participants with
`grep -rn "AUTO-GENERATED from package.json scripts" --include=*.md .`, which
returns CONTRIBUTING.md ALONE today. ★ README carried the pair from the initial
commit until `be21ebf3` removed it; its table is now a hand-curated subset that
says so in its own closing paragraph. Read a count off the grep, not off this line.
```

- [ ] **Step 3: Verify the docs gates**

```bash
npm run docs:symbols:check > <scratchpad>/sym1.log 2>&1; echo "SYM_EXIT=$?"
tail -2 <scratchpad>/sym1.log
npm run docs:claims:check > <scratchpad>/dc2.log 2>&1; echo "CLAIMS_EXIT=$?"
tail -1 <scratchpad>/dc2.log
```

Expected: both `0`, claims reporting **none added**.

- [ ] **Step 4: Commit**

```bash
git add AGENTS.md
git commit --only AGENTS.md -F - <<'EOF'
docs(agents): say how sync-script-docs picks its files, because a grep cannot

The plan for this task told me to prove README is not generated by running
`grep -n "README" scripts/sync-script-docs.mjs` and reading the empty result
as evidence. That command cannot answer the question in either direction:
the script takes no file list. findDocs walks top-level *.md plus
docs/**/*.md, and syncFile skips anything lacking the marker pair, so
participation is discovered and no filename appears in the source at all.
An empty grep was going to confirm whatever I already believed.

The conclusion happened to be right -- CONTRIBUTING.md alone carries the
markers today -- but it was right by luck, and the honest check is one grep
for the marker pair across the docs. AGENTS.md now carries that, so the next
reader enumerates instead of inferring.

Also corrected the provenance: README carried the pair from the initial
commit until be21ebf3 curated its table down to six commands. The standing
note claiming both files are generated was true when written and was
falsified by that commit -- not an authoring error, ordinary decay.

AGENTS.md never actually claimed README was generated; its one nearby
sentence is true and is left alone.
EOF
echo "EXIT=$?"
```

---

## Task 11: Full local gate chain

**Files:** none — verification only.

⚠️ Run these **one at a time**, never two at once, and never read an exit code through a pipe.

- [ ] **Step 1: The four blocking docs/lint gates**

```bash
npm run version:check > <scratchpad>/g-version.log 2>&1; echo "VERSION_EXIT=$?"
grep -i readme <scratchpad>/g-version.log

npm run docs:claims:check > <scratchpad>/g-claims.log 2>&1; echo "CLAIMS_EXIT=$?"
tail -1 <scratchpad>/g-claims.log

npm run docs:scripts:check > <scratchpad>/g-scripts.log 2>&1; echo "SCRIPTS_EXIT=$?"

npm run docs:symbols:check > <scratchpad>/g-symbols.log 2>&1; echo "SYMBOLS_EXIT=$?"
```

Expected: all `0`; version:check **names README.md**; claims reports **none added**.

- [ ] **Step 2: Lint**

```bash
npx eslint --max-warnings=0 > <scratchpad>/g-lint.log 2>&1; echo "LINT_EXIT=$?"
grep -v "npm notice" <scratchpad>/g-lint.log | head -5
```

Expected: `LINT_EXIT=0`. (No source changed, but the whole-repo lint is cheap insurance that nothing else drifted.)

- [ ] **Step 3: Anchors**

```bash
node <scratchpad>/check-anchors.mjs; echo "ANCHOR_EXIT=$?"
```

Expected: `0`, at least 6 links checked, 0 broken.

- [ ] **Step 4: Accounting — nothing was lost**

```bash
wc -c README.md docs/storage.md docs/integrations.md docs/automation.md docs/ai-cost.md docs/security.md
```

Report the numbers against Task 1's baseline. The five new files should total **at least 25 028 bytes** minus the two headings removed during the merge, plus their new headers. README should be roughly 9–11 KB against its original 35 214.

⚠️ State the actual arithmetic in your report. "Content preserved" without numbers is the claim this task exists to replace.

- [ ] **Step 5: Confirm the tree is clean**

```bash
git status --porcelain
git log --oneline -9
```

Expected: clean tree, and the nine commits from Tasks 2–10.

---

## Definition of done

- README is an entry point of roughly 9–11 KB with two install paths, and the shields badge is byte-identical.
- Five new `docs/*.md` files each own one subject; Sample Workspace is in CONTRIBUTING and Deploying in RUNBOOK.
- All fragment links resolve, verified by a checker that was **proved able to fail** and that refuses to certify a run examining fewer than six links.
- `version:check` (naming README), `docs:claims:check` (none added), `docs:scripts:check`, `docs:symbols:check` and `eslint` are all green.
- AGENTS.md no longer claims README is generated.
- No version bump, no CHANGELOG, no push, no MR.
