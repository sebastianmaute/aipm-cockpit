"use client";

// Shared two-pane Help content: a grouped TOC (left) that jumps to grouped
// content sections (right), both filtered by the parent-owned `query`. Used by
// BOTH the in-pane Help view (help-view.tsx) and the floating Help panel
// (help-menu.tsx) so the two surfaces render identically. Presentational: the
// parent owns the search input, tours, relations map, and footer.
import { useEffect, useMemo, useRef, useState } from "react";
import { type Lang, t } from "./i18n";
import { HELP_ENTRIES, HELP_GROUP_ORDER, HELP_GROUP_LABEL } from "./help-content";
import { matchesQuery, highlightSegments } from "./help-search";
import { parseHelpBody, stripHelpMarkers } from "./help-body-markup";
import { navLabelKey, type AppView } from "./nav-config";
import { INTERACTIVE } from "./interaction-styles";

/** DOM id for an entry's content section — shared so the in-pane view's
 *  relations map + deep-link scroll can target sections this component renders. */
export const helpSectionId = (id: string) => `help-sec-${id}`;

function Highlighted({ text, query }: { text: string; query: string }) {
  return (
    <>
      {highlightSegments(text, query).map((seg, k) =>
        seg.match ? (
          <mark key={k} className="bg-ui-green/20 text-inherit">
            {seg.text}
          </mark>
        ) : (
          <span key={k}>{seg.text}</span>
        ),
      )}
    </>
  );
}

export function HelpContentPane({
  lang,
  query,
  onNavigateView,
}: {
  lang: Lang;
  query: string;
  onNavigateView?: (view: AppView) => void;
}) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);

  const groups = useMemo(() => {
    const matched = HELP_ENTRIES.filter((e) =>
      // ★ STRIPPED, not raw: searching the raw body would let a query match
      // `[[` markup that is never rendered.
      matchesQuery(t(lang, e.titleKey), stripHelpMarkers(t(lang, e.bodyKey)), query),
    );
    return HELP_GROUP_ORDER.map((group) => ({
      group,
      entries: matched.filter((e) => e.group === group),
    })).filter((g) => g.entries.length > 0);
  }, [lang, query]);

  // Stable key of the rendered section ids → re-create the observer when the
  // filtered set changes (search). Hoisted scalar avoids the exhaustive-deps
  // "obj.member" rejection.
  const sectionIdsKey = groups.flatMap((g) => g.entries.map((e) => e.id)).join(",");
  useEffect(() => {
    const root = contentRef.current;
    if (!root) return;
    const sections = Array.from(root.querySelectorAll<HTMLElement>("section[id]"));
    if (sections.length === 0) return;
    const obs = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting);
        if (visible.length === 0) return;
        const top = visible.reduce((a, b) => (a.boundingClientRect.top < b.boundingClientRect.top ? a : b));
        const id = top.target.id.replace(/^help-sec-/, "");
        setActiveId(id);
      },
      { root, rootMargin: "0px 0px -70% 0px", threshold: 0 },
    );
    sections.forEach((s) => obs.observe(s));
    return () => obs.disconnect();
  }, [sectionIdsKey]);

  const scrollToSection = (id: string) => {
    setActiveId(id);
    document.getElementById(helpSectionId(id))?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  if (groups.length === 0) {
    return <p className="p-4 text-sm text-muted-foreground">{t(lang, "helpNoResults")}</p>;
  }

  return (
    <div className="@container flex min-h-0 flex-1 flex-col overflow-hidden print:block print:overflow-visible">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden @[560px]:flex-row print:block print:overflow-visible">
      {/* Grouped TOC: horizontal scroll strip when narrow, sticky sidebar when wide */}
      <nav
        aria-label={t(lang, "helpContents")}
        className="flex shrink-0 flex-row gap-2 overflow-x-auto border-b border-line p-2 @[560px]:w-56 @[560px]:min-w-[10rem] @[560px]:max-w-[24rem] @[560px]:flex-col @[560px]:gap-0 @[560px]:resize-x @[560px]:overflow-auto @[560px]:border-b-0 @[560px]:border-r @[560px]:p-3 print:hidden"
      >
        {groups.map(({ group, entries }) => (
          <div key={group} className="shrink-0 @[560px]:mb-3 @[560px]:shrink">
            <p className="px-2 pb-0.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {t(lang, HELP_GROUP_LABEL[group])}
            </p>
            <ul className="flex flex-row gap-0.5 @[560px]:flex-col">
              {entries.map((e) => (
                <li key={e.id}>
                  <button
                    type="button"
                    onClick={() => scrollToSection(e.id)}
                    className={
                      activeId === e.id
                        ? `block w-full whitespace-nowrap rounded border-l-2 border-ui-dark-blue bg-surface-muted px-2 py-1.5 text-left text-sm font-semibold text-ui-dark-blue dark:text-ui-light-grey ${INTERACTIVE}`
                        : `block w-full whitespace-nowrap rounded border-l-2 border-transparent px-2 py-1.5 text-left text-sm text-muted-foreground hover:bg-surface-muted hover:text-foreground ${INTERACTIVE}`
                    }
                  >
                    {t(lang, e.titleKey)}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      {/* Grouped content */}
      <div ref={contentRef} className="min-h-0 flex-1 overflow-auto bg-surface-muted p-3 pr-2 print:max-h-none print:overflow-visible">
        {groups.map(({ group, entries }) => (
          <div key={group} className="mb-8">
            <h2 className="mb-2 border-b border-line pb-1 text-xs font-semibold uppercase tracking-wide text-ui-dark-blue dark:text-ui-light-grey">
              {t(lang, HELP_GROUP_LABEL[group])}
            </h2>
            <div className="flex flex-col gap-3">
              {entries.map((e) => (
                <section key={e.id} id={helpSectionId(e.id)} className="scroll-mt-2 rounded-lg border border-line border-l-[3px] border-l-ui-dark-blue bg-surface p-4">
                  <h3 className="mb-1 text-sm font-semibold text-foreground">
                    <Highlighted text={t(lang, e.titleKey)} query={query} />
                  </h3>
                  <p className="max-w-[64ch] whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
                    {/* ★ Segments, not one string: a label renders emphasised
                        against the muted body. `Highlighted` runs PER segment,
                        so a search term spanning a label boundary matches (the
                        search body is stripped) but highlights only within its
                        own segment. Accepted — see the spec. */}
                    {parseHelpBody(t(lang, e.bodyKey)).map((seg, i) =>
                      seg.isLabel ? (
                        <span key={i} className="font-medium text-foreground">
                          <Highlighted text={seg.text} query={query} />
                        </span>
                      ) : (
                        <Highlighted key={i} text={seg.text} query={query} />
                      ),
                    )}
                  </p>
                  {(e.relatedConcepts?.length ?? 0) > 0 || (e.relatedViews?.length ?? 0) > 0 ? (
                    <p className="mt-1.5 text-xs text-muted-foreground">
                      <span className="font-medium">{t(lang, "helpRelated")}:</span>{" "}
                      {e.relatedConcepts?.map((rid, idx) => {
                        const target = HELP_ENTRIES.find((x) => x.id === rid);
                        if (!target) return null;
                        return (
                          <span key={rid}>
                            {idx > 0 ? ", " : ""}
                            <button
                              type="button"
                              onClick={() => scrollToSection(rid)}
                              className={`text-ui-dark-blue underline-offset-2 hover:underline dark:text-ui-light-grey ${INTERACTIVE}`}
                            >
                              {t(lang, target.titleKey)}
                            </button>
                          </span>
                        );
                      })}
                      {e.relatedViews?.map((v) =>
                        onNavigateView ? (
                          <button
                            key={v}
                            type="button"
                            onClick={() => onNavigateView(v)}
                            aria-label={t(lang, "helpRelationsGoToView", t(lang, navLabelKey(v)))}
                            className={`ml-2 italic text-ui-dark-blue underline-offset-2 hover:underline dark:text-ui-light-grey ${INTERACTIVE}`}
                          >
                            {t(lang, navLabelKey(v))}
                          </button>
                        ) : (
                          <span key={v} className="ml-2 italic">
                            {t(lang, navLabelKey(v))}
                          </span>
                        ),
                      )}
                    </p>
                  ) : null}
                </section>
              ))}
            </div>
          </div>
        ))}
      </div>
      </div>
    </div>
  );
}
