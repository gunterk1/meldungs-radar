import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { feedZerlegen, nurNeue } from '../lib/feed.mjs';
import { klassifikationPruefen, SchemaFehler, jsonSchema } from '../lib/schema.mjs';
import { profilLaden, profilPruefen, ProfilFehler, PROFILE } from '../lib/profil.mjs';
import { eskalieren, VORLAGE, protokollZeile, KONFIDENZ_SCHWELLE } from '../lib/regeln.mjs';
import { klassifizieren, nutzerPrompt, systemPrompt } from '../lib/klassifikator.mjs';

const HEUTE = new Date('2026-08-26T00:00:00Z');

// Die Schema- und Eskalationstests prüfen domänenfreie Logik. Sie brauchen
// trotzdem EIN Profil, weil das Bereichs-Enum von dort kommt — genommen wird
// das Steuerprofil, weil die Fixtures unten aus diesem Thema stammen.
const PROFIL = await profilLaden('steuern');

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
    const r = klassifikationPruefen(GUELTIG, PROFIL, HEUTE);
    assert.ok(r.ok);
    assert.equal(r.wert.relevanz, 'hoch');
    assert.equal(r.wert.wirksam_ab, '2027-01-01');
  });

  test('fehlendes wirksam_ab wird zu null, nicht zu undefined', () => {
    const r = klassifikationPruefen({ ...GUELTIG, wirksam_ab: undefined }, PROFIL, HEUTE);
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
      const r = klassifikationPruefen({ ...GUELTIG, ...patch }, PROFIL, HEUTE);
      assert.equal(r.ok, false);
      assert.ok(r.fehler instanceof SchemaFehler);
      assert.equal(r.fehler.feld, feld, `Fehler sollte Feld "${feld}" benennen, benannte "${r.fehler.feld}"`);
    });
  }

  test('nimmt einen vollständigen Zeitstempel an und kürzt auf das Datum', () => {
    // Real beobachtet am 2026-08-26. Toleranz gegenüber der FORM, nicht dem INHALT.
    const r = klassifikationPruefen({ ...GUELTIG, wirksam_ab: '2026-09-15T11:50:00+02:00' }, PROFIL, HEUTE);
    assert.ok(r.ok);
    assert.equal(r.wert.wirksam_ab, '2026-09-15');
  });

  test('behandelt Leerstring als unbekannt, nicht als Fehler', () => {
    // Die Grammatik kennt keinen Nulltyp — eingeschränkte Modelle weichen aus.
    const r = klassifikationPruefen({ ...GUELTIG, wirksam_ab: '' }, PROFIL, HEUTE);
    assert.ok(r.ok);
    assert.equal(r.wert.wirksam_ab, null);
  });

  test('ein unplausibler Zeitstempel wird trotz gültiger Form abgelehnt', () => {
    const r = klassifikationPruefen({ ...GUELTIG, wirksam_ab: '2099-09-15T11:50:00+02:00' }, PROFIL, HEUTE);
    assert.equal(r.ok, false);
    assert.equal(r.fehler.feld, 'wirksam_ab');
  });

  test('weist Widerspruch zurück: relevanz "keine" mit befüllten bereichen', () => {
    const r = klassifikationPruefen({ ...GUELTIG, relevanz: 'keine', bereiche: ['Formulare'] }, PROFIL, HEUTE);
    assert.equal(r.ok, false);
    assert.equal(r.fehler.feld, 'bereiche');
  });

  test('entfernt doppelte bereiche stillschweigend — Rauschen, kein Widerspruch', () => {
    const r = klassifikationPruefen({ ...GUELTIG, bereiche: ['Formulare', 'Formulare', 'EÜR'] }, PROFIL, HEUTE);
    assert.ok(r.ok);
    assert.deepEqual(r.wert.bereiche, ['Formulare', 'EÜR']);
  });

  test('anbietersicheres Schema enthält weder pattern noch Uniontypen', () => {
    // Ollama fällt bei beidem STILL auf freie Generierung zurück (2026-08-26).
    const js = JSON.stringify(jsonSchema(PROFIL));
    assert.equal(js.includes('pattern'), false, 'pattern bricht die Grammatik');
    for (const [feld, def] of Object.entries(jsonSchema(PROFIL).properties)) {
      assert.equal(Array.isArray(def.type), false, `Uniontyp bei "${feld}" bricht die Grammatik`);
    }
    assert.equal(jsonSchema(PROFIL).required.includes('wirksam_ab'), false,
      'wirksam_ab verpflichtend zu machen erzwingt erfundene Daten');
  });

  test('weist Nicht-Objekte zurück, statt sie durchzulassen', () => {
    for (const x of [null, 'text', 42, ['a']]) {
      assert.equal(klassifikationPruefen(x, PROFIL, HEUTE).ok, false);
    }
  });
});

describe('Eskalationsregel', () => {
  test('relevanter Eintrag wird vorgelegt', () => {
    const e = eskalieren(klassifikationPruefen(GUELTIG, PROFIL, HEUTE));
    assert.equal(e.vorlage, VORLAGE.PRUEFEN);
  });

  test('sicher irrelevanter Eintrag wandert ins Archiv', () => {
    const p = klassifikationPruefen({ ...GUELTIG, relevanz: 'keine', bereiche: [], konfidenz: 0.95 }, PROFIL, HEUTE);
    assert.equal(eskalieren(p).vorlage, VORLAGE.ARCHIV);
  });

  test('UNSICHER irrelevanter Eintrag wird trotzdem vorgelegt', () => {
    const p = klassifikationPruefen({ ...GUELTIG, relevanz: 'keine', bereiche: [], konfidenz: 0.4 }, PROFIL, HEUTE);
    const e = eskalieren(p);
    assert.equal(e.vorlage, VORLAGE.UNKLAR);
    assert.match(e.grund, /Konfidenz/);
  });

  test('genau an der Schwelle wird archiviert, knapp darunter nicht', () => {
    const bei = klassifikationPruefen({ ...GUELTIG, relevanz: 'keine', bereiche: [], konfidenz: KONFIDENZ_SCHWELLE }, PROFIL, HEUTE);
    const unter = klassifikationPruefen({ ...GUELTIG, relevanz: 'keine', bereiche: [], konfidenz: KONFIDENZ_SCHWELLE - 0.01 }, PROFIL, HEUTE);
    assert.equal(eskalieren(bei).vorlage, VORLAGE.ARCHIV);
    assert.equal(eskalieren(unter).vorlage, VORLAGE.UNKLAR);
  });

  test('ungültige Modellausgabe wird ESKALIERT, nicht verworfen', () => {
    const p = klassifikationPruefen({ relevanz: 'quatsch' }, PROFIL, HEUTE);
    const e = eskalieren(p);
    assert.equal(e.vorlage, VORLAGE.UNKLAR);
    assert.match(e.grund, /Schemaprüfung fehlgeschlagen/);
  });

  test('Protokollzeile ist gültiges JSON und lässt Freigabefelder offen', () => {
    const eintrag = feedZerlegen(FEED)[0];
    const pruefung = klassifikationPruefen(GUELTIG, PROFIL, HEUTE);
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
      const r = await klassifizieren(eintrag, PROFIL, { basisUrl, modell: 'test', schluessel: '' }, fetch, HEUTE);
      assert.ok(r.ok);
      assert.equal(r.wert.relevanz, 'hoch');
    });
  });

  test('Modellausgabe ohne gültiges JSON wird abgefangen, nicht geworfen', async () => {
    await mitServer(antwortet('Klar! Hier ist die Antwort:'), async (basisUrl) => {
      const r = await klassifizieren(eintrag, PROFIL, { basisUrl, modell: 'test', schluessel: '' }, fetch, HEUTE);
      assert.equal(r.ok, false);
      assert.match(r.fehler.message, /kein gültiges JSON/);
    });
  });

  test('schemawidrige Modellausgabe wird abgefangen', async () => {
    await mitServer(antwortet(JSON.stringify({ ...GUELTIG, konfidenz: 7 })), async (basisUrl) => {
      const r = await klassifizieren(eintrag, PROFIL, { basisUrl, modell: 'test', schluessel: '' }, fetch, HEUTE);
      assert.equal(r.ok, false);
      assert.equal(r.fehler.feld, 'konfidenz');
    });
  });

  test('HTTP-Fehler des Anbieters wirft mit Endpunkt in der Meldung', async () => {
    await mitServer((req, res) => { res.writeHead(503); res.end('{}'); }, async (basisUrl) => {
      await assert.rejects(
        () => klassifizieren(eintrag, PROFIL, { basisUrl, modell: 'test', schluessel: '' }, fetch, HEUTE),
        /HTTP 503/,
      );
    });
  });

  // Aus dem ersten echten Lauf gelernt: Ollama meldete HTTP 500, der Grund
  // ("model requires more system memory") stand im Körper — und ging verloren.
  test('Fehlermeldung trägt den Grund des Anbieters, nicht nur den Statuscode', async () => {
    const grund = 'model requires more system memory (2.1 GiB) than is available (2.0 GiB)';
    await mitServer((req, res) => {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: grund, type: 'api_error' } }));
    }, async (basisUrl) => {
      await assert.rejects(
        () => klassifizieren(eintrag, PROFIL, { basisUrl, modell: 'test', schluessel: '' }, fetch, HEUTE),
        (e) => e.message.includes('HTTP 500') && e.message.includes('system memory'),
      );
    });
  });

  test('nicht-JSON-Fehlerkörper wird gekürzt mitgegeben statt verschluckt', async () => {
    await mitServer((req, res) => {
      res.writeHead(502, { 'content-type': 'text/html' });
      res.end('<html><body>  Bad   Gateway  </body></html>');
    }, async (basisUrl) => {
      await assert.rejects(
        () => klassifizieren(eintrag, PROFIL, { basisUrl, modell: 'test', schluessel: '' }, fetch, HEUTE),
        /Bad Gateway/,
      );
    });
  });

  test('ohne Schlüssel wird kein Authorization-Header gesetzt', async () => {
    let gesehen = null;
    await mitServer((req, res) => {
      gesehen = req.headers.authorization ?? null;
      antwortet(JSON.stringify(GUELTIG))(req, res);
    }, async (basisUrl) => {
      await klassifizieren(eintrag, PROFIL, { basisUrl, modell: 'test', schluessel: '' }, fetch, HEUTE);
    });
    assert.equal(gesehen, null, 'Ein leerer Schlüssel darf nicht als "Bearer " gesendet werden');
  });

  test('Prompt enthält Titel und Beschreibung des Eintrags', () => {
    const p = nutzerPrompt(eintrag);
    assert.match(p, /Lohnsteuerbescheinigung/);
    assert.match(p, /Vordruckmuster/);
  });
});

describe('Domänenprofil', () => {
  test('jedes mitgelieferte Profil besteht die eigene Prüfung', async () => {
    for (const id of PROFILE) {
      const p = await profilLaden(id);
      assert.equal(p.id, id, `${id}: id im Modul weicht vom Dateinamen ab`);
    }
  });

  test('unbekannte Kennung nennt die verfügbaren Profile, statt nur zu scheitern', async () => {
    await assert.rejects(() => profilLaden('gibtsnicht'), (e) =>
      e instanceof ProfilFehler && PROFILE.every((id) => e.message.includes(id)));
  });

  const kaputt = {
    'feed fehlt':            { feed: undefined },
    'feed ohne https':       { feed: 'http://example.org/f.xml' },
    'bereiche leer':         { bereiche: [] },
    'bereiche mit Duplikat': { bereiche: ['A', 'A'] },
    'bedeutung fehlt':       { wirksamAb: { minJahre: -1, maxJahre: 1 } },
    'Fenster verdreht':      { wirksamAb: { bedeutung: 'x', minJahre: 5, maxJahre: -5 } },
  };
  for (const [name, patch] of Object.entries(kaputt)) {
    test(`weist Profil zurück: ${name}`, async () => {
      const gut = await profilLaden('bsi');
      assert.throws(() => profilPruefen({ ...gut, ...patch }), ProfilFehler);
    });
  }

  // Der eigentliche Beweis, dass das Profil trägt: DIESELBE Eingabe wird je
  // nach Profil angenommen oder zurückgewiesen. Ein Steuertermin darf fünf
  // Jahre in der Zukunft liegen, ein Sicherheitspatch nicht.
  test('das Plausibilitätsfenster ist wirklich profilabhängig', async () => {
    const steuern = await profilLaden('steuern');
    const bsi = await profilLaden('bsi');
    const in5Jahren = { relevanz: 'keine', bereiche: [], was_aendert_sich: 'x',
                        wirksam_ab: '2031-08-26', konfidenz: 0.9 };

    assert.equal(klassifikationPruefen(in5Jahren, steuern, HEUTE).ok, true,
      'Steuerprofil erlaubt +10 Jahre — 2031 muss durchgehen');
    const abgelehnt = klassifikationPruefen(in5Jahren, bsi, HEUTE);
    assert.equal(abgelehnt.ok, false, 'BSI-Profil erlaubt nur +2 Jahre');
    assert.equal(abgelehnt.fehler.feld, 'wirksam_ab');
  });

  test('das anbietersichere Schema trägt das Enum DES PROFILS', async () => {
    for (const id of PROFILE) {
      const p = await profilLaden(id);
      assert.deepEqual(jsonSchema(p).properties.bereiche.items.enum, p.bereiche);
    }
  });

  test('der Prompt trägt Auftrag UND Vertrag — die Trennung ist die Zusage', async () => {
    const p = await profilLaden('bsi');
    const prompt = systemPrompt(p);
    assert.ok(prompt.includes(p.auftrag), 'Auftrag des Profils fehlt');
    assert.ok(prompt.includes(p.wirksamAb.bedeutung), 'Bedeutung von wirksam_ab fehlt');
    for (const b of p.bereiche) assert.ok(prompt.includes(b), `Bereich "${b}" fehlt im Prompt`);
    assert.ok(prompt.includes('konfidenz'), 'Vertragsteil fehlt');
  });

  // Das BSI-Profil steht und fällt mit der Negativliste: Ohne sie muss das
  // Modell raten, ob eine Firewall-Warnung "uns" betrifft. Verschwindet sie
  // beim Umformulieren, wird das Profil still schlechter.
  test('das BSI-Profil benennt ausdrücklich, was NICHT im Bestand ist', async () => {
    const p = await profilLaden('bsi');
    assert.match(p.auftrag, /NICHT IM BESTAND/);
    for (const fremd of ['SharePoint', 'Fortinet', 'MongoDB', 'cPanel']) {
      assert.ok(p.auftrag.includes(fremd), `"${fremd}" fehlt in der Negativliste`);
    }
  });
});
