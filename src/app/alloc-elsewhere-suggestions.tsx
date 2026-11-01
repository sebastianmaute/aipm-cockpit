"use client";

// §785 — in the Plan with AI review window: a person in the proposal whose name equals a person in another project
// is only a SUGGESTION until the user answers; until then their hours there are not counted. Each answer is one
// stored link (`useCrossProjectPeople`). Pure props in; no context. Disabled while the other projects load, because a
// write during a reload would be lost in memory.
import { type Lang, t } from "./i18n";
import { Button } from "./button";
import { type PersonMatch } from "./cross-project/person-match";
import { type CrossProjectPeople } from "./use-cross-project-people";

export interface AllocElsewhereSuggestionsProps {
  lang: Lang;
  crossProject: CrossProjectPeople;
  /** The resource ids the active alternative touches. */
  resourceIds: readonly number[];
  nameOf: (resourceId: number) => string;
  /** True while the window is busy (proposing / applying). */
  busy: boolean;
}

type Relation = PersonMatch["suggestions"][number];

export function AllocElsewhereSuggestions({ lang, crossProject, resourceIds, nameOf, busy }: AllocElsewhereSuggestionsProps) {
  const rows: { id: number; rel: Relation }[] = [];
  for (const id of [...new Set(resourceIds)].sort((a, b) => a - b)) {
    // Only a suggestion that would change the figures: the suggested person has hours in the shown periods.
    for (const rel of crossProject.matches.get(id)?.suggestions ?? []) {
      if (crossProject.suggestionHours(rel) > 0) rows.push({ id, rel });
    }
  }
  if (rows.length === 0) return null;
  const disabled = busy || crossProject.status === "loading";
  const confirm = t(lang, "allocElsewhereConfirm");
  const reject = t(lang, "allocElsewhereReject");
  return (
    <div className="mt-4 border-t border-line pt-3">
      <h3 className="text-xs font-semibold uppercase text-muted-foreground">{t(lang, "allocElsewhereHeading")}</h3>
      <ul className="mt-2 space-y-2">
        {rows.map(({ id, rel }) => {
          const who = `${nameOf(id)} (#${id}) – ${rel.projectName} (#${rel.resourceId})`;
          return (
            <li key={`${id}:${rel.projectId}:${rel.resourceId}`} className="flex flex-wrap items-center gap-2 text-sm text-foreground">
              <span className="min-w-0 flex-1">{t(lang, "allocElsewhereSuggest", nameOf(id), rel.projectName)}</span>
              <Button variant="secondary" size="xs" disabled={disabled} aria-label={`${confirm} – ${who}`} onClick={() => void crossProject.confirm(id, rel)}>
                {confirm}
              </Button>
              <Button variant="secondary" size="xs" disabled={disabled} aria-label={`${reject} – ${who}`} onClick={() => void crossProject.reject(id, rel)}>
                {reject}
              </Button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
