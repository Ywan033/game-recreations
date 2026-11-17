// Shared procedural texture helpers: canvas textures and height → normal map conversion.
import * as THREE from 'three/webgpu';
import { mulberry32 } from './sim.js';

const rnd = mulberry32(4711);
export const TR = (a = 1, b = 0) => b + rnd() * (a - b);

export function canvasTex(w, h, draw, srgb = true) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  draw(ctx, w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

// Draw a grey height field, get a tangent-space normal map (tiling).
export function normalFromHeight(w, h, draw, strength = 2) {
  const src = document.createElement('canvas');
  src.width = w; src.height = h;
  const sctx = src.getContext('2d', { willReadFrequently: true });
  draw(sctx, w, h);
  const hd = sctx.getImageData(0, 0, w, h).data;
  const out = document.createElement('canvas');
  out.width = w; out.height = h;
  const octx = out.getContext('2d');
  const img = octx.createImageData(w, h);
  const d = img.data;
  const H = (x, y) => hd[(((y + h) % h) * w + ((x + w) % w)) * 4];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (H(x + 1, y) - H(x - 1, y)) / 255 * strength;
      const dy = (H(x, y + 1) - H(x, y - 1)) / 255 * strength;
      const l = 1 / Math.hypot(dx, dy, 1);
      const o = (y * w + x) * 4;
      d[o] = (-dx * l * 0.5 + 0.5) * 255;
      d[o + 1] = (dy * l * 0.5 + 0.5) * 255;
      d[o + 2] = (l * 0.5 + 0.5) * 255;
      d[o + 3] = 255;
    }
  }
  octx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(out);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

export function speckle(ctx, w, h, n, alpha, light = true, size = 3) {
  for (let i = 0; i < n; i++) {
    const v = light ? 255 : 0;
    ctx.fillStyle = `rgba(${v},${v},${v},${TR(alpha)})`;
    ctx.fillRect(TR(w), TR(h), TR(size, 1), TR(size, 1));
  }
}

// soft blotches that wrap around the tile edges
export function blotches(ctx, w, h, n, rMin, rMax, alpha, light = true) {
  for (let i = 0; i < n; i++) {
    const x = TR(w), y = TR(h), r = TR(rMax, rMin);
    const v = light ? 255 : 0;
    for (const ox of [-w, 0, w]) for (const oy of [-h, 0, h]) {
      if (x + ox < -r || x + ox > w + r || y + oy < -r || y + oy > h + r) continue;
      const g = ctx.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
      g.addColorStop(0, `rgba(${v},${v},${v},${alpha})`);
      g.addColorStop(1, `rgba(${v},${v},${v},0)`);
      ctx.fillStyle = g;
      ctx.fillRect(x + ox - r, y + oy - r, r * 2, r * 2);
    }
  }
}

// ---- small tiling detail normal maps for character and prop materials
let cache = null;
export function detailMaps() {
  if (cache) return cache;
  const weave = normalFromHeight(128, 128, (ctx, w, h) => {
    ctx.fillStyle = '#808080'; ctx.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 4) for (let x = 0; x < w; x += 4) {
      const over = ((x + y) / 4) % 2 === 0;
      ctx.fillStyle = over ? '#b4b4b4' : '#5a5a5a';
      ctx.fillRect(x, y, over ? 4 : 2, over ? 2 : 4);
    }
    speckle(ctx, w, h, 900, 0.25, true, 2); speckle(ctx, w, h, 900, 0.25, false, 2);
  }, 1.6);
  const leather = normalFromHeight(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#808080'; ctx.fillRect(0, 0, w, h);
    blotches(ctx, w, h, 260, 4, 14, 0.2, true); blotches(ctx, w, h, 260, 3, 10, 0.25, false);
    ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = 1;
    for (let i = 0; i < 70; i++) { const x = TR(w), y = TR(h); ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + TR(26, -26), y + TR(26, -26)); ctx.stroke(); }
  }, 2.2);
  const hammered = normalFromHeight(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#808080'; ctx.fillRect(0, 0, w, h);
    blotches(ctx, w, h, 120, 8, 22, 0.16, true); blotches(ctx, w, h, 120, 8, 22, 0.16, false);
    speckle(ctx, w, h, 1500, 0.2, false, 2);
  }, 1.2);
  // roughness variation for metal and leather (G channel is read)
  const smudge = canvasTex(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#b0b0b0'; ctx.fillRect(0, 0, w, h);
    blotches(ctx, w, h, 60, 14, 50, 0.3, true); blotches(ctx, w, h, 70, 10, 40, 0.3, false);
    speckle(ctx, w, h, 2500, 0.2, true, 2); speckle(ctx, w, h, 2500, 0.25, false, 2);
  }, false);
  cache = { weave, leather, hammered, smudge };
  return cache;
}
