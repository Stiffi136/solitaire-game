// Hints and game-over detection for Klondike.
//
// "Progress" = a hidden tableau card is revealed, or a card leaves stock/waste.
// Both can only happen a limited number of times.
//
// The game is over when no sequence of legal moves leads to progress. This is
// decided by searching a compact copy of the game:
// - Inside the search, hidden cards stay hidden and stock/waste keep their
//   cards (both would be progress), so a search state is only the tableau
//   columns and the foundation heights.
// - Drawing does not change the tableau: stock and waste together always form
//   the same sequence. The cards that can come to the top of the waste by
//   drawing are computed once; a state is progress as soon as one of them can
//   be played there.
// - Columns are strings (one char per card); visited states are stored as
//   64-bit hashes in a typed-array hash set, so memory stays small.
//
// Two stages:
// 1. Breadth-first search (up to BFS_LIMIT states). Returns the first move of a
//    shortest path to progress, so following hints cannot loop. Enough for
//    almost all positions.
// 2. If that is not enough: depth-first search (up to DFS_LIMIT states) with
//    low memory use. It proves game over in very large positions. If it finds
//    a path, the whole path is remembered and the next hints follow it.
// A search that hits its limit counts as "not over": no false game over
// (apart from a hash collision, probability below 1e-6).

import {
  applyAction, canMove, createGame, FOUNDATIONS, GameState, nextFinishMove, PileId, suitOf, TABLEAUS,
} from './klondike';

export type Hint = { type: 'move'; cardId: number; to: PileId } | { type: 'draw' };

let BFS_LIMIT = 200000;
let DFS_LIMIT = 4000000;
/** For tests. */
export function setSearchLimits(bfs: number, dfs: number) { BFS_LIMIT = bfs; DFS_LIMIT = dfs; }

const CH0 = 48; // card id -> char code offset
const enc = (id: number) => String.fromCharCode(CH0 + id);
const rankOf = (c: number) => (c % 13) + 1;
const suitIdx = (c: number) => (c / 13) | 0;
const isRed = (c: number) => { const s = (c / 13) | 0; return s === 1 || s === 2; };

// ---------------------------------------------------------------------------
// public API
// ---------------------------------------------------------------------------

/**
 * Finds a useful move, or null if no progress is possible any more (game over).
 */
export function findHint(state: GameState): Hint | null {
  if (state.wonAt != null) return null;
  const hidden = TABLEAUS.map((t) => state.piles[t].filter((id) => !state.faceUp[id]).length);
  const stockCount = state.piles.stock.length + state.piles.waste.length;
  const top = (a: number[]) => a[a.length - 1];

  // everything visible: only the foundations are left
  if (stockCount === 0 && hidden.every((h) => h === 0)) {
    const m = nextFinishMove(state);
    if (m) return { type: 'move', ...m };
  }
  // direct progress: play the waste card
  const waste = state.piles.waste;
  if (waste.length) {
    const id = top(waste);
    const f = FOUNDATIONS[suitOf(id)];
    if (canMove(state, id, f)) return { type: 'move', cardId: id, to: f };
    for (const t of TABLEAUS) if (canMove(state, id, t)) return { type: 'move', cardId: id, to: t };
  }
  // aces and twos always go up first (a shortest path never takes them back down)
  for (const t of TABLEAUS) {
    const pile = state.piles[t];
    if (!pile.length) continue;
    const id = top(pile);
    const f = FOUNDATIONS[suitOf(id)];
    if (rankOf(id) <= 2 && canMove(state, id, f)) return { type: 'move', cardId: id, to: f };
  }
  // direct progress: reveal a hidden card
  for (let c = 0; c < 7; c++) {
    const pile = state.piles[TABLEAUS[c]];
    const h = hidden[c];
    if (h === 0 || h >= pile.length) continue;
    const id = pile[h];
    const f = FOUNDATIONS[suitOf(id)];
    if (h === pile.length - 1 && canMove(state, id, f)) return { type: 'move', cardId: id, to: f };
    for (const t of TABLEAUS) if (canMove(state, id, t)) return { type: 'move', cardId: id, to: t };
  }
  // a remembered path from an earlier deep search
  const planned = followPlan(state);
  if (planned) return planned;

  const ctx = makeContext(state, hidden);
  const bfs = bfsProgress(ctx);
  if (bfs !== 'unknown') return bfs;
  const path = dfsProgress(ctx);
  if (path === null) return null;
  if (path === 'unknown') return stockCount ? { type: 'draw' } : null;
  rememberPlan(state, path);
  return path[0];
}

/** True when the game is not won and no progress is possible any more. */
export function isGameOver(state: GameState): boolean {
  return state.wonAt == null && findHint(state) === null;
}

// ---------------------------------------------------------------------------
// remembered plan (only used after a deep search)
// ---------------------------------------------------------------------------

let plan: { keys: string[]; moves: Hint[] } | null = null;
const stateKey = (s: GameState) => JSON.stringify(s.piles) + s.faceUp.map(Number).join('');

function followPlan(state: GameState): Hint | null {
  if (!plan) return null;
  const i = plan.keys.indexOf(stateKey(state));
  if (i < 0) { plan = null; return null; }
  return plan.moves[i];
}

function rememberPlan(state: GameState, path: Hint[]) {
  const keys: string[] = [];
  const moves: Hint[] = [];
  const g = createGame(JSON.parse(JSON.stringify(state)) as GameState);
  for (const m of path) {
    if (m.type === 'draw') break; // drawing to the right card is found again quickly
    keys.push(stateKey(g.state));
    moves.push(m);
    if (!applyAction(g, m)) break;
  }
  plan = keys.length ? { keys, moves } : null;
}

// ---------------------------------------------------------------------------
// search
// ---------------------------------------------------------------------------

interface Node { cols: string[]; found: number[] }

interface Context {
  hidden: number[];
  wasteTops: number[];
  root: Node;
}

function makeContext(state: GameState, hidden: number[]): Context {
  return {
    hidden,
    wasteTops: reachableWasteTops(state),
    root: {
      cols: TABLEAUS.map((t) => state.piles[t].map(enc).join('')),
      found: FOUNDATIONS.map((f) => state.piles[f].length),
    },
  };
}

/** Cards that can be on top of the waste now or after some draws. */
function reachableWasteTops(state: GameState): number[] {
  const seq = [...state.piles.waste, ...[...state.piles.stock].reverse()];
  if (!seq.length) return [];
  const dc = state.drawCount;
  const tops = new Set<number>();
  let w = state.piles.waste.length;
  // two full passes visit every reachable position
  for (let i = 0; i < 2 * (Math.ceil(seq.length / dc) + 2); i++) {
    if (w > 0) tops.add(seq[w - 1]);
    w = w === seq.length ? 0 : Math.min(seq.length, w + dc);
  }
  return [...tops];
}

const topOf = (col: string) => col.charCodeAt(col.length - 1) - CH0;
const fitsCol = (c: number, col: string) => {
  if (col.length === 0) return rankOf(c) === 13;
  const p = topOf(col);
  return rankOf(p) === rankOf(c) + 1 && isRed(p) !== isRed(c);
};
const fitsFound = (c: number, found: number[]) => found[suitIdx(c)] === rankOf(c) - 1;

/** Can a card from stock/waste be played in this node? */
const wastePlayable = (ctx: Context, n: Node) =>
  ctx.wasteTops.some((c) => fitsFound(c, n.found) || n.cols.some((col) => fitsCol(c, col)));

/** A child of a node: the move, the new node, or progress (then node is null). */
interface Child { move: Hint; node: Node | null; code: number }

/**
 * Enumerates all useful moves of a node. Calls `visit` for each child; stops
 * when `visit` returns true. Moves that reveal a card are reported with node null.
 * With build = false, child nodes are not built (node is then the parent, only
 * the code is meaningful).
 */
function forEachChild(ctx: Context, s: Node, visit: (c: Child) => boolean, build = true): boolean {
  const hidden = ctx.hidden;
  for (let a = 0; a < 7; a++) {
    const col = s.cols[a];
    for (let i = hidden[a]; i < col.length; i++) {
      const c = col.charCodeAt(i) - CH0;
      const reveals = i === hidden[a] && hidden[a] > 0;
      // to foundation (top card only)
      if (i === col.length - 1 && fitsFound(c, s.found)) {
        const move: Hint = { type: 'move', cardId: c, to: FOUNDATIONS[suitIdx(c)] };
        let node: Node | null = null;
        if (!reveals && build) {
          const cols = s.cols.slice();
          cols[a] = col.slice(0, i);
          const found = s.found.slice();
          found[suitIdx(c)]++;
          node = { cols, found };
        }
        if (visit({ move, node: reveals ? null : node ?? s, code: a | (i << 3) | (7 << 9) })) return true;
      }
      // to another column
      let triedEmpty = false;
      for (let b = 0; b < 7; b++) {
        if (b === a) continue;
        const dest = s.cols[b];
        if (dest.length === 0) {
          // all empty columns are equal; moving a whole column to an empty one is useless
          if (triedEmpty || i === 0) continue;
          triedEmpty = true;
        }
        if (!fitsCol(c, dest)) continue;
        const move: Hint = { type: 'move', cardId: c, to: TABLEAUS[b] };
        let node: Node | null = null;
        if (!reveals && build) {
          const cols = s.cols.slice();
          cols[a] = col.slice(0, i);
          cols[b] = dest + col.slice(i);
          node = { cols, found: s.found };
        }
        if (visit({ move, node: reveals ? null : node ?? s, code: a | (i << 3) | (b << 9) })) return true;
      }
    }
  }
  // foundation back to tableau
  for (let f = 0; f < 4; f++) {
    if (s.found[f] === 0) continue;
    const c = f * 13 + s.found[f] - 1;
    let triedEmpty = false;
    for (let b = 0; b < 7; b++) {
      const dest = s.cols[b];
      if (dest.length === 0) { if (triedEmpty) continue; triedEmpty = true; }
      if (!fitsCol(c, dest)) continue;
      const code = (1 << 20) | f | (b << 9);
      const node = build ? applyCode(s, code).node : s;
      if (visit({ move: { type: 'move', cardId: c, to: TABLEAUS[b] }, node, code })) return true;
    }
  }
  return false;
}

/** Breadth-first search: first move of a shortest path to progress. */
function bfsProgress(ctx: Context): Hint | null | 'unknown' {
  if (wastePlayable(ctx, ctx.root)) return { type: 'draw' };
  const seen = new HashSet64();
  seen.add(ctx.root);
  let queue: { n: Node; first: Hint | null }[] = [{ n: ctx.root, first: null }];
  while (queue.length) {
    const next: typeof queue = [];
    for (const { n, first } of queue) {
      let result: Hint | null = null;
      const stop = forEachChild(ctx, n, ({ move, node }) => {
        const f = first ?? move;
        if (!node) { result = f; return true; }
        if (!seen.add(node)) return false;
        if (wastePlayable(ctx, node)) { result = f; return true; }
        next.push({ n: node, first: f });
        return false;
      });
      if (stop) return result;
      if (seen.size > BFS_LIMIT) return 'unknown';
    }
    queue = next; // the previous level can be freed
  }
  return null;
}

/**
 * Depth-first search with low memory: a path to progress, null, or 'unknown'.
 * Each stack frame keeps its node and the remaining moves as small integer codes;
 * a child node is only built when it is visited.
 */
function dfsProgress(ctx: Context): Hint[] | null | 'unknown' {
  const seen = new HashSet64();
  seen.add(ctx.root);
  const stack: { node: Node; codes: Int32Array; i: number; move: Hint | null }[] = [];
  const path = () => stack.slice(1).map((f) => f.move!);
  /** Pushes a frame; returns a path if one of the moves reveals a card. */
  const expand = (node: Node, move: Hint | null): Hint[] | null => {
    const codes: number[] = [];
    let win: Hint | null = null;
    forEachChild(ctx, node, ({ move: m, node: child, code }) => {
      if (!child) { win = m; return true; }
      codes.push(code);
      return false;
    }, false);
    stack.push({ node, codes: Int32Array.from(codes), i: 0, move });
    return win ? [...path(), win] : null;
  };
  const first = expand(ctx.root, null);
  if (first) return first;
  while (stack.length) {
    const fr = stack[stack.length - 1];
    if (fr.i >= fr.codes.length) { stack.pop(); continue; }
    const code = fr.codes[fr.i++];
    const { node, move } = applyCode(fr.node, code);
    if (!seen.add(node)) continue;
    if (seen.size > DFS_LIMIT) return 'unknown';
    if (wastePlayable(ctx, node)) return [...path(), move, { type: 'draw' }];
    const found = expand(node, move);
    if (found) return found;
  }
  return null;
}

// Move codes: tableau move = a | i << 3 | b << 9 (b = 7: foundation),
// foundation back = 1 << 20 | f | b << 9.
function applyCode(s: Node, code: number): { node: Node; move: Hint } {
  const b = (code >> 9) & 7;
  if (code & (1 << 20)) {
    const f = code & 7;
    const c = f * 13 + s.found[f] - 1;
    const cols = s.cols.slice();
    cols[b] = cols[b] + enc(c);
    const found = s.found.slice();
    found[f]--;
    return { node: { cols, found }, move: { type: 'move', cardId: c, to: TABLEAUS[b] } };
  }
  const a = code & 7, i = (code >> 3) & 63;
  const col = s.cols[a];
  const c = col.charCodeAt(i) - CH0;
  const cols = s.cols.slice();
  cols[a] = col.slice(0, i);
  if (b === 7) {
    const found = s.found.slice();
    found[suitIdx(c)]++;
    return { node: { cols, found }, move: { type: 'move', cardId: c, to: FOUNDATIONS[suitIdx(c)] } };
  }
  cols[b] = s.cols[b] + col.slice(i);
  return { node: { cols, found: s.found }, move: { type: 'move', cardId: c, to: TABLEAUS[b] } };
}

// ---------------------------------------------------------------------------
// 64-bit hash set for nodes (open addressing on typed arrays)
// ---------------------------------------------------------------------------

class HashSet64 {
  private hi = new Int32Array(1 << 16);
  private lo = new Int32Array(1 << 16);
  private used = new Uint8Array(1 << 16);
  size = 0;

  /** Adds the node; returns false if it was already there. */
  add(n: Node): boolean {
    let h1 = 0x811c9dc5 | 0, h2 = 0x2545f491 | 0;
    const mix = (x: number) => {
      h1 = Math.imul(h1 ^ x, 0x01000193);
      h2 = Math.imul(h2 ^ x, 0x5bd1e995);
      h2 ^= h2 >>> 13;
    };
    for (let f = 0; f < 4; f++) mix(n.found[f] + 200);
    for (let c = 0; c < 7; c++) {
      const col = n.cols[c];
      for (let k = 0; k < col.length; k++) mix(col.charCodeAt(k));
      mix(300 + c);
    }
    if (this.size * 2 >= this.used.length) this.grow();
    return this.insert(h1, h2);
  }

  private insert(h1: number, h2: number): boolean {
    const mask = this.used.length - 1;
    let i = (h1 ^ (h2 >>> 7)) & mask;
    while (this.used[i]) {
      if (this.hi[i] === h1 && this.lo[i] === h2) return false;
      i = (i + 1) & mask;
    }
    this.used[i] = 1;
    this.hi[i] = h1;
    this.lo[i] = h2;
    this.size++;
    return true;
  }

  private grow() {
    const { hi, lo, used } = this;
    const n = used.length * 2;
    this.hi = new Int32Array(n);
    this.lo = new Int32Array(n);
    this.used = new Uint8Array(n);
    this.size = 0;
    for (let i = 0; i < used.length; i++) if (used[i]) this.insert(hi[i], lo[i]);
  }
}
