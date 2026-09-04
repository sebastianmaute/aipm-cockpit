// src/app/insights/recommend-tokens.ts
//
// Pure, i18n-free. Stamps the optimistic-concurrency token onto a freshly
// generated recommendation's `update_*` calls, so the replay at apply time is
// checked against the workspace as it stood when the proposal was stored.
//
// ★★★ THE DERIVATION POINT IS THE WHOLE DESIGN, AND THE OBVIOUS ALTERNATIVE IS
// VACUOUS. Deriving the token at the call site immediately before dispatch —
// from the dispatcher's CURRENT row — would compare a value against the very
// read it came from, so `requireToken` could never refuse. For this path that
// is worse than no guard: a recommendation generated hours ago against a row
// that has since moved would be re-tokenised against exactly the state the
// guard exists to reject, and the stale write would commit while the code read
// as protected.
//
// ★★ WHAT THE STAMPED TOKEN ACTUALLY COVERS, stated as measured rather than as
// hoped: the window from the moment the proposal is STORED to the moment the
// user confirms it. That is the long window and the one that matters — a
// background-generated recommendation can sit unreviewed for days. It does NOT
// cover the model round-trip itself (context build → response), because the
// entities handed in here are the caller's live render-scope arrays at the
// moment the recommendation comes back, not a snapshot frozen when the prompt
// was built. Closing that remaining gap means threading an entity snapshot
// through `runInsightRecommendation`; it is deliberately not done here, and
// under-stating this bound would invite someone to "simplify" the derivation
// back to apply time.
//
// ★ A call whose target row is GONE is left unstamped on purpose. It then
// fails at replay with the dispatcher's own "not found", which is the more
// informative error — "changed since you read it" would send the reader
// looking for an edit to a row that no longer exists. `runTool` resolves
// not-found before the token for the same reason.
import { entityToken, type TokenEntity } from "../ai-entity-token";
import type { InsightRecommendation, InsightToolCall } from "./insight";
import type { RecommendPlanWorkspace } from "./recommend-plan";

/** The `update_*` tools a recommendation may propose → the token entity kind
 *  and the workspace list its rows live in.
 *
 *  ★★ THE `create_*` HALF OF `ALLOWED_REC_TOOLS` IS ABSENT BY DESIGN, not by
 *  omission: a create has no stored row to derive a token from, and no
 *  `create_*` tool is guarded. Any GUARDED tool added to the allow-set without
 *  a row here would be replayed with no token and refused outright — loud, and
 *  in the safe direction.
 *
 *  ★★★ THE ALLOW-SET IS NOT THE ONLY GATE ON THIS TABLE, AND THIS COMMENT'S
 *  REASONING DID NOT KNOW THAT. It named `set_task_dependencies` as guarded —
 *  correctly — and concluded "it is simply not in `ALLOWED_REC_TOOLS`, so this
 *  table is unaffected TODAY". That covers `stampRecommendationTokens`, which
 *  only ever sees allow-set members (filtered at generation, load and apply),
 *  and says nothing whatever about `stampCall`, whose OTHER consumer —
 *  `chat-proposal-describe.ts` — filters by no allow-set at all and whose own
 *  comment names `set_task_dependencies` as a call it emits a review row for.
 *  Generalising one caller's filter to the function is the failure shape here,
 *  not an incomplete list.
 *
 *  ★★ THE CONCLUSION HOLDS ANYWAY, FOR A REASON THE COMMENT NEVER GAVE AND
 *  THAT IS DUE TO EXPIRE — so do not read it as reassurance. `describeProposal`
 *  has no production caller: the staging feature is unwired, so nothing reaches
 *  this table by that route at present. When that wiring lands, an untokened
 *  `set_task_dependencies` matches no row, goes out unstamped, and
 *  `requireTaskWriteToken` refuses it at apply with nothing on that path able to
 *  mint the token it asks for — a user-visible refusal appearing with no
 *  warning, since no test or gate covers an unwired path. The row below exists
 *  BEFORE that wiring for exactly that reason; closing this afterwards means
 *  closing it under pressure. Enumerate the guarded set by what a schema
 *  advertises (`expectedTokenField`), never by the `update_*` name, and never by
 *  which set one caller happens to filter on.
 *
 *  ★★ `update_resource` IS GUARDED AND HAS NO ROW, and that omission is
 *  STRUCTURAL rather than an oversight — do not "complete the pattern" by
 *  adding one. The value type below is `key: keyof RecommendPlanWorkspace`, and
 *  that Pick (`recommend-plan.ts`) covers tasks · raid · changes · milestones ·
 *  stakeholders with no `"resources"`, so the row cannot be expressed without
 *  widening a type this file does not own. Consequence, which is the part worth
 *  knowing: a resource call carries ONLY the model's own token, so one arriving
 *  without it can never be applied. `chat-proposal-describe.test.ts` pins that
 *  half; the drift test in `recommend-tokens.test.ts` pins this table's gap
 *  against the schemas as EXACTLY that one tool, so closing it there turns the
 *  test red rather than leaving this note to rot. */
/** ★ EXPORTED FOR ITS DRIFT TEST, not for use as a tool allow-list. The test in
 *  `recommend-tokens.test.ts` asserts that every tool which is BOTH in
 *  `ALLOWED_REC_TOOLS` and token-guarded has a row here — the invariant the
 *  comment above states and which nothing enforced, so adding a guarded tool to
 *  the allow-set used to yield replays that are refused UNRETRYABLY on a path
 *  with no human in the loop. */
export const UPDATE_TARGET: Readonly<
  Record<string, { readonly kind: TokenEntity; readonly key: keyof RecommendPlanWorkspace }>
> = {
  update_task: { kind: "task", key: "tasks" },
  // Not an `update_*` tool and still a token-guarded task write: it replaces
  // the whole `dependencies` list from model input, and `dependencies` is in
  // `CSV_COLUMNS` and absent from `TOKEN_EXCLUDED.task`, so the task token
  // genuinely covers what this tool writes.
  set_task_dependencies: { kind: "task", key: "tasks" },
  update_raid_item: { kind: "raid", key: "raid" },
  update_milestone: { kind: "milestone", key: "milestones" },
  update_change: { kind: "change", key: "changes" },
  update_stakeholder: { kind: "stakeholder", key: "stakeholders" },
};

export function stampCall(call: InsightToolCall, ws: RecommendPlanWorkspace): InsightToolCall {
  const target = UPDATE_TARGET[call.name];
  if (!target) return call; // create_* — nothing to ground, nothing to token
  const id = Number((call.input as { id?: unknown }).id);
  if (!Number.isFinite(id)) return call; // malformed; the replay reports it
  const rows = ws[target.key] as ReadonlyArray<{ id: number }>;
  const row = rows.find((r) => r.id === id);
  if (!row) return call; // see the header: not-found is the better error
  return { ...call, input: { ...call.input, expectedToken: entityToken(target.kind, row) } };
}

/** A copy of `rec` whose every `update_*` call carries the `expectedToken` for
 *  its target row as that row stands NOW. Non-mutating: the input
 *  recommendation and its calls are left untouched (this value is persisted, so
 *  an in-place edit would defeat the reference-equality dirty check the
 *  workspace save relies on). */
export function stampRecommendationTokens(
  rec: InsightRecommendation,
  ws: RecommendPlanWorkspace,
): InsightRecommendation {
  return { ...rec, proposedCalls: rec.proposedCalls.map((c) => stampCall(c, ws)) };
}
