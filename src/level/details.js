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
