/**
 * Provider-agnostischer Aufruf eines OpenAI-kompatiblen Endpunkts.
 *
 * Derselbe Code läuft gegen eine gehostete API oder gegen ein selbst
 * betriebenes Modell (Ollama, LocalAI, vLLM). Der Wechsel ist Konfiguration:
 * STEUERRADAR_BASIS_URL umstellen, fertig.
 *
 * Für DIESEN Anwendungsfall ist ein gehostetes Modell vertretbar — die Quelle
 * sind öffentliche BMF-Schreiben, es fließen keine personenbezogenen Daten.
 * Das ist eine begründete Entscheidung, keine Bequemlichkeit. Sobald ein
 * Workflow Kundendaten berührt, ist der selbst betriebene Weg der einzige,
 * und dieser Code kann ihn ohne Umbau.
 */
import { klassifikationPruefen, jsonSchema, RELEVANZ, BEREICHE } from './schema.mjs';

export const SYSTEM_PROMPT = `Du klassifizierst Meldungen des Bundesfinanzministeriums für ein Steuer-SaaS.

Das Produkt erstellt Online-Steuererklärungen für Privatpersonen und Kleinunternehmen:
Einkommensteuer, Umsatzsteuer, Gewerbesteuer, EÜR, Abgabe über die ELSTER-Schnittstelle.

Beurteile ausschliesslich, ob die Meldung eine ÄNDERUNG auslöst, die dieses Produkt
umsetzen muss. Reine Statistik, Personalien, Ressortnachrichten und Themen ausserhalb
dieser Steuerarten sind "keine".

Antworte NUR mit JSON in genau dieser Form:
{"relevanz": ${RELEVANZ.map(r=>`"${r}"`).join('|')},
 "bereiche": [${BEREICHE.map(b=>`"${b}"`).join(', ')}],
 "was_aendert_sich": "ein Satz auf Deutsch",
 "wirksam_ab": "YYYY-MM-DD" oder null,
 "konfidenz": Zahl zwischen 0 und 1}

Regeln:
- "bereiche" darf nur bei relevanz "keine" leer sein.
- "wirksam_ab" nur setzen, wenn ein Datum im Text steht oder eindeutig folgt. Sonst null.
- "konfidenz" ehrlich schätzen. Bei dünner Grundlage niedrig — Unsicherheit wird
  einem Menschen vorgelegt, nicht bestraft.`;

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

export function konfigAusUmgebung(env = process.env) {
  return {
    basisUrl: env.STEUERRADAR_BASIS_URL || 'https://api.openai.com/v1',
    modell: env.STEUERRADAR_MODELL || 'gpt-4o-mini',
    schluessel: env.STEUERRADAR_API_KEY || '',
  };
}

/**
 * Klassifiziert einen Eintrag. Wirft nie wegen einer schlechten Modellantwort —
 * ungültige Ausgaben kommen als {ok:false} zurück und werden eskaliert.
 */
export async function klassifizieren(eintrag, konfig, fetchImpl = fetch, heute = new Date()) {
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
        json_schema: { name: 'klassifikation', strict: true, schema: jsonSchema() },
      },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
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
  return klassifikationPruefen(roh, heute);
}
