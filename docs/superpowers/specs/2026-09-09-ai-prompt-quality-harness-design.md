# AI prompt-quality harness (slice H) — design

Date: 2026-09-09
Status: **Specced.** Baseline: 0.298.0 "Malzberg", `main` @ `e7f9b3aa`

> Sequenced by `2026-09-08-ai-cost-roadmap-design.md`, which owns the order and the
> dependencies between slices. This file owns H alone and does not restate the roadmap.

## Problem

Three of the four remaining levers on the AI cost roadmap are blocked on the same thing, and
it does not exist:

| Slice | The change | Its regression class |
|---|---|---|
| **G2** | move the view-scoped guide block onto the turn tail | the model stops reading a relocated block |
| leadership-guide trim | drop or shorten a ~9,164-token unscoped guide sent every turn | the model behaves worse having lost guidance |
| tool-array gating | narrow the 17,796-token tool array via the tool-flag mechanism | the model loses a tool it would have reached for |

Nothing in this repo can detect any of the three. What exists is a single eval **run once by
hand on 2026-09-08**, out of repo, against a live key: five probes, two arms, three reps, thirty
requests, no regression found. Its own record in `docs/AGENTS/ai-assistant.md` states the
limit plainly — the old arm scored 3/3 on every probe, so the eval had **no headroom and can
only ever have detected a large regression**, a block the model stopped reading outright.

That is a data point, not a gate. H makes it repeatable, gives it room to fail, and extends it
to the two content-removal slices the planted-token design is structurally blind to.

**Why reachability alone is not enough.** A planted token proves the block carrying it was
read. The leadership-guide trim and tool-array gating do not move a block — they delete
content. Their regression never surfaces as a missing token, because the token sits in a
different block entirely. Two of the three gated slices are invisible to the binary, which is
why H carries graded axes beside it.

## What H is not

- **Not a per-MR gate, and pretending otherwise would be the joke this roadmap writes itself.**
  Every run spends real tokens against a real key.
- **Not a CI job.** No Anthropic key is available to the pipeline, and adding one is its own
  decision with its own blast radius. H is a local command plus a recorded artifact.
- **Not a broad answer-quality harness.** The roadmap outlined assertions on tool arguments,
  entity ids and view adherence. That is a larger build whose assertions themselves need
  validating. H is scoped to the regression classes the three gated slices actually produce.
- **Not a cost measurement.** Token and cache accounting is slice B's, already shipped. H never
  reads a cache flag; the two runs answer different questions and conflating them is how the
  manual eval nearly reported a cost result as a quality result.

## Architecture

The pure-lib / IO-CLI split the doc gates already use, for the reason those gates record: every
defect they shipped was a logic defect, and every one was found by running the lib against real
input rather than by reading it.

| File | Owns | Spends? |
|---|---|---|
| `scripts/ai-eval-lib.mjs` | Pure. Probe definitions, the seeded anchor generator, scoring, the graded axes, the verdict rule, artifact shape, hashing, the refusal predicates. No network, no key, no filesystem. | never |
| `scripts/ai-eval-lib.test.mjs` | Vitest over the lib. Runs in the normal unit suite. | never |
| `scripts/ai-eval.ts` | The CLI. Key read, refusal checks, spend opt-in, dry-run default, arm orchestration, artifact write. I/O only. | only with opt-in |
| `docs/baselines/ai-eval-runs.json` | Per-run record: date, model id, git SHA, arm hashes, per-probe per-arm scores, graded vector, verdict, `complete` flag. | — |
| `docs/baselines/ai-eval-rolling-prompt.txt` | Last complete run's assembled current-arm prompt bytes. Replayed as the drift arm next run. Written by the harness, never by hand. | — |

`ai-eval.ts` is TypeScript run under `npx vite-node`, matching the existing sample-workspace
generator script. It must import the **real** `buildStableSystemBlocks`, `buildTurnContext`,
`buildWireMessages`, `toolsFor` and `builtinSeeds`. A harness that reconstructs the prompt
itself measures its own copy — the live measurement run behind slice G avoided exactly that,
and so must this.

The lib is `.mjs` rather than a module under `src/app` for two reasons: `vitest.config.ts`
globs `scripts/**/*.{test,spec}.mjs` so the lib is testable where it sits, and a new `.ts` file
under `src` is coverage-gated and would ship in the app bundle, which this is not.

### Landmines this arrangement walks into

- **`jsonToWorkspace` returns an EMPTY workspace under bare node** — it needs a DOM. The
  harness seeds from `sample-workspace-small.json`, so it installs jsdom before the first
  decode. Without it the run evaluates against an empty workspace and reports confident
  nonsense.
- **Never name the runner with a `test` or `spec` segment and an `.mjs` extension.** Vitest's
  `include` would execute it — in CI without a key, and on a dev machine with one.
- **A new `npm run` entry is a three-file change.** `package.json` `scriptsDescriptions` plus
  the generated `CONTRIBUTING.md` and `README.md` rows, enforced by the prebuild
  `docs:scripts:check`. Run `npm run docs:scripts`.
- **`docs/baselines/*.json` is outside the doc-claims gate**, which scans `.md` only. The two
  artifacts cannot trip it.

## Arms

Five arms per run, **interleaved** by (probe, rep) so drift within a run lands on all of them
equally rather than accumulating in whichever ran last.

| Arm | What it is | Purpose | Reps |
|---|---|---|---|
| **A — current** | the layout as shipped | the null | full |
| **B — candidate** | the slice's proposed layout, behind a toggle | the thing under test | full |
| **R — rolling replay** | the previous run's stored prompt bytes, verbatim | step drift | full |
| **N — seeded anchor** | the deterministic generator, hash-asserted | slow cumulative drift | full |
| **X — negative control** | arm A with the probed block deleted | validity | 1 |

### Why two drift arms rather than one

A drift reference must be **invariant**, so a score move is attributable to the model, and
**representative**, so drift on it predicts drift on production. Those pull apart: regenerating
a reference to keep it relevant destroys the attribution, and freezing it destroys the
relevance. Neither one arm alone escapes that, and both of these do — without anybody
maintaining anything.

- **R is self-maintaining.** Each complete run writes the prompt bytes it just used for arm A.
  The next run replays those bytes. Same bytes, two dates, two scores — the difference is drift
  and can be nothing else. It is always exactly one slice stale, which is the useful amount.
  Its blind spot, stated: it compares consecutive runs, so drift that creeps slightly per slice
  sits inside noise at every step and the cumulative move is never seen.
- **N cannot rot, because there is nothing to rot.** Not a stored fixture but a deterministic
  generator — filler of a fixed length from a fixed seed, planted token at a fixed depth,
  distractor at another — regenerated identically forever and hash-asserted against the
  recorded hash on every run. If the generator is ever touched the run refuses instead of
  silently measuring a different thing. Its length is tuned to production's ~31k prefix, so it
  is representative in the dimension that governs whether a model change hurts: prefix length
  and needle depth, not content.

R catches what N is too synthetic to see. N catches what R is too short-baselined to see.

### Why X is not optional

X must score **zero**. If a planted token still surfaces with its own block deleted, that token
is leaking from elsewhere in the prompt and the probe was never measuring reachability.

Without X, "hit on every arm" and "the detector is incapable of registering a miss" produce
identical output. A negative result with no falsifier attached is worth nothing, and this repo
has paid for that shape more than once.

## Probes

Each probe plants a token no other part of the prompt can emit, in one relocatable block, and
asks a question whose only correct answer is that token. The five blocks are the five that slice
B relocated: today's date, view scope, insights, the activity recap, the chat pointer.

**Headroom is bought three ways**, chosen per probe:

1. **A distractor token** in a *different* block, with the question naming which one it wants.
   A response is then right, wrong-block, or absent — three outcomes where the manual eval had
   two, and the middle one is the informative addition.
2. **Depth** — the token planted deep inside a long block rather than at its head.
3. **Composition** — a question that cannot be answered without combining two blocks.

**Calibration is a measured step and it spends.** Candidate probes run against arm A alone at
raised reps; a probe is kept only if A scores inside a band. An ace has no headroom and an
impossible has no signal — the manual eval's whole limitation was that all five of its probes
were aces. The opening band is 0.4–0.9; its final value and the reps behind it are **recorded in
the artifact at calibration time**, because a band adjusted later to admit a probe is a band
that has stopped constraining anything.

**The hazard in that, written down rather than discovered:** the instrument is being tuned
against the very layout it will later judge, which risks fitting the probe set to the null.
Mitigated by keeping a band rather than a point, and by calibrating at enough reps that the
band is not fitted to noise. It is a real weakness and it should be re-read before the first
verdict is trusted.

## Pre-flight assertions

All free. The run **refuses to spend** until every one passes:

- each planted token appears exactly once in the assembled prompt
- it sits in the structural position that arm expects — arm A in `system`, arm B on the turn tail
- each distractor is present, in its own block
- the anchor's regenerated hash matches the recorded hash
- the rolling prompt file's hash matches what the last run recorded writing

The manual harness had the first two of these and they are the reason its result means
anything: a probe missing from the prompt would otherwise report a confident "no regression"
while measuring nothing at all.

## Scoring and verdict

**Reachability hard-fails.** A planted token going unread is mechanical and unambiguous: the
block is not being read.

**The four graded axes are pre-registered here — direction and meaning fixed before any run —
and carry no thresholds.**

| Axis | Measured | Worse direction | Why the direction is defensible |
|---|---|---|---|
| tool reaches | the model called a tool for an answer already in the prompt | more | mechanical; currently at zero, so it has room only in the bad direction |
| wrong-block hits | the distractor returned instead of the target | more | unambiguous — it read something, just not the thing asked for |
| instruction adherence | bare token vs elaborated, on probes whose prompt says "exactly as written" | elaborated | the one real difference the manual eval surfaced (3–0, Fisher p = 0.10), still unadjudicated |
| answer length | output tokens | longer | billed at 5x, so a move is a cost fact even where it is not a quality fact |

They print as a labelled vector against those directions and **gate nothing** until enough runs
exist to calibrate them. Pre-registration is the whole point: a threshold invented after seeing
the numbers is a verdict authored to fit them, and a guessed threshold that fires is worse than
no threshold, because it blocks work on a number nobody can defend.

A future slice must not quietly promote one of these to a gate. Promoting one is its own
decision, with its own calibration evidence, recorded here.

## Exit codes

Mirroring the convention `version-sync-check` and both followups gates already use, because the
two failure classes demand opposite responses and a single code cannot be read without opening
the log:

- **0** — passed, or a dry run completed
- **1** — a real regression: reachability fell on arm B relative to arm A
- **2** — the harness could not do its job: no key, refusal triggered, a pre-flight assertion
  failed, the anchor hash mismatched, **or arm A itself fell** — a null that regressed is not a
  verdict about the candidate, it is a broken measurement, and reporting it as 1 would blame the
  slice for something that moved underneath both arms

**A run that measures nothing must never exit 0.** That is the load-bearing half: a scan that
reads nothing passes everything.

## Invocation and the spend guard

Every other `npm run` in this repo is free and safe, so a script sitting beside them reads as
free and safe. This one is not, and the guard is shaped accordingly.

- **Dry run is the default.** No opt-in means: assemble every arm, run every pre-flight
  assertion, print the planned request count and the modelled token cost, spend nothing,
  exit 0. Most breakage — a moved symbol, a leaking token, a touched anchor — surfaces there
  with no key at all.
- **Spending needs an explicit environment opt-in**, and the run prints its estimated request
  count before proceeding.
- **It hard-refuses when `CI` is set**, regardless of the opt-in.
- **The key is read only from `ANTHROPIC_API_KEY` or a key file.** Never a CLI argument (it
  would land in shell history and process listings), never printed, not even truncated.

Modelled, not measured: 4 arms x 5 probes x 3 reps plus the 1-rep negative control is about
**65 requests**, order of $2 per run against a mostly-cached ~31k prefix. Calibration runs cost
extra and are separate.

## Failure handling

- **A partial run never rewrites the rolling prompt.** A run that dies mid-way — rate limit,
  network, an arm erroring — records its artifact marked `complete: false` and leaves
  `ai-eval-rolling-prompt.txt` untouched. Overwriting it from a run nobody scored would poison
  the drift reference invisibly: the next run compares happily against garbage and reports no
  drift.
- **The first run has no rolling reference.** Arm R is skipped and recorded as absent; the run
  does not fail. Otherwise the harness can never bootstrap.
- **A missing key, a set `CI`, a failed assertion or a hash mismatch all exit 2** and spend
  nothing.

## Testing

All free. **No test may ever spend** — the network call is injected, so the lib's tests drive a
fake.

- the verdict rule, over fixtures covering pass, reachability fall, and each refusal
- anchor determinism: same seed produces byte-identical output and a stable hash
- **each pre-flight assertion with a fixture that trips it.** An assertion nobody has watched
  fail is an assertion that may not be wired — the vacuity shape this repo keeps paying for
- a mutation on the anchor's hash guard: change the generator, assert the run refuses. A guard
  that never fires is indistinguishable from a guard that is absent
- the partial-run path: assert the rolling prompt file is not written when `complete` is false

## What this hands the three gated slices

A repeatable command, an exit code that distinguishes a regression from a broken harness, a
recorded artifact per run, and a stated ceiling.

**And one cost it imposes on all three:** each of G2, the leadership-guide trim and tool-array
gating must ship its change **behind a toggle the harness can flip**, so arms A and B exist in
one process. Interleaved arms are what control for model drift; a stored baseline compared
across runs cannot, and confounds the prompt change with anything that moved in between —
including a model update, which is exactly when the verdict most needs to be trusted. That
toggle requirement belongs in each of those three plans.

## Out of scope

- **Assertions on tool arguments, entity ids and view adherence.** The roadmap's broader H
  outline. Deferred: those assertions need validating themselves, and the three gated slices do
  not need them.
- **Any CI integration.** Blocked on a pipeline key, which is a separate decision.
- **Promoting a graded axis to a gate.** Needs calibration evidence that does not exist yet.
- **Prose diffing of answers.** The model is not deterministic; prose diffing produces noise.
  Human judgement over a recorded diff, when wanted, reads the artifact.

## What would make this design wrong

- **If calibration cannot find probes inside the band.** If every candidate probe is an ace
  against arm A, the headroom premise fails and H degrades to the manual eval's ceiling. The
  honest response is to say so in the artifact and let the three slices ship against a
  large-regression-only gate, not to widen the band until something fits.
- **If the negative control does not score zero.** Then planted tokens leak and the probe design
  needs rethinking before any verdict is meaningful.
- **If model updates land faster than runs.** The drift arms assume runs are frequent enough
  that consecutive ones share a model. If not, R degrades to noise and only N remains
  interpretable.
- **If the graded axes never move across many runs.** Then they cost requests and prove nothing,
  and should be cut rather than kept for completeness.
