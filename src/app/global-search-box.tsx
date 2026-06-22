"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { useCombobox } from "./combobox-shared";
import {
  type SearchResult,
  type SearchResultType,
  type SearchableWorkspace,
  SEARCH_MIN_QUERY,
  searchWorkspace,
} from "./global-search";
import { splitHighlight } from "./search-highlight";
import { loadRecents, pushRecent, saveRecents } from "./search-recents";
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
  const [recents, setRecents] = useState<SearchResult[]>(() => loadRecents());
  const results = useMemo(
    () => searchWorkspace({ tasks, raid, changes, milestones, stakeholders }, query),
    [tasks, raid, changes, milestones, stakeholders, query],
  );

  // Only surface recents that still resolve to a live workspace item (a row may
  // have been deleted since it was last visited).
  const recentsToShow = useMemo(() => {
    function existsInWorkspace(r: SearchResult): boolean {
      switch (r.type) {
        case "task":
          return tasks.some((x) => x.id === r.id);
        case "raid":
          return raid.some((x) => x.id === r.id);
        case "change":
          return changes.some((x) => x.id === r.id);
        case "milestone":
          return milestones.some((x) => x.id === r.id);
        case "stakeholder":
          return stakeholders.some((x) => x.id === r.id);
      }
    }
    return recents.filter(existsInWorkspace);
  }, [recents, tasks, raid, changes, milestones, stakeholders]);

  const trimmed = query.trim();
  const showingRecents = trimmed.length === 0;
  // The unified list backing the listbox: recents when the box is empty, else
  // the live search results.
  const items = showingRecents ? recentsToShow : results;

  const { open, setOpen, highlight, rootRef, inputRef, moveHighlight } = useCombobox(
    query,
    items.length,
  );
  const listId = useId();

  // Open when there's at least one match, the (free-text) query is long enough
  // to warrant the no-results message, or the empty box has recents to show.
  const shouldOpen =
    results.length > 0 ||
    trimmed.length >= SEARCH_MIN_QUERY ||
    (trimmed.length === 0 && recentsToShow.length > 0);
  const isOpen = open && shouldOpen;
  const recentsHeaderVisible = isOpen && trimmed.length === 0 && recentsToShow.length > 0;

  // Global focus shortcuts: Cmd/Ctrl+K always; "/" only when no editable element
  // is focused (so it doesn't break typing elsewhere). Touches only the stable
  // inputRef, so empty deps are correct.
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        return;
      }
      if (e.key === "/") {
        const el = document.activeElement as HTMLElement | null;
        const editable =
          !!el &&
          (el.tagName === "INPUT" ||
            el.tagName === "TEXTAREA" ||
            el.tagName === "SELECT" ||
            el.isContentEditable);
        if (!editable) {
          e.preventDefault();
          inputRef.current?.focus();
        }
      }
    }
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function select(r: SearchResult) {
    onSelect(r);
    const next = pushRecent(recents, r);
    setRecents(next);
    saveRecents(next);
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
      if (items.length === 0) return;
      const idx = highlight >= 0 && highlight < items.length ? highlight : 0;
      select(items[idx]);
    } else if (e.key === "Escape") {
      setQuery("");
      setOpen(false);
      inputRef.current?.blur();
    }
  }

  /** Render a label: highlighted segments in query mode, plain for recents. */
  function renderLabel(text: string) {
    if (showingRecents) return text;
    return splitHighlight(text, query).map((seg, i) =>
      seg.match ? (
        <mark key={i} className="rounded-sm bg-AIPM-green/20 text-inherit">
          {seg.text}
        </mark>
      ) : (
        <span key={i}>{seg.text}</span>
      ),
    );
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
        aria-controls={isOpen && items.length > 0 ? listId : undefined}
        aria-activedescendant={
          isOpen && items.length > 0 && highlight >= 0 ? `${listId}-opt-${highlight}` : undefined
        }
        aria-autocomplete="list"
        value={query}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onKeyDown={onKeyDown}
        className="w-full rounded-md border border-line bg-surface px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-AIPM-dark-blue focus:outline-none focus:ring-1 focus:ring-AIPM-green"
      />
      {isOpen && items.length > 0 && (
        <div className="absolute z-30 mt-1 max-h-72 w-full overflow-auto rounded-md border border-line bg-surface pr-2 text-sm">
          {recentsHeaderVisible && (
            <div className="px-3 py-1 text-xs font-medium text-muted-foreground">
              {t(lang, "searchRecent")}
            </div>
          )}
          <ul id={listId} role="listbox">
            {items.map((r, i) => (
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
                  <span className="truncate">{renderLabel(r.title)}</span>
                  <span className="ml-auto shrink-0 rounded border border-line px-1 text-xs text-muted-foreground">
                    {t(lang, typeLabelKey(r.type))}
                  </span>
                </span>
                {r.subtitle && (
                  <span className="truncate text-xs text-muted-foreground">
                    {renderLabel(r.subtitle)}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {isOpen && results.length === 0 && trimmed.length >= SEARCH_MIN_QUERY && (
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
