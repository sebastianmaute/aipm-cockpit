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
import { TOOL_DEFS } from "../chat-tool-defs";
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
export const REC_CALL_ITEM_SCHEMA = {
  anyOf: [...ALLOWED_REC_TOOLS].map((name) => ({
    type: "object" as const,
    properties: {
      name: { type: "string" as const, enum: [name] },
      input: REC_TOOL_INPUT_SCHEMAS[name],
    },
    required: ["name", "input"],
  })),
};

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

/** Why `runTool` would refuse this call for its required arguments, as display
 *  text (`"create_task: taskName, assignee required"`), or null when it would
 *  not. Judges only what the WRITERS require; a field-level refusal is the
 *  plan's job (`describeEntityCalls`).
 *  ★★ The review plan and the apply loop both call this, so a call the review
 *   shows as refused is exactly a call the apply does not send. */
export function recommendationCallProblem(call: InsightToolCall): string | null {
  const schema = REC_TOOL_INPUT_SCHEMAS[call.name];
  if (!Object.hasOwn(REC_TOOL_INPUT_SCHEMAS, call.name) || !schema) return `${call.name}: not allowed`;
  const missing = schema.required.filter((k) => !isGiven(schema.properties[k], call.input[k]));
  if (missing.length > 0) return `${call.name}: ${missing.join(", ")} required`;
  const dateArg = REQUIRED_DATE_ARGS[call.name];
  if (dateArg !== undefined && sanitizeIsoDate(call.input[dateArg]) === "") return `${call.name}: ${dateArg} must be YYYY-MM-DD`;
  return null;
}
