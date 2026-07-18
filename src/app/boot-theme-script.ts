// Pre-paint no-flash boot script (a stringified IIFE injected in layout.tsx).
// It reads the per-device style/theme/scheme localStorage keys and applies
// `data-style` + `.dark` + the active scheme's inline COLOR and STRUCTURAL
// token overrides BEFORE first paint. `data-style` is now ALWAYS "custom"
// (AIPM/Mockup are built-in schemes; the constant style axis is "custom").
//
// The IIFE FIRST runs a synchronous storage-namespace rename (legacy `lop-app:`
// / `lop-*` keys → `aipm-cockpit:` / `aipm-cockpit-*`), mirroring
// storage-migration.migrateLocalStorage — it can't import that TS module (this
// is a stringified pre-hydration IIFE), so the rename is duplicated here on
// purpose and kept in lockstep. It then reads the NEW key names.
//
// No-flash guarantee — STRUCTURAL replay: a scheme with shadows/gradient
// (e.g. Mockup) is painted from `aipm-cockpit-active-scheme-structural` so
// shadowed chrome doesn't flash unstyled on reload.
//
// The BASE fallback (no mirrored boot color key present) is Harbor — the
// fresh-install default scheme. AIPM/Mockup are no longer embedded here: they
// are shipped importable theme files (built-in schemes) that use-style resolves
// at runtime and mirrors into `aipm-cockpit-active-scheme-colors`; a returning
// user always paints pre-paint from that mirrored key. The only maps computed
// from source into this string are Harbor light/dark.
//
// ★★ Keep the pin-light rule in lockstep with the two runtime sites:
//    style-ci.effectiveDark + use-theme's apply(). A scheme honours the theme
//    ONLY when it is dark-capable; Mockup (light-only) always pins light.
// ★★ The structural injection-guard here MIRRORS scheme-apply's
//    isSafeRawCssValue (length cap + charset allowlist + dangerous-substring
//    denylist, incl. `url` with optional whitespace before the paren).
//    (layout-boot-script.test.ts eval's + pins this string.)
import { HARBOR_DARK, HARBOR_LIGHT } from "./builtin-schemes";
import { resolveSchemeColors } from "./scheme-tokens";

const HARBOR_LIGHT_COLORS = JSON.stringify(resolveSchemeColors(HARBOR_LIGHT));
const HARBOR_DARK_COLORS = JSON.stringify(resolveSchemeColors(HARBOR_DARK));

export const NO_FLASH_THEME_SCRIPT = `(function(){try{var LS=localStorage;var mv=function(o,n){if(LS.getItem(n)!==null){LS.removeItem(o);return;}var v=LS.getItem(o);if(v===null)return;LS.setItem(n,v);LS.removeItem(o);};var mk=[],mi;for(mi=0;mi<LS.length;mi++){var kk=LS.key(mi);if(kk)mk.push(kk);}for(mi=0;mi<mk.length;mi++){if(mk[mi].indexOf("lop-app:")===0)mv(mk[mi],"aipm-cockpit:"+mk[mi].slice(8));}mv("lop-style","aipm-cockpit-style");mv("lop-theme","aipm-cockpit-theme");mv("lop-active-scheme-colors","aipm-cockpit-active-scheme-colors");mv("lop-active-scheme-structural","aipm-cockpit-active-scheme-structural");mv("lop-scheme-supports-dark","aipm-cockpit-scheme-supports-dark");document.documentElement.setAttribute("data-style","custom");var t=localStorage.getItem("aipm-cockpit-theme")||"system";var themeDark=t==="dark"||(t==="system"&&window.matchMedia("(prefers-color-scheme: dark)").matches);var rawC=localStorage.getItem("aipm-cockpit-active-scheme-colors");var rawS=localStorage.getItem("aipm-cockpit-active-scheme-structural");var rawSupports=localStorage.getItem("aipm-cockpit-scheme-supports-dark");var schemeDark=rawC?(rawSupports==="1"):true;var colors=rawC?JSON.parse(rawC):((themeDark&&schemeDark)?${HARBOR_DARK_COLORS}:${HARBOR_LIGHT_COLORS});var structural=rawS?JSON.parse(rawS):{};var d=themeDark&&schemeDark;document.documentElement.setAttribute("data-scheme-dark",schemeDark?"1":"0");document.documentElement.classList.toggle("dark",d);var el=document.documentElement;for(var k in colors){if(Object.prototype.hasOwnProperty.call(colors,k)&&typeof colors[k]==="string"&&/^--[\\w-]+$/.test(k)&&/^#[0-9a-fA-F]{3,8}$/.test(colors[k])){el.style.setProperty(k,colors[k]);}}for(var j in structural){if(Object.prototype.hasOwnProperty.call(structural,j)&&typeof structural[j]==="string"&&structural[j].length<=256&&/^--[\\w-]+$/.test(j)&&/^[\\w\\s#.,%()/-]+$/.test(structural[j])&&!/url\\s*\\(|expression|image-set|[;{}@<>\\\\]/i.test(structural[j])){el.style.setProperty(j,structural[j]);}}}catch(e){}})();`;
