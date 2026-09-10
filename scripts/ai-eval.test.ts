// scripts/ai-eval.test.ts — drives `runEval` through its `EvalDeps` seam.
//
// ★★★ NOTHING TYPECHECKS THIS FILE. `tsconfig.json` excludes `scripts/`, so
//     neither `npx tsc --noEmit` nor `next build` reads it, and vitest never
//     typechecks anything. A type error here is invisible to every gate in the
//     pipeline. Typecheck it by hand after editing:
//
//       npx tsc --noEmit --skipLibCheck --ignoreConfig --target es2017 \
//         --lib dom,dom.iterable,esnext --module esnext --moduleResolution bundler \
//         --allowJs --strict --esModuleInterop --resolveJsonModule --isolatedModules \
//         --jsx react-jsx --types node --allowImportingTsExtensions \
//         scripts/ai-eval.test.ts
//
//     ★ `--ignoreConfig` is LOAD-BEARING and not decoration: without it tsc
//     refuses outright with TS5112 ("tsconfig.json is present but will not be
//     loaded if files are specified on commandline"), which reads like a
//     broken recipe. Every other option is passed explicitly for the same
//     reason — the repo's own tsconfig never applies to this file.
//
// ★★★ THIS SUITE SPENDS NOTHING AND WRITES NOTHING. `request` is a fake, so
//     `liveRequest` is never constructed and no `x-api-key` header is ever
//     built; `env` is a literal object whose "key" is a placeholder string;
//     and `readTextIfExists`/`writeArtifact` are in-memory, so
//     `docs/baselines/*` is neither read nor written. `AI_EVAL_SPEND` appears
//     ONLY inside an injected env object — never on `process.env`.
import { afterAll, beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { ApiMessage, SystemBlock } from "../src/app/chat-api";
import {
  EXIT, PROBES, plantedToken, plantedProbeIds, ANCHOR_SPEC, FILTER_ENV,
  buildAnchorPrompt, sha256,
} from "./ai-eval-lib.mjs";

// ★★★ MUST RUN BEFORE THE IMPORT BELOW. `scripts/ai-eval.ts` self-executes at
//     module scope — `runEval().then((code) => process.exit(code))` — unless
//     AI_EVAL_IMPORT is "1". `vi.hoisted` is the only way to set an env var
//     ahead of a static import; without it the import alone starts a real run
//     and calls `process.exit` out from under the test worker.
const { priorImportFlag } = vi.hoisted(() => {
  const prior = process.env.AI_EVAL_IMPORT;
  process.env.AI_EVAL_IMPORT = "1";
  return { priorImportFlag: prior };
});
import { runEval } from "./ai-eval.ts";

// ★★ Put the worker's env back — but NOT because a leak is reachable today,
//    and the first version of this comment claimed it was. A cold review said
//    vitest reuses worker processes across files, so this write would reach
//    whatever ran next. MEASURED AND REFUTED: vitest 4.1.8 is configured with
//    neither `pool` nor `isolate` in `vitest.config.ts`, so it runs the default
//    `forks` pool at `isolate: true` and every test FILE gets a fresh process.
//    Two probe files in one `--maxWorkers=1` run, the second asserting it could
//    see a var the first planted, failed with "expected undefined to be
//    'planted'". A probe that merely READS the key passes either way — it is
//    vacuous, and it stayed green with this restore deleted.
//    The restore stays because that isolation is a DEFAULT, not a guarantee:
//    `pool: "threads"` shares ONE `process.env` across the entire run, and
//    nothing here pins the pool. Restoring to `undefined` means DELETING the
//    key — assigning the string "undefined" would leak a truthy value.
afterAll(() => {
  if (priorImportFlag === undefined) delete process.env.AI_EVAL_IMPORT;
  else process.env.AI_EVAL_IMPORT = priorImportFlag;
});

/** The two artifact paths `runEval` addresses. Hardcoded because they are not
 *  exported and because asserting on them IS the write-decision test — a
 *  constant imported from the file under test could move with it. */
const RUNS_PATH = "docs/baselines/ai-eval-runs.json";
const ROLLING_PATH = "docs/baselines/ai-eval-rolling-prompt.txt";

/** The default `AI_EVAL_SALT`, i.e. what an env with no salt set resolves to. */
const SALT = 1;

/** The standard run's fixed shape, derived rather than restated: five probes,
 *  five reps of arm A and of arm B, one control, five anchor reps, and no
 *  rolling replay while no rolling reference exists. */
const REPS = 5;
const PER_PROBE_REQUESTS = REPS + REPS + 1;
const STANDARD_REQUESTS = PROBES.length * PER_PROBE_REQUESTS + REPS;

type FakeReply = {
  text: string;
  toolUses: number;
  outputTokens: number;
  inputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  stopReason: string;
  blockTypes: Record<string, number>;
};

type SentArm = { system: string; turn: string; whole: string };

/** A well-formed reply carrying `text`. `scoreResponse` refuses anything less
 *  than the whole shape, so the defaults are real values rather than zeros. */
function reply(text: string, over: Partial<FakeReply> = {}): FakeReply {
  return {
    text,
    toolUses: 0,
    outputTokens: 6,
    inputTokens: 120,
    cacheWriteTokens: 0,
    cacheReadTokens: 30,
    stopReason: "end_turn",
    blockTypes: { text: 1 },
    ...over,
  };
}

/** Count non-overlapping, case-insensitive occurrences — the same comparison
 *  the CLI's own pre-flight makes, so an assertion here and a pre-flight
 *  failure can never disagree about whether a token is present. */
function occurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  return haystack.toLowerCase().split(needle.toLowerCase()).length - 1;
}

/** Which token the arm in front of us is asking for, decided from the QUESTION
 *  the arm carries rather than from dispatch order — an arm whose target was
 *  stripped (arm X) still carries its question, which is exactly what makes the
 *  control observable. Any arm carrying no known probe question is the anchor,
 *  whose pair is minted at `ANCHOR_SPEC.salt` and not at the run salt. */
function askedToken(whole: string): string {
  const probe = PROBES.find((p) => whole.includes(p.question));
  return probe
    ? plantedToken(probe.id, SALT)
    : plantedToken("anchor", ANCHOR_SPEC.salt);
}

/** A live-mode environment that cannot spend a cent: `request` is always
 *  injected, so the key below is never read by anything — `liveRequest` is not
 *  constructed on any path this suite reaches. */
const LIVE_ENV: Record<string, string | undefined> = {
  ANTHROPIC_API_KEY: "placeholder-never-read-request-is-injected",
  AI_EVAL_SPEND: "1",
  GIT_SHA: "test-sha",
};

type HarnessOptions = {
  env?: Record<string, string | undefined>;
  files?: Record<string, string>;
  /** Per-request override, by 0-based dispatch index. Return a reply to
   *  substitute one, throw to simulate a transport failure mid-run, or return
   *  null/undefined to fall through to the default answering model. */
  onRequest?: (index: number, whole: string) => FakeReply | null | undefined;
};

/** Everything `runEval` touches that is not pure assembly, faked, plus the two
 *  observation channels the seam buys: what was DISPATCHED and what was
 *  WRITTEN. */
function harness(opts: HarnessOptions = {}) {
  const sent: SentArm[] = [];
  const writes: { path: string; text: string }[] = [];
  const files: Record<string, string> = { ...(opts.files ?? {}) };

  const deps = {
    env: opts.env ?? LIVE_ENV,
    readTextIfExists: (path: string): string | null => files[path] ?? null,
    writeArtifact: (path: string, text: string): void => {
      writes.push({ path, text });
      files[path] = text;
    },
    request: async (system: SystemBlock[], messages: ApiMessage[]): Promise<FakeReply> => {
      const sys = system.map((b) => b.text).join("\n");
      const turn = JSON.stringify(messages);
      const whole = `${sys}\n${turn}`;
      sent.push({ system: sys, turn, whole });
      const override = opts.onRequest?.(sent.length - 1, whole);
      if (override) return override;
      // The answering model: echo the asked-for token when the prompt still
      // carries it, and say so plainly when it does not. The second branch is
      // what makes the negative control score a real zero rather than an
      // accidental one — the refusal text carries no planted token either.
      const target = askedToken(whole);
      return whole.toLowerCase().includes(target.toLowerCase())
        ? reply(target)
        : reply("no such code appears in the context provided");
    },
  };

  /** The run record this run appended, parsed out of the artifact it wrote. */
  const lastRecord = (): Record<string, unknown> => {
    const written = writes.filter((w) => w.path === RUNS_PATH).pop();
    if (!written) throw new Error("no run record was written");
    const parsed = JSON.parse(written.text) as { runs: Record<string, unknown>[] };
    return parsed.runs[parsed.runs.length - 1];
  };

  return { deps, sent, writes, files, lastRecord };
}

/** stdout/stderr, captured rather than printed: a full run logs a dozen lines
 *  and the suite drives several. Captured, not discarded — two tests assert on
 *  what reached the terminal. */
let out: string[] = [];
let err: string[] = [];

beforeEach(() => {
  out = [];
  err = [];
  vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => { out.push(a.join(" ")); });
  vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => { err.push(a.join(" ")); });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("runEval — dry run", () => {
  it("assembles every arm, passes pre-flight and dispatches nothing when spending is not opted into", async () => {
    // Arrange — no AI_EVAL_SPEND, so `spendDecision` returns "dry".
    const h = harness({ env: {} });

    // Act
    const code = await runEval(h.deps);

    // Assert — pre-flight ran over all five probes and every assertion held.
    // ★★ THIS IS THE `ARMS_ARE_ALIAS` PIN. Arm B is a byte-for-byte alias of
    //    arm A today, so flipping the flag to `false` makes pre-flight push
    //    "arm B is byte-identical to arm A" for every probe and this run
    //    returns UNUSABLE instead. Mutation-proved.
    expect(code).toBe(EXIT.PASS);
    expect(out).toContain("pre-flight OK");
    expect(h.sent).toHaveLength(0);
    expect(h.writes).toHaveLength(0);
  });

  it("refuses before assembling anything when the salt is not a whole number", async () => {
    // Arrange
    const h = harness({ env: { ...LIVE_ENV, AI_EVAL_SALT: "not-a-number" } });

    // Act
    const code = await runEval(h.deps);

    // Assert — an unparseable salt mints a stable but unrecordable token
    // universe, so it is refused rather than coerced.
    expect(code).toBe(EXIT.UNUSABLE);
    expect(h.sent).toHaveLength(0);
    expect(h.writes).toHaveLength(0);
    expect(err.join("\n")).toContain("invalid AI_EVAL_SALT");
  });

  it("refuses a salt of zero — the lower bound is 1, and 0 is on the wrong side of it", async () => {
    // Arrange
    const h = harness({ env: { ...LIVE_ENV, AI_EVAL_SALT: "0" } });

    // Act
    const code = await runEval(h.deps);

    // Assert — ★★ MUTATION-PROVED against `Number(rawSalt) < 0`, an off-by-one
    //    that no other test in this file can see: salt 0 is then accepted, no
    //    "invalid AI_EVAL_SALT" line is printed and the run dispatches the
    //    whole standard plan. The existing "not-a-number" test cannot catch it
    //    because the regex rejects that input before the range is consulted.
    expect(code).toBe(EXIT.UNUSABLE);
    expect(h.sent).toHaveLength(0);
    expect(h.writes).toHaveLength(0);
    expect(err.join("\n")).toContain("invalid AI_EVAL_SALT");
  });

  it("refuses a salt too large to survive the run record it would be written into", async () => {
    // Arrange — 309 digits is the shortest input that reaches this: `/^\d+$/`
    // is satisfied, `Number` overflows to Infinity, and
    // `JSON.stringify({salt: Infinity})` is `{"salt":null}`. Accepting it mints
    // a stable, valid, UNRECORDABLE token universe — verbatim the defect the
    // guard exists to refuse, arriving through the guard itself.
    const huge = "9".repeat(309);
    expect(Number(huge)).toBe(Infinity);
    const h = harness({ env: { ...LIVE_ENV, AI_EVAL_SALT: huge } });

    // Act
    const code = await runEval(h.deps);

    // Assert — ★★ MUTATION-PROVED against the pre-fix guard (drop
    //    `Number.isSafeInteger` and test `saltValue < 1` alone): `Infinity < 1`
    //    is FALSE, so the salt is accepted and the run spends the full standard
    //    plan on a run nobody can ever reproduce.
    expect(code).toBe(EXIT.UNUSABLE);
    expect(h.sent).toHaveLength(0);
    expect(h.writes).toHaveLength(0);
    expect(err.join("\n")).toContain("invalid AI_EVAL_SALT");
  });

  it("refuses before assembling anything when the filter names an unknown probe", async () => {
    // Arrange
    const h = harness({ env: { ...LIVE_ENV, [FILTER_ENV.probes]: "no-such-probe" } });

    // Act
    const code = await runEval(h.deps);

    // Assert
    expect(code).toBe(EXIT.UNUSABLE);
    expect(h.sent).toHaveLength(0);
    expect(h.writes).toHaveLength(0);
    expect(err.join("\n")).toContain("invalid filter — spending nothing");
  });

  it("refuses to spend under CI even with a key and an explicit opt-in", async () => {
    // Arrange
    const h = harness({ env: { ...LIVE_ENV, CI: "true" } });

    // Act
    const code = await runEval(h.deps);

    // Assert — the CI refusal outranks the opt-in, and nothing is assembled.
    expect(code).toBe(EXIT.UNUSABLE);
    expect(h.sent).toHaveLength(0);
    expect(h.writes).toHaveLength(0);
    expect(err.join("\n")).toContain("refusing to spend: CI is set");
  });
});

describe("runEval — the standard run", () => {
  it("reports PASS and writes both artifacts for a complete, unfiltered run", async () => {
    // Arrange — no stored artifacts, so this is a first run: no rolling replay.
    const h = harness();

    // Act
    const code = await runEval(h.deps);

    // Assert — the verdict, and the two write decisions that ride it.
    // ★★ THIS IS THE CENSUS-CONSTANTS PIN, and it is a REACHABILITY pin — read
    //    what it does and does not cover before trusting it. Mutating one of
    //    the check's literals (`plan.X !== 1` → `!== 2`) turns this PASS into
    //    UNUSABLE, so the check is proved to RUN over the standard plan.
    //    ★★★ ITS OTHER DIRECTION CANNOT BE DRIVEN FROM HERE, BY CONSTRUCTION.
    //    The check is guarded on `filter === null`, and under that guard
    //    `activeProbes` IS `PROBES`, `reps` IS `REPS` and `armWanted` is
    //    unconditionally true — so all five disjuncts are false for every
    //    input the seam accepts. It can only fire against a FUTURE narrowing
    //    that bypasses `parseFilter`, which is exactly what it is there for.
    //    Verified by simulating one: `reps = filter?.reps ?? REPS - 2` makes it
    //    push "unfiltered run planned 5 probes, reps 3 … the plan itself fell
    //    short" and this test dies. Do not read a green run as that half
    //    having been exercised by an input.
    expect(code).toBe(EXIT.PASS);
    const record = h.lastRecord();
    expect(record.complete).toBe(true);
    expect(record.filter).toBeNull();
    expect(record.verdict).toMatchObject({ code: EXIT.PASS, reasons: [] });
    expect(err.join("\n")).not.toContain("run did not produce every planned result");
    expect(h.writes.map((w) => w.path)).toEqual([RUNS_PATH, ROLLING_PATH]);
  });

  it("dispatches exactly the planned number of requests", async () => {
    // Arrange
    const h = harness();

    // Act
    await runEval(h.deps);

    // Assert — 5 probes x (5 A + 5 B + 1 X) + 5 anchor reps, no replay.
    expect(h.sent).toHaveLength(STANDARD_REQUESTS);
    expect(out.join("\n")).toContain(`planned requests: ${STANDARD_REQUESTS}`);
  });

  it("groups every probe's arms together and dispatches its control last", async () => {
    // Arrange
    const h = harness();

    // Act
    await runEval(h.deps);

    // Assert — arms A and B are byte-identical aliases today, so which of the
    // first ten a request was is NOT observable from the wire; what is
    // observable, and what this pins, is that a probe's eleven requests are
    // contiguous, all carry that probe's question, the first ten carry its
    // target and the eleventh (the control) does not.
    PROBES.forEach((probe, p) => {
      const block = h.sent.slice(p * PER_PROBE_REQUESTS, (p + 1) * PER_PROBE_REQUESTS);
      const target = plantedToken(probe.id, SALT);
      block.forEach((arm, i) => {
        expect(arm.whole).toContain(probe.question);
        expect(occurrences(arm.whole, target)).toBe(i < PER_PROBE_REQUESTS - 1 ? 1 : 0);
      });
    });
  });

  it("dispatches the probe-independent anchor arm after every probe, and never per probe", async () => {
    // Arrange
    const h = harness();

    // Act
    await runEval(h.deps);

    // Assert — the trailing `reps` requests are the anchor: they carry the
    // anchor pair and none of the app's probe questions, because the anchor is
    // regenerated from ANCHOR_SPEC and never goes through the app's builders.
    const anchorTarget = plantedToken("anchor", ANCHOR_SPEC.salt);
    const anchorDecoy = plantedToken("anchorDecoy", ANCHOR_SPEC.salt);
    const tail = h.sent.slice(-REPS);
    expect(tail).toHaveLength(REPS);
    for (const arm of tail) {
      expect(occurrences(arm.whole, anchorTarget)).toBe(1);
      expect(occurrences(arm.whole, anchorDecoy)).toBe(1);
      for (const probe of PROBES) {
        expect(arm.whole).not.toContain(probe.question);
      }
    }
  });

  it("plants every hardened token exactly once in the gated arms", async () => {
    // Arrange
    const h = harness();

    // Act
    await runEval(h.deps);

    // Assert — not merely the target and its decoy: the near-miss competitors
    // are what make a hardened probe hard, and one that silently failed to
    // land would turn it back into an easy one with every gate still green.
    const armA = h.sent[0];
    for (const id of plantedProbeIds()) {
      expect(occurrences(armA.whole, plantedToken(id, SALT))).toBe(1);
    }
  });

  it("builds the negative control as arm A minus the target and nothing else", async () => {
    // Arrange
    const h = harness();

    // Act
    await runEval(h.deps);

    // Assert — for every probe, the control drops that probe's target
    // completely and keeps every other planted token exactly once. A control
    // that also lost the decoy could not tell "answered from somewhere else"
    // apart from "answered nothing".
    PROBES.forEach((probe, p) => {
      const control = h.sent[p * PER_PROBE_REQUESTS + (PER_PROBE_REQUESTS - 1)];
      expect(occurrences(control.whole, plantedToken(probe.id, SALT))).toBe(0);
      for (const id of plantedProbeIds()) {
        if (id === probe.id) continue;
        expect(occurrences(control.whole, plantedToken(id, SALT))).toBe(1);
      }
    });
  });

  it("scores the negative control at zero and the gated arms at one", async () => {
    // Arrange
    const h = harness();

    // Act
    await runEval(h.deps);

    // Assert — X scoring anything above zero makes `verdict` void the probe,
    // so this is the axis the whole control exists to produce.
    const record = h.lastRecord() as { perProbe: { id: string; A: number; B: number; X: number }[] };
    expect(record.perProbe).toHaveLength(PROBES.length);
    for (const row of record.perProbe) {
      expect(row).toMatchObject({ A: 1, B: 1, X: 0 });
    }
  });
});

describe("runEval — a filtered run", () => {
  it("refuses to report PASS when the run was narrowed, however good the scores", async () => {
    // Arrange — one probe, one rep: every arm still answers correctly.
    const h = harness({
      env: { ...LIVE_ENV, [FILTER_ENV.probes]: "date", [FILTER_ENV.reps]: "1" },
    });

    // Act
    const code = await runEval(h.deps);

    // Assert — the refusal is structural and does not depend on the scores.
    // ★★ THE WIRING, not `verdict` in isolation: the same `filter` value has to
    //    reach the record AND the verdict, and there is exactly one argument
    //    that can carry it there.
    expect(code).toBe(EXIT.UNUSABLE);
    const record = h.lastRecord() as {
      filter: { probes: string[]; reps: number } | null;
      perProbe: { A: number; X: number }[];
      verdict: { code: number; reasons: string[] };
    };
    expect(record.filter).toMatchObject({ probes: ["date"], reps: 1 });
    expect(record.perProbe[0].A).toBe(1);
    expect(record.verdict.code).toBe(EXIT.UNUSABLE);
    expect(record.verdict.reasons.join("\n")).toContain("run was FILTERED");
  });

  it("announces a narrowed run on stderr so it cannot be mistaken for the standard one", async () => {
    // Arrange
    const h = harness({ env: { ...LIVE_ENV, [FILTER_ENV.reps]: "1" } });

    // Act
    await runEval(h.deps);

    // Assert
    expect(err.join("\n")).toContain("FILTERED RUN (reps=1) — this run cannot report PASS");
  });

  it("leaves the rolling drift reference alone for a narrowed run", async () => {
    // Arrange
    const h = harness({
      env: { ...LIVE_ENV, [FILTER_ENV.probes]: "date", [FILTER_ENV.reps]: "1" },
    });

    // Act
    await runEval(h.deps);

    // Assert — a narrowed probe set writes a prompt built for a different
    // question, so replaying it would attribute the narrowing to drift.
    expect(h.writes.map((w) => w.path)).toEqual([RUNS_PATH]);
  });

  it("honours an arm filter, dispatching only the arms named", async () => {
    // Arrange — arm A alone, one rep, one probe.
    const h = harness({
      env: {
        ...LIVE_ENV,
        [FILTER_ENV.probes]: "viewScope",
        [FILTER_ENV.reps]: "1",
        [FILTER_ENV.arms]: "A",
      },
    });

    // Act
    await runEval(h.deps);

    // Assert — no B, no X, no anchor.
    expect(h.sent).toHaveLength(1);
    const probe = PROBES.find((p) => p.id === "viewScope");
    if (!probe) throw new Error("the viewScope probe is gone — this test names a probe that no longer exists");
    expect(h.sent[0].whole).toContain(probe.question);
  });
});

describe("runEval — an incomplete run", () => {
  it("records the run as incomplete and leaves the rolling reference alone when the transport throws", async () => {
    // Arrange — fail partway through the second probe's reps.
    const h = harness({
      onRequest: (index) => {
        if (index === 13) throw new Error("simulated transport failure");
        return null;
      },
    });

    // Act
    const code = await runEval(h.deps);

    // Assert — a run that did not happen says nothing about the candidate, so
    // it is UNUSABLE rather than REGRESSION, and the drift reference the next
    // run measures against must not be overwritten from it.
    expect(code).toBe(EXIT.UNUSABLE);
    const record = h.lastRecord() as { complete: boolean; verdict: { reasons: string[] } };
    expect(record.complete).toBe(false);
    expect(record.verdict.reasons.join("\n")).toContain("run did not complete");
    expect(h.writes.map((w) => w.path)).toEqual([RUNS_PATH]);
    expect(err.join("\n")).toContain("run incomplete:");
  });

  it("names the short arm in the census when dispatch stops partway", async () => {
    // Arrange
    const h = harness({
      onRequest: (index) => {
        if (index === 13) throw new Error("simulated transport failure");
        return null;
      },
    });

    // Act
    await runEval(h.deps);

    // Assert — the census compares what was dispatched against the plan only
    // this file holds, which is the one shortfall `verdict` is blind to.
    const census = err.join("\n");
    expect(census).toContain("run did not produce every planned result");
    expect(census).toMatch(/arm [AB] returned \d+ of 5 planned replies/);
  });
});

describe("runEval — the rolling drift replay", () => {
  it("replays the previous run's own arm-A bytes when a reference exists", async () => {
    // Arrange — a first run writes both artifacts; feed exactly those bytes to
    // a second run, which is the real sequence and the only way the drift
    // reference and the salt beside it can be checked together.
    const first = harness();
    await runEval(first.deps);
    const second = harness({ files: { ...first.files } });

    // Act
    const code = await runEval(second.deps);

    // Assert — arm R adds `reps` more requests, and pre-flight did NOT refuse:
    // the reference is compared against what the last run WROTE, so a run
    // following a write must still be able to spend.
    expect(code).toBe(EXIT.PASS);
    expect(second.sent).toHaveLength(STANDARD_REQUESTS + REPS);
    expect(out).toContain("pre-flight OK");
    expect(out.join("\n")).toContain("rolling reference: present");
    const record = second.lastRecord() as {
      drift: { rolling: { hitRate: number } | null };
    };
    expect(record.drift.rolling).not.toBeNull();
    expect(record.drift.rolling?.hitRate).toBe(1);
  });

  it("replays stored bytes verbatim rather than rebuilding today's prompt", async () => {
    // Arrange
    const first = harness();
    await runEval(first.deps);
    const stored = first.writes.filter((w) => w.path === ROLLING_PATH).pop();
    const second = harness({ files: { ...first.files } });

    // Act
    await runEval(second.deps);

    // Assert — a regenerated prompt is a different prompt and the drift
    // attribution is gone, so the replay arms must be the stored halves
    // exactly. ★ The two drift arms INTERLEAVE (N, R, N, R, ...) for the same
    // reason A and B do, so the tail is 2 x reps and arm R is its odd offsets.
    const parsed = JSON.parse(stored?.text ?? "{}") as { system: string; turn: string };
    const tail = second.sent.slice(-2 * REPS);
    expect(tail).toHaveLength(2 * REPS);
    tail.forEach((arm, i) => {
      if (i % 2 === 0) return; // arm N — the anchor, checked elsewhere
      expect(arm.system).toBe(parsed.system);
      expect(arm.turn).toBe(parsed.turn);
    });
  });
});

/** Today's anchor hash, RECOMPUTED from the same three inputs the CLI uses
 *  rather than pasted as a constant. A literal here would pin whatever the
 *  hash was on the day it was typed, so a test seeding "the recorded hash
 *  matches" would keep passing after the generator moved — which is precisely
 *  the drift this guard exists to catch. */
function recordedAnchorHash(): string {
  return sha256(buildAnchorPrompt(
    ANCHOR_SPEC,
    plantedToken("anchor", ANCHOR_SPEC.salt),
    plantedToken("anchorDecoy", ANCHOR_SPEC.salt),
  ));
}

describe("runEval — the drift reference, and the salt that travels with it", () => {
  it("refuses to spend when the recorded anchor hash is not today's", async () => {
    // Arrange — a stored run whose anchor hash cannot be today's. A changed
    // anchor generator means every recorded N score was measured against a
    // different question, so the series is not comparable and the run has
    // nothing to learn by spending.
    const h = harness({
      files: { [RUNS_PATH]: JSON.stringify({ runs: [{ anchorHash: "0".repeat(64) }] }) },
    });

    // Act
    const code = await runEval(h.deps);

    // Assert — ★★ THIS IS THE WIRING PIN, and it is the half that costs money.
    //    `driftReferenceCheck` was fully unit-tested in the library and its
    //    RESULT unused here: mutation-proved against `if (false && !drift.ok)`,
    //    under which the check still computes, pre-flight still reports OK, and
    //    the run dispatches all 60 requests against a reference it has already
    //    established is incomparable.
    expect(code).toBe(EXIT.UNUSABLE);
    expect(h.sent).toHaveLength(0);
    expect(h.writes).toHaveLength(0);
    expect(err.join("\n")).toContain("anchor hash mismatch");
  });

  it("mints the anchor pair at ANCHOR_SPEC.salt, so rotating AI_EVAL_SALT does not trip the anchor guard", async () => {
    // Arrange — a recorded anchor hash minted at `ANCHOR_SPEC.salt`, against a
    // run rotated to salt 2. Rotation is the DOCUMENTED repair for a planted-
    // token collision, so it must remain executable on a tree that already has
    // recorded runs; while the anchor pair rode the run salt it did not.
    const h = harness({
      env: { ...LIVE_ENV, AI_EVAL_SALT: "2" },
      files: {
        [RUNS_PATH]: JSON.stringify({ runs: [{ anchorHash: recordedAnchorHash() }] }),
      },
    });

    // Act
    await runEval(h.deps);

    // Assert — ★★ MUTATION-PROVED against `plantedToken("anchor", salt)`: the
    //    pair then moves with the rotation, today's hash stops matching the
    //    recorded one, pre-flight pushes one anchor mismatch and the run spends
    //    nothing. ★ The exit code is deliberately NOT asserted — the fake
    //    answering model mints its replies at the default salt, so a rotated
    //    run scores zero and the verdict is a regression either way. What is
    //    under test is that the run got as far as SPENDING.
    expect(err.join("\n")).not.toContain("anchor hash mismatch");
    expect(h.sent).toHaveLength(STANDARD_REQUESTS);
  });

  it("scores the rolling replay at the salt of the run that WROTE the file, not the last recorded run's", async () => {
    // Arrange — a real first run writes both artifacts and records
    // `rollingWrittenHash` beside its own `salt`. Append a LATER run that wrote
    // nothing, at a different salt: the rolling reference is then the FIRST
    // entry while the last RECORDED entry is the second. That split is the only
    // arrangement that tells `rollingRef.salt` and `last.salt` apart — every
    // other test in this file has them equal, which is why this survived.
    const first = harness();
    await runEval(first.deps);
    const stored = JSON.parse(first.files[RUNS_PATH]) as {
      runs: Record<string, unknown>[];
    };
    const wrote = stored.runs[stored.runs.length - 1];
    expect(wrote.salt).toBe(SALT);
    expect(typeof wrote.rollingWrittenHash).toBe("string");
    stored.runs.push({ ...wrote, salt: SALT + 1, rollingWrittenHash: null });
    const second = harness({
      files: { ...first.files, [RUNS_PATH]: JSON.stringify(stored) },
    });

    // Act
    await runEval(second.deps);

    // Assert — ★★ MUTATION-PROVED against `last?.salt ?? salt`: the replay is
    //    then scored for a token minted at salt 2, which is not in the stored
    //    bytes at all, and a perfectly healthy replay is recorded as total
    //    drift. Latent on today's baseline because every recorded run is salt
    //    1 — live the moment anyone rotates.
    const record = second.lastRecord() as {
      drift: { rolling: { hitRate: number } | null };
    };
    expect(record.drift.rolling).not.toBeNull();
    expect(record.drift.rolling?.hitRate).toBe(1);
  });
});
