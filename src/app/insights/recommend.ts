// Pure, i18n-free. Forced-tool contract for insight recommendations + untrusted
// output validation. Constrains the model to a safe subset of the chat write
// tools and re-grounds every entity id against the live workspace, so a
// hallucinated id can never reach runTool. No React/fetch/i18n.
import type { GroundingIndex, GroundableView } from "../action-ai";
import type { InsightRecommendation, InsightToolCall } from "./insight";
import { INSIGHT_REC_MAX_CALLS, INSIGHT_REC_SUMMARY_MAX, ALLOWED_REC_TOOLS } from "./insight";
import { REC_CALL_ITEM_SCHEMA, recCallItemSchema } from "./recommend-schema";
import { toolOffered, type PeopleToolFlags } from "../chat-tool-defs";

// Re-export so existing importers of `./recommend` (tests, call sites) are unchanged.
export { ALLOWED_REC_TOOLS };

// update_* tool → the grounding view whose id-set it targets. create_* mint a
// new row (no id to ground) so they are not listed here.
const UPDATE_VIEW: Record<string, GroundableView> = {
  update_task: "open-points",
  update_raid_item: "raid",
  update_milestone: "milestones",
  update_change: "changes",
  update_stakeholder: "stakeholders",
};

function groundCall(name: string, input: Record<string, unknown>, index: GroundingIndex): boolean {
  const view = UPDATE_VIEW[name];
  if (!view) return true; // create_* — nothing to ground
  const id = typeof input.id === "number" ? input.id : Number(input.id);
  if (!Number.isInteger(id)) return false;
  return index[view].has(id);
}

/** Validate + ground the model's untrusted tool_use output against the live
 *  workspace. Returns null when nothing usable survives; individual malformed
 *  or hallucinated calls are dropped, not fatal to the whole recommendation. */
export function parseRecommendation(input: unknown, index: GroundingIndex): InsightRecommendation | null {
  if (!input || typeof input !== "object") return null;
  const o = input as { summary?: unknown; calls?: unknown };
  const summary = typeof o.summary === "string" ? o.summary.trim().slice(0, INSIGHT_REC_SUMMARY_MAX) : "";
  if (!summary || !Array.isArray(o.calls)) return null;
  const calls: InsightToolCall[] = [];
  for (const raw of o.calls) {
    if (!raw || typeof raw !== "object") continue;
    const c = raw as { name?: unknown; input?: unknown };
    if (typeof c.name !== "string" || !ALLOWED_REC_TOOLS.has(c.name)) continue;
    if (!c.input || typeof c.input !== "object" || Array.isArray(c.input)) continue;
    const inputObj = c.input as Record<string, unknown>;
    if (!groundCall(c.name, inputObj, index)) continue;
    calls.push({ name: c.name, input: inputObj });
    if (calls.length >= INSIGHT_REC_MAX_CALLS) break;
  }
  if (calls.length === 0) return null;
  // generatedAt/status are stamped/owned by the caller (generatedAt needs
  // `today`, which this fn must not read to stay clock-free) — the call site
  // overwrites generatedAt; status defaults to the initial lifecycle value.
  return { summary, proposedCalls: calls, generatedAt: "", status: "proposed" };
}

function recommendTool(items: typeof REC_CALL_ITEM_SCHEMA) {
  return {
    name: "propose_insight_actions",
    description: "Propose concrete, applicable actions that resolve the given project insight. Call exactly once.",
    input_schema: {
      type: "object" as const,
      properties: {
        summary: { type: "string", description: "One line: what to do and why." },
        calls: {
          type: "array",
          description:
            "Concrete tool calls that fix the insight. Use only the listed tools; reference only ids present in the digest. Give every required argument of the tool; an update_* call names its target by the numeric id shown in the digest.",
          // §782 — each tool with its own arguments, from the chat tool definitions.
          items,
        },
      },
      required: ["summary", "calls"],
    },
  } as const;
}

/** The allowed tools chat's predicate (`toolWithheldBy`) offers under `flags`, in their order: each tool withheld on
 *  its own (people protection, or the function that owns it hidden, §810), never as a whole union, so a switch
 *  can never drop a tool it does not own. ★ `ALLOWED_REC_TOOLS` itself is NOT narrowed: it is the confirm path's
 *  security allowlist, and the confirm path still refuses a withheld call at the executor. */
export function offeredRecTools(allowed: Iterable<string>, flags: PeopleToolFlags): string[] {
  return [...allowed].filter((name) => toolOffered(name, flags));
}

/** One tool per offered set, so a request's tool list keeps one identity per answer. */
const RECOMMEND_TOOL_BY_OFFER = new Map<string, ReturnType<typeof recommendTool>>();

/** The tool to offer: every allowed tool, or the ones `offeredRecTools` keeps. */
export function recommendToolFor(flags: PeopleToolFlags) {
  const names = offeredRecTools(ALLOWED_REC_TOOLS, flags);
  if (names.length === ALLOWED_REC_TOOLS.size) return RECOMMEND_TOOL;
  const key = names.join(",");
  const cached = RECOMMEND_TOOL_BY_OFFER.get(key);
  if (cached) return cached;
  const built = recommendTool(recCallItemSchema(names));
  RECOMMEND_TOOL_BY_OFFER.set(key, built);
  return built;
}

/** Anthropic tool definition. Forced via tool_choice. */
export const RECOMMEND_TOOL = recommendTool(REC_CALL_ITEM_SCHEMA);
