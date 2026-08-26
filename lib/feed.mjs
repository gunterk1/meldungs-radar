/**
 * RSS-Abruf und -Zerlegung für den BMF-Steuerfeed.
 *
 * Bewusst ohne Laufzeitabhängigkeiten: der Feed ist wohlgeformt, klein
 * (~15 KB, 20 Einträge) und liefert genau vier Felder. Ein XML-Parser als
 * Abhängigkeit wäre hier mehr Angriffsfläche als Nutzen.
 */

export const BMF_STEUERN_FEED =
  'https://www.bundesfinanzministerium.de/SiteGlobals/Functions/RSSFeed/DE/Steuern/RSSSteuern.xml';

// Deutschsprachiger Feed: Umlaut-Entities gehören zwingend dazu. Ein Test
// hat genau das aufgedeckt — &#252; wurde dekodiert, &uuml; nicht.
const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  auml: 'ä', ouml: 'ö', uuml: 'ü', Auml: 'Ä', Ouml: 'Ö', Uuml: 'Ü',
  szlig: 'ß', euro: '€', ndash: '–', mdash: '—', hellip: '…',
  laquo: '«', raquo: '»', bdquo: '„', ldquo: '“', rdquo: '”', sbquo: '‚',
};

function entdecken(s) {
  return s
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&(\w+);/g, (m, n) => (n in ENTITIES ? ENTITIES[n] : m));
}

function feld(block, name) {
  const re = new RegExp(`<${name}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${name}>`);
  const m = block.match(re);
  return m ? entdecken(m[1]).trim() : '';
}

/** @returns {Array<{titel:string, link:string, beschreibung:string, veroeffentlicht:string}>} */
export function feedZerlegen(xml) {
  if (typeof xml !== 'string' || !xml.includes('<item>')) return [];
  return xml
    .split('<item>')
    .slice(1)
    .map((teil) => teil.split('</item>')[0])
    .map((b) => ({
      titel: feld(b, 'title'),
      link: feld(b, 'link'),
      beschreibung: feld(b, 'description'),
      veroeffentlicht: feld(b, 'pubDate'),
    }))
    .filter((e) => e.titel && e.link);
}

export async function feedHolen(url = BMF_STEUERN_FEED, fetchImpl = fetch) {
  const r = await fetchImpl(url, { headers: { accept: 'application/rss+xml, text/xml' } });
  if (!r.ok) throw new Error(`Feed nicht abrufbar: HTTP ${r.status} von ${url}`);
  return feedZerlegen(await r.text());
}

/** Entfernt Einträge, deren Link bereits gesehen wurde. `gesehen` ist ein Set. */
export function nurNeue(eintraege, gesehen) {
  return eintraege.filter((e) => !gesehen.has(e.link));
}
