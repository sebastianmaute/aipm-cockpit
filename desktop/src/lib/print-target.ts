// The two pure decisions the print route needs: WHICH window to print, and
// whether a reported failure was really just the user closing the dialog.
//
// ★ The liveness half lives in window-liveness.ts, because `open-help` needs
// the same decision and importing it from a file named print-target would be a
// lie about what it decides. This module delegates rather than re-deciding, so
// there is ONE liveness idiom in the shell.
import { type DestroyableWindow, liveWindow } from "./window-liveness";

// ★★★ A DESTROYED FOCUSED WINDOW PRINTS NOTHING -- it deliberately does NOT
// fall back to the main window. Falling back would print something the user is
// not looking at, which is exactly the defect this whole path exists to fix;
// refusing costs them one keypress and a log line. The main window is the
// fallback only for the case where there is NO focused window at all, which is
// why `focused ?? main` is resolved BEFORE the liveness check rather than
// after.
export function pickPrintTarget<W extends DestroyableWindow>(
  focused: W | null | undefined,
  main: W | null | undefined,
): W | null {
  return liveWindow(focused ?? main);
}

// Is this print "failure" just the user closing the dialog?
//
// ★ Moved here from menu-model.ts, which models MENUS -- this models printing,
// and print-target.ts is where the other pure print decision already lives.
//
// ★★★ webContents.print's callback is `(success: boolean, failureReason:
// string)` (verified in desktop/node_modules/electron/electron.d.ts), and a
// USER CANCELLATION arrives as success: false. So without this classifier the
// ordinary act of dismissing the print dialog would write a failure line into
// launch.log every time -- the log the rollout note asks users to send when
// something is wrong.
//
// ★★ MATCHED ON THE STEM, CASE-INSENSITIVELY, and deliberately not by
// equality.
//
// ★★★ WHAT IS ACTUALLY MEASURED, stated exactly, because an earlier version of
// this comment said "MEASURED, NOT ASSUMED" of something the command cannot
// show. All the grep proves is that a string EXISTS IN THE BINARY:
//   grep -aoih "print job cancel[a-z]*" \
//     desktop/node_modules/electron/dist/electron.exe
// returns one hit, `Print job canceled` (US spelling, one L). That it is the
// `failureReason` delivered to this callback on a user cancellation is NOT
// verified and cannot be from here -- the callback needs a real Electron
// window. Treat it as the strongest available evidence, not as a measurement.
//
// ★★ THE ARGUMENT FOR THE LOOSE MATCH is a second pair of probes over the same
// binary, and it beats "the string could be reworded": the reason vocabulary is
// NOT what Electron's docs suggest. `Printing is already in progress` and `No
// printers found` have ZERO occurrences, while `Invalid printer settings` has
// one. So the wording cannot be guessed, and an `===` test against today's
// string would quietly reclassify every cancellation as an error after an
// upgrade.
//
// ★★★ THAT IS ALL THAT IS MEASURED. An earlier version of this comment added
// "no reason-shaped string except the cancellation one contains `cancel`" and
// presented it as part of the same measurement. It is not measurable:
// "reason-shaped" has no definition, so nothing can falsify it -- and the
// binary in fact holds hundreds of distinct `cancel`-containing strings,
// sentence-shaped ones included (`Authentication canceled`, `Form submission
// canceled`, `DNS query cancelled`). None of them is a print failureReason as
// far as anyone here can tell, so the stem match is PROBABLY narrow in
// practice -- but that is a judgement, not a probe, and the count itself moves
// with whatever window width you grep. The residual cost -- a genuine print
// failure whose reason contains "cancel" going unlogged -- is accepted as the
// better of the two mistakes.
export function isPrintCancellation(failureReason: string): boolean {
  return /cancel/i.test(failureReason);
}
