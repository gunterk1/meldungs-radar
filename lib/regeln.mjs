/**
 * Die Eskalationsregel — der Kern dieses Werkzeugs.
 *
 * Ein Eintrag wird einem Menschen vorgelegt, wenn er relevant sein KÖNNTE.
 * Unsicherheit landet bei der Prüfinstanz, nicht im Papierkorb. Das ist der
 * Unterschied zwischen einem Werkzeug, das Arbeit abnimmt, und einem, das
 * Entscheidungen an sich zieht.
 */

/** Unterhalb dieser Konfidenz wird auch ein "keine"-Urteil noch vorgelegt. */
export const KONFIDENZ_SCHWELLE = 0.7;

export const VORLAGE = {
  PRUEFEN: 'pruefen',       // relevant — Mensch entscheidet über Handlungsbedarf
  UNKLAR: 'unklar',         // Modell unsicher oder Ausgabe ungültig
  ARCHIV: 'archiv',         // sicher nicht relevant — protokolliert, nicht vorgelegt
};

/**
 * @param {{ok:boolean, wert?:object, fehler?:Error}} pruefung Ergebnis aus klassifikationPruefen()
 * @param {number} schwelle
 * @returns {{vorlage:string, grund:string}}
 */
export function eskalieren(pruefung, schwelle = KONFIDENZ_SCHWELLE) {
  // Ungültige Ausgabe ist KEIN Grund zum Verwerfen. Wer die Schemaprüfung
  // reißt, hat vielleicht trotzdem etwas Wichtiges gesehen.
  if (!pruefung.ok) {
    return { vorlage: VORLAGE.UNKLAR, grund: `Schemaprüfung fehlgeschlagen — ${pruefung.fehler.message}` };
  }
  const { relevanz, konfidenz } = pruefung.wert;

  if (relevanz !== 'keine') {
    return { vorlage: VORLAGE.PRUEFEN, grund: `relevanz=${relevanz}` };
  }
  if (konfidenz < schwelle) {
    return {
      vorlage: VORLAGE.UNKLAR,
      grund: `als irrelevant eingestuft, aber Konfidenz ${konfidenz} < ${schwelle}`,
    };
  }
  return { vorlage: VORLAGE.ARCHIV, grund: `relevanz=keine bei Konfidenz ${konfidenz}` };
}

/** Ein Protokolleintrag pro Vorgang — nachvollziehbar, wer wann was entschieden hat. */
export function protokollZeile({ eintrag, pruefung, entscheidung, modell, zeitpunkt }) {
  return JSON.stringify({
    zeitpunkt,
    link: eintrag.link,
    titel: eintrag.titel,
    veroeffentlicht: eintrag.veroeffentlicht,
    modell,
    modellausgabe: pruefung.ok ? pruefung.wert : null,
    schemafehler: pruefung.ok ? null : pruefung.fehler.message,
    vorlage: entscheidung.vorlage,
    grund: entscheidung.grund,
    freigabe: null,        // wird beim menschlichen Votum nachgetragen
    freigegeben_von: null,
    freigegeben_am: null,
  });
}
