// Application version metadata: version, build date, milestone codename,
// repo/license links, and the Version-popover highlight keys.
// Per-version history lives in CHANGELOG.md (repo root) — the authoritative
// changelog. APP_BUILD_DATE is the date of the last build.
export const APP_VERSION = "0.262.0";
export const APP_BUILD_DATE = "2026-08-27"; // 0.262.0: bound the whole Turso exchange, not just the headers (Clement)
/** Minor-series milestone codename (sci-fi/fantasy author names). The
 *  0.262.x line is "Clement" (this slice's codename — no bio recorded for it
 *  here; not asserting one rather than guessing, per the 0.258.x note below).
 *  ★ Named at its OWN release, closing the one-release lag every entry below
 *  inherited: this list used to open at the PREVIOUS line while shipping the
 *  current one, so the shipping codename appeared nowhere with an attribution.
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
export const APP_MILESTONE = "Clement";
/** Version with its milestone codename for UI display, e.g. `0.39.0 "Tchaikovsky"`. */
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
