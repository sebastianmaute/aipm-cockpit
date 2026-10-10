#!/usr/bin/env node
// Fails a live-Turso run in which any test skipped, or none ran (§215; scripts/live-run-lib.mjs
// says why). Reads the Playwright JSON report named by E2E_JSON_REPORT, which playwright.config.ts
// writes when that variable is set. Exit 0 = every test ran; 1 = a test skipped or none ran;
// 2 = no readable report (the run never got that far, or the variable is unset).
import { readFileSync } from "node:fs";
import { judgeLiveRun } from "./live-run-lib.mjs";

const file = process.env.E2E_JSON_REPORT;
if (!file) {
  console.error("check-live-run: E2E_JSON_REPORT is not set");
  process.exit(2);
}
let report;
try {
  report = JSON.parse(readFileSync(file, "utf8"));
} catch (err) {
  console.error(`check-live-run: cannot read ${file}: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(2);
}
const verdict = judgeLiveRun(report.stats);
(verdict.ok ? console.log : console.error)(`check-live-run: ${file}: ${verdict.message}`);
process.exit(verdict.ok ? 0 : 1);
