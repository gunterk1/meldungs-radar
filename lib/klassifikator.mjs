/**
 * Provider-agnostischer Aufruf eines OpenAI-kompatiblen Endpunkts.
 *
 * Derselbe Code läuft gegen eine gehostete API oder gegen ein selbst
 * betriebenes Modell (Ollama, LocalAI, vLLM). Der Wechsel ist Konfiguration:
 * RADAR_BASIS_URL umstellen, fertig.
 *
 * Für BEIDE mitgelieferten Profile ist ein gehostetes Modell vertretbar — die
 * Quellen sind öffentliche Behördenmeldungen, es fließen keine
 * personenbezogenen Daten. Das ist eine begründete Entscheidung, keine
 * Bequemlichkeit. Sobald ein Profil Kundendaten berührt, ist der selbst
 * betriebene Weg der einzige, und dieser Code kann ihn ohne Umbau.
 */
import { klassifikationPruefen, jsonSchema } from './schema.mjs';
import { RELEVANZ } from './profil.mjs';

/**
 * Der Prompt hat zwei Hälften, und die Trennung ist Absicht.
 *
 * Das Profil liefert den AUFTRAG — worum es geht, welches Inventar gilt, was
 * "keine" bedeutet. Diese Funktion liefert den VERTRAG — die Form der Ausgabe,
 * abgeleitet aus denselben Konstanten, gegen die anschliessend geprüft wird.
 *
 * Läge der Vertrag im Profil, könnte ein Profil ihn unbemerkt anders
 * formulieren als die Prüfung ihn erwartet. Dann scheiterte die Prüfung, und
 * es sähe nach einem Modellfehler aus. Der Vertrag hat genau eine Heimat.
 */
export function systemPrompt(profil) {
  return `${profil.auftrag}

Antworte NUR mit JSON in genau dieser Form:
{"relevanz": ${RELEVANZ.map((r) => `"${r}"`).join('|')},
 "bereiche": [${profil.bereiche.map((b) => `"${b}"`).join(', ')}],
 "was_aendert_sich": "ein Satz auf Deutsch",
 "wirksam_ab": "YYYY-MM-DD" oder null,
 "konfidenz": Zahl zwischen 0 und 1}

Regeln:
- "bereiche" darf nur bei relevanz "keine" leer sein.
- "wirksam_ab" meint: ${profil.wirksamAb.bedeutung}. Nur setzen, wenn ein Datum
  im Text steht oder eindeutig folgt. Sonst null.
- "konfidenz" ehrlich schätzen. Bei dünner Grundlage niedrig — Unsicherheit wird
  einem Menschen vorgelegt, nicht bestraft.`;
}

export function nutzerPrompt(eintrag) {
  return `Titel: ${eintrag.titel}\nVeröffentlicht: ${eintrag.veroeffentlicht}\n\n${eintrag.beschreibung || '(keine Beschreibung im Feed)'}`;
}

/** Zieht die Fehlermeldung des Anbieters aus dem Antwortkörper, ohne je zu werfen. */
async function anbieterGrund(r) {
  let text;
  try { text = await r.text(); } catch { return '(Antwortkörper nicht lesbar)'; }
  if (!text) return '(leerer Antwortkörper)';
  try {
    const j = JSON.parse(text);
    const m = j?.error?.message ?? j?.message ?? j?.error;
    if (typeof m === 'string' && m) return m;
  } catch { /* kein JSON — Rohtext gekürzt zurückgeben */ }
  return text.slice(0, 300).replace(/\s+/g, ' ').trim();
}

/**
 * RADAR_* ist der Name seit dem Profil-Umbau. STEUERRADAR_* wird weiter
 * gelesen, weil eine stillschweigend ignorierte Umgebungsvariable die
 * unangenehmste Sorte Fehler ist: Der Lauf startet, greift auf den
 * Vorgabe-Endpunkt und schlägt dort mit einer Meldung fehl, die nichts mit der
 * Ursache zu tun hat.
 */
export function konfigAusUmgebung(env = process.env) {
  return {
    basisUrl: env.RADAR_BASIS_URL || env.STEUERRADAR_BASIS_URL || 'https://api.openai.com/v1',
    modell: env.RADAR_MODELL || env.STEUERRADAR_MODELL || 'gpt-4o-mini',
    schluessel: env.RADAR_API_KEY || env.STEUERRADAR_API_KEY || '',
  };
}

/**
 * Klassifiziert einen Eintrag. Wirft nie wegen einer schlechten Modellantwort —
 * ungültige Ausgaben kommen als {ok:false} zurück und werden eskaliert.
 */
export async function klassifizieren(eintrag, profil, konfig, fetchImpl = fetch, heute = new Date()) {
  const r = await fetchImpl(`${konfig.basisUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(konfig.schluessel ? { authorization: `Bearer ${konfig.schluessel}` } : {}),
    },
    body: JSON.stringify({
      model: konfig.modell,
      temperature: 0,
      // Eingeschränkte Generierung: verhindert die häufigste Fehlerklasse
      // kleiner Modelle — erfundene Enum-Werte — bereits beim Erzeugen.
      // Belegt im Lauf vom 2026-08-26: 9 von 20 Ausgaben erfanden `bereiche`.
      // Die Laufzeitprüfung bleibt trotzdem, siehe jsonSchema() in schema.mjs.
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'klassifikation', strict: true, schema: jsonSchema(profil) },
      },
      messages: [
        { role: 'system', content: systemPrompt(profil) },
        { role: 'user', content: nutzerPrompt(eintrag) },
      ],
    }),
  });

  if (!r.ok) {
    // Der Anbieter erklärt den Fehler im Körper. Eine Meldung, die nur den
    // Statuscode nennt, zwingt zum Nachstellen mit curl — also mitgeben.
    // Beispiel aus dem ersten Lauf: HTTP 500 hiess in Wahrheit
    // "model requires more system memory (2.1 GiB) than is available (2.0 GiB)".
    throw new Error(
      `Modell nicht erreichbar: HTTP ${r.status} von ${konfig.basisUrl}/chat/completions`
      + ` — ${await anbieterGrund(r)}`,
    );
  }

  const antwort = await r.json();
  const text = antwort?.choices?.[0]?.message?.content;
  if (typeof text !== 'string') {
    return { ok: false, fehler: new Error('Antwort ohne choices[0].message.content') };
  }

  let roh;
  try {
    roh = JSON.parse(text);
  } catch {
    return { ok: false, fehler: new Error('Modellausgabe ist kein gültiges JSON') };
  }
  return klassifikationPruefen(roh, profil, heute);
}
