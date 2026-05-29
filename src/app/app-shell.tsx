"use client";

interface AppShellProps {
  layout: "modern" | "classic";
  classic: React.ReactNode;
  modern: React.ReactNode;
}

export function AppShell({ layout, classic, modern }: AppShellProps) {
  return <>{layout === "classic" ? classic : modern}</>;
}
