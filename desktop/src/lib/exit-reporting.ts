// Should the server child's exit be reported to the user as a crash?
//
// ★★★ NOT "did it exit non-zero". We kill the child ourselves on quit, and on
// Windows that goes through `taskkill /F`, which makes a perfectly deliberate
// shutdown exit with code 1. Reporting on the exit code alone therefore throws
// an error dialog in the user's face every single time they close the app --
// measured, not theorised: that is exactly what shipped.
//
// The question is about INTENT, not about the code. We only warn when the
// child died on its own while the app was still running and had a window to
// warn into.
export interface ServerExitContext {
  /** True once we have begun shutting down, i.e. we killed the child. */
  quitting: boolean;
  /** True while a window exists and is not destroyed. */
  windowAlive: boolean;
}

export function shouldReportServerExit(ctx: ServerExitContext): boolean {
  // A shutdown we initiated is never a crash, whatever the exit code says.
  if (ctx.quitting) return false;
  // With no window there is nowhere to show a dialog, and the app is going
  // away regardless.
  return ctx.windowAlive;
}
