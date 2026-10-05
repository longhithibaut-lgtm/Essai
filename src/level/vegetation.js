import * as THREE from 'three';
import { K, ATLAS } from './surfaces.js';
import { rng } from './kit.js';

// Végétation : arbres en fleurs, oliviers, cyprès, buissons, lavande, lierre qui
// retombe des façades. Volumes adoucis (normales tournées vers l'extérieur du
// houppier) + cartes de feuilles qui découpent la silhouette.

export const LEAF = {
  blossom: [0xf7b8c8, 0xf9cdd8, 0xf4aec2, 0xfbd9e2],
  blossomCore: [0xe99bb0, 0xeea7ba],
  leaf: [0x9cc394, 0x8bb787, 0xaacf9c],
  olive: [0xb5c4a0, 0xa7b893, 0xc3cfae],
  cypress: [0x6f9a72, 0x5f8b66, 0x7ca67d],
  hedge: [0x88b07f, 0x7aa474, 0x96bc8a],
  lavender: [0xb8a6d8, 0xa995cf, 0xc7b8e0],
  ivy: [0x86ad7c, 0x77a06f, 0x94b98a, 0x9fc28f],
  grass: [0xa6c98f, 0x98bf86, 0xb3d29a],
  wisteria: [0xc9b5e6, 0xbba6dd, 0xd9c9ef],
};

const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _m = new THREE.Matrix4();
const _s = new THREE.Vector3();
const _ax = new THREE.Vector3();
const _ay = new THREE.Vector3();

const icoCache = new Map();
function ico(detail) {
  if (!icoCache.has(detail)) icoCache.set(detail, new THREE.IcosahedronGeometry(1, detail));
  return icoCache.get(detail);
}

function pick(arr, rand) { return arr[Math.floor(rand() * arr.length)]; }
const clamp01 = (x) => Math.min(1, Math.max(0, x));

// Volume de feuillage : sphère déformée, normales lisses tournées vers l'extérieur.
function blob(ctx, cx, cy, cz, r, color, center, o = {}) {
  const rand = ctx.rand;
  const src = ico(o.detail ?? 1);
  const pos = src.attributes.position;
  const sx = o.sx ?? 1, sy = o.sy ?? 0.85, sz = o.sz ?? 1;
  const ph = rand() * 10;
  const top = center[1] + (o.height ?? r), bottom = center[1] - (o.height ?? r);
  const c = new THREE.Color(color);
  const f = ctx.foliage;
  const base = f.count;
  const sw = o.sway ?? 0.5;
  const k = o.centerBlend ?? 0.55;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const n = 1 + 0.14 * Math.sin(x * 3.1 + ph) * Math.sin(y * 2.7 + ph * 1.3) * Math.sin(z * 3.3 + ph * 0.7);
    const px = cx + x * r * sx * n, py = cy + y * r * sy * n, pz = cz + z * r * sz * n;
    // normale : mélange de la normale de la boule et de la direction depuis le centre du houppier
    let nx = x / sx, ny = y / sy, nz = z / sz;
    let l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    let dx = px - center[0], dy = (py - center[1]) * 0.8, dz = pz - center[2];
    l = Math.hypot(dx, dy, dz) || 1;
    nx = nx * (1 - k) + (dx / l) * k;
    ny = ny * (1 - k) + (dy / l) * k + 0.12;
    nz = nz * (1 - k) + (dz / l) * k;
    l = Math.hypot(nx, ny, nz) || 1;
    const s = (0.62 + 0.42 * clamp01((py - bottom) / (top - bottom))) * (o.dim ?? 1);
    f.vertex(px, py, pz, nx / l, ny / l, nz / l, ATLAS.solid[0], ATLAS.solid[1], [c.r * s, c.g * s, c.b * s], K.PLAIN, 1, 1, 0, sw);
  }
  for (let i = 0; i < pos.count; i++) f.idx.push(base + i);
}

// Carte de feuillage (quad) centrée en p, axes ax/ay, normale nrm, région d'atlas
function card(f, p, ax, ay, nrm, rgb, region, sw) {
  const [u0, v0, u1, v1] = region;
  const ids = [
    f.vertex(p[0] - ax.x - ay.x, p[1] - ax.y - ay.y, p[2] - ax.z - ay.z, nrm[0], nrm[1], nrm[2], u0, v0, rgb, K.PLAIN, 1, 1, 0, sw),
    f.vertex(p[0] + ax.x - ay.x, p[1] + ax.y - ay.y, p[2] + ax.z - ay.z, nrm[0], nrm[1], nrm[2], u1, v0, rgb, K.PLAIN, 1, 1, 0, sw),
    f.vertex(p[0] + ax.x + ay.x, p[1] + ax.y + ay.y, p[2] + ax.z + ay.z, nrm[0], nrm[1], nrm[2], u1, v1, rgb, K.PLAIN, 1, 1, 0, sw),
    f.vertex(p[0] - ax.x + ay.x, p[1] - ax.y + ay.y, p[2] - ax.z + ay.z, nrm[0], nrm[1], nrm[2], u0, v1, rgb, K.PLAIN, 1, 1, 0, sw),
  ];
  f.quadIdx(ids[0], ids[1], ids[2], ids[3]);
}

// Cartes réparties à la surface d'un ellipsoïde
function cards(ctx, center, rx, ry, rz, n, colors, o = {}) {
  const rand = ctx.rand;
  const size = o.size ?? 0.7;
  const top = center[1] + ry, bottom = center[1] - ry;
  const region = o.region ?? ATLAS.leaves;
  const f = ctx.foliage;
  for (let i = 0; i < n; i++) {
    const u = rand() * 2 - 1;
    const a = rand() * Math.PI * 2;
    const yy = THREE.MathUtils.clamp(u * 0.95 + (o.upBias ?? 0.15), -0.85, 1);
    const rr = Math.sqrt(Math.max(0, 1 - yy * yy));
    const dir = [Math.cos(a) * rr, yy, Math.sin(a) * rr];
    const k = (o.shell ?? 0.85) + rand() * 0.22;
    const p = [center[0] + dir[0] * rx * k, center[1] + dir[1] * ry * k, center[2] + dir[2] * rz * k];
    const s = size * (0.75 + rand() * 0.5);
    _e.set(rand() * Math.PI, rand() * Math.PI * 2, rand() * Math.PI);
    _q.setFromEuler(_e);
    _ax.set(1, 0, 0).applyQuaternion(_q).multiplyScalar(s / 2);
    _ay.set(0, 1, 0).applyQuaternion(_q).multiplyScalar(s / 2);
    const nl = Math.hypot(dir[0], dir[1] + 0.25, dir[2]) || 1;
    const nrm = [dir[0] / nl, (dir[1] + 0.25) / nl, dir[2] / nl];
    const shade = (0.66 + 0.42 * clamp01((p[1] - bottom) / (top - bottom))) * (o.dim ?? 1);
    const c = new THREE.Color(pick(colors, rand)).multiplyScalar(shade);
    card(f, p, _ax, _ay, nrm, [c.r, c.g, c.b], region, o.sway ?? 0.9);
  }
}

function branch(ctx, a, b, r0, r1, color, seg = 8) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
  const len = A.distanceTo(B);
  const geo = new THREE.CylinderGeometry(r1, r0, len, seg, 1, true);
  geo.translate(0, len / 2, 0);
  const dir = B.clone().sub(A).normalize();
  _q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  _m.compose(A, _q, _s.set(1, 1, 1));
  ctx.arch.geometry(geo, _m, { kind: K.PLAIN, color });
}

export function tree(ctx, x, y, z, o = {}) {
  const rand = ctx.rand;
  const s = o.scale ?? 1;
  const kind = o.kind ?? 'blossom';
  const colors = LEAF[kind];
  const trunkCol = kind === 'olive' ? 0xa09284 : 0x9a7a66;
  const h = (kind === 'olive' ? 1.5 : 2.3) * s;
  const lean = [(rand() - 0.5) * 0.45 * s, (rand() - 0.5) * 0.45 * s];
  const topP = [x + lean[0], y + h, z + lean[1]];
  branch(ctx, [x, y, z], topP, 0.17 * s, 0.11 * s, trunkCol);
  const nb = 3 + Math.floor(rand() * 2);
  const R = (kind === 'olive' ? 1.25 : 1.6) * s;
  const RY = R * (kind === 'olive' ? 0.62 : 0.7);
  const center = [topP[0], y + h + RY * 0.9, topP[2]];
  for (let i = 0; i < nb; i++) {
    const a = (i / nb) * Math.PI * 2 + rand();
    const e = [topP[0] + Math.cos(a) * 0.9 * R, y + h + (0.5 + rand() * 0.6) * RY, topP[2] + Math.sin(a) * 0.9 * R];
    branch(ctx, [topP[0], topP[1] - 0.25 * s, topP[2]], e, 0.085 * s, 0.035 * s, trunkCol, 6);
  }
  // Volume intérieur (plus sombre) puis touffes, enfin beaucoup de cartes en surface
  blob(ctx, center[0], center[1], center[2], R * 0.66, kind === 'blossom' ? LEAF.blossomCore[0] : colors[1], center, { detail: 2, height: RY * 1.1, sway: 0.2, sy: 0.72, dim: 0.78 });
  const nBlobs = 4 + Math.floor(rand() * 3);
  for (let i = 0; i < nBlobs; i++) {
    const a = rand() * Math.PI * 2;
    const d = (0.5 + rand() * 0.3) * R;
    const r = (0.3 + rand() * 0.14) * R;
    blob(ctx, center[0] + Math.cos(a) * d, center[1] + (rand() - 0.35) * RY * 0.6, center[2] + Math.sin(a) * d, r, pick(colors, rand), center, { detail: 1, height: RY * 1.1, sway: 0.35, dim: 0.9 });
  }
  const nCards = Math.floor((kind === 'blossom' ? 230 : 170) * s * s + 30);
  const region = kind === 'blossom' ? ATLAS.blossom : ATLAS.leaves;
  cards(ctx, center, R * 1.02, RY * 1.08, R * 1.02, nCards, colors, { size: 0.72 * Math.sqrt(s), region, shell: 0.7 });
  if (kind === 'blossom') cards(ctx, center, R * 0.9, RY * 0.95, R * 0.9, Math.floor(40 * s * s), LEAF.leaf, { size: 0.5 * Math.sqrt(s), region: ATLAS.leaves, dim: 0.85, shell: 0.75 });
  if (kind === 'blossom' && o.petals !== false) {
    for (let i = 0; i < 34; i++) {
      const a = rand() * Math.PI * 2, d = Math.sqrt(rand()) * R * 1.5;
      ctx.arch.box(x + Math.cos(a) * d, y + 0.006, z + Math.sin(a) * d, 0.06, 0.012, 0.05, { kind: K.PLAIN, color: pick(colors, rand), rotY: rand() * 3 });
    }
  }
  if (ctx.ao) ctx.ao(x, z, 1.1 * s, 1.1 * s, y, 0.7);
  if (o.collide !== false && ctx.physics) ctx.solid([x - 0.22 * s, y, z - 0.22 * s], [x + 0.22 * s, y + h, z + 0.22 * s], 'tree');
}

export function cypress(ctx, x, y, z, o = {}) {
  const rand = ctx.rand;
  const h = o.h ?? 5;
  const r = o.r ?? 0.7;
  branch(ctx, [x, y, z], [x, y + 0.8, z], 0.12, 0.1, 0x7a6555);
  const n = 5;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const rr = r * (1 - t * 0.6) * (0.9 + rand() * 0.2);
    const cy = y + 0.9 + t * (h - 1.4);
    blob(ctx, x + (rand() - 0.5) * 0.15, cy, z + (rand() - 0.5) * 0.15, rr, pick(LEAF.cypress, rand), [x, cy, z], { detail: 1, sy: 1.5, height: h * 0.5, sway: 0.25 * t });
  }
  const center = [x, y + h * 0.5 + 0.4, z];
  cards(ctx, center, r * 0.95, h * 0.47, r * 0.95, Math.floor(26 + h * 8), LEAF.cypress, { size: 0.5, sway: 0.4, upBias: 0 });
  if (o.collide !== false && ctx.physics) ctx.solid([x - 0.3, y, z - 0.3], [x + 0.3, y + h, z + 0.3], 'tree');
}

export function bush(ctx, x, y, z, o = {}) {
  const rand = ctx.rand;
  const r = o.r ?? 0.6;
  const colors = LEAF[o.kind ?? 'hedge'];
  const center = [x, y + r * 0.6, z];
  const n = o.blobs ?? 3;
  for (let i = 0; i < n; i++) {
    const a = rand() * Math.PI * 2, d = rand() * r * 0.45;
    blob(ctx, x + Math.cos(a) * d, y + r * (0.5 + rand() * 0.25), z + Math.sin(a) * d, r * (0.6 + rand() * 0.3), pick(colors, rand), center, { detail: o.lite ? 0 : 1, height: r, sway: 0.2, dim: 0.9 });
  }
  cards(ctx, center, r * 1.02, r * 0.75, r * 1.02, Math.floor((o.lite ? 6 : 14) + r * (o.lite ? 14 : 30)), colors, { size: 0.32 + r * 0.25, sway: 0.4 });
  if (o.flowers) {
    const fc = o.flowers;
    cards(ctx, center, r * 1.05, r * 0.78, r * 1.05, Math.floor((o.lite ? 3 : 6) + r * (o.lite ? 8 : 14)), Array.isArray(fc) ? fc : [fc], { size: 0.22 + r * 0.2, region: ATLAS.blossom, sway: 0.4, upBias: 0.5 });
  }
}

// Haie taillée le long d'un rectangle
export function hedge(ctx, minX, minZ, maxX, maxZ, y, o = {}) {
  const h = o.h ?? 0.7;
  const w = maxX - minX, d = maxZ - minZ;
  const n = Math.max(1, Math.round(Math.max(w, d) / 0.8));
  const alongX = w >= d;
  const thick = Math.min(alongX ? d : w, 1.2);
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const x = alongX ? minX + w * t : (minX + maxX) / 2;
    const z = alongX ? (minZ + maxZ) / 2 : minZ + d * t;
    const r = Math.max(thick * 0.62, 0.4);
    blob(ctx, x, y + h * 0.55, z, r * 0.9, pick(o.colors ?? LEAF.hedge, ctx.rand), [x, y + h * 0.3, z], { detail: 1, sx: 1.1, sy: h / r * 0.6, sz: 1.1, height: h, sway: 0.1, dim: 0.82 });
  }
  const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
  if (ctx.ao) ctx.ao(cx, cz, w + 0.5, d + 0.5, y, 0.9);
  cards(ctx, [cx, y + h * 0.55, cz], w / 2 + 0.12, h * 0.52, d / 2 + 0.12, Math.floor((w + d) * 22), o.colors ?? LEAF.hedge, { size: 0.42, sway: 0.2, shell: 0.88 });
}

// Rangée de lavande en fleurs
export function lavender(ctx, x, y, z, w, d, o = {}) {
  // Touffes de lavande : un coussin gris-vert bas, puis des gerbes de tiges fines dont
  // la pointe vire au violet (cartes croisées teintées du pied à la pointe).
  // Tirage propre à chaque massif : retoucher la lavande ne redistribue pas le reste.
  const rand = rng(Math.floor(Math.abs(x * 131 + z * 17 + w * 7)) + 5);
  const lctx = { ...ctx, rand };
  const n = Math.floor(w * d * (o.density ?? 5));
  const f = ctx.foliage;
  const [u0, v0, u1, v1] = ATLAS.grass;
  for (let i = 0; i < n; i++) {
    const px = x + (rand() - 0.5) * w, pz = z + (rand() - 0.5) * d;
    const r = 0.15 + rand() * 0.09;
    blob(lctx, px, y + r * 0.45, pz, r, pick(LEAF.olive, rand), [px, y, pz], { detail: 1, height: r * 0.6, sy: 0.55, sway: 0.15, dim: 0.88 });
    const leaf = new THREE.Color(pick(LEAF.olive, rand)).multiplyScalar(0.8);
    const flower = new THREE.Color(pick([0x8f72c8, 0x7f63bb, 0x9c82d2, 0x8a6dbf], rand));
    const bot = [leaf.r * 0.7, leaf.g * 0.7, leaf.b * 0.7];
    const top = [flower.r * 0.8, flower.g * 0.8, flower.b * 0.8];
    const a0 = rand() * Math.PI;
    for (let k = 0; k < 3; k++) {
      const h = 0.36 + rand() * 0.2, wd = r * 2.4 + rand() * 0.12;
      const aa = a0 + k * Math.PI / 3;
      const dx = Math.cos(aa) * wd / 2, dz = Math.sin(aa) * wd / 2;
      const yb = y + r * 0.35;
      const ids = [
        f.vertex(px - dx, yb, pz - dz, 0, 1, 0, u0, v0, bot, K.PLAIN, 1, 1, 0, 0),
        f.vertex(px + dx, yb, pz + dz, 0, 1, 0, u1, v0, bot, K.PLAIN, 1, 1, 0, 0),
        f.vertex(px + dx * 1.25, yb + h, pz + dz * 1.25, 0, 1, 0, u1, v1, top, K.PLAIN, 1, 1, 0, 0.7),
        f.vertex(px - dx * 1.25, yb + h, pz - dz * 1.25, 0, 1, 0, u0, v1, top, K.PLAIN, 1, 1, 0, 0.7),
      ];
      f.quadIdx(ids[0], ids[1], ids[2], ids[3]);
    }
  }
  // L'ancienne lavande puisait 21 tirages par touffe dans le générateur commun : on les
  // consomme encore, pour que tout ce qui suit garde sa place et sa forme.
  for (let i = 0; i < n * 21; i++) ctx.rand();
}

// Lierre en rideau qui retombe d'un rebord le long d'une façade. (nx, nz) : normale de la façade.
export function ivy(ctx, x, y, z, width, length, nx, nz, o = {}) {
  const rand = ctx.rand;
  const tx = -nz, tz = nx; // tangente
  const f = ctx.foliage;
  const strands = Math.max(2, Math.floor(width / (o.spacing ?? 0.24)));
  const colors = o.colors ?? LEAF.ivy;
  for (let si = 0; si < strands; si++) {
    const s = (si / (strands - 1) - 0.5) * width + (rand() - 0.5) * 0.12;
    // longueur : plus long au centre, irrégulier
    const edge = 1 - Math.pow(Math.abs(s) / (width / 2), 2);
    const L = length * (0.35 + 0.65 * edge) * (0.6 + 0.4 * rand());
    const n = Math.max(2, Math.floor(L / 0.11));
    // touffe qui déborde sur le rebord
    if (o.over) {
      for (let k = 0; k < 2; k++) {
        const p = [x + tx * s - nx * rand() * o.over, y + 0.04 + rand() * 0.08, z + tz * s - nz * rand() * o.over];
        _ax.set(tx, 0, tz).multiplyScalar(0.18);
        _ay.set(-nx, 0.6, -nz).normalize().multiplyScalar(0.18);
        const c = new THREE.Color(pick(colors, rand));
        card(f, p, _ax, _ay, [nx * 0.3, 0.9, nz * 0.3], [c.r, c.g, c.b], ATLAS.leaves, 0.3);
      }
    }
    for (let k = 0; k < n; k++) {
      const t = (k / n) * L;
      const wob = Math.sin(t * 2.3 + si) * 0.05;
      const off = 0.03 + rand() * 0.07 + (k === 0 ? 0.05 : 0);
      const p = [x + tx * (s + wob) + nx * off, y - t, z + tz * (s + wob) + nz * off];
      const sz = (0.3 + rand() * 0.14) * (1 - 0.3 * (t / L));
      const ang = rand() * Math.PI * 2;
      _ax.set(tx * Math.cos(ang), Math.sin(ang), tz * Math.cos(ang)).multiplyScalar(sz / 2);
      _ay.set(-tx * Math.sin(ang) + nx * 0.25, Math.cos(ang), -tz * Math.sin(ang) + nz * 0.25).normalize().multiplyScalar(sz / 2);
      const c = new THREE.Color(pick(colors, rand)).multiplyScalar(0.9 + 0.3 * (1 - t / L));
      const nn = [nx * 0.85, 0.45, nz * 0.85];
      card(f, p, _ax, _ay, nn, [c.r, c.g, c.b], ATLAS.leaves, 0.25 + 0.75 * (t / Math.max(L, 0.1)));
    }
  }
  if (o.flowers) {
    for (let i = 0; i < Math.floor(width * 3); i++) {
      const s = (rand() - 0.5) * width;
      const t = rand() * length * 0.5;
      const p = [x + tx * s + nx * 0.12, y - t, z + tz * s + nz * 0.12];
      const sz = 0.22;
      _ax.set(tx, 0, tz).multiplyScalar(sz / 2);
      _ay.set(nx * 0.3, 1, nz * 0.3).normalize().multiplyScalar(sz / 2);
      const c = new THREE.Color(pick(o.flowers, rand));
      card(f, p, _ax, _ay, [nx, 0.4, nz], [c.r, c.g, c.b], ATLAS.blossom, 0.5);
    }
  }
}

// Herbe : brins en cartes croisées
export function grass(ctx, x, y, z, w, d, o = {}) {
  const rand = ctx.rand;
  const n = Math.floor(w * d * (o.density ?? 6));
  const f = ctx.foliage;
  const [u0, v0, u1, v1] = ATLAS.grass;
  for (let i = 0; i < n; i++) {
    const px = x + (rand() - 0.5) * w, pz = z + (rand() - 0.5) * d;
    const h = 0.22 + rand() * 0.22, wd = 0.35 + rand() * 0.25;
    const a = rand() * Math.PI;
    const c = new THREE.Color(pick(o.colors ?? LEAF.grass, rand));
    const top = [c.r, c.g, c.b];
    const bot = [c.r * 0.7, c.g * 0.7, c.b * 0.7];
    for (let k = 0; k < 2; k++) {
      const aa = a + k * Math.PI / 2;
      const dx = Math.cos(aa) * wd / 2, dz = Math.sin(aa) * wd / 2;
      const ids = [
        f.vertex(px - dx, y, pz - dz, 0, 1, 0, u0, v0, bot, K.PLAIN, 1, 1, 0, 0),
        f.vertex(px + dx, y, pz + dz, 0, 1, 0, u1, v0, bot, K.PLAIN, 1, 1, 0, 0),
        f.vertex(px + dx, y + h, pz + dz, 0, 1, 0, u1, v1, top, K.PLAIN, 1, 1, 0, 0.6),
        f.vertex(px - dx, y + h, pz - dz, 0, 1, 0, u0, v1, top, K.PLAIN, 1, 1, 0, 0.6),
      ];
      f.quadIdx(ids[0], ids[1], ids[2], ids[3]);
    }
  }
}

// Grappes de glycine qui pendent (pergolas)
export function wisteria(ctx, x, y, z, o = {}) {
  const rand = ctx.rand;
  const f = ctx.foliage;
  const L = o.length ?? 0.5;
  const n = 4;
  for (let k = 0; k < n; k++) {
    const t = k / n;
    const sz = 0.2 * (1 - t * 0.5);
    const c = new THREE.Color(pick(LEAF.wisteria, rand)).multiplyScalar(0.9 + 0.15 * (1 - t));
    for (let j = 0; j < 2; j++) {
      const a = j * Math.PI / 2 + rand();
      _ax.set(Math.cos(a), 0, Math.sin(a)).multiplyScalar(sz / 2);
      _ay.set(0, 1, 0).multiplyScalar(sz / 2);
      card(f, [x, y - t * L, z], _ax, _ay, [0, 0.3, 1], [c.r, c.g, c.b], ATLAS.blossom, 0.6 + t);
    }
  }
}
