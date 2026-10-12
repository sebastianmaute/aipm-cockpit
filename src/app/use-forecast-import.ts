"use client";

// The forecast import's state machine (§500): a spreadsheet file becomes sheet
// grids, one sheet becomes forecast rows (by its detected or hand-set columns,
// or by Claude), the rows are validated, and the plan is a diff against ONE
// budget bucket. Nothing is written until `apply()`.
//
// ★★ APPLY RE-PLANS FROM THE LIVE BUCKETS. The preview can sit open while the
// bucket is closed, removed, or "Budget hours follow plan" is switched on;
// `apply()` looks the bucket up by id in the `buckets` it is rendered with NOW,
// rebuilds the plan, and refuses (writes nothing) unless that plan is clean.
// The preview's own plan is derived from the same live inputs, so its Apply
// button disables too — but the refusal here is what holds under a race.
//
// ★ The Claude route's rows are UNTRUSTED: they pass `validateForecastRows`
// with `requireSource: true`, which rejects a row whose cited cell does not
// hold its hours. The hand route's rows carry sources too, but are checked
// without that requirement — they were read from the grid, not proposed.
//
// SECURITY: the api key is read from the in-memory hydrated settings and goes
// straight to the call; it is never logged.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { applyForecastImport, buildForecastImportPlan, normalisePerson, type ImportPlan, type PersonOverride, type UnresolvedPerson } from "./budget-import/forecast-plan";
import { gridToForecastRows, isTotalLabel, parsePeriodLabel } from "./budget-import/forecast-rows";
import type { ColumnMapping, DropReason, ForecastRow } from "./budget-import/forecast-types";
import { validateForecastRows, type DuplicateRow, type RejectedRow } from "./budget-import/forecast-validate";
import { detectLayout } from "./budget-import/layout-detect";
import { readSheetFile, type SheetGrid } from "./budget-import/sheet-grid";
import { runForecastImportCall } from "./forecast-import-call";
import { AiHttpError, classifyAiError } from "./ai-errors";
import { aiKeyMessageKeyForError } from "./ai-key-status";
import { useActionGuideText } from "./action-guides-context";
import { checkAttachmentSize } from "./chat-attachments";
import type { TranslationKey } from "./i18n";
import { aiKeyIfEnabled, isAiEnabled } from "./settings-types";
import type { BudgetBucket, Resource, ResourcePlan, Role } from "./types";
import type { BucketCommitMeta } from "./use-budget-buckets";
import { useSettings } from "./use-settings";

export type ForecastImportStep = "source" | "mapping" | "preview";
export type ForecastImportRoute = "hand" | "claude";
/** A translated message, or a provider's own safe message shown verbatim. */
export type ForecastImportError = { key: TranslationKey } | { message: string };

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
  mapping: ColumnMapping | null;
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
  dropped: readonly DropReason[];
  /** The first rows the current hand mapping reads, for the mapping step. */
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
  /** Preview with `next` (or the current mapping) as the hand route. */
  showPreview: (next?: ColumnMapping) => void;
  askClaude: () => Promise<void>;
  /** Aborts an in-flight read or Claude call. Sets no error. */
  cancel: () => void;
  apply: () => "applied" | "refused";
}

const SAMPLE_ROWS = 5;
const NO_OVERRIDES: ReadonlyMap<string, PersonOverride> = new Map();
const NO_ROWS: readonly ForecastRow[] = [];

/** The message for a failed Claude read, or null for an abort (the user's own
 *  stop is not an error). Mirrors the other forced-call features' mapping. */
export function forecastImportErrorOf(e: unknown): ForecastImportError | null {
  const errName = e instanceof Error ? e.name : (e as { name?: string } | null)?.name;
  if (errName === "AbortError") return null;
  if (e instanceof Error && !(e instanceof AiHttpError) && e.message === "too-large") {
    return { key: "forecastImportErrorTooLargeForClaude" };
  }
  if (e instanceof AiHttpError && classifyAiError(e.status, e.errorType) === "limit") return { key: "aiUsageLimitReached" };
  const keyMsg = aiKeyMessageKeyForError(e);
  if (keyMsg) return { key: keyMsg };
  if (e instanceof AiHttpError && e.safeMessage) return { message: e.safeMessage };
  return { key: "forecastImportErrorAi" };
}

/** A wide mapping over a chosen header row: every header cell that reads as a
 *  period becomes a period column, except the person / email / rate columns
 *  and totals. */
export function wideMappingFor(
  rows: readonly string[][],
  headerRow: number,
  cols: { person: number; email?: number; rate?: number },
): ColumnMapping {
  const header = rows[headerRow] ?? [];
  const taken = new Set([cols.person, cols.email, cols.rate].filter((c): c is number => c !== undefined));
  const periodCols = header.flatMap((cell, col) =>
    !taken.has(col) && !isTotalLabel(cell) && parsePeriodLabel(cell) !== null ? [col] : [],
  );
  const mapping: ColumnMapping = { layout: "wide", headerRow, person: cols.person };
  if (cols.email !== undefined) mapping.email = cols.email;
  if (cols.rate !== undefined) mapping.rate = cols.rate;
  mapping.periodCols = periodCols;
  return mapping;
}

/** The first sheet a layout is found on, else the first sheet. */
function firstDetectedSheet(sheets: readonly SheetGrid[]): number {
  const found = sheets.findIndex((s) => detectLayout(s.rows).kind !== "unknown");
  return found < 0 ? 0 : found;
}

type Validated = ReturnType<typeof validateForecastRows>;

export function useForecastImport(deps: ForecastImportDeps): ForecastImport {
  const { buckets, resources, roles, plan, holidaySet, onChangeBuckets } = deps;
  const bucketId = deps.bucket.id;
  const { settings } = useSettings();
  const guideText = useActionGuideText("forecastImport");
  const apiKey = aiKeyIfEnabled(settings.ai);
  const model = settings.ai.model;
  const aiAvailable = isAiEnabled(settings.ai) && apiKey !== "";

  const [step, setStep] = useState<ForecastImportStep>("source");
  const [sheets, setSheets] = useState<readonly SheetGrid[]>([]);
  const [sheetIndex, setSheetIndex] = useState(0);
  const [mapping, setMappingState] = useState<ColumnMapping | null>(null);
  const [route, setRoute] = useState<ForecastImportRoute>("hand");
  const [claudeRows, setClaudeRows] = useState<unknown>(null);
  const [notes, setNotes] = useState("");
  const [overrides, setOverrides] = useState<ReadonlyMap<string, PersonOverride>>(NO_OVERRIDES);
  const [error, setError] = useState<ForecastImportError | null>(null);
  const [busy, setBusy] = useState<false | "file" | "claude">(false);

  // Monotonic request generation: a read or a Claude reply that resolves after
  // a newer action (or a cancel) is discarded.
  const reqIdRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  // Cleanup-only: abort an in-flight call on unmount. Sets no state.
  useEffect(() => () => abortRef.current?.abort(), []);

  const sheet: SheetGrid | undefined = sheets[sheetIndex];
  const liveBucket = buckets.find((b) => b.id === bucketId);

  const handRows = useMemo(
    () => (sheet && mapping ? gridToForecastRows(sheet.rows, mapping, sheet.name) : null),
    [sheet, mapping],
  );

  const validated = useMemo<Validated | null>(() => {
    if (!sheet) return null;
    if (route === "claude") return validateForecastRows(claudeRows, { sheet, requireSource: true });
    return handRows ? validateForecastRows(handRows.rows, { sheet, requireSource: false }) : null;
  }, [sheet, route, claudeRows, handRows]);

  const okRows = validated?.ok ?? NO_ROWS;
  const canPreview = step === "preview" && validated !== null && liveBucket !== undefined;

  const importPlan = useMemo(
    () => (canPreview && liveBucket
      ? buildForecastImportPlan(okRows, { bucket: liveBucket, resources, roles, plan, holidaySet, overrides })
      : null),
    [canPreview, liveBucket, okRows, resources, roles, plan, holidaySet, overrides],
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

  /** The hand route over one sheet: preview when a layout is found, else the mapping step. */
  const openHandRoute = useCallback((grid: SheetGrid) => {
    const detected = detectLayout(grid.rows);
    setRoute("hand");
    setClaudeRows(null);
    setNotes("");
    setOverrides(NO_OVERRIDES);
    setMappingState(detected.mapping);
    setStep(detected.mapping ? "preview" : "mapping");
  }, []);

  const loadFile = useCallback(async (file: File) => {
    const reqId = nextRequest();
    setError(null);
    setBusy(false);
    // Size first: a 2 GB file must never be read into memory to find out.
    if (checkAttachmentSize(file.size) !== null) {
      setSheets([]);
      setStep("source");
      setError({ key: "forecastImportErrorFileTooLarge" });
      return;
    }
    setBusy("file");
    try {
      const grids = await readSheetFile(file.name, new Uint8Array(await file.arrayBuffer()));
      if (reqId !== reqIdRef.current) return;
      if (grids.length === 0) throw new Error("empty");
      const index = firstDetectedSheet(grids);
      setSheets(grids);
      setSheetIndex(index);
      openHandRoute(grids[index]);
    } catch (e) {
      if (reqId !== reqIdRef.current) return;
      setSheets([]);
      setStep("source");
      setError({ key: e instanceof Error && e.message === "unsupported" ? "forecastImportErrorUnsupported" : "forecastImportErrorUnreadable" });
    } finally {
      if (reqId === reqIdRef.current) setBusy(false);
    }
  }, [nextRequest, openHandRoute]);

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

  const setMapping = useCallback((next: ColumnMapping | null) => {
    setRoute("hand");
    setMappingState(next);
  }, []);

  const editMapping = useCallback(() => {
    setRoute("hand");
    setStep("mapping");
  }, []);

  const showPreview = useCallback((next?: ColumnMapping) => {
    const chosen = next ?? mapping;
    if (!chosen) return;
    setMappingState(chosen);
    setRoute("hand");
    setStep("preview");
  }, [mapping]);

  const setOverride = useCallback((person: string, value: PersonOverride) => {
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
      setClaudeRows(res.rows);
      setNotes(res.notes);
      setOverrides(NO_OVERRIDES);
      setRoute("claude");
      setStep("preview");
    } catch (e) {
      if (reqId !== reqIdRef.current) return;
      setError(forecastImportErrorOf(e));
    } finally {
      if (reqId === reqIdRef.current) {
        abortRef.current = null;
        setBusy(false);
      }
    }
  }, [sheet, aiAvailable, nextRequest, apiKey, model, guideText]);

  const cancel = useCallback(() => {
    nextRequest();
    setBusy(false);
  }, [nextRequest]);

  const apply = useCallback((): "applied" | "refused" => {
    const live = buckets.find((b) => b.id === bucketId);
    const refuse = (): "refused" => {
      setError({ key: "forecastImportRefused" });
      return "refused";
    };
    if (!live || !validated || live.status === "closed" || plan.budgetFollowsPlan === true) return refuse();
    const fresh = buildForecastImportPlan(validated.ok, { bucket: live, resources, roles, plan, holidaySet, overrides });
    if (fresh.blockers.length > 0) return refuse();
    const next = { ...applyForecastImport(live, fresh), localModifiedAt: new Date().toISOString() };
    onChangeBuckets(buckets.map((b) => (b.id === bucketId ? next : b)), { kind: "budget.updated", name: live.name });
    return "applied";
  }, [buckets, bucketId, validated, plan, resources, roles, holidaySet, overrides, onChangeBuckets]);

  return {
    step,
    sheets,
    sheetIndex,
    mapping,
    setMapping,
    route,
    overrides,
    setOverride,
    importPlan,
    unresolvedPeople,
    rejected: validated?.rejected ?? [],
    duplicates: validated?.duplicates ?? [],
    dropped: route === "hand" ? (handRows?.dropped ?? []) : [],
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
