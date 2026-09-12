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
 * `enabled` gates the whole sync — pass false in Classic mode.
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
  const coldDoneRef = useRef(false);

  // Mount + back/forward: hash drives the view (and any deep-linked item).
  useLayoutEffect(() => {
    if (!enabled || isPopout) {
      // ★★ RE-ARM, don't just bail. While disabled this hook maintains nothing,
      //    so the hash freezes at whatever the last enabled window wrote and is
      //    unmaintained residue by the time we come back — i.e. the NEXT
      //    activation is a fresh cold load. Latching the ref once for the
      //    hook's lifetime reintroduced the very defect it fixes by another
      //    route (modern → classic → modern honoured the frozen hash and
      //    yanked the user off their current view). "Cold" therefore means the
      //    first apply of each CONTIGUOUS enabled window.
      coldDoneRef.current = false;
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
      setActiveTab(view);
      if (itemId != null) requestOpen(view, itemId);
    };
    // ★★ ONLY THE FIRST EXECUTED RUN IS COLD. This effect re-runs whenever
    //    `enabled`, `features` or the context callbacks change identity, and
    //    `apply` is NOT idempotent any more — a cold run discards a view-only
    //    hash (see the stale-residue rule above). The worst trigger is the
    //    async settings load: it commits `features: sanitizeFeatures(stored)`,
    //    a NEW array for any user with even one module disabled, so without
    //    this ref a second cold apply fires mid-session and snaps the user off
    //    whatever view they had navigated to, back to the Dashboard. A layout
    //    switch (`enabled`) and a project switch (new `features`) do the same.
    // ★ The ref is set HERE, not at render time: the early return above means
    //   the first EXECUTED run need not be the first render (Classic mode
    //   returns early), and that run IS that window's cold load.
    apply(!coldDoneRef.current);
    coldDoneRef.current = true;
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
    if (!enabled || typeof window === "undefined" || isPopout) return;
    if (isAuthResponseHash(window.location.hash)) return; // don't clobber an MSAL response
    const current = parseHash(window.location.hash);
    if (current.view !== activeTab) {
      window.history.replaceState(null, "", buildHash(activeTab));
    }
  }, [enabled, isPopout, activeTab]);
}
