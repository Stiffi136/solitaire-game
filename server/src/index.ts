import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { Game, Action, createGame, newGame, randomSeed, applyAction, isValidState } from '../../shared/klondike';
import { ClientMsg, ServerMsg, PlayerInfo } from '../../shared/protocol';

const PORT = parseInt(process.env.PORT ?? '8080', 10);
const MAX_PAYLOAD = 64 * 1024;
const COLORS = ['#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6', '#1abc9c', '#e67e22', '#c0392b'];

interface Player {
  id: string;
  name: string;
  color: string;
  ws: WebSocket;
}

interface Room {
  code: string;
  game: Game;
  players: Map<string, Player>;
  emptySince?: number;
}

const rooms = new Map<string, Room>();
let nextId = 0;

// Utility functions
function generatePlayerId(): string {
  return `p_${++nextId}_${Math.random().toString(36).slice(2, 9)}`;
}

function getAvailableColor(room: Room): string {
  const usedColors = new Set([...room.players.values()].map(p => p.color));
  for (const c of COLORS) {
    if (!usedColors.has(c)) return c;
  }
  return COLORS[Math.floor(Math.random() * COLORS.length)];
}

function getPlayersInfo(room: Room): PlayerInfo[] {
  return [...room.players.values()].map(p => ({ id: p.id, name: p.name, color: p.color }));
}

function sendToRoom(room: Room, msg: ServerMsg, except?: string) {
  const data = JSON.stringify(msg);
  for (const [id, player] of room.players) {
    if (except && id === except) continue;
    if (player.ws.readyState === WebSocket.OPEN) {
      player.ws.send(data);
    }
  }
}

function sendToAll(room: Room, msg: ServerMsg) {
  const data = JSON.stringify(msg);
  for (const player of room.players.values()) {
    if (player.ws.readyState === WebSocket.OPEN) {
      player.ws.send(data);
    }
  }
}

function handleMessage(ws: WebSocket, player: Player | null, room: Room | null, msg: unknown) {
  if (!msg || typeof msg !== 'object') return;
  const m = msg as ClientMsg;

  try {
    switch (m.t) {

      case 'action': {
        if (!player || !room) return;
        const action = m.action as Action;
        const result = applyAction(room.game, action);
        if (result) {
          sendToAll(room, { t: 'state', state: room.game.state, by: player.id } as ServerMsg);
        } else {
          ws.send(JSON.stringify({ t: 'state', state: room.game.state } as ServerMsg));
        }
        break;
      }

      case 'cursor': {
        if (!player || !room) return;
        const x = m.x, y = m.y;
        if (!Number.isFinite(x) || !Number.isFinite(y)) return;
        sendToRoom(room, { t: 'cursor', id: player.id, x, y } as ServerMsg, player.id);
        break;
      }

      case 'drag': {
        if (!player || !room) return;
        if (!Array.isArray(m.cards) || !m.cards.every(c => Number.isInteger(c))) return;
        if (!Number.isFinite(m.x) || !Number.isFinite(m.y)) return;
        sendToRoom(room, { t: 'drag', id: player.id, cards: m.cards, x: m.x, y: m.y } as ServerMsg, player.id);
        break;
      }

      case 'dragEnd': {
        if (!player || !room) return;
        sendToRoom(room, { t: 'dragEnd', id: player.id } as ServerMsg, player.id);
        break;
      }

      case 'ping': {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ t: 'pong' } as ServerMsg));
        }
        break;
      }
    }
  } catch (err) {
    console.error('Message error:', err);
  }
}

// HTTP server
const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.method === 'GET') {
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('ok');
    } else {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('Solitaire Multiplayer Server');
    }
  } else {
    res.writeHead(404);
    res.end();
  }
});

// WebSocket server
const wss = new WebSocketServer({ server, maxPayload: MAX_PAYLOAD });

interface ClientData {
  player: Player | null;
  room: Room | null;
}

wss.on('connection', (ws: WebSocket & { isAlive?: boolean }) => {
  const data: ClientData = { player: null, room: null };
  console.log('connect');
  ws.isAlive = true;

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString('utf-8'));
      if (msg.t === 'join') {
        const roomCode = String(msg.room ?? '').toUpperCase().slice(0, 12);
        if (!roomCode || !/^[A-Z0-9]+$/.test(roomCode)) {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ t: 'error', message: 'Invalid room code' } as ServerMsg));
          }
          return;
        }
        // Leave current room if in one
        if (data.player && data.room) {
          data.room.players.delete(data.player.id);
          if (data.room.players.size === 0) data.room.emptySince = Date.now();
          sendToAll(data.room, { t: 'dragEnd', id: data.player.id } as ServerMsg);
          sendToRoom(data.room, { t: 'players', players: getPlayersInfo(data.room) } as ServerMsg);
          console.log(`leave ${data.player.name} from ${data.room.code}`);
        }
        // Get or create room
        let newRoom = rooms.get(roomCode);
        if (!newRoom) {
          const gameState = isValidState(msg.state) ? msg.state : newGame(randomSeed(), 1, true);
          newRoom = {
            code: roomCode,
            game: createGame(gameState),
            players: new Map(),
          };
          rooms.set(roomCode, newRoom);
        }
        // Add player
        const newPlayer: Player = {
          id: generatePlayerId(),
          name: String(msg.name ?? 'Gast').trim().slice(0, 20) || 'Gast',
          color: getAvailableColor(newRoom),
          ws,
        };
        newRoom.players.set(newPlayer.id, newPlayer);
        delete newRoom.emptySince;
        data.player = newPlayer;
        data.room = newRoom;
        const playersInfo = getPlayersInfo(newRoom);
        ws.send(JSON.stringify({
          t: 'welcome',
          you: newPlayer.id,
          room: roomCode,
          state: newRoom.game.state,
          players: playersInfo,
        } as ServerMsg));
        sendToRoom(newRoom, { t: 'players', players: playersInfo } as ServerMsg, newPlayer.id);
        console.log(`join ${newPlayer.name} to ${roomCode}`);
      } else {
        handleMessage(ws, data.player, data.room, msg);
      }
    } catch (err) {
      // Invalid JSON, ignore
    }
  });

  ws.on('close', () => {
    if (data.player && data.room) {
      data.room.players.delete(data.player.id);
      if (data.room.players.size === 0) {
        data.room.emptySince = Date.now();
      } else {
        sendToAll(data.room, { t: 'dragEnd', id: data.player.id } as ServerMsg);
        sendToRoom(data.room, { t: 'players', players: getPlayersInfo(data.room) } as ServerMsg);
      }
      console.log(`leave ${data.player.name} from ${data.room.code}`);
    }
  });

  ws.on('pong', () => {
    ws.isAlive = true;
  });
});

// Keepalive and cleanup
setInterval(() => {
  // Ping all clients
  wss.clients.forEach((ws: WebSocket & { isAlive?: boolean }) => {
    if (ws.isAlive === false) {
      ws.terminate();
      return;
    }
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

// Clean up empty rooms
setInterval(() => {
  const now = Date.now();
  const thirtyMins = 30 * 60 * 1000;
  for (const [code, room] of rooms) {
    if (room.emptySince && now - room.emptySince > thirtyMins) {
      rooms.delete(code);
      console.log(`delete empty room ${code}`);
    }
  }
}, 60000);

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
