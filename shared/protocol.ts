import type { Action, GameState } from './klondike';

export interface PlayerInfo { id: string; name: string; color: string }

/** x/y are table (world) coordinates, the same on every screen. */
export type ClientMsg =
  | { t: 'join'; room: string; name: string; state?: GameState }
  | { t: 'action'; action: Action }
  | { t: 'cursor'; x: number; y: number }
  | { t: 'drag'; cards: number[]; x: number; y: number }
  | { t: 'dragEnd' }
  | { t: 'ping' };

export type ServerMsg =
  | { t: 'welcome'; you: string; room: string; state: GameState; players: PlayerInfo[] }
  | { t: 'state'; state: GameState; by?: string }
  | { t: 'players'; players: PlayerInfo[] }
  | { t: 'cursor'; id: string; x: number; y: number }
  | { t: 'drag'; id: string; cards: number[]; x: number; y: number }
  | { t: 'dragEnd'; id: string }
  | { t: 'error'; message: string }
  | { t: 'pong' };
