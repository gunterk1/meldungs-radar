#!/usr/bin/env node
/**
 * Ein Durchlauf des Radars — dieselbe Logik, die der n8n-Workflow orchestriert.
 *
 *   node bin/radar.mjs            einmal laufen
 *   node bin/radar.mjs --trocken  ohne Modellaufruf, nur Feed und Dedup
 */
import { readFile, writeFile, appendFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { feedHolen, nurNeue, BMF_STEUERN_FEED } from '../lib/feed.mjs';
import { klassifizieren, konfigAusUmgebung } from '../lib/klassifikator.mjs';
import { eskalieren, protokollZeile, VORLAGE } from '../lib/regeln.mjs';

const WURZEL = join(dirname(fileURLToPath(import.meta.url)), '..');
const GESEHEN = join(WURZEL, 'data', 'gesehen.json');
const PROTOKOLL = join(WURZEL, 'data', 'protokoll.jsonl');
const trocken = process.argv.includes('--trocken');

async function gesehenLaden() {
  try { return new Set(JSON.parse(await readFile(GESEHEN, 'utf8'))); }
  catch { return new Set(); }
}

const eintraege = await feedHolen(BMF_STEUERN_FEED);
const gesehen = await gesehenLaden();
const neu = nurNeue(eintraege, gesehen);

console.log(`Feed: ${eintraege.length} Einträge, davon ${neu.length} neu.`);
if (!neu.length) process.exit(0);

if (trocken) {
  for (const e of neu) console.log(`  · ${e.titel}`);
  console.log('\n--trocken: kein Modellaufruf, nichts protokolliert, nichts als gesehen markiert.');
  process.exit(0);
}

const konfig = konfigAusUmgebung();
await mkdir(dirname(PROTOKOLL), { recursive: true });
const zaehler = { [VORLAGE.PRUEFEN]: 0, [VORLAGE.UNKLAR]: 0, [VORLAGE.ARCHIV]: 0 };

for (const eintrag of neu) {
  let pruefung;
  try {
    pruefung = await klassifizieren(eintrag, konfig);
  } catch (e) {
    // Anbieter nicht erreichbar: Eintrag NICHT als gesehen markieren, damit der
    // nächste Lauf ihn erneut aufgreift. Ein Ausfall darf nichts verschlucken.
    console.error(`  ! ${eintrag.titel}\n    ${e.message} — bleibt für den nächsten Lauf offen.`);
    continue;
  }
  const entscheidung = eskalieren(pruefung);
  zaehler[entscheidung.vorlage]++;
  await appendFile(PROTOKOLL, protokollZeile({
    eintrag, pruefung, entscheidung,
    modell: konfig.modell, zeitpunkt: new Date().toISOString(),
  }) + '\n');
  gesehen.add(eintrag.link);

  const zeichen = { [VORLAGE.PRUEFEN]: '→ VORLEGEN', [VORLAGE.UNKLAR]: '? UNKLAR  ', [VORLAGE.ARCHIV]: '  archiv  ' };
  console.log(`  ${zeichen[entscheidung.vorlage]} ${eintrag.titel.slice(0, 80)}`);
  if (entscheidung.vorlage !== VORLAGE.ARCHIV) console.log(`               ${entscheidung.grund}`);
}

await writeFile(GESEHEN, JSON.stringify([...gesehen], null, 0));
console.log(`\nVorzulegen: ${zaehler[VORLAGE.PRUEFEN]} · unklar: ${zaehler[VORLAGE.UNKLAR]} · archiviert: ${zaehler[VORLAGE.ARCHIV]}`);
console.log(`Protokoll: ${PROTOKOLL}`);
