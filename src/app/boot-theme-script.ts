// Pre-paint no-flash boot script (a stringified IIFE injected in layout.tsx).
// It reads the per-device style/theme/scheme localStorage keys and applies
// `data-style` + `.dark` + the active scheme's inline COLOR and STRUCTURAL
// token overrides BEFORE first paint. `data-style` is now ALWAYS "custom"
// (AIPM/Mockup are built-in schemes; the constant style axis is "custom").
//
// No-flash guarantee — STRUCTURAL replay: a scheme with shadows/gradient
// (e.g. Mockup) is painted from `aipm-cockpit-active-scheme-structural` so
// shadowed chrome doesn't flash unstyled on reload.
//
// The BASE fallback (no mirrored boot color key present) is Beacon — the
// fresh-install default scheme, LIGHT-ONLY. AIPM/Mockup are no longer embedded
// here: they are shipped importable theme files (built-in schemes) that
// use-style resolves at runtime and mirrors into
// `aipm-cockpit-active-scheme-colors`; a returning user always paints
// pre-paint from that mirrored key. The only map computed from source into
// this string is Beacon light — there is no dark fallback to choose between,
// since Beacon has no dark map; `schemeDark` defaults to `false` (not `true`)
// when no mirrored colors exist yet, matching Beacon's `supportsDark: false`.
//
// ★★ Keep the pin-light rule in lockstep with the two runtime sites:
//    style-ci.effectiveDark + use-theme's apply(). A scheme honours the theme
//    ONLY when it is dark-capable; Beacon (light-only) always pins light.
// ★★ The structural injection-guard here MIRRORS scheme-apply's
//    isSafeRawCssValue (length cap + charset allowlist + dangerous-substring
//    denylist, incl. `url` with optional whitespace before the paren).
//    (layout-boot-script.test.ts eval's + pins this string.)
import { BEACON_LIGHT } from "./builtin-schemes";
import { resolveSchemeColors } from "./scheme-tokens";

const BEACON_LIGHT_COLORS = JSON.stringify(resolveSchemeColors(BEACON_LIGHT));

export const NO_FLASH_THEME_SCRIPT = `(function(){try{document.documentElement.setAttribute("data-style","custom");var t=localStorage.getItem("aipm-cockpit-theme")||"system";var themeDark=t==="dark"||(t==="system"&&window.matchMedia("(prefers-color-scheme: dark)").matches);var rawC=localStorage.getItem("aipm-cockpit-active-scheme-colors");var rawS=localStorage.getItem("aipm-cockpit-active-scheme-structural");var rawSupports=localStorage.getItem("aipm-cockpit-scheme-supports-dark");var schemeDark=rawC?(rawSupports==="1"):false;var colors=rawC?JSON.parse(rawC):${BEACON_LIGHT_COLORS};var structural=rawS?JSON.parse(rawS):{};var d=themeDark&&schemeDark;document.documentElement.setAttribute("data-scheme-dark",schemeDark?"1":"0");document.documentElement.classList.toggle("dark",d);var el=document.documentElement;for(var k in colors){if(Object.prototype.hasOwnProperty.call(colors,k)&&typeof colors[k]==="string"&&/^--[\\w-]+$/.test(k)&&/^#[0-9a-fA-F]{3,8}$/.test(colors[k])){el.style.setProperty(k,colors[k]);}}for(var j in structural){if(Object.prototype.hasOwnProperty.call(structural,j)&&typeof structural[j]==="string"&&structural[j].length<=256&&/^--[\\w-]+$/.test(j)&&/^[\\w\\s#.,%()/-]+$/.test(structural[j])&&!/url\\s*\\(|expression|image-set|[;{}@<>\\\\]/i.test(structural[j])){el.style.setProperty(j,structural[j]);}}}catch(e){}})();`;
