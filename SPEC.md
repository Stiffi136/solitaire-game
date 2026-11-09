# Solitaire 3D – Spezifikation

Status: v3 (Entscheidungen eingearbeitet) · Sprache der UI: Deutsch

Mockup: `docs/mockup.png`

## 1. Ziel

Klondike-Solitaire im Browser, gerendert mit three.js. Singleplayer läuft komplett offline (statisch auf GitHub Pages). Optional kooperativer Multiplayer: mehrere Personen spielen **dieselbe** Partie gemeinsam über einen WebSocket-Server (Docker-Image auf Render).

## 2. Tech-Stack

| Teil | Technik |
|---|---|
| Frontend | Vite, TypeScript (strict), three.js, kein UI-Framework (HTML/CSS-Overlay) |
| Server | Node 22, TypeScript, `ws`, gebündelt mit esbuild zu einer Datei |
| Gemeinsam | `shared/`: Spiellogik + Nachrichtenprotokoll, von Client und Server importiert |
| Hosting | Frontend: GitHub Pages (GitHub Actions) · Server: Docker auf Render |

## 3. Projektstruktur

```
client/            index.html, src/ (main, renderer, textures, net, style)
server/src/        index.ts (HTTP + WebSocket)
shared/            klondike.ts (Regeln), protocol.ts (Nachrichten)
Dockerfile         Multi-Stage, nur der Server
render.yaml        Render-Blueprint
.github/workflows/deploy.yml   Build + Deploy auf Pages
```

## 4. Spielregeln (Klondike)

- 52 Karten, 7 Tableau-Spalten (1–7 Karten, oberste offen), Stock, Waste, 4 Foundations.
- Ziehen: **1 oder 3 Karten** (Wahl beim neuen Spiel).
- Stock leer → Klick legt Waste umgedreht zurück (unbegrenzt oft).
- Tableau: absteigend, Farbe wechselnd; leere Spalte nur König. Offene Teilstapel dürfen als Ganzes bewegt werden.
- Foundation: **feste Farbe pro Platz** in der Reihenfolge ♠ ♥ ♦ ♣ (wie im Mockup), aufsteigend ab Ass; Karten dürfen zurück aufs Tableau.
- Verdeckte oberste Tableau-Karte wird automatisch aufgedeckt.
- Gewonnen, wenn alle 52 Karten auf den Foundations liegen.
- Mischen deterministisch per Seed (gleicher Seed = gleiches Spiel).
- Undo (Verlauf bis 200 Schritte), Zähler für Züge, Spielzeit, Punkte.
- **Tipp**: Ein möglicher Zug wird gesucht und kurz hervorgehoben (Quelle und Ziel leuchten). Reihenfolge: Foundation → Karte aufdecken → Tableau-Zug → Stock ziehen. Gibt es keinen Zug mehr, erscheint „Keine Züge mehr“.

### 4.1 Punkte (Windows-Standardwertung)

| Aktion | Punkte |
|---|---|
| Waste → Tableau | +5 |
| Waste → Foundation | +10 |
| Tableau → Foundation | +10 |
| Tableau-Karte aufdecken | +5 |
| Foundation → Tableau | −15 |
| Waste zurück in den Stock (Ziehen 1) | −100 |
| Waste zurück in den Stock (Ziehen 3, ab dem 4. Durchgang) | −20 |
| Alle 10 Sekunden Spielzeit (nur wenn Zeitstrafe an) | −2 |
| Zeitbonus beim Sieg (bei mehr als 30 s) | +700 000 / Sekunden |

Die Punkte fallen nie unter 0. Undo stellt auch die Punkte wieder her.

**Zeitstrafe** ist einstellbar (an/aus, Standard: an). Sie wird beim Start eines Spiels im Spielstand festgelegt. Im Multiplayer gilt daher für alle dieselbe Einstellung.
- **Auto-Finish**: Sobald Stock/Waste leer und alles aufgedeckt ist, erscheint ein Button, der die restlichen Karten automatisch ablegt.

## 5. Darstellung (three.js)

- Orthografische Kamera von oben → scharfe 2D-Optik mit 3D-Effekten.
- Karten = Gruppe aus Vorder- und Rückseite (zwei Planes); Umdrehen als echte Drehung um die Y-Achse.
- Look wie im Mockup: klassisches Kartendesign auf dunkelgrünem Filz.
- **Zahlenkarten und Asse** werden zur Laufzeit per Canvas erzeugt: Eckindex oben links (Rang, darunter Farbsymbol, rot/schwarz mit Serifenschrift) und klassische Anordnung der Symbole in der Mitte. Symbole werden als Pfade gezeichnet (kein Emoji-Problem auf iOS).
- **Bildkarten (B, D, K)** mit illustrierten Figuren wie im Mockup. Quelle: „English pattern playing cards deck“ von Dmitry Fomin (Wikimedia Commons, CC0/gemeinfrei). Die 12 Bildkarten liegen als SVG im Repo (`client/public/cards/`), werden beim Start geladen und auf die Canvas-Textur gezeichnet. Lizenz wird im README genannt. Fallback, falls ein Bild nicht lädt: Rahmen mit großem Buchstaben.
- **Rückseite**: blau mit Rautenmuster und weißem Rand.
- Stock zeigt seine Höhe als leichten Stapelrand.
- Leere Foundations: dunkler Umriss mit blassem Farbsymbol (♠ ♥ ♦ ♣). Leere Tableau-Spalte und leerer Stock: dunkler Umriss (Stock mit Umdreh-Symbol ↻).
- Verdeckte Tableau-Karten sind nur als schmale Streifen sichtbar, offene etwas weiter gefächert.
- Weiche Schatten; gezogene Karten heben sich an (größerer Schatten).
- Animationen: Karten gleiten zum Ziel und heben sich dabei kurz an. Umdrehen als 3D-Drehung. Sieg: Karten-Kaskade.
- Hervorhebung für Tipp: leuchtender Rand um Quell- und Zielkarte.
- Responsiv: Layout passt sich an Hoch- und Querformat an; lange Spalten werden enger gefächert, damit sie ins Bild passen.

### 5.1 Oberfläche (HTML-Overlay)

**Kopfleiste** (dunkelgrün, wie im Mockup):
- links: Logo ♠ + „Solitaire“
- rechts: `Zeit: mm:ss` · `Züge: n` · `Punkte: n`
- Icons: Multiplayer 👥 (neu, nicht im Mockup), Hilfe ?, Einstellungen ⚙, Vollbild ⛶
- im Multiplayer zusätzlich: Farbpunkte mit Namen der Mitspieler

**Fußleiste** (umrandete Buttons, zentriert): `Rückgängig` · `Neu starten` · `Tipp`. Bei Auto-Finish erscheint dort zusätzlich `Fertigstellen`.

**Dialoge**:
- Hilfe: Regeln und Bedienung kurz erklärt
- Einstellungen: Ziehen 1/3 und Zeitstrafe an/aus (beides gilt ab dem nächsten Spiel), Punkte anzeigen an/aus, Animationen an/aus
- Neu starten: Rückfrage, wenn das Spiel schon läuft
- Sieg: Zeit, Züge, Punkte, Button „Neues Spiel“
- Multiplayer (siehe 7)

**Mobil (Hochformat)**: Kopfleiste nur Logo-Symbol, Werte kompakt (`00:34 · 12 · 283`); Fußleiste nur Icons. Vollbild-Button wird ausgeblendet, wenn der Browser es nicht kann (iPhone).

## 6. Bedienung

- Maus und Touch über Pointer Events.
- **Drag & Drop**: Karte/Teilstapel greifen, auf Ziel ziehen; ungültig → zurückgleiten. Ziel = Stapel mit größter Überlappung, auf dem der Zug erlaubt ist.
- **Tippen/Klicken** auf offene Karte: automatischer Zug (zuerst Foundation, dann passende Tableau-Spalte).
- Klick auf Stock: ziehen bzw. umdrehen.
- Tastatur: `Strg+Z` = Undo.
- Singleplayer-Spielstand wird in `localStorage` gespeichert (überlebt Reload).

## 7. Multiplayer (kooperativ)

### 7.1 Ablauf
- Multiplayer-Dialog: Name, Server-URL, Raumcode.
- **Raum erstellen**: zufälliger 5-stelliger Code; der aktuelle Spielstand des Erstellers wird übernommen.
- **Beitreten**: per Code oder Einladungslink `…/?room=CODE` (optional `&server=URL`).
- Alle Spieler dürfen jederzeit ziehen; es gibt keine Runden.
- Mitspieler werden oben mit Farbpunkt + Name angezeigt.
- Zeit, Züge und Punkte gehören zur gemeinsamen Partie. „Tipp“ zeigt den Hinweis nur dem, der klickt.

### 7.2 Synchronisation
- **Server ist maßgeblich**: Er hält den Spielstand, wendet Aktionen mit derselben Logik (`shared/`) an und sendet den neuen Stand an alle.
- Client führt eigene Züge sofort lokal aus (flüssig); der Serverstand überschreibt ihn. Ungültige Züge (z. B. zwei gleichzeitig auf dieselbe Karte) werden so automatisch korrigiert.
- **Mauszeiger** der Mitspieler: farbiger Pfeil mit Namen, ca. 20 Updates/s, weich interpoliert.
- **Drag & Drop live**: Während jemand zieht, sehen alle anderen die Karten unter seinem Zeiger mitwandern. Diese Karten sind für andere gesperrt, bis losgelassen wird.
- Koordinaten werden in Tisch-Koordinaten (Welt-Einheiten) übertragen, damit sie bei unterschiedlichen Bildschirmgrößen passen.
- Undo und Neues Spiel wirken für alle.
- Kein Anti-Cheat; nur Basisprüfungen, damit kaputte Nachrichten den Server nicht abstürzen lassen.

### 7.3 Verbindung
- Automatischer Reconnect mit Backoff (1 s → max. 10 s), danach automatisches Wiederbeitreten.
- Hinweis beim Verbinden: Render-Free-Tier kann bis ~1 Minute zum Aufwachen brauchen.
- Keepalive: Server-Ping alle 30 s, tote Verbindungen werden getrennt.
- Leere Räume werden nach 30 Minuten gelöscht (nur im Speicher, keine Datenbank).

### 7.4 Protokoll (JSON über WebSocket)

Client → Server:
| `t` | Inhalt |
|---|---|
| `join` | `room`, `name`, `state?` (Startstand, falls Raum neu) |
| `action` | `move {cardId, to}` · `draw` · `undo` · `newGame {seed, drawCount, timePenalty}` |
| `cursor` | `x`, `y` |
| `drag` | `cards[]`, `x`, `y` (Position der obersten gezogenen Karte) |
| `dragEnd` | – |

Server → Client:
| `t` | Inhalt |
|---|---|
| `welcome` | eigene `id`, `room`, `state`, `players[]` |
| `state` | neuer `state`, `by` (wer gezogen hat) |
| `players` | Liste `{id, name, color}` |
| `cursor` / `drag` / `dragEnd` | wie oben + `id` des Spielers |
| `error` | `message` |

## 8. Deployment

### Frontend (GitHub Pages)
- Workflow bei Push auf `main`: `npm ci` → `npm run build` → Deploy von `dist/`.
- `base: './'`, damit es unter `https://<user>.github.io/<repo>/` läuft.
- Standard-Server-URL über Repo-Variable `VITE_SERVER_URL` (z. B. `wss://solitaire-mp.onrender.com`); im Dialog überschreibbar.

### Server (Render)
- `Dockerfile` im Repo-Root, Multi-Stage, Laufzeit-Image `node:22-alpine`, läuft als User `node`.
- Port aus `PORT` (Render setzt ihn), Standard 8080.
- `GET /health` → `ok` für den Health-Check.
- `render.yaml` als Blueprint (Web Service, Docker, Free-Plan).

### Lokal
- `npm run dev` (Frontend), `npm run server:dev` (Server auf `ws://localhost:8080`).

## 9. Nicht im Umfang (v1)

- Accounts, Ranglisten
- Persistenz der Räume über Server-Neustarts
- Andere Solitaire-Varianten (Spider, FreeCell)
- Sound
- Anti-Cheat

## 10. Entscheidungen

- Variante: Klondike, Ziehen 1 oder 3.
- Bildkarten: freies Grafik-Deck (Dmitry Fomin, CC0).
- Zeitstrafe: einstellbar.
- Multiplayer-Rechte: alle Spieler gleich (jeder darf Neu starten und Rückgängig).
- Beitritt per Raumcode und Einladungslink, keine Raumliste.
