# Entwurfsnotizen

## Warum die Quelle geprüft wurde, bevor irgendetwas gebaut wurde

Drei geratene URLs lieferten am 2026-08-26 alle HTTP 404 — bei jeweils rund 170 KB
Inhalt, also die Fehlerseiten der Portale. Erst die Suche nach der echten
RSS-Übersichtsseite führte zu:

    https://www.bundesfinanzministerium.de/SiteGlobals/Functions/RSSFeed/DE/Steuern/RSSSteuern.xml

**Ein Statuscode allein ist kein Liveness-Nachweis.** 404 mit 170 KB Körper ist eine
Fehlerseite; 200 mit einer Fehlerseite darin wäre ein Soft-404. Geprüft wird gegen den
Inhalt: Der Feed muss `<item>`-Elemente mit Titel und Link liefern, sonst gilt er als
nicht abrufbar.

## Warum der Feed-Parser keine Abhängigkeit hat

Der Feed ist wohlgeformt, rund 15 KB groß und liefert vier Felder. Ein XML-Parser als
Abhängigkeit wäre hier mehr Angriffsfläche als Nutzen — dieselbe Abwägung wie bei der
Laufzeitvalidierung: lieber wenig eigener, geprüfter Code als viel fremder.

**Ein Test hat dabei sofort einen echten Fehler gefunden:** Die erste Fassung dekodierte
numerische Entities (`&#252;`), aber keine benannten (`&uuml;`) — ein Verarbeiter für
einen deutschsprachigen Feed ohne Umlaut-Entities. Behoben in `lib/feed.mjs`.

## Warum die Eskalationsschwelle bei 0,7 liegt

Willkürlich gewählt und bewusst konfigurierbar (`KONFIDENZ_SCHWELLE`). Die Richtung ist
das Entscheidende, nicht der Wert: **Im Zweifel vorlegen.** Ein zu oft vorgelegter Eintrag
kostet dreißig Sekunden Lesezeit. Eine übersehene Gesetzesänderung kostet eine falsche
Steuererklärung.

Wenn sich in den Protokolldaten zeigt, dass Einträge zwischen 0,5 und 0,7 durchgehend als
irrelevant bestätigt werden, kann die Schwelle sinken. **Nicht vorher, und nicht nach
Gefühl — nach Protokoll.**

## Verworfene Varianten

- **Support-Posteingang triagieren.** Enthält per Definition personenbezogene Daten, damit
  nur gegen ein selbst betriebenes Modell und nicht öffentlich zeigbar.
- **ELSTER-Rückmeldungen übersetzen.** Der bessere Geschäftsfall — Fehlercode auflösen,
  Erklärung entwerfen, freigeben, versenden. Aber Bezug zur konkreten Abgabe, also
  Kundendaten. Der natürliche zweite Schritt, sobald diese Bauform steht.

---

# Umbau auf Domänenprofile (2026-09-08)

## Warum das Thema wechselte

Das Repo behauptete, eine übertragbare Bauform zu zeigen, belegte aber eine
Steueranwendung. Solange die Domäne an vier Stellen im Code klebte — Feed-URL,
Bereichs-Enum, Prompt, Namen —, war die Behauptung nicht prüfbar. Zwei Profile
belegen, was eines nur behaupten kann.

## Die Feed-Auswahl war empirisch, nicht thematisch

Erste Idee war Baurecht. Vier Kandidatenquellen wurden am 2026-09-08 tatsächlich
abgerufen, statt sie zu beurteilen — und die Erhebung kippte die Wahl:

| Quelle | Befund |
|---|---|
| **BSI Cyber-Sicherheitswarnungen** | 50 Einträge, jeder substanziell, Relevanz hängt am eigenen Bestand. **Gewählt.** |
| G-BA (letzte Änderungen) | 10 Einträge, dicht und regulatorisch — aber derselbe Beschluss erscheint 3× unter verschiedenen Anlagen. Bräuchte Near-Duplicate-Erkennung, die es hier nicht gibt. |
| BMWSB (Bauen) | **Presse-Feed.** Von 20 Einträgen ist genau einer regulatorisch (CO2KostenAufG). Spatenstich, Fotowettbewerb, Girls' Day. Regulatorisches Baurecht steht in 16 Landesbauordnungen, nicht in Ministeriums-Pressemeldungen — **falsche Quelle, nicht schwieriges Thema.** |
| DIBt | kein auffindbarer Feed. |

Der BMWSB-Feed lieferte dabei das schönste Filter-Gegenbeispiel, das die
Erhebung hergab, und es ist zu gut, um es wegzuwerfen: Ein Stichwortfilter auf
`Bau` nimmt **„Branitzer Baumuniversität"** mit und verwirft
**„CO2KostenAufG"** — die einzige regulatorische Meldung im Feed. Substring-
Treffer und Fachbegriff gehen in entgegengesetzte Richtungen.

**Wieder bestätigt:** Von sechs geratenen Feed-URLs lieferten alle sechs HTTP 404
mit 60–160 KB Körper — die Fehlerseiten der Portale. Die echten Adressen standen
in den Startseiten. Dieselbe Lehre wie am 2026-08-26, nur teurer, weil ich sie
kannte.

## Was das Profil bewusst NICHT darf

Die Form der Modellausgabe ändern. Die Versuchung war da: Für
Sicherheitswarnungen wären `cve`, `aktiv_ausgenutzt` und `betroffene_produkte`
die natürlichen Felder, und `wirksam_ab` passt schlecht. Ein profilabhängiges
Schema hätte aber die gemeinsame Prüfung aufgelöst — und die ist der Kern des
Werkzeugs, nicht das Vokabular.

Gewählt wurde der Mittelweg: **fester Vertrag, austauschbares Vokabular.**
`wirksam_ab` bleibt, aber jedes Profil muss ausdrücklich sagen, was es dort
meint (`wirksamAb.bedeutung`) und welches Fenster plausibel ist. Der Preis ist
ein Feld, das im BSI-Profil selten gefüllt ist. Das ist ehrlicher als ein Feld,
das überall passt und nirgends etwas bedeutet.
