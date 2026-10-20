'use strict';

// CSV lesen und schreiben, gemeinsam fuer die Seite und die Pflegeseite.

/** Zerlegt eine CSV mit Anfuehrungszeichen nach RFC 4180.
 *  Eigener Parser statt einer Bibliothek: Es sind dreissig Zeilen, und die
 *  Datei wird von Hand in Excel gepflegt -- da kommen Semikolons und
 *  Zeilenumbrueche in Feldern vor, an denen ein naives split() scheitert. */
function csvZerlegen(text, trenner = ';') {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);   // Excel-Kennzeichen
  const zeilen = [];
  let feld = '', zeile = [], inAnfuehrung = false;

  for (let i = 0; i < text.length; i++) {
    const z = text[i];
    if (inAnfuehrung) {
      if (z === '"') {
        if (text[i + 1] === '"') { feld += '"'; i++; }        // verdoppelt
        else inAnfuehrung = false;
      } else feld += z;
      continue;
    }
    if (z === '"') { inAnfuehrung = true; }
    else if (z === trenner) { zeile.push(feld); feld = ''; }
    else if (z === '\n') { zeile.push(feld); zeilen.push(zeile); zeile = []; feld = ''; }
    else if (z === '\r') { /* uebergehen */ }
    else feld += z;
  }
  if (feld !== '' || zeile.length) { zeile.push(feld); zeilen.push(zeile); }
  return zeilen;
}

/** Ein Feld fuer eine Semikolon-CSV, nur wo noetig in Anfuehrungszeichen. */
function csvFeld(wert) {
  return /[";\r\n]/.test(wert) ? '"' + wert.replace(/"/g, '""') + '"' : wert;
}

/** Ganze Datei so, wie Excel in deutscher Einstellung sie erwartet:
 *  Kennzeichen am Anfang (sonst keine Umlaute) und Semikolon. Zeilenende
 *  CRLF fuer Downloads; was nach GitHub geht, bekommt LF, denn so legt Git
 *  die Datei ab (siehe .gitattributes). */
function csvText(zeilen, zeilenende = '\r\n') {
  return '﻿' + zeilen.map(z => z.map(csvFeld).join(';')).join(zeilenende) + zeilenende;
}
