// scripts/ai-eval.ts — the AI prompt-quality harness CLI (slice H).
//
// I/O ONLY. Every decision lives in scripts/ai-eval-lib.mjs so it can be tested
// without a key. Run under vite-node:  npx vite-node scripts/ai-eval.ts
//
// ★★ Dry run is the default and spends nothing. Live runs need AI_EVAL_SPEND
//    set and refuse outright under CI.
import { readFileSync, existsSync } from "node:fs";
import {
  buildStableSystemBlocks,
  buildTurnContext,
  toolsFor,
} from "../src/app/chat-api";
import { buildWireMessages } from "../src/app/chat-cache-layout";
import { builtinSeeds } from "../src/app/use-operating-guides";
import type { ApiMessage, SystemBlock } from "../src/app/chat-api";
import {
  EXIT, PROBES, plantedToken, sha256, ANCHOR_SPEC, buildAnchorPrompt,
  preflight, spendDecision,
} from "./ai-eval-lib.mjs";

const ROLLING_PATH = "docs/baselines/ai-eval-rolling-prompt.txt";
const RUNS_PATH = "docs/baselines/ai-eval-runs.json";
const REPS = 5;

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

function main(): number {
  const env = process.env;
  const apiKey = env.ANTHROPIC_API_KEY ?? "";
  const decision = spendDecision({ env, hasKey: apiKey.trim().length > 0 });
  if (decision.mode === "refuse") {
    console.error(decision.reason);
    return decision.code;
  }

  const salt = Number(env.AI_EVAL_SALT ?? "1");
  const anchorTarget = plantedToken("anchor", salt);
  const anchorDecoy = plantedToken("anchorDecoy", salt);
  const anchorPrompt = buildAnchorPrompt(ANCHOR_SPEC, anchorTarget, anchorDecoy);
  const anchorHash = sha256(anchorPrompt);

  const rollingExists = existsSync(ROLLING_PATH);
  const rollingText = rollingExists ? readFileSync(ROLLING_PATH, "utf8") : null;
  const rollingHash = rollingText === null ? null : sha256(rollingText);
  const recorded = existsSync(RUNS_PATH)
    ? JSON.parse(readFileSync(RUNS_PATH, "utf8"))
    : { runs: [] };
  const last = recorded.runs[recorded.runs.length - 1] ?? null;

  const failures: string[] = [];
  for (const probe of PROBES) {
    const tokens: Record<string, string> = {};
    for (const p of PROBES) tokens[p.id] = plantedToken(p.id, salt);
    const armA = flatten(assembleArm("current", tokens, probe.question), "turn");
    const armB = armA; // identity until a gated slice registers a variant
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
  // probe-INDEPENDENT single-probe arms measuring drift, so they run REPS times
  // each and never per probe — they inform the artifact, they do not gate.
  const requests =
    (2 * PROBES.length * REPS) + PROBES.length + (rollingExists ? REPS : 0) + REPS;
  console.log(`mode: ${decision.mode}`);
  console.log(`probes: ${PROBES.length}, reps: ${REPS}, planned requests: ${requests}`);
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
  //    for an order-of-magnitude read; a real figure comes from the live run's
  //    own `usage.input_tokens`, which Task 10 records.
  const sizeTokens: Record<string, string> = {};
  for (const p of PROBES) sizeTokens[p.id] = plantedToken(p.id, salt);
  const sizeArm = assembleArm("current", sizeTokens, PROBES[0].question);
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
  console.error("live mode is not implemented yet");
  return EXIT.UNUSABLE;
}

process.exit(main());
