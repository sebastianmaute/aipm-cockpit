// Pure rail-shape helpers for the Settings navigation. i18n-free and
// React-free so the branch rule is testable without rendering SettingsView
// (which needs five mocked modules just to mount).

/** One navigation entry. `parent` marks it as a child of another entry, which
 *  renders indented and only while its parent's branch is active. Generic over
 *  the id union so the settings rail can pass its own `SectionId`. */
export interface RailEntry<Id extends string> {
  id: Id;
  labelKey: string;
  parent?: Id;
}

/** True when `parentId`'s branch should render its children: either the parent
 *  itself is the active section, or the active section is one of its children.
 *  An id absent from the rail (e.g. the legacy `jira` SectionId, which has no
 *  entry) opens nothing. */
export function isBranchActive<Id extends string>(
  active: Id,
  parentId: Id,
  rail: readonly RailEntry<Id>[],
): boolean {
  if (active === parentId) return true;
  return rail.find((r) => r.id === active)?.parent === parentId;
}
