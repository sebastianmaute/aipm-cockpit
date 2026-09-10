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
  preflight, driftReferenceCheck, spendDecision, scoreResponse, hitRate, gradeArm,
  shouldWriteRolling, parseFilter, filterSpec, buildRunRecord, FILTER_ENV,
  tokenSubstringConflicts, PROBE_HARDENING, plantLabel, priorLabel,
  plantedProbeIds, compositionProbeId, COMPOSITION_ALT_IDS,
} from "./ai-eval-lib.mjs";

/** One probe's difficulty knobs. The table itself lives in the lib — see
 *  `PROBE_HARDENING` there for what each switch does and which are inert. */
type Hardening = { competitor: boolean; fillerBefore: number; composition: boolean };

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

/** How many output tokens one probe reply may cost.
 *
 *  ★★★ RAISED FROM 64 ON 2026-09-09 BECAUSE 64 WAS MEASURING THE CAP, NOT THE
 *  MODEL. The four single-hop probes answer in 11-13 tokens and never come near
 *  it, but the composition probe consumed EXACTLY 64 on all three reps of the
 *  calibration sweep and returned empty text — a probe colliding with the
 *  output ceiling scores `absent` whether or not it found the block, so it
 *  measures nothing. A cap that forecloses a sentence of reasoning before the
 *  answer is a limit on the INSTRUMENT, and it silently caps how hard any probe
 *  can ever be.
 *
 *  ★★ IT IS RECORDED IN EVERY RUN RECORD, because the `outputTokens` graded
 *  axis is a mean and is compared across runs: the cap bounds what that axis
 *  can reach, so runs at different caps are not comparable on it. Changing this
 *  line starts a new comparison series for that axis, exactly like `MODEL`.
 *
 *  ★ COST: output bills at 5x input. The 65-request run recorded 841 output
 *  tokens in total (mean 13). If every reply instead ran to this cap the run
 *  would emit 65 x 512 = 33,280, worth 166,400 weighted tokens against that
 *  run's recorded 681,288 — about +24% worst case, and nowhere near it in
 *  practice. Cheap insurance against a probe that needs room to think. */
const MAX_OUTPUT_TOKENS = 512;

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

/** Realistic, CODE-FREE digest lines for the budget view, used as `fillerBefore`
 *  depth for the `viewScope` probe. Shape and length mirror `view-ai-digest.ts`,
 *  which emits a count line, a filter line and an enumerated `Visible rows:`
 *  sample — so four of these is a representative digest, not a padded one. */
const VIEW_DIGEST_FILLER = [
  "Budget view — 6 role rows across 4 periods; figures are project totals, not filtered.",
  "Planned 4,180 h against a 4,500 h baseline; 320 h of headroom remains.",
  "Roles over baseline: Solution Architect (+140 h), Test Manager (+60 h).",
  "Visible rows: #101 Solution Architect [amber]; #102 Test Manager [red]; #103 Developer [green].",
  "Two buckets carry a red RAG on cost-per-unit: Integration and Rollout.",
];

/** Realistic, CODE-FREE insights used as `fillerBefore` depth for the `insights`
 *  probe. Every one is `high` severity so it sorts AHEAD of the target.
 *
 *  ★★★ SEVERITY IS THE ORDERING LEVER, NOT ARRAY POSITION.
 *  `buildInsightsPromptBlock` SORTS by `INSIGHT_SEVERITY_RANK` (high 0, medium
 *  1, low 2) and then SLICES to `MAX_PROMPT_INSIGHTS` (10). So an array whose
 *  order was meant to bury the target does nothing, and an array longer than 10
 *  drops entries — which for the target is a probe that silently measures
 *  nothing. The target is `low`, the competitor `medium`, these are `high`, and
 *  the total stays at 6. */
const INSIGHT_FILLER = [
  { type: "overdueTrend", data: { current: 14, delta: 5, prior: 9 } },
  { type: "stalledWork", data: { count: 7 } },
  { type: "budgetVariance", data: { name: "Integration", variancePct: 12, buckets: 4 } },
  { type: "raidAging", data: { name: "Vendor SLA gap", daysSinceUpdate: 21 } },
  { type: "milestoneSlip", data: { name: "Pilot cutover", daysOverdue: 3 } },
];

/** The near-miss conversations the composition probe must NOT return. Neither
 *  title is about the budget view, which is what makes the answer unique. */
const CHAT_ALT_TITLES = ["Resource levelling review", "Milestone re-forecast"];

/** The snapshot both prompt builders take.
 *
 *  ★★★ A LITERAL, NOT A DECODED WORKSPACE. `getSnapshot`'s return type is
 *  structural — scalars, string arrays and bounded summaries — so nothing here
 *  needs `jsonToWorkspace`, and therefore nothing needs jsdom. It is also the
 *  only way to get planted tokens to sit at chosen depths inside chosen fields,
 *  which a real decode cannot be made to do.
 *
 *  ★★★ EVERY LABEL AND EVERY PLANTED TOKEN COMES FROM THE PROBE, VIA
 *  `plantLabel`/`priorLabel` — never a literal here, and every switch below
 *  reads `PROBE_HARDENING`. All five blocks said "reference code" until
 *  2026-09-09, and the model answered `chatPointer` with the DATE block's token
 *  on three straight reps because that one sits on the first line of the turn
 *  context. Deriving the block text from the same table the QUESTION is derived
 *  from is what stops the two drifting apart — a mismatch makes the probe
 *  unanswerable while every gate stays green.
 *
 *  ★★ THE HARDENING IS PER-BLOCK BECAUSE THE BLOCKS DIFFER IN WHAT THEY CAN
 *  CARRY. Three of them hold a LIST the app really does fill with several items
 *  (digest lines, insights, recent conversations), so depth there is
 *  representative. `today` and `ActivitySummary.latestAt` are single short
 *  fields the app fills with a date and a timestamp; padding those would make
 *  the block unrepresentative of what the app sends, which is a worse defect
 *  than an easy probe. Those two get the competitor lever only. */
function snapshotFor(tokens: Record<string, string>) {
  const h = PROBE_HARDENING as Record<string, Hardening>;

  // date — competitor only. `today` is a short date field the app fills with a
  // date; there is no list to pad, so `fillerBefore` is structurally inert here.
  const dateField = h.date.competitor
    ? `2026-09-09 (${plantLabel("date")} ${tokens.date}; ${priorLabel("date")} ${tokens.datePrev})`
    : `2026-09-09 (${plantLabel("date")} ${tokens.date})`;

  // viewScope — depth then competitor. The PREVIOUS code is written first so
  // the target is not the first code the model meets in the block.
  const digestLines = [...VIEW_DIGEST_FILLER.slice(0, h.viewScope.fillerBefore)];
  digestLines.push(
    h.viewScope.competitor
      ? `The ${priorLabel("viewScope")} was ${tokens.viewScopePrev}; the ${plantLabel("viewScope")} is ${tokens.viewScope}.`
      : `The ${plantLabel("viewScope")} is ${tokens.viewScope}.`,
  );

  // insights — depth then competitor. See INSIGHT_FILLER on why severity, not
  // array order, decides what the model reads first.
  const insights: Record<string, unknown>[] = INSIGHT_FILLER
    .slice(0, h.insights.fillerBefore)
    .map((f, i) => ({
      id: 100 + i, key: `eval-filler-${i}`, type: f.type, severity: "high",
      data: f.data, status: "active", firstSeenAt: "2026-09-01T08:00:00Z",
      lastSeenAt: "2026-09-08T08:00:00Z", occurrences: 2,
    }));
  if (h.insights.competitor) {
    insights.push({
      id: 200, key: "eval-probe-prev", type: "milestoneSlip", severity: "medium",
      data: { name: `Design freeze (${priorLabel("insights")} ${tokens.insightsPrev})`, daysOverdue: 11 },
      status: "active", firstSeenAt: "2026-08-20T08:00:00Z",
      lastSeenAt: "2026-09-08T08:00:00Z", occurrences: 4,
    });
  }
  // ★★ The token rides `data.name`, which `factLine` interpolates for a
  //    `milestoneSlip`. `status` must be one of `insight-prompt.ts`'s
  //    SURFACED_STATUSES or the whole block is dropped and the probe
  //    silently measures nothing.
  insights.push({
    id: 201, key: "eval-probe", type: "milestoneSlip", severity: "low",
    data: { name: `Phase gate (${plantLabel("insights")} ${tokens.insights})`, daysOverdue: 6 },
    status: "active", firstSeenAt: "2026-09-01T08:00:00Z",
    lastSeenAt: "2026-09-08T08:00:00Z", occurrences: 3,
  });

  // chatPointer — composition. The block lists several conversations, each with
  // its own transcript code, and only ONE is about the view the VIEW SCOPE
  // block says the user is on. The answer is unique; reaching it needs both
  // blocks. `fillerBefore` is capped by COMPOSITION_ALT_IDS and the CLI refuses
  // at pre-flight rather than silently listing fewer near-misses than asked.
  const recent = h.chatPointer.composition
    ? [
        ...CHAT_ALT_TITLES.slice(0, h.chatPointer.fillerBefore).map((title, i) => ({
          title: `${title} (${plantLabel("chatPointer")} ${tokens[COMPOSITION_ALT_IDS[i]]})`,
          at: `2026-09-0${2 + i}`,
        })),
        {
          title: `Budget rebaseline (${plantLabel("chatPointer")} ${tokens.chatPointer})`,
          at: "2026-09-07",
        },
      ]
    : [
        // ★ Depth WITHOUT the composition confound: code-free earlier
        //   conversations, so the block still looks like the list the app
        //   really sends and the target is not its only entry, while the
        //   question stays a plain one-hop lookup for the one labelled code.
        ...CHAT_ALT_TITLES.slice(0, h.chatPointer.fillerBefore).map((title, i) => ({
          title, at: `2026-09-0${2 + i}`,
        })),
        {
          title: `Budget rebaseline (${plantLabel("chatPointer")} ${tokens.chatPointer})`,
          at: "2026-09-07",
        },
      ];

  // activityRecap — competitor only. `latestAt` is the block's one free-text
  // slot; the rest of the sentence is generated from counts, so there is
  // nothing to pad and `fillerBefore` is structurally inert here too.
  const latestAt = h.activityRecap.competitor
    ? `logged under ${plantLabel("activityRecap")} ${tokens.activityRecap} (the ${priorLabel("activityRecap")} was ${tokens.activityRecapPrev})`
    : `${plantLabel("activityRecap")} ${tokens.activityRecap}`;

  return {
    today: dateField,
    language: "en-US",
    holidayCountries: ["DE"],
    storageKind: "file",
    taskCount: 140,
    knownGroups: ["Discovery", "Build", "Rollout"],
    knownLabels: ["blocked", "risk"],
    mode: "expert",
    enabledModules: [],
    currentView: "budget",
    insights,
    viewDigest: digestLines.join("\n"),
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
      latestAt, days: 7,
    },
    // ★ `inlineTitle` collapses whitespace and strips double quotes; the
    //   tokens are bare syllables, so they survive it unchanged.
    chatPointer: { count: recent.length + 1, recent },
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

/** Whether arm B is still a byte-alias of arm A.
 *
 *  ★★★ FLIP THIS IN THE SAME EDIT AS `CANDIDATE_VARIANT`, NEVER SEPARATELY.
 *  Pre-flight checks BOTH directions against the arms' actual bytes, so a stale
 *  value fails whichever way it is stale: `true` with differing arms says a
 *  variant was registered and this flag was forgotten, `false` with identical
 *  arms says the candidate did not relocate anything. There is no way to leave
 *  it wrong and still spend money.
 *
 *  ★★★ WHY A FLAG AND NOT `CANDIDATE_VARIANT !== "current"`: that comparison is
 *  a TS2367 error today, because `assembleArm`'s `variant` parameter is typed as
 *  the literal `"current"` and the comparison narrows to `never`. Nothing here
 *  typechecks in CI (`tsconfig.json` excludes `scripts/`), so the error would
 *  surface only to whoever next ran tsc by hand — which is worse than an
 *  explicit flag, not better.
 *
 *  ★★★ WHY THE CHECK EXISTS AT ALL. Without it, the moment a slice registers a
 *  real variant, "the variant moved the block" and "the variant is a silent
 *  no-op" produce IDENTICAL green output: a PASS over a layout compared with
 *  itself, which is the single outcome this harness exists to make impossible.
 *  `preflight`'s own docstring concedes it cannot prove relocation when both
 *  arms declare the same half — this is the check that forces them to differ. */
const ARMS_ARE_ALIAS = true;

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
  /** The API's own `stop_reason`. `"max_tokens"` means the reply was TRUNCATED
   *  and whatever it scored is a fact about the cap, not about the model. */
  stopReason: string;
  /** A census of the content-block TYPES the API returned — types and counts
   *  only, never their content. A reply that produced no text is then
   *  self-explaining in the artifact instead of needing another spend. */
  blockTypes: Record<string, number>;
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
      // ★ BOUNDED. This reaches the terminal via the run's catch, and an
      //   error body is an untrusted response of unbounded length. Anthropic's
      //   error envelopes do not echo the auth header, so this is not a leak —
      //   bounded anyway, because "the remote decides how many bytes land on
      //   your screen" is not a property worth keeping.
      const detail = (await res.text()).slice(0, 500);
      throw new Error(`anthropic ${res.status}: ${detail}`);
    }
    const body = await res.json() as {
      content?: { type: string; text?: string }[];
      stop_reason?: string;
      usage?: Partial<ApiUsage>;
    };
    const blocks = Array.isArray(body.content) ? body.content : [];
    // ★★★ THE CENSUS, RECORDED WHATEVER HAPPENED. The 2026-09-09 sweep produced
    //     three replies with empty text, zero tool uses and exactly the output
    //     cap, and nothing recorded could say what the response carried
    //     instead — a `thinking` block is the obvious candidate for a reasoning
    //     model, but that is a HYPOTHESIS and this census is what settles it on
    //     the next run rather than another round of reading the code. Types and
    //     counts only: block CONTENT is not captured here or anywhere.
    const blockTypes: Record<string, number> = {};
    for (const b of blocks) {
      const t = typeof b?.type === "string" ? b.type : "(untyped)";
      blockTypes[t] = (blockTypes[t] ?? 0) + 1;
    }
    if (blocks.length === 0) blockTypes["(no blocks)"] = 1;
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
      stopReason: typeof body.stop_reason === "string" ? body.stop_reason : "(absent)",
      blockTypes,
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
  //     cents rather than the full 65, and everything downstream treats a
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

  // ★★★ THE ONE ENV INPUT THAT WAS UNVALIDATED, and the failure was silent
  //     rather than loud: `AI_EVAL_SALT=not-a-number` yielded NaN, and
  //     `plantedToken` is happy to mint from NaN — a stable, valid, UNRECORDED
  //     token universe (`plantedToken("date", NaN)` = "murkkeshphadkesh"),
  //     which then serialised into the run record as `"salt": null`, i.e. a
  //     recorded run nobody can ever reproduce.
  //
  //     ★★★ AND THE DIGIT REGEX ALONE DOES NOT CLOSE IT — the first cut of this
  //     guard let the very defect described above back in through the guard
  //     written to stop it. A salt of 309 or more digits satisfies `\d+`,
  //     `Number` returns Infinity, and `Infinity < 1` is FALSE, so it was
  //     ACCEPTED: `plantedToken` is as happy to mint from Infinity as from NaN,
  //     and the record again reads `"salt": null`, because
  //     `JSON.stringify({salt: Infinity})` is `{"salt":null}`. Hence
  //     `Number.isSafeInteger`, which is the property the record actually
  //     needs — a salt that does not survive a JSON round-trip cannot be
  //     reproduced from the run that recorded it.
  //
  //     ★★ THIS IS NOT THE BOUND `parseFilter` PUTS ON REPS, and saying so was
  //     the error this comment used to make. `parseFilter` bounds BOTH ends
  //     (`reps < 1 || reps > MAX_FILTER_REPS`) because reps drives SPEND, so
  //     its upper bound is a DOMAIN maximum protecting the wallet — catching
  //     Infinity is a side effect of that, not its purpose. Salt has no spend
  //     dimension: a run costs the same at every salt, so there is no domain
  //     maximum to impose and the only upper bound salt needs is
  //     representability.
  const rawSalt = (env.AI_EVAL_SALT ?? "1").trim();
  const saltValue = Number(rawSalt);
  if (!/^\d+$/.test(rawSalt) || !Number.isSafeInteger(saltValue) || saltValue < 1) {
    console.error(
      `invalid AI_EVAL_SALT — spending nothing: must be a whole number of at least 1, got ${JSON.stringify(env.AI_EVAL_SALT ?? "")}`,
    );
    return EXIT.UNUSABLE;
  }
  const salt = saltValue;
  // ★★ The anchor pair is minted from `ANCHOR_SPEC.salt`, NOT from the run
  //    salt — see that field for why rotating `AI_EVAL_SALT` used to trip the
  //    anchor-hash guard and make the documented collision repair unusable.
  const anchorTarget = plantedToken("anchor", ANCHOR_SPEC.salt);
  const anchorDecoy = plantedToken("anchorDecoy", ANCHOR_SPEC.salt);
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
  // ★★★ THE DRIFT REFERENCE MUST BE COMPARED AGAINST WHAT THE LAST RUN WROTE,
  //     NEVER AGAINST WHAT IT READ, and this was wrong until 2026-09-09. A run
  //     records `rollingHash` = the hash of the file it READ at start, then
  //     OVERWRITES that file — so the next run reads different bytes and
  //     `preflight` reported "the stored drift reference is not what the last
  //     run wrote" on every run following a prompt change. It could only ever
  //     pass while the prompt was unchanged, i.e. in exactly the case where the
  //     check had nothing to catch. Measured: the committed rolling file hashes
  //     to ca4466cd… while the last recorded run carries ab7cea71…, so the next
  //     run would have refused to spend at all. `rollingWrittenHash` (below) is
  //     what a run stores when it WRITES, and the reference is the most recent
  //     non-null one — a run that did not write must not blank the reference
  //     the run before it left. Runs recorded before this field existed carry
  //     none, so the check simply stays quiet until a run writes one.
  //
  //     ★★★ THE SALT TRAVELS WITH THE HASH, FOR THE SAME REASON. The rolling
  //     file was written by the run that carries the reference hash, so it holds
  //     THAT run's tokens — not the last recorded run's, and not today's. The
  //     replay used to read `last.salt`, which applied the "compare against what
  //     the last run WROTE" lesson to the hash and not to the salt sitting
  //     beside it. Latent while every recorded run is salt 1; live the moment
  //     anyone rotates `AI_EVAL_SALT`, at which point the replay would be scored
  //     against tokens that are not in the file and read as total drift.
  const writtenRolling = recorded.runs
    .filter((r): r is Record<string, unknown> & { rollingWrittenHash: string } =>
      typeof (r as { rollingWrittenHash?: unknown }).rollingWrittenHash === "string")
    .map((r) => ({
      hash: r.rollingWrittenHash,
      salt: typeof r.salt === "number" ? r.salt : null,
    }));
  const rollingRef = writtenRolling.length > 0
    ? writtenRolling[writtenRolling.length - 1]
    : null;
  const recordedRollingHash = rollingRef?.hash ?? null;

  // ★ ONE token map for the whole run. It was rebuilt per probe and again for
  //   the size print; `plantedToken` is deterministic so every copy was
  //   identical, but three copies of a map the pre-flight, the live arms and
  //   the rolling write all key off is three chances for them to disagree.
  const tokens: Record<string, string> = {};
  // ★★ Keyed off `plantedProbeIds`, NOT off PROBES: hardening plants near-miss
  //    competitors and composition alternatives beside the five targets, and a
  //    map built from PROBES alone renders them as the literal "undefined".
  for (const id of plantedProbeIds()) tokens[id] = plantedToken(id, salt);

  // ★ Pre-flight covers the ACTIVE probes only. Asserting an unselected probe
  //   is free, but a failure in one would abort the very diagnostic run whose
  //   whole point is investigating a different probe.
  const failures: string[] = [];
  // ★★★ NO PLANTED TOKEN MAY CONTAIN ANOTHER. `scoreResponse` now matches by
  //     substring across the WHOLE planted set, so one containment would score
  //     every correct answer "ambiguous" — silently, on every arm, forever. The
  //     repair is to rotate AI_EVAL_SALT; it is deliberately NOT a change to
  //     how tokens are minted, because a re-mint at the same salt would make
  //     the rolling replay miss every time and read as catastrophic drift.
  //     ★★ THAT REPAIR IS ONLY EXECUTABLE BECAUSE THE ANCHOR PAIR NO LONGER
  //     RIDES THIS SALT. While it did, rotating tripped the anchor-hash guard
  //     and exited 2 — the fix worked on a first run and nowhere else. The one
  //     collision rotation cannot repair is anchor-against-anchorDecoy, which
  //     is fixed at `ANCHOR_SPEC.salt` and would be a new anchor series.
  for (const c of tokenSubstringConflicts({ ...tokens, anchor: anchorTarget, anchorDecoy })) {
    failures.push(`planted tokens collide at salt ${salt}: ${c} — rotate AI_EVAL_SALT`);
  }

  // ★★★ COMPOSITION IS IMPLEMENTED FOR ONE BLOCK ONLY. `PROBE_HARDENING` is a
  //     table anyone can edit, and switching `composition` on for a probe whose
  //     block has no list to select from would ask a question with no answer —
  //     which is indistinguishable from a regression. Refuse instead.
  const composedId = compositionProbeId();
  if (composedId !== null && composedId !== "chatPointer") {
    failures.push(
      `PROBE_HARDENING: composition is only implemented for chatPointer, not ${composedId} — that block has no list of candidates to select from, so the question would have no answer`,
    );
  }
  if (composedId !== null
    && (PROBE_HARDENING as Record<string, { fillerBefore: number }>)[composedId].fillerBefore
      > COMPOSITION_ALT_IDS.length) {
    failures.push(
      `PROBE_HARDENING.${composedId}.fillerBefore exceeds the ${COMPOSITION_ALT_IDS.length} near-miss ids COMPOSITION_ALT_IDS declares — add ids to TOKEN_IDS first`,
    );
  }

  // ★★★ A `fillerBefore` ABOVE ITS ARRAY'S LENGTH SILENTLY CLAMPS. Every
  //     composition path is `ARRAY.slice(0, fillerBefore)`, and `slice` is happy
  //     to be asked for more than it has — so `fillerBefore: 9` on `viewScope`
  //     produces the same four lines as `4`, and `PROBE_HARDENING`'s docstring
  //     promise that "a knob and the prompt it governs cannot drift apart" is
  //     quietly false. The COMPOSITION path above was guarded; these three were
  //     not, which is the same defect one branch over.
  //     ★ `date` and `activityRecap` are deliberately absent: neither block has
  //     a list to pad, their `fillerBefore` is documented as structurally inert
  //     at its declaration, and both sit at 0.
  const fillerCaps: [string, number][] = [
    ["viewScope", VIEW_DIGEST_FILLER.length],
    ["insights", INSIGHT_FILLER.length],
    ["chatPointer", CHAT_ALT_TITLES.length],
  ];
  for (const [id, cap] of fillerCaps) {
    const want = (PROBE_HARDENING as Record<string, { fillerBefore: number }>)[id].fillerBefore;
    if (want > cap) {
      failures.push(
        `PROBE_HARDENING.${id}.fillerBefore is ${want} but only ${cap} filler entries exist — the slice would silently clamp and the block would be shallower than the knob claims`,
      );
    }
  }
  // ★★ RUN-LEVEL, SO IT RUNS ONCE — NOT INSIDE THE PROBE LOOP. Both references
  //    are probe-independent; checking them per probe printed the same mismatch
  //    five times and buried the per-probe failures under it.
  const drift = driftReferenceCheck({
    anchorHash,
    recordedAnchorHash: last?.anchorHash ?? anchorHash,
    rollingHash,
    recordedRollingHash,
  });
  if (!drift.ok) failures.push(...drift.failures);

  for (const probe of activeProbes) {
    const armA = flatten(assembleArm("current", tokens, probe.question), "turn");
    const armB = flatten(assembleCandidate(tokens, probe.question), "turn");

    // ★★★ ARM B MUST BE PROVABLY THE ARM `ARMS_ARE_ALIAS` SAYS IT IS. Both
    //     directions fail here, at PRE-FLIGHT, before a cent is spent — see the
    //     flag's own docstring for why either direction is silent otherwise.
    const armAWhole = `${armA.system}\n${armA.turn}`;
    const armBWhole = `${armB.system}\n${armB.turn}`;
    const armsIdentical = armAWhole === armBWhole;
    if (ARMS_ARE_ALIAS && !armsIdentical) {
      failures.push(
        `${probe.id}: ARMS_ARE_ALIAS is true but arm B differs from arm A — a variant was registered without flipping ARMS_ARE_ALIAS beside CANDIDATE_VARIANT`,
      );
    }
    if (!ARMS_ARE_ALIAS && armsIdentical) {
      failures.push(
        `${probe.id}: ARMS_ARE_ALIAS is false but arm B is byte-identical to arm A — the candidate variant ${CANDIDATE_VARIANT} did not relocate anything`,
      );
    }
    // ★★★ THIS IS WHAT MAKES THE ABOVE MORE THAN A BYTE COMPARISON. A variant
    //     can differ in bytes for a reason that is not a relocation at all (a
    //     reordered field, a reworded label) while the probed block never
    //     changed half — and `preflight`'s position assertions cannot tell,
    //     because they only ever check each arm against its OWN declaration.
    //     Requiring the two declared halves to differ is what forces those
    //     assertions to prove the move.
    if (!ARMS_ARE_ALIAS && armA.expectedHalf === armB.expectedHalf) {
      failures.push(
        `${probe.id}: both arms declare the ${armA.expectedHalf} half — relocation is proven only when the declared halves differ, so a candidate must declare the other one`,
      );
    }

    // ★★★ ARM X IS PRE-FLIGHTED HERE AND DELIBERATELY NOT THROUGH `preflight`.
    //     `preflight` asserts the target appears EXACTLY ONCE per arm; arm X is
    //     the arm whose target was removed, so handing it over would fail every
    //     probe by construction and the only way to make it pass would be to
    //     weaken the check for A and B too. The control still needs asserting —
    //     a strip that silently stopped stripping gives a control identical to
    //     arm A, which then scores high, and `verdict` calls the probe void
    //     AFTER the money is spent. So: zero targets, and the decoy untouched.
    // ★★★ EVERY PLANTED TOKEN, EXACTLY ONCE — not merely the target and the
    //     decoy. Hardening plants near-miss competitors and composition
    //     alternatives beside them, and a competitor that silently failed to
    //     land would turn a hardened probe back into an easy one with every
    //     gate still green. `plantedProbeIds` is derived from the same knobs
    //     the block text is, so this cannot go stale when one is turned off.
    const armAText = `${armA.system}
${armA.turn}`;
    for (const id of plantedProbeIds()) {
      const n = occurrences(armAText, tokens[id]);
      if (n !== 1) {
        failures.push(`${probe.id}: planted token ${id} appears ${n} times in arm A, expected exactly 1`);
      }
    }

    const controlText = wholeOf(assembleControl(tokens, probe.id, probe.question));
    const targetInControl = occurrences(controlText, tokens[probe.id]);
    if (targetInControl !== 0) {
      failures.push(
        `${probe.id}: the negative control still carries the target ${targetInControl} time(s) — the strip did not strip`,
      );
    }
    // The strip must remove the TARGET and only the target: every other planted
    // token — the decoy, the near-miss competitors, the composition
    // alternatives — has to survive, or the control stops being arm A minus one
    // thing and starts being a different prompt.
    for (const id of plantedProbeIds()) {
      if (id === probe.id) continue;
      const n = occurrences(controlText, tokens[id]);
      if (n !== 1) {
        failures.push(
          `${probe.id}: the negative control must keep ${id} exactly once, found ${n} — the strip must remove the target and nothing else`,
        );
      }
    }

    const res = preflight({
      target: tokens[probe.id],
      decoy: tokens[probe.distractorBlock],
      armPrompts: { A: armA, B: armB },
      // ★ The two drift references are NOT passed: they are run-level and are
      //   checked once, above, by `driftReferenceCheck`.
      // ★★ NOTHING IS SUPPRESSED HERE. Both arms declare "turn" and both
      //    position assertions run and hold. That is honest for an A/A
      //    self-test — arm B is a deliberate alias of arm A until a gated slice
      //    registers a variant, so there is genuinely no relocation to prove.
      //    A real candidate declares the OTHER half for its arm and `preflight`
      //    then proves the block moved. There is no flag to drop here —
      //    `ARMS_ARE_ALIAS` above is not a suppression, it is the assertion
      //    that the two arms are what the flag claims, and it is what forces a
      //    candidate to declare the other half so these assertions bite.
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

  type Scored = Reply & { outcome: string; otherBlocks: string[] };
  const perProbeReplies: Record<string, { A: Scored[]; B: Scored[]; X: Scored[] }> = {};
  const driftReplies: { R: Scored[]; N: Scored[] } = { R: [], N: [] };
  let complete = true;

  // ★★★ THE SCORER GETS THE WHOLE PLANTED SET, not this probe's designated
  //     decoy. With one decoy, a reply carrying a THIRD probe's token scored
  //     "absent" — and that is exactly what happened: the first full run
  //     reported `wrongBlock: 0` everywhere while the model was answering
  //     `chatPointer` with the DATE block's token. `otherBlocks` then names
  //     which block it reached, which is the whole diagnostic value.
  const probeTokens = { ...tokens };
  // The anchor is a DIFFERENT prompt with its own two planted tokens; handing
  // it the probe set would be harmless but dishonest — it plants none of them.
  const anchorTokens = { anchor: anchorTarget, anchorDecoy };

  const send = async (
    arm: Arm, target: string, tokenSet: Record<string, string>,
  ): Promise<Scored> => {
    const reply = await request(arm.system, arm.messages);
    // ★★ The outcome is attached HERE, not recomputed later. gradeArm's
    //    wrongBlock axis reads `outcome` and its tally reads `otherBlocks`;
    //    handing it a bare reply silently reports zero wrong-block hits on
    //    every run.
    // The WHOLE reply, not its text: a miss cannot name its cause without the
    // tool count and the stop reason, and `scoreResponse` refuses less.
    const scored = scoreResponse(reply, target, tokenSet) as
      { outcome: string; otherBlocks: string[] };
    return { ...reply, outcome: scored.outcome, otherBlocks: scored.otherBlocks };
  };

  // ★★★ INTERLEAVED BY (probe, rep, arm). Running an arm to completion before
  //    starting the next lets any drift within the run land entirely on
  //    whichever went last, which is indistinguishable from a regression.
  try {
    for (const probe of activeProbes) {
      perProbeReplies[probe.id] = { A: [], B: [], X: [] };
      const target = tokens[probe.id];
      for (let rep = 0; rep < reps; rep += 1) {
        if (armWanted("A")) {
          perProbeReplies[probe.id].A.push(
            await send(assembleArm("current", tokens, probe.question), target, probeTokens),
          );
        }
        if (armWanted("B")) {
          perProbeReplies[probe.id].B.push(
            await send(assembleCandidate(tokens, probe.question), target, probeTokens),
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
          await send(assembleControl(tokens, probe.id, probe.question), target, probeTokens),
        );
      }
    }

    for (let rep = 0; rep < reps; rep += 1) {
      if (armWanted("N")) {
        driftReplies.N.push(
          await send(assembleAnchor(anchorPrompt, ANCHOR_QUESTION), anchorTarget, anchorTokens),
        );
      }
      if (plan.R > 0 && rollingText !== null) {
        // The stored bytes carry the SALT of the run that WROTE them, so the
        // replay is scored against that run's tokens — never today's, and never
        // the last RECORDED run's, which need not be the one that wrote the
        // file. See `rollingRef` for the measurement behind that distinction.
        const replaySalt = rollingRef?.salt ?? salt;
        const rTarget = plantedToken(PROBES[0].id, replaySalt);
        // The whole set at THAT salt, for the same reason the probe arms get
        // the whole set at today's: a replay that returned another block's
        // token would otherwise be recorded as having returned nothing.
        const replayTokens: Record<string, string> = {};
        for (const p of PROBES) replayTokens[p.id] = plantedToken(p.id, replaySalt);
        driftReplies.R.push(await send(assembleReplay(rollingText), rTarget, replayTokens));
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

  // ★★★ THE CENSUS — what was DISPATCHED against what came back, and that is
  //     its exact scope. `verdict` refuses a run that measured NOTHING and
  //     refuses a probe whose arm is not a finite number, but it is handed
  //     `perProbe` and cannot know how many replies each row should have held:
  //     a dispatch that threw partway leaves a short row that is otherwise
  //     well-formed, and passes. Only this file holds `plan`, so only this file
  //     can catch that. Anything short forces `complete: false`, which `verdict`
  //     turns into UNUSABLE — never REGRESSION, because a run that did not
  //     happen says nothing about the candidate.
  //
  //     ★★★ IT CANNOT CATCH A SHORTFALL IN THE PLAN ITSELF, and this comment
  //     claimed for a release that it could ("a run that silently dropped three
  //     of five probes"). `plan`, the census loop and `requests` all derive from
  //     `activeProbes`/`reps`/`armWanted` — the same values that drive dispatch
  //     — so a run that dropped three probes shrinks the plan with them and
  //     every comparison below still passes. It is self-referential on that
  //     axis. A shrunken plan is caught instead by the CONSTANTS check
  //     immediately below (an unfiltered run must be the fixed standard run)
  //     and, for a deliberately narrowed run, by `verdict`'s filter guard,
  //     which refuses to report PASS at all.
  //
  // ★ STRUCTURALLY UNFALSIFIABLE TODAY, and kept anyway: every `Scored` in
  //   these arrays was built by `send`, which always attaches a string
  //   `outcome`, so this can only fire against a future push site that bypasses
  //   `send`. Cheap, and the alternative is trusting that no such site is ever
  //   added. Do not read a green run as this having checked anything.
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
  // ★★★ THE PLAN AGAINST THE CONSTANTS, NOT AGAINST ITSELF. This is the half
  //     every check above is structurally blind to, for the reason the census
  //     comment gives. `filter === null` is the standard run and the ONLY shape
  //     allowed to report PASS, so it must be the whole fixed run and nothing
  //     less; a narrowed run is already poison to `verdict` either way.
  if (filter === null) {
    const wanted = `${PROBES.length} probes, reps ${REPS}, A ${REPS}/B ${REPS}/X 1`;
    const planned = `${activeProbes.length} probes, reps ${reps}, A ${plan.A}/B ${plan.B}/X ${plan.X}`;
    if (
      activeProbes.length !== PROBES.length
      || reps !== REPS
      || plan.A !== REPS
      || plan.B !== REPS
      || plan.X !== 1
    ) {
      census.push(
        `unfiltered run planned ${planned}, but the standard run is ${wanted} — the plan itself fell short, which every per-arm check above is blind to`,
      );
    }
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
  //     looks like without storing every one. The first live run recorded scores
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
    probe: string; arm: string; rep: number; outcome: string;
    otherBlocks: string[]; stopReason: string; blockTypes: Record<string, number>;
    text: string;
  }[] = [];
  const exemplarTaken = new Set<string>();
  const collect = (probeId: string, arm: string, rs: Scored[]) => {
    rs.forEach((r, rep) => {
      const key = `${probeId}:${arm}`;
      const isExemplar = r.outcome === "hit" && !exemplarTaken.has(key);
      if (r.outcome !== "hit" || isExemplar) {
        if (isExemplar) exemplarTaken.add(key);
        samples.push({
          probe: probeId, arm, rep, outcome: r.outcome,
          // WHICH block it reached instead. The text alone shows the token; the
          // id is what makes a run's failure readable at a glance.
          otherBlocks: r.otherBlocks ?? [],
          // Why this reply looks the way it does. A `max_tokens` stop with no
          // text block is a truncation, not a miss, and reading it as a miss is
          // how a capped probe gets mistaken for an unreachable block.
          stopReason: r.stopReason ?? "(unrecorded)",
          blockTypes: r.blockTypes ?? {},
          text: truncate(r.text),
        });
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

  // ★ Decided and hashed BEFORE the record is built, because the record has to
  //   carry the hash of what this run wrote for the NEXT run to compare against.
  const willWriteRolling = shouldWriteRolling({
    mode: decision.mode, complete, filtered: filter !== null,
  });
  const rollingBytes = willWriteRolling
    ? JSON.stringify(flatten(assembleArm("current", tokens, PROBES[0].question), "turn"))
    : null;

  // ★★ RUN-LEVEL CENSUS, over EVERY reply — not only the sampled ones. Samples
  //    keep all non-hits plus one exemplar hit, so a truncation that struck the
  //    unsampled hits would otherwise leave no trace at all.
  const allReplies: Scored[] = [
    ...activeProbes.flatMap((p) => [
      ...(perProbeReplies[p.id]?.A ?? []),
      ...(perProbeReplies[p.id]?.B ?? []),
      ...(perProbeReplies[p.id]?.X ?? []),
    ]),
    ...driftReplies.N, ...driftReplies.R,
  ];
  const stopReasons: Record<string, number> = {};
  const blockTypeCensus: Record<string, number> = {};
  for (const r of allReplies) {
    const sr = r.stopReason ?? "(unrecorded)";
    stopReasons[sr] = (stopReasons[sr] ?? 0) + 1;
    for (const [t, n] of Object.entries(r.blockTypes ?? {})) {
      blockTypeCensus[t] = (blockTypeCensus[t] ?? 0) + n;
    }
  }
  const responseShape = { stopReasons, blockTypes: blockTypeCensus };
  // ★★★ WHICH PROBES AND ARMS WERE INSTRUMENT-LIMITED, at the top of the
  //     record. A truncated reply scores a miss whatever the model found, so a
  //     run carrying any is partly measuring its own cap — and that must be
  //     readable from the record's shape rather than reconstructed by hunting
  //     through `samples`. Always emitted, `replies: 0` on a clean run: an
  //     absent field must never be mistakable for a zero.
  const truncatedProbes = new Set<string>();
  const truncatedArms = new Set<string>();
  for (const p of activeProbes) {
    for (const arm of ["A", "B", "X"] as const) {
      for (const r of perProbeReplies[p.id]?.[arm] ?? []) {
        if (r.outcome === "truncated" || r.stopReason === "max_tokens") {
          truncatedProbes.add(p.id);
          truncatedArms.add(arm);
        }
      }
    }
  }
  for (const [arm, rs] of [["N", driftReplies.N], ["R", driftReplies.R]] as const) {
    for (const r of rs) {
      if (r.outcome === "truncated" || r.stopReason === "max_tokens") {
        truncatedProbes.add(arm === "N" ? "anchor" : "rolling");
        truncatedArms.add(arm);
      }
    }
  }
  const truncation = {
    replies: allReplies.filter((r) => r.stopReason === "max_tokens").length,
    ofReplies: allReplies.length,
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    probes: [...truncatedProbes].sort(),
    arms: [...truncatedArms].sort(),
  };
  // ★ Loud in the TERMINAL too, not only in the artifact: a truncated reply
  //   scores `absent` whatever the model found, so a run carrying one is
  //   measuring the cap on that probe and the operator should know before
  //   reading a single rate.
  const truncated = stopReasons["max_tokens"] ?? 0;
  if (truncated > 0) {
    console.error(
      `WARNING: ${truncated} of ${allReplies.length} replies stopped at max_tokens (${MAX_OUTPUT_TOKENS}) — those scores measure the cap, not the model`,
    );
  }

  const firstA = activeProbes.length > 0
    ? perProbeReplies[activeProbes[0].id]?.A[0] ?? null
    : null;
  const record = buildRunRecord({
    date: new Date().toISOString().slice(0, 10),
    model: MODEL,
    gitSha: env.GIT_SHA ?? "unrecorded",
    anchorHash,
    rollingHash,
    rollingWrittenHash: rollingBytes === null ? null : sha256(rollingBytes),
    anchorSpec: ANCHOR_SPEC,
    reps,
    maxOutputTokens: MAX_OUTPUT_TOKENS,
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
    responseShape,
    truncation,
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

  if (rollingBytes !== null) {
    // ★★ Written from THIS run's arm A, and only because the run completed and
    //    was unfiltered. An incomplete run leaves the file alone: overwriting
    //    from a run nobody scored poisons the reference invisibly, and the NEXT
    //    run then compares against garbage and reports no drift.
    deps.writeArtifact(ROLLING_PATH, rollingBytes);
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
