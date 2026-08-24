"use client";

import { useEffect, useRef } from "react";
import type { Lang } from "../i18n";
import { DiagnosticsPanel } from "../diagnostics-panel";
import { useWorkspace } from "../workspace-context";
import { countSplitTaskPairs } from "../task-status";
import { logDiag } from "../diagnostics";

/** Settings → Diagnostics.
 *
 *  ★★★ This wrapper exists to READ THE WORKSPACE so the panel does not have to.
 *  `DiagnosticsPanel` is also mounted by `recovery-panel.tsx`, which runs on a
 *  separate route with no `WorkspaceProvider` above it — a `useWorkspace()`
 *  call inside the panel would throw there. The count is therefore an OPTIONAL
 *  prop: Settings supplies it, recovery omits it, and the row does not render.
 */
export function DiagnosticsSection({ lang }: { lang: Lang }) {
  const { tasks } = useWorkspace();
  const splitPairs = countSplitTaskPairs(tasks);
  const loggedRef = useRef<number | null>(null);

  // ★ Log to the ring so the count reaches the exported diagnostic bundle a
  //   user can send. Firing from here is sufficient: `buildDiagnosticBundle` is
  //   reachable only from the panel's own copy/download buttons, so any export
  //   implies this section mounted.
  // ★ Only when NON-ZERO, and only on a CHANGE. The ring is capped at 200
  //   entries; logging every render would evict everything else in it.
  useEffect(() => {
    if (splitPairs > 0 && loggedRef.current !== splitPairs) {
      loggedRef.current = splitPairs;
      logDiag("warn", "task-pair-split", { count: splitPairs });
    }
  }, [splitPairs]);

  return <DiagnosticsPanel lang={lang} splitPairs={splitPairs} />;
}
