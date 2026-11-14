# KI-Kurzinformation für den Datenschutz (DSB)

*So lesen Sie diese Seite:* `E<n>` ist eine Zeile der [Belegtabelle](appendix.md#belegtabelle); ihre
[Belegart](appendix.md#belegarten) ist *gemessen*, *getestet (Unit)* (ein Test mit Attrappen, kein Lauf gegen
echte Dienste), *getestet (Live-Datenbank)*, *im Code gelesen* (niemand hat es ausgeführt), *geschätzt* oder
*nicht belegt*. `§N` ist ein offener Eintrag im öffentlichen [Register](../../open-followups.md) (englisch) des
Projekts, aufgeführt unter [Offene Lücken](appendix.md#offene-lücken).

## Auf einen Blick

Je nach Funktion sendet die KI personenbezogene Daten an Anthropic, direkt oder über den Server der App und das
Gateway der Organisation; der Weg, den der [CIO](cio.md) wählt, entscheidet, wer jede Anfrage unterwegs
verarbeitet (E4, *getestet (Unit)*; E5, *getestet (Unit)*). Betroffen sein können Personen im
Ressourcenverzeichnis, Stakeholder, zuständige Personen von Aufgaben und verantwortliche
von RAID-Einträgen, Absender und Empfänger angehängter E-Mails, in getipptem Text, Dateien oder einer
importierten Tabelle genannte Personen und die Person, um die es in einem Timelog-Insight geht (E1,
*im Code gelesen*). Die Rollen von Verantwortlichem und Auftragsverarbeiter, die Rechtsgrundlage, Ihr Vertrag
und Ihre Auftragsverarbeitungsvereinbarung mit Anthropic, Übermittlungen und eine Betriebsvereinbarung sind
Fragen, die nur Ihre Organisation beantworten kann.

## Was hinausgeht und wer es freigibt

- **Je Funktion:** siehe [KI-Pfade und Personendaten](appendix.md#ki-pfade-und-personendaten). Der Vorschlag
  für die Ressourcenplanung sendet je Person die geplanten und verfügbaren Stunden und den internen Stundensatz
  ihrer Rolle, und Timelog-Insights nennen eine Person mit Befunden zu ihrer erfassten Arbeitszeit (E1,
  *im Code gelesen*); fünf Funktionen senden, wer abwesend ist, auch bei ausgeblendeter Ressourcen-Funktion
  (E59, *im Code gelesen*).
- **Abwesenheitstypen (Artikel 9):** Kein KI-Pfad sendet den gespeicherten Typ einer Abwesenheit: Der Chat führt
  jede als „absent“, die Bearbeitung einer Zeile und die Listen, wer abwesend ist, lassen ihn weg (E63,
  *getestet (Unit)*; E1, *im Code gelesen*). Ein Hinweis bleibt: Der Timelog-Insight zu Zeit, die an einem
  Abwesenheitstag gebucht wurde, nennt die Person als abwesend „(vacation, sick or training)“, ohne den Typ zu
  nennen, und erreicht den Chat, die Bearbeitung einer Zeile und die Insight-Empfehlungen (E63,
  *getestet (Unit)*; E1, *im Code gelesen*). Er wird nicht gesendet, solange `timelog` abgeschaltet oder Timelog
  im Projekt ausgeblendet ist, und der Chat lässt ihn bei Personenschutz weg; ein Typ, den eine nutzende Person
  schreibt, etwa „krank“, wird so gesendet, wie er dasteht (E64, *im Code gelesen*).
- **Datensparsamkeit:** Listenergebnisse im Chat enthalten keine E-Mail-Adressen (Anhänge, Dokumente und
  protokollierte Änderungen schon), und die Bearbeitung einer Zeile sendet nie Telefonnummer, Geburtstag oder
  Notizen einer Person (E1, *im Code gelesen*).
- **Schutz und seine Grenzen:** Der *Personenschutz* ist aktiv, außer ein Projekt lässt Personen zu (E41,
  *getestet (Unit)*); er ersetzt die Namen bekannter Personen (einwortige nur dort, wo sie großgeschrieben sind)
  sowie jede E-Mail-Adresse, jede gültige IBAN und jede Zahl in Form einer Telefonnummer (E14,
  *getestet (Unit)*); unbekannte Namen und die Namen eines neuen Projekts gehen so hinaus, wie sie dastehen
  (E35, *im Code gelesen*); er läuft im Browser, eine veränderte Kopie kann also ohne ihn senden (E15,
  *im Code gelesen*).
- **Region:** Alle 96 gemessenen Anfragen meldeten für inference_geo den Wert `global`, und die App setzt keinen
  solchen Parameter (E22, *gemessen*; E58, *im Code gelesen*); was das für Übermittlungen bedeutet, bewerten Sie.
- **Freigabe in der App:** Die Nutzenden akzeptieren den Datenhinweis zur KI auf jedem Gerät; ob das für Ihre
  Rechtsgrundlage zählt, entscheiden Sie (E31, *getestet (Unit)*).

## Was Sie steuern

- **Schutz überall:** `ai-people` setzt der Betreiber der Installation, nicht die oder der DSB; der Schalter
  erzwingt den Schutz in jedem Projekt (E19, *getestet (Unit)*) und blendet Ressourcenplanung und RACI aus (E18,
  *getestet (Unit)*); wird er aufgehoben, gilt wieder die gespeicherte Einstellung jedes Projekts (E43,
  *im Code gelesen*).
- **Gespeicherte Chats:** nur mit einer Turso-Datenbank und dem Wiederherstellungsschlüssel des Betreibers
  aufbewahrt (E28, *im Code gelesen*); gelöscht 30 Tage nach ihrer letzten Änderung (der Betreiber kann 1 bis
  3650 einstellen), vom Browser und, wo eingerichtet, vom Server (E29, *im Code gelesen*).
- **Löschen und Suchen:** Die Nutzenden können alle eigenen Chats löschen, außer denen von vor der Umstellung
  auf private Chats, die bis zum Ablauf bleiben; die Suche nach einer Person erreicht und löscht auch die älteren
  gemeinsamen Chats dieses Projekts, die Gespräche anderer enthalten können; der Betreiber kann in der ganzen
  Datenbank suchen und löschen (E57, *im Code gelesen*).

## Noch nicht belegt / offene Lücken

1. **§813:** Das Löschen von Chats ist live nur für seine Datenbankanweisungen belegt, nicht für die
   Oberflächen, echte Löschläufe, die Sicherungen des Anbieters oder was der Modellanbieter aufbewahrt (E30,
   *getestet (Live-Datenbank)*).
2. **§810:** Das Ausblenden der Ressourcen-Funktion hält Personen und Abwesenheiten nicht von der KI fern (E59,
   *im Code gelesen*).
3. **§804:** Der Vorschlag für die Ressourcenplanung sendet immer interne Stundensätze (E1, *im Code gelesen*).
4. **§795:** Für die Hintergrund-KI wird einmal zugestimmt, nicht für jeden Lauf (E32, *getestet (Unit)*).
5. **§814:** Für die Ablehnung von Bildern und PDFs bei Personenschutz und die Stunden anderer Projekte in der
   Ressourcenplanung gibt es kein beobachtetes Verhalten aus einem gemessenen Lauf (E39, *nicht belegt*).

## Was Sie vor einer Zusage prüfen oder verlangen sollten

- Halten Sie Ihre Antworten zu Verantwortlichem, Auftragsverarbeiter, Rechtsgrundlage, Übermittlungen und
  Betriebsvereinbarung fest, mit den
  [Angaben für die Datenschutz-Folgenabschätzung](../../compliance/de/dpia-input.md#fragen-für-ihre-bewertung).
- Fragen Sie Anthropic für Ihr Konto: was es von einer Anfrage aufbewahrt und wie lange, ob es damit trainiert,
  welche Gesellschaft und welche Region sie verarbeiten, welche Bedingungen zur Auftragsverarbeitung und welcher
  Übermittlungsmechanismus gelten und ob es eine Option ohne Aufbewahrung gibt; der Nachweis für das Löschen in
  der App deckt das nicht ab (E30, *getestet (Live-Datenbank)*).
- Durchsuchen Sie in einem Testprojekt auf Turso die gespeicherten Chats nach einem Namen, löschen Sie die
  Treffer und prüfen Sie, dass die Löschung auf dem Server eingerichtet ist (E57, *im Code gelesen*; E29,
  *im Code gelesen*).
- Für die Daten einer Person außerhalb gespeicherter Chats nutzen Sie die Liste in den
  [Angaben für das Verzeichnis von Verarbeitungstätigkeiten](../../compliance/de/record-of-processing-input.md#aufbewahrung-und-löschung);
  geben Sie die [Anlage für den Betriebsrat](../../compliance/de/works-council-annex.md) weiter, bevor
  Ressourcenplanung oder RACI genutzt werden.

## Weiterlesen

- [Angaben für die Datenschutz-Folgenabschätzung](../../compliance/de/dpia-input.md),
  [Angaben für das Verzeichnis von Verarbeitungstätigkeiten](../../compliance/de/record-of-processing-input.md),
  [TOM-Übersicht](../../compliance/de/tom-sheet.md) und
  [Berührungspunkte mit dem Maintainer](../../compliance/de/vendor-touchpoints.md).
- [Anhang](appendix.md): die Belegtabelle, die beiden Wege und die erzeugten Tabellen.
- Die anderen Kurzinformationen: [CEO](ceo.md), [CAIO](caio.md), [CISO](ciso.md).
