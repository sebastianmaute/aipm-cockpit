// src/app/chat-send-loop.ts — the AI chat's round-trip loop: one send's requests, its tool calls,
// the staging gate and its review card, the max_tokens continuation. Moved out of `chat-panel.tsx`'s
// `submitPrompt` so it falls under the coverage gate; no React here. The component builds the send
// (history, prompt layout, tool flags, the stale predicate) before it and applies the outcome after
// it — the notes, the view-switch counter, the saved history, the error mapping
// (`chat-send-errors.ts`) — and reaches its state only through the callbacks in `ChatSendDeps`.

import { type ToolDispatcher, personStripContext } from "./chat-tools";
import {
  type callClaude,
  CONTINUE_NUDGE,
  INTERRUPTED_TOOL_RESULT,
  stringifyResult,
  type TextBlock,
  type ContentBlock,
  type ToolResultBlock,
  type ApiMessage,
  type DisplayItem,
  type ToolFlags,
} from "./chat-api";
import { dropStaleScopeWrite, type ScopeEpochReader } from "./scope-epoch";
import {
  buildPlanRows,
  carriesEnabledModules,
  isEntityWriteCall,
  liftsFunctionWithdrawal,
  shouldStage,
  type PlanRow,
  type ProposedCall,
} from "./chat-proposal";
import { isPureReadTool, markUntrustedByResults, runsInPlaceWhenStaging, type SendRecord } from "./chat-send-record";
import { describeProposal, type DescribedRow } from "./chat-proposal-describe";
import { NO_HOLIDAYS, type AbsenceCtx } from "./absence-clash";
import { callAbsenceClashes, DATE_WRITE_TOOLS } from "./chat-absence-clashes";
import { type ProposalFailureKind } from "./chat-proposal-apply";
import { mintProvisionalIds, newProposalId, proposalTitles, PROPOSAL_PENDING_RESULT, stagedToolResult } from "./chat-proposal-stage";
import { peopleToolsLive } from "./chat-tool-defs";
import { PERSON_FIELDS_REMOVED_NOTE, stripPersonFields } from "./ai-person-fields";
import { emptyWorkspace, type Workspace } from "./workspace";
import { type AiOrigin } from "./activity-origin";

/** The live plan behind a `{kind:"proposal"}` marker in the transcript.
 *
 *  ★★★ IT IS DELIBERATELY NOT PART OF `ChatConversation`. Both `history` and
 *   `display` are persisted, so anything stored on a display item can be
 *   restored much later and would offer to apply a plan staged against a
 *   workspace that has since moved. This state is component-local (`chat-panel.tsx`
 *   holds it), dies with the panel's state, and is bound to the transcript ONLY by
 *   `id` — see the `DisplayItem` proposal variant for the full reasoning. */
export interface PendingProposal {
  readonly id: string;
  readonly rows: readonly DescribedRow[];
  /** The SAME array `describeProposal` was handed, kept because the dependency
   *  graph lives here and nowhere else — `DescribedRow` keeps only `mintedId`
   *  and `pendingOn`, while `cascadeDeselect` walks `dependsOn`/`dependsOnAll`.
   *  Positionally aligned with `rows`, as `describeProposal` requires. */
  readonly planRows: readonly PlanRow[];
  /** One per row, positionally aligned — resolved against the live workspace at
   *  staging time so an `update_*` row is titled by its target, not its tool. */
  readonly titles: readonly string[];
  readonly selected: ReadonlySet<number>;
  readonly applying: boolean;
  /** Row indices `applyProposal` reported as not applied → WHY.
   *  ★★ A Map, not a Set: the apply path distinguishes four outcomes and
   *  collapsing them here is what made the card call every one a conflict. */
  readonly failed: ReadonlyMap<number, ProposalFailureKind>;
  /** How many rows the last Apply actually committed, or `null` before any
   *  Apply on this card.
   *
   *  ★★★ SUCCESS HAD NO REPRESENTATION AT ALL, and that is why a working Apply
   *   read as a dead button: on a clean run the selection empties and Apply
   *   disables itself, which is pixel-identical to a no-op. Every other outcome
   *   the card can reach — four failure kinds — had a string; the one that
   *   normally happens had none. `null` is deliberately distinct from `0`: no
   *   Apply yet, versus an Apply that committed nothing. */
  readonly applied: number | null;
  /** §600 — the scope epoch of the turn that STAGED this plan: that turn's
   *  `sendEpoch`, NOT a fresh `getScopeEpoch()` read at staging or at Apply.
   *  ★★★ THE MODEL WROTE ITS CALLS AGAINST THE SEND-TIME PROJECT. Capturing at
   *   the Apply click would certify whatever project is in scope by then — the
   *   swap itself — rather than catch it. The render-time `seenProjectId`
   *   reconcile cannot stand in for this: the epoch also moves when the project
   *   ID does not (browser/local-* kinds keyed on kind alone, an accepted storage
   *   file, a backend change). */
  readonly scopeEpoch: number;
  readonly origin: AiOrigin; // §799 — the STAGING request's (`chatSendOrigins`), never a later turn's
}

/** One answered round trip, as `callClaude` resolves it. */
export type ChatTurnResponse = Awaited<ReturnType<typeof callClaude>>;

/** What the send's component state and environment give the loop. */
export interface ChatSendDeps {
  /** The round-trip cap, already clamped (`clampMaxChatTurns`). */
  readonly maxTurns: number;
  /** The outgoing history (`fitHistoryToBudget` of the send's new history). Copied, never mutated. */
  readonly messages: readonly ApiMessage[];
  /** AI-02: what the staging gate knows about this send, as `openSendRecord` opened it. */
  readonly sendRecord: SendRecord;
  /** The send's ONE stale predicate (cancel, project, thread, scope), asked at the loop's three sites. */
  readonly stale: () => boolean;
  /** Sends one request over the messages so far (the component injects the turn context and the signal). */
  readonly request: (messages: ApiMessage[]) => Promise<ChatTurnResponse>;
  /** The clock for the request stamps. */
  readonly now: () => number;
  /** Runs one tool and resolves its raw result (`runTool` with the send's dispatcher and origin). */
  readonly executeTool: (name: string, input: unknown) => Promise<unknown>;
  /** The transcript setter, called with an updater. */
  readonly updateDisplay: (update: (prev: DisplayItem[]) => DisplayItem[]) => void;
  /** Puts a staged plan on the card (`setPendingProposal`). */
  readonly stageProposal: (proposal: PendingProposal) => void;
  /** The card's row title (`cardRowTitle` in the send's language). */
  readonly rowTitle: (row: DescribedRow, ws: Workspace, pendingScenarios: ReadonlyMap<number, string>) => string;
  /** The panel's dispatcher: the person strip's scenario rows, the live functions, the settings preview. */
  readonly dispatcher: Pick<ToolDispatcher, "getForecastScenarioRow" | "getSnapshot" | "previewSettings">;
  readonly toolFlags: ToolFlags;
  readonly getScopeEpoch: ScopeEpochReader;
  /** §596 — the epoch the send started in. */
  readonly sendEpoch: number;
  /** The live workspace (`workspaceRef.current`), read only when a turn is gated. */
  readonly getWorkspace: () => Workspace | undefined;
  /** task-manager's one `useHolidaySet` result (`holidaySetRef.current`), absent for mounts that thread none. */
  readonly getHolidaySet: () => ReadonlySet<string> | undefined;
  /** §794: the open project's review-all-writes switch, asked when the turn is gated. */
  readonly reviewAllWrites: () => boolean;
  /** §799 — the staging request's origin, stored on the card. */
  readonly proposalOrigin: AiOrigin;
}

/** §702: what the send's requests put in front of the transcript, for the view-switch counter. */
export interface ChatSendCounters {
  readonly requests: number;
  readonly cacheWrite: number;
  readonly firstRequestAt: number | null;
  readonly lastRequestAt: number;
}

/** The counters before any request has answered. */
export const NO_REQUESTS: ChatSendCounters = { requests: 0, cacheWrite: 0, firstRequestAt: null, lastRequestAt: 0 };

/** How the loop ended. The counters are returned on BOTH arms: a failure after a response still left
 *  its prefix in the cache. */
export type ChatSendOutcome =
  | {
      readonly threw: false;
      /** A clean end_turn, as opposed to exhausting the round-trip cap or a stale break. */
      readonly completed: boolean;
      /** The outgoing history plus every turn this send appended. */
      readonly messages: readonly ApiMessage[];
      readonly sendRecord: SendRecord;
      readonly counters: ChatSendCounters;
    }
  | { readonly threw: true; readonly error: unknown; readonly counters: ChatSendCounters };

/** The staging path's fallback workspace when no `workspace` prop was threaded.
 *
 *  ★★ NEVER CALLED DURING RENDER — `emptyWorkspace()` reads the clock, which
 *   the react-hooks purity rule bans in a component body. Every call site is
 *   inside the async send. */
function stagingWorkspace(ws: Workspace | undefined): Workspace {
  return ws ?? emptyWorkspace();
}

/** A turn's calls, paired with the ids their results must answer. */
type ProposedEntry = { readonly useId: string; readonly call: ProposedCall; readonly removed: readonly string[] };

/** Runs one tool, shows it in the transcript and returns its `tool_result`, plus whether it ran without
 *  throwing. Used by the ordinary path and by a staging turn's reads, which run in place (AI-02). */
async function runAndRecord(
  deps: ChatSendDeps,
  useId: string,
  name: string,
  input: unknown,
): Promise<{ result: ToolResultBlock; ok: boolean }> {
  let resultStr: string;
  let isError = false;
  try {
    resultStr = stringifyResult(await deps.executeTool(name, input));
  } catch (err) {
    isError = true;
    resultStr = err instanceof Error ? err.message : String(err);
  }
  deps.updateDisplay((prev) => [...prev, { kind: "tool", name, input, result: resultStr, error: isError }]);
  return {
    result: { type: "tool_result", tool_use_id: useId, content: resultStr, is_error: isError ? true : undefined },
    ok: !isError,
  };
}

/** Shows a turn's text: a new assistant bubble, or — after a max_tokens continuation (`stitch`) — appended
 *  to the SAME bubble (a split mid code-fence/table would otherwise render as two broken blocks). */
function showTurnText(deps: ChatSendDeps, content: readonly ContentBlock[], stitch: boolean): void {
  const turnText = content
    .filter((b): b is TextBlock => b.type === "text" && b.text.trim() !== "")
    .map((b) => b.text)
    .join("");
  if (!turnText) return;
  deps.updateDisplay((prev) => {
    if (stitch) {
      const last = prev[prev.length - 1];
      if (last && last.kind === "assistant") {
        return [...prev.slice(0, -1), { ...last, text: last.text + turnText }];
      }
    }
    return [...prev, { kind: "assistant", text: turnText }];
  });
}

/** The turn's calls, each with the person fields a staged call must not carry already removed. */
function proposeCalls(deps: ChatSendDeps, content: readonly ContentBlock[]): ProposedEntry[] {
  const proposed: ProposedEntry[] = [];
  for (const block of content) {
    if (block.type !== "tool_use") continue;
    // `ToolUseBlock.input` is `unknown` (the API's own shape). The
    // gate, the plan builder and `runTool` all treat it as a bag of
    // keys, exactly as the immediate path (`runDirectTools`) does when it hands
    // `block.input` straight to `runTool`.
    const sentInput = block.input as Readonly<Record<string, unknown>>;
    // ★★ AI people protection (R4): a staged call's person fields go BEFORE the gate and the card, so
    //  the card shows what Apply writes. The immediate path (`runDirectTools`) hands `runTool` the raw input, and
    //  `runTool` strips it there and says so in the result.
    const people = peopleToolsLive(deps.toolFlags.peopleProtected)
      ? null
      : stripPersonFields(block.name, sentInput, personStripContext(deps.dispatcher, block.name, sentInput));
    const removed = people?.removed ?? [];
    proposed.push({ useId: block.id, call: { name: block.name, input: people && removed.length > 0 ? people.input : sentInput }, removed });
  }
  return proposed;
}

/** The gate's view of the live project, built on first use (`gateContext`). */
type GateContext = { ws: Workspace; absence: AbsenceCtx };

/** ★★★ THE GATE. A turn is STAGED when it holds a destructive call, an
 *  event write that sends invitations, or an `update_project` (always
 *  staged, even alone: `ALWAYS_STAGED_TOOLS`); when its entity writes plus
 *  those this send already applied (`sendRecord.appliedWrites`) come to
 *  more than one; or, in an untrusted send (an attachment in the
 *  history), when it holds any call `stagesWhenUntrusted` names; or when an
 *  entity write would land someone's work on their absence (§773). Staged:
 *  no write runs, the turn's reads (`isPureReadTool`) run in place, the
 *  other calls go on a review card in the transcript, and every `tool_use`
 *  id is still answered. A turn that
 *  does not stage takes the original path (`runDirectTools`) UNCHANGED — that
 *  equivalence is pinned by a test, because "one extra branch" is how
 *  a working path acquires a condition nobody meant to add.
 *  ★★ AI-02 — A CARD IS NEVER REPLACED UNSEEN. Once a turn of this send has staged, a later
 *  turn stages nothing (a second `setPendingProposal` would swap the card before the user saw
 *  it): it takes the direct path, where its reads (`isPureReadTool`) run and every other call
 *  is answered with `PROPOSAL_PENDING_RESULT` and runs nothing. The loop then continues, so
 *  the model can still write its reply; the turn cap bounds it as it bounds any send.
 *  ★★ §773 — a lone date write that lands someone's work on their absence stages too, judged by the
 *  same plan the card shows (`callAbsenceClashes`), so the card always carries the warning.
 *  Built on first use: a turn with no date write, and no staging, never builds it. The holiday set
 *  is task-manager's one `useHolidaySet` result, the same the dispatcher judges with; the prop is
 *  optional only for mounts that thread none (tests), where no day is a holiday on either side.
 *  Returns the gate context when the turn stages, else null. */
function gateTurn(deps: ChatSendDeps, proposed: readonly ProposedEntry[], sendRecord: SendRecord): GateContext | null {
  let gate: GateContext | undefined;
  const gateContext = () => {
    if (gate) return gate;
    const ws = stagingWorkspace(deps.getWorkspace());
    gate = { ws, absence: { absences: ws.absences, resources: ws.resources, holidaySet: deps.getHolidaySet() ?? NO_HOLIDAYS } };
    return gate;
  };
  const hasClash = (c: ProposedCall) => {
    if (!DATE_WRITE_TOOLS.has(c.name)) return false;
    const { ws, absence } = gateContext();
    return callAbsenceClashes(c, ws, absence).length > 0;
  };
  // §810 — turning any hidden function back on always waits for review, judged against the project's live
  // saved functions (the snapshot the executor's refusal reads from), read only for a functions call.
  const liftsWithdrawal = (c: ProposedCall) =>
    carriesEnabledModules(c) && liftsFunctionWithdrawal(c, deps.dispatcher.getSnapshot().enabledModules);
  if (sendRecord.staged || !shouldStage(proposed.map((p) => p.call), sendRecord, hasClash, deps.reviewAllWrites(), liftsWithdrawal)) {
    return null;
  }
  return gateContext();
}

/** The staged branch: the turn's reads run in place, the other calls go on ONE card, and every
 *  `tool_use` id gets its answer. Returns the answers, in the turn's order. */
async function runStagedTurn(deps: ChatSendDeps, proposed: readonly ProposedEntry[], gate: GateContext): Promise<ToolResultBlock[]> {
  const { ws, absence: gateAbsence } = gate;
  // AI-02 — a read changes nothing, so it runs in place and gets its real result; so does `optimize_wbs`,
  // whose own preview writes nothing until applied (`runsInPlaceWhenStaging`). Only the turn's other
  // calls go on the card. These run FIRST, so the transcript keeps the turn's order: their lines, then
  // the card.
  const staged = proposed.filter((p) => !runsInPlaceWhenStaging(p.call.name));
  const readAnswers = new Map<string, ToolResultBlock>();
  let scopeMoved = false;
  for (const p of proposed) {
    if (staged.includes(p)) continue;
    // §596 — re-checked per read, as the ordinary loop (`runDirectTools`) checks per tool. Once the scope has
    // moved, no read runs in the next project, and no card is staged for it.
    if (dropStaleScopeWrite(deps.getScopeEpoch, deps.sendEpoch, "chat-panel.stagedRead", { tool: p.call.name })) {
      scopeMoved = true;
      break;
    }
    readAnswers.set(p.useId, (await runAndRecord(deps, p.useId, p.call.name, p.call.input)).result);
  }
  const calls = staged.map((p) => p.call);
  // ★★★ `mintProvisionalIds` ADVANCES the session mark, so every
  // provisional id differs from the one apply mints and the remap is
  // exercised on every create. See its own docstring for what a
  // peek-based mint would have made dormant.
  const planRows = scopeMoved ? [] : buildPlanRows(calls, mintProvisionalIds(calls, ws));
  // §773 — the card's rows, read again below so each staged result names its row's clashes.
  let described: readonly DescribedRow[] = [];
  if (!scopeMoved) {
    // §779 — the dispatcher's live settings judge a functions row's other settings.
    // §773 — the gate's own absence context, so the card judges exactly what staged it.
    described = describeProposal(calls, ws, planRows, (patch) => deps.dispatcher.previewSettings(patch), gateAbsence);
    const proposalId = newProposalId();
    deps.stageProposal({
      id: proposalId,
      rows: described,
      planRows,
      titles: proposalTitles(described, ws, (r, pending) => deps.rowTitle(r, ws, pending)),
      // Everything starts kept: the card is a chance to REFUSE, and a
      // plan that arrives all-unchecked reads as "nothing to do here".
      selected: new Set(described.map((_, i) => i)),
      applying: false,
      failed: new Map<number, ProposalFailureKind>(),
      applied: null,
      scopeEpoch: deps.sendEpoch, origin: deps.proposalOrigin,
    });
    deps.updateDisplay((prev) => [
      ...prev,
      { kind: "proposal", id: proposalId, count: described.length },
    ]);
  }
  // ★★★ EVERY `tool_use` ID IS ANSWERED EXACTLY ONCE, staged or not. An unanswered
  // id makes the NEXT request a 400 and wedges the chat for good —
  // `closeDanglingToolUses` exists because of exactly that. The
  // result also carries the create's provisional id, so a later call
  // in this same turn can name the row the plan will create, and (§773) the absence clashes
  // the card shows for that row, so Claude can offer another date while the card waits. After a
  // scope move every id without an answer gets the interrupted result, as a truncated turn's calls do.
  // §810 — no clash while the project hides its Resources function (the card still shows it to the user).
  return proposed.map((p): ToolResultBlock => {
    const read = readAnswers.get(p.useId);
    if (read !== undefined) return read;
    const at = staged.indexOf(p);
    return scopeMoved || at === -1
      ? { type: "tool_result", tool_use_id: p.useId, content: INTERRUPTED_TOOL_RESULT, is_error: true }
      : { type: "tool_result", tool_use_id: p.useId, content: stagedToolResult(planRows[at].mintedId, deps.toolFlags.resourcesHidden ? [] : described[at].plan.clashes.map((n) => n.clash)) + (p.removed.length > 0 ? ` ${PERSON_FIELDS_REMOVED_NOTE(p.removed)}` : "") };
  });
}

/** The direct path: each tool runs (or, while a card waits, only a read does), in order. Returns the
 *  results and the entity writes applied. */
async function runDirectTools(
  deps: ChatSendDeps,
  content: readonly ContentBlock[],
  sendRecord: SendRecord,
): Promise<{ results: ToolResultBlock[]; directWrites: number }> {
  const results: ToolResultBlock[] = [];
  // AI-02: entity writes this turn APPLIED directly, added to the send's count. A call
  // that threw (validation, a stale token) changed nothing and is not counted, so the model's
  // corrected retry applies as a lone write would; a call the scope guard dropped never ran.
  let directWrites = 0;
  for (const block of content) {
    if (block.type !== "tool_use") continue;
    // AI-02 — a card of this send is waiting: only a read runs; anything else is answered and skipped.
    if (sendRecord.staged && !isPureReadTool(block.name)) {
      results.push({ type: "tool_result", tool_use_id: block.id, content: PROPOSAL_PENDING_RESULT });
      continue;
    }
    // ★★★ §596 — RE-CHECKED PER TOOL, NOT PER TURN, and no `stale()` call
    // site can stand in for this one: all three run BEFORE this loop. A
    // turn can carry several `tool_use` blocks, so a scope move landing
    // mid-batch would otherwise let every REMAINING tool write into the
    // next project. Scope only — cancel and the project/thread refs are
    // the outer loop's job and cannot move here.
    // ★★ WHAT CAN MOVE IT BETWEEN TWO TOOLS, stated narrowly because the
    // first version of this comment said "each `runTool` awaits" and that
    // is false — `chat-tools.ts` contains no `await` at all
    // (`grep -c await src/app/chat-tools.ts` → 0), so `runTool` resolves
    // on the next microtask and nothing that needs a task (a click, a
    // timer, IO) can interleave. What CAN move it is a dispatcher handler
    // itself, which is a write surface into the same app — that is the
    // case pinned by "stops a multi-tool turn at the tool where the scope
    // changed". The rest is cheap insurance for the day a handler becomes
    // genuinely async.
    if (dropStaleScopeWrite(deps.getScopeEpoch, deps.sendEpoch, "chat-panel.toolLoop", { tool: block.name })) break;
    const { result, ok } = await runAndRecord(deps, block.id, block.name, block.input);
    if (ok && isEntityWriteCall({ name: block.name, input: block.input as Readonly<Record<string, unknown>> })) {
      directWrites += 1;
    }
    results.push(result);
  }
  return { results, directWrites };
}

/** Truncated at the length cap: any tool_use blocks in a truncated turn may be partial — DON'T execute
 *  them; answer them with interrupted results (so the protocol stays valid and the model re-issues them
 *  cleanly), then nudge it to continue where it left off. */
function truncatedTurnAnswer(content: readonly ContentBlock[]): ContentBlock[] {
  const parts: ContentBlock[] = [];
  for (const block of content) {
    if (block.type === "tool_use") {
      parts.push({
        type: "tool_result",
        tool_use_id: block.id,
        content: INTERRUPTED_TOOL_RESULT,
        is_error: true,
      });
    }
  }
  parts.push({ type: "text", text: CONTINUE_NUDGE });
  return parts;
}

/**
 * Runs one send's round trips. Never throws: a failure comes back as `{ threw: true }`, with the
 * counters of every request that answered before it.
 */
export async function runChatSend(deps: ChatSendDeps): Promise<ChatSendOutcome> {
  const messages: ApiMessage[] = [...deps.messages];
  let sendRecord = deps.sendRecord;
  // §702: what this send put in front of the transcript, for the view-switch
  // counter. Each stamp is the time a request went out, because that is when
  // the cache lifetime is refreshed (`VIEW_SWITCH_CACHE_TTL_MS` says why),
  // and it is kept only once that request ANSWERED: an aborted request may
  // or may not have reached the cache, so the stamp errs toward cold.
  // `requests` counts the answered round-trips (the break-even's unit) and
  // `cacheWrite` their cache writes, whatever the send is classified
  // as; any of them means a prefix reached the cache.
  let firstRequestAt: number | null = null;
  let lastRequestAt = 0;
  let requests = 0;
  let cacheWrite = 0;
  const counters = (): ChatSendCounters => ({ requests, cacheWrite, firstRequestAt, lastRequestAt });
  try {
    // When the previous turn was a max_tokens continuation, the next turn's
    // text is appended to the SAME bubble (`showTurnText`). `completed` distinguishes a clean
    // end_turn from exhausting the round-trip cap (so the panel can flag a partial).
    let continueBubble = false;
    let completed = false;

    // Round-trip loop: keep going until the model finishes (end_turn). Two
    // reasons to continue — a tool call to run, or a length-cap truncation to
    // resume — both share the turn budget (a runaway guard).
    for (let turn = 0; turn < deps.maxTurns; turn++) {
      if (deps.stale()) break;
      const sentAt = deps.now();
      const response = await deps.request(messages);
      // §702: the counter takes the request and its cache write together,
      // BEFORE the stale check — a request counted without its write would
      // record a switch as free. Token usage is not counted here: the transport's
      // tap counts every response that arrived, a stale one included.
      lastRequestAt = sentAt;
      firstRequestAt ??= sentAt;
      requests += 1;
      cacheWrite += response.usage.cache_creation_input_tokens;
      // A cancel or a project switch may have landed while awaiting — bail
      // before writing this turn onto (possibly) another project's state.
      if (deps.stale()) break;

      messages.push({ role: "assistant", content: response.content });
      showTurnText(deps, response.content, continueBubble);

      if (deps.stale()) break;

      // Complete tool call: run each tool, feed the results back, loop so the
      // model can use them.
      if (response.stop_reason === "tool_use") {
        const proposed = proposeCalls(deps, response.content);
        const gate = gateTurn(deps, proposed, sendRecord);
        if (gate !== null) {
          sendRecord = { ...sendRecord, staged: true };
          messages.push({ role: "user", content: await runStagedTurn(deps, proposed, gate) });
          // Defensive: no test can observe this reset today. A staged turn adds a display item (the card, or a
          // read's tool line) before any next text, except when the scope moves on its FIRST in-place read: then
          // it adds none, and the next iteration's `stale()` must end the send before any text. Through the panel
          // it does (its `stale()` includes the scope test); at the `runChatSend` seam that rests on the caller's `stale`.
          continueBubble = false;
          continue;
        }

        const { results, directWrites } = await runDirectTools(deps, response.content, sendRecord);
        // ★★★ NEVER PUSH AN EMPTY CARRIER. `content: []` is not "a carrier with
        // nothing in it" to the API — it is an INVALID message, and it kills the
        // conversation permanently: `closeDanglingToolUses` runs at the top of
        // every send and (before §596) had no rule that removes an empty
        // message, so every later send rebuilt the same invalid array, and in
        // Turso mode the `setHistory` `chat-panel.tsx` runs after this loop is persisted by
        // `use-chat-threads`'s save effect, so it survives reload and tab close. A new thread is the
        // only recovery.
        // ★★★ IT DOES NOT BITE ON *THIS* SEND'S CONTINUATION, AND GUESSING THAT
        // IT DID PRODUCED A GREEN TEST AGAINST THE UNGUARDED CODE. While the
        // empty message is the history TAIL, `buildWireMessages` appends the
        // turn-context block INTO a trailing user message, so the wire sees
        // `content: [ctx]` and the next round trip looks perfectly healthy. The
        // damage lands on the NEXT send: the user's new turn is appended after
        // the empty one, which is then no longer the tail, gets no backfill, and
        // goes out as `content: []` behind two consecutive `user` turns. Any
        // test of this THROUGH THE PANEL (the wire, after `buildWireMessages`)
        // must span TWO sends; one that reads this send's second wire request
        // passes either way. At the `runChatSend` seam a single send is enough:
        // the injected `request` receives the raw history, before any turn
        // context is appended, so the empty carrier is visible there.
        // ★★ TWO WAYS TO GET HERE WITH NOTHING, and only the second needs an
        // await, which is why the guard is at the SOURCE rather than left to a
        // downstream repair. (1) A turn with `stop_reason: "tool_use"` and no
        // `tool_use` block in its content — malformed, but it is external data
        // and nothing upstream validates it; `shouldStage([])` is false, so it
        // reaches `runDirectTools` and matches nothing. That one is reachable TODAY
        // and is pinned by "a tool_use turn carrying no tool_use block…" in
        // `chat-panel.test.tsx`. (2) The §596 per-tool guard breaking on the
        // FIRST tool — unreachable today, since nothing awaits between the
        // post-request `stale()` and the first `runTool`, and deliberately
        // guarded anyway rather than left as a trap for whoever adds one.
        // ★ Skipping the push is correct, not a second bug: the assistant turn
        // then has NO carrier at all, which is exactly the shape
        // `closeDanglingToolUses` was written to repair, and it runs before the
        // next request either way.
        if (results.length > 0) {
          messages.push({ role: "user", content: results });
        }
        // §797: a read that showed the model a Jira-synced row makes every later turn of this send untrusted.
        sendRecord = markUntrustedByResults(
          { ...sendRecord, appliedWrites: sendRecord.appliedWrites + directWrites },
          results,
        );
        continueBubble = false; // tool output breaks the text flow — new bubble
        continue;
      }

      // Truncated at the length cap: resume transparently instead of dumping a
      // cut-off message and waiting for the user to prod (`truncatedTurnAnswer`).
      if (response.stop_reason === "max_tokens") {
        messages.push({ role: "user", content: truncatedTurnAnswer(response.content) });
        continueBubble = true; // stitch the resumed text onto the same bubble
        continue;
      }

      // end_turn / stop_sequence — the model is done.
      completed = true;
      break;
    }
    return { threw: false, completed, messages, sendRecord, counters: counters() };
  } catch (error) {
    return { threw: true, error, counters: counters() };
  }
}
