# Staged-write follow-through — design

**Goal.** Close the six defects 0.283.0 "Lessing" left behind in the staged review card and its apply
path, plus the verification debt filed alongside them. The through-line for four of the six is one
sentence: **the card must not misrepresent the write it is about to make.** The fifth (§380) is a
capability gap, and the sixth (§374) is comment rot.

**Branch.** `feat/staged-write-follow-through`, off `origin/main` at `2f59561c`.

**Closes.** §380 · §381 · §376 · §373 · §372 · §374 (code) · §375 (owed eye-verify, performed by the
user) · §370 (test-only).

---

## Provenance, and why this slice needs a cold reviewer

★★★ **Six of these eight entries were filed by the author of the code they describe, who is also
writing this spec and will review the implementation.** That is the configuration in which a defect in
the *justification* survives — the register records it as the recurring failure across nearly every
slice ("the defect sat in MY plan, MY comment or MY correction text, not in the implementation").

The mitigation is structural, not a promise to be careful: **a cold reviewer receives this spec and the
diff, and not the conversation that produced either.** Its brief is to refute the claims below, not to
confirm them, and specifically to ask of each design decision "what command shows this is true?".

---

## What the register said and what the code says — one correction, made before briefing

§380's body states: *"A proper fix needs a per-entity full-row resolver run after the create lands."*

**Six such resolvers already exist**, on the `ToolDispatcher` that `applyProposal` already holds as an
argument. Verified 2026-09-05:

```bash
grep -nE "get(Task|RaidRow|ChangeRow|MilestoneRow|StakeholderRow|ResourceRow)\(" src/app/chat-tools.ts
```

They are distinct from the `list*` / `create*` family that returns `*Summary`, which is what makes the
summary-derived-token dead end §380 documents inapplicable here. Each token-guarded update site already
calls its `get*Row` before `requireToken` — e.g. `chat-tools.ts`'s `update_raid_item` case resolves
`d.getRaidRow(id)` and passes it as `requireToken`'s `current`.

★★ **The source matters as much as the existence.** These getters read the dispatcher's refs, which the
writers update **synchronously** (`applyProposal`'s own docstring records this as why the loop is
sequential and never `Promise.all`). `chat-panel.tsx`'s `workspaceRef` is updated in a `useEffect`, so
during a tight apply loop it is still pre-create. **A resolver sourced from the workspace prop would read
stale state and stamp a token for a row that is not there yet** — and a unit test with a mock accessor
would pass while production failed. Route through the dispatcher; never through `workspaceRef`.

---

## §380 — a staged plan cannot update a row it created in the same plan

**Today.** `describeProposal` marks a row whose target does not yet exist as `pendingOn` rather than
stamping it (stamping a provisional id that collides with a live row would be a permit for the *wrong*
row). The remapped call therefore carries no `expectedToken`, and `applyProposal` refuses it
pre-emptively with `NEW_ROW_TOKEN_UNAVAILABLE_ERROR` before `runTool`, so the failure cannot reach
`requireToken` and inherit the `stale` label.

**Fix.** After a create resolves and `resolveMintedId` records its real id, a later token-guarded row
whose target this plan minted gets a **real** token stamped:

```
entityToken(kind, getRow(realId))
```

resolved through a new map from token-guarded tool name to `{ kind, getRow }`:

| tool | kind | dispatcher getter |
|---|---|---|
| `update_task` | `task` | `getTask` |
| `set_task_dependencies` | `task` | `getTask` |
| `update_raid_item` | `raid` | `getRaidRow` |
| `update_change` | `change` | `getChangeRow` |
| `update_milestone` | `milestone` | `getMilestoneRow` |
| `update_resource` | `resource` | `getResourceRow` |
| `update_stakeholder` | `stakeholder` | `getStakeholderRow` |

The tool layer is **unchanged and still enforcing** — it receives a genuine token, not a bypass. That is
the whole reason to prefer this over an out-of-band "skip the check" context: there is exactly one path
through the guard, and it is the same one every other row takes.

**Pinning.** The map is asserted equal to `TOKEN_REQUIRED_TOOLS` **in both directions** — every guarded
tool has an entry, and every entry names a guarded tool. A one-directional assertion lets a future
token-guarded tool be added with no entry and fall silently back to the refusal, which is the same
defect wearing a different number.

**Refusal is retained, not deleted.** `NEW_ROW_TOKEN_UNAVAILABLE_ERROR` must still fire when the getter
returns `null` — a create that succeeded but whose row cannot be read back. Deleting the refusal because
the happy path now works would convert a loud, recoverable failure into an untokened write attempt.

### The accepted vacuity — recorded, not hidden

★★★ **A same-plan-created row's concurrency guard becomes vacuous: the token is read moments before the
write, so that row can never report `stale`.**

This is correct rather than a hole. The token answers "you reviewed state X, has it moved?". For a row
that **did not exist at review time** there is no reviewed state and nothing to clobber but what this
same plan just wrote. The guard has no work to do.

It is nonetheless a deliberate hole in a safety mechanism, so it goes in the map's docstring **and** in
the register, in the words above. The failure mode this prevents is a later reader seeing a token stamped
on the row and reading it as protection it does not provide.

---

## §381 — a row refused for a capability gap is labelled as a conflict

**Today.** `ProposalCardRow.failed` is one boolean and the card renders `chatProposalFailed` — EN "Not
applied — changed since you reviewed" — for every not-ok row. `chat-panel.tsx` collapses
`applyProposal`'s result into a set of the indices where `ok` is false, discarding `AppliedRow.error` and
`AppliedRow.stale` alike. The apply path distinguishes three outcomes; the card throws the distinction
away and tells the user something false, inviting the one recovery that cannot work.

**Fix.** `failed` goes on covering **every** not-ok row — under-reporting is the worse direction, and a
row that did not land must never read as applied — and gains a kind alongside it. `chat-panel.tsx` stops
collapsing and carries the outcome through. A second EN/DE string covers the not-a-conflict case
(`PENDING_MINT_ERROR` and `NEW_ROW_TOKEN_UNAVAILABLE_ERROR`), keyed off the two **already-exported**
constants rather than by matching prose.

★ `chatProposalFailed` stays correct for `stale: true` and keeps its current wording.

★ This entry stands even if §380 were never fixed: `PENDING_MINT_ERROR` is reachable independently, from
a create that throws or one that returns no usable id.

---

## §376 — a staged document row cannot be named in the review card

**Today.** The three `*_document` tools are in the staging gate's write set, so they are staged — but the
descriptor engine has no `document` entity, so `describeProposal` returns them with an empty plan. The
card has only `call.name` and `call.input`: it cannot say which document is touched or removed.

**Stakes.** Document chat writes take **no undo capture at all** (they recover via `documentVersions`
instead), so this card is the only thing between the model and an unreviewed multi-document rewrite — and
it is the row the card can say least about.

**Fix.** `describeProposal` resolves the document's title from `ws.documents` by `input.id`; the card
renders the operation (from the tool name) plus that title. **No `document` descriptor** — `blocks` is a
typed union outside `diffFields`' scalar model, so a descriptor would diff the title alone while implying
it diffs more.

★ An id matching no document renders the tool name alone, exactly as today. The row stays selectable and
rejectable either way; this fix is about legibility, not reachability.

---

## §373 — the preview shows a value Apply clips, trims or discards

**Today.** The preview's `after` is the raw input coerced by `str` in `describeEntityCalls`
(`inline-ai-edit/plan.ts`) — `String(v)` with a null/array shim, **no trim, no cap, no format check**.
Apply runs the value through a sanitizer instead. They diverge three ways:

1. **Length** — a value past its field's cap previews in full and stores clipped. Caps are not shared:
   `assigneeEmail`, RAID `ownerEmail` and resource `email` route through `sanitizeEmail` (`EMAIL_MAX`
   320), while `sanitizeStakeholder` uses `sanitizeText(o.email, BUDGET_NAME_MAX)` — a different
   sanitizer at a different cap (200).
2. **Non-string** — `str(42)` previews `"42"`, `sanitizeText` returns `""`. Worse at the caller:
   `sanitize-entities.ts` writes `if (email) resource.email = email;`, so the key is **omitted**, and on
   an update built by spreading the stored row that **clears an email the row already had**. Preview:
   `old@x.com → 42`. Result: no email at all.
3. **Whitespace** — `str` does not trim and the sanitizers do.

★★ **The entry is titled around email-shaped fields, but the mechanism is not email-specific.** Length,
non-string and whitespace divergence affect **every text field**; email is merely where the caps differ
and where the emptiness-drop destroys an existing value. Fixing only the four email fields would leave
the same lie on every other field — and scoping a fix to what an entry names is the register's
best-recorded way to ship a false closure.

**Fix.** The preview runs the same normalization Apply will, for **all** `diffFields`: coerce non-strings
to `""`, trim, apply the field's cap. This mirrors what `dateFields` already does for dates
(`sanitizeIsoDate(after) !== after` → reject) rather than adding a per-field "may drop" flag.

**Caps are declared per field, not inferred, and `EntityDescriptor` has nowhere to put one today.**
Verified 2026-09-05 — its members are `diffFields`, `requiredNonEmpty`, `dateFields`, `intRangeFields`,
`enumFields`, `enumDefaultFor`, `arrayFields`, `numberFields`, `titleOf`; there is no text-cap member and
`grep -nE "Cap|MAX|maxLen" src/app/inline-ai-edit/entity-descriptor.ts` returns nothing. So this fix adds
one:

```ts
/** Text fields whose sanitizer clips at a cap, → that cap. */
textCaps: Record<string, number>;
```

★★★ **Populate it with the sanitizers' own exported constants (`EMAIL_MAX`, `BUDGET_NAME_MAX`, …), never
with typed-out numbers.** A literal `320` in the descriptor is a second copy of a value that lives
somewhere else, and it goes stale silently the first time the sanitizer's cap moves — reintroducing this
entry's exact defect (preview and apply disagreeing) by the exact mechanism §372 warns about one section
below. Referencing the constant makes the two impossible to diverge.

★ The two email caps differ by entity (`EMAIL_MAX` 320 for task/RAID/resource, `BUDGET_NAME_MAX` 200 for
stakeholder), so a single shared cap would leave the stakeholder preview wrong in exactly the direction
it is wrong today.

★ A field absent from `textCaps` is trimmed and non-string-coerced but not clipped. That is the correct
default: those two divergences are universal, a cap is not.

★ Consequence to expect during implementation, not to mistake for a regression: any existing test
asserting an untrimmed or uncapped preview string goes red. That is the fix landing.

---

## §372 — an `update_resource` rename sent as the `name` alias previews an empty plan

**Today.** `name` is a write alias the dispatcher splits into `firstName`/`lastName`; it is not a stored
field, and is deliberately absent from the `resource` descriptor's `diffFields` because `before` would
read empty for every resource. So `update_resource({id, name})` produces no diff, previews as an empty
plan, and renames the person on apply. The descriptor's own comment records this consequence.

**Fix.** At preview time, when `input.name` is present, project it into `firstName`/`lastName` and diff
those against the stored row.

★★★ **The projection must call the dispatcher's own split, never a reimplementation.** A second copy of
that rule is precisely how preview and apply diverge again — this slice's entire subject.

---

## §374 — `help-content.ts` says five inline entities and there are six

One line. `src/app/help-content.ts:162` reads `★ Five entities, from \`InlineEntity\``; `InlineEntity`
gained `resource` in the bulk-write-safety slice. The comment's *claim* (which views the help entry
relates to) is still true; only its count is stale.

★ No gate can see this — `docs:symbols:check` proves a backticked NAME exists (`InlineEntity` exists
either way) and cannot see a count at all.

---

## §370 — redo of an AI-captured delete is unproved

The Phase 1 round trips in `use-chat-dispatcher.undo.test.tsx` all stop after `undo()`. The undo
direction is proved at all 14 capture sites and the redo direction at none. Add the redo leg to the
existing round trips.

★ Not evidence of a defect — the capture path is shared with the human writers, whose redo *is*
exercised. This closes a coverage asymmetry, not a bug.

---

## Testing

- **§380** — the map's two-directional equality against `TOKEN_REQUIRED_TOOLS`; a create-then-update plan
  applying both rows; the getter-returns-null path still refusing with
  `NEW_ROW_TOKEN_UNAVAILABLE_ERROR`.
- **§381** — each of the three outcomes rendering its own string; a `stale` row keeping the existing one.
- **§376** — a `delete_document` row naming its document; an unresolvable id degrading to the tool name.
- **§373** — one case per divergence (cap, non-string, whitespace), and the stakeholder cap asserted
  **separately** from the `EMAIL_MAX` ones, since a single shared-cap assumption is the defect.
- **§372** — a `name`-only rename previewing a non-empty diff.

★★ Every fix here is a behaviour the current code gets wrong, so each test must be shown **red before
green** — a test written against already-fixed code proves only that it agrees with itself.

★★ **Mutation-test the §380 map assertion specifically.** A one-directional assertion passes against the
mutant that matters (an entry deleted), which is why both directions are specified above.

---

## Risks and landmines

- **`plan.ts` is shared with the inline-edit surface.** §373 and §372 change previews there too. Read
  that as fixing the same lie in a second place — but the inline-edit tests are a **gate on this slice**,
  not bystanders.
- **`descriptor-drift.test.ts`** likely needs extending to pin the new cap/alias configuration.
- **New `.ts` files are coverage-gated.** Anything extracted needs tests or a documented
  `coverage.exclude` entry with a reason.
- **`src/app/i18n.de.ts` must never be touched with Edit or Write.** Patch via a `.mjs` written with the
  Write tool, `\r\n` anchors, real umlauts, no `\uXXXX` escapes (the `i18n-encoding` test bans ASCII
  substitutions).
- **`npx tsc --noEmit` after any test edit** — vitest never typechecks, and `tsc` exits **2** on
  diagnostics.
- The two modified sample workspaces (`sample-workspace-big.json`, `sample-workspace-huge.json`) are
  foreign to this slice and must never be committed.

---

## §375 — the owed eye-verify (performed by the user)

Not code. It needs a real model turn against a live Anthropic key, which is why it is not automated here:
the unit tests render the card from fixture props, so they prove the card's behaviour and nothing about
whether a real turn produces those props. No e2e seed can reach it either — the axe run seeds file mode,
and the card exists only after a model turn.

Steps, to be run at the end of the slice against `PORT=3100 npm run dev`:

1. Provoke a destructive or multi-write turn (e.g. ask the assistant to retitle several tasks and delete
   one).
2. Confirm the review card renders and lists every row it intends to write.
3. Reject one row that another row depends on; confirm the dependent deselects and disables.
4. Apply.
5. Confirm **one** undo entry restores every applied update and delete.

Two outcomes to watch for specifically, both reachable from an ordinary turn and invisible to every
suite: a create-then-update plan refusing its update row (§380 — should now apply), and a refused row's
label (§381 — should now distinguish a capability gap from a conflict).

---

## Non-goals, stated so they do not read as oversights

- **`resource.emails`** has §373's exact shape (`sanitizeEmailList` dedupes against the primary `email`
  and caps), but it is a list, not a scalar, and `arrayFields` cannot express it — that flag means
  "comma-split on Apply", which is the task-labels shape. File it rather than bend this fix around it.
- **Document rows do not become token-guarded.** §380's fix covers the seven tools in
  `TOKEN_REQUIRED_TOOLS`; the `*_document` tools are not among them.
- **No `document` descriptor** (see §376).
- **The §380 vacuity is accepted, not closed** — see the section above.
