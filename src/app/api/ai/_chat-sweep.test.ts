// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PipelineResultLike } from "../../turso-schema";
import { CHAT_THREADS_DDL } from "../../chat-threads-schema";

import type { PipelineRunner } from "./_chat-sweep";

type SweepModule = typeof import("./_chat-sweep");

// The schedule is started at most once per process, so each test gets a fresh copy of the module.
async function freshModule(): Promise<SweepModule> {
  vi.resetModules();
  return import("./_chat-sweep");
}

const SWEEP_URL = "libsql://sweep-db.example.turso.io";
const SWEEP_TOKEN = "sweep-token-secret";
const PUBLIC_URL = "https://public-db.example.turso.io";
const PUBLIC_TOKEN = "public-token-secret";

function deleted(count: number | undefined): PipelineResultLike[] {
  const ok: PipelineResultLike = { type: "ok", response: { type: "execute", result: { cols: [], rows: [] } } };
  const expiry: PipelineResultLike = {
    type: "ok",
    response: { type: "execute", result: count === undefined ? {} : { affected_row_count: count } },
  };
  return [...CHAT_THREADS_DDL.map(() => ok), expiry];
}

function fakeTimers() {
  const intervals: { fn: () => void; ms: number; unref: ReturnType<typeof vi.fn> }[] = [];
  return {
    intervals,
    timers: {
      setInterval(fn: () => void, ms: number) {
        const handle = { unref: vi.fn() };
        intervals.push({ fn, ms, unref: handle.unref });
        return handle;
      },
    },
  };
}

beforeEach(() => {
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("sweepCredentialsFrom", () => {
  it("prefers the sweep pair, normalising a libsql URL", async () => {
    const { sweepCredentialsFrom } = await freshModule();
    expect(
      sweepCredentialsFrom({
        AIPM_CHAT_SWEEP_TURSO_URL: SWEEP_URL,
        AIPM_CHAT_SWEEP_TURSO_TOKEN: SWEEP_TOKEN,
        NEXT_PUBLIC_TURSO_DATABASE_URL: PUBLIC_URL,
        NEXT_PUBLIC_TURSO_AUTH_TOKEN: PUBLIC_TOKEN,
      }),
    ).toEqual({ httpUrl: "https://sweep-db.example.turso.io", authToken: SWEEP_TOKEN });
  });

  it("falls back to the public pair when the sweep URL is unset or blank", async () => {
    const { sweepCredentialsFrom } = await freshModule();
    const expected = { httpUrl: PUBLIC_URL, authToken: PUBLIC_TOKEN };
    const publicPair = { NEXT_PUBLIC_TURSO_DATABASE_URL: PUBLIC_URL, NEXT_PUBLIC_TURSO_AUTH_TOKEN: PUBLIC_TOKEN };
    expect(sweepCredentialsFrom(publicPair)).toEqual(expected);
    expect(sweepCredentialsFrom({ ...publicPair, AIPM_CHAT_SWEEP_TURSO_URL: "  " })).toEqual(expected);
  });

  it("never mixes a URL from one pair with a token from the other", async () => {
    const { sweepCredentialsFrom } = await freshModule();
    // Sweep URL without its token: the public token must not be borrowed.
    expect(
      sweepCredentialsFrom({
        AIPM_CHAT_SWEEP_TURSO_URL: SWEEP_URL,
        NEXT_PUBLIC_TURSO_DATABASE_URL: PUBLIC_URL,
        NEXT_PUBLIC_TURSO_AUTH_TOKEN: PUBLIC_TOKEN,
      }),
    ).toBeNull();
    // Public URL with only the sweep token: the sweep token must not be borrowed.
    expect(
      sweepCredentialsFrom({ AIPM_CHAT_SWEEP_TURSO_TOKEN: SWEEP_TOKEN, NEXT_PUBLIC_TURSO_DATABASE_URL: PUBLIC_URL }),
    ).toBeNull();
  });

  it("allows an empty token only for a loopback URL", async () => {
    const { sweepCredentialsFrom } = await freshModule();
    expect(sweepCredentialsFrom({ AIPM_CHAT_SWEEP_TURSO_URL: "http://127.0.0.1:8080" })).toEqual({
      httpUrl: "http://127.0.0.1:8080",
      authToken: "",
    });
    expect(sweepCredentialsFrom({ AIPM_CHAT_SWEEP_TURSO_URL: SWEEP_URL, AIPM_CHAT_SWEEP_TURSO_TOKEN: " " })).toBeNull();
  });

  it("returns null with no credentials or an unusable URL", async () => {
    const { sweepCredentialsFrom } = await freshModule();
    expect(sweepCredentialsFrom({})).toBeNull();
    expect(sweepCredentialsFrom({ AIPM_CHAT_SWEEP_TURSO_URL: "http://remote.example.com", AIPM_CHAT_SWEEP_TURSO_TOKEN: "t" })).toBeNull();
  });
});

describe("runChatSweep", () => {
  it("creates the table, then deletes by the retention cutoff, and returns the deleted count", async () => {
    const { runChatSweep } = await freshModule();
    const run = vi.fn<PipelineRunner>(async () => deleted(4));
    const config = { httpUrl: PUBLIC_URL, authToken: PUBLIC_TOKEN };

    const count = await runChatSweep(config, 30, run);

    expect(count).toBe(4);
    expect(run).toHaveBeenCalledTimes(1);
    const [passedConfig, stmts] = run.mock.calls[0];
    expect(passedConfig).toBe(config);
    expect(stmts.slice(0, CHAT_THREADS_DDL.length).map((s) => s.sql)).toEqual(CHAT_THREADS_DDL);
    const expiry = stmts[stmts.length - 1];
    expect(expiry.sql).toMatch(/^DELETE FROM chat_threads WHERE /);
    expect(expiry.sql).not.toContain("project_id");
    expect(expiry.args).toEqual([{ type: "text", value: "-30 days" }]);
  });

  it("returns 0 when the result carries no affected row count", async () => {
    const { runChatSweep } = await freshModule();
    const run = vi.fn(async () => deleted(undefined));
    expect(await runChatSweep({ httpUrl: PUBLIC_URL, authToken: PUBLIC_TOKEN }, 30, run)).toBe(0);
  });
});

describe("startChatSweepSchedule", () => {
  const env = { NEXT_PUBLIC_TURSO_DATABASE_URL: PUBLIC_URL, NEXT_PUBLIC_TURSO_AUTH_TOKEN: PUBLIC_TOKEN };

  it("does not schedule anything without credentials", async () => {
    const { startChatSweepSchedule } = await freshModule();
    const { intervals, timers } = fakeTimers();
    const run = vi.fn(async () => deleted(0));
    expect(startChatSweepSchedule({}, timers, run)).toBe(false);
    expect(intervals).toHaveLength(0);
    expect(run).not.toHaveBeenCalled();
  });

  it("logs nothing when no sweep or public URL is set", async () => {
    const { startChatSweepSchedule } = await freshModule();
    expect(startChatSweepSchedule({}, fakeTimers().timers, vi.fn(async () => deleted(0)))).toBe(false);
    expect(console.warn).not.toHaveBeenCalled();
    expect(console.info).not.toHaveBeenCalled();
  });

  it("says 'chat sweep: not configured' once when a URL is set but no usable pair results, and never the URL", async () => {
    const { startChatSweepSchedule } = await freshModule();
    const run = vi.fn(async () => deleted(0));
    const broken = [
      { AIPM_CHAT_SWEEP_TURSO_URL: "https://remote-sweep.example.com" },
      { NEXT_PUBLIC_TURSO_DATABASE_URL: "not a url at all", NEXT_PUBLIC_TURSO_AUTH_TOKEN: PUBLIC_TOKEN },
    ];
    for (const env of broken) expect(startChatSweepSchedule(env, fakeTimers().timers, run)).toBe(false);
    expect(console.warn).toHaveBeenCalledTimes(1);
    expect(console.warn).toHaveBeenCalledWith("chat sweep: not configured");
    expect(run).not.toHaveBeenCalled();
    const logged = JSON.stringify([...vi.mocked(console.warn).mock.calls, ...vi.mocked(console.info).mock.calls]);
    expect(logged).not.toContain("remote-sweep");
    expect(logged).not.toContain(PUBLIC_TOKEN);
  });

  it("runs once at start and once per daily interval, with an unref'd timer", async () => {
    const { startChatSweepSchedule, CHAT_SWEEP_INTERVAL_MS } = await freshModule();
    expect(CHAT_SWEEP_INTERVAL_MS).toBe(86_400_000);
    const { intervals, timers } = fakeTimers();
    const run = vi.fn(async () => deleted(2));

    expect(startChatSweepSchedule(env, timers, run)).toBe(true);
    await vi.waitFor(() => expect(console.info).toHaveBeenCalledWith("chat sweep: 2 expired"));
    expect(run).toHaveBeenCalledTimes(1);
    expect(intervals).toHaveLength(1);
    expect(intervals[0].ms).toBe(CHAT_SWEEP_INTERVAL_MS);
    expect(intervals[0].unref).toHaveBeenCalledTimes(1);

    intervals[0].fn();
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(2));
  });

  it("starts at most once per process", async () => {
    const { startChatSweepSchedule } = await freshModule();
    const { intervals, timers } = fakeTimers();
    const run = vi.fn(async () => deleted(0));
    expect(startChatSweepSchedule(env, timers, run)).toBe(true);
    expect(startChatSweepSchedule(env, timers, run)).toBe(false);
    expect(intervals).toHaveLength(1);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("uses the configured retention period", async () => {
    const { startChatSweepSchedule } = await freshModule();
    const { timers } = fakeTimers();
    const run = vi.fn<PipelineRunner>(async () => deleted(0));
    startChatSweepSchedule({ ...env, AIPM_AI_CHAT_RETENTION_DAYS: "7" }, timers, run);
    const stmts = run.mock.calls[0][1];
    expect(stmts[stmts.length - 1].args).toEqual([{ type: "text", value: "-7 days" }]);
  });

  it("logs a fixed line on failure and the next interval still runs", async () => {
    const { startChatSweepSchedule } = await freshModule();
    const { intervals, timers } = fakeTimers();
    const run = vi
      .fn<PipelineRunner>()
      .mockRejectedValueOnce(new Error(`fetch ${PUBLIC_URL} failed with ${PUBLIC_TOKEN}`))
      .mockResolvedValueOnce(deleted(3));

    startChatSweepSchedule(env, timers, run);
    await vi.waitFor(() => expect(console.warn).toHaveBeenCalledWith("chat sweep failed"));

    intervals[0].fn();
    await vi.waitFor(() => expect(console.info).toHaveBeenCalledWith("chat sweep: 3 expired"));

    const logged = [...vi.mocked(console.info).mock.calls, ...vi.mocked(console.warn).mock.calls]
      .flat()
      .map((v) => String(v))
      .join("\n");
    expect(logged).toBe(["chat sweep: 3 expired", "chat sweep failed"].join("\n"));
    for (const secret of [PUBLIC_URL, PUBLIC_TOKEN, "public-db"]) expect(logged).not.toContain(secret);
  });
});

describe("register", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.doUnmock("./_chat-sweep");
  });

  async function registerWith(runtime: string) {
    vi.resetModules();
    const start = vi.fn(() => true);
    vi.doMock("./_chat-sweep", () => ({ startChatSweepSchedule: start }));
    vi.stubEnv("NEXT_RUNTIME", runtime);
    const { register } = await import("../../../instrumentation");
    await register();
    return start;
  }

  it("starts the schedule in the Node.js runtime", async () => {
    const start = await registerWith("nodejs");
    expect(start).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledWith(process.env);
  });

  it("does nothing in the Edge runtime", async () => {
    expect(await registerWith("edge")).not.toHaveBeenCalled();
  });
});
