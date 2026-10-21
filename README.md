# Anpassungscoaching-Tool

Maßnahmen zur Anpassung an Hitze und Starkregen für Kommunen, Unternehmen und
Haushalte in der Region Oberland, aus dem Projekt **KARE – Klimaanpassung in
der Region Oberland**.

**Zur Seite:** https://klimaanpassung-oberland.github.io/massnahmentool/

Dieses Repository wird automatisch befüllt und nicht von Hand bearbeitet.
Änderungen hier werden beim nächsten Abgleich überschrieben. Gepflegt werden
die Inhalte an anderer Stelle.

## Einbinden per iframe

Empfohlen: eine feste Höhe nach der Fenstergröße. Das Tool scrollt dann im
iframe, und nur so bleiben Seitenkopf, Ergebnisleiste und Tabellenkopf beim
Scrollen stehen und die Merkleiste unten angeheftet.

```html
<iframe src="https://klimaanpassung-oberland.github.io/massnahmentool/"
        title="Anpassungscoaching-Tool"
        style="width:100%; height:85vh; min-height:600px; border:0"
        loading="lazy"></iframe>
```

Filtert das Redaktionssystem `style` heraus, eine feste Pixelhöhe:

```html
<iframe src="https://klimaanpassung-oberland.github.io/massnahmentool/"
        title="Anpassungscoaching-Tool" width="100%" height="800"
        frameborder="0" loading="lazy"></iframe>
```

Nicht mehr empfohlen, aber möglich: Der iframe wächst mit dem Inhalt, und
die umgebende Seite scrollt. Dann bleiben Kopf und Tabellenkopf nicht stehen,
und die Merkleiste steht über den Ergebnissen statt unten. Die Seite meldet
dafür ihre Höhe:

```html
<script>
window.addEventListener('message', function (e) {
  if (e.origin !== 'https://klimaanpassung-oberland.github.io') return;
  if (!e.data || e.data.typ !== 'kare-hoehe') return;
  document.querySelector('iframe[src^="https://klimaanpassung-oberland.github.io/massnahmentool"]')
    .style.height = e.data.hoehe + 'px';
});
</script>
```

In ArcGIS StoryMaps geht das Mitwachsen nicht. Dort den iframe-Code mit
fester Pixelhöhe in den Embed-Block einfügen, nicht die nackte Adresse, sonst
setzt StoryMaps eine eigene, flache Höhe.

## Lizenz

Der **Programmcode** steht unter der MIT-Lizenz (siehe `LICENSE`).

Für die **Maßnahmeninhalte** — die Maßnahmen, die Einschätzungen zu
Wirksamkeit, Kosten und Dauer sowie die Steckbriefe — gilt die MIT-Lizenz
**nicht**. Sie stammen aus dem geförderten Projekt KARE; die Bedingungen
ihrer Nutzung werden noch festgelegt.
