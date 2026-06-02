import { healthColorName, healthDot, type Health } from "../health";
import { type Lang } from "../i18n";

export function HealthPill({
  value,
  label,
  lang,
}: {
  value: Health | null;
  label: string;
  lang: Lang;
}) {
  const dot = value ? healthDot[value] : "bg-slate-300";
  const name = value ? healthColorName(value, lang) : "—";
  return (
    <span className="inline-flex items-center gap-1.5 text-sm">
      <span className={`inline-block h-2.5 w-2.5 rounded-full ${dot}`} aria-hidden />
      <span className="font-medium">{label}</span>
      <span className="text-muted-foreground">{name}</span>
    </span>
  );
}
