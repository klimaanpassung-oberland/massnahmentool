'use strict';

// Pflegeseite: Excel-Tabelle hochladen, pruefen, mit dem veroeffentlichten
// Stand vergleichen und -- zusammen mit neuen Steckbriefen -- als ein Commit
// nach GitHub schreiben. Die Seite selbst bleibt statisch; geschrieben wird
// ueber die GitHub-Schnittstelle mit dem Schluessel der pflegenden Person.

const BESITZER = 'klimaanpassung-oberland';
const REPO = 'massnahmendatenbank';
const ZWEIG = 'main';
const PFAD_DATEN = 'daten/massnahmen.csv';
const ORDNER_PDF = 'steckbriefe';
const API = `https://api.github.com/repos/${BESITZER}/${REPO}`;
const REPO_URL = `https://github.com/${BESITZER}/${REPO}`;

// Die Spalten in der Reihenfolge der CSV. Die Schluessel sind dieselben wie in
// app.js. 'auch' sind weitere Ueberschriften, unter denen eine Spalte erkannt
// wird -- etwa aus der Beschriftung auf der Seite.
const RISIKEN = ['Hitze', 'Starkregen', 'Hitze & Starkregen', 'Dürre & Starkregen'];
const ARTEN = ['baulich', 'planerisch', 'administrativ', 'Information', 'Anreizsystem'];
const FELDER = [
  { key: 'name', kopf: 'Maßnahme', typ: 'text', breite: 48, auch: ['Massnahme', 'Name'] },
  { key: 'hazard', kopf: 'Hazard', typ: 'text', breite: 20, auch: ['Risiko', 'Lokales Risiko'], liste: RISIKEN },
  { key: 'art', kopf: 'Art', typ: 'text', breite: 15, auch: ['Art der Maßnahme'], liste: ARTEN },
  { key: 'akteure', kopf: 'Akteure', typ: 'akteure', breite: 10, auch: ['Zielgruppe'] },
  { key: 'kosten', kopf: 'Kosten', typ: 'stufe', min: 1, breite: 9, auch: ['Investitionshöhe'] },
  { key: 'dauer', kopf: 'Umsetzungsdauer', typ: 'stufe', min: 0, breite: 11, auch: ['Dauer'] },
  { key: 'rueckhalt', kopf: 'Wirksamkeit - Rückhalt', typ: 'stufe', min: 0, breite: 11, auch: ['Rückhalt'] },
  { key: 'ableitung', kopf: 'Wirksamkeit - Ableitung', typ: 'stufe', min: 0, breite: 11, auch: ['Ableitung'] },
  { key: 'versickerung', kopf: 'Wirksamkeit - Versickerung', typ: 'stufe', min: 0, breite: 11, auch: ['Versickerung'] },
  { key: 'kuehlung', kopf: 'Wirksamkeit - Kühlung', typ: 'stufe', min: 0, breite: 11, auch: ['Kühlung'] },
  { key: 'aufwertung', kopf: 'Aufwertung Stadtstruktur', typ: 'stufe', min: 0, breite: 12, auch: ['Stadtstruktur', 'Aufwertung'] },
  { key: 'steckbrief', kopf: 'Steckbrief', typ: 'steckbrief', breite: 40, auch: ['Steckbrief (PDF)', 'PDF', 'Link'] },
];

// ------------------------------------------------------------------ Zustand

const zustand = {
  schluessel: '',
  verbunden: false,
  stand: null,          // { text, eintraege } -- was jetzt veroeffentlicht ist
  bestandPdf: null,     // Set der Dateinamen in steckbriefe/, null = unbekannt
  neu: null,            // { eintraege, meldungen, datei, csv }
  pdfs: new Map(),      // Dateiname -> File, noch nicht veroeffentlicht
  nachrichtVonHand: false,
};

// ------------------------------------------------------------------ Helfer

const $ = id => document.getElementById(id);

function el(tag, eigenschaften, ...kinder) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(eigenschaften || {})) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v);
  }
  for (const k of kinder.flat()) if (k !== null && k !== undefined && k !== false)
    e.append(k instanceof Node ? k : String(k));
  return e;
}

function status(id, text, art) {
  const e = $(id);
  e.textContent = text;
  e.dataset.art = art || '';
}

const heute = () => new Date().toISOString().slice(0, 10);

function speichern(name, klecks) {
  const adresse = URL.createObjectURL(klecks);
  const a = el('a', { href: adresse, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(adresse), 1000);
}

function groesse(bytes) {
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
}

const normiert = s => String(s).toLowerCase()
  .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
  .replace(/[^a-z0-9]/g, '');

function base64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

// ------------------------------------------------------------------- GitHub

async function api(pfad, optionen = {}) {
  const kopf = {
    Accept: optionen.roh ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (zustand.schluessel) kopf.Authorization = `Bearer ${zustand.schluessel}`;
  if (optionen.daten) kopf['Content-Type'] = 'application/json';
  const adresse = pfad.startsWith('https://') ? pfad : pfad ? `${API}/${pfad}` : API;
  const antwort = await fetch(adresse, {
    method: optionen.methode || 'GET',
    headers: kopf,
    body: optionen.daten ? JSON.stringify(optionen.daten) : undefined,
    cache: 'no-store',
  });
  // Bei Fine-grained Tokens nennt GitHub hier das Ablaufdatum -- sofern der
  // Browser die Angabe herausgibt; sonst bleibt sie eben unbekannt.
  const ablauf = antwort.headers.get('github-authentication-token-expiration');
  if (ablauf) zustand.ablauf = ablauf;
  if (!antwort.ok) {
    let meldung = antwort.statusText;
    try { meldung = (await antwort.json()).message || meldung; } catch { /* kein JSON */ }
    const f = new Error(meldung);
    f.status = antwort.status;
    throw f;
  }
  if (optionen.roh) return antwort.text();
  return antwort.status === 204 ? null : antwort.json();
}

function apiFehlerText(f) {
  if (f.status === 401) return 'Der Zugangsschlüssel ist ungültig oder abgelaufen.';
  if (f.status === 403) return `GitHub verweigert den Zugriff: ${f.message}. ` +
    'Hat der Schlüssel „Contents: Read and write“, und hat die Organisation ihn freigegeben?';
  if (f.status === 404) return 'Kein Zugriff auf das Repository. Wurde beim Anlegen des ' +
    'Schlüssels „massnahmendatenbank“ ausgewählt?';
  if (f.status === undefined) return `Keine Verbindung zu GitHub (${f.message}).`;
  return `GitHub meldet: ${f.message} (${f.status}).`;
}

// ----------------------------------------------------- Schluessel merken

// „Auf diesem Geraet merken“ legt den Schluessel in localStorage, sonst gilt
// er nur fuer diesen Tab (sessionStorage). localStorage teilen sich alle
// Seiten unter klimaanpassung-oberland.github.io; der Schluessel darf aber
// ohnehin nur Inhalte dieses einen Repositorys schreiben.
const SPEICHER = 'kare-schluessel';

function schluesselLesen() {
  try {
    const dauerhaft = localStorage.getItem(SPEICHER);
    if (dauerhaft) return { schluessel: dauerhaft, dauerhaft: true };
    const tab = sessionStorage.getItem(SPEICHER);
    if (tab) return { schluessel: tab, dauerhaft: false };
  } catch { /* privates Fenster o. ae. */ }
  return null;
}

function schluesselMerken(schluessel, dauerhaft) {
  try {
    if (dauerhaft) { localStorage.setItem(SPEICHER, schluessel); sessionStorage.removeItem(SPEICHER); }
    else { sessionStorage.setItem(SPEICHER, schluessel); localStorage.removeItem(SPEICHER); }
  } catch { /* dann eben nicht */ }
}

function schluesselVergessen() {
  try { localStorage.removeItem(SPEICHER); sessionStorage.removeItem(SPEICHER); } catch { /* egal */ }
}

/** '2027-10-20 10:00:00 +0200' oder '... UTC' -> Date, sonst null. */
function ablaufDatum(text) {
  if (!text) return null;
  const iso = text.trim().replace(' ', 'T').replace(/ UTC$/, 'Z')
    .replace(/ ([+-]\d\d)(\d\d)$/, '$1:$2');
  const d = new Date(iso);
  return isNaN(d) ? null : d;
}

function verbindungAnzeigen(verbunden) {
  $('verbinden').hidden = verbunden;
  $('abmelden-zeile').hidden = !verbunden;
}

async function verbinden(schluessel, { gespeichert = false } = {}) {
  zustand.schluessel = schluessel.trim();
  zustand.ablauf = null;
  status('verbindung', gespeichert ? 'Verbinde mit dem gemerkten Schlüssel …' : 'Verbinde …');
  try {
    const repo = await api('');
    let wer = '';
    try { wer = (await api('https://api.github.com/user')).login; } catch { /* egal */ }
    zustand.verbunden = true;
    const recht = repo.permissions && repo.permissions.push === false
      ? ' — aber ohne Schreibrecht. Veröffentlichen wird nicht gehen.' : '.';

    let gueltig = '', art = recht === '.' ? 'gut' : 'warnung';
    const ablauf = ablaufDatum(zustand.ablauf);
    if (ablauf) {
      const tage = Math.floor((ablauf - Date.now()) / 86400000);
      gueltig = ` Schlüssel gültig bis ${ablauf.toLocaleDateString('de-DE')}`;
      if (tage <= 14) {
        gueltig += ` — läuft in ${tage <= 0 ? 'weniger als einem Tag' : tage === 1 ? 'einem Tag' : tage + ' Tagen'} ab. ` +
          'Bitte rechtzeitig einen neuen anlegen.';
        art = 'warnung';
      } else gueltig += '.';
    }
    status('verbindung', `Verbunden${wer ? ' als ' + wer : ''} mit ${repo.full_name}${recht}${gueltig}`, art);
    if (!gespeichert) schluesselMerken(zustand.schluessel, $('merken').checked);
    $('schluessel').value = '';
    verbindungAnzeigen(true);
  } catch (f) {
    zustand.verbunden = false;
    zustand.schluessel = '';
    // Abgelaufen oder widerrufen: vergessen, sonst scheitert jedes Oeffnen
    // erneut. Bei einem Netzfehler dagegen behalten.
    if (gespeichert && (f.status === 401 || f.status === 403)) {
      schluesselVergessen();
      status('verbindung', 'Der gemerkte Schlüssel gilt nicht mehr — vermutlich abgelaufen. ' +
        'Bitte einen neuen anlegen und eintragen (Anleitung unten).', 'fehler');
    } else {
      status('verbindung', apiFehlerText(f), 'fehler');
    }
    verbindungAnzeigen(false);
  }
  await standLaden();
}

async function abmelden() {
  schluesselVergessen();
  zustand.schluessel = '';
  zustand.verbunden = false;
  zustand.ablauf = null;
  verbindungAnzeigen(false);
  status('verbindung', 'Abgemeldet. Der Schlüssel ist auf diesem Gerät nicht mehr gespeichert.', 'leise');
  $('verlauf').replaceChildren(el('p', { class: 'leise' }, 'Sichtbar nach dem Verbinden in Schritt 1.'));
  $('verlauf-mehr').hidden = true;
  await standLaden();
}

/** Laedt, was gerade veroeffentlicht ist: zum Vergleich, fuer die Vorlage und
 *  um zu wissen, welche Steckbriefe schon da sind. */
async function standLaden() {
  zustand.stand = null;
  zustand.bestandPdf = null;
  try {
    let text;
    if (zustand.verbunden) {
      text = await api(`contents/${PFAD_DATEN}?ref=${ZWEIG}`, { roh: true });
    } else {
      // Ohne Schluessel geht es nur, wenn die Seite von dort geladen wurde,
      // wo auch die Daten liegen (GitHub Pages oder oertliche Vorschau).
      const antwort = await fetch(PFAD_DATEN, { cache: 'no-store' });
      if (!antwort.ok) throw new Error(antwort.statusText);
      text = await antwort.text();
    }
    // Vergleichbar machen mit dem, was csvBauen erzeugt: fetch().text()
    // entfernt das Kennzeichen am Anfang, die Arbeitskopie hat CRLF.
    text = '﻿' + text.replace(/^﻿/, '').replace(/\r\n/g, '\n');
    zustand.stand = { text, eintraege: csvEinlesen(text) };
  } catch { /* bleibt unbekannt */ }

  if (zustand.verbunden) {
    try {
      const liste = await api(`contents/${ORDNER_PDF}?ref=${ZWEIG}`);
      zustand.bestandPdf = new Set(liste.filter(d => d.type === 'file').map(d => d.name));
    } catch (f) {
      if (f.status === 404) zustand.bestandPdf = new Set();   // Ordner gibt es noch nicht
    }
  }

  const s = zustand.stand;
  $('vorlage').disabled = !s;
  $('pdf-bestand').textContent = zustand.bestandPdf
    ? `Im Ordner ${ORDNER_PDF}/ liegen ${zustand.bestandPdf.size} Steckbriefe.`
    : 'Welche Steckbriefe schon im Repository liegen, ist erst nach dem Verbinden bekannt.';
  if (!s && !zustand.verbunden) {
    status('tabelle-status', 'Der veröffentlichte Stand ist ohne Verbindung nicht lesbar — ' +
      'Vorlage und Vergleich gibt es erst nach Schritt 1.', 'leise');
  } else if (!s) {
    status('tabelle-status', `${PFAD_DATEN} konnte nicht geladen werden.`, 'fehler');
  } else if (!zustand.neu) {
    status('tabelle-status', `Veröffentlicht sind derzeit ${s.eintraege.length} Maßnahmen.`, 'leise');
  }
  if (zustand.neu) pruefen();
  zeichnen();
  verlaufLaden();
}

// ------------------------------------------------------------ CSV <-> Daten

function csvEinlesen(text) {
  return csvZerlegen(text).slice(1)
    .filter(z => z.some(w => w && w.trim()))
    .map(z => {
      const e = {};
      FELDER.forEach((f, i) => { e[f.key] = (z[i] || '').trim(); });
      return e;
    });
}

function csvBauen(eintraege) {
  return csvText([FELDER.map(f => f.kopf)]
    .concat(eintraege.map(e => FELDER.map(f => e[f.key]))), '\n');
}

// ------------------------------------------------------------ Datei lesen

async function tabelleLesen(datei) {
  const name = datei.name.toLowerCase();
  if (name.endsWith('.xls')) {
    throw new Error('Das alte Format .xls lässt sich nicht lesen. Bitte in Excel ' +
      '„Speichern unter“ → „Excel-Arbeitsmappe (.xlsx)“ wählen.');
  }
  if (name.endsWith('.csv')) {
    const bytes = new Uint8Array(await datei.arrayBuffer());
    let text = new TextDecoder('utf-8').decode(bytes);
    // Excel speichert „CSV (Trennzeichen-getrennt)“ in Windows-1252.
    if (text.includes('�')) text = new TextDecoder('windows-1252').decode(bytes);
    const erste = text.split('\n')[0];
    const trenner = (erste.match(/;/g) || []).length >= (erste.match(/,/g) || []).length ? ';' : ',';
    return { blatt: null, zeilen: csvZerlegen(text, trenner).map((werte, i) => ({ nr: i + 1, werte, links: [] })) };
  }
  return Xlsx.lesen(await datei.arrayBuffer(), namen => {
    const i = namen.findIndex(n => /ma(ß|ss)nahmen/i.test(n));
    return i >= 0 ? i : 0;
  });
}

/** Ordnet die Ueberschriften den bekannten Spalten zu. Reihenfolge und
 *  Schreibweise duerfen abweichen. */
function spaltenZuordnen(kopfzeile) {
  const zuordnung = {}, unbekannt = [];
  kopfzeile.forEach((titel, i) => {
    if (!titel || !titel.trim()) return;
    const n = normiert(titel);
    const feld = FELDER.find(f => [f.kopf, ...f.auch].some(t => normiert(t) === n));
    if (feld && zuordnung[feld.key] === undefined) zuordnung[feld.key] = i;
    else unbekannt.push(titel.trim());
  });
  return { zuordnung, unbekannt };
}

// ----------------------------------------------------------------- Pruefen

const AKTEURE = { K: 'Kommunen', U: 'Unternehmen', P: 'Haushalte' };

// Ab so vielen wegfallenden Massnahmen fragt die Seite vor dem Veroeffentlichen nach.
const BESTAETIGEN_AB = 3;

/** Prueft und bereinigt einen Wert. Gibt { wert, fehler?, warnung? } zurueck. */
function wertPruefen(feld, roh, link) {
  let wert = String(roh ?? '').replace(/\s+/g, ' ').trim();

  if (feld.typ === 'stufe') {
    if (wert === '') return { wert };
    const z = wert.replace(',', '.');
    if (!/^\d+(\.0+)?$/.test(z)) return { wert, fehler: `„${wert}“ ist keine Zahl` };
    const n = parseInt(z, 10);
    if (n < feld.min || n > 3) return { wert, fehler: `${n} liegt nicht zwischen ${feld.min} und 3` };
    return { wert: String(n) };
  }

  if (feld.typ === 'akteure') {
    const buchstaben = wert.toUpperCase().replace(/[\s,;/+&-]/g, '');
    const falsch = [...buchstaben].filter(b => !AKTEURE[b]);
    if (falsch.length) return { wert, fehler: `„${wert}“ — erlaubt sind nur K, U und P` };
    return { wert: ['K', 'U', 'P'].filter(b => buchstaben.includes(b)).join('') };
  }

  if (feld.typ === 'steckbrief') {
    if (link) wert = link.trim();
    if (wert === '') return { wert };
    if (/^https?:\/\//i.test(wert)) {
      try { new URL(wert); } catch { return { wert, fehler: `„${wert}“ ist kein gültiger Link` }; }
      return /^http:/i.test(wert)
        ? { wert, warnung: `Link ohne https — manche Browser blockieren den Download` }
        : { wert };
    }
    wert = wert.replace(/^\.?\/?steckbriefe\//i, '');
    if (/[/\\:]/.test(wert) || wert.startsWith('.'))
      return { wert, fehler: `„${wert}“ — erwartet wird ein Dateiname wie „Gruendach.pdf“ oder ein https-Link` };
    if (!/\.pdf$/i.test(wert)) return { wert, fehler: `„${wert}“ endet nicht auf .pdf` };
    return { wert };
  }

  return { wert };
}

function pruefen() {
  const neu = zustand.neu;
  const { roh } = neu;
  const meldungen = [];
  const melde = (art, text, zeile) => meldungen.push({ art, text, zeile });

  const kopfIndex = roh.zeilen.findIndex(z => z.werte.some(w => w && String(w).trim()));
  if (kopfIndex < 0) {
    melde('fehler', 'Die Tabelle ist leer.');
    neu.eintraege = [];
    neu.meldungen = meldungen;
    return;
  }
  const { zuordnung, unbekannt } = spaltenZuordnen(roh.zeilen[kopfIndex].werte);
  const fehlend = FELDER.filter(f => zuordnung[f.key] === undefined);
  if (fehlend.length) {
    melde('fehler', `Es fehlen Spalten: ${fehlend.map(f => '„' + f.kopf + '“').join(', ')}. ` +
      'Am sichersten mit „Aktuellen Stand als Excel herunterladen“ beginnen — dort sind alle Spalten angelegt.');
  }
  if (unbekannt.length) {
    melde('hinweis', `Diese Spalten kennt die Seite nicht, sie werden nicht übernommen: ${unbekannt.join(', ')}.`);
  }

  const eintraege = [];
  const gesehen = new Map();
  for (const zeile of roh.zeilen.slice(kopfIndex + 1)) {
    if (!zeile.werte.some(w => w && String(w).trim())) continue;
    const e = { _zeile: zeile.nr };
    for (const f of FELDER) {
      const i = zuordnung[f.key];
      const r = wertPruefen(f, i === undefined ? '' : zeile.werte[i], i === undefined ? '' : zeile.links[i]);
      e[f.key] = r.wert;
      if (r.fehler) melde('fehler', `${f.kopf}: ${r.fehler}`, zeile.nr);
      if (r.warnung) melde('warnung', `${f.kopf}: ${r.warnung}`, zeile.nr);
    }
    if (!e.name) { melde('fehler', 'Der Name der Maßnahme fehlt.', zeile.nr); continue; }
    if (gesehen.has(e.name)) {
      melde('fehler', `„${e.name}“ steht doppelt in der Tabelle (auch in Zeile ${gesehen.get(e.name)}).`, zeile.nr);
      continue;
    }
    gesehen.set(e.name, zeile.nr);

    if (e.hazard && !RISIKEN.includes(e.hazard)) {
      const findbar = /hitze|starkregen/i.test(e.hazard);
      melde('warnung', `Risiko „${e.hazard}“ ist neu.` + (findbar ? '' :
        ' Über den Risiko-Filter ist die Maßnahme nicht zu finden — die Seite filtert nur nach Hitze und Starkregen.'), zeile.nr);
    }
    if (e.art && !ARTEN.includes(e.art)) {
      melde('warnung', `Art „${e.art}“ kennt die Seite nicht. Über den Art-Filter ist die Maßnahme ` +
        `nicht zu finden. Bekannt sind: ${ARTEN.join(', ')}.`, zeile.nr);
    }
    eintraege.push(e);
  }

  const ohne = (key, was) => {
    const n = eintraege.filter(e => !e[key]).length;
    if (n) melde('hinweis', `${n} Maßnahme${n === 1 ? '' : 'n'} ohne ${was} — sie fallen heraus, ` +
      `sobald jemand danach filtert (die Seite weist darauf hin).`);
  };
  ohne('hazard', 'Risiko');
  ohne('art', 'Art');

  // Eine Tabelle ohne Massnahmen ist fast immer ein Versehen -- etwa das
  // falsche Blatt oder eine leer gespeicherte Datei. Veroeffentlicht leerte
  // sie die ganze Seite.
  if (!eintraege.length && !meldungen.some(m => m.art === 'fehler')) {
    melde('fehler', 'Die Tabelle enthält keine einzige Maßnahme. Ist das richtige Blatt ' +
      'ausgewählt und die Datei gespeichert? Eine leere Tabelle wird nicht veröffentlicht.');
  }

  neu.eintraege = eintraege;
  neu.meldungen = meldungen;
  steckbriefePruefen();
  neu.csv = neu.meldungen.some(m => m.art === 'fehler') ? null : csvBauen(eintraege);
}

/** Gleicht die Spalte Steckbrief mit den vorhandenen und den gerade
 *  hochgeladenen PDF-Dateien ab. Getrennt, weil es bei jedem neuen PDF
 *  noch einmal laeuft. */
function steckbriefePruefen() {
  const neu = zustand.neu;
  if (!neu || !neu.eintraege) return;
  neu.meldungen = neu.meldungen.filter(m => !m.steckbrief);
  const vorhanden = new Set([...(zustand.bestandPdf || []), ...zustand.pdfs.keys()]);
  const klein = new Map([...vorhanden].map(n => [n.toLowerCase(), n]));
  for (const e of neu.eintraege) {
    const s = e.steckbrief;
    if (!s || /^https?:/i.test(s) || !/\.pdf$/i.test(s)) continue;
    if (vorhanden.has(s)) continue;
    if (!zustand.bestandPdf && !zustand.pdfs.size) continue;    // unbekannt, nicht pruefbar
    const aehnlich = klein.get(s.toLowerCase());
    neu.meldungen.push({
      art: 'warnung', zeile: e._zeile, steckbrief: true,
      text: aehnlich
        ? `Steckbrief „${s}“: Es gibt nur „${aehnlich}“ — die Groß- und Kleinschreibung muss übereinstimmen.`
        : `Steckbrief „${s}“ liegt nicht im Ordner ${ORDNER_PDF}/ — bitte in Schritt 3 hochladen, sonst führt der Link ins Leere.`,
    });
  }
}

// --------------------------------------------------------------- Vergleich

function vergleichen() {
  const alt = zustand.stand ? zustand.stand.eintraege : null;
  const neu = zustand.neu && zustand.neu.csv ? zustand.neu.eintraege : null;
  if (!alt || !neu) return null;
  const altNachName = new Map(alt.map(e => [e.name, e]));
  const neuNamen = new Set(neu.map(e => e.name));
  const ergebnis = { neu: [], geaendert: [], entfernt: [], gleich: 0 };
  for (const e of neu) {
    const a = altNachName.get(e.name);
    if (!a) { ergebnis.neu.push(e); continue; }
    const felder = FELDER.filter(f => f.key !== 'name' && (a[f.key] || '') !== (e[f.key] || ''))
      .map(f => ({ kopf: f.kopf, alt: a[f.key], neu: e[f.key] }));
    if (felder.length) ergebnis.geaendert.push({ name: e.name, felder });
    else ergebnis.gleich++;
  }
  ergebnis.entfernt = alt.filter(e => !neuNamen.has(e.name));
  ergebnis.nurReihenfolge = !ergebnis.neu.length && !ergebnis.geaendert.length &&
    !ergebnis.entfernt.length && zustand.neu.csv !== zustand.stand.text;
  return ergebnis;
}

function csvGeaendert() {
  return !!(zustand.neu && zustand.neu.csv &&
            (!zustand.stand || zustand.neu.csv !== zustand.stand.text));
}

function nachrichtVorschlagen(v) {
  const teile = [];
  if (v) {
    if (v.neu.length) teile.push(`${v.neu.length} neu`);
    if (v.geaendert.length) teile.push(`${v.geaendert.length} geaendert`);
    if (v.entfernt.length) teile.push(`${v.entfernt.length} entfernt`);
    if (v.nurReihenfolge) teile.push('Reihenfolge');
  } else if (csvGeaendert()) teile.push('Tabelle ersetzt');
  const pdf = zustand.pdfs.size;
  let text = teile.length ? `Massnahmen aktualisiert: ${teile.join(', ')}` : '';
  if (pdf) text += (text ? '; ' : '') + `${pdf} Steckbrief${pdf === 1 ? '' : 'e'} hochgeladen`;
  return text;
}

// ---------------------------------------------------------------- Zeichnen

const ART_TITEL = { fehler: 'Fehler', warnung: 'Bitte prüfen', hinweis: 'Hinweise' };

function meldungenZeichnen() {
  const ziel = $('pruefung');
  const neu = zustand.neu;
  if (!neu) {
    ziel.replaceChildren(el('p', { class: 'leise' }, 'Noch keine Tabelle hochgeladen.'));
    return;
  }
  const kinder = [];
  const fehler = neu.meldungen.filter(m => m.art === 'fehler').length;
  kinder.push(el('p', { class: 'zusammenfassung', 'data-art': fehler ? 'fehler' : 'gut' },
    fehler
      ? `${fehler} Fehler in „${neu.datei}“ — so kann die Tabelle nicht veröffentlicht werden.`
      : `„${neu.datei}“${neu.blatt ? ` (Blatt „${neu.blatt}“)` : ''}: ${neu.eintraege.length} Maßnahmen, ohne Fehler.`));

  for (const art of ['fehler', 'warnung', 'hinweis']) {
    const liste = neu.meldungen.filter(m => m.art === art)
      .sort((a, b) => (a.zeile || 0) - (b.zeile || 0));
    if (!liste.length) continue;
    const GRENZE = 25;
    kinder.push(el('div', { class: 'meldungen', 'data-art': art },
      el('h3', {}, `${ART_TITEL[art]} (${liste.length})`),
      el('ul', {}, liste.slice(0, GRENZE).map(m =>
        el('li', {}, m.zeile ? el('span', { class: 'zeilennr' }, `Zeile ${m.zeile}`) : null, m.text))),
      liste.length > GRENZE ? el('p', { class: 'leise' }, `… und ${liste.length - GRENZE} weitere.`) : null));
  }
  ziel.replaceChildren(...kinder);
}

function wert(w) { return w === '' || w === undefined ? '—' : w; }

function aenderungenZeichnen(v) {
  const ziel = $('aenderungen');
  if (!v) {
    ziel.replaceChildren(zustand.neu && zustand.neu.csv && !zustand.stand
      ? el('p', { class: 'leise' }, 'Der veröffentlichte Stand ist nicht bekannt, deshalb kein Vergleich. Nach dem Verbinden erscheint er hier.')
      : '');
    return;
  }
  const kinder = [el('h3', {}, 'Änderungen gegenüber dem veröffentlichten Stand')];
  if (!v.neu.length && !v.geaendert.length && !v.entfernt.length) {
    kinder.push(el('p', {}, v.nurReihenfolge
      ? 'Inhaltlich gleich, nur die Reihenfolge oder Schreibweise in der Datei ist anders.'
      : 'Keine Änderungen an den Maßnahmen.'));
  }
  if (v.neu.length) kinder.push(el('details', { class: 'aenderung', 'data-art': 'neu', open: '' },
    el('summary', {}, `${v.neu.length} neue Maßnahme${v.neu.length === 1 ? '' : 'n'}`),
    el('ul', {}, v.neu.map(e => el('li', {}, e.name)))));
  if (v.geaendert.length) kinder.push(el('details', { class: 'aenderung', 'data-art': 'geaendert', open: '' },
    el('summary', {}, `${v.geaendert.length} geänderte Maßnahme${v.geaendert.length === 1 ? '' : 'n'}`),
    el('ul', {}, v.geaendert.map(g => el('li', {}, el('b', {}, g.name),
      el('ul', {}, g.felder.map(f => el('li', {}, `${f.kopf}: `,
        el('del', {}, wert(f.alt)), ' → ', el('ins', {}, wert(f.neu))))))))));
  if (v.entfernt.length) kinder.push(el('details', { class: 'aenderung', 'data-art': 'entfernt', open: '' },
    el('summary', {}, `${v.entfernt.length} Maßnahme${v.entfernt.length === 1 ? '' : 'n'} nicht mehr in der Tabelle — ` +
      `${v.entfernt.length === 1 ? 'wird' : 'werden'} von der Seite entfernt`),
    el('ul', {}, v.entfernt.map(e => el('li', {}, e.name)))));
  if (v.gleich) kinder.push(el('p', { class: 'leise' }, `${v.gleich} unverändert.`));
  ziel.replaceChildren(...kinder);
}

function pdfsZeichnen() {
  const ziel = $('pdf-liste');
  if (!zustand.pdfs.size) { ziel.replaceChildren(); return; }
  const tabelle = zustand.neu && zustand.neu.eintraege ? zustand.neu.eintraege
                : zustand.stand ? zustand.stand.eintraege : [];
  const zeilen = [...zustand.pdfs.values()].map(datei => {
    const nutzer = tabelle.filter(e => e.steckbrief === datei.name).map(e => e.name);
    const ersetzt = zustand.bestandPdf && zustand.bestandPdf.has(datei.name);
    return el('tr', {},
      el('td', {}, datei.name),
      el('td', { class: 'zahl' }, groesse(datei.size)),
      el('td', {}, ersetzt ? 'ersetzt die vorhandene Datei' : 'neu'),
      el('td', { 'data-art': nutzer.length ? '' : 'warnung' },
        nutzer.length ? nutzer.join(', ') : 'in der Tabelle nirgends eingetragen'),
      el('td', {}, el('button', {
        type: 'button', class: 'knopf-schlicht',
        onclick: () => { zustand.pdfs.delete(datei.name); steckbriefePruefen(); zeichnen(); },
      }, 'entfernen')));
  });
  ziel.replaceChildren(el('table', { class: 'pdf-tabelle' },
    el('thead', {}, el('tr', {}, ['Datei', 'Größe', 'Status', 'Verwendet bei', ''].map(t => el('th', { scope: 'col' }, t)))),
    el('tbody', {}, zeilen)));
}

function zeichnen() {
  if (zustand.neu) {
    const neu = zustand.neu;
    neu.csv = neu.meldungen.some(m => m.art === 'fehler') ? null : csvBauen(neu.eintraege);
  }
  meldungenZeichnen();
  const v = vergleichen();
  aenderungenZeichnen(v);
  pdfsZeichnen();

  const tabelleOk = !zustand.neu || !!zustand.neu.csv;
  const etwasZuTun = csvGeaendert() || zustand.pdfs.size > 0;

  // Fallen mehrere Massnahmen weg, muss man das ausdruecklich wollen. Ein
  // versehentlich gekuerzter Export soll nicht mit einem Klick durchgehen.
  const weg = v ? v.entfernt.length : 0;
  const mussBestaetigen = weg >= BESTAETIGEN_AB;
  $('bestaetigen-zeile').hidden = !mussBestaetigen;
  if (mussBestaetigen) {
    $('bestaetigen-text').textContent =
      `Ja, ${weg} Maßnahmen sollen von der Seite entfernt werden (siehe oben, rot).`;
  } else {
    $('bestaetigen').checked = false;
  }
  const bestaetigt = !mussBestaetigen || $('bestaetigen').checked;

  $('los').disabled = !(zustand.verbunden && tabelleOk && etwasZuTun && bestaetigt);
  $('csv-laden').disabled = !(zustand.neu && zustand.neu.csv);
  $('los').title = !zustand.verbunden ? 'Erst in Schritt 1 verbinden'
    : !tabelleOk ? 'Erst die Fehler in der Tabelle beheben'
    : !etwasZuTun ? 'Es gibt nichts Neues zu veröffentlichen'
    : !bestaetigt ? 'Erst bestätigen, dass die Maßnahmen entfernt werden sollen' : '';
  if (!zustand.nachrichtVonHand) $('nachricht').value = nachrichtVorschlagen(v);
}

// --------------------------------------------------------------- Eingaben

async function tabelleAufnehmen(datei) {
  status('tabelle-status', `Lese „${datei.name}“ …`);
  status('ergebnis', '');
  try {
    const roh = await tabelleLesen(datei);
    zustand.neu = { roh, datei: datei.name, blatt: roh.blatt };
    zustand.nachrichtVonHand = false;
    $('bestaetigen').checked = false;
    pruefen();
    status('tabelle-status', `„${datei.name}“ gelesen — Ergebnis der Prüfung in Schritt 4.`, 'gut');
  } catch (f) {
    zustand.neu = null;
    status('tabelle-status', f.message, 'fehler');
  }
  zeichnen();
}

async function pdfsAufnehmen(dateien) {
  const abgelehnt = [];
  for (const datei of dateien) {
    if (!/\.pdf$/i.test(datei.name)) { abgelehnt.push(`${datei.name} (kein PDF)`); continue; }
    if (datei.size > 100 * 1024 * 1024) { abgelehnt.push(`${datei.name} (über 100 MB — zu groß für GitHub)`); continue; }
    const anfang = new TextDecoder().decode(new Uint8Array(await datei.slice(0, 5).arrayBuffer()));
    if (anfang !== '%PDF-') { abgelehnt.push(`${datei.name} (ist innen kein PDF)`); continue; }
    zustand.pdfs.set(datei.name, datei);
  }
  const gross = [...zustand.pdfs.values()].filter(d => d.size > 20 * 1024 * 1024).map(d => d.name);
  status('ergebnis', '');
  $('pdf-bestand').dataset.art = abgelehnt.length || gross.length ? 'warnung' : '';
  $('pdf-bestand').textContent = [
    abgelehnt.length ? `Nicht übernommen: ${abgelehnt.join(', ')}.` : '',
    gross.length ? `Sehr groß, besser verkleinern: ${gross.join(', ')}.` : '',
  ].filter(Boolean).join(' ') || `${zustand.pdfs.size} PDF zum Hochladen vorgemerkt.`;
  steckbriefePruefen();
  zeichnen();
}

function ablageEinrichten(id, eingabe, aufnehmen) {
  const zone = $(id);
  $(eingabe).addEventListener('change', e => {
    if (e.target.files.length) aufnehmen([...e.target.files]);
    e.target.value = '';                      // dieselbe Datei erneut waehlbar
  });
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drueber'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drueber'));
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('drueber');
    if (e.dataTransfer.files.length) aufnehmen([...e.dataTransfer.files]);
  });
}

// --------------------------------------------------------------- Ausgaben

/** Excel-Mappe zum Bearbeiten: der aktuelle Stand, oder ein frueherer aus
 *  „Fruehere Staende“. */
function vorlageHerunterladen(eintraege = zustand.stand && zustand.stand.eintraege,
                              standText = `Heruntergeladen am ${heute()} von ${REPO_URL}`,
                              dateiname = `${heute()} Massnahmen KARE.xlsx`) {
  if (!eintraege) return;
  const kopf = FELDER.map(f => f.kopf);
  const zeilen = eintraege.map(e => FELDER.map(f =>
    f.typ === 'stufe' && e[f.key] !== '' ? Number(e[f.key]) : e[f.key]));
  const spalte = key => FELDER.findIndex(f => f.key === key);
  const auswahl = [
    { spalte: spalte('hazard'), werte: RISIKEN, hinweis: 'Neue Werte sind möglich, aber der Risiko-Filter kennt nur Hitze und Starkregen.' },
    { spalte: spalte('art'), werte: ARTEN, hinweis: 'Diese Art kennt der Filter auf der Seite nicht.' },
    { spalte: spalte('akteure'), werte: ['K', 'U', 'P', 'KU', 'KP', 'UP', 'KUP'], hinweis: 'K = Kommunen, U = Unternehmen, P = Haushalte, auch kombiniert.' },
    ...FELDER.filter(f => f.typ === 'stufe').map(f => ({
      spalte: spalte(f.key), streng: true,
      werte: f.min === 1 ? ['1', '2', '3'] : ['0', '1', '2', '3'],
      hinweis: f.min === 1 ? 'Bitte 1, 2 oder 3 eintragen oder leer lassen.' : 'Bitte 0 bis 3 eintragen oder leer lassen.',
    })),
  ];
  const hinweise = [
    ['Spalte', 'Bedeutung'],
    ['Maßnahme', 'Name der Maßnahme. Muss eindeutig sein — daran erkennt die Pflegeseite, welche Maßnahme geändert wurde.'],
    ['Hazard', 'Hitze, Starkregen oder eine Verbindung wie „Hitze & Starkregen“. Der Filter sucht nach den Wörtern Hitze und Starkregen.'],
    ['Art', ARTEN.join(', ') + '. Andere Werte findet der Filter nicht.'],
    ['Akteure', 'Für wen die Maßnahme gedacht ist: K = Kommunen, U = Unternehmen, P = Haushalte (private). Kombinieren durch Aneinanderreihen, z. B. UP.'],
    ['Kosten', '1 = bis 20.000 €, 2 = 20.000 bis 100.000 €, 3 = über 100.000 €. Leer = nicht bekannt.'],
    ['Umsetzungsdauer', '1 = kurz, 2 = mittel, 3 = lang. Zählt auch Genehmigung und Flächenverfügbarkeit, nicht nur die Bauzeit.'],
    ['Wirksamkeit …, Aufwertung Stadtstruktur', '0 = keine, 1 = gering, 2 = mittel, 3 = hoch. Leer heißt „nicht bewertet“, nicht „keine Wirkung“.'],
    ['Steckbrief', `Dateiname des PDF im Ordner ${ORDNER_PDF}/ (z. B. Gruendach.pdf, Groß-/Kleinschreibung beachten) oder ein vollständiger https-Link. Ein Excel-Hyperlink geht auch.`],
    ['', ''],
    ['Ablauf', 'Datei bearbeiten, speichern und auf der Pflegeseite (pflege.html) wieder hochladen. Dort wird geprüft und verglichen, bevor etwas veröffentlicht wird.'],
    ['Stand', standText],
  ];
  const klecks = Xlsx.schreiben([
    { name: 'Maßnahmen', zeilen: [kopf, ...zeilen], kopfzeile: true,
      breiten: FELDER.map(f => f.breite), auswahl },
    { name: 'Hinweise', zeilen: hinweise, kopfzeile: true, umbruch: true, breiten: [34, 100] },
  ]);
  speichern(dateiname, klecks);
}

// ---------------------------------------------------------- Fruehere Staende

/** Jede Veroeffentlichung ist ein Commit; Git bewahrt alle auf. Hier werden
 *  sie lesbar gemacht und lassen sich zurueckholen -- ohne dass jemand
 *  wissen muss, was ein Commit ist. */
const VERLAUF_JE_SEITE = 10;
const verlauf = { eintraege: [], seite: 0, csv: new Map() };

function datumText(iso) {
  return new Date(iso).toLocaleString('de-DE', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

async function standVon(sha) {
  if (!verlauf.csv.has(sha)) {
    const laden = api(`contents/${PFAD_DATEN}?ref=${sha}`, { roh: true });
    // Ein Fehlschlag soll beim naechsten Versuch neu laden, nicht haengen bleiben.
    laden.catch(() => verlauf.csv.delete(sha));
    verlauf.csv.set(sha, laden);
  }
  return verlauf.csv.get(sha);
}

async function verlaufLaden(weiter = false) {
  if (!zustand.verbunden) return;
  if (!weiter) { verlauf.eintraege = []; verlauf.seite = 0; }
  verlauf.seite++;
  try {
    const liste = await api(`commits?path=${encodeURIComponent(PFAD_DATEN)}&sha=${ZWEIG}` +
                            `&per_page=${VERLAUF_JE_SEITE}&page=${verlauf.seite}`);
    const neu = await Promise.all(liste.map(async c => {
      let anzahl = null;
      try { anzahl = csvEinlesen(await standVon(c.sha)).length; } catch { /* bleibt offen */ }
      return {
        sha: c.sha,
        datum: c.commit.author.date,
        wer: (c.author && c.author.login) || c.commit.author.name,
        was: c.commit.message.split('\n')[0],
        anzahl,
      };
    }));
    verlauf.eintraege.push(...neu);
    $('verlauf-mehr').hidden = liste.length < VERLAUF_JE_SEITE;
  } catch (f) {
    $('verlauf').replaceChildren(el('p', { class: 'status', 'data-art': 'fehler' },
      'Die früheren Stände konnten nicht geladen werden: ' + apiFehlerText(f)));
    return;
  }
  verlaufZeichnen();
}

function verlaufZeichnen() {
  const zeilen = verlauf.eintraege.map((v, i) => {
    const aktuell = i === 0;
    const leer = v.anzahl === 0;
    return el('tr', { 'data-art': leer ? 'leer' : '' },
      el('td', { class: 'zahl' }, datumText(v.datum)),
      el('td', {}, v.wer),
      el('td', {}, v.was, aktuell ? el('span', { class: 'marke-aktuell' }, 'aktuell') : null),
      el('td', { class: 'zahl', title: leer ? 'leere Tabelle' : '' },
        v.anzahl === null ? '?' : String(v.anzahl)),
      el('td', { class: 'aktionen' },
        el('button', { type: 'button', class: 'knopf-schlicht', onclick: () => alteExcel(v) }, 'Excel'),
        aktuell ? null : el('button', { type: 'button', class: 'knopf-zweit knopf-klein',
          onclick: () => wiederherstellen(v) }, 'Wiederherstellen')));
  });
  $('verlauf').replaceChildren(el('div', { class: 'verlauf-rahmen' },
    el('table', { class: 'pdf-tabelle verlauf-tabelle' },
      el('thead', {}, el('tr', {}, ['Veröffentlicht', 'von', 'Beschreibung', 'Maßnahmen', '']
        .map(t => el('th', { scope: 'col' }, t)))),
      el('tbody', {}, zeilen))));
}

async function alteExcel(v) {
  const text = await standVon(v.sha);
  const tag = v.datum.slice(0, 10);
  vorlageHerunterladen(csvEinlesen(text),
    `Früherer Stand vom ${datumText(v.datum)} (${v.sha.slice(0, 7)}), heruntergeladen am ${heute()}`,
    `${heute()} Massnahmen KARE (Stand ${tag}).xlsx`);
}

/** Holt einen frueheren Stand in Schritt 4, als waere er hochgeladen worden:
 *  gleiche Pruefung, gleicher Vergleich, und veroeffentlicht wird er als
 *  neuer Stand. Der Verlauf dazwischen bleibt erhalten. */
async function wiederherstellen(v) {
  status('ergebnis', '');
  try {
    const text = await standVon(v.sha);
    const roh = { blatt: null, zeilen: csvZerlegen(text).map((werte, i) => ({ nr: i + 1, werte, links: [] })) };
    zustand.neu = { roh, datei: `Stand vom ${datumText(v.datum)}`, blatt: null };
    pruefen();
    $('bestaetigen').checked = false;
    zustand.nachrichtVonHand = true;
    $('nachricht').value = `Stand vom ${datumText(v.datum)} wiederhergestellt (${v.sha.slice(0, 7)})`;
    status('tabelle-status', `Stand vom ${datumText(v.datum)} geladen — bitte in Schritt 4 prüfen und veröffentlichen.`, 'gut');
    zeichnen();
    $('s4').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (f) {
    status('ergebnis', 'Der frühere Stand konnte nicht geladen werden: ' + apiFehlerText(f), 'fehler');
  }
}

function csvHerunterladen() {
  if (!zustand.neu || !zustand.neu.csv) return;
  speichern(`${heute()} massnahmen.csv`, new Blob([zustand.neu.csv.replace(/\n/g, '\r\n')], { type: 'text/csv;charset=utf-8' }));
}

// ---------------------------------------------------------- Veroeffentlichen

/** Schreibt Tabelle und Steckbriefe als einen einzigen Commit. Einzeln ueber
 *  die Contents-Schnittstelle waeren es mehrere Commits, und ein Abbruch
 *  mittendrin liesse einen halben Stand zurueck. */
async function veroeffentlichen() {
  const knopf = $('los');
  knopf.disabled = true;
  const nachricht = $('nachricht').value.trim() || nachrichtVorschlagen(vergleichen()) || 'Inhalte aktualisiert';
  try {
    status('ergebnis', 'Hole den aktuellen Stand …');
    const ref = await api(`git/ref/heads/${ZWEIG}`);
    const basis = ref.object.sha;
    const basisCommit = await api(`git/commits/${basis}`);

    const baum = [];
    if (csvGeaendert()) {
      status('ergebnis', 'Lade die Tabelle hoch …');
      const blob = await api('git/blobs', { methode: 'POST',
        daten: { content: base64(new TextEncoder().encode(zustand.neu.csv)), encoding: 'base64' } });
      baum.push({ path: PFAD_DATEN, mode: '100644', type: 'blob', sha: blob.sha });
    }
    const pdfs = [...zustand.pdfs.values()];
    for (let i = 0; i < pdfs.length; i++) {
      status('ergebnis', `Lade ${pdfs[i].name} hoch (${i + 1} von ${pdfs.length}) …`);
      const blob = await api('git/blobs', { methode: 'POST',
        daten: { content: base64(new Uint8Array(await pdfs[i].arrayBuffer())), encoding: 'base64' } });
      baum.push({ path: `${ORDNER_PDF}/${pdfs[i].name}`, mode: '100644', type: 'blob', sha: blob.sha });
    }

    status('ergebnis', 'Lege den neuen Stand an …');
    const neuerBaum = await api('git/trees', { methode: 'POST',
      daten: { base_tree: basisCommit.tree.sha, tree: baum } });
    const commit = await api('git/commits', { methode: 'POST',
      daten: { message: nachricht, tree: neuerBaum.sha, parents: [basis] } });
    // force: false -- hat inzwischen jemand anderes veroeffentlicht, schlaegt
    // das fehl, statt dessen Arbeit zu ueberschreiben.
    await api(`git/refs/heads/${ZWEIG}`, { methode: 'PATCH', daten: { sha: commit.sha, force: false } });

    const e = $('ergebnis');
    e.dataset.art = 'gut';
    e.replaceChildren('Veröffentlicht. Die öffentliche Seite zeigt den neuen Stand nach wenigen Minuten; wer sie schon offen hat, sieht ihn spätestens nach zehn Minuten. ',
      el('a', { href: commit.html_url || `${REPO_URL}/commit/${commit.sha}`, target: '_blank', rel: 'noopener' },
        'Änderung auf GitHub ansehen'));
    zustand.pdfs.clear();
    zustand.neu = null;
    zustand.nachrichtVonHand = false;
    $('nachricht').value = '';
    await standLaden();
    $('ergebnis').dataset.art = 'gut';
  } catch (f) {
    const text = f.status === 422 || f.status === 409
      ? 'In der Zwischenzeit hat jemand anderes etwas veröffentlicht. Der Stand wird neu geladen — ' +
        'bitte die Änderungen prüfen und noch einmal veröffentlichen.'
      : apiFehlerText(f);
    status('ergebnis', text, 'fehler');
    if (f.status === 422 || f.status === 409) await standLaden();
  }
  zeichnen();
}

// -------------------------------------------------------------------- Start

function starten() {
  $('repo-link').href = REPO_URL;
  $('link-upload-daten').href = `${REPO_URL}/upload/${ZWEIG}/daten`;
  $('link-upload-pdf').href = `${REPO_URL}/upload/${ZWEIG}/${ORDNER_PDF}`;

  $('verbinden').addEventListener('submit', e => {
    e.preventDefault();
    const s = $('schluessel').value;
    if (s.trim()) verbinden(s);
  });
  $('abmelden').addEventListener('click', abmelden);
  $('vorlage').addEventListener('click', () => vorlageHerunterladen());
  $('bestaetigen').addEventListener('change', zeichnen);
  $('verlauf-mehr').addEventListener('click', () => verlaufLaden(true));
  $('csv-laden').addEventListener('click', csvHerunterladen);
  $('los').addEventListener('click', veroeffentlichen);
  $('nachricht').addEventListener('input', () => { zustand.nachrichtVonHand = true; });
  ablageEinrichten('ablage-tabelle', 'datei-tabelle', d => tabelleAufnehmen(d[0]));
  ablageEinrichten('ablage-pdf', 'datei-pdf', pdfsAufnehmen);

  const gemerkt = schluesselLesen();
  if (gemerkt) {
    $('merken').checked = gemerkt.dauerhaft;
    verbinden(gemerkt.schluessel, { gespeichert: true });
  } else {
    standLaden();
  }
}

starten();
