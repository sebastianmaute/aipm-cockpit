// Pre-paint no-flash boot script (a stringified IIFE injected in layout.tsx).
// It reads the per-device style/theme/scheme localStorage keys and applies
// `data-style` + `.dark` + the active scheme's inline COLOR and STRUCTURAL
// token overrides BEFORE first paint. `data-style` is now ALWAYS "custom"
// (AIPM/Mockup are built-in schemes; the constant style axis is "custom").
//
// Two no-flash guarantees:
//  1. STRUCTURAL replay — a scheme with shadows/gradient (Mockup) is painted
//     from `lop-active-scheme-structural` (or the embedded map on legacy first
//     boot) so shadowed chrome doesn't flash unstyled on reload.
//  2. LEGACY-FIRST-BOOT fallback — users still on the OLD `lop-style="AIPM"`/
//     "mockup" (pre-scheme-migration) have NOT been migrated by use-style yet
//     on their first post-upgrade boot (runtime migration runs AFTER paint), so
//     we embed the resolved AIPM/Mockup maps and paint them directly — no
//     one-frame Harbor flash before use-style snaps in.
//
// All embedded maps are COMPUTED FROM SOURCE at module load (no drift).
//
// ★★ Keep the pin-light rule in lockstep with the two runtime sites:
//    style-ci.effectiveDark + use-theme's apply(). A scheme honours the theme
//    ONLY when it is dark-capable; Mockup (light-only) always pins light.
// ★★ The structural injection-guard here MIRRORS scheme-apply's
//    isSafeRawCssValue (length cap + charset allowlist + dangerous-substring
//    denylist, incl. `url` with optional whitespace before the paren).
//    (layout-boot-script.test.ts eval's + pins this string.)
import { HARBOR_DARK, HARBOR_LIGHT, ICC_DARK, ICC_LIGHT, MOCKUP_LIGHT } from "./builtin-schemes";
import { ICC_STRUCTURAL, MOCKUP_STRUCTURAL, resolveSchemeColors } from "./scheme-tokens";

const HARBOR_LIGHT_COLORS = JSON.stringify(resolveSchemeColors(HARBOR_LIGHT));
const HARBOR_DARK_COLORS = JSON.stringify(resolveSchemeColors(HARBOR_DARK));
const ICC_LIGHT_COLORS = JSON.stringify(resolveSchemeColors(ICC_LIGHT));
const ICC_DARK_COLORS = JSON.stringify(resolveSchemeColors(ICC_DARK));
const MOCKUP_LIGHT_COLORS = JSON.stringify(resolveSchemeColors(MOCKUP_LIGHT));
const ICC_STRUCTURAL_JSON = JSON.stringify(ICC_STRUCTURAL);
const MOCKUP_STRUCTURAL_JSON = JSON.stringify(MOCKUP_STRUCTURAL);

export const NO_FLASH_THEME_SCRIPT = `(function(){try{var st=localStorage.getItem("lop-style");var legacyIcc=st==="AIPM";var legacyMockup=st==="mockup";document.documentElement.setAttribute("data-style","custom");var t=localStorage.getItem("lop-theme")||"system";var themeDark=t==="dark"||(t==="system"&&window.matchMedia("(prefers-color-scheme: dark)").matches);var rawC=localStorage.getItem("lop-active-scheme-colors");var rawS=localStorage.getItem("lop-active-scheme-structural");var schemeDark,colors,structural;if(legacyMockup){schemeDark=false;colors=rawC?JSON.parse(rawC):${MOCKUP_LIGHT_COLORS};structural=rawS?JSON.parse(rawS):${MOCKUP_STRUCTURAL_JSON};}else if(legacyIcc){schemeDark=true;colors=rawC?JSON.parse(rawC):(themeDark?${ICC_DARK_COLORS}:${ICC_LIGHT_COLORS});structural=rawS?JSON.parse(rawS):${ICC_STRUCTURAL_JSON};}else{var rawSupports=localStorage.getItem("lop-scheme-supports-dark");schemeDark=rawC?(rawSupports==="1"):true;colors=rawC?JSON.parse(rawC):((themeDark&&schemeDark)?${HARBOR_DARK_COLORS}:${HARBOR_LIGHT_COLORS});structural=rawS?JSON.parse(rawS):{};}var d=themeDark&&schemeDark;document.documentElement.setAttribute("data-scheme-dark",schemeDark?"1":"0");document.documentElement.classList.toggle("dark",d);var el=document.documentElement;for(var k in colors){if(Object.prototype.hasOwnProperty.call(colors,k)&&typeof colors[k]==="string"&&/^--[\\w-]+$/.test(k)&&/^#[0-9a-fA-F]{3,8}$/.test(colors[k])){el.style.setProperty(k,colors[k]);}}for(var j in structural){if(Object.prototype.hasOwnProperty.call(structural,j)&&typeof structural[j]==="string"&&structural[j].length<=256&&/^--[\\w-]+$/.test(j)&&/^[\\w\\s#.,%()/-]+$/.test(structural[j])&&!/url\\s*\\(|expression|image-set|[;{}@<>\\\\]/i.test(structural[j])){el.style.setProperty(j,structural[j]);}}}catch(e){}})();`;
