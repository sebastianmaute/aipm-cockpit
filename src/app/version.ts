// Application version metadata: version, build date, milestone codename,
// repo/license links, and the Version-popover highlight keys.
// Per-version history lives in CHANGELOG.md (repo root) — the authoritative
// changelog. APP_BUILD_DATE is the date of the last build.
export const APP_VERSION = "0.303.0";
export const APP_BUILD_DATE = "2026-09-11"; // 0.303.0: AI PM Cockpit now ships as a per-user Windows desktop app that needs no admin rights, no Node.js and no terminal — it runs the app's own server on 127.0.0.1:17300 only, never on the machine's network address, keeps that port fixed because the saved data belongs to it, and says so in a dialog rather than a blank window when it cannot start; it names itself "AI PM Cockpit" with its own icon, author and branded installer instead of Electron's; a v-tag now drives the release, checking the tag against the app version, building the installer as a kept artifact and creating a GitLab Release that links to it, though no tag pipeline has run yet; and the README became an entry point, with its detail moved into docs of their own (Christie)
// 0.302.0: the toolchain moves to ESLint 10 with the package that blocked it — eslint-plugin-react 7.37.5, which still calls an API ESLint 10 removed — left entirely unpatched, unforked and unvendored; pinning settings.react.version from react/package.json keeps the config off the only path that reached the removed call, so all 17 react rules still load and the resolved rule set stays byte-identical to ESLint 9, at the price of one silent degradation (a component declared by JSDoc tag alone stops being detected) that a new guard test is the sole detector for (Blaylock)
// 0.300.0: a developer harness that measures whether the assistant still reads each part of its prompt, so the next round of cost work can be checked instead of assumed — it plants a unique nonsense token in one prompt block and a decoy in another, asks the model to return the target, and runs five arms including a negative control and two drift references, so a score move can be blamed on the change rather than on the model shifting underneath it; it refuses to report success on a run that measured nothing, and refuses to spend when it detects CI. Help and the in-app feature guide no longer describe the token-counting multiplier that 0.298.0 retired, and the README's feature table moved to docs/features.md (Mohanraj)
// 0.299.0: nineteen dialogs now carry a help icon in their header that opens the matching Help entry in a popover over the dialog, instead of sending you to the Help view behind it — the popover floats free of the dialog so a long explanation is no longer cut off at the dialog's edge, it scrolls when it needs to, and Tab stays inside the dialog while it is open; the AI settings dialog now offers the AI entry rather than nothing, and two dialogs whose only candidate entry described a different surface were left with no icon rather than a misleading one (Yefremov)
// 0.298.0: the AI usage caps now measure what a request costs instead of counting every token the same — a cached read bills at a tenth of an input token and an output token at five times one — so the cap warning that used to fire in the first two messages of every session now fires when it means something; Settings shows output separately and explains the change, the counting-multiplier setting is retired, and the assistant's task list no longer carries note logs the guide told it never to use, cutting a quarter off what that request ships (Malzberg)
// 0.297.0: the assistant can no longer put fields it was never offered into a new project's starter content — eighteen were reachable across risks, changes, milestones and stakeholders — a seeded risk's owner links to the team directory again by name or email, and a change's decision date is no longer something the assistant can set at all (Gentle)
// 0.296.0: the AI assistant's always-on operating guides are split into their own cached prompt block, so moving between views mid-conversation no longer re-sends ~13,300 tokens of identical prompt text — measured at roughly half the cost over a conversation that switches view (McHugh)
// 0.295.0: the AI assistant's chat transcript is now sent as a stable cacheable prefix instead of being rebuilt every turn, the usage meter counts every token class Anthropic bills — including cached reads and writes — instead of only input and output, Settings shows the session's cache breakdown and hit rate, and a one-time toast explains why a usage-cap warning may now arrive earlier with no setting changed (Borges)
// 0.294.0: the assistant can no longer write fields it was never given — eight undisclosed writes closed, and every create tool now runs through the same guard its edit path already used (Jimenez)
// 0.293.1: the activity log no longer says "AI planned 1 allocation cells" — the two AI planning entries pick the singular wording at a count of one, in both languages (Vandermeer)
// 0.293.0: the AI assistant can now read and write resource absences and calendar meetings, every staged write is described on the review card before it lands, and any write that would email attendees is forced through that card however small the turn (Vandermeer)
// 0.292.0: an overdue-trend insight is no longer crowded out of the list by a run of time-booking guardrail findings, booked hours that carry no usable date are named separately and given the one remedy that works, switching a bucket between planning modes stops warning about hours that are not there, and the per-device booking cache is now bounded by what it actually stores (Yoshimoto)
// 0.291.1: a Reports arrangement saved in a form the app can no longer read now falls back to the standard set of blocks, instead of being replaced by a layout carried over from older settings (Hoban)
// 0.291.0: a task or reminder that says "1 change" now says it in both languages and in every place it is counted, an overdue steering reminder no longer reads as if it were due tomorrow, a bulk edit of one row stops calling it "1 tasks", and a link to a task that has been deleted says so instead of showing a bare number (Hoban)
// 0.290.0: the Reports view can be rearranged the way the Dashboard already could — drag a block into a new order, resize it, put one away on a shelf and bring it back, with the whole arrangement remembered per project; "Move to Turso" now refuses unless a connection test has actually reached the database, from every button that offers it; and a drag handle no longer offers arrow keys on a surface that never listened for them (Holdstock)
// 0.289.0: the assistant's inline edit preview now matches what it will actually store — a field the assistant refuses is named instead of the edit reporting "no changes", a newly created item's links are shown and labelled with the row they belong to, an email list previews exactly as it will be saved, and cost and schedule figures you saved yourself are no longer quietly rounded or capped when the project loads (Mirrlees)
// 0.288.0: Turso can be set up from Settings again when a deployment variable holds an unusable URL, a "Test connection" button proves the database answers before you commit to it, each of the three Test-connection buttons now says which service it tests and announces its result to a screen reader, a failed connection is described in your own language instead of an internal message, and a task's changes badge reads "1 change" rather than "1 changes" (Duchamp)
// 0.287.0: controls that cannot act now say so instead of vanishing — the Turso buttons stay visible but disabled with a hint you can reach by pointer and by screen reader, the RAID badge shows a count with the breakdown in its tooltip, an asset's name opens its preview, an open document's body collapses when you click its name again, and the Knowledge "Attach to" field becomes a searchable picker that no longer hides most of your project (Tiptree)
// 0.286.0: the assistant’s change preview now shows every field it can actually write — including the relationship lists whose edits replace rather than merge — names each field readably, says which changes it will refuse, and no longer clears a stored value a refused edit was never meant to touch (Sladek)
// 0.285.0: the edit-task dialog is reorganised — Status & Notes moves up, predecessors and successors share a row, group and labels share a row, the budget bucket joins Effort & Classification, and Time spent becomes a Jira-style Time tracking dialog opened from the progress bar, with a remaining-work override that is stored only when you pin it (Barnhill)
// 0.284.0: a row a staged plan could not write now says which of the three things went wrong instead of a single flat refusal, one unreadable row no longer takes the rest of the plan down with it, and an inline AI edit’s preview of a numeric field shows the number that would actually be stored (Kornbluth)
// 0.283.0: when the assistant is about to delete something, or to change more than one row at once, it now shows you the plan first — every row with what it would change — and writes nothing until you approve it; the rows you keep are applied as ONE step you can undo in one press (Lessing)
// 0.282.0: TimeLog bookings are now reviewed against four optional guardrails — a per-entry cap, a daily cap, work booked on holidays or weekends, and hours beyond a person's contracted day — each surfaced as an insight rather than blocking anything (Zamyatin)
// 0.281.0: the assistant can now read Outlook mail you attach — .msg, .eml and saved .mhtml — pulling the real text out of the message and out of the files attached to it, instead of naming them and stopping (Womack)
/** Minor-series milestone codename (an author's surname). The
 *  0.299.x line is "Yefremov" (Ivan Yefremov, Soviet author of "Andromeda
 *  Nebula", 1957). A PATCH release keeps its minor line's
 *  name, as 0.293.1 kept "Vandermeer" like 0.293.0, exactly as 0.291.1 kept
 *  "Hoban". Only a MINOR bump needs the sweep below.
 *  SELECTION: take the FIRST name in `docs/release-codenames.md`'s
 *  "Candidate Names Not Yet Used" list and, in the same release commit, move
 *  it to the FRONT of that file's "Already Used" list (newest first). That
 *  list does not name every shipped codename, so CHANGELOG.md stays the
 *  record: still run the sweep below on the pick, and if it collides, drop it
 *  from the candidates and take the next.
 *  ★★ Updated at the 0.294.0 bump. This sentence is the trap the paragraph
 *  below describes, and it has now been left stale THREE times; it is ungated,
 *  so nothing but a reader will ever catch it. "Jimenez" (Simon Jimenez,
 *  American author of "The Vanished Birds", 2020) was swept against the FULL
 *  history before use: 285 distinct codenames across 388 named version headers,
 *  matched with `"[^"]+"` at ANY position — an end-of-line anchor cannot see
 *  the headers that put the codename before the date, and an `[A-Za-z]+` class
 *  silently drops "Le Guin", "Nevala-Lee" and "García". Positive controls
 *  Vandermeer, Chiang, Banks and Le Guin all read TAKEN in the same run.
 *  ★★ This lead sentence still opened "The 0.291.x line is Hoban" through
 *  0.292.0 and 0.293.0 — two minor bumps that moved the constant and left the
 *  prose, which is the ungated-lead-sentence trap this docstring warns about
 *  further down, recurring twice after being written up. Corrected again at
 *  the 0.295.0 bump (2026-09-08) — update this sentence IN THE SAME COMMIT as
 *  the constant, every time.
 *  ★★★ 0.296.0 REPEATED THE "Chiang" MISTAKE BELOW, ONE RELEASE LATER, FROM
 *  THE SAME CAUSE — and the paragraph warning against it was already sitting
 *  here when it happened. It was bumped as "Kowal", which passed the
 *  per-minor-line LEGALITY check (0.296.x was empty) while having one prior
 *  use at 0.37.0, so it failed the zero-anywhere DESIRABILITY bar. The author
 *  had told himself in-session that reuse in an unrelated minor line was
 *  fine — verbatim the pre-authorisation the "Chiang" note calls WRONG. Caught
 *  by re-reading this docstring while fixing something else, not by any gate;
 *  nothing checks this, and that is the point. Renamed to "McHugh" before
 *  anything was pushed.
 *  0.296.x sweep for "McHugh", run BEFORE the rename by BOTH commands this
 *  docstring prescribes: `grep -ic mchugh CHANGELOG.md` returned 0 (a true
 *  zero-anywhere absence, the stronger DESIRABILITY bar) and the dash-agnostic
 *  header pattern returned nothing. Controls fired in the SAME run: positives
 *  `borges` 1, `chiang` 1, `moorcock` 1 and `kowal` 2 (its 0.37.0 header plus
 *  the 0.296.0 one being renamed — the collision this sweep existed to find),
 *  and negative `zzznotaname` 0. The header pattern also demonstrably matched
 *  BOTH dash shapes, `0.296.0` with a hyphen and `0.37.0` with an EM DASH.
 *  ★★ "Gentle" was clear in the same run and was SPENT on 0.297.0 — this line
 *  said "remains unspent" until that bump, which is the shape to watch for: a
 *  note recording a name as available is falsified by the next release that
 *  takes it, and nothing gates it. "McHugh" is a single ASCII word, so it is
 *  not exposed to the `[^"]+` vs `[A-Za-z]+` character-class trap below.
 *  ★★★ 0.297.0's OWN SWEEP FOUND A BROKEN CONTROL IN THE PRESCRIBED RECIPE, and
 *  the bug is in the pattern, never in the name. Use ALTERNATION for a
 *  dash-agnostic header regex — `(-|–|—)` — never a BRACKET CLASS.
 *  ★★ WHY, in the smallest statement that survives testing. Under a BYTE
 *  locale a multibyte character inside a `grep -E` bracket expression is
 *  byte-decomposed, so `[-–—]` is not three characters but the byte set
 *  {2D, E2, 80, 93, 94}. BARE, it then matches every U+20xx punctuation mark
 *  through the shared `E2` lead byte — `…` and `•` included, neither of them a
 *  dash. ANCHORED, where the class must consume a whole position, it matches
 *  ONE byte of a three-byte dash and the surrounding match fails. A UTF-8
 *  locale masks both. Alternation is correct in all four cells.
 *  ★★★ AN EARLIER REVISION OF THIS NOTE SAID ONLY "does not match the EM DASH",
 *  which is true of the ANCHORED form alone — a reader running the BARE form
 *  sees it match and concludes the warning is stale, which is the exact failure
 *  the note exists to prevent. It took a peer challenging it and four measured
 *  cells to get a wording that holds; the peer's own replacement ("depending on
 *  environment") was wrong the other way, since both cells are reachable on ONE
 *  machine and the axis is the pattern's SHAPE. Measured on GNU grep 3.0 with
 *  LC_ALL/LANG/LC_CTYPE unset:
 *    anchored `[-–—]` vs the 0.37.0 header  -> 0   (under-match)
 *    bare     `[-–—]` vs a file of … and •  -> 2   (false positives)
 *    both, under LC_ALL=C.UTF-8             -> 1 and 0   (correct)
 *    `(-|–|—)` in every combination         -> correct
 *  ★★★ THE TWO DIRECTIONS ARE NOT EQUALLY DANGEROUS. The over-match is LOUD.
 *  The anchored under-match returns 0, which is EXACTLY what a clean sweep
 *  returns, so it cannot be told from the answer you were hoping for. Treat any
 *  past clean sweep run with the bracket form as UNVERIFIED — "Gentle" included.
 *  The zero-anywhere `grep -ic <name> CHANGELOG.md` bar is byte-safe and is why
 *  0.297.0's sweep still stands: a plain ASCII substring, no class, no
 *  multibyte, so it cannot enter any of these cells.
 *  ★★ A control that silently fails to fire makes every 0 beside it worthless,
 *  which is the whole point of running controls in the same invocation.
 *  ★★★ 0.295.0 SHIPPED ONCE ALREADY AS "Chiang" AND WAS RENAMED WITHIN THE
 *  SAME DAY, and the rename is the useful part of this record — not the name.
 *  "Chiang" passed the LEGALITY check below (uniqueness is per-minor-line, and
 *  its one prior use at 0.120.0 is an unrelated line, so it was not a
 *  collision) but was rejected anyway on DESIRABILITY: this docstring's own
 *  ★★ note a few paragraphs down says the repo *prefers* a name unused
 *  anywhere in the history and has rejected a legal reuse ("Banks") on that
 *  ground alone. A brief that pre-authorised "don't worry about reuse in
 *  unrelated minor lines" was WRONG to do so — legality is not the same
 *  question as desirability, and only the second one is what this repo
 *  actually enforces by convention. Passing the per-minor-line uniqueness
 *  grep is necessary, not sufficient: also grep for an EXACT, case-sensitive,
 *  zero-hit absence before treating a candidate as clear.
 *  0.295.x sweep for "Borges", checked BEFORE the (re-)bump, by BOTH commands
 *  this docstring prescribes: `grep -ic borges CHANGELOG.md` returned 0 — a
 *  true zero-anywhere absence, which is the stronger DESIRABILITY bar, not
 *  merely the per-minor-line LEGALITY one. Positive controls fired in the
 *  same run (`"Chiang"` 2 — the 0.120.0 header plus this line's own now-
 *  renamed 0.295.0 header — and `"Moorcock"` 1) and the negative control
 *  `zzznotaname` returned 0, so the zero above is real and not a broken
 *  pattern. The dash-agnostic header pattern for `borges` also returned no
 *  match. "Borges" is a single ASCII word, so it is not at risk of the
 *  `[^"]+` vs `[A-Za-z]+` character-class trap this docstring warns about
 *  further down (a name with a space, hyphen or non-ASCII character can
 *  silently fail the class-restricted variant of this check).
 *  0.293.x line was "Vandermeer" (Jeff VanderMeer, American author of the
 *  "Southern Reach" trilogy, 2014).
 *  0.291.x line was "Hoban" (Russell Hoban, American-British author of
 *  "Riddley Walker", 1980, written in an invented post-collapse English).
 *  Checked BEFORE the bump, by BOTH commands this docstring prescribes, in a
 *  run whose controls fired: `grep -ic hoban CHANGELOG.md` returns 0 and the
 *  dash-agnostic header pattern returns nothing, against POSITIVE controls
 *  `delany` 1, `russ` 3, `butler` 1, `emshwiller` 1, `lessing` 1 and
 *  `holdstock` 1 — the last being the line immediately below, so the pattern
 *  demonstrably sees the newest header shape — and a NEGATIVE control
 *  `zzznotaname` returning 0, so a zero here is a real absence.
 *  ★★ `mchugh` and `gentle` were also clear in THIS run and are NOT spent.
 *  Read that under the standing warning two paragraphs down: a prior bump's
 *  spare list goes stale silently, and two of 0.284.x's three were spent
 *  within two releases. Re-sweep every time.
 *  0.290.x line was "Holdstock" (Robert Holdstock, British fantasy author of
 *  "Mythago Wood", 1984, World Fantasy Award).
 *  Checked BEFORE the bump, by BOTH commands this docstring prescribes.
 *  (1) The whole-file case-insensitive sweep: `grep -ic holdstock CHANGELOG.md`
 *  returns 0, in a run whose positive controls all fired — `lessing` 1,
 *  `banks` 1 (the header shape an END-OF-LINE anchor cannot see), `emshwiller`
 *  1, `duchamp` 1 and `mirrlees` 1 — and whose NEGATIVE control `zzznotaname`
 *  returned 0, so a zero is a real absence rather than a broken pattern.
 *  (2) The dash-agnostic header pattern below: no hit for `holdstock`, against
 *  a pattern proved non-vacuous in the same run — its positive control
 *  `duchamp` returned the 0.288.0 line, and its named-header count was read
 *  from that run rather than quoted here, since every release moves it.
 *  ★★ THE POOL IS VISIBLY EXHAUSTED AT THIS DEPTH, and this bump's sweep is the
 *  sharpest evidence yet: of a 15-candidate batch, ELEVEN were already taken —
 *  `priest`, `brunner`, `disch`, `shepard`, `nagata`, `wecker`, `griffith`,
 *  `fowler`, `valente`, `hopkinson` and `mandel`. Sweep a BATCH, not a
 *  favourite. ★ Names clear in THIS run and not spent: `mchugh`, `gentle`,
 *  `hoban`.
 *  ★★★ AND DO NOT TRUST A PRIOR BUMP'S "cleared but not needed" LIST — it goes
 *  stale silently. The 0.284.x note below banked `barnhill`, `sladek` and
 *  `malzberg` as spare; TWO of the three were spent within two releases
 *  (0.285.x and 0.286.x) while the note went on offering them. The line above
 *  is offered under exactly the same warning — re-sweep every time; a name is
 *  only free in the run you are looking at. ★★ `emshwiller` is the trap this
 *  bump nearly fell into: it reads as an obvious unused candidate and is in
 *  fact TAKEN, which is why it serves as a positive control here.
 *  ★★★ CHANGELOG.md IS THE LEDGER OF PAST CODENAMES; THIS DOCSTRING IS NOT.
 *  Every codename ever shipped is in a CHANGELOG version header, so the 53
 *  hand-maintained "0.NNN.x was <name> (biography)" lines that used to sit here
 *  are gone. Nothing read them — `version:check` reads only the
 *  `APP_MILESTONE` declaration, never this prose — and they rotted repeatedly:
 *  a whole line's entry went missing, a note pointed at a spare-name list that
 *  no longer existed in the entry it named, and one bump added five biographies
 *  from memory alone. Per AGENTS.md's doc-set rule the second copy links rather
 *  than restates, so what follows is only what CHANGELOG.md cannot hold.
 *  ★★★ UNIQUENESS IS PER MINOR LINE, NOT ACROSS HISTORY, so a bare
 *  `grep -rn "<name>" CHANGELOG.md` misleads in BOTH directions. A HIT is not
 *  proof a name is taken: reuse across minor lines is permitted and is common.
 *  Enumerate today's reuses — it dedups WITHIN a minor line, so 0.278.0 and
 *  0.278.1 sharing a name is correctly not reported:
 *  grep -oE '^## \[0\.[0-9]+\.[0-9]+\][^"]*"[^"]+"' CHANGELOG.md \
 *    | sed -E 's/^## \[(0\.[0-9]+)\.[0-9]+\][^"]*"([^"]+)"$/\2|\1/' \
 *    | sort -u | cut -d'|' -f1 | uniq -d
 *  ★★ Run it rather than trusting any list, this sentence included: measured
 *  2026-09-07 it returned names the deleted ledger never flagged as reuses at
 *  all — "Tiptree", the 0.287.x codename, among them. A ZERO is no proof
 *  either; see the two anchor axes below.
 *  ★★ Legality and desirability are different questions. The rule permits a
 *  reuse, but this repo prefers a name unused anywhere in the history and has
 *  rejected a legal one ("Banks") on that ground alone.
 *  ★★★ ONE PERSON ALREADY HOLDS TWO CODENAMES, AND NO GREP CAN FIND THAT.
 *  0.287.x is "Tiptree" and 0.236.x is "Sheldon" — James Tiptree Jr. was the
 *  pen name of Alice Sheldon. That is a relationship between two entries rather
 *  than a property of either, which is why CHANGELOG.md cannot express it and
 *  why it survived the cut. ★ 0.236.x deliberately records no biography: for a
 *  slice whose name nobody wrote down, assert nothing rather than guess one.
 *  ★★★ CHECK A CANDIDATE BEFORE THE BUMP, AND DASH-AGNOSTICALLY. Run it after
 *  and the pattern matches the header you just wrote, which reads as a
 *  collision with yourself. Both commands, not one:
 *  `grep -ic <name> CHANGELOG.md`
 *  `grep -oE '^## \[0\.[0-9]+\.[0-9]+\][^"]*"[^"]+"' CHANGELOG.md | grep -i <name>`
 *  ★★★ AN ANCHORED GREP MISSES HEADERS ON TWO SEPARATE AXES, and each has
 *  already reported a taken name as free. (1) THE DASH — older headers use an
 *  em dash and newer ones a hyphen, so a `] - ` anchor is blind to a large
 *  minority of them; that is how two consecutive lines shipped asserting a
 *  freshness that was false. (2) THE ORDER — some headers put the codename
 *  BEFORE the date (`## [0.7.2] "Banks" — 2026-05-19`), so an END-OF-LINE
 *  anchor cannot see them; that is how "Banks" reached this constant, the
 *  CHANGELOG heading and all six satellites before it was caught. Measure both
 *  populations rather than trusting a figure written here:
 *  `grep -coE '^## \[0\.[0-9]+\.[0-9]+\]' CHANGELOG.md` (all version headers)
 *  `grep -coE '^## \[0\.[0-9]+\.[0-9]+\] *"' CHANGELOG.md` (codename first)
 *  ★★★ THE NAME CLASS IS `[^"]+`, NOT `[A-Za-z]+`, and the first cut of that
 *  correction shipped `[A-Za-z]+` — one character class from the defect it was
 *  written to end. It silently drops every codename that is not a single ASCII
 *  word: "Le Guin" (space), "Nevala-Lee" (hyphen), "García" (non-ASCII). A
 *  candidate of any of those shapes returns zero hits and reads as free. Prove
 *  a replacement pattern by showing it sees ALL named headers, never by showing
 *  it finds the one name you happened to check:
 *  `grep -coE '^## \[0\.[0-9]+\.[0-9]+\][^"]*"[^"]+"' CHANGELOG.md`
 *  ★★ AND PROVE THE ZERO. A candidate cleared by a run whose positive controls
 *  never fired is not cleared at all. 0.289.x was swept with three known-taken
 *  positives and a "zzznotaname" negative control before it was written here.
 *  ★★ THE POOL IS VISIBLY EXHAUSTED AT THIS DEPTH. A 10-candidate batch swept
 *  for 0.289.0 cleared only three; names as established as Cherryh, Willis,
 *  Vinge, Peake and Kiernan were all already taken. Sweep a BATCH, not a
 *  favourite. ★★★ AND DO NOT TRUST A PRIOR BUMP'S "cleared but not needed"
 *  LIST — it goes stale silently: one banked three spare names and TWO were
 *  spent within two releases while the note went on offering them. Re-sweep
 *  every time; a name is only free in the run you are looking at.
 *  ★★ THE LEAD SENTENCE ABOVE IS UNGATED PROSE. `version:check` compares the
 *  satellites against `APP_MILESTONE` and never against the prose beside it,
 *  and 0.278.0 shipped with the constant already "Gilman" while this docstring
 *  still opened "The 0.277.x line is Ozeki" — the file that IS the source of
 *  truth for the codename described the previous line as current. Bumping the
 *  constants is not the whole edit; update that sentence in the same commit.
 *  ★★ 0.224.0 IS A PERMANENTLY DEAD NUMBER — do not reuse it. The 0.226.0 line
 *  was built and numbered 0.224.0 while unpushed; main could not wait for it,
 *  deliberately skipped 0.224.0 and shipped 0.225.0 "Walton" first, so keeping
 *  0.224.0 would have meant a release commit naming a version no build ever
 *  reported. The gap is the record of why.
 *  ★ Fetch before bumping. 0.221.0 "Kavan" shipped on main while the 0.222.0
 *  branch was in review, forcing a renumber at merge time — and it happened
 *  again when a branch's own 0.237.0 bump collided with 0.236.0 and 0.237.0
 *  both landing on main first, forcing a renumber to 0.238.0. No gate checks
 *  either the number or the name; the only defence is reading CHANGELOG.md
 *  first. */
// ★★★ A NINTH VERSION SITE, AND THE ONLY ONE USERS SEE. 0.248.0 shipped with
// APP_VERSION "0.248.0" beside APP_MILESTONE "Butcher" — the 0.247.x name — so
// `APP_VERSION_LABEL` rendered `0.248.0 "Butcher"` in Settings, the top bar and the
// Version popover, while CHANGELOG.md, the README badge and the docstring above all
// said "Bujold". Nothing compares them, and no gate reads either constant.
// ★★ THE CHECKLIST IS NOT AT FAULT — AGENTS.md's "Releasing:" bullet names the
// milestone in its first clause, beside APP_VERSION and APP_BUILD_DATE. An earlier
// version of this comment blamed the checklist for not counting it, which sends the
// next maintainer to add an item that is already there. What failed was execution.
// Bump BOTH together.
export const APP_MILESTONE = "Christie";
/** Version with its milestone codename for UI display, e.g. `0.39.0 "Gibson"`. */
export const APP_VERSION_LABEL = `${APP_VERSION} "${APP_MILESTONE}"`;
export const APP_REPO_URL = "https://www.example.com";

/** Open-source license (SPDX id) and its canonical reference URL, shown in the
 *  Settings footer and the Help panel. Mirrors package.json `license`. */
export const APP_LICENSE = "EUPL-1.2";
export const APP_LICENSE_URL =
  "https://interoperable-europe.ec.europa.eu/collection/eupl/eupl-text-eupl-12";

/** Translation keys for the high-level feature highlights shown in the
 *  Version popover. Update both EN and DE in i18n.ts when you add to this. */
export const APP_HIGHLIGHT_KEYS = [
  "versionHighlightChat",
  "versionHighlightVoice",
  "versionHighlightStorage",
  "versionHighlightJira",
  "versionHighlightReports",
  "versionHighlightGantt",
  "versionHighlightRaid",
  "versionHighlightResources",
  "versionHighlightActivity",
  "versionHighlightContacts",
  "versionHighlightExport",
  "versionHighlightNotifications",
  "versionHighlightWorkspace",
  "versionHighlightSecurity",
  "versionHighlightPerformance",
  "versionHighlightBudget",
  "versionHighlightPolish",
  "versionHighlightBudgetEdit",
  "versionHighlightTheme",
  "versionHighlightPalette",
  "versionHighlightTableResize",
  "versionHighlightRaidReport",
  "versionHighlightReportsSortFilter",
  "versionHighlightPrintReports",
  "versionHighlightM365Auth",
  "versionHighlightSharepointStorage",
  "versionHighlightOutlookContacts",
  "versionHighlightOutlookCalendar",
  "versionHighlightTursoStorage",
  "versionHighlightTursoRelational",
  "versionHighlightStorageConvert",
  "versionHighlightStorageUnreachable",
  "versionHighlightModernLayout",
  "versionHighlightFullPageEdit",
  "versionHighlightTableRestyle",
  "versionHighlightSidebarPolish",
  "versionHighlightPaneResize",
  "versionHighlightConsistency",
  "versionHighlightBudgetModes",
  "versionHighlightBudgetReport",
  "versionHighlightComposableReports",
  "versionHighlightDashboard",
  "versionHighlightMilestones",
  "versionHighlightEarnedValue",
  "versionHighlightEvmRag",
  "versionHighlightBudgetRag",
  "versionHighlightUiRefinements",
  "versionHighlightTrends",
  "versionHighlightChangeLog",
  "versionHighlightRaidReview",
  "versionHighlightStakeholders",
  "versionHighlightStakeholderReport",
  "versionHighlightModes",
  "versionHighlightClarke",
  "versionHighlightFieldFeedback",
  "versionHighlightButler",
  "versionHighlightVinge",
  "versionHighlightTursoMultiProject",
  "versionHighlightSpDocLinks",
  "versionHighlightFieldVisibility",
  "versionHighlightTemplates",
  "versionHighlightPerProjectFunctions",
  "versionHighlightTemplateSuggest",
  "versionHighlightRecovery",
  "versionHighlightUiPolishBatch",
  "versionHighlightActionCenter",
  "versionHighlightSnoozeActions",
  "versionHighlightActionChips",
  "versionHighlightScheduleWorkload",
  "versionHighlightUiBatch",
  "versionHighlightDocuments",
  "versionHighlightLoadFormats",
  "versionHighlightConfidenceRanking",
  "versionHighlightCreateTask",
  "versionHighlightUiBatch85",
  "versionHighlightAssignOwner",
  "versionHighlightDraftMessage",
  "versionHighlightCommTemplates",
  "versionHighlightCommTemplatesRich",
  "versionHighlightCommTemplatesVersions",
  "versionHighlightCommTemplatesSend",
  "versionHighlightEscalate",
  "versionHighlightRebaseline",
  "versionHighlightDesktopNotify",
  "versionHighlightLearning",
  "versionHighlightCalendarPush",
  "versionHighlightUiBatchVm",
  "versionHighlightAiContextCore",
  "versionHighlightAiAskClaude",
  "versionHighlightUiBatch0990",
  "versionHighlightUiBatch0100",
  "versionHighlightUiBatch0101",
  "versionHighlightAiWriteTools",
  "versionHighlightAiDocIngest",
  "versionHighlightAiCreateWizard",
  "versionHighlightAiActionSuggestions",
  "versionHighlightScheduledJobs",
  "versionHighlightInstallable",
  "versionHighlightTaskStatus",
  "versionHighlightKanban",
  "versionHighlightWeightSuggest",
  "versionHighlightProjectImport",
  "versionHighlightSteering",
  "versionHighlightTour",
  "versionHighlightTimezones",
  "versionHighlightTimezoneDisplay",
  "versionHighlightTimezoneCalendar",
  "versionHighlightAiFeatureGuide",
  "versionHighlightJiraEncryption",
  "versionHighlightLandingCockpit",
  "versionHighlightMilestoneHorizon",
  "versionHighlightCoaching",
  "versionHighlightTrendArrows",
  "versionHighlightBurndownSparkline",
  "versionHighlightDashboardDensity",
  "versionHighlightClickThrough",
  "versionHighlightDeepLinkFlash",
  "versionHighlightGlobalSearch",
  "versionHighlightSavedViews",
  "versionHighlightSavedViewsPanels",
  "versionHighlightSavedViewsReports",
  "versionHighlightUiBatch0134",
  "versionHighlightInteractionStates",
  "versionHighlightBulkEdit",
  "versionHighlightDensityRhythm",
  "versionHighlightResponsiveGrids",
  "versionHighlightTimelog",
  "versionHighlightDualCi",
  "versionHighlightMockupPolish",
  "versionHighlightSetupWizard",
  "versionHighlightPortfolioHealth",
  "versionHighlightTimelogWorkflow",
  "versionHighlightAiMasterSwitch",
  "versionHighlightMasonry",
  "versionHighlightModelPicker",
  "versionHighlightActionGrouping",
  "versionHighlightActionLayout",
  "versionHighlightActionProviders",
  "versionHighlightActionInlineCtas",
  "versionHighlightMultiUpload",
  "versionHighlightHelpLayout",
  "versionHighlightChatFullWidth",
  "versionHighlightViewTips",
  "versionHighlightAnalyzeModal",
  "versionHighlightHelpRedesign",
  "versionHighlightFloatingHelpTabs",
  "versionHighlightDocumentsCards",
  "versionHighlightColumnVisibility",
  "versionHighlightViewChrome",
  "versionHighlightPrintMultipage",
  "versionHighlightColorSchemes",
  "versionHighlightResizeAnchor",
  "versionHighlightNextActionsRedesign",
  "versionHighlightJiraMultiProject",
  "versionHighlightStakeholderDrag",
  "versionHighlightCalendarWriteback",
  "versionHighlightCalendarChange",
  "versionHighlightCalendarAbsence",
  "versionHighlightCalendarPull",
  "versionHighlightCalendarPullTask",
  "versionHighlightCalendarPullRaidChange",
  "versionHighlightCalendarPullAbsence",
  "versionHighlightCalendarAutoPull",
  "versionHighlightInlineAiEdit",
  "versionHighlightInlineAiEditSp2",
  "versionHighlightSearchCoverage",
  "versionHighlightActivityDiff",
  "versionHighlightKeyboardA11y",
  "versionHighlightWorkloadActionable",
  "versionHighlightResourceEnhance",
  "versionHighlightResourceFollowup",
  "versionHighlightTimelogCustomer",
  "versionHighlightGanttBaseline",
  "versionHighlightStatusDigest",
  "versionHighlightUndo",
  "versionHighlightUxBatchAldiss",
  "versionHighlightRedo",
  "versionHighlightIdIntegrity",
  "versionHighlightLiveNames",
  "versionHighlightSteeringReports",
  "versionHighlightColorSchemesDark",
  "versionHighlightSchemeDehardcode",
  "versionHighlightSchemeDatabase",
  "versionHighlightModalResize",
  "versionHighlightFeatureGuidance",
  "versionHighlightUiBatch0187",
  "versionHighlightFieldUndo",
  "versionHighlightOfficeIngest",
  "versionHighlightM365SignInFix",
  "versionHighlightDeepLinkEditor",
  "versionHighlightResourceClearFix",
  "versionHighlightPopoverClip",
  "versionHighlightProcessAttachment",
  "versionHighlightFloatingEditor",
  "versionHighlightOpenPointsActions",
  "versionHighlightRaidInquiry",
  "versionHighlightTaskNoteLog",
  "versionHighlightGanttMilestonePlacement",
  "versionHighlightUndoLabels",
  "versionHighlightToastPause",
  "versionHighlightAiErrorDetail",
  "versionHighlightPullContacts",
  "versionHighlightKnowledgeLinks",
  "versionHighlightTaskDedup",
  "versionHighlightAppRename",
  "versionHighlightThemeDecouple",
  "versionHighlightUiTokenRename",
  "versionHighlightHeroicons",
  "versionHighlightKnowledgeItems",
  "versionHighlightAiSettingsTool",
  "versionHighlightProjectOverrides",
  "versionHighlightProjectViewMode",
  "versionHighlightInsights",
  "versionHighlightInsightsRecommend",
  "versionHighlightInsightsOutcome",
  "versionHighlightInsightsDigest",
  "versionHighlightCostReason",
  "versionHighlightBurndownFollowPlan",
  "versionHighlightChatFormatting",
  "versionHighlightDirectoryHideExternal",
  "versionHighlightRichNotes",
  "versionHighlightTaskDescription",
  "versionHighlightBudgetCpi",
  "versionHighlightTimelogScopeMemory",
  "versionHighlightPolishR1",
  "versionHighlightKanbanSwimlanes",
  "versionHighlightDashboardR3",
  "versionHighlight0201",
  "versionHighlight0202",
  "versionHighlight02023",
  "versionHighlight0203",
  "versionHighlight0207",
  "versionHighlight0208",
  "versionHighlight0209",
  "versionHighlight0210",
  "versionHighlight0211",
  "versionHighlight0212",
  "versionHighlight0213",
  "versionHighlight0214",
  "versionHighlight0215",
  "versionHighlight0216",
  "versionHighlight0217",
  "versionHighlight0218",
  "versionHighlight0219",
  "versionHighlight0220",
  "versionHighlight0222",
  "versionHighlight0223",
  "versionHighlight0225",
  "versionHighlight0226",
  "versionHighlight0227",
  "versionHighlight0228",
  "versionHighlight0229",
  "versionHighlight0230",
  "versionHighlight0231",
  "versionHighlight0232",
  "versionHighlight0233",
  "versionHighlight0234",
  "versionHighlight0235",
  "versionHighlight0237",
  "versionHighlightTaskListAlign",
  "versionHighlightActivityWorkspace",
  "versionHighlightDashboardArrange",
  "versionHighlightHistorySearch",
  "versionHighlightCsvQuoting",
  "versionHighlightRichExport",
  "versionHighlightActorAttribution",
  "versionHighlightChangeNotesTimelog",
  "versionHighlightBlockEditing",
  "versionHighlightLazyEditor",
  "versionHighlightDictationPosition",
  "versionHighlightBlockStructure",
  "versionHighlightDocumentImages",
  "versionHighlightIconSet",
  "versionHighlightDocumentImageExport",
  "versionHighlightAiCalendarWrites",
] as const;
