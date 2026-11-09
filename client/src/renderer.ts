import * as THREE from 'three';
import {
  Action, canMove, findAutoMove, findCard, FOUNDATIONS, GameState, movableStack, PileId, rankOf, TABLEAUS,
} from '../../shared/klondike';
import type { Hint } from '../../shared/solver';
import * as tex from './textures';

export const CARD_W = 1;
export const CARD_H = 1.4;
const COL = 1.18;
const ROW_GAP = 0.32;
const TAB_Y = -(CARD_H + ROW_GAP);
const FAN_DOWN = 0.17;
const FAN_UP = 0.36;
const WASTE_FAN = 0.26;
const MARGIN = 0.2;
const MAX_PX_PER_UNIT = 190;

const colX = (i: number) => (i - 3) * COL;

export function pileBase(p: PileId): { x: number; y: number } {
  if (p === 'stock') return { x: colX(0), y: 0 };
  if (p === 'waste') return { x: colX(1), y: 0 };
  if (p[0] === 'f') return { x: colX(3 + Number(p[1])), y: 0 };
  return { x: colX(Number(p[1])), y: TAB_Y };
}

interface Target { x: number; y: number; z: number; faceUp: boolean; shadow: boolean }
interface Fly { x: number; y: number; vx: number; vy: number; delay: number; z: number; launched: boolean }
interface CardView {
  id: number;
  group: THREE.Group;
  shadow: THREE.Mesh;
  pos: THREE.Vector3;
  flip: number;
  fly: Fly | null;
}
interface Drag {
  cards: number[];
  offX: number; offY: number;
  startX: number; startY: number;
  x: number; y: number;
  active: boolean;
}

export interface RendererCallbacks {
  onAction(a: Action): void;
  onPointer(x: number, y: number): void;
  onDrag(cards: number[], x: number, y: number): void;
  onDragEnd(): void;
  onFrame(): void;
  getInsets(): { top: number; bottom: number };
}

export class TableRenderer {
  readonly view = { left: -5, right: 5, top: 5, bottom: -5 };
  animations = true;

  private gl: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-5, 5, 5, -5, 0.1, 100);
  private cards: CardView[] = [];
  private state: GameState | null = null;
  private targets = new Map<number, Target>();
  private remote = new Map<string, { cards: number[]; x: number; y: number }>();
  private drag: Drag | null = null;
  private down: { kind: 'stock' | 'card' | 'none'; x: number; y: number } | null = null;
  private felt: THREE.Mesh;
  private glows: THREE.Mesh[] = [];
  private glowUntil = 0;
  private cascading = false;
  private lastFrame = performance.now();

  constructor(private canvas: HTMLCanvasElement, private cb: RendererCallbacks) {
    this.gl = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.gl.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.gl.outputColorSpace = THREE.SRGBColorSpace;
    tex.setMaxAnisotropy(this.gl.capabilities.getMaxAnisotropy());
    this.camera.position.set(0, 0, 50);

    this.felt = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: tex.feltTexture() }));
    this.felt.position.z = -1;
    this.scene.add(this.felt);

    this.buildSlots();
    this.buildCards();
    this.buildGlows();

    window.addEventListener('resize', () => this.resize());
    canvas.addEventListener('pointerdown', (e) => this.onDown(e));
    canvas.addEventListener('pointermove', (e) => this.onMove(e));
    canvas.addEventListener('pointerup', (e) => this.onUp(e));
    canvas.addEventListener('pointercancel', () => this.cancelDrag());
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    this.resize();
    this.gl.setAnimationLoop(() => this.frame());
  }

  // ---------- scene setup ----------

  private buildSlots() {
    const geo = new THREE.PlaneGeometry(CARD_W, CARD_H);
    const add = (p: PileId, t: THREE.Texture) => {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false }));
      const b = pileBase(p);
      m.position.set(b.x, b.y, 0);
      this.scene.add(m);
    };
    add('stock', tex.slotTexture('redeal'));
    add('waste', tex.slotTexture(null));
    FOUNDATIONS.forEach((f, i) => add(f, tex.slotTexture(i)));
    const empty = tex.slotTexture(null);
    TABLEAUS.forEach((t) => add(t, empty));
  }

  private buildCards() {
    const geo = new THREE.PlaneGeometry(CARD_W, CARD_H);
    const backMat = new THREE.MeshBasicMaterial({ map: tex.backTexture(), alphaTest: 0.5 });
    const shadowGeo = new THREE.PlaneGeometry(CARD_W * tex.SHADOW_PAD_FRAC.x, CARD_H * tex.SHADOW_PAD_FRAC.y);
    const shadowMat = new THREE.MeshBasicMaterial({ map: tex.shadowTexture(), transparent: true, opacity: 0.35, depthWrite: false });
    for (let id = 0; id < 52; id++) {
      const group = new THREE.Group();
      const front = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex.cardTexture(id), alphaTest: 0.5 }));
      const back = new THREE.Mesh(geo, backMat);
      back.rotation.y = Math.PI;
      group.add(front, back);
      const shadow = new THREE.Mesh(shadowGeo, shadowMat);
      this.scene.add(group, shadow);
      this.cards.push({ id, group, shadow, pos: new THREE.Vector3(0, 0, 0), flip: Math.PI, fly: null });
    }
    void tex.loadFaceArt();
  }

  private buildGlows() {
    const mat = new THREE.MeshBasicMaterial({ map: tex.glowTexture(), transparent: true, depthWrite: false, depthTest: false });
    const geo = new THREE.PlaneGeometry(CARD_W * tex.SHADOW_PAD_FRAC.x, CARD_H * tex.SHADOW_PAD_FRAC.y);
    for (let i = 0; i < 2; i++) {
      const m = new THREE.Mesh(geo, mat);
      m.visible = false;
      m.renderOrder = 10;
      this.scene.add(m);
      this.glows.push(m);
    }
  }

  // ---------- public API ----------

  setState(state: GameState, opts: { instant?: boolean } = {}) {
    const prev = this.state;
    this.state = state;
    this.layout();
    if (opts.instant) {
      for (const c of this.cards) {
        const t = this.targets.get(c.id)!;
        c.pos.set(t.x, t.y, t.z);
        c.flip = t.faceUp ? 0 : Math.PI;
      }
    }
    // drag no longer valid (e.g. a teammate moved these cards)
    if (this.drag) {
      const stack = movableStack(state, this.drag.cards[0]);
      if (!stack || stack.join() !== this.drag.cards.join()) this.cancelDrag();
    }
    if (state.wonAt != null && prev && prev.wonAt == null && prev.seed === state.seed && this.animations) this.startCascade();
    if (state.wonAt == null) this.stopCascade();
  }

  setRemoteDrag(id: string, cards: number[], x: number, y: number) {
    this.remote.set(id, { cards, x, y });
    if (this.drag && this.drag.cards.some((c) => cards.includes(c))) this.cancelDrag();
  }

  clearRemoteDrag(id: string) { this.remote.delete(id); }
  clearAllRemote() { this.remote.clear(); }

  showHint(h: Hint) {
    if (!this.state) return;
    const place = (m: THREE.Mesh, x: number, y: number) => { m.position.set(x, y, 20); m.visible = true; };
    this.glows.forEach((g) => (g.visible = false));
    if (h.type === 'draw') {
      const b = pileBase('stock');
      place(this.glows[0], b.x, b.y);
    } else {
      const c = this.cards[h.cardId];
      place(this.glows[0], c.pos.x, c.pos.y);
      const dest = this.state.piles[h.to];
      if (dest.length) { const t = this.targets.get(dest[dest.length - 1])!; place(this.glows[1], t.x, t.y); }
      else { const b = pileBase(h.to); place(this.glows[1], b.x, b.y); }
    }
    this.glowUntil = performance.now() + 1800;
  }

  worldToClient(x: number, y: number) {
    const r = this.canvas.getBoundingClientRect();
    const v = this.view;
    return { x: r.left + ((x - v.left) / (v.right - v.left)) * r.width, y: r.top + ((v.top - y) / (v.top - v.bottom)) * r.height };
  }

  // ---------- layout ----------

  resize() {
    const W = window.innerWidth, H = window.innerHeight;
    const { top, bottom } = this.cb.getInsets();
    const minW = 6 * COL + CARD_W + 2 * MARGIN;
    const minH = 2 * CARD_H + ROW_GAP + 2.3 + 2 * MARGIN;
    const s = Math.min(W / minW, Math.max(80, H - top - bottom) / minH, MAX_PX_PER_UNIT);
    const v = this.view;
    v.left = -W / 2 / s; v.right = W / 2 / s;
    v.top = CARD_H / 2 + MARGIN + top / s;
    v.bottom = v.top - H / s;
    this.camera.left = v.left; this.camera.right = v.right; this.camera.top = v.top; this.camera.bottom = v.bottom;
    this.camera.updateProjectionMatrix();
    this.gl.setSize(W, H, false);
    this.felt.scale.set(v.right - v.left, v.top - v.bottom, 1);
    this.felt.position.set((v.left + v.right) / 2, (v.top + v.bottom) / 2, -1);
    this.bottomInsetWorld = bottom / s;
    if (this.state) this.layout();
  }
  private bottomInsetWorld = 0;

  private layout() {
    const st = this.state!;
    const t = this.targets;
    st.piles.stock.forEach((id, i) => {
      const b = pileBase('stock');
      t.set(id, { x: b.x - i * 0.002, y: b.y + i * 0.004, z: 0.01 + i * 0.004, faceUp: false, shadow: i === 0 });
    });
    const waste = st.piles.waste;
    const visible = st.drawCount === 3 ? 3 : 1;
    waste.forEach((id, i) => {
      const b = pileBase('waste');
      const k = Math.max(0, i - (waste.length - visible));
      t.set(id, { x: b.x + k * WASTE_FAN, y: b.y, z: 0.01 + i * 0.004, faceUp: true, shadow: k > 0 || i === 0 });
    });
    for (const f of FOUNDATIONS) {
      const b = pileBase(f);
      st.piles[f].forEach((id, i) => t.set(id, { x: b.x, y: b.y, z: 0.01 + i * 0.004, faceUp: true, shadow: i === 0 }));
    }
    const avail = TAB_Y - CARD_H / 2 - (this.view.bottom + this.bottomInsetWorld + MARGIN);
    for (const p of TABLEAUS) {
      const pile = st.piles[p];
      const b = pileBase(p);
      let natural = 0;
      for (let i = 0; i < pile.length - 1; i++) natural += st.faceUp[pile[i]] ? FAN_UP : FAN_DOWN;
      const scale = natural > avail && natural > 0 ? Math.max(0.25, avail / natural) : 1;
      let y = b.y;
      pile.forEach((id, i) => {
        t.set(id, { x: b.x, y, z: 0.01 + i * 0.01, faceUp: st.faceUp[id], shadow: true });
        y -= (st.faceUp[id] ? FAN_UP : FAN_DOWN) * scale;
      });
    }
  }

  private pileRect(p: PileId) {
    const b = pileBase(p);
    const pile = this.state!.piles[p];
    let bottomY = b.y;
    if (p[0] === 't' && pile.length) bottomY = this.targets.get(pile[pile.length - 1])!.y;
    return { l: b.x - CARD_W / 2, r: b.x + CARD_W / 2, t: b.y + CARD_H / 2, b: bottomY - CARD_H / 2 };
  }

  // ---------- input ----------

  private toWorld(e: PointerEvent) {
    const r = this.canvas.getBoundingClientRect();
    const v = this.view;
    return {
      x: v.left + ((e.clientX - r.left) / r.width) * (v.right - v.left),
      y: v.top - ((e.clientY - r.top) / r.height) * (v.top - v.bottom),
    };
  }

  private isRemoteLocked(id: number) {
    for (const r of this.remote.values()) if (r.cards.includes(id)) return true;
    return false;
  }

  private pick(x: number, y: number): number | null {
    let best: CardView | null = null;
    for (const c of this.cards) {
      const p = c.group.position;
      if (Math.abs(x - p.x) > CARD_W / 2 || Math.abs(y - p.y) > CARD_H / 2) continue;
      if (!best || p.z > best.group.position.z) best = c;
    }
    return best ? best.id : null;
  }

  private inStockSlot(x: number, y: number) {
    const b = pileBase('stock');
    return Math.abs(x - b.x) <= CARD_W / 2 && Math.abs(y - b.y) <= CARD_H / 2;
  }

  private onDown(e: PointerEvent) {
    if (!this.state || this.cascading || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const w = this.toWorld(e);
    this.down = { kind: 'none', x: e.clientX, y: e.clientY };
    const id = this.pick(w.x, w.y);
    if (id != null && !this.isRemoteLocked(id)) {
      const loc = findCard(this.state, id)!;
      if (loc.pile === 'stock') this.down.kind = 'stock';
      else {
        const stack = movableStack(this.state, id);
        if (stack && !stack.some((c) => this.isRemoteLocked(c))) {
          const p = this.cards[id].pos;
          this.drag = { cards: stack, offX: p.x - w.x, offY: p.y - w.y, startX: e.clientX, startY: e.clientY, x: p.x, y: p.y, active: false };
          this.down.kind = 'card';
        }
      }
    } else if (id == null && this.inStockSlot(w.x, w.y)) this.down.kind = 'stock';
    this.canvas.setPointerCapture(e.pointerId);
  }

  private onMove(e: PointerEvent) {
    const w = this.toWorld(e);
    this.cb.onPointer(w.x, w.y);
    const d = this.drag;
    if (d) {
      if (!d.active && Math.hypot(e.clientX - d.startX, e.clientY - d.startY) > 6) d.active = true;
      if (d.active) {
        d.x = w.x + d.offX; d.y = w.y + d.offY;
        this.cb.onDrag(d.cards, d.x, d.y);
        this.canvas.style.cursor = 'grabbing';
      }
      return;
    }
    if (e.pointerType === 'mouse' && this.state) {
      const id = this.pick(w.x, w.y);
      let cursor = 'default';
      if (id != null) {
        if (findCard(this.state, id)?.pile === 'stock') cursor = 'pointer';
        else if (movableStack(this.state, id) && !this.isRemoteLocked(id)) cursor = 'grab';
      } else if (this.inStockSlot(w.x, w.y)) cursor = 'pointer';
      this.canvas.style.cursor = cursor;
    }
  }

  private onUp(_e: PointerEvent) {
    const d = this.drag, down = this.down;
    this.down = null;
    if (!this.state) return;
    if (d?.active) this.drop(d);
    else if (down?.kind === 'card' && d) {
      this.drag = null;
      const to = findAutoMove(this.state, d.cards[0]);
      if (to) this.cb.onAction({ type: 'move', cardId: d.cards[0], to });
    } else if (down?.kind === 'stock') this.cb.onAction({ type: 'draw' });
    this.drag = null;
    this.canvas.style.cursor = 'default';
  }

  private drop(d: Drag) {
    const lead = d.cards[0];
    const l = d.x - CARD_W / 2, r = d.x + CARD_W / 2, t = d.y + CARD_H / 2, b = d.y - CARD_H / 2;
    let best: PileId | null = null, bestArea = 0;
    for (const p of [...FOUNDATIONS, ...TABLEAUS] as PileId[]) {
      const pr = this.pileRect(p);
      const w = Math.min(r, pr.r) - Math.max(l, pr.l);
      const h = Math.min(t, pr.t) - Math.max(b, pr.b);
      if (w <= 0 || h <= 0) continue;
      if (w * h > bestArea && canMove(this.state!, lead, p)) { best = p; bestArea = w * h; }
    }
    this.drag = null;
    if (best) this.cb.onAction({ type: 'move', cardId: lead, to: best });
    this.cb.onDragEnd();
  }

  private cancelDrag() {
    if (this.drag?.active) this.cb.onDragEnd();
    this.drag = null;
    this.down = null;
  }

  // ---------- win cascade ----------

  private startCascade() {
    const st = this.state!;
    this.cascading = true;
    let order = 0;
    for (let rank = 13; rank >= 1; rank--) {
      for (const f of FOUNDATIONS) {
        const id = st.piles[f].find((c) => rankOf(c) === rank);
        if (id == null) continue;
        const c = this.cards[id];
        const dir = c.pos.x > 0 ? -1 : 1;
        c.fly = {
          x: c.pos.x, y: c.pos.y,
          vx: dir * (1.5 + Math.random() * 3) * (Math.random() < 0.25 ? -1 : 1),
          vy: Math.random() * 3, delay: 0.7 + order * 0.11, z: 6 + order * 0.01, launched: false,
        };
        order++;
      }
    }
  }

  private stopCascade() {
    if (!this.cascading) return;
    this.cascading = false;
    for (const c of this.cards) c.fly = null;
  }

  // ---------- frame ----------

  private frame() {
    const now = performance.now();
    const dt = Math.min((now - this.lastFrame) / 1000, 0.05);
    this.lastFrame = now;
    const k = this.animations ? 1 - Math.exp(-dt * 16) : 1;
    const kRemote = 1 - Math.exp(-dt * 20);

    const remoteIndex = new Map<number, { x: number; y: number; j: number }>();
    for (const r of this.remote.values()) r.cards.forEach((id, j) => remoteIndex.set(id, { x: r.x, y: r.y, j }));
    const dragIndex = new Map<number, number>();
    if (this.drag?.active) this.drag.cards.forEach((id, j) => dragIndex.set(id, j));

    for (const c of this.cards) {
      const t = this.targets.get(c.id);
      if (!t) { c.group.visible = c.shadow.visible = false; continue; }
      c.group.visible = true;
      let lift = 0;
      const dj = dragIndex.get(c.id);
      const rj = remoteIndex.get(c.id);
      if (c.fly && c.fly.delay > 0) {
        // waiting for launch: first glide to the foundation like a normal move
        c.fly.delay -= dt;
        c.pos.x += (t.x - c.pos.x) * k; c.pos.y += (t.y - c.pos.y) * k;
        c.pos.z = Math.max(c.pos.z, t.z);
        lift = Math.min(Math.hypot(t.x - c.pos.x, t.y - c.pos.y) * 0.5, 1.5);
      } else if (c.fly) {
        const f = c.fly;
        if (!f.launched) { f.launched = true; f.x = c.pos.x; f.y = c.pos.y; }
        {
          f.vy -= 16 * dt; f.x += f.vx * dt; f.y += f.vy * dt;
          const floor = this.view.bottom + CARD_H / 2;
          if (f.y < floor) { f.y = floor; f.vy = Math.abs(f.vy) * 0.72 + 1.2; }
          c.pos.set(f.x, f.y, f.z);
        }
      } else if (dj != null) {
        c.pos.set(this.drag!.x, this.drag!.y - dj * FAN_UP, 5 + dj * 0.01);
      } else if (rj) {
        c.pos.lerp(new THREE.Vector3(rj.x, rj.y - rj.j * FAN_UP, 4 + rj.j * 0.01), kRemote);
      } else {
        const dx = t.x - c.pos.x, dy = t.y - c.pos.y;
        const dist = Math.hypot(dx, dy);
        c.pos.x += dx * k; c.pos.y += dy * k;
        // keep moving cards above the table, settle z only near the target
        c.pos.z = dist > 0.05 ? Math.max(c.pos.z, t.z) : c.pos.z + (t.z - c.pos.z) * k;
        lift = Math.min(dist * 0.5, 1.5);
      }
      const targetFlip = c.fly ? 0 : t.faceUp || dj != null || rj ? 0 : Math.PI;
      c.flip += (targetFlip - c.flip) * k;
      if (Math.abs(targetFlip - c.flip) < 0.001) c.flip = targetFlip;
      lift += Math.abs(Math.sin(c.flip)) * 0.4;

      const z = c.pos.z + lift;
      c.group.position.set(c.pos.x, c.pos.y, z);
      c.group.rotation.y = c.flip;
      const off = 0.025 + Math.min(z, 5) * 0.025;
      c.shadow.visible = t.shadow || lift > 0.02 || dj != null || !!rj || !!c.fly;
      c.shadow.position.set(c.pos.x + off * 0.5, c.pos.y - off, z - 0.003);
      c.shadow.scale.set(Math.max(0.05, Math.abs(Math.cos(c.flip))), 1, 1);
    }

    if (this.glows[0].visible) {
      const left = this.glowUntil - now;
      if (left <= 0) this.glows.forEach((g) => (g.visible = false));
      else (this.glows[0].material as THREE.MeshBasicMaterial).opacity = 0.55 + 0.45 * Math.sin(now / 120);
    }

    this.cb.onFrame();
    this.gl.render(this.scene, this.camera);
  }
}
