'use strict';

// Die Seite kommt ohne fremde Bibliotheken aus. Das ist Absicht: Das Werkzeug
// soll in zehn Jahren noch laufen, und jede eingebundene Fremdquelle ist eine
// Stelle, die bis dahin verschwinden, sich aendern oder Besucherdaten
// mitschneiden kann.

const DATEI = 'daten/massnahmen.csv';
// Liste der hochgeladenen Steckbriefe, beim Veroeffentlichen geschrieben
// (werkzeuge/vorab.py). Fehlt sie -- etwa in der oertlichen Vorschau --,
// gilt jeder eingetragene Steckbrief als vorhanden.
const STECKBRIEF_LISTE = 'daten/steckbriefe.json';

// Die Spalten der CSV in der Reihenfolge, in der sie dort stehen, und ihre
// Ueberschriften (fuer den CSV-Export).
const SPALTEN = ['name', 'ereignis', 'art', 'akteur', 'planung', 'zielgruppe', 'kosten', 'dauer',
                 'rueckhalt', 'ableitung', 'versickerung', 'kuehlung', 'synergien', 'steckbrief'];
const CSV_KOPF = ['Maßnahme', 'Extremwetterereignis', 'Art', 'Umsetzender Akteur', 'Planung',
                  'Zu erreichende Zielgruppe', 'Kosten', 'Umsetzungsdauer',
                  'Wirksamkeit - Rückhalt', 'Wirksamkeit - Ableitung', 'Wirksamkeit - Versickerung',
                  'Wirksamkeit - Kühlung', 'Synergien', 'Steckbrief'];

const STUFE = { '0': 'keine', '1': 'gering', '2': 'mittel', '3': 'hoch' };
const DAUER = { '1': 'kurz', '2': 'mittel', '3': 'lang' };
const KOSTEN = { '1': 'bis 20.000 €', '2': '20.000 bis 100.000 €', '3': 'über 100.000 €' };
const AKTEUR = { K: 'Kommunen', U: 'Unternehmen', P: 'Privathaushalte' };
const WIRKUNGEN = [
  { key: 'rueckhalt', name: 'Rückhalt', kurz: 'Rück&shy;halt', erklaerung: 'hält Regenwasser zurück' },
  { key: 'ableitung', name: 'Ableitung', kurz: 'Ab&shy;leitung', erklaerung: 'leitet Wasser schadlos ab' },
  { key: 'versickerung', name: 'Versickerung', kurz: 'Versicke&shy;rung', erklaerung: 'lässt Wasser im Boden versickern' },
  { key: 'kuehlung', name: 'Kühlung', kurz: 'Küh&shy;lung', erklaerung: 'senkt die Temperatur' },
];

// Extremwetterereignisse und Arten in der Reihenfolge der Filter. Neue Werte
// aus der Tabelle kommen ans Ende -- die Filter wachsen mit den Daten.
const EREIGNISSE = ['Hitze', 'Starkregen', 'Dürre', 'Hochwasser', 'Klimaanpassung allgemein'];
// Massnahmen fuer „Klimaanpassung allgemein“ gelten fuer jedes Ereignis und
// erscheinen bei jedem Ereignisfilter mit.
const ALLGEMEIN = 'Klimaanpassung allgemein';
const ARTEN = ['baulich - grau', 'baulich - blau-grün', 'planerisch', 'administrativ',
               'Information', 'Anreizsystem', 'Risikotransfer'];
const EREIGNIS_KLASSE = { Hitze: 'hitze', Starkregen: 'regen', Dürre: 'duerre', Hochwasser: 'hochwasser', [ALLGEMEIN]: 'allgemein' };

// Am Desktop startet die Seite immer mit der Tabelle (auf dem Handy immer
// Kacheln). Umschalten gilt fuer den Besuch, nicht dauerhaft -- sonst
// hebelte ein einmaliger Klick die Startansicht fuer immer aus. Nur eine
// Ansicht in der Adresse (?ansicht=kacheln) geht vor.
const STANDARD_ANSICHT = 'tabelle';

// Wie die Auswahl „Sortieren“ ordnet: Kosten und Dauer niedrig zuerst,
// Wirkungen und Synergien hoch zuerst.
const SORTIER_RICHTUNG = { name: true, kosten: true, dauer: true, ereignis: true, art: true, akteur: true, zielgruppe: true };
const TEXTFELDER = ['name', 'ereignis', 'art', 'akteur', 'zielgruppe'];

// Schmal = Handy. Gleiche Grenze wie in stil.css. Nur auf dem Bildschirm:
// Beim Drucken ist ein A4-Blatt ebenfalls schmaler als 860 px, und ohne
// „screen“ schaltete die Seite mitten im Druck auf Kacheln um.
const SCHMAL = window.matchMedia('screen and (max-width: 860px)');
// Ab dieser Breite passt die Tabelle neben die Filterleiste.
const BREIT = window.matchMedia('screen and (min-width: 1440px)');

const zustand = {
  sortierung: { feld: null, auf: true },
  ansicht: 'tabelle',
  merkliste: new Set(),
  nurMerkliste: false,
  // Kam die Merkliste aus einem geteilten Link, wird sie erst gespeichert,
  // wenn man selbst etwas aendert -- sonst ueberschriebe ein fremder Link
  // still die eigene Liste.
  merklisteAusLink: false,
  vergleich: false,
};
// Mehr Spalten werden auch am Desktop unuebersichtlich.
const MAX_VERGLEICH = 6;
let alle = [];
// Wirksamkeits-Spalten mit mindestens einem Wert; ganz leere werden nicht
// gezeigt (derzeit die Kuehlung) und erscheinen, sobald ein Wert dazukommt.
let wirkungenMitWert = WIRKUNGEN;
let vorhandeneSteckbriefe = null;   // Set der Dateinamen, null = unbekannt

// ---------------------------------------------------------------- CSV lesen

/** Kurzer, lesbarer Schluessel fuer Links und Merkliste. */
function kennung(name) {
  return name.toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function einlesen(text) {
  const zeilen = csvZerlegen(text);
  return zeilen.slice(1)
    .filter(z => z.some(w => w && w.trim()))
    .map(z => {
      const eintrag = {};
      SPALTEN.forEach((s, i) => { eintrag[s] = (z[i] || '').trim(); });
      eintrag.id = kennung(eintrag.name);
      eintrag.ereignisse = eintrag.ereignis ? eintrag.ereignis.split(/\s*&\s*/).filter(Boolean) : [];
      return eintrag;
    });
}

// ----------------------------------------------------------------- Anzeigen

/** Inhalte kommen aus einer hochgeladenen Tabelle und landen per innerHTML
 *  in der Seite -- deshalb jedes Feld maskieren. */
function esc(wert) {
  return String(wert).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Der Strich allein waere fuer Screenreader stumm oder hiesse „Gedankenstrich“.
const STRICH = '<span class="fehlt"><span aria-hidden="true">–</span>' +
               '<span class="unsichtbar">keine Angabe</span></span>';

// Fuer Screenreader: Hinweis an Links, die in einem neuen Fenster aufgehen.
const NEUES_FENSTER = '<span class="unsichtbar"> (öffnet in neuem Fenster)</span>';

/** Name zum Anzeigen: nach einem Schraegstrich darf umbrochen werden, sonst
 *  sprengt etwa „Kaltluftentstehungsgebieten/Frischluftschneisen“ die Spalte. */
// Wortteile, vor denen lange Woerter getrennt werden duerfen. Nicht jeder
// Browser bringt eine deutsche Silbentrennung mit; ohne sie hielte
// „Elementarschadenversicherung“ die schmale Namensspalte breit.
const WORTFUGEN = ['versicherung', 'veranstaltung', 'angebot', 'schaden', 'anpassung',
  'rückhalte', 'becken', 'nutzung', 'bewirtschaftung', 'begrünung', 'verschattung',
  'beschattung', 'oberflächen', 'wasser', 'mulden', 'rigolen', 'systeme', 'gebäude',
  'pflicht', 'versickerung', 'entsiegelung', 'schutz', 'konzept', 'planung', 'flächen'];
const FUGE = new RegExp(String.raw`(?<=\p{L}{3})(?=(${WORTFUGEN.join('|')}))`, 'giu');

function nameHtml(name) {
  return esc(name).replace(/\//g, '/<wbr>')
    .replace(/\p{L}{14,}/gu, wort => wort.replace(FUGE, '&shy;'));
}

/** „baulich - grau“ wird als „baulich – grau“ gezeigt; gefiltert wird mit
 *  dem Wert aus der Tabelle. */
function artText(art) {
  return art.replace(/ - /g, ' – ');
}

/** Bewertung als drei Punkte. Fuer Screenreader ist das ein Bild mit dem
 *  Wort als Namen („mittel“) -- ein aria-label an einem blossen span lesen
 *  sie nicht zuverlaessig vor. Steht das Wort ohnehin daneben, bleiben die
 *  Punkte stumm (stumm = true), sonst hiesse es „mittel mittel“. */
function punkte(wert, beschriftung, stumm = false) {
  const n = parseInt(wert, 10);
  if (!wert || isNaN(n)) return STRICH;
  if (n === 0) {
    return stumm ? '<span class="fehlt" aria-hidden="true">0</span>'
      : '<span class="fehlt"><span aria-hidden="true">0</span><span class="unsichtbar">keine</span></span>';
  }
  const text = (beschriftung && beschriftung[wert]) || wert;
  const name = stumm ? 'aria-hidden="true"' : `role="img" aria-label="${text}"`;
  return `<span class="punkte" title="${text}" ${name}>` +
         '<span class="punkt punkt-voll" aria-hidden="true"></span>'.repeat(n) +
         '<span class="punkt punkt-leer" aria-hidden="true"></span>'.repeat(3 - n) + '</span>';
}

function geld(wert, stumm = false) {
  const n = parseInt(wert, 10);
  if (!wert || isNaN(n) || n < 1) return STRICH;
  const name = stumm ? 'aria-hidden="true"' : `role="img" aria-label="${KOSTEN[n]}"`;
  return `<span class="geld" title="${KOSTEN[n]}" ${name}>${'€'.repeat(n)}</span>`;
}

function akteure(wert) {
  return wert.split('').map(b => AKTEUR[b] || b);
}

function akteurMarken(wert) {
  return wert
    ? `<div class="zellmarken">${akteure(wert).map(z => `<span class="marke">${esc(z)}</span>`).join('')}</div>`
    : STRICH;
}

/** Planung: Haken bei 1, sonst nichts. */
function planungHaken(wert) {
  return wert === '1'
    ? '<span class="haken-planung" role="img" aria-label="ja" title="ja">✓</span>'
    : '<span class="unsichtbar">nein</span>';
}

function textOderStrich(wert) {
  return wert ? esc(wert) : STRICH;
}

/** Ein Steckbrief ist entweder ein Dateiname im Ordner steckbriefe/ oder ein
 *  vollstaendiger Link auf eine Datei anderswo. Andere Adressarten (etwa
 *  javascript:) werden nicht verlinkt, ebenso wenig Dateien, die noch nicht
 *  hochgeladen sind -- der Link fuehrte sonst ins Leere. */
function steckbriefAdresse(wert) {
  if (!wert) return null;
  if (/^https?:\/\//i.test(wert)) return wert;
  if (!/^[^/\\:]+$/.test(wert)) return null;
  if (vorhandeneSteckbriefe && !vorhandeneSteckbriefe.has(wert)) return null;
  return 'steckbriefe/' + encodeURIComponent(wert);
}

function ereignisMarken(e) {
  if (!e.ereignisse.length) return '<span class="marke marke-leer">nicht angegeben</span>';
  return e.ereignisse.map(r =>
    `<span class="marke marke-${EREIGNIS_KLASSE[r] || 'sonst'}">${esc(r)}</span>`).join(' ');
}

function merkKnopf(e) {
  const an = zustand.merkliste.has(e.id);
  return `<button type="button" class="merken" data-merken="${esc(e.id)}" aria-pressed="${an}"` +
         ` title="${an ? 'Von der Merkliste nehmen' : 'Auf die Merkliste'}"` +
         ` aria-label="${esc(e.name)} ${an ? 'von der Merkliste nehmen' : 'merken'}">${an ? '★' : '☆'}</button>`;
}

/** Die Wirkungen, die tatsaechlich bewertet sind, staerkste zuerst. */
function staerken(e) {
  return WIRKUNGEN.filter(w => parseInt(e[w.key], 10) > 0)
    .sort((a, b) => e[b.key] - e[a.key]);
}

function karteBauen(e) {
  const li = document.createElement('li');
  li.className = 'karte';
  const st = staerken(e);
  const bewertet = WIRKUNGEN.some(w => e[w.key] !== '') || e.synergien !== '';
  const wirkung = st.length
    ? st.map(w => `<span class="wirkung"><span class="wirkung-name">${w.name}</span> ${STUFE[e[w.key]]}</span>`).join('')
    : `<span class="leise">${WIRKUNGEN.some(w => e[w.key] !== '') ? 'laut Bewertung keine' : 'nicht bewertet'}</span>`;
  const steckbrief = steckbriefAdresse(e.steckbrief);
  const nichtAngegeben = '<span class="leise">nicht angegeben</span>';
  const kosten = e.kosten && KOSTEN[e.kosten]
    ? `${geld(e.kosten, true)} <span class="leise">${KOSTEN[e.kosten]}</span>` : nichtAngegeben;
  const dauer = e.dauer && DAUER[e.dauer]
    ? `${punkte(e.dauer, DAUER, true)} ${DAUER[e.dauer]}` : nichtAngegeben;
  const fakt = (titel, inhalt) => `<div><dt>${titel}</dt><dd>${inhalt}</dd></div>`;

  li.innerHTML =
    `<article aria-labelledby="k-${esc(e.id)}">` +
      `<div class="karte-kopf">` +
        `<h3 id="k-${esc(e.id)}">${nameHtml(e.name)}</h3>${merkKnopf(e)}` +
      `</div>` +
      `<p class="karte-marken">${ereignisMarken(e)}` +
        (e.art ? ` <span class="karte-art">${esc(artText(e.art))}</span>` : '') +
        (e.planung === '1' ? ' <span class="marke marke-planung">✓ Planung</span>' : '') + `</p>` +
      `<dl class="fakten">` +
        fakt('Kosten', kosten) +
        fakt('Dauer', dauer) +
        fakt('Wirk&shy;samkeit', `<span class="wirkungen">${wirkung}</span>`) +
        (e.synergien !== '' && e.synergien !== '0' ? fakt('Synergien', `${punkte(e.synergien, STUFE, true)} ${STUFE[e.synergien] || esc(e.synergien)}`) : '') +
        fakt('Umsetzung', e.akteur ? esc(akteure(e.akteur).join(' · ')) : nichtAngegeben) +
        (e.zielgruppe ? fakt('Zielgruppe', esc(akteure(e.zielgruppe).join(' · '))) : '') +
      `</dl>` +
      // Ist gar nichts bewertet, gibt es auch nichts aufzuklappen.
      (bewertet
        ? `<details class="alle-wirkungen"><summary>Alle Bewertungen</summary><dl>` +
          [...WIRKUNGEN, { key: 'synergien', name: 'Synergien', erklaerung: 'zusätzlicher Nutzen' }]
            .map(w => `<div><dt>${w.name} <span class="leise">– ${w.erklaerung}</span></dt>` +
            `<dd>${e[w.key] !== '' ? `${punkte(e[w.key], STUFE, true)} ${STUFE[e[w.key]] || esc(e[w.key])}` : '<span class="leise">nicht bewertet</span>'}</dd></div>`).join('') +
          `</dl></details>`
        : '') +
      (steckbrief
        ? `<a class="steckbrief-knopf" href="${esc(steckbrief)}" target="_blank" rel="noopener">Steckbrief öffnen (PDF)` +
          `<span class="unsichtbar">: ${esc(e.name)}</span>${NEUES_FENSTER}</a>` +
          // Auf Papier die volle Adresse statt eines nicht anklickbaren Links.
          `<span class="nur-druck druck-adresse" aria-hidden="true">Steckbrief: ${esc(new URL(steckbrief, location.href).href)}</span>`
        : '') +
    `</article>`;
  return li;
}

// ---------------------------------------------------------------- Tabelle

/** Spalten der Tabelle, wie in der Excel des Projekts angeordnet. Kopf und
 *  Spaltenbreiten (colgroup, fuer den Druck) entstehen daraus; ganz leere
 *  Wirksamkeits-Spalten fallen weg. */
function tabellenSpalten() {
  return [
    { klasse: 'merken', kopf: '<span class="unsichtbar">Merken</span>', zelle: e => merkKnopf(e), td: 'spalte-merken' },
    { klasse: 'name', kopf: 'Maßnahme', sort: 'name', zelle: e => `<span class="name-text">${nameHtml(e.name)}</span>`, td: 'spalte-name' },
    { klasse: 'ereignis', kopf: 'Extrem&shy;wetter&shy;ereignis', sort: 'ereignis', td: 'spalte-ereignis',
      zelle: e => e.ereignisse.length ? `<div class="zellmarken">${ereignisMarken(e)}</div>` : STRICH },
    { klasse: 'art', kopf: 'Art', sort: 'art', zelle: e => e.art ? esc(artText(e.art)) : STRICH },
    { klasse: 'akteur', kopf: 'Umsetzender Akteur', sort: 'akteur', zelle: e => akteurMarken(e.akteur) },
    { klasse: 'planung', kopf: 'Pla&shy;nung', sort: 'planung', mitte: true, zelle: e => planungHaken(e.planung) },
    { klasse: 'zielgruppe', kopf: 'Zu erreichende Ziel&shy;gruppe', sort: 'zielgruppe', zelle: e => akteurMarken(e.zielgruppe) },
    { klasse: 'kosten', kopf: 'Kosten', sort: 'kosten', mitte: true, zelle: e => geld(e.kosten) },
    { klasse: 'dauer', kopf: 'Dauer', sort: 'dauer', mitte: true, zelle: e => punkte(e.dauer, DAUER) },
    ...wirkungenMitWert.map(w => ({ klasse: 'wirkung', gruppe: true, kopf: w.kurz, sort: w.key, mitte: true,
      zelle: e => punkte(e[w.key], STUFE) })),
    { klasse: 'synergien', kopf: 'Syner&shy;gien', sort: 'synergien', mitte: true, zelle: e => punkte(e.synergien, STUFE) },
    { klasse: 'steckbrief', kopf: 'Steck&shy;brief', mitte: true, zelle: e => {
      const a = steckbriefAdresse(e.steckbrief);
      return a
        ? `<a class="steckbrief nur-bildschirm" href="${esc(a)}" target="_blank" rel="noopener" aria-label="Steckbrief ${esc(e.name)} (PDF, öffnet in neuem Fenster)">PDF</a>` +
          '<span class="nur-druck" aria-hidden="true">ja</span>'
        : STRICH;
    } },
  ];
}

/** Baut Spaltenbreiten und Kopf der Tabelle; die Gruppe „Wirksamkeit“
 *  ueberspannt so viele Spalten, wie es Wirksamkeits-Spalten gibt. */
function tabellenkopfBauen() {
  const spalten = tabellenSpalten();
  const tabelle = document.getElementById('tabelle');
  tabelle.querySelectorAll('colgroup, thead').forEach(t => t.remove());
  const gruppe = spalten.filter(s => s.gruppe).length;

  const colgroup = document.createElement('colgroup');
  colgroup.innerHTML = spalten.map(s => `<col class="sp-${s.klasse}">`).join('');

  const kopfzelle = (s, zweizeilig) =>
    `<th scope="col"${zweizeilig ? ' rowspan="2"' : ''}${s.sort ? ` data-sort="${s.sort}"` : ''}` +
    `${s.mitte ? ' class="mitte"' : ''}${s.td === 'spalte-merken' ? ' class="spalte-merken"' : ''}>${s.kopf}</th>`;
  let erste = '', gruppeGesetzt = false;
  for (const s of spalten) {
    if (s.gruppe) {
      if (!gruppeGesetzt) erste += `<th scope="colgroup" colspan="${gruppe}" class="gruppe">Wirksamkeit</th>`;
      gruppeGesetzt = true;
    } else erste += kopfzelle(s, gruppe > 0);
  }
  const zweite = spalten.filter(s => s.gruppe).map(s => kopfzelle(s, false)).join('');
  const thead = document.createElement('thead');
  thead.innerHTML = `<tr>${erste}</tr>` + (gruppe ? `<tr>${zweite}</tr>` : '');

  tabelle.querySelector('caption').after(colgroup, thead);
  sortierknoepfeSetzen();
}

function zeileBauen(e) {
  const tr = document.createElement('tr');
  tr.innerHTML = tabellenSpalten().map(s =>
    `<td class="${[s.td, s.mitte ? 'mitte' : ''].filter(Boolean).join(' ')}">${s.zelle(e)}</td>`).join('');
  return tr;
}

// ------------------------------------------------------------------ Filtern

const FILTERFELDER = ['ereignis', 'akteur', 'zielgruppe', 'art', 'kosten'];

function kaesten(feld) {
  return [...document.querySelectorAll(`fieldset[data-feld="${feld}"] input`)];
}

function gewaehlt(feld) {
  return kaesten(feld).filter(k => k.checked).map(k => k.value);
}

/** Haken fuer Extremwetterereignisse und Arten aus den Daten: bekannte in
 *  fester Reihenfolge, neue hinten an. */
function filterAufbauen() {
  const bauen = (feld, bekannt, werteJeEintrag, text) => {
    const vorhanden = new Set(alle.flatMap(werteJeEintrag));
    const werte = [...bekannt.filter(w => vorhanden.has(w)),
                   ...[...vorhanden].filter(w => !bekannt.includes(w)).sort((a, b) => a.localeCompare(b, 'de'))];
    const feldset = document.querySelector(`fieldset[data-feld="${feld}"]`);
    feldset.querySelectorAll('label').forEach(l => l.remove());
    for (const w of werte) {
      const label = document.createElement('label');
      const kasten = document.createElement('input');
      kasten.type = 'checkbox';
      kasten.value = w;
      label.append(kasten, ' ' + text(w));
      feldset.append(label);
    }
  };
  bauen('ereignis', EREIGNISSE, e => e.ereignisse, w => w);
  bauen('art', ARTEN, e => (e.art ? [e.art] : []), artText);
}

function passtEreignis(e, wahl) {
  if (!wahl.length) return true;
  return e.ereignisse.some(t => wahl.includes(t)) || e.ereignisse.includes(ALLGEMEIN);
}

function passtAkteur(wert, wahl) {
  return !wahl.length || wahl.some(b => wert.includes(b));
}

function suchbegriff() {
  return document.getElementById('suchfeld').value.trim();
}

function gefiltert() {
  const ereignis = gewaehlt('ereignis'), art = gewaehlt('art'), kosten = gewaehlt('kosten');
  const akteur = gewaehlt('akteur'), ziel = gewaehlt('zielgruppe');
  const suche = suchbegriff().toLowerCase();
  return alle.filter(e =>
    (!zustand.nurMerkliste || zustand.merkliste.has(e.id)) &&
    passtEreignis(e, ereignis) &&
    (!art.length || art.includes(e.art)) &&
    (!kosten.length || kosten.includes(e.kosten)) &&
    passtAkteur(e.akteur, akteur) &&
    passtAkteur(e.zielgruppe, ziel) &&
    (!suche || e.name.toLowerCase().includes(suche)));
}

/** Zaehlt die Massnahmen, die nur deshalb herausfallen, weil bei ihnen die
 *  gefilterte Angabe fehlt -- nicht, weil sie nicht passen. Ohne diesen
 *  Hinweis verschwinden sie stumm, und niemand merkt, dass die Datengrundlage
 *  unvollstaendig ist. */
function wegenLuecke() {
  const gesetzt = f => gewaehlt(f).length > 0;
  return alle.filter(e =>
    (gesetzt('ereignis') && !e.ereignisse.length) ||
    (gesetzt('art') && !e.art) ||
    (gesetzt('kosten') && !e.kosten) ||
    (gesetzt('akteur') && !e.akteur) ||
    (gesetzt('zielgruppe') && !e.zielgruppe)).length;
}

function filterAnzahl() {
  return FILTERFELDER.reduce((n, f) => n + gewaehlt(f).length, 0) + (suchbegriff() ? 1 : 0);
}

// ---------------------------------------------------------------- Sortieren

function sortieren(liste) {
  const { feld, auf } = zustand.sortierung;
  if (!feld) return liste;
  const richtung = auf ? 1 : -1;
  const zahlfeld = !TEXTFELDER.includes(feld);
  return [...liste].sort((a, b) => {
    const x = a[feld], y = b[feld];
    // Leere Felder immer ans Ende, in beide Richtungen -- sonst fuellt
    // sich die erste Bildschirmseite mit Strichen.
    const lx = x === '', ly = y === '';
    if (lx || ly) return lx && ly ? 0 : (lx ? 1 : -1);
    if (zahlfeld) return (parseInt(x, 10) - parseInt(y, 10)) * richtung;
    return x.localeCompare(y, 'de') * richtung;
  });
}

// --------------------------------------------------------------- Chips

const KOSTEN_TEXT = { 1: '€ bis 20.000 €', 2: '€€ 20–100.000 €', 3: '€€€ über 100.000 €' };
const FELD_ZUSATZ = { akteur: 'Umsetzung', zielgruppe: 'Zielgruppe' };

function chipText(feld, wert) {
  if (feld === 'akteur' || feld === 'zielgruppe') return `${FELD_ZUSATZ[feld]}: ${AKTEUR[wert]}`;
  if (feld === 'kosten') return KOSTEN_TEXT[wert];
  if (feld === 'art') return artText(wert);
  return wert;
}

function chipsZeichnen() {
  const ziel = document.getElementById('chips');
  const chips = [];
  if (zustand.nurMerkliste) {
    chips.push(`<button type="button" class="chip chip-merk" data-chip="merkliste">★ Nur Merkliste <span aria-hidden="true">✕</span></button>`);
  }
  for (const feld of FILTERFELDER) {
    for (const wert of gewaehlt(feld)) {
      chips.push(`<button type="button" class="chip" data-chip="${feld}" data-wert="${esc(wert)}"` +
        ` aria-label="Filter ${esc(chipText(feld, wert))} entfernen">${esc(chipText(feld, wert))} <span aria-hidden="true">✕</span></button>`);
    }
  }
  if (suchbegriff()) {
    chips.push(`<button type="button" class="chip" data-chip="suche" aria-label="Suche entfernen">„${esc(suchbegriff())}“ <span aria-hidden="true">✕</span></button>`);
  }
  if (chips.length > 1) {
    chips.push('<button type="button" class="knopf-schlicht" data-chip="alle">Alle entfernen</button>');
  }
  ziel.innerHTML = chips.join('');
  ziel.hidden = !chips.length;
}

function chipEntfernen(knopf) {
  const art = knopf.dataset.chip;
  if (art === 'alle') { allesZuruecksetzen(); return; }
  if (art === 'merkliste') merklisteVerlassen();
  else if (art === 'suche') document.getElementById('suchfeld').value = '';
  else kaesten(art).forEach(k => { if (k.value === knopf.dataset.wert) k.checked = false; });
  zeichnen();
}

function allesZuruecksetzen() {
  document.querySelectorAll('.filter input[type="checkbox"]').forEach(k => { k.checked = false; });
  document.getElementById('suchfeld').value = '';
  merklisteVerlassen();
  zeichnen();
}

// --------------------------------------------------------- Adresse (Link)

/** Die Auswahl steht in der Adresse, damit man sie als Link weitergeben
 *  kann: „Das sind eure acht Massnahmen.“ */
const PARAM = { ereignis: 'ereignis', akteur: 'fuer', zielgruppe: 'ziel', art: 'art', kosten: 'kosten' };

function adresseSchreiben() {
  const p = new URLSearchParams();
  if (suchbegriff()) p.set('suche', suchbegriff());
  for (const feld of FILTERFELDER) {
    const w = gewaehlt(feld);
    if (w.length) p.set(PARAM[feld], w.join(','));
  }
  if (zustand.sortierung.feld) {
    p.set('sortierung', zustand.sortierung.feld + (zustand.sortierung.auf ? '' : '-ab'));
  }
  // In der Adresse heisst die Kachelansicht so, wie sie auf der Seite heisst.
  if (zustand.ansicht !== STANDARD_ANSICHT) p.set('ansicht', zustand.ansicht === 'karten' ? 'kacheln' : zustand.ansicht);
  if (zustand.vergleich && zustand.merkliste.size) {
    p.set('vergleich', [...zustand.merkliste].join(','));
  } else if (zustand.nurMerkliste && zustand.merkliste.size) {
    p.set('merkliste', [...zustand.merkliste].join(','));
  }
  const text = p.toString().replace(/%2C/g, ',');
  history.replaceState(null, '', location.pathname + (text ? '?' + text : ''));
}

/** Filter aus der Adresse. Laeuft erst, wenn die Haken aus den Daten gebaut
 *  sind. Aeltere Links mit ?risiko=… gelten fuer die Extremwetterereignisse;
 *  „Hitze+Starkregen“ wird zu den beiden einzelnen Haken. */
function filterAusAdresse() {
  const p = new URLSearchParams(location.search);
  document.getElementById('suchfeld').value = p.get('suche') || '';
  for (const feld of FILTERFELDER) {
    let werte = (p.get(PARAM[feld]) || '').split(',').filter(Boolean);
    if (feld === 'ereignis' && !werte.length) {
      werte = (p.get('risiko') || '').split(',').filter(Boolean).flatMap(w => w.split('+'));
    }
    kaesten(feld).forEach(k => { k.checked = werte.includes(k.value); });
  }
}

function adresseLesen() {
  const p = new URLSearchParams(location.search);
  const s = p.get('sortierung');
  if (s) {
    const feld = s.replace(/-ab$/, '');
    if (SPALTEN.includes(feld)) zustand.sortierung = { feld, auf: !s.endsWith('-ab') };
  }
  // Ansicht aus der Adresse, sonst Standard. ?ansicht=karten aus aelteren
  // Links gilt weiter als Kacheln.
  const ansicht = p.get('ansicht');
  zustand.ansicht = ansicht === 'kacheln' || ansicht === 'karten' ? 'karten'
    : ansicht === 'tabelle' ? 'tabelle' : STANDARD_ANSICHT;
  // Frueher dauerhaft gemerkte Wahl aufraeumen.
  try { localStorage.removeItem('kare-ansicht'); } catch { /* egal */ }
  const vgl = (p.get('vergleich') || '').split(',').filter(Boolean);
  const merk = (p.get('merkliste') || '').split(',').filter(Boolean);
  if (vgl.length) {
    zustand.merkliste = new Set(vgl);
    zustand.vergleich = true;
    zustand.merklisteAusLink = true;
  } else if (merk.length) {
    zustand.merkliste = new Set(merk);
    zustand.nurMerkliste = true;
    zustand.merklisteAusLink = true;
  }
}

// --------------------------------------------------------------- Merkliste

// Die Merkliste gilt, bis der Tab geschlossen wird (sessionStorage): Neu
// laden und zwischen Liste und Vergleich wechseln uebersteht sie, beim
// naechsten Besuch ist sie leer. Sonst saehe am gemeinsam genutzten Rechner
// die naechste Person die Liste der vorigen. Wer eine Auswahl behalten will,
// kopiert den Link.
const MERK_SCHLUESSEL = 'kare-merkliste';

function merklisteLaden() {
  try {
    // Frueher lag die Liste dauerhaft in localStorage; dort aufraeumen.
    localStorage.removeItem(MERK_SCHLUESSEL);
    const roh = sessionStorage.getItem(MERK_SCHLUESSEL);
    if (roh) zustand.merkliste = new Set(JSON.parse(roh));
  } catch { /* privates Fenster o. ae.: dann eben ohne Gedaechtnis */ }
}

function merklisteSpeichern() {
  zustand.merklisteAusLink = false;
  try { sessionStorage.setItem(MERK_SCHLUESSEL, JSON.stringify([...zustand.merkliste])); } catch { /* egal */ }
}

/** „Nur Merkliste“ aus. Kam die Liste aus einem geteilten Link, gilt danach
 *  wieder die eigene. */
function merklisteVerlassen() {
  zustand.nurMerkliste = false;
  if (zustand.merklisteAusLink) {
    zustand.merklisteAusLink = false;
    zustand.merkliste = new Set();
    merklisteLaden();
  }
}

function merkenUmschalten(id) {
  if (zustand.merkliste.has(id)) zustand.merkliste.delete(id);
  else zustand.merkliste.add(id);
  merklisteSpeichern();
  if (zustand.nurMerkliste && !zustand.merkliste.size) zustand.nurMerkliste = false;
  zeichnen();
}

// ---------------------------------------------------------------- Vergleich

/** Die gemerkten Massnahmen in der Reihenfolge, in der sie gemerkt wurden. */
function vergleichsListe() {
  const nachId = new Map(alle.map(e => [e.id, e]));
  return [...zustand.merkliste].map(id => nachId.get(id)).filter(Boolean);
}

function stufeText(wert, woerter) {
  return wert !== '' && woerter[wert]
    ? `${punkte(wert, woerter, true)} ${woerter[wert]}`
    : '<span class="leise">nicht bewertet</span>';
}

// Zeilen des Vergleichs. „besser“ sagt, welcher Wert hervorgehoben wird.
function vergleichZeilen() {
  return [
    { name: 'Extremwetterereignis', html: e => ereignisMarken(e) },
    { name: 'Art', html: e => e.art ? esc(artText(e.art)) : STRICH },
    { name: 'Umsetzender Akteur', html: e => e.akteur ? esc(akteure(e.akteur).join(', ')) : STRICH },
    { name: 'Planung', html: e => (e.planung === '1' ? '✓ ja' : 'nein') },
    { name: 'Zu erreichende Zielgruppe', html: e => e.zielgruppe ? esc(akteure(e.zielgruppe).join(', ')) : STRICH },
    { name: 'Kosten', key: 'kosten', besser: 'niedrig',
      html: e => e.kosten && KOSTEN[e.kosten]
        ? `${geld(e.kosten, true)} <span class="leise">${KOSTEN[e.kosten]}</span>`
        : '<span class="leise">nicht angegeben</span>' },
    { name: 'Dauer', key: 'dauer', besser: 'niedrig',
      html: e => e.dauer && DAUER[e.dauer] ? stufeText(e.dauer, DAUER) : '<span class="leise">nicht angegeben</span>' },
    { gruppe: 'Wirksamkeit' },
    ...wirkungenMitWert.map(w => ({ name: w.name, erklaerung: w.erklaerung, key: w.key, besser: 'hoch',
      html: e => stufeText(e[w.key], STUFE) })),
    { name: 'Synergien', erklaerung: 'zusätzlicher Nutzen', key: 'synergien', besser: 'hoch',
      html: e => stufeText(e.synergien, STUFE) },
    { name: 'Steckbrief', html: e => {
      const a = steckbriefAdresse(e.steckbrief);
      return a ? `<a class="steckbrief nur-bildschirm" href="${esc(a)}" target="_blank" rel="noopener">PDF öffnen` +
        `<span class="unsichtbar">: Steckbrief ${esc(e.name)}</span>${NEUES_FENSTER}</a>` +
        '<span class="nur-druck" aria-hidden="true">ja, siehe Anhang</span>' : STRICH;
    } },
  ];
}

/** Welche Spalten in dieser Zeile den besten Wert haben. Hervorgehoben wird
 *  nur, wenn sich die Werte unterscheiden -- sind alle gleich, ist keiner
 *  „besser“. Bei Wirkungen zaehlt 0 („keine“) nicht als Bestwert. */
function besteSpalten(zeile, liste) {
  if (!zeile.besser) return new Set();
  const werte = liste.map(e => parseInt(e[zeile.key], 10));
  const gueltig = werte.filter(w => !isNaN(w) && (zeile.besser === 'niedrig' || w > 0));
  if (!gueltig.length) return new Set();
  const bester = zeile.besser === 'hoch' ? Math.max(...gueltig) : Math.min(...gueltig);
  const treffer = new Set(werte.map((w, i) => (w === bester ? i : -1)).filter(i => i >= 0));
  return treffer.size < liste.length ? treffer : new Set();
}

function vergleichZeichnen() {
  const ziel = document.getElementById('vergleich');
  const ganz = vergleichsListe();
  const liste = ganz.slice(0, MAX_VERGLEICH);
  if (liste.length < 2) {
    ziel.innerHTML = '<p class="leer">Für einen Vergleich mindestens zwei Maßnahmen mit ☆ merken.</p>';
    return;
  }
  const kopf = liste.map(e =>
    `<th scope="col"><div class="vgl-kopf"><span>${nameHtml(e.name)}</span>` +
    `<button type="button" class="vgl-weg" data-merken="${esc(e.id)}"` +
    ` aria-label="${esc(e.name)} aus dem Vergleich nehmen" title="Aus dem Vergleich nehmen">✕</button></div></th>`).join('');
  const zeilen = vergleichZeilen().map(z => {
    if (z.gruppe) return `<tr class="vgl-gruppe"><th scope="rowgroup" colspan="${liste.length + 1}">${z.gruppe}</th></tr>`;
    const beste = besteSpalten(z, liste);
    return `<tr><th scope="row">${z.name}` +
      (z.erklaerung ? `<span class="vgl-erklaerung">${z.erklaerung}</span>` : '') + `</th>` +
      // Hervorhebung nicht nur ueber Farbe: Screenreader hoeren „bester Wert“.
      liste.map((e, i) => beste.has(i)
        ? `<td class="beste">${z.html(e)}<span class="unsichtbar"> (bester Wert)</span></td>`
        : `<td>${z.html(e)}</td>`).join('') + `</tr>`;
  }).join('');
  ziel.innerHTML =
    `<div class="vergleich-rahmen"><table class="vergleich-tabelle">` +
      `<caption class="unsichtbar">Vergleich von ${liste.length} Maßnahmen</caption>` +
      `<thead><tr><th scope="col" class="vgl-ecke"><span class="unsichtbar">Eigenschaft</span></th>${kopf}</tr></thead>` +
      `<tbody>${zeilen}</tbody></table></div>` +
    `<p class="vgl-legende"><span class="beste-muster" aria-hidden="true"></span>` +
      ` Hervorgehoben: der günstigste, schnellste oder wirksamste Wert je Zeile.</p>` +
    (ganz.length > MAX_VERGLEICH
      ? `<p class="hinweis-luecke">Verglichen werden die ersten ${MAX_VERGLEICH} von ${ganz.length} gemerkten Maßnahmen. ` +
        `Nimm mit ✕ welche heraus, um die übrigen zu sehen.</p>`
      : '');
}

/** Leiste unten am Bildschirm, sobald etwas gemerkt ist -- damit niemand
 *  fuer „Merkliste“ oder „Vergleichen“ ans Seitenende scrollen muss. */
function merkleisteZeichnen() {
  const n = zustand.merkliste.size;
  const leiste = document.getElementById('merkleiste');
  const zeigen = n > 0 || zustand.vergleich;
  leiste.hidden = !zeigen;
  document.body.classList.toggle('mit-merkleiste', zeigen);
  document.getElementById('merk-text').innerHTML =
    n === 0 ? 'Nichts gemerkt' : `<span aria-hidden="true">★ </span>${n} gemerkt`;

  const nur = document.getElementById('merk-nur');
  nur.hidden = zustand.vergleich;
  nur.setAttribute('aria-pressed', zustand.nurMerkliste);

  const vgl = document.getElementById('merk-vergleich');
  if (zustand.vergleich) {
    vgl.innerHTML = '<span aria-hidden="true">← </span>Zurück zur Liste';
    vgl.disabled = false;
    vgl.title = '';
  } else {
    vgl.textContent = n > 1 ? `${Math.min(n, MAX_VERGLEICH)} vergleichen` : 'Vergleichen';
    vgl.disabled = n < 2;
    vgl.title = n < 2 ? 'Mindestens zwei Maßnahmen mit ☆ merken' : '';
  }
}

// ----------------------------------------------------------------- Zeichnen

function effektiveAnsicht() {
  return SCHMAL.matches ? 'karten' : zustand.ansicht;
}

/** Die Filter liegen hinter einem Knopf: auf dem Handy immer (Fenster von
 *  unten), am Desktop in der Tabellenansicht, wenn die Tabelle sonst nicht
 *  auf den Bildschirm passt (Leiste von links). */
function filterModusSetzen() {
  const fenster = SCHMAL.matches || (effektiveAnsicht() === 'tabelle' && !BREIT.matches);
  document.body.classList.toggle('filter-als-fenster', fenster);
  document.body.classList.toggle('filter-seitlich', fenster && !SCHMAL.matches);
  if (!fenster) filterSchliessen();
}

function zeichnen() {
  const treffer = sortieren(gefiltert());
  const vergleich = zustand.vergleich;
  const karten = !vergleich && effektiveAnsicht() === 'karten';
  const tabelleZeigen = !vergleich && !karten;
  document.body.classList.toggle('im-vergleich', vergleich);
  document.body.classList.toggle('ansicht-tabelle', tabelleZeigen);
  filterModusSetzen();

  const liste = document.getElementById('karten');
  const tabelle = document.getElementById('tabelle-rahmen');
  liste.hidden = !karten;
  tabelle.hidden = !tabelleZeigen;
  document.getElementById('vergleich').hidden = !vergleich;
  if (karten) liste.replaceChildren(...treffer.map(karteBauen));
  else if (tabelleZeigen) document.getElementById('koerper').replaceChildren(...treffer.map(zeileBauen));
  else vergleichZeichnen();

  const n = treffer.length;
  const imVergleich = Math.min(vergleichsListe().length, MAX_VERGLEICH);
  document.getElementById('zaehler').textContent = vergleich
    ? `Vergleich von ${imVergleich} Maßnahme${imVergleich === 1 ? '' : 'n'}`
    : n === alle.length ? `Alle ${alle.length} Maßnahmen` : `${n} von ${alle.length} Maßnahmen`;
  document.getElementById('filter-anwenden').textContent =
    n === 1 ? '1 Maßnahme anzeigen' : `${n} Maßnahmen anzeigen`;

  const leer = document.getElementById('leer');
  leer.hidden = n > 0 || vergleich;
  leer.textContent = zustand.nurMerkliste
    ? 'Auf der Merkliste steht nichts, das zu diesen Filtern passt.'
    : 'Zu dieser Auswahl gibt es keine Maßnahme. Nimm einen Filter heraus.';

  const luecken = wegenLuecke();
  const hinweis = document.getElementById('ausgeblendet');
  hinweis.hidden = luecken === 0 || vergleich;
  if (luecken) {
    hinweis.textContent =
      `${luecken} Maßnahme${luecken === 1 ? '' : 'n'} ` +
      `${luecken === 1 ? 'ist' : 'sind'} hier nicht dabei, weil die gefilterte ` +
      `Angabe dort fehlt — nicht, weil ${luecken === 1 ? 'sie nicht passt' : 'sie nicht passen'}.`;
  }

  const anzahl = filterAnzahl();
  const fa = document.getElementById('filter-anzahl');
  fa.hidden = !anzahl;
  // Sichtbar „Filter 2“, vorgelesen „Filter 2 aktiv“.
  fa.innerHTML = `${anzahl}<span class="unsichtbar"> aktiv</span>`;

  merkleisteZeichnen();

  document.getElementById('sortierung').value =
    zustand.sortierung.feld && document.querySelector(`#sortierung option[value="${zustand.sortierung.feld}"]`)
      ? zustand.sortierung.feld : '';
  document.querySelectorAll('.umschalter button').forEach(b =>
    b.setAttribute('aria-pressed', b.dataset.ansicht === zustand.ansicht));
  document.querySelectorAll('thead th').forEach(th => {
    if (th.dataset.sort && th.dataset.sort === zustand.sortierung.feld)
      th.setAttribute('aria-sort', zustand.sortierung.auf ? 'ascending' : 'descending');
    else th.removeAttribute('aria-sort');
  });

  chipsZeichnen();
  adresseSchreiben();
  // Druckkopf und Anhang gleich mitfuellen, nicht erst beim Drucken: So
  // stimmen sie auch, wenn ein Programm die Seite direkt als PDF druckt.
  druckkopfFuellen();
  druckAnhangFuellen(vergleich ? vergleichsListe().slice(0, MAX_VERGLEICH) : (karten ? [] : treffer));
  kopfleisteMessen();
  hoeheMelden();
}

// --------------------------------------------------- Filterfenster (Handy)

let fokusVorher = null;

function filterOeffnen() {
  fokusVorher = document.activeElement;
  document.body.classList.add('filter-offen');
  document.getElementById('filter-abdeckung').hidden = false;
  document.getElementById('filter-oeffnen').setAttribute('aria-expanded', 'true');
  // Der Rest der Seite ist solange nicht bedienbar, auch nicht per Tastatur.
  if (!document.documentElement.classList.contains('eingebettet-wachsend')) {
    for (const s of ['.kopf', '.ergebnis', '.fuss']) document.querySelector(s).inert = true;
    document.getElementById('filter').setAttribute('role', 'dialog');
    document.getElementById('filter').setAttribute('aria-modal', 'true');
  }
  document.getElementById('filter-schliessen').focus();
  hoeheMelden();
}

function filterSchliessen() {
  if (!document.body.classList.contains('filter-offen')) return;
  document.body.classList.remove('filter-offen');
  document.getElementById('filter-abdeckung').hidden = true;
  document.getElementById('filter-oeffnen').setAttribute('aria-expanded', 'false');
  for (const s of ['.kopf', '.ergebnis', '.fuss']) document.querySelector(s).inert = false;
  document.getElementById('filter').removeAttribute('role');
  document.getElementById('filter').removeAttribute('aria-modal');
  (fokusVorher || document.getElementById('filter-oeffnen')).focus();
  hoeheMelden();
}

// ------------------------------------------------------------ Weitergeben

function weitergebenStatus(inhalt) {
  const s = document.getElementById('weitergeben-status');
  s.replaceChildren(...(Array.isArray(inhalt) ? inhalt : [inhalt]));
}

async function linkKopieren() {
  adresseSchreiben();
  const link = location.href;
  try {
    await navigator.clipboard.writeText(link);
    weitergebenStatus('Link kopiert. Wer ihn öffnet, sieht genau diese Auswahl.');
  } catch {
    // Etwa in einem iframe ohne Erlaubnis fuer die Zwischenablage: dann den
    // Link zum Kopieren von Hand anbieten.
    const feld = document.createElement('input');
    feld.type = 'text';
    feld.readOnly = true;
    feld.value = link;
    feld.className = 'link-feld';
    feld.setAttribute('aria-label', 'Link zur Auswahl');
    weitergebenStatus(['Link zum Kopieren: ', feld]);
    feld.focus();
    feld.select();
  }
}

function druckkopfFuellen() {
  const teile = [];
  for (const feld of FILTERFELDER) {
    const w = gewaehlt(feld);
    if (w.length) teile.push(w.map(x => chipText(feld, x)).join(', '));
  }
  if (suchbegriff()) teile.push(`Suche „${suchbegriff()}“`);
  if (zustand.nurMerkliste) teile.unshift('Merkliste');
  const n = gefiltert().length;
  const imVergleich = Math.min(vergleichsListe().length, MAX_VERGLEICH);
  document.getElementById('druck-auswahl').textContent = zustand.vergleich
    ? `Vergleich von ${imVergleich} Maßnahmen`
    : `${n} Maßnahme${n === 1 ? '' : 'n'}` + (teile.length ? ` · Auswahl: ${teile.join(' · ')}` : ' · ohne Filter');
  const heute = new Date().toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
  document.getElementById('druck-stand').textContent = `Stand ${heute} · Diese Auswahl online: ${location.href}`;
}

/** Steckbriefe der gedruckten Massnahmen mit voller Adresse. In den Kacheln
 *  steht die Adresse schon an der Kachel, dort bleibt der Anhang leer. */
function druckAnhangFuellen(liste) {
  const mit = liste.filter(e => steckbriefAdresse(e.steckbrief));
  const ziel = document.getElementById('druck-anhang');
  ziel.innerHTML = mit.length
    ? '<h2>Steckbriefe</h2><ul>' + mit.map(e =>
        `<li><b>${esc(e.name)}:</b> ${esc(new URL(steckbriefAdresse(e.steckbrief), location.href).href)}</li>`).join('') + '</ul>'
    : '';
}

// Datum im Druckkopf auf den Moment des Druckens setzen.
window.addEventListener('beforeprint', druckkopfFuellen);

function alsCsv() {
  const treffer = zustand.vergleich ? vergleichsListe().slice(0, MAX_VERGLEICH) : sortieren(gefiltert());
  const zeilen = [CSV_KOPF].concat(treffer.map(e => SPALTEN.map(s =>
    s === 'steckbrief' && steckbriefAdresse(e[s]) ? new URL(steckbriefAdresse(e[s]), location.href).href : e[s])));
  const klecks = new Blob([csvText(zeilen)], { type: 'text/csv;charset=utf-8' });
  const adresse = URL.createObjectURL(klecks);
  const a = document.createElement('a');
  const heute = new Date().toISOString().slice(0, 10);
  a.href = adresse;
  a.download = `${heute} ${zustand.vergleich ? 'Massnahmenvergleich' : 'Massnahmenauswahl'}.csv`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(adresse), 1000);
}

// -------------------------------------------------------------------- Start

/** Die Tabellenkoepfe haften unter der angehefteten Ergebnisleiste. Deren
 *  Hoehe aendert sich mit der Fensterbreite (Umbruch) und wird mitgefuehrt. */
function kopfleisteMessen() {
  const wurzel = document.documentElement.style;
  // Genaue Hoehe, nicht offsetHeight: Das rundet auf ganze Pixel, und
  // zwischen Leiste und Tabellenkopf blieb ein Bruchteil-Spalt, durch den
  // beim Scrollen die Zeilen schimmerten.
  wurzel.setProperty('--kopfleiste', document.querySelector('.ergebnis-kopf').getBoundingClientRect().height + 'px');
  wurzel.setProperty('--seitenkopf', document.querySelector('.kopf').getBoundingClientRect().height + 'px');
}

/** Sortierbare Spaltenkoepfe bekommen einen echten Knopf. Eine anklickbare
 *  Zelle erkennen Screenreader nicht als bedienbar; die Richtung sagt
 *  aria-sort an der Zelle. */
function sortierknoepfeSetzen() {
  document.querySelectorAll('#tabelle thead th[data-sort]').forEach(th => {
    const knopf = document.createElement('button');
    knopf.type = 'button';
    knopf.className = 'sortierknopf';
    knopf.append(...th.childNodes);
    th.append(knopf);
    knopf.addEventListener('click', () => {
      const feld = th.dataset.sort;
      zustand.sortierung = { feld, auf: zustand.sortierung.feld === feld ? !zustand.sortierung.auf : true };
      zeichnen();
    });
  });
}

function verdrahten() {
  const beobachter = new ResizeObserver(kopfleisteMessen);
  beobachter.observe(document.querySelector('.ergebnis-kopf'));
  beobachter.observe(document.querySelector('.kopf'));
  window.addEventListener('resize', kopfleisteMessen);
  // Ein Lauscher fuer alle Haken, auch die erst aus den Daten gebauten.
  document.getElementById('filter').addEventListener('change', e => {
    if (e.target.matches('input[type="checkbox"]')) zeichnen();
  });
  document.getElementById('suchfeld').addEventListener('input', zeichnen);
  document.getElementById('zuruecksetzen').addEventListener('click', allesZuruecksetzen);

  document.getElementById('filter-oeffnen').addEventListener('click', filterOeffnen);
  document.getElementById('filter-schliessen').addEventListener('click', filterSchliessen);
  document.getElementById('filter-anwenden').addEventListener('click', filterSchliessen);
  document.getElementById('filter-abdeckung').addEventListener('click', filterSchliessen);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') filterSchliessen(); });
  SCHMAL.addEventListener('change', zeichnen);
  BREIT.addEventListener('change', zeichnen);

  document.getElementById('chips').addEventListener('click', e => {
    const k = e.target.closest('[data-chip]');
    if (k) chipEntfernen(k);
  });
  document.querySelector('.ergebnis').addEventListener('click', e => {
    const k = e.target.closest('[data-merken]');
    if (k) {
      const id = k.dataset.merken;
      merkenUmschalten(id);
      // Fokus bleibt auf dem Stern, auch wenn die Liste neu gezeichnet wurde.
      const neu = document.querySelector(`[data-merken="${CSS.escape(id)}"]`);
      if (neu) neu.focus();
    }
  });

  document.getElementById('sortierung').addEventListener('change', e => {
    const feld = e.target.value || null;
    zustand.sortierung = { feld, auf: feld ? !!SORTIER_RICHTUNG[feld] : true };
    zeichnen();
  });
  document.querySelectorAll('.umschalter button').forEach(b =>
    b.addEventListener('click', () => {
      zustand.ansicht = b.dataset.ansicht;
      zeichnen();
    }));

  document.getElementById('merk-nur').addEventListener('click', () => {
    if (zustand.nurMerkliste) merklisteVerlassen();
    else zustand.nurMerkliste = true;
    zeichnen();
  });
  document.getElementById('merk-vergleich').addEventListener('click', () => {
    zustand.vergleich = !zustand.vergleich;
    if (zustand.vergleich) zustand.nurMerkliste = false;
    zeichnen();
    // Zum Anfang der Ergebnisse, damit man den Vergleich nicht erst suchen muss.
    document.querySelector('.ergebnis').scrollIntoView({ block: 'start' });
  });
  document.getElementById('teilen').addEventListener('click', linkKopieren);
  document.getElementById('drucken').addEventListener('click', () => window.print());
  document.getElementById('herunterladen').addEventListener('click', alsCsv);
}

/** Eingebettet als iframe: der umgebenden Seite die eigene Hoehe melden,
 *  damit der iframe mitwaechst statt eine zweite Bildlaufleiste zu zeigen.
 *  Die Hoehe ist keine vertrauliche Angabe, deshalb an jeden Empfaenger.
 *  Gemeldet wird nach jedem Zeichnen und zusaetzlich bei Groessenaenderung
 *  (Schrift geladen, Fenster schmaler, Bewertungen auf- und zugeklappt). */
let zuletztGemeldet = 0;
function hoeheMelden() {
  if (window.parent === window) return;
  // Hoehe des Inhalts, nicht scrollHeight: das waere nie kleiner als der
  // iframe selbst, und nach dem Filtern schrumpfte der Rahmen nicht mehr.
  const hoehe = Math.ceil(document.body.getBoundingClientRect().height);
  if (hoehe === zuletztGemeldet) return;
  zuletztGemeldet = hoehe;
  window.parent.postMessage({ typ: 'kare-hoehe', hoehe }, '*');
  // Waechst der iframe tatsaechlich mit, liegt der untere Rand der Seite
  // womoeglich weit ausserhalb des Bildschirms. Ein unten angeheftetes
  // Filterfenster waere dann unsichtbar -- es klappt stattdessen an Ort und
  // Stelle auf.
  setTimeout(() => {
    if (window.innerHeight >= hoehe - 4 && hoehe > 900) {
      document.documentElement.classList.add('eingebettet-wachsend');
    }
  }, 400);
}

if (window.parent !== window) {
  new ResizeObserver(hoeheMelden).observe(document.body);
  window.addEventListener('load', hoeheMelden);
}

async function steckbriefeLaden() {
  try {
    const antwort = await fetch(STECKBRIEF_LISTE, { cache: 'no-cache' });
    if (antwort.ok) vorhandeneSteckbriefe = new Set(await antwort.json());
  } catch { /* unbekannt: alle eingetragenen gelten als vorhanden */ }
}

async function starten() {
  merklisteLaden();
  adresseLesen();
  verdrahten();
  filterModusSetzen();
  try {
    // no-cache: beim Server nachfragen, ob es einen neueren Stand gibt.
    // Sonst saehe man nach dem Veroeffentlichen bis zu zehn Minuten lang
    // die alte Tabelle; ist sie unveraendert, antwortet der Server knapp.
    const [antwort] = await Promise.all([fetch(DATEI, { cache: 'no-cache' }), steckbriefeLaden()]);
    if (!antwort.ok) throw new Error(`${antwort.status} ${antwort.statusText}`);
    alle = einlesen(await antwort.text());
    wirkungenMitWert = WIRKUNGEN.filter(w => alle.some(e => e[w.key] !== ''));
    // Was auf der Merkliste steht, aber nicht mehr in der Tabelle, faellt
    // stillschweigend heraus -- sonst zaehlte der Knopf Unsichtbares mit.
    const da = new Set(alle.map(e => e.id));
    zustand.merkliste = new Set([...zustand.merkliste].filter(id => da.has(id)));
    filterAufbauen();
    filterAusAdresse();
    tabellenkopfBauen();
    zeichnen();
  } catch (fehler) {
    document.getElementById('zaehler').textContent =
      'Die Maßnahmen konnten nicht geladen werden: ' + fehler.message;
  }
}

starten();
