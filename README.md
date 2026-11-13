# Kaart

Een besloten pagina. Wat hier staat is versleuteld; zonder de kaart valt er niets te lezen.

## Hoe het werkt

- `index.html` en `assets/` zijn alleen een slotscherm. Er staat geen inhoud in.
- `data/card.bin` is de inhoud, versleuteld met AES-256-GCM.
- De sleutel wordt in de browser afgeleid uit twee dingen die samen op de kaart staan:
  1. een willekeurig geheim van 256 bits in de QR-code, achter de `#` van de link.
     Dat deel van een link stuurt een browser nooit naar een server;
  2. het wachtwoord dat eronder geschreven staat, opgerekt met PBKDF2-HMAC-SHA256
     (600.000 rondes).
  Beide worden met HKDF-SHA256 samengevoegd tot de sleutel.
- Ontsleutelen gebeurt volledig op het toestel van de lezer. De pagina laadt niets
  van andere websites en stuurt niets terug.

De link alleen is dus niet genoeg, en het wachtwoord alleen ook niet.

## Inhoud bijwerken

De leesbare bron en `geheim.json` (link plus wachtwoord) staan bewust niet in deze
repository. Met die twee:

```bash
node tools/kaart.mjs seal geheim.json <bronmap>
```

```bash
node tools/kaart.mjs open geheim.json <doelmap>
```

Het wachtwoord of de inhoud wijzigen kan zonder dat de QR-code verandert: verzegel
opnieuw met dezelfde link.
