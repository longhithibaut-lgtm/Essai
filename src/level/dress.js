import { K } from './surfaces.js';
import { PAL, windowGrid, acUnit, waterTank, vent, chimney, antenna, hut, skylight, planter, parapet, shadeSail, banner, awning, laundry, gableRoof, dome, duct } from './props.js';
import { tree, cypress, bush, hedge, ivy } from './vegetation.js';

// Habillage automatique des toits et des façades des immeubles voisins.

export { windowGrid };

// Position monde d'un point (u le long de la face, y) et normale de la face
function facePoint(b, face, u, off) {
  switch (face) {
    case '+z': return { x: b.minX + u, z: b.maxZ + off, nx: 0, nz: 1, rot: 0 };
    case '-z': return { x: b.maxX - u, z: b.minZ - off, nx: 0, nz: -1, rot: Math.PI };
    case '+x': return { x: b.maxX + off, z: b.maxZ - u, nx: 1, nz: 0, rot: Math.PI / 2 };
    default: return { x: b.minX - off, z: b.minZ + u, nx: -1, nz: 0, rot: -Math.PI / 2 };
  }
}

export function facadeDress(ctx, b, face, o = {}) {
  if (b.plain) return;
  const rand = ctx.rand;
  const batch = o.batch ?? ctx.arch;
  const g = windowGrid(b, face);
  if (g.style === 3) return;
  const shaftTop = b.top - (b.deck === 'roof' ? 0 : 0.3);
  const floors = o.floors ?? 5;
  const flowerCols = [0xf4a3b5, 0xfbe3a0, 0xf7f0ff, 0xe48fa0, 0xc9b3e6];
  for (let f = 0; f < floors; f++) {
    for (let i = 0; i < g.nb; i++) {
      const r = rand();
      const slabY = shaftTop - g.band - f * g.floorH; // ligne de dalle au-dessus de l'étage
      const sillY = slabY - g.mx[1];
      const headY = slabY - g.mn[1];
      if (sillY < (o.minY ?? -20)) continue;
      const uc = i * g.bw + g.bw / 2;
      const ww = g.mx[0] - g.mn[0];
      if (r < (o.flowers ?? 0.22)) {
        // Jardinière de fenêtre fleurie
        const p = facePoint(b, face, uc, 0.18);
        batch.box(p.x, sillY - 0.12, p.z, Math.min(ww, 1.6), 0.24, 0.3, { kind: K.TERRA, color: PAL.terra, rotY: p.rot });
        if (!o.noFoliage) {
          const n = Math.max(2, Math.floor(Math.min(ww, 1.6) / 0.4));
          for (let k = 0; k < n; k++) {
            const uu = uc + (k / (n - 1) - 0.5) * Math.min(ww, 1.5);
            const q = facePoint(b, face, uu, 0.2);
            bush(ctx, q.x, sillY - 0.05, q.z, { r: 0.22, kind: 'leaf', blobs: 1, flowers: flowerCols, lite: true });
          }
        }
      } else if (r < (o.flowers ?? 0.22) + (o.balcony ?? 0.12) && g.style !== 1) {
        // Petit balcon
        const depth = 0.9;
        const bwid = Math.min(ww + 0.6, g.bw - 0.2);
        const p = facePoint(b, face, uc, depth / 2);
        const floorY = slabY - g.floorH;
        if (floorY < (o.minY ?? -20)) continue;
        batch.box(p.x, floorY + 0.06, p.z, bwid, 0.14, depth, { kind: K.PLASTER, color: PAL.coping, rotY: p.rot });
        const p2 = facePoint(b, face, uc, depth - 0.03);
        batch.box(p2.x, floorY + 0.6, p2.z, bwid, 0.03, 0.03, { kind: K.METAL, color: PAL.metalDark, rotY: p.rot });
        batch.box(p2.x, floorY + 1.05, p2.z, bwid, 0.04, 0.05, { kind: K.METAL, color: PAL.metalDark, rotY: p.rot });
        for (let k = 0; k <= 6; k++) {
          const q = facePoint(b, face, uc + (k / 6 - 0.5) * bwid, depth - 0.03);
          batch.box(q.x, floorY + 0.58, q.z, 0.025, 0.98, 0.025, { kind: K.METAL, color: PAL.metalDark });
        }
        if (!o.noFoliage && rand() < 0.6) {
          const q = facePoint(b, face, uc + bwid * 0.32, depth * 0.5);
          bush(ctx, q.x, floorY + 0.13, q.z, { r: 0.3, kind: rand() < 0.5 ? 'leaf' : 'hedge', blobs: 1, flowers: rand() < 0.5 ? flowerCols : null, lite: true });
        }
      } else if (r < (o.flowers ?? 0.22) + (o.balcony ?? 0.12) + (o.ac ?? 0.07)) {
        // Climatiseur sous la fenêtre
        const p = facePoint(b, face, uc + ww * 0.25, 0.3);
        batch.box(p.x, sillY - 0.45, p.z, 0.8, 0.55, 0.5, { kind: K.VENT, color: PAL.metalLight, rotY: p.rot });
      } else if (r < (o.flowers ?? 0.22) + (o.balcony ?? 0.12) + (o.ac ?? 0.07) + (o.awnings ?? 0.06)) {
        const p = facePoint(b, face, uc, 0.0);
        awning(ctx, p.x, p.z, headY + 0.25, Math.min(ww + 0.3, 2.4), 0.7, p.rot, { color: PAL.fabrics[Math.floor(rand() * PAL.fabrics.length)], stripes: 5 });
      }
    }
  }
  // Bannières
  if (o.banners) {
    for (let k = 0; k < o.banners; k++) {
      const u = (k + 0.5) / o.banners * g.W;
      const p = facePoint(b, face, u, 0.25);
      const col = PAL.fabrics[Math.floor(rand() * PAL.fabrics.length)];
      banner(ctx, p.x, shaftTop - 0.8, p.z, 0.9, 3.4 + rand() * 2.5, p.rot, { color: col, color2: rand() < 0.5 ? PAL.coralSoft : null });
    }
  }
  // Lierre qui retombe du toit
  if (o.ivy) {
    const [r0, r1] = o.ivyRange ?? [0.15, 0.85];
    for (let k = 0; k < o.ivy; k++) {
      const u = (r0 + rand() * (r1 - r0)) * g.W;
      const p = facePoint(b, face, u, 0.22);
      ivy(ctx, p.x, b.top - 0.02, p.z, 1.4 + rand() * 1.8, 2.5 + rand() * 4.0, p.nx, p.nz, { flowers: rand() < 0.5 ? [0xf7f0ff, 0xf4a3b5] : null, over: 0.25 });
    }
  }
}

// Habillage générique d'un toit. far : immeubles lointains (moins de détails).
export function roofDress(ctx, b, o = {}) {
  const rand = ctx.rand;
  const batch = o.batch ?? ctx.arch;
  const far = !!o.far;
  const y = b.top;
  const inset = 0.6;
  const x0 = b.minX + inset, x1 = b.maxX - inset, z0 = b.minZ + inset, z1 = b.maxZ - inset;
  const W = x1 - x0, D = z1 - z0;
  if (W < 2 || D < 2) return;
  // Quelques toits de tuiles et coupoles : silhouette méditerranéenne, apaisée.
  const kind = o.kind ?? (o.garden ? 'flat' : (() => {
    const r = rand();
    // Au loin, davantage de toits de tuiles : la silhouette se découpe et la ville se réchauffe
    const gp = far ? 0.32 : 0.2;
    if (o.allowGable !== false && r < gp && W < 15 && D < 15) return 'gable';
    if (o.allowDome !== false && r < gp + 0.06 && W > 8 && D > 8) return 'dome';
    return 'flat';
  })());
  if (kind === 'gable') {
    const terra = [0xd38f70, 0xc98166, 0xdb9a7a, 0xcf8a74][Math.floor(rand() * 4)];
    gableRoof(ctx, b.minX, b.maxX, b.minZ, b.maxZ, y, Math.min(b.maxX - b.minX, b.maxZ - b.minZ) * 0.26, { batch, color: terra, wallColor: o.wallColor ?? PAL.plaster });
    if (rand() < 0.6) chimney({ ...ctx, physics: null }, b.minX + (b.maxX - b.minX) * (0.25 + rand() * 0.5), y + 0.4, b.minZ + (b.maxZ - b.minZ) * (0.3 + rand() * 0.4), { batch, h: 1.6 });
    return;
  }
  if (kind === 'dome') {
    const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
    const r = Math.min(W, D) * 0.32;
    dome(ctx, cx, y, cz, r, { batch, color: rand() < 0.3 ? 0xdfe8ee : 0xf6f1ea });
    const pctx2 = { ...ctx, physics: null };
    const h = 0.7;
    parapet(pctx2, b.minX, b.maxZ - 0.15, b.maxX, b.maxZ - 0.15, y, { h, batch, collide: false, piers: !far });
    parapet(pctx2, b.minX, b.minZ + 0.15, b.maxX, b.minZ + 0.15, y, { h, batch, collide: false, piers: !far });
    parapet(pctx2, b.minX + 0.15, b.minZ + 0.3, b.minX + 0.15, b.maxZ - 0.3, y, { h, batch, collide: false, piers: !far });
    parapet(pctx2, b.maxX - 0.15, b.minZ + 0.3, b.maxX - 0.15, b.maxZ - 0.3, y, { h, batch, collide: false, piers: !far });
    return;
  }
  // Muret périphérique
  if (o.parapet !== false) {
    const h = 0.5 + rand() * 0.5;
    const pctx = { ...ctx, physics: null };
    // Sur l'étanchéité, chaque muret a son relevé et son solin (côté toit)
    const sk = !far && b.deck === 'roof';
    parapet(pctx, b.minX, b.maxZ - 0.15, b.maxX, b.maxZ - 0.15, y, { h, batch, collide: false, piers: !far, skirt: sk ? -1 : 0 });
    parapet(pctx, b.minX, b.minZ + 0.15, b.maxX, b.minZ + 0.15, y, { h, batch, collide: false, piers: !far, skirt: sk ? 1 : 0 });
    parapet(pctx, b.minX + 0.15, b.minZ + 0.3, b.minX + 0.15, b.maxZ - 0.3, y, { h, batch, collide: false, piers: !far, skirt: sk ? 1 : 0 });
    parapet(pctx, b.maxX - 0.15, b.minZ + 0.3, b.maxX - 0.15, b.maxZ - 0.3, y, { h, batch, collide: false, piers: !far, skirt: sk ? -1 : 0 });
  }
  const used = [];
  const free = (x, z, r) => used.every((u) => Math.hypot(u[0] - x, u[1] - z) > u[2] + r);
  const place = (r, fn, tries = 8) => {
    for (let t = 0; t < tries; t++) {
      const x = x0 + r + rand() * Math.max(0.01, W - 2 * r);
      const z = z0 + r + rand() * Math.max(0.01, D - 2 * r);
      if (free(x, z, r)) { used.push([x, z, r]); fn(x, z); return true; }
    }
    return false;
  };
  const area = W * D;
  const pctx = { ...ctx, physics: null };
  const garden = o.garden ?? (rand() < 0.3);
  if (rand() < 0.55) place(1.4, (x, z) => waterTank(pctx, x, y, z, { batch, r: 0.9 + rand() * 0.4, h: 1.4 + rand() * 0.8, leg: 1.0 + rand() * 1.2 }));
  if (rand() < 0.35 && area > 40) place(1.8, (x, z) => hut(pctx, x, y, z, { batch, rotY: Math.floor(rand() * 4) * Math.PI / 2, awning: !far, vent: !far, color: [PAL.plasterWarm, PAL.plaster, PAL.plasterSand][Math.floor(rand() * 3)] }));
  // Groupes de climatiseurs reliés par une gaine, comme sur les vrais toits
  // Caissons techniques (comme sur les vrais toits : on lit la ville par ses toits)
  const nBox = Math.min(3, Math.floor(area / 60)) + (rand() < 0.5 ? 1 : 0);
  for (let i = 0; i < nBox; i++) {
    const bw = 0.9 + rand() * 1.4, bd = 0.8 + rand() * 1.0, bh = 0.6 + rand() * 1.0;
    place(Math.max(bw, bd) * 0.6 + 0.2, (x, z) => {
      batch.box(x, y + bh / 2, z, bw, bh, bd, { kind: rand() < 0.5 ? K.VENT : K.PLASTER, color: rand() < 0.5 ? PAL.metalLight : PAL.plaster });
      batch.box(x, y + bh + 0.04, z, bw + 0.08, 0.08, bd + 0.08, { kind: K.METAL, color: PAL.metal });
      if (ctx.ao) ctx.ao(x, z, bw + 0.6, bd + 0.6, y, 0.8);
    });
  }
  const nClusters = Math.min(5, Math.floor(area / 34 * (o.acDensity ?? 1)) + (rand() < 0.6 ? 1 : 0));
  for (let i = 0; i < nClusters; i++) {
    const n = 1 + Math.floor(rand() * 3);
    const alongX = rand() < 0.5;
    const span = (n - 1) * 1.5;
    place(Math.max(0.9, span / 2 + 0.9), (x, z) => {
      const sc = 0.85 + rand() * 0.3;
      for (let k = 0; k < n; k++) {
        const off = k * 1.5 - span / 2;
        acUnit(pctx, x + (alongX ? off : 0), y, z + (alongX ? 0 : off), { batch, rotY: alongX ? 0 : Math.PI / 2, scale: sc });
      }
      if (!far && rand() < 0.7) {
        const ex = alongX ? x : (rand() < 0.5 ? x0 + 0.3 : x1 - 0.3);
        const ez = alongX ? (rand() < 0.5 ? z0 + 0.3 : z1 - 0.3) : z;
        duct(pctx, [x, z], [ex, ez], y, { batch, size: 0.34 });
      }
    });
  }
  // Tuyaux le long d'un muret
  if (!far && rand() < 0.45) {
    const side = Math.floor(rand() * 4);
    const yy = y + 0.28;
    const a = side === 0 ? [x0 + 0.2, z0 + 0.2] : side === 1 ? [x0 + 0.2, z1 - 0.2] : side === 2 ? [x0 + 0.2, z0 + 0.2] : [x1 - 0.2, z0 + 0.2];
    const c = side === 0 ? [x1 - 0.2, z0 + 0.2] : side === 1 ? [x1 - 0.2, z1 - 0.2] : side === 2 ? [x0 + 0.2, z1 - 0.2] : [x1 - 0.2, z1 - 0.2];
    for (const dy of [0, 0.16]) batch.tube([a[0], yy + dy, a[1]], [c[0], yy + dy, c[1]], 0.055, 6, { kind: K.METAL, color: dy ? PAL.metalLight : PAL.metal });
    const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
    for (let t = 0; t <= len; t += 1.6) {
      const k = t / len;
      batch.box(a[0] + (c[0] - a[0]) * k, y + 0.2, a[1] + (c[1] - a[1]) * k, 0.12, 0.4, 0.12, { kind: K.METAL, color: PAL.metalDark });
    }
  }
  if (!far) {
    for (let i = 0; i < Math.min(3, Math.floor(area / 40)); i++) place(0.4, (x, z) => vent(pctx, x, y, z, { batch }));
    if (rand() < 0.5) place(0.6, (x, z) => chimney(pctx, x, y, z, { batch }));
    if (rand() < 0.4) place(1.2, (x, z) => skylight(pctx, x, y, z, 1.6, 1.0, { batch }));
  }
  if (rand() < (o.antenna ?? 0.25)) place(0.5, (x, z) => antenna(pctx, x, y, z, { batch, h: 3 + rand() * 4 }));
  if (rand() < (o.ducts ?? 0.4) && W > 4 && D > 4) {
    const alongX = rand() < 0.5;
    const t = rand();
    const a = alongX ? [x0 + 0.4, z0 + 0.5 + t * (D - 1)] : [x0 + 0.5 + t * (W - 1), z0 + 0.4];
    const c = alongX ? [x0 + 0.4 + W * (0.4 + rand() * 0.5), a[1]] : [a[0], z0 + 0.4 + D * (0.4 + rand() * 0.5)];
    duct(pctx, a, c, y, { batch });
  }
  if (garden) {
    const ntree = Math.min(3, Math.floor(area / 35) + 1);
    for (let i = 0; i < ntree; i++) {
      place(1.6, (x, z) => {
        const top = planter(pctx, x, y, z, 1.6, 1.6, { batch, h: 0.5 });
        const r = rand();
        if (far) bush(ctx, x, top, z, { r: 0.9, kind: r < 0.5 ? 'leaf' : 'blossom' });
        else if (r < 0.35) tree(pctx, x, top, z, { kind: 'blossom', scale: 0.7 + rand() * 0.3 });
        else if (r < 0.7) tree(pctx, x, top, z, { kind: rand() < 0.5 ? 'olive' : 'leaf', scale: 0.7 + rand() * 0.3, petals: false });
        else cypress(pctx, x, top, z, { h: 3.5 + rand() * 2 });
      });
    }
    if (!far && rand() < 0.6 && W > 5 && D > 5) {
      place(2.2, (x, z) => {
        const c = PAL.fabrics[Math.floor(rand() * PAL.fabrics.length)];
        shadeSail(pctx, [[x - 2, y + 2.6, z - 1.8], [x + 2, y + 2.3, z - 2], [x + 1.9, y + 2.7, z + 1.8], [x - 2.1, y + 2.4, z + 1.9]], { color: c, posts: true, base: y });
      });
    }
  }
  if (!far && rand() < (o.laundry ?? 0.3) && W > 4) {
    const zz = z0 + rand() * D;
    laundry(pctx, [x0 + 0.3, y + 1.9, zz], [x1 - 0.3, y + 1.9, zz + (rand() - 0.5) * 2], { sag: 0.25 });
    batch.box(x0 + 0.3, y + 0.97, zz, 0.06, 1.94, 0.06, { kind: K.METAL, color: PAL.metalDark });
  }
  if (o.hedges && !far) {
    hedge(pctx, x0, z0, x1, z0 + 0.7, y, { h: 0.7 });
  }
}
