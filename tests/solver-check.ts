// Checks the hint / game-over solver. Run: npm run test:solver
// 1. A bot that always follows the hint must end (win or game over) and never get an illegal hint.
// 2. Game-over states are checked with an independent search over all legal moves:
//    there must be no false game over.
import {
  ALL_PILES, applyAction, canMove, createGame, GameState, movableStack, newGame, TABLEAUS,
} from '../shared/klondike';
import { findHint, isGameOver } from '../shared/solver';

const SEEDS = 100;
const overStates: GameState[] = [];
let failed = false;

for (const dc of [1, 3] as const) {
  let wins = 0, over = 0, open = 0, slowest = 0;
  for (let seed = 0; seed < SEEDS; seed++) {
    const g = createGame(newGame(seed, dc, true));
    const t0 = Date.now();
    for (let step = 0; step < 1500 && Date.now() - t0 < 5000; step++) {
      const a = performance.now();
      const h = findHint(g.state);
      slowest = Math.max(slowest, performance.now() - a);
      if (!h) break;
      const ok = applyAction(g, h.type === 'draw' ? { type: 'draw' } : { type: 'move', cardId: h.cardId, to: h.to });
      if (!ok) { console.error(`illegal hint, seed ${seed}:`, h); failed = true; break; }
    }
    if (g.state.wonAt != null) wins++;
    else if (isGameOver(g.state)) { over++; overStates.push(g.state); }
    else open++; // search limit reached: not declared over (allowed, but should be rare)
  }
  console.log(`draw ${dc}: ${wins} won, ${over} game over, ${open} undecided, slowest hint ${slowest.toFixed(0)} ms`);
  if (open > SEEDS * 0.02) { console.error('too many undecided games'); failed = true; }
}

const hidden = (s: GameState) => TABLEAUS.reduce((n, t) => n + s.piles[t].filter((id) => !s.faceUp[id]).length, 0);
const stock = (s: GameState) => s.piles.stock.length + s.piles.waste.length;
let checked = 0, falsePos = 0;
for (const start of overStates.slice(0, 20)) {
  const h0 = hidden(start), s0 = stock(start);
  const seen = new Set([JSON.stringify(start.piles)]);
  const queue = [start];
  let found = false;
  for (let qi = 0; qi < queue.length && !found && seen.size < 100000; qi++) {
    const s = queue[qi];
    const acts: Parameters<typeof applyAction>[1][] = [{ type: 'draw' }];
    for (let id = 0; id < 52; id++) if (movableStack(s, id)) for (const p of ALL_PILES) if (canMove(s, id, p)) acts.push({ type: 'move', cardId: id, to: p });
    for (const a of acts) {
      const g = { state: s, history: [] as GameState[] };
      if (!applyAction(g, a)) continue;
      const k = JSON.stringify(g.state.piles);
      if (seen.has(k)) continue;
      seen.add(k);
      if (hidden(g.state) < h0 || stock(g.state) < s0 || g.state.wonAt != null) { found = true; break; }
      queue.push(g.state);
    }
  }
  checked++;
  if (found) { falsePos++; failed = true; }
}
console.log(`independent check: ${checked} game-over states, ${falsePos} false game over`);
if (failed) { console.error('FAILED'); process.exit(1); }
console.log('OK');
