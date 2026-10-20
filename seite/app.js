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

const STUFE = { '1': 'gering', '2': 'mittel', '3': 'hoch' };
const DAUER = { '1': 'kurz', '2': 'mittel', '3': 'lang' };

let alle = [];
let sortierung = { feld: null, auf: true };

// ---------------------------------------------------------------- CSV lesen

function einlesen(text) {
  const zeilen = csvZerlegen(text);
  return zeilen.slice(1)
    .filter(z => z.some(w => w && w.trim()))
    .map(z => {
      const eintrag = {};
      SPALTEN.forEach((s, i) => { eintrag[s] = (z[i] || '').trim(); });
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

function punkte(wert, beschriftung) {
  const n = parseInt(wert, 10);
  if (!wert || isNaN(n)) return '<span class="fehlt" title="keine Angabe">–</span>';
  if (n === 0) return '<span class="fehlt" title="keine">0</span>';
  const voll = '●'.repeat(n), leer = '○'.repeat(3 - n);
  const text = (beschriftung && beschriftung[wert]) || wert;
  return `<span class="punkte" title="${text}" aria-label="${text}">` +
         `<span class="punkt-voll">${voll}</span>` +
         `<span class="punkt-leer">${leer}</span></span>`;
}

function geld(wert) {
  const n = parseInt(wert, 10);
  if (!wert || isNaN(n) || n < 1) return '<span class="fehlt" title="keine Angabe">–</span>';
  const texte = { 1: 'bis 20.000 €', 2: '20.000 bis 100.000 €', 3: 'über 100.000 €' };
  return `<span class="geld" title="${texte[n]}" aria-label="${texte[n]}">${'€'.repeat(n)}</span>`;
}

const ZIELGRUPPE = { K: 'Kommunen', U: 'Unternehmen', P: 'Haushalte' };

function zielgruppe(wert) {
  if (!wert) return '<span class="fehlt">–</span>';
  return wert.split('').map(b => `<span class="marke">${esc(ZIELGRUPPE[b] || b)}</span>`).join(' ');
}

function textOderStrich(wert) {
  return wert ? esc(wert) : '<span class="fehlt" title="keine Angabe">–</span>';
}

/** Ein Steckbrief ist entweder ein Dateiname im Ordner steckbriefe/ oder ein
 *  vollstaendiger Link auf eine Datei anderswo. Andere Adressarten (etwa
 *  javascript:) werden nicht verlinkt. */
function steckbrief(eintrag) {
  const wert = eintrag.steckbrief;
  if (!wert) return '<span class="fehlt">–</span>';
  let pfad;
  if (/^https?:\/\//i.test(wert)) pfad = wert;
  else if (/^[^/\\:]+$/.test(wert)) pfad = 'steckbriefe/' + encodeURIComponent(wert);
  else return '<span class="fehlt">–</span>';
  return `<a class="steckbrief" href="${esc(pfad)}" target="_blank" rel="noopener">PDF öffnen</a>`;
}

function zeileBauen(e) {
  const tr = document.createElement('tr');
  tr.innerHTML =
    `<td>${esc(e.name)}</td>` +
    `<td>${textOderStrich(e.hazard)}</td>` +
    `<td>${textOderStrich(e.art)}</td>` +
    `<td>${zielgruppe(e.akteure)}</td>` +
    `<td>${geld(e.kosten)}</td>` +
    `<td>${punkte(e.dauer, DAUER)}</td>` +
    `<td>${punkte(e.rueckhalt, STUFE)}</td>` +
    `<td>${punkte(e.ableitung, STUFE)}</td>` +
    `<td>${punkte(e.versickerung, STUFE)}</td>` +
    `<td>${punkte(e.kuehlung, STUFE)}</td>` +
    `<td>${punkte(e.aufwertung, STUFE)}</td>` +
    `<td>${steckbrief(e)}</td>`;
  return tr;
}

// ------------------------------------------------------------------ Filtern

function gewaehlt(feld) {
  const kaesten = document.querySelectorAll(
    `fieldset[data-feld="${feld}"] input:checked`);
  return [...kaesten].map(k => k.value);
}

function passtRisiko(e, wahl) {
  if (!wahl.length) return true;
  const h = e.hazard;
  return wahl.some(w => {
    if (w === 'Hitze+Starkregen') return h.includes('Hitze') && h.includes('Starkregen');
    return h.includes(w);
  });
}

function passtZielgruppe(e, wahl) {
  return !wahl.length || wahl.some(w => e.akteure.includes(w));
}

function gefiltert() {
  const risiko = gewaehlt('risiko');
  const art = gewaehlt('art');
  const kosten = gewaehlt('kosten');
  const ziel = gewaehlt('zielgruppe');
  const suche = document.getElementById('suchfeld').value.trim().toLowerCase();

  return alle.filter(e =>
    passtRisiko(e, risiko) &&
    (!art.length || art.includes(e.art)) &&
    (!kosten.length || kosten.includes(e.kosten)) &&
    passtZielgruppe(e, ziel) &&
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

// ---------------------------------------------------------------- Sortieren

function sortieren(liste) {
  if (!sortierung.feld) return liste;
  const f = sortierung.feld, richtung = sortierung.auf ? 1 : -1;
  const zahlfeld = !['name', 'hazard', 'art', 'akteure'].includes(f);
  return [...liste].sort((a, b) => {
    let x = a[f], y = b[f];
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

// ----------------------------------------------------------------- Zeichnen

function zeichnen() {
  const treffer = sortieren(gefiltert());
  const koerper = document.getElementById('koerper');
  koerper.replaceChildren(...treffer.map(zeileBauen));

  document.getElementById('zaehler').textContent =
    treffer.length === alle.length
      ? `Alle ${alle.length} Maßnahmen`
      : `${treffer.length} von ${alle.length} Maßnahmen`;

  document.getElementById('leer').hidden = treffer.length > 0;

  const luecken = wegenLuecke();
  const hinweis = document.getElementById('ausgeblendet');
  hinweis.hidden = luecken === 0;
  if (luecken) {
    hinweis.textContent =
      `${luecken} Maßnahme${luecken === 1 ? '' : 'n'} ` +
      `${luecken === 1 ? 'ist' : 'sind'} hier nicht dabei, weil die gefilterte ` +
      `Angabe dort fehlt — nicht, weil ${luecken === 1 ? 'sie nicht passt' : 'sie nicht passen'}.`;
  }
  hoeheMelden();
}

// ---------------------------------------------------------- Herunterladen

function alsCsv() {
  const treffer = sortieren(gefiltert());
  const kopf = ['Maßnahme', 'Hazard', 'Art', 'Akteure', 'Kosten', 'Umsetzungsdauer',
                'Wirksamkeit - Rückhalt', 'Wirksamkeit - Ableitung',
                'Wirksamkeit - Versickerung', 'Wirksamkeit - Kühlung',
                'Aufwertung Stadtstruktur'];
  const zeilen = [kopf].concat(treffer.map(e => SPALTEN.slice(0, 11).map(s => e[s])));
  const klecks = new Blob([csvText(zeilen)], { type: 'text/csv;charset=utf-8' });
  const adresse = URL.createObjectURL(klecks);
  const a = document.createElement('a');
  const heute = new Date().toISOString().slice(0, 10);
  a.href = adresse;
  a.download = `${heute} Massnahmenauswahl.csv`;
  a.click();
  URL.revokeObjectURL(adresse);
}

// -------------------------------------------------------------------- Start

function verdrahten() {
  document.querySelectorAll('.filter input[type="checkbox"]')
    .forEach(k => k.addEventListener('change', zeichnen));
  document.getElementById('suchfeld').addEventListener('input', zeichnen);
  document.getElementById('herunterladen').addEventListener('click', alsCsv);

  document.getElementById('zuruecksetzen').addEventListener('click', () => {
    document.querySelectorAll('.filter input[type="checkbox"]')
      .forEach(k => { k.checked = false; });
    document.getElementById('suchfeld').value = '';
    zeichnen();
  });

  document.querySelectorAll('thead th[data-sort]').forEach(th => {
    th.addEventListener('click', () => {
      const feld = th.dataset.sort;
      sortierung = { feld, auf: sortierung.feld === feld ? !sortierung.auf : true };
      document.querySelectorAll('thead th').forEach(x => x.removeAttribute('aria-sort'));
      th.setAttribute('aria-sort', sortierung.auf ? 'ascending' : 'descending');
      zeichnen();
    });
  });
}

async function starten() {
  try {
    const antwort = await fetch(DATEI);
    if (!antwort.ok) throw new Error(`${antwort.status} ${antwort.statusText}`);
    alle = einlesen(await antwort.text());
    verdrahten();
    zeichnen();
  } catch (fehler) {
    document.getElementById('zaehler').textContent =
      'Die Maßnahmen konnten nicht geladen werden: ' + fehler.message;
  }
}

/** Eingebettet als iframe: der umgebenden Seite die eigene Hoehe melden,
 *  damit der iframe mitwaechst statt eine zweite Bildlaufleiste zu zeigen.
 *  Die Hoehe ist keine vertrauliche Angabe, deshalb an jeden Empfaenger.
 *  Gemeldet wird nach jedem Zeichnen und zusaetzlich bei Groessenaenderung
 *  (Schrift geladen, Fenster schmaler, Hinweise auf- und zugeklappt). */
let zuletztGemeldet = 0;
function hoeheMelden() {
  if (window.parent === window) return;
  // Hoehe des Inhalts, nicht scrollHeight: das waere nie kleiner als der
  // iframe selbst, und nach dem Filtern schrumpfte der Rahmen nicht mehr.
  const hoehe = Math.ceil(document.body.getBoundingClientRect().height);
  if (hoehe === zuletztGemeldet) return;
  zuletztGemeldet = hoehe;
  window.parent.postMessage({ typ: 'kare-hoehe', hoehe }, '*');
}

if (window.parent !== window) {
  new ResizeObserver(hoeheMelden).observe(document.body);
  window.addEventListener('load', hoeheMelden);
}
starten();
