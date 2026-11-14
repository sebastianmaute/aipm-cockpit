# KI-Kurzinformation für die Projektleitung

## Auf einen Blick

Die KI entwirft Arbeit für Sie und schlägt sie vor: Die meisten Funktionen ändern nichts, bevor Sie ihren
Vorschlag übernehmen, eine einzelne gewöhnliche Änderung im Chat wird aber sofort angewendet (E56,
*im Code gelesen*; E47, *getestet (Unit)*). Ihre Antworten können sich von Lauf zu Lauf unterscheiden: Die App
tut nichts dafür, dass dieselbe Anfrage dieselbe Antwort ergibt, und ob die Optimierung der Arbeitspakete
gleich ausfällt, wurde nicht gemessen (E61, *im Code gelesen*; E27, *nicht belegt*). Text, den die KI schreibt,
trägt in Ihrem Bericht kein eigenes Kennzeichen; einem Lenkungsausschuss zu sagen, welche Teile die KI
entworfen hat, liegt also bei Ihnen (E55, *im Code gelesen*; E62, *im Code gelesen*).

## Was hinausgeht und wer es freigibt

- **Was hinausgeht:** Jede Funktion sendet die Projektdaten, die unter [KI-Pfade](appendix.md#ki-pfade)
  aufgeführt sind (E1, *im Code gelesen*). Bei aktivem Personenschutz werden die Namen der Personen, die das
  Projekt kennt, vor dem Senden ersetzt; ein Name, den das Projekt nicht kennt und der in eine Aufgabe oder
  einen Chat getippt wurde, wird so gesendet, wie er dasteht (E14, *getestet (Unit)*; E35, *im Code gelesen*).
- **Sie geben frei:** Die Bearbeitung einer Zeile, der Vorschlag für die Ressourcenplanung, der RACI-Vorschlag,
  der Vorschlag für den Projektstrukturplan, die Prüfung auf doppelte Aufgaben, der Prognose-Import, der
  Gewichtungsvorschlag und die Insight-Empfehlungen ändern das Projekt erst, wenn Sie übernehmen, annehmen oder
  bestätigen; Ressourcenplanung und RACI zeigen jede Änderung mit ihrem bisherigen und dem vorgeschlagenen Wert
  (E56, *im Code gelesen*). Der Vorschlag für ein neues Projekt füllt den Projektassistenten aus, und angelegt
  wird nichts, bevor Sie ihn abschließen (E49, *im Code gelesen*).
- **Wird von selbst angewendet:** Eine gewöhnliche Änderung im Chat, etwa ein einzelner Termin, wird sofort
  angewendet und als Änderung der KI protokolliert (§794; E47, *getestet (Unit)*). Der Chat hält Änderungen in
  festgelegten Fällen auf einer Prüfkarte fest, etwa bei einer Löschung, einer Einladung, einem Termin auf der
  Abwesenheit einer Person oder mehr als einer Änderung, und hält jede Änderung fest, solange eine Datei
  angehängt ist (E47, *getestet (Unit)*). Text, den der Chat über seine Werkzeuge liest, etwa eine aus Jira
  synchronisierte Aufgabe, löst diese Prüfpflicht nicht aus (E48, *im Code gelesen*).
- **Im Hintergrund:** Die geplanten Analysen und Zusammenfassungen erzeugen Text und ändern keinen
  Projektdatensatz, und eine Empfehlung wartet auf Ihre Bestätigung (E56, *im Code gelesen*); Hintergrundläufen
  stimmen Sie einmal zu, nicht Lauf für Lauf (E32, *getestet (Unit)*).

## Was Sie steuern

- **Übernehmen oder lassen:** In den Vorschlägen für Ressourcenplanung, RACI, Projektstrukturplan und doppelte
  Aufgaben können Sie Punkte abwählen; die übrigen werden als Ganzes übernommen, angenommen oder bestätigt (E56,
  *im Code gelesen*). Der
  Entwurf für den Lenkungsausschuss wartet unter „KI-Entwurf – Abschnitte in den Bericht übernehmen“, bis Sie
  einen Abschnitt oder alle übernehmen (E62, *im Code gelesen*).
- **Eine Prüfung erzwingen:** Hängen Sie eine Datei an das Chat-Gespräch an, dann wartet jede vorgeschlagene
  Änderung auf der Prüfkarte, außer der Optimierung der Arbeitspakete, die ihre eigene Vorschau öffnet (E47,
  *getestet (Unit)*).
- **Rückgängig machen:** Aufgaben, die ein übernommener Projektstrukturplan anlegt, lassen sich nicht rückgängig
  machen; löschen Sie sie von Hand (E56, *im Code gelesen*).
- **Projektübergreifende Ressourcenplanung:** Stunden aus anderen Projekten zählen nur auf einer gemeinsam
  genutzten Turso-Datenbank, für Personen, deren Zuordnung bestätigt ist oder die eine E-Mail-Adresse teilen;
  Projekte, die ihre Personen schützen, bleiben außen vor, und die Anfrage beschreibt von Ihrem Projekt höchstens
  120 Personen, 26 Zeiträume, 150 offene Aufgaben und 40 Meilensteine (E60, *im Code gelesen*). Der Schutz ist in
  jedem Projekt aktiv, außer das Projekt lässt Personen zu; standardmäßig zählen also nur Projekte, die Personen
  zulassen (E41, *getestet (Unit)*).

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
  jeden KI-Text in Folien oder Exporten; das Aktivitätsprotokoll zeigt, welche Speicherungen von der KI
  entworfenen Text enthielten (E62, *im Code gelesen*).
- Prüfen Sie jeden Namen, jedes Datum und jede Zahl eines Vorschlags am Projekt, und behandeln Sie einen Plan als
  eine Möglichkeit: Fragen Sie erneut und vergleichen Sie, bevor Sie übernehmen (E61, *im Code gelesen*).
- Beantworten Sie vor „Mit KI planen“ auf einer gemeinsamen Datenbank dessen Vorschläge zu „derselben Person“,
  sonst zählen die Stunden dieser Personen in anderen Projekten nicht; auch dann zählen nur Projekte, die
  Personen zulassen (E60, *im Code gelesen*; E41, *getestet (Unit)*).

## Weiterlesen

- [KI-Kompetenz](../../compliance/de/ai-literacy.md), zu Prüfkarten und typischen Fehlern.
- [Anlage für den Betriebsrat](../../compliance/de/works-council-annex.md#was-die-ki-ohne-freigabe-durch-eine-person-tun-darf).
- [Anhang](appendix.md): die Belegtabelle, die beiden Wege und die erzeugten Tabellen.
- Die anderen Kurzinformationen: [CEO](ceo.md), [CAIO](caio.md), [COO](coo.md).
