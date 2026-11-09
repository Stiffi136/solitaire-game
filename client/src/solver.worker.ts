// Runs the hint / game-over search off the main thread.
import type { GameState } from '../../shared/klondike';
import { findHint } from '../../shared/solver';

self.onmessage = (e: MessageEvent<{ id: number; state: GameState }>) => {
  const { id, state } = e.data;
  let hint = null;
  try { hint = findHint(state); } catch { /* treat as "no result" */ }
  (self as unknown as Worker).postMessage({ id, hint });
};
