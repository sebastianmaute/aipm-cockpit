// Application version metadata: version, build date, milestone codename,
// repo/license links, and the Version-popover highlight keys.
// Per-version history lives in CHANGELOG.md (repo root) — the authoritative
// changelog. APP_BUILD_DATE is the date of the last build.
export const APP_VERSION = "1.12.0";
export const APP_BUILD_DATE = "2026-09-19"; // 1.12.0: the Dashboard's landing screen is reworked around what changed, what to do next and how the project is doing — row 1 now holds the delta strip, the digest card and the Print/Reset controls, with a hidden-tiles count badge replacing the always-visible shelf; row 2 carries the Next-actions hero beside Overall status; then the narrative, coaching and tip cards, then the arrangeable tile grid. The Budget burn tile is chart-only and now leads the grid at 2 wide by 8 tall; the KPI tile sits beside it on wide screens at 2 wide by 3 tall, carrying Effort SPI and Effort CPI whenever each can be computed, with columns that follow the visible cell count; a saved layout is upgraded once to match. The Next-actions hero's Open button no longer renders where it would do nothing, and a budget-history property test that flaked once in CI is fixed at its root cause. §580–§585 filed and closed in this release (Child)
// 1.11.0: a new project can be created from a workspace JSON file — given to the create wizard's first step, or picked with "Import workspace file…" on its details step, which works without an AI key — with the file's content becoming the project and the wizard's details replacing the file's own; the AI Assistant accepts .json files and files dropped onto it, and takes at most 10 attachments and 30 MB per message, naming each file it leaves out; and "Explore a demo project" now opens a project in mid-flight, its dates moved by whole plan periods so today falls where the demo was written, with current budget, activity, insight, knowledge and TimeLog content, while a demo file that cannot be read now shows an error instead of creating an empty project. Four follow-ups are filed and open: "Load project from file" throwing in Firefox/Safari (§574), chat history re-sending earlier turns' attachments (§575), an FX snapshot that is not byte-stable through JSON (§576) and the budget variance insight comparing full-window budget against to-date actuals (§577) (Grisham)
// 1.10.1: the 2026-09 security audit follow-ups — a hostile docx, xlsx or pptx file with repetitive unclosed markup no longer stalls document ingest; the Jira and TimeLog proxies now refuse to follow an upstream redirect instead of hopping it to a host the allowlist never validated; the packaged desktop app's server now launches via utilityProcess.fork with the RunAsNode and Node-inspect fuses off; and an imported RAID item with an oversized name no longer costs seconds to load. Two follow-ups from the same audit are filed and still open: quadratic regexes outside the OOXML extractors (§578) and an xlsx whose rows each reach column XFD (§579) (Leonard)
// 1.10.0: the Budget forecast now shows one card at a time — a switch above it picks "At current pace" or "At current efficiency", remembered per device, and hidden when printing so the printout shows the chosen card — with a red/amber/green badge from that card's own variance at completion; on the Budget report, Forecast and Burn-down are now one Forecast section, with the card beside the chart on wide screens and stacked below 1280px, and the recorded-change table full width below both; and the gap line now names both readings it is comparing (Leonard)
// 1.9.0: the budget report and dashboard burn-down and cumulative charts now let you hover, tap or use a pen over a plotted point — or reach one with the keyboard, using arrow keys, Home, End and Escape on the chart's own tab stop — to see a readout box naming that stop's date, each series' value there and a one-line explanation of what it means, with the same content spoken to a screen reader through a live region; the box stays clamped inside both the chart and the browser window, a stop with nothing to report is skipped instead of shown empty, and the app's info-hint bubble now shares its box styling with the chart readout instead of drawing its own (James)
// 1.8.0: the budget chart now shows where the budget moved — every saved budget edit that changes the project's budget at completion is recorded with its date, bucket and amount, starting from the budget as it stood before the first one; in the cumulative view the budget line steps at each change with a marker naming the bucket, the change table lists every recorded change with the added scope to date, and each forecast card splits its variance at completion into performance, added scope and any unexplained budget change; on Turso, snapshots now keep each bucket's percent complete, so the earned-value line also covers buckets whose percent complete is typed in by hand, and any stretch the line cannot fully cover is dashed and labelled; the dashboard budget tile keeps the chart alone, and the change table sits below the chart until the screen is wide enough for both side by side (Rendell)
// 1.7.1: closing a budget bucket that passes its remaining budget to a successor no longer makes the project look better off — that leftover budget was being counted twice, which raised the project's budget at completion and, through it, flattered every forecast figure: variance at completion, the date the budget runs out, the burn-down's budget line, and the percentage of budget consumed. Earned value moved onto the same footing, so a project could no longer report having earned more than its whole budget, being more than 100% complete, or costing less to finish than it had already spent. Any project with a closed bucket feeding a successor will see its forecast figures move — the new numbers are the honest ones (Sayers)
// 1.7.0: the Budget Report and the dashboard burn tile now share ONE burn-down chart, with Burn-down/Cumulative and €/Hours switches that each device remembers, drawing both forecast lines and — in the cumulative view — the earned value actually delivered to date; each forecast card gains an "In hours" line carrying its own estimate at completion, variance and run-out, so an overrun in effort is visible even where the money still looks fine; and when cheaper roles burn more hours than planned the report says so in one voice — a banner, a "Where the hours went" role table, a booked rate per hour beside the other figures, and a chip on both cards and on the dashboard tile — with every rate figure covering hourly buckets only and naming the fixed-price hours it leaves out (Sayers)
// 1.6.1: the desktop app now runs on Electron 44 (Chromium 152, Node 24); Help → Version opens the app's own Version panel with the same content as in the app, in the app's language, plus a desktop section naming the log file and how to get updates, instead of a separate native dialog; links to other websites open in the system browser while pop-outs, PDF export and Microsoft sign-in stay in the app; and the CI desktop-package job pins its build image — the desktop sign-in popup's state handling has no unit tests, filed as follow-up 547, and an edit made while a project's first load is still pending is overwritten when that load lands, filed as follow-up 548 (Ishiguro)
// 1.6.0: the Budget Report gains a Forecast section — a facts row of budget, actuals, remaining budget and earned value, and two forecast cards, at current pace and at current efficiency, each with its estimate at completion, variance at completion and estimate to complete, the pace card adding the burn rate and the day the budget runs out, and a line saying how far the two forecasts differ — with banners saying when a forecast cannot be calculated yet and a tooltip on every term; the dashboard Budget burn tile shows the forecast headline, its spend box reads "Spent", and the Budget rating follows the current-pace variance at completion once that forecast exists, still combined with the effort cost index, so a Trends snapshot captured from this release on can change colour without the budget changing; the Budget view shows a forecast line linking to the Budget Report; the task-effort indices read "Effort CPI" and "Effort SPI" everywhere and the "Cost recovery" tile is now "Internal cost index"; and a dated TimeLog Apply removes the overlapping period total of the other granularity (follow-up 543) — that removal also deletes hand-typed hours on days the Apply never routed, without the confirm dialog saying so, filed as follow-up 546 (Ishiguro)
// 1.5.1: an email field refuses a changed address that is not valid or holds a comma or semicolon — in every record editor, bulk edit, the AI tools and the Jira and TimeLog settings, which keep the last valid address while you type — while addresses already stored keep loading; a stored "Name <address>" loads as the bare address, opening a file or switching to a project that is not on Turso, applying a template or creating a project from a seed names the records still holding an unsafe address, an AI seed leaves such an address blank, and Jira and Outlook contact sync blank one; correcting a person's email carries the correction to the linked tasks, RAID items, absences, shifts, stakeholders and contact persons still holding the old copy, as one undo step; a popout can no longer create a person, record an undo step or replay one; permanently deleting a Turso project also removes its chat threads, committee report versions, snapshots and version history; and a date that is not on the calendar, such as 2026-02-30, is no longer stored on save, while a file or Turso load blanks an optional one and keeps a required one — the stakeholder editor still saves name, organization, title and notes uncapped when submitted with Enter, filed as follow-up 541 (Highsmith)
// 1.5.0: TimeLog actuals keep their booking days — Apply writes each person's hours per booking day into a budget line and replaces a covered period whole, the budget report, burn-down and Budget view count those days into whichever month or week holds them, so switching the plan between monthly and weekly after a fetch or an Apply no longer strands applied hours under keys the report never reads (follow-up 169); a period holding TimeLog day hours is read-only in the Budget view; and the per-device TimeLog cache packs its day cells so a large project fits, with a warning in the TimeLog panel when the browser still refuses the save — an older build drops day keys on load, so do not roll back past this release once TimeLog hours are applied, and a period key of the other granularity, typed by hand or written by an Apply before 1.5.0, is added to the day hours after switching back, filed as follow-up 543 (Highsmith)
// 1.4.0: the Version panel shows a one-line pitch and five highlights of what makes the app different instead of a per-release history, and its Acme footer gives way to the EUPL-1.2 licence, an author line built with Claude Code and links to GitHub and LinkedIn; the start window shows the transparent beacon banner, the classic header logo is 300×70 and the modern sidebar logo spans the sidebar; a guardrail insight's person link opens that person's editor in the Resources directory; Outlook Push and Pull buttons name their entity; the chat attach button no longer clicks a display:none input; a Kanban task with no resource link lands in its person's lane by email, never an external's; and the Gantt no longer numbers a milestone it cannot draw — repeating a person link while that person's editor is open re-runs the open, filed as follow-up 540 (Hammett)
// 1.3.3: an info hint beside a field is no longer read as part of that field's name — in the task and project forms, the absence, change, RAID, resource and stakeholder editors, Jira settings and four settings sections — and dictation mics no longer sit inside field labels; a dialog opened on top of another names its close button after its own title, so "Close" no longer means two different buttons; the AI absence tools refuse a malformed assignee email as the task tools do, and the absence editor refuses one you type while still saving an absence that already holds one; switching from the classic layout back to the modern one keeps the view you were on; and the TimeLog picker resets when you switch between two projects that have no code (Chandler)
// 1.3.2:rich text that merely opens with a bracketed phrase such as <a note about pricing> is no longer read as HTML and emptied, because a tag now counts as HTML only when every attribute carries a value; a run of carriage returns before a line break no longer loses one on every Markdown save; a meeting report over 100,000 characters falls back to plain text instead of being cut inside a tag or character, and one that opens with plain text keeps its markup; the resource editor, the AI resource tools and the AI inline edit refuse a new email address holding a comma or semicolon through one shared rule while keeping addresses already stored; and a TimeLog cache entry too large for browser storage drops its user and project lists instead of being lost (Chandler)
// 1.3.1: the Budget burn-down values a fixed-price bucket from its contract amount, so its planned and remaining lines match the budget report and an overrun shows in the period it happens; a non-EUR bucket with no exchange rate still converts at 1:1 but now says so on its currency, and the project total on the Budget panel, the budget report and the Dashboard budget tile names how many fixed-price contract amounts it counted that way; the FX override keeps four decimals in the editor and on load, so its advertised minimum of 0.0001 is no longer rounded to 0 and refused; the bucket editor no longer offers or saves an FX override on an EUR bucket; Help no longer promises a burn-down forecast; and the sidebar and classic top bar show the AI PM Cockpit banner by default (Chandler)
// 1.3.0: Insights and Next actions can log a signal as a RAID item through the RAID editor, and saving from an insight marks it acted and links the two; Escalate now records who was escalated to and when on the RAID item itself, with a note naming the recipient, an activity entry and the severity raise, shown in a hidden-by-default "Last escalated" column and a read-only list in the RAID editor; the AI assistant can record an escalation the same way — append-only, undoable, authored "AI created", with no mail; and Markdown storage keeps a literal <br> in any cell instead of reading it back as a line break, which had wiped an item's note log or escalation history (Chandler)
// 1.2.0: every project row in the Projects list now shows how many of its eleven key facts are set — a meter plus "N of 11" text — with a row for a project not yet opened on this device reading as not measured rather than as 0 of 11; the current project also carries a banner naming its missing facts with a "Complete them" button that opens the edit form, and non-current rows show their cached customer; Next actions groups the current project's missing key facts into one row, always ranked below the Now tier, that opens the Projects view; snoozing any grouped Next-actions row now snoozes every signal folded into it instead of only the top one, so the row no longer reappears immediately with the next reason promoted; and a Next-actions "open" action whose id is not a number no longer writes #<view>/NaN into the address bar (Hodgell)
// 1.1.0: a project can be created and saved with nothing but a name — code, project manager, customer, products, profit center, NACE section, deployment, start date, contacts and regulatory classification may all stay blank, on every storage backend, where before a blank key fact made the loader discard the whole project; a blank code shows as a dash in the project lists and the Turso picker, and a TimeLog fetch for a project with no start date falls back to its 90-day window; the follow-up register is now checked by a blocking register-only gate on each open entry's Work item line and a warn-only comparison against the open GitLab issues — do not roll back past this release once a name-only project exists, because an older build drops it on load, and two projects without a code give the TimeLog picker the same switch signal, filed as follow-up 532 (Doyle)
// 1.0.3: the app opens on the Dashboard instead of wherever the last session ended — a view-only address left over from the previous session is ignored on a fresh start while a link to a specific item still opens it, and relaunching the desktop app brings its window back to the Dashboard; the Ask Claude button no longer sits unclickable behind the search field at common laptop widths; and a toggle's check mark takes no room while the toggle is off, except in the seven places where that would move a control under the pointer — switching from the classic layout back to the modern one also lands on the Dashboard for now, filed as follow-up 478 (Pratchett)
// 1.0.2: every money figure the budget engine produces is EUR and the surfaces say so — a fixed-price bucket held in another currency is converted before it is compared against its cost, where before the contract amount was read as if it were EUR and the bucket reported a healthier margin than it had; an FX rate stored against a EUR bucket is now ignored rather than divided by, which repairs buckets that kept a stale rate after their currency was switched back and had been shrinking an 80,000 EUR contract to 72,727 on the project rollup and throughout the Budget report; four budget surfaces now say EUR instead of the plan's symbol, the money ratio is no longer called CPI (which is EVM's term for a different number), and three hints are corrected in English and German — a non-EUR PLAN stays unsupported and its margin is now wrong where it used to be right, filed as follow-up 473 (Pratchett)
// 1.0.1: the desktop app can print and can check for a newer version — File → Print… (Ctrl+P) prints the window you are actually looking at, driven from the main process because Electron refuses a page's own print call, which is the same reason the in-pane Print buttons no longer appear in the desktop app instead of doing nothing when clicked; Help → "Check for updates…" and the Version dialog both open the Releases page, the app shipping no auto-updater on purpose; cancelling the print dialog no longer writes a failure line into launch.log; Help → Help and the print route now share one liveness decision, so neither can throw at a window the user has closed; and a failure during startup is logged and shown in a dialog rather than leaving no window and no trace — PDF export from Documents and the export menu stays inert in the packaged app, filed as follow-up 468 (Pratchett)
// 1.0.0: AI PM Cockpit's first release published as an installer package — it replaces the 0.303.0 GitLab Release, which is being withdrawn along with its tag; the Windows installer no longer carries sharp's Linux binaries that a Linux CI runner had been installing into the bundled server though the app never loads them, measured about 6.1 MiB smaller (103,565,559 B → 97,186,650 B) against v0.303.0's installer, with the desktop-package CI jobs now failing if a sharp package reappears; and a spike write-up records what the first CI builds and the first GitLab Release actually measured — image pull times, artifact sizes and contents, and that a signed-in non-member can download the installer — leaving a new open follow-up for a Linux installer (Pratchett)
// 0.303.0: AI PM Cockpit now ships as a per-user Windows desktop app that needs no admin rights, no Node.js and no terminal — it runs the app's own server on 127.0.0.1:17300 only, never on the machine's network address, keeps that port fixed because the saved data belongs to it, and says so in a dialog rather than a blank window when it cannot start; it names itself "AI PM Cockpit" with its own icon, author and branded installer instead of Electron's; a v-tag now drives the release, checking the tag against the app version, building the installer as a kept artifact and creating a GitLab Release that links to it, though no tag pipeline has run yet; and the README became an entry point, with its detail moved into docs of their own (Christie)
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
 *  1.12.x line is "Child" (Lee Child, British thriller novelist, author of
 *  "Killing Floor", 1997, and "Persuader", 2003), taken by the SELECTION
 *  procedure below as the first name in the candidate list. Swept BEFORE the
 *  1.12.0 header was written, in one run with its controls: `grep -ciw child
 *  CHANGELOG.md` 6, `grep -c '"Child"' CHANGELOG.md` 0, and `git log --all
 *  --format=%s | grep -ciw child` 4; positive control `grep -c '"Grisham"'
 *  CHANGELOG.md` 1, negative control `zzznotaname` 0. The six CHANGELOG.md
 *  hits and four commit-subject hits are all the ordinary English word
 *  ("child"/"children"/"server-child.ts") or the unrelated `mountedRef`-style
 *  "child prop" usage, never the codename `"Child"` — inspected individually;
 *  none is this codename.
 *  The 1.11.x line was "Grisham" (John Grisham, American legal-thriller novelist,
 *  author of "A Time to Kill", 1989, and "The Firm", 1991), taken by the
 *  SELECTION procedure below as the first name in the candidate list. Swept
 *  BEFORE the 1.11.0 header was renamed to it, in one run with its controls:
 *  `grep -ciw grisham CHANGELOG.md` 0, `grep -c '"Grisham"' CHANGELOG.md` 0,
 *  and `git log --all --format=%s | grep -ciw grisham` 0; positive control
 *  `grep -c '"Leonard"' CHANGELOG.md` 2, negative control `zzznotaname` 0.
 *  The 1.10.x line was "Leonard" (Elmore Leonard, American crime novelist, author of
 *  "Get Shorty", 1990, and "Rum Punch", 1992), taken by the SELECTION procedure
 *  below as the first name in the candidate list. Swept BEFORE the 1.10.0
 *  header was written, in one run with its controls: `grep -ci leonard
 *  CHANGELOG.md` 0, `grep -c '"Leonard"' CHANGELOG.md` 0, and `git log
 *  --format=%s | grep -ci leonard` 0; positive control `grep -c '"James"'
 *  CHANGELOG.md` 1.
 *  The 1.9.x line was "James" (P. D. James, British crime novelist, author of
 *  "Cover Her Face", 1962, and "The Children of Men", 1992), taken by the
 *  SELECTION procedure below as the first name in the candidate list. Swept
 *  BEFORE the 1.9.0 header was written, in one run with its controls: `james`
 *  0 hits anywhere in CHANGELOG.md, 0 against the header lines, and 0 in every
 *  commit subject in the history; positive control `rendell` 1 header hit,
 *  negative control `zzznotaname` 0.
 *  The 1.8.x line was "Rendell" (Ruth Rendell, British crime novelist, author of "A
 *  Judgement in Stone", 1977, and the Inspector Wexford novels beginning with
 *  "From Doon with Death", 1964), taken by the SELECTION procedure below as the
 *  first name in the candidate list. Swept BEFORE the 1.8.0 header was written,
 *  in one run with its controls: `rendell` 0 hits anywhere in CHANGELOG.md, 0
 *  against the header lines, and 0 in every commit subject in the history;
 *  positive control `sayers` 2 on each axis, negative control `zzznotaname` 0.
 *  The 1.7.x line was "Sayers", taken as the first name in the candidate list
 *  (it was entry 5 there). The 1.7.0 release commit did not update this
 *  docstring, so no sweep for it was recorded here and this lead went on naming
 *  1.6.x through two releases.
 *  The 1.6.x line was "Ishiguro" (Kazuo Ishiguro, British novelist and 2017 Nobel
 *  laureate, author of "The Remains of the Day", 1989, and "Never Let Me Go",
 *  2005), chosen after the first candidate turned out to be taken by 0.16.0.
 *  Swept BEFORE the 1.6.0 header was written, in one run with its controls:
 *  `ishiguro` 0 hits anywhere in CHANGELOG.md, 0 against the header lines, and 0
 *  in every commit subject in the history; positive control `chandler` 4 on each
 *  axis, negative control `zzznotaname` 0.
 *  The 1.5.x line was "Highsmith" (Patricia Highsmith, American crime novelist, author
 *  of "Strangers on a Train", 1950, and "The Talented Mr. Ripley", 1955), taken by
 *  the SELECTION procedure below as the first name in the candidate list. Swept
 *  BEFORE the 1.5.0 header was written, in one run with its controls:
 *  `highsmith` 0 hits anywhere in CHANGELOG.md, 0 against the header lines, and 0
 *  in every commit subject in the history; positive control `chandler` 4 on each
 *  axis, negative control `zzznotaname` 0.
 *  The 1.4.x line was "Hammett" (Dashiell Hammett, American crime novelist, author of
 *  "Red Harvest", 1929, and "The Maltese Falcon", 1930), taken by the SELECTION
 *  procedure below as the first name in the candidate list. Swept BEFORE the
 *  1.4.0 header was written, in one run with its controls: `hammett` 0 hits
 *  anywhere in CHANGELOG.md, 0 against the header pattern at any position, and
 *  0 in every commit subject in the history; positive control `chandler` 4,
 *  negative control `zzznotaname` 0.
 *  The 1.3.x line was "Chandler" (Raymond Chandler, American crime novelist of the
 *  Philip Marlowe novels, beginning with "The Big Sleep", 1939), taken by the
 *  SELECTION procedure below as the first name in the candidate list. Swept
 *  BEFORE the 1.3.0 header was written, in one run with its controls:
 *  `chandler` 0 hits anywhere in CHANGELOG.md, 0 against the bracketed header
 *  pattern, 0 against the bracketless one, and 0 in every commit subject in
 *  the history; positive control `cadigan` 2, negative control `zzznotaname` 0.
 *  The 1.2.x line was "Hodgell" (P.C. Hodgell, American fantasy author of the
 *  Kencyrath series, beginning with "God Stalk", 1982) — provided directly
 *  rather than drawn from the SELECTION procedure's candidate list: it is
 *  absent from BOTH sections of `docs/release-codenames.md` (the "Already
 *  Used" list and the "Candidate Names Not Yet Used" list), so this is an
 *  explicit pick outside the usual procedure, the same shape as "Pratchett"
 *  for the 1.0.x line further down. Swept BEFORE the 1.2.0 header was
 *  written: `hodgell` 0 hits anywhere in CHANGELOG.md, 0 against the
 *  bracketed header pattern, 0 against the bracketless one, and 0 in every
 *  commit subject in the history; positive control `cadigan` 2, negative
 *  control `zzznotaname` 0.
 *  The 1.1.x line was "Doyle" (Arthur Conan Doyle, Scottish author of the Sherlock
 *  Holmes stories, beginning with "A Study in Scarlet", 1887), taken by the
 *  SELECTION procedure below as the first name in the candidate list. Swept
 *  BEFORE the 1.1.0 header was written, in one run with its controls: `doyle`
 *  0 anywhere in CHANGELOG.md and 0 in the named headers, with the bracketed
 *  `\[[0-9]+\.` pattern and the bracketless `## 0.124.0` shape both read;
 *  positives `pratchett` 6 (four 1.0.x headers, 0.51.0 and the bracketless
 *  0.124.0) and `cadigan` 2; negative `zzznotaname` 0. It is also absent
 *  from every commit subject in the history, so it is unused anywhere, not
 *  merely legal for its minor line.
 *  The 1.0.x line was "Pratchett" (Terry Pratchett, British author of the Discworld
 *  novels, beginning with "The Colour of Magic", 1983) — the user's explicit
 *  choice for the 1.0 release, deliberately REUSING a name already spent
 *  twice before (0.51.0 and 0.124.0, both also "Pratchett"). That is legal:
 *  uniqueness is per MINOR LINE, not across history (see the ★★★ note below),
 *  and the 0.51.x/0.124.x lines are unrelated to 1.0.x, so this is not a
 *  collision. The docstring elsewhere on this point (the "Banks"/"Chiang"
 *  history) says this repo normally PREFERS a name unused anywhere in the
 *  history and has rejected a legal reuse on that ground alone — this one
 *  is the exception, made on the user's explicit instruction rather than by
 *  the usual candidate-list sweep, and is recorded here for that reason. A
 *  PATCH release keeps its minor line's
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
 *  grep -oE '^## \[[0-9]+\.[0-9]+\.[0-9]+\][^"]*"[^"]+"' CHANGELOG.md \
 *    | sed -E 's/^## \[([0-9]+\.[0-9]+)\.[0-9]+\][^"]*"([^"]+)"$/\2|\1/' \
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
 *  `grep -oE '^## \[[0-9]+\.[0-9]+\.[0-9]+\][^"]*"[^"]+"' CHANGELOG.md | grep -i <name>`
 *  ★★★ AN ANCHORED GREP MISSES HEADERS ON TWO SEPARATE AXES, and each has
 *  already reported a taken name as free. (1) THE DASH — older headers use an
 *  em dash and newer ones a hyphen, so a `] - ` anchor is blind to a large
 *  minority of them; that is how two consecutive lines shipped asserting a
 *  freshness that was false. (2) THE ORDER — some headers put the codename
 *  BEFORE the date (`## [0.7.2] "Banks" — 2026-05-19`), so an END-OF-LINE
 *  anchor cannot see them; that is how "Banks" reached this constant, the
 *  CHANGELOG heading and all six satellites before it was caught. Measure both
 *  populations rather than trusting a figure written here:
 *  `grep -coE '^## \[[0-9]+\.[0-9]+\.[0-9]+\]' CHANGELOG.md` (all version headers)
 *  `grep -coE '^## \[[0-9]+\.[0-9]+\.[0-9]+\] *"' CHANGELOG.md` (codename first)
 *  ★ (3) THE BRACKET — one header, `## 0.124.0 "Pratchett" — 2026-06-22`, omits
 *  the brackets around the version entirely. It is 1 of 437 `## ` headers total
 *  — not among the 436 bracketed ones the two commands above count — measured
 *  by running all three:
 *  `grep -cE '^## [0-9]+\.[0-9]+\.[0-9]+ ' CHANGELOG.md` prints 1 (bracketless),
 *  `grep -cE '^## \[[0-9]+\.[0-9]+\.[0-9]+\]' CHANGELOG.md` prints 436 (bracketed),
 *  `grep -cE '^## ' CHANGELOG.md` prints 437 (every header, either shape).
 *  Every pattern
 *  on this page is anchored on the `\[`, so all of them miss it — a bracketless
 *  header reads as absent from every sweep here, not merely as a dash/order
 *  miss. Left unfixed rather than patched in: a third alternation branch here
 *  is exactly the kind of pattern change this docstring says to PROVE against
 *  the full header population, not guess at, and this file's job today is
 *  widening `\[0\.` to `\[[0-9]+\.` for the 1.0.x line, not that.
 *  ★★★ THE NAME CLASS IS `[^"]+`, NOT `[A-Za-z]+`, and the first cut of that
 *  correction shipped `[A-Za-z]+` — one character class from the defect it was
 *  written to end. It silently drops every codename that is not a single ASCII
 *  word: "Le Guin" (space), "Nevala-Lee" (hyphen), "García" (non-ASCII). A
 *  candidate of any of those shapes returns zero hits and reads as free. Prove
 *  a replacement pattern by showing it sees ALL named headers, never by showing
 *  it finds the one name you happened to check:
 *  `grep -coE '^## \[[0-9]+\.[0-9]+\.[0-9]+\][^"]*"[^"]+"' CHANGELOG.md`
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
export const APP_MILESTONE = "Child";
/** Version with its milestone codename for UI display, e.g. `0.39.0 "Gibson"`. */
export const APP_VERSION_LABEL = `${APP_VERSION} "${APP_MILESTONE}"`;
/** The app's public source repository, linked from the Version panel. */
export const APP_REPO_URL = "https://github.com/sebastianmaute/aipm-cockpit";
/** The author's public profile, linked from the Version panel's author line. */
export const APP_AUTHOR_URL = "https://www.linkedin.com/in/sebastian-maute/";

/** Open-source license (SPDX id) and its canonical reference URL, shown in the
 *  Settings footer and the Help panel. Mirrors package.json `license`. */
export const APP_LICENSE = "EUPL-1.2";
export const APP_LICENSE_URL =
  "https://interoperable-europe.ec.europa.eu/collection/eupl/eupl-text-eupl-12";

/** Where to get a newer build, linked from the Version panel's desktop-only
 *  section (rendered only under `isDesktopShellUserAgent()` — the web app has
 *  its own deploy and no "get a newer build" question). MUST equal desktop's
 *  own `RELEASES_URL` (desktop/src/lib/constants.ts), which the packaged
 *  app's Help → "Check for updates…" item already opens via
 *  `shell.openExternal` — two copies of one URL, pinned equal by
 *  `desktop/src/lib/menu-model.test.ts` (reads this file as text; desktop
 *  cannot import across its tsconfig rootDir, so there is no single shared
 *  constant to import instead). */
export const APP_RELEASES_URL =
  "https://gitlab.example.com/example-group/public-collab/aipm-cockpit/-/releases";

/** Translation keys for the elevator-pitch highlights in the Version panel: the
 *  features unique to this app, NOT a per-release history (CHANGELOG.md owns that).
 *  A release does not add a key here. Update EN and DE together. */
export const APP_HIGHLIGHT_KEYS = [
  "versionHighlightCopilot",
  "versionHighlightLimits",
  "versionHighlightStack",
  "versionHighlightLocalFirst",
  "versionHighlightScales",
] as const;
