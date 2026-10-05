import * as THREE from 'three';
import { K } from './surfaces.js';
import { PAL } from './props.js';

// Petits ouvrages de façade qui disent l'âge d'un mur : ancres de fer forgé,
// descentes d'eau de zinc avec leur cuvette et leurs colliers, solins.
// Tout est décoratif (pas de collision) et posé hors de la ligne des mains.

// Ancre de tirant en X, plaquée sur une face d'axe x (nx = ±1) ou z (nz = ±1).
export function tieAnchor(batch, x, y, z, nx, nz, s = 0.26) {
  const c = { kind: K.METAL, color: 0x5e4a44 };
  const ox = nx * 0.03, oz = nz * 0.03;
  // le long de la face : t = (−nz, nx) en xz
  const tx = -nz, tz = nx;
  for (const sg of [-1, 1]) {
    batch.tube(
      [x + ox - tx * s * sg, y - s, z + oz - tz * s * sg],
      [x + ox + tx * s * sg, y + s, z + oz + tz * s * sg],
      0.019, 5, c,
    );
  }
  batch.box(x + nx * 0.035, y, z + nz * 0.035, nx ? 0.05 : 0.11, 0.11, nz ? 0.05 : 0.11, c);
}

// Descente d'eau de zinc le long d'une face, de yTop à yBot, avec cuvette en tête,
// colliers réguliers et dauphin en pied.
export function downpipe(batch, x, z, yTop, yBot, nx, nz, o = {}) {
  const r = o.r ?? 0.055;
  const zinc = { kind: K.METAL, color: o.color ?? PAL.zinc };
  const dark = { kind: K.METAL, color: PAL.metalDark };
  const off = r + 0.05;
  const px = x + nx * off, pz = z + nz * off;
  batch.cylinder(px, yBot, pz, r, r, yTop - yBot - 0.35, 8, { ...zinc, caps: false });
  // cuvette (boîte évasée) et sa gargouille vers le chéneau
  batch.box(px, yTop - 0.2, pz, 0.24, 0.3, 0.24, zinc);
  batch.box(px, yTop - 0.03, pz, 0.3, 0.05, 0.3, zinc);
  batch.cylinder(px, yTop - 0.48, pz, r, 0.13, 0.14, 8, zinc);
  // colliers
  for (let y = yTop - 0.9; y > yBot + 0.4; y -= 1.7) {
    batch.box(px, y, pz, nx ? 0.1 : 0.15, 0.04, nz ? 0.1 : 0.15, dark);
    batch.box(x + nx * 0.03, y, z + nz * 0.03, nx ? 0.06 : 0.03, 0.04, nz ? 0.06 : 0.03, dark);
  }
}

// Mur appareillé : remplit une boîte (axes alignés) de blocs de pierre chanfreinés,
// posés en rangs alternés le long du grand côté. Les chanfreins de deux blocs voisins
// creusent un joint en V qui se lit même à l'ombre ; chaque bloc a sa teinte et un
// léger faux-aplomb. Décoratif : la collision reste celle de la boîte d'origine.
// o : { rows, block, color, kind, bevel, top (dessus du dernier rang), rand }
export function blockWall(batch, minX, minY, minZ, maxX, maxY, maxZ, o = {}) {
  const alongX = maxX - minX >= maxZ - minZ;
  const L = alongX ? maxX - minX : maxZ - minZ;
  const H = maxY - minY;
  const rows = o.rows ?? Math.max(1, Math.round(H / 0.42));
  const rh = H / rows;
  const bl = o.block ?? 1.1;
  const rand = o.rand ?? Math.random;
  const base = new THREE.Color(o.color ?? PAL.stone);
  const c = new THREE.Color();
  const bev = o.bevel ?? 0.022;
  for (let r = 0; r < rows; r++) {
    const y0 = minY + r * rh, y1 = y0 + rh;
    let a = alongX ? minX : minZ;
    const a1 = alongX ? maxX : maxZ;
    // premier bloc raccourci un rang sur deux (appareil alterné)
    let first = r % 2 ? bl * (0.45 + rand() * 0.2) : bl * (0.8 + rand() * 0.3);
    while (a < a1 - 0.02) {
      let len = first ?? bl * (0.8 + rand() * 0.45);
      first = null;
      if (a1 - (a + len) < bl * 0.35) len = a1 - a;
      const b = Math.min(a1, a + len);
      const k = 0.92 + rand() * 0.14;
      c.copy(base).multiplyScalar(k);
      const warm = rand();
      if (warm < 0.2) c.offsetHSL(0.01, 0.04, 0);
      const out = (rand() - 0.5) * 0.012;
      const oo = { kind: o.kind ?? K.STONE, color: c.getHex(), style: 1, bevel: bev, skipBottom: r === 0, skipTop: r === rows - 1 && !o.top };
      if (alongX) batch.boxMinMax(a, y0, minZ - out, b, y1, maxZ + out, oo);
      else batch.boxMinMax(minX - out, y0, a, maxX + out, y1, b, oo);
      a = b;
    }
  }
}
