// Application version metadata: version, build date, milestone codename,
// repo/license links, and the Version-popover highlight keys.
// Per-version history lives in CHANGELOG.md (repo root) — the authoritative
// changelog. APP_BUILD_DATE is the date of the last build.
export const APP_VERSION = "0.275.0";
export const APP_BUILD_DATE = "2026-09-01"; // 0.275.0: every control that repeats once per row on the Next-actions, Projects, Resources and version-history surfaces now announces a name unique to its row, so a screen reader can tell two rows apart when the people, projects or actions in them share a name (Nagata)
/** Minor-series milestone codename (sci-fi/fantasy author names). The
 *  0.274.x line is "Varley" (John Varley, American SF author, the Gaea
 *  trilogy). Checked dash-agnostically BEFORE the bump with the command
 *  below: zero hits, against a pattern proved to see all 365 named headers,
 *  so this one is genuinely fresh rather than a permitted reuse.
 *  0.273.x was "Goonan" (Kathleen Ann Goonan, American SF author, the
 *  Nanotech Quartet). Checked dash-agnostically BEFORE the bump with the
 *  command below: zero hits, against a pattern proved to see all 363 named
 *  headers, so this one is genuinely fresh rather than a permitted reuse.
 *  0.272.x was "Zoline" (Pamela Zoline, American SF author and painter,
 *  "The Heat Death of the Universe"). Checked dash-agnostically BEFORE the
 *  bump with the command below: zero hits across all 398 version headers, so
 *  this one is genuinely fresh rather than a permitted reuse.
 *  ★★★ 0.271.x ("Gibson") WAS a reuse: 0.59.0 (2026-06-10) ran under the
 *  same name. Permitted — the rule at the end of this comment is uniqueness
 *  per MINOR LINE, not across all history — and recorded so that a bare
 *  `grep -rn "Gibson" CHANGELOG.md` hit is not read as the name being taken.
 *  ★★★ THAT LINE FIRST SHIPPED CLAIMING THE NAME WAS FRESH, on the evidence
 *  of a grep anchored to `] - `, in the very sentence that pointed at the
 *  dash note below warning against exactly that. 0.59.0's header uses an EM
 *  DASH and was invisible to it — as are 100 of the 398 version headers, and
 *  not only through the dash: 23 of those put the codename BEFORE the date,
 *  so the `] - ` anchor misses them on a second axis. Check a candidate
 *  dash-agnostically, and BEFORE the bump — run it after and the pattern
 *  matches the header you just wrote, which reads as a collision with
 *  yourself:
 *  `grep -oE '^## \[0\.[0-9]+\.[0-9]+\][^"]*"[^"]+"' CHANGELOG.md | grep -i <name>`
 *  ★★★ THE NAME CLASS IS `[^"]+`, NOT `[A-Za-z]+`, AND THE FIRST CUT OF THIS
 *  VERY CORRECTION SHIPPED `[A-Za-z]+` — one character class away from the
 *  defect it was written to end. That class silently drops every codename
 *  that is not a single ASCII word: "Le Guin" (space), "Nevala-Lee"
 *  (hyphen), "García" (non-ASCII) — 4 of 362 named headers today. A
 *  candidate of any of those shapes returns zero hits and reads as free.
 *  A replacement is only proved by showing it sees ALL 362 named headers,
 *  never by showing it finds the one name you happened to be checking:
 *  `grep -coE '^## \[0\.[0-9]+\.[0-9]+\][^"]*"[^"]+"' CHANGELOG.md`
 *  0.270.x was "Tchaikovsky" (Adrian Tchaikovsky, British SF/fantasy
 *  author). ★★ REUSED: 0.39.0 (2026-06-01) also ran under this name —
 *  permitted, same per-MINOR-LINE rule. ★★ It shipped asserting "Not
 *  previously used at any minor line", which was FALSE, for the same
 *  dash-anchored-grep reason as the 0.271.x note above; corrected
 *  2026-08-31, one release late. The rest of the original note stands and is
 *  a separate judgement: the name WAS chosen over one that 0.265.x had taken
 *  the day before, since a reader grepping CHANGELOG would then get two hits
 *  a day apart. Legality and recency are different questions.
 *  0.269.x was "Due" (Tananarive Due, American horror/SF author).
 *  0.268.x was "Ogawa" (Yoko Ogawa, Japanese author of speculative fiction),
 *  developed concurrently with this line on a separate branch and merged
 *  first.
 *  0.267.x was "Nagamatsu" (Sequoia Nagamatsu, American SF author).
 *  0.266.x was "VanderMeer" (Jeff VanderMeer, American SF/weird-fiction
 *  author). ★★ REUSED: 0.96.0 also ran under this name — permitted by the same
 *  uniqueness-per-MINOR-LINE rule spelled out below, and recorded here so that a
 *  bare `grep -rn "VanderMeer" CHANGELOG.md` hit is not read as the name being
 *  taken. Read WHICH minor line the hit belongs to before concluding anything.
 *  0.265.x was "Nagata" (Linda Nagata, American SF author). ★★ REUSED:
 *  0.75.0 also ran under this name. That is permitted — the rule below is
 *  uniqueness per MINOR LINE, not across all history, and "Okorafor" carries
 *  the same note — but it means a bare `grep -rn "Nagata" CHANGELOG.md`
 *  returns a hit for a name that was nonetheless free to take. Read WHICH
 *  minor line the hit belongs to before concluding a name is taken.
 *  0.264.x was "Russell" (that slice's codename — no bio recorded for it here;
 *  not asserting one now rather than guessing, per the 0.236.x note below).
 *  0.263.x was "Okorafor" (Nnedi Okorafor, Nigerian-American SF/fantasy
 *  author). Reused: 0.223.x and 0.25.x also ran under this name.
 *  0.262.x was "Swainston" (Steph Swainston, British fantasy author).
 *  0.261.x was "Leckie" (Ann Leckie, SF author).
 *  0.260.x was "Cho" (Zen Cho, Malaysian fantasy author).
 *  0.259.x was "Tsutsui" (Yasutaka Tsutsui, Japanese SF author).
 *  0.258.x was "Mandelo" (that slice's codename — no bio recorded for it
 *  here; not asserting one now rather than guessing, per the 0.236.x note
 *  below).
 *  0.257.x was "Shepard" (Lucius Shepard, SF/fantasy author).
 *  0.256.x was "Khaw" (Cassandra Khaw, SF/horror author).
 *  0.255.x was "Bisson" (Terry Bisson, SF author).
 *  0.254.x was "Yoshinaga" (Fumi Yoshinaga, SF/fantasy manga author).
 *  0.253.x was "Schroeder" (Karl Schroeder, SF author).
 *  0.252.x was "Brust" (Steven Brust, fantasy author).
 *  0.251.x was "Larson" (Rich Larson, SF author).
 *  0.250.x was "McAuley" (Paul McAuley, SF author).
 *  0.249.x was "Modesitt" (L.E. Modesitt Jr., SF/fantasy author).
 *  0.248.x was "Bujold" (Lois McMaster Bujold, SF/fantasy author).
 *  0.247.x was "Butcher" (Jim Butcher, fantasy author).
 *  0.246.x was "Bodard" (Aliette de Bodard, SF/fantasy author).
 *  0.245.x was "Buckell" (Tobias S. Buckell, SF author).
 *  0.244.x was "Waldrop" (Howard Waldrop, SF/fantasy short-fiction author).
 *  0.243.x was "Aaronovitch" (Ben Aaronovitch, urban-fantasy author).
 *  0.242.x was "Ashby" (Madeline Ashby, SF author).
 *  0.241.x was "Tuttle" (Lisa Tuttle, SF/fantasy author).
 *  0.240.x was "Elliott" (Kate Elliott, prolific SF/fantasy author).
 *  0.239.x was "Rusch" (Kristine Kathryn Rusch, prolific SF/fantasy author).
 *  0.238.x was "Attanasio" (A.A. Attanasio, SF/fantasy author).
 *  0.237.x was "Roberson" (Chris Roberson, SF/fantasy author).
 *  0.236.x was "Sheldon" (the rich-text toolbar's keyboard contract slice —
 *  no bio recorded for it here; not asserting one now rather than guessing).
 *  0.235.x was "Lackey" (Mercedes Lackey, prolific fantasy author).
 *  0.234.x was "Anders" (Charlie Jane Anders, contemporary SF/fantasy author).
 *  0.233.x was "Reed" (Robert Reed, prolific SF short-fiction author).
 *  ★★ 0.224.0 IS A PERMANENTLY DEAD NUMBER — do not reuse it. The 0.226.0 line
 *  was built and numbered 0.224.0 while unpushed; main could not wait for it,
 *  deliberately skipped 0.224.0 and shipped 0.225.0 "Walton" first, so keeping
 *  0.224.0 would have meant a release commit naming a version no build ever
 *  reported. The gap is the record of why.
 *  ★ Fetch before bumping. 0.221.0 "Kavan" shipped on main while the 0.222.0
 *  branch was in review and forced a renumber at merge time — and it happened
 *  AGAIN here: this branch's own bump (0.237.0 "Attanasio") collided with
 *  0.236.0 "Sheldon" AND 0.237.0 "Roberson" both landing on main first while
 *  it sat unpushed, forcing a renumber to 0.238.0 at merge time. A codename
 *  is unique per minor line and no gate here checks either the number or the
 *  name — the only defence is looking at CHANGELOG.md first. ★★ Match the NAME,
 *  not the dash: older CHANGELOG entries use an em-dash and newer ones a hyphen,
 *  so a dash-anchored grep reports used names as free. */
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
export const APP_MILESTONE = "Nagata";
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
] as const;
