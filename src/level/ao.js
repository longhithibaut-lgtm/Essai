import * as THREE from 'three';

// Ombres de contact : quads au sol avec un dégradé doux, posés sous les objets et
// au pied des murets. Donne du poids aux objets sans calcul d'occlusion à l'écran.

function makeTexture() {
  const S = 64;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const img = g.createImageData(S, S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      // distance à un rectangle intérieur, normalisée
      const u = Math.abs((x + 0.5) / S - 0.5) * 2, v = Math.abs((y + 0.5) / S - 0.5) * 2;
      // cœur net au contact, queue courte : l'ombre tient l'objet sans voiler le sol
      const dx = Math.max(0, u - 0.4) / 0.6, dy = Math.max(0, v - 0.4) / 0.6;
      const d = Math.min(1, Math.hypot(dx, dy));
      const a = Math.pow(1 - d, 2.8);
      const o = (y * S + x) * 4;
      img.data[o] = img.data[o + 1] = img.data[o + 2] = 255;
      img.data[o + 3] = Math.round(a * 255);
    }
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  return tex;
}

export class ContactShadows {
  constructor() {
    this.pos = [];
    this.uv = [];
    this.col = [];
    this.idx = [];
    this.n = 0;
  }

  add(cx, cz, w, d, y, k = 1, rotY = 0) {
    const cs = Math.cos(rotY), sn = Math.sin(rotY);
    const hw = w / 2, hd = d / 2;
    const yy = y + 0.008;
    const corners = [[-hw, -hd, 0, 0], [-hw, hd, 0, 1], [hw, hd, 1, 1], [hw, -hd, 1, 0]];
    for (const [lx, lz, u, v] of corners) {
      this.pos.push(cx + lx * cs + lz * sn, yy, cz - lx * sn + lz * cs);
      this.uv.push(u, v);
      this.col.push(1, 1, 1, k);
    }
    const b = this.n;
    this.idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    this.n += 4;
  }

  // Salissure verticale au pied d'un mur : quad posé contre la face (x0,z0)-(x1,z1),
  // de y à y + h, décalé de 1 cm vers l'extérieur (nx, nz). Plein en bas, fondu en haut,
  // adouci aux extrémités.
  addWall(x0, z0, x1, z1, y, h, k = 1, nx = 0, nz = 0) {
    const len = Math.hypot(x1 - x0, z1 - z0);
    if (len < 0.05) return;
    const ox = nx * 0.012, oz = nz * 0.012;
    const ramp = Math.min(0.5, len * 0.25) / len;
    const segs = [[0, ramp, 0.02, 0.325], [ramp, 1 - ramp, 0.325, 0.675], [1 - ramp, 1, 0.675, 0.98]];
    for (const [t0, t1, u0, u1] of segs) {
      const ax = x0 + (x1 - x0) * t0 + ox, az = z0 + (z1 - z0) * t0 + oz;
      const bx = x0 + (x1 - x0) * t1 + ox, bz = z0 + (z1 - z0) * t1 + oz;
      const b = this.n;
      this.pos.push(ax, y, az, ax, y + h, az, bx, y + h, bz, bx, y, bz);
      this.uv.push(u0, 0.5, u0, 0.98, u1, 0.98, u1, 0.5);
      for (let i = 0; i < 4; i++) this.col.push(1, 1, 1, k);
      this.idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
      this.n += 4;
    }
  }

  mesh() {
    if (!this.n) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 4));
    g.setIndex(this.n > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    const mat = new THREE.MeshBasicMaterial({
      color: 0x3a2c3c, map: makeTexture(), vertexColors: true, transparent: true, opacity: 0.36,
      depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
    });
    const m = new THREE.Mesh(g, mat);
    m.renderOrder = 1;
    m.matrixAutoUpdate = false;
    return m;
  }
}
