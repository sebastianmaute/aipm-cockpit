// src/app/insights/recommend-schema.ts
//
// Pure, i18n-free. The per-tool input schemas `propose_insight_actions` offers
// the model, and the required-argument check the review plan and the apply loop
// both judge a proposed call by (§782).
//
// ★★ DERIVED FROM THE CHAT TOOLS, NEVER A SECOND COPY. Each schema is the chat
//  tool's own `input_schema` (`TOOL_DEFS`) minus `expectedToken`: the store
//  stamps that token itself (`recommend-tokens.ts`), so the model must not be
//  asked for it. The chat definitions are read, not edited, so what a chat call
//  accepts is unchanged.
// ★★ Before §782 the model was sent `input: {type:"object"}` and never told an
//  argument name, so it proposed a `create_task` without `taskName`/`assignee`;
//  the review showed it as a normal create and `runTool` threw at apply.
import { PEOPLE_TOOLS, TOOL_DEFS } from "../chat-tool-defs";
import { PERSON_FIELDS_BY_TOOL } from "../ai-person-fields";
import { sanitizeIsoDate } from "../sanitize-core";
import { ALLOWED_REC_TOOLS, type InsightToolCall } from "./insight";

interface InputSchema {
  readonly type: "object";
  readonly properties: Readonly<Record<string, unknown>>;
  readonly required: readonly string[];
}

type ChatDef = { name: string; input_schema: { properties?: Record<string, unknown>; required?: readonly string[] } };

/** The argument `recommend-tokens.ts` stamps on every `update_*` call. */
const STAMPED_ARG = "expectedToken";

function recSchema(def: ChatDef): InputSchema {
  const props = def.input_schema.properties ?? {};
  return {
    type: "object",
    properties: Object.fromEntries(Object.entries(props).filter(([k]) => k !== STAMPED_ARG)),
    required: (def.input_schema.required ?? []).filter((k) => k !== STAMPED_ARG),
  };
}

/** `ALLOWED_REC_TOOLS` → the input schema the model is offered for that tool. */
export const REC_TOOL_INPUT_SCHEMAS: Readonly<Record<string, InputSchema>> = Object.fromEntries(
  (TOOL_DEFS as unknown as readonly ChatDef[])
    .filter((d) => ALLOWED_REC_TOOLS.has(d.name))
    .map((d) => [d.name, recSchema(d)]),
);

/** One `calls[]` item per allowed tool: its name and its own input schema.
 *  ★ No `type` on the union itself: `withStrictTool` closes every `type:
 *   "object"` node it meets, and a closed object with no properties would leave
 *   the model only `{}` to send. It closes each BRANCH instead (`closeObjects`
 *   enters `anyOf`), and `matchesSchema` accepts a call that fits one branch, so
 *   a reply breaking its tool's schema is re-asked strict (§782 review).
 *  ★ An update's `id` is `type: "number"`, so a reply sending `id: "3"` (which
 *   `runTool` would accept through `Number()`) also counts as a mismatch and is
 *   re-asked strict, one extra request. Deliberate: `matchesSchema` is shared by
 *   every forced-call tool, and loosening its number check would accept strings
 *   for tools whose writers do not take them; the strict reply sends a number. */
function recCallItemSchema(names: readonly string[]) {
  return {
    anyOf: names.map((name) => ({
      type: "object" as const,
      properties: {
        name: { type: "string" as const, enum: [name] },
        input: REC_TOOL_INPUT_SCHEMAS[name],
      },
      required: ["name", "input"],
    })),
  };
}

export const REC_CALL_ITEM_SCHEMA = recCallItemSchema([...ALLOWED_REC_TOOLS]);

/** AI people protection (layer 1): the same union without the people tools (the stakeholder writers), for a
 *  request about a project that protects its people. ★ `ALLOWED_REC_TOOLS` itself is NOT narrowed — it is the
 *  confirm path's security allowlist; only what the model is OFFERED changes, by the executor's own
 *  predicate (`peopleToolsLive`), so offering and serving cannot disagree. */
export const REC_CALL_ITEM_SCHEMA_PEOPLE_PROTECTED = recCallItemSchema(
  [...ALLOWED_REC_TOOLS].filter((name) => !PEOPLE_TOOLS.has(name)),
);

/** Required arguments a writer also parses as a date: the dispatcher's
 *  `createTask` (`use-chat-dispatcher.ts`) and `sanitizeMilestone` both read
 *  them with `sanitizeIsoDate` and throw on "". */
const REQUIRED_DATE_ARGS: Readonly<Record<string, string>> = { create_task: "dueDate", create_milestone: "date" };

function isGiven(schema: unknown, value: unknown): boolean {
  const type = (schema as { type?: unknown } | undefined)?.type;
  // `runTool` reads an id with `Number()`, so a numeric string is accepted there.
  if (type === "number") return typeof value !== "boolean" && value !== null && value !== "" && Number.isFinite(Number(value));
  if (type === "string") return typeof value === "string" && value.trim() !== "";
  return value !== undefined && value !== null;
}

/** Why a call cannot be applied, as data, so a caller can word it in its own
 *  language (§782 round 3). Tool and argument names are identifiers and are
 *  never translated. */
export type RecCallProblem =
  | { readonly kind: "not-allowed"; readonly tool: string }
  | { readonly kind: "required"; readonly tool: string; readonly args: readonly string[] }
  | { readonly kind: "date"; readonly tool: string; readonly arg: string };

/** Words a `RecCallProblem` as display text. */
export type RecCallProblemFormat = (problem: RecCallProblem) => string;

/** The English wording, and the default where no language is known. It mirrors
 *  the `insightRecommendationCall*` strings in `i18n.ts`. */
export const formatRecCallProblemEn: RecCallProblemFormat = (p) => {
  if (p.kind === "not-allowed") return `${p.tool}: not allowed`;
  if (p.kind === "required") return `${p.tool}: ${p.args.join(", ")} required`;
  return `${p.tool}: ${p.arg} must be YYYY-MM-DD`;
};

/** Why `runTool` would refuse this call for its required arguments, as display
 *  text (`"create_task: taskName, assignee required"` by default, else as
 *  `format` words it), or null when it would not. Judges only what the WRITERS
 *  require; a field-level refusal is the plan's job (`describeEntityCalls`).
 *  ★★ The review plan and the apply loop both call this, so a call the review
 *   shows as refused is exactly a call the apply does not send.
 *  ★ AI people protection (R4): with `peopleProtected`, a person field is never required — it was
 *   stripped, and the writer then creates the row without it ("creates it unassigned"). */
export function recommendationCallProblem(
  call: InsightToolCall,
  format: RecCallProblemFormat = formatRecCallProblemEn,
  peopleProtected = false,
): string | null {
  const problem = recCallProblemOf(call, peopleProtected);
  return problem === null ? null : format(problem);
}

function recCallProblemOf(call: InsightToolCall, peopleProtected: boolean): RecCallProblem | null {
  const tool = call.name;
  const schema = REC_TOOL_INPUT_SCHEMAS[tool];
  if (!Object.hasOwn(REC_TOOL_INPUT_SCHEMAS, tool) || !schema) return { kind: "not-allowed", tool };
  const stripped = peopleProtected ? (PERSON_FIELDS_BY_TOOL[tool] ?? []) : [];
  const missing = schema.required.filter((k) => !stripped.includes(k) && !isGiven(schema.properties[k], call.input[k]));
  if (missing.length > 0) return { kind: "required", tool, args: missing };
  const dateArg = REQUIRED_DATE_ARGS[tool];
  if (dateArg !== undefined && sanitizeIsoDate(call.input[dateArg]) === "") return { kind: "date", tool, arg: dateArg };
  return null;
}
