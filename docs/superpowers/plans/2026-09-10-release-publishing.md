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
| `desktop/release/win-unpacked/` | **314 MB** — an expanded duplicate of the installer's own contents |
| `aipm-cockpit-0.301.0-setup.exe` | **97,353,634 bytes (92.8 MB)** |
| `aipm-cockpit-0.301.0-setup.exe.blockmap` | **102,463 bytes** |
| A clean `desktop/release/` uploaded whole | ≈ **408 MB** (314 + 93 + ~1), matching the spec's 407 |
| After narrowing to installer + blockmap | ≈ **93 MB**, a ~77% reduction |

Reproduce: `du -sm desktop/release/*` and `ls -l desktop/release/*.exe desktop/release/*.blockmap`.

★★ **A local `desktop/release/` can hold TWO installers and that is not a bug.** electron-builder does not clean the directory, so a build predating the `artifactName` change leaves `aipm-cockpit Setup 0.301.0.exe` beside the new name — which is how a local `du` reports 500 MB rather than 408. CI always starts clean. The globs chosen in Task 4 are self-protecting against this anyway: `*-setup.exe` does not match `aipm-cockpit Setup 0.301.0.exe` (capital S, spaces).

★★★ **THE ARTIFACT IS 92.8 MB AND GITLAB'S DEFAULT `max_artifacts_size` IS 100 MB PER JOB.** That is ~7% headroom, and the spec records that the settings endpoint is admin-only and unreadable from here — so **this instance's real limit is unknown**, and 100 MB is the documented default, not a measured fact about  (GitLab). One electron bump or a few more bundled assets crosses it, and the failure lands as an upload error *after* a successful 20-minute build. Spike 1 measures it; Task 11 is where it is first observed.

## File structure

| File | Responsibility |
|---|---|
| `scripts/tag-version-lib.mjs` (new) | PURE. `classifyTag(tag, appVersion)` → `match` / `drift` / `unscannable`. No I/O, no `process.exit`, no shebang. |
| `scripts/tag-version-lib.test.mjs` (new) | Unit tests for the above, including the mismatch case the spec demands. |
| `scripts/check-tag-version.mjs` (new) | CLI. Reads `src/app/version.ts` via `version-sync-lib.mjs`, reads `CI_COMMIT_TAG`, owns the exit codes. Shebang. |
| `scripts/release-publish-lib.mjs` (new) | PURE. `buildAssetUrl(env)` and `buildReleasePayload(env)`. No fetch, no I/O, no shebang. |
| `scripts/release-publish-lib.test.mjs` (new) | Unit tests, including that the token never appears in the payload. |
| `scripts/publish-release.mjs` (new) | CLI. Does the one `fetch`, supports `--dry-run`. Shebang. |
| `package.json` | Two scripts (`tag:check`, `release:publish`) **and** their `scriptsDescriptions` entries. |
| `CONTRIBUTING.md` | Regenerated script table (`npm run docs:scripts`). |
| `.gitlab-ci.yml` | `release` stage; `tag-version-check` job; `.desktop-package` hidden base + `desktop-package` + `desktop-package-tag`; `publish-release` job. |
| `docs/desktop-rollout.md` | Where a colleague downloads the installer. It currently says "from the share". |
| `docs/RUNBOOK.md` | The operator procedure for cutting a release. RUNBOOK owns operations; this is one. |
| `AGENTS.md` | Its CI pipeline bullet enumerates every job. A new CI gate means updating it — that file says so itself. |
| `docs/superpowers/specs/_probes/2026-09-10-wine-runner-and-artifact-size.md` (new) | Spike 1's finding. |

Two library/CLI splits, mirroring `followup-index-lib.mjs` + `check-followup-index.mjs`: pure logic is unit-testable and the CLI owns I/O and exit codes.

---

## Task 1: Spike — is the wine image reachable, and does 93 MB upload?

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
2. Does a 92.8 MB artifact clear this instance's `max_artifacts_size`? The
   setting is admin-only and unreadable from here. GitLab's documented DEFAULT
   is 100 MB per job, which would leave ~7% headroom.

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
| Image unreachable | **DELETE the `desktop-package` and `desktop-package-tag` jobs.** Publish from a local Windows build instead, and say so in `docs/RUNBOOK.md`. A broken job left in place is worse than no job: it reports a red pipeline nobody can act on. The job's own comment in `.gitlab-ci.yml` already prescribes this. |
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
# instance, DELETE this job rather than leaving it broken: local packaging on
# Windows (npm run desktop:package) is the supported path either way.
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
    # ~408 MB of which win-unpacked/ is 314 MB -- an expanded duplicate of the
    # installer's own contents. Narrowed it is ~93 MB.
    #
    # ★ The globs are self-protecting against a stale pre-artifactName build:
    # `*-setup.exe` does not match `aipm-cockpit Setup 0.301.0.exe`. CI starts
    # clean anyway; a local tree may hold both.
    #
    # ★★ 92.8 MB sits against a documented 100 MB max_artifacts_size DEFAULT
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
  # a drifted tag still ran this 20-minute wine build to completion, and a
  # publish job wired by needs: to this job would still have created a
  # Release whose per-tag asset URL then 404s, because that URL resolves only
  # through a pipeline GitLab calls SUCCESSFUL. Task 7's publish-release
  # therefore carries no needs: and is gated by stage order instead. Listing
  # tag-version-check here makes a failing guard SKIP this job outright.
  # ★ Deliberately NOT on the .desktop-package BASE above -- a branch pipeline
  # has no tag-version-check job, and a base needs: naming a job that does not
  # exist on that pipeline fails pipeline CREATION ("needs ... not added").
  needs: [install, tag-version-check]
  # ★★★ NO allow_failure, ON PURPOSE. See the comment above the base job.
  rules:
    - if: $CI_COMMIT_TAG
  artifacts:
    # ★★★ never, because README and docs/desktop-rollout.md tell people to
    # download this. An expiring artifact is fine for a manual check and
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
# that job), so a failing guard here SKIPS the wine build instead of letting
# it run for 20 minutes and only then reddening the pipeline.
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
(dropping the stale hard-coded "~93 MB").

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
 * silently 404s the download on every Release, past ones included. It is
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
 * ★★ Downloading needs PROJECT MEMBERSHIP, not merely a signed-in account:
 * per GitLab's permissions docs ("Download artifacts",
 * https://docs.gitlab.com/user/permissions/), an `internal` project serves
 * artifacts only to a Guest with project-based pipeline visibility enabled,
 * or to Reporter and up — a signed-in non-member gets nothing. Stated by
 * those docs, NOT YET VERIFIED on this instance; Task 11 checks it with a
 * non-member account. docs/desktop-rollout.md carries the same caveat so a
 * colleague hits a clear permission error rather than being surprised by one.
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

Expected: EXIT=0, `Test Files 1 passed (1)`, `Tests 16 passed (16)` — 6 `buildAssetUrl` cases, 2 `installerName` cases, 8 `buildReleasePayload` cases. ★★★ THAT COUNT IS POST-REVIEW, NOT THE INITIAL CUT — a Task 5 review round added a `describe("installerName")` block (fail-closed semver validation) plus five `buildReleasePayload`/`buildAssetUrl` cases (link_type pinned to `"package"`, real description content, a real CHANGELOG.md markdown link, a whitespace-only-tag case, and a Proxy-based test proving the lib never READS an env key outside `CI_PROJECT_URL`/`CI_COMMIT_TAG`, not merely that it never serialises one). The original cut was 8 (four `buildAssetUrl` + four `buildReleasePayload`). ★ Count the `it(` blocks in the file rather than trusting this number; a count in prose is the cheapest thing to check and the easiest to leave rotting.

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
- Create: `scripts/publish-release.mjs`
- Modify: `package.json` (`scripts` + `scriptsDescriptions`)
- Regenerate: `CONTRIBUTING.md`

★ No `release-cli` image and no `curl`. The spec rejects the `release:` keyword because it drags in another image, and this pipeline already carries one unverified image dependency. Node 24 has global `fetch`, and `node:24-bookworm-slim` is already the default image.

- [ ] **Step 1: Write the CLI**

Create `scripts/publish-release.mjs`:

```js
#!/usr/bin/env node
// Create the GitLab Release for the current tag and attach the installer link.
//
// EXIT CODES:
//   0  created (or --dry-run printed the payload)
//   1  the API refused
//   2  could not even try (missing env, or version.ts's shape moved)
//
// ★ --dry-run makes every decision locally and prints the payload WITHOUT a
//   network call or a token, so the shape can be reviewed before a real tag
//   exists. Use it in Task 10; it is the only part of this job runnable locally.
import { readFileSync } from "node:fs";
import { SOURCE_FILE, readSourceFrom } from "./version-sync-lib.mjs";
import { buildReleasePayload } from "./release-publish-lib.mjs";

const dryRun = process.argv.includes("--dry-run");

let version;
let milestone;
try {
  ({ version, milestone } = readSourceFrom(readFileSync(SOURCE_FILE, "utf8")));
} catch (err) {
  console.error(`[release:publish] cannot read ${SOURCE_FILE}: ${err.message}`);
  process.exit(2);
}

let payload;
try {
  payload = buildReleasePayload(process.env, version, milestone);
} catch (err) {
  console.error(`[release:publish] CANNOT PUBLISH: ${err.message}`);
  process.exit(2);
}

if (dryRun) {
  console.log("[release:publish] --dry-run, nothing sent. Payload:");
  console.log(JSON.stringify(payload, null, 2));
  process.exit(0);
}

const api = process.env.CI_API_V4_URL;
const projectId = process.env.CI_PROJECT_ID;
const token = process.env.CI_JOB_TOKEN;
if (!api || !projectId || !token) {
  // ★ Name WHICH one is missing, never the value of any of them.
  console.error(
    `[release:publish] CANNOT PUBLISH: missing ${[
      !api && "CI_API_V4_URL",
      !projectId && "CI_PROJECT_ID",
      !token && "CI_JOB_TOKEN",
    ]
      .filter(Boolean)
      .join(", ")}`,
  );
  process.exit(2);
}

const res = await fetch(`${api}/projects/${projectId}/releases`, {
  method: "POST",
  headers: {
    "JOB-TOKEN": token,
    "Content-Type": "application/json",
  },
  body: JSON.stringify(payload),
});

// ★★ Read the body BEFORE branching on ok: GitLab's error message is the only
// thing that distinguishes "tag already has a release" from a real failure, and
// a bare status code sends the reader nowhere.
const body = await res.text();

if (!res.ok) {
  console.error(`[release:publish] API refused: HTTP ${res.status}`);
  console.error(body.slice(0, 2000));
  process.exit(1);
}

console.log(`[release:publish] created release for ${payload.tag_name}`);
console.log(`[release:publish] asset: ${payload.assets.links[0].url}`);
```

- [ ] **Step 2: Prove the dry run works and prints the right URL**

```bash
CI_PROJECT_URL=https://gitlab.example/g/p CI_COMMIT_TAG=v0.301.0 \
  node scripts/publish-release.mjs --dry-run > "$SP/b-t6-dry.log" 2>&1; echo "DRY_EXIT=$?"
grep -E "jobs/artifacts|tag_name|job=desktop-package-tag" "$SP/b-t6-dry.log"
```

Expected: `DRY_EXIT=0`, and a URL of the form
`https://gitlab.example/g/p/-/jobs/artifacts/v0.301.0/raw/desktop/release/aipm-cockpit-0.301.0-setup.exe?job=desktop-package-tag`.

- [ ] **Step 3: Prove it refuses rather than half-publishing**

```bash
CI_PROJECT_URL=https://gitlab.example/g/p CI_COMMIT_TAG= \
  node scripts/publish-release.mjs --dry-run; echo "NOTAG_EXIT=$?"
CI_PROJECT_URL= CI_COMMIT_TAG=v0.301.0 \
  node scripts/publish-release.mjs; echo "NOURL_EXIT=$?"
```

Expected: both `2`, each naming the missing variable. Neither may print a token or attempt a request.

- [ ] **Step 4: Add the npm script and its description**

Edit `package.json` with the **Edit tool**. In `"scripts"`, after `"tag:check"`:

```json
    "release:publish": "node scripts/publish-release.mjs"
```

In `"scriptsDescriptions"`, after its `"tag:check"` entry:

```json
    "release:publish": "Create the GitLab Release for the current tag and attach an asset link to the installer built by desktop-package-tag. Runs only in a tag pipeline (needs CI_API_V4_URL, CI_PROJECT_ID, CI_PROJECT_URL, CI_COMMIT_TAG, CI_JOB_TOKEN). `--dry-run` builds and prints the payload with no network call and no token, which is the only part runnable locally. Uses node's fetch deliberately: no release-cli image, no curl."
```

- [ ] **Step 5: Regenerate and check**

```bash
npm run docs:scripts > "$SP/b-t6-gen.log" 2>&1; echo "GEN_EXIT=$?"
npm run docs:scripts:check > "$SP/b-t6-chk.log" 2>&1; echo "CHK_EXIT=$?"
grep -E "unchanged|would-update|updated" "$SP/b-t6-gen.log" "$SP/b-t6-chk.log"
```

Expected: both EXIT=0, `unchanged: CONTRIBUTING.md`.

- [ ] **Step 6: Commit**

```bash
git add scripts/publish-release.mjs package.json CONTRIBUTING.md
git commit --only scripts/publish-release.mjs package.json CONTRIBUTING.md -F - <<'EOF'
feat(ci): release:publish, via node fetch rather than release-cli

The spec rejects the release: keyword because it requires the release-cli image
and this pipeline already carries one unverified image dependency. Node 24 has
global fetch and node:24-bookworm-slim is already the default image, so this
adds no image and no curl.

Three exit codes, matching the repo's gate convention: 1 is the API refusing, 2
is being unable to try at all. Missing-variable errors name WHICH variable, never
a value, and the body is read before branching on res.ok -- GitLab's message is
the only thing that separates "this tag already has a release" from a real
failure.

--dry-run builds and prints the payload with no network and no token. It is the
only part of this job that can be exercised before a real tag exists.

Claude-Session: https://[session link removed]
EOF
```

---

## Task 7: Wire the publish job

**Files:**
- Modify: `.gitlab-ci.yml`

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
# not node_modules, not the ~93 MB installer -- since `release:publish` only
# needs the installer's download URL, never its bytes.
# ★★ No allow_failure: a tag whose Release was never created looks published
# and is not -- README and docs/desktop-rollout.md send people to a page with
# no download on it.
# ★ Default image (node:24-bookworm-slim). No release-cli, no curl: the script
# uses node's global fetch.
publish-release:
  stage: release
  dependencies: []
  rules:
    - if: $CI_COMMIT_TAG
  script:
    - npm run release:publish
```

★ It needs no `node_modules` either — `publish-release.mjs` imports only node builtins and two local `.mjs` files.

- [ ] **Step 2: Verify the YAML and the job's keys**

```bash
node -e "const y=require('js-yaml');const c=y.load(require('fs').readFileSync('.gitlab-ci.yml','utf8'));console.log(JSON.stringify(c['publish-release']));console.log('stages:',JSON.stringify(c.stages))" > "$SP/b-t7.log" 2>&1; echo "EXIT=$?"
cat "$SP/b-t7.log"
```

Expected: EXIT=0; the job shows `stage: release`, **no** `needs` key at all, `dependencies: []`, one rule, and **no** `allow_failure`; `stages` includes `release` last.

- [ ] **Step 3: Confirm the job name in the URL matches the job that exists**

The asset URL hardcodes `?job=desktop-package-tag` via `ARTIFACT_JOB`. Prove the two agree:

```bash
grep -n "ARTIFACT_JOB = " scripts/release-publish-lib.mjs
grep -n "^desktop-package-tag:" .gitlab-ci.yml
```

Expected: the exported constant and the YAML job name are the same string. ★★ **Nothing checks this automatically** — a rename on either side produces a 404 at download time, long after a green pipeline.

- [ ] **Step 4: Commit**

```bash
git add .gitlab-ci.yml
git commit --only .gitlab-ci.yml -F - <<'EOF'
ci(release): publish the Release from the tag build's artifact

No needs: at all -- dependencies: [] plus ordinary stage order means this job
only runs once every job in every earlier stage has succeeded, which closes
the dead-link case for every blocking gate on the tag pipeline, not just
desktop-package-tag. A needs:-based publish would fire the moment that one
job succeeded regardless of any other gate, and could create a Release whose
asset link 404s later -- see the ★★★ note on the job. No allow_failure: a tag
whose Release was never created looks published and is not, and README sends
people to it.

Runs on the default node image -- no release-cli, no curl.

Claude-Session: https://[session link removed]
EOF
```

---

## Task 8: Tell people where to download it

**Files:**
- Modify: `docs/desktop-rollout.md`
- Modify: `docs/RUNBOOK.md`

`docs/desktop-rollout.md:5` currently says "Run the installer from the share" and owns the download location (README deliberately names none, so there is exactly one place to update).

- [ ] **Step 1: Replace the rollout doc's install step**

With the **Edit tool**, replace this line in `docs/desktop-rollout.md`:

```markdown
1. Run the installer from the share.
```

with:

```markdown
1. Download the installer from the project's **Releases** page — pick the newest
   release and click the `aipm-cockpit-<version>-setup.exe` asset link (~93 MB).
   You need to be signed in to GitLab: the project is `internal`, so downloads
   are not public.
2. Run it.
```

Then renumber the two steps that follow (the SmartScreen box becomes 3, the
per-user install becomes 4).

- [ ] **Step 2: Add the operator procedure to the RUNBOOK**

`docs/RUNBOOK.md` owns operations — build, deploy, rollback — and cutting a release is one. Add a section (place it after the existing build/deploy material, before the common-issues list):

```markdown
## Publishing a desktop release

1. Bump `src/app/version.ts` (`APP_VERSION`, `APP_BUILD_DATE`, milestone), add
   the `CHANGELOG.md` entry, and propagate with `npm run version:sync` — six
   places carry the version and `version-sync-check` is blocking.
2. Merge to the default branch.
3. Tag it: `git tag v<version> && git push origin v<version>`. The tag **must**
   match `APP_VERSION`; `tag-version-check` fails the pipeline immediately
   otherwise (exit 1 is drift, exit 2 means it could not scan at all).
4. The tag pipeline runs `desktop-package-tag` (blocking, ~20 min, wine image)
   and then `publish-release`, which creates the Release and attaches the
   installer link.
5. Check the Releases page: the asset link should download
   `aipm-cockpit-<version>-setup.exe`.

★ Tag-build artifacts never expire, deliberately — a published download must not
vanish. Branch builds still expire after a week.

★★ If `desktop-package-tag` fails on the wine image, the fallback is a local
Windows build (`npm run desktop:build && npm run desktop:package`) uploaded to
the Release by hand. See
`docs/superpowers/specs/_probes/2026-09-10-wine-runner-and-artifact-size.md` for
why that is the sanctioned fallback rather than a thing to debug in CI.

★★ The installer is unsigned. A downloaded copy prompts SmartScreen; a locally
built one does not, because SmartScreen keys off the Mark-of-the-Web stream a
browser writes on download. So "no prompt appeared" from a local build is not
evidence the prompt is gone for colleagues.
```

- [ ] **Step 3: Check the docs gates**

```bash
npm run docs:claims:check > "$SP/b-t8-claims.log" 2>&1; echo "CLAIMS_EXIT=$?"
grep -iE "none added|out of range" "$SP/b-t8-claims.log"
```

Expected: EXIT=0 and "none added". ★ Neither new block carries a `path:LINE` citation, so the ratchet must not move. If it did, you introduced one — convert it to a symbol name rather than re-baselining.

- [ ] **Step 4: Commit**

```bash
git add docs/desktop-rollout.md docs/RUNBOOK.md
git commit --only docs/desktop-rollout.md docs/RUNBOOK.md -F - <<'EOF'
docs: name the download location, and the release procedure

desktop-rollout.md said "run the installer from the share" and it owns the
download location -- README deliberately names none, so there is exactly one
place to update. It now points at the Releases page, and says the download needs
a signed-in GitLab user, since an internal project serves no public artifacts.

RUNBOOK gains the operator procedure: bump, merge, tag, and what each of the two
tag jobs does. It records the wine fallback (a local build uploaded by hand) as
sanctioned rather than something to debug in CI, and that a local build's
missing SmartScreen prompt is not evidence about a downloaded one.

Claude-Session: https://[session link removed]
EOF
```

---

## Task 9: Update the CI enumeration in AGENTS.md

**Files:**
- Modify: `AGENTS.md`

That file's CI bullet enumerates every pipeline job and ends with "New CI gate → also update this line." Three jobs changed shape and two are new, so this is required, not optional.

★★ `docs:symbols:check` gates this file: a backticked MIXED-CASE name that exists nowhere in `src`/`scripts`/`e2e` fails the build. `tag-version-check`, `desktop-package-tag` and `publish-release` are job names, not code symbols — but `check-tag-version.mjs`, `tag-version-lib.mjs`, `publish-release.mjs` and `release-publish-lib.mjs` are real files, so backticking them is safe. Run the gate; do not reason about it.

- [ ] **Step 1: Extend the pipeline enumeration**

With the **Edit tool**, find the `- **CI is GitLab**` bullet's stage list (`install → quality (...) → build → e2e [...]`) and:

1. Add to the `quality` list: `**tag-version-check** BLOCKING [tag pipelines only — `npm run tag:check` asserts `$CI_COMMIT_TAG` equals `v$APP_VERSION`, via `scripts/check-tag-version.mjs` over the pure `scripts/tag-version-lib.mjs`. ★★ SAME TWO-EXIT-CODE SPLIT as `version:check`: **1 is DRIFT** (tag and `version.ts` disagree, so a published installer would misreport itself), **2 is the gate unable to scan** (empty tag — a rules bug — or the declaration shape moved). `needs: []` so it runs immediately, and `desktop-package-tag` lists it in its OWN `needs:` too, so a failing guard here skips the 20-minute wine build outright rather than letting it run and only then reddening the pipeline]`
2. **ADD** the desktop jobs to the `e2e` stage list, immediately before `· **dast-zap** weekly/manual]`. Measured 2026-09-10: `grep -n "desktop-package" AGENTS.md` returns **nothing** — that file has never mentioned the packaging job at all, so there is no existing text to replace. Add: `· **desktop-package** (manual, non-tag, `allow_failure: true`) · **desktop-package-tag** (tag pipelines, **BLOCKING**, artifact `expire_in: never`)`
3. Add a new stage after `e2e`: `→ release [**publish-release** BLOCKING on tag pipelines — `npm run release:publish` (`scripts/publish-release.mjs` over `scripts/release-publish-lib.mjs`) creates the GitLab Release and attaches a PER-TAG artifact link. ★★★ The producing job's name is embedded in that URL, so renaming `desktop-package-tag` 404s the download on every past Release and NOTHING checks it]`

★ Keep it short. That file regrew 111% in fifteen days once; a bullet past ~60 lines of subsystem detail belongs in `docs/AGENTS/`.

- [ ] **Step 2: Run the gate that reads this file**

```bash
npm run docs:symbols:check > "$SP/b-t9.log" 2>&1; echo "SYMBOLS_EXIT=$?"
tail -5 "$SP/b-t9.log"
```

Expected: EXIT=0. A failure names the backticked symbol it could not resolve — fix the name, never the allowlist.

- [ ] **Step 3: Commit**

```bash
git add AGENTS.md
git commit --only AGENTS.md -F - <<'EOF'
docs(agents): enumerate the tag guard, the split packaging jobs and the release job

That bullet ends with "New CI gate -> also update this line", and five jobs
changed or arrived. Records the two-exit-code split on tag-version-check, that
desktop-package-tag is blocking where desktop-package is not, and that the
producing job's name is embedded in every published download URL with nothing
checking it.

Claude-Session: https://[session link removed]
EOF
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

- [ ] **Step 2: The two new script suites, named explicitly**

```bash
npx vitest run scripts/tag-version-lib.test.mjs scripts/release-publish-lib.test.mjs > "$SP/b-g-unit.log" 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " "$SP/b-g-unit.log"
```

Expected: EXIT=0, `Test Files 2 passed (2)`, `Tests 32 passed (32)` (16 + 16; derive it with `grep -c "  it(" scripts/tag-version-lib.test.mjs scripts/release-publish-lib.test.mjs` rather than trusting this line — the release-publish-lib half grew from 8 to 16 in the Task 5 review round). ★★★ **Assert `Test Files 2` against your own list length.** A mistyped path mixed with a real one is dropped **silently at exit 0** — the tally alone cannot tell you a file never ran.

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
CI_PROJECT_URL=https://gitlab.example/g/p CI_COMMIT_TAG=v$VER node scripts/publish-release.mjs --dry-run > "$SP/b-g-dry.log" 2>&1; echo "DRY_EXIT=$?"
grep -E "job=desktop-package-tag" "$SP/b-g-dry.log"
```

Expected: `1`, `2`, `0`, `0`, and the asset URL naming the tag job.

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

---

## Definition of done

- [ ] Spike 1's finding is committed with its **Measured** section filled in, and its decision table applied.
- [ ] `npm run tag:check` exits **1** on a mismatched tag, **2** on an empty one, **0** on a matching one — and the 0 case NAMES both values.
- [ ] The mismatched tag has been driven red **in CI**, not only locally.
- [ ] The stored tag artifact is the installer plus its `.blockmap`, ~93 MB, and contains no `win-unpacked/`.
- [ ] `desktop-package-tag` carries **no** `allow_failure`, and `desktop-package` still carries it under its manual rule.
- [ ] Tag artifacts are `expire_in: never`; branch artifacts are still `1 week`.
- [ ] `ARTIFACT_JOB` in `scripts/release-publish-lib.mjs` is the same string as the `desktop-package-tag` job name.
- [ ] `docs/desktop-rollout.md` names the Releases page, and says the download needs a signed-in GitLab user.
- [ ] `AGENTS.md`'s CI enumeration lists the five changed or new jobs.
- [ ] Task 10's gate chain is green and `git status --porcelain` is empty.

**Not in this plan, by decision:**

- **A publish abstraction for GitHub** (spec §6.6). GitHub cannot receive releases until the repo is public, off a personal account, and mirroring tags — none of it scheduled. Adding it later is another small job consuming the same artifact, not an indirection layer today.
- **The `release:` keyword** (§6.4) — it needs the `release-cli` image, and this pipeline already carries one unverified image dependency.
- **An auto-update feed** (§7). An `internal` project serves no unauthenticated downloads, so an `electron-updater` feed pointed here needs a token on every laptop. Spike 1 of the Electron plan owns that question, and this plan does not answer it.
- **Extracting release notes from `CHANGELOG.md`.** A heading rename would silently empty them; the Release links the file instead.
- **Any version bump, CHANGELOG entry, merge, or MR.**
