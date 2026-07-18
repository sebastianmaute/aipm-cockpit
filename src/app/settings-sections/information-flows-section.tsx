"use client";

import { type Lang, t } from "../i18n";
import { FieldHint } from "../field-hint";
import { NodeGraph } from "../node-graph";
import type { NodeGraphNode, NodeGraphEdge, NodeGraphZone } from "../node-graph-layout";

interface InformationFlowsSectionProps {
  lang: Lang;
  /** Cap (px) for the diagram svg width. Default 480 keeps Settings + the
   *  in-pane Help flows tab byte-identical; the in-pane tab passes 720. */
  maxWidth?: number;
}

const DIAGRAM_DESC =
  "A diagram showing the browser app at the centre, grouped into two zones. " +
  "Your data: local IndexedDB/localStorage, project files (JSON / CSV / Markdown) " +
  "and an optional Turso cloud database. Connected services: Jira and Timelog via " +
  "API proxies, SharePoint and Outlook via Microsoft Graph, and the Anthropic AI chat API.";

// Manual hub/zone layout in viewBox units (0 0 480 300).
const NODES: readonly NodeGraphNode[] = [
  { id: "local", label: "Local storage", sub: "IndexedDB", accent: "green", x: 18, y: 40, w: 100, h: 44 },
  { id: "file", label: "File storage", sub: "JSON / CSV / MD", accent: "green", x: 18, y: 96, w: 100, h: 44 },
  { id: "turso", label: "Turso", sub: "cloud DB", accent: "green", x: 18, y: 152, w: 100, h: 44 },
  { id: "hub", label: "Browser app", sub: "(this PWA)", accent: "hub", x: 190, y: 120, w: 100, h: 44 },
  { id: "jira", label: "Jira", accent: "blue", x: 310, y: 40, w: 78, h: 30 },
  { id: "timelog", label: "Timelog", accent: "blue", x: 394, y: 40, w: 78, h: 30 },
  { id: "sharepoint", label: "SharePoint", accent: "blue", x: 310, y: 84, w: 78, h: 30 },
  { id: "outlook", label: "Outlook", accent: "blue", x: 394, y: 84, w: 78, h: 30 },
  { id: "anthropic", label: "Anthropic", sub: "AI chat", accent: "blue", x: 310, y: 140, w: 162, h: 44 },
];

const EDGES: readonly NodeGraphEdge[] = [
  { a: "hub", b: "local", arrow: "both" },
  { a: "hub", b: "file", arrow: "both" },
  { a: "hub", b: "turso", arrow: "both" },
  { a: "hub", b: "jira", arrow: "both" },
  { a: "hub", b: "timelog", arrow: "both" },
  { a: "hub", b: "sharepoint", arrow: "both" },
  { a: "hub", b: "outlook", arrow: "both" },
  { a: "hub", b: "anthropic", arrow: "both" },
];

interface LegendProps {
  lang: Lang;
}

function Legend({ lang }: LegendProps) {
  const items = [
    { labelKey: "infoFlowsLegendLocalLabel", descKey: "infoFlowsLegendLocalDesc" },
    { labelKey: "infoFlowsLegendFileLabel", descKey: "infoFlowsLegendFileDesc" },
    { labelKey: "infoFlowsLegendTursoLabel", descKey: "infoFlowsLegendTursoDesc" },
    { labelKey: "infoFlowsLegendJiraLabel", descKey: "infoFlowsLegendJiraDesc" },
    { labelKey: "infoFlowsLegendTimelogLabel", descKey: "infoFlowsLegendTimelogDesc" },
    { labelKey: "infoFlowsLegendSharePointLabel", descKey: "infoFlowsLegendSharePointDesc" },
    { labelKey: "infoFlowsLegendOutlookLabel", descKey: "infoFlowsLegendOutlookDesc" },
    { labelKey: "infoFlowsLegendAnthropicLabel", descKey: "infoFlowsLegendAnthropicDesc" },
  ] as const;

  return (
    <>
      <div className="mb-2 flex flex-wrap gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-ui-green" aria-hidden="true" />
          {t(lang, "infoFlowsZoneDataLabel")}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-ui-dark-blue" aria-hidden="true" />
          {t(lang, "infoFlowsZoneServicesLabel")}
        </span>
      </div>
      <dl className="space-y-1 text-xs text-muted-foreground">
        {items.map(({ labelKey, descKey }) => (
          <div key={labelKey} className="flex gap-2">
            <dt className="min-w-[8rem] font-medium text-foreground">{t(lang, labelKey)}</dt>
            <dd>{t(lang, descKey)}</dd>
          </div>
        ))}
      </dl>
    </>
  );
}

export function InformationFlowsSection({ lang, maxWidth = 480 }: InformationFlowsSectionProps) {
  const zones: readonly NodeGraphZone[] = [
    { label: t(lang, "infoFlowsZoneDataLabel"), color: "var(--ui-green)", x: 8, y: 20, w: 120, h: 200 },
    { label: t(lang, "infoFlowsZoneServicesLabel"), color: "var(--ui-dark-blue)", x: 300, y: 20, w: 172, h: 200 },
  ];

  return (
    <div className="mb-4">
      <FieldHint className="mb-4">{t(lang, "infoFlowsIntro")}</FieldHint>

      <NodeGraph
        viewBox={{ w: 480, h: 300 }}
        nodes={NODES}
        edges={EDGES}
        zones={zones}
        ariaLabel={t(lang, "infoFlowsDiagramAriaLabel")}
        description={DIAGRAM_DESC}
        maxWidth={maxWidth}
        edgeClassName="stroke-ui-medium-grey"
      />

      <div className="mt-4">
        <Legend lang={lang} />
      </div>
    </div>
  );
}
