/**
 * Profil: BSI-Cyber-Sicherheitswarnungen.
 *
 * Warum dieses Thema die Bauform besser begründet als jedes andere:
 * Ob eine Warnung einen betrifft, STEHT NICHT IM TEXT. Sie nennt ein Produkt,
 * nicht den eigenen Bestand. Die Relevanzfrage ist erst beantwortbar, wenn man
 * beides nebeneinanderlegt — und genau das kann ein Stichwortfilter nicht.
 *
 * Der Bestand unten ist nicht erfunden. Er ist der Stack von
 * github.com/gunterk1/php-ai-bridge, öffentlich nachlesbar samt deploy/.
 * Wer die Urteile dieses Radars anzweifelt, kann sie an einer echten
 * Inventarliste nachprüfen.
 */

export default {
  id: 'bsi',
  name: 'BSI-Cyber-Sicherheitswarnungen',
  feed: 'https://www.bsi.bund.de/SiteGlobals/Functions/RSSFeed/RSSNewsfeed/RSSNewsfeed_CSW.xml',

  frage: 'Betrifft diese Warnung unseren Bestand?',

  bereiche: [
    'PHP/Symfony', 'Node/TypeScript', 'Python/FastAPI',
    'Datenbank', 'Container/Kubernetes', 'Web-/Reverse-Proxy', 'Lieferkette/CI',
  ],

  wirksamAb: {
    bedeutung: 'Datum, ab dem ein Update oder ein Workaround verfügbar ist — NICHT das Datum der Warnung',
    // Rückwärts großzügig: eine alte Schwachstelle kann heute erst gemeldet
    // werden. Vorwärts eng: einen Fix für übernächstes Jahr kündigt niemand an.
    minJahre: -5,
    maxJahre: 2,
  },

  auftrag: `Du beurteilst Cyber-Sicherheitswarnungen des BSI für ein konkretes Systeminventar.

DER BESTAND — nur was hier steht, ist im Einsatz:
- PHP 8.3, Symfony 8, Doctrine ORM, Composer
- Python 3, FastAPI, LangChain
- Node 22, TypeScript, React
- SQLite und MySQL
- Docker, Kubernetes (inkl. Ingress-NGINX), Terraform
- WordPress und WooCommerce
- selbst gehostete Modelle über Ollama und LocalAI
- Linux-Server, Git, GitHub Actions

NICHT IM BESTAND — Warnungen dazu sind "keine", auch wenn sie kritisch sind:
Windows-Server, Microsoft SharePoint, Exchange, WSUS, Active Directory;
Netzwerk- und VPN-Appliances jeder Art (Fortinet, SonicWall, Citrix NetScaler,
Ivanti, Palo Alto, Check Point, WatchGuard, Zyxel, Cisco); cPanel/WHM;
MongoDB, Redis, BIND; Zimbra; F5 BIG-IP; Photovoltaik- und Gebäudetechnik.

Beurteile ausschliesslich, ob die Warnung eine Handlung an DIESEM Bestand
auslöst. Eine Warnung über ein Produkt, das nicht im Bestand steht, ist "keine"
— unabhängig von ihrer Schwere. Umgekehrt gilt: Trifft sie eine Komponente des
Bestands, ist sie relevant, auch wenn der Produktname im Titel ungewohnt klingt.

Organisatorische Hinweise ohne Produktbezug (Phishing-Kampagnen,
Brute-Force-Wellen, Lagebilder) sind "mittel", wenn sie eine Massnahme nahelegen,
sonst "keine".`,
};
