import * as THREE from 'three';
import { K, createArchMaterial, createFoliageMaterial, createFabricMaterial, createWaterMaterial } from './level/surfaces.js';
import { Batch, rng } from './level/kit.js';
import {
  PAL, mixHex, building, parapet, railing, edgeMark, acUnit, waterTank, vent, chimney, antenna, hut, planter, bench,
  lantern, pot, crate, cafeSet, stringLights, shadeSail, laundry, duct, skylight,
} from './level/props.js';
import { tree, cypress, bush, hedge, lavender, ivy, grass, wisteria } from './level/vegetation.js';
import { roofDress, facadeDress } from './level/dress.js';
import { buildCity, aqueduct } from './level/city.js';
import { Signs } from './level/signs.js';
import { ContactShadows } from './level/ao.js';
import { inlay, path, drain, gutter, pipes, hatch, basin, shiftedSlabs } from './level/ground.js';
import { junctionGrime } from './level/grime.js';
import { tieAnchor, downpipe } from './level/details.js';

// Le parcours : des terrasses blanches posées sur de hautes tours, au-dessus des
// nuages, dans une ville calme. Le joueur avance vers -z. Collisions : boîtes alignées.
//
// Enchaînement : départ, saut, double franchissement, course murale à droite,
// glissade sous la pergola, escalade, pas japonais, jardin du bassin, cascade de
// toits, course murale à gauche, ruelle du linge (franchissement, glissade,
// franchissement), escalade, escalier, passerelle, pavillon de la cloche.

const FLOWERS = [0xf4a3b5, 0xfbe3a0, 0xfaf3ff, 0xe48fa0, 0xc9b3e6, 0xffc9a8];

export function buildLevel(scene, physics, materials) {
  const rand = rng(11);
  const ctx = {
    arch: new Batch(),
    far: new Batch(),
    foliage: new Batch({ sway: true }),
    farFoliage: new Batch({ sway: true }),
    fabric: new Batch({ sway: true }),
    water: new Batch(),
    physics,
    rand,
    solid(min, max, tag) { physics.add(min, max, { tag }); },
  };
  const shadows = new ContactShadows();
  ctx.ao = (cx, cz, w, d, y, k, rotY) => shadows.add(cx, cz, w, d, y, k, rotY);
  ctx.groundAt = (x, z, y) => Math.abs(physics.groundBelow(x, y + 0.05, z, 0.02) - y) < 0.06;
  const deco = { ...ctx, physics: null }; // mêmes lots, sans collision
  const A = ctx.arch;
  const keepOut = [];
  const B = (o) => { const b = building(ctx, o); keepOut.push(b); return b; };

  // =====================================================================
  // A : terrasse du départ
  // =====================================================================
  B({ minX: -7, maxX: 7, minZ: -7, maxZ: 7, top: 0, style: 0.12, color: PAL.plasterWarm });
  parapet(ctx, -7, 6.85, 7, 6.85, 0);
  parapet(ctx, -6.85, -7, -6.85, 6.7, 0);
  parapet(ctx, 6.85, -7, 6.85, 6.7, 0);
  parapet(ctx, -6.7, -6.85, -2.2, -6.85, 0);
  parapet(ctx, 2.2, -6.85, 6.7, -6.85, 0);
  edgeMark(ctx, -2.2, 2.2, -7, -6.78, 0);
  // Jardin de gauche : longue jardinière de lavande, arbre en fleurs, voile et table
  planter(ctx, -6.05, 0, 1.0, 1.0, 9.0, { h: 0.45 });
  lavender(ctx, -6.05, 0.43, 1.0, 0.8, 8.6, { density: 3.2 });
  planter(ctx, -4.6, 0, -0.2, 1.7, 1.7, { h: 0.5 });
  tree(ctx, -4.6, 0.5, -0.2, { kind: 'blossom', scale: 1.1 });
  shadeSail(ctx, [[-6.6, 2.75, -2.6], [-3.3, 2.45, -2.9], [-3.2, 2.85, -6.45], [-6.6, 2.55, -6.45]], { color: PAL.fabrics[0], posts: true, base: 0, collide: true });
  cafeSet(ctx, -5.0, 0, -4.6, { rotY: 0.3 });
  pot(ctx, -3.7, 0, -5.9, { r: 0.3 });
  bush(ctx, -3.7, 0.5, -5.9, { r: 0.38, kind: 'leaf', flowers: FLOWERS });
  // Droite : réservoir sur pieds, banc, pots, linge
  waterTank(ctx, 5.4, 0, -3.3, { r: 1.05, h: 1.7, leg: 1.7, collide: true });
  bench(ctx, 5.7, 0, 0.6, { rotY: Math.PI / 2, collide: true });
  pot(ctx, 6.2, 0, -1.6, { r: 0.34, h: 0.55, collide: true });
  bush(ctx, 6.2, 0.55, -1.6, { r: 0.45, kind: 'leaf', flowers: FLOWERS });
  pot(ctx, 6.2, 0, 2.6, { r: 0.3, collide: true });
  tree(deco, 6.2, 0.5, 2.6, { kind: 'olive', scale: 0.55, petals: false });
  A.cylinder(4.1, 0, -1.9, 0.035, 0.04, 2.1, 6, { kind: K.METAL, color: PAL.metalDark });
  A.cylinder(4.1, 0, 3.6, 0.035, 0.04, 2.1, 6, { kind: K.METAL, color: PAL.metalDark });
  laundry(ctx, [4.1, 2.05, -1.9], [4.1, 2.05, 3.6], { sag: 0.22, items: 4 });
  acUnit(ctx, 5.4, 0, 5.4, { collide: true });
  acUnit(ctx, 3.8, 0, 5.6, { collide: true, rotY: Math.PI / 2 });
  hut(ctx, -5.0, 0, 5.0, { rotY: Math.PI / 2, w: 2.6, d: 2.8, stripes: 6 });
  lantern(ctx, -2.75, 0, -6.35);
  lantern(ctx, 2.75, 0, -6.35);
  stringLights(ctx, [-3.3, 2.5, -2.9], [4.1, 2.15, -1.9], { n: 14, sag: 0.35 });
  ivy(ctx, -7.02, 0.7, -3, 3.5, 3.5, -1, 0);
  ivy(ctx, 7.02, 0.7, 1.5, 3.0, 4.0, 1, 0);
  // Sol : allée centrale bordée de terre cuite qui mène droit à l'appel corail,
  // platelage sous la voile, gravier sous le réservoir, regards, tuyaux, trappe.
  path(ctx, -2.3, 2.3, -6.7, 6.7, 0, { tile: 1.0 });
  inlay(ctx, -6.6, -3.3, -6.6, -2.35, 0, { kind: K.WOOD, color: PAL.woodPale, h: 0.04 });
  inlay(ctx, 4.35, 6.6, -4.7, -1.95, 0, { kind: K.GRAVEL, color: 0xd6cdc2, h: 0.02 });
  pipes(ctx, [6.42, -6.4], [6.42, -2.2], 0);
  drain(ctx, 3.1, 0, -5.6);
  drain(ctx, -2.95, 0, 2.9);
  hatch(ctx, 5.2, 0, 3.6, 0.9, 0.9);
  // Quelques dalles ont joué avec les années (tirage à part : le reste ne bouge pas)
  const slabRand = rng(77);
  shiftedSlabs(ctx, -1.98, 1.98, -6.6, 6.6, 0.012, { tile: 1.0, n: 3, rand: slabRand, gravel: 0 });
  shiftedSlabs(ctx, 2.45, 6.6, -1.6, 6.5, 0, { tile: 0.55, n: 4, rand: slabRand, color: PAL.deck });
  shiftedSlabs(ctx, -3.6, -2.4, 1.0, 6.5, 0, { tile: 0.55, n: 2, rand: slabRand, color: PAL.deck });

  // =====================================================================
  // B : premier saut, puis double franchissement
  // =====================================================================
  B({ minX: -3, maxX: 3, minZ: -16, maxZ: -10, top: 0.5, style: 0.47, color: PAL.plaster, tile: 0.95, deckColor: 0xeee4da });
  railing(ctx, -2.92, -10.15, -2.92, -15.85, 0.5);
  railing(ctx, 2.92, -10.15, 2.92, -15.85, 0.5);
  pot(ctx, -2.45, 0.5, -15.4, { r: 0.3, collide: true });
  bush(ctx, -2.45, 1.0, -15.4, { r: 0.36, kind: 'leaf', flowers: FLOWERS });
  pot(ctx, 2.45, 0.5, -15.4, { r: 0.3, collide: true });
  bush(ctx, 2.45, 1.0, -15.4, { r: 0.36, kind: 'leaf', flowers: FLOWERS });
  // Muret de pierre à franchir
  B({ minX: -2.2, maxX: 2.2, minZ: -19, maxZ: -16, top: 1.2, plain: true, sideKind: K.STONE, color: PAL.stone, deckColor: PAL.stoneWarm, cornice: true, corniceOver: 0.1, tag: 'vault' });
  edgeMark(ctx, -2.2, 2.2, -16.25, -16, 1.2);
  edgeMark(ctx, -2.2, 2.2, -19.25, -19, 2.0);

  // =====================================================================
  // D : grande terrasse avant le mur corail
  // =====================================================================
  B({ minX: -4, maxX: 3, minZ: -32, maxZ: -19, top: 2.0, style: 0.71, color: PAL.plasterSand, tile: 0.08, deckColor: 0xecc8b2 });
  parapet(ctx, -3.85, -19.2, -3.85, -31.8, 2.0, { h: 0.75 });
  railing(ctx, 2.92, -19.3, 2.92, -25.2, 2.0);
  planter(ctx, -3.1, 2.0, -21.6, 1.3, 1.5, { h: 0.5 });
  tree(ctx, -3.1, 2.5, -21.6, { kind: 'olive', scale: 0.85, petals: false });
  bench(ctx, -3.25, 2.0, -25.2, { rotY: -Math.PI / 2, collide: true });
  planter(ctx, -2.9, 2.0, -28.8, 1.6, 1.6, { h: 0.5 });
  tree(ctx, -2.9, 2.5, -28.8, { kind: 'leaf', scale: 0.85 });
  lantern(ctx, -3.3, 2.0, -31.3);
  shadeSail(ctx, [[-3.9, 4.55, -23.4], [-1.3, 4.25, -23.6], [-1.35, 4.65, -27.2], [-3.9, 4.35, -27.0]], { color: PAL.fabrics[3], posts: true, base: 2.0, collide: true });
  edgeMark(ctx, 1.6, 3.0, -32, -31.75, 2.0);
  path(ctx, 0.3, 2.85, -31.72, -19.4, 2.0, { tile: 1.0, color: 0xefe4d8, borderColor: 0xc7b19f });
  drain(ctx, -1.0, 2.0, -30.6);
  shiftedSlabs(ctx, -3.5, 0.25, -31.6, -19.6, 2.0, { tile: 0.08, n: 7, rand: slabRand, color: 0xecc8b2 });
  shiftedSlabs(ctx, 0.62, 2.53, -31.6, -19.6, 2.012, { tile: 1.0, n: 2, rand: slabRand, color: 0xefe4d8, gravel: 0 });
  // Mur corail : flanc d'un immeuble blanc
  const bWR = B({ minX: 3, maxX: 12, minZ: -43, maxZ: -31, top: 7.0, style: 0.33, color: PAL.plaster, tag: 'wallrun', faces: ['+z', '-z', '+x'], quoins: false });
  A.boxMinMax(2.93, -9, -43, 3.0, 7.0, -31, { kind: K.CORAL, color: PAL.coral });
  // L'angle corail se voit de loin depuis le départ
  A.boxMinMax(2.93, -9, -31.0, 4.4, 6.38, -30.895, { kind: K.CORAL, color: PAL.coral });
  // Bandeaux corail en léger relief sous le niveau de la terrasse, hors de portée des
  // mains : on les voit filer en franchissant le vide
  for (const [y0, y1] of [[1.42, 1.64], [-3.3, -3.08]]) {
    A.boxMinMax(2.885, y0, -43, 2.93, y1, -31.0, { kind: K.CORAL, color: PAL.coralSoft });
  }
  // Le mur a vécu : ancres de fer au-dessus de la ligne de course, descente de zinc sur l'angle
  for (const z of [-34.6, -39.4]) tieAnchor(A, 2.93, 6.3, z, -1, 0);
  tieAnchor(A, 3.66, 5.2, -30.895, 0, 1, 0.26);
  downpipe(A, 4.12, -30.895, 6.25, -9, 0, 1);
  roofDress(deco, bWR, { garden: true, laundry: 0 });
  facadeDress(ctx, bWR, '+z', { floors: 4, balcony: 0, flowers: 0.35, ivy: 1, ivyRange: [0.55, 0.85], minY: -10 });
  // Colonne de pierre élancée, côté gauche
  B({ minX: -5.3, maxX: -3.9, minZ: -37.7, maxZ: -36.3, top: 5.5, plain: true, sideKind: K.STONE, color: PAL.stone, corniceOver: 0.12 });
  cypress(deco, -4.6, 5.5, -37.0, { h: 3.2, r: 0.5 });

  // =====================================================================
  // E : terrasse de la pergola (glissade), puis mur d'escalade
  // =====================================================================
  B({ minX: -4, maxX: 3, minZ: -54, maxZ: -42, top: 2.0, style: 0.58, color: PAL.plasterWarm, tile: 0.9 });
  parapet(ctx, -3.85, -42.2, -3.85, -53.8, 2.0, { h: 0.75 });
  {
    const yb = 3.25;
    for (const [px, pz] of [[-3.85, -46.6], [2.85, -46.6], [-3.85, -49.4], [2.85, -49.4]]) {
      A.box(px, 2.0 + (yb - 2.0) / 2, pz, 0.3, yb - 2.0, 0.3, { kind: K.WOOD, color: PAL.woodDark, bevel: 0.025, skipBottom: true });
      ctx.solid([px - 0.15, 2.0, pz - 0.15], [px + 0.15, yb, pz + 0.15], 'post');
    }
    for (const pz of [-46.6, -49.4]) A.box(-0.5, yb + 0.13, pz, 7.4, 0.26, 0.24, { kind: K.WOOD, color: PAL.woodDark, bevel: 0.025 });
    for (let x = -3.9; x <= 2.95; x += 0.55) A.box(x, yb + 0.35, -48, 0.09, 0.18, 4.4, { kind: K.WOOD, color: PAL.wood });
    ctx.solid([-4.1, yb, -49.6], [3.1, yb + 0.45, -46.4], 'pergola');
    A.boxMinMax(-3.7, 1.95, -50.3, 2.7, 2.012, -45.7, { kind: K.WOOD, color: PAL.woodPale });
    // Glycine sur la pergola, grappes qui pendent
    for (let i = 0; i < 12; i++) {
      const x = -3.7 + i * 0.6 + (rand() - 0.5) * 0.3;
      bush(deco, x, yb + 0.25, -48 + (rand() - 0.5) * 2.6, { r: 0.55 + rand() * 0.25, kind: 'hedge', blobs: 2 });
    }
    for (let i = 0; i < 40; i++) {
      const x = -3.8 + rand() * 6.6, z = -48 + (rand() - 0.5) * 3.4;
      wisteria(deco, x, yb + 0.02, z, { length: 0.18 + rand() * 0.12 });
    }
    for (let i = 0; i < 10; i++) bush(deco, -3.6 + i * 0.75, yb + 0.5, -48 + (rand() - 0.5) * 2.4, { r: 0.45, kind: 'wisteria', blobs: 1, flowers: [0xd9c9ef, 0xf2d6ea] });
    stringLights(ctx, [-3.85, yb - 0.05, -46.45], [2.85, yb - 0.05, -46.45], { n: 12, sag: 0.18 });
    stringLights(ctx, [-3.85, yb - 0.05, -49.55], [2.85, yb - 0.05, -49.55], { n: 12, sag: 0.18 });
  }
  planter(ctx, -3.15, 2.0, -43.6, 1.2, 1.6, { h: 0.5 });
  bush(deco, -3.15, 2.5, -43.6, { r: 0.6, kind: 'leaf', flowers: FLOWERS });
  planter(ctx, -3.15, 2.0, -52.4, 1.2, 2.2, { h: 0.5 });
  lavender(deco, -3.15, 2.48, -52.4, 1.0, 2.0, { density: 6 });
  planter(ctx, 2.3, 2.0, -52.6, 1.0, 1.6, { h: 0.5 });
  bush(deco, 2.3, 2.5, -52.6, { r: 0.5, kind: 'hedge', flowers: [0xfaf3ff] });
  lantern(ctx, 2.45, 2.0, -50.7);
  // Mur d'escalade : panneau corail, lierre de part et d'autre
  A.boxMinMax(-2.1, 2.0, -54.0, 1.1, 5.35, -53.93, { kind: K.CORAL, color: PAL.coral });
  ivy(ctx, -3.1, 5.9, -53.97, 1.5, 2.6, 0, 1, { flowers: [0xfaf3ff, 0xf4a3b5] });
  ivy(ctx, 2.1, 5.9, -53.97, 1.5, 2.2, 0, 1);

  // =====================================================================
  // F : toit au-dessus du mur
  // =====================================================================
  B({ minX: -4, maxX: 3, minZ: -60, maxZ: -54, top: 5.6, style: 0.86, color: PAL.plasterRose, corniceColor: PAL.coralSoft, faces: ['-z', '+x', '-x'], corniceOver: 0.1 });
  acUnit(ctx, -3.0, 5.6, -58.7, { collide: true });
  vent(ctx, 2.4, 5.6, -54.7);
  chimney(ctx, -3.3, 5.6, -55.0);
  railing(ctx, -3.92, -54.2, -3.92, -57.6, 5.6);
  hatch(ctx, 2.2, 5.6, -56.7, 0.9, 0.9);
  path(ctx, -1.0, 1.6, -59.72, -54.3, 5.6, { tile: 1.0, color: 0xf3e6df, borderColor: 0xd99a86 });
  drain(ctx, -2.2, 5.6, -56.4);
  edgeMark(ctx, -0.7, 2.3, -60, -59.75, 5.6);

  // =====================================================================
  // G : pas japonais (colonnes de pierre)
  // =====================================================================
  const stones = [[0.8, -63], [-0.8, -69.4], [0.8, -75.8], [-0.8, -82.2]];
  for (const [sx, sz] of stones) {
    B({ minX: sx - 1.5, maxX: sx + 1.5, minZ: sz - 1.8, maxZ: sz + 1.8, top: 4.4, plain: true, sideKind: K.STONE, color: PAL.stone, deckColor: PAL.stoneWarm, corniceOver: 0.16, bands: false });
    edgeMark(ctx, sx - 1.2, sx + 1.2, sz - 1.8, sz - 1.56, 4.4);
    A.box(sx, 4.4 - 4.5, sz, 3.3, 0.35, 3.9, { kind: K.PLASTER, color: PAL.coping });
    A.box(sx, 4.4 - 12, sz, 3.3, 0.35, 3.9, { kind: K.PLASTER, color: PAL.coping });
  }

  // =====================================================================
  // H : le jardin du bassin
  // =====================================================================
  const H_TOP = 3.6;
  B({ minX: -9, maxX: 9, minZ: -104, maxZ: -86.4, top: H_TOP, style: 0.27, color: PAL.plaster });
  parapet(ctx, -8.85, -103.7, -8.85, -86.6, H_TOP);
  parapet(ctx, 8.85, -103.7, 8.85, -86.6, H_TOP);
  parapet(ctx, -8.7, -86.55, -2.5, -86.55, H_TOP);
  parapet(ctx, 2.5, -86.55, 8.7, -86.55, H_TOP);
  parapet(ctx, -9, -103.85, 1.0, -103.85, H_TOP);
  parapet(ctx, 5.0, -103.85, 9, -103.85, H_TOP);
  edgeMark(ctx, 1.0, 5.0, -104, -103.72, H_TOP);
  lantern(ctx, -3.0, H_TOP, -87.2);
  lantern(ctx, 3.0, H_TOP, -87.2);
  // Allée d'honneur du jardin, puis l'allée de sortie vers la cascade
  path(ctx, -1.9, 1.7, -101.2, -86.75, H_TOP, { tile: 1.0 });
  path(ctx, -103.6, -101.2, -1.9, 6.2, H_TOP, { axis: 'x', tile: 1.0 });
  inlay(ctx, 1.75, 7.2, -97.0, -88.6, H_TOP, { kind: K.GRAVEL, color: 0xd9d0c5, h: 0.02 });
  drain(ctx, 1.25, H_TOP, -98.8);
  shiftedSlabs(ctx, -1.58, 1.38, -101.1, -87.0, H_TOP + 0.012, { tile: 1.0, n: 3, rand: slabRand, gravel: 0 });
  // Pelouse surélevée et grand arbre en fleurs
  A.boxMinMax(-8.4, H_TOP, -98.5, -2.2, H_TOP + 0.16, -89.0, { kind: K.STONE, color: PAL.stone });
  A.boxMinMax(-8.25, H_TOP + 0.15, -98.35, -2.35, H_TOP + 0.17, -89.15, { kind: K.PLAIN, color: 0x7d9a62 });
  grass(deco, -5.3, H_TOP + 0.17, -93.75, 5.8, 9.1, { density: 9 });
  tree(ctx, -4.8, H_TOP + 0.17, -93.2, { kind: 'blossom', scale: 1.5 });
  tree(ctx, -7.2, H_TOP + 0.17, -97.3, { kind: 'leaf', scale: 0.8 });
  cypress(ctx, -7.9, H_TOP, -101.2, { h: 4.6 });
  cypress(ctx, -6.4, H_TOP, -102.6, { h: 3.8 });
  for (let i = 0; i < 5; i++) A.box(-3.0 + (i % 2) * 0.35, H_TOP + 0.175, -90 - i * 1.6, 0.7, 0.03, 0.55, { kind: K.STONE, color: PAL.coping });
  // Bassin
  const wy = basin(ctx, 2.0, 6.4, -94.7, -89.3, H_TOP, 0.32);
  for (let i = 0; i < 9; i++) {
    const x = 2.6 + rand() * 3.2, z = -94 + rand() * 4.2;
    A.cylinder(x, wy + 0.002, z, 0.16 + rand() * 0.1, 0.16, 0.008, 8, { kind: K.PLAIN, color: 0x8fb886, caps: true });
    if (rand() < 0.4) A.box(x + 0.05, wy + 0.03, z, 0.08, 0.05, 0.08, { kind: K.PLAIN, color: 0xfad4e0 });
  }
  bench(ctx, 4.2, H_TOP, -96.4, { rotY: Math.PI, collide: true });
  tree(ctx, 6.6, H_TOP, -100.6, { kind: 'blossom', scale: 0.95 });
  hedge(deco, 7.6, -99.0, 8.5, -88.0, H_TOP, { h: 0.75 });
  ctx.solid([7.5, H_TOP, -99.0], [8.6, H_TOP + 0.75, -88.0], 'hedge');
  // Petit pavillon de bois au fond à gauche
  {
    const px = -4.2, pz = -101.4;
    for (const [dx, dz] of [[-1.3, -1.0], [1.3, -1.0], [-1.3, 1.0], [1.3, 1.0]]) {
      A.box(px + dx, H_TOP + 1.3, pz + dz, 0.18, 2.6, 0.18, { kind: K.WOOD, color: PAL.woodDark });
      ctx.solid([px + dx - 0.09, H_TOP, pz + dz - 0.09], [px + dx + 0.09, H_TOP + 2.6, pz + dz + 0.09], 'post');
    }
    A.box(px, H_TOP + 2.7, pz, 3.4, 0.2, 2.8, { kind: K.WOOD, color: PAL.wood });
    A.box(px, H_TOP + 2.9, pz, 2.6, 0.2, 2.0, { kind: K.WOOD, color: PAL.wood });
    A.box(px, H_TOP + 3.06, pz, 1.4, 0.12, 1.0, { kind: K.WOOD, color: PAL.woodDark });
    bench(ctx, px, H_TOP, pz - 0.5, { rotY: 0, len: 2.0, collide: true });
    A.box(px - 1.3, H_TOP + 2.35, pz + 1.0, 0.16, 0.22, 0.16, { kind: K.GLOW, color: PAL.glow });
  }
  pot(ctx, 8.1, H_TOP, -102.9, { r: 0.35, collide: true });
  bush(deco, 8.1, H_TOP + 0.5, -102.9, { r: 0.45, kind: 'leaf', flowers: FLOWERS });

  // =====================================================================
  // I : cascade de toits qui descend vers la droite
  // =====================================================================
  const bI1 = B({ minX: -1, maxX: 7, minZ: -114, maxZ: -107, top: 2.6, style: 0.52, color: PAL.plasterCool, deck: 'roof', upstand: ['-x', '+x'] });
  railing(ctx, 6.92, -107.2, 6.92, -113.8, 2.6);
  acUnit(ctx, -0.1, 2.6, -108.8, { collide: true, rotY: Math.PI / 2 });
  acUnit(ctx, -0.1, 2.6, -111.2, { collide: true, rotY: Math.PI / 2 });
  vent(ctx, 1.2, 2.6, -113.2);
  antenna(ctx, -0.4, 2.6, -113.3, { h: 3.2 });
  duct(deco, [0.95, -107.6], [0.95, -112.4], 2.6, { size: 0.36 });
  duct(deco, [0.95, -112.4], [-0.6, -112.4], 2.6, { size: 0.36 });
  ctx.solid([0.7, 2.6, -112.6], [1.2, 3.35, -107.5], 'duct');
  edgeMark(ctx, 2.6, 6.2, -114, -113.75, 2.6);
  facadeDress(ctx, bI1, '+z', { floors: 3, flowers: 0.4, balcony: 0, minY: -6 });
  // Caillebotis de bois posé sur l'étanchéité, jusqu'à l'appel
  inlay(ctx, 3.0, 5.0, -113.72, -107.25, 2.6, { kind: K.WOOD, color: PAL.woodPale, h: 0.05 });
  skylight(ctx, 5.85, 2.6, -108.3, 1.1, 1.5);
  skylight(ctx, 5.85, 2.6, -110.5, 1.1, 1.5);
  pipes(ctx, [6.62, -107.3], [6.62, -113.6], 2.6);
  drain(ctx, 2.0, 2.6, -108.0, 0.36);

  const bI2 = B({ minX: 1, maxX: 9, minZ: -124, maxZ: -117, top: 1.4, style: 0.91, color: PAL.plasterSand, tile: 0.2, deckColor: 0xe9cdb8 });
  waterTank(ctx, 7.8, 1.4, -122.6, { r: 0.8, h: 1.4, leg: 1.2, collide: true });
  A.cylinder(8.6, 1.4, -117.6, 0.035, 0.04, 2.1, 6, { kind: K.METAL, color: PAL.metalDark });
  laundry(ctx, [8.6, 3.45, -117.6], [8.4, 3.3, -121.4], { sag: 0.2, items: 3 });
  pot(ctx, 1.6, 1.4, -117.6, { r: 0.3, collide: true });
  bush(deco, 1.6, 1.9, -117.6, { r: 0.4, kind: 'leaf', flowers: FLOWERS });
  edgeMark(ctx, 3.8, 7.0, -124, -123.75, 1.4);
  path(ctx, 4.1, 6.7, -123.72, -117.3, 1.4, { tile: 1.0, color: 0xf0e2d4, borderColor: 0xc9a78f });
  facadeDress(ctx, bI2, '+z', { floors: 3, flowers: 0.4, balcony: 0, minY: -8 });

  const bI3 = B({ minX: 5, maxX: 12, minZ: -137, maxZ: -127, top: 0.4, style: 0.44, color: PAL.plaster, deck: 'roof', upstand: ['+x'] });
  B({ minX: 3, maxX: 5, minZ: -136, maxZ: -127, top: 0.4, style: 0.44, color: PAL.plaster, cornice: false });
  hut(ctx, 10.4, 0.4, -131.5, { rotY: -Math.PI / 2, color: PAL.plasterRose, awningColor: PAL.fabrics[3] });
  acUnit(ctx, 10.7, 0.4, -135.6, { collide: true });
  planter(ctx, 3.7, 0.4, -128.2, 1.0, 1.6, { h: 0.5 });
  path(ctx, 4.35, 6.55, -136.8, -129.2, 0.4, { tile: 1.0 });
  bush(deco, 3.7, 0.9, -128.2, { r: 0.55, kind: 'hedge', flowers: FLOWERS });
  facadeDress(ctx, bI3, '+z', { floors: 3, flowers: 0.35, balcony: 0, minY: -10 });

  // Mur corail de gauche : flanc d'un immeuble
  const bW2 = B({ minX: -3, maxX: 5, minZ: -148, maxZ: -136, top: 5.6, style: 0.64, color: PAL.plasterWarm, tag: 'wallrun', faces: ['+z', '-z', '-x'], quoins: false, corniceOver: 0.25 });
  A.boxMinMax(5.0, -9, -148, 5.07, 5.6, -136, { kind: K.CORAL, color: PAL.coral });
  A.boxMinMax(3.6, -9, -136.0, 5.07, 4.98, -135.92, { kind: K.CORAL, color: PAL.coral });
  roofDress(deco, bW2, { garden: true });
  facadeDress(ctx, bW2, '+z', { floors: 3, balcony: 0, flowers: 0.3, ivy: 1, ivyRange: [0.2, 0.5], minY: -8 });

  // =====================================================================
  // K : la ruelle du linge
  // =====================================================================
  const K_TOP = 0.4;
  B({ minX: 5, maxX: 13, minZ: -172, maxZ: -147, top: K_TOP, style: 0.4, color: PAL.plasterWarm, tile: 0.1, deckColor: 0xe8c6ae });
  // Rive gauche : vieux mur de jardin en pierre, contreforts, fontaine, haie au sommet
  const bKL = B({ minX: -4, maxX: 5, minZ: -172, maxZ: -148, top: 2.6, style: 0.15, plain: true, sideKind: K.STONE, color: 0xe4d4c2, deckColor: 0xe6dccf, corniceOver: 0.14 });
  const bKR = B({ minX: 13, maxX: 22, minZ: -172, maxZ: -147, top: 8.5, style: 0.78, color: PAL.plaster });
  roofDress(deco, bKL, { garden: true, laundry: 0, parapet: false });
  hedge(deco, 4.15, -171.6, 4.95, -148.4, 2.6, { h: 0.85 });
  for (const z of [-156.6, -163.6, -170.4]) {
    A.boxMinMax(5.0, K_TOP, z - 0.3, 5.34, 2.05, z + 0.3, { kind: K.STONE, color: 0xddcbb8, bevel: 0.03, skipBottom: true });
    A.boxMinMax(5.0, 2.05, z - 0.34, 5.24, 2.32, z + 0.34, { kind: K.STONE, color: PAL.coping, bevel: 0.025 });
    shadows.add(5.17, z, 1.2, 1.3, K_TOP, 0.9);
  }
  {
    // Fontaine murale : vasque, plaque, bec de bronze
    const zf = -167.4;
    basin(ctx, 5.0, 5.66, zf - 0.72, zf + 0.72, K_TOP, 0.6, { rim: 0.12, color: 0xd8c7b4, collide: false });
    A.boxMinMax(5.0, K_TOP + 0.64, zf - 0.5, 5.1, K_TOP + 1.9, zf + 0.5, { kind: K.STONE, color: PAL.stoneWarm });
    A.boxMinMax(5.0, K_TOP + 1.9, zf - 0.32, 5.12, K_TOP + 2.08, zf + 0.32, { kind: K.STONE, color: PAL.coping });
    A.tube([5.1, K_TOP + 1.28, zf], [5.3, K_TOP + 1.22, zf], 0.03, 6, { kind: K.METAL, color: 0xb48a5a });
    shadows.add(5.3, zf, 1.6, 2.0, K_TOP, 0.9);
    ctx.solid([5.0, K_TOP, zf - 0.72], [5.66, K_TOP + 0.6, zf + 0.72], 'fountain');
  }
  facadeDress(ctx, bKR, '-x', { floors: 3, flowers: 0.35, balcony: 0.2, ac: 0.08, awnings: 0.08, banners: 2, ivy: 1, minY: 2.6 });
  facadeDress(ctx, bKL, '+x', { floors: 2, flowers: 0.3, balcony: 0, ac: 0.1, minY: -6 });
  for (const [z, w, l] of [[-151.5, 2.2, 1.6], [-158.5, 1.6, 1.2], [-165.5, 2.4, 1.8]]) ivy(ctx, 5.0, 2.62, z, w, l, 1, 0, { over: 0.3, flowers: z === -158.5 ? [0xfaf3ff, 0xf4a3b5] : null });
  for (const z of [-154.8, -162.2, -168.6]) {
    A.box(5.06, 1.75, z, 0.12, 0.3, 0.2, { kind: K.WOOD, color: PAL.woodDark });
    A.box(5.16, 1.55, z, 0.16, 0.22, 0.16, { kind: K.GLOW, color: PAL.glow });
  }
  // Cordes à linge entre les deux rives de la ruelle
  for (const z of [-150.5, -156.5, -163.2, -169.0]) {
    A.cylinder(4.75, 2.6, z, 0.035, 0.04, 1.95, 6, { kind: K.METAL, color: PAL.metalDark });
    A.box(13.0 - 0.06, 5.2, z, 0.12, 0.12, 0.12, { kind: K.METAL, color: PAL.metalDark });
    laundry(ctx, [4.75, 4.5, z], [12.95, 5.2, z + (rand() - 0.5) * 1.2], { sag: 0.35 });
  }
  // Sol de la ruelle : rigole centrale, bordures de pierre, regards
  gutter(ctx, 8.28, 8.72, -171.7, -147.3, K_TOP);
  inlay(ctx, 5.0, 5.36, -171.8, -147.2, K_TOP, { kind: K.STONE, color: PAL.stoneWarm, h: 0.05 });
  inlay(ctx, 12.64, 13.0, -171.8, -147.2, K_TOP, { kind: K.STONE, color: PAL.stoneWarm, h: 0.05 });
  drain(ctx, 6.1, K_TOP, -158.4);
  shiftedSlabs(ctx, 5.4, 12.6, -171.5, -147.5, K_TOP, { tile: 0.1, n: 14, rand: slabRand, color: 0xe8c6ae, gravel: 0.35 });
  drain(ctx, 11.0, K_TOP, -163.8);
  // Obstacle 1 : jardinière de pierre à franchir
  A.boxMinMax(6.0, K_TOP, -153.8, 12.0, K_TOP + 0.84, -153.0, { kind: K.STONE, color: PAL.stone, bevel: 0.035, skipBottom: true, skipTop: true });
  A.boxMinMax(5.95, K_TOP + 0.84, -153.85, 12.05, K_TOP + 0.9, -152.95, { kind: K.CORAL, color: PAL.coral, bevel: 0.018 });
  ctx.solid([6.0, K_TOP, -153.8], [12.0, K_TOP + 0.9, -153.0], 'vault');
  for (const x of [5.5, 12.5]) {
    pot(ctx, x, K_TOP, -153.4, { r: 0.32, collide: true });
    bush(deco, x, K_TOP + 0.5, -153.4, { r: 0.42, kind: 'leaf', flowers: FLOWERS });
  }
  // Obstacle 2 : poutre basse drapée (glissade)
  {
    const z0 = -161.5, z1 = -160.0, yb = K_TOP + 1.25;
    A.boxMinMax(5.0, yb, z0, 13.0, yb + 0.4, z1, { kind: K.WOOD, color: PAL.wood, bevel: 0.03 });
    ctx.solid([5.0, yb, z0], [13.0, yb + 0.4, z1], 'beam');
    for (const x of [5.15, 12.85]) {
      A.boxMinMax(x - 0.15, K_TOP, z0 + 0.45, x + 0.15, yb, z1 - 0.45, { kind: K.WOOD, color: PAL.woodDark });
      ctx.solid([x - 0.15, K_TOP, z0 + 0.45], [x + 0.15, yb, z1 - 0.45], 'post');
    }
    ctx.fabric.cloth((s, t) => [5.3 + s * 7.4, yb - t * 0.22, z1 + 0.02 + Math.sin(t * 1.6) * 0.03], 24, 2, {
      color: (s) => (Math.floor(s * 12 * 0.999) % 2 === 0 ? PAL.coralSoft : PAL.fabrics[0]), pin: (s, t) => t * 0.3,
    });
    for (const x of [6.4, 8.5, 10.6]) {
      pot(ctx, x, yb + 0.4, -160.75, { r: 0.26, h: 0.4 });
      bush(deco, x, yb + 0.8, -160.75, { r: 0.34, kind: 'leaf', flowers: FLOWERS });
      ivy(deco, x, yb + 0.42, z1 + 0.01, 0.6, 0.5, 0, 1);
    }
  }
  // Obstacle 3 : banc-jardinière bas
  A.boxMinMax(6.5, K_TOP, -166.6, 11.0, K_TOP + 0.56, -166.0, { kind: K.STONE, color: PAL.stone, bevel: 0.035, skipBottom: true, skipTop: true });
  A.boxMinMax(6.45, K_TOP + 0.56, -166.65, 11.05, K_TOP + 0.62, -165.95, { kind: K.CORAL, color: PAL.coral, bevel: 0.018 });
  ctx.solid([6.5, K_TOP, -166.6], [11.0, K_TOP + 0.62, -166.0], 'vault');
  crate(ctx, 12.3, K_TOP, -158.0, 0.6);
  crate(ctx, 12.35, K_TOP + 0.6, -158.05, 0.45, { rotY: 0.4 });
  ctx.solid([12.0, K_TOP, -158.3], [12.6, K_TOP + 1.05, -157.7], 'crate');
  lantern(ctx, 12.4, K_TOP, -149.0);
  lantern(ctx, 5.6, K_TOP, -170.9);
  // Mur d'escalade final : panneau corail
  A.boxMinMax(7.0, K_TOP, -172.0, 10.0, 3.75, -171.93, { kind: K.CORAL, color: PAL.coral });
  ivy(ctx, 6.25, 4.0, -171.97, 1.2, 2.4, 0, 1, { flowers: [0xfaf3ff] });
  ivy(ctx, 11.3, 4.4, -171.97, 1.8, 2.2, 0, 1);

  // =====================================================================
  // M : la montée (escalier et portique)
  // =====================================================================
  const M_TOP = 4.0;
  B({ minX: 4, maxX: 14, minZ: -180, maxZ: -172, top: M_TOP, style: 0.21, color: PAL.plaster, corniceColor: PAL.coralSoft, faces: ['-z', '+x', '-x'], corniceOver: 0.1 });
  for (let k = 1; k <= 6; k++) {
    const zf = -174.5 - 0.6 * (k - 1);
    const top = M_TOP + 0.3 * k;
    A.boxMinMax(6.0, M_TOP, -180, 11.0, top, zf, { kind: K.STONE, color: k % 2 ? PAL.stone : PAL.stoneWarm, bevel: 0.022, skipBottom: true });
    ctx.solid([6.0, M_TOP, -180], [11.0, top, zf], 'stairs');
  }
  for (const x of [5.85, 11.15]) {
    A.boxMinMax(x - 0.15, M_TOP, -180, x + 0.15, M_TOP + 2.35, -177.6, { kind: K.PLASTER, color: PAL.plaster, bevel: 0.03, skipBottom: true });
    A.boxMinMax(x - 0.15, M_TOP, -177.6, x + 0.15, M_TOP + 1.2, -174.5, { kind: K.PLASTER, color: PAL.plaster, bevel: 0.03, skipBottom: true });
    ctx.solid([x - 0.15, M_TOP, -180], [x + 0.15, M_TOP + 2.35, -174.5], 'wall');
  }
  // Portique corail au sommet des marches
  {
    const y0 = M_TOP + 1.8;
    for (const x of [6.25, 10.75]) {
      A.box(x, y0 + 1.9, -179.55, 0.42, 3.8, 0.42, { kind: K.CORAL, color: PAL.coralSoft, bevel: 0.03 });
      A.box(x, y0 + 0.1, -179.55, 0.6, 0.2, 0.6, { kind: K.STONE, color: PAL.coping, bevel: 0.03 });
      ctx.solid([x - 0.21, y0, -179.76], [x + 0.21, y0 + 3.8, -179.34], 'post');
    }
    A.box(8.5, y0 + 3.95, -179.55, 6.2, 0.34, 0.55, { kind: K.CORAL, color: PAL.coralSoft, bevel: 0.03 });
    A.box(8.5, y0 + 4.2, -179.55, 6.8, 0.18, 0.7, { kind: K.WOOD, color: PAL.woodDark, bevel: 0.03 });
    A.box(8.5, y0 + 3.25, -179.55, 4.6, 0.18, 0.3, { kind: K.CORAL, color: PAL.coralSoft, bevel: 0.025 });
    A.box(8.5, y0 + 3.55, -179.5, 0.5, 0.42, 0.06, { kind: K.WOOD, color: PAL.woodDark });
  }
  for (const [x, z] of [[4.9, -173.2], [13.1, -173.2], [4.9, -179.0], [13.1, -179.0]]) {
    planter(ctx, x, M_TOP, z, 1.2, 1.2, { h: 0.5 });
    cypress(ctx, x, M_TOP + 0.5, z, { h: 3.6 + rand() * 1.4, r: 0.55 });
  }
  lavender(deco, 4.9, M_TOP, -176.1, 1.2, 3.6, { density: 4 });
  lavender(deco, 13.1, M_TOP, -176.1, 1.2, 3.6, { density: 4 });

  // =====================================================================
  // Passerelle de bois vers le pavillon
  // =====================================================================
  const N_TOP = 5.8;
  {
    const x0 = 7.5, x1 = 9.5, z0 = -190, z1 = -180;
    A.boxMinMax(x0, N_TOP - 0.22, z0, x1, N_TOP, z1, { kind: K.WOOD, color: PAL.wood });
    ctx.solid([x0, N_TOP - 0.25, z0], [x1, N_TOP, z1], 'bridge');
    A.boxMinMax(x0 + 0.1, N_TOP - 0.55, z0, x0 + 0.3, N_TOP - 0.22, z1, { kind: K.WOOD, color: PAL.woodDark });
    A.boxMinMax(x1 - 0.3, N_TOP - 0.55, z0, x1 - 0.1, N_TOP - 0.22, z1, { kind: K.WOOD, color: PAL.woodDark });
    for (let i = 0; i <= 8; i++) {
      const z = z1 - i * 1.25;
      for (const x of [x0 + 0.05, x1 - 0.05]) {
        A.box(x, N_TOP + 0.55, z, 0.09, 1.1, 0.09, { kind: K.WOOD, color: PAL.woodDark });
        if (i % 2 === 1) A.box(x, N_TOP + 1.16, z, 0.12, 0.14, 0.12, { kind: K.GLOW, color: PAL.glow });
      }
    }
    for (const x of [x0 + 0.05, x1 - 0.05]) {
      for (const h of [0.55, 1.02]) {
        let prev = [x, N_TOP + h, z1];
        for (let i = 1; i <= 8; i++) {
          const z = z1 - i * 1.25;
          const mid = [x, N_TOP + h - 0.05, z + 0.625];
          A.tube(prev, mid, 0.018, 4, { kind: K.METAL, color: PAL.rope });
          const p = [x, N_TOP + h, z];
          A.tube(mid, p, 0.018, 4, { kind: K.METAL, color: PAL.rope });
          prev = p;
        }
      }
      ctx.solid([x - 0.08, N_TOP, z0], [x + 0.08, N_TOP + 1.05, z1], 'railing');
    }
    // Fanions le long des cordes hautes
    for (const x of [x0 + 0.05, x1 - 0.05]) {
      for (let i = 0; i < 20; i++) {
        const z = z1 - 0.25 - i * 0.48;
        const col = PAL.fabrics[i % PAL.fabrics.length];
        ctx.fabric.cloth((s, t) => [x, N_TOP + 1.0 - t * 0.28 * (1 - Math.abs(s - 0.5) * 1.6), z - s * 0.32], 2, 2, { color: col, pin: (s, t) => t });
      }
    }
  }

  // =====================================================================
  // N : le pavillon de la cloche
  // =====================================================================
  B({ minX: 0, maxX: 17, minZ: -210, maxZ: -190, top: N_TOP, style: 0.69, color: PAL.plasterWarm, tile: 1.0, deckColor: 0xf3ece4 });
  parapet(ctx, 0.15, -190.15, 7.45, -190.15, N_TOP);
  parapet(ctx, 9.55, -190.15, 16.85, -190.15, N_TOP);
  parapet(ctx, 0.15, -190.3, 0.15, -209.7, N_TOP);
  parapet(ctx, 16.85, -190.3, 16.85, -209.7, N_TOP);
  parapet(ctx, 0, -209.85, 17, -209.85, N_TOP);
  A.boxMinMax(7.4, N_TOP, -198.5, 9.6, N_TOP + 0.012, -190.3, { kind: K.STONE, color: PAL.coping });
  inlay(ctx, 7.1, 7.4, -197.7, -190.3, N_TOP, { tile: 0.04, color: 0xd9a184, h: 0.016 });
  inlay(ctx, 9.6, 9.9, -197.7, -190.3, N_TOP, { tile: 0.04, color: 0xd9a184, h: 0.016 });
  inlay(ctx, 1.1, 4.1, -207.3, -204.3, N_TOP, { kind: K.GRAVEL, color: 0xd9d0c5, h: 0.02 });
  inlay(ctx, 12.9, 15.9, -207.1, -204.1, N_TOP, { kind: K.GRAVEL, color: 0xd9d0c5, h: 0.02 });
  inlay(ctx, 5.6, 11.4, -202.9, -197.1, N_TOP, { tile: 0.5, color: 0xeadfd2, h: 0.01 });
  shiftedSlabs(ctx, 2.0, 15.0, -209.4, -203.4, N_TOP, { tile: 1.0, n: 5, rand: slabRand, color: 0xf3ece4 });
  for (const [px, pz] of [[6.8, -198.3], [10.2, -198.3], [6.8, -201.7], [10.2, -201.7]]) {
    A.box(px, N_TOP + 1.6, pz, 0.32, 3.2, 0.32, { kind: K.WOOD, color: PAL.woodDark, bevel: 0.03 });
    A.box(px, N_TOP + 0.08, pz, 0.5, 0.16, 0.5, { kind: K.STONE, color: PAL.coping, bevel: 0.03, skipBottom: true });
    ctx.solid([px - 0.16, N_TOP, pz - 0.16], [px + 0.16, N_TOP + 3.2, pz + 0.16], 'post');
  }
  A.box(8.5, N_TOP + 3.35, -200, 5.0, 0.3, 4.8, { kind: K.WOOD, color: PAL.wood, bevel: 0.04 });
  A.box(8.5, N_TOP + 3.6, -200, 4.2, 0.22, 4.0, { kind: K.PLASTER, color: PAL.coping, bevel: 0.035 });
  A.box(8.5, N_TOP + 3.8, -200, 3.2, 0.2, 3.0, { kind: K.PLASTER, color: PAL.coping, bevel: 0.035 });
  A.box(8.5, N_TOP + 4.0, -200, 1.6, 0.22, 1.4, { kind: K.CORAL, color: PAL.coralSoft, bevel: 0.03 });
  A.box(8.5, N_TOP + 3.12, -200, 0.12, 0.2, 0.12, { kind: K.METAL, color: PAL.metalDark });
  // Socle de pierre, lanternes suspendues aux angles du toit
  A.boxMinMax(6.2, N_TOP, -202.3, 10.8, N_TOP + 0.14, -197.7, { kind: K.STONE, color: PAL.coping, bevel: 0.03, skipBottom: true });
  ctx.solid([6.2, N_TOP, -202.3], [10.8, N_TOP + 0.14, -197.7], 'plinth');
  for (const [px, pz] of [[6.2, -197.8], [10.8, -197.8], [6.2, -202.2], [10.8, -202.2]]) {
    A.tube([px, N_TOP + 3.2, pz], [px, N_TOP + 2.75, pz], 0.01, 3, { kind: K.METAL, color: PAL.metalDark });
    A.box(px, N_TOP + 2.6, pz, 0.2, 0.28, 0.2, { kind: K.GLOW, color: PAL.glow });
    A.box(px, N_TOP + 2.77, pz, 0.26, 0.05, 0.26, { kind: K.WOOD, color: PAL.woodDark });
  }
  // Rubans de vœux noués sous l'avant-toit
  for (let i = 0; i < 14; i++) {
    const t = i / 13;
    const x = 6.6 + t * 3.8, z = -197.75 - (i % 2) * 0.05;
    const col = PAL.fabrics[i % PAL.fabrics.length];
    ctx.fabric.cloth((s, tt) => [x + (s - 0.5) * 0.08, N_TOP + 3.18 - tt * (0.5 + (i % 3) * 0.12), z], 1, 3, { color: col, pin: (s, tt) => tt });
  }
  for (const [x0, x1] of [[2.6, 6.6], [10.4, 14.4]]) {
    basin(ctx, x0, x1, -197.5, -192.5, N_TOP, 0.34);
  }
  for (const [x, z] of [[7.0, -191.2], [10.0, -191.2], [7.0, -196.6], [10.0, -196.6]]) lantern(ctx, x, N_TOP, z, { h: 1.3 });
  tree(ctx, 2.6, N_TOP, -205.8, { kind: 'blossom', scale: 1.25 });
  tree(ctx, 14.4, N_TOP, -205.6, { kind: 'blossom', scale: 1.1 });
  tree(ctx, 14.6, N_TOP, -200.0, { kind: 'olive', scale: 0.8, petals: false });
  cypress(ctx, 1.2, N_TOP, -199.5, { h: 4.4 });
  cypress(ctx, 1.2, N_TOP, -201.6, { h: 3.6 });
  bench(ctx, 5.4, N_TOP, -208.2, { rotY: 0, collide: true });
  bench(ctx, 11.6, N_TOP, -208.2, { rotY: 0, collide: true });
  hedge(deco, 0.6, -197.0, 1.3, -191.0, N_TOP, { h: 0.7 });
  hedge(deco, 15.7, -197.0, 16.4, -191.0, N_TOP, { h: 0.7 });
  stringLights(ctx, [2.6, N_TOP + 3.0, -205.0], [6.8, N_TOP + 3.1, -201.7], { n: 10, sag: 0.4 });
  stringLights(ctx, [14.4, N_TOP + 3.0, -205.0], [10.2, N_TOP + 3.1, -201.7], { n: 10, sag: 0.4 });
  ivy(ctx, 3.5, N_TOP + 0.72, -189.98, 3.5, 3.0, 0, 1, { flowers: [0xfaf3ff, 0xf4a3b5], over: 0.3 });
  ivy(ctx, 13.5, N_TOP + 0.72, -189.98, 3.5, 3.4, 0, 1, { over: 0.3 });

  // =====================================================================
  // Voisins proches : bas du côté du soleil (gauche), hauts et éclairés à droite
  // =====================================================================
  const near = [
    // droite
    { minX: 9.5, maxX: 19, minZ: -8, maxZ: 9, top: 6.5, style: 0.08, color: PAL.plaster, face: '-x', banners: 2, attic: 3.6 },
    { minX: 7.5, maxX: 18, minZ: -29, maxZ: -12, top: -3.2, style: 0.55, color: PAL.plasterSage, garden: true },
    { minX: 14, maxX: 24, minZ: -60, maxZ: -46, top: 4.5, style: 0.37, color: PAL.plasterWarm, panel: [-57.2, -48.8, -2.3, 2.6], deck: 'roof' },
    { minX: 13.5, maxX: 23, minZ: -42, maxZ: -31, top: -1.5, style: 0.62, color: PAL.plasterCool, deck: 'roof' },
    { minX: 6.5, maxX: 16, minZ: -85, maxZ: -64, top: 0.6, style: 0.95, color: PAL.plasterSand, garden: true },
    { minX: 12, maxX: 22, minZ: -104, maxZ: -86, top: 10.5, style: 0.18, color: PAL.plaster, face: '-x', banners: 2, attic: 3.4 },
    { minX: 15.5, maxX: 25, minZ: -134, maxZ: -109, top: 8.5, style: 0.83, color: PAL.plasterRose, panel: [-126.6, -116.4, 0.9, 7.2], deck: 'roof' },
    { minX: 15, maxX: 25, minZ: -190, maxZ: -175, top: 3.6, style: 0.49, color: PAL.plasterWarm, face: '-x', attic: 3.4 },
    { minX: 20, maxX: 30, minZ: -212, maxZ: -193, top: 2.0, style: 0.74, color: PAL.plaster, bare: true, deck: 'roof', upstand: true },
    // gauche
    { minX: -21, maxX: -11, minZ: -22, maxZ: 3, top: -2.5, style: 0.28, color: PAL.plasterRose, garden: true },
    { minX: -18, maxX: -9, minZ: -56, maxZ: -30, top: -1.0, style: 0.67, color: PAL.plasterWarm, garden: true },
    { minX: -16, maxX: -6, minZ: -86, maxZ: -62, top: -6.0, style: 0.13, color: PAL.plaster, deck: 'roof' },
    { minX: -23, maxX: -12.5, minZ: -106, maxZ: -86, top: 0.0, style: 0.41, color: PAL.plasterSand, garden: true },
    { minX: -14, maxX: -4, minZ: -134, maxZ: -108, top: -4.0, style: 0.88, color: PAL.plasterCool, deck: 'roof' },
    { minX: -9, maxX: 3, minZ: -189, maxZ: -174, top: 0.5, style: 0.31, color: PAL.plasterSage, garden: true },
    { minX: -14, maxX: -3, minZ: -214, maxZ: -193, top: -2.0, style: 0.59, color: PAL.plasterWarm, garden: true },
    // derrière le départ
    { minX: -8, maxX: 8, minZ: 10, maxZ: 24, top: -5.0, style: 0.22, color: PAL.plaster, garden: true },
  ];
  for (const n of near) {
    const b = B({ ...n });
    if (n.attic) {
      // Attique en retrait avec sa propre corniche, petite terrasse devant
      const ins = 1.6;
      const a = building(deco, { minX: b.minX + ins, maxX: b.maxX - ins * 0.5, minZ: b.minZ + ins * 0.5, maxZ: b.maxZ - ins * 0.5, top: b.top + n.attic, bottom: b.top - 0.3, color: mixHex(n.color, PAL.plasterSand, 0.3), style: (n.style + 0.37) % 0.96, deck: 'roof', bands: false, detail: 'full' });
      roofDress(deco, a, { garden: false, parapet: true });
      railing(deco, b.minX + 0.3, b.minZ + 0.4, b.minX + 0.3, b.maxZ - 0.4, b.top, { collide: false });
    } else if (!n.bare) roofDress(deco, b, { garden: n.garden ?? false });
    if (n.face) facadeDress(ctx, b, n.face, { floors: 5, flowers: 0.3, balcony: 0.16, ac: 0.08, awnings: 0.06, banners: n.banners ?? 0, ivy: 1, minY: -16 });
    if (n.panel) {
      // Panneau aveugle encadré de pierre, où l'on a peint une vieille réclame
      const [z0, z1, y0, y1] = n.panel, x = b.minX;
      A.boxMinMax(x - 0.16, y0, z0, x, y1, z1, { kind: K.PLASTER, color: mixHex(n.color, 0xffffff, 0.25) });
      for (const [a0, a1, c0, c1] of [[y0 - 0.25, y0, z0 - 0.25, z1 + 0.25], [y1, y1 + 0.25, z0 - 0.25, z1 + 0.25], [y0, y1, z0 - 0.25, z0], [y0, y1, z1, z1 + 0.25]]) {
        A.boxMinMax(x - 0.24, a0, c0, x, a1, c1, { kind: K.PLASTER, color: PAL.coping });
      }
    }
  }

  // Salissures et ombres de contact là où les terrasses butent contre les volumes
  junctionGrime(keepOut, shadows, ctx.groundAt);

  // Campanile derrière le pavillon : un repère qu'on aperçoit de loin
  {
    const cx = 25, cz = -202.5, w = 4.4;
    B({ minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - w / 2, maxZ: cz + w / 2, top: 24, bottom: 1.9, plain: true, sideKind: K.STONE, color: PAL.stone, deck: 'roof', cornice: true, corniceOver: 0.25, bands: false });
    for (const y of [8, 16]) A.box(cx, y, cz, w + 0.3, 0.4, w + 0.3, { kind: K.PLASTER, color: PAL.coping });
    for (const [dx, dz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      A.box(cx + dx * (w / 2 - 0.4), 26.3, cz + dz * (w / 2 - 0.4), 0.8, 4.6, 0.8, { kind: K.STONE, color: PAL.stone });
    }
    for (const [dx, dz, rw, rd] of [[0, -1, w, 0.8], [0, 1, w, 0.8], [-1, 0, 0.8, w], [1, 0, 0.8, w]]) {
      A.box(cx + dx * (w / 2 - 0.4), 28.4, cz + dz * (w / 2 - 0.4), rw, 0.5, rd, { kind: K.STONE, color: PAL.stone });
      A.box(cx + dx * (w / 2 - 0.25), 24.35, cz + dz * (w / 2 - 0.25), rw, 0.7, rd * 0.4, { kind: K.METAL, color: PAL.metalDark });
    }
    A.box(cx, 28.75, cz, w + 0.6, 0.25, w + 0.6, { kind: K.PLASTER, color: PAL.coping });
    const cone = new THREE.ConeGeometry(w * 0.74, 4.6, 4, 1);
    cone.rotateY(Math.PI / 4);
    A.geometry(cone, new THREE.Matrix4().makeTranslation(cx, 28.9 + 2.3, cz), { kind: K.TERRA, color: PAL.terra });
    A.cylinder(cx, 25.2, cz, 0.35, 0.75, 1.2, 14, { kind: K.METAL, color: 0xc89a62 });
    A.tube([cx, 33.4, cz], [cx, 35.0, cz], 0.04, 6, { kind: K.METAL, color: PAL.metalDark });
    A.box(cx, 34.5, cz, 0.6, 0.05, 0.05, { kind: K.METAL, color: PAL.metalDark });
  }

  // Plaques de rue et réclames peintes
  const signs = new Signs();
  signs.add('savon', 15.34, 4.1, -121.5, -1, 0, 9.0);
  signs.add('the', 13.84, 0.2, -53, -1, 0, 7.0);
  signs.add('lavandieres', 13, 2.75, -156.0, -1, 0, 1.3);
  signs.add('montee', 4.95, 2.95, -172, 0, 1, 1.3);
  signs.add('nuages', 10.7, 4.95, -190, 0, 1, 1.2);

  // =====================================================================
  // Ville intermédiaire, aqueducs
  // =====================================================================
  aqueduct(ctx, { axis: 'x', from: -150, to: 110, c: -262, top: 3.5, thick: 3.4 });
  aqueduct(ctx, { axis: 'z', from: -230, to: 20, c: -58, top: -1.5, thick: 3.0 });
  keepOut.push({ minX: -150, maxX: 110, minZ: -266, maxZ: -258 });
  keepOut.push({ minX: -61, maxX: -55, minZ: -230, maxZ: 20 });
  const corridor = (z) => (z > -60 ? [-24, 26] : z > -140 ? [-25, 28] : [-17, 33]);
  // Côté soleil (gauche), la ville reste basse : la vue s'ouvre sur la lumière.
  const cap = (x, z) => (x < 0 && x > -125 && z > -170 ? 1.5 : Infinity);
  // Ville : son propre tirage, pour que les retouches du parcours ne la redistribuent pas.
  buildCity({ ...ctx, rand: rng(31) }, { corridor, keepOut, cap });

  // =====================================================================
  // Maillages fusionnés
  // =====================================================================
  const archMat = createArchMaterial();
  const farMat = createArchMaterial({ shadows: false });
  const foliageMat = createFoliageMaterial();
  const fabricMat = createFabricMaterial();
  const waterMat = createWaterMaterial();
  const animated = [archMat, farMat, foliageMat, fabricMat, waterMat];
  const meshes = [];
  const addMesh = (batch, mat, cast, receive) => {
    if (!batch.count) return null;
    const mesh = new THREE.Mesh(batch.build(), mat);
    mesh.castShadow = cast;
    mesh.receiveShadow = receive;
    mesh.matrixAutoUpdate = false;
    scene.add(mesh);
    meshes.push(mesh);
    return mesh;
  };
  addMesh(ctx.arch, archMat, true, true);
  addMesh(ctx.far, farMat, false, false);
  addMesh(ctx.foliage, foliageMat, true, true);
  addMesh(ctx.farFoliage, foliageMat, false, true);
  addMesh(ctx.fabric, fabricMat, true, true);
  addMesh(ctx.water, waterMat, false, true);
  const aoMesh = shadows.mesh();
  if (aoMesh) { scene.add(aoMesh); meshes.push(aoMesh); }
  const signMesh = signs.mesh();
  if (signMesh) { scene.add(signMesh); meshes.push(signMesh); }

  // ---------- Cloche ----------
  const bell = new THREE.Group();
  const bellMat = new THREE.MeshStandardMaterial({ color: 0xe8b77a, metalness: 0.7, roughness: 0.3, side: THREE.DoubleSide, emissive: 0x6a3a10, emissiveIntensity: 0.3 });
  const bellBody = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.55, 0.9, 20, 1, true), bellMat);
  bellBody.position.y = -0.45;
  bell.add(bellBody);
  const bellTop = new THREE.Mesh(new THREE.SphereGeometry(0.28, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), bellMat);
  bell.add(bellTop);
  bell.position.set(8.5, N_TOP + 3.0, -200);
  bellBody.castShadow = true;
  scene.add(bell);

  // ---------- Lueurs à collecter ----------
  const orbPositions = [
    [0.45, 1.75, -8.5],
    [0.45, 1.9, -17.5],
    [2.2, 4.0, -34], [2.2, 4.75, -37.5], [2.2, 4.1, -41],
    [0.5, 2.5, -46.5],
    [0.1, 6.45, -57],
    [0, 5.8, -66.2], [0, 5.8, -72.6], [0, 5.8, -79.0],
    [-5.6, 4.9, -96.6], [4.2, 4.6, -92],
    [3.0, 5.2, -105.5], [4.3, 4.3, -115.5], [5.0, 3.0, -125.5],
    [5.8, 2.45, -139.5], [5.8, 3.0, -142.5], [5.8, 2.5, -145.5],
    [9.0, 1.45, -153.4], [9.0, 1.0, -160.8],
    [9.0, 5.2, -176.2], [8.95, 6.55, -185],
    [2.4, 6.7, -203.5], [14.6, 6.7, -194.8],
  ];
  const orbGeo = new THREE.IcosahedronGeometry(0.16, 1);
  const orbMat = materials?.glow ?? new THREE.MeshStandardMaterial({ color: 0xffd9a8, emissive: 0xffd9a8, emissiveIntensity: 1.1 });
  const haloTex = makeHaloTexture();
  const orbs = orbPositions.map((p, i) => {
    const g = new THREE.Group();
    const core = new THREE.Mesh(orbGeo, orbMat);
    g.add(core);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTex, color: 0xffe2b8, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.8 }));
    halo.scale.setScalar(1.3);
    g.add(halo);
    g.position.set(p[0], p[1], p[2]);
    scene.add(g);
    return { pos: new THREE.Vector3(...p), group: g, collected: false, phase: i * 1.37, fade: 1 };
  });

  // ---------- Points de reprise ----------
  const checkpoints = [
    { name: 'A', title: 'La terrasse aux lavandes', min: [-7, -1, -7], max: [7, 2, 7], spawn: [0, 0, 4], yaw: 0 },
    { name: 'B', title: 'Le premier pas', min: [-3, 0, -16], max: [3, 2, -10], spawn: [0, 0.5, -12], yaw: 0 },
    { name: 'D', title: 'Le mur corail', min: [-4, 1.5, -32], max: [3, 4, -19], spawn: [-0.5, 2, -22], yaw: 0 },
    { name: 'E', title: 'La pergola des glycines', min: [-4, 1.5, -54], max: [3, 4, -42], spawn: [-0.5, 2, -43.5], yaw: 0 },
    { name: 'F', title: 'Le toit rose', min: [-4, 5, -60], max: [3, 8, -54], spawn: [-0.5, 5.6, -58.5], yaw: 0 },
    { name: 'H', title: 'Le jardin du bassin', min: [-9, 3, -104], max: [9, 7, -86.4], spawn: [0, H_TOP, -88.5], yaw: 0 },
    { name: 'I', title: 'La cascade de toits', min: [-1, 2, -114], max: [7, 5, -107], spawn: [3.5, 2.6, -108.6], yaw: 0 },
    { name: 'J', title: 'Les toits blancs', min: [3, 0, -137], max: [12, 3, -127], spawn: [5.6, 0.4, -128.6], yaw: 0 },
    { name: 'K', title: 'La ruelle du linge', min: [5, 0, -172], max: [13, 3, -147], spawn: [8.5, K_TOP, -148.6], yaw: 0 },
    { name: 'M', title: 'La montée au portique', min: [4, 3.5, -180], max: [14, 7, -172], spawn: [8.5, M_TOP, -173.4], yaw: 0 },
    { name: 'N', title: 'Le pavillon de la cloche', min: [0, 5, -210], max: [17, 9, -190], spawn: [8.5, N_TOP, -191.5], yaw: 0 },
  ];

  // ---------- Conseils ----------
  const hints = [
    { id: 'move', min: [-7, -1, -1], max: [7, 3, 7], text: 'Avance avec <kbd>Z</kbd><kbd>W</kbd>, regarde avec la souris' },
    { id: 'jump', min: [-3, -1, -7], max: [3, 3, -3], text: '<kbd>Espace</kbd> pour sauter' },
    { id: 'vault', min: [-3, 0, -16], max: [3, 3, -12], text: 'Cours vers un muret pour l’enjamber' },
    { id: 'wallrun', min: [-4, 1.5, -31], max: [3, 5, -26], text: 'Saute le long du mur corail pour courir dessus' },
    { id: 'slide', min: [-4, 1.5, -46], max: [3, 5, -42.5], text: '<kbd>Maj</kbd> ou <kbd>C</kbd> en courant pour glisser' },
    { id: 'climb', min: [-4, 1.5, -54], max: [3, 5, -50], text: 'Saute face au mur pour grimper' },
    { id: 'calm', min: [7, 5, -190], max: [10, 8, -181], text: 'Prends ton temps : la cloche t’attend' },
  ];

  const goal = { min: [6.8, N_TOP - 0.5, -201.7], max: [10.2, N_TOP + 3, -198.3] };

  // ---------- Points de vue (captures, menu) ----------
  const viewpoints = {
    depart: { pos: [0, 1.62, 5.5], yaw: 0, pitch: -0.04 },
    panorama: { pos: [2, 10, 15], yaw: 0.03, pitch: -0.21 },
    mur: { pos: [1.2, 3.62, -27.5], yaw: -0.16, pitch: 0.02 },
    pergola: { pos: [-0.5, 3.62, -43], yaw: 0, pitch: -0.06 },
    jardin: { pos: [0, 5.22, -88], yaw: 0, pitch: -0.05 },
    cascade: { pos: [3.0, 5.22, -102.6], yaw: -0.12, pitch: -0.18 },
    ruelle: { pos: [8.5, 2.02, -148.6], yaw: 0, pitch: 0.02 },
    cloche: { pos: [8.5, 7.42, -181.5], yaw: 0, pitch: -0.02 },
  };

  // ---------- Itinéraire pour le pilote automatique (tests) ----------
  const route = [
    { p: [0, 0, -5.6], action: 'jump', r: 0.45 },
    { p: [0, 0.5, -15] },
    { p: [0, 2, -24] },
    { p: [2.66, 2, -29.4], r: 0.3 },
    { p: [2.66, 2, -31.0], action: 'jump', r: 0.3 },
    { p: [2.66, 3, -42.5], r: 0.6 },
    { p: [-0.5, 2, -43.4], r: 0.5 },
    { p: [-0.5, 2, -45.0], action: 'slide', r: 0.5 },
    { p: [-0.5, 2, -51.2], r: 0.4 },
    { p: [-0.5, 2, -52.7], action: 'jump', r: 0.4 },
    { p: [-0.5, 5.6, -57.5], r: 0.6 },
    { p: [0.8, 5.6, -59.4], r: 0.4 },
    { p: [0.8, 4.4, -64.4], action: 'jump', r: 0.35 },
    { p: [-0.8, 4.4, -70.8], action: 'jump', r: 0.35 },
    { p: [0.8, 4.4, -77.2], action: 'jump', r: 0.35 },
    { p: [-0.8, 4.4, -83.6], action: 'jump', r: 0.35 },
    { p: [0.4, H_TOP, -92], r: 0.6 },
    { p: [3.0, H_TOP, -101.4], r: 0.5 },
    { p: [3.0, H_TOP, -103.3], action: 'jump', r: 0.4 },
    { p: [4.0, 2.6, -111.4], r: 0.5 },
    { p: [4.4, 2.6, -113.3], action: 'jump', r: 0.4 },
    { p: [5.4, 1.4, -121.4], r: 0.5 },
    { p: [5.4, 1.4, -123.3], action: 'jump', r: 0.4 },
    { p: [5.36, K_TOP, -134.4], r: 0.3 },
    { p: [5.36, K_TOP, -136.0], action: 'jump', r: 0.3 },
    { p: [5.36, 1.4, -147.5], r: 0.6 },
    { p: [8.5, K_TOP, -151.0], r: 0.6 },
    { p: [8.5, K_TOP, -158.6], action: 'slide', r: 0.5 },
    { p: [8.5, K_TOP, -169.2], r: 0.4 },
    { p: [8.5, K_TOP, -170.7], action: 'jump', r: 0.4 },
    { p: [8.5, M_TOP, -174.2], r: 0.6 },
    { p: [8.5, N_TOP, -185], r: 0.6 },
    { p: [8.5, N_TOP, -200], r: 0.5 },
  ];

  let time = 0;
  function update(dt) {
    time += dt;
    for (const m of animated) m.userData.uniforms.uTime.value = time;
    for (const o of orbs) {
      if (o.collected) {
        o.fade = Math.max(0, o.fade - dt * 3);
        o.group.scale.setScalar(1 + (1 - o.fade) * 1.5);
        o.group.children[1].material.opacity = 0.8 * o.fade;
        o.group.children[0].visible = o.fade > 0.5;
        if (o.fade <= 0) o.group.visible = false;
        continue;
      }
      o.group.position.y = o.pos.y + Math.sin(time * 1.6 + o.phase) * 0.12;
      o.group.children[0].rotation.y = time * 1.2 + o.phase;
      o.group.children[0].rotation.x = time * 0.7;
    }
    bell.rotation.z = Math.sin(time * 0.9) * 0.04;
  }

  return { meshes, orbs, checkpoints, hints, goal, viewpoints, route, bell, update, spawn: { pos: [0, 0, 4], yaw: 0 } };
}

function makeHaloTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.25, 'rgba(255,235,200,0.55)');
  grd.addColorStop(1, 'rgba(255,220,180,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
