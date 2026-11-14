# KI-Kurzinformation für die Informationssicherheit (CISO)

*So lesen Sie diese Seite:* `E<n>` ist eine Zeile der [Belegtabelle](appendix.md#belegtabelle); ihre
[Belegart](appendix.md#belegarten) ist *gemessen*, *getestet (Unit)* (ein Test mit Attrappen, kein Lauf gegen
echte Dienste), *getestet (Live-Datenbank)*, *im Code gelesen* (niemand hat es ausgeführt), *geschätzt* oder
*nicht belegt*. `§N` ist ein offener Eintrag im öffentlichen [Register](../../open-followups.md) (englisch) des
Projekts, aufgeführt unter [Offene Lücken](appendix.md#offene-lücken).

## Auf einen Blick

Die KI sendet Projektinhalte direkt aus dem Browser an Anthropic (der direkte Weg) oder über den Server der App
und, wenn eines gesetzt ist, das Gateway der Organisation (der Relay-Weg;
[Diagramm](appendix.md#zwei-wege-zum-modell)) (E4, *getestet (Unit)*; E5, *getestet (Unit)*). Das Modell liest
Text, den andere geschrieben haben, etwa angehängte E-Mails, aus Jira synchronisierte Aufgaben und für ein
neues Projekt ausgewählte Confluence-Seiten; der Chat macht aus seinen Antworten Änderungen, der
Projektassistent füllt nur ein Formular vor (E47, *getestet (Unit)*; E48, *im Code gelesen*; E49,
*im Code gelesen*). Auf dem Relay-Weg lehnt der Server Aufrufe ab, solange die KI abgeschaltet ist (E19,
*getestet (Unit)*), und führt, wenn eine Schlüsselbeschränkung gesetzt ist, die Schlüsselprüfung aus (E7,
*getestet (Unit)*); auf dem direkten Weg besteht die Abschaltung aus der Content Security Policy der Seite und
der eigenen Prüfung der App, beide im Browser angewendet (E53, *getestet (Unit)*; E3, *getestet (Unit)*), sodass
eine veränderte Kopie dort nicht aufgehalten wird, und ein anderer Client mit demselben Schlüssel wird auf keinem
der beiden Wege aufgehalten (E52, *im Code gelesen*). Auch der Personenschutz läuft im Browser, mit derselben
Grenze (E15, *im Code gelesen*). Diese Kurzinformationen verweisen auf keine unabhängige Sicherheitsbewertung
der App.

## Was hinausgeht und wer es freigibt

- **Aus dem Browser:** nur an die Hosts in der Content Security Policy der Seite, die der Server sendet und der
  Browser durchsetzt; api.anthropic.com steht nur auf dem direkten Weg bei eingeschalteter KI darin (E53,
  *getestet (Unit)*). Turso-, SharePoint- und OneDrive-Hosts sind per Platzhalter erlaubt, ebenso jeder lokale
  Port ([Browser-Hosts](appendix.md#browser-hosts); §800; E34, *im Code gelesen*).
- **Vom Server:** Das Relay leitet vier Anthropic-Header weiter, dazu das Gateway-Token, wenn eines gesetzt
  ist, und keine Cookies, und protokolliert weder Schlüssel noch Token, Inhalt oder URL (E6,
  *getestet (Unit)*); die übrigen [Server-Ziele](appendix.md#server-ziele) sind aufgeführt. Updates kommen aus den
  GitHub-Releases des Projekts; ein Update installiert also dieselbe unsignierte Installationsdatei wie die
  erste Installation (E34, *im Code gelesen*; E51, *im Code gelesen*).
- **Schlüssel:** Der Schlüssel der Nutzenden wird im Browser verschlüsselt gespeichert; zur Nutzung geladen,
  liegt er im Klartext im Speicher der Seite (E46, *getestet (Unit)*).
- **Personen:** Bei aktivem *Personenschutz* werden die Namen bekannter Personen (einwortige Namen nur dort, wo
  sie großgeschrieben sind) sowie jede E-Mail-Adresse, jede gültige IBAN und jede Zahl in Form einer
  Telefonnummer vor dem Senden ersetzt, ein unbekannter Name aber so gesendet, wie er dasteht (E14,
  *getestet (Unit)*; E35, *im Code gelesen*).

## Was Sie steuern

- **Notschalter für diese Installation:** `ai` in `AIPM_DISABLED_INTEGRATIONS` lässt das Relay jeden Aufruf
  ablehnen (E19, *getestet (Unit)*) und nimmt api.anthropic.com aus der Policy (E53, *getestet (Unit)*); er
  wirkt nur auf diese Installation und widerruft keinen Schlüssel (E52, *im Code gelesen*).
- **Schlüssel:** Die Schlüsselbeschränkung lehnt auf dem Server Schlüssel anderer Organisationen oder
  Workspaces ab (E7, *getestet (Unit)*); eine *bestandene Prüfung* merkt sich der Server, und sie bleibt bis zu
  15 Minuten gültig (E9, *getestet (Unit)*).
- **Gateway:** lief noch nie gegen ein echtes Gateway, ist also noch keine Kontrolle, auf die Sie sich verlassen
  können (§802; E12, *nicht belegt*).
- **Über Anhänge eingeschleuste Anweisungen:** Solange eine angehängte Datei oder E-Mail im Chat ist, wartet
  jede vorgeschlagene Änderung auf einer Prüfkarte, außer der Optimierung der Arbeitspakete, die ihre eigene
  Vorschau öffnet (E47, *getestet (Unit)*). Eingefügter Text und Text, den der Chat über seine Werkzeuge liest,
  etwa eine aus Jira synchronisierte Aufgabe, lösen diese Prüfpflicht nicht aus (§797; E48, *im Code gelesen*).
- **Installationsdatei:** Jede Desktop-Version trägt eine SBOM, mit Herkunftsnachweisen (Attestierungen) nur,
  solange das Repository öffentlich ist (E50, *im Code gelesen*); die Installationsdatei ist nicht codesigniert
  (E51, *im Code gelesen*). `AIPM_DISABLE_UPDATE_CHECK` schaltet die Update-Prüfung der Desktop-App ab (E34,
  *im Code gelesen*).

## Noch nicht belegt / offene Lücken

1. **§797:** Text, den der Chat über seine Werkzeuge liest, löst die Prüfpflicht nicht aus (E48,
   *im Code gelesen*).
2. **§794:** Eine einzelne Änderung im Chat wird ohne Prüfkarte angewendet (E47, *getestet (Unit)*).
3. **§805:** Das Relay fügt das Gateway-Token für jeden Aufrufer hinzu, der den Server erreicht (E13,
   *im Code gelesen*).
4. **§487, §793:** Die Windows-Installationsdatei ist unsigniert, und das Deinstallationsprogramm bliebe auch mit
   eingeschalteter Signierung unsigniert (E51, *im Code gelesen*).
5. **§800:** Die Policy erlaubt ganze Host-Familien per Platzhalter (E34, *im Code gelesen*).

## Was Sie vor einer Zusage prüfen oder verlangen sollten

- Setzen Sie auf einer Testinstallation `ai` und prüfen Sie, dass api.anthropic.com in der Policy der Seite
  fehlt und das Relay mit 503 ablehnt (E19, *getestet (Unit)*; E53, *getestet (Unit)*).
- Hängen Sie eine E-Mail mit einer Anweisung an und prüfen Sie, dass eine einzelne vorgeschlagene Änderung auf
  der Prüfkarte wartet; schreiben Sie denselben Text in einen synchronisierten Jira-Vorgang und sehen Sie, dass
  eine einzelne gewöhnliche Änderung sofort angewendet wird, während Änderungen, die Löschungen oder Einladungen
  auslösen, in beiden Fällen warten (E47, *getestet (Unit)*; E48, *im Code gelesen*).
- Stellen Sie den Server der App hinter Ihre eigene Zugangskontrolle: Wer ihn erreicht, kann das Relay aufrufen,
  das das Gateway-Token hinzufügt und keine Begrenzung der Anfragen hat, und die Begrenzung der anderen Routen
  zählt nach einem Header, den der Aufrufer selbst setzen kann (§805, §806, §562; E13, *im Code gelesen*; E54,
  *im Code gelesen*).
- Für Vorfälle: Das Aktivitätsprotokoll nennt die KI als Akteur ihrer Änderungen im Chat, aber kein Eintrag
  verweist auf die Chat-Nachricht dahinter (§799; E55, *im Code gelesen*).
- Fragen Sie Anthropic, was es von einer Anfrage aufbewahrt, wie lange und ob es damit trainiert.
- Prüfen Sie SBOM und Herkunftsnachweise der Version, die Sie installieren, und weisen Sie die Nutzenden auf die
  Warnung vor einem unbekannten Herausgeber hin (E50, *im Code gelesen*; E51, *im Code gelesen*).

## Weiterlesen

- [Anhang](appendix.md), mit den [Browser-Hosts](appendix.md#browser-hosts), den
  [Server-Zielen](appendix.md#server-ziele) und den [Betriebsschaltern](appendix.md#betriebsschalter).
- Das [Sicherheitsmodell](../../security.md) (englisch) und das [Betriebshandbuch](../../RUNBOOK.md)
  (englisch).
- [TOM-Übersicht](../../compliance/de/tom-sheet.md) und
  [Berührungspunkte mit dem Maintainer](../../compliance/de/vendor-touchpoints.md).
- Die anderen Kurzinformationen: [CEO](ceo.md), [CIO](cio.md), [DSB](dpo.md).
