// Moves every test's clock forward, to find tests that only pass while a
// hardcoded date is still in the future (open-followups §149).
//
// ★ Off unless `VITEST_CLOCK_OFFSET_DAYS` is set, so a normal run is untouched.
// The weekly `unit-future-clock` job (`.github/workflows/future-clock.yml`) sets it
// and annotates whatever goes red. Reproduce one locally with, for example:
//   VITEST_CLOCK_OFFSET_DAYS=400 npx vitest run <file>
//
// ★ Only `Date` is faked, never the timer functions: faking every timer would
// put RTL and the React scheduler on a stopped clock, which has nothing to do
// with a date rollover. `shouldAdvanceTime` keeps the faked clock moving, so a
// test that measures an elapsed duration with `Date.now()` still sees time pass.
// A test file that installs its own fake timers still inherits the shift:
// `vi.useFakeTimers()` starts its clock from the current, already shifted
// `Date.now()` (checked with a probe under the variable). Only a file that calls
// `vi.setSystemTime` itself, or restores real timers before it asserts, sets its
// own clock and is not covered.

const DAY_MS = 86_400_000;

/**
 * Parses the offset in whole days. Unset, empty or "0" means off (null).
 * Anything else that is not a whole number THROWS, so a typo in the job
 * cannot silently run the suite on today's date and report green.
 */
export function parseClockOffsetDays(raw: string | undefined): number | null {
  if (raw === undefined || raw.trim() === "") return null;
  if (!/^-?\d+$/.test(raw.trim())) {
    throw new Error(`VITEST_CLOCK_OFFSET_DAYS must be a whole number of days, got "${raw}"`);
  }
  const days = Number(raw.trim());
  return days === 0 ? null : days;
}

interface ClockHooks {
  beforeEach: (fn: () => void) => void;
  afterEach: (fn: () => void) => void;
}

interface ClockApi {
  useFakeTimers: (config: { toFake: ["Date"]; shouldAdvanceTime: true }) => unknown;
  setSystemTime: (time: number) => unknown;
  useRealTimers: () => unknown;
}

/** Registers the per-test hooks that shift `Date` by `days`. */
export function registerClockOffset(days: number, hooks: ClockHooks, clock: ClockApi): void {
  hooks.beforeEach(() => {
    // Read the real time BEFORE faking, then move the fake clock from there.
    const now = Date.now();
    clock.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true });
    clock.setSystemTime(now + days * DAY_MS);
  });
  hooks.afterEach(() => {
    clock.useRealTimers();
  });
}
