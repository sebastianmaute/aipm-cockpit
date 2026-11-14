# KI-Kurzinformation für die Betriebsleitung (COO)

## Auf einen Blick

Für den Betrieb ist die KI laufende Kosten auf dem eigenen Anthropic-Schlüssel jeder Person (E2,
*getestet (Unit)*) und ein Nutzen, den noch niemand gemessen hat. Im Demoprojekt kostete ein Chat-Aufruf
0,0668 $ mit Personenschutz und 0,0711 $ ohne, die anderen Funktionen 0,0034 $ bis 0,0314 $ (E24,
*gemessen*), bei einer Wartezeit (Median) von 2,0 s bis 24,1 s (E37, *gemessen*). Für ein Team von fünf
Personen sind das etwa 25 $, 67 $ oder 165 $ im Monat bei leichter, typischer oder intensiver Nutzung, mit
angenommenen Aufrufen je Person und Tag (E25, *geschätzt*). Wie viel Arbeitszeit die KI spart, hat niemand
gemessen (E26, *nicht belegt*). Ein Pilot liefert die Zahl, an der die Wirtschaftlichkeit hängt.

## Was hinausgeht und wer es freigibt

Was jede Funktion sendet, steht in der Tabelle [KI-Pfade](appendix.md#ki-pfade) (E1, *im Code gelesen*). Am
wenigsten sendet der Text der Zusammenfassung: Statuszahlen, die bald fälligen Meilensteine und den
Betriebsleitfaden der Person für die Zusammenfassung, aber keine Namen von Personen, außer ein Meilensteinname
enthält einen (E1, *im Code gelesen*).

## Was Sie steuern

- **Wessen Schlüssel:** Die KI lässt sich auf Schlüssel Ihrer eigenen Anthropic-Organisation und ihrer
  Workspaces beschränken. Ist die Beschränkung gesetzt, werden nur Schlüssel Ihrer Organisation angenommen,
  sodass die Nutzung auf diesen Schlüsseln läuft (E7, *getestet (Unit)*); ein Schlüssel, der die Bedingung
  nicht mehr erfüllt, bleibt bis zu 15 Minuten angenommen (E9, *getestet (Unit)*).
- **Ausgabenlimits:** Die App zählt die Nutzung nur im Browser jeder Person, und ihre Limits sind persönliche
  Einstellungen: Die Limits je Sitzung und je Woche benachrichtigen nur, und die optionale wöchentliche harte
  Obergrenze hält nur die Hintergrund-KI an. Nichts in der App hält interaktive KI bei einem Ausgabenlimit an
  (E38, *im Code gelesen*).

## Noch nicht belegt / offene Lücken

1. **§811:** Die Zeit, die die KI spart, ist nicht gemessen (E26, *nicht belegt*).
2. **§812:** Ob „Arbeitspakete mit KI optimieren“ sein Ergebnis wiederholt, ist nicht gemessen (E27,
   *nicht belegt*).
3. **§814:** Sechs Pfade haben weder gemessene Kosten noch beobachtetes Verhalten, darunter die wöchentliche
   harte Obergrenze (E39, *nicht belegt*).
4. **§798:** Nur zwei KI-Aufrufe, der Text der Zusammenfassung auf Anfrage und der Schlüsseltest im Browser,
   haben ein eigenes Zeitlimit; das Relay setzt ein Leerlauf-Zeitlimit von 15 Minuten, und eine Antwort mit
   Ratenlimit oder Überlastung wird nicht wiederholt (E40, *im Code gelesen*).
5. **§795:** Hintergrundläufen wird einmal zugestimmt; sie werden nicht Lauf für Lauf freigegeben (E32,
   *getestet (Unit)*).

## Was Sie vor einer Zusage prüfen oder verlangen sollten

- Messen Sie die Zeit je Aufgabe, bevor die KI eingeschaltet wird; ohne diese Ausgangsbasis bleibt die
  Nutzenfrage offen.
- Da die App interaktive Ausgaben nicht anhält (E38, *im Code gelesen*), fragen Sie den CIO, ob sich für die
  Anthropic-Organisation oder die Workspaces, zu denen die Schlüssel gehören, ein Ausgabenlimit und
  Nutzungsberichte einrichten lassen.
- **Pilot, als Vorlage:**
  - *Umfang:* Personenschutz erzwingen, gleich was ein Projekt gespeichert hat (E19, *getestet (Unit)*; E41,
    *getestet (Unit)*); das blendet den Vorschlag für die Ressourcenplanung und den RACI-Vorschlag aus und
    schaltet das Diktat ab (E18, *getestet (Unit)*). Namen, die das Projekt nicht kennt, werden weiterhin so
    gesendet, wie sie dastehen (E35, *im Code gelesen*). Den Vorschlag für ein neues Projekt auslassen, dessen
    Namen sich nicht schützen lassen: Kein Schalter erledigt das, sagen Sie es den Nutzern (E42,
    *im Code gelesen*). Ressourcenplanung und RACI erst, wenn Betriebsrat und Datenschutzbeauftragte zustimmen;
    wird die Sperre aufgehoben, gilt wieder die eigene Einstellung jedes Projekts, prüfen Sie diese daher
    vorher (E43, *im Code gelesen*).
  - *Dauer und Größe:* nach Ihrer Wahl, etwa 6–12 Wochen und 10–30 Projektleitungen.
  - *Messen:* Ausgaben je Person und Woche; Zeit je Aufgabe gegenüber der Ausgangsbasis; wie viele
    KI-Vorschläge angenommen werden und wie viele Nacharbeit brauchen; Wiederholbarkeit des Vorschlags für den
    Projektstrukturplan (§812; E27, *nicht belegt*).
  - *Abbruch und Freigabe:* abbrechen, wenn Ausgaben, Nacharbeit oder ein Befund zum Personenschutz eine vorher
    festgelegte Grenze überschreiten; der Betrieb kann die KI ganz abschalten (E19, *getestet (Unit)*); Freigabe durch Betriebsrat, Datenschutzbeauftragte, CISO und die
    Budgetverantwortlichen.

## Weiterlesen

- [Gemessene Zahlen](appendix.md#gemessene-zahlen) und die
  [Teammonat-Schätzung](appendix.md#teammonat-schätzung), mit ihrer Rechnung.
- [Anhang](appendix.md), mit den [Betriebsschaltern](appendix.md#betriebsschalter).
- [Compliance-Paket](../../compliance/de/README.md) und seine
  [Anlage für den Betriebsrat](../../compliance/de/works-council-annex.md).
- Die anderen Kurzinformationen: [CEO](ceo.md), [CIO](cio.md), [PM](pm.md).
