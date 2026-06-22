// Pure, i18n-free: maps an activity-log kind to the AppView whose editor/list
// it belongs to, for view-level click-through from the dashboard's recent-activity
// list. Returns null for kinds with no deep-linkable destination (bulk/jira/
// absence/shift/resource/role/settings/doc/history) — those rows stay static.
import type { ActivityKind } from "./activity-log";
import type { AppView } from "./nav-config";

export function activityViewOf(kind: ActivityKind): AppView | null {
  if (kind.startsWith("task.")) return "open-points";
  if (kind.startsWith("raid.")) return "raid";
  if (kind.startsWith("milestone.")) return "milestones";
  if (kind.startsWith("change.")) return "changes";
  if (kind.startsWith("stakeholder.")) return "stakeholders";
  return null;
}
