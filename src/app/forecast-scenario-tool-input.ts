/** Strict input for the forecast scenario AI tools (§502) — pure, i18n-free, DOM-free. Strings here are
 *  model-facing English. */
import {
  DEFAULT_RAMP_WEEKS, MAX_SCENARIO_CHANGES, REFERENCE_ERRORS, SCENARIO_NAME_MAX,
  keepsAnyStoredReference, validateScenarioChange, validateScenarioDraft,
  type AddedPeopleWho, type ForecastScenario, type ScenarioChange, type ScenarioChangeError, type ScenarioError,
  type ValidationContext,
} from "./forecast-scenarios";
import { SUPPORTED_CURRENCIES, type BudgetCurrency } from "./types";

type Rec = Record<string, unknown>;
type Failure = { ok: false; error: string };
type Parsed<T> = { ok: true; value: T } | Failure;

const BAD_ROWS = `changes must be an array of at most ${MAX_SCENARIO_CHANGES} rows`;
const WHO_SHAPE = "who must be either {resourceId, hoursPerWeek} or {label, count, rate, currency, hoursPerWeek}";
const RESOURCE_KEYS = ["resourceId"];
const PLACEHOLDER_KEYS = ["label", "count", "rate", "currency"];

function isRec(v: unknown): v is Rec {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function ok<T>(value: T): Parsed<T> {
  return { ok: true, value };
}

function fail(error: string): Failure {
  return { ok: false, error };
}

/** A required finite number field, or a refusal naming it. Never coerces a string. */
function num(raw: Rec, key: string): Parsed<number> {
  const v = raw[key];
  return typeof v === "number" && Number.isFinite(v) ? ok(v) : fail(`${key} must be a number`);
}

function str(raw: Rec, key: string): Parsed<string> {
  const v = raw[key];
  return typeof v === "string" ? ok(v) : fail(`${key} must be a string`);
}

function optStr(raw: Rec, key: string, fallback: string): Parsed<string> {
  return raw[key] === undefined ? ok(fallback) : str(raw, key);
}

function optNum(raw: Rec, key: string, fallback: number): Parsed<number> {
  return raw[key] === undefined ? ok(fallback) : num(raw, key);
}

function parseWho(raw: unknown): Parsed<AddedPeopleWho> {
  if (!isRec(raw)) return fail(WHO_SHAPE);
  const hasResource = RESOURCE_KEYS.some((k) => k in raw);
  const hasPlaceholder = PLACEHOLDER_KEYS.some((k) => k in raw);
  if (hasResource === hasPlaceholder) return fail(WHO_SHAPE);
  const hours = num(raw, "hoursPerWeek");
  if (!hours.ok) return hours;
  if (hasResource) {
    const id = num(raw, "resourceId");
    return id.ok ? ok({ resourceId: id.value, hoursPerWeek: hours.value }) : id;
  }
  const label = str(raw, "label");
  if (!label.ok) return label;
  const count = num(raw, "count");
  if (!count.ok) return count;
  const rate = num(raw, "rate");
  if (!rate.ok) return rate;
  const currency = str(raw, "currency");
  if (!currency.ok) return currency;
  // Whether it is a supported currency is a range rule: `validateScenarioChange` words it.
  return ok({
    label: label.value, count: count.value, rate: rate.value,
    currency: currency.value as BudgetCurrency, hoursPerWeek: hours.value,
  });
}

function parseScope(raw: Rec): Parsed<ScenarioChange> {
  const tasks = num(raw, "tasks");
  if (!tasks.ok) return tasks;
  const on = str(raw, "on");
  if (!on.ok) return on;
  if (raw.milestoneId === undefined) return ok({ kind: "scope", tasks: tasks.value, on: on.value });
  const milestoneId = num(raw, "milestoneId");
  return milestoneId.ok
    ? ok({ kind: "scope", tasks: tasks.value, on: on.value, milestoneId: milestoneId.value })
    : milestoneId;
}

function parseDated(raw: Rec, kind: "availability" | "addPeople"): Parsed<ScenarioChange> {
  const from = str(raw, "from");
  if (!from.ok) return from;
  const until = optStr(raw, "until", "");
  if (!until.ok) return until;
  if (kind === "availability") {
    const percent = num(raw, "percent");
    return percent.ok ? ok({ kind, percent: percent.value, from: from.value, until: until.value }) : percent;
  }
  const rampWeeks = optNum(raw, "rampWeeks", DEFAULT_RAMP_WEEKS);
  if (!rampWeeks.ok) return rampWeeks;
  const who = parseWho(raw.who);
  if (!who.ok) return who;
  return ok({ kind, who: who.value, from: from.value, until: until.value, rampWeeks: rampWeeks.value });
}

function parseRow(raw: unknown): Parsed<ScenarioChange> {
  if (!isRec(raw)) return fail("must be an object");
  if (raw.kind === "scope") return parseScope(raw);
  if (raw.kind === "availability" || raw.kind === "addPeople") return parseDated(raw, raw.kind);
  return fail("kind must be one of availability, addPeople, scope");
}

/** Shape check only: the right primitive types, the defaults, no clamping. Range rules are
 *  `validateScenarioChange`'s job, in `checkToolDraft`. */
export function parseToolChanges(
  raw: unknown,
): { ok: true; changes: ScenarioChange[] } | { ok: false; error: string } {
  if (!Array.isArray(raw) || raw.length > MAX_SCENARIO_CHANGES) return fail(BAD_ROWS);
  const changes: ScenarioChange[] = [];
  for (const [i, item] of raw.entries()) {
    const row = parseRow(item);
    if (!row.ok) return fail(`changes[${i}]: ${row.error}`);
    changes.push(row.value);
  }
  return { ok: true, changes };
}

const DRAFT_TEXT: Readonly<Record<Exclude<ScenarioError, "name-taken">, string>> = {
  cap: "This project already has 4 saved scenarios, the most it can keep. Ask the user to delete one first.",
  "name-empty": "A scenario needs a name.",
  "name-long": `A scenario name can be at most ${SCENARIO_NAME_MAX} characters.`,
  "too-many-changes": `A scenario can hold at most ${MAX_SCENARIO_CHANGES} changes.`,
};

function rowText(error: ScenarioChangeError, c: ScenarioChange): string {
  const milestone = c.kind === "scope" ? c.milestoneId : undefined;
  const resource = c.kind === "addPeople" && "resourceId" in c.who ? c.who.resourceId : undefined;
  switch (error) {
    case "date": return "dates must be YYYY-MM-DD";
    case "until-before-from": return "until must be on or after from";
    case "percent": return "percent must be between 10 and 300";
    case "hours": return "hoursPerWeek must be between 1 and 60";
    case "count": return "count must be a whole number from 1 to 20";
    case "ramp": return "rampWeeks must be a whole number from 0 to 26";
    case "rate": return "rate must be between 0 and 100000";
    case "currency": return `currency must be one of ${SUPPORTED_CURRENCIES.join(", ")}`;
    case "label": return `label must be 1 to ${SCENARIO_NAME_MAX} characters`;
    case "tasks": return "tasks must be a non-zero whole number between -1000 and 1000";
    case "milestone-unknown": return `milestone ${milestone} does not exist`;
    case "milestone-finished": return `milestone ${milestone} is already achieved or cancelled`;
    case "resource-unknown": return `resource ${resource} does not exist`;
    case "resource-archived": return `resource ${resource} is archived`;
    case "on-team": return `resource ${resource} already works on this project; use an availability change instead`;
  }
}

/** Null when the draft may be saved, or the model-facing refusal. A reference that a stored row of the same
 *  scenario already kept is accepted even if it has gone stale since (spec §4.1/§4.1a). */
export function checkToolDraft(a: {
  name: string;
  changes: readonly ScenarioChange[];
  list: readonly ForecastScenario[];
  exceptId: number | null;
  stored: readonly ScenarioChange[];
  ctx: ValidationContext;
}): string | null {
  const draft = validateScenarioDraft({ name: a.name, changes: a.changes }, a.list, a.exceptId);
  if (draft === "name-taken") return `A scenario named "${a.name.trim()}" already exists. Choose another name.`;
  if (draft !== null) return DRAFT_TEXT[draft];
  const refusals: string[] = [];
  a.changes.forEach((c, i) => {
    const error = validateScenarioChange(c, a.ctx);
    if (error === null) return;
    if (REFERENCE_ERRORS.has(error) && keepsAnyStoredReference(a.stored, c)) return;
    refusals.push(`changes[${i}]: ${rowText(error, c)}`);
  });
  return refusals.length === 0 ? null : refusals.join("; ");
}
