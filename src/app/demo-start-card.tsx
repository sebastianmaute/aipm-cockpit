"use client";

// The empty state's "Explore the demo" card. Its copy depends on where the demo would go: with a
// usable Turso config it is created there with its Trends history; otherwise it is local, and the
// card says Trends needs Turso and offers the guided setup first. `weeks` is the seeded history's
// length (`DEMO_SNAPSHOT_WEEKS`), never a literal.

import { useId } from "react";
import { Button } from "./button";
import { t, type Lang } from "./i18n";
import type { DemoVariant } from "./demo-project";

export interface DemoStartCardProps {
  lang: Lang;
  variant: DemoVariant;
  weeks: number;
  /** One boot after the guided setup connected Turso (`useDemoIntentOnBoot`). */
  connectedNote: boolean;
  onExplore: () => void;
  /** Local variant only: store the intent and open the setup wizard at its Storage step. */
  onSetUpTurso?: () => void;
}

export function DemoStartCard({ lang, variant, weeks, connectedNote, onExplore, onSetUpTurso }: DemoStartCardProps) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3 rounded-md border border-line bg-surface p-4">
      <h3 id={headingId} className="text-sm font-semibold text-foreground">
        {t(lang, "demoCardTitle")}
      </h3>
      <p className="text-sm text-muted-foreground">{t(lang, "demoCardBody")}</p>
      {connectedNote && (
        <p className="text-sm font-medium text-foreground">{t(lang, "demoTursoConnectedNote", weeks)}</p>
      )}
      <p className="border-l-2 border-line pl-3 text-sm text-muted-foreground">
        {variant.kind === "turso"
          ? t(lang, "demoCardTrendsIncluded", weeks, variant.projectName)
          : t(lang, "demoCardTrendsNeedsTurso", weeks)}
      </p>
      <div className="mt-auto flex flex-wrap gap-2">
        <Button variant="primary" onClick={onExplore}>
          {t(lang, "demoCardTitle")}
        </Button>
        {variant.kind === "local" && onSetUpTurso && (
          <Button variant="secondary" onClick={onSetUpTurso}>
            {t(lang, "demoCardSetUpTurso")}
          </Button>
        )}
      </div>
    </section>
  );
}
