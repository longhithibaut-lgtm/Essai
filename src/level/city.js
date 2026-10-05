import * as THREE from 'three';
import { PAL, building } from './props.js';
import { roofDress, facadeDress } from './dress.js';
import { K } from './surfaces.js';
import { rng, Batch } from './kit.js';

// Ville intermédiaire autour du parcours : îlots d'immeubles blancs à corniches,
// toits habités, quelques tours repères. Rien ici n'a de collision (hors d'atteinte).

// Blancs et crèmes en majorité, quelques tons plus soutenus (ocre, terre cuite rosée,
// sauge, pierre grise) pour que la ville se lise en couches.
const COLORS = [PAL.plaster, PAL.plaster, PAL.plasterWarm, PAL.plasterWarm, PAL.plasterCool, PAL.plasterSand, PAL.plasterRose, PAL.plasterSage, 0xf7f4f0,
  0xeac9a2, 0xe7b9a3, 0xd3dbc8, 0xdcd5cb, 0xcfd6de, 0xf0d5b4,
  // tons soutenus mais doux : ocre, terre cuite rosée, sauge, gris-bleu, pierre
  0xdcae7e, 0xd49a84, 0xb9c3a6, 0xadb7c4, 0xc9b9a6, 0xe0b48f,
  // vieilles façades plus franches (Gênes, Naples) : la ville se lit en couches dans la brume
  0xd6a070, 0xc98f7a, 0xa9b896, 0xe3c088, 0xb7a08c, 0xcf9f86];

function overlaps(a, list, m) {
  return list.some((b) => a.minX < b.maxX + m && a.maxX > b.minX - m && a.minZ < b.maxZ + m && a.maxZ > b.minZ - m);
}

export function buildCity(ctx, { corridor, keepOut, cap = () => Infinity }) {
  const rand = ctx.rand;
  const placed = [];
  // Feuillage de la ville : lot séparé qui ne projette pas d'ombre (moins coûteux).
  const nctx = { ...ctx, physics: null, foliage: ctx.farFoliage ?? ctx.foliage, ao: null, groundAt: null };
  let z = 70;
  while (z > -340) {
    const depth = 11 + rand() * 12;
    const zMax = z, zMin = z - depth;
    const zc = (zMax + zMin) / 2;
    const [cx0, cx1] = corridor(zc);
    for (const side of [-1, 1]) {
      let prev = null;
      let x = side < 0 ? cx0 - (2 + rand() * 6) : cx1 + (2 + rand() * 6);
      while (Math.abs(x) < 150) {
        const w = 8 + rand() * 11;
        const minX = side < 0 ? x - w : x, maxX = side < 0 ? x : x + w;
        const dEdge = side < 0 ? cx0 - maxX : minX - cx1;
        const zj0 = zMin + rand() * 2.5, zj1 = zMax - rand() * 2.5;
        const rect = { minX, maxX, minZ: zj0, maxZ: zj1 };
        x += side * (w + 3.5 + rand() * 6);
        if (overlaps(rect, keepOut, 3) || overlaps(rect, placed, 1.5)) continue;
        // Hauteur : bas près du parcours (vue dégagée), plus haut au loin, quelques tours.
        // Des trouées laissent voir la mer de nuages : la ville respire.
        if (rand() < 0.22) continue;
        let top;
        const r = rand();
        if (dEdge < 18) top = -17 + rand() * 12;
        else if (dEdge < 45) top = -14 + rand() * 18;
        else top = -9 + rand() * 22;
        let tower = false;
        if (dEdge > 38 && r < 0.1) { top = 12 + rand() * 22; tower = true; }
        if (zc < -225 && Math.abs((minX + maxX) / 2 - 8) < 45) top = Math.min(top, -4 + rand() * 4);
        const capTop = cap((minX + maxX) / 2, zc);
        if (top > capTop) { top = capTop - rand() * 6; tower = false; }
        const near = dEdge < 26;
        const batch = near ? ctx.arch : ctx.far;
        const col = COLORS[Math.floor(rand() * COLORS.length)];
        let bx = rect;
        if (tower) {
          // Tour plus fine
          const sh = Math.min(w, depth) * 0.25;
          bx = { minX: minX + sh * 0.5, maxX: maxX - sh * 0.5, minZ: zj0 + sh * 0.5, maxZ: zj1 - sh * 0.5 };
        }
        const st = tower && rand() < 0.25 ? 0.97 + rand() * 0.029 : rand() * 0.96;
        const b = building(nctx, { ...bx, top, batch, color: tower && st >= 0.97 ? 0xeee7e2 : col, style: st, deck: rand() < 0.4 ? 'pave' : 'roof', collide: false, bands: !(st >= 0.97), bandEvery: 2 + Math.floor(rand() * 3) });
        placed.push(rect);
        // Tours : gradins successifs, chacun avec sa corniche, puis un édicule technique
        let roofTop = top;
        if (tower && b.w > 6 && b.d > 6) {
          let tier = b, t = top;
          const nTier = 1 + Math.floor(rand() * 2.4);
          for (let k = 0; k < nTier; k++) {
            const inset = 1.2 + rand() * 1.6;
            if (tier.w - 2 * inset < 4 || tier.d - 2 * inset < 4) break;
            const h = 4 + rand() * 9;
            tier = building(nctx, { minX: tier.minX + inset, maxX: tier.maxX - inset, minZ: tier.minZ + inset, maxZ: tier.maxZ - inset, top: t + h, bottom: t, batch, color: k % 2 ? col : (b.color ?? col), style: st, deck: 'roof', collide: false, bands: false, detail: 'simple' });
            // petite terrasse sur le gradin inférieur
            roofDress(nctx, { ...b, minX: b.minX, maxX: b.minX + inset, top: t }, { batch, far: true, parapet: false });
            t += h;
          }
          // Couronnement : édicule à persiennes, ou lanterne coiffée d'une pyramide de
          // tuiles, ou petite coupole sur tambour (tirage à part : la ville ne bouge pas)
          const ew = Math.min(tier.w, tier.d) * 0.45;
          const cr = rng(Math.floor(Math.abs(tier.cx * 31.7 + tier.cz * 7.3)) + 11)();
          if (cr < 0.34) {
            const lw = Math.min(tier.w, tier.d) * 0.62;
            batch.box(tier.cx, t + 1.4, tier.cz, lw, 2.8, lw, { kind: K.FACADE, color: b.color ?? col, style: 0.13 });
            batch.box(tier.cx, t + 2.9, tier.cz, lw + 0.5, 0.25, lw + 0.5, { kind: K.PLASTER, color: PAL.coping });
            const cone = new THREE.ConeGeometry(lw * 0.78, lw * 0.75, 4, 1);
            cone.rotateY(Math.PI / 4);
            batch.geometry(cone, new THREE.Matrix4().makeTranslation(tier.cx, t + 3.02 + lw * 0.375, tier.cz), { kind: K.TERRA, color: [0xd38f70, 0xc98166, 0xdb9a7a][Math.floor(cr * 30) % 3] });
            roofTop = t + 3.0 + lw * 0.75;
          } else if (cr < 0.52) {
            const r = Math.min(tier.w, tier.d) * 0.3;
            batch.cylinder(tier.cx, t, tier.cz, r * 1.05, r * 1.05, 1.6, 16, { kind: K.PLASTER, color: b.color ?? col, caps: false });
            batch.cylinder(tier.cx, t + 1.6, tier.cz, r * 1.18, r * 1.18, 0.18, 16, { kind: K.PLASTER, color: PAL.coping });
            const dg = new THREE.SphereGeometry(r, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2);
            batch.geometry(dg, new THREE.Matrix4().makeTranslation(tier.cx, t + 1.78, tier.cz), { kind: K.PLASTER, color: cr < 0.43 ? 0xdfe8ee : 0xf6f1ea });
            roofTop = t + 1.78 + r;
          } else {
            batch.box(tier.cx, t + 1.5, tier.cz, ew, 3.0, ew * 0.8, { kind: K.VENT, color: PAL.metalLight });
            batch.box(tier.cx, t + 3.08, tier.cz, ew + 0.3, 0.16, ew * 0.8 + 0.3, { kind: K.PLASTER, color: PAL.coping });
            roofTop = t + 3.2;
          }
          // Sous un couronnement, l'habillage du toit est tiré quand même (la suite de la
          // ville garde sa place) mais jeté : rien ne vient percer la lanterne ou la coupole.
          if (cr < 0.52) roofDress({ ...nctx, foliage: new Batch() }, tier, { batch: new Batch(), far: !near, parapet: true });
          else roofDress(nctx, tier, { batch, far: !near, parapet: true });
        } else if (rand() < 0.42 && b.w > 8 && b.d > 8) {
          const inset = 1.8 + rand() * 1.5;
          const h = tower ? 4 + rand() * 10 : 3.4;
          const a = building(nctx, { minX: b.minX + inset, maxX: b.maxX - inset, minZ: b.minZ + inset, maxZ: b.maxZ - inset, top: top + h, bottom: top, batch, color: col, deck: 'roof', collide: false, bands: false, style: b.style });
          roofDress(nctx, a, { batch, far: !near, parapet: true });
          roofTop = top + h;
          // Petite terrasse autour de l'attique
          if (near) roofDress(nctx, { ...b, minX: b.minX, maxX: b.minX + inset, top }, { batch, far: true, parapet: false });
        } else {
          roofDress(nctx, b, { batch, far: !near });
        }
        // Passerelle couverte entre deux immeubles voisins
        if (prev && rand() < 0.3) {
          const gx0 = side < 0 ? b.maxX : prev.maxX, gx1 = side < 0 ? prev.minX : b.minX;
          const zo0 = Math.max(prev.minZ, b.minZ) + 1, zo1 = Math.min(prev.maxZ, b.maxZ) - 1;
          const yTop = Math.min(prev.top, b.top) - 3.2;
          if (gx1 - gx0 > 2 && gx1 - gx0 < 11 && zo1 - zo0 > 4 && yTop > -10) {
            const zc2 = (zo0 + zo1) / 2;
            const bw = Math.min(3.6, zo1 - zo0);
            building(nctx, { minX: gx0, maxX: gx1, minZ: zc2 - bw / 2, maxZ: zc2 + bw / 2, top: yTop, bottom: yTop - 3.4, batch, color: col, style: 0.4 + rand() * 0.2, deck: 'roof', collide: false, bands: false, corniceOver: 0.12 });
            batch.box((gx0 + gx1) / 2, yTop - 3.5, zc2, gx1 - gx0, 0.2, bw + 0.3, { kind: K.PLASTER, color: PAL.coping });
          }
        }
        prev = b;
        if (tower && rand() < 0.7) {
          // Mât fin au sommet
          batch.cylinder((b.minX + b.maxX) / 2, roofTop, (b.minZ + b.maxZ) / 2, 0.08, 0.16, 6 + rand() * 6, 6, { kind: K.METAL, color: PAL.metalLight });
        }
        if (near) {
          // Façade tournée vers le parcours
          const face = side < 0 ? '+x' : '-x';
          facadeDress(nctx, b, face, { batch, floors: 4, noFoliage: dEdge > 14, banners: rand() < 0.25 ? 1 + Math.floor(rand() * 2) : 0, ivy: rand() < 0.4 ? 1 : 0, minY: -18 });
        }
      }
    }
    z = zMin - (4 + rand() * 6);
  }
  return placed;
}

// Aqueduc monumental : deux rangs d'arches, posé au-dessus de la mer de nuages.
// axis 'x' : s'étend le long de x à la profondeur z = c ; axis 'z' : le long de z en x = c.
export function aqueduct(ctx, { axis = 'x', from, to, c, top = 4, thick = 3.2, batch, color = PAL.stone }) {
  const b = batch ?? ctx.far;
  const len = to - from;
  const shape = new THREE.Shape();
  const bottom = -40;
  shape.moveTo(0, bottom);
  shape.lineTo(len, bottom);
  shape.lineTo(len, top);
  shape.lineTo(0, top);
  shape.lineTo(0, bottom);
  // Grandes arches
  const bigPitch = 12, bigSpan = 9;
  const springBig = top - 9.5;
  for (let x = 2.5; x + bigSpan < len - 2; x += bigPitch) {
    const h = new THREE.Path();
    const r = bigSpan / 2;
    h.moveTo(x, bottom + 2);
    h.lineTo(x + bigSpan, bottom + 2);
    h.lineTo(x + bigSpan, springBig);
    h.absarc(x + r, springBig, r, 0, Math.PI, false);
    h.lineTo(x, bottom + 2);
    shape.holes.push(h);
  }
  // Petites arches du rang supérieur
  const smallPitch = 4, smallSpan = 2.6;
  const springSmall = top - 3.2;
  for (let x = 1.4; x + smallSpan < len - 1; x += smallPitch) {
    const h = new THREE.Path();
    const r = smallSpan / 2;
    h.moveTo(x, top - 1.2 - 3.4);
    h.lineTo(x + smallSpan, top - 1.2 - 3.4);
    h.lineTo(x + smallSpan, springSmall);
    h.absarc(x + r, springSmall, r, 0, Math.PI, false);
    h.lineTo(x, top - 1.2 - 3.4);
    shape.holes.push(h);
  }
  const geo = new THREE.ExtrudeGeometry(shape, { depth: thick, bevelEnabled: false, curveSegments: 10 });
  const m = new THREE.Matrix4();
  if (axis === 'x') m.makeTranslation(from, 0, c - thick / 2);
  else m.makeRotationY(-Math.PI / 2).premultiply(new THREE.Matrix4().makeTranslation(c + thick / 2, 0, from));
  b.geometry(geo, m, { kind: K.STONE, color, face: [1000, 1000] });
  // Corniche du tablier
  if (axis === 'x') {
    b.box(from + len / 2, top + 0.2, c, len + 0.4, 0.4, thick + 0.5, { kind: K.PLASTER, color: PAL.coping });
    b.box(from + len / 2, springSmall - smallSpan / 2 - 1.6, c, len, 0.35, thick + 0.3, { kind: K.PLASTER, color: PAL.coping });
  } else {
    b.box(c, top + 0.2, from + len / 2, thick + 0.5, 0.4, len + 0.4, { kind: K.PLASTER, color: PAL.coping });
    b.box(c, springSmall - smallSpan / 2 - 1.6, from + len / 2, thick + 0.3, 0.35, len, { kind: K.PLASTER, color: PAL.coping });
  }
}
