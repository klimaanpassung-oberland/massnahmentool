'use strict';

// Die Seite kommt ohne fremde Bibliotheken aus. Das ist Absicht: Das Werkzeug
// soll in zehn Jahren noch laufen, und jede eingebundene Fremdquelle ist eine
// Stelle, die bis dahin verschwinden, sich aendern oder Besucherdaten
// mitschneiden kann.

const DATEI = 'daten/massnahmen.csv';

// Die Spalten der CSV in der Reihenfolge, in der sie dort stehen.
const SPALTEN = ['name', 'hazard', 'art', 'akteure', 'kosten', 'dauer',
                 'rueckhalt', 'ableitung', 'versickerung', 'kuehlung',
                 'aufwertung', 'steckbrief'];

const STUFE = { '0': 'keine', '1': 'gering', '2': 'mittel', '3': 'hoch' };
const DAUER = { '1': 'kurz', '2': 'mittel', '3': 'lang' };
const KOSTEN = { '1': 'bis 20.000 €', '2': '20.000 bis 100.000 €', '3': 'über 100.000 €' };
const ZIELGRUPPE = { K: 'Kommunen', U: 'Unternehmen', P: 'Haushalte' };
const WIRKUNGEN = [
  { key: 'rueckhalt', name: 'Rückhalt', erklaerung: 'hält Regenwasser zurück' },
  { key: 'ableitung', name: 'Ableitung', erklaerung: 'leitet Wasser schadlos ab' },
  { key: 'versickerung', name: 'Versickerung', erklaerung: 'lässt Wasser im Boden versickern' },
  { key: 'kuehlung', name: 'Kühlung', erklaerung: 'senkt die Temperatur' },
  { key: 'aufwertung', name: 'Stadtstruktur', erklaerung: 'wertet Ort und Stadtbild auf' },
];

// Wie die Auswahl „Sortieren“ ordnet: Kosten und Dauer niedrig zuerst,
// Wirkungen hoch zuerst.
const SORTIER_RICHTUNG = { name: true, kosten: true, dauer: true, hazard: true, art: true, akteure: true };

// Schmal = Handy. Gleiche Grenze wie in stil.css.
const SCHMAL = window.matchMedia('(max-width: 860px)');
// Ab dieser Breite passt die Tabelle neben die Filterleiste.
const BREIT = window.matchMedia('(min-width: 1300px)');

const zustand = {
  sortierung: { feld: null, auf: true },
  ansicht: 'karten',
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

const STRICH = '<span class="fehlt" title="keine Angabe">–</span>';

/** Name zum Anzeigen: nach einem Schraegstrich darf umbrochen werden, sonst
 *  sprengt etwa „Kaltluftentstehungsgebieten/Frischluftschneisen“ die Spalte. */
function nameHtml(name) {
  return esc(name).replace(/\//g, '/<wbr>');
}

function punkte(wert, beschriftung) {
  const n = parseInt(wert, 10);
  if (!wert || isNaN(n)) return STRICH;
  if (n === 0) return '<span class="fehlt" title="keine">0</span>';
  const text = (beschriftung && beschriftung[wert]) || wert;
  return `<span class="punkte" title="${text}" aria-label="${text}">` +
         `<span class="punkt-voll" aria-hidden="true">${'●'.repeat(n)}</span>` +
         `<span class="punkt-leer" aria-hidden="true">${'○'.repeat(3 - n)}</span></span>`;
}

function geld(wert) {
  const n = parseInt(wert, 10);
  if (!wert || isNaN(n) || n < 1) return STRICH;
  return `<span class="geld" title="${KOSTEN[n]}" aria-label="${KOSTEN[n]}">${'€'.repeat(n)}</span>`;
}

function zielgruppen(wert) {
  return wert.split('').map(b => ZIELGRUPPE[b] || b);
}

function textOderStrich(wert) {
  return wert ? esc(wert) : STRICH;
}

/** Ein Steckbrief ist entweder ein Dateiname im Ordner steckbriefe/ oder ein
 *  vollstaendiger Link auf eine Datei anderswo. Andere Adressarten (etwa
 *  javascript:) werden nicht verlinkt. */
function steckbriefAdresse(wert) {
  if (!wert) return null;
  if (/^https?:\/\//i.test(wert)) return wert;
  if (/^[^/\\:]+$/.test(wert)) return 'steckbriefe/' + encodeURIComponent(wert);
  return null;
}

function risikoMarken(hazard) {
  if (!hazard) return '<span class="marke marke-leer">Risiko nicht angegeben</span>';
  return hazard.split(/\s*&\s*/).map(r => {
    const art = /hitze/i.test(r) ? 'hitze' : /starkregen/i.test(r) ? 'regen' : 'sonst';
    return `<span class="marke marke-${art}">${esc(r)}</span>`;
  }).join(' ');
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
  const bewertet = WIRKUNGEN.some(w => e[w.key] !== '');
  const wirkung = st.length
    ? st.map(w => `<span class="wirkung"><span class="wirkung-name">${w.name}</span> ${STUFE[e[w.key]]}</span>`).join('')
    : `<span class="leise">${bewertet ? 'laut Bewertung keine' : 'nicht bewertet'}</span>`;
  const steckbrief = steckbriefAdresse(e.steckbrief);
  const kosten = e.kosten && KOSTEN[e.kosten]
    ? `${geld(e.kosten)} <span class="leise">${KOSTEN[e.kosten]}</span>`
    : '<span class="leise">nicht angegeben</span>';
  const dauer = e.dauer && DAUER[e.dauer]
    ? `${punkte(e.dauer, DAUER)} ${DAUER[e.dauer]}`
    : '<span class="leise">nicht angegeben</span>';
  const fuer = e.akteure ? esc(zielgruppen(e.akteure).join(' · ')) : '<span class="leise">nicht angegeben</span>';

  li.innerHTML =
    `<article aria-labelledby="k-${esc(e.id)}">` +
      `<div class="karte-kopf">` +
        `<h3 id="k-${esc(e.id)}">${nameHtml(e.name)}</h3>${merkKnopf(e)}` +
      `</div>` +
      `<p class="karte-marken">${risikoMarken(e.hazard)}` +
        (e.art ? ` <span class="karte-art">${esc(e.art)}</span>` : '') + `</p>` +
      `<dl class="fakten">` +
        `<div><dt>Kosten</dt><dd>${kosten}</dd></div>` +
        `<div><dt>Dauer</dt><dd>${dauer}</dd></div>` +
        `<div><dt>Wirkung</dt><dd class="wirkungen">${wirkung}</dd></div>` +
        `<div><dt>Für</dt><dd>${fuer}</dd></div>` +
      `</dl>` +
      // Ist gar nichts bewertet, gibt es auch nichts aufzuklappen.
      (bewertet
        ? `<details class="alle-wirkungen"><summary>Alle Bewertungen</summary><dl>` +
          WIRKUNGEN.map(w => `<div><dt>${w.name} <span class="leise">– ${w.erklaerung}</span></dt>` +
            `<dd>${e[w.key] !== '' ? `${punkte(e[w.key], STUFE)} ${STUFE[e[w.key]] || esc(e[w.key])}` : '<span class="leise">nicht bewertet</span>'}</dd></div>`).join('') +
          `</dl></details>`
        : '') +
      (steckbrief
        ? `<a class="steckbrief-knopf" href="${esc(steckbrief)}" target="_blank" rel="noopener">Steckbrief öffnen (PDF)</a>`
        : '') +
    `</article>`;
  return li;
}

/** Kompakte Zeile: Name darf umbrechen, Risiko und Zielgruppe stehen als
 *  kleine Marken untereinander -- so passen alle Spalten auf einen Bildschirm. */
function zeileBauen(e) {
  const tr = document.createElement('tr');
  const steckbrief = steckbriefAdresse(e.steckbrief);
  const risiko = e.hazard ? `<div class="zellmarken">${risikoMarken(e.hazard)}</div>` : STRICH;
  const fuer = e.akteure
    ? `<div class="zellmarken">${zielgruppen(e.akteure).map(z => `<span class="marke">${esc(z)}</span>`).join('')}</div>`
    : STRICH;
  tr.innerHTML =
    `<td class="spalte-merken">${merkKnopf(e)}</td>` +
    `<td class="spalte-name">${nameHtml(e.name)}</td>` +
    `<td>${risiko}</td>` +
    `<td>${textOderStrich(e.art)}</td>` +
    `<td>${fuer}</td>` +
    `<td class="mitte">${geld(e.kosten)}</td>` +
    `<td class="mitte">${punkte(e.dauer, DAUER)}</td>` +
    WIRKUNGEN.map(w => `<td class="mitte">${punkte(e[w.key], STUFE)}</td>`).join('') +
    `<td class="mitte">${steckbrief ? `<a class="steckbrief" href="${esc(steckbrief)}" target="_blank" rel="noopener" aria-label="Steckbrief ${esc(e.name)} (PDF)">PDF</a>` : STRICH}</td>`;
  return tr;
}

// ------------------------------------------------------------------ Filtern

const FILTERFELDER = ['zielgruppe', 'risiko', 'art', 'kosten'];

function kaesten(feld) {
  return [...document.querySelectorAll(`fieldset[data-feld="${feld}"] input`)];
}

function gewaehlt(feld) {
  return kaesten(feld).filter(k => k.checked).map(k => k.value);
}

function passtRisiko(e, wahl) {
  if (!wahl.length) return true;
  const h = e.hazard;
  return wahl.some(w => {
    if (w === 'Hitze+Starkregen') return h.includes('Hitze') && h.includes('Starkregen');
    return h.includes(w);
  });
}

function suchbegriff() {
  return document.getElementById('suchfeld').value.trim();
}

function gefiltert() {
  const risiko = gewaehlt('risiko'), art = gewaehlt('art');
  const kosten = gewaehlt('kosten'), ziel = gewaehlt('zielgruppe');
  const suche = suchbegriff().toLowerCase();
  return alle.filter(e =>
    (!zustand.nurMerkliste || zustand.merkliste.has(e.id)) &&
    passtRisiko(e, risiko) &&
    (!art.length || art.includes(e.art)) &&
    (!kosten.length || kosten.includes(e.kosten)) &&
    (!ziel.length || ziel.some(z => e.akteure.includes(z))) &&
    (!suche || e.name.toLowerCase().includes(suche)));
}

/** Zaehlt die Massnahmen, die nur deshalb herausfallen, weil bei ihnen die
 *  gefilterte Angabe fehlt -- nicht, weil sie nicht passen. Ohne diesen
 *  Hinweis verschwinden sie stumm, und niemand merkt, dass die Datengrundlage
 *  unvollstaendig ist. */
function wegenLuecke() {
  const risiko = gewaehlt('risiko'), art = gewaehlt('art'), kosten = gewaehlt('kosten');
  return alle.filter(e =>
    (risiko.length && !e.hazard) ||
    (art.length && !e.art) ||
    (kosten.length && !e.kosten)).length;
}

function filterAnzahl() {
  return FILTERFELDER.reduce((n, f) => n + gewaehlt(f).length, 0) + (suchbegriff() ? 1 : 0);
}

// ---------------------------------------------------------------- Sortieren

function sortieren(liste) {
  const { feld, auf } = zustand.sortierung;
  if (!feld) return liste;
  const richtung = auf ? 1 : -1;
  const zahlfeld = !['name', 'hazard', 'art', 'akteure'].includes(feld);
  return [...liste].sort((a, b) => {
    const x = a[feld], y = b[feld];
    if (zahlfeld) {
      // Leere Felder immer ans Ende, in beide Richtungen -- sonst fuellt
      // sich die erste Bildschirmseite mit Strichen.
      const lx = x === '', ly = y === '';
      if (lx || ly) return lx && ly ? 0 : (lx ? 1 : -1);
      return (parseInt(x, 10) - parseInt(y, 10)) * richtung;
    }
    return x.localeCompare(y, 'de') * richtung;
  });
}

// --------------------------------------------------------------- Chips

const RISIKO_TEXT = { 'Hitze+Starkregen': 'Hitze und Starkregen' };
const KOSTEN_TEXT = { 1: '€ bis 20.000 €', 2: '€€ 20–100.000 €', 3: '€€€ über 100.000 €' };

function chipText(feld, wert) {
  if (feld === 'zielgruppe') return ZIELGRUPPE[wert];
  if (feld === 'risiko') return RISIKO_TEXT[wert] || wert;
  if (feld === 'kosten') return KOSTEN_TEXT[wert];
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
const PARAM = { zielgruppe: 'fuer', risiko: 'risiko', art: 'art', kosten: 'kosten' };

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
  if (zustand.ansicht === 'tabelle') p.set('ansicht', 'tabelle');
  if (zustand.vergleich && zustand.merkliste.size) {
    p.set('vergleich', [...zustand.merkliste].join(','));
  } else if (zustand.nurMerkliste && zustand.merkliste.size) {
    p.set('merkliste', [...zustand.merkliste].join(','));
  }
  const text = p.toString().replace(/%2C/g, ',');
  history.replaceState(null, '', location.pathname + (text ? '?' + text : ''));
}

function adresseLesen() {
  const p = new URLSearchParams(location.search);
  document.getElementById('suchfeld').value = p.get('suche') || '';
  for (const feld of FILTERFELDER) {
    const werte = (p.get(PARAM[feld]) || '').split(',').filter(Boolean);
    kaesten(feld).forEach(k => { k.checked = werte.includes(k.value); });
  }
  const s = p.get('sortierung');
  if (s) {
    const feld = s.replace(/-ab$/, '');
    if (SPALTEN.includes(feld)) zustand.sortierung = { feld, auf: !s.endsWith('-ab') };
  }
  zustand.ansicht = p.get('ansicht') === 'tabelle' ? 'tabelle' : 'karten';
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

const MERK_SCHLUESSEL = 'kare-merkliste';

function merklisteLaden() {
  try {
    const roh = localStorage.getItem(MERK_SCHLUESSEL);
    if (roh) zustand.merkliste = new Set(JSON.parse(roh));
  } catch { /* privates Fenster o. ae.: dann eben ohne Gedaechtnis */ }
}

function merklisteSpeichern() {
  zustand.merklisteAusLink = false;
  try { localStorage.setItem(MERK_SCHLUESSEL, JSON.stringify([...zustand.merkliste])); } catch { /* egal */ }
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
    ? `${punkte(wert, woerter)} ${woerter[wert]}`
    : '<span class="leise">nicht bewertet</span>';
}

// Zeilen des Vergleichs. „besser“ sagt, welcher Wert hervorgehoben wird.
const VERGLEICH_ZEILEN = [
  { name: 'Risiko', html: e => e.hazard ? risikoMarken(e.hazard) : STRICH },
  { name: 'Art', html: e => textOderStrich(e.art) },
  { name: 'Für wen', html: e => e.akteure ? esc(zielgruppen(e.akteure).join(', ')) : STRICH },
  { name: 'Kosten', key: 'kosten', besser: 'niedrig',
    html: e => e.kosten && KOSTEN[e.kosten]
      ? `${geld(e.kosten)} <span class="leise">${KOSTEN[e.kosten]}</span>`
      : '<span class="leise">nicht angegeben</span>' },
  { name: 'Dauer', key: 'dauer', besser: 'niedrig',
    html: e => e.dauer && DAUER[e.dauer] ? stufeText(e.dauer, DAUER) : '<span class="leise">nicht angegeben</span>' },
  { gruppe: 'Wirkung' },
  ...WIRKUNGEN.map(w => ({ name: w.name, erklaerung: w.erklaerung, key: w.key, besser: 'hoch',
    html: e => stufeText(e[w.key], STUFE) })),
  { name: 'Steckbrief', html: e => {
    const a = steckbriefAdresse(e.steckbrief);
    return a ? `<a class="steckbrief" href="${esc(a)}" target="_blank" rel="noopener">PDF öffnen</a>` : STRICH;
  } },
];

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
  const zeilen = VERGLEICH_ZEILEN.map(z => {
    if (z.gruppe) return `<tr class="vgl-gruppe"><th scope="rowgroup" colspan="${liste.length + 1}">${z.gruppe}</th></tr>`;
    const beste = besteSpalten(z, liste);
    return `<tr><th scope="row">${z.name}` +
      (z.erklaerung ? `<span class="vgl-erklaerung">${z.erklaerung}</span>` : '') + `</th>` +
      liste.map((e, i) => `<td${beste.has(i) ? ' class="beste"' : ''}>${z.html(e)}</td>`).join('') + `</tr>`;
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
  document.getElementById('merk-text').textContent = n === 0 ? 'Nichts gemerkt' : `★ ${n} gemerkt`;

  const nur = document.getElementById('merk-nur');
  nur.hidden = zustand.vergleich;
  nur.setAttribute('aria-pressed', zustand.nurMerkliste);

  const vgl = document.getElementById('merk-vergleich');
  if (zustand.vergleich) {
    vgl.textContent = '← Zurück zur Liste';
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
  fa.textContent = anzahl;

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
  document.getElementById('druck-stand').textContent = `Stand ${heute} · ${location.href}`;
}

// Im Ausdruck alle Bewertungen zeigen, danach wieder zuklappen wie vorher.
let vorDruckOffen = [];
window.addEventListener('beforeprint', () => {
  druckkopfFuellen();
  vorDruckOffen = [...document.querySelectorAll('details.alle-wirkungen')].map(d => d.open);
  document.querySelectorAll('details.alle-wirkungen').forEach(d => { d.open = true; });
});
window.addEventListener('afterprint', () => {
  document.querySelectorAll('details.alle-wirkungen').forEach((d, i) => { d.open = !!vorDruckOffen[i]; });
});

function alsCsv() {
  const treffer = zustand.vergleich ? vergleichsListe().slice(0, MAX_VERGLEICH) : sortieren(gefiltert());
  const kopf = ['Maßnahme', 'Hazard', 'Art', 'Akteure', 'Kosten', 'Umsetzungsdauer',
                'Wirksamkeit - Rückhalt', 'Wirksamkeit - Ableitung',
                'Wirksamkeit - Versickerung', 'Wirksamkeit - Kühlung',
                'Aufwertung Stadtstruktur', 'Steckbrief'];
  const zeilen = [kopf].concat(treffer.map(e => SPALTEN.map(s =>
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

function verdrahten() {
  document.querySelectorAll('.filter input[type="checkbox"]')
    .forEach(k => k.addEventListener('change', zeichnen));
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
    b.addEventListener('click', () => { zustand.ansicht = b.dataset.ansicht; zeichnen(); }));
  document.querySelectorAll('thead th[data-sort]').forEach(th => {
    th.tabIndex = 0;
    const sortieren = () => {
      const feld = th.dataset.sort;
      zustand.sortierung = { feld, auf: zustand.sortierung.feld === feld ? !zustand.sortierung.auf : true };
      zeichnen();
    };
    th.addEventListener('click', sortieren);
    th.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); sortieren(); } });
  });

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

async function starten() {
  merklisteLaden();
  adresseLesen();
  verdrahten();
  filterModusSetzen();
  try {
    // no-cache: beim Server nachfragen, ob es einen neueren Stand gibt.
    // Sonst saehe man nach dem Veroeffentlichen bis zu zehn Minuten lang
    // die alte Tabelle; ist sie unveraendert, antwortet der Server knapp.
    const antwort = await fetch(DATEI, { cache: 'no-cache' });
    if (!antwort.ok) throw new Error(`${antwort.status} ${antwort.statusText}`);
    alle = einlesen(await antwort.text());
    // Was auf der Merkliste steht, aber nicht mehr in der Tabelle, faellt
    // stillschweigend heraus -- sonst zaehlte der Knopf Unsichtbares mit.
    const da = new Set(alle.map(e => e.id));
    zustand.merkliste = new Set([...zustand.merkliste].filter(id => da.has(id)));
    zeichnen();
  } catch (fehler) {
    document.getElementById('zaehler').textContent =
      'Die Maßnahmen konnten nicht geladen werden: ' + fehler.message;
  }
}

starten();
