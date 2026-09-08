/**
 * Das Domänenprofil — die einzige Stelle, an der dieses Werkzeug etwas über
 * sein Thema weiß.
 *
 * Vorher steckte die Domäne an vier Stellen im Code: die Feed-URL in feed.mjs,
 * das Bereichs-Enum in schema.mjs, der Prompt im klassifikator.mjs und die
 * Namen überall. Das war kein Fehler, solange es ein Thema gab — aber es machte
 * die zentrale Behauptung dieses Repos unprüfbar: dass die Bauform trägt und
 * nur das Thema wechselt.
 *
 * Jetzt ist die Behauptung vorführbar. `profile/` enthält zwei Profile, der
 * restliche Code kennt keines von beiden.
 *
 * WAS DAS PROFIL NICHT DARF: die Form der Modellausgabe ändern. Die vier Felder
 * (relevanz, bereiche, was_aendert_sich, konfidenz) und ihre Prüfung sind fest.
 * Ein Profil liefert Vokabular und Auftrag, nicht den Vertrag — sonst gäbe es
 * keine gemeinsame Prüfung mehr, und die ist der Kern des Werkzeugs.
 */

/** Domänenfrei: gilt für jedes Profil. */
export const RELEVANZ = ['hoch', 'mittel', 'keine'];

export class ProfilFehler extends Error {
  constructor(feld, grund) {
    super(`Profil ungültig — ${feld}: ${grund}`);
    this.name = 'ProfilFehler';
    this.feld = feld;
  }
}

/**
 * Prüft ein Profil beim Laden, nicht beim ersten Modellaufruf.
 *
 * Ein halb ausgefülltes Profil würde sonst erst auffallen, wenn die
 * Schemaprüfung reihenweise Ausgaben zurückweist — und dann sähe es aus wie
 * ein Modellproblem. Fehlerursachen gehören dorthin, wo sie entstehen.
 */
export function profilPruefen(p) {
  if (p === null || typeof p !== 'object') throw new ProfilFehler('(wurzel)', 'kein Objekt');

  for (const feld of ['id', 'name', 'feed', 'auftrag']) {
    if (typeof p[feld] !== 'string' || !p[feld].trim()) {
      throw new ProfilFehler(feld, 'fehlt oder ist leer');
    }
  }
  if (!/^https:\/\//.test(p.feed)) {
    throw new ProfilFehler('feed', 'keine https-URL');
  }
  if (!Array.isArray(p.bereiche) || p.bereiche.length === 0) {
    throw new ProfilFehler('bereiche', 'leeres oder fehlendes Array');
  }
  for (const b of p.bereiche) {
    if (typeof b !== 'string' || !b.trim()) throw new ProfilFehler('bereiche', 'Eintrag ist kein nicht-leerer String');
  }
  if (new Set(p.bereiche).size !== p.bereiche.length) {
    // Ein doppelter Bereich macht die Ausgabe nicht falsch, aber das Enum
    // unehrlich: Das Modell bekäme eine Auswahl, die es so nicht gibt.
    throw new ProfilFehler('bereiche', 'enthält Duplikate');
  }

  const f = p.wirksamAb;
  if (f === null || typeof f !== 'object') throw new ProfilFehler('wirksamAb', 'fehlt');
  if (typeof f.bedeutung !== 'string' || !f.bedeutung.trim()) {
    throw new ProfilFehler('wirksamAb.bedeutung', 'fehlt — das Feld heißt in jeder Domäne gleich und meint überall etwas anderes');
  }
  if (typeof f.minJahre !== 'number' || typeof f.maxJahre !== 'number') {
    throw new ProfilFehler('wirksamAb', 'minJahre/maxJahre sind keine Zahlen');
  }
  if (f.minJahre > f.maxJahre) {
    throw new ProfilFehler('wirksamAb', `leeres Fenster: minJahre ${f.minJahre} > maxJahre ${f.maxJahre}`);
  }
  return p;
}

export const PROFILE = ['bsi', 'steuern'];

/** Lädt ein Profil nach Kennung. Wirft mit der Liste der gültigen Kennungen. */
export async function profilLaden(id) {
  if (!PROFILE.includes(id)) {
    throw new ProfilFehler('id', `"${id}" unbekannt — verfügbar: ${PROFILE.join(', ')}`);
  }
  const modul = await import(`../profile/${id}.mjs`);
  return profilPruefen(modul.default);
}
