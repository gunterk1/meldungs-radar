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
    // Ein relevanter Eintrag ohne benannten Bereich ist in sich widersprüchlich.
    if (roh.relevanz !== 'keine' && roh.bereiche.length === 0) {
      throw new SchemaFehler('bereiche', 'leer, obwohl relevanz != "keine"', roh.relevanz);
    }

    if (typeof roh.was_aendert_sich !== 'string' || !roh.was_aendert_sich.trim()) {
      throw new SchemaFehler('was_aendert_sich', 'leer oder kein String', roh.was_aendert_sich);
    }

    if (roh.wirksam_ab !== null && roh.wirksam_ab !== undefined) {
      if (typeof roh.wirksam_ab !== 'string' || !ISO_DATUM.test(roh.wirksam_ab)) {
        throw new SchemaFehler('wirksam_ab', 'kein ISO-Datum YYYY-MM-DD', roh.wirksam_ab);
      }
      const d = new Date(roh.wirksam_ab + 'T00:00:00Z');
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

    if (typeof roh.konfidenz !== 'number' || Number.isNaN(roh.konfidenz)
        || roh.konfidenz < 0 || roh.konfidenz > 1) {
      throw new SchemaFehler('konfidenz', 'keine Zahl in [0,1]', roh.konfidenz);
    }

    return {
      ok: true,
      wert: {
        relevanz: roh.relevanz,
        bereiche: [...roh.bereiche],
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
