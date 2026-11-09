// Hints and game-over detection for Klondike.
//
// "Progress" = a hidden tableau card is revealed, or a card leaves stock/waste.
// Both can only happen a limited number of times. A hint is always the first
// move of a shortest path to progress, so following hints can never loop.
//
// The game is over when no sequence of legal moves leads to progress. This is
// decided by a breadth-first search over a compact copy of the game:
// - Inside the search, hidden cards stay hidden and stock/waste keep their
//   cards (both would be progress), so a search state is only the tableau
//   columns and the foundation heights.
// - Drawing does not depend on the tableau: stock and waste together always
//   form the same sequence. The set of cards that can come to the top of the
//   waste by drawing is computed once; a state is progress as soon as one of
//   these cards can be played there.
// - Columns are strings (one char per card), so copying and hashing are cheap.
// - A search that hits its limit counts as "not over": there is never a false
//   game over.

import {
  canMove, FOUNDATIONS, GameState, nextFinishMove, PileId, suitOf, TABLEAUS,
} from './klondike';

export type Hint = { type: 'move'; cardId: number; to: PileId } | { type: 'draw' };

/** Maximum number of states the search visits. */
let searchLimit = 200000;
/** For tests. */
export function setSearchLimit(n: number) { searchLimit = n; }

const CH0 = 48; // card id -> char code offset
const enc = (id: number) => String.fromCharCode(CH0 + id);
const rankOf = (c: number) => (c % 13) + 1;
const suitIdx = (c: number) => (c / 13) | 0;
const isRed = (c: number) => { const s = (c / 13) | 0; return s === 1 || s === 2; };

/**
 * Finds a useful move, or null if no progress is possible any more (game over).
 * Order: direct progress first, otherwise the first move of the shortest path to progress.
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
  // aces and twos always go up first (a shortest path never takes them back down,
  // so this cannot loop with the search below)
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
  // otherwise search
  const result = searchProgress(state, hidden);
  if (result !== 'unknown') return result;
  return stockCount ? { type: 'draw' } : null;
}

/** True when the game is not won and no progress is possible any more. */
export function isGameOver(state: GameState): boolean {
  return state.wonAt == null && findHint(state) === null;
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

interface Node {
  cols: string[];   // tableau columns, bottom first, hidden cards included
  found: number[];  // foundation heights per suit
  first: Hint | null; // first move of the path that leads here
}

function searchProgress(state: GameState, hidden: number[]): Hint | null | 'unknown' {
  const wasteTops = reachableWasteTops(state);
  const start: Node = {
    cols: TABLEAUS.map((t) => state.piles[t].map(enc).join('')),
    found: FOUNDATIONS.map((f) => state.piles[f].length),
    first: null,
  };
  const key = (n: Node) => n.found.join('') + '|' + n.cols.join('|');
  const seen = new Set<string>([key(start)]);
  const queue: Node[] = [start];

  const topOf = (col: string) => col.charCodeAt(col.length - 1) - CH0;
  const fitsCol = (c: number, col: string) => {
    if (col.length === 0) return rankOf(c) === 13;
    const p = topOf(col);
    return rankOf(p) === rankOf(c) + 1 && isRed(p) !== isRed(c);
  };
  const fitsFound = (c: number, found: number[]) => found[suitIdx(c)] === rankOf(c) - 1;

  for (let qi = 0; qi < queue.length; qi++) {
    const s = queue[qi];
    const add = (n: Node, move: Hint) => {
      const k = key(n);
      if (seen.has(k)) return;
      seen.add(k);
      n.first = s.first ?? move;
      queue.push(n);
    };

    // a card from stock/waste can be played here: draw until it is on top
    // (a playable waste top is direct progress and handled in findHint)
    for (const c of wasteTops) {
      if (fitsFound(c, s.found) || s.cols.some((col) => fitsCol(c, col))) return s.first ?? { type: 'draw' };
    }

    // tableau moves
    for (let a = 0; a < 7; a++) {
      const col = s.cols[a];
      for (let i = hidden[a]; i < col.length; i++) {
        const c = col.charCodeAt(i) - CH0;
        const reveals = i === hidden[a] && hidden[a] > 0;
        // to foundation (top card only)
        if (i === col.length - 1 && fitsFound(c, s.found)) {
          const move: Hint = { type: 'move', cardId: c, to: FOUNDATIONS[suitIdx(c)] };
          if (reveals) return s.first ?? move;
          const cols = s.cols.slice();
          cols[a] = col.slice(0, i);
          const found = s.found.slice();
          found[suitIdx(c)]++;
          add({ cols, found, first: null }, move);
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
          if (reveals) return s.first ?? move;
          const cols = s.cols.slice();
          cols[a] = col.slice(0, i);
          cols[b] = dest + col.slice(i);
          add({ cols, found: s.found, first: null }, move);
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
        const cols = s.cols.slice();
        cols[b] = dest + enc(c);
        const found = s.found.slice();
        found[f]--;
        add({ cols, found, first: null }, { type: 'move', cardId: c, to: TABLEAUS[b] });
      }
    }

    if (seen.size > searchLimit) return 'unknown';
  }
  return null;
}
