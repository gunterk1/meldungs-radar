# Steuer-Radar

Überwacht die Steuermeldungen des Bundesfinanzministeriums, klassifiziert jede Meldung
danach, ob sie ein Steuer-SaaS zur Änderung zwingt, und **legt sie einem Menschen vor.
Nichts wird ohne Freigabe wirksam.**

Gebaut für [taxtastic](https://taxtastic.de) — Online-Steuererklärungen mit
ELSTER-Anbindung. Der Bedarf ist banal und wiederkehrend: Steuerregeln ändern sich
jährlich, das BMF meldet es öffentlich, und irgendwer muss es nachhalten.

```
npm test                      # 34 Tests, keine Laufzeitabhängigkeiten
node bin/radar.mjs --trocken  # Feed abrufen und zeigen, ohne Modellaufruf
node bin/radar.mjs            # ein vollständiger Durchlauf
docker compose up -d          # n8n als Zeitgeber und Freigabeoberfläche
```

## Warum hier überhaupt ein Sprachmodell steht

Das ist die Frage, die vor dem Bauen kommt — und sie hat oft die Antwort „gar nicht".
Hier hat sie eine andere, und der Grund lässt sich vorführen. Ein Feedabruf vom
2026-08-26 lieferte zwanzig Meldungen. Darunter:

| Meldung | Betrifft das Produkt |
|---|---|
| Entwurf eines Einkommensteuerreformgesetzes 2027 | **ja** |
| Muster für den Ausdruck der elektronischen Lohnsteuerbescheinigung für 2027 | **ja** |
| Nutzung eines betrieblichen Kfz für private Fahrten (§ 9 EStG) | **ja** |
| Kassenmäßige Steuereinnahmen nach Steuerarten | nein — Statistik |
| Entwurf eines Gesetzes zur Änderung des Tabaksteuergesetzes | nein |
| Reform der Steuerberaterprüfung | nein |

**Ein Stichwortfilter scheitert daran vorhersehbar.** Er lässt „Tabaksteuergesetz" und
„Kassenmäßige Steuereinnahmen" durch, weil „Steuer" darin vorkommt, und verwirft womöglich
das Vordruckmuster, weil „Einkommensteuer" fehlt. Relevanzurteil über unstrukturierten
Text ist genau die Aufgabe, bei der ein Modell etwas beiträgt, das deterministischer Code
nicht kann.

Wäre der Feed sortenrein, wäre die richtige Lösung eine Weiterleitungsregel und kein
Modell. **Diese Unterscheidung ist der Zweck des Projekts.**

## Die Bauform

```
  Zeitplan → Feed → Dedup → Modell → Schemaprüfung → Eskalation → Mensch → Protokoll
                                          ▲                ▲          ▲
                                    deterministisch    Regel      entscheidet
```

**1 · Das Modell liefert Text, dieser Code entscheidet, was davon gilt.**
`lib/schema.mjs` prüft jede Ausgabe zur Laufzeit gegen ein Schema — Enum-Zugehörigkeit,
Datumsformat, Plausibilität des Wirksamkeitsdatums, Konfidenz im Bereich [0,1]. Geprüft,
nicht gecastet. Ein `SchemaFehler` benennt das Feld.

**2 · Unsicherheit eskaliert, statt zu verschwinden.**

```js
vorgelegt wird, wenn  relevanz !== 'keine'  ODER  konfidenz < 0.7
```

Eine ungültige Modellausgabe wird **nicht verworfen**, sondern als `unklar` vorgelegt. Wer
die Schemaprüfung reißt, hat vielleicht trotzdem etwas Wichtiges gesehen. Ein Ausfall des
Anbieters markiert den Eintrag nicht als gesehen — der nächste Lauf greift ihn erneut auf.
**Kein Pfad in diesem Werkzeug führt dazu, dass eine Meldung still unter den Tisch fällt.**

**3 · Der Mensch entscheidet, und es ist nachweisbar.**
Jeder Vorgang landet zeilenweise in `data/protokoll.jsonl` mit Modellausgabe,
Prüfergebnis, Einstufung und Begründung. Die Felder `freigabe`, `freigegeben_von` und
`freigegeben_am` bleiben leer, bis ein Mensch entschieden hat.

## Datenresidenz

Der Code ist **provider-agnostisch** gegen einen OpenAI-kompatiblen Endpunkt. Derselbe
Code läuft gegen eine gehostete API oder gegen ein selbst betriebenes Modell — der Wechsel
sind drei Zeilen in `.env`, kein Umbau.

Für **diesen** Anwendungsfall ist ein gehostetes Modell vertretbar: Die Quelle sind
öffentliche BMF-Meldungen, es fließen keine personenbezogenen Daten. **Das ist eine
begründete Entscheidung, keine Bequemlichkeit** — und sie kehrt sich um, sobald ein
Workflow Kundendaten berührt. Für diesen Fall liegt das Ollama-Profil in der
`docker-compose.yml` bereit.

## Aufbau

```
lib/feed.mjs           RSS-Abruf und -Zerlegung, ohne Abhängigkeiten
lib/schema.mjs         Laufzeitvalidierung der Modellausgabe
lib/regeln.mjs         Eskalationsregel und Protokollformat
lib/klassifikator.mjs  provider-agnostischer Modellaufruf
bin/radar.mjs          ein Durchlauf, auch als --trocken
workflows/             n8n-Workflow: Zeitgeber, Ausführung, Freigabe
test/                  34 Tests gegen einen Wegwerf-HTTP-Server
```

**Eine Implementierung, nicht zwei.** Der n8n-Workflow ruft über einen Execute-Command-Node
`bin/radar.mjs` im gemounteten Repo auf, statt die Logik in einem Code-Node nachzubauen.
Was getestet ist, läuft auch produktiv.

## Was vier echte Läufe gezeigt haben

Alle gegen `qwen2.5:0.5b` über Ollama, dieselben zwanzig Meldungen vom 2026-08-26.
Jeder Lauf deckte einen echten Defekt auf; jeder Defekt ist als Test festgehalten.

| Lauf | Konfiguration | vorlegen · unklar | Befund |
|---|---|---|---|
| 1 | `response_format: json_object` | 11 · 9 | Modell erfindet `bereiche`-Werte („Kindergeld", „EU-Recht") statt aus dem Enum zu wählen |
| 2 | volles JSON-Schema | 1 · 19 | **Ollama übersetzt `pattern` und Uniontypen nicht in seine Grammatik — und fällt dann STILL auf freie Generierung zurück.** HTTP 200, `finish_reason: "stop"`, Prosa statt JSON |
| 3 | anbietersicheres Schema | 16 · 4 | Modell liefert `"2026-09-15T11:50:00+02:00"` statt eines Datums |
| 4 | + Toleranz für Zeitstempel | **19 · 1** | Der letzte Fehler ist die Plausibilitätsprüfung: erfundenes `wirksam_ab` im Jahr **2013** |

**Die wichtigste Lehre steht in Lauf 2.** Eingeschränkte Generierung ist ein *Hinweis*, keine
Garantie — ein Anbieter, der ein Schemaelement nicht ausdrücken kann, verwirft die
Einschränkung möglicherweise ohne Fehler und ohne Warnung. Die Laufzeitprüfung ist deshalb
nicht Gürtel-und-Hosenträger, sondern die eigentliche Absicherung. `jsonSchema()` enthält
darum bewusst weder `pattern` noch Uniontypen, und `wirksam_ab` ist nicht verpflichtend —
sonst zwingt die Grammatik das Modell, ein Datum zu erfinden, wo keines im Text steht.

**Und was die Läufe über das Modell sagen: `qwen2.5:0.5b` taugt für diese Aufgabe nicht.**
In keinem der vier Läufe wurde ein einziger Eintrag archiviert — das Modell stufte auch das
*Siebte Steuerforum der Finanzverwaltung* und die *körperschaftsteuerliche Organschaft* als
relevant ein. Ein Werkzeug, das alles weiterreicht, spart keine Lesezeit. **Die Schutzschicht
ist bewiesen, die Urteilsfähigkeit steht noch aus** — dafür braucht es ein größeres Modell.

## Was noch fehlt

- **Freigabekanal.** Der letzte Node bereitet die Vorlage auf; über welchen Weg zugestimmt
  wird (E-Mail, Slack, n8n *Send and Wait*), ist bewusst offen und hängt am Betrieb.
- **Zweite Stufe.** Bei Relevanz das verlinkte Dokument nachladen und den konkreten
  Handlungsbedarf extrahieren. Die Feed-Beschreibungen sind im Median 255 Zeichen lang —
  genug für Relevanz, nicht für Inhalt.
- **Rückschreiben der Freigabe** ins Protokoll.
- **Ein Modell, das urteilen kann.** Siehe oben — die Schutzschicht steht, die
  Klassifikationsgüte ist unbelegt.

## Lizenz

MIT
