# Anpassungscoaching-Tool

Maßnahmen zur Anpassung an Hitze und Starkregen für Kommunen, Unternehmen und
Haushalte in der Region Oberland, aus dem Projekt **KARE – Klimaanpassung in
der Region Oberland**.

**Zur Seite:** https://klimaanpassung-oberland.github.io/massnahmentool/

Dieses Repository wird automatisch befüllt und nicht von Hand bearbeitet.
Änderungen hier werden beim nächsten Abgleich überschrieben. Gepflegt werden
die Inhalte an anderer Stelle.

## Einbinden per iframe

```html
<iframe src="https://klimaanpassung-oberland.github.io/massnahmentool/"
        width="100%" height="1400" style="border:0" loading="lazy"
        title="Anpassungscoaching-Tool"></iframe>
```

Wo die umgebende Seite Skripte erlaubt, kann der iframe mit dem Inhalt
mitwachsen. Die Seite meldet dafür ihre Höhe:

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

In ArcGIS StoryMaps geht das nicht. Dort den iframe-Code in den Embed-Block
einfügen, nicht die nackte Adresse, sonst setzt StoryMaps eine eigene, flache
Höhe.

## Lizenz

Der **Programmcode** steht unter der MIT-Lizenz (siehe `LICENSE`).

Für die **Maßnahmeninhalte** — die Maßnahmen, die Einschätzungen zu
Wirksamkeit, Kosten und Dauer sowie die Steckbriefe — gilt die MIT-Lizenz
**nicht**. Sie stammen aus dem geförderten Projekt KARE; die Bedingungen
ihrer Nutzung werden noch festgelegt.
