<!-- Split out of AGENTS.md, which is the always-loaded file (CLAUDE.md is `@AGENTS.md`).
     THIS file is NOT auto-loaded — open it when you work on this subsystem.
     Same conventions: ★ = a non-obvious rule, ★★ = has already caused a bug,
     ★★★ = has caused the same bug more than once.
     `npm run docs:symbols:check` gates this file exactly as it gates AGENTS.md:
     it proves a backticked NAME is real, never that a CLAIM about it is true.
     Every claim here was true when written and some have outlived their code —
     grep before relying on one, and correct what you disprove in the same commit. -->

# UI shell — theming & colour schemes

[← AGENTS.md](../../AGENTS.md) · [doc set](../../AGENTS.md#the-doc-set--what-lives-where)

### UI shell — theming & color schemes

  • **Dual-CI / style axis:** ★ Phase 2 SUPERSEDES this axis — `data-style` is now the CONSTANT `"custom"` and
  AIPM/Mockup are read-only BUILT-IN SCHEMES (see the scheme bullet below); the CSS-role-token MECHANISM here
  still stands, only its source moved (scheme maps, not per-`data-style` CSS blocks). `data-style` (formerly
  `"AIPM"|"mockup"|"custom"`) on `<html>` is ORTHOGONAL to `.dark`; set by
  `use-style.tsx` (`useCiStyle`, `aipm-cockpit-style` localStorage, NOT the settings blob) + the no-flash boot script
  (`boot-theme-script.ts`, reads `aipm-cockpit-style`+`aipm-cockpit-theme`+the scheme boot keys pre-paint). Mockup ("Dashboard" style) is
  LIGHT-ONLY + PINS light: `use-style` fires a `aipm-cockpit-style-change` event; `use-theme` is the SOLE `.dark`
  writer and re-applies on that event (switching back to AIPM restores dark). ALL style difference is CSS
  role tokens in `globals.css`: `--rag-red/amber/green` (+ `-text` AA variants — ★ but `--rag-amber-text` is AA only on
  LIGHT AIPM; as SMALL text on `bg-surface` it FAILS AA on dark/mockup, see the Next-actions surface bullet), `--table-head-bg/-fg`,
  `--table-head-accent` (sort-button active/hover), `--shadow-card/-control/-card-hover`, `--gradient-kpi`,
  `--rag-green-chip`/`--rag-red-chip` + `--delta-chip-pad` (KPI delta pills), `--segment-track-bg/-active-bg/-active-fg`. AIPM values
  reproduce the old look; ★ Phase 2: AIPM-dark + Mockup no longer live in a `.dark` /
  `:root[data-style=mockup]` CSS block (both REMOVED) — they now ride their SCHEME maps, and `globals.css`
  `:root` is the static AIPM-LIGHT no-JS fallback only. RAG flows through `health.ts` (`healthDot`/`healthText` →
  `--rag-*` / `--rag-*-text` token families (e.g. `bg-[var(--rag-red)]`, `text-[var(--rag-green-text)]`)). `--gradient-kpi` is APPLIED to the completion-% gauge
  (`KpiGradientBar` in `report-table.tsx`, the Tile `bar` slot) — AIPM `var(--ui-green)` solid, Mockup the
  red→amber→green gradient (inline `style`, the ONLY legal gradient path). It is the SOLE "more=better"
  visual; NEVER apply to effort/usage bars (more=worse — gradient inverts the signal). Shadows/gradients
  legal ONLY via tokens (e.g. `shadow-[var(--shadow-card)]` — use the `--shadow-*` token family); `shell-palette-guard` bans raw
  `shadow*`/`drop-shadow`/`bg-gradient-` via strip-then-ban.
  ★★ `shell-palette-guard` + `palette-chrome-sweep` scan the WHOLE SOURCE incl. COMMENTS: the bare word
  "shadow" or a literal `--shadow-card` in prose (a JSDoc/comment) trips RAW_SHADOW (only the
  `shadow-[var(--…)]` className form is stripped first) — reference the token obliquely in comments.
  `bg`/`border`/`divide-ui-light-grey` + `text-ui-dark-grey` are BANNED chrome greys (`text-ui-light-grey`
  is fine) — use `bg-ui-medium-grey` for a neutral dot/fill. The axe gate (`e2e/a11y.spec.ts`) scans
  FIVE combos over the THREE built-in schemes: harbor-light, harbor-dark, meridian-light, meridian-dark,
  umber-light (5 × A11Y_VIEWS) — ★ umber-DARK is deliberately omitted to hold the count at five, so scheme
  DATA is 5-of-6 covered, not fully. Seeding
  `aipm-cockpit-style`/`aipm-cockpit-theme` via `addInitScript` — ★ Phase 2: it must ALSO seed `aipm-cockpit:color-schemes` `activeId`
  to the scheme under test, else `syncScheme` overwrites the boot paint on mount (scheme landmine 4). Appearance
  Style switch disables the theme control while Mockup (a light-only scheme) is active.
  ★★ ANY RAG-semantic color (status values, KPI deltas, win/loss, stacked-bar segments — NOT just the
  dots) MUST use the `--rag-*`/`--rag-*-text` tokens, never raw `text-ui-green`/`-pink-strong`, or it
  won't switch under Mockup (bit trend-arrow / reports-tables / StackedBar / budget / raid-report).
  ★★★ **A `dark:text-*` COMPANION DOES NOT SURVIVE `hover:` — a hover arm needs `dark:hover:text-*`.**
  `globals.css:3` is `@custom-variant dark (&:where(.dark, .dark *))`, and `:where()` contributes ZERO
  specificity, so `dark:text-x` is (0,1,0) while `hover:text-y:hover` is (0,2,0) — the hover rule wins
  whatever the source order. ★ Reasoning from source order gives the WRONG answer: Tailwind emits the
  `dark:` rule LATER, which looks like it should win. This is why an element can carry
  `text-ui-dark-blue hover:text-ui-dark-blue dark:text-ui-light-grey` and still go invisible in dark
  mode the moment the pointer touches it. ★★ The DEFECT is specificity-decided and therefore
  order-immune; the FIX is NOT — `dark:hover:text-*` compiles to `:where(.dark,.dark *):hover` =
  (0,2,0), which TIES `hover:text-*` and wins on emission order alone. Stable in Tailwind today, but
  the remedy is order-sensitive in a way the bug is not. 12 files already use `dark:hover:text-` correctly; 18 do not
  (`docs/open-followups.md` §40). ★★ A companion must also be checked for its VALUE, not merely its
  presence — `chat-prompt-chips.tsx:37` "has" a companion that re-asserts the identical broken colour.
  ★★ NO GATE CATCHES ANY OF THIS: axe scans the RESTING state only, so a hover-state contrast failure
  is structurally invisible to it, and there is no hover pass in `e2e/a11y.spec.ts`.
  ★★ Data-table header sort buttons (`report-table` SortHeaderButton, used by every `SortResizeTh` — now
  the Open Points table too, `SortableTh` was RETIRED into it) use `text-[var(--table-head-accent)]` for
  active/hover — raw `text-ui-green` is sub-AA (2.03:1) on the
  Mockup light header AND a blanket `.aipm-cockpit-thead button{color}` rule silently kills the sort affordance.
  ★★ A TRANSLUCENT role-token tint (`rgba(...)`) over a parent whose bg CHANGES on hover (e.g. a `Tile`
  button's `hover:bg-surface-muted`) RE-composites darker → its TEXT can drop below AA on hover. The axe
  gate scans RESTING state only, so it PASSES. Use OPAQUE pre-composited tints — `--rag-green-chip`/
  `--rag-red-chip` are opaque hex (NOT rgba) for exactly this (bit the KPI delta chips).
  ★★ PURPLE TEXT on a purple tint needs `--ui-purple-strong` (light `#7a2d72`, dark `#d98cc8`), the AA
  companion mirroring `ui-pink-strong`/`ui-green-strong` — plain `text-ui-purple` (#aa4899) on
  `bg-ui-purple/10` is 3.6:1 (bit the AI-consent block). Bright `ui-purple` stays for fills/borders.
  ★★ A `-strong` text token tuned AA on `bg-surface` can still FAIL on the lighter `bg-surface-muted` —
  dark `--ui-pink-strong` was bumped `#e5497c`→`#e96089` so overdue pink text clears AA on a Kanban
  card (`bg-surface-muted`), not just on `bg-surface`. Brightening a dark text token only RAISES contrast.
  ★★ A STRUCTURAL style diff that must stay an AIPM no-op (padding/size, not color) can't ride a Tailwind
  class (a class isn't token-toggleable). Put it in a token applied via INLINE STYLE, gated on presence:
  e.g. `--delta-chip-pad` (AIPM `0` ⇒ byte-identical; Mockup pads the pill), `style={chip ? {padding:
  "var(--delta-chip-pad)"} : undefined}` — so AIPM is untouched AND a chip-less (flat) trend gets no empty bubble.
  • **★★ RELEASE B (token rename, 0.190.23):** the palette token NAMES were renamed `AIPM-*`→`ui-*`
  everywhere — Tailwind classes (`bg-AIPM-green`→`bg-ui-green`), CSS var names (`--AIPM-green`→`--ui-green`),
  the `@theme` map (`--color-AIPM-*`→`--color-ui-*`), scheme registries (`CORE_TOKENS`/`VALID_TOKENS`/
  `DERIVED_TOKENS`), any exported theme FILE's color KEYS, and the palette guards. The 12 base
  tokens are `ui-{dark-blue,green,green-strong,pink,pink-strong,purple,purple-strong,blue,white,dark-grey,
  light-grey,medium-grey}`. The var NAMES + `@theme` MECHANISM are otherwise unchanged (only the prefix);
  Phase-2 text below that says `--AIPM-*` now means `--ui-*`. PRESERVED (NOT renamed): `AIPM` (company /
  theme display name), `Acme`/`AIPM-consult` (host/email), `AIPM-logo`/`AIPM-icon` (asset classes),
  and the legacy `CiStyle` union members `"AIPM"`/`"mockup"` (`style-ci.ts` — vestigial: `data-style` is
  the constant `"custom"` now, and NO live scheme carries either id). NO key migration — a stored/
  exported scheme with legacy `--AIPM-*` color keys drops to the default-scheme fallback (Beacon) (no active users).
  • **★★ RELEASE A (theme decouple, 0.190.22) SUPERSEDES the "FIVE built-ins" claim below:** AIPM + Mockup
  LEFT the code built-ins entirely. `BUILTIN_SCHEMES` = **[harbor, meridian, umber, beacon]** (Beacon added
  as the fresh-install default; it is LIGHT-ONLY — no `dark` map — and pins light mode via the same
  supportsDark-driven mechanism a light-only USER scheme already used), and a theme is
  now a FILE THE USER LOADS in the full portable format (light/dark/`structural`/branding/pinned AA tokens).
  ★★★ CORRECTED 2026-07-30 — earlier revisions of this bullet claimed AIPM and Mockup "ship as
  `public/themes/AIPM.json` + `mockup.json`" and that the gallery "fetches `/themes/*.json`". **There is no
  `public/themes/` directory, there are no shipped theme files, and nothing in the repo references that
  path** (verified: `find . -name AIPM.json` → nothing; `public/` holds only logos, the manifest and `sw.js`).
  The in-app **Theme gallery** (`theme-gallery.tsx`, mounted in `AppearanceSection` beside the scheme editor)
  is a FILE-UPLOAD importer (`accept="application/json,.json"`) → widened `importScheme` → `addScheme` +
  `updateScheme({dark,structural})` → a removable user scheme. Fresh install picker = Harbor/Meridian/Umber/Beacon (Beacon is the DEFAULT selection);
  `e2e/a11y.spec.ts`'s own comment states it plainly: "AIPM and Dashboard no longer exist in the app in any
  form — a theme is a file the user loads." Do not re-add a claim that any theme is bundled. NO migration (no active users) — an orphaned `activeId "AIPM"/"mockup"`
  falls back to the default scheme (Beacon) via reconcile. `ICC_SEED`/`MOCKUP_SEED` + their structural maps DELETED from
  `scheme-tokens.ts` (AA derivation uses a neutral `FALLBACK_SURFACE`); `globals.css :root` is now the
  **Harbor-resolved-light** no-JS fallback (the var NAMES are now `--ui-*` after Release B; `@theme` map
  structure UNCHANGED). Portable format widened: `exportScheme`/`cleanScheme` carry `structural`
  (via `cleanStructural` + `STRUCTURAL_TOKENS`, `isSafeRawCssValue`-gated) + the 7 pinned derived tokens;
  `updateScheme` accepts a `structural` patch. Scheme editor base/reset = `HARBOR_LIGHT`; its old
  "New from AIPM/Mockup" buttons → one "New from current theme". ★★ e2e axe `a11y.spec.ts` runs its 6-combo
  matrix on the FOUR BUILT-INS — harbor light+dark, meridian light+dark, umber light, beacon light —
  resolving each map node-side at seed time. ★ Umber-DARK is deliberately unscanned to hold the count down;
  Beacon has no dark variant to scan. — The Phase-2 text below still describes
  the MECHANISM (data-style/scheme apply/structural), just not the built-in ROSTER.
  • **Scheme-driven color schemes (Phase 2 — AIPM + Mockup ARE built-in schemes):** the AIPM/mockup/custom
  `data-style` AXIS COLLAPSED — `data-style` is now the CONSTANT `"custom"` (`use-style` always writes it;
  `CiStyle.style` is always `"custom"` in normal operation). AIPM + Mockup JOINED Harbor/Meridian/Umber as
  READ-ONLY BUILT-IN schemes → FIVE built-ins in `BUILTIN_SCHEMES` (`builtin-schemes.ts`; ids
  `"AIPM"`/`"mockup"`/`"harbor"`/`"meridian"`/`"umber"`, undeletable via `BUILTIN_SCHEME_IDS`). Harbor was the
  fresh-install DEFAULT at the time (`DEFAULT_SCHEME_ID`) — no longer true, see the RELEASE A bullet above;
  Beacon is default now. A scheme carries `{ light, dark?, supportsDark, structural?,
  builtIn? }` (user ids `"u-<n>"`); apply is INLINE `documentElement.style.setProperty` (the legal runtime
  mechanism — NEVER a Tailwind class, so palette-sweep is untouched). ★★ STRUCTURAL (NON-color) token group:
  `ColorScheme.structural?` = 7 tokens (the `--shadow-card/-control/-card-hover` family + `--gradient-kpi`,
  `--delta-chip-pad`, `--rag-green-chip`, `--rag-red-chip`) defined in `scheme-tokens.ts`
  (`STRUCTURAL_TOKENS`/`ICC_STRUCTURAL`/`MOCKUP_STRUCTURAL`), applied via `applySchemeStructural`
  (`scheme-apply.ts`); each raw value is gated by `isSafeRawCssValue` — a charset allowlist plus a denylist
  blocking `url(` / `expression` / `image-set` / `;` / braces / `@` / angle brackets / backtick. Mirrored to
  boot key `aipm-cockpit-active-scheme-structural` (NOT `aipm-cockpit:`-prefixed → boot reads it pre-paint like
  `aipm-cockpit-active-scheme-colors`; consequently NOT swept by `clearAppConfig` — intentional, mirrors the colors
  key). ★★ `globals.css`: `:root` is KEPT as the STATIC no-JS / pre-boot AIPM-LIGHT fallback (colors +
  structural); the old `.dark` TOKEN block AND the `:root[data-style="mockup"]` block were REMOVED — AIPM-dark +
  Mockup now ride their SCHEME maps. `.dark` REMAINS a class toggle (Tailwind `dark:` utilities). ★★
  ★★ **`deriveAaVariants` targets `--surface-muted` for every AA variant EXCEPT `--ui-purple-strong`**, which
  is derived against the purple tint COMPOSITED over that surface (`PURPLE_TINT_ALPHA_LIGHT` 0.20 /
  `..._DARK` 0.25 — the RAID "caused this" chips' HOVER state, mode-picked via the surface's own luminance).
  Reason: every consumer of that token — those chips, the chat AI-consent block, the read-only mirror banner
  — puts it on `bg-ui-purple/10`, and NONE on a plain surface, so the card was never the background this text
  actually sits on. Deriving against the card cleared 4.5 there while landing at 4.22:1 (Meridian light) and
  4.35:1 (Umber light) once hover deepened the tint. This is the documented translucent-tint-on-hover trap,
  and the axe gate CANNOT see it (it scans the resting state, and those chips live in an edit modal it never
  opens) — `scheme-purple-hover.test.ts` is the only coverage, and it checks the built-ins AND the shipped
  the `globals.css :root` Harbor-light fallback. ★★ The GUARD must composite over the same `--surface-muted` the DERIVATION
  does: composited over the lighter `--surface` it is looser than the code it guards, and a revert
  slips through in 4 of the 6 built-in combos. ★★ SIDE EFFECT, accepted deliberately: because the
  reference is the harder surface, this also LIGHTENED the value DERIVED FOR the three built-in DARK
  maps (harbor `#a990ff`→`#c7a9ff`, meridian `#ad83ff`→`#cc9bff`, umber `#b786db`→`#d79eff` — the token is
  not IN those maps, which hold exactly the 21 editable tokens; it is computed from them) — visible
  on the AI-consent block, read-only banner and RAID chips in dark mode, none of which was FAILING.
  Kept because it matches this module's existing "derive against the harder surface" rule and keeps the
  token safe if a purple chip is ever placed on a muted card. ★★ The same trap bites text ALPHA, not
  just a background tint: `hover:text-ui-purple-strong/80` on the consent link measured 3.40–3.58:1 in
  the light schemes as shipped (4.04–4.25:1 once 0.202.3's darker token is applied — still under AA
  either way). A `-strong` token is tuned to sit AT AA, so ANY alpha on it lands under — use a
  non-colour hover cue (that link now thickens its underline). A grep for `-strong` + `hover:bg-`
  structurally cannot find this shape — the same fade shipped on `trends-panel.tsx`'s delete button as
  a whole-element `hover:opacity-80` (~4.0–4.3:1), fixed alongside; sweep for `opacity`/`/NN` on a
  `-strong` element, not just for a background class. ★★★ `nudgeToAa` takes an explicit `lighten` OVERRIDE and the purple
  arm MUST pass it. The function defaults the direction to `bg`'s own luminance, which is right while `bg`
  IS the surface — but purple measures against a TINT, and a 20% composite moves luminance far more than
  20%, so the direction (read off the tint) and the alpha (read off the surface) can disagree. A light
  scheme with a mid-grey `--surface-muted` (e.g. `#c8c8c8`) then LIGHTENS on a light background, runs the
  loop to its 20-iteration cap and returns `#ffffff` — white text on a light card, ~1.7:1. Both inputs are
  user-editable (`ADVANCED_TOKENS`) and user schemes are light-only this phase, so it is reachable even
  though every built-in is clear — which also means the built-in sweep can never see it. ★ The custom-scheme
  cases in `scheme-purple-hover.test.ts` pin the direction for a card ABOVE `nudgeToAa`'s 0.5-luminance
  threshold; they do NOT close the hole generally — a `--surface-muted` BELOW 0.5 (e.g. `#a0a0a0`) still
  returns `#ffffff`, and that limitation is module-wide, hitting the green/pink/rag derivations too. Whoever
  decides the mode decides the direction.
  ★ Keep the alphas in lockstep with `raid-edit-fields.tsx`. ★ A pin was tried first
  and rejected: `builtin-schemes.test.ts` requires built-in maps to hold EXACTLY the 21 editable
  tokens, so a pinned AA variant is a test failure by construction. ★ Do NOT
  add "and `cleanColors` would drop the pin on save-as-new" to that argument — it is FALSE and was
  briefly written here: `--ui-purple-strong` is in `DERIVED_TOKENS`, which `VALID_TOKENS` includes, so
  `cleanColors` KEEPS it (that is exactly how an imported AIPM/Mockup scheme survives a save).
  `resolveSchemeColors` is now BASE-WINS (`{...deriveAaVariants(colors), ...colors}`): derivation only FILLS
  missing AA variants; an explicitly PINNED `-strong`/`-text`/`muted-foreground` SURVIVES — that is why
  AIPM/Mockup reproduce the shipping look exactly (landmine 1). ★★ `effectiveDark(themeDark, schemeSupportsDark)`
  DROPPED the `style` arg; pin-light = `!activeScheme.supportsDark` (Mockup `supportsDark:false`, honours theme
  for a dark-capable scheme). `use-theme` (sole `.dark` writer) reads `data-scheme-dark` ONLY — the mockup
  `data-style` branch is GONE. `use-style.syncScheme` stays the SOLE apply path (resolves for the CURRENT theme,
  applies inline, mirrors both boot keys + `data-scheme-dark`). ★★ EVENT WIRING (order-independent, unchanged):
  `use-theme` recomputes `.dark` on `aipm-cockpit-style-change` ONLY; a theme flip dispatches `aipm-cockpit-theme-change` →
  `use-style` re-resolves; a SCHEME switch (`aipm-cockpit-scheme-change`) runs `syncScheme` FIRST then re-dispatches
  `aipm-cockpit-style-change` — do NOT make `use-theme` listen to `aipm-cockpit-scheme-change` (the fixed race). ★★ Boot script
  (`boot-theme-script.ts`, imported by `layout.tsx`) ALWAYS writes `data-style="custom"`, paints scheme colors
  AND structural, and EMBEDS the resolved AIPM/Mockup/Harbor maps so a legacy-first-boot device migrates without
  a Harbor flash. `use-style` ONE-TIME-migrates a legacy `aipm-cockpit-style="AIPM"/"mockup"` → the scheme activeId (in
  the lazy `useState` initializer) then writes `aipm-cockpit-style="custom"`. `layout-boot-script.test.ts` PINS the EXACT
  boot string + runtime-evals it — edit boot ⇒ update that guard in lockstep. ★★ AppearanceSection: the scheme
  `<select>` routes ALL ids (incl AIPM/mockup) through `selectScheme` (NOT `setStyle`); `pinsLight =
  !activeSupportsDark`; the editor is ALWAYS mounted (built-ins read-only via `BUILTIN_SCHEME_IDS` —
  Rename/Delete/Apply disabled, tweak + Save-as-new to customise); global app-name/footer inputs shown when the
  active scheme owns no branding (built-ins), HIDDEN for a branded user scheme. `reconcileBuiltins` remains the
  SOLE `activeId` validator (re-seeds built-ins from code, keeps user schemes + activeId; else
  `DEFAULT_SCHEME_ID`) — `loadSchemes`/`setActive` must NOT validate (built-ins aren't in the raw store).
  ★★ NO-FLASH SINGLE-SOURCE: EVERY editor mutation (select/save/import/rename/delete/apply) writes the boot
  key(s) + applies, so the active library scheme == what renders (the boot keys are purely DERIVED); mutating
  one channel without the other is the coherence bug (selecting did nothing / a deleted scheme's colours
  lingered). Schemes OWN slogan/footerSlogan (apply REPLACES via `mergeAppliedBranding`); logo/favicon stay
  GLOBAL. Derived `-strong`/`-text`/`muted-foreground` tokens are dropped on save (`cleanColors`). USER schemes
  are still light-only THIS PHASE (editor edits `.light`); built-ins carry both maps. Pure modules:
  `scheme-tokens.ts` (registry + AIPM/MOCKUP seed+structural maps, `deriveAaVariants`, `resolveSchemeColors`),
  `scheme-contrast.ts` (WCAG warn-only), `scheme-apply.ts` (colors + structural apply/read/write helpers),
  `color-schemes.ts` (per-device `aipm-cockpit:color-schemes`, hex-validated). Selection hook
  `use-color-schemes.ts` (coverage-excluded).
  ★★ FIVE Phase-2 landmines (do NOT reintroduce):
  (1) `resolveSchemeColors` is BASE-WINS — a built-in that must reproduce an exact hand-tuned value PINS it in
  its light/dark map; derivation only fills gaps. Flipping back to derived-wins silently OVERWRITES AIPM/Mockup
  pinned `-strong`/`-text`/`muted-foreground`.
  (2) Mockup's `-strong` tokens were NOT overridden by the (now-removed) `:root[data-style=mockup]` CSS — they
  cascaded from `:root` (AIPM). So `MOCKUP_LIGHT` MUST PIN `ui-green/pink/purple-strong` to
  `#4d7000`/`#c41e5a`/`#7a2d72`, else `nudgeToAa` re-derives WRONG values (review-caught regression).
  (3) AIPM scheme maps FLATTEN tokens that were `var(--surface)` in globals (e.g. `--segment-track-bg`) —
  `ICC_SEED` hardcodes `#ffffff`; `ICC_DARK` MUST re-override `--segment-track-bg: #121619` (dark surface) or
  the segmented control is white-on-near-white in dark (axe AA fail). Audit any seed-flattened chrome token
  when adding a dark map.
  (4) e2e axe seed: seeding the boot keys is NOT enough — `syncScheme` re-resolves from `aipm-cockpit:color-schemes`
  on mount and OVERWRITES the boot paint. The axe seed MUST also set `aipm-cockpit:color-schemes` `activeId` to the
  scheme under test (empty `schemes:[]` is fine — `reconcileBuiltins` injects built-ins).
  (5) The palette guards do NOT scan the `.ts` scheme data files (`shell-palette-guard` = fixed shell-file
  list; `palette-chrome-sweep` = `.tsx` only), so structural shadow/gradient STRINGS in
  `builtin-schemes.ts`/`scheme-tokens.ts` don't trip them — no allowlist needed.
- **Scrollbar gap:** per-view inner scrollers (`min-h-0 flex-1 overflow-auto`) need `pr-2` for the
  content↔scrollbar gap. Shared `INNER_TABLE_CLASS`/report-table/actions-panel already include it; bare
  per-panel scrollers do NOT — add `pr-2` or content jams the scrollbar.
- **Print:** `globals.css @media print` scopes printing to a `.print-root` subtree (`body * {visibility:
  hidden}`; only `.print-root` shows) — a view WITHOUT `print-root` prints BLANK. To make a view printable:
  add `print-root` (+ `print-landscape` for wide tables) to its outermost pane (alongside the `VIEW_PANE_*`
  class); add `<PrintButton lang={lang}/>` (from `task-manager-ui`; defaults to `window.print()`, already
  labeled + `print:hidden`) to the toolbar — LEFT of any Reset buttons (resets stay rightmost); `print:hidden`
  the toolbar/filters/bulk-bars (keep the data table + section title visible).
  `ColumnResizeHandle` is already `print:hidden`. ★★ The `@media print` block (a) anchors `.print-root` at
  `position:absolute; top:0; left:0` + `height:auto !important` (so a user-dragged `useResizable` inline size
  can't clip the printout) — NOT `inset:0` (a `bottom:0` pins the abs box to ONE PAGE height → content past
  page 1 is CLIPPED; the single-page-print bug); (b) GLOBALLY resets every `.print-root [class*="overflow-"]`/
  `[class*="max-h-"]` descendant to `overflow:visible !important; max-height:none !important` (inner scrollers
  otherwise print a scrollbar AND clip to their box = one page) — so per-panel `print:max-h-none
  print:overflow-visible` is now REDUNDANT; (c) strips rounded container chrome via `.print-root
  [class*="rounded"][class*="border-line"] {border:0; border-radius:0}` (`divide-line` row-lines + `rounded-full`
  RAG dots untouched). Guarded by `e2e/print.spec.ts` (print-media emulation: asserts 0 clipping scrollers, 0
  rounded boxes, box contains full content). Don't reintroduce `inset:0` or a per-pane print clip. Data views (tasks/milestones/changes/
  stakeholders/RAID/resources/
  knowledge/history/steering/portfolio/RACI/timelog) + the ReportCard views are wired; Settings/Chat/Projects
  are not (nothing to print).
- **Branding (per-device `settings.branding {logo?, slogan?, footerSlogan?, favicon?, startLogo?}`):** rides the
  `writeSettings` spread (no allowlist edit); validated by `sanitizeBranding` — logo/favicon/startLogo must be a
  size-capped RASTER `data:image` URL (SVG EXCLUDED — XSS surface), slogan/footerSlogan trimmed+capped. Edited
  in Settings → Appearance. `logo` overrides the sidebar logo — ★ a custom logo renders WITHOUT
  `brightness-0 invert` (that filter only whitens the mono AIPM default); `slogan` = sidebar app-name subtitle;
  `footerSlogan` = bottom footer tagline (default `DEFAULT_FOOTER_SLOGAN`, seeded into
  `defaultSettings.branding`). `favicon` drives the document `<link rel=icon>` via `useApplyFavicon`/
  `applyFavicon` (`use-favicon.ts`) — captures the build-time default ONCE so a remove restores it. Sidebar +
  classic `AppHeader` + `app-modals` footer read branding via `useSettings()`. CSP already allows `data:` in
  `img-src`. Default sidebar logo is `/app-logo.svg` (mono mark, whitened by `brightness-0 invert`); the classic
  `AppHeader` renders `/AIPM-logo.svg` un-inverted (light header) — ★ the two default assets are DIFFERENT files,
  which an earlier "classic header uses it" wording hid.
  ★★ `startLogo` is a FIFTH, SEPARATE field driving ONLY the start window (`project-empty-state.tsx`, the
  `view === "choices"` branch); unset ⇒ the shipped `/ai-pm-cockpit-banner-harbor.svg`, NOT `logo` and NOT the
  AIPM mark. It is deliberately not shared with the sidebar `logo` — one wants a small mark, the other a wide
  banner. ★★★ THE `<img>` NEEDS A **DEFINITE** HEIGHT (`h-12`), NEVER ONLY A CAP. It shipped once as
  `max-h-12 w-auto` — all constraints, nothing definite — and the empty-state HEADER COLLAPSED: the shipped
  banner carries a `viewBox` but NO `width`/`height` attributes, so it has no intrinsic size (`naturalWidth`
  reports the 300×70 default object size, not the real 1200×280), and with nothing definite to derive from
  Chrome sized it against the sibling heading's line box — img 128×29.9, `<h2>` **0px wide**, the title
  invisible. `e2e/smoke.spec.ts` failed on it in CI; NOTHING local can see it (jsdom has no layout, and the
  axe seed has a project so the empty state never renders there). ★ A CUSTOM upload is a raster and always
  carries intrinsic dimensions, so only the DEFAULT — every fresh install — was affected. ★ With the height
  definite, `w-auto` derives ~206×48 from the ratio; `max-w-[280px]` engages only above 280/48 ≈ 5.8:1 and
  `object-contain` keeps that case undistorted. `shrink-0` lets the `truncate` heading absorb a narrow
  window instead of the logo. `project-empty-state.test.tsx` pins the definite height as the proxy.
  ★★ Adding a branding field means
  TWO presence checks in lockstep — `sanitizeBranding`'s final `out.x || …` AND `appearance-section.tsx`'s
  `setBranding` `cleaned` gate; miss the second and setting that field ALONE writes `branding: undefined`, so
  the upload silently no-ops and any sibling field is destroyed along with it. ★ Schemes do NOT own it:
  `mergeAppliedBranding` spreads `current` and overwrites only the other four, so a scheme apply can neither
  set nor clear it (pinned in `color-schemes.test.ts` — the four-field version passed happily without a pin).
  ★★ Because no scheme can own it, the Settings → Appearance branding block edits it UNGATED — unlike the
  other four rows, which sit behind `activeIsBuiltin`. That is NOT a parity break to "fix": the other four
  merely MOVE to the scheme editor under a user scheme, whereas `startLogo` has no second editor, so gating
  it removed the field from the app entirely for those users (shipped that way, caught in review, pinned by
  `appearance-section.test.tsx` "keeps the start-logo row reachable under a USER scheme"). Do not add it to
  `color-scheme-editor.tsx` either — a scheme cannot carry it into `settings`, so that control would appear
  to work and do nothing.
- **Footer bar / page scrollbars (★★):** the footer (`app-modals.tsx`, `!isPopout`) is `position: fixed`
  bottom-right ON PURPOSE — `modalsBlock` is an in-flow SIBLING of the `h-screen` ModernShell, so an in-flow
  footer adds height > 100vh → a page VERTICAL scrollbar. Keep it fixed (out of flow) + `pointer-events-none`;
  both layouts reserve a `pb-6` bottom gap. Related: the shell root is `w-full`, NOT `w-screen` (`100vw`
  includes the scrollbar width → spurious HORIZONTAL scrollbar).
- **Settings sections:** each window shows a uniform pane `<h2>` (its rail label); `mode`/`templates`/
  `commTemplates` are excluded (they self-head + carry an intro line). Appearance is its OWN rail section
  (un-folded from General; General now folds only Storage).
- **Feature-module guidance (Settings → Mode — the section is titled "Mode"; only its intro copy calls the toggles "functions"):** `mode-section.tsx` renders each `FEATURE_MODULES`
  toggle with an optional `descKey` description under the label (use case + when to enable). ★ Adding a
  module ⇒ give it a `descKey` + EN/DE i18n string (all 12 now have one). ★★ a11y: the description is a
  SEPARATE `<span id>` linked via `aria-describedby` — do NOT nest it inside the `<label>` (that folds it
  into the checkbox's accessible name and breaks exact-name `getByRole` queries). The checkbox `id` +
  `aria-describedby` ids are `useId`-scoped so a settings pop-out can't collide.
- **Knowledge view (renamed from Documents, v0.190.0):** the `documents` AppView + feature module were
  renamed to `knowledge` across nav / help / operating-guide / i18n, and the files renamed
  (`documents-panel`→`knowledge-panel`, `document-meta`→`knowledge-meta`, `documents.ts`→`knowledge.ts`,
  `document-links-field`→`knowledge-links-field`; user strings read "Knowledge" / "Wissen"). ★★ The persisted
  per-entity **`documentLinks`** field + its CSV/MD/Turso COLUMNS are INTENTIONALLY LEFT on the wire — the
  rename is view/feature-only, NO serialization change, golden fixtures unchanged. Do NOT "fix" `documentLinks`
  to `knowledgeLinks` (that's a six-write-path + golden-regen migration for zero benefit). ★ ONE back-compat
  migration preserves existing users: `sanitizeFeatures` maps a stored `documents` module id → `knowledge`.
  ★★ THE SECOND ONE IS GONE AND THE BREAK IS DELIBERATE. A `documents` → `knowledge` slug alias used to sit
  at the top of `slugToView`; it was REMOVED when the new Documents view was added, because it runs BEFORE
  the `allNavViews()` lookup and would have permanently shadowed that view's own hash route. The canonical
  Knowledge slug is `knowledge`; `#documents/<id>` now resolves to **Documents**, so a pre-v0.190 bookmark
  lands on the wrong view rather than being redirected. Do NOT "restore" the alias — `nav-config.test.ts`
  pins the current behaviour. ★ The shared TS type is `KnowledgeLink` (was `DocumentLink`),
  with an OPTIONAL `linkKind: "document" | "confluence" | "url"` emitted ONLY for confluence/url (a document
  link — the default + every legacy link — omits it, so serialization stays byte-identical); `linkKindOf(link)`
  resolves the effective kind (absent ⇒ "document"). NOTE the pre-existing `kind` field already means the
  SharePoint item shape (file/folder) — the new field is `linkKind` to avoid that collision. The add-link form
  has a type selector (Web URL / Confluence page / Document); confluence/url are stored as ordinary
  `isSafeHttpUrl`-validated links (no fetch to store) with a kind-appropriate icon; `fileTypeOf` takes the kind
  (kind wins over the file heuristics).
  ★★ **Standalone knowledge items (`Workspace.knowledgeItems`, v0.190.41):** a NEW persisted workspace-level
  field for Knowledge-library items that live on their OWN (not attached to an entity), each a `KnowledgeItem`
  = `KnowledgeLink & { taskIds?: number[] }` (optional multi-task link, the "second step"). Type + validator
  `sanitizeKnowledgeItems` live in `document-link.ts`. Persisted as a JSON blob across ALL SIX write paths like
  `timelogLinks` (JSON in/out in `workspace.ts`; CSV `# KNOWLEDGE ITEMS` section in `csv-codecs-config`/`-decode`;
  MD `## Knowledge Items` fenced block in `markdown-codecs-core`/`-decode`; Turso single meta row + tenant meta
  row keyed `knowledge_items`; IDB KV `knowledgeItems` in `browser-backend.ts`) — BUT unlike timelog/steering it
  is EXPORTABLE, so it is gated by a NEW `knowledgeItems` `ExportSectionKey` (`enabled("knowledgeItems")`, default
  OFF) rather than `config === undefined`, and has a `buildExportSections` PDF builder. Empty ⇒ byte-stable (no
  golden regen). ★ App-level save/load wiring MIRRORS neither timelog nor steering exactly: the value+setter are
  threaded through `workspace-context` (`knowledgeItems`/`setKnowledgeItems`), set on load in BOTH
  `use-storage-backend.applyWorkspace` AND `task-manager`'s restore effect, and — CRUCIALLY — INCLUDED in the
  three `backend.save({…})` literals + `currentWorkspace()` in `use-storage-backend.ts` (steering/timelog are
  NOT in those literals; knowledge is, so it actually autosaves). `version-diff` singleton entry. Panel: the add
  form's target `<select>` gains a "Standalone" option → `addStandaloneItem` pushes to `setKnowledgeItems`; a
  "Knowledge library" card grid renders `ws.knowledgeItems` with remove + a per-item `<select multiple>` task
  linker. Guarded by `knowledge-items-persistence.test.ts`.
- **Responsive metric grids:** a multi-column grid of CONTENT cards (KPI tiles, budget CCI cards, hours
  breakdown, checkbox lists) must carry a `grid-cols-1` (or `grid-cols-2`) mobile base and only widen at
  `sm:`/`lg:` — a bare `grid grid-cols-3`/`grid-cols-4` overflows a phone/narrow-tablet viewport (the
  cells crush + text wraps). The convention is the Reports tile grid (`grid-cols-1 ... sm:grid-cols-2
  lg:grid-cols-3` / `grid-cols-2 ... sm:grid-cols-4`). EXEMPT: a 2×2 grid whose two dimensions are
  SEMANTIC (the stakeholder interest×power matrix) and a side-by-side diff grid — collapsing those to one
  column destroys the meaning; leave them `grid-cols-2`. Most views are NOT in the axe gate's narrow-width
  scan, so a responsive break slips CI — eye-check new metric strips at ~375px.
- **Interaction-state atoms (`interaction-styles.ts`):** pure class-string consts every interactive control
  composes so hover/focus/press read identically app-wide — `FOCUS_RING` (canonical
  `focus:outline-none focus:ring-2 focus:ring-ui-green`), `TRANSITION` (`transition-colors duration-150`),
  `PRESS` (`active:translate-y-px`), and `INTERACTIVE` = all three. Palette-safe by construction (no color but
  the brand ring; no shadow/gradient). ★ Apply ADDITIVELY — append the atom AFTER the control's own color
  classes; convert a plain-string `className` to a template literal. ★ Buttons get `${INTERACTIVE}`; FORM
  FIELDS (`<input>`/`<select>`/`<textarea>`) get `${FOCUS_RING} ${TRANSITION}` ONLY — never PRESS (a 1px
  translate on a field is wrong). ★ A control that ALREADY has a complete `focus:ring-2` keeps it — add motion
  only (`${TRANSITION} ${PRESS}`), don't re-add the ring. ★★ Do NOT override a BESPOKE SEMANTIC focus ring
  (invalid-state `ui-pink`, consent `ui-purple`, critical-path toggle) with the green `FOCUS_RING` — leave
  those, add motion only. ★ Weak legacy `focus:ring-1 focus:ring-ui-green` fragments are normalized to the
  `ring-2` standard. The shared report/table primitives (`Tile`/`SortHeaderButton`/`TableFilter` in
  `report-table.tsx`, `task-manager-ui.tsx` tabs/reset/print/sort) already carry the atoms.
- **Design-system primitives (USE these; do NOT hand-roll — see the no-handroll rule):** the
  DS-sprawl program (0.190.2–0.190.35) built a full primitive layer. Reach for the primitive
  (or adapt it); ASK before introducing a new control. Controls: `Button` (`button.tsx`;
  primary/secondary/ghost/destructive × xs/sm/md, `ref`-forwarding, `cursor-pointer` base, folds
  `AddButton`), `IconButton`/`TextButton` (icon-only / inline action-link, both ref-forwarding),
  `Input`/`Select`/`Textarea`/`Checkbox` (`form-controls.tsx`; `size` md/xs, `invalid` prop,
  `<Textarea autoGrow>`), `SegmentedControl`, `ToggleButton`. Surfaces: `Modal`/`ModalHeader`/
  `EditModalShell` (`modal.tsx` — owns backdrop + focus-trap/restore + Escape + topmost-only
  stack; default tint `MODAL_BACKDROP_CLASS` = `bg-ui-dark-blue/40`; initial focus seeds the FIRST
  focusable child, not the un-ringed root), `PopoverPanel` (portal dropdown), `Card` (polymorphic
  `as`), `Banner` (auto-derives live-region role from severity). Empty/table:
  `EmptyState`/`AddFirstItemButton`/`Skeleton`/`PanelSkeleton`, `DataTable` + `SortResizeTh`/
  `SortHeaderButton`/`ColumnResizeHandle`. Display: `RagDot`/`RagBadge`, `Badge`, `CountBadge`,
  `ProgressTrack`, `FieldError`/`ModalFieldError`/`FieldHint`, `InfoTooltip`, interaction atoms
  `INTERACTIVE`/`FOCUS_RING`/`TRANSITION`/`PRESS` (`interaction-styles.ts`). Link pickers:
  `EntityLinkPicker` (`entity-link-picker.tsx`). File dialogs: `FilePickerButton`
  (`file-picker-button.tsx`).
  ★★ **A VISUALLY-HIDDEN file input belongs to `FilePickerButton` and nothing else** (0.211.1) — a DS
  `Button` plus the `sr-only` input it owns. ★ Scope precisely: this does NOT ban every
  `<input type="file">`. A VISIBLE one is fine and `step0-import-panel.tsx` correctly keeps one (it is
  focusable, keyboard-operable and labelled — none of the three defects below can occur). The banned
  shape is specifically a HIDDEN input driven by a `<label>`. Three properties are load-bearing and each
  closes a real defect:
  the input is `sr-only` and NEVER `display:none` (a `display:none` input can't be clicked in every
  browser); it carries `tabIndex={-1}` + `aria-hidden` or it is a SECOND tab stop announcing the same
  accessible name as the Button (axe reports MISSING names, never DUPLICATED ones, so nothing automated
  catches that); and it is a real `<button>`, because a `<label>` is NOT focusable and a `focus:ring` on
  one can never render (WCAG 2.4.7 — axe has no focus-visibility rule either). It owns NO validation:
  `onFile` hands back the raw `File` and the caller keeps its own mime/size checks (see
  `branding-image-input.tsx`). ★ Do NOT hand-roll a `<label>`-wrapping-`sr-only-input` picker; that shape
  is what this replaced (`docs/open-followups.md` §15, §46). `chat-panel.tsx` still hand-rolls one with
  `display:none` — that is §47, not a precedent.
  ★★ **THREE link/chip pickers, one per problem — pick by shape, don't merge them:**
  `EntityLinkPicker` = chips + search dropdown over an UNBOUNDED set, entity-agnostic (caller maps its
  entity to a flat `LinkPickerEntry {id, code, label}` and OWNS both the query state and the option
  filtering — which is where its callers genuinely diverge: `TaskLinkPicker` filters by text alone,
  the RAID cause picker must also exclude self and any pick that would close a cycle). `TaskLinkPicker`
  is now a THIN task-flavoured wrapper around it, and `RaidCausedByField` renders it directly with
  `onOpen` (the click-through chip variant; the ↩ glyph rides `onOpen`'s presence, not a prop).
  `StakeholderChipPicker` stays SEPARATE — it renders EVERY item as a checkbox chip for a BOUNDED list,
  no search, no add/remove asymmetry. ★ `EntityLinkPicker` takes no `lang` and calls no `t()` — every
  string arrives translated. ★ the chip's remove button appends the entry's `code` to `removeLabel`, so
  N chips get row-UNIQUE names (WCAG 2.4.6); RAID's shipped with N identical "Clear" names because a
  single-chip fixture can never surface the collision. ★ the click-through chip pins `aria-label` explicitly
  — adjacent inline spans concatenate with NO separator, so name-from-content yielded "R#3Vendor delay".
  (Same fix applied to the read-only "caused this" children chips in `raid-edit-fields.tsx`, which had the
  identical bleed plus `text-ui-purple` → now `text-ui-purple-strong`.)
  ★★ That `-strong` swap was NOT a uniform win when it landed, and the caveat still applies to any OTHER
  `-strong` token: it repaired a real AA failure in the DARK schemes and in AIPM light/dark (the PINNED value)
  but was a literal NO-OP in Harbor/Meridian/Umber LIGHT, where `nudgeToAa` exited at zero iterations because
  the base already cleared 4.5 against `--surface-muted`. Don't assume `-strong` changes anything in a light
  scheme with no pinned value. (For PURPLE specifically this was then fixed at the source — see the
  `--ui-purple-strong` derivation note in the scheme section: its reference is no longer `--surface-muted`.)
  ★★ **The dropdown is a COMBOBOX and its rows ARE the options.** Input: `role="combobox"` +
  `aria-expanded`/`aria-controls`/`aria-activedescendant`/`aria-autocomplete="list"`; list: `role="listbox"`
  with `role="option"` `<li>`s carrying the click handler DIRECTLY. Do NOT put a `<button>` inside a
  `role="option"` — that is an axe **nested-interactive** violation, and the keyboard path is
  activedescendant, so the button buys nothing (mirrors `global-search-box.tsx`). ★ Highlight state is
  internal (view state) while `query` stays a CONTROLLED prop; it resets via a render-time reconcile keyed on
  the QUERY, never on the `options` identity — callers re-filter and hand a fresh array every render, so an
  identity-keyed reset would clear the highlight constantly and the arrow keys would never stick. It is also
  CLAMPED ON READ, which drops an OUT-OF-RANGE index only — an in-range index that now names a DIFFERENT
  entity is covered by the query-keyed reconcile above, not by the clamp (a caller that swapped `options`
  WITHOUT changing `query` would defeat both; none does today). ★★★ Escape calls `preventDefault()`, and THAT
  is what contains it: the shared `Modal`'s document-level handler bails on `e.defaultPrevented`.
  `stopPropagation` CANNOT contain it — React 19 delegates on `document` (Next passes `document` to
  `hydrateRoot`), the very node `Modal` listens on, and stopPropagation does not suppress a listener
  co-registered on the SAME node. ★ A test asserting "no document listener fired" PASSES anyway, because
  React Testing Library renders into a div under `body`, which puts React's listener on a DESCENDANT — a
  topology the real app never has. Assert `defaultPrevented` instead. Without the Modal-side bail, dismissing
  a dropdown ALSO closes the edit modal and discards the draft. ★★ Enter is claimed ONLY when an option is
  actually armed — these pickers live inside `<form>` edit modals where a bare Enter submits, so swallowing it
  whenever the list happens to be open silently breaks submitting from that field.
  ★ The remove button's name DIVERGES by branch: with `onOpen` it is `"<removeLabel> <code>"` (the chip body
  already announces the entity), without it, it is `"<removeLabel> <code> <label>"` — in the inert branch the ×
  is the chip's ONLY focusable element, so a code-only name tells a screen-reader user nothing about what they
  are unlinking. `title` stays the short `removeLabel` in both.
  ★ The extraction unified three incidental sizings onto RAID's values, so the TASK flavour changed slightly:
  chip row `mb-1`→`mb-2` + `items-center`, chip label `max-w-[160px]`→`max-w-[220px]`, dropdown
  `max-h-48`→`max-h-60`. Deliberate (they were differences with no reason), and it lands in all four
  `TaskLinkPicker` call sites — Knowledge cards, change modal, RAID linked tasks, budget bucket editor.
  ★★ LANDMINES: primitives concatenate `className` with NO tailwind-merge → a class that fights a
  variant/size PROP loses by CSS source-order (pick the right variant, don't override); ONLY
  `Button`/`IconButton`/`TextButton` forward `ref` — `Input`/`Select`/`Textarea` do NOT (a
  ref-needing field stays bespoke); `PopoverPanel` is RIGHT-ALIGN-ONLY + `onClose` must be a stable
  `useCallback` + `anchorRef`→the trigger button; a growable textarea needs `autoGrow` (the
  primitive forces `resize-none`). ★ Deliberately BESPOKE (not sprawl — don't migrate): help-menu
  (draggable window), project-switcher / ask-claude-menu (menu/dialog popovers), colConfig popover,
  filled-semantic one-offs (chat pink Stop, purple consent w/ bespoke ring).
- **Shared consolidation modules (Tier E, 0.190.39) — reuse these, do NOT re-hand-roll:**
  • **`device-store.ts`** = `readDeviceJson<T>(key, fallback)` / `writeDeviceJson(key, v)` / `removeDeviceKey(key)` —
  the SSR-guard + try/catch JSON envelope EVERY per-device `aipm-cockpit:*` store uses (the store keeps its OWN
  validation/cap/dedupe on the parsed result). ★ `writeDeviceJson` SWALLOWS quota throws — a store that must
  PROPAGATE a write failure (scheduled-jobs / operating-guide) keeps its own throwing writer and adopts device-store
  for READS only; a raw-non-JSON store (reminder-snooze stores a bare number) doesn't use it at all.
  • **`capped-list-store.ts`** = `createCappedListStore<T extends {id;name}>(key, max, sanitizeList, {capOnLoad?})`
  → `{load, add, remove, rename, save}` (`add` mints max-id+1, cap keeps the LAST `max`) built ON the device-store
  envelope; saved-views + reports-views adopt (`capOnLoad:true` vs default false). panel-views (per-VIEW cap) +
  search-recents (dedupe) stay bespoke — don't force them in.
  • **`ai-forced-call.ts`** = `runForcedToolCall({apiKey, model, system?, tools, toolName, messages, maxTokens, signal?})`
  — the ONE audited never-log one-shot forced-tool Anthropic envelope (key is header-ONLY; response body read only via
  sanitized `safeAiErrorType`/`safeAiErrorMessage`; `!ok`→`AiHttpError` with STATUS-only message; absent tool_use →
  `Error("parse")`). ★★ EVERY new one-shot forced-tool call routes its fetch through this (scheduled-job-analysis,
  weight-suggestion-call, task-dedup-call, committee report-call, digest-narrative, use-project-proposal already do);
  each caller keeps its OWN parse/ground/coerce. ★ the multi-turn agentic `callClaude` (chat) is NOT a forced call —
  do NOT fold it in.
  • **`use-draft-state.ts`** `useDraftState<T>(initial|null)` → `{draft, setDraft, update, error, setError}` — LOCAL-draft
  edit-modals only (absence/milestone/resource); the parent-owned-draft modals (change/raid/stakeholder call `onChange`,
  no local state) correctly do NOT use it. **`use-task-picker-options.ts`** `useTaskPickerOptions(tasks, selectedIds,
  query, extra?)` wraps `filterPickerOptions` for the change/raid task pickers (raid's self/cycle CAUSE picker stays
  separate). **`EntityPaneCalendarHintsProps`** / `EntityPaneHintsProps` interface mixin (`workspace-section-types.ts`)
  — change/raid extend calendar+hints, stakeholders is hints-ONLY (no calendar). **`guardTurso()`** = the
  isPopout+`tursoConfigNow`+toast preamble, a non-memoized local helper in `use-storage-turso-ops.ts` (switch keeps its
  extra `tursoProjectId===id` guard inline). jira **`parseIssueFields`** in `api/jira/_helpers.ts` (create/update issue
  routes share the field-sanitize; the SSRF/auth/URL guard stays per-route).
- **Empty + loading primitives:** `empty-state.tsx` `EmptyState` (presentational; `title`/`description`/
  `actions[]` props, i18n done by caller; CTA buttons carry `INTERACTIVE`; `compact` for inline card slots) —
  use it instead of a bare `<p>no data</p>` for true "no rows" messages (NOT `<td>`-cell or dashed-`<div>`
  card empties; the swap still renders the title text so `getByText` tests survive). `skeleton.tsx`
  `Skeleton` (decorative `animate-pulse` `bg-surface-muted` block, `aria-hidden`) + `PanelSkeleton`
  (full-pane loading placeholder over `VIEW_PANE_FILL_CLASS`). ★★ `PanelSkeleton` `lang` is OPTIONAL: WITH
  lang → `role="status"`+`aria-live` + sr-only translated label; WITHOUT → purely decorative `aria-hidden`
  shimmer (no announcement, but no worse than blank). `workspace-panels.tsx` wires the prop-less decorative
  variant as the `loading` fallback on all **23** lazy `dynamic()` view panels (so all are full-pane — don't wire
  it into a non-full-pane lazy mount). New i18n key `loading` (EN/DE).
- **Add-first-item empty state (clickable dashed box):** when an entity panel has ZERO items (truly empty,
  NOT filtered-empty), render a full-width clickable dashed `<button>` that adds the first item — NOT the
  `EmptyState` primitive. Style (shared by budget · gantt · milestones · changes · stakeholders · raid · open-points):
  `flex w-full flex-col items-center gap-2 rounded-(lg|md) border border-dashed border-line p-(6|10)
  text-center text-sm text-muted-foreground hover:border-ui-dark-blue hover:text-ui-dark-blue
  dark:hover:text-ui-light-grey ${INTERACTIVE}` with two spans: the descriptive empty text + a
  `font-medium` "+ <Add X>…" line; `onClick` = the panel's create handler (`openNew`/`addBucket`/`onAddTask`/
  `setTaskModalOpen(true)`). ★★ NO SOLID OUTER BOX: the box sits UNWRAPPED (gantt look) — the panel's
  bordered scroller (`INNER_TABLE_CLASS` / `rounded-(md|xl) border border-line`) is made CONDITIONAL
  (`className={count===0 ? undefined : SCROLLER}`) so it borders only the DATA view; the empty box is the
  scroller div's sole child at natural height. Gantt's DATA view IS bordered — only its empty state is
  unwrapped; mirror that. ★ RAID's box is category-filter-aware (`openNew(effectiveCategory)`) + carries the
  `raidAddItem` aria-label so it's the add affordance the inline-add tests click.
  ★ For TABLE panels (changes/stakeholders/raid/open-points) the box REPLACES the `<table>` (`{count===0 ? box : <table>}`),
  and the in-table FILTERED no-matches row stays (headers give context); the truly-empty `<td>` row is
  removed. ★ FILTERED-empty + popout (no create handler) fall back to the plain text box (gantt) or the
  no-matches row (tables) — never a dead add affordance. ★ Test gotcha: the box's "+ Add X…" text collides
  with the header add-button on a `getByRole("button",{name:/add x/i})` query — render WITH one item when
  asserting the header button. ★ Knowledge uses the clickable box too — it opens the add-link panel
  (`setAddOpen(true)`; manual-link entry needs no SharePoint). ★ Activity is fully FLAT: the data-view
  scroller has NO border (border dropped per request) and the empty/no-match states are natural-height dashed
  boxes (`flex-1` dropped) — read-only, no add affordance. ★ Steering
  committee is a FORM (no empty state) — its content scroller is flattened (border removed) always. This
  SUPERSEDES the older "use EmptyState, not a dashed-div" rule for the add-first-item case (EmptyState still
  stands for read-only "no data" messages).
- **Bulk edit (entity panels):** generic multi-row bulk edit shared across
  RAID/Milestones/Changes/Stakeholders. Pure `row-selection.ts` (set ops) +
  `use-row-selection.ts` (Set<number> selection, filter-aware select-all);
  `bulk-edit-bar.tsx` ("N selected" + toggle + clear); `bulk-edit-panel.tsx`
  (generic per-field enable-checkbox panel driven by a `BulkField[]` descriptor +
  `selectField`/`dateField`/`textField` builders; Apply emits ONLY ticked fields;
  entity logic stays in the caller's `onApply`). Each panel adds a checkbox column
  (row-unique `selectItem` labels + `selectAllVisibleRows`), the bar, and the
  panel; bump the empty/no-match/add-row `colSpan` by 1. No new persisted field —
  patches ride the existing single-item save path via `sanitizeX`.
  ★★ FUNCTIONAL-SETTER LANDMINE: bulk `applyBulk` LOOPS the single-item save handler
  N times in ONE tick. A handler that does `setX(<value from closure>)`
  (non-functional) makes every call read the SAME stale array → last write wins →
  all but one row silently dropped. EVERY entity save handler MUST use
  `setX(prev => …)`. Bit RAID/Changes/Stakeholders (Milestones was already
  functional); single-row tests + a mocked `onSave` hid it — regression-tested with
  a per-hook "N saves in one tick" test. ★ RAID Status is OMITTED from bulk
  (category-specific; `sanitizeRaidItem` silently defaults a mismatch).
- **`useResizable(storageKey)` inline-size beats class width:** the hook writes a saved `{width,height}` as
  an INLINE style, which OVERRIDES class `w-full`/width. Changing a resizable pane's DEFAULT size silently
  no-ops for anyone with a persisted size — BUMP the storageKey (e.g. `…-size` → `…-size-full`) so the stale
  size is discarded (pane stays resizable from the new baseline). Bit Milestones/Knowledge going full-width.
- **★★ `useColumnResize` persists ONLY user-dragged widths (v2, 0.212.0)** — `{v:2,widths}` where `widths`
  holds just the columns the user actually dragged, returned raw as `sizedWidths` beside the unchanged
  merged `colWidths` (37 other call sites across 17 files read `colWidths` and are untouched — count them
  as INVOCATIONS, not files: `raid-report-panel` alone holds 7 and `resources-report` 5). So a `*_COL_WIDTHS` default change
  now reaches a user who once dragged one unrelated column. ★★ BUT NOT retroactively, and the reason is a
  trap: the PRE-v2 persist effect had NO first-run guard, so it fired ~250ms after MOUNT and wrote the whole
  MERGED map — meaning a v1 blob is a full DEFAULTS SNAPSHOT, not a record of drags, and `readSized`
  promotes every key of it to user-set. A table carrying a v1 blob therefore still ignores its new defaults.
  Open Points escapes ONLY because its id was bumped `open-points` → `open-points-v2`; the other 37 tables
  did not (`docs/open-followups.md` §52). Bumping the tableId is the same remedy as the `useResizable`
  storage-key bump above, for the same reason. ★ An unrecognised VERSION reads as "no user widths" rather
  than falling through to the v1 branch — a `{v:3,widths:{…}}` spread verbatim would put a numeric `v` and
  an OBJECT-valued `widths` into a `Record<TId, number>`.
- **★★ Open Points table geometry — ONE auto column, computed minWidth (0.212.0).** The table is
  `tableLayout: fixed` + `width: 100%` + `minWidth: ${tableMinWidthPx(...)}px`. It was `width: max-content`
  + `minWidth: 100%`, so the table outgrew the sum of its declared columns and the browser spread the
  leftover across them. ★★ OBSERVED: gutter + `sel` + `status` rendered ~138px against 100px declared —
  about +12.7px EACH, invisible on a 200px column and a third again on a 36px one. `taskName` is now the
  SINGLE column that emits no `width` (only while un-sized — once dragged it declares one), so it absorbs
  the leftover. ★★ The exact distribution RULE is NOT verified: an equal-per-column split fits that one
  measurement and a proportional split does not, but it is an inference from a screenshot and nothing here
  can check it (CSS 2.1 §17.5.2.1 only says the excess "should be distributed over the columns"). The fix
  holds either way — an auto column takes the leftover before any fixed column does — so do NOT restate the
  mechanism as settled; measure it in DevTools first. An earlier revision of this bullet asserted
  "EQUALLY, NOT proportionally" at ★★★, which is exactly the unverifiable-claim shape this file warns about.
  ★★ DRAGGING `taskName` RE-ENABLES THE DEFECT: it then declares a width, no column is auto, and the edge
  padding comes back until "reset columns". Accepted — treating the drag as a floor while keeping the column
  auto makes the grip stop tracking the pointer, which reads as broken. ★ Do NOT restore `width: max-content`: with an
  auto column present it resolves against that column's longest unwrapped content — the longest task title
  — so the pane would scroll horizontally at all times. ★ Arithmetic lives in pure `open-points-table-geometry.ts`
  (`visibleTaskCols` · `colWidthStyle` · `tableMinWidthPx` · `GUTTER_WIDTH_PX` · `TASK_NAME_MIN_PX`), NOT in
  the pane, which sits at its size ratchet; the column list is the leaf `tasks-section-columns.ts`. ★ The
  pane's prop is `sizedWidths`, carrying the SIZED-ONLY map (an absent key is what lets `taskName` render
  width-free). ★★ It was briefly left named `colWidths` on the argument that renaming cost ratchet lines;
  that was wrong — a rename is net-zero — and the name matters: passing the DEFAULTS-FILLED map instead
  gives every column a width and silently reverts the flex layout. ★★★ THE GUARD IS THAT
  `useColumnManager` DOES NOT RETURN THE MERGED MAP — there is no `colWidths` binding anywhere in
  `task-manager.tsx` (grep it: zero occurrences), so `sizedWidths={colWidths}` is `TS2304 Cannot find
  name`, and `use-column-manager.test.ts` pins the omission with a `@ts-expect-error` that fails tsc as
  an unused directive if the key ever returns. ★★ DO NOT re-expose it on the argument that "the type
  wouldn't catch it anyway" — that much is true (`Record<string, number>` IS assignable to
  `Partial<Record<string, number>>`, proved with a standalone `tsc --strict`, exit 0), and it is exactly
  why the value must not be in scope. Two revisions of this bullet got this wrong in opposite directions:
  first claiming the type system catches it, then — after the removal made the guard real — still saying
  "the name is the only guard, and it is a human one". Both were false when written. ★ The
  leading gutter `<col>` renders from `GUTTER_WIDTH_PX`, never a `w-7` class, because `tableMinWidthPx`
  seeds its sum with that same constant and a class would let the two drift with nothing to catch it —
  jsdom sees neither.
- **Rounded table headers:** `TABLE_HEAD_CLASS` carries a `.aipm-cockpit-thead` marker; the Dark-Blue fill lives on
  `<th>` (NOT `<thead>`) via `globals.css` so rounded first/last corners clip it, with `border-spacing:0`.
  Don't move bg back to `<thead>` — a rounded `th` only clips a fill it paints.
- **Heavy browser-only deps** (rich-text editor, etc.) load via `next/dynamic({ ssr: false })` to stay off
  the main bundle; ProseMirror/Tiptap-style libs need `Range.getClientRects` + `getBoundingClientRect` jsdom
  stubs in tests. jsdom has NO layout engine — `scrollHeight`/`offsetHeight`/`getBoundingClientRect` all
  return 0, so measure-based UI (textarea autogrow, resize) must stub `scrollHeight` in its test
  (`Object.defineProperty(el, "scrollHeight", { configurable: true, value: N })`) — pixel-height assertion
  silently reads 0 otherwise.
- **M365 Graph** called client-side via `useMsAuth().acquireToken(scopes, { interactive })` —
  `interactive:true` pops an incremental-consent dialog for a new scope; background probes stay silent. New
  Graph host must be added to the CSP allowlist (above).

