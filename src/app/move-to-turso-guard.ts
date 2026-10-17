// §715 — ONE "Move to Turso" AT A TIME. Both buttons run through `holdDuring` (the load hold unmounts
// the main tree at once), so the window is the click-to-commit gap of a fast double-click, or a caller
// not wrapped in the hold. The move awaits a seal, the probe and the flush before `portfolioCreate`,
// so a second move in that window would create a second portfolio row; it is dropped instead.
// Module scope (one move per page); a successful move ends in a reload.
// ★ A LEAF on purpose — no imports — so `vitest.setup.ts` can reset it after every test: a test that
//   parks a move (a gate it never resolves) would otherwise leave every later move in its file dropped.
let moveToTursoRunning = false;

/** Claims the move; false when one is already running. */
export function beginMoveToTurso(): boolean {
  if (moveToTursoRunning) return false;
  moveToTursoRunning = true;
  return true;
}

export function endMoveToTurso(): void {
  moveToTursoRunning = false;
}

/** Test-only (`vitest.setup.ts`, after every test). */
export function __resetMoveToTursoGuard(): void {
  moveToTursoRunning = false;
}
