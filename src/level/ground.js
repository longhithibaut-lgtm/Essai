import * as THREE from 'three';
import { K } from './surfaces.js';
import { PAL } from './props.js';

// Sols : calepinages, bordures, caniveaux, regards et tuyauteries au pied des murets.
// Rien de tout cela n'a de collision (épaisseur de quelques millimètres).

// Dalle ou parquet incrusté dans le sol, légèrement au-dessus du dallage
export function inlay(ctx, minX, maxX, minZ, maxZ, y, o = {}) {
  ctx.arch.boxMinMax(minX, y - 0.01, minZ, maxX, y + (o.h ?? 0.012), maxZ, { kind: o.kind ?? K.PAVE, color: o.color ?? 0xf2eae0, style: o.tile ?? 1.0, skipBottom: true });
}

// Allée bordée : dallage clair au centre, bandes de petits carreaux de part et d'autre.
// axis 'z' : l'allée court le long de z.
export function path(ctx, a0, a1, b0, b1, y, o = {}) {
  const bw = o.border ?? 0.32;
  const along = o.axis ?? 'z';
  const box = (u0, u1, v0, v1, opts) => (along === 'z' ? inlay(ctx, u0, u1, v0, v1, y, opts) : inlay(ctx, v0, v1, u0, u1, y, opts));
  // a : travers (x si axis z), b : long
  box(a0 + bw, a1 - bw, b0, b1, { tile: o.tile ?? 1.0, color: o.color ?? 0xf3ece3 });
  box(a0, a0 + bw, b0, b1, { tile: 0.04, color: o.borderColor ?? 0xd9a184, h: 0.016 });
  box(a1 - bw, a1, b0, b1, { tile: 0.04, color: o.borderColor ?? 0xd9a184, h: 0.016 });
}

// Regard / grille d'évacuation avec un peu de crasse autour
export function drain(ctx, x, y, z, s = 0.42) {
  ctx.arch.boxMinMax(x - s / 2 - 0.05, y - 0.01, z - s / 2 - 0.05, x + s / 2 + 0.05, y + 0.014, z + s / 2 + 0.05, { kind: K.STONE, color: 0xcfc4b8, skipBottom: true });
  ctx.arch.boxMinMax(x - s / 2, y - 0.01, z - s / 2, x + s / 2, y + 0.018, z + s / 2, { kind: K.GRILLE, color: 0x6c6a70, skipBottom: true });
  if (ctx.ao) ctx.ao(x, z, s * 2.6, s * 2.6, y, 0.55);
}

// Caniveau de pierre (rigole) le long d'une allée
export function gutter(ctx, x0, x1, z0, z1, y) {
  ctx.arch.boxMinMax(x0, y - 0.01, z0, x1, y + 0.01, z1, { kind: K.STONE, color: 0xcdbfb0, skipBottom: true });
  const alongZ = Math.abs(z1 - z0) > Math.abs(x1 - x0);
  if (alongZ) {
    const xm = (x0 + x1) / 2;
    ctx.arch.boxMinMax(xm - 0.06, y - 0.01, z0, xm + 0.06, y + 0.013, z1, { kind: K.STONE, color: 0xa79a90, skipBottom: true });
  } else {
    const zm = (z0 + z1) / 2;
    ctx.arch.boxMinMax(x0, y - 0.01, zm - 0.06, x1, y + 0.013, zm + 0.06, { kind: K.STONE, color: 0xa79a90, skipBottom: true });
  }
}

// Deux tuyaux sur petits supports au pied d'un muret (axe x ou z)
export function pipes(ctx, a, b, y, o = {}) {
  const A = ctx.arch;
  const r = o.r ?? 0.055;
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const len = Math.hypot(dx, dz);
  const n = Math.max(1, Math.floor(len / 1.5));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = a[0] + dx * t, z = a[1] + dz * t;
    A.box(x, y + 0.13, z, Math.abs(dx) > Math.abs(dz) ? 0.08 : 0.34, 0.26, Math.abs(dx) > Math.abs(dz) ? 0.34 : 0.08, { kind: K.METAL, color: PAL.metalDark });
  }
  const off = Math.abs(dx) > Math.abs(dz) ? [0, 0.09] : [0.09, 0];
  A.tube([a[0] - off[0], y + 0.2, a[1] - off[1]], [b[0] - off[0], y + 0.2, b[1] - off[1]], r, 8, { kind: K.METAL, color: o.c1 ?? PAL.metal });
  A.tube([a[0] + off[0], y + 0.2, a[1] + off[1]], [b[0] + off[0], y + 0.2, b[1] + off[1]], r * 0.75, 8, { kind: K.METAL, color: o.c2 ?? 0xc9b49a });
  if (ctx.ao) ctx.ao((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, Math.abs(dx) + 0.6, Math.abs(dz) + 0.6, y, 0.5);
}

// Trappe de toit : socle maçonné et couvercle métallique
export function hatch(ctx, x, y, z, w = 1.0, d = 1.0) {
  const A = ctx.arch;
  A.box(x, y + 0.2, z, w, 0.4, d, { kind: K.PLASTER, color: PAL.plaster });
  A.box(x, y + 0.44, z, w + 0.08, 0.08, d + 0.08, { kind: K.METAL, color: PAL.metalLight });
  A.box(x + w * 0.3, y + 0.5, z, 0.06, 0.04, d * 0.5, { kind: K.METAL, color: PAL.metalDark });
  if (ctx.ao) ctx.ao(x, z, w + 0.7, d + 0.7, y, 0.9);
  if (ctx.physics) ctx.solid([x - w / 2, y, z - d / 2], [x + w / 2, y + 0.48, z + d / 2], 'prop');
}

// Bassin maçonné : quatre margelles, fond sombre, eau un peu sous le bord.
export function basin(ctx, minX, maxX, minZ, maxZ, y, h, o = {}) {
  const A = ctx.arch;
  const t = o.rim ?? 0.24;
  const st = { kind: K.STONE, color: o.color ?? PAL.stone };
  A.boxMinMax(minX, y, minZ, maxX, y + h, minZ + t, st);
  A.boxMinMax(minX, y, maxZ - t, maxX, y + h, maxZ, st);
  A.boxMinMax(minX, y, minZ + t, minX + t, y + h, maxZ - t, st);
  A.boxMinMax(maxX - t, y, minZ + t, maxX, y + h, maxZ - t, st);
  A.boxMinMax(minX + t, y, minZ + t, maxX - t, y + 0.03, maxZ - t, { kind: K.STONE, color: 0x6f7f7a, skipBottom: true });
  ctx.water.boxMinMax(minX + t, y + h - 0.1, minZ + t, maxX - t, y + h - 0.065, maxZ - t, {});
  if (ctx.ao) ctx.ao((minX + maxX) / 2, (minZ + maxZ) / 2, maxX - minX + 0.6, maxZ - minZ + 0.6, y, 0.8);
  if (ctx.physics && o.collide !== false) ctx.solid([minX, y, minZ], [maxX, y + h, maxZ], 'rim');
  return y + h - 0.065;
}

// Dalles qui ont bougé : quelques dalles soulevées de 1 à 2 cm (leurs arêtes usées
// accrochent la lumière) ou remplacées par du gravier, exactement sur la grille de
// calepinage que dessine le shader (même taille, mêmes rangs décalés).
// base : hauteur du dessus du sol sous les dalles (dallage ou allée incrustée).
export function shiftedSlabs(ctx, minX, maxX, minZ, maxZ, base, o = {}) {
  const tile = o.tile ?? 1.0;
  const ts = 0.4 + (1.3 - 0.4) * tile;
  const rand = o.rand ?? ctx.rand;
  const n = o.n ?? 4;
  const color = o.color ?? 0xf3ece3;
  const used = new Set();
  let placed = 0;
  for (let t = 0; t < n * 12 && placed < n; t++) {
    const z = minZ + rand() * (maxZ - minZ);
    const r = Math.floor(z / ts);
    const off = tile >= 0.75 && ((r % 2) + 2) % 2 === 1 ? ts * 0.5 : 0;
    const x = minX + rand() * (maxX - minX);
    const i = Math.floor((x + off) / ts);
    const x0 = i * ts - off, z0 = r * ts;
    if (x0 < minX + 0.01 || x0 + ts > maxX - 0.01 || z0 < minZ + 0.01 || z0 + ts > maxZ - 0.01) continue;
    const key = i + ':' + r;
    if (used.has(key)) continue;
    used.add(key);
    placed++;
    const j = 0.013;
    if (rand() < (o.gravel ?? 0.3)) {
      ctx.arch.boxMinMax(x0 + j, base - 0.01, z0 + j, x0 + ts - j, base + 0.004, z0 + ts - j, { kind: K.GRAVEL, color: 0xcfc3b4, skipBottom: true });
    } else {
      const h = 0.009 + rand() * 0.014;
      const k = 0.94 + rand() * 0.1;
      const c = new THREE.Color(color).multiplyScalar(k);
      ctx.arch.boxMinMax(x0 + j, base - 0.01, z0 + j, x0 + ts - j, base + h, z0 + ts - j, { kind: K.PAVE, color: c.getHex(), style: tile, skipBottom: true });
    }
  }
}
