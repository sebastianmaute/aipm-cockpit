# KI-Kurzinformation für die KI-Verantwortung (Chief AI Officer)

## Auf einen Blick

Die KI der App entwirft, analysiert und schlägt Projektmanagement-Arbeit in 17 Funktionen vor, drei davon laufen
im Hintergrund (E1, *im Code gelesen*). Außerhalb des Chats wendet eine Funktion, die Änderungen vorschlägt,
nichts an, bevor eine Person es tut; der Chat wendet eine einzelne gewöhnliche Änderung sofort an (E56,
*im Code gelesen*; E47, *getestet (Unit)*). Zwei Funktionen schlagen Änderungen an der Arbeit von Personen vor:
Der Vorschlag für die Ressourcenplanung schlägt geplante Stunden von Personen und Verschiebungen offener
Aufgaben zwischen ihnen vor, und der RACI-Vorschlag schlägt eine Rolle je Person und Meilenstein vor (E56,
*im Code gelesen*). Wie sich diese Funktionen und Ihre Nutzung zu Anhang III der KI-Verordnung verhalten,
ordnet Ihre Organisation ein; diese Seite liefert die Fakten dafür, keine Schlussfolgerung.

## Was hinausgeht und wer es freigibt

- **Die Anfragen mit dem stärksten Personenbezug:** Die Anfrage zur Ressourcenplanung enthält je Person Rolle,
  Status als extern, geplante und verfügbare Stunden und den internen Stundensatz ihrer Rolle; die RACI-Anfrage
  enthält Einfluss und Interesse der Stakeholder; Insights aus Timelog nennen eine Person mit Befunden zu ihrer
  erfassten Arbeitszeit und gehen an den Chat, die Bearbeitung einer Zeile und die Insight-Empfehlungen
  ([KI-Pfade und Personendaten](appendix.md#ki-pfade-und-personendaten); E1, *im Code gelesen*).
- **Wo eine Person freigibt:** Jede Änderung der Ressourcenplanung und des RACI-Vorschlags wird mit ihrem
  bisherigen und dem vorgeschlagenen Wert gezeigt und lässt sich abwählen (E56, *im Code gelesen*). Der Chat
  hält Änderungen in festgelegten Fällen auf einer Prüfkarte fest, etwa bei einer Löschung oder mehr als einer
  Änderung, und hält jede Änderung fest, solange eine Datei angehängt ist (E47, *getestet (Unit)*).
- **Wo niemand vorher freigibt:** Text, den der Chat über seine Werkzeuge liest, etwa eine aus Jira
  synchronisierte Aufgabe, löst die Prüfpflicht nicht aus (E48, *im Code gelesen*).

## Was Sie steuern

- **Personenbezogene KI aus:** `ai-people` erzwingt den Personenschutz in jedem Projekt (E19,
  *getestet (Unit)*); das blendet den Vorschlag für die Ressourcenplanung und den RACI-Vorschlag aus und
  schaltet das Diktat ab (E18, *getestet (Unit)*), und solange er aktiv ist, übernimmt die App aus einer
  KI-Antwort nichts Personenbezogenes (E17, *getestet (Unit)*).
- **Grenzen dieses Schalters:** Der Schutz läuft im Browser, eine veränderte Kopie kann also ohne ihn senden
  (E15, *im Code gelesen*); Namen, die das Projekt nicht kennt, werden so gesendet, wie sie dastehen, und die
  Namen eines neuen Projekts lassen sich nicht schützen (E35, *im Code gelesen*); wird die Sperre aufgehoben,
  gilt für jedes Projekt wieder seine gespeicherte Einstellung (E43, *im Code gelesen*). Kein Schalter schaltet
  eine einzelne Funktion ab (E42, *im Code gelesen*).
- **Kennzeichnung nach Artikel 50:** Die Oberflächen benennen die KI („KI-Assistent“, „Claude fragen“,
  „KI-generiert – vor dem Handeln prüfen.“), und das Aktivitätsprotokoll zeigt ihre Änderungen mit dem Akteur
  „KI-Assistent“; der Text, den sie schreibt, trägt keine maschinenlesbare Kennzeichnung (E55,
  *im Code gelesen*).
- **KI-Kompetenz nach Artikel 4:** Siehe das [Material zur KI-Kompetenz](../../compliance/de/ai-literacy.md) und
  die [Musterhinweise](../../compliance/de/model-notices.md) im Compliance-Paket.

## Noch nicht belegt / offene Lücken

1. **§794:** Eine einzelne Änderung im Chat wird ohne Prüfkarte angewendet (E47, *getestet (Unit)*).
2. **§801:** Text, den die KI schreibt, trägt keine maschinenlesbare Kennzeichnung; legen Sie also fest, wie er
   gekennzeichnet wird, sobald er die App in Berichten und Exporten verlässt (E55, *im Code gelesen*).
3. **§795:** Der Hintergrund-KI wird einmal zugestimmt, sie wird nicht Lauf für Lauf freigegeben (E32,
   *getestet (Unit)*).
4. **§797:** Text, den der Chat über seine Werkzeuge liest, löst die Prüfpflicht nicht aus (E48,
   *im Code gelesen*).
5. **§810:** Das Ausblenden der Ressourcen-Funktion eines Projekts hält dessen Personen und Abwesenheiten nicht
   von der KI fern (E59, *im Code gelesen*).

## Was Sie vor einer Zusage prüfen oder verlangen sollten

- Schreiben Sie auf, wofür Ihre Organisation Ressourcenplanung und RACI nutzen wird, und lesen Sie das, neben der
  [Zweckbestimmung des Maintainers](../../compliance/de/ai-act-readiness.md#rollen), mit dem
  [Hinweis zur KI-Verordnung](../../compliance/de/ai-act-readiness.md#zuteilungs--und-raci-vorschläge-anhang-iii)
  gegen Anhang III Nummer 4 Buchstabe b und Artikel 6 Absatz 3; bis das geklärt ist, erzwingen Sie den Schutz
  (E18, *getestet (Unit)*; E19, *getestet (Unit)*).
- Bitten Sie den Chat in einem Testprojekt um eine einzelne Terminänderung an einer Aufgabe, deren zuständige
  Person an dem Tag nicht abwesend ist, und sehen Sie, dass sie ohne Karte angewendet wird und im
  Aktivitätsprotokoll als Änderung der KI erscheint; hängen Sie dann eine Datei an und sehen Sie, dass dieselbe
  Bitte wartet (E47, *getestet (Unit)*; E55, *im Code gelesen*).

## Weiterlesen

- [Hinweis zur KI-Verordnung](../../compliance/de/ai-act-readiness.md),
  [Musterhinweise](../../compliance/de/model-notices.md) und
  [KI-Kompetenz](../../compliance/de/ai-literacy.md).
- [Anlage für den Betriebsrat](../../compliance/de/works-council-annex.md#was-die-ki-ohne-freigabe-durch-eine-person-tun-darf).
- [Anhang](appendix.md): die Belegtabelle, die beiden Wege und die erzeugten Tabellen.
- Die anderen Kurzinformationen: [CEO](ceo.md), [DSB](dpo.md), [PM](pm.md).
