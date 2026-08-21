# Dashboard density toggle — implementation plan

> Inline TDD execution. Files share `i18n.ts` + `settings-types.ts` → coupled, run sequentially.

**Goal:** Per-device Comfortable/Compact dashboard density (spacing only).

**Tech:** Next.js 16 / React 19 / TS / vitest / Tailwind.

---

### Task 1: Pure engine `dashboard-density.ts` + test

- Create `src/app/dashboard-density.ts`: `DashboardDensity` type, `DensityClasses` interface, `densityClasses(d)`.
  - comfortable → `{ outer: "space-y-4", kpiGap: "gap-2", cardPad: "p-3" }`
  - compact → `{ outer: "space-y-2", kpiGap: "gap-1", cardPad: "p-2" }`
- Create `src/app/dashboard-density.test.ts`: assert both branches.
- Run `npm run test:run -- dashboard-density` → green.

### Task 2: settings model

- `settings-types.ts`: add `dashboardDensity?: "comfortable" | "compact";` to `Settings` (near `tasksViewMode`); add `dashboardDensity: "comfortable"` to `defaultSettings`.
- `npx tsc --noEmit` clean.

### Task 3: i18n keys (EN + DE)

- `i18n.ts`: `dashboardDensityLabel`, `dashboardDensityComfortable`, `dashboardDensityCompact`, `dashboardDensityCompactView`, `dashboardDensityComfortableView`, `versionHighlightDashboardDensity`.
- `i18n.de.ts`: same keys, real umlauts, via node utf8 write (CRLF `\r\n` anchor).
- `npx tsc --noEmit` (EN/DE parity enforced).

### Task 4: DashboardPanel props + classes + on-panel toggle

- Import `densityClasses`, `type DashboardDensity`.
- Props: `density?: DashboardDensity`, `onToggleDensity?: (d: DashboardDensity) => void`.
- `const dc = densityClasses(props.density ?? "comfortable");`
- Apply `dc.outer` to container (was `space-y-4`), `dc.kpiGap` to KPI grid (was `gap-2`), `dc.cardPad` to sparkline card (was `p-3`).
- Toggle button beside Trends toggle: when `onToggleDensity`, render `aria-pressed={density==="compact"}`, label = compact?comfortableView:compactView, onClick flips.
- `dashboard-panel.test.tsx`: compact → container has `space-y-2`; toggle present + fires flipped; absent without prop.

### Task 5: AppearanceSection control + test

- `appearance-section.tsx`: third `SegmentedControl<DashboardDensity>` bound to `settings.dashboardDensity ?? "comfortable"`, `onChange((v) => onChange({...settings, dashboardDensity: v}))`, `ariaLabel={t(lang,"dashboardDensityLabel")}`.
- Add `appearance-section.test.tsx`: renders 3 controls, density change calls onChange with new value.

### Task 6: wire workspace-section

- Dashboard render: `density={settings.dashboardDensity ?? "comfortable"}` + `onToggleDensity={(d) => setSettings((s) => ({ ...s, dashboardDensity: d }))}`.

### Task 7: versioning

- `version.ts`: APP_VERSION "0.123.0" + milestone; append `versionHighlightDashboardDensity` to `APP_HIGHLIGHT_KEYS`.
- CHANGELOG entry; README badge; package.json version.

### Task 8: verify

- `npm run test:run` green · `npx tsc --noEmit` clean · `npm run lint` clean.
- axe: `npx playwright test e2e/a11y.spec.ts --project=chromium -g "Dashboard"` + `-g "Settings"`.
- AGENTS.md module-map entry.
