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
 *  ★★ "THE SIX `update_*` TOOLS ARE THE ONLY GUARDED ONES" IS NO LONGER TRUE
 *  AND THIS COMMENT SAID IT. `set_task_dependencies` is guarded too — a
 *  token-covered, model-supplied whole-list replace — and it is simply not in
 *  `ALLOWED_REC_TOOLS`, so this table is unaffected TODAY. Adding it to that
 *  allow-set means adding a row here in the same commit. Enumerate the guarded
 *  set by what a schema advertises (`expectedTokenField`), never by the
 *  `update_*` name. */
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
  update_raid_item: { kind: "raid", key: "raid" },
  update_milestone: { kind: "milestone", key: "milestones" },
  update_change: { kind: "change", key: "changes" },
  update_stakeholder: { kind: "stakeholder", key: "stakeholders" },
};

function stampCall(call: InsightToolCall, ws: RecommendPlanWorkspace): InsightToolCall {
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
