// What the splash says while the background service starts.
//
// On the first start after an install or an update the local server can take
// up to a minute to answer, and an artwork-only window reads as a hang. The
// page (desktop/splash.html) exposes `window.__splash`; main.ts drives it
// through `executeJavaScript` with the scripts built here.
//
// Pure and Electron-free so it can be tested: main.ts is outside the root
// typecheck and no unit test can import it.

/** After this long on the splash, the reassurance line is shown. */
export const SPLASH_SLOW_MS = 10_000;

export interface SplashMessages {
  readonly starting: string;
  readonly opening: string;
  readonly slow: string;
}

const EN: SplashMessages = {
  starting: "Starting the background service…",
  opening: "Opening…",
  slow: "Still starting. The first start after installing or updating can take up to a minute — please wait.",
};

const DE: SplashMessages = {
  starting: "Hintergrunddienst wird gestartet…",
  opening: "Wird geöffnet…",
  slow: "Startet noch. Der erste Start nach der Installation oder einem Update kann bis zu einer Minute dauern – bitte warten.",
};

/** German when the OS locale is German (`de`, `de-DE`, ...), else English. */
export function splashMessages(locale: string): SplashMessages {
  return locale.toLowerCase().startsWith("de") ? DE : EN;
}

/**
 * The script main.ts hands to `executeJavaScript`. The text reaches the page
 * ONLY through `JSON.stringify`, never by concatenation, so quotes,
 * backslashes and newlines in it cannot break out of the string literal. The
 * `window.__splash &&` guard makes a call against a page that has already
 * navigated away a no-op rather than a thrown ReferenceError.
 */
export function splashScript(kind: "status" | "slow", text: string): string {
  return `window.__splash && window.__splash.${kind}(${JSON.stringify(text)})`;
}

/** The timer functions `splashSequence` schedules with; main.ts passes the globals. */
export interface SplashTimers<H> {
  setTimeout(fn: () => void, ms: number): H;
  clearTimeout(handle: H): void;
}

export interface SplashSequence {
  /** "Starting the background service…": only a launch that really spawns the server says it. */
  starting(): void;
  /** Stops the reassurance timer, then "Opening…" as the window navigates to the app. */
  opening(): void;
  /** Stops the reassurance timer without a message (a failed start). Safe to call twice. */
  stop(): void;
}

/**
 * The splash's status sequence. The reassurance line is scheduled at once and fires after
 * SPLASH_SLOW_MS unless `opening` or `stop` ran first: a timer left running would fire into
 * whatever the window shows next. main.ts calls `stop` on every way out of its startup, so the
 * order and the clearing live here, where a test with fake timers can reach them.
 */
export function splashSequence<H>(
  send: (kind: "status" | "slow", text: string) => void,
  text: SplashMessages,
  timers: SplashTimers<H>,
): SplashSequence {
  const handle = timers.setTimeout(() => send("slow", text.slow), SPLASH_SLOW_MS);
  let stopped = false;
  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    timers.clearTimeout(handle);
  };
  return {
    starting: () => send("status", text.starting),
    opening: () => {
      stop();
      send("status", text.opening);
    },
    stop,
  };
}
