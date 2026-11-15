# KI-Kurzinformation für die Projektleitung

*So lesen Sie diese Seite:* `E<n>` ist eine Zeile der [Belegtabelle](appendix.md#belegtabelle); ihre
[Belegart](appendix.md#belegarten) ist *gemessen*, *getestet (Unit)* (ein Test mit Attrappen, kein Lauf gegen
echte Dienste), *getestet (Live-Datenbank)*, *im Code gelesen* (diese Kurzinformationen nennen keinen Test
und keinen Lauf dafür), *geschätzt* oder *nicht belegt*. `§N` ist ein offener Eintrag im öffentlichen
[Register](../../open-followups.md) (englisch) des Projekts, aufgeführt unter
[Offene Lücken](appendix.md#offene-lücken).

## Auf einen Blick

Die KI entwirft Arbeit für Sie und schlägt sie vor: Die meisten Funktionen ändern nichts, bevor Sie ihren
Vorschlag übernehmen, eine einzelne gewöhnliche Änderung im Chat wird aber sofort angewendet (E56,
*im Code gelesen*; E47, *getestet (Unit)*). Die Antworten der KI können sich von Lauf zu Lauf unterscheiden: Die
App tut nichts dafür, dass dieselbe Anfrage dieselbe Antwort ergibt, und ob die Optimierung der Arbeitspakete
gleich ausfällt, wurde nicht gemessen (E61, *im Code gelesen*; E27, *nicht belegt*). KI-Text in Ihrem Bericht
trägt kein Kennzeichen; einem Lenkungsausschuss zu sagen, was die KI entworfen hat, liegt also bei Ihnen (E55,
*im Code gelesen*; E62, *im Code gelesen*). Ihre Nutzung kostet etwa
5 $, 13 $ oder 33 $ im Monat bei leichter, typischer oder intensiver Nutzung, geschätzt aus angenommener Nutzung
(E25, *geschätzt*) und 2 bis 6 gemessenen Aufrufen je Funktion in einem Demoprojekt (E37, *gemessen*).

## Was hinausgeht und wer es freigibt

- **Was hinausgeht:** Jede Funktion sendet die Projektdaten, die unter [KI-Pfade](appendix.md#ki-pfade)
  aufgeführt sind (E1, *im Code gelesen*). Bei aktivem *Personenschutz* werden die Namen der Personen, die das
  Projekt kennt (einwortige Namen nur dort, wo sie großgeschrieben sind), vor dem Senden ersetzt; ein Name, den
  das Projekt nicht kennt und der in eine Aufgabe oder einen Chat getippt wurde, wird so gesendet, wie er
  dasteht (E14, *getestet (Unit)*; E35, *im Code gelesen*).
- **Sie geben frei:** Die Bearbeitung einer Zeile, der Vorschlag für die Ressourcenplanung („Mit KI planen“),
  der RACI-Vorschlag, der Vorschlag für den Projektstrukturplan („Arbeitspakete mit KI optimieren“), die Prüfung
  auf doppelte Aufgaben, der Prognose-Import, der Gewichtungsvorschlag und die Insight-Empfehlungen ändern das
  Projekt erst, wenn Sie übernehmen, annehmen oder bestätigen (E56, *im Code gelesen*). Der Vorschlag für ein neues
  Projekt füllt den Projektassistenten aus, und angelegt wird nichts, bevor Sie ihn abschließen (E49,
  *im Code gelesen*).
- **Wird von selbst angewendet:** Eine gewöhnliche Änderung im Chat, also eine einzelne Änderung je Absenden,
  die nichts löscht, niemanden einlädt, keinen Termin auf eine Abwesenheit legt und kein Werkzeug nutzt, das
  immer zur Prüfung geht, wird sofort angewendet (§794; E47, *getestet (Unit)*) und erscheint
  im Aktivitätsprotokoll als Änderung der KI (E55, *im Code gelesen*). Alles andere wartet auf einer *Prüfkarte*
  auf Sie, ebenso jede Änderung, solange eine Datei angehängt ist, außer der Optimierung der Arbeitspakete, die
  ihre eigene Vorschau öffnet; ein wieder geöffneter gespeicherter Chat behält keinen Anhang (E47,
  *getestet (Unit)*). Text, den der Chat über seine Werkzeuge liest, löst diese Prüfpflicht nicht aus (E48,
  *im Code gelesen*).
- **Im Hintergrund:** Die geplanten Analysen und Zusammenfassungen erzeugen Text und ändern keinen
  Projektdatensatz, und eine Empfehlung wartet auf Ihre Bestätigung (E56, *im Code gelesen*); für
  Hintergrundläufe stimmen Sie einmal zu, nicht für jeden Lauf (E32, *getestet (Unit)*).

## Was Sie steuern

- **Nicht die Schalter:** KI aus, erzwungener Schutz, der Weg und die Schlüsselbeschränkung sind
  Server-Einstellungen des Betreibers der Installation (E19, *getestet (Unit)*; E4, *getestet (Unit)*; E7,
  *getestet (Unit)*); im Piloten, den die Kurzinformationen für CEO und COO vorschlagen, ist der Schutz
  erzwungen, was Ressourcenplanung und RACI ausblendet (E18, *getestet (Unit)*).
- **Übernehmen oder lassen:** In den Vorschlägen für Ressourcenplanung, RACI, Projektstrukturplan und doppelte
  Aufgaben können Sie Punkte abwählen, und der Gewichtungsvorschlag bietet „Übernehmen“ für jede einzelne
  Gewichtung; die übrigen werden als Ganzes übernommen, angenommen oder bestätigt (E56, *im Code gelesen*). Der
  Entwurf für den Lenkungsausschuss wartet unter „KI-Entwurf – Abschnitte in den Bericht übernehmen“, bis Sie
  einen Abschnitt oder alle übernehmen (E62, *im Code gelesen*).
- **Rückgängig machen und wiederfinden:** Aufgaben, die ein übernommener Projektstrukturplan anlegt, lassen sich
  nicht rückgängig machen und tragen kein KI-Kennzeichen (E66, *im Code gelesen*); der Eintrag im
  Aktivitätsprotokoll zum Übernehmen nennt jede angelegte Aufgabe mit Nummer und Titel, dort finden Sie sie also
  wieder (E68, *getestet (Unit)*).
- **Projektübergreifende Ressourcenplanung:** Stunden aus anderen Projekten zählen nur auf einer gemeinsam
  genutzten Turso-Datenbank, für Personen, deren Zuordnung Sie bestätigt haben oder die eine E-Mail-Adresse
  teilen, und nur aus Projekten, die Personen zulassen, was standardmäßig keines tut (E60, *getestet (Unit)*;
  E41, *getestet (Unit)*). Die Anfrage beschreibt von Ihrem Projekt höchstens 120 Personen, 26 Zeiträume, 150
  offene Aufgaben und 40 Meilensteine; wie viel weggelassen wurde, erfährt das Modell, und „Mit KI planen“ zeigt
  Ihnen dieselben Zahlen (E60, *getestet (Unit)*).

## Noch nicht belegt / offene Lücken

1. **§794:** Eine einzelne Änderung im Chat wird ohne Prüfkarte angewendet (E47, *getestet (Unit)*).
2. **§812:** Ob die Optimierung der Arbeitspakete gleich ausfällt, wurde nicht gemessen (E27, *nicht belegt*).
3. **§814:** Für die Stunden aus anderen Projekten im Vorschlag für die Ressourcenplanung gibt es kein
   beobachtetes Verhalten aus einem gemessenen Lauf (E39, *nicht belegt*).
4. **§801:** Text, den die KI schreibt, trägt keine maschinenlesbare Kennzeichnung (E55, *im Code gelesen*).
5. **§796:** Aufgaben, die ein übernommener Projektstrukturplan anlegt, lassen sich nicht rückgängig machen (E56,
   *im Code gelesen*).

## Was Sie vor einer Zusage prüfen oder verlangen sollten

- Kennzeichnen Sie vor einem Lenkungsausschuss die Abschnitte, die Sie aus dem KI-Entwurf übernommen haben, und
  jeden KI-Text in Folien oder Exporten; das Aktivitätsprotokoll zeigt, welche Speichervorgänge von der KI
  entworfenen Text enthielten (E62, *im Code gelesen*).
- Prüfen Sie jeden Namen, jedes Datum und jede Zahl eines Vorschlags am Projekt, und behandeln Sie einen Plan als
  eine Möglichkeit: Fragen Sie erneut und vergleichen Sie, bevor Sie übernehmen (E61, *im Code gelesen*).
- Beantworten Sie vor „Mit KI planen“ auf einer gemeinsamen Datenbank dessen Vorschläge zu „derselben Person“,
  sonst zählen die Stunden dieser Personen in anderen Projekten nicht (E60, *getestet (Unit)*).

## Weiterlesen

- [KI-Kompetenz](../../compliance/de/ai-literacy.md), zu Prüfkarten und typischen Fehlern.
- [Anlage für den Betriebsrat](../../compliance/de/works-council-annex.md#was-die-ki-ohne-freigabe-durch-eine-person-tun-darf).
- [Anhang](appendix.md): die Belegtabelle, die beiden Wege und die erzeugten Tabellen.
- Die anderen Kurzinformationen: [CEO](ceo.md), [CAIO](caio.md), [COO](coo.md).
