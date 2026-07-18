"use client";
import type { DiffLine } from "./text-diff";

export interface CommTemplateDiffViewProps {
  lines: DiffLine[];
  addedLabel: string;
  removedLabel: string;
  summary: string;
}

export function CommTemplateDiffView(props: CommTemplateDiffViewProps) {
  const { lines, addedLabel, removedLabel, summary } = props;
  return (
    <div
      role="list"
      aria-label={summary}
      className="flex flex-col rounded-md border border-line bg-surface px-2 py-1.5 font-mono text-xs"
    >
      {lines.map((line, i) => {
        if (line.type === "added") {
          return (
            <div key={i} role="listitem" aria-label={`${addedLabel}: ${line.text}`} className="text-ui-green-strong">
              <span aria-hidden>+ </span>{line.text || " "}
            </div>
          );
        }
        if (line.type === "removed") {
          return (
            <div key={i} role="listitem" aria-label={`${removedLabel}: ${line.text}`} className="text-ui-purple line-through">
              <span aria-hidden>- </span>{line.text || " "}
            </div>
          );
        }
        return (
          <div key={i} role="listitem" className="text-muted-foreground">
            <span aria-hidden>&nbsp;&nbsp;</span>{line.text || " "}
          </div>
        );
      })}
    </div>
  );
}
