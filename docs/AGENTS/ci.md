<!-- Split out of AGENTS.md, which is the always-loaded file (CLAUDE.md is `@AGENTS.md`).
     THIS file is NOT auto-loaded — open it when you work on this subsystem.
     Same conventions: ★ = a non-obvious rule, ★★ = has already caused a bug,
     ★★★ = has caused the same bug more than once.
     `npm run docs:symbols:check` gates this file exactly as it gates AGENTS.md:
     it proves a backticked NAME is real, never that a CLAIM about it is true.
     Every claim here was true when written and some have outlived their code —
     grep before relying on one, and correct what you disprove in the same commit. -->

# CI — the GitLab pipeline, job by job

[← AGENTS.md](../../AGENTS.md) · [doc set](../../AGENTS.md#the-doc-set--what-lives-where)

Owns the per-job detail of the GitLab pipeline ( (GitLab)): every quality gate and its exit
codes, the e2e and prod-smoke jobs, desktop packaging, the release stage, and where the
`quality-gate-bypass` escape hatch does and does not exist.

★ Moved VERBATIM out of `AGENTS.md`'s "Hard constraints" section on 2026-09-13 — only link targets changed, plus one line citation converted to a symbol and a grep. Positional words inside the moved text ("this file", "above", "below", "in Commands") still
describe where it sat in `AGENTS.md`, not this file; `AGENTS.md` keeps a short pointer bullet.

## The "CI is GitLab" hard constraint

- **CI is GitLab** (not GitHub),  (GitLab). Pipeline: install → quality (lint · typecheck · **semgrep** SAST
  BLOCKING [two-scan: a full-severity `--gitlab-sast` report for the widget + a separate `--severity ERROR
  --error` gate] · **dependency-audit** blocking · **file-size-ratchet** BLOCKING · **duplication-gate**
  BLOCKING [jscpd `--threshold` per package.json `dup:check` — ★★ it compares the TOTAL
  duplicated-LINE percentage across all formats, NOT per-format and NOT tokens; the `dup:check` line
  in Commands carries the bisect] · **agents-symbol-check** BLOCKING
  [`npm run docs:symbols:check` — fails when THIS FILE names a code symbol that does not exist] ·
  **version-sync-check** BLOCKING [`npm run version:check` — `src/app/version.ts` is the source of
  truth for the version and codename; every file the Releasing bullet below points at restates one or
  both, and nothing compared them before this job. Propagate with `npm run version:sync` rather than
  hand-editing them. ★★ TWO FAILURE
  MODES, TWO EXIT CODES: **1 is DRIFT** (a satellite disagrees with `version.ts` — fix with
  `version:sync`), **2 is the gate unable to do its job** (a missing file, a moved regex shape, an
  empty codemap glob — a gate that scans nothing passes everything). Both were 1 until 0.260.x, so a
  red pipeline could not be read without opening the log, and the two demand opposite responses.
  ★ Its ONE structural blind spot is a format the reader and writer agree on and are both wrong
  about: the README badge is a URL inside a markdown link, so a codename with a SPACE has to be
  encoded — un-encoded, `--update` wrote a badge whose link truncates mid-codename and the gate then
  reported IN SYNC over it. Fixed by `encode`/`decode` hooks on that one pattern; a new satellite
  whose file format cannot hold a raw value needs the same, and no amount of reader/writer symmetry
  substitutes] ·
  **doc-claims-check** BLOCKING [`npm run docs:claims:check` — a RATCHET over `path:LINE` citations in
  every tracked PROSE doc — all of `docs/**` bar `docs/superpowers/`, plus the seven root/lib docs in
  `ROOT_DOCS` (the byte-pinned `golden-workspace.md` fixture is deliberately excluded). ★★ It said
  "every tracked doc" while `CHANGELOG.md`, `CLAUDE.md` and the two `lib/*.md` guides were NOT
  scanned; a cold review caught it and the scope was widened to match the claim rather than the claim
  narrowed. Proves only that a cited line COULD exist, never that it
  is right — the Commands entry carries the measurement] ·
  **followups-status-check** BLOCKING [`npm run followups:status:check` — every OPEN entry in
  `docs/open-followups.md` must carry a `**Status:**` line with an ISO date that either cites a
  command or says `never machine-verified`. ★★ TWO EXIT CODES, opposite responses, the same split
  `version-sync-check` documents: **1 is DRIFT** (write the Status line), **2 is the gate unable to
  scan at all** — an unreadable register, or zero entries parsed. The vacuity guard is the
  load-bearing half, because a scan that reads nothing passes everything. ★★★ DO NOT satisfy a red
  run by inventing a verification — `never machine-verified` is a CONFORMING answer and is the
  honest one for an entry nobody has probed. ★ The check is command-SHAPED, not merely backticked:
  a backticked filename is not a verification, and accepting one was measured to admit 10 entries
  that named none] ·
  **followups-index-check** BLOCKING [`npm run followups:index:check` — every `## <n>.` heading in
  `docs/open-followups.md` must carry a row in the index table between `<!-- INDEX:BEGIN -->` and
  `<!-- INDEX:END -->`, and every row must point at a heading that exists. Nothing compared the two
  sets before it, and they disagreed on the day it landed. ★★ SAME TWO-EXIT-CODE SPLIT as its two
  siblings above: **1 is DRIFT** (write the missing rows, delete the orphaned ones, or renumber a
  duplicate), **2 is the gate unable to scan** — markers missing, markers DUPLICATED, or either set
  empty. ★★★ It also reports a §number used TWICE on either axis, which the set difference it is
  built on is structurally BLIND to: paste one index row and both differences come back empty while
  the two counts disagree. ★ DO NOT satisfy a red run by renumbering an entry — a follow-up number
  is a permanent handle other docs cite] ·
  **followups-workitems-check** BLOCKING [`npm run followups:workitems:check` — every OPEN entry in
  `docs/open-followups.md` carries exactly one line STARTING `**Work item:**` whose remainder is `#NN`
  or exactly `none — decision record`, no closed entry carries one, and no issue is claimed by two open
  entries (`scripts/check-followup-workitems.mjs` over `scripts/followup-workitem-lib.mjs`). ★★ SAME
  TWO-EXIT-CODE SPLIT: **1 is DRIFT**, **2 is the gate unable to scan** (unreadable register, or under
  the 50-open-entry floor). ★★ It reads the REGISTER ONLY, so an issue closed in GitLab while its entry
  stays open passes it. ★ DO NOT satisfy a red run with `none — decision record` on an entry that has
  real work — create the issue] ·
  **followups-gitlab-sync** WARN-ONLY [`npm run followups:gitlab:check` — compares every open entry's
  Work item line with the OPEN GitLab issues both ways (`scripts/check-followup-gitlab.mjs` over
  `compareWithGitLab` in `scripts/followup-workitem-lib.mjs`): an issue closed in GitLab, one titled for
  another entry, one with no open entry, a `§NNN:` issue without `source::register` or the reverse.
  ★★ Skips with exit 0 until a masked, protected `REGISTER_SYNC_TOKEN` (a project access token
  with the read-API scope) exists. **1 is DRIFT**, **2 is could-not-compare** (network, token, redirect, or under a
  50-open-issue floor — a wrong-project token answers `[]`). ★★ Default-branch pushes and schedules
  ONLY: on an MR, whoever merges second rebases, so a branch can hold issues whose entries are not on
  main yet. `allow_failure: true` sits at job level AND on each rule — the YAML comment says why] ·
  **tag-version-check** BLOCKING [tag pipelines only, `needs: []` — `npm run tag:check` asserts the tag
  is `v` + `APP_VERSION` (`scripts/check-tag-version.mjs` over `scripts/tag-version-lib.mjs`). ★★ SAME
  TWO-EXIT-CODE SPLIT: **1 is DRIFT** (the installer would misreport its own version), **2 is the gate
  unable to scan** (an empty tag — a rules bug — or `version.ts`'s shape moved). `desktop-package-tag`
  lists it in its own `needs:`, so the wine build waits for it rather than racing it (that a FAILED
  guard then SKIPS the build is expected `needs:` behaviour, but no GitLab doc checked here states it
  and no tag pipeline has shown it; `publish-release` is held back either way, by stage order)] · **unit** [coverage floors: global lines 92/funcs 91/branch
  80/stmts 89 + per-engine globs in `vitest.config.ts`] · **unit-tests-shuffled** BLOCKING [runs the full
  unit suite at `--sequence.shuffle --sequence.seed=1`; `needs: [install, {job: unit-tests, artifacts:
  false}]` so it cannot run concurrently with **unit-tests** — two full vitest runs on one runner is the
  machine-saturation condition behind the load-sensitive flakes; guards against intra-file test-order
  dependence, open-followups §75]) → build → e2e [**e2e** (MR and default-branch pipelines only — its
  two `rules:` match nothing on a tag) · **prod-smoke** BLOCKING (the same two rules, so not on a tag
  either) [`npm run e2e:smoke:prod` — `next start` + the smoke driver, consuming build's `.next/` artifact.
  ★★ THE ONLY GATE THAT SEES THE PROD CSP, and the reason is per-suite. Dev grants `'unsafe-inline'` on
  `style-src-elem` while prod is nonce-only (`src/proxy.ts`), so anything meeting the DEV policy is blind
  to this class. The unit suite never starts a server at all. **e2e** does, but `playwright.config.ts`
  `webServer.command` is `npm run dev` — so it meets the permissive policy too. And `e2e:smoke` starts no
  server, so it only ever gets pointed at one somebody already had running, which in practice is dev.
  ★ Note **e2e** does NOT invoke `e2e:smoke` — they are separate entry points that happen to share the
  same blind spot, so fixing one would not have covered the other. That is how §54 stayed invisible for
  months. ★ **dast-zap** DOES serve a prod build (`Dockerfile.dast` ends `CMD ["npm","run","start"]`), so
  it is the one other suite that meets this policy — but it does not gate MR or default-branch pipelines,
  where its rule is `when: manual` WITH `allow_failure: true` — tag pipelines match that rule too, and
  without the key a blocking manual job holds every later stage, so `publish-release` would never run.
  ★★ It is NOT unconditionally non-blocking,
  and an earlier revision of this bullet said it "cannot fail a pipeline", which is false in the very mode
  the line names: `allow_failure: true` is indented under the `- when: manual` rule ONLY, there is no
  job-level one, and a `rules:` entry that omits it defaults to FALSE — so on a `schedule`
  pipeline the first rule matches and dast-zap runs BLOCKING. Its ZAP findings still cannot fail it
  (`zap-baseline.py … -I … || true`), but the unguarded `docker build` / `docker network create dastnet`
  / `docker run` steps can, and `network create` fails outright on a re-run where the network survives.
  Reproduce with `sed -n '/^dast-zap:/,/^  image:/p' .gitlab-ci.yml`] · **desktop-package** (manual,
  non-tag, `allow_failure: true`, artifact 1 week) · **desktop-package-tag** (tag pipelines, **BLOCKING**,
  artifact `expire_in: never`) · **dast-zap** weekly/manual] → release [**publish-release** BLOCKING, tag
  pipelines only — `npm run release:publish` (`scripts/publish-release.mjs` over
  `scripts/release-publish-lib.mjs`) creates the GitLab Release with a PER-TAG artifact link. ★★ NO
  `needs:`, on purpose — stage order is what holds it behind every earlier gate; the YAML comment says
  why. ★★★ That URL embeds the producing job's name (`ARTIFACT_JOB`) and the installer's path, so
  renaming `desktop-package-tag` or changing electron-builder's `artifactName` alone would 404 the next
  Release's download while the build stays green. `release-publish-lib.test.mjs` reads `.gitlab-ci.yml`
  and `desktop/electron-builder.yml` as text and fails on either drift, and on the job's artifact
  `paths:` no longer covering the installer].
  All quality gates are ratchets. ★★ The
  `quality-gate-bypass` escape hatch is NOT uniform — reproduce with
  `grep -n quality-gate-bypass .gitlab-ci.yml`, which returns five lines in three jobs: **semgrep** and
  **file-size-ratchet** carry a full commented `rules:` block; **duplication-gate** only NAMES the label
  in prose, with no rules block; and EVERY other quality-stage job mentions it nowhere (`lint`,
  `typecheck`, `dependency-audit`, `dependency-audit-full`, `agents-symbol-check`, `version-sync-check`,
  `doc-claims-check`, `followups-status-check`, `followups-index-check`, `followups-workitems-check`, `followups-gitlab-sync`, `tag-version-check`, `unit-tests`,
  `unit-tests-shuffled`, `unit-tests-shuffled-random` — enumerate with
  `grep -nE "^[a-z][a-zA-Z0-9_-]*:" .gitlab-ci.yml`). ★★★ FOUR successive revisions of this
  sentence were wrong — each named the wrong jobs or under-enumerated, sending an operator hunting for a
  bypass block on whichever gate is actually red. One of them ATTACHED the reproduce command above
  without running it, and the command refutes the sentence it was attached to. **Attach the command and
  run it.** ★★★ THAT WORDING IS NOT ENOUGH, measured 2026-08-08: a review round corrected at least
  EIGHT false claims in these docs and introduced SIX MORE errors across two correction passes — every
  one of them prose, and in every case the author HAD run a command, just not against the sentence they
  ended up writing. So: **a correction is a NEW claim and inherits none of the verification of the
  thing it corrects — run a command against the REPLACEMENT text, not only against the error you
  found.** Two replacement recipes in that round were themselves wrong (one returned five files where
  the sentence said two; its successor returned one, because a consumer imported `../x` while the
  pattern matched only `./x`). ★ The two counts are NOT a matching pair — they are tallied by different
  criteria (corrections made vs. items a reviewer flagged), and one of the six was a broken sentence
  rather than an untrue statement. Read them as magnitudes, not as a symmetry.
  ★★★ COROLLARY — an edit that INSERTS lines invalidates every `file:line` citation below it, including
  ones written moments earlier in the same commit, so a correction round must re-check the citations it
  did not touch: `ALLOW_DATA_ATTR: false` moved 114→130 when a comment block landed, then 130→131 when
  a one-line edit followed. Cite the SYMBOL and a grep instead. ★★ Three stars because
  [`docs/open-followups.md`](../open-followups.md) already records this class repeatedly — one entry
  there calls itself "the third recorded instance", so those two hops are the fourth and fifth. The
  detail lives there, not here. ★ "Ratchets" is loose too: only **file-size-ratchet** (`docs/baselines/file-sizes.json`,
  read by name as its `BASELINE` constant — `grep -n "const BASELINE" scripts/check-file-sizes.mjs`) and **unit-tests**' coverage floors (`vitest.config.ts`)
  hold a baseline; every other quality gate — **duplication-gate** INCLUDED — is plain pass/fail
  against a hardcoded number. ★★ duplication-gate was listed here as baselined and is not: nothing
  reads `docs/baselines/jscpd-2026-07.json` (`grep -rn "baselines/jscpd" package.json .gitlab-ci.yml
  scripts/` returns no loader), and its threshold is the literal `1.75` in `package.json dup:check`.
  A weekly `schedule` pipeline also runs
  `dependency-audit-full` + **unit-tests-shuffled-random** (same suite, seed `$CI_PIPELINE_ID` echoed with
  its reproduce command, warn-only `allow_failure: true`) + **followups-gitlab-sync** (warn-only, also on
  default-branch pushes) + a **dast-zap** ZAP baseline (dind-based, manual
  otherwise). (Phases 1-4 of the
  tech-debt roadmap are complete — gates flipped to blocking in Phase 4, MR !174.)
  New CI gate → also update this line.
