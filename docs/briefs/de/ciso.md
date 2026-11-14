# KI-Kurzinformation für die Informationssicherheit (CISO)

## Auf einen Blick

Die KI sendet Projektinhalte an Anthropic oder an das Gateway der Organisation, aus dem Browser oder vom
Server der App (E4, *getestet (Unit)*; E5, *getestet (Unit)*). Das Modell liest Text, den andere geschrieben
haben, etwa angehängte E-Mails, aus Jira synchronisierte Aufgaben und für ein neues Projekt ausgewählte
Confluence-Seiten; der Chat macht aus seinen Antworten Änderungen, der Projektassistent füllt nur ein Formular
vor (E47, *getestet (Unit)*; E48, *im Code gelesen*; E49, *im Code gelesen*). Auf dem Relay-Weg setzt der
Server die
Schlüsselprüfung und die Ablehnung bei abgeschalteter KI durch (E7, *getestet (Unit)*; E19,
*getestet (Unit)*); auf dem direkten Weg besteht die Abschaltung aus der Content Security Policy der Seite und der
eigenen Prüfung der App, beide im Browser angewendet (E53, *getestet (Unit)*; E3, *getestet (Unit)*), sodass eine
veränderte Kopie dort nicht aufgehalten wird, und ein anderer Client mit demselben Schlüssel wird auf keinem
der beiden Wege aufgehalten (E52, *im Code gelesen*). Auch der
Personenschutz läuft im Browser, mit derselben Grenze (E15, *im Code gelesen*).

## Was hinausgeht und wer es freigibt

- **Aus dem Browser:** nur an die Hosts in der Content Security Policy der Seite, die der Server sendet und der
  Browser durchsetzt; api.anthropic.com steht nur auf dem direkten Weg bei eingeschalteter KI darin (E53,
  *getestet (Unit)*). Turso-, SharePoint- und OneDrive-Hosts sind per Platzhalter erlaubt, ebenso jeder lokale
  Port ([Browser-Hosts](appendix.md#browser-hosts); §800; E34, *im Code gelesen*).
- **Vom Server:** Das Relay leitet vier Anthropic-Header weiter, dazu das Gateway-Token, wenn eines gesetzt
  ist, und keine Cookies, und protokolliert weder Schlüssel noch Token, Inhalt oder URL (E6,
  *getestet (Unit)*); die übrigen [Server-Ziele](appendix.md#server-ziele) sind aufgeführt (E34,
  *im Code gelesen*).
- **Schlüssel:** Der Schlüssel jeder Person wird im Browser verschlüsselt gespeichert; zur Nutzung geladen,
  liegt er im Klartext im Speicher der Seite (E46, *getestet (Unit)*).
- **Personen:** Bei aktivem Schutz werden die Namen bekannter Personen sowie jede E-Mail-Adresse, jede gültige
  IBAN und jede Zahl in Form einer Telefonnummer vor dem Senden ersetzt, ein unbekannter Name aber so gesendet,
  wie er dasteht (E14, *getestet (Unit)*; E35, *im Code gelesen*).

## Was Sie steuern

- **Notschalter:** `ai` in `AIPM_DISABLED_INTEGRATIONS` lässt das Relay jeden Aufruf ablehnen (E19,
  *getestet (Unit)*) und nimmt api.anthropic.com aus der Policy (E53, *getestet (Unit)*); er wirkt nur auf
  diese Installation und widerruft keinen Schlüssel (E52, *im Code gelesen*).
- **Schlüssel:** Die Schlüsselbeschränkung lehnt auf dem Server Schlüssel anderer Organisationen oder
  Workspaces ab (E7, *getestet (Unit)*); ein Bestehen gilt bis zu 15 Minuten (E9, *getestet (Unit)*).
- **Eingeschleuste Anweisungen:** Solange eine angehängte Datei oder E-Mail im Chat ist, wartet jede
  vorgeschlagene Änderung auf einer Prüfkarte, außer der Optimierung der Arbeitspakete, die ihre eigene
  Vorschau öffnet (E47, *getestet (Unit)*). Eingefügter Text und Text, den der Chat über seine Werkzeuge liest,
  etwa aus Jira synchronisierte Aufgaben, lösen diese Prüfpflicht nicht aus (E48, *im Code gelesen*).
- **Installationsprogramm:** Jede Desktop-Version trägt eine SBOM, mit Attestierungen nur, solange das
  Repository öffentlich ist (E50, *im Code gelesen*); das Installationsprogramm ist nicht codesigniert (E51,
  *im Code gelesen*). `AIPM_DISABLE_UPDATE_CHECK` schaltet
  die Update-Prüfung der Desktop-App ab (E34, *im Code gelesen*).

## Noch nicht belegt / offene Lücken

1. **§797:** Text, den der Chat über seine Werkzeuge liest, löst die Prüfpflicht nicht aus (E48,
   *im Code gelesen*).
2. **§794:** Eine einzelne Änderung im Chat wird ohne Prüfkarte angewendet (E47, *getestet (Unit)*).
3. **§805:** Das Relay fügt das Gateway-Token für jeden Aufrufer hinzu, der den Server erreicht (E13,
   *im Code gelesen*).
4. **§487, §793:** Das Windows-Installationsprogramm ist unsigniert, und das Deinstallationsprogramm bliebe
   auch mit eingeschalteter Signierung unsigniert (E51, *im Code gelesen*).
5. **§800:** Die Policy erlaubt ganze Host-Familien per Platzhalter (E34, *im Code gelesen*).

## Was Sie vor einer Zusage prüfen oder verlangen sollten

- Setzen Sie auf einer Testinstallation `ai` und prüfen Sie, dass api.anthropic.com in der Policy der Seite
  fehlt und das Relay mit 503 ablehnt (E19, *getestet (Unit)*; E53, *getestet (Unit)*).
- Hängen Sie eine E-Mail mit einer Anweisung an und prüfen Sie, dass eine einzelne vorgeschlagene Änderung auf
  der Prüfkarte wartet. Schreiben Sie denselben Text dann in die Beschreibung eines synchronisierten
  Jira-Vorgangs und sehen Sie, dass eine einzelne gewöhnliche Änderung, die er auslöst, sofort angewendet wird;
  löschende oder einladende Vorschläge warten in beiden Fällen (E47, *getestet (Unit)*; E48, *im Code gelesen*).
- Stellen Sie den Server der App hinter Ihre eigene Zugangskontrolle: Das Relay prüft keinen Aufrufer und hat
  keine Begrenzung der Anfragen, und die Begrenzung der anderen Routen zählt nach einem Header, den der
  Aufrufer selbst setzen kann (§805, §806, §562; E13, *im Code gelesen*; E54, *im Code gelesen*).
- Prüfen Sie SBOM und Attestierungen der Version, die Sie installieren, und weisen Sie die Nutzenden auf die
  Warnung vor einem unbekannten Herausgeber hin (E50, *im Code gelesen*; E51, *im Code gelesen*).

## Weiterlesen

- [Anhang](appendix.md), mit den [Browser-Hosts](appendix.md#browser-hosts), den
  [Server-Zielen](appendix.md#server-ziele) und den [Betriebsschaltern](appendix.md#betriebsschalter).
- Das [Sicherheitsmodell](../../security.md) (englisch) und der [Betriebsleitfaden](../../RUNBOOK.md)
  (englisch).
- [TOM-Übersicht](../../compliance/de/tom-sheet.md) und
  [Berührungspunkte mit dem Maintainer](../../compliance/de/vendor-touchpoints.md).
- Die anderen Kurzinformationen: [CEO](ceo.md), [CIO](cio.md), [DSB](dpo.md).
