// Pre-paint no-flash boot script (a stringified IIFE injected in layout.tsx).
// It reads the per-device style/theme/scheme localStorage keys and applies
// `data-style` + `.dark` + the active custom scheme's inline token overrides
// BEFORE first paint. A fresh visitor (no `lop-style`) defaults to the Harbor
// scheme (dark-capable) so the very first load already shows the default look —
// the embedded Harbor maps are COMPUTED FROM SOURCE at module load (no drift).
//
// ★★ Keep the pin-light rule in lockstep with the two runtime sites:
//    style-ci.effectiveDark + use-theme's apply(). custom honours the theme
//    ONLY when the active scheme is dark-capable; mockup always pins light.
//    (layout-boot-script.test.ts pins this string.)
import { HARBOR_DARK, HARBOR_LIGHT } from "./builtin-schemes";
import { resolveSchemeColors } from "./scheme-tokens";

const HARBOR_LIGHT_COLORS = JSON.stringify(resolveSchemeColors(HARBOR_LIGHT));
const HARBOR_DARK_COLORS = JSON.stringify(resolveSchemeColors(HARBOR_DARK));

export const NO_FLASH_THEME_SCRIPT = `(function(){try{var st=localStorage.getItem("lop-style");var fresh=(st!=="AIPM"&&st!=="mockup"&&st!=="custom");var s=fresh?"custom":st;document.documentElement.setAttribute("data-style",s);var t=localStorage.getItem("lop-theme")||"system";var d=t==="dark"||(t==="system"&&window.matchMedia("(prefers-color-scheme: dark)").matches);var schemeDark=fresh?true:localStorage.getItem("lop-scheme-supports-dark")==="1";if(s==="mockup"){d=false;}if(s==="custom"&&!schemeDark){d=false;}document.documentElement.setAttribute("data-scheme-dark",schemeDark?"1":"0");document.documentElement.classList.toggle("dark",d);if(s==="custom"){var raw=localStorage.getItem("lop-active-scheme-colors");var m=raw?JSON.parse(raw):(d?${HARBOR_DARK_COLORS}:${HARBOR_LIGHT_COLORS});for(var k in m){if(Object.prototype.hasOwnProperty.call(m,k)&&typeof m[k]==="string"){document.documentElement.style.setProperty(k,m[k]);}}}}catch(e){}})();`;
