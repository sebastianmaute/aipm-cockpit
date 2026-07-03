import type { Lang } from "../i18n";
import { DiagnosticsPanel } from "../diagnostics-panel";

export function DiagnosticsSection({ lang }: { lang: Lang }) {
  return <DiagnosticsPanel lang={lang} />;
}
