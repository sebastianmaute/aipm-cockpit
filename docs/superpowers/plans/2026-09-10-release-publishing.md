# Release Publishing Implementation Plan (Part B)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `v*` tag publishes a GitLab Release whose asset link points at a Windows installer that provably carries that version.

**Architecture:** Three small CI jobs and two pure script libraries. A tag guard fails when the tag disagrees with `src/app/version.ts`, without stopping the rest of the pipeline — every other quality and build job still runs; only the tag build's own `needs:` waits on that guard, so a drifted tag skips the 20-minute wine build and the publish job downstream of it, instead of running them anyway; the existing manual `desktop-package` job splits into a hidden base plus a branch job and a tag job so artifact scope and retention can differ; a `release` stage job carries no `needs:` at all and relies on stage order (`dependencies: []` plus the default `when: on_success`) so it only runs once every earlier-stage job has succeeded, then calls the Releases API through `node:fetch` and attaches a per-tag artifact URL. All comparison and payload logic lives in pure, unit-tested `scripts/*-lib.mjs` modules — the CI YAML holds no logic.

**Tech Stack:** GitLab CI (self-managed,  (GitLab)), `electronuserland/builder:wine`, Node 24 (`node:24-bookworm-slim`, global `fetch`), vitest over `scripts/**/*.test.mjs`, electron-builder NSIS.

---

## Ground rules for every task

These are not suggestions. Each one has cost someone a debugging session in this repo.

- **Never read a gate's exit code through a pipe.** `npm run x | tail` gives you `tail`'s status and discards the diagnostic. Redirect, `echo "EXIT=$?"` unpiped, then grep the file.
- **Logs go in the scratchpad, never `/tmp`:**
  `C:\Users\SEBAST~1.MAU\AppData\Local\Temp\claude\C--Projects-aipm-cockpit\628bd54e-9e78-4bdb-86f3-b2e46f1a8c77\scratchpad`.
  Referred to below as `$SP`.
- **Never `git add -A` or `git add .`.** Stage explicit paths. **Never** stage `sample-workspace-huge.json` or `not-in-use.env.local.bak`.
- `git checkout -- <file>` and `git restore` are deny-blocked. **Never `git stash` in this worktree** (the stack is shared with other checkouts). **Never `--amend`.** `rm -rf` is gate-blocked — use PowerShell `Remove-Item -Recurse -Force`.
- **No shebang on any `.mjs` that a test imports.** A `#!` line on an imported module makes vitest throw, naming the *wrong* file. Libraries get no shebang; CLIs do.
- **`scripts/**`, `docs/**` and `AGENTS.md` are LF, blob and working copy alike. `.gitlab-ci.yml` is stored LF in the blob but THIS WORKING COPY is CRLF** (`git ls-files --eol .gitlab-ci.yml` → `i/lf w/crlf`, no `.gitattributes` entry for it) — edit it with the Edit tool only and preserve its CRLF working copy; do not re-line it to LF. Check any path with `git ls-files --eol <path>` before editing. **Never `sed -i`** — under Git Bash it re-lines a whole CRLF file, and `core.autocrlf=true` hides that from the diff.
- **Write helper scripts with the Write tool**, never a bash heredoc or inline `node -e`: this session measured backslashes being silently halved that way, corrupting a regex.
- **Never echo, log or commit `CI_JOB_TOKEN`**, any Turso URL, or any auth token. The publish script must not print its own headers.
- **No version bump, no CHANGELOG entry, no push, no tag, no MR** during Tasks 1–9. Task 10 is local gates. Task 11 requires the user's explicit say-so and is the only task that touches the remote.
- Commit trailer on every commit:
  `Claude-Session: https://[session link removed]`

### What is already done — do NOT re-implement

Measured 2026-09-10 against the working tree, not assumed:

| Spec section | State |
|---|---|
| §6.3 installer file name | **DONE.** `desktop/electron-builder.yml:5` already reads `artifactName: aipm-cockpit-${version}-setup.exe`, and the built file is `aipm-cockpit-0.301.0-setup.exe`. Task 3 only *verifies* it. |
| The `desktop-package` job | **EXISTS** at `.gitlab-ci.yml:468`, `stage: e2e`, `image: electronuserland/builder:wine`, `needs: [install]`, one rule (`- when: manual` with `allow_failure: true` indented under it), `artifacts.paths: [desktop/release/]`, `expire_in: 1 week`. Task 4 restructures it. |
| §6.5's warning | **ALREADY IN THE FILE** as a `★★` comment above the job, warning that a second rule omitting `allow_failure` defaults to FALSE. Task 4 must keep that comment true. |

## The numbers this plan rests on

All measured on 2026-09-10 from a real local package, so the implementer can check them rather than trust them:

| Thing | Measured |
|---|---|
| `desktop/release/win-unpacked/` | **314 MiB** — an expanded duplicate of the installer's own contents |
| `aipm-cockpit-0.301.0-setup.exe` | **97,353,634 bytes (97.4 MB / 92.8 MiB)** |
| `aipm-cockpit-0.301.0-setup.exe.blockmap` | **102,463 bytes** |
| A clean `desktop/release/` uploaded whole | ≈ **408 MiB** (314 + 93 + ~1), matching the spec's 407 |
| After narrowing to installer + blockmap | ≈ **93 MiB** (97.5 MB), a ~77% reduction |

Reproduce: `du -sm desktop/release/*` and `ls -l desktop/release/*.exe desktop/release/*.blockmap`. ★ `du -m` counts MiB (1,048,576 bytes), so every `du`-derived figure here is MiB; a decimal MB figure is 4.9% larger. An earlier revision labelled the installer "92.8 MB", which is its MiB figure under a decimal unit.

★★ **A local `desktop/release/` can hold TWO installers and that is not a bug.** electron-builder does not clean the directory, so a build predating the `artifactName` change leaves `aipm-cockpit Setup 0.301.0.exe` beside the new name — which is how a local `du` reports 500 MiB rather than 408. CI always starts clean. The globs chosen in Task 4 are self-protecting against this anyway: `*-setup.exe` does not match `aipm-cockpit Setup 0.301.0.exe` (capital S, spaces).

★★★ **THE ARTIFACT IS 92.9 MiB (97.5 MB — the installer plus its blockmap) AND GITLAB'S DEFAULT `max_artifacts_size` IS 100 MB PER JOB.** That is ~7.1% headroom if GitLab's "MB" there means MiB, and only ~2.5% if it is decimal — which unit it applies is NOT established here, so plan for the smaller figure. The spec records that the settings endpoint is admin-only and unreadable from here — so **this instance's real limit is unknown**, and 100 MB is the documented default, not a measured fact about  (GitLab). One electron bump or a few more bundled assets crosses it, and the failure lands as an upload error *after* a successful 20-minute build. Spike 1 measures it; Task 11 is where it is first observed.

## File structure

| File | Responsibility |
|---|---|
| `scripts/tag-version-lib.mjs` (new) | PURE. `classifyTag(tag, appVersion)` → `match` / `drift` / `unscannable`. No I/O, no `process.exit`, no shebang. |
| `scripts/tag-version-lib.test.mjs` (new) | Unit tests for the above, including the mismatch case the spec demands. |
| `scripts/check-tag-version.mjs` (new) | CLI. Reads `src/app/version.ts` via `version-sync-lib.mjs`, reads `CI_COMMIT_TAG`, owns the exit codes. Shebang. |
| `scripts/release-publish-lib.mjs` (new) | PURE. `buildAssetUrl(env, version)` and `buildReleasePayload(env, version, milestone)` (Task 5); `expectedFromPayload`, `classifyCreateResponse` and `classifyExistingRelease`, which decide every exit code the CLI can return (Task 6). No fetch, no I/O, no shebang. |
| `scripts/release-publish-lib.test.mjs` (new) | Unit tests, including that the token never appears in the payload, and every classifier branch and boundary. |
| `scripts/publish-release.mjs` (new) | CLI. Does the POST — and, after a 409, one GET — with `redirect: "manual"` and a 30 s timeout; maps the lib's verdicts to exit codes; supports `--dry-run`. Shebang. |
| `scripts/publish-release.integration.test.mjs` (new) | The CLI end to end: spawns it against a fake Releases API on an ephemeral port with a canary token — the redirect, the argument guard, the redaction and the trailing-slash strip, each mutation-proved (Task 6 Step 10). |
| `package.json` | Two scripts (`tag:check`, `release:publish`) **and** their `scriptsDescriptions` entries. |
| `CONTRIBUTING.md` | Regenerated script table (`npm run docs:scripts`). |
| `.gitlab-ci.yml` | `release` stage; `tag-version-check` job; `.desktop-package` hidden base + `desktop-package` + `desktop-package-tag`; `publish-release` job. |
| `docs/desktop-rollout.md` | Where a colleague downloads the installer. It currently says "from the share". |
| `docs/RUNBOOK.md` | The operator procedure for cutting a release. RUNBOOK owns operations; this is one. |
| `AGENTS.md` | Its CI pipeline bullet enumerates every job. A new CI gate means updating it — that file says so itself. |
| `docs/superpowers/specs/_probes/2026-09-10-wine-runner-and-artifact-size.md` (new) | Spike 1's finding. |

Two library/CLI splits, mirroring `followup-index-lib.mjs` + `check-followup-index.mjs`: pure logic is unit-testable and the CLI owns I/O and exit codes.

---

## Task 1: Spike — is the wine image reachable, and does a ~93 MiB artifact upload?

**Files:**
- Create: `docs/superpowers/specs/_probes/2026-09-10-wine-runner-and-artifact-size.md`

Both of the spec's §9 unknowns are answered by **one** manual run of the existing `desktop-package` job. Write the finding document now, with the procedure and the decision table, so the answer has somewhere to land and the decision is made *before* anyone is invested in the outcome.

⚠️ **This task writes a document. It does not run the job.** Running it needs a push, which is Task 11 and needs the user's explicit say-so.

- [ ] **Step 1: Write the finding document**

Create the file with exactly this content:

```markdown
# Spike: the wine runner and the artifact size limit

**Status:** OPEN — resolved by the first manual run of `desktop-package`.

Two unknowns, one measurement. Both are settled by triggering the existing
manual job once and reading its log.

## Questions

1. Can these runners pull and run `electronuserland/builder:wine`? It has never
   run here. The runners are Linux (`node:24-bookworm-slim` by default), so a
   Windows NSIS target needs wine, and that image is the only thing providing it.
2. Does a 92.9 MiB (97.5 MB) artifact — the installer plus its blockmap — clear
   this instance's `max_artifacts_size`? The setting is admin-only and
   unreadable from here. GitLab's documented DEFAULT is 100 MB per job: ~7.1%
   headroom if that "MB" means MiB, only ~2.5% if it is decimal. Which unit
   GitLab applies is NOT established here, so plan for the smaller figure.

## Procedure

1. Push the branch. Open the pipeline.
2. Run the `desktop-package` job manually.
3. Read the log for three things, in order:
   - **Image pull.** A failure here is question 1, answered NO.
   - **Build completion.** `electron-builder` printing a `.exe` path.
   - **Artifact upload.** A size rejection here is question 2, answered NO —
     and note it arrives AFTER a successful build, so a green build is not
     evidence the artifact survived.
4. If the job is green, download the artifact and confirm it is the installer
   plus its `.blockmap` and NOT `win-unpacked/`.

## Measured

_(fill in: date, pipeline URL, job outcome, artifact size as GitLab reports it)_

## Decision table — decided in advance, so the outcome cannot be rationalised

| Outcome | Action |
|---|---|
| Image unreachable | **DELETE the `desktop-package` and `desktop-package-tag` jobs, AND remove or disable `publish-release` in the same change.** Publish from a local Windows build instead, and say so in `docs/RUNBOOK.md`. A broken job left in place is worse than no job: it reports a red pipeline nobody can act on. ★★ Deleting the build jobs ALONE is worse still: `publish-release` has no `needs:`, so it would go on running on every tag and publish a Release whose asset link names a job that no longer exists — a green pipeline over a download that 404s. The build job's own comment in `.gitlab-ci.yml` prescribes the same. |
| Image fine, artifact rejected as too large | Keep the build job; **drop the Release asset link** and have `docs/desktop-rollout.md` point at a manually-uploaded copy. Do NOT chase the limit by splitting the installer — a two-part download is worse than a share link. |
| Both fine | Proceed with the rest of the plan unchanged. |

## What this does NOT establish

- Nothing about SmartScreen. A CI-built installer is unsigned and carries no
  Mark-of-the-Web until a browser downloads it (measured 2026-09-10:
  `Get-Item -Stream *` on a locally built installer returns `:$DATA` alone).
- Nothing about the auto-update feed. Spike 1 of the Electron plan owns that,
  and the design's §7 constrains it: an `internal` project serves no
  unauthenticated downloads, so an updater pointed here needs a credential on
  every laptop.
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/specs/_probes/2026-09-10-wine-runner-and-artifact-size.md
git commit --only docs/superpowers/specs/_probes/2026-09-10-wine-runner-and-artifact-size.md -F - <<'EOF'
docs(spike): the wine runner and the artifact size limit, decided in advance

Both of the design's first-run unknowns are answered by one manual run of the
existing job, so they share a finding. The decision table is written BEFORE the
measurement on purpose: "the image is unreachable" has an honest answer
(delete the job and publish locally) that is easy to argue out of once someone
has spent a day on it.

Records that 92.8 MB sits against a documented 100 MB default that nobody here
can read, and that a size rejection arrives AFTER a green build.

Claude-Session: https://[session link removed]
EOF
```

---

## Task 2: The tag/version guard — pure logic first

**Files:**
- Create: `scripts/tag-version-lib.mjs`
- Create: `scripts/tag-version-lib.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `scripts/tag-version-lib.test.mjs`:

```js
import { describe, expect, it } from "vitest";
import { classifyTag, describeVerdict, TAG_PREFIX } from "./tag-version-lib.mjs";

describe("classifyTag", () => {
  it("accepts a tag that names exactly the app version", () => {
    expect(classifyTag("v0.301.0", "0.301.0")).toEqual({
      verdict: "match",
      tag: "v0.301.0",
      appVersion: "0.301.0",
    });
  });

  // ★ The defect this whole guard exists to catch: tagging v0.302.0 on a tree
  // whose APP_VERSION is 0.301.0 publishes an installer that misreports its
  // own version.
  it("reports drift when the tag names a different version", () => {
    const r = classifyTag("v0.302.0", "0.301.0");
    expect(r.verdict).toBe("drift");
    expect(r.expected).toBe("v0.301.0");
  });

  // ★★★ MUTATION-PROVEN: deleting the `!tag.startsWith(TAG_PREFIX)` branch below
  // leaves this test green on ITS OWN, because "0.301.0" is missing the prefix
  // CHARACTER entirely — its stripped-remainder length already differs from
  // appVersion's ("0.301.0".slice(1) === ".301.0"), so the remainder-equality
  // check alone already rejects it. A wrong-but-same-length prefix character (a
  // capital "V", or any other single character) strips to the SAME remainder
  // and is caught ONLY by the startsWith check — and CI's tag-pipeline rules
  // fire on ANY tag, not merely v-prefixed ones, so this branch is the only
  // thing standing between `V0.301.0` and a publish.
  it("reports drift on a tag with no v prefix", () => {
    expect(classifyTag("0.301.0", "0.301.0").verdict).toBe("drift");
    expect(classifyTag("V0.301.0", "0.301.0").verdict).toBe("drift");
    expect(classifyTag("x0.301.0", "0.301.0").verdict).toBe("drift");
    // `expected` is built from TAG_PREFIX, not copied off the tag under test —
    // pin it here too, or a mutant that returns the wrong tag in `expected`
    // survives this test undetected.
    expect(classifyTag("0.301.0", "0.301.0").expected).toBe("v0.301.0");
  });

  // ★★ A version that is a PREFIX of the tagged one must not pass. Substring
  // comparison is the obvious wrong implementation here.
  it("reports drift when the tag merely starts with the version", () => {
    expect(classifyTag("v0.301.01", "0.301.0").verdict).toBe("drift");
    expect(classifyTag("v0.301.0-rc1", "0.301.0").verdict).toBe("drift");
  });

  // ★★★ UNSCANNABLE IS NOT DRIFT, and conflating them is the failure mode.
  // An empty CI_COMMIT_TAG means this job ran on a pipeline that is not a tag
  // pipeline — a rules bug. Reporting that as "drift" would send the reader to
  // version.ts — a file with nothing wrong in it.
  it("reports unscannable, not drift, on an absent tag", () => {
    expect(classifyTag("", "0.301.0").verdict).toBe("unscannable");
    expect(classifyTag(undefined, "0.301.0").verdict).toBe("unscannable");
    expect(classifyTag("   ", "0.301.0").verdict).toBe("unscannable");
    // Pin the reason text too, or swapping the tag-empty message for the
    // appVersion-empty one survives: it must point at CI's rules, not at
    // version.ts.
    expect(classifyTag("", "0.301.0").reason).toMatch(/rules/);
  });

  it("reports unscannable on an absent app version", () => {
    expect(classifyTag("v0.301.0", "").verdict).toBe("unscannable");
    // ★★ Dropping the `typeof appVersion !== "string"` half of this guard
    // survives every other test here and then THROWS on `undefined` (calling
    // .trim() on it) — a CLI wrapping this would report that as exit 1, the
    // DRIFT code, not "unscannable".
    expect(classifyTag("v0.301.0", undefined).verdict).toBe("unscannable");
  });

  it("exports the prefix it compares against", () => {
    expect(TAG_PREFIX).toBe("v");
  });
});

describe("describeVerdict", () => {
  // ★★★ THE DEFAULT CASE IS THE GUARD. A verdict describeVerdict does not
  // recognise -- a typo, a future fourth verdict, or classifyTag returning
  // nothing at all -- must resolve to exit 2 (CANNOT SCAN), never to a silent
  // exit 0. A guard that cannot classify must never report agreement.
  it("maps every verdict to its exit code and stream, and refuses to guess on the rest", () => {
    expect(describeVerdict(classifyTag("v0.301.0", "0.301.0"), "CI_COMMIT_TAG")).toMatchObject({
      code: 0,
      stream: "stdout",
    });
    expect(describeVerdict(classifyTag("v0.302.0", "0.301.0"), "CI_COMMIT_TAG")).toMatchObject({
      code: 1,
      stream: "stderr",
    });
    expect(describeVerdict(classifyTag("", "0.301.0"), "CI_COMMIT_TAG")).toMatchObject({
      code: 2,
      stream: "stderr",
    });
    expect(describeVerdict({ verdict: "ambiguous" }, "CI_COMMIT_TAG")).toMatchObject({
      code: 2,
      stream: "stderr",
    });
    expect(describeVerdict(undefined, "CI_COMMIT_TAG")).toMatchObject({ code: 2, stream: "stderr" });
    expect(describeVerdict(null, "CI_COMMIT_TAG")).toMatchObject({ code: 2, stream: "stderr" });
  });

  // ★★ Both versions are EQUAL when the tag is merely missing the "v" --
  // bumping src/app/version.ts cannot fix a prefix typo, and telling an
  // operator to do so is wrong advice baked into a passing gate.
  it("does not advise bumping version.ts when the tag lacks a v prefix", () => {
    const result = classifyTag("0.301.0", "0.301.0");
    expect(result.verdict).toBe("drift");
    const { message } = describeVerdict(result, "CI_COMMIT_TAG");
    expect(message).not.toMatch(/bump/i);
  });

  // ★ An empty env beats argv under the old `??` precedence, and the
  // unscannable message always named CI_COMMIT_TAG even when the value came
  // from argv. `source` fixes both: it must be threaded through, not
  // hardcoded.
  it("names the source passed in inside the unscannable message", () => {
    const result = classifyTag("", "0.301.0");
    expect(describeVerdict(result, "argv").message).toMatch(/argv/);
    expect(describeVerdict(result, "CI_COMMIT_TAG").message).toMatch(/CI_COMMIT_TAG/);
  });

  // ★★★ (real logic error, cold-review finding B) "0.302.0" is missing the
  // prefix -- but it ALSO names a version that does not exist yet. Deciding
  // the advice off `tag.startsWith(TAG_PREFIX)` alone sent an operator who
  // forgot to bump to "Re-tag as v0.301.0", i.e. re-tag an EXISTING release.
  // Drop the bump advice ONLY when the version underneath the tag already
  // matches appVersion -- the tag itself, or the tag with its leading
  // character stripped -- so the ONLY thing wrong really is the prefix.
  it("advises bumping only when the version underneath the tag is also wrong", () => {
    const adviceFor = (tag) => describeVerdict(classifyTag(tag, "0.301.0"), "CI_COMMIT_TAG").message;
    expect(adviceFor("0.301.0")).not.toMatch(/bump/i);
    expect(adviceFor("V0.301.0")).not.toMatch(/bump/i);
    expect(adviceFor("0.302.0")).toMatch(/bump/i);
    expect(adviceFor("V0.302.0")).toMatch(/bump/i);
  });

  // ★ A fully-prefixed tag naming the wrong version was never wrong, but
  // nothing pinned this branch directly before.
  it("advises bumping when the tag is correctly prefixed but names the wrong version", () => {
    const { message } = describeVerdict(classifyTag("v9.9.9", "0.301.0"), "CI_COMMIT_TAG");
    expect(message).toMatch(/bump/i);
  });

  // ★★★ A verdict string that merely STARTS WITH the same letter as a real
  // one ("mismatch" vs "match") must not be mistaken for it by a
  // startsWith/prefix-style check -- only exact equality may resolve a
  // verdict, and the default branch is what catches this.
  it("treats a verdict that merely resembles a real one as unrecognised", () => {
    const result = describeVerdict(
      { verdict: "mismatch", tag: "v0.301.0", appVersion: "0.301.0", expected: "v0.301.0" },
      "CI_COMMIT_TAG",
    );
    expect(result.code).toBe(2);
  });

  it("names the classifyTag reason inside the unscannable message", () => {
    const result = classifyTag("", "0.301.0");
    const { message } = describeVerdict(result, "CI_COMMIT_TAG");
    expect(message).toMatch(/rules/);
  });

  it("names both the tag and the version in the match message", () => {
    const result = classifyTag("v0.301.0", "0.301.0");
    const { message } = describeVerdict(result, "CI_COMMIT_TAG");
    expect(message).toContain("v0.301.0");
    expect(message).toContain("0.301.0");
  });

  it("includes classifyTag's detail in the drift message", () => {
    const result = classifyTag("v0.302.0", "0.301.0");
    const { message } = describeVerdict(result, "CI_COMMIT_TAG");
    expect(message).toContain(result.detail);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run scripts/tag-version-lib.test.mjs > "$SP/b-t2a.log" 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests |Cannot find" "$SP/b-t2a.log"
```

Expected: EXIT=1, failing to resolve `./tag-version-lib.mjs`.

- [ ] **Step 3: Write the library**

Create `scripts/tag-version-lib.mjs`:

```js
// Pure comparison of a git tag against version.ts's APP_VERSION.
//
// WHY: src/app/version.ts is the source of truth for the app version, and a
// release is cut by tagging. Nothing connects the two, so `v0.302.0` on a tree
// whose APP_VERSION is 0.301.0 publishes an installer that misreports itself —
// the same drift class `version-sync-check` catches among the six satellites,
// one level up.
//
// ★ NO SHEBANG. This module is imported by a vitest spec, and a `#!` line on an
// imported .mjs makes vitest throw naming the WRONG file. The CLI
// (check-tag-version.mjs) owns the shebang, the I/O and the exit codes.

// SOURCE_FILE is a plain exported string constant -- importing it here adds
// no I/O and no cycle (version-sync-lib.mjs does not import this module). It
// lets describeVerdict's messages name the file without the CLI having to
// stitch that in after the fact.
import { SOURCE_FILE } from "./version-sync-lib.mjs";

/** Tags are `v<version>`. Exported so the test compares against one source. */
export const TAG_PREFIX = "v";

/**
 * Classify a tag against the app version.
 *
 * Returns `{ verdict: "match" | "drift" | "unscannable", ... }`.
 *
 * ★★ THREE VERDICTS, NOT TWO, and the third is the load-bearing one. "drift"
 * means the two disagree and someone must fix a version. "unscannable" means
 * the comparison could not be made at all — an empty tag, i.e. this job ran on
 * a pipeline that is not a tag pipeline. A guard that cannot compare must never
 * report agreement, and must not send the reader to version.ts either.
 */
export function classifyTag(tag, appVersion) {
  if (typeof tag !== "string" || tag.trim() === "") {
    return {
      verdict: "unscannable",
      reason:
        "CI_COMMIT_TAG is empty — this job must run only on tag pipelines. Check its rules:, not version.ts.",
    };
  }
  if (typeof appVersion !== "string" || appVersion.trim() === "") {
    return {
      verdict: "unscannable",
      reason: "APP_VERSION came back empty — src/app/version.ts's shape moved.",
    };
  }

  const expected = `${TAG_PREFIX}${appVersion}`;

  if (!tag.startsWith(TAG_PREFIX)) {
    return {
      verdict: "drift",
      tag,
      appVersion,
      expected,
      detail: `tag does not start with "${TAG_PREFIX}"`,
    };
  }

  // ★ Compare the WHOLE remainder, never a prefix: "v0.301.01" and
  // "v0.301.0-rc1" both start with the version and are both wrong.
  if (tag.slice(TAG_PREFIX.length) !== appVersion) {
    return {
      verdict: "drift",
      tag,
      appVersion,
      expected,
      detail: "tag names a different version than src/app/version.ts",
    };
  }

  return { verdict: "match", tag, appVersion };
}

/**
 * Turn a classifyTag() result into what the CLI should print and how it
 * should exit: `{ code, stream, message }`, `stream` one of "stdout"/"stderr".
 *
 * ★★★ THE DEFAULT BRANCH IS THE WHOLE POINT OF THIS FUNCTION, not a fallback
 * bolted on afterward. A CLI whose success path is "the fall-through" reports
 * "ok" and exits 0 on a verdict it has never seen -- measured: a stubbed lib
 * returning `{verdict: "ambiguous"}` made the old inline CLI print "ok" and
 * exit 0. ANY result this function does not recognise as match/drift/
 * unscannable -- an unknown verdict string, or a null/undefined/non-object
 * result entirely (classifyTag threw, or a renamed export resolved to
 * `undefined` and was never called) -- resolves to exit 2, stderr, naming
 * what came back. A guard that cannot classify must never report agreement.
 *
 * `source` names where the CLI read the tag from ("argv" or "CI_COMMIT_TAG")
 * and is used only by the unscannable message, so the operator is told where
 * to look rather than always being pointed at CI_COMMIT_TAG.
 */
export function describeVerdict(result, source) {
  if (result === null || typeof result !== "object" || typeof result.verdict !== "string") {
    return {
      code: 2,
      stream: "stderr",
      message: `[tag:check] CANNOT SCAN: classifyTag returned an unrecognised result (${JSON.stringify(result)}).`,
    };
  }

  if (result.verdict === "match") {
    return {
      code: 0,
      stream: "stdout",
      // ★ NAME both values on success. A bare exit 0 cannot be told apart
      // from a gate that stopped reading the file.
      message: `[tag:check] ok — tag ${result.tag} matches ${SOURCE_FILE} version=${result.appVersion}`,
    };
  }

  if (result.verdict === "drift") {
    // ★★★ Drop the bump advice ONLY when the version UNDERNEATH the tag
    // already matches appVersion -- never merely because the tag lacks
    // TAG_PREFIX. `tag.startsWith(TAG_PREFIX)` was the wrong predicate:
    // "0.302.0" is ALSO un-prefixed, but it names a version that does not
    // exist yet, so "Re-tag as v0.301.0" would send an operator who forgot
    // to bump to re-tag an EXISTING release instead. The right question is
    // whether stripping (at most) the bad leading character recovers
    // appVersion -- i.e. whether the prefix really is the ONLY thing wrong.
    const onlyPrefixWrong = result.tag === result.appVersion || result.tag.slice(1) === result.appVersion;
    const advice = onlyPrefixWrong
      ? `Re-tag as ${result.expected} — ${SOURCE_FILE} already says ${result.appVersion}.`
      : `Either tag ${result.expected} instead, or bump ${SOURCE_FILE} (and propagate with \`npm run version:sync\`) before tagging.`;
    return {
      code: 1,
      stream: "stderr",
      message:
        `[tag:check] DRIFT: tag ${result.tag} but ${SOURCE_FILE} says ${result.appVersion} — ${result.detail}.\n` +
        `[tag:check] ${advice}`,
    };
  }

  if (result.verdict === "unscannable") {
    return {
      code: 2,
      stream: "stderr",
      message: `[tag:check] CANNOT SCAN (source: ${source}): ${result.reason}`,
    };
  }

  return {
    code: 2,
    stream: "stderr",
    message: `[tag:check] CANNOT SCAN: classifyTag returned an unrecognised verdict "${result.verdict}".`,
  };
}
```

- [ ] **Step 4: Run it and watch it pass**

```bash
npx vitest run scripts/tag-version-lib.test.mjs > "$SP/b-t2b.log" 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " "$SP/b-t2b.log"
```

Expected: EXIT=0, `Test Files  1 passed (1)`, `Tests  16 passed (16)` (derive it with `grep -c "  it(" scripts/tag-version-lib.test.mjs` rather than trusting this line — the `classifyTag` describe block above accounts for 7, and the `describeVerdict` describe block, grown over two review rounds, accounts for the other 9). **Assert the count against `grep -c`** — a missing test path mixed with a real one is dropped silently at exit 0.

- [ ] **Step 5: Commit**

```bash
git add scripts/tag-version-lib.mjs scripts/tag-version-lib.test.mjs
git commit --only scripts/tag-version-lib.mjs scripts/tag-version-lib.test.mjs -F - <<'EOF'
feat(ci): pure tag-vs-APP_VERSION comparison

version.ts is the source of truth for the version and a release is cut by
tagging, but nothing connects the two: v0.302.0 on a 0.301.0 tree publishes an
installer that misreports itself.

Three verdicts, not two. "unscannable" (an empty CI_COMMIT_TAG, i.e. a rules
bug that ran this on a non-tag pipeline) is deliberately NOT "drift", which
would send the reader to version.ts to fix a file that is correct.

Compares the whole remainder rather than a prefix -- v0.301.01 and v0.301.0-rc1
both start with the version and are both wrong. Pinned by tests.

Claude-Session: https://[session link removed]
EOF
```

---

## Task 3: The guard CLI, and proving it goes red

**Files:**
- Create: `scripts/check-tag-version.mjs`
- Modify: `package.json` (`scripts` + `scriptsDescriptions`)
- Regenerate: `CONTRIBUTING.md`

- [ ] **Step 1: Write the CLI**

Create `scripts/check-tag-version.mjs`:

```js
#!/usr/bin/env node
// Fail a tag pipeline whose tag disagrees with src/app/version.ts.
//
// EXIT CODES, following version:check's convention in this repo:
//   0  the tag names exactly APP_VERSION
//   1  DRIFT — they disagree; fix the tag or version.ts
//   2  the gate could not do its job (no tag, version.ts's shape moved, or a
//      classification this script does not recognise)
//
// ★★ 1 and 2 demand opposite responses, which is why they are separate: a gate
// that scans nothing passes everything, so 2 must never be reported as 0 and
// must not be reported as 1 either.
//
// ★★★ EVERYTHING RUNS INSIDE ONE TOP-LEVEL TRY, including the two library
// imports. A STATIC `import` can't be caught: a renamed export in either lib
// throws at module-load time, before any of this file's own code runs, and
// prints a raw Node stack that reads as a crashed tool rather than "the gate
// could not scan". `await import()` rejects into the same catch as every
// other failure here, so a moved shape always exits 2 with a clean message.
import { readFileSync } from "node:fs";

// ★ argv wins over env, and the source travels with the value: an empty
// CI_COMMIT_TAG used to beat a real argv value under `??`, and the
// unscannable message always named CI_COMMIT_TAG even when the tag came from
// argv. Both are fixed by resolving them together, once.
//
// ★★ A blank/whitespace-only argv (`node check-tag-version.mjs "   "`) is
// treated as ABSENT, not as a real tag -- without this, that call reported
// "(source: argv): CI_COMMIT_TAG is empty", which both blames the wrong
// variable and ignores a real CI_COMMIT_TAG sitting right there in env.
const argvTag = process.argv[2];
const hasArgvTag = typeof argvTag === "string" && argvTag.trim() !== "";
const tag = hasArgvTag ? argvTag : process.env.CI_COMMIT_TAG || "";
const source = hasArgvTag ? "argv" : "CI_COMMIT_TAG";

try {
  const { SOURCE_FILE, readSourceFrom } = await import("./version-sync-lib.mjs");
  const { classifyTag, describeVerdict } = await import("./tag-version-lib.mjs");

  // readSourceFrom THROWS when the declaration shape moved, which lands in
  // the catch below exactly like every other structural failure. ★ It also
  // requires APP_MILESTONE, so a MILESTONE-only shape change blocks this tag
  // gate too (exit 2) even though this guard never reads the milestone
  // itself -- deliberate: readSourceFrom is the ONE parser for version.ts's
  // shape, and keeping a single parser means a moved shape can never pass
  // here while version-sync-check already fails it on its own gate.
  const appVersion = readSourceFrom(readFileSync(SOURCE_FILE, "utf8")).version;

  const result = classifyTag(tag, appVersion);
  const { code, stream, message } = describeVerdict(result, source);

  if (stream === "stdout") console.log(message);
  else console.error(message);

  // ★★★ (D) DO NOT TRUST describeVerdict's `code` BLINDLY, even though it is
  // this file's own sibling module. Clamp to the only two codes that may ever
  // leave this branch un-widened (0 and 1), and even 0 is accepted ONLY when
  // the result's own verdict says "match" -- a describeVerdict bug (or a
  // future verdict wired through with code 0 by mistake) still exits 2
  // rather than silently passing a tag pipeline.
  const verdictIsMatch = result && typeof result === "object" && result.verdict === "match";
  const exitCode = code === 0 ? (verdictIsMatch ? 0 : 2) : code === 1 ? 1 : 2;
  process.exit(exitCode);
} catch (err) {
  // ★★ No path above may exit 0 or 1 from here down — a structural failure
  // (a missing file, a moved declaration shape, a renamed export resolving
  // to `undefined` and throwing when called) is exit 2, the same code
  // describeVerdict uses for a verdict it cannot classify. Before this
  // rewrite, only the readFileSync/readSourceFrom read was guarded, so a
  // throw from anything after it — or from this file's own logic — fell
  // through to Node's default exit 1, which is the DRIFT code.
  //
  // ★ (A) `err` is not guaranteed to be an Error -- `throw undefined` or
  // `throw null` from a lib crashes a bare `err.message` read and exits 1
  // (Node's default for an uncaught throw), which is the DRIFT code, not
  // "the gate could not scan". Never read `.message` off `err` directly.
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`[tag:check] CANNOT SCAN: ${msg}`);
  process.exit(2);
}
```

- [ ] **Step 2: Prove it goes GREEN on a matching tag**

`src/app/version.ts` reads `0.301.0` today; read it rather than trusting that.

```bash
node -e "console.log(require('fs').readFileSync('src/app/version.ts','utf8').match(/APP_VERSION = \"([^\"]+)\"/)[1])"
CI_COMMIT_TAG=v0.301.0 node scripts/check-tag-version.mjs; echo "MATCH_EXIT=$?"
```

Expected: `MATCH_EXIT=0` and a line naming BOTH the tag and the version. If the version above is not `0.301.0`, use whatever it printed.

- [ ] **Step 3: Drive it RED — the spec demands this explicitly**

```bash
CI_COMMIT_TAG=v9.9.9 node scripts/check-tag-version.mjs; echo "DRIFT_EXIT=$?"
CI_COMMIT_TAG=0.301.0 node scripts/check-tag-version.mjs; echo "NOPREFIX_EXIT=$?"
CI_COMMIT_TAG= node scripts/check-tag-version.mjs; echo "UNSCANNABLE_EXIT=$?"
CI_COMMIT_TAG= node scripts/check-tag-version.mjs v0.301.0; echo "ARGV_EXIT=$?"
```

Expected: `DRIFT_EXIT=1`, `NOPREFIX_EXIT=1`, `UNSCANNABLE_EXIT=2`, `ARGV_EXIT=0` (argv wins over an empty env var, and it is genuinely read — this is the only row in this step that isn't a red case).

★★★ **If the mismatched tag exits 0, the guard is vacuous and nothing else in this plan matters** — a green release pipeline would then be publishing an installer that lies about its version, which is the single failure this task exists to prevent.

- [ ] **Step 4: Add the npm script and its description**

Edit `package.json` with the **Edit tool** (the file is `i/lf w/crlf`; never `sed -i`). Add to `"scripts"`, after `"desktop:package"`:

```json
    "tag:check": "node scripts/check-tag-version.mjs"
```

And to `"scriptsDescriptions"`, after its `"desktop:package"` entry:

```json
    "tag:check": "Assert the current tag names exactly src/app/version.ts's APP_VERSION. Reads CI_COMMIT_TAG (or argv[2] locally). Exit 1 is DRIFT — the tag and version.ts disagree, so an installer would misreport its own version; exit 2 means the gate could not scan at all (no tag, or version.ts's shape moved), which demands the opposite response. BLOCKING on tag pipelines."
```

★ A new script **requires** a `scriptsDescriptions` entry or `npm run docs:scripts:check` fails.

- [ ] **Step 5: Regenerate the generated script table and check it**

```bash
npm run docs:scripts > "$SP/b-t3-gen.log" 2>&1; echo "GEN_EXIT=$?"
npm run docs:scripts:check > "$SP/b-t3-chk.log" 2>&1; echo "CHK_EXIT=$?"
grep -E "unchanged|would-update|updated" "$SP/b-t3-gen.log" "$SP/b-t3-chk.log"
```

Expected: both EXIT=0, and the check reporting `unchanged: CONTRIBUTING.md`.

★★ **Which docs the generator rewrites is DISCOVERED, never named** — it walks top-level `*.md` plus `docs/**/*.md` and includes a file only if it carries the marker pair: an opening `<!-- AUTO-GENERATED from package.json scripts -->` and a closing comment reading `END
AUTO-GENERATED`. So grepping the script for a filename cannot answer which files participate. Enumerate instead:

★★★ **THAT CLOSING MARKER IS DELIBERATELY BROKEN ACROSS A LINE BREAK ABOVE, AND MUST STAY BROKEN.** The matcher is `START[\s\S]*?END` over any `docs/**/*.md`, so a plan that quotes both markers intact makes ITSELF a participant — `docs:scripts:check` then reports `would-update` on this very file and the generator would replace this section with the script table. Measured twice: once on the Part A plan, once here. `AGENTS.md` escapes it only because its own closing marker happens to wrap; that is now intentional there too.
`grep -rn "AUTO-GENERATED from package.json scripts" --include=*.md .` — which returns `CONTRIBUTING.md` alone today, making this a two-file change.

- [ ] **Step 6: Verify §6.3 is already satisfied**

No edit — a check, because the spec lists it as work and it landed with the branding change:

```bash
grep -n "artifactName" desktop/electron-builder.yml
ls desktop/release/*.exe 2>/dev/null
```

Expected: `artifactName: aipm-cockpit-${version}-setup.exe` (a literal `${version}` — that is electron-builder's placeholder, not shell interpolation), and any built installer carrying the hyphenated, space-free name. **Nothing to change.** If a stale `aipm-cockpit Setup <version>.exe` also exists, that is a leftover from a pre-`artifactName` build, not a defect.

- [ ] **Step 7: Commit**

```bash
git add scripts/check-tag-version.mjs package.json CONTRIBUTING.md
git commit --only scripts/check-tag-version.mjs package.json CONTRIBUTING.md -F - <<'EOF'
feat(ci): tag:check gate, driven red

Wires the pure comparison to a CLI with the two-exit-code split this repo uses
for version:check: 1 is DRIFT (fix the tag or version.ts), 2 is the gate unable
to scan (no tag, or the declaration shape moved). A gate that scans nothing
passes everything, so those cannot share a code.

Proved non-vacuous rather than asserted: v9.9.9 exits 1, a v-less 0.301.0 exits
1, an empty tag exits 2, and the matching tag exits 0 while NAMING both values
-- a bare 0 cannot be told from a gate that stopped reading the file.

Claude-Session: https://[session link removed]
EOF
```

---

## Task 4: Restructure the packaging job — scope, retention, and an explicit `allow_failure`

**Files:**
- Modify: `.gitlab-ci.yml` (the `stages:` list at the top; the `desktop-package` job at ~line 468)

This is the spec's §6.2 and §6.5. Read the existing job and the `★★` comment above it before editing.

★★★ **`artifacts:expire_in` cannot vary per `rules:` entry**, so the asymmetry the spec asks for (branch `1 week`, tag `never`) cannot be expressed in one job. Hence a hidden base plus two concrete jobs. This is true regardless of whether `expire_in` expands CI variables — the two jobs also differ in `rules` and in `allow_failure`, so they would need splitting anyway. Do not try to collapse them.

★★★ **The tag job's NAME is part of every published download URL** (`?job=desktop-package-tag`, Task 6). Renaming it silently 404s every asset link in every past Release. If you rename it, you must re-point historical Releases by hand.

- [ ] **Step 1: Add the `release` stage**

Edit `.gitlab-ci.yml`'s opening block to:

```yaml
stages:
  - install
  - quality
  - build
  - e2e
  # Tag pipelines only: publishes the Release that points at e2e's installer.
  # A separate stage rather than a `needs:` inside e2e, so the ordering is
  # visible in the pipeline graph and does not depend on same-stage needs --
  # and, more to the point, so STAGE ORDER is what makes publish-release wait
  # on every earlier-stage gate before it runs (Task 7).
  - release
```

- [ ] **Step 2: Replace the `desktop-package` job with a base plus two jobs**

`5fa964cf` already rewrote the comment block above the job — the header used to call the job MANUAL without distinguishing branch from tag, which stopped being true once this split exists, so it now names `desktop-package-tag` and says the tag path is automatic and BLOCKING. The rewritten header is reproduced below, verbatim, **extended** with the `★★`/`★★★` `allow_failure` notes. Replace from `desktop-package:` to the end of its `artifacts:` block with:

```yaml
# Windows desktop installer. On a BRANCH this stays MANUAL: the build is slow
# and the artifact is large, so running it per-MR would dominate pipeline time
# and storage for no signal. On a TAG it is automatic and BLOCKING -- see
# desktop-package-tag below, not "MANUAL" -- a release must not silently skip
# its own installer.
#
# ★ The runners are Linux, so a Windows NSIS target needs wine — that is what
# this image provides. If this image is ever unreachable from this GitLab
# instance, DELETE this base and both desktop-package jobs rather than leaving
# them broken -- and remove or disable publish-release IN THE SAME CHANGE. It
# has no needs:, so on its own it would go on running on every tag and publish
# a Release whose asset link names a job that no longer exists: a green
# pipeline over a download that 404s. Local packaging on Windows
# (npm run desktop:package) is the supported path either way.
#
# ★★ This REBUILDS the app with NEXT_STANDALONE=1 rather than consuming the
# build job's artifact. That is deliberate and is the one place the
# never-rebuild rule does not hold: `build` produces a NON-standalone .next/,
# so the artifact is the wrong SHAPE, not merely stale.
#
# ★★ allow_failure was indented under the `- when: manual` rule ONLY, mirroring
# dast-zap. A rules entry that omits it defaults to FALSE, so a second rule
# added here without its own allow_failure would make this job BLOCKING on any
# pipeline that matched it.
#
# ★★★ THAT SECOND RULE NOW EXISTS, AS ITS OWN JOB, AND ITS allow_failure IS
# DELIBERATELY ABSENT. desktop-package-tag is BLOCKING: a release that silently
# did not build is worse than a red pipeline. desktop-package ITSELF also
# gained a second rule (`if: $CI_COMMIT_TAG` -> `when: never`), and that one
# omits allow_failure too -- harmless, because `when: never` means the rule
# never produces a job at all, so there is nothing for allow_failure to apply
# to. The two concrete jobs also carry different artifact retention, which
# `artifacts:expire_in` cannot express per-rule -- that is why this is a base
# plus two jobs rather than one job with two rules.
.desktop-package:
  stage: e2e
  image: electronuserland/builder:wine
  needs: [install]
  script:
    - NEXT_STANDALONE=1 npm run build
    - npm run desktop:copy-static
    - npm --prefix desktop ci || npm --prefix desktop install
    - npm --prefix desktop run build
    - npm run desktop:package
    # ★★★ an empty glob match only makes the RUNNER log "No files to upload"
    # and leaves the job GREEN with no artifact. Fail loudly instead -- `ls`
    # exits non-zero when either glob matches nothing, so list both globs.
    - ls -l desktop/release/*-setup.exe desktop/release/*-setup.exe.blockmap
  artifacts:
    # ★★★ THE INSTALLER AND ITS BLOCKMAP, NEVER desktop/release/ WHOLE. This is
    # a defect fix, not an optimisation: measured 2026-09-10, the directory is
    # ~408 MiB of which win-unpacked/ is 314 MiB -- an expanded duplicate of the
    # installer's own contents. Narrowed it is ~93 MiB (97.5 MB).
    #
    # ★ The globs are self-protecting against a stale pre-artifactName build:
    # `*-setup.exe` does not match `aipm-cockpit Setup 0.301.0.exe`. CI starts
    # clean anyway; a local tree may hold both.
    #
    # ★★ 92.9 MiB (97.5 MB) sits against a documented 100 MB max_artifacts_size DEFAULT
    # that is admin-only and unreadable from here. A rejection arrives AFTER a
    # green 20-minute build. See the spike finding under specs/_probes/.
    #
    # ★ `extends:` deep-merges HASHES ("You can use extends to merge hashes
    # but not arrays" -- GitLab docs), so a concrete job below that overrides
    # `artifacts:` to set only its own `expire_in` still inherits `paths` from
    # HERE and must NOT repeat it -- an earlier revision of this comment (and
    # of the plan) wrongly claimed extends "would otherwise drop paths".
    # Proven with the merge verifier (Task 4 Step 4), not by reasoning about
    # merge semantics.
    paths:
      - desktop/release/*-setup.exe
      - desktop/release/*-setup.exe.blockmap

desktop-package:
  extends: .desktop-package
  rules:
    # NOT on tags -- desktop-package-tag owns those, and two wine builds per
    # pipeline would double the slowest job in it.
    - if: $CI_COMMIT_TAG
      when: never
    - when: manual
      allow_failure: true
  artifacts:
    expire_in: 1 week

desktop-package-tag:
  extends: .desktop-package
  # ★★★ CRITICAL: also needs the tag guard, not just install. GitLab evaluates
  # `needs:` purely against the STATUS of what is listed (atomic_processing_
  # service.rb; docs: "Jobs start as soon as their dependencies finish without
  # waiting for pipeline stages to complete") -- with needs: [install] alone,
  # a drifted tag would still run this wine build to completion, and a
  # publish job wired by needs: to this job would still have created a
  # Release whose per-tag asset URL then 404s, because that URL resolves only
  # through a pipeline GitLab calls SUCCESSFUL. Task 7's publish-release
  # therefore carries no needs: and is gated by stage order instead. Listing
  # tag-version-check here makes this job WAIT for the guard; that a FAILED
  # guard then SKIPS it is expected needs: behaviour, but no GitLab doc
  # checked here states it and no tag pipeline has shown it.
  # ★ Deliberately NOT on the .desktop-package BASE above -- a branch pipeline
  # has no tag-version-check job, and a base needs: naming a job that does not
  # exist on that pipeline fails pipeline CREATION ("needs ... not added").
  needs: [install, tag-version-check]
  # ★★★ NO allow_failure, ON PURPOSE. See the comment above the base job.
  rules:
    - if: $CI_COMMIT_TAG
  artifacts:
    # ★★★ never, because docs/desktop-rollout.md (linked from README) tells
    # people to download this. An expiring artifact is fine for a manual check and
    # unacceptable behind a published Release asset link -- the link would go
    # dead silently, weeks later, with nothing failing.
    expire_in: never
```

★ `artifacts.paths` is declared ONCE, on the base, and inherited by both concrete jobs — NOT repeated in each. `extends` deep-merges HASHES, so a concrete job that overrides `artifacts:` to set only its own `expire_in` still inherits `paths` from the base. An earlier revision of this plan claimed the opposite (that `extends` "would otherwise drop `paths`"), which is false and was corrected here and in the base job's own comment; both concrete jobs resolving `paths` is verified in Step 4 by reading the merged config, not by reasoning about merge semantics.

★ **Declined:** loosening all three tag rules to `if: $CI_COMMIT_TAG =~ /^v/` was considered and rejected. Keeping the bare `if: $CI_COMMIT_TAG` means a non-`v` tag still matches every one of these jobs and fails LOUDLY at `tag-version-check` (which compares against `v$APP_VERSION`), rather than silently excluding itself from the guard while `publish-release` (Task 7) would otherwise still be free to run with no build behind it.

- [ ] **Step 3: Add the tag guard job**

Insert into the `quality` stage section (beside the other blocking gates):

```yaml
# Tag pipelines only: refuse a tag that disagrees with src/app/version.ts.
#
# ★ needs: [] so it runs IMMEDIATELY, without waiting for the rest of the
# quality stage.
# ★★ desktop-package-tag lists THIS job in its own needs: (see the comment on
# that job), so the wine build waits for this guard instead of racing it. That
# a FAILED guard then SKIPS the build is expected needs: behaviour, but no
# GitLab doc checked here states it and no tag pipeline has shown it.
# publish-release is held back either way: it sits in a later stage with the
# default when: on_success (see the comment on that job).
# ★★★ No allow_failure. Publishing an installer that misreports its own version
# is the whole failure this prevents.
tag-version-check:
  stage: quality
  needs: []
  rules:
    - if: $CI_COMMIT_TAG
  script:
    - npm run tag:check
```

★ It needs no `node_modules`: the script reads `src/app/version.ts` as text and `CI_COMMIT_TAG` from the environment, and `npm run` works without an install.

- [ ] **Step 4: Verify the YAML parses and the merge did what you think**

Do not eyeball `extends:` merges — print them, RESOLVED. **A plain `require('js-yaml').load(...)` only returns each job's LITERAL keys, and since `paths` now lives on `.desktop-package` alone (M1), it will not appear in either concrete job's literal keys — that is the fix working, not a regression.** Resolve `extends:` the way GitLab does (deep-merge mapping keys, replace arrays wholesale) for the jobs this task touches:

```bash
node -e "
const y=require('js-yaml');
const c=y.load(require('fs').readFileSync('.gitlab-ci.yml','utf8'));
function merge(base, child){
  const out={...base};
  for(const [k,v] of Object.entries(child)){
    if(k==='extends') continue;
    if(v && typeof v==='object' && !Array.isArray(v) && out[k] && typeof out[k]==='object' && !Array.isArray(out[k])){
      out[k]=merge(out[k], v);
    } else { out[k]=v; }
  }
  return out;
}
function resolve(name){
  const job=c[name];
  if(!job.extends) return job;
  const parents=Array.isArray(job.extends)?job.extends:[job.extends];
  let merged={};
  for(const p of parents) merged=merge(merged, resolve(p));
  return merge(merged, job);
}
for(const k of ['desktop-package','desktop-package-tag','tag-version-check']){
  const r=resolve(k);
  console.log(k, JSON.stringify({needs:r.needs, rules:r.rules, allow_failure:r.allow_failure, artifacts:r.artifacts}));
}
" > "$SP/b-t4.log" 2>&1; echo "EXIT=$?"
cat "$SP/b-t4.log"
```

Expected: EXIT=0; RESOLVED `desktop-package` shows `needs: ["install"]`; RESOLVED `desktop-package-tag` shows `needs: ["install","tag-version-check"]` and no `allow_failure` anywhere in the job or its rules; BOTH concrete jobs' resolved `artifacts.paths` show the installer + blockmap globs, inherited from the base rather than repeated.

★ `js-yaml` resolves from the repo root today (4.3.2, a transitive dependency — verified 2026-09-10). If a future install drops it, use GitLab's own `CI Lint` in the project UI during Task 11 and record that here rather than skipping the check.

- [ ] **Step 5: Confirm nothing else referenced the old single job**

```bash
git grep -n "desktop-package" -- . | cat
```

Expected: hits in `.gitlab-ci.yml` only, plus any docs you are about to update in Task 7. A hit in `docs/` naming the old job as the download source must be fixed there, not left.

- [ ] **Step 6: Commit**

```bash
git add .gitlab-ci.yml
git commit --only .gitlab-ci.yml -F - <<'EOF'
ci(desktop): narrow the artifact, split branch from tag, add the tag guard

artifacts.paths was desktop/release/ whole, which uploads ~408 MB of which
win-unpacked/ is 314 MB -- an expanded duplicate of the installer's own
contents (measured 2026-09-10). Narrowed to the installer plus its blockmap,
~93 MB. The globs are self-protecting: *-setup.exe does not match a stale
pre-artifactName "aipm-cockpit Setup 0.301.0.exe".

Tag builds keep their artifact forever, branch builds keep the existing 1 week.
The asymmetry is the point -- an expiring artifact behind a published Release
asset link goes dead silently, weeks later, with nothing failing. expire_in
cannot vary per rules entry, hence a hidden base plus two jobs; they differ in
rules and allow_failure too, so they needed splitting regardless.

desktop-package-tag is BLOCKING, and its missing allow_failure is deliberate:
the file's existing comment warned that a rules entry omitting it defaults to
false, and that is exactly what a tag build wants.

tag-version-check runs with needs: [] so it reports back immediately; a
drifted tag skips the wine build outright, because the build job needs the
guard.

Claude-Session: https://[session link removed]
EOF
```

---

## Task 5: The Release payload — pure logic first

**Files:**
- Create: `scripts/release-publish-lib.mjs`
- Create: `scripts/release-publish-lib.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `scripts/release-publish-lib.test.mjs`:

★ THE BLOCK BELOW IS THE POST-REVIEW STATE, not the original TDD-red cut. A
Task 5 review round found 7 surviving mutants (a bogus `link_type`, one pinned
to the wrong-but-accepted member, a blank description, the version-emptiness
guard removed, `required()`'s trim removed, and two secret-reading mutants —
one base64-encoding `CI_JOB_TOKEN` into the body, one reading
`CI_REGISTRY_PASSWORD`) and added the tests below that kill them, plus a
`describe("installerName")` block for the semver-validation hardening in Step
3. Run Step 2 against the ORIGINAL 8-test cut if reproducing the initial red
step; this file is what ends up committed.

```js
import { describe, expect, it } from "vitest";
import { ARTIFACT_JOB, buildAssetUrl, buildReleasePayload, installerName } from "./release-publish-lib.mjs";

const ENV = {
  CI_PROJECT_URL: "https://gitlab.example.com/group/aipm-cockpit",
  CI_COMMIT_TAG: "v0.301.0",
  CI_JOB_TOKEN: "super-secret-token",
};

// Reads of any env key outside this set throw, so a test built on this proves
// the lib never TOUCHES a secret -- not merely that it never stringifies one
// verbatim into the payload. A mutant that base64-encodes CI_JOB_TOKEN into
// the body, or reads CI_REGISTRY_PASSWORD into an unused field, survives a
// plain "does the serialised payload contain the token" test but not this
// one, because the read itself throws before the value can go anywhere.
const READABLE_ENV_KEYS = new Set(["CI_PROJECT_URL", "CI_COMMIT_TAG"]);
const envThatThrowsOnSecretReads = (env) =>
  new Proxy(env, {
    get(target, key) {
      if (typeof key === "string" && !READABLE_ENV_KEYS.has(key)) {
        throw new Error(`lib read env.${key}`);
      }
      return target[key];
    },
  });

// The Releases API's link_type enum -- docs.gitlab.com/api/releases/ "Create
// a release". "installer" is not a member; only these four are.
const RELEASE_LINK_TYPES = ["other", "runbook", "image", "package"];

describe("buildAssetUrl", () => {
  // ★★★ PER-TAG, NEVER PER-JOB-ID. A /-/jobs/<id>/artifacts/ URL dies the
  // moment the job is re-run; the per-tag form keeps resolving.
  it("builds a per-tag artifact URL naming the producing job", () => {
    expect(buildAssetUrl(ENV, "0.301.0")).toBe(
      "https://gitlab.example.com/group/aipm-cockpit/-/jobs/artifacts/v0.301.0/raw/desktop/release/aipm-cockpit-0.301.0-setup.exe?job=desktop-package-tag",
    );
  });

  it("names the job the artifact actually comes from", () => {
    expect(ARTIFACT_JOB).toBe("desktop-package-tag");
    expect(buildAssetUrl(ENV, "0.301.0")).toContain(`?job=${ARTIFACT_JOB}`);
  });

  it("refuses when the tag is missing", () => {
    expect(() => buildAssetUrl({ ...ENV, CI_COMMIT_TAG: "" }, "0.301.0")).toThrow(/CI_COMMIT_TAG/);
  });

  it("refuses when the project URL is missing", () => {
    expect(() => buildAssetUrl({ ...ENV, CI_PROJECT_URL: "" }, "0.301.0")).toThrow(/CI_PROJECT_URL/);
  });

  // required()'s emptiness check trims before comparing -- a blank-but-not-
  // literally-empty CI_COMMIT_TAG (e.g. a stray space from a malformed rules:
  // match) must refuse exactly like a truly empty one.
  it("refuses a whitespace-only tag", () => {
    expect(() => buildAssetUrl({ ...ENV, CI_COMMIT_TAG: "  " }, "0.301.0")).toThrow(/CI_COMMIT_TAG/);
  });

  it("refuses an empty or whitespace version", () => {
    expect(() => buildAssetUrl(ENV, "")).toThrow(/version/);
    expect(() => buildAssetUrl(ENV, "   ")).toThrow(/version/);
  });
});

describe("installerName", () => {
  // ★★★ FAILS CLOSED on anything that is not a plain semver, rather than
  // trying to URL-encode it. "#" is a legal character in a git ref and starts
  // a URL FRAGMENT -- left unescaped it would silently truncate the asset URL
  // instead of surfacing as an error.
  it("refuses a version that is not a plain semver string", () => {
    expect(() => installerName("0.301.0#x")).toThrow(/version/);
    expect(() => installerName("")).toThrow(/version/);
  });

  it("accepts a plain semver version, with or without a pre-release tag", () => {
    expect(installerName("0.301.0")).toBe("aipm-cockpit-0.301.0-setup.exe");
    expect(installerName("0.301.0-rc.1")).toBe("aipm-cockpit-0.301.0-rc.1-setup.exe");
  });
});

describe("buildReleasePayload", () => {
  it("names the release with the version and milestone", () => {
    const p = buildReleasePayload(ENV, "0.301.0", "Arnason");
    expect(p.tag_name).toBe("v0.301.0");
    expect(p.name).toBe('AI PM Cockpit 0.301.0 "Arnason"');
  });

  it("attaches exactly one asset link, pointing at the installer", () => {
    const p = buildReleasePayload(ENV, "0.301.0", "Arnason");
    expect(p.assets.links).toHaveLength(1);
    expect(p.assets.links[0].url).toBe(buildAssetUrl(ENV, "0.301.0"));
    expect(p.assets.links[0].name).toContain("aipm-cockpit-0.301.0-setup.exe");
  });

  // The Releases API's link_type enum is other|runbook|image|package --
  // "installer" is not a member, and pinning it to "package" (rather than any
  // accepted-but-unintended member such as "other") keeps the semantics
  // right, not merely the request valid.
  it("uses link_type package, a value the Releases API accepts", () => {
    const [link] = buildReleasePayload(ENV, "0.301.0", "Arnason").assets.links;
    expect(RELEASE_LINK_TYPES).toContain(link.link_type);
    expect(link.link_type).toBe("package");
  });

  it("gives the description real content", () => {
    expect(buildReleasePayload(ENV, "0.301.0", "Arnason").description).toMatch(/SmartScreen/);
  });

  // ★ A real markdown link, not a code span naming the file -- the reader
  // should be able to click through to the tag's CHANGELOG.md directly.
  it("links CHANGELOG.md at the tag as a real markdown link, not a code span", () => {
    const p = buildReleasePayload(ENV, "0.301.0", "Arnason");
    expect(p.description).toContain(
      "[CHANGELOG.md](https://gitlab.example.com/group/aipm-cockpit/-/blob/v0.301.0/CHANGELOG.md)",
    );
  });

  // ★★★ THE ONE ASSERTION THAT IS ABOUT SECRETS. The token authenticates the
  // request via a header; it must never reach the request BODY, which GitLab
  // renders publicly on the Releases page.
  it("never puts the job token in the payload", () => {
    const p = buildReleasePayload(ENV, "0.301.0", "Arnason");
    expect(JSON.stringify(p)).not.toContain(ENV.CI_JOB_TOKEN);
  });

  // ★★★ THE KEY ONE. Proves the lib never so much as READS CI_JOB_TOKEN,
  // CI_REGISTRY_PASSWORD, or any other secret-shaped env var -- not merely
  // that none of them end up verbatim in the serialised payload, which the
  // test above this one already covers and a mutant that base64-encodes or
  // otherwise transforms a secret before writing it would survive.
  it("reads no env key but the two it needs", () => {
    expect(() => buildReleasePayload(envThatThrowsOnSecretReads(ENV), "0.301.0", "Arnason")).not.toThrow();
  });

  it("refuses when the milestone is missing", () => {
    expect(() => buildReleasePayload(ENV, "0.301.0", "")).toThrow(/milestone/i);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run scripts/release-publish-lib.test.mjs > "$SP/b-t5a.log" 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests |Cannot find" "$SP/b-t5a.log"
```

Expected: EXIT=1, module not found.

- [ ] **Step 3: Write the library**

Create `scripts/release-publish-lib.mjs`:

★ THE BLOCK BELOW IS ALSO THE POST-REVIEW STATE — see the note above Step 1's
test block for what changed and why: `required()`'s message no longer claims
every missing variable implies a tag pipeline (`CI_PROJECT_URL` is set on
every pipeline kind), `installerName` fails closed on a non-semver version via
`SEMVER_RE` instead of merely rejecting emptiness, `buildAssetUrl`'s docstring
gained the `Projects::ArtifactsController` / release_fields / project-membership
notes, and `buildReleasePayload` links `CHANGELOG.md` as a real markdown link
(dropping the stale hard-coded "~93 MB"). ★★ `buildAssetUrl`'s download-access
paragraph below is the text as REWRITTEN in Task 6's last fix round: the Task 5
cut asserted a membership rule and cited a Task 11 check that did not exist.
Task 6 also replaces this block's header comment and `required()`.

```js
// Pure construction of the GitLab Release payload and its asset URL.
//
// ★ NO SHEBANG — imported by a vitest spec (see tag-version-lib.mjs).
// ★ NO fetch and NO process.exit here. publish-release.mjs owns both, so every
//   decision in this file is testable without a network or a token.

/**
 * The job whose artifact the asset link points at.
 *
 * ★★★ THIS STRING IS PART OF EVERY PUBLISHED DOWNLOAD URL. Renaming the CI job
 * without changing it here — or changing it here without renaming the job —
 * silently 404s the download of the NEXT Release, with every gate green.
 * What happens to a PAST Release's link is not established: each one names
 * the job inside its own tag's pipeline, which a later rename does not touch,
 * but the per-tag URL (see buildAssetUrl) resolves only through the latest
 * successful pipeline for that tag, and only while that pipeline's artifact
 * still exists. desktop-package-tag sets `expire_in: never`, so expiry is not
 * what would remove it; deleting the artifact or the pipeline would. It is
 * exported so the test pins it against one source rather than two literals.
 */
export const ARTIFACT_JOB = "desktop-package-tag";

/** Where electron-builder's artifactName puts the installer, relative to the repo root. */
export const INSTALLER_DIR = "desktop/release";

function required(env, key) {
  const v = env[key];
  if (typeof v !== "string" || v.trim() === "") {
    // ★ Name only the missing variable, never a blanket claim about WHY it is
    // missing — CI_PROJECT_URL is set on every pipeline (branch, MR, tag),
    // not only a tag one, and the old wording ("this script runs only in a
    // tag pipeline") was wrong on that path.
    throw new Error(`${key} is missing or empty`);
  }
  return v;
}

/** A plain dotted-triple semver, optionally with a `-pre.release` tag — nothing else. */
const SEMVER_RE = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

/**
 * `aipm-cockpit-<version>-setup.exe`, matching desktop/electron-builder.yml's artifactName.
 *
 * ★★★ FAILS CLOSED on anything that is not a plain semver, rather than trying
 * to URL-encode whatever came in. `#` is a legal character in a git ref and
 * starts a URL FRAGMENT — left unescaped it silently truncates the asset URL
 * at that point, handing out a link that looks valid and 404s (or worse,
 * resolves to something else). `version` comes from src/app/version.ts's
 * APP_VERSION, so this should never fire outside a corrupted build; if it
 * does, the pipeline must stop rather than publish a link nobody can trust.
 */
export function installerName(version) {
  if (typeof version !== "string" || !SEMVER_RE.test(version)) {
    throw new Error(`version "${version}" is not a plain semver string (expected to match ${SEMVER_RE})`);
  }
  return `aipm-cockpit-${version}-setup.exe`;
}

/**
 * The PER-TAG artifact URL.
 *
 * ★★★ Deliberately not the per-job-id form. `/-/jobs/<id>/artifacts/raw/...`
 * names one execution and dies when the job is re-run — which is a normal thing
 * to do to a release build. `/-/jobs/artifacts/<tag>/raw/<path>?job=<name>`
 * resolves to the latest successful run of that job at that ref, so the link
 * survives a re-run.
 *
 * ★ This exact web-form URL (`/-/jobs/artifacts/<ref>/raw/<path>?job=<name>`)
 * is not documented in GitLab's current REST/GraphQL API reference — it is
 * served by `Projects::ArtifactsController` (GitLab's own Rails source),
 * which resolves `<ref>` against the LATEST SUCCESSFUL PIPELINE for that ref.
 * That is why the link 404s until the whole tag pipeline succeeds, not merely
 * until `desktop-package-tag` does — the same "no needs:" reasoning
 * publish-release itself relies on (see .gitlab-ci.yml).
 *
 * ★ GitLab's own release_fields guidance advises AGAINST linking job
 * artifacts from a Release because they are ephemeral — an artifact that
 * later expires turns a page meant to stay valid indefinitely into a dead
 * link. `desktop-package-tag` sets `expire_in: never` specifically to close
 * that gap for this one link.
 *
 * ★★ WHO MAY DOWNLOAD IS NOT SETTLED, so nothing here claims it. The project
 * is `internal`, so an anonymous visitor gets nothing; past that, GitLab's
 * permissions docs ("Download artifacts",
 * https://docs.gitlab.com/user/permissions/) make job-artifact access depend
 * on the user's role AND on the project's pipeline-visibility setting, so
 * whether a signed-in NON-member can download is a property of this project's
 * settings that nobody has measured. Task 11 Step 6 of
 * docs/superpowers/plans/2026-09-10-release-publishing.md opens this link as
 * a signed-in non-member and records the answer with that setting;
 * docs/desktop-rollout.md (the plan's Task 8) tells a colleague what to do
 * when the link 404s.
 */
export function buildAssetUrl(env, version) {
  const base = required(env, "CI_PROJECT_URL");
  const tag = required(env, "CI_COMMIT_TAG");
  return `${base}/-/jobs/artifacts/${tag}/raw/${INSTALLER_DIR}/${installerName(version)}?job=${ARTIFACT_JOB}`;
}

/**
 * The POST body for `POST /projects/:id/releases`.
 *
 * ★ `description` LINKS CHANGELOG.md rather than quoting it. Parsing a
 * release section out of it is real work with a real failure mode (a heading
 * rename silently empties the notes), and the file is one click away. Link,
 * do not restate — the same rule the doc set runs on.
 */
export function buildReleasePayload(env, version, milestone) {
  const tag = required(env, "CI_COMMIT_TAG");
  const projectUrl = required(env, "CI_PROJECT_URL");
  if (typeof milestone !== "string" || milestone.trim() === "") {
    throw new Error("milestone is empty — src/app/version.ts's APP_MILESTONE shape moved");
  }

  const exe = installerName(version);
  const changelogUrl = `${projectUrl}/-/blob/${encodeURIComponent(tag)}/CHANGELOG.md`;

  return {
    tag_name: tag,
    name: `AI PM Cockpit ${version} "${milestone}"`,
    description: [
      `Windows desktop installer for AI PM Cockpit ${version} "${milestone}".`,
      "",
      `- Download: **${exe}** (asset link below)`,
      "- First run, and what to do if it does not start: `docs/desktop-rollout.md`",
      `- What changed: [CHANGELOG.md](${changelogUrl})`,
      "",
      "The installer is not code-signed, so Windows shows a SmartScreen prompt on",
      "first run: **More info → Run anyway**. It installs for the current user and",
      "needs no admin rights.",
    ].join("\n"),
    assets: {
      links: [
        {
          name: `${exe} (Windows installer)`,
          url: buildAssetUrl(env, version),
          link_type: "package",
        },
      ],
    },
  };
}
```

- [ ] **Step 4: Run it and watch it pass**

```bash
npx vitest run scripts/release-publish-lib.test.mjs > "$SP/b-t5b.log" 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " "$SP/b-t5b.log"
```

Expected: EXIT=0, `Test Files 1 passed (1)`, `Tests 16 passed (16)` — 6 `buildAssetUrl` cases, 2 `installerName` cases, 8 `buildReleasePayload` cases. ★★★ THAT COUNT IS POST-REVIEW, NOT THE INITIAL CUT — a Task 5 review round added a `describe("installerName")` block (fail-closed semver validation) plus five `buildReleasePayload`/`buildAssetUrl` cases (link_type pinned to `"package"`, real description content, a real CHANGELOG.md markdown link, a whitespace-only-tag case, and a Proxy-based test proving the lib never READS an env key outside `CI_PROJECT_URL`/`CI_COMMIT_TAG`, not merely that it never serialises one). The original cut was 8 (four `buildAssetUrl` + four `buildReleasePayload`). ★ Count the `it(` blocks in the file rather than trusting this number; a count in prose is the cheapest thing to check and the easiest to leave rotting. ★★ 16 is the count AT THIS TASK'S COMMIT. Task 6 grows the same file to 98 and replaces this block's header comment and `required()`, and from then on `grep -c "  it("` undercounts — Task 6 Step 4 says why and what to use instead.

- [ ] **Step 5: Commit**

```bash
git add scripts/release-publish-lib.mjs scripts/release-publish-lib.test.mjs
git commit --only scripts/release-publish-lib.mjs scripts/release-publish-lib.test.mjs -F - <<'EOF'
feat(ci): pure Release payload and per-tag asset URL

The asset link uses the per-tag artifact form
(/-/jobs/artifacts/<tag>/raw/<path>?job=<name>) rather than a job-id URL: a job
id names one execution and dies when a release build is re-run, which is a
normal thing to do.

The producing job's name is exported as one constant, because it is part of
every published download URL -- renaming the CI job without changing it here
404s the download on every past Release too.

A test asserts CI_JOB_TOKEN never reaches the payload: it authenticates via a
header, and the body is rendered publicly on the Releases page.

description links CHANGELOG.md rather than quoting it. Parsing a release section
out has a silent failure mode -- a heading rename empties the notes.

Claude-Session: https://[session link removed]
EOF
```

---

## Task 6: The publish CLI

**Files:**
- Modify: `scripts/release-publish-lib.mjs` (the two response classifiers, `expectedFromPayload`, and one shared emptiness rule)
- Modify: `scripts/release-publish-lib.test.mjs`
- Create: `scripts/publish-release.mjs`
- Create: `scripts/publish-release.integration.test.mjs`
- Modify: `package.json` (`scripts` + `scriptsDescriptions`)
- Regenerate: `CONTRIBUTING.md`

★ No `release-cli` image and no `curl`. The spec rejects the `release:` keyword because it drags in another image, and this pipeline already carries one unverified image dependency. Node 24 has global `fetch`, and `node:24-bookworm-slim` is already the default image.

★★★ **THIS SECTION IS THE POST-REVIEW STATE, AND EVERY CODE BLOCK IN IT IS BYTE-IDENTICAL TO THE COMMITTED FILES.** The first cut of this task was one inline CLI whose success path was the fall-through. A pre-implementation review ran it VERBATIM in a sandbox against a local fake API with a canary token, and measured:

1. **CRITICAL — `res.ok` accepted any 2xx.** A 200 HTML page exited 0 "created release"; a POST answered 302 was followed by fetch as a GET, got `200 []`, and ALSO exited 0 "created". The fake server logged both requests.
2. **CRITICAL — 409 was a plain refusal.** GitLab answers `error(_('Release already exists'), 409)` (`app/services/releases/create_service.rb`). A create that succeeds but whose response is lost (timeout, reset) then makes every retry 409 and fail forever, while the asset URL — which resolves only through a SUCCESSFUL pipeline — stays dead.
3. Structural failures exited 1, the refusal code: a renamed lib export is a static-import SyntaxError, and `fetch failed` an uncaught TypeError.
4. No timeout.
5. A typo'd `--dryrun` reached `fetch` and sent a real POST.
6. `--dry-run` exited 0 with `CI_API_V4_URL` and `CI_PROJECT_ID` unset.
7. The response handling was inline and untested — the same lesson as Task 3's `describeVerdict`.

A cold review of the first classifier cut then found four more, each reproduced against a verbatim copy of that cut before it was fixed: `classifyExistingRelease` read ANY JSON object on a 200 as the Release (`200 []` and `200 {}` → code 1, "delete that Release"; another tag's Release carrying our link → code 0); `expected` was never validated (`C(201, {assets:{links:[{}]}}, {})` → "created", because `undefined === undefined` on both comparisons, and `expected = undefined` threw); 408 and 429 were refusals (code 1); and a string `"201"` coerced through the range checks and read "HTTP 201 is not 201 Created".

A second cold review, of the committed CLI, found that it had NO committed test at all — truncate-then-redact, a followed redirect or a deleted argument guard would each have shipped green — and that its catch could itself throw (`String()` of a prototype-less object), which exits 1, the refusal code. Step 10 and the catch's own inner try close those. It also found this section's Step 8 `--dryrun` row unable to see the guard by exit code; that is measured, and recorded, at Step 8.

**The exit-code contract** (the CLI's header carries the same text):

- **0** — a 201 whose body echoes this tag AND this asset link; or a 409 whose existing Release already carries this link (an earlier create landed and only its response was lost); or `--dry-run`.
- **1** — the API REFUSED: a 4xx other than 408, 409 and 429, or a 409 whose existing Release for this tag lacks this link. A human has to act.
- **2** — everything else, all safe to retry: missing env, an unknown argument, a network failure, the 30 s timeout, 408 and 429, a 5xx, a redirect, a 2xx that does not confirm, a GET after a 409 that cannot be read, a structural failure — including an error that cannot even be described, since the catch builds its message inside its own try with a fixed fallback.

★★ **408 and 429 are 2 BY DECISION.** A request timeout or a rate limit says nothing about whether this Release may be created, and a retry is safe BECAUSE of the 409 path: if the timed-out create did land, the retry answers 409 and the GET confirms it.

- [ ] **Step 1: Write the failing classifier tests**

In `scripts/release-publish-lib.test.mjs`, widen the import to:

```js
import { describe, expect, it } from "vitest";
import {
  ARTIFACT_JOB,
  buildAssetUrl,
  buildReleasePayload,
  classifyCreateResponse,
  classifyExistingRelease,
  expectedFromPayload,
  installerName,
} from "./release-publish-lib.mjs";
```

and append:

```js
// The (status, json) shapes publish-release.mjs classifies. EXPECTED is what
// expectedFromPayload() returns for ENV's payload -- the first
// expectedFromPayload test pins that, so these literals cannot drift from the
// real builder.
const EXPECTED = {
  tagName: "v0.301.0",
  assetUrl:
    "https://gitlab.example.com/group/aipm-cockpit/-/jobs/artifacts/v0.301.0/raw/desktop/release/aipm-cockpit-0.301.0-setup.exe?job=desktop-package-tag",
};
const OTHER_URL = "https://example.com/other-file.exe";
const OUR_LINK = () => ({ url: EXPECTED.assetUrl });
const withLinks = (...links) => ({ tag_name: EXPECTED.tagName, assets: { links } });
const withOurLink = () => withLinks(OUR_LINK());

// Every non-success message is a real sentence with a known prefix, never ""
// -- a blank message reaches the job log as a bare "[release:publish] " line.
const CANNOT_CONFIRM = /^CANNOT CONFIRM: \S/;
const REFUSED = /^API refused: HTTP 4\d\d/;

// Each row is an `expected` the classifiers must refuse, paired with the body
// that would VACUOUSLY confirm it if they did not -- `undefined === undefined`
// on both comparisons once made `C(201, {assets:{links:[{}]}}, {})` "created".
const BAD_EXPECTED = [
  ["undefined", undefined, { assets: { links: [{}] } }],
  ["null", null, { assets: { links: [{}] } }],
  ["{}", {}, { assets: { links: [{}] } }],
  ["a string", "v0.301.0", { assets: { links: [{}] } }],
  ["tagName only", { tagName: EXPECTED.tagName }, withLinks({})],
  ["assetUrl only", { assetUrl: EXPECTED.assetUrl }, { assets: { links: [OUR_LINK()] } }],
  ["whitespace values", { tagName: "  ", assetUrl: "  " }, { tag_name: "  ", assets: { links: [{ url: "  " }] } }],
];

describe("expectedFromPayload", () => {
  it("reads the tag and the one asset URL out of the payload being sent", () => {
    const p = buildReleasePayload(ENV, "0.301.0", "Arnason");
    expect(expectedFromPayload(p)).toEqual(EXPECTED);
    expect(EXPECTED.assetUrl).toBe(buildAssetUrl(ENV, "0.301.0"));
  });

  // The round trip the CLI makes: the server echoing our own payload back
  // is the one body that must confirm.
  it("confirms the payload's own echo as created", () => {
    const p = buildReleasePayload(ENV, "0.301.0", "Arnason");
    expect(classifyCreateResponse(201, p, expectedFromPayload(p))).toEqual({ kind: "created" });
  });

  it("refuses a payload with no usable tag_name", () => {
    expect(() => expectedFromPayload({ assets: { links: [OUR_LINK()] } })).toThrow(/tag_name is missing/);
    expect(() => expectedFromPayload({ tag_name: "  ", assets: { links: [OUR_LINK()] } })).toThrow(/tag_name/);
  });

  it("refuses a payload whose one link has no usable url", () => {
    expect(() => expectedFromPayload(withLinks({}))).toThrow(/assets\.links\[0\]\.url is missing/);
    expect(() => expectedFromPayload(withLinks(null))).toThrow(/assets\.links\[0\]\.url/);
  });

  // The classifiers confirm ONE url; taking the first of several would
  // report a Release with some of its links missing as done.
  it("refuses a payload with zero asset links, or more than one", () => {
    expect(() => expectedFromPayload(withLinks())).toThrow(/exactly one asset link \(found 0\)/);
    expect(() => expectedFromPayload(withLinks(OUR_LINK(), { url: OTHER_URL }))).toThrow(/exactly one asset link \(found 2\)/);
    expect(() => expectedFromPayload({ tag_name: EXPECTED.tagName })).toThrow(/exactly one asset link \(found none\)/);
    expect(() => expectedFromPayload(undefined)).toThrow(/exactly one asset link/);
  });
});

describe("classifyCreateResponse", () => {
  // ★★★ THE CRITICAL DEFECT THIS CLASSIFIER EXISTS TO CLOSE. The plan's
  // original inline code accepted res.ok (any 2xx) as success; a fake-API
  // sandbox run measured a 200 HTML proxy page AND a POST answered 302 that
  // fetch silently re-followed as a GET (200 []) both exiting 0 "created".
  it("confirms creation ONLY on 201 with a matching tag and our asset link", () => {
    expect(classifyCreateResponse(201, withOurLink(), EXPECTED)).toEqual({ kind: "created" });
  });

  it("finds our link when it is not the first entry, past a null one", () => {
    expect(classifyCreateResponse(201, withLinks(null, { url: OTHER_URL }, OUR_LINK()), EXPECTED)).toEqual({
      kind: "created",
    });
  });

  it.each([
    ["another tag's body", { tag_name: "v0.999.0", assets: { links: [OUR_LINK()] } }],
    ["no tag_name", { assets: { links: [OUR_LINK()] } }],
    ["an empty link list", withLinks()],
    ["only another link", withLinks({ url: OTHER_URL })],
    ["a link with no url", withLinks({})],
    ["a link list that is not an array", { tag_name: EXPECTED.tagName, assets: { links: OUR_LINK() } }],
    ["no assets at all", { tag_name: EXPECTED.tagName }],
    ["a null body (unparsed)", null],
    ["an undefined body", undefined],
    ["an array body", []],
    ["an array carrying our tag and link", Object.assign([], withOurLink())],
  ])("refuses to confirm a 201 with %s, code 2", (_label, json) => {
    const r = classifyCreateResponse(201, json, EXPECTED);
    expect(r.kind).toBe("fail");
    expect(r.code).toBe(2);
    expect(r.message).toMatch(CANNOT_CONFIRM);
    expect(r.message).toMatch(/201 but the body lacks/);
  });

  // GitLab's Releases::CreateService answers 409 "Release already exists"
  // both for a real prior release AND for a create that actually SUCCEEDED
  // whose response was lost to a timeout/reset -- 409 must route to a
  // check, never a plain refusal that a retry would then fail FOREVER.
  it("routes a 409 to check-existing, never a plain refusal", () => {
    expect(classifyCreateResponse(409, { message: "Release already exists" }, EXPECTED)).toEqual({
      kind: "check-existing",
    });
  });

  // Every row sends OUR body, so the STATUS is the only thing that can make
  // it anything but "created" -- a mutant widening the 201 check to a range
  // turns the neighbouring rows into "created" and fails here.
  it.each([
    [0, 2, /unexpected HTTP status 0$/],
    [Number.NaN, 2, /unexpected HTTP status NaN$/],
    [100, 2, /unexpected HTTP status 100$/],
    [199, 2, /unexpected HTTP status 199$/],
    [200, 2, /HTTP 200 is not 201 Created/],
    [204, 2, /HTTP 204 is not 201 Created/],
    [299, 2, /HTTP 299 is not 201 Created/],
    [300, 2, /HTTP 300 redirect/],
    [302, 2, /HTTP 302 redirect/],
    [399, 2, /HTTP 399 redirect/],
    [400, 1, /^API refused: HTTP 400$/],
    [403, 1, /^API refused: HTTP 403 /],
    [404, 1, /^API refused: HTTP 404$/],
    [408, 2, /HTTP 408 is transient/],
    [429, 2, /HTTP 429 is transient/],
    [499, 1, /^API refused: HTTP 499$/],
    [500, 2, /HTTP 500 — the API, or a proxy in front of it, is erroring/],
    [502, 2, /HTTP 502 — the API/],
    [599, 2, /HTTP 599 — the API/],
    [600, 2, /unexpected HTTP status 600$/],
  ])("classifies HTTP %s as fail, code %s", (status, code, message) => {
    const r = classifyCreateResponse(status, withOurLink(), EXPECTED);
    expect(r.kind).toBe("fail");
    expect(r.code).toBe(code);
    expect(r.message).toMatch(code === 1 ? REFUSED : CANNOT_CONFIRM);
    expect(r.message).toMatch(message);
  });

  it("names the Developer+ and protected-tag requirement on a 403", () => {
    const { message } = classifyCreateResponse(403, {}, EXPECTED);
    expect(message).toMatch(/Developer\+/);
    expect(message).toMatch(/protected tags/);
  });

  it("gives no 403 advice on any other 4xx", () => {
    for (const status of [400, 401, 404, 422, 499]) {
      expect(classifyCreateResponse(status, {}, EXPECTED).message).not.toMatch(/Developer/);
    }
  });

  // ★★ DECIDED: 408 and 429 are TRANSIENT, not refusals. Retrying is safe
  // because of the 409 branch -- a create that did land answers 409 next
  // time, and classifyExistingRelease confirms it.
  it("treats 408 and 429 as transient and retry-safe, never the refusal code", () => {
    for (const status of [408, 429]) {
      const r = classifyCreateResponse(status, null, EXPECTED);
      expect(r.code).toBe(2);
      expect(r.message).toMatch(/safe to retry/);
    }
  });

  // fetch always reports a number, so a string is a caller bug. A string
  // "201" once coerced through the range checks and read "HTTP 201 is not
  // 201 Created".
  it.each([["201"], [undefined], [null]])("refuses a non-numeric status (%s), code 2", (status) => {
    const r = classifyCreateResponse(status, withOurLink(), EXPECTED);
    expect(r).toEqual({ kind: "fail", code: 2, message: expect.stringMatching(/non-numeric HTTP status/) });
    expect(r.message).not.toMatch(/201 Created/);
  });

  it.each(BAD_EXPECTED)("refuses to classify without a usable expected (%s), even a 201 or a 409", (_label, expected, json) => {
    for (const status of [201, 409]) {
      const r = classifyCreateResponse(status, json, expected);
      expect(r.kind).toBe("fail");
      expect(r.code).toBe(2);
      expect(r.message).toMatch(/no expected tagName and assetUrl/);
    }
  });
});

describe("classifyExistingRelease", () => {
  it("confirms an existing Release for our tag that already carries our link, code 0", () => {
    expect(classifyExistingRelease(200, withOurLink(), EXPECTED)).toEqual({
      code: 0,
      message: "release for v0.301.0 already exists with this asset link",
    });
  });

  it("finds our link when it is not the first entry, past a null one", () => {
    expect(classifyExistingRelease(200, withLinks(null, { url: OTHER_URL }, OUR_LINK()), EXPECTED).code).toBe(0);
  });

  it.each([
    ["only another link", withLinks({ url: OTHER_URL })],
    ["an empty link list", withLinks()],
  ])("flags a real conflict, code 1, when our tag's Release has %s", (_label, json) => {
    const r = classifyExistingRelease(200, json, EXPECTED);
    expect(r.code).toBe(1);
    expect(r.message).toMatch(/^a Release for v0\.301\.0 exists WITHOUT /);
    expect(r.message).toMatch(/Release links API/);
    expect(r.message).toMatch(/delete that Release/);
  });

  // "delete that Release" is advice to destroy something -- it may only be
  // given about a body that IS our tag's Release, with a link list we read.
  it.each([
    ["null (unparsed)", null],
    ["undefined", undefined],
    ["a string", "x"],
    ["an array", []],
    ["an array carrying our tag and link", Object.assign([], withOurLink())],
    ["{}", {}],
    ["another tag's Release carrying our link", { tag_name: "v0.999.0", assets: { links: [OUR_LINK()] } }],
    ["no tag_name", { assets: { links: [OUR_LINK()] } }],
    ["our tag with no assets", { tag_name: EXPECTED.tagName }],
    ["our tag with a link list that is not an array", { tag_name: EXPECTED.tagName, assets: { links: OUR_LINK() } }],
  ])("cannot confirm, code 2, a 200 whose body is %s", (_label, json) => {
    const r = classifyExistingRelease(200, json, EXPECTED);
    expect(r.code).toBe(2);
    expect(r.message).toMatch(CANNOT_CONFIRM);
    expect(r.message).toMatch(/HTTP 200, but the body is not a Release for v0\.301\.0/);
  });

  // Every row sends OUR Release, so the status check alone is what makes it
  // code 2 -- a mutant widening `=== 200` to a range or to `<= 200` fails a row.
  it.each([[100], [199], [201], [204], [301], [404], [503]])(
    "cannot confirm, code 2, when reading the Release returns HTTP %s",
    (status) => {
      const r = classifyExistingRelease(status, withOurLink(), EXPECTED);
      expect(r.code).toBe(2);
      expect(r.message).toMatch(CANNOT_CONFIRM);
      expect(r.message).toMatch(new RegExp(`returned HTTP ${status}, not 200`));
    },
  );

  it.each([["200"], [undefined]])("refuses a non-numeric status (%s), code 2", (status) => {
    const r = classifyExistingRelease(status, withOurLink(), EXPECTED);
    expect(r.code).toBe(2);
    expect(r.message).toMatch(/non-numeric HTTP status/);
  });

  it.each(BAD_EXPECTED)("refuses to classify without a usable expected (%s)", (_label, expected, json) => {
    const r = classifyExistingRelease(200, json, expected);
    expect(r.code).toBe(2);
    expect(r.message).toMatch(/no expected tagName and assetUrl/);
  });
});
```

★ Every status row sends OUR body, and every existing-release status row OUR Release, so the STATUS is the only thing that can fail the row — a mutant widening `=== 201` or `=== 200` to a range turns a neighbouring row "created" or code 0. Each `BAD_EXPECTED` row pairs an `expected` with the body that would VACUOUSLY confirm it, so the refusal is what is under test, not the body.

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run scripts/release-publish-lib.test.mjs > "$SP/b-t6a.log" 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " "$SP/b-t6a.log"
```

Expected: EXIT=1 — Task 5's lib exports neither classifier nor `expectedFromPayload`.

- [ ] **Step 3: Add the classifiers to the library**

In `scripts/release-publish-lib.mjs`, replace the header comment with:

```js
// Pure construction of the GitLab Release payload and its asset URL, and pure
// classification of the Releases API's answers to that payload.
//
// ★ NO SHEBANG — imported by a vitest spec (see tag-version-lib.mjs).
// ★ NO fetch and NO process.exit here. publish-release.mjs owns both, so every
//   decision in this file is testable without a network or a token.
// ★★ NO CLASSIFIER MESSAGE EVER INCLUDES THE RESPONSE BODY — only the status
//   and the tag and asset URL this run built. So redacting CI_JOB_TOKEN out of
//   an echoed body belongs to the CLI, the one place a body is ever printed.
```

Replace `required()` with one shared emptiness rule and a `required()` that also takes a nullable object and a label — `expectedFromPayload` and the classifiers' check on `expected` both use it, so there is exactly one definition of "empty":

```js
/**
 * The ONE emptiness rule, shared by required() and the classifiers' check on
 * `expected`: a string with something other than whitespace in it.
 */
function isNonEmptyString(v) {
  return typeof v === "string" && v.trim() !== "";
}

/**
 * `obj[key]`, or a throw naming `label` when it is not a non-empty string.
 * ★ `obj` may be null/undefined (a missing asset link) — that reads as a
 * missing value, not a TypeError.
 */
function required(obj, key, label = key) {
  const v = obj?.[key];
  if (!isNonEmptyString(v)) {
    // ★ Name only the missing variable, never a blanket claim about WHY it is
    // missing — CI_PROJECT_URL is set on every pipeline (branch, MR, tag),
    // not only a tag one, and the old wording ("this script runs only in a
    // tag pipeline") was wrong on that path.
    throw new Error(`${label} is missing or empty`);
  }
  return v;
}
```

Append after `buildReleasePayload`:

```js
/**
 * The `{ tagName, assetUrl }` the two classifiers below confirm against,
 * read out of the payload this run is about to send.
 *
 * ★★ The CLI takes `expected` from HERE and never assembles it by hand: the
 * point of confirming a 201 is that the server echoed back what we SENT, so
 * both values must come from the sent payload itself. Built via required(),
 * so a payload missing either value throws here rather than handing the
 * classifiers an `expected` they would refuse anyway.
 *
 * ★ Exactly ONE asset link, or it throws. The classifiers confirm one URL;
 * confirming only the first of several would report a Release with some of
 * its links missing as done.
 */
export function expectedFromPayload(payload) {
  const links = payload?.assets?.links;
  if (!Array.isArray(links) || links.length !== 1) {
    throw new Error(`payload must carry exactly one asset link (found ${Array.isArray(links) ? links.length : "none"})`);
  }
  return {
    tagName: required(payload, "tag_name"),
    assetUrl: required(links[0], "url", "assets.links[0].url"),
  };
}

/**
 * Does `expected` name BOTH values? Without it there is nothing to confirm
 * against: `expected = {}` once made a 201 whose link had no `url` read as
 * "created", because `undefined === undefined` on both comparisons.
 */
function hasExpected(expected) {
  return isNonEmptyString(expected?.tagName) && isNonEmptyString(expected?.assetUrl);
}

const NO_EXPECTED =
  "CANNOT CONFIRM: no expected tagName and assetUrl to check the response against — a caller bug (build it with expectedFromPayload), not an answer from the API";

/**
 * ★ Names the status's TYPE, never its value: a non-number here is a caller
 * bug (fetch always reports a number), and echoing an arbitrary value would
 * break the no-body-in-a-message rule in this file's header.
 */
function nonNumericStatus(status) {
  return `CANNOT CONFIRM: a non-numeric HTTP status (${typeof status}) — fetch always reports a number, so this is a caller bug`;
}

/** A JSON object — not null, not an array. */
function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * Does a Release response body carry the exact asset link we expect?
 *
 * ★ Compares the FULL url string, never a substring or a name match — a
 * link pointing at a stale job id or a differently-cased path is not "the
 * same" link even if it looks close.
 */
function hasOurLink(json, expected) {
  return Array.isArray(json?.assets?.links) && json.assets.links.some((l) => l && l.url === expected.assetUrl);
}

/**
 * Classify the response to the CREATE `POST .../releases` call.
 *
 * `expected = { tagName, assetUrl }`, from expectedFromPayload() — the tag
 * and asset link this run is SENDING, so the classifier confirms the server
 * echoed back what we actually asked for, never merely that it returned *a*
 * 201. An `expected` missing either value is refused (fail, code 2) before
 * the status is even read.
 *
 * Returns:
 *  - `{ kind: "created" }` — 201, and the body's tag_name and asset link
 *    both match what we sent.
 *  - `{ kind: "check-existing" }` — 409. GitLab's Releases::CreateService
 *    answers 409 when a Release for this tag already exists
 *    (app/services/releases/create_service.rb:
 *    `error(_('Release already exists'), 409)`). That can mean a real prior
 *    release, OR a create that actually SUCCEEDED whose response was lost to
 *    a timeout/reset — the caller must GET the existing Release and pass it
 *    to classifyExistingRelease() to tell those apart. Treating 409 as a
 *    plain refusal makes every retry fail FOREVER once that happens, while
 *    the asset URL this run built never gets attached to anything.
 *  - `{ kind: "fail", code: 1, message }` — a 4xx refusal other than 408,
 *    409 and 429: final, and a human has to act (a 403 says what on).
 *  - `{ kind: "fail", code: 2, message }` — everything else, all of it safe
 *    to retry: any other 2xx (a proxy or an unauthenticated endpoint
 *    answering 200 with an unrelated body is NOT a created release), a
 *    redirect (3xx — the caller must use `redirect: "manual"` so fetch never
 *    follows one into a GET on our behalf), 408 and 429, a 5xx, an
 *    unexpected status (0, NaN, 1xx, 600+), and a non-numeric one.
 *
 * ★★ 408 AND 429 ARE TRANSIENT, SO CODE 2, NOT THE REFUSAL CODE 1. A request
 * timeout or a rate limit says nothing about whether this Release may be
 * created, and a retry is safe BECAUSE of the 409 branch: if the timed-out
 * create did land, the retry answers 409 and classifyExistingRelease()
 * confirms it.
 *
 * ★★★ NOTHING BUT THE 201-AND-CONFIRMED BRANCH MAY RETURN "created". A
 * classifier whose success path is "any 2xx" or a bare `res.ok` is the
 * CRITICAL defect a pre-implementation review measured against the plan's
 * original inline code, run verbatim in a sandbox against a fake API: a 200
 * HTML proxy page exited 0 "created release", and a POST answered 302 was
 * silently re-followed by fetch as a GET (200 []) and ALSO exited 0
 * "created" — the fake server logged both requests.
 */
export function classifyCreateResponse(status, json, expected) {
  if (!hasExpected(expected)) {
    return { kind: "fail", code: 2, message: NO_EXPECTED };
  }
  // ★ Before ANY range comparison: a string "201" coerces through >= and <,
  // and used to land in the 2xx branch reading "HTTP 201 is not 201 Created".
  if (typeof status !== "number") {
    return { kind: "fail", code: 2, message: nonNumericStatus(status) };
  }
  if (status === 201) {
    // ★ The same plain-object rule classifyExistingRelease applies, so the two
    // classifiers agree on what counts as a Release body.
    if (isPlainObject(json) && json.tag_name === expected.tagName && hasOurLink(json, expected)) {
      return { kind: "created" };
    }
    return {
      kind: "fail",
      code: 2,
      message: `CANNOT CONFIRM: 201 but the body lacks tag_name=${expected.tagName} and/or the asset link ${expected.assetUrl}`,
    };
  }
  if (status >= 200 && status < 300) {
    return {
      kind: "fail",
      code: 2,
      message: `CANNOT CONFIRM: HTTP ${status} is not 201 Created — a 2xx from a proxy or an unrelated endpoint is not a created Release`,
    };
  }
  if (status >= 300 && status < 400) {
    return {
      kind: "fail",
      code: 2,
      message: `CANNOT CONFIRM: HTTP ${status} redirect — CI_API_V4_URL is not canonical, and a followed redirect would turn the POST into a GET`,
    };
  }
  if (status === 409) {
    return { kind: "check-existing" };
  }
  if (status === 408 || status === 429) {
    return {
      kind: "fail",
      code: 2,
      message: `CANNOT CONFIRM: HTTP ${status} is transient (a request timeout or a rate limit) — safe to retry, since a create that did land answers 409 next time`,
    };
  }
  if (status >= 400 && status < 500) {
    return {
      kind: "fail",
      code: 1,
      message: `API refused: HTTP ${status}${status === 403 ? " (the tag pusher needs Developer+, and the right to create protected tags)" : ""}`,
    };
  }
  if (status >= 500 && status < 600) {
    return {
      kind: "fail",
      code: 2,
      message: `CANNOT CONFIRM: HTTP ${status} — the API, or a proxy in front of it, is erroring; safe to retry`,
    };
  }
  // 0, NaN, 1xx, 600+ — never a refusal (code 1) and never a success.
  return {
    kind: "fail",
    code: 2,
    message: `CANNOT CONFIRM: unexpected HTTP status ${status}`,
  };
}

/**
 * Classify the GET on a Release that already exists, made after a 409 from
 * the create POST.
 *
 * `expected = { tagName, assetUrl }`, from expectedFromPayload(), the same
 * value classifyCreateResponse takes.
 *
 * Returns `{ code: 0 | 1 | 2, message }`:
 *  - 0 — 200, the body is a Release for OUR tag, and it already carries our
 *    asset link: the earlier create actually succeeded and only its response
 *    was lost — safe to treat this run as done.
 *  - 1 — 200 and a Release for our tag whose asset link list we could READ,
 *    and our link is not in it: a real conflict a human must resolve (add
 *    the link via the Release links API, or delete that Release and retry).
 *  - 2 — anything else. Never guess which of the two outcomes above is true:
 *    a missing `expected`, a non-200 or non-numeric status (404/5xx — the
 *    existing Release could not even be read), or a 200 whose body is not a
 *    JSON object naming our tag with an `assets.links` array (unparsed, an
 *    array, `{}`, another tag's Release, no link list). A 200 `[]` once read
 *    as code 1, "delete that Release" — advice to destroy something nobody
 *    had identified.
 */
export function classifyExistingRelease(status, json, expected) {
  if (!hasExpected(expected)) {
    return { code: 2, message: NO_EXPECTED };
  }
  if (typeof status !== "number") {
    return { code: 2, message: nonNumericStatus(status) };
  }
  if (status !== 200) {
    return {
      code: 2,
      message: `CANNOT CONFIRM: reading the existing Release for ${expected.tagName} returned HTTP ${status}, not 200 — cannot tell whether it carries ${expected.assetUrl}`,
    };
  }
  if (!isPlainObject(json) || json.tag_name !== expected.tagName || !Array.isArray(json.assets?.links)) {
    return {
      code: 2,
      message: `CANNOT CONFIRM: HTTP 200, but the body is not a Release for ${expected.tagName} with a readable asset link list — cannot tell whether it carries ${expected.assetUrl}`,
    };
  }
  if (hasOurLink(json, expected)) {
    return { code: 0, message: `release for ${expected.tagName} already exists with this asset link` };
  }
  return {
    code: 1,
    message: `a Release for ${expected.tagName} exists WITHOUT ${expected.assetUrl} — add the link (Release links API) or delete that Release, then retry`,
  };
}
```

- [ ] **Step 4: Run it and watch it pass**

```bash
npx vitest run scripts/release-publish-lib.test.mjs > "$SP/b-t6b.log" 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " "$SP/b-t6b.log"
npx vitest list scripts/release-publish-lib.test.mjs --maxWorkers=1 > "$SP/b-t6-list.log" 2>&1
grep -c "Failed to start" "$SP/b-t6-list.log"
grep -c "^scripts/release-publish-lib.test.mjs >" "$SP/b-t6-list.log"
```

Expected: EXIT=0, `Test Files  1 passed (1)`, `Tests  98 passed (98)`, `0` "Failed to start" lines, and the count `98`. ★★ **`grep -c "  it("` CANNOT DERIVE THIS COUNT ANY MORE** — it prints 29, because every `it.each` row is its own test at runtime. `vitest list` enumerates what actually runs.
★★★ **`vitest list` EXITS 0 EVEN WHEN IT LISTS NOTHING.** Measured on a loaded machine: its worker failed to start ("Failed to start forks worker"), it printed no tests, and it still exited 0, so the count read `0` and looked like an empty file. Hence `--maxWorkers=1`, and the "Failed to start" count, which must be `0` before the tally means anything.
★ Neither guard in the pattern is load-bearing ON ITS OWN, and an earlier revision here said the `^` was. npm echoes its own `npm notice run vitest list scripts/release-publish-lib.test.mjs …` line into the log, and either guard excludes it. Measured: both guards 98, `^` alone 98, ` >` alone 98, neither 99. Keep both, each a backstop for the other.

- [ ] **Step 5: Mutation-test the classifiers**

One mutant at a time, never two vitest processes at once: an anchored replace whose anchor AND replacement are each asserted unique, a run of ONLY this test file, the per-case failures recorded, then the inverse anchored replace and a hash check that the file is byte-identical to its pre-mutant state. Measured on the first commit — 65 mutants, 62 killed, 3 surviving, all 3 equivalent. The fix round then made the 201 branch require `isPlainObject(json)` too, so every mutant on that rewritten line was re-run against it (the rows marked *fix round*):

| Mutants | Result |
|---|---|
| `hasExpected`: `&&` → OR, body → `true`; `isNonEmptyString` without `trim`, without `typeof` | KILLED by the `BAD_EXPECTED` rows (and `trim` also by Task 5's whitespace-tag test, which is the shared rule working) |
| the non-numeric guard removed, in either classifier | KILLED by the non-numeric rows |
| `status === 201` → any 2xx | KILLED by the 200 / 204 / 299 rows |
| 201 body: the tag check dropped; the link check dropped (*fix round*: re-run on the rewritten line) | KILLED by the 201-refusal table |
| *fix round*: the 201 branch's `isPlainObject(json)` reverted to `json?.tag_name`; → `true` | KILLED by the array-carrying-our-tag row (and, for `true`, by the null / undefined rows too) |
| every range edge — 2xx `>= 200` → `> 200` / `>= 199`, `< 300` → `<= 300`; 3xx `>= 300` → `> 300`, `< 400` → `< 399` / `<= 400`; 4xx `>= 400` → `> 400`, `< 500` → `< 499`; 5xx `>= 500` → `> 500`, `< 600` → `<= 600` | KILLED, each by exactly ONE boundary row (200, 199, 300, 300, 399, 400, 400, 499, 500, 600) |
| the 409 branch removed; the 408/429 branch removed; 429 dropped from it | KILLED |
| 4xx code 1 → 2; the 403 advice on every 4xx; the 403 advice removed | KILLED |
| the unexpected-status fallback → `"created"` | KILLED by the 0 / NaN / 100 / 199 / 600 rows |
| each of the ten messages → `""` | KILLED by the prefix and text regexes |
| `hasOurLink`: `Array.isArray` → `true`; `l && l.url` → `l.url`; `some` → `every` | KILLED |
| existing `!== 200` → any 2xx; → `> 200` | KILLED by the 201 / 204 and the 100 / 199 rows, each sending OUR Release |
| `isPlainObject`: each conjunct → `true`; the call dropped | KILLED by the undefined / null / array-carrying-our-tag rows |
| existing: tag check dropped; link-list check dropped; code 0 → 1; code 1 → 2; link check → `true` | KILLED |
| `expectedFromPayload`: `!== 1` → `< 1`; `Array.isArray` dropped; tag or url read without `required()`; `obj?.[key]` → `obj[key]`; `label` → `key`; `"none"` → `0` | KILLED |
| the missing-`expected` and non-numeric verdicts' codes changed | KILLED |
| `assets?.` → `assets.` in the existing check | KILLED |
| **`status === 201` → `==`** | SURVIVED — EQUIVALENT. The non-numeric guard returns first, so `status` is a number here, and `==` between two numbers is `===`. |
| **`status !== 200` → `!=`** | SURVIVED — EQUIVALENT, by the same guard in `classifyExistingRelease`. |
| **`hasOurLink`'s `json?.` → `json.`** (*fix round*: re-run, still survives) | SURVIVED — EQUIVALENT. Both callers establish a non-nullish `json` first: each reaches it only after `isPlainObject(json)` holds. |

★★ A surviving mutant is a QUESTION, not a verdict. Each of the three above was run, not assumed, and each is equivalent for a reason that names the guard that makes it so — delete that guard and the mutant stops being equivalent.

- [ ] **Step 6: Write the CLI**

Create `scripts/publish-release.mjs`:

```js
#!/usr/bin/env node
// Create the GitLab Release for the current tag and attach the installer link.
//
// EXIT CODES — outside --dry-run, 0 means a CONFIRMED Release and nothing
// else does:
//   0  a 201 whose body echoes this tag AND this asset link; or a 409 whose
//      existing Release already carries this link (an earlier create landed
//      and only its response was lost); or --dry-run printed the payload
//   1  the API REFUSED: a 4xx other than 408, 409 and 429, or a 409 whose
//      existing Release for this tag lacks this link. A human has to act; a
//      retry fails the same way.
//   2  everything else, all of it safe to retry: missing env, an unknown
//      argument, a network failure, the 30 s timeout, a 5xx, a 408 or 429
//      (transient, not a refusal), a redirect, a 2xx that does not confirm, a
//      GET after a 409 that cannot be read, and any structural failure (a
//      moved version.ts shape, a renamed lib export).
//
// ★★ A retry on 2 is safe BECAUSE of the 409 path: if a create landed and
//   only its response was lost, the retry answers 409 and the GET confirms it.
// ★★★ EVERY decision about a response is made by the pure classifiers in
//   release-publish-lib.mjs, which are unit- and mutation-tested, against an
//   `expected` taken from the payload by expectedFromPayload(). This file only
//   fetches, redacts, prints, and maps a verdict to an exit code.
// ★★ `redirect: "manual"` on BOTH requests. A followed redirect turns the POST
//   into a GET, and that GET's 200 once read as "created".
// ★★ No classifier message contains a response body. This file is the one
//   place a body is printed, so it redacts CI_JOB_TOKEN out of every body
//   excerpt — BEFORE truncating it, so a token straddling the cut cannot leak
//   a prefix — and out of the caught error. It never prints its own headers.
// ★ --dry-run validates CI_API_V4_URL and CI_PROJECT_ID exactly as a real run
//   does, builds and prints the payload, and says only whether a token is
//   PRESENT. It makes no network call, and it is the only part runnable
//   locally. Any other argument exits 2: a typo'd `--dryrun` used to send a
//   real POST.
// ★ Both libraries are imported dynamically, inside the one try, so a renamed
//   export or a moved version.ts shape exits 2 with a clean message instead
//   of Node's default exit 1, which here is the REFUSAL code.
import { readFileSync } from "node:fs";

const TIMEOUT_MS = 30_000;
const BODY_EXCERPT_CHARS = 2000;

const token = process.env.CI_JOB_TOKEN;
// ★ An empty token is falsy on purpose: split("") would put the marker
// between every character of the text.
const redact = (s) => (token ? String(s).split(token).join("[REDACTED]") : String(s));
const say = (msg) => console.log(`[release:publish] ${redact(msg)}`);
const fail = (code, msg, body) => {
  console.error(`[release:publish] ${redact(msg)}`);
  if (body) console.error(redact(body).slice(0, BODY_EXCERPT_CHARS));
  process.exit(code);
};

const args = process.argv.slice(2);
const unknown = args.filter((a) => a !== "--dry-run");
if (unknown.length > 0) {
  fail(2, `CANNOT PUBLISH: unknown argument(s) ${unknown.join(" ")} — the only flag is --dry-run`);
}
const dryRun = args.includes("--dry-run");

/** The body as JSON, or null — a proxy's HTML page is not an answer. */
function parseJsonOrNull(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

try {
  const { SOURCE_FILE, readSourceFrom } = await import("./version-sync-lib.mjs");
  const { buildReleasePayload, expectedFromPayload, classifyCreateResponse, classifyExistingRelease } = await import(
    "./release-publish-lib.mjs"
  );

  const { version, milestone } = readSourceFrom(readFileSync(SOURCE_FILE, "utf8"));
  const payload = buildReleasePayload(process.env, version, milestone);
  const expected = expectedFromPayload(payload);

  // ★ Trailing slashes stripped, so `.../api/v4/` cannot build `v4//projects`.
  // A backward scan, not `/\/+$/`: that regex backtracks quadratically when a
  // long run of slashes is NOT at the end (measured: 100k slashes then one
  // other character took ~12 s), and this scan is linear.
  const rawApi = process.env.CI_API_V4_URL ?? "";
  let apiEnd = rawApi.length;
  while (apiEnd > 0 && rawApi[apiEnd - 1] === "/") apiEnd--;
  const api = rawApi.slice(0, apiEnd);
  const projectId = process.env.CI_PROJECT_ID;
  // ★ Name WHICH one is missing, never the value of any of them.
  const missing = [!api && "CI_API_V4_URL", !projectId && "CI_PROJECT_ID", !dryRun && !token && "CI_JOB_TOKEN"].filter(
    Boolean,
  );
  if (missing.length > 0) fail(2, `CANNOT PUBLISH: missing ${missing.join(", ")}`);

  // new URL() throws on a malformed CI_API_V4_URL, in --dry-run as well.
  const endpoint = new URL(`${api}/projects/${encodeURIComponent(projectId)}/releases`).href;

  if (dryRun) {
    say(`--dry-run, nothing sent. Would POST ${endpoint} (JOB-TOKEN ${token ? "present" : "absent"}). Payload:`);
    console.log(redact(JSON.stringify(payload, null, 2)));
    process.exit(0);
  }

  const call = (url, init) =>
    fetch(url, {
      ...init,
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { "JOB-TOKEN": token, ...init.headers },
    });

  const res = await call(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await res.text();
  const created = classifyCreateResponse(res.status, parseJsonOrNull(body), expected);

  if (created.kind === "created") {
    say(`created release for ${expected.tagName}`);
    say(`asset: ${expected.assetUrl}`);
    process.exit(0);
  }

  if (created.kind === "check-existing") {
    say(`HTTP 409: a Release for ${expected.tagName} already exists — checking whether it carries this asset link`);
    const got = await call(`${endpoint}/${encodeURIComponent(expected.tagName)}`, { method: "GET" });
    const gotBody = await got.text();
    const existing = classifyExistingRelease(got.status, parseJsonOrNull(gotBody), expected);
    if (existing.code === 0) {
      say(existing.message);
      say(`asset: ${expected.assetUrl}`);
      process.exit(0);
    }
    // ★ Clamp: only the classifier's explicit 1 leaves as 1; anything else is 2.
    fail(existing.code === 1 ? 1 : 2, existing.message, gotBody);
  }

  // ★ Clamp: only an explicit fail/1 leaves as 1. Anything else — including a
  // verdict shape this file does not know — is 2, and never 0.
  fail(
    created.kind === "fail" && created.code === 1 ? 1 : 2,
    created.message ?? "CANNOT CONFIRM: the create classifier returned no verdict",
    body,
  );
} catch (err) {
  // ★ `err` need not be an Error (`throw null`), so never read .message off
  // it directly. fetch's own message is only "fetch failed"; the reason is on
  // `cause` — an errno code (ECONNREFUSED, ECONNRESET), or for a blocked port
  // no code at all, only a message ("bad port"). An AbortSignal timeout
  // arrives as a TimeoutError.
  // ★★ Describing `err` can itself throw — String() of a prototype-less
  // object has no toString — and a throw from INSIDE this catch is uncaught,
  // so Node would exit 1, the REFUSAL code. Hence its own try and a fixed
  // fallback: this catch always exits 2.
  let detail = "an error that could not be described";
  try {
    const cause = err?.cause?.code ?? err?.cause?.message;
    detail = err instanceof Error ? `${err.name}: ${err.message}${cause ? ` (${cause})` : ""}` : String(err);
  } catch {
    // keep the fallback
  }
  fail(2, `CANNOT PUBLISH: ${detail}`);
}
```

★ Read `buildReleasePayload`'s real signature — `(env, version, milestone)` after Task 5 — rather than any older sketch of it.

- [ ] **Step 7: Prove the dry run validates the API half and prints the right URL**

```bash
CI_PROJECT_URL=https://gitlab.example/g/p CI_COMMIT_TAG=v0.301.0 \
CI_API_V4_URL=https://gitlab.example/api/v4 CI_PROJECT_ID=1 CI_JOB_TOKEN=canary-not-a-token \
  node scripts/publish-release.mjs --dry-run > "$SP/b-t6-dry.log" 2>&1; echo "DRY_EXIT=$?"
grep -E "Would POST|\"tag_name\"|job=desktop-package-tag" "$SP/b-t6-dry.log"
```

Expected: `DRY_EXIT=0`; `Would POST https://gitlab.example/api/v4/projects/1/releases (JOB-TOKEN present)`; `"tag_name": "v0.301.0"`; and an asset URL of the form
`https://gitlab.example/g/p/-/jobs/artifacts/v0.301.0/raw/desktop/release/aipm-cockpit-0.301.0-setup.exe?job=desktop-package-tag`.
★ `CI_API_V4_URL` and `CI_PROJECT_ID` are REQUIRED even here — a dry run that passes without them proves nothing about the half that talks to the API. Only the token is optional, and only its presence is printed.

- [ ] **Step 8: Prove it refuses rather than half-publishing**

Every call carries a CANARY token, so "prints no token" is a count rather than a hope. Each call strips any real `CI_API_V4_URL` / `CI_JOB_TOKEN` inherited from your shell with `env -u` BEFORE the canary is set, so none can reach a real API: the refusals have no API URL at all, and the `--dryrun` row's URL is `127.0.0.1:1`, a port on fetch's blocked-ports list, so fetch refuses it without opening a socket.

```bash
env -u CI_API_V4_URL CI_PROJECT_URL=https://gitlab.example/g/p CI_COMMIT_TAG= CI_PROJECT_ID=1 CI_JOB_TOKEN=canary-not-a-token \
  node scripts/publish-release.mjs --dry-run > "$SP/b-t6-notag.log" 2>&1; echo "NOTAG_EXIT=$?"
env -u CI_API_V4_URL -u CI_JOB_TOKEN CI_PROJECT_URL= CI_COMMIT_TAG=v0.301.0 CI_PROJECT_ID=1 CI_JOB_TOKEN=canary-not-a-token \
  node scripts/publish-release.mjs > "$SP/b-t6-nourl.log" 2>&1; echo "NOURL_EXIT=$?"
env -u CI_API_V4_URL -u CI_JOB_TOKEN CI_PROJECT_URL=https://gitlab.example/g/p CI_COMMIT_TAG=v0.301.0 CI_PROJECT_ID=1 CI_JOB_TOKEN=canary-not-a-token \
  node scripts/publish-release.mjs > "$SP/b-t6-noapi.log" 2>&1; echo "NOAPI_EXIT=$?"
env -u CI_API_V4_URL -u CI_JOB_TOKEN CI_API_V4_URL=http://127.0.0.1:1/api/v4 CI_PROJECT_URL=https://gitlab.example/g/p CI_COMMIT_TAG=v0.301.0 CI_PROJECT_ID=1 CI_JOB_TOKEN=canary-not-a-token \
  node scripts/publish-release.mjs --dryrun > "$SP/b-t6-typo.log" 2>&1; echo "TYPO_EXIT=$?"
cat "$SP/b-t6-notag.log" "$SP/b-t6-nourl.log" "$SP/b-t6-noapi.log" "$SP/b-t6-typo.log"
grep -c canary "$SP/b-t6-dry.log" "$SP/b-t6-notag.log" "$SP/b-t6-nourl.log" "$SP/b-t6-noapi.log" "$SP/b-t6-typo.log"
```

Expected: `NOTAG_EXIT=2`, `NOURL_EXIT=2`, `NOAPI_EXIT=2`, `TYPO_EXIT=2`, naming in turn `CI_COMMIT_TAG is missing or empty`, `CI_PROJECT_URL is missing or empty`, `missing CI_API_V4_URL`, and `unknown argument(s) --dryrun`; and `:0` for every log in the last line. ★ Read the COUNT, not `grep`'s exit status, which is 1 whenever the count is 0.

★★★ **FOR THE `--dryrun` ROW, THE MESSAGE IS THE ASSERTION — ITS EXIT CODE CANNOT SEE THE GUARD.** Measured against a scratchpad copy of the CLI with the unknown-argument guard DELETED, under every environment this row could use:

| Environment | Guard present | Guard deleted |
|---|---|---|
| API at blocked port 1, canary token (the row above) | 2 — `unknown argument(s) --dryrun` | 2 — `fetch failed (bad port)` |
| API set, token unset | 2 — `unknown argument(s) --dryrun` | 2 — `missing CI_JOB_TOKEN` |
| API unset (this row's previous form) | 2 — `unknown argument(s) --dryrun` | 2 — `missing CI_API_V4_URL` |

Any environment that cannot reach a network exits 2 either way, because failing to reach one IS exit 2. So a green `TYPO_EXIT=2` alone proves nothing; the `unknown argument(s) --dryrun` line does. The exit code only discriminates against an API that would CONFIRM the POST — which is Step 10's live-server row, where deleting the guard turns 2 into 0.

- [ ] **Step 9: Drive the real path against a local fake API**

The CLASSIFIER unit tests cannot see `redirect: "manual"`, the timeout or the redaction — those live in the CLI. Step 10 commits an integration test that pins the redirect, the argument guard and the redaction; this one-off matrix additionally covers what that test skips (the 30 s timeout, a refused connection, a blocked port, a missing lib). Run the CLI against a throwaway local HTTP server — written to the scratchpad with the Write tool, never a heredoc — that answers each case below, logs every request it receives (method, path, and whether a `JOB-TOKEN` header was PRESENT, never its value), and is killed by the PID that started it. Every call sets `CI_JOB_TOKEN=canary-not-a-token`. Measured:

| Case | Exit | What the server saw |
|---|---|---|
| 201, our tag and link | 0 | POST |
| 201, another tag | 2 | POST |
| 201, no link | 2 | POST |
| 200 HTML page | 2 | POST |
| 302 → a path answering `200 []` | 2 | POST only — the redirect was NOT followed |
| 409, then GET 200 carrying our link | 0 | POST, GET `.../releases/v0.301.0` |
| 409, then GET 200 without our link | 1 | POST, GET |
| 409, then GET 404 | 2 | POST, GET |
| 409, then GET `200 []` | 2 | POST, GET |
| 403 | 1 | POST |
| 429 | 2 | POST |
| 500 | 2 | POST |
| 400 whose body echoes the request's token | 1 | POST — the echo prints as `[REDACTED]` |
| 400 whose echoed token straddles the 2000-char excerpt cut | 1 | POST |
| `--dryrun` (typo) with a live server | 2 | nothing |
| `--dry-run` with a live server | 0 | nothing |
| connection refused (a closed ephemeral port) | 2 | — (`fetch failed (ECONNREFUSED)`) |
| port 9 | 2 | — (`fetch failed (bad port)`: fetch's blocked-ports list, NOT a refused connection) |
| a copy of the CLI with neither lib beside it | 2 | — (`Cannot find module`, never Node's default 1) |
| a server that never answers | 2 | POST — `TimeoutError` after ~30.2 s |

plus the six local env rows of Steps 7 and 8 (26 cases in all). `grep -c canary` over ALL captured CLI output: **0**.
★★ Both zeros need a positive control or they prove nothing. The echo row's output contains `[REDACTED]` exactly once, so the token really did come back; and a scratchpad COPY of the CLI with truncate-then-redact instead of redact-then-truncate leaks a `canar` prefix on the straddle row where the committed order leaks none.
★ The timeout path runs at the real 30 s. The design has no env hook to shorten it, deliberately — an override is one more input to a job that holds a token.

- [ ] **Step 10: Pin the CLI end to end with a committed test**

A one-off matrix proves the CLI once; only a committed test keeps it proved. Create `scripts/publish-release.integration.test.mjs`:

```js
// @vitest-environment node
//
// scripts/publish-release.mjs END TO END: the real CLI, spawned as a child
// process, against a fake Releases API on an ephemeral loopback port.
//
// ★★ The classifiers have their own unit tests; THIS file covers what only a
// real run can see — `redirect: "manual"`, the unknown-argument guard, the
// trailing-slash strip, and redaction of an echoed body BEFORE it is cut to
// its excerpt. Each of those was mutation-proved against this file.
//
// ★ The child is started with async `spawn`, never `spawnSync`: the fake API
// lives in THIS process, and a synchronous spawn would block the event loop
// that has to answer the child's request.
//
// ★ Every CI_* variable is stripped from the child's environment before the
// fake ones are set, so a real CI_JOB_TOKEN from the pipeline running this
// test can never reach the child — and the canary is the only token it sees.
import { spawn } from "node:child_process";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const REPO = fileURLToPath(new URL("..", import.meta.url));
const CLI = fileURLToPath(new URL("./publish-release.mjs", import.meta.url));
const TOKEN = "canary-not-a-token";
const RELEASES = "/api/v4/projects/1/releases";
const EXISTING = `${RELEASES}/v0.301.0`;
const MOVED = "/api/v4/moved";

const send = (res, status, body, headers = {}) => {
  res.writeHead(status, { "Content-Type": "application/json", ...headers });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
};
/** The Release body a real GitLab would return for the payload we POSTed. */
const echo = (payload) => ({ tag_name: payload.tag_name, assets: { links: payload.assets.links } });
const withOtherLink = (payload) => ({
  tag_name: payload.tag_name,
  assets: { links: [{ url: "https://example.com/other.exe" }] },
});

let api;
afterEach(async () => {
  if (!api) return;
  api.server.closeAllConnections();
  await new Promise((resolve) => api.server.close(resolve));
  api = undefined;
});

/** The only paths a row's `respond` is ever asked to answer. */
const KNOWN_PATHS = new Set([RELEASES, EXISTING, MOVED]);

/**
 * Start the fake API. `respond({ req, res, posted, body })` answers each
 * request to a KNOWN path; `posted` is the payload of the first POST to the
 * releases endpoint.
 *
 * ★ Every other path gets a 404 here, before any row sees it. A CLI that
 * builds a wrong URL (a `v4//projects` path, say) must fail FAST on the
 * `requests` assertion — without this, a row's `respond` ran against a null
 * `posted`, threw inside the server, left the request unanswered, and the row
 * died on the 20 s test timeout instead of on the assertion that names the
 * defect.
 */
async function startApi(respond) {
  const requests = [];
  let posted = null;
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      requests.push(`${req.method} ${req.url}`);
      if (!KNOWN_PATHS.has(req.url)) return send(res, 404, { message: "404 Not Found" });
      if (req.method === "POST" && req.url === RELEASES && posted === null) posted = JSON.parse(body);
      respond({ req, res, posted, body });
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, requests, url: `http://127.0.0.1:${server.address().port}/api/v4` };
}

function runCli(apiUrl, args) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("CI_")));
  Object.assign(env, {
    CI_PROJECT_URL: "https://gitlab.example/g/p",
    CI_COMMIT_TAG: "v0.301.0",
    CI_PROJECT_ID: "1",
    CI_API_V4_URL: apiUrl,
    CI_JOB_TOKEN: TOKEN,
  });
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, ...args], { cwd: REPO, env });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, out }));
  });
}

// Each row: how the fake API answers, what the CLI must exit with, exactly
// which requests the API must have received, and text the output must hold.
const ROWS = [
  {
    name: "201 echoing our tag and link exits 0",
    respond: ({ res, posted }) => send(res, 201, echo(posted)),
    code: 0,
    requests: [`POST ${RELEASES}`],
    outHas: ["created release for v0.301.0"],
  },
  {
    name: "201 naming another tag exits 2",
    respond: ({ res, posted }) => send(res, 201, { ...echo(posted), tag_name: "v0.999.0" }),
    code: 2,
    requests: [`POST ${RELEASES}`],
    outHas: ["CANNOT CONFIRM: 201 but the body lacks"],
  },
  {
    // Followed, a 302 turns the POST into a GET whose `200 []` once read as "created".
    name: "302 exits 2 and is NOT followed",
    respond: ({ req, res }) =>
      req.url === RELEASES ? send(res, 302, "", { Location: MOVED }) : send(res, 200, []),
    code: 2,
    requests: [`POST ${RELEASES}`],
    outHas: ["HTTP 302 redirect"],
  },
  {
    // A followed 307 RE-POSTS to the new location, which here would confirm —
    // so this row exits 0 and records two requests if the redirect is followed.
    name: "307 exits 2 and is NOT followed, even to a location that would confirm",
    respond: ({ req, res, body }) =>
      req.url === RELEASES ? send(res, 307, "", { Location: MOVED }) : send(res, 201, echo(JSON.parse(body))),
    code: 2,
    requests: [`POST ${RELEASES}`],
    outHas: ["HTTP 307 redirect"],
  },
  {
    name: "409, then a GET carrying our link, exits 0",
    respond: ({ req, res, posted }) =>
      req.method === "POST" ? send(res, 409, { message: "Release already exists" }) : send(res, 200, echo(posted)),
    code: 0,
    requests: [`POST ${RELEASES}`, `GET ${EXISTING}`],
    outHas: ["already exists with this asset link"],
  },
  {
    name: "409, then a GET without our link, exits 1",
    respond: ({ req, res, posted }) =>
      req.method === "POST" ? send(res, 409, { message: "Release already exists" }) : send(res, 200, withOtherLink(posted)),
    code: 1,
    requests: [`POST ${RELEASES}`, `GET ${EXISTING}`],
    outHas: ["exists WITHOUT", "Release links API"],
  },
  {
    // The GET after a 409 must not follow a redirect either: here the moved
    // location would CONFIRM, so a followed GET exits 0 on a Release nobody read.
    name: "409, then a GET answering 307, exits 2 and does NOT follow it",
    respond: ({ req, res, posted }) => {
      if (req.method === "POST") return send(res, 409, { message: "Release already exists" });
      if (req.url === EXISTING) return send(res, 307, "", { Location: MOVED });
      return send(res, 200, echo(posted));
    },
    code: 2,
    requests: [`POST ${RELEASES}`, `GET ${EXISTING}`],
    outHas: ["returned HTTP 307, not 200"],
  },
  {
    name: "403 exits 1 with the Developer+ advice",
    respond: ({ res }) => send(res, 403, { message: "403 Forbidden" }),
    code: 1,
    requests: [`POST ${RELEASES}`],
    outHas: ["API refused: HTTP 403", "Developer+"],
  },
  {
    name: "429 exits 2 (transient)",
    respond: ({ res }) => send(res, 429, { message: "Retry later" }),
    code: 2,
    requests: [`POST ${RELEASES}`],
    outHas: ["HTTP 429 is transient"],
  },
  {
    name: "500 exits 2",
    respond: ({ res }) => send(res, 500, { message: "500 Internal Server Error" }),
    code: 2,
    requests: [`POST ${RELEASES}`],
    outHas: ["HTTP 500"],
  },
  {
    name: "400 whose body echoes the token exits 1, with the token redacted",
    respond: ({ req, res }) => send(res, 400, { message: `bad request from token ${req.headers["job-token"]}` }),
    code: 1,
    requests: [`POST ${RELEASES}`],
    outHas: ["API refused: HTTP 400", "bad request from token [REDACTED]"],
  },
  {
    // `{"message":"` is 12 chars, so 1983 filler puts the token at char 1995,
    // straddling the CLI's 2000-char excerpt cut. Truncate-then-redact would
    // leave "canar" in the output; redact-then-truncate cuts the MARKER.
    name: "a token straddling the 2000-char excerpt cut leaks no prefix",
    respond: ({ req, res }) => send(res, 400, { message: `${"y".repeat(1983)}${req.headers["job-token"]} tail` }),
    code: 1,
    requests: [`POST ${RELEASES}`],
    outHas: ["yyyyy[REDA"],
  },
  {
    // The API would CONFIRM a POST, so only the guard keeps this at 2.
    name: "--dryrun (a typo) exits 2 and sends nothing",
    args: ["--dryrun"],
    respond: ({ res, posted }) => send(res, 201, echo(posted)),
    code: 2,
    requests: [],
    outHas: ["unknown argument(s) --dryrun"],
  },
  {
    name: "--dry-run exits 0 and sends nothing",
    args: ["--dry-run"],
    respond: ({ res, posted }) => send(res, 201, echo(posted)),
    code: 0,
    requests: [],
    outHas: ["--dry-run, nothing sent", "JOB-TOKEN present"],
  },
  {
    name: "trailing slashes on CI_API_V4_URL do not reach the request path",
    apiSuffix: "//",
    respond: ({ res, posted }) => send(res, 201, echo(posted)),
    code: 0,
    requests: [`POST ${RELEASES}`],
    outHas: ["created release for v0.301.0"],
  },
];

describe("publish-release.mjs against a fake Releases API", () => {
  it.each(ROWS)("$name", async ({ respond, args = [], apiSuffix = "", code, requests, outHas }) => {
    api = await startApi(respond);
    const r = await runCli(`${api.url}${apiSuffix}`, args);
    // Requests first: a wrong URL or a followed redirect shows up here, by name.
    expect(api.requests).toEqual(requests);
    expect(r.code, r.out).toBe(code);
    for (const text of outHas) expect(r.out).toContain(text);
    // The canary must never reach the output — not whole, and not as a prefix.
    expect(r.out).not.toContain(TOKEN);
    expect(r.out).not.toContain("canar");
  });
});
```

```bash
npx vitest run scripts/publish-release.integration.test.mjs --maxWorkers=1 > "$SP/b-t6-int.log" 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " "$SP/b-t6-int.log"
npx vitest list scripts/publish-release.integration.test.mjs --maxWorkers=1 > "$SP/b-t6-int-list.log" 2>&1
grep -c "Failed to start" "$SP/b-t6-int-list.log"
grep -c "^scripts/publish-release.integration.test.mjs >" "$SP/b-t6-int-list.log"
```

Expected: EXIT=0, `Test Files  1 passed (1)`, `Tests  15 passed (15)`, `0` "Failed to start" lines, and the count `15` (Step 4 explains why that zero must be checked).

★ The fake API answers ONLY the three paths a row expects (the releases endpoint, the existing Release, and a redirect target) and 404s everything else before any row sees it. So a CLI that builds a wrong URL fails FAST, on the `requests` assertion, which the test checks first. Without that, a wrong path reached a row's handler with nothing posted, the handler threw, the request went unanswered, and the row died on the 20 s test timeout.

★★ **The catch's fixed-fallback message has NO committed test**, and cannot have one without adding an injection point to the CLI: nothing reachable from outside makes the description itself throw. It was proved once, on scratchpad copies throwing `Object.create(null)` at the top of the try — exit 1 before the inner try existed, exit 2 after.

★★ It spawns with async `spawn`, never `spawnSync`: the fake API lives in the test's own process, and a synchronous spawn blocks the event loop that has to answer the child. ★ It strips every `CI_*` variable before setting the fake ones, so a real `CI_JOB_TOKEN` in the pipeline running the suite never reaches the child.

Mutation-proved one mutant at a time, as in Step 5 — each is the defect a review said would otherwise ship green:

| Mutant in `publish-release.mjs` | Result — the failing row, and the assertion that fired |
|---|---|
| truncate BEFORE redacting the body excerpt | KILLED by the straddle row alone: its `yyyyy[REDA` check fails, since the cut now lands inside the token, and `canar` reaches the output |
| `redirect: "follow"` on the POST only | KILLED by the 302 row AND the 307 row, both on `requests`: two requests reach the API. Unguarded, the followed 307 re-POSTs to a location that CONFIRMS |
| `redirect: "follow"` on the GET only | KILLED by the 409-then-307 row, on `requests`: three requests, because the followed GET reaches the confirming location |
| the unknown-argument guard deleted | KILLED by the `--dryrun` row, on `requests`: the POST is sent |
| the trailing-slash strip deleted | KILLED by the trailing-slash row, on `requests`: the path becomes `/api/v4///projects/1/releases` (the URL's `//` plus the endpoint's own `/`), and it failed in ~240 ms instead of timing out |

Every row that failed did so in under 300 ms. ★ The 307 row is the one that proves `redirect: "manual"` on the POST, not the 302: a followed 302 becomes a GET whose unrelated answer still exits 2, so only the request COUNT catches it there, while a followed 307 keeps the POST and its body and would publish.

- [ ] **Step 11: Add the npm script and its description**

Edit `package.json` with the **Edit tool** (its working copy is CRLF — the Edit tool preserves that). In `"scripts"`, after `"tag:check"`:

```json
    "release:publish": "node scripts/publish-release.mjs",
```

In `"scriptsDescriptions"`, after its `"tag:check"` entry:

```json
    "release:publish": "Create the GitLab Release for the current tag and attach an asset link to the installer built by desktop-package-tag. Needs CI_API_V4_URL, CI_PROJECT_ID, CI_PROJECT_URL, CI_COMMIT_TAG and CI_JOB_TOKEN. Outside --dry-run, exit 0 means a confirmed Release and nothing else: a 201 echoing this tag and link, or a 409 whose existing Release already carries the link. Exit 1 is a 4xx refusal (a human must act), or a 409 whose Release lacks the link. Exit 2 is everything else, all safe to retry: missing env, an unknown argument, network, the 30 s timeout, 408/429, 5xx, a redirect, an unconfirmable 2xx. `--dry-run` validates the same env except the token, prints the payload and whether a token is present, and sends nothing. Uses node's fetch deliberately: no release-cli image, no curl.",
```

★ Both lines END IN A COMMA: `tag:check` is not the last entry in either object — `e2e:desktop` follows it in both — so a snippet without one is invalid JSON.

- [ ] **Step 12: Regenerate and check**

```bash
npm run docs:scripts > "$SP/b-t6-gen.log" 2>&1; echo "GEN_EXIT=$?"
npm run docs:scripts:check > "$SP/b-t6-chk.log" 2>&1; echo "CHK_EXIT=$?"
grep -hE "unchanged|would-update|updated" "$SP/b-t6-gen.log" "$SP/b-t6-chk.log"
```

Expected: both EXIT=0; the GENERATE run prints `updated: CONTRIBUTING.md`, and only the CHECK run prints `unchanged: CONTRIBUTING.md`.

- [ ] **Step 13: Commit — four commits, each path-limited**

The first two landed the classifiers and the CLI; the third and fourth are the fix rounds from the second and third cold reviews. ★ The third message's closing claims (project membership, 128 tests) are a RECORD of that commit and are superseded by the fourth: see Task 8 and Task 10 for the current text.

```bash
git commit -F - -- scripts/release-publish-lib.mjs scripts/release-publish-lib.test.mjs <<'EOF'
fix(ci): the release classifiers confirm the tag and refuse to guess

classifyExistingRelease read any JSON object on a 200 as the Release: a 200 []
or {} returned code 1 with advice to delete a Release nobody had identified,
and another tag's Release carrying our link returned code 0. It now needs a
plain object naming our tag with a readable link list before it returns 0 or
1; anything else is 2.

Neither classifier validated expected, so {} confirmed a 201 whose link had no
url (undefined === undefined on both comparisons) and undefined threw. Both
now refuse, as fail/2, an expected missing either value, through the same
emptiness rule required() uses. expectedFromPayload builds it from the payload
being sent, so the CLI never assembles it by hand.

408 and 429 are transient, so 2 rather than the refusal code: a retry is safe
because a create that did land answers 409 and the 409 path confirms it. A
non-numeric status is refused before any range check, so "201" no longer
reads "HTTP 201 is not 201 Created", and 0/NaN/600 read "unexpected status"
rather than "could not be reached".

Mutation-tested one mutant at a time: 65 mutants, 62 killed, 3 equivalent.

Claude-Session: https://[session link removed]
EOF
git add scripts/publish-release.mjs
git commit -F - -- scripts/publish-release.mjs package.json CONTRIBUTING.md docs/superpowers/plans/2026-09-10-release-publishing.md <<'EOF'
feat(ci): release:publish, which exits 0 only on a confirmed Release

The plan's first cut was run verbatim against a local fake API before any of
it landed, and its success path was the fall-through: res.ok took any 2xx, so
a 200 HTML page exited 0 "created", and a POST answered 302 was followed as a
GET whose 200 [] also exited 0. A 409 was a plain refusal, so a create whose
response was lost made every retry fail forever.

This version exits 0 only on a 201 echoing this tag and link, or on a 409
whose existing Release already carries the link. Every verdict comes from the
pure, mutation-tested classifiers in release-publish-lib.mjs, against an
expected taken from the payload. Exit 1 is a 4xx refusal or a 409 Release
without the link; 2 is everything else, all retry-safe: missing env, an
unknown argument (a typo'd --dryrun used to POST), network, a 30 s timeout,
408/429, 5xx, a redirect (redirect: "manual" on both requests), an
unconfirmable 2xx, and any structural failure, since both libs are imported
inside the one try.

The token is redacted from every echoed body before it is truncated, and from
the caught error. --dry-run now validates CI_API_V4_URL and CI_PROJECT_ID too
and prints only whether a token is present.

Driven through 26 cases against a local fake API with a canary token: every
exit code as designed, the canary in 0 lines of output, and both zeros backed
by a positive control.

The plan's Task 6 is rewritten to the committed code, byte for byte, and its
step defects fixed: the dry run passes the API variables, every refusal call
carries a canary and cannot reach a network, the package.json snippets carry
their trailing commas, and the generate run's expected output says "updated".
Task 10 now expects 113 tests (16 + 97), derived with vitest list because
grep -c cannot count it.each rows, and its dry run passes the API variables
it now needs.

Claude-Session: https://[session link removed]
EOF
git add scripts/publish-release.integration.test.mjs
git commit -F - -- scripts/publish-release.mjs scripts/publish-release.integration.test.mjs scripts/release-publish-lib.mjs scripts/release-publish-lib.test.mjs package.json CONTRIBUTING.md .gitlab-ci.yml docs/superpowers/plans/2026-09-10-release-publishing.md <<'EOF'
fix(ci): release:publish is tested end to end, and its catch cannot exit 1

scripts/publish-release.integration.test.mjs spawns the real CLI against a
fake Releases API on an ephemeral port: 14 rows, a canary token, and the
canary asserted absent on every one. Mutation-proved: truncating before
redacting, following a redirect on the POST, deleting the unknown-argument
guard and deleting the trailing-slash strip each turn it red. Before it, all
four would have shipped green.

The catch built its message with String(err), which throws for a
prototype-less object, and a throw inside a catch exits 1 -- the refusal
code. The description now has its own try and a fixed fallback; a scratchpad
copy throwing Object.create(null) exits 1 before the fix and 2 after.

Trailing slashes on CI_API_V4_URL are stripped, so .../api/v4/ cannot build
v4//projects. classifyCreateResponse's 201 branch applies the same
isPlainObject rule as classifyExistingRelease, so an array carrying our tag
and link is fail/2, pinned by a test. The CLI header, scriptsDescriptions and
CONTRIBUTING say that 0 means a confirmed Release outside --dry-run.

The plan's Step 8 --dryrun row now points at fetch's blocked port 1 and
asserts the message, because its exit code cannot see the guard: with the
guard deleted it still exits 2 (bad port), as it does under every other
environment the row could use -- measured. Sizes in the measurement record
are labelled MiB where du produced them (97,353,634 bytes is 97.4 MB /
92.8 MiB), and the same comments in .gitlab-ci.yml follow. The user-facing
Task 8 text drops the size and says a download needs project membership, not
merely a signed-in account, which the lib's own docstring already claimed
desktop-rollout.md said. Task 10 now runs three files: 128 tests (16 + 98 + 14).

Claude-Session: https://[session link removed]
EOF
git commit -F - -- scripts/publish-release.mjs scripts/publish-release.integration.test.mjs scripts/release-publish-lib.mjs docs/superpowers/specs/_probes/2026-09-10-wine-runner-and-artifact-size.md docs/superpowers/plans/2026-09-10-release-publishing.md <<'EOF'
fix(ci): the plan's probe, Task 11 and Task 8 say only what was measured

After 2de4b877 the probe file and the plan's copy of it disagreed: the plan
said 92.9 MiB with a unit caveat, while the committed probe still said
92.8 MB and ~7%. Both now carry the same text, byte for byte.

buildAssetUrl's docstring, and the plan, said "Task 11 checks it with a
non-member account", but Task 11 had no such step. It now has one (Step 6):
open the asset link as a signed-in non-member and record the result together
with the project's pipeline-visibility setting. Until that has run, neither
Task 8's user-facing text nor the docstring asserts an access rule. Two
earlier revisions asserted opposite rules, and neither was measured.

The integration test's fake API now 404s every path a row does not expect,
so a wrong URL fails fast on the requests assertion (now checked first)
instead of on a 20 s timeout. The slash-strip mutant, which builds
/api/v4///projects/1/releases, now dies in ~240 ms. A new row pins that the
GET after a 409 does not follow a 307 either; following on the GET alone
turns it red. That makes 15 rows, and Task 10 now expects 129 tests
(16 + 98 + 15).

The trailing-slash strip is now a backward scan instead of /\/+$/. The regex
took ~12 s on 100k slashes followed by one other character; the scan took
0.1 ms.

The plan's Step 4 said the ^ anchor was load-bearing. Measured: either guard
alone excludes npm's echoed command line (98), and only dropping both prints
99. The plan also records that vitest list exits 0 when its worker fails to
start and lists nothing, so the derivations now run it with --maxWorkers=1
and check for "Failed to start".

Claude-Session: https://[session link removed]
EOF
```

★ `git add` the new CLI first — a pathspec naming an untracked file fails `git commit -- <path>`. ★★ Never `git add -A`: another agent may be mid-edit in the same tree, and `git commit -- <paths>` commits exactly those paths while leaving anything someone else staged untouched.

---

## Task 7: Wire the publish job

**Files:**
- Modify: `.gitlab-ci.yml`
- Modify: this plan (Task 7 only — its YAML block is kept byte-identical to the job, modulo CRLF)

- [ ] **Step 1: Add the job**

Append at the end of `.gitlab-ci.yml`:

```yaml
# Tag pipelines only: create the Release and point it at the installer.
#
# ★★★ NO `needs:`, AND THAT IS DELIBERATE -- do NOT "optimise" this back to
# needs: [desktop-package-tag]. GitLab evaluates `needs:` purely against the
# STATUS of the jobs listed, and dependency jobs start the moment those finish
# WITHOUT waiting for the rest of the pipeline's stages to complete (GitLab
# source: atomic_processing_service.rb; GitLab docs: "Jobs start as soon as
# their dependencies finish without waiting for pipeline stages to complete").
# desktop-package-tag itself needs only [install, tag-version-check] (Task 4)
# -- so needs: [desktop-package-tag] HERE would let this job fire the instant
# that ONE job succeeds, even if some OTHER blocking gate on the same tag
# pipeline (lint, typecheck, semgrep, unit tests, build, ...) later fails --
# e2e and prod-smoke do NOT run on tag pipelines at all (their own rules
# match merge_request_event / the default branch only), so neither is among
# those gates. The per-tag asset URL this job publishes only resolves
# through a pipeline GitLab calls SUCCESSFUL, so a needs:-based publish can
# create a Release whose download link 404s -- the exact bug this plan
# exists to close, just moved one job over. Omitting `needs:` puts this job
# on ordinary STAGE order: it sits in `release`, the LAST stage, and
# inherits the default `when: on_success`, which the GitLab docs define
# verbatim as: "on_success (default): Run the job only when no jobs in
# earlier stages fail." -- closing the dead-link case for EVERY blocking
# gate on the tag pipeline, not just the tag guard.
# ★★ THAT INCLUDES dast-zap's `when: manual` rule. A manual job's
# allow_failure DEFAULTS TO FALSE inside `rules:`, and a blocking manual job
# stops the pipeline at its own stage -- so publish-release also depends on
# dast-zap's manual rule keeping `allow_failure: true`. If that key were
# ever dropped, every tag pipeline would sit "blocked" in e2e and never
# reach `release`.
# ★ `dependencies: []` (not `needs:`) says the same "no needs:" thing to the
# artifact-download side: this job fetches NO artifacts from earlier jobs --
# not node_modules, not the installer -- since `release:publish` only needs
# the installer's download URL, never its bytes.
# ★ `cache: []` switches off the npm cache this job would otherwise inherit
# from `default:`. Nothing here needs node_modules: `release:publish` is
# plain `node scripts/publish-release.mjs`, which imports only node builtins
# and two local .mjs files that import nothing themselves -- so there is no
# `npm ci` either. `default:` carries no before_script today; if one is ever
# added, this job inherits it, and wants `before_script: []`.
# ★★ No allow_failure: a tag whose Release was never created looks published
# and is not -- docs/desktop-rollout.md (linked from README) sends people to a
# page with no download on it.
# ★ Image inherited from `default:` (node:24-bookworm-slim). No release-cli,
# no curl: the script uses node's global fetch.
publish-release:
  stage: release
  dependencies: []
  cache: []
  rules:
    - if: $CI_COMMIT_TAG
  script:
    - npm run release:publish
```

★ It needs no `node_modules` — `publish-release.mjs` imports only `node:fs` statically and `./version-sync-lib.mjs` + `./release-publish-lib.mjs` dynamically, and neither lib has a single `import` or `require`. The `release:publish` script line is plain `node scripts/publish-release.mjs` (no `vite-node`/`tsx` wrapper) and `package.json` defines no `prerelease:publish` hook, so `npm run` works on a checkout with no install. That is what licenses `cache: []` and the absence of `npm ci`. Measured 2026-09-11 by reading the files, not assumed:

```bash
grep -nE "\bfrom\s+['\"]|\bimport\s*\(|\brequire\s*\(" scripts/publish-release.mjs scripts/release-publish-lib.mjs scripts/version-sync-lib.mjs
grep -nE '"(pre|post)?release:publish"' package.json
```

→ three hits, all in `publish-release.mjs` (`node:fs`, and the two local `.mjs` files); and `release:publish` alone (the script line plus its `scriptsDescriptions` entry), no `pre`/`post` hook.

★★ **`default:` is the thing to re-check if this job ever misbehaves.** Today it sets `image` (`node:24-bookworm-slim`) and `cache` (the `.npm/` pull cache) and nothing else — no `before_script`, no `artifacts`, no `interruptible`. `cache: []` overrides the one inherited key that would cost anything; `image` is inherited on purpose.

- [ ] **Step 2: Verify the YAML and the job's keys**

Write a verifier to the scratchpad with the **Write tool** (not `node -e` — quoting a YAML key like `$CI_COMMIT_TAG` through a shell is its own trap). It loads `.gitlab-ci.yml` with the repo's own `js-yaml` (`node_modules/yaml` does not exist here), takes an optional path argument so it can be pointed at a mutated copy, and asserts, printing PASS/FAIL per line and exiting 1 on any FAIL:

1. the job's key set is **exactly** `{stage, dependencies, cache, rules, script}` — which alone rules out `needs`, `allow_failure`, `extends` and `before_script`, and each of those also gets its own named check;
2. `stage: release`; `dependencies: []`; `cache: []`; `rules` deep-equals `[{if: "$CI_COMMIT_TAG"}]` (one rule, no `when`, no `allow_failure`); `script` is `["npm run release:publish"]`;
3. `release` is the LAST entry of `stages`, and `publish-release` is the only job in it;
4. the job's EFFECTIVE values after `default:` — the job has no `extends`, so `default:` is the only merge source: image `node:24-bookworm-slim`, cache `[]`, no inherited `before_script`; and `default:` holds only `image` + `cache`;
5. `workflow:rules` admits `$CI_COMMIT_TAG`, and `dast-zap`'s `when: manual` rule still carries `allow_failure: true`;
6. `ARTIFACT_JOB` read out of `scripts/release-publish-lib.mjs` names a job that exists and runs on tags — meaning the FIRST of its rules that matches a tag pipeline (`if: $CI_COMMIT_TAG`, or a rule with no `if`/`changes`/`exists`) exists and is not `when: never`, because GitLab's first matching rule decides. (Step 3's grep checks the name half only.)

```bash
node "$SP/t7-pub-verify.cjs" > "$SP/t7-pub-verify.log" 2>&1; echo "EXIT=$?"
cat "$SP/t7-pub-verify.log"
```

Measured 2026-09-11: `EXIT=0`, every line PASS, and the literal job prints as `{"stage":"release","dependencies":[],"cache":[],"rules":[{"if":"$CI_COMMIT_TAG"}],"script":["npm run release:publish"]}` with `stages` `["install","quality","build","e2e","release"]`.

★★ **Then prove it can go red.** A second scratchpad script wrote six mutated copies of `.gitlab-ci.yml` INTO THE SCRATCHPAD (never the repo) — add `needs: [desktop-package-tag]`, drop `cache: []`, drop `dependencies: []`, add `allow_failure: true`, move the job to `stage: e2e`, and drop `dast-zap`'s manual `allow_failure` — and ran the verifier on each: **6 of 6 exited 1**, each naming the assertion it broke. A verifier nobody has seen fail is a claim, not a check.

- [ ] **Step 3: Confirm the job name in the URL matches the job that exists**

The asset URL hardcodes `?job=desktop-package-tag` via `ARTIFACT_JOB`. Prove the two agree:

```bash
grep -n "ARTIFACT_JOB = " scripts/release-publish-lib.mjs
grep -n "^desktop-package-tag:" .gitlab-ci.yml
```

Expected: the exported constant and the YAML job name are the same string. Measured 2026-09-11: both print `desktop-package-tag`. ★★ **Nothing checks this automatically** — a rename on either side produces a 404 at download time, long after a green pipeline. (The Step 2 verifier's last two checks cover this and one thing more, but that script lives in a scratchpad and runs in no CI job. The first is this same name comparison. The second asks whether that job RUNS on a tag pipeline, which the grep cannot see.)

★★ **That second check was vacuous as first written.** `t7-pub-verify.cjs` passed it if ANY rule said `if: $CI_COMMIT_TAG` — which is true of `desktop-package` too, whose tag rule is `when: never`, so it would have passed with `ARTIFACT_JOB` naming a job that never runs on a tag. The corrected copy, `t8-pub-verify.cjs` (the original is left as it ran), requires the first tag-matching rule to exist and not be `when: never`. Proved against a scratchpad copy of `.gitlab-ci.yml` whose `desktop-package-tag` tag rule gained `when: never`: the corrected verifier exits 1, naming `{"if":"$CI_COMMIT_TAG","when":"never"}`; the original exits 0 on the same file; against the real `.gitlab-ci.yml` the corrected one exits 0 with every line PASS.

- [ ] **Step 4: Commit**

Path-limited, from a message file written with the Write tool, and with THIS plan in the same commit so the YAML block above cannot drift from the job it describes:

```bash
git commit -F "$SP/t7-pub-msg.txt" -- .gitlab-ci.yml docs/superpowers/plans/2026-09-10-release-publishing.md
```

The message:

```text
ci(release): publish the Release from the tag build's artifact

No needs: at all -- dependencies: [] plus ordinary stage order means this job
only runs once every job in every earlier stage has succeeded, which closes
the dead-link case for every blocking gate on the tag pipeline, not just
desktop-package-tag. A needs:-based publish would fire the moment that one
job succeeded regardless of any other gate, and could create a Release whose
asset link 404s later -- see the ★★★ note on the job. No allow_failure: a tag
whose Release was never created looks published and is not, and README sends
people to it.

cache: [] as well, which the plan's block was missing: without it the job
inherits default:'s npm cache pull for nothing. It needs no node_modules --
release:publish is plain `node scripts/publish-release.mjs`, which imports
node:fs and two local .mjs files that import nothing, and package.json has no
prerelease:publish hook -- so there is no npm ci either. default: carries only
image and cache, so no before_script is inherited; the job comment says what
to do if one is ever added.

Runs on the image inherited from default: (node:24-bookworm-slim) -- no
release-cli, no curl. The comment no longer quotes the installer's size: the
job never downloads it, so the figure bought nothing and would only go stale.

The plan's Task 7 is synced to what landed: its YAML block is byte-identical
to the job (modulo CRLF), Step 2 describes the verifier that was actually run
-- key set, effective values after default:, stage order, the dast-zap
precondition and ARTIFACT_JOB, driven red by six mutants (6 of 6 exit 1) --
and this commit block replaces the one it prescribed.

Claude-Session: https://[session link removed]
```

---

## Task 8: Tell people where to download it

**Files:**
- Modify: `docs/desktop-rollout.md`
- Modify: `docs/RUNBOOK.md`

`docs/desktop-rollout.md:5` currently says "Run the installer from the share" and owns the download location (README links to that file and names no download location itself, so there is exactly one place to update). ★ Checked when this landed: nothing else in the rollout doc names a share, a network path, a size or a publisher.

- [ ] **Step 1: Replace the rollout doc's install step**

With the **Edit tool**, replace these three steps in `docs/desktop-rollout.md`:

```markdown
1. Run the installer from the share.
2. Windows will show a blue **"Windows protected your PC"** box. This is expected: the app is not code-signed. Click **More info**, then **Run anyway**.
3. The app installs for your user only — you do **not** need admin rights.
```

with:

```markdown
1. Download the installer from the project's **Releases** page — pick the newest
   release and click its asset link, `aipm-cockpit-<version>-setup.exe (Windows installer)`.
   You need to be signed in to GitLab with access to the project's pipelines.
   If the link answers with a 404 or a permission error, ask a project
   maintainer for access to the project.
2. Run it.
3. Windows will show a blue **"Windows protected your PC"** box. This is expected: the app is not code-signed. Click **More info**, then **Run anyway**.
4. The app installs for your user only — you do **not** need admin rights.
```

★ The link text is the asset link's NAME as `buildReleasePayload` in `scripts/release-publish-lib.mjs` builds it — the file name plus ` (Windows installer)` — not the bare file name an earlier revision of this block quoted.

★★ **This text makes one weak access claim and leaves the real rule open, because nobody has measured it.** What it CLAIMS: the reader must be signed in to GitLab (the project is `internal`, so an anonymous visitor gets nothing) and must have "access to the project's pipelines" — near-tautological for downloading a job artifact, but still a claim, and the only one. What it LEAVES OPEN: which role that takes, and whether a signed-in NON-member qualifies; the 404 sentence routes anyone it excludes to a maintainer without saying why. GitLab's permissions docs make job-artifact access depend on the user's role AND on the project's pipeline-visibility setting; depending on that setting, a signed-in NON-member of an internal project may or may not be able to download. Two earlier revisions of this step each asserted a rule — "being signed in is enough", then "project membership is required" — and neither was verified. **Task 11 Step 6 settles it** by opening the asset link as a signed-in non-member. Once it has, tighten this paragraph to the measured rule, and `buildAssetUrl`'s docstring in `scripts/release-publish-lib.mjs` with it, which points at that step.

★ No size is quoted in this user-facing text, as in the Release description (Task 5): a figure there goes stale on the next release and nothing checks it.

The block above already carries the renumbering: the SmartScreen box becomes 3
and the per-user install 4, which is the file's actual structure (three steps
before this change, verified).

- [ ] **Step 2: Add the operator procedure to the RUNBOOK**

`docs/RUNBOOK.md` owns operations — build, deploy, rollback — and cutting a release is one. It has no desktop or Electron section to merge into, so add one between `## Rollback` and `## Secrets` (after the build/deploy/rollback material, before the common-issues list):

```markdown
## Publishing a desktop release

1. Bump `src/app/version.ts` (`APP_VERSION`, `APP_BUILD_DATE`, `APP_MILESTONE`),
   add the `CHANGELOG.md` entry, and propagate with `npm run version:sync`,
   which rewrites every other file that restates the version —
   `version-sync-check` is blocking.
2. Merge to the default branch.
3. Tag the merged commit: `git tag v<version> && git push origin v<version>`.
   The tag **must** match `APP_VERSION`; `tag-version-check` runs as soon as the
   tag pipeline starts and fails otherwise (exit 1 is drift, exit 2 means it
   could not scan at all). A failure holds back `publish-release`, which runs
   only once every earlier stage has passed. It should also skip the installer
   build, which lists the check in its `needs:`, but that half is GitLab
   behaviour no tag pipeline has shown yet. Whoever pushes the tag needs
   Developer+ and the right to create protected tags, because the pipeline's job
   token acts with the pusher's access — GitLab behaviour as documented,
   unverified here.
4. The tag pipeline runs `desktop-package-tag` (blocking; a full wine build, so
   slow) and then, only once every earlier stage has passed, `publish-release`,
   which creates the Release and attaches the installer link.
5. Check the Releases page: the asset link should download
   `aipm-cockpit-<version>-setup.exe`.

**If the tag pipeline is red.** `publish-release` has no `needs:` and runs only
once every earlier stage has passed.

- **Another job failed.** If the failure was flaky, retry that job, and GitLab
  then runs the skipped `publish-release`. A deterministic failure — tag drift,
  a real lint or test error — fails the same way on every retry: it needs a fix
  and a new tag, because a tag's pipeline only ever builds the commit the tag
  names. Until the pipeline is green the asset link may 404, because GitLab
  resolves a per-tag artifact URL only through a successful pipeline. The retry
  running `publish-release` and the 404 are GitLab behaviour, unverified here.
- **`publish-release` exited 2** (a timeout, a 5xx, a 408/429, a 2xx it could not
  confirm): retry it. A create that did land answers 409 the second time, and the
  job exits 0 only if that existing Release carries the link. A redirect or a
  missing variable also exits 2 and will not clear on a retry, so read the message.
- **`publish-release` exited 1**: a human must act. Either the API refused with
  a 4xx other than 408, 409 or 429 (for a 403 it prints
  `API refused: HTTP 403 (the tag pusher needs Developer+, and the right to create protected tags)`,
  which is step 3's access), or it answered 409 and the Release that already
  exists for the tag lacks the link
  (`a Release for <tag> exists WITHOUT <link> — add the link (Release links API) or delete that Release, then retry`).

★ Tag-build artifacts never expire, deliberately — a published download must not
vanish. The manual `desktop-package` build on other pipelines still expires
after a week.

★★ If `desktop-package-tag` cannot run on the wine image, the fallback is a
local Windows build (`npm ci` and `npm --prefix desktop ci`, then
`npm run desktop:build && npm run desktop:package`; the installer lands in
`desktop/release/`), attached by hand to a Release you create yourself — a
failed `desktop-package-tag` stops the pipeline before `publish-release` runs.
If the image is unreachable for good and the `desktop-package` jobs are deleted,
remove or disable `publish-release` in the same change: it has no `needs:`, so
on its own it would go on running on every tag and publish a Release whose link
names a job that no longer exists — a green pipeline over a download that 404s.
See `docs/superpowers/specs/_probes/2026-09-10-wine-runner-and-artifact-size.md`
for why that is the sanctioned fallback rather than a thing to debug in CI.

★★ The installer is unsigned. A copy downloaded through a browser carries the
Mark-of-the-Web stream the browser writes on download, which is what SmartScreen
checks, so colleagues should expect the prompt. A locally built copy was
measured to carry no such stream (`Get-Item -Stream *` lists `:$DATA` alone), so
"no prompt appeared" from a local build is not evidence the prompt is gone for
colleagues.
```

★★ **Six claims in this block's first revision did not survive checking, and are corrected above:**
- "six places carry the version" — `version:sync` (`scripts/version-sync-lib.mjs`) also writes `desktop/package.json` and `desktop/package-lock.json` now. The count is dropped rather than replaced, since the next satellite moves it again; "milestone" is named as the real field, `APP_MILESTONE`.
- "~20 min" — nothing measured it: the probe's "Measured" section is still unfilled. Now "a full wine build, so slow".
- "fails the pipeline immediately" — `tag-version-check` has `needs: []` and `desktop-package-tag` lists it in its own `needs:`, so the effect worth telling an operator is that the installer build is SKIPPED. Said that way.
- "Branch builds still expire after a week" — on non-tag pipelines `desktop-package` is `when: manual`; said so.
- The fallback said "uploaded to the Release by hand", but `desktop-package-tag` is blocking and `publish-release` runs on stage order with `when: on_success`, so when the wine build fails there is no Release to upload to. It now says to create one. It also needed `npm --prefix desktop ci`: `desktop/` has its own lockfile, and the CI job installs it before `npm run desktop:package`.
- "A downloaded copy prompts SmartScreen" was stated as fact; it is reasoning from the Mark-of-the-Web measurement in the probe ("What this does NOT establish"), so it now says colleagues should expect the prompt.

Two things were ADDED, both checked against the code: step 3's access requirement matches the 403 message in `classifyCreateResponse`, and the "If the tag pipeline is red" block matches `publish-release.mjs`'s exit contract.
- Exit 2 covers a timeout, a 5xx, a 408/429 and a 2xx that does not confirm — a 201 included — and ALSO a redirect and a missing variable, which is why the block says those will not clear on a retry: the CLI's header calls every exit 2 "safe to retry", which is not the same as "fixed by a retry".
- A retry after a landed create gets a 409 that `classifyExistingRelease` resolves to 0 only when the existing Release carries the link, and to 1 when it does not.
- The two exit-1 messages are quoted verbatim from `classifyCreateResponse` (the 403 suffix) and `classifyExistingRelease` (the WITHOUT message), with `<tag>` and `<link>` standing for the interpolated values.
- The two GitLab claims — a retried job makes GitLab run the skipped `publish-release`, and a per-tag artifact URL resolves only through a successful pipeline — are GitLab's documented behaviour as read, not measured on this project, and the block says so. The plan's original block had no recovery path, and `d65a70c8`'s covered only `publish-release`'s own exits; a cold review of Task 7 asked for the rest, because no `needs:` means ANY red gate on the tag pipeline holds the Release back.

- [ ] **Step 3: Check the docs gates**

```bash
npm run docs:claims:check > "$SP/b-t8-claims.log" 2>&1; echo "CLAIMS_EXIT=$?"
grep -iE "none added|out of range" "$SP/b-t8-claims.log"
```

Expected: EXIT=0 and "none added". ★ Neither new block carries a `path:LINE` citation, so the ratchet must not move. If it did, you introduced one — convert it to a symbol name rather than re-baselining.

Measured when this landed — `CLAIMS_EXIT=0` and:

```
doc-claims ratchet ok — 490 line citations across 11 docs, none added (1 unresolvable + 2 out-of-range grandfathered; 9 third-party, not repo debt)
```

★★ "11 docs" counts only the docs that HOLD a citation, so it cannot show that `docs/RUNBOOK.md` is in scope at all. The falsifier, run then reverted: a backticked `scripts/publish-release.mjs` plus `:51` added to the RUNBOOK's step 2 turned the gate red (exit 1, "docs/RUNBOOK.md: NEW line citation to scripts/publish-release.mjs (1×)"), and removing it restored the line above. The two totals in that line move whenever any doc gains or loses a citation; quote the "none added", not the numbers.

- [ ] **Step 4: Commit**

Written to a message file and committed path-limited, so nothing else staged in the shared tree can ride along:

```bash
git commit -F <msgfile> -- docs/desktop-rollout.md docs/RUNBOOK.md docs/superpowers/plans/2026-09-10-release-publishing.md
```

```
docs: name the download location, and the release procedure

desktop-rollout.md said "run the installer from the share", and it owns the
download location -- README links to it and names no location itself, so
there is exactly one place to update. It now points at the Releases page,
names the asset link as publish-release creates it, and says what to do if
the link 404s. It deliberately does not say WHO has access: that depends on
the project's pipeline-visibility setting and is measured by Task 11 Step 6.
Nothing else in the file named a share, a size or a publisher.

RUNBOOK gains the operator procedure, between Rollback and Secrets: bump,
merge, tag, what each tag job does, and what a failed publish-release means.
Exit 2 -- a 201 it could not confirm included -- is safe to re-run, because
a create that landed answers 409 and is confirmed by reading it back; exit 1
needs a human, and a 403 names the tag pusher's access, which step 3 now
states. It records the wine fallback as sanctioned rather than something to
debug in CI, and that a local build's missing SmartScreen prompt is not
evidence about a downloaded one.

Claims the plan's blocks carried that did not survive checking:
- "six places carry the version": version:sync also writes
  desktop/package.json and desktop/package-lock.json now. The count is
  dropped, not replaced; the milestone field is named, APP_MILESTONE.
- "~20 min": nothing measured it -- the probe's Measured section is still
  empty. Now "a full wine build, so slow".
- "fails the pipeline immediately": the effect worth telling an operator is
  that desktop-package-tag, which needs tag-version-check, is skipped.
- "branch builds expire after a week": desktop-package is a manual job on
  non-tag pipelines; said so.
- the fallback said "uploaded to the Release", but a failed
  desktop-package-tag stops the pipeline before publish-release runs, so
  there is no Release to upload to. It now says to create one, and that the
  local build needs npm --prefix desktop ci first (desktop/ has its own
  lockfile).
- the SmartScreen line stated as fact what is reasoning from the probe's
  Mark-of-the-Web measurement; colleagues now "should expect" the prompt.
- the asset link is named "aipm-cockpit-<version>-setup.exe (Windows
  installer)" by buildReleasePayload, not the bare file name.

The plan's Task 8 is synced: both blocks are byte-identical to the two docs,
Step 3 carries the gate's real output and a falsifier that proves the RUNBOOK
is in the gate's scope, and this block replaces the commit it prescribed.

Claude-Session: https://[session link removed]
```

- [ ] **Step 5: The recovery round**

A cold review of Task 7 found that the RUNBOOK said only what happens when the tag pipeline goes right. The recovery block now in Step 2's markdown landed as a second commit, together with the Task 7 verifier correction (Task 7 Step 3) and the reworded access note in Step 1. The gate was re-run and gave `CLAIMS_EXIT=0`, "none added". The block-sync check compares Step 1's blocks, Step 2's block and both commit blocks against the committed files.

```bash
git commit -F <msgfile> -- docs/RUNBOOK.md docs/superpowers/plans/2026-09-10-release-publishing.md
```

```
docs: the release procedure says how to recover a red tag pipeline

publish-release has no needs: and runs only once every earlier stage has
passed, so any red job on the tag pipeline holds the Release back -- and the
RUNBOOK said only what happens when things go right. It now has a short "If
the tag pipeline is red" block:
- another job failed, a flaky gate included: retry it, and GitLab runs the
  skipped publish-release; until the pipeline is green the asset link may
  404. Both are GitLab behaviour, marked unverified here.
- publish-release exited 2: retry it. A create that landed answers 409, and
  the job then exits 0 only if that Release carries the link. A redirect or
  a missing variable also exits 2 and a retry will not clear it -- the CLI
  calls every exit 2 safe to retry, which is not the same as fixed by one.
- exited 1: a human must act; the 403 and WITHOUT messages are quoted
  verbatim from release-publish-lib.mjs's two classifiers.
Step 5 loses the exit-code sentences it had; the block owns them now.

Plan, Task 7: the Step 2 verifier's "ARTIFACT_JOB job runs on tags" check
passed if any rule said if: $CI_COMMIT_TAG -- true of desktop-package too,
whose tag rule is when: never. A corrected copy requires the first
tag-matching rule to exist and not be when: never. Against a scratchpad
YAML whose desktop-package-tag rule gained when: never it exits 1 where the
original exits 0, and against the real file it passes. Step 2 item 6 and the
Step 3 parenthetical now say what the check proves.

Plan, Task 8: the access note called the user text NEUTRAL about access, but
that text still claims "access to the project's pipelines". The note now
says what the text claims and what it leaves open. The RUNBOOK block is
byte-identical to the doc again, and this message is recorded as Step 5.

Claude-Session: https://[session link removed]
```

- [ ] **Step 6: The hedge round**

A later cold review changed Step 2's block in five places, all now in the block above and byte-identical to `docs/RUNBOOK.md`:
- Step 3 stated as fact that a failing `tag-version-check` "skips the installer build". It now says what is known: the failure holds back `publish-release` (stage order, documented), and SHOULD skip the build, which lists the check in its `needs:` — hedged, because no fetched GitLab doc states what a failed `needs:` entry does (Task 9's note) and no tag pipeline has run. The job-token sentence is marked as GitLab's documented behaviour, unverified here: the CI/CD job token page says the token "receives the same access level as the user that triggered the pipeline". Round 1's correction ("fails the pipeline immediately" → SKIPPED) was itself the over-claim.
- "Another job failed" told the operator to retry. That clears a flaky failure only; a deterministic one (tag drift, a real lint or test error) needs a fix and a new tag, mirroring the exit-2 bullet's "will not clear on a retry".
- The exit-1 bullet said "a 4xx". `classifyCreateResponse` returns code 1 for a 4xx other than 408, 409 and 429, and a 409 goes to `classifyExistingRelease`, which returns 1 when the existing Release lacks the link. Both halves are now named.
- The wine fallback now says that deleting the build jobs (the probe's decision for an unreachable image) means removing or disabling `publish-release` in the same change. It has no `needs:`, so it would otherwise still run on every tag and publish a link to a job that no longer exists, on a green pipeline. The probe's decision table (Task 1's block) and the `.desktop-package` comment in `.gitlab-ci.yml` (Task 4's block) say the same.
- The SmartScreen line said a local build "does not prompt". The probe measured only that a locally built installer carries no Mark-of-the-Web stream, and the line now says that.

---

## Task 9: Update the CI enumeration in AGENTS.md

**Files:**
- Modify: `AGENTS.md` (the CI bullet in Steps 1–3; the Releasing bullet and the `version-sync-check` entry in Step 4)
- Modify: `CONTRIBUTING.md`, `.gitlab-ci.yml` (Step 4 — comments only in the YAML)

That file's CI bullet enumerates every pipeline job and ends with "New CI gate → also update this line." Four jobs are new to this branch — `tag-version-check`, `desktop-package`, `desktop-package-tag`, `publish-release`, none of them on `main` — and so is the `release` stage, so this is required, not optional. Re-measured 2026-09-11: `grep -n "desktop-package" AGENTS.md` returned **nothing** (exit 1) before this task, so there was no existing text to replace.

★★ `docs:symbols:check` gates this file, and only MIXED-CASE backticked names — MEASURED 2026-09-11, not reasoned: a probe appending one invented kebab-case name and one invented camelCase name to the new text failed the gate (exit 1) on the camelCase one ALONE. So the job names are never scanned, and `ARTIFACT_JOB` / `APP_VERSION` (SCREAMING_CASE) are not either.

- [ ] **Step 1: Extend the pipeline enumeration**

With the **Edit tool**, in the `- **CI is GitLab**` bullet. Every replacement below is the exact committed text, two-space indent included.

1. The `quality` list. Replace the line

```text
  is a permanent handle other docs cite] · **unit** [coverage floors: global lines 92/funcs 91/branch
```

with

```text
  is a permanent handle other docs cite] ·
  **tag-version-check** BLOCKING [tag pipelines only, `needs: []` — `npm run tag:check` asserts the tag
  is `v` + `APP_VERSION` (`scripts/check-tag-version.mjs` over `scripts/tag-version-lib.mjs`). ★★ SAME
  TWO-EXIT-CODE SPLIT: **1 is DRIFT** (the installer would misreport its own version), **2 is the gate
  unable to scan** (an empty tag — a rules bug — or `version.ts`'s shape moved). `desktop-package-tag`
  lists it in its own `needs:`, so the wine build waits for it rather than racing it (that a FAILED
  guard then SKIPS the build is expected `needs:` behaviour, but no GitLab doc checked here states it
  and no tag pipeline has shown it; `publish-release` is held back either way, by stage order)] · **unit** [coverage floors: global lines 92/funcs 91/branch
```

★ A later review round reworded the parenthetical: it first said the skip "is GitLab's default", which claims a documented default the note below says no fetched doc states. All four sites that describe the skip — this one, `docs/RUNBOOK.md` step 3, and the comments on `tag-version-check` and `desktop-package-tag` in `.gitlab-ci.yml` — now say the same thing: the WAIT is real, the skip is expected and unshown, and `publish-release` is held back regardless by its stage and default `when: on_success` (documented verbatim, and quoted in the YAML comment on that job).

★★ "Skips" is hedged on purpose. GitLab's docs say needs-jobs "start as soon as their dependencies finish", which verifies the WAIT; neither `docs.gitlab.com/ci/yaml/` nor `docs.gitlab.com/ci/yaml/needs/` states what happens to a job whose `needs:` entry FAILS (both fetched 2026-09-11). Do not upgrade the hedge without a citation or a real tag pipeline.

2. The dast-zap sentence inside the **prod-smoke** bracket. Replace

```text
  where its rule is `when: manual` WITH `allow_failure: true`. ★★ It is NOT unconditionally non-blocking,
```

with

```text
  where its rule is `when: manual` WITH `allow_failure: true` — tag pipelines match that rule too, and
  without the key a blocking manual job holds every later stage, so `publish-release` would never run.
  ★★ It is NOT unconditionally non-blocking,
```

Cited: the `allow_failure` section of `docs.gitlab.com/ci/yaml/` — "A blocked pipeline does not run any jobs in later stages until the manual job is started and completes successfully."

3. The `e2e` list and the new `release` stage. Replace

```text
  Reproduce with `sed -n '/^dast-zap:/,/^  image:/p' .gitlab-ci.yml`] · **dast-zap** weekly/manual].
```

with

```text
  Reproduce with `sed -n '/^dast-zap:/,/^  image:/p' .gitlab-ci.yml`] · **desktop-package** (manual,
  non-tag, `allow_failure: true`, artifact 1 week) · **desktop-package-tag** (tag pipelines, **BLOCKING**,
  artifact `expire_in: never`) · **dast-zap** weekly/manual] → release [**publish-release** BLOCKING, tag
  pipelines only — `npm run release:publish` (`scripts/publish-release.mjs` over
  `scripts/release-publish-lib.mjs`) creates the GitLab Release with a PER-TAG artifact link. ★★ NO
  `needs:`, on purpose — stage order is what holds it behind every earlier gate; the YAML comment says
  why. ★★★ That URL embeds the producing job's name (`ARTIFACT_JOB`), and nothing compares the constant
  to the YAML — its unit test pins a literal — so renaming `desktop-package-tag` alone 404s the next
  Release's download with every gate green].
```

★★★ An earlier draft of this step said a rename "404s the download on every PAST Release". That half is not established and was dropped: a past Release's link names the job inside ITS OWN tag's pipeline, which a later rename does not touch, and the web form resolves against "the latest successful pipeline" for the ref. What IS established is the half the text keeps — `release-publish-lib.test.mjs` asserts `ARTIFACT_JOB` against the literal `"desktop-package-tag"` and reads no YAML (`grep -rn "gitlab-ci" scripts/release-publish-lib.test.mjs scripts/publish-release.integration.test.mjs` returns nothing), so a rename on one side only is caught by nothing. ★ `ARTIFACT_JOB`'s own docstring in `scripts/release-publish-lib.mjs` said "past ones included" when this task landed; that file was outside this task and was reported, not edited. A later review round corrected the docstring (comment only) to what is known — a one-sided rename 404s the NEXT Release, a past Release's fate is not established, and the per-tag URL resolves only through the latest successful pipeline for the tag and only while its `expire_in: never` artifact still exists — and Task 5's lib block above changed with it.

4. The `quality-gate-bypass` sentence lists "EVERY other quality-stage job"; `tag-version-check` is a quality-stage job with no bypass label, so it joins the list. Replace

```text
  `doc-claims-check`, `followups-status-check`, `followups-index-check`, `unit-tests`,
```

with

```text
  `doc-claims-check`, `followups-status-check`, `followups-index-check`, `tag-version-check`, `unit-tests`,
```

Reproduce: the quality stage holds 16 jobs (parse `.gitlab-ci.yml` with the repo's `js-yaml` and group by `stage`), and `grep -n quality-gate-bypass .gitlab-ci.yml` still returns five lines in three jobs — so the list is 16 − 3 = 13 names.

★ Keep it short. That file regrew 111% in fifteen days once; a bullet past ~60 lines of subsystem detail belongs in `docs/AGENTS/`. Measured: Step 1 grows `AGENTS.md` from 176,997 to 178,530 bytes (`wc -c`).

- [ ] **Step 2: Run the gates that read this file**

```bash
npm run docs:symbols:check > "$SP/t9-symbols.log" 2>&1; echo "SYMBOLS_EXIT=$?"; tail -1 "$SP/t9-symbols.log"
npm run docs:claims:check > "$SP/t9-claims.log" 2>&1; echo "CLAIMS_EXIT=$?"; tail -1 "$SP/t9-claims.log"
```

Measured 2026-09-11 after Step 1:

```text
SYMBOLS_EXIT=0
13 doc(s): 1649 named symbols all resolve (against 49491 identifiers in src/scripts/e2e)
CLAIMS_EXIT=0
doc-claims ratchet ok — 490 line citations across 11 docs, none added (1 unresolvable + 2 out-of-range grandfathered; 9 third-party, not repo debt)
```

The totals are a moment's, not a property — read the EXIT lines. A symbols failure names the backticked symbol it could not resolve — fix the name, never the allowlist.

- [ ] **Step 3: Commit**

`AGENTS.md` and `docs/superpowers/plans/` are both `text eol=lf`; check `git ls-files --eol AGENTS.md` reads `i/lf w/lf` before committing.

```bash
git commit -F "$SP/t9-msg-a.txt" -- AGENTS.md docs/superpowers/plans/2026-09-10-release-publishing.md
```

with `$SP/t9-msg-a.txt` holding exactly:

```text
docs(agents): enumerate the tag-pipeline jobs and the release stage

The CI bullet ends with "New CI gate -> also update this line", and none of
tag-version-check, desktop-package, desktop-package-tag or publish-release was
in it. Records the tag guard's two-exit-code split, that desktop-package-tag
blocks where desktop-package does not, that publish-release has no needs: on
purpose, and that nothing compares the job name embedded in every asset URL
to the YAML. Adds the clause publish-release depends on to the dast-zap
sentence, and tag-version-check to the quality-stage jobs with no bypass label.

The plan's draft said a rename 404s every PAST Release; that half is not
established and was dropped, and the plan now says why.

Claude-Session: https://[session link removed]
```

- [ ] **Step 4: Name every file `version:sync` writes, where the version is documented — a SEPARATE commit**

`SATELLITES` in `scripts/version-sync-lib.mjs` also writes `desktop/package.json` and `desktop/package-lock.json`; `grep -n 'file: "' scripts/version-sync-lib.mjs` prints six entries. Three prose sites omitted both, and each gets the smallest fix that stops it rotting again:

★★ **There was a FOURTH site, and this step missed it:** `version-sync-check`'s own comment in `.gitlab-ci.yml` enumerated "package.json, both package-lock.json entries, the README shields badge and every docs/CODEMAPS header" and said "hand-editing six places" — item 4 below edited that same file and did not touch it. A later review round replaced the enumeration with a pointer to `SATELLITES` plus the reproduce grep. The same commit removed the two other stale copies a repo-wide grep found: the "six other places" count in `scripts/version-sync-lib.mjs`'s own header, and the `version:check` description reported as NOT fixed below. Older plans and specs that say "six places" are dated records of their own slices and were left alone.

1. `AGENTS.md`'s Releasing bullet said "FIVE MORE PLACES". The count and the enumeration are DROPPED rather than corrected — a count rots — and replaced by a pointer to the lib plus its reproduce grep:

```text
  strings). ★★ EVERY OTHER COPY OF THE VERSION IS GATED BY `npm run version:check`, and the list is
  `SATELLITES` in `scripts/version-sync-lib.mjs` — not this line, which said "FIVE MORE PLACES" and
  missed `desktop/package.json` + `desktop/package-lock.json`. Read it with
  `grep -n 'file: "' scripts/version-sync-lib.mjs` (one line per file or glob; each lockfile carries
  TWO occurrences); CONTRIBUTING.md's Versioning table says what changes in each.
```

and its "rather than editing six places by hand" becomes "rather than editing each by hand".

2. `AGENTS.md`'s `version-sync-check` entry restated the same list. It now links rather than restates:

```text
  truth for the version and codename; every file the Releasing bullet below points at restates one or
  both, and nothing compared them before this job. Propagate with `npm run version:sync` rather than
  hand-editing them. ★★ TWO FAILURE
```

3. `CONTRIBUTING.md`'s Versioning table sits OUTSIDE the `<!-- AUTO-GENERATED from package.json scripts -->` pair (that block ends well above `### Versioning`), so it is hand-edited: two rows, and one sentence naming the lib as the tiebreak:

```text
cannot anchor on — and fix the pattern in that case, never the file. The table
mirrors `SATELLITES` in `scripts/version-sync-lib.mjs`; where the two disagree the
lib is right (`grep -n 'file: "' scripts/version-sync-lib.mjs` lists its files):
```

```text
| `desktop/package.json` | `version` |
```

```text
| `desktop/package-lock.json` | `version` **twice** — the root one and the `packages[""]` one |
```

★ NOT fixed, reported: the `version:check` row of CONTRIBUTING.md's GENERATED scripts table ("package.json, lockfile, README badge, codemap headers") omits the desktop files too. It is generated from `package.json`'s `scriptsDescriptions`, which this task does not touch. ★ Fixed by the later review round named above: the description now points at `SATELLITES`, and the generated row was edited to match byte for byte (checked by reproducing `buildTable` from `scripts/sync-script-docs.mjs` against both files, with a control pairing the new `package.json` against the old `CONTRIBUTING.md` that reports drift).

4. `.gitlab-ci.yml`, comments only. Two comments said "README and docs/desktop-rollout.md" tell people where to download; only `docs/desktop-rollout.md` names the location and README links to it. Both become "docs/desktop-rollout.md (linked from README)", and the Task 4 and Task 7 YAML blocks above change identically — both measured still byte-identical to `.gitlab-ci.yml` after CRLF→LF. Edit tool only; `git ls-files --eol .gitlab-ci.yml` stays `i/lf w/crlf` (631 CRLF, 0 bare LF), and a `js-yaml` parse hashes to the same sha256 before and after.

Gates, measured 2026-09-11:

```text
SYMBOLS_EXIT=0
CLAIMS_EXIT=0
SCRIPTS_EXIT=0
[sync-script-docs] unchanged: CONTRIBUTING.md
```

- [ ] **Step 5: Commit Step 4**

```bash
git commit -F "$SP/t9-msg-b.txt" -- AGENTS.md CONTRIBUTING.md .gitlab-ci.yml docs/superpowers/plans/2026-09-10-release-publishing.md
```

with `$SP/t9-msg-b.txt` holding exactly:

```text
docs: every file version:sync writes is named where the version is documented

SATELLITES in scripts/version-sync-lib.mjs also writes desktop/package.json
and desktop/package-lock.json, and three prose sites omitted both. AGENTS.md's
Releasing bullet ("FIVE MORE PLACES") now points at the lib and its reproduce
grep instead of carrying a count; its version-sync-check entry points at that
bullet instead of restating the list; CONTRIBUTING.md's Versioning table, which
sits outside the generated scripts block, gains the two rows and names the lib
as the tiebreak.

Also .gitlab-ci.yml, comments only: README does not name the download location,
it links docs/desktop-rollout.md, which does. The parsed YAML is identical
before and after, and the plan's Task 4 and Task 7 blocks change with it.

Claude-Session: https://[session link removed]
```

---

## Task 10: Local gate chain

**Files:** none — this task runs gates and fixes what they report.

⚠️ Never read a gate's exit code through a pipe. Never run two vitest processes at once.

- [ ] **Step 1: Typecheck and lint**

```bash
npx tsc --noEmit > "$SP/b-g-tsc.log" 2>&1; echo "EXIT=$?"; grep -c "error TS" "$SP/b-g-tsc.log"
npx eslint --max-warnings=0 src desktop scripts e2e > "$SP/b-g-lint.log" 2>&1; echo "LINT_EXIT=$?"
tail -5 "$SP/b-g-lint.log"
```

Expected: `0` TS errors (read the COUNT, not the exit code) and `LINT_EXIT=0`. Use this eslint form, not `npm run lint`, which exits 1 on gitignored `.worktrees/` leftovers.

- [ ] **Step 2: The three new script suites, named explicitly**

```bash
npx vitest run scripts/tag-version-lib.test.mjs scripts/release-publish-lib.test.mjs scripts/publish-release.integration.test.mjs > "$SP/b-g-unit.log" 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " "$SP/b-g-unit.log"
```

Expected: EXIT=0, `Test Files  3 passed (3)`, `Tests  129 passed (129)` (16 + 98 + 15). Derive it rather than trusting this line — `npx vitest list scripts/tag-version-lib.test.mjs scripts/release-publish-lib.test.mjs scripts/publish-release.integration.test.mjs --maxWorkers=1 > "$SP/b-g-list.log" 2>&1; grep -c "Failed to start" "$SP/b-g-list.log"; grep -cE "^scripts/(tag-version-lib|release-publish-lib|publish-release\.integration)\.test\.mjs >" "$SP/b-g-list.log"` — the first count must be `0`, because `vitest list` exits 0 even when its worker fails to start and lists nothing (Task 6 Step 4). ★★ NOT `grep -c "  it("`, which this line used to prescribe: it prints 16 + 29 + 0, because every `it.each` row is its own test at runtime and the integration file is a single `it.each`. The release-publish-lib file grew from 8 to 16 in the Task 5 review round and to 98 in Task 6; the integration file is Task 6's too. ★★★ **Assert `Test Files 3` against your own list length.** A mistyped path mixed with a real one is dropped **silently at exit 0** — the tally alone cannot tell you a file never ran.

- [ ] **Step 3: Docs, version and followup gates**

```bash
npm run version:check > "$SP/b-g-ver.log" 2>&1; echo "VERSION_EXIT=$?"
npm run docs:claims:check > "$SP/b-g-claims.log" 2>&1; echo "CLAIMS_EXIT=$?"
npm run docs:scripts:check > "$SP/b-g-scripts.log" 2>&1; echo "SCRIPTS_EXIT=$?"
npm run docs:symbols:check > "$SP/b-g-sym.log" 2>&1; echo "SYMBOLS_EXIT=$?"
npm run followups:index:check > "$SP/b-g-fi.log" 2>&1; echo "FI_EXIT=$?"
npm run followups:status:check > "$SP/b-g-fs.log" 2>&1; echo "FS_EXIT=$?"
grep -iE "none added" "$SP/b-g-claims.log"; grep -iE "unchanged" "$SP/b-g-scripts.log"
grep -i "README" "$SP/b-g-ver.log"
```

Expected: all EXIT=0; claims "none added"; scripts "unchanged: CONTRIBUTING.md". ★★ For `version:check`, confirm the output **NAMES** its satellites (`README.md: version=…`, `desktop/package.json…`) — a bare 0 does not prove anything was read.

- [ ] **Step 4: The two guards, driven both ways one final time**

The tree has moved since Tasks 3 and 6; re-run the proofs rather than trusting them.

```bash
CI_COMMIT_TAG=v9.9.9 node scripts/check-tag-version.mjs; echo "DRIFT_EXIT=$?"
CI_COMMIT_TAG= node scripts/check-tag-version.mjs; echo "UNSCANNABLE_EXIT=$?"
VER=$(node -e "console.log(require('fs').readFileSync('src/app/version.ts','utf8').match(/APP_VERSION = \"([^\"]+)\"/)[1])")
CI_COMMIT_TAG=v$VER node scripts/check-tag-version.mjs; echo "MATCH_EXIT=$?"
CI_PROJECT_URL=https://gitlab.example/g/p CI_COMMIT_TAG=v$VER CI_API_V4_URL=https://gitlab.example/api/v4 CI_PROJECT_ID=1 CI_JOB_TOKEN=canary-not-a-token node scripts/publish-release.mjs --dry-run > "$SP/b-g-dry.log" 2>&1; echo "DRY_EXIT=$?"
grep -E "job=desktop-package-tag" "$SP/b-g-dry.log"
grep -c canary "$SP/b-g-dry.log"
```

Expected: `1`, `2`, `0`, `0`, the asset URL naming the tag job, and a canary count of `0`. ★ The dry run needs `CI_API_V4_URL` and `CI_PROJECT_ID` since Task 6 — without them it exits 2 by design, because a dry run that skips the API half proves nothing about it.

- [ ] **Step 5: Size and duplication ratchets**

```bash
npm run size:check > "$SP/b-g-size.log" 2>&1; echo "SIZE_EXIT=$?"
npm run dup:check > "$SP/b-g-dup.log" 2>&1; echo "DUP_EXIT=$?"
```

Expected: both EXIT=0. `size:check` walks `src` only, so these new `scripts/` files are outside it; `dup:check` compares the TOTAL duplicated-line percentage across all formats against the threshold in `package.json`'s `dup:check`.

- [ ] **Step 6: Confirm the tree is clean**

```bash
git status --porcelain
```

Expected: **empty**. Anything left is a probe from an earlier task that was not reverted.

---

## Task 11: First real run — REQUIRES THE USER'S EXPLICIT SAY-SO

**Files:** none — this task pushes and observes.

★★★ **STOP HERE unless the user has explicitly said to push.** The standing rule in this repo is no push, no MR and no merge without an explicit instruction, and no `--auto-merge` ever. Everything above is local and reversible; this task is not. **Tagging is separately irreversible** — a pushed tag with a wrong version publishes a Release, and deleting a published Release is not a clean undo.

- [ ] **Step 1: Push the branch and open the pipeline**

Nothing here runs on a branch pipeline except the existing jobs — `tag-version-check`, `desktop-package-tag` and `publish-release` are all `if: $CI_COMMIT_TAG`. So a branch push proves the YAML parses and changes nothing else.

Confirm in the pipeline that the three tag-only jobs are **absent**. If any appears, its rule is wrong — that is the `unscannable` case the guard reports as exit 2, and it would fire on every branch.

- [ ] **Step 2: Resolve Spike 1 by running `desktop-package` manually**

Follow the procedure in
`docs/superpowers/specs/_probes/2026-09-10-wine-runner-and-artifact-size.md`, fill in its **Measured** section, and apply its decision table. Read the log for the image pull, the build, and **the artifact upload separately** — a size rejection arrives after a green build.

Then confirm the artifact contains the installer and its `.blockmap` and **not** `win-unpacked/`. That is the spec's §6.2 verification, and the only way to see it is to look at what GitLab stored.

- [ ] **Step 3: Commit the spike finding**

```bash
git add docs/superpowers/specs/_probes/2026-09-10-wine-runner-and-artifact-size.md
git commit --only docs/superpowers/specs/_probes/2026-09-10-wine-runner-and-artifact-size.md -F - <<'EOF'
docs(spike): resolve the wine runner and artifact size questions

Fills in the measured section from the first manual run: image pull, build
outcome, and the artifact's stored size and contents as GitLab reports them.

Claude-Session: https://[session link removed]
EOF
```

- [ ] **Step 4: Prove the tag guard red in CI, not just locally**

The spec requires the guard to be driven red with a mismatched tag. Locally that is Task 10 Step 4; in CI it needs a real tag, so use a throwaway one on a branch commit:

```bash
git tag v9.9.9
git push origin v9.9.9
```

Expected: the tag pipeline goes red at `tag-version-check` **before** any wine build starts, with the drift message naming both values. Then remove it:

```bash
git push origin :refs/tags/v9.9.9
git tag -d v9.9.9
```

★★ Do this **before** any real release tag. A guard proved only locally has never been exercised through the `rules:` that decide whether it runs at all — and a rule that never matches is the failure mode this step exists to catch.

- [ ] **Step 5: The first real release — a separate decision**

This needs a version bump, a CHANGELOG entry and a merge, none of which are in this plan. When the user asks for it, follow `docs/RUNBOOK.md`'s new "Publishing a desktop release" section.

- [ ] **Step 6: Measure who can download — as a signed-in NON-member**

Needs a published Release, so it runs after Step 5. Open the Release's asset link while signed in to GitLab as a user who is **NOT a member of the project** — a colleague outside it, or a test account. Record, in `docs/superpowers/specs/_probes/2026-09-10-wine-runner-and-artifact-size.md`'s **Measured** section:

1. The outcome: the installer downloads, or a 404 / permission error.
2. The project's pipeline-visibility setting (**Settings → CI/CD → General pipelines**, "Project-based pipeline visibility" — read it, or ask a maintainer who can).

Then make Task 8's `docs/desktop-rollout.md` wording and `buildAssetUrl`'s docstring in `scripts/release-publish-lib.mjs` say the measured rule. Both deliberately assert NONE today, and both point here.

★★ This is the only step that can settle it. GitLab's permissions docs make job-artifact access depend on both the role and that setting, and two earlier revisions of this plan asserted opposite rules without measuring either. A download that works for you, a member, proves nothing about a colleague who is not one.

---

## Definition of done

- [ ] Spike 1's finding is committed with its **Measured** section filled in, and its decision table applied.
- [ ] `npm run tag:check` exits **1** on a mismatched tag, **2** on an empty one, **0** on a matching one — and the 0 case NAMES both values.
- [ ] The mismatched tag has been driven red **in CI**, not only locally.
- [ ] The stored tag artifact is the installer plus its `.blockmap`, ~93 MiB (97.5 MB), and contains no `win-unpacked/`.
- [ ] `desktop-package-tag` carries **no** `allow_failure`, and `desktop-package` still carries it under its manual rule.
- [ ] Tag artifacts are `expire_in: never`; branch artifacts are still `1 week`.
- [ ] `ARTIFACT_JOB` in `scripts/release-publish-lib.mjs` is the same string as the `desktop-package-tag` job name.
- [ ] `docs/desktop-rollout.md` names the Releases page and says what to do on a 404, and its access wording matches what Task 11 Step 6 measured.
- [ ] Task 11 Step 6 is recorded: whether a signed-in non-member could download, and the project's pipeline-visibility setting.
- [ ] `AGENTS.md`'s CI enumeration lists the five changed or new jobs.
- [ ] Task 10's gate chain is green and `git status --porcelain` is empty.

**Not in this plan, by decision:**

- **A publish abstraction for GitHub** (spec §6.6). GitHub cannot receive releases until the repo is public, off a personal account, and mirroring tags — none of it scheduled. Adding it later is another small job consuming the same artifact, not an indirection layer today.
- **The `release:` keyword** (§6.4) — it needs the `release-cli` image, and this pipeline already carries one unverified image dependency.
- **An auto-update feed** (§7). An `internal` project serves no unauthenticated downloads, so an `electron-updater` feed pointed here needs a token on every laptop. Spike 1 of the Electron plan owns that question, and this plan does not answer it.
- **Extracting release notes from `CHANGELOG.md`.** A heading rename would silently empty them; the Release links the file instead.
- **Any version bump, CHANGELOG entry, merge, or MR.**
