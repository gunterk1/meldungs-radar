/**
 * Profil: BMF-Steuermeldungen.
 *
 * Das ursprüngliche Thema dieses Repos, unverändert im Inhalt — nur nicht mehr
 * im Code verteilt. Es bleibt als zweites Profil erhalten, weil zwei Profile
 * belegen, was eines nur behauptet.
 */

export default {
  id: 'steuern',
  name: 'BMF-Steuermeldungen',
  feed: 'https://www.bundesfinanzministerium.de/SiteGlobals/Functions/RSSFeed/DE/Steuern/RSSSteuern.xml',

  frage: 'Zwingt die Meldung das Steuer-SaaS zu einer Änderung?',

  bereiche: [
    'Einkommensteuer', 'Umsatzsteuer', 'Gewerbesteuer',
    'EÜR', 'ELSTER-Schnittstelle', 'Formulare',
  ],

  wirksamAb: {
    bedeutung: 'Datum, ab dem die Regelung gilt',
    // Steuerrecht wirkt nicht 20 Jahre rückwirkend und nicht 10 Jahre im
    // Voraus. Wer das halluziniert, hat auch den Rest geraten.
    minJahre: -5,
    maxJahre: 10,
  },

  auftrag: `Du klassifizierst Meldungen des Bundesfinanzministeriums für ein Steuer-SaaS.

Das Produkt erstellt Online-Steuererklärungen für Privatpersonen und Kleinunternehmen:
Einkommensteuer, Umsatzsteuer, Gewerbesteuer, EÜR, Abgabe über die ELSTER-Schnittstelle.

Beurteile ausschliesslich, ob die Meldung eine ÄNDERUNG auslöst, die dieses Produkt
umsetzen muss. Reine Statistik, Personalien, Ressortnachrichten und Themen ausserhalb
dieser Steuerarten sind "keine".`,
};
