"use client";

import { useId, useMemo, useState } from "react";
import { useCombobox } from "./combobox-shared";
import {
  type SearchResult,
  type SearchResultType,
  type SearchableWorkspace,
  SEARCH_MIN_QUERY,
  searchWorkspace,
} from "./global-search";
import { type Lang, type TranslationKey, t } from "./i18n";
import { useWorkspace } from "./workspace-context";
import { useWorkspaceTab } from "./workspace-tab-context";

/** Map a result type to its i18n type-label key. */
function typeLabelKey(type: SearchResultType): TranslationKey {
  switch (type) {
    case "task":
      return "searchResultTask";
    case "raid":
      return "searchResultRaid";
    case "change":
      return "searchResultChange";
    case "milestone":
      return "searchResultMilestone";
    case "stakeholder":
      return "searchResultStakeholder";
  }
}

interface GlobalSearchBoxProps {
  lang: Lang;
  tasks: SearchableWorkspace["tasks"];
  raid: SearchableWorkspace["raid"];
  changes: SearchableWorkspace["changes"];
  milestones: SearchableWorkspace["milestones"];
  stakeholders: SearchableWorkspace["stakeholders"];
  onSelect: (r: SearchResult) => void;
}

export function GlobalSearchBox({
  lang,
  tasks,
  raid,
  changes,
  milestones,
  stakeholders,
  onSelect,
}: GlobalSearchBoxProps) {
  const [query, setQuery] = useState("");
  const results = useMemo(
    () => searchWorkspace({ tasks, raid, changes, milestones, stakeholders }, query),
    [tasks, raid, changes, milestones, stakeholders, query],
  );

  const { open, setOpen, highlight, rootRef, inputRef, moveHighlight } = useCombobox(
    query,
    results.length,
  );
  const listId = useId();

  // Open when there's at least one match, or when the (free-text) query is long
  // enough to warrant the no-results message. A 1-digit numeric query the engine
  // matched opens via results.length; a 1-char free-text returning [] stays shut.
  const shouldOpen = results.length > 0 || query.trim().length >= SEARCH_MIN_QUERY;
  const isOpen = open && shouldOpen;

  function select(r: SearchResult) {
    onSelect(r);
    setQuery("");
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      moveHighlight(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      moveHighlight(-1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (results.length === 0) return;
      const idx = highlight >= 0 && highlight < results.length ? highlight : 0;
      select(results[idx]);
    } else if (e.key === "Escape") {
      setQuery("");
      setOpen(false);
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-label={t(lang, "searchLabel")}
        placeholder={t(lang, "searchGlobalPlaceholder")}
        aria-expanded={isOpen}
        aria-controls={isOpen && results.length > 0 ? listId : undefined}
        aria-activedescendant={
          isOpen && results.length > 0 && highlight >= 0 ? `${listId}-opt-${highlight}` : undefined
        }
        aria-autocomplete="list"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onKeyDown={onKeyDown}
        className="w-full rounded-md border border-line bg-surface px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-AIPM-dark-blue focus:outline-none focus:ring-1 focus:ring-AIPM-green"
      />
      {isOpen && results.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-30 mt-1 max-h-72 w-full overflow-auto rounded-md border border-line bg-surface pr-2 text-sm"
        >
          {results.map((r, i) => (
            <li
              key={`${r.type}-${r.id}`}
              id={`${listId}-opt-${i}`}
              role="option"
              aria-selected={i === highlight}
              aria-label={`${t(lang, typeLabelKey(r.type))} – ${r.title}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => select(r)}
              className={`flex cursor-pointer flex-col items-start gap-0.5 px-3 py-1.5 text-left ${
                i === highlight
                  ? "bg-surface-muted text-AIPM-dark-blue"
                  : "text-foreground hover:bg-surface-muted"
              }`}
            >
              <span className="flex w-full items-center gap-2">
                <span className="truncate">{r.title}</span>
                <span className="ml-auto shrink-0 rounded border border-line px-1 text-xs text-muted-foreground">
                  {t(lang, typeLabelKey(r.type))}
                </span>
              </span>
              {r.subtitle && (
                <span className="truncate text-xs text-muted-foreground">{r.subtitle}</span>
              )}
            </li>
          ))}
        </ul>
      )}
      {isOpen && results.length === 0 && query.trim().length >= SEARCH_MIN_QUERY && (
        <div className="absolute z-30 mt-1 w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-muted-foreground">
          {t(lang, "searchNoResults")}
        </div>
      )}
    </div>
  );
}

/** Connected wrapper: live workspace slices + deep-link on select. */
export function GlobalSearchConnected({ lang }: { lang: Lang }) {
  const ws = useWorkspace();
  const { requestOpen } = useWorkspaceTab();
  return (
    <GlobalSearchBox
      lang={lang}
      tasks={ws.tasks}
      raid={ws.raid}
      changes={ws.changes}
      milestones={ws.milestones}
      stakeholders={ws.stakeholders}
      onSelect={(r) => requestOpen(r.view, r.id)}
    />
  );
}
