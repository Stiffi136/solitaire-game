import type { GameState } from '../../shared/klondike';
import type { ClientMsg, ServerMsg } from '../../shared/protocol';

export type NetStatus = 'connecting' | 'open' | 'reconnecting' | 'closed';

/** Accepts ws(s)://, http(s):// or a bare host and returns a ws(s):// URL. */
export function normalizeServerUrl(input: string): string {
  let u = input.trim().replace(/\/+$/, '');
  if (!u) return '';
  if (u.startsWith('https://')) u = 'wss://' + u.slice(8);
  else if (u.startsWith('http://')) u = 'ws://' + u.slice(7);
  else if (!/^wss?:\/\//.test(u)) u = (u.startsWith('localhost') || u.startsWith('127.') ? 'ws://' : 'wss://') + u;
  return u;
}

export class NetClient {
  onMessage: (m: ServerMsg) => void = () => {};
  onStatus: (s: NetStatus) => void = () => {};

  private ws: WebSocket | null = null;
  private retry = 0;
  private retryTimer = 0;
  private pingTimer = 0;
  private closedByUser = false;

  constructor(
    readonly url: string,
    readonly room: string,
    private name: string,
    private getState: () => GameState,
  ) {}

  connect() {
    this.closedByUser = false;
    this.onStatus(this.retry ? 'reconnecting' : 'connecting');
    let ws: WebSocket;
    try { ws = new WebSocket(this.url); } catch { this.scheduleRetry(); return; }
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.onStatus('open');
      this.send({ t: 'join', room: this.room, name: this.name, state: this.getState() });
      clearInterval(this.pingTimer);
      this.pingTimer = window.setInterval(() => this.send({ t: 'ping' }), 25000);
    };
    ws.onmessage = (ev) => {
      try { this.onMessage(JSON.parse(String(ev.data)) as ServerMsg); } catch { /* ignore */ }
    };
    ws.onclose = () => {
      clearInterval(this.pingTimer);
      if (this.ws !== ws) return;
      this.ws = null;
      if (this.closedByUser) this.onStatus('closed');
      else this.scheduleRetry();
    };
    ws.onerror = () => { /* onclose follows */ };
  }

  private scheduleRetry() {
    this.onStatus('reconnecting');
    const delay = Math.min(10000, 1000 * 2 ** this.retry++);
    this.retryTimer = window.setTimeout(() => this.connect(), delay);
  }

  send(m: ClientMsg) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  get connected() { return this.ws?.readyState === WebSocket.OPEN; }

  close() {
    this.closedByUser = true;
    clearTimeout(this.retryTimer);
    clearInterval(this.pingTimer);
    const ws = this.ws;
    this.ws = null;
    ws?.close();
    this.onStatus('closed');
  }
}

/** Sends at most every `ms`; the last call is always delivered unless cancelled. */
export function throttle<A extends unknown[]>(ms: number, fn: (...a: A) => void) {
  let last = 0, timer = 0, pending: A | null = null;
  const run = () => { timer = 0; last = performance.now(); if (pending) { const a = pending; pending = null; fn(...a); } };
  const call = (...a: A) => {
    pending = a;
    const wait = ms - (performance.now() - last);
    if (wait <= 0) { clearTimeout(timer); run(); }
    else if (!timer) timer = window.setTimeout(run, wait);
  };
  call.cancel = () => { clearTimeout(timer); timer = 0; pending = null; };
  return call;
}
