# Solitaire 3D – Specification

Status: v5 · UI languages: English (default) and German

Mockup: `docs/mockup.png`

## 1. Goal

Klondike solitaire in the browser, rendered with three.js. Single player runs fully offline (static site on GitHub Pages). Optional cooperative multiplayer: several people play **the same** game together through a WebSocket server (Docker image on Render).

## 2. Tech stack

| Part | Technology |
|---|---|
| Frontend | Vite, TypeScript (strict), three.js, no UI framework (HTML/CSS overlay) |
| Server | Node 22, TypeScript, `ws`, bundled into one file with esbuild |
| Shared | `shared/`: game logic and message protocol, imported by client and server |
| Hosting | Frontend: GitHub Pages (GitHub Actions) · Server: Docker on Render |

## 3. Project structure

```
client/            index.html, src/ (main, renderer, textures, net, style)
server/src/        index.ts (HTTP + WebSocket)
shared/            klondike.ts (rules), solver.ts (hint, game over), protocol.ts (messages)
tests/             solver-check.ts
Dockerfile         multi-stage, server only
render.yaml        Render blueprint
.github/workflows/deploy.yml   build and deploy to Pages
.devcontainer/     dev container (Node 22, Docker-in-Docker)
```

## 4. Game rules (Klondike)

- 52 cards, 7 tableau columns (1–7 cards, top card face up), stock, waste, 4 foundations.
- Draw **1 or 3 cards** (chosen when a new game starts).
- Empty stock → a click turns the waste back over into the stock (unlimited).
- Tableau: descending, alternating colors; only a king goes on an empty column. Face-up runs can be moved as a whole.
- Foundations: **one fixed suit per slot** in the order ♠ ♥ ♦ ♣ (as in the mockup), ascending from the ace; cards may be moved back to the tableau.
- A face-down top card of a tableau column is turned over automatically.
- The game is won when all 52 cards are on the foundations.
- Shuffling is deterministic per seed (same seed = same deal).
- Undo (history of up to 200 steps), move counter, play time, score.
- **Hint**: finds a useful move and highlights it briefly (source and target glow).
- **Auto finish**: when stock and waste are empty and all cards are face up, a button appears that moves the remaining cards to the foundations.

### 4.1 Game over

- The game is over when it is not won and **no progress is possible any more**, not even through a sequence of moves.
- Progress means: a hidden tableau card is revealed, a card leaves stock/waste, or the game is won.
- Code: `shared/solver.ts` (`findHint`, `isGameOver`).
- Detection: direct progress moves are checked first (playable waste card, revealing move; aces and twos always go to the foundation first). Otherwise a breadth-first search runs over all legal tableau and foundation moves, including foundation-to-tableau moves.
- Search state: inside the search, hidden cards stay hidden and stock/waste keep their cards, so a state is only the tableau columns and the foundation heights. Drawing does not change the tableau, so the cards that can reach the top of the waste by drawing are computed once; a state counts as progress as soon as one of them can be played.
- The search visits at most 200,000 states. If it hits this limit, the game counts as **not** over (never a false game over). In tests this happens in about 1 of 600 games.
- The hint uses the same logic: it returns the first move on a shortest path to progress, so following hints never loops.
- The client runs the search in a Web Worker (`client/src/solver.worker.ts`), so a long search does not block the UI.
- Test: `npm run test:solver` (bot on 200 games: no illegal hint, no loop; independent search on game-over states: no false game over). It also runs in the Pages workflow.
- **The check runs only when the player presses "Hint"** (no automatic check, to save CPU, memory and battery). Measured cost: 99 % of checks take less than 0.4 ms; about 0.3 % (end of lost games) take 50 ms to about 1 s and briefly use tens of MB in the worker.
- The hint button shows its state:
  - **Hint**: ready.
  - **Searching…**: a spinner replaces the bulb icon while the search runs; further clicks are ignored.
  - **No moves**: red outline. The "No moves left" dialog (time, moves, score, "Undo", "New game") opens; a click on the button opens it again.
  - Any change of the game (also by another player) resets the button to "Hint".
- In multiplayer, game over is only shown to the player who pressed "Hint".

### 4.2 Score (Windows standard scoring)

| Action | Points |
|---|---|
| Waste → tableau | +5 |
| Waste → foundation | +10 |
| Tableau → foundation | +10 |
| Turn over a tableau card | +5 |
| Foundation → tableau | −15 |
| Waste back to stock (draw 1) | −100 |
| Waste back to stock (draw 3, from the 4th pass) | −20 |
| Every 10 seconds of play (only with time penalty on) | −2 |
| Time bonus on win (if longer than 30 s) | +700,000 / seconds |

The score never drops below 0. Undo also restores the score.

The **time penalty** can be switched on/off (default: on). It is stored in the game state when a game starts, so in multiplayer the same setting applies to everyone.

## 5. Rendering (three.js)

- Orthographic camera from above → crisp 2D look with 3D effects.
- Card = group of front and back plane; turning over is a real rotation around the Y axis.
- Look as in the mockup: classic card design on dark green felt.
- **Number cards and aces** are drawn at runtime on a canvas: corner index top left (rank, suit symbol below, red/black, serif font) and the classic pip layout in the middle. Suit symbols are drawn as paths (no emoji issues on iOS).
- **Court cards (J, Q, K)** with illustrated figures as in the mockup. Source: "English pattern playing cards deck" by Dmitry Fomin (Wikimedia Commons, CC0). The 12 court cards are SVG files in the repo (`client/public/cards/`), loaded at start and drawn onto the canvas texture. Fallback if an image does not load: frame with a large letter.
- **Back**: blue with a diamond pattern and a white border.
- The stock shows its height as a slight stack edge.
- Empty foundations: dark outline with a faint suit symbol (♠ ♥ ♦ ♣). Empty tableau column and empty stock: dark outline (stock with a redeal symbol ↻).
- Face-down tableau cards show only as narrow strips, face-up cards are fanned wider.
- Soft shadows; dragged cards lift up (larger shadow).
- Animations: cards glide to their target and lift briefly while moving. Turning over as a 3D rotation. Win: card cascade.
- Hint highlight: glowing outline around source and target card.
- Responsive: the layout adapts to portrait and landscape; long columns are fanned tighter so they fit on screen.

### 5.1 User interface (HTML overlay)

**Languages**: English (default) and German, selectable in the settings dialog and saved in `localStorage`. The switch applies immediately. All UI texts live in `client/src/i18n.ts`; static HTML uses `data-i18n*` attributes. Server error messages are English and translated in the client.

**Top bar** (dark green, as in the mockup):
- left: logo ♠ + "Solitaire"
- right: `Time: mm:ss` · `Moves: n` · `Score: n`
- icons: multiplayer 👥 (new, not in the mockup), help ?, settings ⚙, fullscreen ⛶
- in multiplayer also: colored dots with the names of the players

**Bottom bar** (outlined buttons, centered): `Undo` · `New game` · `Hint`. With auto finish, `Finish` appears as well.

**Dialogs**:
- Help: short explanation of rules and controls
- Settings: language (English/German), draw 1/3 and time penalty on/off (both apply from the next game), show score on/off, animations on/off
- New game: confirmation if a game is in progress
- Win: time, moves, score, "New game" button
- Game over: see 4.1 (opened from the hint button)
- Multiplayer: see 7

**Mobile (portrait)**: top bar shows only the logo symbol, compact values (`00:34 · 12 · 283`); bottom bar icons only. The fullscreen button is hidden if the browser does not support it (iPhone).

## 6. Controls

- Mouse and touch via pointer events.
- **Drag and drop**: grab a card or a run, drop it on a target; invalid → it glides back. Target = the pile with the largest overlap on which the move is legal.
- **Tap/click** a face-up card: automatic move (foundation first, then a matching tableau column).
- Click on the stock: draw or turn the waste over.
- Keyboard: `Ctrl+Z` = undo.
- The single-player game is saved in `localStorage` (survives a reload).

## 7. Multiplayer (cooperative)

### 7.1 Flow
- Multiplayer dialog: name and room code. The server address is **not** shown or editable (see 8).
- **Create room**: random 5-character code; the creator's current game is taken over.
- **Join**: by code or invite link `…/?room=CODE`.
- If no server is configured for the build, the multiplayer button is hidden.
- All players may move at any time; there are no turns.
- Players are shown in the top bar with a colored dot and name.
- Time, moves and score belong to the shared game. "Hint" shows the hint only to the player who clicks it.

### 7.2 Synchronization
- **The server is authoritative**: it holds the game state, applies actions with the same logic (`shared/`) and sends the new state to everyone.
- The client applies its own moves immediately (smooth); the server state overrides it. Invalid moves (e.g. two players grabbing the same card) are corrected this way.
- **Mouse pointers** of other players: colored arrow with name, about 20 updates/s, smoothly interpolated.
- **Live drag and drop**: while someone drags, everyone else sees the cards move under that player's pointer. These cards are locked for others until they are dropped.
- Coordinates are sent in table coordinates (world units), so they match across screen sizes.
- Undo and new game apply to everyone.
- No anti-cheat; only basic checks so that broken messages cannot crash the server.

### 7.3 Connection
- Automatic reconnect with backoff (1 s → max. 10 s), then automatic rejoin. The client sends its current state when it joins, so a room that no longer exists is recreated with that state.
- Notice while connecting: a sleeping server (Render free tier) can take up to about 1 minute to wake up.
- Keepalive: server ping every 30 s, dead connections are closed.
- Rooms live only in memory (no database).
- **Room cleanup**: a room is deleted 30 minutes after its last player left (checked every 60 s). A room with at least one connected player is never deleted. A server restart removes all rooms.

### 7.4 Protocol (JSON over WebSocket)

Client → server:
| `t` | Content |
|---|---|
| `join` | `room`, `name`, `state?` (initial state if the room is new) |
| `action` | `move {cardId, to}` · `draw` · `undo` · `newGame {seed, drawCount, timePenalty}` |
| `cursor` | `x`, `y` |
| `drag` | `cards[]`, `x`, `y` (position of the top dragged card) |
| `dragEnd` | – |
| `ping` | – |

Server → client:
| `t` | Content |
|---|---|
| `welcome` | own `you` id, `room`, `state`, `players[]` |
| `state` | new `state`, `by` (who moved; missing if the action was rejected) |
| `players` | list `{id, name, color}` |
| `cursor` / `drag` / `dragEnd` | as above + `id` of the player |
| `error` | `message` |
| `pong` | – |

## 8. Deployment

### Frontend (GitHub Pages)
- Workflow on push to `main`: `npm ci` → `npm run build` → deploy `dist/`.
- `base: './'` so it runs under `https://<user>.github.io/<repo>/`.
- The server address is fixed at build time through the repository variable `VITE_SERVER_URL` (e.g. `wss://solitaire-mp.onrender.com`). Users cannot see or change it in the UI.
- Local development: `ws://localhost:8080` is used automatically on `localhost`; in GitHub Codespaces the address is derived from the forwarded port 8080.

### Server (Render)
- `Dockerfile` in the repo root, multi-stage, runtime image `node:22-alpine`, runs as user `node`.
- Port from `PORT` (set by Render), default 8080.
- `GET /health` → `ok` for the health check.
- `render.yaml` as blueprint (web service, Docker, free plan).

### Local
- `npm run dev` (frontend), `npm run server:dev` (server on `ws://localhost:8080`), or both with `npm run dev:all`.

## 9. Out of scope (v1)

- Accounts, leaderboards
- Rooms that survive a server restart
- Other solitaire variants (Spider, FreeCell)
- Sound
- Anti-cheat

## 10. Decisions

- Variant: Klondike, draw 1 or 3.
- Court cards: free artwork (Dmitry Fomin, CC0).
- Time penalty: configurable.
- Multiplayer rights: all players are equal (everyone may start a new game and undo).
- Joining by room code and invite link, no room list.
- Server address is not configurable in the UI.
- UI languages: English (default) and German.
