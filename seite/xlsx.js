'use strict';

// Liest und schreibt Excel-Dateien (.xlsx) ohne fremde Bibliothek.
//
// Eine .xlsx ist ein Zip-Archiv mit XML-Dateien darin. Zum Entpacken reicht,
// was jeder heutige Browser mitbringt (DecompressionStream), das XML liest
// DOMParser. Eine Bibliothek wie SheetJS waere bequemer, aber genau die Art
// Fremdquelle, die die Seite vermeiden will -- und gebraucht wird hier nur
// ein kleiner Teil: Text und Zahlen aus einem Blatt, dazu Hyperlinks.

const Xlsx = (() => {

  const NS_HAUPT = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const NS_BEZUG = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const NS_PAKET = 'http://schemas.openxmlformats.org/package/2006/relationships';

  // ------------------------------------------------------------ Zip lesen

  function zipVerzeichnis(bytes) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let ende = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { ende = i; break; }
    }
    if (ende < 0) {
      throw new Error('Das ist keine .xlsx-Datei. Ältere .xls-Dateien und ' +
        'mit Kennwort geschützte Mappen lassen sich nicht lesen — bitte in ' +
        'Excel als „Excel-Arbeitsmappe (.xlsx)“ ohne Kennwort speichern.');
    }
    const anzahl = dv.getUint16(ende + 10, true);
    let pos = dv.getUint32(ende + 16, true);
    const dekoder = new TextDecoder();
    const eintraege = new Map();
    for (let n = 0; n < anzahl; n++) {
      if (dv.getUint32(pos, true) !== 0x02014b50) throw new Error('Die Excel-Datei ist beschädigt.');
      const methode = dv.getUint16(pos + 10, true);
      const groesse = dv.getUint32(pos + 20, true);
      const nameLaenge = dv.getUint16(pos + 28, true);
      const extraLaenge = dv.getUint16(pos + 30, true);
      const kommentarLaenge = dv.getUint16(pos + 32, true);
      const kopf = dv.getUint32(pos + 42, true);
      const name = dekoder.decode(bytes.subarray(pos + 46, pos + 46 + nameLaenge));
      eintraege.set(name, { methode, groesse, kopf });
      pos += 46 + nameLaenge + extraLaenge + kommentarLaenge;
    }
    return eintraege;
  }

  async function zipEintrag(bytes, verzeichnis, name) {
    const e = verzeichnis.get(name);
    if (!e) return null;
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const start = e.kopf + 30 + dv.getUint16(e.kopf + 26, true) + dv.getUint16(e.kopf + 28, true);
    const roh = bytes.subarray(start, start + e.groesse);
    if (e.methode === 0) return roh;
    if (e.methode !== 8) throw new Error('Die Excel-Datei ist auf unbekannte Art gepackt.');
    const strom = new Blob([roh]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(strom).arrayBuffer());
  }

  async function xmlEintrag(bytes, verzeichnis, name) {
    const roh = await zipEintrag(bytes, verzeichnis, name);
    if (!roh) return null;
    return new DOMParser().parseFromString(new TextDecoder().decode(roh), 'application/xml');
  }

  // Manche Programme schreiben die Elemente mit Vorsilbe (x:row), Excel ohne.
  // Ueber den lokalen Namen zu suchen deckt beides ab.
  const elemente = (wurzel, name) => [...wurzel.getElementsByTagNameNS('*', name)];

  function bezugsId(el) {
    return el.getAttributeNS(NS_BEZUG, 'id') || el.getAttribute('r:id');
  }

  /** Liest eine .rels-Datei als Zuordnung Id -> Ziel. */
  function bezuege(dok) {
    const karte = new Map();
    if (!dok) return karte;
    elemente(dok, 'Relationship').forEach(r =>
      karte.set(r.getAttribute('Id'), {
        ziel: r.getAttribute('Target'),
        extern: r.getAttribute('TargetMode') === 'External',
      }));
    return karte;
  }

  function pfadAuflösen(basis, ziel) {
    if (ziel.startsWith('/')) return ziel.slice(1);
    const teile = basis.split('/').slice(0, -1);
    for (const t of ziel.split('/')) {
      if (t === '..') teile.pop(); else if (t !== '.') teile.push(t);
    }
    return teile.join('/');
  }

  /** 'AB12' -> { spalte: 27, zeile: 12 } (Spalte ab 0, Zeile wie in Excel ab 1). */
  function zelladresse(ref) {
    const m = /^([A-Z]+)(\d+)$/.exec(ref || '');
    if (!m) return null;
    let spalte = 0;
    for (const b of m[1]) spalte = spalte * 26 + (b.charCodeAt(0) - 64);
    return { spalte: spalte - 1, zeile: parseInt(m[2], 10) };
  }

  function zahlAlsText(v) {
    const n = Number(v);
    if (!isFinite(n)) return v;
    // Excel speichert 2 gelegentlich als 1.9999999999999998.
    if (Math.abs(n - Math.round(n)) < 1e-9) return String(Math.round(n));
    return String(n);
  }

  /** Liest ein Blatt einer .xlsx.
   *  @param {ArrayBuffer} puffer
   *  @param {(namen: string[]) => number} [blattWaehlen] Index des Blatts
   *  @returns {Promise<{blatt: string, zeilen: {nr: number, werte: string[], links: string[]}[]}>} */
  async function lesen(puffer, blattWaehlen) {
    const bytes = new Uint8Array(puffer);
    const verzeichnis = zipVerzeichnis(bytes);

    const mappe = await xmlEintrag(bytes, verzeichnis, 'xl/workbook.xml');
    if (!mappe) throw new Error('In der Datei steckt keine Excel-Arbeitsmappe.');
    const mappenBezuege = bezuege(await xmlEintrag(bytes, verzeichnis, 'xl/_rels/workbook.xml.rels'));
    const blaetter = elemente(mappe, 'sheet').map(s => ({
      name: s.getAttribute('name'),
      pfad: pfadAuflösen('xl/workbook.xml', (mappenBezuege.get(bezugsId(s)) || {}).ziel || ''),
    }));
    if (!blaetter.length) throw new Error('Die Arbeitsmappe enthält kein Tabellenblatt.');
    const blatt = blaetter[blattWaehlen ? blattWaehlen(blaetter.map(b => b.name)) : 0] || blaetter[0];

    const texte = [];
    const geteilt = await xmlEintrag(bytes, verzeichnis, 'xl/sharedStrings.xml');
    if (geteilt) {
      elemente(geteilt, 'si').forEach(si => texte.push(
        // Lautschrift (rPh) gehoert nicht zum angezeigten Text.
        elemente(si, 't').filter(t => t.parentNode.localName !== 'rPh')
          .map(t => t.textContent).join('')));
    }

    const dok = await xmlEintrag(bytes, verzeichnis, blatt.pfad);
    if (!dok) throw new Error(`Das Blatt „${blatt.name}“ fehlt in der Datei.`);

    // Hyperlinks: Steht in einer Zelle „Steckbrief“ mit hinterlegtem Link,
    // ist der Link gemeint, nicht der angezeigte Text.
    const teile = blatt.pfad.split('/');
    const relsPfad = teile.slice(0, -1).join('/') + '/_rels/' + teile.at(-1) + '.rels';
    const blattBezuege = bezuege(await xmlEintrag(bytes, verzeichnis, relsPfad));
    const linkJeZelle = new Map();
    elemente(dok, 'hyperlink').forEach(h => {
      const b = blattBezuege.get(bezugsId(h));
      if (!b || !b.extern) return;
      // Ein Link kann fuer einen Bereich gelten (A2:A5); jede Zelle bekommt ihn.
      const [von, bis] = (h.getAttribute('ref') || '').split(':').map(zelladresse);
      if (!von) return;
      const ende = bis || von;
      for (let z = von.zeile; z <= ende.zeile; z++)
        for (let s = von.spalte; s <= ende.spalte; s++) linkJeZelle.set(`${z},${s}`, b.ziel);
    });

    const zeilen = [];
    let naechsteZeile = 1;
    elemente(dok, 'row').forEach(row => {
      const nr = parseInt(row.getAttribute('r'), 10) || naechsteZeile;
      naechsteZeile = nr + 1;
      const werte = [], links = [];
      let naechsteSpalte = 0;
      [...row.children].filter(c => c.localName === 'c').forEach(c => {
        const adr = zelladresse(c.getAttribute('r'));
        const spalte = adr ? adr.spalte : naechsteSpalte;
        naechsteSpalte = spalte + 1;
        const typ = c.getAttribute('t');
        const v = [...c.children].find(k => k.localName === 'v');
        let wert = '';
        if (typ === 's') wert = texte[parseInt(v && v.textContent, 10)] ?? '';
        else if (typ === 'inlineStr') wert = elemente(c, 't').map(t => t.textContent).join('');
        else if (typ === 'b') wert = v && v.textContent === '1' ? 'WAHR' : 'FALSCH';
        else if (typ === 'e') wert = '';                       // #NV, #BEZUG! ...
        else if (typ === 'str') wert = v ? v.textContent : '';
        else wert = v ? zahlAlsText(v.textContent) : '';
        werte[spalte] = wert;
        const link = linkJeZelle.get(`${nr},${spalte}`);
        if (link) links[spalte] = link;
      });
      for (let i = 0; i < werte.length; i++) if (werte[i] === undefined) werte[i] = '';
      zeilen.push({ nr, werte, links });
    });

    return { blatt: blatt.name, zeilen };
  }

  // ---------------------------------------------------------- Zip schreiben

  const CRC_TABELLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABELLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  /** Packt Dateien ungepackt (Verfahren 0) in ein Zip. Fuer ein paar
   *  Kilobyte XML lohnt Komprimieren nicht, und so bleibt es kurz. */
  function zipBauen(dateien) {
    const kodierer = new TextEncoder();
    const lokal = [], zentral = [];
    let versatz = 0;
    for (const [name, inhalt] of dateien) {
      const n = kodierer.encode(name);
      const d = typeof inhalt === 'string' ? kodierer.encode(inhalt) : inhalt;
      const crc = crc32(d);

      const k = new DataView(new ArrayBuffer(30));
      k.setUint32(0, 0x04034b50, true);
      k.setUint16(4, 20, true);
      k.setUint16(6, 0x0800, true);                 // Dateinamen in UTF-8
      k.setUint32(14, crc, true);
      k.setUint32(18, d.length, true);
      k.setUint32(22, d.length, true);
      k.setUint16(26, n.length, true);
      lokal.push(new Uint8Array(k.buffer), n, d);

      const z = new DataView(new ArrayBuffer(46));
      z.setUint32(0, 0x02014b50, true);
      z.setUint16(4, 20, true);
      z.setUint16(6, 20, true);
      z.setUint16(8, 0x0800, true);
      z.setUint32(16, crc, true);
      z.setUint32(20, d.length, true);
      z.setUint32(24, d.length, true);
      z.setUint16(28, n.length, true);
      z.setUint32(42, versatz, true);
      zentral.push(new Uint8Array(z.buffer), n);

      versatz += 30 + n.length + d.length;
    }
    const zentralLaenge = zentral.reduce((s, t) => s + t.length, 0);
    const e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true);
    e.setUint16(8, dateien.length, true);
    e.setUint16(10, dateien.length, true);
    e.setUint32(12, zentralLaenge, true);
    e.setUint32(16, versatz, true);
    return new Blob([...lokal, ...zentral, new Uint8Array(e.buffer)],
      { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }

  // -------------------------------------------------------- xlsx schreiben

  const xml = s => String(s)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  function spaltenbuchstabe(i) {
    let s = '';
    for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + (i - 1) % 26) + s;
    return s;
  }

  // Stil 0 normal, 1 Kopfzeile (fett, weiss auf KARE-Blau), 2 Fliesstext mit Umbruch.
  const STILE = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="${NS_HAUPT}">
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1A65AC"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf></cellXfs>
<cellStyles count="1"><cellStyle name="Standard" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

  function blattXml(b) {
    const zeilen = b.zeilen.map((zeile, zi) => {
      const zellen = zeile.map((w, si) => {
        if (w === '' || w === null || w === undefined) return '';
        const ref = spaltenbuchstabe(si) + (zi + 1);
        const stil = zi === 0 && b.kopfzeile ? ' s="1"' : (b.umbruch ? ' s="2"' : '');
        if (typeof w === 'number') return `<c r="${ref}"${stil}><v>${w}</v></c>`;
        return `<c r="${ref}"${stil} t="inlineStr"><is><t xml:space="preserve">${xml(w)}</t></is></c>`;
      }).join('');
      return `<row r="${zi + 1}">${zellen}</row>`;
    }).join('');

    const letzte = spaltenbuchstabe(Math.max(...b.zeilen.map(z => z.length)) - 1);
    const ansicht = b.kopfzeile
      ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
      : '<sheetViews><sheetView workbookViewId="0"/></sheetViews>';
    const breiten = b.breiten
      ? '<cols>' + b.breiten.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('') + '</cols>'
      : '';
    const filter = b.kopfzeile ? `<autoFilter ref="A1:${letzte}${b.zeilen.length}"/>` : '';

    // Auswahllisten. Bei Zahlen hart (stop), bei Texten nur Warnung, damit
    // eine neue Kategorie moeglich bleibt.
    const pruef = (b.auswahl || []).map(a => {
      const sp = spaltenbuchstabe(a.spalte);
      return `<dataValidation type="list" allowBlank="1" showErrorMessage="1" errorStyle="${a.streng ? 'stop' : 'warning'}"` +
        ` errorTitle="Ungewöhnlicher Wert" error="${xml(a.hinweis || 'Bitte einen Wert aus der Liste wählen.')}"` +
        ` sqref="${sp}2:${sp}2000"><formula1>"${xml(a.werte.join(','))}"</formula1></dataValidation>`;
    }).join('');
    const pruefungen = pruef ? `<dataValidations count="${b.auswahl.length}">${pruef}</dataValidations>` : '';

    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="${NS_HAUPT}" xmlns:r="${NS_BEZUG}">${ansicht}<sheetFormatPr defaultRowHeight="15"/>${breiten}<sheetData>${zeilen}</sheetData>${filter}${pruefungen}</worksheet>`;
  }

  /** Baut eine .xlsx.
   *  @param {{name: string, zeilen: (string|number)[][], kopfzeile?: boolean,
   *           breiten?: number[], umbruch?: boolean,
   *           auswahl?: {spalte: number, werte: string[], streng?: boolean, hinweis?: string}[]}[]} blaetter
   *  @returns {Blob} */
  function schreiben(blaetter) {
    const dateien = [];
    dateien.push(['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${
      blaetter.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`]);
    dateien.push(['_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${NS_PAKET}"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`]);

    // Der Autofilter braucht in Excel einen versteckten Namen, sonst
    // "repariert" Excel die Datei beim Oeffnen.
    const namen = blaetter.map((b, i) => {
      if (!b.kopfzeile) return '';
      const letzte = spaltenbuchstabe(Math.max(...b.zeilen.map(z => z.length)) - 1);
      return `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${xml(b.name.replace(/'/g, "''"))}'!$A$1:$${letzte}$${b.zeilen.length}</definedName>`;
    }).join('');
    dateien.push(['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="${NS_HAUPT}" xmlns:r="${NS_BEZUG}"><sheets>${
      blaetter.map((b, i) => `<sheet name="${xml(b.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')
    }</sheets>${namen ? `<definedNames>${namen}</definedNames>` : ''}</workbook>`]);
    dateien.push(['xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${NS_PAKET}">${
      blaetter.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')
    }<Relationship Id="rId${blaetter.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`]);
    dateien.push(['xl/styles.xml', STILE]);
    blaetter.forEach((b, i) => dateien.push([`xl/worksheets/sheet${i + 1}.xml`, blattXml(b)]));
    return zipBauen(dateien);
  }

  return { lesen, schreiben };
})();
