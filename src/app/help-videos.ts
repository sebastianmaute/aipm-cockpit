// The narrated video guides (§715) as Help sees them: each video's YouTube id
// and title, and which Help entries link which videos. Pure and i18n-free —
// `help-content-pane.tsx` renders the links, which open YouTube in the
// browser (a new tab on the web; the desktop shell hands every external
// `target="_blank"` open to the system browser, `decideWindowOpen`).
//
// ★ The video ids and titles mirror `scripts/demo-video/videos.mjs`, which
// records the videos; `scripts/help-videos-catalogue.test.mjs` fails when the
// two lists disagree. The YouTube ids come from the published channel and are
// the one thing no local file can check: re-read them from the channel's
// Videos tab after a video is re-uploaded.

import type { HelpEntryId } from "./help-content";

/** The project's YouTube channel, where every video guide is published. */
export const YOUTUBE_CHANNEL_URL = "https://www.youtube.com/@aipmcockpit";

/** One published video: its YouTube id and its title (English, as on YouTube). */
export interface HelpVideo {
  youtubeId: string;
  title: string;
}

/** Every video guide, keyed by its recorder id (`videos.mjs`). */
export const HELP_VIDEO_CATALOGUE = {
  big: { youtubeId: "zPf-x7WrOgI", title: "A week with the cockpit" },
  "ch1-install": { youtubeId: "7RTinVBf5a8", title: "Install: download and set up the desktop app" },
  "ch2-connect": { youtubeId: "JObv34GIfuE", title: "Get started: connect and create a project" },
  "ch3-monday": { youtubeId: "z_m3BkJiG8E", title: "Monday — a milestone slipped" },
  "ch4-tuesday": { youtubeId: "XmfK-xMx5K8", title: "Tuesday — re-plan" },
  "ch5-wednesday": { youtubeId: "ZB_FNz6d9E4", title: "Wednesday — people" },
  "ch6-thursday": { youtubeId: "5raoa0AojXU", title: "Thursday — risks, stakeholders, money" },
  "ch7-friday": { youtubeId: "vbdI-EO4fn8", title: "Friday — close the week" },
  "ai-proposal": { youtubeId: "TzCeHS9RUs0", title: "Set up a project with Claude" },
  "ai-chat": { youtubeId: "C-efIB43qUM", title: "The AI Assistant" },
  "ai-dedup": { youtubeId: "1hGeKZzreaI", title: "Deduplicate & unify" },
  "ai-wbs": { youtubeId: "-yquYD6hY_Y", title: "Optimize with AI" },
  "ai-inline-task": { youtubeId: "t6RnDmg9UnI", title: "Ask Claude on a task" },
  "ai-inline-entity": { youtubeId: "FFXSDj2UvE8", title: "Ask Claude on RAID, changes, milestones and stakeholders" },
  "ai-next-actions": { youtubeId: "mkMWgVdRRN4", title: "Analyze next actions with AI" },
  "ai-insight": { youtubeId: "oOEOJGTOAic", title: "Insight recommendations" },
  "ai-digest": { youtubeId: "w5eEdIckfWc", title: "The status digest" },
  "ai-alloc": { youtubeId: "JqEd0oesV7w", title: "Plan allocations with AI" },
  "ai-raci": { youtubeId: "lcNbaqOH3ss", title: "Suggest RACI" },
  "ai-steering": { youtubeId: "vGVnoP-oiiw", title: "Draft the steering report" },
  "ai-forecast-import": { youtubeId: "3KCGIDvXxzw", title: "Import a forecast with Claude" },
  "ai-weights": { youtubeId: "UOJxO3e4Qp8", title: "Tune next actions with AI" },
  "ai-scheduled": { youtubeId: "ToeiXsjtGd4", title: "Scheduled AI jobs" },
  "f-open-points": { youtubeId: "gELBe3K9m20", title: "Open points" },
  "f-board": { youtubeId: "0N547TVM8so", title: "The board" },
  "f-swimlanes": { youtubeId: "5T97IAAnJpI", title: "Swimlanes" },
  "f-gantt": { youtubeId: "tCCn6MzgmlQ", title: "The Gantt chart" },
  "f-milestones": { youtubeId: "wNQQzRu03d4", title: "Milestones" },
  "f-changes": { youtubeId: "JJ90fuoLbn0", title: "Changes" },
  "f-directory": { youtubeId: "2eo4Ve99Rts", title: "The resource directory" },
  "f-absences": { youtubeId: "OMPvv7vPqMI", title: "Absences" },
  "f-planning": { youtubeId: "X5Lnn5J5OPE", title: "Planning" },
  "f-workload": { youtubeId: "lGtkzOss1aQ", title: "Workload" },
  "f-raid": { youtubeId: "trEya75N428", title: "RAID" },
  "f-modules": { youtubeId: "PisNSO2p35E", title: "Turn functions on or off" },
  "f-budget": { youtubeId: "3AW70pR8Hd4", title: "Budget" },
  "f-trends": { youtubeId: "VjJI4_vXwyk", title: "Trends" },
  "f-stakeholders": { youtubeId: "PGogytuBHm0", title: "Stakeholders" },
  "f-raci": { youtubeId: "OoD9aW8bZas", title: "RACI" },
  "f-influence": { youtubeId: "CrZHc7NFOP8", title: "The stakeholder map" },
  "f-knowledge": { youtubeId: "facpUKFMfA0", title: "Knowledge" },
  "f-activity": { youtubeId: "X2Q_5_6QTQ0", title: "The activity log" },
  "f-history": { youtubeId: "8ZuvBNIXyaI", title: "Version history" },
} as const satisfies Record<string, HelpVideo>;

export type HelpVideoId = keyof typeof HELP_VIDEO_CATALOGUE;

/** The videos each Help entry links, feature video first, then the AI ones.
 *  An entry absent here links none. Keyed by `HelpEntryId`, so a renamed or
 *  deleted entry fails to typecheck rather than silently losing its links. */
export const HELP_ENTRY_VIDEOS: Partial<Record<HelpEntryId, readonly HelpVideoId[]>> = {
  "concept-milestone": ["f-milestones"],
  "concept-raid": ["f-raid"],
  "concept-change": ["f-changes"],
  "concept-stakeholder": ["f-stakeholders", "f-influence"],
  "concept-raci": ["f-raci", "ai-raci"],
  "concept-budget": ["f-budget"],
  "concept-resource": ["f-planning", "f-workload"],
  "concept-steering": ["ai-steering"],
  "concept-task-status": ["f-board"],
  "concept-baseline": ["f-trends"],
  "concept-knowledge": ["f-knowledge"],
  "workflow-getting-started": ["ch2-connect", "ai-forecast-import"],
  "workflow-end-to-end": ["big"],
  "workflow-plan": ["f-milestones", "f-gantt"],
  "workflow-risk": ["f-raid"],
  "workflow-scope": ["f-changes"],
  "workflow-budget": ["f-budget"],
  "workflow-stakeholders": ["f-stakeholders", "f-influence", "f-raci"],
  "feature-per-project-functions": ["f-modules"],
  "feature-tasks": ["f-open-points", "ai-wbs", "ai-dedup"],
  "feature-task-status": ["f-board", "f-swimlanes"],
  "feature-gantt": ["f-gantt"],
  "feature-raid": ["f-raid"],
  "feature-resources": ["f-directory", "f-absences", "f-planning", "f-workload", "ai-alloc"],
  "feature-steering": ["ai-steering"],
  "feature-activity": ["f-activity"],
  "feature-knowledge": ["f-knowledge"],
  "feature-version-history": ["f-history"],
  "feature-ai": ["ai-chat"],
  "feature-ai-advanced": ["ai-proposal", "ai-next-actions", "ai-weights", "ai-scheduled"],
  "feature-tour": ["big"],
  "feature-projects": ["ai-proposal"],
  "feature-scheduled-reports": ["ai-scheduled"],
  "feature-install": ["ch1-install"],
  "feature-inline-ai-edit": ["ai-inline-task", "ai-inline-entity"],
  "feature-digest": ["ai-digest"],
  "automated-insights": ["ai-insight"],
};

/** The watch-page URL of one video. */
export function youtubeWatchUrl(video: HelpVideo): string {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(video.youtubeId)}`;
}

/** The videos one Help entry links, in display order (none for most entries). */
export function helpEntryVideos(entryId: string): readonly HelpVideo[] {
  const ids = (HELP_ENTRY_VIDEOS as Partial<Record<string, readonly HelpVideoId[]>>)[entryId] ?? [];
  return ids.map((id) => HELP_VIDEO_CATALOGUE[id]);
}
