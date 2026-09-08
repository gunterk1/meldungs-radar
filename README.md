# Radar

Überwacht einen Behörden-Feed, klassifiziert jede Meldung danach, ob sie eine
Handlung auslöst, und **legt sie einem Menschen vor. Nichts wird ohne Freigabe
wirksam.**

Das Thema ist Konfiguration. `profile/` enthält zwei Profile, der restliche Code
kennt keines von beiden.

```
npm test                                  # 46 Tests, keine Laufzeitabhängigkeiten
node bin/radar.mjs --trocken              # Feed abrufen und zeigen, ohne Modellaufruf
node bin/radar.mjs                        # ein vollständiger Durchlauf (Profil: bsi)
node bin/radar.mjs --profil steuern       # anderes Thema, derselbe Code
docker compose up -d                      # n8n als Zeitgeber und Freigabeoberfläche
```

| Profil | Quelle | Die Frage |
|---|---|---|
| `bsi` | BSI-Cyber-Sicherheitswarnungen | Betrifft diese Warnung unseren Bestand? |
| `steuern` | BMF-Steuermeldungen | Zwingt die Meldung das Steuer-SaaS zu einer Änderung? |

## Warum hier überhaupt ein Sprachmodell steht

Das ist die Frage, die vor dem Bauen kommt — und sie hat oft die Antwort „gar
nicht". Hier hat sie eine andere, und der Grund lässt sich vorführen.

**Ob eine Sicherheitswarnung dich betrifft, steht nicht in der Warnung.** Sie
nennt ein Produkt. Ob das Produkt bei dir läuft, weißt nur du. Die Relevanzfrage
ist erst beantwortbar, wenn man Meldung und Inventar nebeneinanderlegt — und
genau diese Verbindung kann ein Stichwortfilter nicht herstellen.

Ein Abruf vom 2026-09-08 lieferte 50 Warnungen. Gegen das Inventar des Profils
`bsi` (der öffentliche Stack von
[php-ai-bridge](https://github.com/gunterk1/php-ai-bridge)):

| Warnung | Betrifft den Bestand |
|---|---|
| WordPress — Schwachstellen erlauben Remote Code Execution | **ja** |
| Kubernetes — kritische Schwachstelle im Ingress-NGINX Controller | **ja** |
| React Server Components — kritische Schwachstelle | **ja** |
| Trivy — Supply-Chain-Angriff | **ja** |
| SonicWall SMA1000 — Zero-Day aktiv ausgenutzt | nein — keine Appliance im Bestand |
| Microsoft SharePoint — Zero-Day, massive Ausnutzung | nein |
| BIND — Proof of Concept bedroht DNS-Server | nein |

**41 der 50 Meldungen (82 %) betreffen Produkte, die hier gar nicht laufen** —
Netzwerk-Appliances, Windows-Serverdienste, fremde Datenbanken. Sie sind alle
echt, viele kritisch, und trotzdem für diesen Bestand ohne Belang.

**Ein Stichwortfilter scheitert daran in beide Richtungen, nachweisbar:**

- Filter auf `PHP` → **null Treffer.** Obwohl „WordPress — Remote Code
  Execution" im Feed steht und WordPress PHP *ist*. Der Produktname enthält den
  Stackbegriff nicht, und niemand pflegt eine vollständige Synonymliste.
- Filter auf `Server` → **fünf Treffer, vier davon falsch.** Windows VPN-Server,
  BIND DNS-Server, Exchange, Redis — und dazwischen „React Server Components",
  das einzige relevante.

Relevanzurteil über unstrukturierten Text gegen ein bekanntes Inventar ist genau
die Aufgabe, bei der ein Modell etwas beiträgt, das deterministischer Code nicht
kann. **Wäre der Feed sortenrein, wäre die richtige Lösung eine
Weiterleitungsregel und kein Modell. Diese Unterscheidung ist der Zweck des
Projekts.**

## Die Bauform

```
  Zeitplan → Feed → Dedup → Modell → Schemaprüfung → Eskalation → Mensch → Protokoll
                ▲                        ▲                ▲          ▲
              Profil              deterministisch      Regel     entscheidet
```

**1 · Das Modell liefert Text, dieser Code entscheidet, was davon gilt.**
`lib/schema.mjs` prüft jede Ausgabe zur Laufzeit gegen ein Schema — Enum-Zugehörigkeit,
Datumsformat, Plausibilität des Wirksamkeitsdatums, Konfidenz im Bereich [0,1]. Geprüft,
nicht gecastet. Ein `SchemaFehler` benennt das Feld.

**2 · Unsicherheit eskaliert, statt zu verschwinden.**

```js
vorgelegt wird, wenn  relevanz !== 'keine'  ODER  konfidenz < 0.7
```

Eine schemawidrige Ausgabe wird **eskaliert, nicht verworfen** — wer die Prüfung
reißt, hat vielleicht trotzdem etwas Wichtiges gesehen. Ein Anbieterausfall
markiert nichts als gesehen. **Kein Pfad führt dazu, dass eine Meldung still
verlorengeht.**

**3 · Die Freigabe ist kein Anhängsel.** Die Felder `freigabe`,
`freigegeben_von`, `freigegeben_am` stehen in jeder Protokollzeile und bleiben
`null`, bis ein Mensch entschieden hat.

## Das Profil — und was es nicht darf

Ein Profil liefert vier Dinge: **Feed-URL, Bereichs-Enum, Auftrag** (inklusive
Inventar) und das **Plausibilitätsfenster** für `wirksam_ab`.

Das letzte ist der unbequeme Teil. Das Schemafeld heißt in jeder Domäne gleich
und meint überall etwas anderes — im Steuerrecht „ab wann gilt die Regel", bei
einer Sicherheitswarnung „ab wann gibt es einen Fix". Deshalb ist
`wirksamAb.bedeutung` ein Pflichtfeld des Profils, und deshalb sind die Fenster
verschieden: Steuern `-5/+10` Jahre, BSI `-5/+2`. Ein Fix für übernächstes Jahr
kündigt niemand an.

**Ein Profil darf die Form der Ausgabe nicht ändern.** Die vier Felder und ihre
Prüfung sind fest. Der Prompt hat deshalb zwei Hälften: Das Profil liefert den
**Auftrag**, `systemPrompt()` liefert den **Vertrag** — abgeleitet aus denselben
Konstanten, gegen die anschließend geprüft wird. Läge der Vertrag im Profil,
könnte ein Profil ihn unbemerkt anders formulieren als die Prüfung ihn erwartet;
das Ergebnis sähe dann nach einem Modellfehler aus. Der Vertrag hat genau eine
Heimat.

Dass das Profil trägt und nicht dekorativ ist, prüft ein Test: Dieselbe Eingabe
mit `wirksam_ab: 2031-08-26` wird unter `steuern` angenommen und unter `bsi`
zurückgewiesen.

## Ein gemessener Lauf — und warum er unbequem ist

50 BSI-Warnungen, `llama3.2:1b` lokal über Ollama, 2026-09-08. Protokoll unter
`data/protokoll-bsi.jsonl`.

| | |
|---|---|
| vorgelegt (`pruefen`) | 38 |
| unklar (Schemaprüfung gerissen) | 12 |
| **archiviert** | **0 von 50 — 0 %** |

**Das Modell hat kein einziges Mal gültig „keine" gesagt.** Neunmal hat es es
versucht und sich dabei selbst widersprochen: `relevanz: "keine"` bei
gleichzeitig befüllten `bereiche`. Die Widerspruchsprüfung hat alle neun
abgefangen — als `unklar`, nicht als Archiv.

Die Konfidenz ist keine Schätzung, sondern ein Würfel mit drei Seiten: 13× genau
`1.0`, 11× genau `0.5`, 10× genau `0.0`. Und die vier Warnungen, die den Bestand
**tatsächlich** betreffen, hat es zwar alle als `hoch` erkannt — WordPress und
Kubernetes aber mit **Konfidenz 0.00**. Gleichzeitig richtig und maximal unsicher.

**Was das über das Werkzeug sagt, ist zweierlei.**

Die Schutzschicht hält: Keine ungültige Ausgabe kam durch, kein Widerspruch
wurde glattgebügelt, nichts ist still verschwunden. Bei einem Modell, das
reihenweise Unsinn produziert, verschlechtert sich das System zu „ein Mensch
liest alles" — und nicht zu „eine kritische Warnung wurde stillschweigend
archiviert". Das ist der Unterschied, für den die Eskalationsregel da ist, und
er ist hier gemessen statt behauptet.

Die Klassifikation taugt bei dieser Modellgröße nichts. **Ein Werkzeug, das
alles weiterreicht, spart keine Lesezeit.** Dafür fehlt ein größeres Modell —
dieselbe offene Stelle wie im Steuerprofil, jetzt auf einer zweiten Domäne
reproduziert. Dass sie zweimal an derselben Ursache hängt und nicht an der
Domäne, ist selbst ein Befund.

## Was das hier nicht zeigt

- **Die Klassifikationsgüte ist nicht belegt.** Geprüft ist die Schutzschicht an
  echten Modellausgaben — dass keine ungültige Ausgabe durchkommt und nichts
  still verschwindet. Ob die Urteile *gut* sind, bräuchte einen gelabelten Satz;
  der Lauf oben zeigt nur, dass sie bei 1B Parametern schlecht sind.
- **`relevanz: "hoch"` bei `konfidenz: 0.0` ist ein Widerspruch, den das Schema
  NICHT abfängt.** Er ist folgenlos, weil `relevanz !== 'keine'` ohnehin vorlegt
  — aber er ist eine Lücke in der Widerspruchsprüfung, keine Absicht.
- **Das Inventar ist handgepflegt.** In einem echten Betrieb käme es aus einer
  SBOM oder einem CMDB-Export, nicht aus einer Textliste im Profil. Solange es
  von Hand gepflegt wird, ist der stillste Fehler ein Produkt, das in Betrieb
  ging und niemand ins Profil eingetragen hat — dann urteilt das Modell korrekt
  „keine" auf einer Warnung, die sehr wohl zählt.
- **Ein Eintrag pro Feed-Link.** Der BSI-Feed führt Warnungen mit
  Versionsständen (`Version 1.0`, `1.1`, `1.2` derselben Sache). Dedup per Link
  behandelt jede Version als neu. Das ist hier gewollt — eine hochgestufte
  Warnung *soll* erneut vorgelegt werden —, aber es ist kein
  Near-Duplicate-Erkennen, und beim G-BA-Feed wäre es zu wenig.
