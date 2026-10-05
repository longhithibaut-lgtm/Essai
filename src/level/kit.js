import * as THREE from 'three';
import { K } from './surfaces.js';

// Lot de géométrie fusionnée. Chaque face porte des UV en mètres (u depuis le bord
// gauche, v depuis le haut pour les côtés), ses dimensions (aFace.xy) et un style
// (aFace.z), pour que le shader dessine joints, fenêtres et chanfreins au bon endroit.

const _c = new THREE.Color();
const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _m3 = new THREE.Matrix3();

// Générateur pseudo-aléatoire déterministe (décor identique à chaque chargement).
export function rng(seed = 1) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function toLinear(color) {
  if (Array.isArray(color)) return color;
  _c.set(color);
  return [_c.r, _c.g, _c.b];
}

export class Batch {
  constructor({ sway = false } = {}) {
    this.sway = sway;
    this.pos = [];
    this.nrm = [];
    this.uv = [];
    this.col = [];
    this.kind = [];
    this.face = [];
    this.swayA = [];
    this.idx = [];
    this.count = 0;
  }

  vertex(x, y, z, nx, ny, nz, u, v, rgb, kind, fw, fh, fs, sway = 0) {
    this.pos.push(x, y, z);
    this.nrm.push(nx, ny, nz);
    this.uv.push(u, v);
    this.col.push(rgb[0], rgb[1], rgb[2]);
    this.kind.push(kind);
    this.face.push(fw, fh, fs);
    this.swayA.push(sway);
    return this.count++;
  }

  tri(a, b, c) { this.idx.push(a, b, c); }
  quadIdx(a, b, c, d) { this.idx.push(a, b, c, a, c, d); }

  // Boîte centrée en (cx, cy, cz). o : { kind, color, style, rotY, skipBottom, skipTop, shadeTop }
  box(cx, cy, cz, w, h, d, o = {}) {
    const kind = o.kind ?? K.PLASTER;
    const rgb = toLinear(o.color ?? 0xf3ece6);
    const st = o.style ?? 0;
    const hw = w / 2, hh = h / 2, hd = d / 2;
    const rot = o.rotY ?? 0;
    const cs = Math.cos(rot), sn = Math.sin(rot);
    const P = (lx, ly, lz) => [cx + lx * cs + lz * sn, cy + ly, cz - lx * sn + lz * cs];
    const N = (nx, ny, nz) => [nx * cs + nz * sn, ny, -nx * sn + nz * cs];
    const face = (corners, normal, fw, fh, uvs) => {
      const nn = N(...normal);
      const ids = corners.map((c, i) => {
        const p = P(...c);
        return this.vertex(p[0], p[1], p[2], nn[0], nn[1], nn[2], uvs[i][0], uvs[i][1], rgb, kind, fw, fh, st);
      });
      this.quadIdx(ids[0], ids[1], ids[2], ids[3]);
    };
    // Côtés : u depuis la gauche (vu de l'extérieur), v depuis le haut
    // +z
    face([[-hw, hh, hd], [-hw, -hh, hd], [hw, -hh, hd], [hw, hh, hd]], [0, 0, 1], w, h, [[0, 0], [0, h], [w, h], [w, 0]]);
    // -z
    face([[hw, hh, -hd], [hw, -hh, -hd], [-hw, -hh, -hd], [-hw, hh, -hd]], [0, 0, -1], w, h, [[0, 0], [0, h], [w, h], [w, 0]]);
    // +x
    face([[hw, hh, hd], [hw, -hh, hd], [hw, -hh, -hd], [hw, hh, -hd]], [1, 0, 0], d, h, [[0, 0], [0, h], [d, h], [d, 0]]);
    // -x
    face([[-hw, hh, -hd], [-hw, -hh, -hd], [-hw, -hh, hd], [-hw, hh, hd]], [-1, 0, 0], d, h, [[0, 0], [0, h], [d, h], [d, 0]]);
    if (!o.skipTop) face([[-hw, hh, -hd], [-hw, hh, hd], [hw, hh, hd], [hw, hh, -hd]], [0, 1, 0], w, d, [[0, 0], [0, d], [w, d], [w, 0]]);
    if (!o.skipBottom) face([[-hw, -hh, hd], [-hw, -hh, -hd], [hw, -hh, -hd], [hw, -hh, hd]], [0, -1, 0], w, d, [[0, d], [0, 0], [w, 0], [w, d]]);
  }

  // Boîte par coins (axes alignés)
  boxMinMax(minX, minY, minZ, maxX, maxY, maxZ, o = {}) {
    this.box((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2, maxX - minX, maxY - minY, maxZ - minZ, o);
  }

  // Cylindre vertical (ou cône tronqué), base en y.
  cylinder(x, y, z, rTop, rBot, h, seg = 12, o = {}) {
    const kind = o.kind ?? K.METAL;
    const rgb = toLinear(o.color ?? 0xdddddd);
    const st = o.style ?? 0;
    const circ = Math.PI * 2 * Math.max(rTop, rBot);
    const ring = [];
    const slope = (rBot - rTop) / h;
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      const ca = Math.cos(a), sa = Math.sin(a);
      const nl = Math.hypot(1, slope);
      const nx = ca / nl, ny = slope / nl, nz = sa / nl;
      const u = (i / seg) * circ;
      const t = this.vertex(x + ca * rTop, y + h, z + sa * rTop, nx, ny, nz, u, 0, rgb, kind, circ, h, st);
      const b = this.vertex(x + ca * rBot, y, z + sa * rBot, nx, ny, nz, u, h, rgb, kind, circ, h, st);
      ring.push([t, b]);
    }
    for (let i = 0; i < seg; i++) {
      const [t0, b0] = ring[i], [t1, b1] = ring[i + 1];
      this.idx.push(t0, t1, b1, t0, b1, b0);
    }
    if (o.caps !== false) {
      const top = this.vertex(x, y + h, z, 0, 1, 0, rTop, rTop, rgb, kind, rTop * 2, rTop * 2, st);
      const tops = [];
      for (let i = 0; i <= seg; i++) {
        const a = (i / seg) * Math.PI * 2;
        tops.push(this.vertex(x + Math.cos(a) * rTop, y + h, z + Math.sin(a) * rTop, 0, 1, 0, rTop + Math.cos(a) * rTop, rTop + Math.sin(a) * rTop, rgb, kind, rTop * 2, rTop * 2, st));
      }
      for (let i = 0; i < seg; i++) this.idx.push(top, tops[i + 1], tops[i]);
    }
  }

  // Cylindre entre deux points (tuyaux, cordes, montants inclinés)
  tube(a, b, r, seg = 6, o = {}) {
    const kind = o.kind ?? K.METAL;
    const rgb = toLinear(o.color ?? 0xdddddd);
    const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
    const dir = B.clone().sub(A);
    const len = dir.length();
    dir.normalize();
    const up = Math.abs(dir.y) < 0.95 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    const s = new THREE.Vector3().crossVectors(dir, up).normalize();
    const t = new THREE.Vector3().crossVectors(s, dir).normalize();
    const circ = Math.PI * 2 * r;
    const ids = [];
    for (let i = 0; i <= seg; i++) {
      const ang = (i / seg) * Math.PI * 2;
      const nx = s.x * Math.cos(ang) + t.x * Math.sin(ang);
      const ny = s.y * Math.cos(ang) + t.y * Math.sin(ang);
      const nz = s.z * Math.cos(ang) + t.z * Math.sin(ang);
      const u = (i / seg) * circ;
      const v0 = this.vertex(A.x + nx * r, A.y + ny * r, A.z + nz * r, nx, ny, nz, u, 0, rgb, kind, circ, len, 0);
      const v1 = this.vertex(B.x + nx * r, B.y + ny * r, B.z + nz * r, nx, ny, nz, u, len, rgb, kind, circ, len, 0);
      ids.push([v0, v1]);
    }
    for (let i = 0; i < seg; i++) {
      const [a0, a1] = ids[i], [b0, b1] = ids[i + 1];
      this.idx.push(a0, b1, b0, a0, a1, b1);
    }
  }

  // Géométrie quelconque (déjà positionnée par `matrix`). Normales lissées optionnelles
  // vers `center` (volumes de feuillage).
  geometry(geo, matrix, o = {}) {
    const kind = o.kind ?? K.PLAIN;
    const g = geo;
    const pos = g.attributes.position;
    const nor = g.attributes.normal;
    const uvA = g.attributes.uv;
    const rgb = toLinear(o.color ?? 0xffffff);
    if (matrix) _m3.getNormalMatrix(matrix);
    const base = this.count;
    const jitter = o.colorJitter ?? 0;
    const rand = o.rand;
    for (let i = 0; i < pos.count; i++) {
      _v.fromBufferAttribute(pos, i);
      if (matrix) _v.applyMatrix4(matrix);
      _n.fromBufferAttribute(nor, i);
      if (matrix) _n.applyMatrix3(_m3).normalize();
      if (o.center) {
        const cx = _v.x - o.center[0], cy = (_v.y - o.center[1]) * (o.flatten ?? 1), cz = _v.z - o.center[2];
        const l = Math.hypot(cx, cy, cz) || 1;
        const k = o.centerBlend ?? 0.7;
        _n.set(_n.x * (1 - k) + (cx / l) * k, _n.y * (1 - k) + (cy / l) * k + (o.lift ?? 0), _n.z * (1 - k) + (cz / l) * k).normalize();
      }
      let c = rgb;
      if (o.vertexShade) {
        const s = o.vertexShade(_v, _n);
        c = [rgb[0] * s, rgb[1] * s, rgb[2] * s];
      }
      if (jitter && rand) {
        const j = 1 + (rand() - 0.5) * jitter;
        c = [c[0] * j, c[1] * j, c[2] * j];
      }
      const u = o.uv ? o.uv[0] : (uvA ? uvA.getX(i) : 50);
      const v = o.uv ? o.uv[1] : (uvA ? uvA.getY(i) : 50);
      const sw = typeof o.sway === 'function' ? o.sway(_v) : (o.sway ?? 0);
      this.vertex(_v.x, _v.y, _v.z, _n.x, _n.y, _n.z, u, v, c, kind, o.face?.[0] ?? 100, o.face?.[1] ?? 100, o.style ?? 0, sw);
    }
    if (g.index) {
      const ia = g.index.array;
      for (let i = 0; i < ia.length; i++) this.idx.push(base + ia[i]);
    } else {
      for (let i = 0; i < pos.count; i++) this.idx.push(base + i);
    }
  }

  // Grille de tissu : fn(s, t) -> [x, y, z], pin(s, t) -> amplitude de l'ondulation
  cloth(fn, ns, nt, o = {}) {
    const rgbFn = typeof o.color === 'function' ? o.color : null;
    const rgb = rgbFn ? null : toLinear(o.color ?? 0xffffff);
    const kind = o.kind ?? K.PLAIN;
    const base = this.count;
    const P = [];
    for (let j = 0; j <= nt; j++) {
      for (let i = 0; i <= ns; i++) P.push(fn(i / ns, j / nt));
    }
    const at = (i, j) => P[j * (ns + 1) + i];
    for (let j = 0; j <= nt; j++) {
      for (let i = 0; i <= ns; i++) {
        const p = at(i, j);
        const pa = at(Math.min(ns, i + 1), j), pb = at(Math.max(0, i - 1), j);
        const qa = at(i, Math.min(nt, j + 1)), qb = at(i, Math.max(0, j - 1));
        const du = [pa[0] - pb[0], pa[1] - pb[1], pa[2] - pb[2]];
        const dv = [qa[0] - qb[0], qa[1] - qb[1], qa[2] - qb[2]];
        let nx = du[1] * dv[2] - du[2] * dv[1], ny = du[2] * dv[0] - du[0] * dv[2], nz = du[0] * dv[1] - du[1] * dv[0];
        const l = Math.hypot(nx, ny, nz) || 1;
        nx /= l; ny /= l; nz /= l;
        if (o.flipNormal) { nx = -nx; ny = -ny; nz = -nz; }
        const c = rgbFn ? toLinear(rgbFn(i / ns, j / nt)) : rgb;
        const sw = o.pin ? o.pin(i / ns, j / nt) : 1;
        this.vertex(p[0], p[1], p[2], nx, ny, nz, i / ns, j / nt, c, kind, 1, 1, 0, sw);
      }
    }
    for (let j = 0; j < nt; j++) {
      for (let i = 0; i < ns; i++) {
        const a = base + j * (ns + 1) + i;
        const b = a + 1, c = a + ns + 2, d = a + ns + 1;
        this.idx.push(a, b, c, a, c, d);
      }
    }
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aKind', new THREE.Float32BufferAttribute(this.kind, 1));
    g.setAttribute('aFace', new THREE.Float32BufferAttribute(this.face, 3));
    g.setAttribute('aSway', new THREE.Float32BufferAttribute(this.swayA, 1));
    g.setIndex(this.count > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}
