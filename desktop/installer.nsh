; Included by electron-builder into the NSIS installer (`nsis.include` in electron-builder.yml).
;
; A welcome page that says up front that installing takes a while. The install unpacks thousands of
; small files (the Next.js server and its node_modules), and on a machine that scans each new file
; the progress bar can stand still long enough to look like a hang; a user who closes the window
; then gets a half-installed app. Updates install silently (electron-updater runs this installer
; with /S), so they never show this page; the app's own "Update available" and "Update ready"
; windows carry the same warning (desktop/src/lib/update-window.ts, desktop/src/updater.ts).
;
; ★ electron-builder's assisted installer inserts this macro in place of a welcome page of its own
; (it has none otherwise: assistedInstaller.nsh, `!ifmacrodef customWelcomePage`). MUI2 is
; included before that point, so the MUI defines below apply to this page alone.
!macro customWelcomePage
  !define MUI_WELCOMEPAGE_TEXT "Setup will install ${PRODUCT_NAME} on your computer.$\r$\n$\r$\nInstalling takes a few minutes. At times the progress bar may stand still and the window may seem frozen. This is normal: please wait, and do not close it.$\r$\n$\r$\nClick Next to continue."
  !insertmacro MUI_PAGE_WELCOME
!macroend
