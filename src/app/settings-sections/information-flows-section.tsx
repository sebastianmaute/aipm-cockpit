"use client";

import { type Lang, t } from "../i18n";

interface InformationFlowsSectionProps {
  lang: Lang;
}

// ── Diagram sub-components ────────────────────────────────────────────────────

function DiagramTitle() {
  return (
    <>
      <title>Information flows diagram</title>
      <desc>
        A diagram showing the browser app at the centre, grouped into two zones.
        Your data: local IndexedDB/localStorage, project files (JSON / CSV /
        Markdown) and an optional Turso cloud database. Connected services: Jira
        and Timelog via API proxies, SharePoint and Outlook via Microsoft Graph,
        and the Anthropic AI chat API.
      </desc>
    </>
  );
}

// A single node box. accent "green" = data zone, "blue" = service zone,
// "hub" = the central browser-app node (dark-blue fill).
function Node({
  x,
  y,
  w,
  title,
  sub,
  accent,
}: {
  x: number;
  y: number;
  w: number;
  title: string;
  sub?: string;
  accent: "green" | "blue" | "hub";
}) {
  const stroke = accent === "green" ? "var(--AIPM-green)" : "var(--AIPM-dark-blue)";
  const fill = accent === "hub" ? "var(--AIPM-dark-blue)" : "var(--AIPM-white)";
  const titleFill = accent === "hub" ? "var(--AIPM-white)" : "var(--AIPM-dark-blue)";
  const subFill = accent === "hub" ? "var(--AIPM-green)" : "var(--AIPM-dark-grey)";
  const h = sub ? 44 : 30;
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx="7"
        fill={fill}
        stroke={stroke}
        strokeWidth={accent === "hub" ? 2 : 1.5}
      />
      {/* left accent edge (skip on hub) */}
      {accent !== "hub" && <rect x={x} y={y} width="3" height={h} rx="1.5" fill={stroke} />}
      <text
        x={x + w / 2}
        y={y + (sub ? 18 : 19)}
        textAnchor="middle"
        fill={titleFill}
        fontSize="10.5"
        fontWeight="600"
      >
        {title}
      </text>
      {sub && (
        <text x={x + w / 2} y={y + 33} textAnchor="middle" fill={subFill} fontSize="8.5">
          {sub}
        </text>
      )}
    </g>
  );
}

// A dashed group rectangle with an uppercase zone label.
function Zone({
  x,
  y,
  w,
  h,
  label,
  color,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  color: string;
}) {
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx="10"
        fill="none"
        stroke="var(--AIPM-medium-grey)"
        strokeWidth="1"
        strokeDasharray="4 3"
      />
      <text
        x={x + 10}
        y={y + 12}
        fill={color}
        fontSize="9"
        fontWeight="700"
        style={{ textTransform: "uppercase", letterSpacing: "0.5px" }}
      >
        {label}
      </text>
    </g>
  );
}

// Connector lines between the hub and each node (existing arrow markers).
function Connectors() {
  const lineProps = {
    stroke: "var(--AIPM-medium-grey)",
    strokeWidth: 1.5,
    markerEnd: "url(#arrow)",
    markerStart: "url(#arrow-rev)",
  };
  return (
    <g>
      {/* hub left edge (190,142) ↔ data-zone nodes (right edge x=118) */}
      <line x1="190" y1="142" x2="118" y2="62" {...lineProps} />
      <line x1="190" y1="142" x2="118" y2="118" {...lineProps} />
      <line x1="190" y1="142" x2="118" y2="174" {...lineProps} />
      {/* hub right edge (290,142) ↔ service-zone nodes (left edge) */}
      <line x1="290" y1="142" x2="310" y2="55" {...lineProps} />
      <line x1="290" y1="142" x2="394" y2="55" {...lineProps} />
      <line x1="290" y1="142" x2="310" y2="99" {...lineProps} />
      <line x1="290" y1="142" x2="394" y2="99" {...lineProps} />
      <line x1="290" y1="142" x2="310" y2="162" {...lineProps} />
    </g>
  );
}

function ArrowDefs() {
  return (
    <defs>
      <marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
        <path d="M0,0 L0,6 L8,3 z" fill="var(--AIPM-medium-grey)" />
      </marker>
      <marker
        id="arrow-rev"
        markerWidth="8"
        markerHeight="8"
        refX="2"
        refY="3"
        orient="auto-start-reverse"
      >
        <path d="M0,0 L0,6 L8,3 z" fill="var(--AIPM-medium-grey)" />
      </marker>
    </defs>
  );
}

// ── Legend sub-component ──────────────────────────────────────────────────────

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
          <span className="h-2.5 w-2.5 rounded-sm bg-AIPM-green" aria-hidden="true" />
          {t(lang, "infoFlowsZoneDataLabel")}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-AIPM-dark-blue" aria-hidden="true" />
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

// ── Main export ───────────────────────────────────────────────────────────────

export function InformationFlowsSection({ lang }: InformationFlowsSectionProps) {
  return (
    <div className="mb-4">
      <p className="mb-4 text-xs text-muted-foreground">{t(lang, "infoFlowsIntro")}</p>

      <svg
        role="img"
        aria-label={t(lang, "infoFlowsDiagramAriaLabel")}
        viewBox="0 0 480 300"
        width="100%"
        style={{ maxWidth: 480 }}
        xmlns="http://www.w3.org/2000/svg"
      >
        <DiagramTitle />
        <ArrowDefs />

        {/* zones (drawn first, behind nodes) */}
        <Zone
          x={8}
          y={20}
          w={120}
          h={200}
          label={t(lang, "infoFlowsZoneDataLabel")}
          color="var(--AIPM-green)"
        />
        <Zone
          x={300}
          y={20}
          w={172}
          h={200}
          label={t(lang, "infoFlowsZoneServicesLabel")}
          color="var(--AIPM-dark-blue)"
        />

        <Connectors />

        {/* data zone */}
        <Node x={18} y={40} w={100} title="Local storage" sub="IndexedDB" accent="green" />
        <Node x={18} y={96} w={100} title="File storage" sub="JSON / CSV / MD" accent="green" />
        <Node x={18} y={152} w={100} title="Turso" sub="cloud DB" accent="green" />

        {/* hub */}
        <Node x={190} y={120} w={100} title="Browser app" sub="(this PWA)" accent="hub" />

        {/* service zone */}
        <Node x={310} y={40} w={78} title="Jira" accent="blue" />
        <Node x={394} y={40} w={78} title="Timelog" accent="blue" />
        <Node x={310} y={84} w={78} title="SharePoint" accent="blue" />
        <Node x={394} y={84} w={78} title="Outlook" accent="blue" />
        <Node x={310} y={140} w={162} title="Anthropic" sub="AI chat" accent="blue" />
      </svg>

      <div className="mt-4">
        <Legend lang={lang} />
      </div>
    </div>
  );
}
