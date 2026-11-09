import * as THREE from 'three';
import { isRed, rankOf, RANK_LABELS, suitOf } from '../../shared/klondike';

/** Card texture size; aspect 1:1.4 like the card meshes. */
export const TW = 300;
export const TH = 420;
const RADIUS = 20;
const RED = '#c8141e';
const BLACK = '#141414';
const SERIF = 'Georgia, "Times New Roman", "DejaVu Serif", serif';

let maxAniso = 4;
export function setMaxAnisotropy(n: number) { maxAniso = n; }

function makeCanvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return { c, ctx: c.getContext('2d')! };
}

function toTexture(c: HTMLCanvasElement) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = maxAniso;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Draws a suit symbol as a path (no emoji fonts needed). */
export function drawSuit(ctx: CanvasRenderingContext2D, suit: number, cx: number, cy: number, size: number, flip = false) {
  const s = size / 2;
  ctx.save();
  ctx.translate(cx, cy);
  if (flip) ctx.rotate(Math.PI);
  ctx.beginPath();
  if (suit === 2) { // diamond
    ctx.moveTo(0, -s); ctx.lineTo(s * 0.74, 0); ctx.lineTo(0, s); ctx.lineTo(-s * 0.74, 0); ctx.closePath();
  } else if (suit === 1) { // heart
    ctx.moveTo(0, s * 0.92);
    ctx.bezierCurveTo(-s * 0.35, s * 0.55, -s * 1.0, s * 0.15, -s * 0.95, -s * 0.38);
    ctx.bezierCurveTo(-s * 0.9, -s * 0.95, -s * 0.15, -s * 1.0, 0, -s * 0.45);
    ctx.bezierCurveTo(s * 0.15, -s * 1.0, s * 0.9, -s * 0.95, s * 0.95, -s * 0.38);
    ctx.bezierCurveTo(s * 1.0, s * 0.15, s * 0.35, s * 0.55, 0, s * 0.92);
  } else if (suit === 0) { // spade
    ctx.moveTo(0, -s);
    ctx.bezierCurveTo(s * 0.35, -s * 0.6, s * 1.0, -s * 0.25, s * 0.95, s * 0.22);
    ctx.bezierCurveTo(s * 0.9, s * 0.68, s * 0.3, s * 0.72, s * 0.08, s * 0.38);
    ctx.quadraticCurveTo(s * 0.12, s * 0.8, s * 0.42, s);
    ctx.lineTo(-s * 0.42, s);
    ctx.quadraticCurveTo(-s * 0.12, s * 0.8, -s * 0.08, s * 0.38);
    ctx.bezierCurveTo(-s * 0.3, s * 0.72, -s * 0.9, s * 0.68, -s * 0.95, s * 0.22);
    ctx.bezierCurveTo(-s * 1.0, -s * 0.25, -s * 0.35, -s * 0.6, 0, -s);
  } else { // club
    const r = s * 0.42;
    ctx.moveTo(r, -s * 0.5); ctx.arc(0, -s * 0.5, r, 0, Math.PI * 2);
    ctx.moveTo(-s * 0.48 + r, s * 0.15); ctx.arc(-s * 0.48, s * 0.15, r, 0, Math.PI * 2);
    ctx.moveTo(s * 0.48 + r, s * 0.15); ctx.arc(s * 0.48, s * 0.15, r, 0, Math.PI * 2);
    ctx.moveTo(-s * 0.12, 0); ctx.lineTo(s * 0.12, 0);
    ctx.quadraticCurveTo(s * 0.12, s * 0.75, s * 0.42, s);
    ctx.lineTo(-s * 0.42, s);
    ctx.quadraticCurveTo(-s * 0.12, s * 0.75, -s * 0.12, 0);
  }
  ctx.fill();
  ctx.restore();
}

// Pip positions (x, y in 0..1 of the pip area). y > 0.5 is drawn upside down.
const L = 0, M = 0.5, R = 1;
const PIPS: Record<number, [number, number][]> = {
  2: [[M, 0], [M, 1]],
  3: [[M, 0], [M, 0.5], [M, 1]],
  4: [[L, 0], [R, 0], [L, 1], [R, 1]],
  5: [[L, 0], [R, 0], [M, 0.5], [L, 1], [R, 1]],
  6: [[L, 0], [R, 0], [L, 0.5], [R, 0.5], [L, 1], [R, 1]],
  7: [[L, 0], [R, 0], [M, 0.25], [L, 0.5], [R, 0.5], [L, 1], [R, 1]],
  8: [[L, 0], [R, 0], [M, 0.25], [L, 0.5], [R, 0.5], [M, 0.75], [L, 1], [R, 1]],
  9: [[L, 0], [R, 0], [L, 1 / 3], [R, 1 / 3], [M, 0.5], [L, 2 / 3], [R, 2 / 3], [L, 1], [R, 1]],
  10: [[L, 0], [R, 0], [M, 1 / 6], [L, 1 / 3], [R, 1 / 3], [L, 2 / 3], [R, 2 / 3], [M, 5 / 6], [L, 1], [R, 1]],
};

// ---- face card art (loaded SVGs) ----
const faceArt = new Map<number, HTMLImageElement>();
const cardCanvases = new Map<number, { ctx: CanvasRenderingContext2D; tex: THREE.CanvasTexture }>();
/** Part of the source SVG that holds the figure (fractions of its size). */
const FACE_CROP = { x: 0.088, y: 0.054, w: 0.829, h: 0.892 };

function drawFace(ctx: CanvasRenderingContext2D, id: number) {
  const color = isRed(id) ? RED : BLACK;
  const x = 84, w = 204, h = Math.round(w * (FACE_CROP.h * 1.5) / FACE_CROP.w), y = Math.round((TH - h) / 2);
  const img = faceArt.get(id);
  if (img && img.naturalWidth > 0) {
    const iw = img.naturalWidth, ih = img.naturalHeight;
    ctx.save();
    rr(ctx, x, y, w, h, 6); ctx.clip();
    ctx.drawImage(img, iw * FACE_CROP.x, ih * FACE_CROP.y, iw * FACE_CROP.w, ih * FACE_CROP.h, x, y, w, h);
    ctx.restore();
    ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 2;
    rr(ctx, x, y, w, h, 6); ctx.stroke();
  } else {
    ctx.fillStyle = isRed(id) ? '#fbeaea' : '#ececf3';
    rr(ctx, x, y, w, h, 8); ctx.fill();
    ctx.strokeStyle = color; ctx.lineWidth = 3; ctx.stroke();
    ctx.fillStyle = color;
    ctx.font = `bold 150px ${SERIF}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(RANK_LABELS[rankOf(id)], x + w / 2, y + h / 2 - 20);
    drawSuit(ctx, suitOf(id), x + w / 2, y + h - 60, 56);
  }
}

function drawCard(ctx: CanvasRenderingContext2D, id: number) {
  const rank = rankOf(id), suit = suitOf(id);
  const color = isRed(id) ? RED : BLACK;
  ctx.clearRect(0, 0, TW, TH);
  rr(ctx, 2, 2, TW - 4, TH - 4, RADIUS);
  const g = ctx.createLinearGradient(0, 0, 0, TH);
  g.addColorStop(0, '#ffffff'); g.addColorStop(1, '#eef0ee');
  ctx.fillStyle = g; ctx.fill();
  ctx.strokeStyle = '#b9bdb9'; ctx.lineWidth = 3; ctx.stroke();

  if (rank >= 11) drawFace(ctx, id);

  // corner index: rank, suit next to it, suit below
  ctx.fillStyle = color;
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  const label = RANK_LABELS[rank];
  ctx.font = `bold 78px ${SERIF}`;
  const tw = ctx.measureText(label).width;
  const maxW = 92;
  ctx.save();
  ctx.translate(14, 80);
  if (tw > maxW) ctx.scale(maxW / tw, 1);
  ctx.fillText(label, 0, 0);
  ctx.restore();
  const rw = Math.min(tw, maxW);
  if (rank < 11) drawSuit(ctx, suit, 14 + rw + 30, 50, 44);
  drawSuit(ctx, suit, 14 + Math.max(rw, 44) / 2, 120, 40);

  if (rank === 1) {
    drawSuit(ctx, suit, 168, 250, 150);
  } else if (rank <= 10) {
    const ax = 120, aw = 120, ay = 150, ah = 225;
    for (const [px, py] of PIPS[rank]) {
      drawSuit(ctx, suit, ax + px * aw, ay + py * ah, 54, py > 0.5);
    }
  }
}

export function cardTexture(id: number): THREE.CanvasTexture {
  const { c, ctx } = makeCanvas(TW, TH);
  drawCard(ctx, id);
  const tex = toTexture(c);
  cardCanvases.set(id, { ctx, tex });
  return tex;
}

/** Loads the court card SVGs and redraws their textures. Never rejects. */
export async function loadFaceArt(): Promise<void> {
  const suits = ['S', 'H', 'D', 'C'];
  const ranks = ['J', 'Q', 'K'];
  const jobs: Promise<void>[] = [];
  suits.forEach((s, si) => ranks.forEach((r, ri) => {
    const id = si * 13 + 10 + ri;
    jobs.push(new Promise<void>((resolve) => {
      const img = new Image();
      img.onload = () => {
        faceArt.set(id, img);
        const entry = cardCanvases.get(id);
        if (entry) { drawCard(entry.ctx, id); entry.tex.needsUpdate = true; }
        resolve();
      };
      img.onerror = () => resolve();
      img.src = `${import.meta.env.BASE_URL}cards/${r}_${s}.svg`;
    }));
  }));
  await Promise.all(jobs);
}

export function backTexture(): THREE.CanvasTexture {
  const { c, ctx } = makeCanvas(TW, TH);
  rr(ctx, 2, 2, TW - 4, TH - 4, RADIUS);
  ctx.fillStyle = '#ffffff'; ctx.fill();
  ctx.strokeStyle = '#9aa6b8'; ctx.lineWidth = 3; ctx.stroke();
  const ix = 16, iy = 16, iw = TW - 32, ih = TH - 32;
  ctx.save();
  rr(ctx, ix, iy, iw, ih, 12); ctx.clip();
  const g = ctx.createLinearGradient(0, 0, TW, TH);
  g.addColorStop(0, '#2a62d8'); g.addColorStop(1, '#173f9e');
  ctx.fillStyle = g; ctx.fillRect(ix, iy, iw, ih);
  // diamond lattice
  ctx.strokeStyle = 'rgba(255,255,255,0.28)'; ctx.lineWidth = 2;
  const step = 22;
  for (let d = -TH; d < TW + TH; d += step) {
    ctx.beginPath(); ctx.moveTo(d, 0); ctx.lineTo(d + TH, TH); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(d, TH); ctx.lineTo(d + TH, 0); ctx.stroke();
  }
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  for (let y = iy; y < iy + ih; y += step) for (let x = ix; x < ix + iw; x += step) {
    ctx.beginPath(); ctx.arc(x + step / 2, y + step / 2, 3, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
  ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 3;
  rr(ctx, ix + 8, iy + 8, iw - 16, ih - 16, 8); ctx.stroke();
  return toTexture(c);
}

/** Empty pile outline. symbol: suit index, 'redeal', or null. */
export function slotTexture(symbol: number | 'redeal' | null): THREE.CanvasTexture {
  const { c, ctx } = makeCanvas(TW, TH);
  rr(ctx, 5, 5, TW - 10, TH - 10, RADIUS);
  ctx.fillStyle = 'rgba(0,0,0,0.12)'; ctx.fill();
  ctx.strokeStyle = 'rgba(160,220,180,0.35)'; ctx.lineWidth = 5; ctx.stroke();
  ctx.fillStyle = 'rgba(140,210,165,0.32)';
  if (typeof symbol === 'number') drawSuit(ctx, symbol, TW / 2, TH / 2, 110);
  else if (symbol === 'redeal') {
    ctx.strokeStyle = 'rgba(140,210,165,0.45)'; ctx.lineWidth = 14; ctx.lineCap = 'round';
    const cx = TW / 2, cy = TH / 2, r = 55, end = -Math.PI * 0.3;
    ctx.beginPath(); ctx.arc(cx, cy, r, Math.PI * 0.05, Math.PI * 1.6); ctx.stroke();
    // arrow head at the end of the arc, pointing clockwise
    const ex = cx + r * Math.cos(end), ey = cy + r * Math.sin(end);
    const tx = -Math.sin(end), ty = Math.cos(end); // tangent (clockwise)
    const nx = Math.cos(end), ny = Math.sin(end);
    ctx.fillStyle = "rgba(140,210,165,0.45)";
    ctx.beginPath();
    ctx.moveTo(ex + tx * 26, ey + ty * 26);
    ctx.lineTo(ex - tx * 14 + nx * 24, ey - ty * 14 + ny * 24);
    ctx.lineTo(ex - tx * 14 - nx * 24, ey - ty * 14 - ny * 24);
    ctx.closePath(); ctx.fill();
  }
  return toTexture(c);
}

/** Soft shadow drawn only via canvas shadowBlur (works in Safari too). */
export function shadowTexture(): THREE.CanvasTexture {
  const pad = 40;
  const { c, ctx } = makeCanvas(TW / 2 + pad * 2, TH / 2 + pad * 2);
  ctx.shadowColor = 'rgba(0,0,0,1)';
  ctx.shadowBlur = 18;
  ctx.shadowOffsetX = 2000;
  rr(ctx, pad - 2000, pad, TW / 2, TH / 2, RADIUS / 2);
  ctx.fillStyle = '#000'; ctx.fill();
  return toTexture(c);
}
export const SHADOW_PAD_FRAC = { x: (TW / 2 + 80) / (TW / 2), y: (TH / 2 + 80) / (TH / 2) };

/** Glowing outline for hints. */
export function glowTexture(): THREE.CanvasTexture {
  const pad = 40;
  const { c, ctx } = makeCanvas(TW / 2 + pad * 2, TH / 2 + pad * 2);
  ctx.shadowColor = 'rgba(255,215,64,1)';
  ctx.shadowBlur = 22;
  ctx.strokeStyle = 'rgba(255,230,120,1)'; ctx.lineWidth = 7;
  rr(ctx, pad, pad, TW / 2, TH / 2, RADIUS / 2);
  ctx.stroke(); ctx.stroke();
  return toTexture(c);
}

export function feltTexture(): THREE.CanvasTexture {
  const size = 512;
  const { c, ctx } = makeCanvas(size, size);
  const g = ctx.createRadialGradient(size / 2, size * 0.45, size * 0.05, size / 2, size / 2, size * 0.75);
  g.addColorStop(0, '#22703f'); g.addColorStop(1, '#0f4224');
  ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
  const img = ctx.getImageData(0, 0, size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 14;
    img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
  return toTexture(c);
}
