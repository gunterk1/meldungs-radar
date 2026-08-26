import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { feedZerlegen, nurNeue } from '../lib/feed.mjs';
import { klassifikationPruefen, SchemaFehler } from '../lib/schema.mjs';
import { eskalieren, VORLAGE, protokollZeile, KONFIDENZ_SCHWELLE } from '../lib/regeln.mjs';
import { klassifizieren, nutzerPrompt } from '../lib/klassifikator.mjs';

const HEUTE = new Date('2026-08-26T00:00:00Z');

const FEED = `<?xml version="1.0"?><rss><channel>
<item><title>Muster f&#252;r den Ausdruck der elektronischen Lohnsteuerbescheinigung f&uuml;r 2027</title>
<link>https://bmf.example/a</link><description>Das Vordruckmuster wird hiermit bekanntgemacht.</description>
<pubDate>Thu, 13 Aug 2026 00:00:00 +0200</pubDate></item>
<item><title>Kassenm&auml;&szlig;ige Steuereinnahmen</title>
<link>https://bmf.example/b</link><description><![CDATA[Monatliche Ergebnisse als Download.]]></description>
<pubDate>Thu, 20 Aug 2026 08:00:00 +0200</pubDate></item>
</channel></rss>`;

const GUELTIG = {
  relevanz: 'hoch', bereiche: ['Formulare'],
  was_aendert_sich: 'Neues Vordruckmuster ab 2027.',
  wirksam_ab: '2027-01-01', konfidenz: 0.9,
};

describe('Feed', () => {
  test('zerlegt Einträge und dekodiert Entities', () => {
    const e = feedZerlegen(FEED);
    assert.equal(e.length, 2);
    assert.equal(e[0].titel, 'Muster für den Ausdruck der elektronischen Lohnsteuerbescheinigung für 2027');
    assert.equal(e[1].titel, 'Kassenmäßige Steuereinnahmen');
    assert.equal(e[1].beschreibung, 'Monatliche Ergebnisse als Download.'); // CDATA
  });

  test('liefert leeres Array statt zu werfen, wenn kein Feed kommt', () => {
    assert.deepEqual(feedZerlegen('<html>Fehlerseite</html>'), []);
    assert.deepEqual(feedZerlegen(null), []);
  });

  test('nurNeue filtert bereits gesehene Links', () => {
    const e = feedZerlegen(FEED);
    const neu = nurNeue(e, new Set(['https://bmf.example/a']));
    assert.equal(neu.length, 1);
    assert.equal(neu[0].link, 'https://bmf.example/b');
  });
});

describe('Schemaprüfung', () => {
  test('nimmt eine gültige Ausgabe an und normalisiert sie', () => {
    const r = klassifikationPruefen(GUELTIG, HEUTE);
    assert.ok(r.ok);
    assert.equal(r.wert.relevanz, 'hoch');
    assert.equal(r.wert.wirksam_ab, '2027-01-01');
  });

  test('fehlendes wirksam_ab wird zu null, nicht zu undefined', () => {
    const r = klassifikationPruefen({ ...GUELTIG, wirksam_ab: undefined }, HEUTE);
    assert.ok(r.ok);
    assert.equal(r.wert.wirksam_ab, null);
  });

  for (const [name, patch, feld] of [
    ['unbekannte relevanz',        { relevanz: 'vielleicht' },                'relevanz'],
    ['unbekannter bereich',        { bereiche: ['Erbschaftsteuer'] },         'bereiche'],
    ['relevant ohne bereich',      { bereiche: [] },                          'bereiche'],
    ['leerer Änderungstext',       { was_aendert_sich: '   ' },               'was_aendert_sich'],
    ['Datum im falschen Format',   { wirksam_ab: '01.01.2027' },              'wirksam_ab'],
    ['Datum unplausibel weit weg', { wirksam_ab: '2099-01-01' },              'wirksam_ab'],
    ['Konfidenz über 1',           { konfidenz: 1.4 },                        'konfidenz'],
    ['Konfidenz kein Zahlenwert',  { konfidenz: 'hoch' },                     'konfidenz'],
  ]) {
    test(`weist zurück: ${name}`, () => {
      const r = klassifikationPruefen({ ...GUELTIG, ...patch }, HEUTE);
      assert.equal(r.ok, false);
      assert.ok(r.fehler instanceof SchemaFehler);
      assert.equal(r.fehler.feld, feld, `Fehler sollte Feld "${feld}" benennen, benannte "${r.fehler.feld}"`);
    });
  }

  test('weist Nicht-Objekte zurück, statt sie durchzulassen', () => {
    for (const x of [null, 'text', 42, ['a']]) {
      assert.equal(klassifikationPruefen(x, HEUTE).ok, false);
    }
  });
});

describe('Eskalationsregel', () => {
  test('relevanter Eintrag wird vorgelegt', () => {
    const e = eskalieren(klassifikationPruefen(GUELTIG, HEUTE));
    assert.equal(e.vorlage, VORLAGE.PRUEFEN);
  });

  test('sicher irrelevanter Eintrag wandert ins Archiv', () => {
    const p = klassifikationPruefen({ ...GUELTIG, relevanz: 'keine', bereiche: [], konfidenz: 0.95 }, HEUTE);
    assert.equal(eskalieren(p).vorlage, VORLAGE.ARCHIV);
  });

  test('UNSICHER irrelevanter Eintrag wird trotzdem vorgelegt', () => {
    const p = klassifikationPruefen({ ...GUELTIG, relevanz: 'keine', bereiche: [], konfidenz: 0.4 }, HEUTE);
    const e = eskalieren(p);
    assert.equal(e.vorlage, VORLAGE.UNKLAR);
    assert.match(e.grund, /Konfidenz/);
  });

  test('genau an der Schwelle wird archiviert, knapp darunter nicht', () => {
    const bei = klassifikationPruefen({ ...GUELTIG, relevanz: 'keine', bereiche: [], konfidenz: KONFIDENZ_SCHWELLE }, HEUTE);
    const unter = klassifikationPruefen({ ...GUELTIG, relevanz: 'keine', bereiche: [], konfidenz: KONFIDENZ_SCHWELLE - 0.01 }, HEUTE);
    assert.equal(eskalieren(bei).vorlage, VORLAGE.ARCHIV);
    assert.equal(eskalieren(unter).vorlage, VORLAGE.UNKLAR);
  });

  test('ungültige Modellausgabe wird ESKALIERT, nicht verworfen', () => {
    const p = klassifikationPruefen({ relevanz: 'quatsch' }, HEUTE);
    const e = eskalieren(p);
    assert.equal(e.vorlage, VORLAGE.UNKLAR);
    assert.match(e.grund, /Schemaprüfung fehlgeschlagen/);
  });

  test('Protokollzeile ist gültiges JSON und lässt Freigabefelder offen', () => {
    const eintrag = feedZerlegen(FEED)[0];
    const pruefung = klassifikationPruefen(GUELTIG, HEUTE);
    const z = JSON.parse(protokollZeile({
      eintrag, pruefung, entscheidung: eskalieren(pruefung),
      modell: 'test', zeitpunkt: HEUTE.toISOString(),
    }));
    assert.equal(z.link, 'https://bmf.example/a');
    assert.equal(z.vorlage, VORLAGE.PRUEFEN);
    assert.equal(z.freigabe, null);
    assert.equal(z.freigegeben_von, null);
  });
});

/** Wegwerf-Server, der einen OpenAI-kompatiblen Endpunkt nachstellt. */
async function mitServer(handler, fn) {
  const srv = createServer(handler);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const basisUrl = `http://127.0.0.1:${srv.address().port}/v1`;
  try {
    return await fn(basisUrl);
  } finally {
    await new Promise((r) => srv.close(r));
  }
}

function antwortet(inhalt, status = 200) {
  return (req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: inhalt } }] }));
    });
  };
}

describe('Klassifikator gegen einen echten HTTP-Endpunkt', () => {
  const eintrag = feedZerlegen(FEED)[0];

  test('gültige Modellantwort kommt geprüft zurück', async () => {
    await mitServer(antwortet(JSON.stringify(GUELTIG)), async (basisUrl) => {
      const r = await klassifizieren(eintrag, { basisUrl, modell: 'test', schluessel: '' }, fetch, HEUTE);
      assert.ok(r.ok);
      assert.equal(r.wert.relevanz, 'hoch');
    });
  });

  test('Modellausgabe ohne gültiges JSON wird abgefangen, nicht geworfen', async () => {
    await mitServer(antwortet('Klar! Hier ist die Antwort:'), async (basisUrl) => {
      const r = await klassifizieren(eintrag, { basisUrl, modell: 'test', schluessel: '' }, fetch, HEUTE);
      assert.equal(r.ok, false);
      assert.match(r.fehler.message, /kein gültiges JSON/);
    });
  });

  test('schemawidrige Modellausgabe wird abgefangen', async () => {
    await mitServer(antwortet(JSON.stringify({ ...GUELTIG, konfidenz: 7 })), async (basisUrl) => {
      const r = await klassifizieren(eintrag, { basisUrl, modell: 'test', schluessel: '' }, fetch, HEUTE);
      assert.equal(r.ok, false);
      assert.equal(r.fehler.feld, 'konfidenz');
    });
  });

  test('HTTP-Fehler des Anbieters wirft mit Endpunkt in der Meldung', async () => {
    await mitServer((req, res) => { res.writeHead(503); res.end('{}'); }, async (basisUrl) => {
      await assert.rejects(
        () => klassifizieren(eintrag, { basisUrl, modell: 'test', schluessel: '' }, fetch, HEUTE),
        /HTTP 503/,
      );
    });
  });

  test('ohne Schlüssel wird kein Authorization-Header gesetzt', async () => {
    let gesehen = null;
    await mitServer((req, res) => {
      gesehen = req.headers.authorization ?? null;
      antwortet(JSON.stringify(GUELTIG))(req, res);
    }, async (basisUrl) => {
      await klassifizieren(eintrag, { basisUrl, modell: 'test', schluessel: '' }, fetch, HEUTE);
    });
    assert.equal(gesehen, null, 'Ein leerer Schlüssel darf nicht als "Bearer " gesendet werden');
  });

  test('Prompt enthält Titel und Beschreibung des Eintrags', () => {
    const p = nutzerPrompt(eintrag);
    assert.match(p, /Lohnsteuerbescheinigung/);
    assert.match(p, /Vordruckmuster/);
  });
});
