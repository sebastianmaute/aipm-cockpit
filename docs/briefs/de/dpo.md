# KI-Kurzinformation für den Datenschutz (DSB)

## Auf einen Blick

Je nach Funktion sendet die KI personenbezogene Daten an Anthropic, direkt oder über das Gateway der
Organisation: Namen in Aufgaben, RAID-Einträgen und Stakeholdern, Personen im Ressourcenverzeichnis,
Abwesenheiten als abwesende Tage und angehängte Dateien und E-Mails mit Absendern und Empfängern (E1,
*im Code gelesen*; E4, *getestet (Unit)*; E5, *getestet (Unit)*). Der Personenschutz, in jedem Projekt aktiv,
außer das Projekt lässt Personen zu, ersetzt im Browser vor dem Senden die Namen und Kontaktdaten bekannter
Personen (E41, *getestet (Unit)*; E14, *getestet (Unit)*; E15, *im Code gelesen*). Wer Verantwortlicher und
wer Auftragsverarbeiter ist, die Rechtsgrundlage, Ihr Vertrag und Ihre Auftragsverarbeitungsvereinbarung mit
Anthropic, Übermittlungen und eine Betriebsvereinbarung sind Fragen, die nur Ihre Organisation beantworten
kann; diese Seite liefert die Fakten dafür.

## Was hinausgeht und wer es freigibt

- **Je Funktion:** Was jede Funktion über Personen sendet, steht unter
  [KI-Pfade und Personendaten](appendix.md#ki-pfade-und-personendaten) (E1, *im Code gelesen*). Darunter: Der
  Vorschlag für die Ressourcenplanung sendet je Person die geplanten und verfügbaren Stunden und den internen
  Stundensatz ihrer Rolle (E1, *im Code gelesen*); Insights aus Timelog nennen eine Person mit Befunden zu
  ihrer erfassten Arbeitszeit (E1, *im Code gelesen*); fünf Funktionen senden, wer abwesend ist, auch während
  die Ressourcen-Funktion ausgeblendet ist (E59, *im Code gelesen*).
- **Datensparsamkeit:** Listenergebnisse im Chat enthalten keine E-Mail-Adressen, und die Bearbeitung einer
  Zeile sendet nie Telefonnummer, Geburtstag oder Notizen einer Person (E1, *im Code gelesen*).
- **Schutz und seine Grenzen:** Bei aktivem Schutz werden die Namen bekannter Personen sowie jede
  E-Mail-Adresse, jede gültige IBAN und jede Zahl in Form einer Telefonnummer ersetzt (E14,
  *getestet (Unit)*); Namen, die das Projekt nicht kennt, werden so gesendet, wie sie dastehen, und die Namen
  eines neuen Projekts lassen sich nicht schützen (E35, *im Code gelesen*); eine veränderte Kopie der App kann
  ohne Schutz senden (E15, *im Code gelesen*).
- **Region:** Alle 96 gemessenen Anfragen meldeten Anthropics inference_geo-Wert `global` (E22, *gemessen*), und
  die App setzt selbst keinen (E58, *im Code gelesen*); was das für Übermittlungen bedeutet, ist Ihre Frage.
- **Freigabe in der App:** Jede Person stimmt dem KI-Hinweis auf jedem Gerät zu (E31, *getestet (Unit)*); der
  Hintergrund-KI wird einmal zugestimmt, nicht Lauf für Lauf (E32, *getestet (Unit)*). Ob diese Zustimmung in
  Ihrer Rechtsgrundlage eine Rolle spielt, entscheiden Sie.

## Was Sie steuern

- **Schutz überall:** `ai-people` erzwingt den Schutz in jedem Projekt (E19, *getestet (Unit)*) und blendet den
  Vorschlag für die Ressourcenplanung und den RACI-Vorschlag aus (E18, *getestet (Unit)*); wird diese Sperre
  aufgehoben, gilt für jedes Projekt wieder seine gespeicherte Einstellung (E43, *im Code gelesen*).
- **Wessen Konto:** Die Schlüsselbeschränkung nimmt nur Schlüssel Ihrer Anthropic-Organisation an (E7,
  *getestet (Unit)*); ein Schlüssel, der nicht mehr besteht, wird noch bis zu 15 Minuten angenommen (E9,
  *getestet (Unit)*).
- **Gespeicherte Chats:** nur mit einer Turso-Datenbank und dem Wiederherstellungsschlüssel des Betreibers
  aufbewahrt (E28, *im Code gelesen*); gelöscht 30 Tage nach ihrer letzten Änderung, sofern der Betreiber nicht
  1 bis 3650 Tage setzt, vom Browser und, wo eingerichtet, vom Server (E29, *im Code gelesen*).
- **Löschen und Suchen:** Personen können alle ihre eigenen Chats löschen oder sie nach einer Person
  durchsuchen und die Treffer löschen; der Betreiber kann beides in der ganzen Datenbank (E57,
  *im Code gelesen*).

## Noch nicht belegt / offene Lücken

1. **§813:** Das Löschen von Chats ist live nur für seine Datenbankanweisungen belegt, nicht für die
   Oberflächen, die Löschläufe mit echten Zugangsdaten, die Sicherungen des Anbieters oder was der
   Modellanbieter aufbewahrt (E30, *getestet (Live-Datenbank)*).
2. **§810:** Das Ausblenden der Ressourcen-Funktion hält Personen und Abwesenheiten nicht von der KI fern (E59,
   *im Code gelesen*).
3. **§804:** Der Vorschlag für die Ressourcenplanung sendet immer interne Stundensätze (E1, *im Code gelesen*).
4. **§795:** Der Hintergrund-KI wird einmal zugestimmt, sie wird nicht Lauf für Lauf freigegeben (E32,
   *getestet (Unit)*).
5. **§802:** Der Gateway-Weg ist nie gegen ein echtes Gateway gelaufen (E12, *nicht belegt*).

## Was Sie vor einer Zusage prüfen oder verlangen sollten

- Halten Sie Ihre Antworten zu Verantwortlichem, Auftragsverarbeiter, Rechtsgrundlage, Übermittlungen und
  Betriebsvereinbarung fest, mit den
  [Angaben für die Datenschutz-Folgenabschätzung](../../compliance/de/dpia-input.md#fragen-für-ihre-bewertung);
  setzen Sie die Schlüsselbeschränkung, damit Anfragen über diese Installation mit den Schlüsseln Ihrer
  Organisation laufen (E7, *getestet (Unit)*; E52, *im Code gelesen*).
- Fragen Sie Anthropic, was es von einer Anfrage aufbewahrt; der Nachweis für das Löschen in der App deckt das
  nicht ab (E30, *getestet (Live-Datenbank)*).
- Durchsuchen Sie in einem Testprojekt auf Turso die gespeicherten Chats nach einem Namen, löschen Sie die
  Treffer und prüfen Sie, dass die Löschung auf dem Server eingerichtet ist (E57, *im Code gelesen*; E29,
  *im Code gelesen*).
- Für die Daten einer Person außerhalb gespeicherter Chats nutzen Sie die Liste der Orte in den
  [Angaben für das Verzeichnis von Verarbeitungstätigkeiten](../../compliance/de/record-of-processing-input.md#aufbewahrung-und-löschung).
- Geben Sie die [Anlage für den Betriebsrat](../../compliance/de/works-council-annex.md) weiter, bevor
  Ressourcenplanung oder RACI genutzt werden.

## Weiterlesen

- [Angaben für die Datenschutz-Folgenabschätzung](../../compliance/de/dpia-input.md),
  [Angaben für das Verzeichnis von Verarbeitungstätigkeiten](../../compliance/de/record-of-processing-input.md),
  [TOM-Übersicht](../../compliance/de/tom-sheet.md) und
  [Berührungspunkte mit Anbietern](../../compliance/de/vendor-touchpoints.md).
- [Anhang](appendix.md): die Belegtabelle, die beiden Wege und die erzeugten Tabellen.
- Die anderen Kurzinformationen: [CEO](ceo.md), [CAIO](caio.md), [CISO](ciso.md).
