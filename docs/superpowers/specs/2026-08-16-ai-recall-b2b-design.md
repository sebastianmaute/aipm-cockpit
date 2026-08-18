# AI Recall — B2b: ambient activity recap, entry actors, recall toggles — Design

**Date:** 2026-08-16
**Status:** designed, unimplemented
**Predecessor:** [B2a](2026-08-16-ai-recall-b2a-design.md) — shipped as 0.241.0 "Tuttle".

**Sub-project B2b of three.** B2a shipped `search_history` plus the ambient insight-outcomes
section. This document covers B2b. B2c (chat-thread search + cross-thread continuity) stays
unstarted and out of scope.

---

## Problem

Three problems, coupled tightly enough that splitting them produces two slices that each half-work.

**1. The model does not know the history tool exists.** `search_history` shipped in 0.241.0 and is
reachable only if the model decides to reach for it. `view-ai-scope.ts` hints at it on the Activity
view alone — which is the one view where the user least needs a nudge, because they are already
looking at the log. On every other view the tool is invisible.

**2. The audit log is blind to AI-made changes.** Measured, not assumed:
`use-chat-dispatcher.ts` contains exactly ONE `logActivity` reference — line 246, threading it into
`useDocumentTools`. The dispatcher's entity writers (`createTask`, `updateTask`, and their RAID /
change / milestone / stakeholder / resource peers) call it nowhere. So an AI that reassigns forty
tasks leaves no trace in the project's audit trail, while a user who reassigns one leaves a row with
a field diff. The Activity panel presents itself as the record of what happened to the project, and
for AI-driven work it is silently incomplete.

**3. Neither recall feature can be turned off.** B2a's tool costs its schema on every turn whether
or not it is wanted, and B2b's recap will cost tokens on every turn of every conversation. A user
who wants one may well not want the other.

### ★★★ A correction the first draft of this document got wrong

The first framing claimed actor was needed because "the AI writes `task.updated` exactly like a
person, so the kinds cannot tell them apart." That is false in both directions and the falsity is
worth recording, because it inverts the whole justification:

- The AI does not write `task.updated`. It writes nothing for entity changes.
- Every writer that *does* log today already self-identifies **in its kind**: `jira.sync`,
  `calendar.autoPulled`, `ai.documentWrite`.

So an actor field added to today's tree would be decorative — reachable only on document writes,
where the kind already says the same thing. That is precisely the "a value nothing can produce"
objection that ruled out a fourth `"system"` actor, applied to the entire field.

**Actor becomes load-bearing only once AI entity writes are logged.** The two are one change, and
this document treats them as one.

---

## Non-goals

- B2c: chat-thread search, cross-thread continuity, the `coverage` disclaimer, a `source`
  discriminator on `HistoryResult.events`.
- Rendering activity *lines* into the prompt. B2b ships a **count**, not a recap of content — see
  "Why a nudge and not a recap".
- Field diffs in anything model-facing beyond what `search_history` already returns.
- Folding `activity-log-panel.tsx`'s three raw `<th>` columns into `SortResizeTh` / giving them
  `aria-sort`. Pre-existing, noted in `AGENTS.md`, deliberately untouched here.
- Retiring the `ai.documentWrite` kind. It predates this slice, an older client must keep rendering
  it, and churning it buys nothing.

---

## Architecture

Four pieces, in dependency order.

### 1. `ActivityEntry.actor`

```ts
/** Who caused an entry. ★ Deliberately NOT extended with "system": no writer
 *  could produce it today, and a value nothing emits is a value nothing tests. */
export type ActivityActor = "user" | "ai" | "integration";
```

```ts
export interface ActivityEntry {
  // …existing fields…
  /** Who caused this entry. ABSENT on every entry written before this release. */
  actor?: ActivityActor;
}
```

**★★★ Absence is NOT `"user"`, and must never be defaulted to it at read time.** Entries predating
the field have a genuinely unknown actor. Coercing them would assert that the AI's past document
writes were the user's — a false statement in the one record the model is told to trust. An entry
with no actor renders with no attribution and counts into an `unknown` bucket, never into `user`.

**★★ The six write paths cost nothing, and this contradicts the AGENTS.md landmine only in
appearance.** That landmine is about a new *slice*; this is a new *field on an existing blob entry*.
Every path serialises the entry wholesale as JSON — verified at each site:

| Path | Mechanism |
|---|---|
| CSV | `activityLogToCsv` → one `config,<JSON.stringify(log)>` cell |
| Markdown | `activityLogToMarkdown` → a fenced ```` ```json ```` block |
| JSON | `workspace.ts` spreads `ws.activityLog` verbatim |
| Turso single / tenant | the meta-blob row, same JSON |
| IndexedDB | the meta-blob, same JSON |

So the only load-boundary work is in `sanitizeActivityEntry`.

**★★★ An unknown-but-string `actor` is KEPT, exactly as an unknown `kind` already is.** The reason
is identical and already documented on `sanitizeActivityEntry`: the log is shared workspace data,
the loaded value becomes app state, and autosave writes that state straight back — so an older
client that dropped an actor a newer release wrote would strip it from the shared project on every
save. A non-string actor is corruption and is dropped to `undefined`.

★ The TS type stays a three-member union while the sanitizer admits any string, which is the same
asymmetry `kind: ActivityKind` already carries. Any render-side lookup keyed on actor therefore
needs the `hasOwnProperty` guard `activityMessageKey` already models — never a bare index.

### 2. Logging AI entity writes

**AI entity writes use the EXISTING kinds, with `actor: "ai"`.** A task updated by the assistant is
the same event as a task updated by a person; only the actor differs. That is what the field is for.
The alternative — a parallel `ai.taskUpdated` kind set — would mean ~20 new kinds, ~20 new i18n
key pairs in both dictionaries, and two rendering paths for one event.

**★★ The rest parameter blocks the obvious signature, and this is already a settled precedent.**
`logActivity` is `(kind, ...args)`, so an actor cannot be a trailing argument — the same constraint
that forced `logActivityChanges` to exist as a separate function rather than an options argument.
Actor therefore **leads**:

```ts
logActivity(kind, ...args)                       // actor "user" — ~150 existing call sites UNTOUCHED
logActivityAs(actor, kind, ...args)              // explicit
logActivityChanges(kind, changes, ...args)       // actor "user"
logActivityChangesAs(actor, kind, changes, ...args)
```

`appendActivityEntry` gains a trailing `actor?: ActivityActor` — it already takes an explicit `args`
array, so it has no rest-parameter problem.

Call sites that change:

| Site | Actor | Count |
|---|---|---|
| `use-chat-dispatcher.ts` entity writers | `"ai"` | new logging, **20** writers |
| `use-jira-sync.ts` | `"integration"` | 1 |
| `use-calendar-integrations.ts` | `"integration"` | 4 |
| everything else | `"user"` (default) | 0 edits |

★ `useDocumentTools`' existing `ai.documentWrite` call gains `actor: "ai"` too. Redundant with its
kind, and correct anyway — a consumer filtering on actor must not have to special-case one kind.

★★ **Twenty is a measured count, not an estimate, and it is the number that sizes this task.**
Re-derive it rather than trusting this line — the reproduce command is the claim:

```bash
grep -cE "^      (create|update|delete)[A-Z][a-zA-Z]*: \(" src/app/use-chat-dispatcher.ts
```

An earlier revision of this table said "~7 writer families", which understated the work by roughly
threefold. A family is not a call site, and the implementer edits call sites.

**★★ Volume is the risk this introduces.** `ACTIVITY_MAX_ENTRIES` is 500 and `mergeActivityLogs`
caps by keeping the newest. A bulk AI operation creating forty tasks now writes forty entries, which
can age out a week of user history in one chat turn. Two mitigations, both required:
- The dispatcher's *bulk* writers log ONE summarising entry, not N — mirroring what
  `jira.sync` already does (`added + pulled, pushed, conflicts` in a single row).
- The per-entity writers log one entry each, as a user action does.

★ `view-ai-scope.ts`'s `activity.reading` prose currently states the log records changes
"not your own tool calls". **That becomes false with this change and must be rewritten in the same
commit** — it is pinned by `view-ai-scope.test.ts`, so the test goes red and names the file.

### 3. The ambient nudge

**Engine.** A new pure function in `history-search.ts`, which already owns tz-aware day bounds:

```ts
export const RECAP_WINDOW_DAYS = 7;

export interface ActivitySummary {
  total: number;
  byActor: { user: number; ai: number; integration: number; unknown: number };
  /** Newest matching entry's raw UTC timestamp. */
  latestAt: string;
}

export function summarizeRecentActivity(
  entries: readonly ActivityEntry[],
  today: string,
  tz: string,
  days?: number,
): ActivitySummary | null;
```

- **No clock.** `today` and `tz` are parameters, matching `searchHistory`'s existing contract, so the
  function is deterministic and immune to the §149 calendar-rollover class.
- Day bounds via the existing `dayInZone`, not a new comparison. An entry whose timestamp has no
  parseable day is **excluded** — the same decision `searchHistory` makes, for the same reason.
- Returns `null` when the window is empty, so a quiet project costs zero tokens.
- `latestAt` is the raw UTC stamp; the renderer converts. Sorting or comparing in the offset-bearing
  form is the DST bug `searchHistory` documents at length — Berlin renders `00:30Z` as `02:30+02:00`
  and the *later* `01:30Z` as `02:30+01:00`.

**Transport.** `getSnapshot()` gains:

```ts
/** Bounded counts for the ambient recap — four numbers and a timestamp.
 *  ★★★ NOT the log. `get_app_state` returns the snapshot VERBATIM; that is
 *  exactly why `getActivityLog()` is a separate method. This is safe there for
 *  the same reason `insights` and `viewDigest` are: it is bounded and small. */
activitySummary?: ActivitySummary;
```

Computed in `use-chat-dispatcher.ts`'s `getSnapshot`, which already holds `activityLogRef` and
`getTimezone()`. Skipped entirely when the recap toggle is off.

**Render.** `buildActivityRecapBlock(summary: ActivitySummary | null): string` in
`activity-prompt.ts` — already the model-facing render layer.

```
Recent project activity: 14 changes in the last 7 days
(9 by the user, 5 by the AI assistant; latest 2026-08-16).
Use search_history to read them.
```

- **Plain English literals, no i18n keys.** Unlike `renderActivityEntry`, this line has no UI
  counterpart to stay in step with, so routing it through `t("en-US", …)` would add two dictionary
  entries that exist only to be read by a machine.
- The actor breakdown is **omitted when only one bucket is non-zero** — "(14 by the user)" restates
  the total.
- `unknown` renders as "N of unknown origin" and only when non-zero. Pre-field entries age out of a
  7-day window within a week of release, so this is transitional by construction.
- Returns `""` for a null summary; `chat-api`'s existing `.filter(Boolean)` drops the block.

**Placement: the volatile suffix, immediately after `insightsBlock`.** Activity changes on every
turn, so in the cached prefix it would invalidate the prompt cache on every message.

★ The actor split is load-bearing rather than decorative: it is what stops the model reading its own
edits back as new user information and acting on them twice.

### 4. Two toggles

```ts
// AiConfig
historySearch?: boolean;   // search_history tool. Default ON (undefined = on).
activityRecap?: boolean;   // Ambient activity nudge. Default ON (undefined = on).
```

Both default **ON** via `?? true`, matching `actionSuggestions`. Defaulting off would silently
remove a capability that shipped on in 0.241.0.

`sanitizeAiConfig` handles both; the settings row uses the AI section's existing primitive — no
hand-rolled control.

**`historySearch` off REMOVES the tool from the list, it does not refuse it.** A refused tool still
costs its schema on every turn, which is most of what the toggle is for.

**★★ `CACHED_TOOLS` is a module-level constant and the cache breakpoint rides its LAST element.**
Gating a tool out therefore cannot be done by filtering at the call site — that would rebuild the
array per call and destroy referential stability. Two frozen module-level variants instead, selected
by the setting, each with the breakpoint recomputed on its own last element.

★ Verified `search_history` is **not** last (`update_settings` is, of 39 tools), so removing it does
not move the breakpoint today. The variant construction must still recompute rather than assume it,
because a future tool appended after `search_history` would make the assumption silently wrong.

`activityRecap` off skips `summarizeRecentActivity` entirely — not merely the block.

### 5. The Activity panel

A fourth column, **plain text, not sortable**, plus one toolbar filter `<select>` with an
`aria-label`.

★ Non-sortable is deliberate. The table's three existing headers are raw `<th>`s with hand-rolled
sort buttons and **no `aria-sort`** — a known gap recorded in `AGENTS.md`. A fourth sort button
would deepen that debt; a plain cell does not.

★★ One toolbar filter, never a per-row control. Per-row controls in a list need row-unique
accessible names, and **no axe rule can see a collision** — measured against axe-core 4.12.1: of its
105 rules, 69 carry one of the four tags `e2e/a11y.spec.ts` requests and not one flags two controls
sharing a name. §111 and §126 are open for exactly this.

---

## File structure

| File | Change |
|---|---|
| `activity-log.ts` | `ActivityActor` type; `actor?` on `ActivityEntry`; `appendActivityEntry` trailing param; `sanitizeActivityEntry` keep/drop rules |
| `use-activity-log.ts` | `logActivityAs` / `logActivityChangesAs` |
| `activity-log-context.tsx` | context type carries the `As` variants |
| `use-chat-dispatcher.ts` | log entity writes as `"ai"`; compute `activitySummary` |
| `use-jira-sync.ts` | 1 site → `"integration"` |
| `use-calendar-integrations.ts` | 4 sites → `"integration"` |
| `use-document-tools.ts` | `ai.documentWrite` → `"ai"` |
| `history-search.ts` | `summarizeRecentActivity`, `RECAP_WINDOW_DAYS`, `ActivitySummary` |
| `activity-prompt.ts` | `buildActivityRecapBlock` |
| `chat-api.ts` | recap block in the volatile suffix; `CACHED_TOOLS` variants |
| `chat-tools.ts` | `activitySummary` on the `getSnapshot()` interface |
| `chat-tool-defs.ts` | unchanged (the gate is in the list, not the def) |
| `view-ai-scope.ts` | rewrite the now-false `activity.reading` prose |
| `settings-types.ts` | two `AiConfig` fields + `sanitizeAiConfig` |
| `settings-view.tsx` | two rows in the AI section |
| `i18n.ts` / `i18n.de.ts` | 2 labels + 2 hints + actor labels + the filter's label |
| `activity-log-panel.tsx` | actor column + toolbar filter |

### ★★★ Prerequisite: extract from `chat-tools.ts` FIRST

Measured 2026-08-16: `chat-tools.ts` is **797 lines against the 800 cap** — and `size:check` counts
`readFileSync().split("\n").length`, i.e. `wc -l` **plus one**, so that 797 is the gate's own number
and the budget is three lines. This slice adds a `getSnapshot()` field with its comment. The
extraction is an ordering constraint, not an optimisation.

Re-measure rather than trusting this line:

```bash
node -e "console.log(require('fs').readFileSync('src/app/chat-tools.ts','utf8').split('\n').length)"
```

---

## Testing

**Sanitizer** (`activity-log.test.ts`)
- A known actor round-trips.
- An unknown-but-string actor is **kept** (the forward-compat rule).
- A non-string actor is dropped to `undefined`, entry retained.
- An absent actor stays absent — asserted as `undefined`, never as `"user"`.

**Engine** (`history-search.test.ts`)
- Window boundary in the project zone: an entry at `23:30Z` on the day *before* the cutoff is
  included for a `UTC+2` project and excluded for `UTC-5`. ★ A UTC-only fixture cannot fail this.
- A DST-transition fixture, since the window bound uses `dayInZone`.
- Empty window → `null`, not a zeroed summary.
- Actor tally, including the `unknown` bucket.
- An unparseable timestamp is excluded and does not inflate `total`.

**Renderer** (`activity-prompt.test.ts`)
- Single non-zero bucket → breakdown omitted.
- Two or more → breakdown present, in a fixed order.
- `null` → `""`.
- `unknown` appears only when non-zero.

**Wiring**
- `chat-tools.test.ts`'s existing guard still passes: `activityLog` is NOT on the snapshot.
  Extended: `activitySummary` IS, and is bounded.
- The recap lands in the **volatile** system block, not the cached prefix. ★ Assert the block index,
  not merely that the text appears somewhere — a test matching the whole prompt passes with the
  block in the cached prefix, which is the defect.
- Toggle off → `search_history` absent from the selected tool list; the cache breakpoint still sits
  on that variant's last element.
- Toggle off → `summarizeRecentActivity` not called (spy), not merely an empty block.
- `view-ai-scope.test.ts` pins the rewritten prose.

**Settings**
- Both fields round-trip through `sanitizeAiConfig`; `undefined` reads as ON.

**★ Clock hygiene.** The engine takes `today`, so it needs no freeze. Any *component* test reaching
a real clock gets `vi.useFakeTimers({ toFake: ["Date"] })` — not full fake timers, which put RTL and
the React scheduler on a stopped clock for no benefit. This is the §149 class and it detonates on a
calendar rollover with no code change behind it.

---

## Risks

| Risk | Handling |
|---|---|
| `chat-tools.ts` at 797/800 | Extraction ordered first; re-measure with the command above |
| AI bulk writes age out user history | Bulk writers log one summarising entry, mirroring `jira.sync` |
| `view-ai-scope.ts` prose becomes false | Rewritten in the same commit; its test goes red and names it |
| Golden fixtures | If the sample generator stamps actor, `golden-workspace.test` regenerates — a legitimate format change, never a mask for a diff |
| `i18n.de.ts` corruption | CRLF file; the Edit tool corrupts umlauts and curls quotes. Patch via node utf8 write, verify after |
| A wrong count asserted every turn | The nudge is in every conversation forever, so the window-boundary and DST cases get real tests rather than a smoke check |
| `unknown` bucket looks like a bug | Transitional by construction — pre-field entries leave a 7-day window within a week of release |

---

## Out of scope

- B2c in full.
- `SortResizeTh` / `aria-sort` conversion of `activity-log-panel.tsx`.
- A `"system"` actor — no writer could produce it.
- Retiring `ai.documentWrite`.
- Per-actor retention or capping. `ACTIVITY_MAX_ENTRIES` stays one global cap.
