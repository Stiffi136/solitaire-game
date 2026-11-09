# Solitaire 3D

**▶ Play it live: https://stiffi136.github.io/solitaire-game**

Klondike solitaire in the browser, rendered with three.js. Single player runs offline (GitHub Pages); optional cooperative multiplayer through a WebSocket server (Docker, e.g. on Render).

Specification: [SPEC.md](SPEC.md)

## Run locally

```bash
npm install
npm run server:dev   # multiplayer server on ws://localhost:8080
npm run dev          # frontend on http://localhost:5173
```

Or both at once: `npm run dev:all`.

On `localhost` the client uses `ws://localhost:8080` automatically.

### Dev container

`.devcontainer/` contains a ready-made environment (Node 22, Docker-in-Docker, GitHub CLI). In VS Code: **Reopen in Container**, or on GitHub: **Code → Codespaces**. Then run `npm run dev:all`.

In **Codespaces** the server address is detected automatically. Port 8080 must be set to **Public** for this (tab "Ports" → right click → Port Visibility), otherwise GitHub blocks the WebSocket connection of other players.

## Structure

| Folder | Content |
|---|---|
| `client/` | Vite frontend (three.js renderer, UI, WebSocket client) |
| `server/` | Node WebSocket server (`ws`), bundled into one file with esbuild |
| `shared/` | Game rules (`klondike.ts`) and protocol (`protocol.ts`), used by both |

## Deployment

### 1. Server on Render

1. Push the repo to GitHub.
2. In Render: **New → Blueprint** and select the repo (uses `render.yaml`),
   or **New → Web Service → Docker** with the `Dockerfile` in the root.
3. After the deploy, note the URL, e.g. `https://solitaire-mp.onrender.com`.
   Test: `https://….onrender.com/health` returns `ok`.

Note: the free plan puts the service to sleep after about 15 minutes without traffic. The first connection then takes up to a minute. Rooms live only in memory and are lost when the server restarts.

Test locally: `docker build -t solitaire-mp . && docker run -p 8080:8080 solitaire-mp`

### 2. Frontend on GitHub Pages

1. In the repo: **Settings → Pages → Source: GitHub Actions**.
2. **Settings → Secrets and variables → Actions → Variables**: `VITE_SERVER_URL` = `wss://solitaire-mp.onrender.com`.
3. Push to `main` → the workflow `.github/workflows/deploy.yml` builds and publishes.

The server address is compiled into the build and is not shown in the UI. Without `VITE_SERVER_URL`, the game is single player only (the multiplayer button is hidden).

## Multiplayer

- 👥 → enter a name → **Neuen Raum erstellen** (create room). The current game is taken over.
- Copy and share the link (`…/?room=CODE`). Whoever opens it joins directly.
- Everyone plays the same game. Pointers and dragged cards of the other players are visible live.
- The server is authoritative: it checks every move with the same rules and sends the new state to everyone.
- Rooms are deleted 30 minutes after the last player left.

## Licenses

- Court cards (jack, queen, king): "English pattern playing cards deck" by Dmitry Fomin, Wikimedia Commons, CC0. Details in `client/public/cards/LICENSE.md`.
- All other graphics are drawn at runtime on a canvas.
