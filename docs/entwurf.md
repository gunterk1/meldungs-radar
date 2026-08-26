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
