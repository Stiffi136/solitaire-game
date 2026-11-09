import './style.css';
import {
  Action, applyAction, canAutoFinish, createGame, displayScore, DrawCount, elapsedSeconds, findHint, Game,
  GameState, isGameOver, isValidState, newGame, nextFinishMove, randomSeed,
} from '../../shared/klondike';
import type { PlayerInfo, ServerMsg } from '../../shared/protocol';
import { NetClient, NetStatus, normalizeServerUrl, throttle } from './net';
import { TableRenderer } from './renderer';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

window.addEventListener('error', (e) => showFatal(String(e.message)));
function showFatal(msg: string) {
  const l = $('loading');
  l.hidden = false;
  l.classList.add('err');
  l.textContent = 'Fehler: ' + msg;
}

// ---------- settings & persistence ----------

interface Settings { drawCount: DrawCount; timePenalty: boolean; showScore: boolean; animations: boolean; name: string }
const SETTINGS_KEY = 'solitaire.settings';
const GAME_KEY = 'solitaire.game';
/** Multiplayer server, fixed at build time (VITE_SERVER_URL) or derived for local dev. */
const SERVER_URL = normalizeServerUrl((import.meta.env.VITE_SERVER_URL as string | undefined)
  || (location.hostname === 'localhost' || location.hostname === '127.0.0.1' ? 'ws://localhost:8080' : '')
  // GitHub Codespaces: <name>-5173.app.github.dev -> <name>-8080.app.github.dev
  || (location.hostname.endsWith('.app.github.dev') ? `wss://${location.hostname.replace(/-5173\./, '-8080.')}` : ''));
const settings: Settings = {
  drawCount: 1, timePenalty: true, showScore: true,
  animations: !matchMedia('(prefers-reduced-motion: reduce)').matches,
  name: '',
  ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'),
};
const saveSettings = () => localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));

function loadGame(): GameState | null {
  try {
    const s = JSON.parse(localStorage.getItem(GAME_KEY) || 'null');
    return isValidState(s) ? s : null;
  } catch { return null; }
}

const game: Game = createGame(loadGame() ?? newGame(randomSeed(), settings.drawCount, settings.timePenalty));
localStorage.setItem(GAME_KEY, JSON.stringify(game.state));

// ---------- networking state ----------

let net: NetClient | null = null;
let myId = '';
let online = false;
let pending = 0; // own actions not yet confirmed by the server
let players: PlayerInfo[] = [];

const sendCursor = throttle(50, (x: number, y: number) => net?.send({ t: 'cursor', x, y }));
const sendDrag = throttle(33, (cards: number[], x: number, y: number) => net?.send({ t: 'drag', cards, x, y }));

// ---------- renderer ----------

const renderer = new TableRenderer($<HTMLCanvasElement>('table'), {
  onAction: dispatch,
  onPointer: (x, y) => { if (online) sendCursor(x, y); },
  onDrag: (cards, x, y) => { if (online) sendDrag(cards, x, y); },
  onDragEnd: () => { if (online) { sendDrag.cancel(); net?.send({ t: 'dragEnd' }); } },
  onFrame: updateCursors,
  getInsets: () => ({ top: $('topbar').offsetHeight, bottom: $('bottombar').offsetHeight }),
});
renderer.animations = settings.animations;
if (import.meta.env.DEV) Object.assign(window, { __renderer: renderer, __game: game });
renderer.setState(game.state, { instant: true });
$('loading').hidden = true;

function dispatch(a: Action) {
  if (online && net) {
    if ((a.type === 'move' || a.type === 'draw') && applyAction(game, a)) {
      pending++;
      stateChanged();
    }
    net.send({ t: 'action', action: a });
    return;
  }
  if (applyAction(game, a)) stateChanged();
}

let lastWon = game.state.wonAt != null;
function stateChanged() {
  renderer.setState(game.state);
  if (!online) localStorage.setItem(GAME_KEY, JSON.stringify(game.state));
  updateHud();
  const won = game.state.wonAt != null;
  if (won && !lastWon) setTimeout(showWin, settings.animations ? 4500 : 200);
  lastWon = won;
  checkGameOver();
}

// Game over: checked shortly after the last change, shown once per state.
let overTimer = 0;
let overShownFor = -1;
function checkGameOver() {
  clearTimeout(overTimer);
  closeModal('dlg-over');
  overTimer = window.setTimeout(() => {
    const st = game.state;
    if (pending > 0 || st.version === overShownFor || !isGameOver(st)) return;
    overShownFor = st.version;
    $('over-stats').innerHTML = `Zeit <b>${fmtTime(elapsedSeconds(st))}</b> · Züge <b>${st.moves}</b>`
      + (settings.showScore ? ` · Punkte <b>${displayScore(st)}</b>` : '');
    openModal('dlg-over');
  }, 700);
}

// ---------- HUD ----------

const fmtTime = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

function updateHud() {
  const st = game.state;
  $('time').textContent = fmtTime(elapsedSeconds(st));
  $('moves').textContent = String(st.moves);
  $('score').textContent = String(displayScore(st));
  $('score-wrap').hidden = !settings.showScore;
  $<HTMLButtonElement>('btn-undo').disabled = !online && game.history.length === 0;
  $('btn-finish').hidden = !canAutoFinish(st);
}
setInterval(updateHud, 250);
updateHud();

let toastTimer = 0;
function toast(msg: string) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => t.classList.remove('show'), 2600);
}

// ---------- dialogs ----------

function openModal(id: string) { $(id).hidden = false; }
function closeModal(id: string) { $(id).hidden = true; }
document.querySelectorAll<HTMLElement>('.modal').forEach((m) => {
  m.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (target === m || target.closest('[data-close]')) m.hidden = true;
  });
});
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') document.querySelectorAll<HTMLElement>('.modal').forEach((m) => (m.hidden = true));
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !(e.target instanceof HTMLInputElement)) {
    e.preventDefault();
    dispatch({ type: 'undo' });
  }
});

function startNewGame() {
  closeModal('dlg-new'); closeModal('dlg-win'); closeModal('dlg-over');
  dispatch({ type: 'newGame', seed: randomSeed(), drawCount: settings.drawCount, timePenalty: settings.timePenalty });
}

$('btn-new').onclick = () => {
  const st = game.state;
  if (st.moves === 0 || st.wonAt != null) return startNewGame();
  $('new-text').textContent = online
    ? 'Das laufende Spiel geht für alle im Raum verloren.'
    : 'Das laufende Spiel geht verloren.';
  openModal('dlg-new');
};
$('new-confirm').onclick = startNewGame;
$('win-new').onclick = startNewGame;
$('over-new').onclick = startNewGame;
$('over-undo').onclick = () => { closeModal('dlg-over'); dispatch({ type: 'undo' }); };
$('btn-undo').onclick = () => dispatch({ type: 'undo' });
$('btn-hint').onclick = () => {
  const h = findHint(game.state);
  if (h) renderer.showHint(h);
  else toast(game.state.wonAt != null ? 'Schon gewonnen!' : 'Keine Züge mehr möglich.');
};

let finishing = 0;
$('btn-finish').onclick = () => {
  if (finishing) return;
  finishing = window.setInterval(() => {
    const m = nextFinishMove(game.state);
    if (!m) { clearInterval(finishing); finishing = 0; return; }
    dispatch({ type: 'move', ...m });
  }, settings.animations ? 110 : 10);
};

function showWin() {
  const st = game.state;
  $('win-stats').innerHTML = `Zeit <b>${fmtTime(elapsedSeconds(st))}</b> · Züge <b>${st.moves}</b>`
    + (settings.showScore ? ` · Punkte <b>${displayScore(st)}</b>` : '');
  openModal('dlg-win');
}

// settings dialog
$('btn-settings').onclick = () => {
  document.querySelectorAll<HTMLInputElement>('input[name=draw]').forEach((r) => (r.checked = Number(r.value) === settings.drawCount));
  $<HTMLInputElement>('set-penalty').checked = settings.timePenalty;
  $<HTMLInputElement>('set-score').checked = settings.showScore;
  $<HTMLInputElement>('set-anim').checked = settings.animations;
  openModal('dlg-settings');
};
$('dlg-settings').addEventListener('change', () => {
  const d = document.querySelector<HTMLInputElement>('input[name=draw]:checked');
  settings.drawCount = d?.value === '3' ? 3 : 1;
  settings.timePenalty = $<HTMLInputElement>('set-penalty').checked;
  settings.showScore = $<HTMLInputElement>('set-score').checked;
  settings.animations = $<HTMLInputElement>('set-anim').checked;
  renderer.animations = settings.animations;
  saveSettings();
  updateHud();
});

$('btn-help').onclick = () => openModal('dlg-help');

// fullscreen
const fsBtn = $('btn-fs');
if (!document.fullscreenEnabled) fsBtn.hidden = true;
fsBtn.onclick = () => {
  if (document.fullscreenElement) void document.exitFullscreen();
  else void document.documentElement.requestFullscreen().catch(() => toast('Vollbild nicht möglich.'));
};
document.addEventListener('fullscreenchange', () => renderer.resize());

// ---------- multiplayer UI ----------

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const randomCode = () => Array.from({ length: 5 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
const cleanCode = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);

function inviteLink(room: string) {
  const u = new URL(location.href);
  u.search = '';
  u.hash = '';
  u.searchParams.set('room', room);
  return u.toString();
}

function renderMpDialog() {
  const inRoom = !!net;
  $('mp-form').hidden = inRoom;
  $('mp-room-view').hidden = !inRoom;
  if (!inRoom) {
    $<HTMLInputElement>('mp-name').value ||= settings.name;
    return;
  }
  $('mp-code').textContent = net!.room;
  $<HTMLInputElement>('mp-link').value = inviteLink(net!.room);
  const ul = $('mp-players');
  ul.innerHTML = '';
  for (const p of players) {
    const li = document.createElement('li');
    const dot = document.createElement('i');
    dot.style.background = p.color;
    li.append(dot, document.createTextNode(p.name + (p.id === myId ? ' (du)' : '')));
    ul.append(li);
  }
}

function renderPlayers() {
  const box = $('players');
  box.innerHTML = '';
  if (!online) return;
  for (const p of players) {
    const chip = document.createElement('div');
    chip.className = 'chip';
    chip.title = p.name;
    const dot = document.createElement('i');
    dot.style.background = p.color;
    const name = document.createElement('span');
    name.textContent = p.id === myId ? `${p.name} (du)` : p.name;
    chip.append(dot, name);
    box.append(chip);
  }
}

// without a configured server there is no multiplayer
if (!SERVER_URL) $('btn-mp').hidden = true;
$('btn-mp').onclick = () => { renderMpDialog(); openModal('dlg-mp'); };

function readForm(): { name: string; server: string } | null {
  const name = $<HTMLInputElement>('mp-name').value.trim().slice(0, 20);
  if (!name) { toast('Bitte gib einen Namen ein.'); $('mp-name').focus(); return null; }
  settings.name = name;
  saveSettings();
  return { name, server: SERVER_URL };
}

$('mp-create').onclick = () => {
  const f = readForm();
  if (f) connect(f.server, randomCode(), f.name);
};
$('mp-join').onclick = () => {
  const f = readForm();
  const room = cleanCode($<HTMLInputElement>('mp-room').value);
  if (!f) return;
  if (!room) { toast('Bitte gib einen Raumcode ein.'); $('mp-room').focus(); return; }
  connect(f.server, room, f.name);
};
$('mp-leave').onclick = () => { leave(); renderMpDialog(); };
$('mp-copy').onclick = async () => {
  const link = $<HTMLInputElement>('mp-link').value;
  try {
    if (navigator.share && matchMedia('(pointer: coarse)').matches) await navigator.share({ title: 'Solitaire', url: link });
    else { await navigator.clipboard.writeText(link); toast('Link kopiert.'); }
  } catch {
    $<HTMLInputElement>('mp-link').select();
  }
};

function setStatus(s: NetStatus) {
  const dot = $('mp-dot');
  dot.className = s === 'open' ? 'on' : s === 'closed' ? '' : 'wait';
  $('mp-status').textContent = { connecting: 'verbinde…', open: 'verbunden', reconnecting: 'Verbindung verloren, verbinde neu…', closed: 'getrennt' }[s];
  $('mp-wake').hidden = !(s === 'connecting' || s === 'reconnecting');
  if (s !== 'open' && online) { online = false; renderer.clearAllRemote(); clearCursors(); renderPlayers(); }
}

function connect(server: string, room: string, name: string) {
  leave();
  net = new NetClient(server, room, name, () => game.state);
  net.onStatus = setStatus;
  net.onMessage = onServerMessage;
  net.connect();
  const u = new URL(location.href);
  u.searchParams.set('room', room);
  history.replaceState(null, '', u);
  renderMpDialog();
}

function leave() {
  if (!net) return;
  const n = net;
  net = null;
  n.close();
  online = false;
  pending = 0;
  players = [];
  renderer.clearAllRemote();
  clearCursors();
  renderPlayers();
  const u = new URL(location.href);
  u.searchParams.delete('room');
  history.replaceState(null, '', u);
  // keep playing the shared game alone
  game.history = [];
  localStorage.setItem(GAME_KEY, JSON.stringify(game.state));
  updateHud();
}

function onServerMessage(m: ServerMsg) {
  switch (m.t) {
    case 'welcome':
      myId = m.you;
      online = true;
      pending = 0;
      players = m.players;
      game.state = m.state;
      game.history = [];
      lastWon = m.state.wonAt != null;
      renderer.setState(game.state);
      updateHud(); renderPlayers(); renderMpDialog(); checkGameOver();
      toast(`Verbunden mit Raum ${m.room}`);
      break;
    case 'state': {
      if (m.by === myId || m.by === undefined) pending = Math.max(0, pending - 1);
      if (m.by === myId && pending > 0) break; // newer local state is already shown
      game.state = m.state;
      game.history = [];
      stateChanged();
      break;
    }
    case 'players': {
      const prev = players;
      players = m.players;
      for (const p of m.players) if (!prev.some((q) => q.id === p.id) && p.id !== myId) toast(`${p.name} ist beigetreten`);
      for (const p of prev) if (!m.players.some((q) => q.id === p.id)) { removeCursor(p.id); renderer.clearRemoteDrag(p.id); }
      renderPlayers(); renderMpDialog();
      break;
    }
    case 'cursor': setCursor(m.id, m.x, m.y); break;
    case 'drag': renderer.setRemoteDrag(m.id, m.cards, m.x, m.y); break;
    case 'dragEnd': renderer.clearRemoteDrag(m.id); break;
    case 'error': toast(m.message); break;
  }
}

// ---------- remote cursors ----------

interface RemoteCursor { el: HTMLElement; x: number; y: number; cx: number; cy: number; seen: number }
const cursors = new Map<string, RemoteCursor>();

function setCursor(id: string, x: number, y: number) {
  let c = cursors.get(id);
  if (!c) {
    const p = players.find((q) => q.id === id);
    if (!p) return;
    const el = document.createElement('div');
    el.className = 'rcursor';
    el.innerHTML = `<svg viewBox="0 0 24 24"><path d="M3 2l7.5 19 2.6-7.9L21 10.5z"/></svg><span></span>`;
    el.querySelector('path')!.setAttribute('fill', p.color);
    const label = el.querySelector('span')!;
    label.textContent = p.name;
    label.style.background = p.color;
    $('cursors').append(el);
    c = { el, x, y, cx: x, cy: y, seen: 0 };
    cursors.set(id, c);
  }
  c.x = x; c.y = y; c.seen = performance.now();
}

function updateCursors() {
  const now = performance.now();
  for (const c of cursors.values()) {
    c.cx += (c.x - c.cx) * 0.35;
    c.cy += (c.y - c.cy) * 0.35;
    const p = renderer.worldToClient(c.cx, c.cy);
    c.el.style.transform = `translate(${p.x - 3}px, ${p.y - 2}px)`;
    c.el.style.opacity = now - c.seen > 15000 ? '0' : '1';
  }
}
function removeCursor(id: string) { cursors.get(id)?.el.remove(); cursors.delete(id); }
function clearCursors() { for (const id of [...cursors.keys()]) removeCursor(id); }

// ---------- invite link ----------

{
  const params = new URLSearchParams(location.search);
  const room = cleanCode(params.get('room') || '');
  if (room && SERVER_URL) {
    $<HTMLInputElement>('mp-room').value = room;
    if (settings.name) connect(SERVER_URL, room, settings.name);
    else { renderMpDialog(); openModal('dlg-mp'); }
  }
}

// a saved game may already be over
checkGameOver();
