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
        A diagram showing the browser PWA at the centre connected to: local
        IndexedDB/localStorage, optional Turso cloud DB, Jira via API proxy,
        Microsoft 365 (Graph + MSAL), Timelog via API proxy, and the Anthropic
        AI API.
      </desc>
    </>
  );
}

// Central PWA node
function PwaNode() {
  return (
    <g>
      <rect x="185" y="145" width="130" height="50" rx="8"
        fill="var(--AIPM-dark-blue)" stroke="var(--AIPM-green)" strokeWidth="2" />
      <text x="250" y="166" textAnchor="middle" fill="var(--AIPM-white)"
        fontSize="11" fontWeight="600">Browser app</text>
      <text x="250" y="182" textAnchor="middle" fill="var(--AIPM-green)"
        fontSize="9.5">(this PWA)</text>
    </g>
  );
}

// Local storage node – top-left
function LocalStorageNode() {
  return (
    <g>
      <rect x="20" y="20" width="130" height="50" rx="8"
        fill="var(--AIPM-light-grey)" stroke="var(--AIPM-medium-grey)" strokeWidth="1.5" />
      <text x="85" y="41" textAnchor="middle" fill="var(--AIPM-dark-blue)"
        fontSize="10.5" fontWeight="600">Local storage</text>
      <text x="85" y="57" textAnchor="middle" fill="var(--AIPM-dark-grey)"
        fontSize="9">IndexedDB / localStorage</text>
    </g>
  );
}

// Turso node – top-right
function TursoNode() {
  return (
    <g>
      <rect x="350" y="20" width="130" height="50" rx="8"
        fill="var(--AIPM-light-grey)" stroke="var(--AIPM-medium-grey)" strokeWidth="1.5" />
      <text x="415" y="41" textAnchor="middle" fill="var(--AIPM-dark-blue)"
        fontSize="10.5" fontWeight="600">Turso (libSQL)</text>
      <text x="415" y="57" textAnchor="middle" fill="var(--AIPM-dark-grey)"
        fontSize="9">optional cloud DB</text>
    </g>
  );
}

// Timelog node – top-centre (directly above the PWA)
function TimelogNode() {
  return (
    <g>
      <rect x="185" y="20" width="130" height="50" rx="8"
        fill="var(--AIPM-light-grey)" stroke="var(--AIPM-medium-grey)" strokeWidth="1.5" />
      <text x="250" y="41" textAnchor="middle" fill="var(--AIPM-dark-blue)"
        fontSize="10.5" fontWeight="600">Timelog</text>
      <text x="250" y="57" textAnchor="middle" fill="var(--AIPM-dark-grey)"
        fontSize="9">via /api/timelog proxy</text>
    </g>
  );
}

// Jira node – bottom-left
function JiraNode() {
  return (
    <g>
      <rect x="20" y="280" width="130" height="50" rx="8"
        fill="var(--AIPM-light-grey)" stroke="var(--AIPM-medium-grey)" strokeWidth="1.5" />
      <text x="85" y="301" textAnchor="middle" fill="var(--AIPM-dark-blue)"
        fontSize="10.5" fontWeight="600">Jira</text>
      <text x="85" y="317" textAnchor="middle" fill="var(--AIPM-dark-grey)"
        fontSize="9">via /api/jira proxy</text>
    </g>
  );
}

// Microsoft 365 node – bottom-centre
function M365Node() {
  return (
    <g>
      <rect x="185" y="280" width="130" height="50" rx="8"
        fill="var(--AIPM-light-grey)" stroke="var(--AIPM-medium-grey)" strokeWidth="1.5" />
      <text x="250" y="298" textAnchor="middle" fill="var(--AIPM-dark-blue)"
        fontSize="10.5" fontWeight="600">Microsoft 365</text>
      <text x="250" y="313" textAnchor="middle" fill="var(--AIPM-dark-grey)"
        fontSize="9">Graph API + MSAL</text>
      <text x="250" y="325" textAnchor="middle" fill="var(--AIPM-dark-grey)"
        fontSize="9">SharePoint · Contacts · Calendar</text>
    </g>
  );
}

// Anthropic node – bottom-right
function AnthropicNode() {
  return (
    <g>
      <rect x="350" y="280" width="130" height="50" rx="8"
        fill="var(--AIPM-light-grey)" stroke="var(--AIPM-medium-grey)" strokeWidth="1.5" />
      <text x="415" y="301" textAnchor="middle" fill="var(--AIPM-dark-blue)"
        fontSize="10.5" fontWeight="600">Anthropic API</text>
      <text x="415" y="317" textAnchor="middle" fill="var(--AIPM-dark-grey)"
        fontSize="9">AI Assistant chat</text>
    </g>
  );
}

// Connector arrows between nodes and the central PWA
function Connectors() {
  const lineProps = {
    stroke: "var(--AIPM-medium-grey)",
    strokeWidth: 1.5,
    markerEnd: "url(#arrow)",
    markerStart: "url(#arrow-rev)",
  };
  return (
    <g>
      {/* Local storage ↔ PWA */}
      <line x1="150" y1="45" x2="185" y2="155" {...lineProps} />
      {/* Turso ↔ PWA */}
      <line x1="350" y1="45" x2="315" y2="155" {...lineProps} />
      {/* Timelog ↔ PWA */}
      <line x1="250" y1="70" x2="250" y2="145" {...lineProps} />
      {/* Jira ↔ PWA */}
      <line x1="150" y1="305" x2="185" y2="185" {...lineProps} />
      {/* M365 ↔ PWA */}
      <line x1="250" y1="280" x2="250" y2="195" {...lineProps} />
      {/* Anthropic ↔ PWA */}
      <line x1="350" y1="305" x2="315" y2="195" {...lineProps} />
    </g>
  );
}

function ArrowDefs() {
  return (
    <defs>
      <marker id="arrow" markerWidth="8" markerHeight="8"
        refX="6" refY="3" orient="auto">
        <path d="M0,0 L0,6 L8,3 z" fill="var(--AIPM-medium-grey)" />
      </marker>
      <marker id="arrow-rev" markerWidth="8" markerHeight="8"
        refX="2" refY="3" orient="auto-start-reverse">
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
  const items: Array<{ labelKey: Parameters<typeof t>[1]; descKey: Parameters<typeof t>[1] }> = [
    { labelKey: "infoFlowsLegendLocalLabel", descKey: "infoFlowsLegendLocalDesc" },
    { labelKey: "infoFlowsLegendTursoLabel", descKey: "infoFlowsLegendTursoDesc" },
    { labelKey: "infoFlowsLegendJiraLabel", descKey: "infoFlowsLegendJiraDesc" },
    { labelKey: "infoFlowsLegendM365Label", descKey: "infoFlowsLegendM365Desc" },
    { labelKey: "infoFlowsLegendTimelogLabel", descKey: "infoFlowsLegendTimelogDesc" },
    { labelKey: "infoFlowsLegendAnthropicLabel", descKey: "infoFlowsLegendAnthropicDesc" },
  ];

  return (
    <dl className="mt-4 space-y-1 text-xs text-muted-foreground">
      {items.map(({ labelKey, descKey }) => (
        <div key={labelKey} className="flex gap-2">
          <dt className="min-w-[8rem] font-medium text-foreground">
            {t(lang, labelKey)}
          </dt>
          <dd>{t(lang, descKey)}</dd>
        </div>
      ))}
    </dl>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

export function InformationFlowsSection({ lang }: InformationFlowsSectionProps) {
  return (
    <div className="mb-4">
      <p className="mb-1 text-sm font-medium text-foreground">
        {t(lang, "settingsSectionInformationFlows")}
      </p>
      <p className="mb-4 text-xs text-muted-foreground">
        {t(lang, "infoFlowsIntro")}
      </p>

      <svg
        role="img"
        aria-label={t(lang, "infoFlowsDiagramAriaLabel")}
        viewBox="0 0 500 350"
        width="100%"
        style={{ maxWidth: 500 }}
        xmlns="http://www.w3.org/2000/svg"
      >
        <DiagramTitle />
        <ArrowDefs />
        <Connectors />
        <LocalStorageNode />
        <TursoNode />
        <TimelogNode />
        <PwaNode />
        <JiraNode />
        <M365Node />
        <AnthropicNode />
      </svg>

      <Legend lang={lang} />
    </div>
  );
}
