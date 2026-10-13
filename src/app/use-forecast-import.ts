"use client";

// The forecast import's state machine (§500): a spreadsheet file becomes sheet
// grids, one sheet becomes forecast rows by its columns — detected, set by
// hand, or proposed by Claude — the rows are validated, and the plan is a diff
// against ONE budget bucket. Nothing is written until `apply()`.
//
// ★★ APPLY RE-PLANS FROM THE LIVE BUCKETS. The preview can sit open while the
// bucket is closed, removed, or "Budget hours follow plan" is switched on;
// `apply()` looks the bucket up by id in the `buckets` it is rendered with NOW,
// rebuilds the plan, and refuses (writes nothing) unless that plan is clean.
// The preview's own plan is derived from the same live inputs, so its Apply
// button disables too — but the refusal here is what holds under a race.
//
// ★★ AN AMBIGUOUS SHEET WAITS FOR THE USER (fix 7). When detection reports
// that more than one column could hold the hours or the period (`ambiguous`),
// the hand route opens on the mapping step, and Apply is refused until each
// such field is confirmed: by choosing its column, or by `confirmColumns`.
// Re-detecting (a new file, sheet, or Detect columns) asks again.
//
// ★★★ CLAUDE SETS THE MAPPING, NEVER A VALUE (owner decision 2026-10-13).
// "Ask Claude" returns a column mapping; the hand reader imports with it. It
// opens on the mapping step, and Apply waits for an explicit "These columns
// are right" (`confirmColumns`) on ANY layout, with or without a question: the
// model can be wrong, and only the user confirms. An edit of a field is no
// such press, and an edit after it asks for it again (`claudeConfirmed` holds
// the mapping the press confirmed). Every question detection raises is asked
// of the mapping IN EFFECT (`questionsFor`), Claude's or the user's edit of it.
//
// SECURITY: the api key is read from the in-memory hydrated settings and goes
// straight to the call; it is never logged.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { applyForecastImport, buildForecastImportPlan, normalisePerson, type ImportPlan, type PersonOverride, type UnresolvedPerson } from "./budget-import/forecast-plan";
import { gridToForecastRows, isTotalLabel } from "./budget-import/forecast-rows";
import { assignRunPeriods } from "./budget-import/period-assign";
import type { AssumedYear, ColumnAmbiguity, ColumnMapping, DropReason, ForecastCollision, ForecastRow, IgnoredColumn } from "./budget-import/forecast-types";
import { validateForecastRows, type DuplicateRow, type RejectedRow } from "./budget-import/forecast-validate";
import { detectLayout, questionsFor, type LayoutDetection } from "./budget-import/layout-detect";
import type { UnreadCells } from "./budget-import/unread-cells";
import { readSheetFile, type NumberOrigin, type SheetGrid } from "./budget-import/sheet-grid";
import { runForecastImportCall } from "./forecast-import-call";
import { AiHttpError, classifyAiError } from "./ai-errors";
import { aiKeyMessageKeyForError } from "./ai-key-status";
import { useActionGuideText } from "./action-guides-context";
import { checkAttachmentSize, MAX_ATTACHMENT_BYTES } from "./chat-attachments";
import type { TranslationKey } from "./i18n";
import { aiKeyIfEnabled, isAiEnabled } from "./settings-types";
import type { BudgetBucket, Resource, ResourcePlan, Role } from "./types";
import type { BucketCommitMeta } from "./use-budget-buckets";
import { useSettings } from "./use-settings";

export type ForecastImportStep = "source" | "mapping" | "preview";
/** Where the mapping in effect came from: detection or the user (`hand`), or
 *  Claude's proposal, edited or not (`claude`). The rows are read the same way. */
export type ForecastImportRoute = "hand" | "claude";
/** A translated message, or a provider's own safe message shown verbatim. */
export type ForecastImportError = { key: TranslationKey; args?: string[] } | { message: string };

export interface ForecastImportDeps {
  /** The bucket the import was opened for. Only its id is trusted at apply time. */
  bucket: BudgetBucket;
  /** The LIVE bucket list — the plan and `apply()` read the target from here. */
  buckets: readonly BudgetBucket[];
  resources: readonly Resource[];
  roles: readonly Role[];
  plan: ResourcePlan;
  holidaySet: ReadonlySet<string>;
  onChangeBuckets: (next: BudgetBucket[], meta?: BucketCommitMeta) => void;
}

export interface ForecastImport {
  step: ForecastImportStep;
  sheets: readonly SheetGrid[];
  sheetIndex: number;
  /** The columns the rows are read by: the detected ones, Claude's, or — when
   *  nothing was detected — `defaultMappingFor`, so the mapping step's selects
   *  and its sample agree from the start. Null only before a sheet is loaded. */
  mapping: ColumnMapping | null;
  /** False when `detectLayout` found nothing and the hand mapping is the default. */
  layoutDetected: boolean;
  /** The fields the mapping in effect leaves open and the user has not
   *  confirmed yet: Apply is refused while any is left. On the Claude route,
   *  every question `questionsFor` asks of the mapping until the press. */
  ambiguous: readonly ColumnAmbiguity[];
  /** True on the Claude route until "These columns are right" is pressed for
   *  the mapping in effect: Apply is refused meanwhile. */
  claudeUnconfirmed: boolean;
  /** "These columns are right": confirms every field in `ambiguous` and, on
   *  the Claude route, the mapping itself. */
  confirmColumns: () => void;
  /** The target bucket is no longer in the live list (removed meanwhile). */
  bucketGone: boolean;
  setMapping: (next: ColumnMapping | null) => void;
  route: ForecastImportRoute;
  overrides: ReadonlyMap<string, PersonOverride>;
  setOverride: (person: string, value: PersonOverride) => void;
  /** The diff against the live bucket; null until a preview is possible. */
  importPlan: ImportPlan | null;
  /** The people the automatic match could not settle, as if NO override were
   *  set — the list the per-person pickers render from, so a picker does not
   *  vanish once its person is settled. */
  unresolvedPeople: readonly UnresolvedPerson[];
  rejected: readonly RejectedRow[];
  duplicates: readonly DuplicateRow[];
  /** Date columns of one row finer than the period, summed (bi-weekly sheets). */
  subPeriods: readonly DuplicateRow[];
  /** Cells of one sheet row landing on the same person and period: they block Apply. */
  collisions: readonly ForecastCollision[];
  dropped: readonly DropReason[];
  /** Number columns left unread (header not a period). */
  ignoredColumns: readonly IgnoredColumn[];
  /** Rows above the header row that hold data (not read). */
  rowsAboveHeader: number;
  /** Non-blank rows below a repeated header row (not read). */
  rowsBelowRepeatedHeader: number;
  /** Always empty now that Claude cites no cells. */
  unread: UnreadCells;
  /** The default year headers without one were read in, when the preview's
   *  rows used it; the preview says so. */
  assumedYear: AssumedYear | undefined;
  /** The first rows the current mapping reads, for the mapping step. */
  sample: readonly ForecastRow[];
  notes: string;
  error: ForecastImportError | null;
  busy: boolean;
  /** True while a Claude read is in flight (the trigger then reads "Stop"). */
  claudeBusy: boolean;
  /** AI on and a key present: whether "Ask Claude" can run. */
  aiAvailable: boolean;
  loadFile: (file: File) => Promise<void>;
  selectSheet: (index: number) => void;
  /** The hand route over the current sheet: re-detect, preview or map. */
  detectColumns: () => void;
  editMapping: () => void;
  /** Preview with `next` (or the current mapping). */
  showPreview: (next?: ColumnMapping) => void;
  askClaude: () => Promise<void>;
  /** Aborts an in-flight read or Claude call. Sets no error. */
  cancel: () => void;
  apply: () => "applied" | "refused";
}

const SAMPLE_ROWS = 5;
const BYTES_PER_MB = 1024 * 1024;
const NO_OVERRIDES: ReadonlyMap<string, PersonOverride> = new Map();
const NO_ROWS: readonly ForecastRow[] = [];
const NO_COLLISIONS: readonly ForecastCollision[] = [];
const NO_UNREAD: UnreadCells = { cells: [], rows: [] };
const NO_AMBIGUITY: readonly ColumnAmbiguity[] = [];
const NO_CONFIRMATIONS: ReadonlyMap<string, string> = new Map();

/** What a confirmation of `field` is bound to in `m`: the header row, the
 *  hours column, or the period column (a wide reading's period columns). The
 *  `rows` question (round 9 I-W) is bound to what groups the rows: the header
 *  row, the person and the period column(s). */
function fieldValue(m: ColumnMapping, field: ColumnAmbiguity["field"]): string {
  if (field === "header") return String(m.headerRow);
  if (field === "rows") return [m.headerRow, m.person, fieldValue(m, "period")].join(":");
  if (field === "hours") return String(m.hours);
  return m.layout === "long" ? String(m.period) : (m.periodCols ?? []).join(",");
}

const confirmationKey = (layout: ColumnMapping["layout"], field: ColumnAmbiguity["field"]): string => `${layout}:${field}`;

/**
 * The questioned fields the user has not confirmed for the CURRENT mapping.
 * ★★ A confirmation belongs to a (layout, field) pair and to the value it
 * confirmed (fix 9 m-a): choosing the period in Long once also cleared the
 * Wide reading's question, so flipping back to Wide applied the very reading
 * that was questioned, and a round-trip that reset a chosen hours column kept
 * the gate cleared on the default.
 */
function unconfirmedOf(
  questioned: readonly ColumnAmbiguity[],
  confirmations: ReadonlyMap<string, string>,
  mapping: ColumnMapping | null,
): readonly ColumnAmbiguity[] {
  if (mapping === null || questioned.length === 0) return questioned;
  const open = questioned.filter((a) => confirmations.get(confirmationKey(mapping.layout, a.field)) !== fieldValue(mapping, a.field));
  return open.length === questioned.length ? questioned : open;
}

/** `next` settles an ambiguous field: the user chose its column in the long
 *  layout (a different one than before, even if they come back). ★★ A layout
 *  change confirms nothing: Wide, then Long, rebuilds the long mapping from the
 *  defaults — the very preselection in question — and once cleared the gate on
 *  the way (rr7 I2). */
function confirmsField(a: ColumnAmbiguity, before: ColumnMapping | null, next: ColumnMapping): boolean {
  if (before === null || before.layout !== next.layout) return false;
  // The header row has a select in either layout (fix 9 OOS-c).
  if (a.field === "header") return next.headerRow !== before.headerRow;
  // Only "These columns are right" accepts one person's differing rows (round 9 I-W).
  if (a.field === "rows") return false;
  return next.layout === "long" && next[a.field] !== before[a.field];
}

/** Every field of a `ColumnMapping` but the period columns, compared apart. */
const MAPPING_FIELDS = ["layout", "headerRow", "person", "email", "rate", "period", "hours", "year", "yearCol"] as const;

/** Two mappings read the sheet the same way, every field (the year and the
 *  period columns included) by VALUE: the press confirmed THIS mapping, and a
 *  freshly built copy of it is still that mapping. */
function isSameMapping(a: ColumnMapping, b: ColumnMapping): boolean {
  return MAPPING_FIELDS.every((field) => a[field] === b[field]) && (a.periodCols ?? []).join(",") === (b.periodCols ?? []).join(",");
}

/** The message for a failed Claude read, or null for an abort (the user's own
 *  stop is not an error). Mirrors the other forced-call features' mapping. */
export function forecastImportErrorOf(e: unknown): ForecastImportError | null {
  const errName = e instanceof Error ? e.name : (e as { name?: string } | null)?.name;
  if (errName === "AbortError") return null;
  if (e instanceof Error && !(e instanceof AiHttpError) && e.message === "too-large") {
    return { key: "forecastImportErrorTooLargeForClaude" };
  }
  if (e instanceof Error && !(e instanceof AiHttpError) && e.message === "bad-mapping") {
    return { key: "forecastImportErrorBadMapping" };
  }
  if (e instanceof AiHttpError && classifyAiError(e.status, e.errorType) === "limit") return { key: "aiUsageLimitReached" };
  const keyMsg = aiKeyMessageKeyForError(e);
  if (keyMsg) return { key: keyMsg };
  if (e instanceof AiHttpError && e.safeMessage) return { message: e.safeMessage };
  return { key: "forecastImportErrorAi" };
}

/** A wide mapping over a chosen header row: every header cell that reads as a
 *  period becomes a period column, except the person / email / rate columns
 *  and totals. `year` reads headers without a year ("Jan") and is kept on
 *  the mapping. The header is read as a run (`assignRunPeriods`), exactly as
 *  `gridToForecastRows` will read it. */
export function wideMappingFor(
  rows: readonly string[][],
  headerRow: number,
  cols: { person: number; email?: number; rate?: number },
  year?: number,
  numbers?: NumberOrigin,
): ColumnMapping {
  const header = rows[headerRow] ?? [];
  const taken = new Set([cols.person, cols.email, cols.rate].filter((c): c is number => c !== undefined));
  const run = assignRunPeriods(header, { defaultYear: year, numbers });
  const periodCols = header.flatMap((cell, col) =>
    !taken.has(col) && !isTotalLabel(cell) && run[col] !== null ? [col] : [],
  );
  const mapping: ColumnMapping = { layout: "wide", headerRow, person: cols.person };
  if (cols.email !== undefined) mapping.email = cols.email;
  if (cols.rate !== undefined) mapping.rate = cols.rate;
  mapping.periodCols = periodCols;
  if (year !== undefined) mapping.year = year;
  return mapping;
}

/** The columns the mapping step starts from when nothing was detected:
 *  header row 1, person in column A, every header period a period column. */
export function defaultMappingFor(rows: readonly string[][], year?: number, numbers?: NumberOrigin): ColumnMapping {
  return wideMappingFor(rows, 0, { person: 0 }, year, numbers);
}

/** The year a header without one is read in by default: the target bucket's
 *  start year. */
export function bucketStartYear(bucket: BudgetBucket): number | undefined {
  const year = Number(bucket.startDate.slice(0, 4));
  return Number.isInteger(year) && year > 0 ? year : undefined;
}

/** `detectLayout` over one sheet, read the way its file stores numbers. */
function detectSheet(grid: SheetGrid, year: number | undefined): LayoutDetection {
  return detectLayout(grid.rows, { numbers: grid.numbers, defaultYear: year });
}

/** The first sheet a layout is found on (else the first sheet), with its
 *  detection, so a load detects each sheet at most once. */
function firstDetectedSheet(
  sheets: readonly SheetGrid[],
  year: number | undefined,
): { index: number; detected: LayoutDetection } {
  let first: LayoutDetection | null = null;
  for (let index = 0; index < sheets.length; index++) {
    const detected = detectSheet(sheets[index], year);
    first ??= detected;
    if (detected.kind !== "unknown") return { index, detected };
  }
  return { index: 0, detected: first ?? detectSheet(sheets[0], year) };
}

type Validated = ReturnType<typeof validateForecastRows>;

export function useForecastImport(deps: ForecastImportDeps): ForecastImport {
  const { buckets, resources, roles, plan, holidaySet, onChangeBuckets } = deps;
  const bucketId = deps.bucket.id;
  const startYear = bucketStartYear(deps.bucket);
  const { settings } = useSettings();
  const guideText = useActionGuideText("forecastImport");
  const apiKey = aiKeyIfEnabled(settings.ai);
  const model = settings.ai.model;
  const aiAvailable = isAiEnabled(settings.ai) && apiKey !== "";

  const [step, setStep] = useState<ForecastImportStep>("source");
  const [sheets, setSheets] = useState<readonly SheetGrid[]>([]);
  const [sheetIndex, setSheetIndex] = useState(0);
  const [mapping, setMappingState] = useState<ColumnMapping | null>(null);
  const [layoutDetected, setLayoutDetected] = useState(false);
  // The fields detection questioned, and what the user confirmed (`unconfirmedOf`).
  const [questioned, setQuestioned] = useState<readonly ColumnAmbiguity[]>(NO_AMBIGUITY);
  const [confirmations, setConfirmations] = useState<ReadonlyMap<string, string>>(NO_CONFIRMATIONS);
  const [route, setRoute] = useState<ForecastImportRoute>("hand");
  // The Claude route's press: the mapping "These columns are right" confirmed.
  const [claudeConfirmed, setClaudeConfirmed] = useState<ColumnMapping | null>(null);
  const [notes, setNotes] = useState("");
  const [overrides, setOverrides] = useState<ReadonlyMap<string, PersonOverride>>(NO_OVERRIDES);
  const [error, setError] = useState<ForecastImportError | null>(null);
  const [busy, setBusy] = useState<false | "file" | "claude">(false);
  // ★ ONE year value: detection and the mapping read year-less headers in it.
  // It starts at the bucket's start year and follows the mapping step's year
  // field; a CLEARED field means no default year on both routes (Claude's
  // mapping takes it when it names no year of its own).
  const [year, setYear] = useState<number | undefined>(startYear);

  // Monotonic request generation: a read or a Claude reply that resolves after
  // a newer action (or a cancel) is discarded.
  const reqIdRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  // Cleanup-only: abort an in-flight call on unmount. Sets no state.
  useEffect(() => () => abortRef.current?.abort(), []);

  const sheet: SheetGrid | undefined = sheets[sheetIndex];
  const liveBucket = buckets.find((b) => b.id === bucketId);
  const isClaude = route === "claude";
  // The Claude route asks every question of the mapping in effect, live.
  const claudeQuestions = useMemo(
    () => (isClaude && sheet && mapping ? questionsFor(sheet.rows, mapping, { numbers: sheet.numbers }) : NO_AMBIGUITY),
    [isClaude, sheet, mapping],
  );
  const claudePressed = isClaude && claudeConfirmed !== null && mapping !== null && isSameMapping(claudeConfirmed, mapping);
  const unconfirmed = useMemo(
    () => (isClaude ? (claudePressed ? NO_AMBIGUITY : claudeQuestions) : unconfirmedOf(questioned, confirmations, mapping)),
    [isClaude, claudePressed, claudeQuestions, questioned, confirmations, mapping],
  );
  const claudeUnconfirmed = isClaude && !claudePressed;

  const handRows = useMemo(
    () => (sheet && mapping ? gridToForecastRows(sheet.rows, mapping, sheet.name, sheet.numbers) : null),
    [sheet, mapping],
  );

  // Both routes read the sheet by the mapping in effect.
  const validated = useMemo<Validated | null>(
    () => (sheet && handRows ? validateForecastRows(handRows.rows, { sheet, requireSource: false, defaultYear: year }) : null),
    [sheet, handRows, year],
  );

  const okRows = validated?.ok ?? NO_ROWS;
  const collisions = validated?.collisions ?? NO_COLLISIONS;
  const canPreview = step === "preview" && validated !== null && liveBucket !== undefined;

  const importPlan = useMemo(
    () => (canPreview && liveBucket
      ? buildForecastImportPlan(okRows, { bucket: liveBucket, resources, roles, plan, holidaySet, overrides, collisions })
      : null),
    [canPreview, liveBucket, okRows, resources, roles, plan, holidaySet, overrides, collisions],
  );
  const unresolvedPeople = useMemo(
    () => (canPreview && liveBucket
      ? buildForecastImportPlan(okRows, { bucket: liveBucket, resources, roles, plan, holidaySet, overrides: NO_OVERRIDES }).unresolved
      : []),
    [canPreview, liveBucket, okRows, resources, roles, plan, holidaySet],
  );

  /** Abandons whatever is in flight and returns the new request's id. */
  const nextRequest = useCallback((): number => {
    abortRef.current?.abort();
    abortRef.current = null;
    reqIdRef.current += 1;
    return reqIdRef.current;
  }, []);

  /** The hand route over one sheet: preview when a layout is found and clear,
   *  else the mapping step. `known` is a detection the caller already ran on
   *  `grid`. Every detection starts its own confirmation. */
  const openHandRoute = useCallback((grid: SheetGrid, known?: LayoutDetection) => {
    const detected = known ?? detectSheet(grid, year);
    setRoute("hand");
    setClaudeConfirmed(null);
    setNotes("");
    setOverrides(NO_OVERRIDES);
    setLayoutDetected(detected.mapping !== null);
    setMappingState(detected.mapping ?? defaultMappingFor(grid.rows, year, grid.numbers));
    setQuestioned(detected.ambiguous);
    setConfirmations(NO_CONFIRMATIONS);
    setStep(detected.mapping && detected.ambiguous.length === 0 ? "preview" : "mapping");
  }, [year]);

  const loadFile = useCallback(async (file: File) => {
    const reqId = nextRequest();
    setError(null);
    setBusy(false);
    // Size first: a 2 GB file must never be read into memory to find out.
    if (checkAttachmentSize(file.size) !== null) {
      setSheets([]);
      setStep("source");
      setError({ key: "forecastImportErrorFileTooLarge", args: [String(MAX_ATTACHMENT_BYTES / BYTES_PER_MB)] });
      return;
    }
    setBusy("file");
    try {
      const grids = await readSheetFile(file.name, new Uint8Array(await file.arrayBuffer()));
      if (reqId !== reqIdRef.current) return;
      if (grids.length === 0) throw new Error("empty");
      const { index, detected } = firstDetectedSheet(grids, year);
      setSheets(grids);
      setSheetIndex(index);
      openHandRoute(grids[index], detected);
    } catch (e) {
      if (reqId !== reqIdRef.current) return;
      setSheets([]);
      setStep("source");
      setError({ key: e instanceof Error && e.message === "unsupported" ? "forecastImportErrorUnsupported" : "forecastImportErrorUnreadable" });
    } finally {
      if (reqId === reqIdRef.current) setBusy(false);
    }
  }, [nextRequest, openHandRoute, year]);

  const selectSheet = useCallback((index: number) => {
    const grid = sheets[index];
    if (!grid) return;
    nextRequest();
    setBusy(false);
    setError(null);
    setSheetIndex(index);
    openHandRoute(grid);
  }, [sheets, nextRequest, openHandRoute]);

  const detectColumns = useCallback(() => {
    if (!sheet) return;
    nextRequest();
    setBusy(false);
    setError(null);
    openHandRoute(sheet);
  }, [sheet, nextRequest, openHandRoute]);

  // ★ The four user edits below each clear a stale error: a banner from an
  // earlier failed action must not outlive the user moving on. ★★ An edit
  // keeps the route: Claude's mapping, edited, still waits for the press.
  const setMapping = useCallback((next: ColumnMapping | null) => {
    setError(null);
    setMappingState(next);
    if (next !== null) {
      setYear(next.year);
      const chosen = isClaude ? [] : questioned.filter((a) => confirmsField(a, mapping, next));
      if (chosen.length > 0) {
        setConfirmations((prev) => {
          const out = new Map(prev);
          for (const a of chosen) out.set(confirmationKey(next.layout, a.field), fieldValue(next, a.field));
          return out;
        });
      }
    }
  }, [isClaude, mapping, questioned]);

  // "These columns are right": confirms every questioned field as the current
  // mapping reads it, and on the Claude route the mapping itself.
  const confirmColumns = useCallback(() => {
    setError(null);
    if (mapping === null) return;
    if (isClaude) {
      setClaudeConfirmed(mapping);
      return;
    }
    setConfirmations((prev) => {
      const out = new Map(prev);
      for (const a of questioned) out.set(confirmationKey(mapping.layout, a.field), fieldValue(mapping, a.field));
      return out;
    });
  }, [isClaude, mapping, questioned]);

  const editMapping = useCallback(() => {
    setError(null);
    setStep("mapping");
  }, []);

  const showPreview = useCallback((next?: ColumnMapping) => {
    const chosen = next ?? mapping;
    if (!chosen) return;
    setError(null);
    setMappingState(chosen);
    setYear(chosen.year);
    setStep("preview");
  }, [mapping]);

  const setOverride = useCallback((person: string, value: PersonOverride) => {
    setError(null);
    setOverrides((prev) => new Map(prev).set(normalisePerson(person), value));
  }, []);

  const askClaude = useCallback(async () => {
    if (!sheet || !aiAvailable) return;
    const reqId = nextRequest();
    const controller = new AbortController();
    abortRef.current = controller;
    setError(null);
    setBusy("claude");
    try {
      const res = await runForecastImportCall(sheet, { apiKey, model, guideText }, controller.signal);
      if (reqId !== reqIdRef.current) return;
      // A mapping that names no year reads year-less labels in the year in effect.
      const proposed: ColumnMapping = res.mapping.year === undefined && year !== undefined ? { ...res.mapping, year } : res.mapping;
      setMappingState(proposed);
      setYear(proposed.year);
      setClaudeConfirmed(null);
      setNotes(res.notes);
      setOverrides(NO_OVERRIDES);
      setRoute("claude");
      setStep("mapping");
    } catch (e) {
      if (reqId !== reqIdRef.current) return;
      setError(forecastImportErrorOf(e));
    } finally {
      if (reqId === reqIdRef.current) {
        abortRef.current = null;
        setBusy(false);
      }
    }
  }, [sheet, aiAvailable, nextRequest, apiKey, model, guideText, year]);

  const cancel = useCallback(() => {
    nextRequest();
    setBusy(false);
  }, [nextRequest]);

  const apply = useCallback((): "applied" | "refused" => {
    const live = buckets.find((b) => b.id === bucketId);
    const refuse = (key: TranslationKey = "forecastImportRefused"): "refused" => {
      setError({ key });
      return "refused";
    };
    // Outside the preview the user has reviewed nothing. No message: Apply is
    // disabled there, and the bucket did not change.
    if (step !== "preview") return "refused";
    // Claude's mapping is never applied before the user's press, and an
    // ambiguous mapping never before its fields are confirmed.
    if (claudeUnconfirmed) return refuse("forecastImportConfirmClaudeFirst");
    if (unconfirmed.length > 0) return refuse("forecastImportConfirmFirst");
    if (!live || !validated || live.status === "closed" || plan.budgetFollowsPlan === true) return refuse();
    const fresh = buildForecastImportPlan(validated.ok, {
      bucket: live, resources, roles, plan, holidaySet, overrides, collisions: validated.collisions,
    });
    // The refusal names its cause: a collision, or nothing left to change (the
    // same hours applied elsewhere first) is not "the bucket changed" (final
    // review M3). Closed / follows-plan are caught above with that message.
    if (fresh.blockers.includes("same-row-period")) return refuse("forecastImportRefusedSameRow");
    if (fresh.blockers.includes("nothing-to-apply")) return refuse("forecastImportRefusedNothing");
    if (fresh.blockers.length > 0) return refuse();
    const next = { ...applyForecastImport(live, fresh), localModifiedAt: new Date().toISOString() };
    onChangeBuckets(buckets.map((b) => (b.id === bucketId ? next : b)), { kind: "budget.updated", name: live.name });
    return "applied";
  }, [step, claudeUnconfirmed, unconfirmed, buckets, bucketId, validated, plan, resources, roles, holidaySet, overrides, onChangeBuckets]);

  return {
    step,
    sheets,
    sheetIndex,
    mapping,
    layoutDetected,
    ambiguous: unconfirmed,
    claudeUnconfirmed,
    confirmColumns,
    bucketGone: liveBucket === undefined,
    setMapping,
    route,
    overrides,
    setOverride,
    importPlan,
    unresolvedPeople,
    rejected: validated?.rejected ?? [],
    duplicates: validated?.duplicates ?? [],
    subPeriods: validated?.subPeriods ?? [],
    collisions,
    dropped: handRows?.dropped ?? [],
    ignoredColumns: handRows?.ignoredColumns ?? [],
    rowsAboveHeader: handRows?.rowsAboveHeader ?? 0,
    rowsBelowRepeatedHeader: handRows?.rowsBelowRepeatedHeader ?? 0,
    assumedYear: handRows?.assumedYear,
    unread: NO_UNREAD,
    sample: handRows ? handRows.rows.slice(0, SAMPLE_ROWS) : NO_ROWS,
    notes,
    error,
    busy: busy !== false,
    claudeBusy: busy === "claude",
    aiAvailable,
    loadFile,
    selectSheet,
    detectColumns,
    editMapping,
    showPreview,
    askClaude,
    cancel,
    apply,
  };
}
