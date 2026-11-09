// Klondike rules. Pure functions, shared by client and server.

export type PileId =
  | 'stock' | 'waste'
  | 'f0' | 'f1' | 'f2' | 'f3'
  | 't0' | 't1' | 't2' | 't3' | 't4' | 't5' | 't6';

export const FOUNDATIONS = ['f0', 'f1', 'f2', 'f3'] as const;
export const TABLEAUS = ['t0', 't1', 't2', 't3', 't4', 't5', 't6'] as const;
export const ALL_PILES: PileId[] = ['stock', 'waste', ...FOUNDATIONS, ...TABLEAUS];

/** Suit order: 0 ♠, 1 ♥, 2 ♦, 3 ♣. Foundation fN only takes suit N. */
export const SUIT_SYMBOLS = ['♠', '♥', '♦', '♣'];
export const RANK_LABELS = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

/** Card id = suit * 13 + (rank - 1), 0..51. */
export const suitOf = (id: number) => Math.floor(id / 13);
export const rankOf = (id: number) => (id % 13) + 1;
export const isRed = (id: number) => { const s = suitOf(id); return s === 1 || s === 2; };

export type DrawCount = 1 | 3;

export interface GameState {
  piles: Record<PileId, number[]>; // bottom first
  faceUp: boolean[];               // indexed by card id
  seed: number;
  drawCount: DrawCount;
  timePenalty: boolean;
  moves: number;
  score: number;      // move-based score (without time penalty / bonus)
  recycles: number;   // how often waste went back to stock
  startedAt: number | null; // ms epoch, set on first action
  wonAt: number | null;
  version: number;    // increments on every change
}

export type Action =
  | { type: 'move'; cardId: number; to: PileId }
  | { type: 'draw' }
  | { type: 'undo' }
  | { type: 'newGame'; seed: number; drawCount: DrawCount; timePenalty: boolean }
  /** Cheats: "win" puts all cards on the foundations, "lose" deals a hopeless game. */
  | { type: 'cheat'; cheat: 'win' | 'lose' };

export interface Game { state: GameState; history: GameState[] }

const HISTORY_LIMIT = 200;

export function randomSeed(): number {
  return Math.floor(Math.random() * 0x7fffffff);
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function emptyPiles(): Record<PileId, number[]> {
  const p = {} as Record<PileId, number[]>;
  for (const id of ALL_PILES) p[id] = [];
  return p;
}

export function newGame(seed: number, drawCount: DrawCount = 1, timePenalty = true): GameState {
  const rand = mulberry32(seed);
  const deck = Array.from({ length: 52 }, (_, i) => i);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  const piles = emptyPiles();
  const faceUp = new Array<boolean>(52).fill(false);
  for (let col = 0; col < 7; col++) {
    for (let k = 0; k <= col; k++) piles[TABLEAUS[col]].push(deck.pop()!);
    faceUp[piles[TABLEAUS[col]][col]] = true;
  }
  piles.stock = deck;
  return {
    piles, faceUp, seed, drawCount, timePenalty,
    moves: 0, score: 0, recycles: 0, startedAt: null, wonAt: null, version: 0,
  };
}

export function createGame(state: GameState): Game {
  return { state, history: [] };
}

export function findCard(state: GameState, id: number): { pile: PileId; index: number } | null {
  for (const pile of ALL_PILES) {
    const index = state.piles[pile].indexOf(id);
    if (index >= 0) return { pile, index };
  }
  return null;
}

const isTableau = (p: PileId) => p[0] === 't';
const isFoundation = (p: PileId) => p[0] === 'f';
const top = (arr: number[]) => arr[arr.length - 1];

/** Cards that move together when `id` is picked up, or null if it cannot be picked up. */
export function movableStack(state: GameState, id: number): number[] | null {
  const loc = findCard(state, id);
  if (!loc) return null;
  const pile = state.piles[loc.pile];
  if (loc.pile === 'stock') return null;
  if (isTableau(loc.pile)) return state.faceUp[id] ? pile.slice(loc.index) : null;
  return loc.index === pile.length - 1 ? [id] : null;
}

export function canMove(state: GameState, id: number, to: PileId): boolean {
  const loc = findCard(state, id);
  if (!loc || loc.pile === to || to === 'stock' || to === 'waste') return false;
  const stack = movableStack(state, id);
  if (!stack) return false;
  const dest = state.piles[to];
  if (isFoundation(to)) {
    if (stack.length !== 1) return false;
    if (suitOf(id) !== Number(to[1])) return false;
    return dest.length === 0 ? rankOf(id) === 1 : rankOf(top(dest)) === rankOf(id) - 1;
  }
  // tableau
  if (dest.length === 0) return rankOf(id) === 13;
  const t = top(dest);
  return state.faceUp[t] && isRed(t) !== isRed(id) && rankOf(t) === rankOf(id) + 1;
}

export function isWon(state: GameState): boolean {
  return FOUNDATIONS.every((f) => state.piles[f].length === 13);
}

/** Elapsed seconds of play. */
export function elapsedSeconds(state: GameState, now = Date.now()): number {
  if (state.startedAt == null) return 0;
  return Math.max(0, Math.floor(((state.wonAt ?? now) - state.startedAt) / 1000));
}

/** Score shown to the player: move score, time penalty, win bonus. */
export function displayScore(state: GameState, now = Date.now()): number {
  const secs = elapsedSeconds(state, now);
  let s = state.score;
  if (state.timePenalty) s -= Math.floor(secs / 10) * 2;
  s = Math.max(0, s);
  if (state.wonAt != null && secs > 30) s += Math.floor(700000 / secs);
  return s;
}

function addScore(state: GameState, delta: number) {
  state.score = Math.max(0, state.score + delta);
}

function clone(state: GameState): GameState {
  return {
    piles: Object.fromEntries(
      ALL_PILES.map((p) => [p, [...state.piles[p]]]),
    ) as Record<PileId, number[]>,
    faceUp: [...state.faceUp],
    seed: state.seed,
    drawCount: state.drawCount,
    timePenalty: state.timePenalty,
    moves: state.moves,
    score: state.score,
    recycles: state.recycles,
    startedAt: state.startedAt,
    wonAt: state.wonAt,
    version: state.version,
  };
}

/** Applies an action. Returns false (and changes nothing) if it is not allowed. */
export function applyAction(game: Game, action: Action): boolean {
  try {
    return applyInner(game, action);
  } catch {
    return false;
  }
}

function applyInner(game: Game, action: Action): boolean {
  const cur = game.state;
  switch (action?.type) {
    case 'newGame': {
      const dc: DrawCount = action.drawCount === 3 ? 3 : 1;
      const seed = Number.isFinite(action.seed) ? Math.floor(action.seed) : randomSeed();
      game.state = newGame(seed, dc, action.timePenalty !== false);
      game.state.version = cur.version + 1;
      game.history = [];
      return true;
    }
    case 'cheat': {
      if (action.cheat === 'win') {
        if (cur.wonAt != null) return false;
        const next = clone(cur);
        for (const p of ALL_PILES) next.piles[p] = [];
        FOUNDATIONS.forEach((f, suit) => { next.piles[f] = Array.from({ length: 13 }, (_, r) => suit * 13 + r); });
        next.faceUp.fill(true);
        commit(game, next);
        return true;
      }
      if (action.cheat === 'lose') {
        const next = hopelessGame(cur);
        commit(game, next);
        next.moves = 0;
        return true;
      }
      return false;
    }
    case 'undo': {
      const prev = game.history.pop();
      if (!prev) return false;
      prev.version = cur.version + 1;
      game.state = prev;
      return true;
    }
    case 'draw': {
      if (cur.wonAt != null) return false;
      if (cur.piles.stock.length === 0 && cur.piles.waste.length === 0) return false;
      const next = clone(cur);
      if (next.piles.stock.length === 0) {
        next.piles.stock = next.piles.waste.reverse();
        next.piles.waste = [];
        for (const id of next.piles.stock) next.faceUp[id] = false;
        next.recycles++;
        if (next.drawCount === 1) addScore(next, -100);
        else if (next.recycles > 3) addScore(next, -20);
      } else {
        for (let i = 0; i < next.drawCount && next.piles.stock.length; i++) {
          const id = next.piles.stock.pop()!;
          next.faceUp[id] = true;
          next.piles.waste.push(id);
        }
      }
      commit(game, next);
      return true;
    }
    case 'move': {
      if (cur.wonAt != null) return false;
      const { cardId, to } = action;
      if (!ALL_PILES.includes(to) || !canMove(cur, cardId, to)) return false;
      const next = clone(cur);
      const from = findCard(next, cardId)!;
      const src = next.piles[from.pile];
      const stack = src.splice(from.index);
      next.piles[to].push(...stack);
      // scoring
      if (from.pile === 'waste' && isTableau(to)) addScore(next, 5);
      else if (from.pile === 'waste' && isFoundation(to)) addScore(next, 10);
      else if (isTableau(from.pile) && isFoundation(to)) addScore(next, 10);
      else if (isFoundation(from.pile) && isTableau(to)) addScore(next, -15);
      // reveal
      if (isTableau(from.pile) && src.length && !next.faceUp[top(src)]) {
        next.faceUp[top(src)] = true;
        addScore(next, 5);
      }
      commit(game, next);
      return true;
    }
    default:
      return false;
  }
}

/**
 * A deal in which no move is possible at all:
 * - the 7 face-up tableau cards are all red, so none fits on another;
 * - all aces and every black card that could go on a red top card are hidden;
 * - the stock holds only cards that fit nowhere (no aces, only red cards and
 *   black cards that do not fit on the red tops).
 */
function hopelessGame(cur: GameState): GameState {
  const rand = mulberry32((cur.seed ^ 0x5eed) + cur.version);
  const shuffle = <T>(a: T[]) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const all = Array.from({ length: 52 }, (_, i) => i);
  const reds = all.filter((c) => isRed(c) && rankOf(c) > 1);
  const tops = shuffle(reds.filter((c) => rankOf(c) >= 6)).slice(0, 7);
  const topRanks = new Set(tops.map(rankOf));
  const mustHide = all.filter((c) => !tops.includes(c) && (rankOf(c) === 1 || (!isRed(c) && topRanks.has(rankOf(c) + 1))));
  const free = shuffle(all.filter((c) => !tops.includes(c) && !mustHide.includes(c)));
  const hiddenCards = shuffle([...mustHide, ...free.slice(0, 21 - mustHide.length)]);
  const stock = free.slice(21 - mustHide.length);
  const st = newGame(cur.seed, cur.drawCount, cur.timePenalty);
  for (const p of ALL_PILES) st.piles[p] = [];
  st.faceUp.fill(false);
  let h = 0;
  TABLEAUS.forEach((t, col) => {
    for (let k = 0; k < col; k++) st.piles[t].push(hiddenCards[h++]);
    st.piles[t].push(tops[col]);
    st.faceUp[tops[col]] = true;
  });
  st.piles.stock = stock;
  st.version = cur.version;
  return st;
}

function commit(game: Game, next: GameState) {
  const now = Date.now();
  next.moves++;
  next.version++;
  if (next.startedAt == null) next.startedAt = now;
  if (isWon(next)) next.wonAt = now;
  game.history.push(game.state);
  if (game.history.length > HISTORY_LIMIT) game.history.shift();
  game.state = next;
}

/** Best target when a card is tapped: foundation first, then tableau. */
export function findAutoMove(state: GameState, id: number): PileId | null {
  const loc = findCard(state, id);
  if (!loc) return null;
  const f = FOUNDATIONS[suitOf(id)];
  if (canMove(state, id, f)) return f;
  let empty: PileId | null = null;
  for (const t of TABLEAUS) {
    if (!canMove(state, id, t)) continue;
    if (state.piles[t].length) return t;
    // moving a king from the bottom of a column to another empty column is useless
    if (!(isTableau(loc.pile) && loc.index === 0)) empty ??= t;
  }
  return empty;
}

/** True when stock and waste are empty and every card is face up. */
export function canAutoFinish(state: GameState): boolean {
  if (state.wonAt != null) return false;
  if (state.piles.stock.length || state.piles.waste.length) return false;
  return TABLEAUS.every((t) => state.piles[t].every((id) => state.faceUp[id]));
}

/** Next card for auto finish: the lowest rank that fits a foundation. */
export function nextFinishMove(state: GameState): { cardId: number; to: PileId } | null {
  let best: { cardId: number; to: PileId } | null = null;
  for (const t of TABLEAUS) {
    const pile = state.piles[t];
    if (!pile.length) continue;
    const id = top(pile);
    const f = FOUNDATIONS[suitOf(id)];
    if (canMove(state, id, f) && (!best || rankOf(id) < rankOf(best.cardId))) best = { cardId: id, to: f };
  }
  return best;
}

/** Loose structural check for states sent by clients. */
export function isValidState(s: unknown): s is GameState {
  if (!s || typeof s !== 'object') return false;
  const st = s as GameState;
  if (!st.piles || !Array.isArray(st.faceUp) || st.faceUp.length !== 52) return false;
  const seen = new Set<number>();
  for (const p of ALL_PILES) {
    const arr = st.piles[p];
    if (!Array.isArray(arr)) return false;
    for (const id of arr) {
      if (!Number.isInteger(id) || id < 0 || id > 51 || seen.has(id)) return false;
      seen.add(id);
    }
  }
  return seen.size === 52 && (st.drawCount === 1 || st.drawCount === 3)
    && typeof st.score === 'number' && typeof st.moves === 'number';
}
