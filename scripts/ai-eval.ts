// scripts/ai-eval.ts — the AI prompt-quality harness CLI (slice H).
//
// I/O ONLY. Every decision lives in scripts/ai-eval-lib.mjs so it can be tested
// without a key. Run under vite-node:  npx vite-node scripts/ai-eval.ts
//
// ★★ Dry run is the default and spends nothing. Live runs need AI_EVAL_SPEND
//    set and refuse outright under CI.
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import {
  buildStableSystemBlocks,
  buildTurnContext,
  toolsFor,
  ANTHROPIC_VERSION,
  normalizeApiUsage,
} from "../src/app/chat-api";
import { buildWireMessages } from "../src/app/chat-cache-layout";
import { builtinSeeds } from "../src/app/use-operating-guides";
import type { ApiMessage, ApiUsage, SystemBlock } from "../src/app/chat-api";
// ★★ The weights are IMPORTED, never restated. A second copy of the four
//    ratios is a second thing to drift, and a drifted weight makes two runs'
//    cost figures silently incomparable. `usageCostEquivalent` applies them;
//    `USAGE_COST_WEIGHTS` is recorded in the artifact so a later change to them
//    is visible in the series rather than retroactively rewriting it.
import { USAGE_COST_WEIGHTS, usageCostEquivalent } from "../src/app/ai-usage";
import type { Usage } from "../src/app/ai-usage";
import {
  EXIT, PROBES, plantedToken, sha256, ANCHOR_SPEC, buildAnchorPrompt,
  preflight, spendDecision, scoreResponse, hitRate, gradeArm,
  shouldWriteRolling, parseFilter, filterSpec, buildRunRecord, FILTER_ENV,
} from "./ai-eval-lib.mjs";

const ROLLING_PATH = "docs/baselines/ai-eval-rolling-prompt.txt";
const RUNS_PATH = "docs/baselines/ai-eval-runs.json";
const REPS = 5;

/** The model every arm is sent to.
 *
 *  ★★ It mirrors the app's own default (`use-ai-orchestration.ts`), because a
 *  harness that measures a model the app does not use measures nothing anyone
 *  ships against. It is a constant and not an env override on purpose: the
 *  recorded runs are a SERIES, and a run against a different model is a
 *  different series — changing this line means saying so in the artifact and
 *  not comparing across the boundary, exactly like `ANCHOR_SPEC`. */
const MODEL = "claude-sonnet-5";

/** How many output tokens one probe reply may cost. Every probe asks for a bare
 *  reference code and nothing else, so this is generous; it also bounds the
 *  worst case when a model ignores the instruction and starts explaining. */
const MAX_OUTPUT_TOKENS = 64;

/** The anchor arm's question. Fixed and probe-INDEPENDENT: the anchor is one
 *  synthetic prompt with its own target and decoy at frozen depths, so it must
 *  not inherit a probe's wording — a question that varied with the probe would
 *  make the drift series incomparable with itself. */
const ANCHOR_QUESTION =
  "Two reference codes appear in the text above. Reply with the second one, exactly as written, and nothing else.";

/** How much of a reply is recorded in the artifact. The observed answers ran
 *  11-22 output tokens, so this is far more than any well-behaved reply needs;
 *  it exists to bound a model that ignores "and nothing else" entirely. */
const MAX_SAMPLE_CHARS = 400;

function truncate(text: string): string {
  const s = String(text);
  return s.length <= MAX_SAMPLE_CHARS
    ? s
    : `${s.slice(0, MAX_SAMPLE_CHARS)}…[+${s.length - MAX_SAMPLE_CHARS} chars]`;
}

/** The diagnostic filter, as `parseFilter` returns it. `null` members are
 *  dimensions the operator did not narrow. */
type Filter = {
  probes: string[] | null;
  reps: number | null;
  arms: string[] | null;
  spec: string;
};

/** The snapshot both prompt builders take.
 *
 *  ★★★ A LITERAL, NOT A DECODED WORKSPACE. `getSnapshot`'s return type is
 *  structural — scalars, string arrays and bounded summaries — so nothing here
 *  needs `jsonToWorkspace`, and therefore nothing needs jsdom. It is also the
 *  only way to get planted tokens to sit at chosen depths inside chosen
 *  fields, which a real decode cannot be made to do.
 *
 *  Every field carrying a probe token takes it from `tokens`, so one call site
 *  controls where each token lands. */
function snapshotFor(tokens: Record<string, string>) {
  return {
    today: `2026-09-09 (reference code ${tokens.date})`,
    language: "en-US",
    holidayCountries: ["DE"],
    storageKind: "file",
    taskCount: 140,
    knownGroups: ["Discovery", "Build", "Rollout"],
    knownLabels: ["blocked", "risk"],
    mode: "expert",
    enabledModules: [],
    currentView: "budget",
    // ★★ The token rides `data.name`, which `factLine` interpolates for a
    //    `milestoneSlip`. `status` must be one of `insight-prompt.ts`'s
    //    SURFACED_STATUSES or the whole block is dropped and the probe
    //    silently measures nothing.
    insights: [
      {
        id: 1, key: "eval-probe", type: "milestoneSlip", severity: "high",
        data: { name: `Phase gate (reference code ${tokens.insights})`, daysOverdue: 6 },
        status: "active", firstSeenAt: "2026-09-01T08:00:00Z",
        lastSeenAt: "2026-09-08T08:00:00Z", occurrences: 3,
      },
    ],
    viewDigest: `Budget view, 12 rows after filters. Reference code ${tokens.viewScope}.`,
    timezone: "Europe/Berlin",
    // ★★★ `ActivitySummary` carries NO free-text field — every other member is
    //     a count — so `latestAt` is the only place a token can ride, and it
    //     rides `buildActivityRecapBlock`'s DOCUMENTED fallback: `dayInZone`
    //     returns null for an unparseable stamp and the raw value is emitted
    //     verbatim. A parseable stamp would be reformatted to a bare day and
    //     the token would vanish, so this string must stay unparseable by
    //     `new Date(...)`. Ugly, and deliberately so — the alternative is a
    //     probe over a block that cannot carry a needle at all.
    activitySummary: {
      total: 12, byActor: { user: 9, ai: 2, integration: 1, unknown: 0 },
      latestAt: `reference code ${tokens.activityRecap}`, days: 7,
    },
    // ★ `inlineTitle` collapses whitespace and strips double quotes; the
    //   tokens are bare syllables, so they survive it unchanged.
    chatPointer: {
      count: 4,
      recent: [{ title: `Budget rebaseline (reference code ${tokens.chatPointer})`, at: "2026-09-07" }],
    },
  } as unknown as Parameters<typeof buildTurnContext>[1];
}

type Arm = { system: SystemBlock[]; messages: ApiMessage[] };

/** Assemble one arm's request.
 *
 *  ★★ `variant` is where the candidate layout plugs in. H ships with "current"
 *  only, and arm B is deliberately an ALIAS of arm A: an A/A run must come back
 *  PASS, which is the harness's own self-test and the only way to validate the
 *  machinery before any gated slice exists. Each of G2, the guide trim and
 *  tool-array gating adds its own variant here and flips it from its plan. */
function assembleArm(variant: "current", tokens: Record<string, string>, question: string): Arm {
  const snapshot = snapshotFor(tokens);
  const guides = builtinSeeds();
  const toolFlags = {};
  const system = buildStableSystemBlocks("en-US", snapshot, guides, true, toolFlags);
  const turnContext = buildTurnContext("en-US", snapshot, guides, true, toolFlags);
  const history: ApiMessage[] = [{ role: "user", content: question }];
  const { messages } = buildWireMessages(history, turnContext);
  void variant;
  return { system, messages };
}

/** The variant arm B is built from. "current" today, which makes arm B a
 *  deliberate byte-for-byte ALIAS of arm A — see `assembleCandidate`. */
const CANDIDATE_VARIANT = "current";

/** Arm B — the candidate.
 *
 *  ★★ THIS IS THE ONE ARM THAT LEGITIMATELY SHARES ARM A'S BUILDER, and only
 *  because `CANDIDATE_VARIANT` is still "current": an A/A run must come back
 *  PASS, which is the harness's own self-test and the only way to validate the
 *  machinery before a gated slice exists. It has its own function anyway so
 *  that a slice registering a real variant changes ONE line here and cannot
 *  accidentally move arm A with it. Arms R, N and X are the opposite case and
 *  each says why below. */
function assembleCandidate(tokens: Record<string, string>, question: string): Arm {
  return assembleArm(CANDIDATE_VARIANT, tokens, question);
}

/** Arm X — the negative control. Arm A with the probed block's token REMOVED.
 *
 *  ★★★ IT MUST SCORE ZERO. If the token still surfaces with its block gone, it
 *  is reachable from somewhere else in the prompt and that probe never measured
 *  reachability at all. Without X, "hit on every arm" and "the detector cannot
 *  register a miss" produce identical output.
 *
 *  ★★ It shares arm A's BUILDER but never arm A's BYTES: the token map it
 *  passes has one entry blanked, so the assembled prompt differs from arm A's
 *  by exactly the thing under test and by nothing else. Reassembling it through
 *  a second copy of the builder would let the control drift away from the arm
 *  it is the control FOR, which is the one property it must keep. The decoy is
 *  deliberately left in place — a control that also lost the decoy could not
 *  distinguish "answered from somewhere else" from "answered nothing". */
function assembleControl(tokens: Record<string, string>, probeId: string, question: string): Arm {
  const stripped = { ...tokens, [probeId]: "" };
  return assembleArm("current", stripped, question);
}

/** Arm N — the seeded anchor. Probe-independent: one fixed prompt, its own
 *  target and decoy, regenerated from `ANCHOR_SPEC` and hash-asserted.
 *
 *  ★★★ IT CANNOT GO THROUGH `assembleArm`. The anchor's whole value is that it
 *  is INDEPENDENT of this repo's prompt builders — it is the fixed rule against
 *  which a model change is told apart from a prompt change. Building it from
 *  the app's builders would make it move whenever the thing it is measuring
 *  moves, and the two effects could never be separated again. */
function assembleAnchor(prompt: string, question: string): Arm {
  return {
    system: [{ type: "text", text: prompt }],
    messages: [{ role: "user", content: question }],
  };
}

/** Arm R — the rolling replay. The PREVIOUS run's own arm-A bytes, verbatim.
 *
 *  ★★ Same bytes, two dates, two scores: the difference is drift and can be
 *  nothing else. Which is exactly why nothing here may rebuild it — a
 *  regenerated prompt is a different prompt and the attribution is gone. It
 *  therefore cannot share `assembleArm` even in principle: `assembleArm` builds
 *  TODAY's prompt, and today's prompt is the one thing arm R must not be.
 *
 *  ★ KNOWN LIMIT: the stored system half is one joined string, so the replay
 *  restores the BYTES but not the original block boundaries or their
 *  `cache_control` marks. It measures content drift, never cache behaviour. */
function assembleReplay(storedJson: string): Arm {
  const stored = JSON.parse(storedJson) as { system: string; turn: string };
  return {
    system: [{ type: "text", text: stored.system }],
    messages: JSON.parse(stored.turn) as ApiMessage[],
  };
}

/** One reply, reduced to what anything downstream reads. The four token counts
 *  are the four BILLED classes — `inputTokens` alone is the uncached portion
 *  and says nothing about a cached prefix's cost. */
type Reply = {
  text: string;
  toolUses: number;
  outputTokens: number;
  inputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
};

/** The harness's ONLY network boundary. Everything else in this file is pure
 *  assembly or a filesystem read/write, so injecting this function is enough to
 *  exercise the entire live path without a key, a request or a cent. */
type RequestFn = (system: SystemBlock[], messages: ApiMessage[]) => Promise<Reply>;

/** Build the real transport. Mirrors the app's own call shape — same endpoint,
 *  same version header, same tool array — so the harness measures the request
 *  the app actually makes.
 *
 *  ★★★ THE KEY IS READ FROM THE ENVIRONMENT AND PASSED ONLY IN THE HEADER. It
 *  is closed over HERE, at the one call site that needs it, so that an injected
 *  `RequestFn` is never handed a key at all — it is never a CLI argument (that
 *  lands in shell history and process listings), never logged, and never
 *  included in an error message. The RESPONSE body is safe to surface; the
 *  request header is not. */
function liveRequest(apiKey: string): RequestFn {
  return async (system, messages) => {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey.trim(),
        "anthropic-version": ANTHROPIC_VERSION,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_OUTPUT_TOKENS,
        system,
        messages,
        tools: toolsFor({}),
      }),
    });
    if (!res.ok) {
      throw new Error(`anthropic ${res.status}: ${await res.text()}`);
    }
    const body = await res.json() as {
      content?: { type: string; text?: string }[];
      usage?: Partial<ApiUsage>;
    };
    const blocks = Array.isArray(body.content) ? body.content : [];
    // ★★★ ALL FOUR BILLED CLASSES, THROUGH THE APP'S OWN NORMALISER. The first
    //     live run recorded `input_tokens` alone (1605) and dropped both cache
    //     fields, so a harness whose PURPOSE is measuring prompt cost could not
    //     say what the run cost — a ~31k-token cached prefix is invisible in
    //     `input_tokens`. That is the same defect the app's own meter carried
    //     before 0.295.0. `normalizeApiUsage` defaults a missing or non-finite
    //     field to 0 rather than `undefined`, which matters here because an
    //     `undefined` would propagate through the sums as NaN and every later
    //     comparison against it would silently be false.
    const usage = normalizeApiUsage(body.usage);
    return {
      text: blocks.filter((b) => b.type === "text").map((b) => b.text ?? "").join("\n"),
      toolUses: blocks.filter((b) => b.type === "tool_use").length,
      outputTokens: usage.output_tokens,
      inputTokens: usage.input_tokens,
      cacheWriteTokens: usage.cache_creation_input_tokens,
      cacheReadTokens: usage.cache_read_input_tokens,
    };
  };
}

/** The four billed classes of one or many replies, in `ai-usage.ts`'s own
 *  vocabulary so `usageCostEquivalent` can weight it without a translation
 *  layer that could invert a field. */
const ZERO_USAGE: Usage = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 };

function usageOf(replies: { inputTokens: number; outputTokens: number; cacheWriteTokens: number; cacheReadTokens: number }[]): Usage {
  return replies.reduce<Usage>((acc, r) => ({
    input: acc.input + r.inputTokens,
    output: acc.output + r.outputTokens,
    cacheWrite: acc.cacheWrite + r.cacheWriteTokens,
    cacheRead: acc.cacheRead + r.cacheReadTokens,
  }), ZERO_USAGE);
}

function sumUsage(parts: Usage[]): Usage {
  return parts.reduce<Usage>((a, u) => ({
    input: a.input + u.input,
    output: a.output + u.output,
    cacheWrite: a.cacheWrite + u.cacheWrite,
    cacheRead: a.cacheRead + u.cacheRead,
  }), ZERO_USAGE);
}

/** Split one arm into the two halves `preflight` asserts positions against, and
 *  declare which half is expected to carry the probe's target.
 *
 *  ★★★ "turn" IS THE CORRECT ANSWER FOR EVERY PROBE TODAY, and it is measured,
 *  not assumed: `buildStableSystemBlocks` contains none of the relocatable
 *  block builders and `buildTurnContext` contains all of them, so all five
 *  targets ride the volatile half that `buildWireMessages` puts in messages.
 *  A candidate variant that moves a block into the cached system array declares
 *  "system" for its arm and `preflight` then proves the move happened. */
function flatten(arm: Arm, expectedHalf: "system" | "turn") {
  const system = arm.system.map((b) => b.text).join("\n");
  const turn = JSON.stringify(arm.messages);
  return { expectedHalf, system, turn };
}

/** Both halves of an arm as one string. Used for the arm-X assertions, which
 *  are about a token's ABSENCE and therefore have no half to declare —
 *  `flatten` would force one, and a declared half on an arm with no target is a
 *  claim nobody can check. */
function wholeOf(arm: Arm): string {
  return `${arm.system.map((b) => b.text).join("\n")}\n${JSON.stringify(arm.messages)}`;
}

/** Count non-overlapping occurrences, case-insensitively — the same comparison
 *  `scoreResponse` makes, so a pre-flight assertion and a score can never
 *  disagree about whether a token is present. */
function occurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  return haystack.toLowerCase().split(needle.toLowerCase()).length - 1;
}

/** Everything this CLI touches that is not pure assembly.
 *
 *  ★★★ THE INJECTION SEAM. `request` is the process's only network call and
 *  `writeArtifact` its only mutation of the repo, so handing in fakes exercises
 *  the whole live path — interleaving, scoring, the census, the verdict and
 *  both write decisions — while spending nothing and writing nothing. `env` is
 *  a parameter rather than a direct `process.env` read for the same reason: the
 *  live branch can be reached with a synthetic environment, so verifying it
 *  never requires setting `AI_EVAL_SPEND` on a real process. */
type EvalDeps = {
  env: Record<string, string | undefined>;
  request?: RequestFn;
  readTextIfExists: (path: string) => string | null;
  writeArtifact: (path: string, text: string) => void;
};

const defaultDeps: EvalDeps = {
  env: process.env,
  readTextIfExists: (path) => (existsSync(path) ? readFileSync(path, "utf8") : null),
  writeArtifact: (path, text) => writeFileSync(path, text, "utf8"),
};

export async function runEval(overrides: Partial<EvalDeps> = {}): Promise<number> {
  const deps: EvalDeps = { ...defaultDeps, ...overrides };
  const env = deps.env;
  const apiKey = env.ANTHROPIC_API_KEY ?? "";
  const decision = spendDecision({ env, hasKey: apiKey.trim().length > 0 });
  if (decision.mode === "refuse") {
    console.error(decision.reason);
    return decision.code;
  }

  // ★★★ THE DIAGNOSTIC FILTER. It exists so one broken probe can be re-run for
  //     cents rather than sixty requests, and everything downstream treats a
  //     non-null filter as poison: `verdict` refuses to pass, and
  //     `shouldWriteRolling` refuses to write. Parsed FIRST so a typo'd probe
  //     id costs nothing.
  const parsed = parseFilter(env) as
    | { ok: true; filter: Filter | null }
    | { ok: false; errors: string[] };
  if (!parsed.ok) {
    console.error("invalid filter — spending nothing:");
    for (const e of parsed.errors) console.error(`  ${e}`);
    console.error(
      `usage: ${FILTER_ENV.probes}=<id,...> ${FILTER_ENV.reps}=<n> ${FILTER_ENV.arms}=<A,B,X,N,R>`,
    );
    return EXIT.UNUSABLE;
  }
  const filter = parsed.filter;
  const activeProbes = filter?.probes
    ? PROBES.filter((p) => filter.probes?.includes(p.id))
    : PROBES;
  const reps = filter?.reps ?? REPS;
  const armWanted = (arm: string): boolean => !filter?.arms || filter.arms.includes(arm);

  const salt = Number(env.AI_EVAL_SALT ?? "1");
  const anchorTarget = plantedToken("anchor", salt);
  const anchorDecoy = plantedToken("anchorDecoy", salt);
  const anchorPrompt = buildAnchorPrompt(ANCHOR_SPEC, anchorTarget, anchorDecoy);
  const anchorHash = sha256(anchorPrompt);

  const rollingText = deps.readTextIfExists(ROLLING_PATH);
  const rollingExists = rollingText !== null;
  const rollingHash = rollingText === null ? null : sha256(rollingText);
  const runsText = deps.readTextIfExists(RUNS_PATH);
  const recorded = runsText === null
    ? { runs: [] as Record<string, unknown>[] }
    : JSON.parse(runsText) as { runs: Record<string, unknown>[] };
  const last = (recorded.runs[recorded.runs.length - 1] ?? null) as
    | { anchorHash?: string; rollingHash?: string | null; salt?: number; date?: string }
    | null;

  // ★ ONE token map for the whole run. It was rebuilt per probe and again for
  //   the size print; `plantedToken` is deterministic so every copy was
  //   identical, but three copies of a map the pre-flight, the live arms and
  //   the rolling write all key off is three chances for them to disagree.
  const tokens: Record<string, string> = {};
  for (const p of PROBES) tokens[p.id] = plantedToken(p.id, salt);

  // ★ Pre-flight covers the ACTIVE probes only. Asserting an unselected probe
  //   is free, but a failure in one would abort the very diagnostic run whose
  //   whole point is investigating a different probe.
  const failures: string[] = [];
  for (const probe of activeProbes) {
    const armA = flatten(assembleArm("current", tokens, probe.question), "turn");
    const armB = flatten(assembleCandidate(tokens, probe.question), "turn");

    // ★★★ ARM X IS PRE-FLIGHTED HERE AND DELIBERATELY NOT THROUGH `preflight`.
    //     `preflight` asserts the target appears EXACTLY ONCE per arm; arm X is
    //     the arm whose target was removed, so handing it over would fail every
    //     probe by construction and the only way to make it pass would be to
    //     weaken the check for A and B too. The control still needs asserting —
    //     a strip that silently stopped stripping gives a control identical to
    //     arm A, which then scores high, and `verdict` calls the probe void
    //     AFTER the money is spent. So: zero targets, and the decoy untouched.
    const controlText = wholeOf(assembleControl(tokens, probe.id, probe.question));
    const targetInControl = occurrences(controlText, tokens[probe.id]);
    if (targetInControl !== 0) {
      failures.push(
        `${probe.id}: the negative control still carries the target ${targetInControl} time(s) — the strip did not strip`,
      );
    }
    const decoyInControl = occurrences(controlText, tokens[probe.distractorBlock]);
    if (decoyInControl !== 1) {
      failures.push(
        `${probe.id}: the negative control must keep its decoy exactly once, found ${decoyInControl} — without it a control cannot tell "answered from elsewhere" from "answered nothing"`,
      );
    }

    const res = preflight({
      target: tokens[probe.id],
      decoy: tokens[probe.distractorBlock],
      armPrompts: { A: armA, B: armB },
      anchorHash,
      recordedAnchorHash: last?.anchorHash ?? anchorHash,
      rollingHash,
      recordedRollingHash: last?.rollingHash ?? null,
      // ★★ NOTHING IS SUPPRESSED HERE. Both arms declare "turn" and both
      //    position assertions run and hold. That is honest for an A/A
      //    self-test — arm B is a deliberate alias of arm A until a gated slice
      //    registers a variant, so there is genuinely no relocation to prove.
      //    A real candidate declares the OTHER half for its arm and `preflight`
      //    then proves the block moved. There is no flag to drop.
    });
    if (!res.ok) failures.push(`${probe.id}: ${res.failures.join("; ")}`);
  }

  // A and B run per probe per rep. X is one rep per probe. R and N are
  // probe-INDEPENDENT single-probe arms measuring drift, so they run `reps`
  // times each and never per probe — they inform the artifact, they do not gate.
  // ★ THE PLAN IS COMPUTED ONCE, HERE, and the census below compares against
  //   these same numbers — a separately-derived plan would let the two disagree
  //   about what a short run even is.
  const plan = {
    A: armWanted("A") ? reps : 0,
    B: armWanted("B") ? reps : 0,
    X: armWanted("X") ? 1 : 0,
    N: armWanted("N") ? reps : 0,
    R: armWanted("R") && rollingExists && last !== null ? reps : 0,
  };
  const requests =
    activeProbes.length * (plan.A + plan.B + plan.X) + plan.N + plan.R;
  console.log(`mode: ${decision.mode}`);
  console.log(
    `probes: ${activeProbes.length}/${PROBES.length}, reps: ${reps}, planned requests: ${requests}`,
  );
  if (filter !== null) {
    // Loud, and on stderr: a narrowed run is a diagnostic and must never be
    // mistaken for the standard one, in the terminal or in the artifact.
    console.error(`FILTERED RUN (${filterSpec(filter)}) — this run cannot report PASS`);
  }
  console.log(`anchor hash: ${anchorHash}`);
  console.log(`rolling reference: ${rollingExists ? "present" : "absent (first run)"}`);

  // ★★ The assembled SIZE is the one number that says whether this harness is
  //    measuring the prompt the app actually sends, so it prints on every run
  //    — including the dry one, which is the only place most people will look.
  //
  //    ★★★ CHARS ONLY, NO TOKEN ESTIMATE. Nothing here tokenizes, and the
  //    familiar chars/4 rule of thumb is ~40% LOW on this content: against the
  //    recorded fixed prefix (tools 17,796 tok, stable block 0 13,305 tok) the
  //    measured ratios are 45,532/17,796 = 2.56 and 38,929/13,305 = 2.93 chars
  //    per token — dense JSON schema and dense prose, neither of them 4. A
  //    printed "~10,367 tok" for a 41,467-char prompt would be wrong by
  //    thousands of tokens and would be read as a measurement. Divide by ~2.7
  //    for an order-of-magnitude read; the real figures come from the live
  //    run's own `usage`, which the record carries in all four billed classes
  //    — and note `input_tokens` ALONE is not the prompt size, it is only the
  //    uncached remainder (1605 against a ~31k-token prompt on the first run).
  const sizeArm = assembleArm("current", tokens, PROBES[0].question);
  const sizeFlat = flatten(sizeArm, "turn");
  const toolsJson = JSON.stringify(toolsFor({}));
  // ★ Block 0 is broken out because it is the CACHED prefix and the half any
  //   recorded fixed-prefix figure refers to. Block 1 is the current view's
  //   guides and is absent on a view no feature guide scopes to.
  const blockChars = sizeArm.system.map((b) => b.text.length);
  console.log(
    `assembled arm A (chars): system ${sizeFlat.system.length} ` +
      `in ${sizeArm.system.length} block(s) [${blockChars.join(" + ")}], ` +
      `turn ${sizeFlat.turn.length}, tools ${toolsJson.length}`,
  );

  if (failures.length > 0) {
    console.error("PRE-FLIGHT FAILED — spending nothing:");
    for (const f of failures) console.error(`  ${f}`);
    return EXIT.UNUSABLE;
  }
  console.log("pre-flight OK");
  if (decision.mode === "dry") {
    console.log("dry run — no requests sent. Set AI_EVAL_SPEND=1 to run live.");
    return EXIT.PASS;
  }
  // ★★★ The transport is resolved HERE and nowhere earlier: an injected fake
  //     means `liveRequest` is never constructed, so the key never leaves the
  //     two lines above. Reaching this point at all required an explicit
  //     AI_EVAL_SPEND and a key, both already checked by `spendDecision`.
  const request = deps.request ?? liveRequest(apiKey);

  type Scored = Reply & { outcome: string };
  const perProbeReplies: Record<string, { A: Scored[]; B: Scored[]; X: Scored[] }> = {};
  const driftReplies: { R: Scored[]; N: Scored[] } = { R: [], N: [] };
  let complete = true;

  const send = async (arm: Arm, target: string, decoy: string): Promise<Scored> => {
    const reply = await request(arm.system, arm.messages);
    // ★★ The outcome is attached HERE, not recomputed later. gradeArm's
    //    wrongBlock axis reads `outcome`; handing it a bare reply silently
    //    reports zero wrong-block hits on every run.
    return { ...reply, outcome: scoreResponse(reply.text, target, decoy) };
  };

  // ★★★ INTERLEAVED BY (probe, rep, arm). Running an arm to completion before
  //    starting the next lets any drift within the run land entirely on
  //    whichever went last, which is indistinguishable from a regression.
  try {
    for (const probe of activeProbes) {
      perProbeReplies[probe.id] = { A: [], B: [], X: [] };
      const target = tokens[probe.id];
      const decoy = tokens[probe.distractorBlock];
      for (let rep = 0; rep < reps; rep += 1) {
        if (armWanted("A")) {
          perProbeReplies[probe.id].A.push(
            await send(assembleArm("current", tokens, probe.question), target, decoy),
          );
        }
        if (armWanted("B")) {
          perProbeReplies[probe.id].B.push(
            await send(assembleCandidate(tokens, probe.question), target, decoy),
          );
        }
      }
      // ★★ THE CONTROL IS DISPATCHED, not merely allocated. Its score is the
      //    one zero in this artifact that carries meaning, and `verdict` reads
      //    it — an X array left empty makes `hitRate` return 0, which reads as
      //    a clean control and is in fact no control at all. One rep is enough
      //    for a result that must be flatly zero.
      if (armWanted("X")) {
        perProbeReplies[probe.id].X.push(
          await send(assembleControl(tokens, probe.id, probe.question), target, decoy),
        );
      }
    }

    for (let rep = 0; rep < reps; rep += 1) {
      if (armWanted("N")) {
        driftReplies.N.push(
          await send(assembleAnchor(anchorPrompt, ANCHOR_QUESTION), anchorTarget, anchorDecoy),
        );
      }
      if (plan.R > 0 && rollingText !== null) {
        // The stored bytes carry the SALT of the run that wrote them, so the
        // replay is scored against that run's tokens, never today's.
        const replaySalt = last?.salt ?? salt;
        const rTarget = plantedToken(PROBES[0].id, replaySalt);
        const rDecoy = plantedToken(PROBES[0].distractorBlock, replaySalt);
        driftReplies.R.push(await send(assembleReplay(rollingText), rTarget, rDecoy));
      }
    }
  } catch (err) {
    // ★★ No retry. A partial run is recorded as partial and the rolling
    //    reference is left alone; retrying inside the run would put some arms
    //    at a different point in time from others, which is precisely the
    //    confound interleaving exists to remove.
    console.error(`run incomplete: ${String(err)}`);
    complete = false;
  }

  // ★★★ THE CENSUS — what was dispatched against what came back.
  //     `verdict` refuses a run that measured NOTHING and refuses a probe whose
  //     arm is not a finite number, but it is handed `perProbe` and cannot know
  //     how many probes or reps SHOULD have been in it: a run that silently
  //     dropped three of five probes hands over two well-formed rows and passes.
  //     Only this file knows the plan, so only this file can compare the plan
  //     against the result. Anything short forces `complete: false`, which
  //     `verdict` turns into UNUSABLE — never REGRESSION, because a run that
  //     did not happen says nothing about the candidate.
  const isScored = (r: Scored | undefined) => typeof r?.outcome === "string";
  const census: string[] = [];
  for (const probe of activeProbes) {
    const got = perProbeReplies[probe.id];
    if (!got) {
      census.push(`${probe.id}: dispatched no arms at all`);
      continue;
    }
    for (const arm of ["A", "B", "X"] as const) {
      const rs = got[arm];
      const want = plan[arm];
      if (rs.length !== want) {
        census.push(`${probe.id}: arm ${arm} returned ${rs.length} of ${want} planned replies`);
      } else if (!rs.every(isScored)) {
        census.push(`${probe.id}: arm ${arm} carried a reply with no scored outcome`);
      }
    }
  }
  if (driftReplies.N.length !== plan.N || !driftReplies.N.every(isScored)) {
    census.push(`anchor: returned ${driftReplies.N.length} of ${plan.N} planned replies`);
  }
  if (driftReplies.R.length !== plan.R || !driftReplies.R.every(isScored)) {
    census.push(`rolling replay: returned ${driftReplies.R.length} of ${plan.R} planned replies`);
  }
  if (census.length > 0) {
    complete = false;
    console.error("run did not produce every planned result:");
    for (const c of census) console.error(`  ${c}`);
  }

  const outcomesOf = (rs: Scored[]) => rs.map((r) => r.outcome);
  // ★★ Only A, B and X reach the verdict. R and N measure DRIFT — they say
  //    whether the instrument moved, never whether the candidate is worse — so
  //    folding them in would let a model update fail a slice.
  const perProbe = activeProbes.map((p) => ({
    id: p.id,
    A: hitRate(outcomesOf(perProbeReplies[p.id]?.A ?? [])),
    B: hitRate(outcomesOf(perProbeReplies[p.id]?.B ?? [])),
    X: hitRate(outcomesOf(perProbeReplies[p.id]?.X ?? [])),
  }));

  // ★★★ WHAT THE MODEL ACTUALLY SAID, for every reply that was not a hit, plus
  //     ONE exemplar hit per (probe, arm) so a reader can see what a good answer
  //     looks like without storing all sixty. The first live run recorded scores
  //     alone, and `chatPointer` scoring 0.0 on the UNCHANGED baseline was then
  //     undiagnosable — a refusal, a paraphrase and an answer to a different
  //     question are one number, and telling them apart cost another full run.
  //
  //     ★★ ONLY the reply text, truncated. Nothing from the REQUEST is captured:
  //     the prompt is regenerable from the salt and the builders, and an
  //     artifact that quoted requests would grow without bound for no gain.
  //     (The content is model output against a synthetic snapshot — there is no
  //     real project data anywhere in this harness.)
  const samples: {
    probe: string; arm: string; rep: number; outcome: string; text: string;
  }[] = [];
  const exemplarTaken = new Set<string>();
  const collect = (probeId: string, arm: string, rs: Scored[]) => {
    rs.forEach((r, rep) => {
      const key = `${probeId}:${arm}`;
      const isExemplar = r.outcome === "hit" && !exemplarTaken.has(key);
      if (r.outcome !== "hit" || isExemplar) {
        if (isExemplar) exemplarTaken.add(key);
        samples.push({ probe: probeId, arm, rep, outcome: r.outcome, text: truncate(r.text) });
      }
    });
  };
  for (const p of activeProbes) {
    for (const arm of ["A", "B", "X"] as const) collect(p.id, arm, perProbeReplies[p.id]?.[arm] ?? []);
  }
  collect("anchor", "N", driftReplies.N);
  collect("rolling", "R", driftReplies.R);

  // ★★ EVERY BILLED CLASS, SUMMED ACROSS THE WHOLE RUN AND PER ARM, plus the
  //    weighted total from `usageCostEquivalent`. Weighted, not summed: a cached
  //    read bills at a tenth and an output token at five times, so an unweighted
  //    total answers a question nobody asked. NOT converted to currency — a
  //    dollar figure would hardcode a price into an artifact meant to be
  //    comparable across years.
  const armUsage: Record<string, Usage> = {
    A: usageOf(activeProbes.flatMap((p) => perProbeReplies[p.id]?.A ?? [])),
    B: usageOf(activeProbes.flatMap((p) => perProbeReplies[p.id]?.B ?? [])),
    X: usageOf(activeProbes.flatMap((p) => perProbeReplies[p.id]?.X ?? [])),
    N: usageOf(driftReplies.N),
    R: usageOf(driftReplies.R),
  };
  const totalUsage = sumUsage(Object.values(armUsage));
  const usage = {
    requests:
      activeProbes.reduce(
        (n, p) => n + (perProbeReplies[p.id]?.A.length ?? 0)
          + (perProbeReplies[p.id]?.B.length ?? 0) + (perProbeReplies[p.id]?.X.length ?? 0),
        0,
      ) + driftReplies.N.length + driftReplies.R.length,
    total: totalUsage,
    costEquivalent: usageCostEquivalent(totalUsage),
    byArm: armUsage,
    // Recorded so a later change to the weights is visible in the series
    // instead of silently rewriting every earlier run's cost figure.
    costWeights: USAGE_COST_WEIGHTS,
  };

  const firstA = activeProbes.length > 0
    ? perProbeReplies[activeProbes[0].id]?.A[0] ?? null
    : null;
  const record = buildRunRecord({
    date: new Date().toISOString().slice(0, 10),
    model: MODEL,
    gitSha: env.GIT_SHA ?? "unrecorded",
    anchorHash,
    rollingHash,
    anchorSpec: ANCHOR_SPEC,
    reps,
    salt,
    // ★★★ `filter` reaches the record and the verdict as ONE argument — see
    //     `buildRunRecord`. There is no second place to pass it and therefore
    //     no way to record a narrowing while reporting an unnarrowed verdict.
    filter,
    // ★ The REAL token figures for the first arm-A request. `inputTokens` is
    //   the UNCACHED portion ALONE — it read 1605 on the first live run while
    //   the prompt is ~31k tokens, because the rest was a cache read. All four
    //   classes are here for that reason.
    sizes: {
      systemChars: sizeFlat.system.length,
      turnChars: sizeFlat.turn.length,
      toolsChars: toolsJson.length,
      inputTokens: firstA?.inputTokens ?? null,
      cacheWriteTokens: firstA?.cacheWriteTokens ?? null,
      cacheReadTokens: firstA?.cacheReadTokens ?? null,
    },
    usage,
    perProbe,
    graded: activeProbes.map((p) => ({
      id: p.id,
      A: gradeArm(perProbeReplies[p.id]?.A ?? [], tokens[p.id]),
      B: gradeArm(perProbeReplies[p.id]?.B ?? [], tokens[p.id]),
    })),
    drift: {
      anchor: {
        hitRate: hitRate(outcomesOf(driftReplies.N)),
        graded: gradeArm(driftReplies.N, anchorTarget),
      },
      rolling: plan.R === 0
        ? null
        : {
            hitRate: hitRate(outcomesOf(driftReplies.R)),
            comparedAgainstRunDate: last?.date ?? null,
          },
    },
    samples,
    complete,
  }) as { verdict: { code: number; reasons: string[]; notes: string[] } };
  const v = record.verdict;
  recorded.runs.push(record as unknown as Record<string, unknown>);
  deps.writeArtifact(RUNS_PATH, `${JSON.stringify(recorded, null, 2)}\n`);

  if (shouldWriteRolling({ mode: decision.mode, complete, filtered: filter !== null })) {
    // ★★ Written from THIS run's arm A, and only because the run completed.
    //    An incomplete run leaves the file alone: overwriting from a run nobody
    //    scored poisons the reference invisibly, and the NEXT run then compares
    //    against garbage and reports no drift.
    const built = assembleArm("current", tokens, PROBES[0].question);
    deps.writeArtifact(ROLLING_PATH, JSON.stringify(flatten(built, "turn")));
  }

  for (const r of v.reasons) console.error(r);
  for (const n of v.notes) console.log(n);
  console.log(`verdict: ${v.code === EXIT.PASS ? "PASS" : v.code === EXIT.REGRESSION ? "REGRESSION" : "UNUSABLE"}`);
  return v.code;
}

/** The CLI entry point — suppressed only for a harness that drives `runEval`
 *  itself with an injected transport, which must be able to import this module
 *  without the import alone starting a run and calling `process.exit` out from
 *  under it.
 *
 *  ★★★ AN ENV FLAG AND NOT THE USUAL ENTRY-MODULE COMPARISON, because under
 *  vite-node there is nothing to compare against: it strips the script path
 *  from `process.argv` entirely (measured — argv is `[node, cli.mjs]` and
 *  nothing else), so `import.meta.url === pathToFileURL(argv[1])` is false for
 *  the real CLI invocation and the tool would silently do nothing at exit 0.
 *
 *  ★★ The flag ANNOUNCES ITSELF on stderr rather than returning quietly. A
 *  suppressed entry point that printed nothing is exactly the false green this
 *  harness exists to detect: a run that measured nothing must never be
 *  indistinguishable from a clean one. */
if (process.env.AI_EVAL_IMPORT === "1") {
  console.error(
    "ai-eval: AI_EVAL_IMPORT=1 — CLI entry suppressed; the importer must call runEval() itself",
  );
} else {
  runEval().then((code) => process.exit(code));
}
