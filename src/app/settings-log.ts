/** Debounce delay for coalescing rapid settings changes into one activity entry. */
export const SETTINGS_LOG_DEBOUNCE_MS = 1500;

export interface SettingsLogger {
  /** Schedule a (re-debounced) log call. Safe to call on every settings change. */
  notifyChange(): void;
  /** Cancel any pending log call — call on effect cleanup / unmount. */
  cancel(): void;
}

/**
 * Factory for a trailing-edge debounced settings logger.
 *
 * Pure and framework-agnostic so it is straightforward to unit-test with
 * `vi.useFakeTimers()`. The `setTimeoutFn` / `clearTimeoutFn` parameters
 * default to the globals but can be injected for deterministic tests.
 */
export function createSettingsLogger(
  log: () => void,
  delayMs: number,
  setTimeoutFn: (cb: () => void, ms: number) => ReturnType<typeof setTimeout> = setTimeout,
  clearTimeoutFn: (h: ReturnType<typeof setTimeout>) => void = clearTimeout,
): SettingsLogger {
  let handle: ReturnType<typeof setTimeout> | null = null;

  return {
    notifyChange() {
      if (handle !== null) clearTimeoutFn(handle);
      handle = setTimeoutFn(() => {
        handle = null;
        log();
      }, delayMs);
    },
    cancel() {
      if (handle !== null) {
        clearTimeoutFn(handle);
        handle = null;
      }
    },
  };
}
