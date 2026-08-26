/**
 * Laufzeitvalidierung der Modellausgabe — geprüft, nicht gecastet.
 *
 * Ein Sprachmodell liefert Text. Was davon ein gültiges Klassifikationsergebnis
 * ist, entscheidet dieser Code und nicht das Modell. Fällt eine Prüfung durch,
 * wird der Eintrag NICHT verworfen, sondern als unklar eskaliert — siehe
 * `eskalieren()` in lib/regeln.mjs.
 */

export class SchemaFehler extends Error {
  constructor(feld, grund, wert) {
    super(`Feld "${feld}": ${grund}` + (wert === undefined ? '' : ` (erhalten: ${JSON.stringify(wert)})`));
    this.name = 'SchemaFehler';
    this.feld = feld;
    this.grund = grund;
  }
}

export const RELEVANZ = ['hoch', 'mittel', 'keine'];
export const BEREICHE = [
  'Einkommensteuer', 'Umsatzsteuer', 'Gewerbesteuer',
  'EÜR', 'ELSTER-Schnittstelle', 'Formulare',
];

const ISO_DATUM = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Prüft eine Modellausgabe gegen das Klassifikationsschema.
 * @returns {{ok: true, wert: object} | {ok: false, fehler: SchemaFehler}}
 */
export function klassifikationPruefen(roh, heute = new Date()) {
  try {
    if (roh === null || typeof roh !== 'object' || Array.isArray(roh)) {
      throw new SchemaFehler('(wurzel)', 'kein Objekt', roh);
    }

    if (!RELEVANZ.includes(roh.relevanz)) {
      throw new SchemaFehler('relevanz', `nicht in ${RELEVANZ.join('|')}`, roh.relevanz);
    }

    if (!Array.isArray(roh.bereiche)) {
      throw new SchemaFehler('bereiche', 'kein Array', roh.bereiche);
    }
    for (const b of roh.bereiche) {
      if (!BEREICHE.includes(b)) throw new SchemaFehler('bereiche', 'unbekannter Bereich', b);
    }
    // Widersprüche in BEIDE Richtungen. Ein Modell, das sich selbst widerspricht,
    // hat die Aufgabe nicht verstanden — das ist ein Eskalationsgrund, keine
    // Kleinigkeit zum Glattbügeln.
    if (roh.relevanz !== 'keine' && roh.bereiche.length === 0) {
      throw new SchemaFehler('bereiche', 'leer, obwohl relevanz != "keine"', roh.relevanz);
    }
    if (roh.relevanz === 'keine' && roh.bereiche.length > 0) {
      throw new SchemaFehler('bereiche', 'befüllt, obwohl relevanz = "keine"', roh.bereiche);
    }

    if (typeof roh.was_aendert_sich !== 'string' || !roh.was_aendert_sich.trim()) {
      throw new SchemaFehler('was_aendert_sich', 'leer oder kein String', roh.was_aendert_sich);
    }

    // Leerstring als "unbekannt" behandeln: Die Grammatik kennt keinen
    // Nulltyp, also weicht ein eingeschränktes Modell darauf aus.
    let wirksamAb = roh.wirksam_ab === '' ? null : roh.wirksam_ab;

    if (wirksamAb !== null && wirksamAb !== undefined) {
      if (typeof wirksamAb !== 'string') {
        throw new SchemaFehler('wirksam_ab', 'kein String', roh.wirksam_ab);
      }
      // Ein vollständiger Zeitstempel ist eindeutig — Datumsteil übernehmen.
      // Beobachtet am 2026-08-26: "2026-09-15T11:50:00+02:00".
      // Toleranz gegenüber der FORM, nicht gegenüber dem INHALT.
      const zeitstempel = wirksamAb.match(/^(\d{4}-\d{2}-\d{2})T[\d:.]+(?:Z|[+-]\d{2}:?\d{2})$/);
      if (zeitstempel) wirksamAb = zeitstempel[1];

      if (!ISO_DATUM.test(wirksamAb)) {
        throw new SchemaFehler('wirksam_ab', 'kein ISO-Datum YYYY-MM-DD', roh.wirksam_ab);
      }
      const d = new Date(wirksamAb + 'T00:00:00Z');
      if (Number.isNaN(d.getTime())) {
        throw new SchemaFehler('wirksam_ab', 'kein gültiges Datum', roh.wirksam_ab);
      }
      // Plausibilität: Steuerrecht wirkt nicht 20 Jahre rückwirkend und nicht
      // 10 Jahre im Voraus. Wer das halluziniert, hat auch den Rest geraten.
      const jahre = (d.getTime() - heute.getTime()) / (365.25 * 864e5);
      if (jahre < -5 || jahre > 10) {
        throw new SchemaFehler('wirksam_ab', 'unplausibel weit von heute entfernt', roh.wirksam_ab);
      }
    }
    roh = { ...roh, wirksam_ab: wirksamAb ?? null };

    if (typeof roh.konfidenz !== 'number' || Number.isNaN(roh.konfidenz)
        || roh.konfidenz < 0 || roh.konfidenz > 1) {
      throw new SchemaFehler('konfidenz', 'keine Zahl in [0,1]', roh.konfidenz);
    }

    return {
      ok: true,
      wert: {
        relevanz: roh.relevanz,
        bereiche: [...new Set(roh.bereiche)],  // Duplikate sind Rauschen, kein Widerspruch
        was_aendert_sich: roh.was_aendert_sich.trim(),
        wirksam_ab: roh.wirksam_ab ?? null,
        konfidenz: roh.konfidenz,
      },
    };
  } catch (e) {
    if (e instanceof SchemaFehler) return { ok: false, fehler: e };
    throw e;
  }
}

/**
 * Dasselbe Schema in der Form, die Anbieter für eingeschränkte Generierung
 * erwarten (OpenAI `response_format: json_schema`, Ollama `format`).
 *
 * Erzeugt aus DENSELBEN Konstanten wie die Laufzeitprüfung — die Enums haben
 * genau eine Heimat. Die Einschränkung ERSETZT die Prüfung nicht: Ein Anbieter
 * darf den Hinweis ignorieren, ein Proxy ihn verschlucken, und formgültig ist
 * nicht sachlich plausibel (ein Datum im Jahr 2099 passt in jedes Schema).
 */
export function jsonSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    // `wirksam_ab` NICHT verpflichtend: sonst zwingt die Grammatik das Modell,
    // ein Datum zu erfinden, wo keines im Text steht.
    required: ['relevanz', 'bereiche', 'was_aendert_sich', 'konfidenz'],
    properties: {
      relevanz: { type: 'string', enum: RELEVANZ },
      bereiche: { type: 'array', items: { type: 'string', enum: BEREICHE } },
      was_aendert_sich: { type: 'string' },
      // BEWUSST ohne `pattern` und ohne Uniontyp ['string','null'].
      // Belegt am 2026-08-26: Ollama kann beides nicht in seine Grammatik
      // übersetzen und fällt dann STILL auf freie Generierung zurück —
      // HTTP 200, finish_reason "stop", und Prosa statt JSON. Kein Fehler,
      // keine Warnung. Deshalb hier nur, was jede Grammatik ausdrücken kann;
      // Format und Plausibilität prüft klassifikationPruefen().
      wirksam_ab: { type: 'string' },
      konfidenz: { type: 'number', minimum: 0, maximum: 1 },
    },
  };
}
