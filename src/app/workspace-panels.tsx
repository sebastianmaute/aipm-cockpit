"use client";
// Lazily-loaded (ssr:false) workspace view panels, kept off the main bundle.
// Rendered by workspace-section.tsx. Each shows a PanelSkeleton while its chunk
// loads so the first visit to a view shimmers into place instead of flashing
// blank. The fallback is prop-less (no `lang` in this module scope) → decorative.
import dynamic from "next/dynamic";
import { useMemo } from "react";
import { PanelSkeleton } from "./skeleton";
import { useWorkspace } from "./workspace-context";
import { useSettings } from "./use-settings";
import { useResizable } from "./use-resizable";
import { VIEW_PANE_RESIZABLE_CLASS } from "./view-styles";
import { getTursoConfig } from "./turso-config";
import { ASSET_PARTITION_FALLBACK } from "./document-assets-schema";
import { loadPortfolioMode, loadCurrentTursoProjectId } from "./portfolio-mode";
import { loadRegistry } from "./projects-registry";
import { isSafeMode } from "./safe-mode";
import type { Lang } from "./i18n";

const loading = () => <PanelSkeleton />;

export const ChatPanel = dynamic(
  () => import("./chat-panel").then((m) => m.ChatPanel),
  { ssr: false, loading },
);
export const PortfolioHealthPanel = dynamic(
  () => import("./portfolio-health-panel").then((m) => m.PortfolioHealthPanel),
  { ssr: false, loading },
);
export const GanttView = dynamic(
  () => import("./gantt-view").then((m) => m.GanttView),
  { ssr: false, loading },
);
export const ReportsPanel = dynamic(
  () => import("./reports").then((m) => m.ReportsPanel),
  { ssr: false, loading },
);
export const RaidPanel = dynamic(
  () => import("./raid-panel").then((m) => m.RaidPanel),
  { ssr: false, loading },
);
export const ResourcesPanel = dynamic(
  () => import("./resources-panel").then((m) => m.ResourcesPanel),
  { ssr: false, loading },
);
export const ActivityLogPanel = dynamic(
  () => import("./activity-log-panel").then((m) => m.ActivityLogPanel),
  { ssr: false, loading },
);
export const ResourcesReportPanel = dynamic(
  () => import("./resources-report").then((m) => m.ResourcesReportPanel),
  { ssr: false, loading },
);
export const RaidReportPanel = dynamic(
  () => import("./raid-report-panel").then((m) => m.RaidReportPanel),
  { ssr: false, loading },
);
export const ChangePanel = dynamic(
  () => import("./change-panel").then((m) => m.ChangePanel),
  { ssr: false, loading },
);
export const ChangeReportPanel = dynamic(
  () => import("./change-report-panel").then((m) => m.ChangeReportPanel),
  { ssr: false, loading },
);
export const StakeholdersPanel = dynamic(
  () => import("./stakeholders-panel").then((m) => m.StakeholdersPanel),
  { ssr: false, loading },
);
export const RaciPanel = dynamic(
  () => import("./raci-panel").then((m) => m.RaciPanel),
  { ssr: false, loading },
);
export const StakeholderMapPanel = dynamic(
  () => import("./stakeholder-map-panel").then((m) => m.StakeholderMapPanel),
  { ssr: false, loading },
);
export const BudgetPanel = dynamic(
  () => import("./budget-panel").then((m) => m.BudgetPanel),
  { ssr: false, loading },
);
export const BudgetReportPanel = dynamic(
  () => import("./budget-report-panel").then((m) => m.BudgetReportPanel),
  { ssr: false, loading },
);
export const TrendsPanel = dynamic(
  () => import("./trends-panel").then((m) => m.TrendsPanel),
  { ssr: false, loading },
);
export const HistoryPanel = dynamic(
  () => import("./history-panel").then((m) => m.HistoryPanel),
  { ssr: false, loading },
);
export const ProjectsPanel = dynamic(
  () => import("./projects-panel").then((m) => m.ProjectsPanel),
  { ssr: false, loading },
);
export const ActionsPanel = dynamic(
  () => import("./actions-panel").then((m) => m.ActionsPanel),
  { ssr: false, loading },
);
export const InsightsPanel = dynamic(
  () => import("./insights-panel").then((m) => m.InsightsPanel),
  { ssr: false, loading },
);
export const KnowledgePanel = dynamic(
  () => import("./knowledge-panel").then((m) => m.KnowledgePanel),
  { ssr: false, loading },
);
export const TimelogPanel = dynamic(
  () => import("./timelog-panel").then((m) => m.TimelogPanel),
  { ssr: false, loading },
);
const DocumentsPanelLazy = dynamic(
  () => import("./documents-panel").then((m) => m.DocumentsPanel),
  { ssr: false, loading },
);

/** The Documents tabpanel, state and all.
 *
 *  ★ It owns its own `useWorkspace()` read rather than taking threaded props so
 *  the view router in workspace-section.tsx stays ONE line — that file is a
 *  baselined 963 in the size ratchet, and a per-view render block there costs
 *  ~20 lines of irreducible growth. Reading context here is free: this subtree
 *  is not memoized (the memo caveat applies to `ResourcesPanel` alone).
 *
 *  ★★ The whole context value is passed as `ws` deliberately. It is structurally
 *  a SUPERSET of `Workspace`, and the preview resolves `dataSection` blocks
 *  against every key in `EXPORT_SECTION_KEYS` — so hand-assembling an object
 *  here would be a second place to remember a new slice, failing SILENTLY as an
 *  empty section. Passing the context carries a new slice for free. */
export function DocumentsTabPanel({
  className,
  lang,
  isPopout,
  allowDestructiveSave,
}: {
  className: string;
  lang: Lang;
  isPopout: boolean;
  /** Threaded straight through to `DocumentsPanel` — see its own docstring. */
  allowDestructiveSave?: () => void;
}) {
  const ws = useWorkspace();
  // ★★ The asset library's Turso gate. Mirrors workspace-section.tsx's
  // `chatTursoConfig` pattern exactly (see AGENTS.md's AI Assistant sidebar
  // bullet): `getTursoConfig` returns a FRESH object every call, so the
  // `useMemo` on the credential STRINGS (not the settings object) is
  // load-bearing — an unstable identity would re-fire useDocumentAssets'
  // dangling-diff effect on every render. Hoisted to locals because
  // exhaustive-deps rejects an `obj.member` dependency.
  const { settings } = useSettings();
  const tursoUrl = settings.integrations?.turso?.databaseUrl;
  const tursoToken = settings.integrations?.turso?.authToken;
  //
  // ★★★ SAFE MODE REFUSES TO OPERATE — it must never silently RE-PARTITION the
  // byte store. Both Turso readers below FORCE a degraded value under `?safe=1`
  // (portfolio-mode.ts: `loadPortfolioMode` returns "file" and
  // `loadCurrentTursoProjectId` returns null), while `loadRegistry()` carries no
  // such guard. So without this gate a Turso-portfolio user entering Safe Mode
  // would swap the byte-lookup key to the FILE registry's project id (or
  // `ASSET_PARTITION_FALLBACK`) while the METADATA — which rides the workspace,
  // not this key —
  // stayed put: every asset reads as dangling, every embedded image breaks, and
  // an upload writes bytes under a key normal-mode boot never looks at.
  // `deleteAllAssetDataForProject` is keyed the same way, so those orphans would
  // then survive project deletion too.
  //
  // ★★ STABILISING THE KEY INSTEAD IS INCOHERENT, NOT MERELY UGLY. Safe Mode
  // also boots settings at `defaultStorageConfig` (`kind: "browser"`), so the
  // metadata half comes from the BROWSER backend whatever this key says. No
  // project id makes the two halves agree, and reconstructing the real one by
  // reading MODE_KEY/CURRENT_TURSO_PROJECT_KEY raw would defeat, from inside a
  // view component, the guards portfolio-mode.ts exists to apply. Disabling is
  // the only sound answer, and a null `tursoConfig` is already exactly that
  // (documents-asset-section.tsx's `enabled` gate) — no new state, and it
  // cannot move or rewrite a byte.
  //
  // ★★ Safe Mode ALSO defaulting `settings.integrations` does not make this
  // redundant: NEXT_PUBLIC_TURSO_DATABASE_URL takes PRECEDENCE over the settings
  // value in `getTursoConfig` whenever it is USABLE (an unusable one falls
  // through to settings instead — §337), so an env-configured deployment
  // returns a non-null config from default settings alone. That is the reachable path this gate closes, and the one a test that
  // leans on the settings coupling would pass vacuously.
  const safeMode = isSafeMode();
  const assetsTursoConfig = useMemo(
    () => (safeMode ? null : getTursoConfig(tursoUrl, tursoToken)),
    [safeMode, tursoUrl, tursoToken],
  );
  // ★★ Project id scoping the asset byte store's `(id, project_id)` rows.
  // `DocumentsTabPanel` has no `currentProjectId` PROP — workspace-section.tsx
  // is baselined at exactly 1000 lines with zero headroom, so it cannot be
  // threaded through — so this reads the SAME two sources task-manager.tsx's
  // `landingProjectId` combines, directly: Turso portfolio mode's
  // last-selected project id, or the file registry's current entry. Read
  // fresh each render (no effect) — synchronous localStorage reads in render
  // are pure and this repo already relies on that elsewhere.
  // ★ That expression is only TRUSTWORTHY because of the gate above: it is
  // consumed solely alongside a non-null `tursoConfig`, and Safe Mode — the one
  // state in which its two inputs disagree about which portfolio is loaded —
  // forces that config to null. Do not reuse it anywhere that lacks the gate.
  const assetsProjectId =
    loadPortfolioMode() === "turso"
      ? (loadCurrentTursoProjectId() || ASSET_PARTITION_FALLBACK)
      : (loadRegistry().currentProjectId || ASSET_PARTITION_FALLBACK);
  // ★★ The RESIZABLE PANE, and the reason the reset-size control is not a lie.
  // The toolbar has always drawn one, but `onResetSize` was optional, the panel
  // fell back to a no-op, and this call site never passed it — so the button
  // was inert AND there was nothing resizable behind it. The pane lives HERE
  // rather than inside the lazy panel so the storage key and the reset handler
  // are minted at the same level as every other view's (Knowledge, Insights,
  // History all render this exact `print-root + VIEW_PANE_RESIZABLE_CLASS` div
  // inside their tabpanel wrapper). ★ The key is `documents-pane-size`, NOT
  // `documents-size-full` — that one is already taken by knowledge-panel.tsx,
  // whose feature was called "Documents" before the Knowledge rename.
  const { ref: paneRef, reset: resetPaneSize } = useResizable("aipm-cockpit:documents-pane-size");
  return (
    <div id="panel-documents" role="tabpanel" className={className}>
      <div ref={paneRef} className={`print-root ${VIEW_PANE_RESIZABLE_CLASS}`}>
        {/* ★★ `isReadOnly` is what makes the popout guard live, and
            `onResetSize` is what makes the reset control live. The panel's own
            tests cannot catch either being dropped here — they render the
            component directly and supply the props themselves, so an unpassed
            prop is invisible to every one of them. Pinned instead by the
            WIRING-level test in workspace-panels.documents.test.tsx
            (mutation-proved: drop a line and its cases go red).
            ★★ `mutateDocuments`, NOT `setDocuments`. The pane must not be able
            to rewrite `documents` without the matching `documentVersions`
            write — that before-image is the only history the AI tools sharing
            this entry point have, and they bypass the undo stack entirely. It
            is passed straight through: the panel's prop signature IS the
            context one, so there is no wrapper here to get the source wrong. */}
        <DocumentsPanelLazy
          lang={lang}
          documents={ws.documents}
          mutateDocuments={ws.mutateDocuments}
          documentVersions={ws.documentVersions}
          ws={ws}
          isReadOnly={isPopout}
          onResetSize={resetPaneSize}
          allowDestructiveSave={allowDestructiveSave}
          assetPane={{
            tursoConfig: assetsTursoConfig,
            projectId: assetsProjectId,
            assets: ws.documentAssets,
            setAssets: ws.setDocumentAssets,
            // ★ The SAME bypass the panel itself gets — the asset remove is a
            //   second delete route into a counted slice, so it needs it too.
            allowDestructiveSave,
          }}
        />
      </div>
    </div>
  );
}
