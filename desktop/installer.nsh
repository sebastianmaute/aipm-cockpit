; Included by electron-builder into the NSIS installer (`nsis.include` in electron-builder.yml).
;
; A welcome page that says up front that installing takes a while. The install unpacks thousands of
; small files (the Next.js server and its node_modules), and on a machine that scans each new file
; the progress bar can stand still long enough to look like a hang; a user who closes the window
; then gets a half-installed app. Updates install silently (electron-updater runs this installer
; with /S), so they never show this page; the app's own "Update available" and "Update ready"
; windows carry the same warning (desktop/src/lib/update-window.ts, desktop/src/updater.ts).
;
; Then the privacy statement (desktop/installer-privacy.txt, the same text as the README's
; "Privacy statement"), on a stock Modern UI 2 license page with its own header and a Next button,
; so nothing has to be accepted. Silent updates skip it too.
;
; ★ electron-builder's assisted installer inserts this macro in place of a welcome page of its own
; (it has none otherwise: assistedInstaller.nsh, `!ifmacrodef customWelcomePage`). MUI2 is
; included before that point, so the MUI defines below apply to these two pages alone.
; ★ makensis reads the text file when it compiles the setup, from PROJECT_DIR (electron-builder
; defines it as the desktop/ directory), so a missing file fails the build, never an install. Keep
; the file plain ASCII, which reads the same in whichever encoding makensis assumes for it.
!define AIPM_PRIVACY_FILE "${PROJECT_DIR}\installer-privacy.txt"

!macro customWelcomePage
  !define MUI_WELCOMEPAGE_TEXT "Setup will install ${PRODUCT_NAME} on your computer.$\r$\n$\r$\nInstalling takes a few minutes. At times the progress bar may stand still and the window may seem frozen. This is normal: please wait, and do not close it.$\r$\n$\r$\nClick Next to continue."
  !insertmacro MUI_PAGE_WELCOME

  !define MUI_PAGE_HEADER_TEXT "Privacy"
  !define MUI_PAGE_HEADER_SUBTEXT "What ${PRODUCT_NAME} sends, and to whom."
  !define MUI_LICENSEPAGE_TEXT_TOP "How the app handles your data:"
  !define MUI_LICENSEPAGE_TEXT_BOTTOM "Click Next to continue."
  !define MUI_LICENSEPAGE_BUTTON "$(^NextBtn)"
  !insertmacro MUI_PAGE_LICENSE "${AIPM_PRIVACY_FILE}"
!macroend
