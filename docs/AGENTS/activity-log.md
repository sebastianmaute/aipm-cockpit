# Activity log — `Workspace.activityLog`

Owns the per-project audit trail: its meta-blob persistence, the `logMode` split across the
two load funnels, entry ids, forward-compat sanitising, who stamps the actor, and the three
incompatible delta shapes the completion trend derives from it.

Does NOT own the undo stack itself, the AI dispatcher's tool surface
(`docs/AGENTS/ai-assistant.md`), or the six-write-paths rule (`AGENTS.md`). One fact, one doc.

★★★ **IT IS WORKSPACE DATA THAT MUST NEVER BE EXPORTED.** An entry's `changes` carries old/new
values for up to 12 fields — internal audit detail that must not reach a client-facing
document — so it is storage-only on every path, and it is absent from `TABLE_NAMES` because
it has no table of its own, NOT because it sits outside the workspace.

- **Activity log (`Workspace.activityLog`):** per-project audit trail, promoted from a per-device
  `localStorage` blob. Persists via the **meta-blob** pattern (one JSON row in `meta`, like
  `insights`/`documents`), NOT `ENTITY_SPECS` — so it is correctly absent from `TABLE_NAMES` because it
  has no table, **not** because it is non-workspace data. ★★ **STORAGE-ONLY on every path**: no
  `activityLog` key in `EXPORT_SECTION_KEYS`, and the CSV and Markdown emit sites gate on
  `config === undefined` rather than routing through the export `enabled(...)` allow-list. An entry's
  `changes` carries old/new values for up to `MAX_FIELD_CHANGES` (12) fields per update — internal
  audit detail that must never reach a document handed to a client. Do not add an export key.
  ★★ **Nor an AI-snapshot field.** `runTool`'s `get_app_state` returns `getSnapshot()` verbatim, so the log
  is reachable only through `getActivityLog()` on `ToolDispatcher`. It is CAPPED (`ACTIVITY_MAX_ENTRIES`),
  and discovering that cap is not a licence to "complete the pattern" — the guard rests on per-call size,
  not on unboundedness. Reasoning + the guard test:
  [`docs/AGENTS/ai-assistant.md`](docs/AGENTS/ai-assistant.md).
  ★★★ **`isWorkspaceEmpty` deliberately EXCLUDES it, INVERTING the `documents` rule directly above.**
  The log is auto-appended by ordinary use, so counting it would make a project with log entries and no
  user records read as non-empty — letting a transient empty backend read replace a populated project,
  i.e. turning a data-loss guard into a data-loss vector. Same reasoning keeps it out of
  `nonEmptyCollectionCount`/`workspaceRecordCount`. Pinned by `workspace.test.ts` ("a workspace holding
  ONLY activity entries is still EMPTY (inverse of documents)"). Do not "complete" the documents
  precedent.
  ★★★ **`applyWorkspace`'s `logMode` has TWO branches and they are not interchangeable.** MERGE
  (same-project load/reload) unions by id via `mergeActivityLogs` so entries appended while a load was
  in flight survive; REPLACE (project switch/create/load-from-file) stops the outgoing project's trail
  leaking into the target. **The default is REPLACE — the contaminating direction must be asked for
  explicitly.** ★★ Those switch/create/load-from-file sites do NOT hide from a bare
  `grep "applyWorkspace("` — they spell it `deps.applyWorkspace(ws)` and the grep finds all six. What
  hides is the ARGUMENT: the deps contract in `use-storage-file-ops.ts` / `use-storage-turso-ops.ts` is
  typed `(ws: Workspace) => void`, one parameter, so those call sites structurally CANNOT pass a
  `logMode` and silently take the default. Widening that contract is what would let one of them opt into
  the contaminating branch — check the TYPE, not the call text.
  ★★ **`applyRestoredWorkspace` (`task-manager.tsx`, the SECOND load funnel) deliberately does NOT set
  `activityLog`.** `getVersionPayload` builds its snapshot from an explicit field list carrying no
  `activityLog`, so fanning it out would blank the audit trail on every version restore.
  ★★ It is ONE OF FOUR slices on which the two funnels disagree, NOT the only one — `features`,
  `fieldVisibility` and `documentAssets` are also absent from the restore fan-out. An earlier revision
  said "the one slice" and its successor said THREE; either sends a reader who diffs the funnels off to
  distrust the doc or to "complete the pattern" on the rest. ★★★ **THAT SENTENCE HAS NOW BEEN
  OVERTAKEN TWICE BY SLICES THAT NEVER OPENED THIS FILE** — `documentAssets` joined `applyWorkspace`
  with S3c-1 and nothing here moved. Do not repair it by writing FOUR and walking away; re-derive,
  which is why the commands sit below rather than the count. ★★ That diff returns FIVE names, not
  four — the fifth is `setLoadedBackend`, which is the load GATE (`workspaceLoaded` derives from it),
  not a workspace slice, and the comment above `applyRestoredWorkspace` already says the restore
  funnel deliberately omits it. Four SLICES, five NAMES; a reader who stops at the count will think
  this line is wrong. ★ A range that stops at `setCalendarEvents` hides `setLoadedBackend` and returns
  four — it is deliberately the LAST call in `applyWorkspace`, so end the range at the function's close
  brace. ★ It does NOT hide `setDocumentAssets`, which shares `setCalendarEvents`' source line.
  ★★★ RUN THESE RATHER THAN PARAPHRASE THEM. The paragraph above described this diff in prose
  ("extract the setter names … and `comm` them") while the code comment that carried the real command
  lost it to a size-ratchet condense — and prose describing a command is not a command. It cannot go
  back there: `use-storage-backend.ts` stands at **799** of the 800-line cap (`size:check` counts
  `wc -l` plus one) — ONE line of headroom, not the two this used to imply — and this file is outside
  that gate's `src` walk, so the command lives here.
  ★★ **SUPERSEDED 2026-09-03 — the headroom half of that argument no longer holds.** The ratchet
  LIMIT was doubled 800 → 1600, so `use-storage-backend.ts` (still 799) now has ~800 lines of room
  and the command COULD go back into the source comment. The reason to keep it HERE is unchanged and
  is the one that always mattered: prose describing a command is not a command, and a comment that
  gets condensed loses it again. Read the paragraph above as the rationale, not the line count.
  `sed -n '/^  const applyWorkspace = /,/^  };$/p' src/app/use-storage-backend.ts | grep -oE 'set[A-Za-z0-9_]+\(' | sort -u | wc -l` → **29**
  `sed -n '/^  const applyRestoredWorkspace = /,/^  \}, \[/p' src/app/task-manager.tsx | grep -oE 'set[A-Za-z0-9_]+\(' | sort -u | wc -l` → **24**
  `comm -23 <(sed -n '/^  const applyWorkspace = /,/^  };$/p' src/app/use-storage-backend.ts | grep -oE 'set[A-Za-z0-9_]+\(' | sort -u) <(sed -n '/^  const applyRestoredWorkspace = /,/^  \}, \[/p' src/app/task-manager.tsx | grep -oE 'set[A-Za-z0-9_]+\(' | sort -u)`
  → `setActivityLog(` `setDocumentAssets(` `setFeatures(` `setFieldVisibility(` `setLoadedBackend(`
  ★★ THE TWO RANGES TAKE DIFFERENT ANCHORS AND BOTH WRONG FORMS INFLATE SILENTLY rather than error.
  `applyRestoredWorkspace` is a `useCallback`, so it closes on `}, [` — reusing the first command's
  end anchor there runs 626 lines and reports 39. And that first command's start pattern needs the
  `const … = ` prefix: bare, it spans 573 printed lines and reports 32.
  ★★★ **THE NUMBERS ARE RIGHT AND THE MECHANISM WAS WRONG, and the correct one is two lines below.**
  This said a bare match "starts at an earlier mention". It does not: the FIRST occurrence of
  `applyWorkspace` in that file IS the declaration, so anchored and bare open at the very same line.
  573 is not an offset — it is the TOTAL printed span, because `sed` RE-TRIGGERS the range at every
  LATER mention (the comments, the call site, the two return-object keys), each opening a fresh
  range that runs to the next `^  };$`. That is exactly the re-trigger the paragraph below already
  describes correctly, which is what makes this the file contradicting itself rather than merely
  being stale. The anchored form spans 64 lines. Reproduce both spans:
  `sed -n '/^  const applyWorkspace = /,/^  };$/p' src/app/use-storage-backend.ts | wc -l` against
  `sed -n '/applyWorkspace/,/^  };$/p' src/app/use-storage-backend.ts | wc -l`, and
  `grep -n applyWorkspace src/app/use-storage-backend.ts | head -1` for the start line.
  ★★★ **THE SELF-MATCH CAME BACK, AND THIS PARAGRAPH HAD DECLARED IT RETIRED.** It read: the code
  comment that used to quote this command "is gone, the file now holds one occurrence, and anchored
  and unanchored both return 28". By 2026-08-25 a comment in `use-storage-backend.ts` was spelling
  the START PATTERN in full again, so `sed` opened a SECOND range there: measured, the unanchored
  form returned **31** against the anchored form's **29**, and only the leading two-space anchor
  saved the anchored one, because the quoted copy is indented as a comment body. That comment now
  spells the pattern short on purpose and both forms return **29** — but the RECURRENCE is the point,
  not the repair. ★★ The durable rule, which survived all three revisions of this line: a command
  quoted inside the file it scans WILL eventually match itself, and it fails by returning a plausible
  LARGER number rather than by erroring. Never write "dormant" about it — write the anchor and keep it.
  ★★★ **THE SIX-SLICE BLANKING THIS PARAGRAPH RECORDED IS FIXED — corrected 2026-08-25.** It read:
  `getVersionPayload` captures 18 slices while `applyRestoredWorkspace` fans out 24, so
  `knowledgeItems`, `insights`, `documents`, `documentVersions`, `settingsOverrides` and
  `calendarEvents` "are each SET from a payload that never carried them — i.e. blanked on every
  version restore", filed as pre-existing and deliberately not fixed. Those six were added to the
  capture, so **both sides are 24 and they now agree slice for slice** (`docs/open-followups.md`
  §240). Derive it rather than reading the number here — the payload's field list and its dep array
  are the same 24 names twice over:
  `sed -n '/const getVersionPayload = useCallback/,/^  );$/p' src/app/task-manager.tsx`.
  ★★★ **"BOTH SIDES ARE 24" IS ABOUT THE CAPTURE AND THE FAN-OUT — NOT ABOUT WHAT A RESTORE
  REWRITES, and reading it the second way is a data-loss bug.** `applyRestore` starts from the LIVE
  workspace and rewrites only keys present in `COLLECTION_SPECS` (`version-diff.ts`), so the two
  sets are related but not equal. ★★★ **THIS PARAGRAPH SAID THE FIVE ARRAYS WERE DELIBERATELY ABSENT
  FROM THAT REGISTRY AND INVISIBLE TO `diffWorkspaces` — corrected 2026-08-26, when they were
  registered.** All five (`knowledgeItems`, `insights`, `documents`, `documentVersions`,
  `calendarEvents`) are `kind: "list"` rows now, so the diff sees every one of them and a session
  editing only those slices DOES capture a version. Three are restorable; `documents` and
  `documentVersions` carry `restorable: false` — diff-visible, but `applyRestore` skips them
  (`if (spec.restorable === false) continue;`) because `applyDocMutation` owns document history and
  wiring them in would give one document two independent histories. Derive it rather than reading it
  here — the two non-restorable rows say so in the row:
  `grep -E 'key: "(knowledgeItems|insights|calendarEvents|documents|documentVersions)"' src/app/version-diff.ts`
  ★ Two of them were briefly in the registry as `kind: "singleton"`, which spread the array into an
  object and made every backend drop the slice on the next save; that was fixed well before the
  registration above, and the reason is in the registry's own comment. Tracked as
  `docs/open-followups.md` §241 and §242 — BOTH still open, each on a deliberate remainder rather
  than on the behaviour this paragraph used to describe.
  The round-trip is pinned by `task-manager.restore-backfill.test.tsx` ("round-trips all six optional
  slices through getVersionPayload"), whose SIBLING test is the reason a pin was needed at all: it
  feeds the restore a workspace that already carries the slice, so it would pass with the capture
  still dropping it.
  ★★★ **AN ABSENT SLICE KEY IS NOT AN EMPTY ONE, AND THE PAYLOAD NOW SAYS WHICH.** `workspaceToJson`
  omits an additive slice's key whenever the live array is empty, and `getVersionPayload` could not
  emit these six AT ALL before `db217e08` (2026-08-25) — so `{"tasks":[…]}` is byte-identical whether
  the user genuinely had zero knowledge items or the format simply could not carry them. Read as
  "empty", every live record diffs as `"added"` and the restore DELETES the lot; read as "cannot
  speak", nothing is deleted but a restore can never again REMOVE a record added since the capture,
  for any of the six, permanently. Both readings are wrong and no care inside the diff can separate
  them, because the information was not in the payload. `version-capture-format.ts` puts it there:
  `stampCaptureFormat` marks every capture at `capturePayload` — the single point `writeVersion` and
  `restore` both funnel through — and `diffWorkspaces`/`applyRestore` each take a
  `…SpeaksForEmptySlices` flag that DEFAULTS TO FALSE, the safe reading.
  ★★ `PRE_FORMAT_2_BLIND_SLICES` is scoped to exactly `db217e08`'s six and BOTH ends are load-bearing:
  wider (adding `project`/`steeringCommittee`/`timelogLinks`, additive and omitted-when-unset too but
  emitted all along) silently turns every revert-to-unset into a no-op; narrower — dropping the
  SINGLETON `settingsOverrides` because its five siblings are arrays — lets a restore blank a
  project's timezone and notification overrides permanently. Both mistakes were made and caught on
  2026-08-26; see `docs/open-followups.md` §259.
  ★★ The suppression lives in `diffWorkspaces`, not only in `applyRestore`, and that is the half
  that is easy to skip: a restore that SKIPS a slice is invisible to the surface — the row still
  renders a checkbox and a "Restore this" button, the empty-selection toast does not fire, and
  `restore()` returns `true` and logs "Restored N change(s)" for a restore that changed nothing.
  A row the restore will refuse to act on must never be offered.
  ★★ "Deliberately omitted ⇒ preserved" is STILL true of `activityLog` alone as a statement about
  INTENT, and that is the half worth keeping: it is omitted from BOTH sides on purpose, with the
  reason written down. `features`, `fieldVisibility` and `documentAssets` are absent from the restore
  fan-out and are equally preserved — but by nothing that says so, which is the same silence that let
  the six above stay blanked for as long as they did. Read neither as a guarantee. ★ `documentAssets`
  now has a number for exactly that silence — `docs/open-followups.md` §254, which records that the
  absence is plausibly deliberate and that nothing in the code says so.
  ★★ **Entry ids are `"<deviceId>-<sessionNonce>-<counter>"`.** The middle segment is load-bearing:
  `getDeviceId` persists its value in `localStorage` (`DEVICE_ID_KEY`) while the counter is module
  scope, so `"<deviceId>-<counter>"` re-mints the same id on every reload and `mergeActivityLogs` (which
  unions by id) silently discards one of two real entries. ★ Minted inside a `setState` functional
  updater (`useActivityLog`), which React double-invokes under StrictMode — the counter is gap-tolerant
  by design and must never be treated as a dense sequence number.
  ★★ **An unknown-but-string `kind` is KEPT, not dropped** (`sanitizeActivityEntry`), unlike the retired
  localStorage-era validator: the log is shared workspace data and the autosave writes loaded state
  straight back, so an older client dropping a kind a newer release added would DELETE those entries
  from the shared project. Rendering falls back to `activityUnknownKind` via `activityMessageKey`, whose
  `hasOwnProperty` check is required — a bare index resolves `kind: "toString"` to a `Function` prototype
  method, `t()` then misses it in the dict and throws on `undefined.replace`, crashing the app through
  the top-level `ErrorBoundary`. ★ A non-string or absent `kind` IS dropped: `activityGroupOf` calls
  `kind.startsWith` and there is nothing honest to display.
  ★★ **An entry also carries an OPTIONAL `actor` (`"user"` | `"ai"` | `"integration"`), and ABSENCE IS
  NOT `"user"`.** Every entry written before 0.244.0 has a genuinely unknown author, so defaulting the
  missing case would attribute the entire pre-release trail to whoever happens to be reading it.
  `ActivityEntry` keeps the field optional for exactly that reason — render the gap as unattributed,
  never as a person, and never filter as though absence meant anything.
  ★ **It rides all SIX write paths for free, and that is not a violation of the six-write-paths rule
  above.** Every path serialises the whole entry as JSON wholesale (CSV as one `config,<json>` cell,
  Markdown as a fenced json block), so a new FIELD on a meta-blob entry costs no per-path work at all.
  The landmine is about a new SLICE. ★★ Do NOT generalise that to an `ENTITY_SPECS` entity, where a new
  column really does cost every one of the six — the exemption is a property of the blob, not of the
  activity log.
  ★★★ **`sanitizeActivityEntry` KEEPS an unknown-but-string `actor`** — the same forward-compat reason
  it keeps an unknown `kind` directly above, and a non-string one is stripped the same way. **So every
  actor lookup needs an own-property guard, never a bare index:** `actor: "toString"` otherwise resolves
  a `Function` prototype method, which is the crash shape the `activityMessageKey` `hasOwnProperty`
  check already exists to prevent. Nothing gates this and a green suite will not find it — the fixture
  has to carry the hostile string.
  ★★★ **THE AI DISPATCHER'S ENTITY WRITERS NOW LOG** (`actor: "ai"`, reusing the EXISTING kinds). Those
  writers logged NOTHING before 0.244.0, so the trail was blind to every AI-made ENTITY change and any
  older reasoning that read the log as "what the assistant did to my records" was wrong by omission.
  ONE kind was added — `bulk.delete` — because recording an irreversible mass delete as `bulk.edit`
  misdescribed it.
  ★ **SCOPE IT TO ENTITY WRITES — it was NOT "every AI-made change", and an earlier revision of the line
  above said it was.** Nine call sites in six files already logged `ai.*` kinds at base: `ai.documentWrite`
  (`use-document-tools.ts`, ×3), `ai.inlineEdit` (`use-inline-entity-edit.ts`, ×2 — since REMOVED, see
  [`docs/AGENTS/ai-assistant.md`](docs/AGENTS/ai-assistant.md)), `ai.insightRecommendation`
  (`task-manager.tsx`), `ai.allocationPlan` (`use-alloc-plan.tsx`), `ai.raciSuggest`
  (`use-raci-suggest.tsx`), `ai.taskDedup` (`use-tasks-dedup.tsx`). Re-derive against the merge base
  rather than trusting the number:
  `git grep -nE 'logActivity[A-Za-z]*\??\.?\(\s*"ai\.' 2e2c8c00 -- src/app | grep -v test` → **9**.
  `CHANGELOG.md` got the scope right — it scopes the gap to the assistant's ENTITY WRITERS, not to
  every AI-made change (`sed -n '20p' CHANGELOG.md`). One claim in three places, one correct.
  ★★ **The actor is stamped at the WIRING, not the leaf.** `useActivityLog` returns pre-stamped
  `logActivityUser`/`logActivityChangesUser`, because a leaf logging a generic kind cannot know whether
  a user, the assistant or a background pull reached it. **A call site's spelling is therefore NOT its
  actor** — never infer one by grepping for the kind; find which wrapper the site was handed.
  Integrations (Jira sync + the four calendar background auto-pulls) stamp `"integration"`.
  ★ **`completion-trend.ts`'s `COUNT_KINDS` set has FOUR members** — `task.created`, `task.completed`,
  `task.reopened`, `task.deleted` — and the dispatcher writes exactly TWO of them, `task.created` and
  `task.deleted`. So tasks the AI creates or deletes now move that trend. Intended, but it is a change to
  an EXISTING derived metric — the trend can shift with no user action behind it.
  `grep -n COUNT_KINDS src/app/completion-trend.ts` prints the set;
  `grep -oE 'logActivityAs\?\.\("ai", "[a-z.]+"' src/app/use-chat-dispatcher.ts | sort -u` prints the 21
  distinct kinds the dispatcher writes across its 23 sites, of which those two intersect the set.
  ★★ **An AI status change to Done still logs `task.updated`, and now logs a completion BESIDE it** —
  `update_task` stamps that one kind whichever fields it touches, exactly as the form save does
  (`use-task-submit.ts`, which routes the status through `logActivityChanges("task.updated", …)`), so the
  `task.updated` entry alone remains invisible to the set; both sites now also emit the transition. Same
  for the INLINE status dropdown, which used to log on DELETE only.
  ★★ **SCOPE THE COMMAND TO THE CLAIM.** An earlier revision attached `grep -n "logActivity"` to the
  dropdown claim, which returns **6** lines on that file — the prop type, the destructure, the ref init,
  the ref assignment, a dep array and the one call. The claim was TRUE and the command did not reproduce
  it, which is the exact failure the rule at the top of this file exists to prevent; both reviewers
  flagged it independently.
  ★★★ **`task.completed` AND `task.reopened` NOW HAVE WRITERS, and this
  entry used to say the opposite.** It read: they "have **NO writer anywhere in the app**, only a union
  member, an `activityMessageKey` row and their seat in this set", with
  `git grep -nE '"task\.(completed|reopened)"' -- 'src/app/*.ts' 'src/app/*.tsx' | grep -v '\.test\.'`
  attached and an expected answer of "only `activity-log.ts` and `completion-trend.ts`". Both halves are
  stale, and the COMMAND is the more dangerous half: the writers do not spell either literal, they call
  the shared `statusActivityKind` decision, which returns the kind. Run today it prints THREE files —
  `activity-log.ts`, `completion-trend.ts` and `task-status.ts` — and names not one writer. Enumerate
  them with the helper instead:
  `git grep -nE 'statusActivityKind' -- 'src/app/*.ts' 'src/app/*.tsx' | grep -v '\.test\.'`
  → the definition in `task-status.ts` plus SIX consuming files: `use-task-submit.ts`,
  `use-task-row-handlers.ts`, `use-bulk-operations.ts`, `use-action-center-handlers.ts`,
  `use-chat-dispatcher.ts` and `use-jira-sync.ts`.
  ★★★ **A MISSED WRITER COSTS AN AUDIT ENTRY *AND* CAN MOVE THE CHART — and this line used to deny the
  second half.** It read "A MISSED WRITER COSTS AN AUDIT ENTRY AND NEVER A METRIC", then contradicted
  itself one clause later by conceding "their only metric-side job stays the seeding one". Seeding IS a
  metric effect. What is true: the **numerator** cannot be moved by a missed writer, because `deliveredBy`
  reduces over `tasks` and never over these entries. What is false: that nothing else can. Both kinds sit
  in `COUNT_KINDS`, which both ADMITS an entry past the `continue` guard and decides which days SEED a
  point — so a missed writer changes which days the reconstructed sparkline plots, and can drop it under
  the `days.length < 2` floor, rendering no chart at all.
  ★★ Measured 2026-08-30 against the real module with `npx vite-node`, not reasoned — two probes, because
  the effect is not merely additive. (1) One task delivered 06-10, `currentDone` 1, `currentTotal` 2,
  today 06-21: activity `[task.completed 06-10, task.created 06-12]` → `[06-10 → 100, 06-12 → 50]`;
  drop the completion entry → `[]`. (2) Two tasks delivered 06-10 and 06-15 against two `task.created`
  days 06-08/06-09, `currentDone` 2, `currentTotal` 4: without completion writers →
  `[06-08 → 0, 06-09 → 50]`, with them → `[06-08 → 0, 06-09 → 0, 06-10 → 25, 06-15 → 50]`.
  ★★★ **THE THIRD POINT IS THE ONE THIS BULLET EXISTS FOR.** 06-10 carries a completion and NO create
  or delete, so no total moves on it and
  it is plotted only because `task.completed` is a member of `COUNT_KINDS` — a completion-only day, the
  exact thing the surrounding prose argues for. `06-09` MOVES, because
  the last plotted point keeps `currentDone` by design and seeding a later day demotes 06-09 to history,
  where `deliveredBy` correctly reports 0 delivered. The new value is the CORRECT one — this is an
  accuracy improvement, not a regression — but it is a user-visible change on the default file-mode path.
  Pinned by the "a completion-only day" pair in `completion-trend.test.ts`.
  ★★ `status-activity-census.test.ts` shipped in `9bf06d3b` and its own header states the
  two reasons it is a convenience: it is file-granular, and it matches on spelling. A file with several
  write sites passes on any one of them. Per-site coverage is per-site
  tests, and nothing else.
  ★★ The numerator is READ from task data (`deliveredBy` in
  `completion-trend.ts` counts `completedDate <= day`), which is what let the fix work retroactively over
  history already on disk. ★★★ So the two kinds' ONLY remaining job in `COUNT_KINDS` is deciding which
  days SEED a point — a day carrying a completion and no create/delete moves no total at all, yet the
  percent moves on it, so removing them from the set silently DROPS every completion-only day from the
  series. They are members with no delta arm on purpose; do not "tidy" them out.
  ★★ `bulk.delete` is STILL deliberately NOT in `COUNT_KINDS` — that set's members each move the metric
  by ±1 per entry, while one `bulk.delete` entry carries a count of N, so adding it would under-count by
  N−1. §163 closed the gap the OTHER way, as that entry said it had to be: a second set,
  `BULK_TOTAL_KINDS`, whose members have their delta READ OUT OF THE ENTRY (`args[0]`) rather than
  implied by the kind. ★ Do not "simplify" the two sets into one — they encode two different arithmetics,
  and merging them silently reinstates the N−1 undercount.
  ★★★ THERE IS A **THIRD** ARITHMETIC AND IT IS NEITHER SET — `reversedForwardDelta`, added by §166,
  which reads `undo`/`redo` rows. Those two kinds belong to no set on purpose: their delta is neither
  ±1 nor `args[0]` but the FORWARD delta of the ops they reverse, signed by the direction, so an `undo`
  subtracts it and a `redo` re-applies it. `useUndoStack` appends `(kind, count)` PAIRS after the row's
  total-rows arg — one per distinct kind, built by `reversedKindCounts` from `UndoMeta`, at all four
  log sites. Before that the walk honoured a `bulk.delete −N` and ignored its undo, so an undone mass
  delete left every reconstructed day's DENOMINATOR N too HIGH — which, since `percent` is
  `done/total`, pushed the CURVE DOWN, the exact mirror of §163's inflation.
  ★★★ PAIRS, AND THE FIRST CUT'S SINGLE-KIND FORM IS THE LESSON. That cut wrote one kind, or `""` for
  a mixed batch, and defended `""` as an acceptable residual because "every single-entry undo is
  homogeneous, i.e. the common case is exact". True and IRRELEVANT: a single-entry undo never reached
  the batch helper (`commitUndo`/`redo` pass `meta.kind` directly), so the reassurance described the
  one path on which the residual could not occur. `""` arose ONLY under the caret's
  undo-through/redo-through — where a multi-entry batch is the whole point of the control — so
  "delete 50, edit one field, undo through both" discarded the 50-row correction and reproduced §166
  two clicks from its own fix. **A residual's justification must name the path the residual occurs
  on.** Full reasoning in `docs/open-followups.md` §166.
  ★★★ READING UNDO ROWS IS ONLY SOUND WHERE THE FORWARD SIDE IS READ TOO, and the first cut of §166
  broke that: `use-tasks-dedup.tsx` captures `kind: "task.deleted"` but logs only `ai.taskDedup N`,
  which was in neither set — so the reversal added +N against a forward side of ZERO and an undone
  dedup inflated every earlier day. `ai.taskDedup` is now a `BULK_TOTAL_KINDS` member, which also
  closes the pre-existing blind spot (its `args[0]` is `removedCount`, and `applyMerges` returns
  `removedCount: removed.length`). ★★ ENUMERATE THE CAPTURE SITES before touching either set: grep
  `src/app` for a `capture` call whose kind is the task-delete one, excluding tests AND
  `completion-trend.ts`. There are FOUR, and only the dedup one was unpaired. ★★★ The pattern is
  DESCRIBED, not quoted, and an earlier revision here quoted it and claimed "returns FOUR" — it
  returns SIX, because `completion-trend.ts`'s own comment spells the same search string and is
  matched by it. Third recorded instance of a self-matching grep in this repo; a cold review caught
  it in both files at once. Every gate was green over the dedup defect.
  ★★★ `bulk.delete` HAS THREE WRITERS NOW, and for one commit range on this branch it had ONE. (NOT "for
  one release" — an earlier wording said that, and the kind has never shipped: `git grep -n '"bulk\.delete"' 2e2c8c00 -- src`
  returns nothing at the merge base. It sends a reader hunting a released version that does not exist.) The kind arrived with the AI's
  `delete_all_tasks`, so the first cut of §163 corrected the denominator for AI mass deletes while the USER
  path — `handleClearAll` and `handleBulkDelete` in `use-bulk-operations.ts`, which took an undo capture and
  logged NOTHING — stayed silent, INVERTING the asymmetry rather than removing it. Both user handlers now
  log it. Re-derive rather than trusting this count — and note the command must be scoped to WRITERS:
  `git grep -nE 'logActivity[A-Za-z]*(Ref\.current)?\??\.?\(("ai", )?"bulk\.delete"' -- 'src/app/*.ts' 'src/app/*.tsx' | grep -v '\.test\.'` → **3**.
  ★★ A bare `git grep -n '"bulk\.delete"'` does NOT reproduce the claim — it also matches the union
  member, the `activityMessageKey` row, `BULK_TOTAL_KINDS` itself, and every test. That mistake was made
  and caught while writing this very bullet — the same "scope the command to the claim" failure recorded
  two paragraphs up for `use-task-row-handlers.ts` — which is why the wrong command is quoted here rather
  than silently replaced.
  ★★★ NO NUMBER IS QUOTED FOR THE BARE FORM ON PURPOSE, AND THIS IS THE **FOURTH** ROUND OF THIS ERROR.
  Round one said the bare grep "returns 6" — wrong, because 6 is what you get only after
  `| grep -v '\.test\.'`, which the quoted command does not have. Round two replaced it with "returns
  **14**" and quoted **6** for the filtered form; a cold review measured **16** and **7**. So the
  correction of a wrong number was itself a wrong number, twice over, inside a paragraph whose entire
  subject is attaching a command that reproduces its claim. ★★ The filtered count had ALSO moved
  underneath it: `reversedForwardDelta`'s own `kind === "bulk.delete"` comparison is a new non-writer
  hit that this branch added, so any number written here is stale by the end of the commit that writes
  it. Run whichever form you want the figure for; **do not restore a number.** ★★ The user
  handlers count the rows REMOVED, never the ids requested — a stale selection can name ids no longer in
  `tasks`, and the walk subtracts whatever the entry carries. ★ The general rule this cost: **a metric
  corrected for one actor is a SCOPE, not a fix — check the other one in the same pass.**
  ★ `bulkTaskCount`'s `Number.isFinite` guard is
  load-bearing and its failure is SILENT: the walk does `total -= delta`, so one NaN propagates into every
  EARLIER day, and `clampPctFromCounts` maps each non-finite result to 0 — the chart then reads a
  plausible 0% across that whole earlier span rather than looking broken. ★ "Everywhere" is what an
  earlier wording said and it overshoots: `endState[i]` is assigned BEFORE the subtraction, so days at
  or after the bad entry keep their correct values. The preceding clause already says "every EARLIER
  day" — the two halves of one sentence disagreed.
  ★ **`mergeActivityLogs` NARROWS the loss window, it does not close it.** An entry appended on device A
  between B's load and B's save is still lost; closing it needs append-level writes the meta-blob shape
  cannot express. Do not record as solved.
