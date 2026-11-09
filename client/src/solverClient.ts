import type { GameState } from '../../shared/klondike';
import { findHint, type Hint } from '../../shared/solver';

/**
 * Asks the solver (in a Web Worker) for a hint. A new request cancels the one
 * that is still running. Resolves to undefined when cancelled.
 * Falls back to the main thread if workers are not available.
 */
export class SolverClient {
  private worker: Worker | null = null;
  private nextId = 1;
  private pending: { id: number; resolve: (h: Hint | null | undefined) => void } | null = null;

  hint(state: GameState): Promise<Hint | null | undefined> {
    if (typeof Worker === 'undefined') return Promise.resolve(findHint(state));
    if (this.pending) {
      // cancel the running search
      this.pending.resolve(undefined);
      this.pending = null;
      this.worker?.terminate();
      this.worker = null;
    }
    const w = this.worker ??= this.create();
    const id = this.nextId++;
    return new Promise((resolve) => {
      this.pending = { id, resolve };
      w.postMessage({ id, state });
    });
  }

  private create() {
    const w = new Worker(new URL('./solver.worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent<{ id: number; hint: Hint | null }>) => {
      if (this.pending?.id !== e.data.id) return;
      const p = this.pending;
      this.pending = null;
      p.resolve(e.data.hint);
    };
    w.onerror = () => {
      const p = this.pending;
      this.pending = null;
      this.worker = null;
      p?.resolve(undefined);
    };
    return w;
  }
}
