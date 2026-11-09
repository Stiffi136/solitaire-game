import './style.css';
import {
  Action, applyAction, canAutoFinish, createGame, displayScore, DrawCount, elapsedSeconds, Game,
  GameState, isValidState, newGame, nextFinishMove, randomSeed,
} from '../../shared/klondike';
import { SolverClient } from './solverClient';
import type { PlayerInfo, ServerMsg } from '../../shared/protocol';
import { NetClient, NetStatus, normalizeServerUrl, throttle } from './net';
import { TableRenderer } from './renderer';
import { applyStatic, Lang, setLang, t } from './i18n';

const CHEAT_LABEL = { win: 'cheatWin', lose: 'cheatLose', hard: 'cheatHard' } as const;

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

window.addEventListener('error', (e) => showFatal(String(e.message)));
function showFatal(msg: string) {
  const l = $('loading');
  l.hidden = false;
  l.classList.add('err');
  l.textContent = t('error', { msg });
}

// ---------- settings & persistence ----------

interface Settings { drawCount: DrawCount; timePenalty: boolean; showScore: boolean; animations: boolean; name: string; lang: Lang }
const SETTINGS_KEY = 'solitaire.settings';
/** sessionStorage: room of this tab, to rejoin after a reload. */
const ACTIVE_ROOM_KEY = 'solitaire.activeRoom';
const GAME_KEY = 'solitaire.game';
/** Multiplayer server, fixed at build time (VITE_SERVER_URL) or derived for local dev. */
const SERVER_URL = normalizeServerUrl((import.meta.env.VITE_SERVER_URL as string | undefined)
  || (location.hostname === 'localhost' || location.hostname === '127.0.0.1' ? 'ws://localhost:8080' : '')
  // GitHub Codespaces: <name>-5173.app.github.dev -> <name>-8080.app.github.dev
  || (location.hostname.endsWith('.app.github.dev') ? `wss://${location.hostname.replace(/-5173\./, '-8080.')}` : ''));
const settings: Settings = {
  drawCount: 1, timePenalty: true, showScore: true,
  animations: !matchMedia('(prefers-reduced-motion: reduce)').matches,
  name: '', lang: 'en',
  ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'),
};
const saveSettings = () => localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
setLang(settings.lang);
applyStatic();

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
  setHintState('idle');
}

// Hint and game over. The search runs only when the hint button is pressed
// (in a worker). The button shows the state: idle, searching, or "no moves".
const solver = new SolverClient();
type HintState = 'idle' | 'busy' | 'over';
let hintState: HintState = 'idle';
function setHintState(s: HintState) {
  hintState = s;
  const btn = $<HTMLButtonElement>('btn-hint');
  btn.dataset.state = s;
  btn.setAttribute('aria-busy', String(s === 'busy'));
  const key = s === 'busy' ? 'searching' : s === 'over' ? 'noMovesShort' : 'hint';
  btn.querySelector('.lbl')!.setAttribute('data-i18n', key);
  btn.querySelector('.lbl')!.textContent = t(key);
  btn.title = t(key);
  if (s !== 'over') closeModal('dlg-over');
}

function showGameOver() {
  $<HTMLButtonElement>('over-undo').disabled = !online && game.history.length === 0;
  $('over-stats').innerHTML = statsLine(game.state);
  openModal('dlg-over');
}

async function onHint() {
  const st = game.state;
  if (st.wonAt != null) return toast(t('alreadyWon'));
  if (hintState === 'busy') return;
  if (hintState === 'over') return showGameOver();
  setHintState('busy');
  const h = await solver.hint(st);
  if (game.state !== st) return; // the game changed meanwhile; stateChanged() reset the button
  if (h === undefined) return setHintState('idle');
  if (h) {
    setHintState('idle');
    renderer.showHint(h);
  } else {
    setHintState('over');
    showGameOver();
  }
}

// ---------- HUD ----------

const statsLine = (st: GameState) => `${t('time')} <b>${fmtTime(elapsedSeconds(st))}</b> · ${t('moves')} <b>${st.moves}</b>`
  + (settings.showScore ? ` · ${t('score')} <b>${displayScore(st)}</b>` : '');
const fmtTime = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

function updateHud() {
  const st = game.state;
  renderCheatMark();
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
    if ((target === m && !m.hasAttribute('data-static')) || target.closest('[data-close]')) m.hidden = true;
  });
});
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') document.querySelectorAll<HTMLElement>('.modal:not([data-static])').forEach((m) => (m.hidden = true));
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
  $('new-text').textContent = t(online ? 'newGameTextOnline' : 'newGameText');
  openModal('dlg-new');
};
$('new-confirm').onclick = startNewGame;
$('win-new').onclick = startNewGame;
$('over-new').onclick = startNewGame;
$('over-undo').onclick = () => { closeModal('dlg-over'); dispatch({ type: 'undo' }); };
$('btn-undo').onclick = () => dispatch({ type: 'undo' });
$('btn-hint').onclick = () => void onHint();

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
  $('win-stats').innerHTML = statsLine(st);
  openModal('dlg-win');
}

// settings dialog
$('btn-settings').onclick = () => {
  document.querySelectorAll<HTMLInputElement>('input[name=draw]').forEach((r) => (r.checked = Number(r.value) === settings.drawCount));
  $<HTMLInputElement>('set-penalty').checked = settings.timePenalty;
  $<HTMLInputElement>('set-score').checked = settings.showScore;
  $<HTMLInputElement>('set-anim').checked = settings.animations;
  document.querySelectorAll<HTMLInputElement>('input[name=lang]').forEach((r) => (r.checked = r.value === settings.lang));
  openModal('dlg-settings');
};
$('dlg-settings').addEventListener('change', () => {
  const d = document.querySelector<HTMLInputElement>('input[name=draw]:checked');
  settings.drawCount = d?.value === '3' ? 3 : 1;
  settings.timePenalty = $<HTMLInputElement>('set-penalty').checked;
  settings.showScore = $<HTMLInputElement>('set-score').checked;
  settings.animations = $<HTMLInputElement>('set-anim').checked;
  renderer.animations = settings.animations;
  const l = document.querySelector<HTMLInputElement>('input[name=lang]:checked')?.value as Lang | undefined;
  if (l && l !== settings.lang) { settings.lang = l; setLang(l); applyStatic(); refreshTexts(); }
  saveSettings();
  updateHud();
});

$('btn-help').onclick = () => openModal('dlg-help');

// cheats
for (const cheat of ['win', 'lose', 'hard'] as const) {
  $(`cheat-${cheat}`).onclick = () => {
    document.querySelectorAll<HTMLElement>('.modal').forEach((m) => (m.hidden = true));
    dispatch({ type: 'cheat', cheat });
  };
}

/** Shows the cheat mark in the top bar and in the result dialogs. */
function cheatList(st: GameState) { return (st.cheats ?? []).map((c) => t(CHEAT_LABEL[c])).join(', '); }

function renderCheatMark() {
  const st = game.state;
  const used = !!st.cheats?.length;
  const badge = $('cheat-badge');
  badge.hidden = !used;
  badge.querySelector('span')!.textContent = t('cheatBadge');
  badge.title = used ? t('cheatNote', { list: cheatList(st) }) : '';
  document.querySelectorAll<HTMLElement>('.cheat-note').forEach((p) => {
    p.hidden = !used;
    p.textContent = used ? t('cheatNote', { list: cheatList(st) }) : '';
  });
}

// fullscreen
const fsBtn = $('btn-fs');
if (!document.fullscreenEnabled) fsBtn.hidden = true;
fsBtn.onclick = () => {
  if (document.fullscreenElement) void document.exitFullscreen();
  else void document.documentElement.requestFullscreen().catch(() => toast(t('fullscreenFailed')));
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
  $('mp-share').hidden = !canShare;
  $<HTMLInputElement>('mp-link').value = inviteLink(net!.room);
  const ul = $('mp-players');
  ul.innerHTML = '';
  for (const p of players) {
    const li = document.createElement('li');
    const dot = document.createElement('i');
    dot.style.background = p.color;
    li.append(dot, document.createTextNode(p.name + (p.id === myId ? ` ${t('you')}` : '')));
    ul.append(li);
  }
}

function renderPlayers() {
  const box = $('players');
  box.innerHTML = '';
  $('btn-share').hidden = !(online && canShare);
  if (!online) return;
  for (const p of players) {
    const chip = document.createElement('div');
    chip.className = 'chip';
    chip.title = p.name;
    const dot = document.createElement('i');
    dot.style.background = p.color;
    const name = document.createElement('span');
    name.textContent = p.id === myId ? `${p.name} ${t('you')}` : p.name;
    chip.append(dot, name);
    box.append(chip);
  }
}

// without a configured server there is no multiplayer
if (!SERVER_URL) $('btn-mp').hidden = true;
$('btn-mp').onclick = () => { renderMpDialog(); openModal('dlg-mp'); };

function readForm(): { name: string; server: string } | null {
  const name = $<HTMLInputElement>('mp-name').value.trim().slice(0, 20);
  if (!name) { toast(t('enterName')); $('mp-name').focus(); return null; }
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
  if (!room) { toast(t('enterRoom')); $('mp-room').focus(); return; }
  connect(f.server, room, f.name);
};
$('mp-leave').onclick = () => { leave(); renderMpDialog(); };
// Invite: native share sheet (WhatsApp, Signal, SMS …) where the browser has one, else copy.
const canShare = typeof navigator.share === 'function';

async function copyInvite() {
  if (!net) return;
  const link = inviteLink(net.room);
  try {
    await navigator.clipboard.writeText(link);
    toast(t('linkCopied'));
  } catch {
    // no clipboard access (e.g. insecure context): let the user copy by hand
    renderMpDialog();
    openModal('dlg-mp');
    $<HTMLInputElement>('mp-link').select();
  }
}

async function shareInvite() {
  if (!net) return;
  const data: ShareData = { title: 'Solitaire', text: t('shareText', { room: net.room }), url: inviteLink(net.room) };
  if (!canShare || (navigator.canShare && !navigator.canShare(data))) return copyInvite();
  try {
    await navigator.share(data);
  } catch (e) {
    // AbortError = the user closed the share sheet; anything else: fall back to copying
    if ((e as DOMException)?.name !== 'AbortError') await copyInvite();
  }
}

$('mp-copy').onclick = () => void copyInvite();
$('mp-share').onclick = () => void shareInvite();
$('btn-share').onclick = () => void shareInvite();

let netStatus: NetStatus = 'closed';
function setStatus(s: NetStatus) {
  netStatus = s;
  const dot = $('mp-dot');
  dot.className = s === 'open' ? 'on' : s === 'closed' ? '' : 'wait';
  $('mp-status').textContent = t(`st_${s}`);
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
  sessionStorage.setItem(ACTIVE_ROOM_KEY, room);
  renderMpDialog();
}

function leave() {
  if (!net) return;
  sessionStorage.removeItem(ACTIVE_ROOM_KEY);
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
      updateHud(); renderPlayers(); renderMpDialog(); setHintState('idle');
      toast(t('connectedTo', { room: m.room }));
      break;
    case 'state': {
      // tell everyone when a teammate cheats
      const before = game.state.cheats?.length ?? 0;
      const after = m.state.cheats ?? [];
      if (m.by && m.by !== myId && after.length > before) {
        const who = players.find((p) => p.id === m.by)?.name ?? '?';
        toast(t('cheatUsedBy', { name: who, cheat: t(CHEAT_LABEL[after[after.length - 1]]) }));
      }
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
      for (const p of m.players) if (!prev.some((q) => q.id === p.id) && p.id !== myId) toast(t('playerJoined', { name: p.name }));
      for (const p of prev) if (!m.players.some((q) => q.id === p.id)) { removeCursor(p.id); renderer.clearRemoteDrag(p.id); }
      renderPlayers(); renderMpDialog();
      break;
    }
    case 'cursor': setCursor(m.id, m.x, m.y); break;
    case 'drag': renderer.setRemoteDrag(m.id, m.cards, m.x, m.y); break;
    case 'dragEnd': renderer.clearRemoteDrag(m.id); break;
    case 'error': toast(m.message === 'Invalid room code' ? t('invalidRoom') : m.message); break;
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
// Opening …/?room=CODE shows a short dialog: enter a name and join, or play alone.
// After a reload inside a room (same tab) the player rejoins directly.

function removeRoomParam() {
  const u = new URL(location.href);
  u.searchParams.delete('room');
  history.replaceState(null, '', u);
}

function showInvite(room: string) {
  $('invite-code').textContent = room;
  const name = $<HTMLInputElement>('invite-name');
  name.value = settings.name;
  openModal('dlg-invite');
  // focusing on touch devices would pop up the keyboard over the dialog
  if (!settings.name && !matchMedia('(pointer: coarse)').matches) name.focus();
}

$('invite-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const room = $('invite-code').textContent || '';
  const input = $<HTMLInputElement>('invite-name');
  const name = input.value.trim().slice(0, 20);
  if (!name) { toast(t('enterName')); input.focus(); return; }
  settings.name = name;
  saveSettings();
  closeModal('dlg-invite');
  connect(SERVER_URL, room, name);
});

$('invite-solo').onclick = () => {
  closeModal('dlg-invite');
  removeRoomParam();
  startNewGame();
};

{
  const room = cleanCode(new URLSearchParams(location.search).get('room') || '');
  if (room && SERVER_URL) {
    if (sessionStorage.getItem(ACTIVE_ROOM_KEY) === room && settings.name) connect(SERVER_URL, room, settings.name);
    else showInvite(room);
  } else if (room) {
    removeRoomParam(); // no multiplayer server in this build
  }
}

/** Re-renders texts that are built in code (after a language change). */
function refreshTexts() {
  setStatus(netStatus);
  renderMpDialog();
  renderPlayers();
  setHintState(hintState);
  if (!$('dlg-over').hidden) $('over-stats').innerHTML = statsLine(game.state);
  if (!$('dlg-win').hidden) $('win-stats').innerHTML = statsLine(game.state);
}

