import { type Priority } from "./types";

export type Lang = "en-US" | "en-GB" | "de";

const enUS = {
  appTitle: "List of Open Points Tracker",
  appSubtitle: "Capture open project items. Stored locally in this browser.",

  newTask: "New task",
  editingTask: "Editing task #{0}",
  cancelEdit: "Cancel edit",
  cancel: "Cancel",
  addTask: "Add task",
  updateTask: "Update task",

  id: "ID",
  priority: "Priority",
  taskName: "Task name",
  assignee: "Assignee",
  email: "Email",
  startDate: "Start date",
  startDateHint:
    "Optional. When set, the Gantt anchors this task's left edge here. Otherwise it derives from predecessors or last-update date.",
  dueDate: "Due date",
  lastUpdateDate: "Last update date",
  blockers: "Blockers",
  notes: "Notes",

  placeholderTaskName: "What needs to happen?",
  placeholderAssignee: "Name or email",
  placeholderEmail: "Optional — used for status inquiries",
  placeholderBlockers: "What's preventing progress?",
  placeholderNotes: "Anything else worth recording",

  errorRequired: "Task name, assignee, and due date are required.",
  errorPastDate: "Due date must be today or later.",
  errorInvalidEmail: "That doesn't look like a valid email address.",

  priorityLow: "Low",
  priorityMedium: "Medium",
  priorityHigh: "High",
  priorityUrgent: "Urgent",

  tasks: "Tasks",
  tasksCount: "({0})",
  tasksCountFiltered: "({0} of {1})",
  clearAll: "Clear all",
  searchPlaceholder: "Search task name, assignee, blockers, notes…",
  allPriorities: "All priorities",
  allAssignees: "All assignees",
  noTasks: "No tasks yet. Add one above.",
  noTasksFiltered: "No tasks match the current filters.",

  task: "Task",
  start: "Start",
  due: "Due",
  lastUpdate: "Last update",

  edit: "Edit",
  delete: "Delete",
  sendInquiry: "Send inquiry",

  showMore: "Show more",
  showLess: "Show less",
  tableResizeHint: "Drag the bottom-right corner to resize the table.",
  tableResetSize: "Reset size",
  tableResetSizeHint: "Reset back to the default size.",
  colResetWidthsHint: "Reset all column widths back to their defaults.",
  colConfigTitle: "Configure columns",
  colStatus: "Status",
  workspaceResizeHint:
    "Drag the bottom-right corner to resize this workspace pane.",
  workspaceCollapse: "Collapse workspace",
  workspaceExpand: "Expand workspace",

  confirmDelete: "Delete task #{0}? This cannot be undone.",
  confirmClearAll: "Delete all {0} tasks? This cannot be undone.",
  confirmClearActivityLog: "Clear all {0} activity log entries? This cannot be undone.",
  promptEmail: "No email saved for {0}. Enter their email address:",

  emailSubject: "Update for assigned task: #{0} – {1}",
  emailBodyTemplate:
    "Hi {0},\n\nCould you provide a status update on the following task?\n\n- ID: #{1}\n- Task: {2}\n- Due: {3}\n- Last update: {4}\n\nThanks",

  dueToday: "Due today",
  overdue: "Overdue (was due {0})",
  workDayLeft: "{0} work day left",
  workDaysLeft: "{0} work days left",

  settings: "Settings",
  language: "Language",
  holidayCountries: "Holiday countries",
  selectCountry: "Select country…",
  add: "Add",
  noCountriesSelected: "No countries selected. Only weekends are excluded.",
  remove: "Remove",

  voiceCommand: "Voice command",
  voiceCommandTip:
    "Click and say e.g. \"edit task 2\", \"delete task 3\", \"add task review the deck\"",
  voiceFieldHint: "Click and dictate",
  voiceListening: "Listening…",
  voiceUnsupported: "Voice input is not supported in this browser.",
  voiceUnknownCommand: "Didn't understand: \"{0}\"",
  voiceTaskNotFound: "Task #{0} not found.",
  voiceFailed: "Voice input failed.",
  voicePermissionDenied: "Microphone permission denied.",

  storage: "Storage",
  storageBrowser: "Browser only",
  storageBrowserHint:
    "Tasks are stored in this browser's IndexedDB. Data is lost if you clear browsing data.",
  storageLocalJson: "Local JSON file",
  storageLocalCsv: "Local CSV file",
  storageLocalMd: "Local Markdown file",
  storageSpJson: "SharePoint Online (JSON)",
  storageSpCsv: "SharePoint Online (CSV)",
  comingSoon: "coming soon",
  storageFsaUnsupported:
    "This browser doesn't support direct file access. Use Chrome, Edge, or Opera.",
  storagePickFile: "Save as new file",
  storageChangeFile: "Save as new file",
  storageOpenFile: "Open existing file",
  storagePickFilePrompt: "Save as a new file or open an existing one to start syncing.",
  storageOpenedToast: "Loaded {0} task(s) from file.",
  storageConfirmOverwrite:
    "This will replace the {0} task(s) currently in the app with the contents of the file. Continue?",
  storagePermissionNeeded: "permission required on next save",
  storageSpComingSoon:
    "SharePoint sync is planned but not implemented yet. It will require an Azure AD app registration.",
  storageSwitchedToast: "Storage backend switched.",
  storageLoadFailed: "Couldn't load tasks: {0}",
  storageSaveFailed: "Couldn't save tasks: {0}",
  storageNotReady: "Storage isn't configured yet — pick a file in Settings.",
  storagePermissionGestureNeeded:
    "Write access not granted yet. Open Settings and click \"Grant write access\" to allow saving.",
  storageGrantWrite: "Grant write access",
  storagePermissionGranted: "Write access granted.",
  storagePermissionDenied:
    "Write access was not granted. Saves will not work until you allow it.",
  storageWriteBlocked:
    "Can't write to this file — the location is blocked by the browser's security policy. Pick a different file or switch to browser storage in Settings.",

  selectAllVisible: "Select all visible tasks",
  selectRow: "Select task #{0}",
  selectionCount: "{0} selected",
  clearSelection: "Clear selection",
  bulkSendInquiries: "Send inquiries",
  bulkEdit: "Bulk edit",
  bulkEditTitleOne: "Bulk edit (1 task)",
  bulkEditTitleMany: "Bulk edit ({0} tasks)",
  bulkApplyOne: "Apply to 1 task",
  bulkApplyMany: "Apply to {0} tasks",
  bulkEditNoFields: "Tick at least one field to update.",
  bulkEditDoneOne: "Updated 1 task.",
  bulkEditDoneMany: "Updated {0} tasks.",
  bulkSendNoTasks: "No tasks ready to send.",
  bulkSendDone: "Opened {0} email(s) for {1} task(s).",
  bulkSendBlocked:
    "Your browser may have blocked some email windows. Allow popups for this site or send individually.",
  confirmBulkSend: "Send {0} email(s) for {1} task(s)?",
  emailSubjectBulk: "Update on {0} open tasks",
  emailBodyBulkTemplate:
    "Hi {0},\n\nCould you provide a status update on the following {1} open tasks?\n\n{2}\n\nThanks",

  tabChat: "Chat",
  tabNewTask: "New task",
  tabEditTask: "Editing task #{0}",

  aiAssistant: "AI assistant",
  aiApiKey: "Anthropic API key",
  aiApiKeyPlaceholder: "sk-ant-...",
  aiModel: "Model",
  aiApiKeyHint:
    "Stored in this browser only. Calls go directly from your browser to api.anthropic.com.",

  chatPlaceholder: "Ask Claude about your tasks…",
  chatSend: "Send",
  chatThinking: "Thinking…",
  chatNoApiKey:
    "Add your Anthropic API key in Settings to start chatting.",
  chatClear: "Clear chat",
  chatToolCall: "Used {0}",
  chatToolError: "Tool error",
  chatError: "Chat failed: {0}",
  chatGreeting:
    "I can list, add, update, delete tasks and send inquiries. Try \"show overdue tasks\" or \"add a task to review the pricing deck due Friday\".",

  aiConsentTitle: "Enable Claude chat?",
  aiConsentBullet1:
    "Your messages and task data (names, assignees, emails, dates, blockers, notes) are sent directly from this browser to api.anthropic.com whenever you chat.",
  aiConsentBullet2:
    "Your Anthropic API key is stored in this browser's localStorage. Anyone with access to this browser profile can read and use it. Anthropic will bill any usage to that key.",
  aiConsentBullet3:
    "Anthropic's handling of your data is governed by their Privacy Policy and Usage Policy. Review them before enabling.",
  aiConsentBullet4:
    "Do not paste confidential client information, credentials, personal data of third parties, or anything covered by an NDA into chat or task fields while chat is enabled.",
  aiConsentBullet5:
    "You can revoke consent at any time in Settings, which disables the chat without deleting your tasks or API key.",
  aiConsentBullet6:
    "Acme's policy on AI usage applies to this feature. You must read it before enabling chat.",
  aiConsentPolicyLink: "Open Acme AI usage policy",
  aiConsentPolicyCheckbox:
    "I have read and accept Acme's policy on AI usage.",
  aiConsentAccept: "I understand — enable chat",
  aiConsentDecline: "Cancel",
  aiConsentRequired:
    "Consent required. Open the Chat tab to review and enable.",
  aiConsentGranted: "Chat enabled",
  aiConsentRevoke: "Revoke consent",
  aiConsentNotAccepted:
    "Claude chat is disabled. Review and accept the consent below to enable it.",

  notifications: "Due-date notifications",
  notificationsHint:
    "Each notification can be enabled or disabled independently. Threshold is the number of work days before the due date that will trigger the notification (overdue and due-today are always included).",
  notifBanner: "Banner",
  notifToast: "Toast",
  notifPopup: "Pop-up on load",
  notifThreshold: "Within",
  notifThresholdSuffix: "work day(s)",

  alertCatOverdue: "Overdue",
  alertCatToday: "Today",
  alertCatSoon: "Soon",
  alertSummaryOverdue: "{0} overdue",
  alertSummaryToday: "{0} due today",
  alertSummarySoon: "{0} due soon",
  alertBannerTitle: "{0} task(s) need attention",
  alertBannerAria: "Upcoming due dates",
  alertBannerOpen: "Show list",
  alertBannerDismiss: "Dismiss",
  alertToastTitle: "Upcoming due dates",
  alertModalTitle: "Upcoming due dates",
  alertModalClose: "Close",
  alertModalNone: "Nothing due in your configured window.",
  showDueAlerts: "Show due-date notifications",
  addTaskButton: "Add task",

  exportTitle: "Export tasks",
  exportSubtitle: "Download all {0} tasks in your preferred format.",
  exportCsv: "CSV",
  exportCsvHint: "Plain comma-separated values — opens in any spreadsheet app.",
  exportMd: "Markdown",
  exportMdHint: "Pipe-table format, good for reports and code reviews.",
  exportPdf: "PDF",
  exportPdfHint: "Opens a print preview; choose \"Save as PDF\" in the dialog.",
  exportDocx: "Word (.docx)",
  exportDocxHint: "Landscape A4 with a branded table of every task.",
  exportXlsx: "Excel (.xlsx)",
  exportXlsxHint: "Frozen header, auto-filter enabled, branded colors.",
  exportPptx: "PowerPoint (.pptx)",
  exportPptxHint: "Title slide + one slide per task (capped at 100).",

  markComplete: "Mark complete",
  reopenTask: "Reopen",
  completedOn: "Completed on {0}",

  tabReports: "Reports",
  tabGantt: "Gantt",
  ganttEmpty:
    "Add at least one task with a due date to see it on the Gantt chart.",
  ganttNoMatches: "No tasks match the current filters.",
  ganttAddTask: "+ Add task",
  ganttToday: "Today",
  ganttRange: "Showing {0} — {1}",
  ganttFilterStatus: "Status",
  ganttStatusAll: "All status",
  ganttStatusOpen: "Open",
  ganttStatusCompleted: "Completed",
  ganttStatusOverdue: "Overdue",
  ganttSortLabel: "Sort",
  ganttSortAuto: "Auto (start date)",
  ganttSortDue: "Due date",
  ganttSortName: "Name (A–Z)",
  ganttSortPriority: "Priority",
  ganttSortCustom: "Custom (drag)",
  ganttResetFilters: "Reset filters",
  ganttDragHint: "Drag to reorder rows",
  ganttBarDragHint:
    "Drag the bar to move it · drag an edge to resize",
  ganttBarMove: "Move task (changes start and due date)",
  ganttBarResizeStart: "Drag to change start date",
  ganttBarResizeEnd: "Drag to change due date",
  ganttCriticalPath: "Critical path",
  ganttCriticalPathHint:
    "Highlight the chain of zero-slack tasks that drive the project end date.",
  health: "Health",
  healthAuto: "Auto",
  healthRed: "Red",
  healthAmber: "Amber",
  healthGreen: "Green",
  healthAutoCurrent: "Auto (currently: {0})",
  healthDriverManual: "manual override",
  healthDriverOverdue: "overdue",
  healthDriverBlocked: "blocked",
  healthDriverDueToday: "due today",
  healthDriverDueSoon: "due soon",
  healthDriverCompleted: "completed",
  healthDriverOnTrack: "on track",
  healthTooltip: "{0}: {1}",
  reportsGroupHealth: "Group health",
  reportsUngrouped: "Ungrouped",
  reportsGroupCounts: "{0} red · {1} amber · {2} green",
  tabRaid: "RAID",
  raidEmpty: "No RAID items yet. Capture a risk, assumption, issue, or dependency to start.",
  raidNoMatches: "No RAID items match the current filters.",
  raidAddItem: "+ Add RAID item",
  raidCategory: "Category",
  raidCategoryAll: "All categories",
  raidCategoryR: "Risk",
  raidCategoryA: "Assumption",
  raidCategoryI: "Issue",
  raidCategoryD: "Dependency",
  raidSeverity: "Severity",
  raidSeverityAll: "All severities",
  raidSeverityLow: "Low",
  raidSeverityMedium: "Medium",
  raidSeverityHigh: "High",
  raidSeverityCritical: "Critical",
  raidStatus: "Status",
  raidStatusAll: "All statuses",
  raidStatusOpen: "Open",
  raidStatusMitigated: "Mitigated",
  raidStatusRealized: "Realized",
  raidStatusClosed: "Closed",
  raidStatusPending: "Pending",
  raidStatusValidated: "Validated",
  raidStatusInvalidated: "Invalidated",
  raidStatusInProgress: "In Progress",
  raidStatusResolved: "Resolved",
  raidStatusDelivered: "Delivered",
  raidStatusBlocked: "Blocked",
  raidOwner: "Owner",
  raidTitle: "Title",
  raidDescription: "Description",
  raidMitigation: "Mitigation / resolution plan",
  raidProbability: "Probability",
  raidImpact: "Impact",
  raidRiskMatrix: "Risk matrix (probability × impact)",
  raidRaisedDate: "Raised",
  raidTargetDate: "Target date",
  raidClosedDate: "Closed",
  raidLinkedTasks: "Linked tasks",
  raidAddLinkedTask: "Link task",
  raidLinkPickerPlaceholder: "Type id or task name…",
  raidCreateMitigationTask: "Create mitigation task",
  raidCreateMitigationTaskHint: "Spawns a new task pre-filled from this item and links it back.",
  raidNewItem: "New RAID item",
  raidEditItem: "Editing RAID #{0}",
  raidDelete: "Delete",
  raidConfirmDelete: "Delete this RAID item? This can't be undone.",
  raidReferencedBy: "Referenced by {0} RAID item(s)",
  raidReferencedByMix: "{0}R · {1}A · {2}I · {3}D",
  raidSearchPlaceholder: "Search title, owner, description…",
  raidErrorTitleRequired: "Title is required.",
  raidSave: "Save",
  raidUnlinkTask: "Unlink",
  raidPlaceholderTitle: "What's the risk / assumption / issue / dependency?",
  raidPlaceholderDescription: "Optional — more context for the steering committee",
  raidPlaceholderMitigation: "How will this be mitigated / resolved / validated / delivered?",
  raidCausedBy: "Caused by",
  raidCausedByPlaceholder: "Type id or title of the cause…",
  raidCausedByClear: "Clear cause",
  raidCausedThisCount: "Caused {0} item(s)",
  raidCausedThis: "Items caused by this",
  raidErrorCausedByCycle: "That choice would create a cycle in the cause chain.",
  raidErrorCausedBySelf: "An item can't cause itself.",
  raidAutoCreatedIssue: "Risk #{0} realized — auto-created Issue #{1}.",
  raidAdvancedChangeCategory: "Advanced: change category",
  raidCategoryChangedWarning:
    "Changing the category may reset the status and risk-matrix fields.",
  reportsEmpty: "No tasks yet — add some to see statistics here.",
  reportsTotal: "Total",
  reportsOpen: "Open",
  reportsCompleted: "Completed",
  reportsOverdue: "Overdue",
  reportsOpenByStatus: "Open tasks by status",
  reportsDueSoon: "Due soon (≤3 work days)",
  reportsOnTrack: "On track",
  reportsNoOpen: "No open tasks.",
  reportsCompletionOutcomes: "Completion outcomes",
  reportsCompletedOnTime: "Completed on time",
  reportsCompletedLate: "Completed late",
  reportsNoCompletions: "No tasks have been completed yet.",
  reportsInquiries: "Status inquiries",
  reportsInquiriesTotal: "Total sent",
  reportsInquiriesAvg: "Avg per task with inquiries",
  reportsInquiriesTasks: "Tasks with inquiries",
  reportsInquiriesCol: "Inquiries",
  reportsByAssignee: "By assignee",
  reportsByPriority: "By priority",

  help: "Help",
  helpIntro:
    "List of Open Points Tracker captures open project items, sends status inquiries, surfaces upcoming due dates, and (optionally) syncs both ways with Jira.",
  helpSecAddTitle: "Adding & editing tasks",
  helpSecAddBody:
    "Click the + button in the header to open the New task modal. The same modal opens — pre-filled — when you click Edit on a row. Required fields: Task name, Assignee, Due date. Optional: Email, Group, Labels, Blockers, Notes. You can also ask Claude in the Chat tab (e.g. \"add a task to review the deck due Friday\").",
  helpSecWorkspaceTitle: "Workspace pane",
  helpSecWorkspaceBody:
    "The boxed pane below the header holds the workspace tabs (Chat, Reports, Gantt, RAID, Resources, Activity). Drag its bottom-right corner to resize, click the chevron on the right of the tab strip to collapse / expand, and Reset size to restore the default. Resize and collapsed state both persist across reloads.",
  helpSecTabsTitle: "Tabs",
  helpSecTabsBody:
    "Chat — talk to Claude to view, add, update, and delete tasks in natural language.\nReports — statistics about tasks, assignees, status, inquiries, and on-time / late completions, plus breakdowns by group and label.\nGantt — visual timeline with drag-to-reschedule and FS / SS / FF / SF dependency arrows.\nRAID — register risks, assumptions, issues, and dependencies; link entries to specific tasks.\nResources — capacity calendar with shifts, absences, holidays, and per-day workload.\nActivity — audit log of every task / RAID / resource change in this browser.",
  helpSecTasksTitle: "Tasks list",
  helpSecTasksBody:
    "Sort by clicking column headers. Filter via the search box and the priority / assignee dropdowns. Tick the row checkboxes to multi-select; a bulk-edit bar appears for batch updates. Per-row actions: Mark complete / Reopen, Send inquiry, Push to Jira (when Jira is enabled and the row is unlinked), Edit, Delete. Long notes collapse to the first line — click \"Show more\" to expand. Drag the table's bottom-right corner to resize.",
  helpSecGanttTitle: "Gantt chart",
  helpSecGanttBody:
    "Visual project timeline driven by start / due dates and the predecessor graph. Drag a bar to move it, drag its right edge to extend the due date, and drag the handles to draw a dependency between tasks (FS, SS, FF, SF). Cycles are blocked and flagged. Click a bar to open the task editor. Today line, weekend shading, holiday columns, and per-assignee absences are shaded onto the timeline automatically.",
  helpSecRaidTitle: "RAID register",
  helpSecRaidBody:
    "Track Risks, Assumptions, Issues, and Dependencies in a separate register. Each entry has a category, owner, status, severity, optional links to one or more tasks, and an optional list of \"caused by\" parent RAID items (cross-category allowed; cycles are blocked at edit time). For risks, the probability × impact matrix derives the severity automatically. Task rows with related RAID entries show an indicator — click it to jump straight to the filtered register.",
  helpSecResourcesTitle: "Resources",
  helpSecResourcesBody:
    "Capacity planning for assignees. Toggle between List view (per-assignee stats — open tasks, overdue, upcoming absences, configured shift) and Calendar view (30-day grid of tasks, absences, and holidays per assignee). Add a shift to set someone's hours per weekday; add an absence to block vacation, sick days, training, or other off-time. Resource data lives in the same storage backend as tasks.",
  helpSecActivityTitle: "Activity log",
  helpSecActivityBody:
    "Append-only log of task, RAID, absence, and shift changes in this browser. Sort by time / kind, filter by entity group, and search by text, wildcard (`*`, `?`), or regex. Useful for audit-style review after bulk edits or Jira syncs. The log lives in this browser only — it is never written to any export file — and trims the oldest entries when it exceeds 500. \"Clear log\" asks for confirmation before deleting all entries.",
  helpSecVoiceTitle: "Voice commands",
  helpSecVoiceBody:
    "Click the microphone in the header and try:\n• \"add task review the deck\"\n• \"edit task 2\"\n• \"delete task 3\"\n• \"send inquiry for task 5\"\n• \"search blockers\" / \"clear search\"\n• \"switch to German\"\nIndividual text fields also have an inline microphone for dictation.",
  helpSecNotifTitle: "Due-date notifications",
  helpSecNotifBody:
    "Banner sits between the header and the workspace while any task needs attention. Toast and pop-up fire once per app load if enabled. The bell icon in the header reopens the list anytime, with an unread-count badge. Configure each channel independently in Settings → Notifications.",
  helpSecJiraTitle: "Jira sync",
  helpSecJiraBody:
    "Settings → Jira: paste your Atlassian site URL, email, and API token, pick a project + issue types, and choose an assignee scope. The Sync button next to the tasks list pulls remote changes, pushes local edits, and queues true conflicts in a per-task review dialog. Push to Jira (row action) or the \"Also create in Jira\" checkbox in the task modal creates a brand-new issue. Notes ↔ Jira description sync is lossy — rich formatting flattens to plain text. Jira-managed fields (assignee, status reopen) are locked in the app.",
  helpSecStorageTitle: "Storage",
  helpSecStorageBody:
    "Tasks live in this browser's IndexedDB by default (record-level writes; legacy localStorage data migrates automatically on first load). Switch to a local JSON, CSV, or Markdown file in Settings → Storage to sync with disk (Chrome / Edge / Opera). The browser will ask for write permission on the first save; if it denies, click \"Grant write access\" in Settings. SharePoint backends are coming soon.",
  helpSecAiTitle: "AI chat",
  helpSecAiBody:
    "Add an Anthropic API key in Settings → AI, then accept the consent screen on the Chat tab. Messages and task data are sent directly from your browser to api.anthropic.com — Acme's AI usage policy applies. The key is stored in this browser's localStorage. Claude can list, create, update, and delete tasks on your behalf via tool calls.",
  helpSecKeysTitle: "Keyboard & shortcuts",
  helpSecKeysBody:
    "Esc — close any open modal, popover, or task form.\nEnter in chat — send message. Shift+Enter — newline.\n+ button in header — open the New task modal.\nChevron in the workspace tab strip — collapse / expand the pane.\nClick a tab while collapsed — auto-expands.",
  helpPolicyLink: "Acme AI usage policy",

  version: "Version",
  versionVersion: "Version",
  versionBuild: "Build",
  versionTechStack:
    "Built with Next.js, React, Tailwind CSS, and Titillium Web. Runs entirely client-side; no app backend.",
  versionHighlightsHeader: "Highlights",
  versionHighlightChat: "Claude chat with tool calls — list, add, edit, delete tasks in natural language.",
  versionHighlightVoice: "Voice commands and per-field dictation (browser SpeechRecognition).",
  versionHighlightStorage: "Local JSON / CSV / Markdown files or browser-only storage.",
  versionHighlightJira: "Bidirectional Jira Cloud sync — pull, push, per-task conflict review, create new issues.",
  versionHighlightReports: "Reports with status, assignee, group, label, and on-time / late completion stats.",
  versionHighlightGantt: "Gantt chart with FS / SS / FF / SF task dependencies, drag-to-reschedule, and cycle detection.",
  versionHighlightRaid: "RAID register for risks, assumptions, issues, and dependencies, linked to tasks.",
  versionHighlightResources: "Resource planning with shifts, absences, holidays, and a per-day workload calendar.",
  versionHighlightActivity: "Activity log of every task / RAID / resource change with filtering.",
  versionHighlightContacts: "Persisted contacts address book — assignee + email suggestions survive task deletion and Jira sync churn.",
  versionHighlightExport: "Export to CSV, Markdown, PDF (print), DOCX, XLSX, and PPTX.",
  versionHighlightNotifications: "Configurable due-date banner, toast, and pop-up notifications.",
  versionHighlightWorkspace: "Resizable + collapsible workspace, resizable tasks table, persisted across reloads.",
  versionHighlightSecurity: "Per-request Content-Security-Policy nonce with strict script + style directives; no inline-script bypass.",
  versionHighlightPerformance: "Faster startup and lower memory use via lazy-loaded modules (DOCX/XLSX/PPTX export, German UI, holiday calendars) and IndexedDB record-level storage.",

  group: "Group",
  labels: "Labels",
  placeholderGroup: "e.g. Project Alpha",
  labelsPlaceholder: "Type a label and press Enter",
  labelsAtCap: "Label limit reached",

  depDependencies: "Dependencies",
  depRelations: "Relations",
  depDependsOn: "Depends on",
  depAdd: "Add",
  depRemove: "Remove",
  depType: "Dependency type",
  depPickTask: "Predecessor task",
  depPickTaskPlaceholder: "Select a predecessor task…",
  depMissing: "missing",
  depHelp:
    "Link this task to a predecessor. FS — predecessor finishes before this task starts (most common). SS — both can start together. FF — both can finish together. SF — predecessor starts before this task finishes (rare).",
  depTypeFsShort: "Finish-to-Start",
  depTypeSsShort: "Start-to-Start",
  depTypeFfShort: "Finish-to-Finish",
  depTypeSfShort: "Start-to-Finish",
  depTypeFsHelp:
    "Finish-to-Start: this task can start once the predecessor finishes.",
  depTypeSsHelp:
    "Start-to-Start: this task can start once the predecessor starts.",
  depTypeFfHelp:
    "Finish-to-Finish: this task can finish once the predecessor finishes.",
  depTypeSfHelp:
    "Start-to-Finish: this task can finish once the predecessor starts.",

  contactsRemove: "Forget this contact",
  allGroups: "All groups",
  groupNone: "No group",
  allLabels: "All labels",
  reportsByGroup: "By group",
  reportsByLabel: "By label",
  reportsNoGroups: "No tasks have a group assigned.",
  reportsNoLabels: "No tasks have labels assigned.",

  comboAddNew: "Add \"{0}\"",
  comboToggle: "Show options",

  jiraIntegration: "Jira integration",
  jiraStatusOn: "enabled",
  jiraStatusOff: "off",
  jiraEnable: "Enable Jira sync",
  jiraSiteUrl: "Site URL",
  jiraEmail: "Atlassian account email",
  jiraApiToken: "API token",
  jiraApiTokenLink: "Create an API token",
  jiraTest: "Test connection",
  jiraTesting: "Testing…",
  jiraConnectedAs: "Connected as {0}",
  jiraProject: "Project",
  jiraPickProject: "pick a project",
  jiraCurrentProject: "Current: {0} ({1})",
  jiraIssueTypes: "Issue types to import",
  jiraAssignee: "Assignee scope",
  jiraAssignee_currentUser: "Current user",
  jiraAssignee_any: "Any",
  jiraAssignee_specific: "Specific user",
  jiraUserSearch: "Type to search users…",
  jiraAssigneeSelected: "Selected: {0}",
  jiraReset: "Reset Jira configuration",
  jiraNote:
    "Credentials are stored only in this browser. Requests are proxied through the local Next.js server to api.atlassian.com — Jira blocks direct browser calls.",
  jiraSync: "Sync with Jira",
  jiraSyncing: "Syncing…",
  jiraSyncNoScope:
    "Pick a project in Settings → Jira integration before syncing.",
  jiraSyncDone: "Synced {0} issue(s) from Jira — {1} new, {2} updated.",
  jiraSyncDoneFull:
    "Synced {0} issue(s): {1} new, {2} pulled, {3} pushed.",
  jiraSyncConflicts:
    "{0} conflict(s) — remote won; check those tasks.",
  jiraSyncFailed: "Jira sync failed: {0}",
  jiraPushFailed: "Could not push {0}: {1}",
  jiraReopenForbidden:
    "This task is linked to {0}. Reopening must be done in Jira — the workflow transition isn't available from this app.",
  jiraAssigneeForbidden:
    "Assignee for {0} is managed in Jira. Change it in Jira and re-sync to update locally.",
  jiraManagedHint: "Managed by Jira — change in Jira",
  jiraBulkAssigneeBlocked:
    "Assignee can't be bulk-edited because {0} selected task(s) are linked to Jira. Unselect them or change assignees in Jira.",

  completed: "Completed",
  jiraSyncConflictsReview:
    "{0} conflict(s) need review — opening dialog.",
  jiraConflictTitle: "Resolve Jira sync conflicts",
  jiraConflictSubtitle:
    "{0} task(s) changed on both sides since the last sync. Pick which value to keep per field. Assignee is always pulled from Jira.",
  jiraConflictQuickPicks: "Apply to all:",
  jiraConflictAllLocal: "Keep local everywhere",
  jiraConflictAllRemote: "Take remote everywhere",
  jiraConflictField: "Field",
  jiraConflictLocal: "Local (this app)",
  jiraConflictRemote: "Remote (Jira)",
  jiraConflictApply: "Apply choices",
  jiraConflictDefer: "Defer (resolve later)",
  jiraConflictResolved:
    "Resolved {0} conflict(s) — {1} pulled, {2} pushed.",
  jiraPushToJira: "Push to Jira",
  jiraPushing: "Pushing…",
  jiraCreateOnSubmit: "Also create this in Jira ({0} — {1})",
  jiraPushedToast:
    "Created {0} in Jira as {1}. Assignee wasn't pushed — set it in Jira.",
  jiraPushPrereq:
    "Enable Jira and pick a project in Settings before pushing tasks.",

  tabActivity: "Activity",
  activityEmpty: "No activity recorded yet.",
  activityClear: "Clear log",
  activityCount: "{0} entries",
  activityTaskCreated: "Task #{0} created: {1}",
  activityTaskUpdated: "Task #{0} updated: {1}",
  activityTaskDeleted: "Task #{0} deleted: {1}",
  activityTaskCompleted: "Task #{0} marked complete: {1}",
  activityTaskReopened: "Task #{0} reopened: {1}",
  activityRaidCreated: "RAID #{0} created ({1}): {2}",
  activityRaidUpdated: "RAID #{0} updated ({1}): {2}",
  activityRaidDeleted: "RAID #{0} deleted ({1}): {2}",
  activityRaidStatusChanged: "RAID #{0} status: {1} → {2}",
  activityRaidAutoIssue: "Risk #{0} realized — auto-created Issue #{1}",
  activityBulkEdit: "Bulk edit applied to {0} task(s)",
  activityBulkInquiries: "Bulk inquiries sent for {0} task(s)",
  activityJiraSync: "Jira sync: {0} pulled, {1} pushed, {2} conflict(s)",
  activityHeaderWhen: "When",
  activityHeaderKind: "Kind",
  activityHeaderMessage: "Message",
  activityFilterAll: "All",
  activityFilterTasks: "Tasks",
  activityFilterRaid: "RAID",
  activityFilterBulk: "Bulk",
  activityFilterJira: "Jira",
  activitySearchPlaceholder: "Search (text, wildcards, or regex)…",
  activitySearchLiteral: "Text",
  activitySearchWildcard: "Wildcard",
  activitySearchRegex: "Regex",
  activitySearchInvalidRegex: "Invalid regex",
  activityNoMatches: "No entries match the filters.",
  popoutOpenInNewWindow: "Open in new window",
  popoutReuseWindow: "Reuse popout window",
  tabResources: "Resources",
  resourcesEmpty: "No tasks have been assigned to anyone yet.",
  resourcesOpenTasks: "Open",
  resourcesOverdueTasks: "Overdue",
  resourcesUpcomingAbsences: "Upcoming absences",
  resourcesAbsenceCount: "{0} absence(s)",
  resourcesAddAbsence: "+ Add absence",
  absenceNewItem: "New absence",
  absenceEditItem: "Editing absence #{0}",
  absenceAssignee: "Assignee",
  absenceAssigneeEmail: "Email",
  absenceStart: "Start",
  absenceEnd: "End",
  absenceType: "Type",
  absenceNote: "Note",
  absenceTypeVacation: "Vacation",
  absenceTypeSick: "Sick",
  absenceTypeTraining: "Training",
  absenceTypeOther: "Other",
  absencePlaceholderAssignee: "Name (matches existing Task assignees)",
  absencePlaceholderNote: "Optional — context for the team",
  absenceErrorRequired: "Assignee, start, and end are required.",
  absenceErrorEndBeforeStart: "End date cannot be before start date.",
  absenceConfirmDelete: "Delete this absence? This cannot be undone.",
  absenceSave: "Save",
  activityAbsenceCreated: "Absence #{0} created for {1}: {2} – {3}",
  activityAbsenceUpdated: "Absence #{0} updated for {1}: {2} – {3}",
  activityAbsenceDeleted: "Absence #{0} deleted for {1}",
  resourcesViewList: "List",
  resourcesViewCalendar: "Calendar",
  resourcesToday: "Today",
  resourcesHoliday: "Holiday",
  resourcesEditShift: "Edit shift",
  resourcesWeeklyHours: "Hours/week",
  resourcesDefaultShift: "Default (Mon–Fri 8h)",
  shiftNewItem: "New shift",
  shiftEditItem: "Editing shift #{0}",
  shiftAssignee: "Assignee",
  shiftAssigneeEmail: "Email",
  shiftHoursPerDay: "Hours per weekday",
  shiftDaySun: "Sun",
  shiftDayMon: "Mon",
  shiftDayTue: "Tue",
  shiftDayWed: "Wed",
  shiftDayThu: "Thu",
  shiftDayFri: "Fri",
  shiftDaySat: "Sat",
  shiftNote: "Note",
  shiftPlaceholderAssignee: "Name (matches existing Task assignees)",
  shiftPlaceholderNote: "Optional — context for the team",
  shiftErrorAssigneeRequired: "Assignee is required.",
  shiftErrorAssigneeAlreadyHasShift:
    "That assignee already has a shift — edit the existing one instead.",
  shiftErrorHourRange: "Hours must be between 0 and 24.",
  shiftConfirmDelete: "Delete this shift? This cannot be undone.",
  shiftSave: "Save",
  activityShiftCreated: "Shift #{0} created for {1}",
  activityShiftUpdated: "Shift #{0} updated for {1}",
  activityShiftDeleted: "Shift #{0} deleted for {1}",
  taskDueDateAbsenceWarning:
    "Note: {0} is on {1} from {2} to {3}.",
  resourcesWorkdayHours: "Hours per work day",
  resourcesUnassignedRole: "no role",

  rolesManageTitle: "Roles & rates",
  rolesRateCard: "Rate card",
  rolesDiscipline: "Discipline",
  rolesGrade: "Grade",
  rolesInternalRate: "Internal /h",
  rolesExternalRate: "External /h",
  rolesAddCombo: "Add role",
  rolesAddDiscipline: "Add discipline",
  rolesAddGrade: "Add grade",
  rolesNoRoles: "No roles yet — add a discipline × grade combination.",
  resourcesManageRoles: "Manage roles",
  resourcesOpenReport: "Report",
  resourcesViewPlanning: "Planning",
  resourcesCapacityDays: "Capacity (days)",
  resourcesPlanStart: "From",
  resourcesPlanEnd: "To",
  resourcesGranularityWeek: "Weeks",
  resourcesGranularityMonth: "Months",
  resourcesInternalCost: "Internal",
  resourcesExternalCost: "External",
  resourcesMargin: "Margin",
  resourcesTotal: "Total",
  resourcesAbsenceOverrideHint: "Absence h (auto if blank)",

  resourcesReportTitle: "Resource report",
  resourcesReportTotalCapacity: "Total capacity",
  resourcesReportByPeriod: "By period",
  resourcesReportByDiscipline: "By discipline",
  resourcesReportByGrade: "By grade",
  resourcesReportByCombo: "By role",
  resourcesReportByResource: "By resource",
  resourcesReportHeadcount: "People",
  resourcesReportAvgUtil: "Avg util.",
  resourcesReportEmpty: "No resources to report.",
  resourcesRole: "Role",
  resourcesRollupShow: "Show rollup",
  resourcesRollupHide: "Hide rollup",

  resourcesViewDirectory: "Directory",
  resourcesViewWorkload: "Workload",
  resourcesAddResource: "+ Add resource",
  resourceColTitle: "Title",
  resourceColDepartment: "Department",
  resourceColPhone: "Phone",
  resourceColBirthday: "Birthday",

  resourceNewTitle: "New resource",
  resourceEditTitle: "Edit resource",
  resourceFirstName: "First name",
  resourceLastName: "Last name",
  resourceJobTitle: "Title",
  resourceCompany: "Company",
  resourceDepartment: "Department",
  resourceLocation: "Location",
  resourcePhone: "Business phone",
  resourceEmail: "Email",
  resourceBirthday: "Birthday",
  resourceBirthdayMonth: "Month",
  resourceBirthdayDay: "Day",
  resourceNotes: "Notes",
  resourceSave: "Save resource",
  resourceConfirmDelete: "Delete this resource?",
  resourceErrorName: "Enter a first or last name.",

  resourcesUnlinked: "Unlinked",
  resourcesUnlinkedHint: "Not in the address book",
  resourcesAddAsResource: "Add as resource",

  resourcesAddressBookTitle: "Address Book",
  resourcesOpenAddressBook: "Open address book",

  notifBirthday: "Birthday reminders",
  birthdayLeadDays: "Days ahead",
  birthdayBannerAria: "Upcoming birthdays",
  birthdayBannerTitle: "{0} upcoming birthday(s)",
  birthdayToday: "today",
  birthdayInDays: "in {0}d",
  birthdayToast: "🎂 {0} upcoming birthday(s)",
} as const;

export type TranslationKey = keyof typeof enUS;

// en-GB currently mirrors en-US. Switching the language still updates
// document.documentElement.lang, which affects date input formatting.
const enGB: Record<TranslationKey, string> = { ...enUS };

// The de dictionary lives in `./i18n.de` and is loaded on demand via
// `loadI18n("de")`. Until loaded, `t("de", key)` falls back to en-US so
// the UI never renders raw translation keys. Callers that care about a
// flash-of-English (the page-mount path in task-manager.tsx) should
// `await loadI18n(lang)` before first content paint.
let activeDeDict: Record<TranslationKey, string> | null = null;
let pendingDeLoad: Promise<void> | null = null;

export function loadI18n(lang: Lang): Promise<void> {
  // en-US and en-GB are baked into this module — nothing to load.
  if (lang !== "de") return Promise.resolve();
  if (activeDeDict) return Promise.resolve();
  if (pendingDeLoad) return pendingDeLoad;
  pendingDeLoad = import("./i18n.de").then((mod) => {
    activeDeDict = mod.de;
  });
  return pendingDeLoad;
}

export function t(
  lang: Lang,
  key: TranslationKey,
  ...args: (string | number)[]
): string {
  let dict: Record<TranslationKey, string>;
  if (lang === "de" && activeDeDict) dict = activeDeDict;
  else if (lang === "en-GB") dict = enGB;
  else dict = enUS;
  let s = dict[key] ?? enUS[key];
  args.forEach((a, i) => {
    s = s.replace(`{${i}}`, String(a));
  });
  return s;
}

export function migrateLang(value: unknown): Lang {
  if (value === "en-US" || value === "en-GB" || value === "de") return value;
  if (value === "en") return "en-US"; // legacy
  return "en-US";
}

/**
 * Localized label for a task priority value. Thin wrapper over `t()` that
 * encodes the convention `priority${Low|Medium|High|Urgent}`.
 */
export function priorityLabel(lang: Lang, p: Priority): string {
  return t(lang, `priority${p}` as TranslationKey);
}
