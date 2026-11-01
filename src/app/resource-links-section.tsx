"use client";

// §785 — the person's entry shows where else they work: the other projects they are matched in, the name matches
// still waiting for an answer, and the pairs the user said are not the same. Pure props in (the hook's result);
// nothing renders for a new person or when other projects cannot be seen (status "unavailable"), and then no request
// is made. Opening an existing person asks for a fresh load. Answers are disabled while a load runs, because a write
// during a reload would be lost in memory. A failed write is already toasted by the hook's `onWriteError`.
import { useEffect } from "react";
import { type Lang, t } from "./i18n";
import { Button } from "./button";
import { HelpIconButton } from "./help-icon-button";
import { InfoTooltip } from "./info-tooltip";
import { type CrossProjectPeople } from "./use-cross-project-people";
import { type PersonMatch } from "./cross-project/person-match";

export interface ResourceLinksSectionProps {
  lang: Lang;
  crossProject: CrossProjectPeople;
  resourceId: number;
  /** This person's display name, for the row-unique button names. */
  name: string;
}

type Relation = PersonMatch["suggestions"][number];

export function ResourceLinksSection({ lang, crossProject, resourceId, name }: ResourceLinksSectionProps) {
  const { status, request } = crossProject;
  const unavailable = status === "unavailable";
  useEffect(() => {
    if (!unavailable) request();
  }, [unavailable, request, resourceId]);
  if (unavailable) return null;

  const match = crossProject.matches.get(resourceId);
  const matched = match?.matched ?? [];
  const suggestions = match?.suggestions ?? [];
  const rejected = match?.rejected ?? [];
  const loading = status === "loading";
  const heading = t(lang, "resourceLinksHeading");
  const confirm = t(lang, "resourceLinkConfirm");
  const reject = t(lang, "resourceLinkReject");
  const undoLabel = t(lang, "resourceLinkUndo");
  const other = (rel: Relation): string => crossProject.nameOf(rel.projectId, rel.resourceId);
  // Row-unique: this person, the other person (id too, since names can repeat) and the project.
  const who = (rel: Relation): string => `${name} (#${resourceId}) – ${other(rel)} (#${rel.resourceId}) – ${rel.projectName}`;
  const rowClass = "flex flex-wrap items-center gap-2 text-sm text-foreground";

  return (
    <section className="sm:col-span-2 border-t border-line pt-3" aria-label={heading}>
      <h3 className="flex items-center gap-1 text-xs font-semibold uppercase text-muted-foreground">
        {heading}
        <InfoTooltip text={t(lang, "resourceLinksTip")} label={`${t(lang, "resourceLinksTip")} – ${heading}`} />
        <HelpIconButton lang={lang} conceptId="feature-cross-project-people" dialogTitle={heading} />
      </h3>
      {loading && <p className="mt-2 text-xs text-muted-foreground">{t(lang, "allocElsewhereLoading")}</p>}
      {crossProject.loadFailed && <p className="mt-2 text-xs text-foreground">{t(lang, "allocElsewhereLoadFailed")}</p>}
      {crossProject.failures.length > 0 && (
        <p className="mt-2 text-xs text-foreground">
          {t(lang, "allocElsewhereFailures", crossProject.failures.map((f) => f.projectName).join(", "))}
        </p>
      )}
      <ul className="mt-2 space-y-2">
        {matched.map((rel) => (
          <li key={`m:${rel.projectId}:${rel.resourceId}`} className={rowClass}>
            <span className="min-w-0 flex-1">
              {t(lang, rel.via === "confirmed" ? "resourceWorksInProjectConfirmed" : "resourceWorksInProject", rel.projectName)}
            </span>
            {rel.via === "confirmed" && (
              <Button variant="secondary" size="xs" type="button" disabled={loading} aria-label={`${undoLabel} – ${who(rel)}`}
                onClick={() => void crossProject.undo(resourceId, rel)}>
                {undoLabel}
              </Button>
            )}
            {rel.via === "email" && (
              <Button variant="secondary" size="xs" type="button" disabled={loading} aria-label={`${reject} – ${who(rel)}`}
                onClick={() => void crossProject.reject(resourceId, rel)}>
                {reject}
              </Button>
            )}
          </li>
        ))}
        {suggestions.map((rel) => (
          <li key={`s:${rel.projectId}:${rel.resourceId}`} className={rowClass}>
            <span className="min-w-0 flex-1">{t(lang, "resourceLinkSuggest", other(rel), rel.projectName)}</span>
            <Button variant="secondary" size="xs" type="button" disabled={loading} aria-label={`${confirm} – ${who(rel)}`}
              onClick={() => void crossProject.confirm(resourceId, rel)}>
              {confirm}
            </Button>
            <Button variant="secondary" size="xs" type="button" disabled={loading} aria-label={`${reject} – ${who(rel)}`}
              onClick={() => void crossProject.reject(resourceId, rel)}>
              {reject}
            </Button>
          </li>
        ))}
        {rejected.map((rel) => (
          <li key={`r:${rel.projectId}:${rel.resourceId}`} className={rowClass}>
            <span className="min-w-0 flex-1">{t(lang, "resourceLinkRejected", other(rel), rel.projectName)}</span>
            <Button variant="secondary" size="xs" type="button" disabled={loading} aria-label={`${undoLabel} – ${who(rel)}`}
              onClick={() => void crossProject.undo(resourceId, rel)}>
              {undoLabel}
            </Button>
          </li>
        ))}
      </ul>

    </section>
  );
}
