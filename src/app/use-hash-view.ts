"use client";
import { useEffect, useLayoutEffect, useRef } from "react";
import { useWorkspaceTab } from "./workspace-tab-context";
import { buildHash, parseHash, type AppView } from "./nav-config";
import { isViewEnabled, type FeatureModuleId } from "./feature-modules";

function currentHash(): string {
  if (typeof window === "undefined") return "";
  return window.location.hash;
}

/**
 * True when the URL fragment is an MSAL auth response (`#code=…`/`#state=…`/
 * `#error=…`/`#id_token=…`). Such a fragment MUST be left untouched: the MSAL
 * popup lands on the app origin and its `handleRedirectPromise` reads the
 * fragment, broadcasts the response to the opener over a BroadcastChannel, and
 * closes the popup. If this hook rewrites the hash first (routing an unknown
 * slug to a default view), the response is destroyed and the sign-in popup
 * hangs open forever. A normal view hash (`#raid/123`) never has these keys.
 */
export function isAuthResponseHash(raw: string): boolean {
  const h = raw.charAt(0) === "#" ? raw.slice(1) : raw;
  if (!h) return false;
  const params = new URLSearchParams(h);
  return (
    params.has("code") ||
    params.has("state") ||
    params.has("error") ||
    params.has("id_token") ||
    params.has("session_state")
  );
}

/**
 * Two-way sync between the URL hash and the active view, for the MAIN window
 * only (popouts use ?popout= and must not be touched). Hash grammar is
 * `#<slug>[/<id>]`: a trailing numeric id deep-links a specific item via
 * requestOpen. On view change we only rewrite the hash when the BASE view
 * differs, so an existing `#raid/123` is preserved while the user stays on RAID.
 *
 * `enabled` gates the whole sync. The call site passes
 * `hydrated && layout === "modern"`: FALSE in Classic mode, and ALSO false
 * before settings hydrate. That second half is load-bearing — use-settings.ts
 * seeds defaultSettings (layout "modern") synchronously, so without it the cold
 * apply would fire on render 1 for every user, against default `features`
 * (§536, §595). Turning it back on is a LAYOUT RE-ENTRY, not a navigation:
 * the view stays, nothing is routed or opened, and the URL is rewritten to
 * the bare current view. Only the first enabled window of the PAGE LOAD
 * applies the cold rule (a view-only hash is stale residue → Dashboard; an
 * item-bearing hash is a deep link). See docs/open-followups.md §478.
 * `features` gates navigation to disabled-module views — if the hash points at
 * a view whose module is off, the hash is ignored (the redirect effect keeps
 * the user on a valid view and will rewrite the hash).
 *
 * IMPORTANT — why the view→hash write uses `history.replaceState` and not
 * `window.location.hash = …`: assigning to `location.hash` fires a `hashchange`
 * event, which this hook's own listener (`apply`) handles by calling
 * `setActiveTab`. That self-notification turns the two effects into a feedback
 * loop: every view→hash write re-enters hash→view, which can flip the view and
 * trigger another write. Because `hashchange` is a macrotask, React's
 * "maximum update depth" guard never trips, so the loop pegs the main thread
 * silently (blank page, no error). `replaceState` updates the URL without
 * firing `hashchange`; genuine back/forward navigation still fires it and is
 * still handled by `apply`.
 *
 * The mount effect registers BOTH `hashchange` and `popstate`, and
 * `replaceState` fires NEITHER — per spec `pushState`/`replaceState` never
 * fire `popstate`, which fires only on genuine session-history TRAVERSAL
 * (back/forward, `history.back()`, `history.go()`) between two entries for the
 * same document; `replaceState` creates no new entry and traverses nowhere. So
 * neither listener can re-enter from our own write, while real back/forward
 * still fires `popstate` and is still handled by `apply`.
 */
export function useHashView(enabled: boolean = true, features?: readonly FeatureModuleId[]): void {
  const { activeTab, setActiveTab, isPopout, requestOpen } = useWorkspaceTab();
  // ★★ TWO pieces of state, not one (docs/open-followups.md §478, option (c)):
  //    - `pageColdDoneRef` — has THIS PAGE LOAD's first enabled window run yet?
  //      Set once, NEVER reset (not by the disabled branch, not by a cleanup).
  //    - `windowActiveRef` — are we inside a contiguous enabled window? Reset
  //      ONLY by the disabled branch, so an effect CLEANUP (a dep change, or
  //      StrictMode's mount → unmount → remount) does not end the window.
  const pageColdDoneRef = useRef(false);
  const windowActiveRef = useRef(false);
  // Set by a layout RE-ENTRY; consumed by the view→hash effect below, which
  // is the one that can see the live `activeTab`.
  const reentryRepairRef = useRef(false);
  // ★★ Set by an apply that ROUTES to a DIFFERENT view; consumed by the view→
  //    hash effect below. setActiveTab does not commit until the next render,
  //    so the passive effect runs once with the OLD activeTab — it would then
  //    see the deep link's view as a mismatch and rewrite the URL to the old
  //    view, destroying `/123` (§535). Carries the TARGET view, not a bare
  //    boolean (fix round 1 follow-up): the passive effect suppresses only
  //    while its own `activeTab` has not yet caught up to that target
  //    (`pending !== activeTab`), so a warm apply whose target already EQUALS
  //    `activeTab` — a no-op `setActiveTab` — never arms this at all (armed-
  //    but-nothing-to-consume left the URL stale forever, and could swallow
  //    the NEXT genuine navigation's write too, since a no-op setActiveTab
  //    triggers no re-render and therefore no passive-effect run to consume
  //    the flag). One-shot, NOT "suppress until activeTab matches this specific
  //    value forever": each run reads and clears it exactly once.
  const pendingApplyRef = useRef<AppView | null>(null);
  // ★ The layout effect deliberately does NOT depend on `activeTab` (see its
  //   dep array below), so `apply` cannot compare its own routing target
  //   against a stale closed-over value — it needs the CURRENT activeTab at
  //   the moment it runs. Kept fresh by a DEDICATED layout effect with NO dep
  //   array (declared BEFORE the apply layout effect, so same-commit ordering
  //   guarantees this one runs first) rather than synced during render —
  //   eslint's `react-hooks/refs` rule rejects a ref write in the render body
  //   (`Cannot access refs during render`) — and rather than in a PASSIVE
  //   effect: a passive effect runs AFTER the apply layout effect on a commit
  //   where `features` and `activeTab` change together, so `apply` would still
  //   read the previous value on exactly the commits that matter most.
  const activeTabRef = useRef(activeTab);
  useLayoutEffect(() => {
    activeTabRef.current = activeTab;
  });

  // Mount + back/forward: hash drives the view (and any deep-linked item).
  useLayoutEffect(() => {
    if (!enabled || isPopout) {
      // ★★ A LAYOUT SWITCH IS NOT A NAVIGATION. While disabled (classic) this
      //    hook maintains nothing, but the hash is NOT frozen: `requestOpen`
      //    (workspace-tab-context.tsx) writes `#<view>/<id>` in any non-popout
      //    layout, so an item opened from global search during classic leaves
      //    an item-bearing hash behind. Coming back to modern must neither
      //    discard the user's view (the old re-armed cold rule sent them to the
      //    Dashboard) nor honour that stale hash (a lifetime latch reopened the
      //    item). So only the WINDOW flag is cleared here — the page-load flag
      //    stays set, and the next enabled run is a RE-ENTRY, which does not
      //    route at all (§478).
      windowActiveRef.current = false;
      reentryRepairRef.current = false;
      pendingApplyRef.current = null;
      return;
    }
    const apply = (cold: boolean) => {
      const raw = currentHash();
      // Leave an MSAL auth-response fragment intact for handleRedirectPromise —
      // routing it away would strand the sign-in popup open (see isAuthResponseHash).
      if (isAuthResponseHash(raw)) return;
      // Fresh open / no view encoded ("" or bare "#") lands on the Dashboard
      // home — but fall back to open-points (a guaranteed core view) if the
      // dashboard module is disabled, so the user is never stranded.
      const blank = raw === "" || raw === "#";
      const blankView: AppView = features && !isViewEnabled("dashboard", features) ? "open-points" : "dashboard";
      const parsed = blank ? { view: blankView, itemId: null } : parseHash(raw);
      // ★★ A COLD load treats a VIEW-ONLY hash as stale session residue: the
      //    view→hash effect below writes `#<view>` on every navigation, so the
      //    URL a browser restores (or a reload keeps) merely records where the
      //    last session ended. An ITEM-bearing hash is a real deep link and is
      //    honoured in full. Every LATER hashchange/popstate keeps the hash
      //    authoritative, so genuine back/forward navigation is untouched.
      //    KNOWN COST: a shared view-only link such as `#budget` now lands on
      //    the Dashboard. Item-bearing links — what people actually share to
      //    point at a thing — still work.
      const { view, itemId } =
        cold && !blank && parsed.itemId == null ? { view: blankView, itemId: null } : parsed;
      if (features && !isViewEnabled(view, features)) return; // disabled target: ignore the hash
      // Arm ONLY when this actually moves the tab — a target equal to the
      // CURRENT activeTab makes setActiveTab a no-op, which triggers no
      // re-render and therefore no passive-effect run to consume the flag
      // (see the ref's doc comment above).
      if (view !== activeTabRef.current) pendingApplyRef.current = view;
      setActiveTab(view);
      if (itemId != null) requestOpen(view, itemId);
    };
    // ★★ ONLY THE PAGE'S FIRST EXECUTED RUN IS COLD. This effect re-runs
    //    whenever `enabled`, `features` or the context callbacks change
    //    identity, and `apply` is NOT idempotent — a cold run discards a
    //    view-only hash (see the stale-residue rule above). The worst trigger
    //    is the async settings load: it commits `features:
    //    sanitizeFeatures(stored)`, a NEW array for any user with even one
    //    module disabled, so a second cold apply would fire mid-session and
    //    snap the user off whatever view they had navigated to. A re-run INSIDE
    //    the same enabled window is therefore a warm apply, exactly as before.
    // ★ The refs are set HERE, not at render time: the early return above means
    //   the first EXECUTED run need not be the first render (a page that loads
    //   in Classic returns early), and that run IS the page's cold load.
    // ★★ STRICTMODE: the dev double-invoke is mount → CLEANUP → mount, and the
    //    cleanup below touches neither ref, so the second invoke sees the
    //    window still active and takes the warm branch — it can never be
    //    mistaken for a re-entry (which would repair the URL and drop an
    //    item-bearing deep link's `/<id>`).
    if (!pageColdDoneRef.current) {
      apply(true);
      pageColdDoneRef.current = true;
    } else if (!windowActiveRef.current) {
      // RE-ENTRY (enabled false → true after the page's cold window already
      // ran): keep `activeTab`, route nothing, open nothing. The URL is
      // repaired to the bare current view by the view→hash effect.
      reentryRepairRef.current = true;
    } else {
      apply(false);
    }
    windowActiveRef.current = true;
    // MUST be this named wrapper, added and removed as the same reference:
    // passing `apply` directly hands the EVENT OBJECT in as `cold` (truthy),
    // making every later navigation a cold load.
    const onEvent = () => apply(false);
    window.addEventListener("hashchange", onEvent);
    window.addEventListener("popstate", onEvent);
    return () => {
      window.removeEventListener("hashchange", onEvent);
      window.removeEventListener("popstate", onEvent);
    };
  }, [enabled, isPopout, features, setActiveTab, requestOpen]);

  // View change: write the hash, but only when the BASE view differs — so an
  // existing "#raid/123" is not clobbered while we stay on RAID.
  // Uses replaceState (not `location.hash =`) so the write does NOT re-enter
  // the hashchange listener above — see the hook doc comment.
  useEffect(() => {
    // Consumed FIRST, above every early return (including the disabled/popout
    // one): a disabled or popout run of this effect must still clear the flag,
    // or it survives — armed and stale — into whatever run re-enables it. That
    // ordering was implicit before (the layout effect's own disabled branch
    // happened to clear it first, same commit) rather than pinned here.
    const pending = pendingApplyRef.current;
    pendingApplyRef.current = null;
    if (!enabled || typeof window === "undefined" || isPopout) return;
    const reentry = reentryRepairRef.current;
    reentryRepairRef.current = false;
    if (isAuthResponseHash(window.location.hash)) return; // don't clobber an MSAL response
    // An apply routed to `pending` in this commit; activeTab has not caught up
    // to it yet. Writing now would rewrite the URL to the view we are leaving
    // (§535). The apply's own requestOpen has already written `#<view>/<id>`
    // for an item-bearing hash, and the next run — once activeTab committed to
    // `pending` — finds `pending === activeTab`, falls through, and the
    // ordinary comparison below finds the hash already correct and writes
    // nothing.
    if (pending !== null && pending !== activeTab) return;
    // ★★ A layout re-entry writes the BARE view unconditionally: the base-view
    //    comparison below would keep a stale `#raid/123` whenever `activeTab`
    //    is already `raid` (§478).
    if (reentry) {
      const bare = buildHash(activeTab);
      if (window.location.hash !== bare) window.history.replaceState(null, "", bare);
      return;
    }
    const current = parseHash(window.location.hash);
    if (current.view !== activeTab) {
      window.history.replaceState(null, "", buildHash(activeTab));
    }
  }, [enabled, isPopout, activeTab]);
}
