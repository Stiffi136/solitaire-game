# Solitaire 3D

Klondike-Solitaire im Browser mit three.js. Einzelspieler läuft offline (GitHub Pages), optional kooperativer Mehrspieler über einen WebSocket-Server (Docker, z. B. auf Render).

Spezifikation: [SPEC.md](SPEC.md)

## Lokal starten

```bash
npm install
npm run server:dev   # Mehrspieler-Server auf ws://localhost:8080
npm run dev          # Frontend auf http://localhost:5173
```

Auf `localhost` ist `ws://localhost:8080` als Server vorausgewählt.

Oder beides zusammen: `npm run dev:all`.

### Dev Container

`.devcontainer/` enthält eine fertige Umgebung (Node 22, Docker-in-Docker, GitHub CLI). In VS Code: **Reopen in Container**, oder auf GitHub: **Code → Codespaces**. Danach `npm run dev:all`.

In **Codespaces** wird die Server-Adresse automatisch erkannt. Port 8080 muss dafür auf **Public** stehen (Tab „Ports“ → Rechtsklick → Port Visibility), sonst blockiert GitHub die WebSocket-Verbindung von Mitspielern.

## Struktur

| Ordner | Inhalt |
|---|---|
| `client/` | Vite-Frontend (three.js-Renderer, UI, WebSocket-Client) |
| `server/` | Node-WebSocket-Server (`ws`), mit esbuild zu einer Datei gebündelt |
| `shared/` | Spielregeln (`klondike.ts`) und Protokoll (`protocol.ts`), von beiden genutzt |

## Deployment

### 1. Server auf Render

1. Repo auf GitHub pushen.
2. In Render: **New → Blueprint** und das Repo wählen (nutzt `render.yaml`),
   oder **New → Web Service → Docker** mit dem `Dockerfile` im Root.
3. Nach dem Deploy die URL notieren, z. B. `https://solitaire-mp.onrender.com`.
   Test: `https://…onrender.com/health` liefert `ok`.

Hinweis: Der Free-Plan legt den Dienst nach ca. 15 Minuten ohne Verkehr schlafen. Das erste Verbinden dauert dann bis zu einer Minute. Räume liegen nur im Speicher und sind nach einem Neustart weg.

Lokal testen: `docker build -t solitaire-mp . && docker run -p 8080:8080 solitaire-mp`

### 2. Frontend auf GitHub Pages

1. Im Repo: **Settings → Pages → Source: GitHub Actions**.
2. **Settings → Secrets and variables → Actions → Variables**: `VITE_SERVER_URL` = `wss://solitaire-mp.onrender.com`.
3. Push auf `main` → Workflow `.github/workflows/deploy.yml` baut und veröffentlicht.

Ohne `VITE_SERVER_URL` funktioniert alles auch. Die Server-Adresse wird dann im Mehrspieler-Dialog eingegeben und im Browser gespeichert.

## Mehrspieler

- 👥 → Name eingeben → **Neuen Raum erstellen**. Das aktuelle Spiel wird übernommen.
- Link kopieren und teilen (`…/?room=CODE`). Wer ihn öffnet, tritt direkt bei.
- Alle spielen dieselbe Partie. Zeiger und gezogene Karten der anderen sind live sichtbar.
- Der Server ist maßgeblich: Er prüft jeden Zug mit denselben Regeln und schickt den neuen Stand an alle.

## Lizenzen

- Bildkarten (Bube, Dame, König): „English pattern playing cards deck“ von Dmitry Fomin, Wikimedia Commons. Details in `client/public/cards/LICENSE.md`.
- Alle anderen Grafiken werden zur Laufzeit per Canvas gezeichnet.
