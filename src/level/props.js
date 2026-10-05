import * as THREE from 'three';
import { K } from './surfaces.js';

// Architecture et accessoires : immeubles à corniche, parapets, garde-corps,
// climatiseurs, réservoirs, édicules, jardinières, bancs, lanternes, guirlandes,
// voiles d'ombrage, auvents, bannières et linge.

export const PAL = {
  plaster: 0xf4ede6,
  plasterWarm: 0xf6e6d8,
  plasterRose: 0xf1d9d0,
  plasterSand: 0xeedfc6,
  plasterSage: 0xe2e6d9,
  plasterCool: 0xe8e7ee,
  stone: 0xe9ddcf,
  stoneWarm: 0xe2cdb8,
  coping: 0xfbf6ef,
  deck: 0xf1e9e1,
  coral: 0xff8a6a,
  coralSoft: 0xffa184,
  wood: 0xc29372,
  woodDark: 0x8e6b56,
  woodPale: 0xd8b494,
  metal: 0xa3abb4,
  metalLight: 0xe4e7ea,
  metalDark: 0x5f6773,
  terra: 0xd48a6c,
  glow: 0xffd2a0,
  rope: 0x8a7c70,
  fabrics: [0xfff4e6, 0xf6d6c2, 0xefc0b2, 0xd7e2cf, 0xf3e0b0, 0xd9d7ea, 0xffb196, 0xf9ebe0],
};

const fract = (x) => x - Math.floor(x);

// Ombre de contact douce posée au sol (ctx.ao fourni par le niveau, absent pour la ville lointaine)
function ao(ctx, cx, cz, w, d, y, k = 1, rotY = 0) {
  if (ctx.ao) ctx.ao(cx, cz, w, d, y, k, rotY);
}

export function buildingStyle(st) {
  return {
    band: 1.1 + 0.5 * fract(st * 3.7),
    floorH: 3.1 + 0.5 * fract(st * 5.3),
  };
}

// Fenêtres dessinées par le shader : on reproduit la même grille pour poser
// pilastres, jardinières, balcons et climatiseurs exactement entre ou sous les fenêtres.
export function windowGrid(b, face) {
  const st = b.style;
  const s = buildingStyle(st);
  const style = st >= 0.97 ? 3 : Math.floor(fract(st * 7.31) * 3);
  const shut = (style === 0 || style === 2) && fract(st * 13.7) > 0.45;
  const bayW = style === 3 ? 1.5 : style === 1 ? 1.6 + 0.4 * fract(st * 2.9) : 2.3 + 0.9 * fract(st * 9.1);
  const W = face === '+x' || face === '-x' ? b.d : b.w;
  const nb = Math.max(1, Math.floor(W / bayW + 0.5));
  const bw = W / nb;
  let mn, mx;
  if (style === 0) { mn = shut ? [bw * 0.3, 0.55] : [0.42, 0.55]; mx = shut ? [bw * 0.7, s.floorH - 0.95] : [bw - 0.42, s.floorH - 0.95]; }
  else if (style === 3) { mn = [0, 0]; mx = [bw, s.floorH]; }
  else if (style === 1) { mn = [0.06, 0.7]; mx = [bw - 0.06, s.floorH - 0.85]; }
  else { mn = [bw * 0.28, 0.35]; mx = [bw * 0.72, s.floorH - 0.3]; }
  return { style, shut, nb, bw, band: s.band, floorH: s.floorH, mn, mx, W };
}

// Boîte collée sur une face : u0..u1 le long de la face (vue de l'extérieur, depuis
// la gauche), y0..y1 en hauteur, saillie `dep` vers l'extérieur (négative : dans le mur).
export function faceBox(batch, b, face, u0, u1, y0, y1, dep, o) {
  const d0 = Math.min(0, dep), d1 = Math.max(0, dep);
  switch (face) {
    case '+z': batch.boxMinMax(b.minX + u0, y0, b.maxZ + d0, b.minX + u1, y1, b.maxZ + d1, o); break;
    case '-z': batch.boxMinMax(b.maxX - u1, y0, b.minZ - d1, b.maxX - u0, y1, b.minZ - d0, o); break;
    case '+x': batch.boxMinMax(b.maxX + d0, y0, b.maxZ - u1, b.maxX + d1, y1, b.maxZ - u0, o); break;
    default: batch.boxMinMax(b.minX - d1, y0, b.minZ + u0, b.minX - d0, y1, b.minZ + u1, o);
  }
}

const FACES = ['+z', '-z', '+x', '-x'];

// Modénature d'une façade : pilastres entre les baies, chaînes d'angle, allèges
// filantes des bandeaux vitrés, ailettes des murs rideaux.
function sculptFace(batch, bb, face, shaftTop, yLow, frameCol, o) {
  const g = windowGrid(bb, face);
  const W = g.W;
  if (W < 3) return;
  const yTop = shaftTop - 0.44;
  if (g.style === 0 || g.style === 2) {
    const pw = g.shut ? 0.3 : 0.42;
    for (let i = 1; i < g.nb; i++) {
      const u = i * g.bw;
      faceBox(batch, bb, face, u - pw / 2, u + pw / 2, yLow, yTop, 0.09, { kind: K.PLASTER, color: frameCol });
    }
    // Chaînes d'angle (un peu plus larges)
    if (o.quoins !== false) {
      faceBox(batch, bb, face, 0, 0.5, yLow, yTop, 0.11, { kind: K.PLASTER, color: frameCol });
      faceBox(batch, bb, face, W - 0.5, W, yLow, yTop, 0.11, { kind: K.PLASTER, color: frameCol });
    }
  } else if (g.style === 1) {
    // Allèges filantes en saillie entre les rubans de fenêtres
    for (let f = 0; f < 30; f++) {
      const y1 = shaftTop - (g.band + f * g.floorH + g.floorH - 0.85);
      const y0 = shaftTop - (g.band + (f + 1) * g.floorH + 0.7);
      if (y1 < yLow) break;
      faceBox(batch, bb, face, -0.06, W + 0.06, Math.max(y0, yLow), y1, 0.07, { kind: K.PLASTER, color: frameCol });
    }
    faceBox(batch, bb, face, -0.06, W + 0.06, shaftTop - g.band - 0.7, yTop, 0.07, { kind: K.PLASTER, color: frameCol });
  } else if (g.style === 3) {
    for (let i = 0; i <= g.nb; i++) {
      const u = Math.min(W - 0.05, Math.max(0.05, i * g.bw));
      faceBox(batch, bb, face, u - 0.05, u + 0.05, yLow, yTop, o.far ? 0.18 : 0.26, { kind: K.METAL, color: 0xd9dbe0 });
    }
  }
}

// Corniche saillante : larmier, modillons, frise et cimaise.
function cornice(batch, bb, shaftTop, ov, col, full, faces) {
  const { minX, maxX, minZ, maxZ } = bb;
  const w = maxX - minX, d = maxZ - minZ;
  const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
  // Larmier (débord principal) et cimaise
  batch.box(cx, shaftTop - 0.17, cz, w + ov * 2, 0.34, d + ov * 2, { kind: K.PLASTER, color: col });
  batch.box(cx, shaftTop - 0.39, cz, w + ov * 1.2, 0.1, d + ov * 1.2, { kind: K.PLASTER, color: col, skipTop: true });
  // Frise
  batch.box(cx, shaftTop - 0.95, cz, w + 0.1, 0.22, d + 0.1, { kind: K.PLASTER, color: col, skipTop: true });
  if (!full) return;
  // Modillons : petits consoles régulières sous le larmier (ombres rythmées)
  const step = 0.62;
  const dep = ov * 0.92;
  for (const face of faces) {
    const W = face === '+x' || face === '-x' ? d : w;
    const n = Math.max(1, Math.floor(W / step));
    const s0 = (W - (n - 1) * step) / 2;
    for (let i = 0; i < n; i++) {
      const u = s0 + i * step;
      faceBox(batch, bb, face, u - 0.08, u + 0.08, shaftTop - 0.6, shaftTop - 0.34, dep, { kind: K.PLASTER, color: col, skipTop: true });
    }
  }
}

// Immeuble : fût à fenêtres, corniche, terrasse dallée ou toit, bandeaux.
// o.detail : 'full' (pilastres + modillons), 'simple' (pilastres, corniche simple), false.
// o.faces : faces à sculpter (on évite les murs où l'on court et grimpe).
export function building(ctx, o) {
  const b = o.batch ?? ctx.arch;
  const { minX, maxX, minZ, maxZ, top } = o;
  const bottom = o.bottom ?? -62;
  const st = o.style ?? ctx.rand();
  const color = o.color ?? PAL.plaster;
  const w = maxX - minX, d = maxZ - minZ;
  const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
  const deck = o.deck ?? 'pave';
  const deckT = deck === 'pave' ? 0.3 : 0;
  const shaftTop = top - deckT;
  const hasCornice = o.cornice ?? true;
  const corniceCol = o.corniceColor ?? PAL.coping;
  const detail = o.detail ?? (b === ctx.arch ? 'full' : 'simple');
  const faces = o.faces ?? FACES;
  const bb = { minX, maxX, minZ, maxZ, w, d, style: st };

  if (deck === 'pave') {
    b.box(cx, top - deckT / 2, cz, w, deckT, d, { kind: o.deckKind ?? K.PAVE, color: o.deckColor ?? PAL.deck, style: o.tile ?? 0.55, skipBottom: true });
  }
  const shaftH = shaftTop - bottom;
  b.box(cx, bottom + shaftH / 2, cz, w, shaftH, d, { kind: o.sideKind ?? (o.plain ? K.PLASTER : K.FACADE), color, style: st, skipBottom: true, skipTop: deck === 'pave' });
  if (hasCornice) {
    const ov = o.corniceOver ?? (detail === 'full' && !o.plain ? 0.42 : 0.2);
    if (o.plain || !detail) {
      b.box(cx, shaftTop - 0.22, cz, w + ov * 2, 0.44, d + ov * 2, { kind: K.PLASTER, color: corniceCol });
      b.box(cx, shaftTop - 0.56, cz, w + ov, 0.24, d + ov, { kind: K.PLASTER, color: corniceCol });
    } else {
      cornice(b, bb, shaftTop, ov, corniceCol, detail === 'full', faces);
    }
  }
  // Pilastres, allèges, ailettes
  if (detail && !o.plain && shaftH > 3) {
    const yLow = Math.max(bottom, o.detailBottom ?? -26);
    const frameCol = o.frameColor ?? mixHex(color, corniceCol, 0.55);
    for (const face of faces) sculptFace(b, bb, face, shaftTop, yLow, frameCol, { far: detail !== 'full', quoins: o.quoins });
  }
  // Bandeaux tous les quelques étages, alignés sur les dalles dessinées par le shader
  if (o.bands !== false && !o.plain) {
    const s = buildingStyle(st);
    const every = o.bandEvery ?? 3;
    for (let k = every; k < 40; k += every) {
      const y = shaftTop - (s.band + k * s.floorH);
      if (y < bottom + 4) break;
      if (y < -24) break; // sous la mer de nuages, inutile
      b.box(cx, y, cz, w + 0.3, 0.26, d + 0.3, { kind: K.PLASTER, color: corniceCol });
    }
  }
  if (o.collide !== false && ctx.physics) {
    ctx.solid([minX, bottom, minZ], [maxX, top, maxZ], o.tag ?? 'building');
  }
  return { minX, maxX, minZ, maxZ, top, cx, cz, w, d, style: st, plain: !!o.plain, deck, color };
}

const _ca = new THREE.Color(), _cb = new THREE.Color();
export function mixHex(a, b, t) {
  _ca.set(a); _cb.set(b);
  return _ca.lerp(_cb, t).getHex();
}

// Mur bas avec chaperon
export function parapet(ctx, x1, z1, x2, z2, top, o = {}) {
  const b = o.batch ?? ctx.arch;
  const h = o.h ?? 0.7, t = o.t ?? 0.3;
  const minX = Math.min(x1, x2), maxX = Math.max(x1, x2);
  const minZ = Math.min(z1, z2), maxZ = Math.max(z1, z2);
  const alongX = maxX - minX >= maxZ - minZ;
  const bx0 = alongX ? minX : minX - t / 2, bx1 = alongX ? maxX : minX + t / 2;
  const bz0 = alongX ? minZ - t / 2 : minZ, bz1 = alongX ? minZ + t / 2 : maxZ;
  b.boxMinMax(bx0, top, bz0, bx1, top + h - 0.07, bz1, { kind: K.PLASTER, color: o.color ?? PAL.plaster });
  b.boxMinMax(bx0 - (alongX ? 0 : 0.05), top + h - 0.07, bz0 - (alongX ? 0.05 : 0), bx1 + (alongX ? 0 : 0.05), top + h, bz1 + (alongX ? 0.05 : 0), { kind: o.coral ? K.CORAL : K.STONE, color: o.coral ? PAL.coral : PAL.coping });
  // Piliers réguliers le long des grands murets : rythme, ombres, petits chapiteaux
  const len = alongX ? maxX - minX : maxZ - minZ;
  if (o.piers !== false && len > 4.5 && !o.coral) {
    const n = Math.max(1, Math.round(len / 3.2));
    const pc = o.pierColor ?? PAL.coping;
    for (let i = 0; i <= n; i++) {
      const c = (alongX ? minX : minZ) + (len * i) / n;
      const c0 = Math.max(alongX ? minX : minZ, c - 0.2), c1 = Math.min(alongX ? maxX : maxZ, c + 0.2);
      if (alongX) {
        b.boxMinMax(c0, top, bz0 - 0.045, c1, top + h - 0.07, bz1 + 0.045, { kind: K.PLASTER, color: pc });
        b.boxMinMax(c0 - 0.04, top + h - 0.07, bz0 - 0.08, c1 + 0.04, top + h + 0.05, bz1 + 0.08, { kind: K.STONE, color: PAL.coping });
      } else {
        b.boxMinMax(bx0 - 0.045, top, c0, bx1 + 0.045, top + h - 0.07, c1, { kind: K.PLASTER, color: pc });
        b.boxMinMax(bx0 - 0.08, top + h - 0.07, c0 - 0.04, bx1 + 0.08, top + h + 0.05, c1 + 0.04, { kind: K.STONE, color: PAL.coping });
      }
    }
  }
  // Ombre de contact du seul côté où il y a un sol (pas au-dessus du vide)
  if (ctx.ao && ctx.groundAt) {
    const mx = (bx0 + bx1) / 2, mz = (bz0 + bz1) / 2;
    for (const sg of [-1, 1]) {
      const px = alongX ? mx : mx + sg * (t / 2 + 0.25), pz = alongX ? mz + sg * (t / 2 + 0.25) : mz;
      if (!ctx.groundAt(px, pz, top)) continue;
      if (alongX) ao(ctx, mx, mz + sg * t / 2, bx1 - bx0, 0.6, top, 1);
      else ao(ctx, mx + sg * t / 2, mz, 0.6, bz1 - bz0, top, 1);
    }
  }
  if (o.collide !== false && ctx.physics) ctx.solid([bx0, top, bz0], [bx1, top + h, bz1], 'parapet');
}

// Garde-corps métallique fin
export function railing(ctx, x1, z1, x2, z2, top, o = {}) {
  const b = o.batch ?? ctx.arch;
  const h = o.h ?? 1.0;
  const col = o.color ?? PAL.metalLight;
  const len = Math.hypot(x2 - x1, z2 - z1);
  const n = Math.max(1, Math.round(len / (o.spacing ?? 1.4)));
  const dx = (x2 - x1) / len, dz = (z2 - z1) / len;
  const rot = Math.atan2(-dz, dx);
  for (let i = 0; i <= n; i++) {
    const x = x1 + (x2 - x1) * (i / n), z = z1 + (z2 - z1) * (i / n);
    b.box(x, top + h / 2, z, 0.05, h, 0.05, { kind: K.METAL, color: col });
  }
  const mx = (x1 + x2) / 2, mz = (z1 + z2) / 2;
  b.box(mx, top + h, mz, len + 0.05, 0.05, 0.07, { kind: K.METAL, color: col, rotY: rot });
  b.box(mx, top + h * 0.55, mz, len, 0.025, 0.025, { kind: K.METAL, color: col, rotY: rot });
  b.box(mx, top + 0.12, mz, len, 0.025, 0.025, { kind: K.METAL, color: col, rotY: rot });
  if (o.collide !== false && ctx.physics) {
    const minX = Math.min(x1, x2) - 0.04, maxX = Math.max(x1, x2) + 0.04;
    const minZ = Math.min(z1, z2) - 0.04, maxZ = Math.max(z1, z2) + 0.04;
    ctx.solid([minX, top, minZ], [maxX, top + h, maxZ], 'railing');
  }
}

// Bande corail affleurante au bord d'un appel de saut (vision du coureur)
export function edgeMark(ctx, minX, maxX, minZ, maxZ, top) {
  ctx.arch.boxMinMax(minX, top - 0.02, minZ, maxX, top + 0.012, maxZ, { kind: K.CORAL, color: PAL.coral });
}

export function acUnit(ctx, x, y, z, o = {}) {
  const b = o.batch ?? ctx.arch;
  const s = o.scale ?? 1;
  const rot = o.rotY ?? 0;
  const w = 1.3 * s, h = 0.95 * s, d = 0.85 * s;
  if (b !== ctx.far) b.box(x, y + 0.06, z, w + 0.1, 0.12, d + 0.1, { kind: K.METAL, color: PAL.metalDark, rotY: rot });
  b.box(x, y + 0.12 + h / 2, z, w, h, d, { kind: K.VENT, color: o.color ?? PAL.metalLight, rotY: rot });
  ao(ctx, x, z, w + 0.6, d + 0.6, y, 1, rot);
  if (o.collide && ctx.physics) {
    const r = Math.max(w, d) / 2;
    ctx.solid([x - r, y, z - r], [x + r, y + 0.12 + h, z + r], 'prop');
  }
}

export function waterTank(ctx, x, y, z, o = {}) {
  const b = o.batch ?? ctx.arch;
  const r = o.r ?? 1.1, h = o.h ?? 1.8, leg = o.leg ?? 1.4;
  for (const [lx, lz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    b.box(x + lx * r * 0.62, y + leg / 2, z + lz * r * 0.62, 0.1, leg, 0.1, { kind: K.METAL, color: PAL.metalDark });
  }
  b.box(x, y + leg - 0.05, z, r * 1.6, 0.1, r * 1.6, { kind: K.METAL, color: PAL.metalDark });
  ao(ctx, x, z, r * 2.4, r * 2.4, y, 0.6);
  b.cylinder(x, y + leg, z, r, r, h, 16, { kind: K.WOOD, color: o.color ?? PAL.woodPale, caps: false });
  for (const t of [0.2, 0.55, 0.88]) b.cylinder(x, y + leg + h * t, z, r + 0.025, r + 0.025, 0.05, 16, { kind: K.METAL, color: PAL.metalDark, caps: false });
  b.cylinder(x, y + leg + h, z, 0.05, r + 0.08, 0.7, 16, { kind: K.TERRA, color: o.roof ?? PAL.woodDark });
  if (o.collide && ctx.physics) ctx.solid([x - r * 0.7, y, z - r * 0.7], [x + r * 0.7, y + leg + h, z + r * 0.7], 'prop');
}

export function vent(ctx, x, y, z, o = {}) {
  const b = o.batch ?? ctx.arch;
  const r = o.r ?? 0.18, h = o.h ?? 0.9;
  b.cylinder(x, y, z, r, r, h, 10, { kind: K.METAL, color: PAL.metalLight, caps: false });
  b.cylinder(x, y + h, z, 0.02, r * 1.8, r * 0.9, 10, { kind: K.METAL, color: PAL.metalLight });
}

export function chimney(ctx, x, y, z, o = {}) {
  const b = o.batch ?? ctx.arch;
  const w = o.w ?? 0.7, h = o.h ?? 1.4;
  b.box(x, y + h / 2, z, w, h, w, { kind: K.PLASTER, color: o.color ?? PAL.plaster });
  b.box(x, y + h + 0.05, z, w + 0.14, 0.1, w + 0.14, { kind: K.STONE, color: PAL.coping });
  b.box(x, y + h + 0.32, z, w * 0.5, 0.06, w * 0.5, { kind: K.PLASTER, color: PAL.coping });
  for (const [lx, lz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) b.box(x + lx * w * 0.22, y + h + 0.2, z + lz * w * 0.22, 0.05, 0.2, 0.05, { kind: K.PLASTER, color: PAL.coping });
}

export function antenna(ctx, x, y, z, o = {}) {
  const b = o.batch ?? ctx.arch;
  const h = o.h ?? 4;
  b.tube([x, y, z], [x, y + h, z], 0.035, 6, { kind: K.METAL, color: PAL.metalDark });
  for (let i = 1; i <= 3; i++) {
    const yy = y + h * (0.45 + i * 0.15);
    const l = 0.9 - i * 0.2;
    b.box(x, yy, z, l, 0.03, 0.03, { kind: K.METAL, color: PAL.metalDark, rotY: o.rotY ?? 0 });
  }
}

// Édicule d'escalier avec porte, lampe et petit auvent
export function hut(ctx, x, y, z, o = {}) {
  const b = o.batch ?? ctx.arch;
  const w = o.w ?? 2.8, d = o.d ?? 2.6, h = o.h ?? 2.7;
  const rot = o.rotY ?? 0;
  const cs = Math.cos(rot), sn = Math.sin(rot);
  const L = (lx, lz) => [x + lx * cs + lz * sn, z - lx * sn + lz * cs];
  b.box(x, y + h / 2, z, w, h, d, { kind: K.PLASTER, color: o.color ?? PAL.plasterWarm, rotY: rot });
  ao(ctx, x, z, w + 0.8, d + 0.8, y, 1, rot);
  b.box(x, y + h + 0.09, z, w + 0.3, 0.18, d + 0.3, { kind: K.STONE, color: PAL.coping, rotY: rot });
  // Porte sur la face +z locale
  const [dx, dz] = L(0, d / 2 + 0.02);
  b.box(dx, y + 1.05, dz, 0.95, 2.1, 0.06, { kind: K.WOOD, color: o.door ?? PAL.woodDark, rotY: rot });
  const [fx, fz] = L(0, d / 2 + 0.03);
  b.box(fx, y + 2.16, fz, 1.15, 0.1, 0.08, { kind: K.STONE, color: PAL.coping, rotY: rot });
  const [lx, lz] = L(0.75, d / 2 + 0.1);
  b.box(lx, y + 2.3, lz, 0.16, 0.22, 0.16, { kind: K.GLOW, color: PAL.glow, rotY: rot });
  if (o.awning !== false) {
    const col = o.awningColor ?? PAL.fabrics[1];
    awning(ctx, ...L(0, d / 2), y + 2.55, 1.6, 0.8, rot, { color: col, stripes: o.stripes });
  }
  if (o.vent !== false) vent(ctx, ...(() => { const p = L(-w * 0.28, -d * 0.2); return [p[0], y + h + 0.18, p[1]]; })(), { batch: b });
  if (o.collide !== false && ctx.physics) {
    const r = Math.max(w, d) / 2;
    const ex = Math.abs(cs) * w / 2 + Math.abs(sn) * d / 2, ez = Math.abs(sn) * w / 2 + Math.abs(cs) * d / 2;
    ctx.solid([x - ex, y, z - ez], [x + ex, y + h, z + ez], 'prop');
    void r;
  }
}

export function planter(ctx, x, y, z, w, d, o = {}) {
  const b = o.batch ?? ctx.arch;
  const h = o.h ?? 0.55;
  b.box(x, y + h / 2, z, w, h, d, { kind: o.kind ?? K.STONE, color: o.color ?? PAL.stone });
  ao(ctx, x, z, w + 0.5, d + 0.5, y, 0.9);
  b.box(x, y + h - 0.02, z, w - 0.16, 0.04, d - 0.16, { kind: K.SOIL, color: 0x6b5444 });
  if (o.collide !== false && ctx.physics) ctx.solid([x - w / 2, y, z - d / 2], [x + w / 2, y + h, z + d / 2], 'planter');
  return y + h;
}

export function bench(ctx, x, y, z, o = {}) {
  const b = o.batch ?? ctx.arch;
  const rot = o.rotY ?? 0;
  const len = o.len ?? 1.8;
  const cs = Math.cos(rot), sn = Math.sin(rot);
  const L = (lx, lz) => [x + lx * cs + lz * sn, z - lx * sn + lz * cs];
  ao(ctx, x, z, len + 0.4, 0.9, y, 0.7, rot);
  for (const s of [-1, 1]) {
    const [px, pz] = L(s * (len / 2 - 0.15), 0);
    b.box(px, y + 0.21, pz, 0.08, 0.42, 0.42, { kind: K.METAL, color: PAL.metalDark, rotY: rot });
  }
  for (let i = 0; i < 4; i++) {
    const [px, pz] = L(0, -0.15 + i * 0.1);
    b.box(px, y + 0.44, pz, len, 0.04, 0.08, { kind: K.WOOD, color: PAL.wood, rotY: rot });
  }
  if (o.back !== false) {
    for (let i = 0; i < 2; i++) {
      const [px, pz] = L(0, 0.22);
      b.box(px, y + 0.62 + i * 0.13, pz, len, 0.08, 0.035, { kind: K.WOOD, color: PAL.wood, rotY: rot });
    }
  }
  if (o.collide && ctx.physics) {
    const ex = Math.abs(cs) * len / 2 + Math.abs(sn) * 0.25, ez = Math.abs(sn) * len / 2 + Math.abs(cs) * 0.25;
    ctx.solid([x - ex, y, z - ez], [x + ex, y + 0.5, z + ez], 'bench');
  }
}

export function lantern(ctx, x, y, z, o = {}) {
  const b = o.batch ?? ctx.arch;
  const h = o.h ?? 1.6;
  b.box(x, y + 0.06, z, 0.3, 0.12, 0.3, { kind: K.STONE, color: PAL.stone });
  ao(ctx, x, z, 0.8, 0.8, y, 0.7);
  b.box(x, y + h / 2, z, 0.12, h, 0.12, { kind: K.WOOD, color: PAL.woodDark });
  b.box(x, y + h + 0.2, z, 0.3, 0.38, 0.3, { kind: K.GLOW, color: PAL.glow });
  for (const [lx, lz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) b.box(x + lx * 0.16, y + h + 0.2, z + lz * 0.16, 0.04, 0.42, 0.04, { kind: K.WOOD, color: PAL.woodDark });
  b.box(x, y + h + 0.43, z, 0.46, 0.06, 0.46, { kind: K.WOOD, color: PAL.woodDark });
  b.box(x, y + h + 0.5, z, 0.26, 0.08, 0.26, { kind: K.WOOD, color: PAL.woodDark });
  if (o.collide !== false && ctx.physics) ctx.solid([x - 0.1, y, z - 0.1], [x + 0.1, y + h + 0.4, z + 0.1], 'post');
}

export function pot(ctx, x, y, z, o = {}) {
  const b = o.batch ?? ctx.arch;
  const r = o.r ?? 0.32, h = o.h ?? 0.5;
  b.cylinder(x, y, z, r, r * 0.75, h, 12, { kind: K.TERRA, color: o.color ?? PAL.terra });
  ao(ctx, x, z, r * 2.6, r * 2.6, y, 0.8);
  b.cylinder(x, y + h - 0.01, z, r * 0.9, r * 0.9, 0.02, 12, { kind: K.SOIL, color: 0x6b5444 });
  if (o.collide && ctx.physics) ctx.solid([x - r, y, z - r], [x + r, y + h, z + r], 'pot');
  return y + h;
}

export function skylight(ctx, x, y, z, w, d, o = {}) {
  const b = o.batch ?? ctx.arch;
  b.box(x, y + 0.2, z, w, 0.4, d, { kind: K.METAL, color: PAL.metalLight });
  b.box(x, y + 0.42, z, w - 0.12, 0.05, d - 0.12, { kind: K.GLASS, color: 0xb8c4d0 });
}

export function crate(ctx, x, y, z, s = 0.6, o = {}) {
  const b = o.batch ?? ctx.arch;
  b.box(x, y + s / 2, z, s, s, s, { kind: K.WOOD, color: o.color ?? PAL.woodPale, rotY: o.rotY ?? 0 });
  ao(ctx, x, z, s + 0.4, s + 0.4, y, 0.8);
}

// Petite table et deux chaises
export function cafeSet(ctx, x, y, z, o = {}) {
  const b = o.batch ?? ctx.arch;
  b.cylinder(x, y, z, 0.03, 0.03, 0.72, 6, { kind: K.METAL, color: PAL.metalDark, caps: false });
  b.cylinder(x, y + 0.72, z, 0.38, 0.38, 0.03, 14, { kind: K.METAL, color: PAL.metalLight });
  b.cylinder(x, y, z, 0.2, 0.22, 0.03, 10, { kind: K.METAL, color: PAL.metalDark });
  ao(ctx, x, z, 2.0, 1.2, y, 0.5, rot0(o));
  const rot = o.rotY ?? 0;
  for (const s of [-1, 1]) {
    const cx = x + Math.cos(rot) * s * 0.65, cz = z - Math.sin(rot) * s * 0.65;
    b.box(cx, y + 0.44, cz, 0.42, 0.04, 0.42, { kind: K.WOOD, color: PAL.wood, rotY: rot });
    for (const [lx, lz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) b.box(cx + lx * 0.18, y + 0.22, cz + lz * 0.18, 0.03, 0.44, 0.03, { kind: K.METAL, color: PAL.metalDark });
    const bx = x + Math.cos(rot) * s * 0.86, bz = z - Math.sin(rot) * s * 0.86;
    b.box(bx, y + 0.7, bz, 0.04, 0.5, 0.42, { kind: K.WOOD, color: PAL.wood, rotY: rot });
  }
}

// Guirlande lumineuse entre deux points
export function stringLights(ctx, a, c, o = {}) {
  const b = o.batch ?? ctx.arch;
  const n = o.n ?? 12;
  const sag = o.sag ?? 0.5;
  let prev = a;
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const p = [a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t - sag * 4 * t * (1 - t), a[2] + (c[2] - a[2]) * t];
    b.tube(prev, p, 0.008, 3, { kind: K.METAL, color: PAL.metalDark });
    if (i < n) b.box(p[0], p[1] - 0.06, p[2], 0.07, 0.09, 0.07, { kind: K.GLOW, color: i % 3 === 0 ? 0xffe6c0 : PAL.glow });
    prev = p;
  }
}

// ---------- Tissus ----------

// Voile d'ombrage tendue entre 3 ou 4 coins, avec mâts.
export function shadeSail(ctx, corners, o = {}) {
  const f = ctx.fabric;
  const col = o.color ?? PAL.fabrics[0];
  const sag = o.sag ?? 0.35;
  if (corners.length === 4) {
    const [p0, p1, p2, p3] = corners;
    f.cloth((s, t) => {
      const a = lerp3(p0, p1, s), bb = lerp3(p3, p2, s);
      const p = lerp3(a, bb, t);
      // bords incurvés vers l'intérieur + affaissement au centre
      const edge = Math.sin(Math.PI * s) * Math.sin(Math.PI * t);
      p[1] -= sag * edge;
      return p;
    }, 8, 8, { color: col, pin: (s, t) => Math.sin(Math.PI * s) * Math.sin(Math.PI * t) * 0.8 });
  } else {
    const [p0, p1, p2] = corners;
    f.cloth((s, t) => {
      const a = lerp3(p0, p1, s);
      const p = lerp3(a, p2, t);
      p[1] -= sag * Math.sin(Math.PI * s) * Math.sin(Math.PI * t) * (1 - t);
      return p;
    }, 8, 8, { color: col, pin: (s, t) => Math.sin(Math.PI * s) * Math.sin(Math.PI * (1 - t) * 0.999) * 0.6 });
  }
  if (o.posts) {
    for (const p of corners) {
      if (p[3] === false) continue;
      const base = o.base ?? 0;
      ctx.arch.cylinder(p[0], base, p[2], 0.045, 0.06, p[1] - base + 0.15, 8, { kind: K.METAL, color: PAL.metalDark });
      if (ctx.physics && o.collide) ctx.solid([p[0] - 0.06, base, p[2] - 0.06], [p[0] + 0.06, p[1], p[2] + 0.06], 'post');
    }
  }
}

// Auvent rayé incliné au-dessus d'une porte ou d'une fenêtre
export function awning(ctx, x, z, y, w, depth, rotY = 0, o = {}) {
  const f = ctx.fabric;
  const cs = Math.cos(rotY), sn = Math.sin(rotY);
  const c1 = o.color ?? PAL.fabrics[1];
  const c2 = o.color2 ?? PAL.fabrics[0];
  const stripes = o.stripes ?? 7;
  f.cloth((s, t) => {
    const lx = (s - 0.5) * w;
    const lz = t * depth;
    const ly = -t * depth * 0.55 - Math.sin(Math.PI * s) * 0.03;
    return [x + lx * cs + lz * sn, y + ly, z - lx * sn + lz * cs];
  }, stripes * 2, 3, { color: (s) => (Math.floor(s * stripes * 0.999) % 2 === 0 ? c1 : c2), pin: (s, t) => t * 0.25 });
  // Lambrequin
  f.cloth((s, t) => {
    const lx = (s - 0.5) * w;
    const lz = depth;
    const ly = -depth * 0.55 - t * 0.18;
    return [x + lx * cs + lz * sn, y + ly, z - lx * sn + lz * cs];
  }, stripes * 2, 1, { color: (s) => (Math.floor(s * stripes * 0.999) % 2 === 0 ? c1 : c2), pin: (s, t) => 0.25 + t * 0.4 });
}

// Bannière verticale suspendue à une tringle (sur une façade)
export function banner(ctx, x, y, z, w, h, rotY = 0, o = {}) {
  const f = ctx.fabric;
  const cs = Math.cos(rotY), sn = Math.sin(rotY);
  const col = o.color ?? PAL.fabrics[2];
  const col2 = o.color2 ?? null;
  f.cloth((s, t) => {
    const lx = (s - 0.5) * w;
    const lz = Math.sin(t * Math.PI * 0.5) * 0.12;
    return [x + lx * cs + lz * sn, y - t * h, z - lx * sn + lz * cs];
  }, 3, 8, { color: col2 ? (s, t) => (t > 0.12 && t < 0.2 ? col2 : col) : col, pin: (s, t) => t * 0.9 });
  ctx.arch.box(x, y + 0.02, z, w + 0.16, 0.04, 0.04, { kind: K.METAL, color: PAL.woodDark, rotY });
}

// Corde à linge avec quelques pièces de tissu
export function laundry(ctx, a, c, o = {}) {
  const sag = o.sag ?? 0.35;
  const n = 10;
  let prev = a;
  const pts = [a];
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const p = [a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t - sag * 4 * t * (1 - t), a[2] + (c[2] - a[2]) * t];
    ctx.arch.tube(prev, p, 0.008, 3, { kind: K.METAL, color: PAL.rope });
    pts.push(p);
    prev = p;
  }
  const len = Math.hypot(c[0] - a[0], c[2] - a[2]);
  const dx = (c[0] - a[0]) / len, dz = (c[2] - a[2]) / len;
  const items = o.items ?? Math.floor(len / 1.1);
  const rand = ctx.rand;
  for (let i = 0; i < items; i++) {
    const t = (i + 0.5 + (rand() - 0.5) * 0.4) / items;
    if (rand() < 0.15) continue;
    const y0 = a[1] + (c[1] - a[1]) * t - sag * 4 * t * (1 - t);
    const x0 = a[0] + (c[0] - a[0]) * t, z0 = a[2] + (c[2] - a[2]) * t;
    const w = 0.45 + rand() * 0.45, h = 0.5 + rand() * 0.6;
    const col = PAL.fabrics[Math.floor(rand() * PAL.fabrics.length)];
    ctx.fabric.cloth((s, tt) => [x0 + dx * (s - 0.5) * w, y0 - tt * h, z0 + dz * (s - 0.5) * w], 3, 4, { color: col, pin: (s, tt) => tt });
  }
}

function lerp3(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

// Toit à deux pans en tuiles (axe du faîtage : 'x' ou 'z')
export function gableRoof(ctx, minX, maxX, minZ, maxZ, y, h, o = {}) {
  const b = o.batch ?? ctx.arch;
  const axis = o.axis ?? (maxX - minX >= maxZ - minZ ? 'x' : 'z');
  const ov = o.overhang ?? 0.35;
  const col = o.color ?? PAL.terra;
  const wall = o.wallColor ?? PAL.plaster;
  const x0 = minX - ov, x1 = maxX + ov, z0 = minZ - ov, z1 = maxZ + ov;
  const kind = K.ROOF;
  const rgb = toRGB(col), wrgb = toRGB(wall);
  const quad = (p0, p1, p2, p3, n, w, l, c, k) => {
    const ids = [
      b.vertex(...p0, ...n, 0, 0, c, k, w, l, 0),
      b.vertex(...p1, ...n, 0, l, c, k, w, l, 0),
      b.vertex(...p2, ...n, w, l, c, k, w, l, 0),
      b.vertex(...p3, ...n, w, 0, c, k, w, l, 0),
    ];
    b.quadIdx(ids[0], ids[1], ids[2], ids[3]);
  };
  const tri = (p0, p1, p2, n, c) => {
    const a = b.vertex(...p0, ...n, 0, 0, c, K.PLASTER, 100, 100, 0);
    const bb = b.vertex(...p1, ...n, 0, 0, c, K.PLASTER, 100, 100, 0);
    const cc = b.vertex(...p2, ...n, 0, 0, c, K.PLASTER, 100, 100, 0);
    b.tri(a, bb, cc);
  };
  if (axis === 'x') {
    const zm = (minZ + maxZ) / 2, half = (z1 - z0) / 2;
    const sl = Math.hypot(half, h);
    const ny = half / sl, nz = h / sl;
    const W = x1 - x0;
    // pan +z puis pan -z (u le long du faîtage, v du faîtage vers l'égout)
    quad([x0, y + h, zm], [x0, y, z1], [x1, y, z1], [x1, y + h, zm], [0, ny, nz], W, sl, rgb, kind);
    quad([x1, y + h, zm], [x1, y, z0], [x0, y, z0], [x0, y + h, zm], [0, ny, -nz], W, sl, rgb, kind);
    tri([minX, y, maxZ], [minX, y, minZ], [minX, y + h * (maxZ - minZ) / (z1 - z0), zm], [-1, 0, 0], wrgb);
    tri([maxX, y, minZ], [maxX, y, maxZ], [maxX, y + h * (maxZ - minZ) / (z1 - z0), zm], [1, 0, 0], wrgb);
  } else {
    const xm = (minX + maxX) / 2, half = (x1 - x0) / 2;
    const sl = Math.hypot(half, h);
    const ny = half / sl, nx = h / sl;
    const L = z1 - z0;
    quad([xm, y + h, z1], [x1, y, z1], [x1, y, z0], [xm, y + h, z0], [nx, ny, 0], L, sl, rgb, kind);
    quad([xm, y + h, z0], [x0, y, z0], [x0, y, z1], [xm, y + h, z1], [-nx, ny, 0], L, sl, rgb, kind);
    tri([minX, y, minZ], [maxX, y, minZ], [xm, y + h * (maxX - minX) / (x1 - x0), minZ], [0, 0, -1], wrgb);
    tri([maxX, y, maxZ], [minX, y, maxZ], [xm, y + h * (maxX - minX) / (x1 - x0), maxZ], [0, 0, 1], wrgb);
  }
}

// Coupole sur tambour
export function dome(ctx, x, y, z, r, o = {}) {
  const b = o.batch ?? ctx.arch;
  const drumH = o.drum ?? r * 0.5;
  b.cylinder(x, y, z, r * 1.02, r * 1.02, drumH, 24, { kind: K.PLASTER, color: o.drumColor ?? PAL.plaster, caps: false });
  b.cylinder(x, y + drumH, z, r * 1.1, r * 1.1, 0.18, 24, { kind: K.PLASTER, color: PAL.coping });
  const geo = new THREE.SphereGeometry(r, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2);
  const m = new THREE.Matrix4().makeTranslation(x, y + drumH + 0.15, z);
  b.geometry(geo, m, { kind: K.PLASTER, color: o.color ?? 0xf6f1ea, face: [100, 100] });
  b.cylinder(x, y + drumH + 0.15 + r * 0.98, z, 0.02, 0.12, 0.6, 8, { kind: K.METAL, color: PAL.metalDark });
}

// Gaine de ventilation qui court sur un toit, sur petits supports
export function duct(ctx, a, c, y, o = {}) {
  const b = o.batch ?? ctx.arch;
  const s = o.size ?? 0.42;
  const dx = c[0] - a[0], dz = c[1] - a[1];
  const len = Math.hypot(dx, dz);
  if (len < 0.5) return;
  const rot = Math.atan2(-dz, dx);
  const mx = (a[0] + c[0]) / 2, mz = (a[1] + c[1]) / 2;
  const hy = y + 0.35 + s / 2;
  b.box(mx, hy, mz, len, s, s, { kind: K.METAL, color: o.color ?? PAL.metalLight, rotY: rot });
  const n = Math.max(1, Math.floor(len / 1.6));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const px = a[0] + dx * t, pz = a[1] + dz * t;
    b.box(px, y + 0.175, pz, 0.08, 0.35, s + 0.1, { kind: K.METAL, color: PAL.metalDark, rotY: rot });
    if (i > 0 && i < n) b.box(px, hy, pz, 0.05, s + 0.04, s + 0.04, { kind: K.METAL, color: PAL.metal, rotY: rot });
  }
}

function rot0(o) { return o.rotY ?? 0; }

function toRGB(hex) {
  const c = new THREE.Color(hex);
  return [c.r, c.g, c.b];
}
