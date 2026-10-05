// Monde de collision : uniquement des boîtes alignées sur les axes (AABB).
// Simple, robuste et suffisant pour une architecture faite de blocs.

export class PhysicsWorld {
  constructor() {
    this.boxes = [];
  }

  // min/max : tableaux [x, y, z]. tag : chaîne libre (ex. "wallrun", "checkpoint").
  add(min, max, data = {}) {
    const box = {
      minX: min[0], minY: min[1], minZ: min[2],
      maxX: max[0], maxY: max[1], maxZ: max[2],
      ...data,
    };
    this.boxes.push(box);
    return box;
  }

  // Retourne la première boîte qui chevauche l'AABB donnée, ou null.
  overlap(minX, minY, minZ, maxX, maxY, maxZ, ignoreTrigger = true) {
    const boxes = this.boxes;
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      if (ignoreTrigger && b.trigger) continue;
      if (minX < b.maxX && maxX > b.minX && minY < b.maxY && maxY > b.minY && minZ < b.maxZ && maxZ > b.minZ) {
        return b;
      }
    }
    return null;
  }

  // Remplit `out` avec toutes les boîtes qui chevauchent l'AABB.
  overlapAll(minX, minY, minZ, maxX, maxY, maxZ, out, ignoreTrigger = true) {
    out.length = 0;
    const boxes = this.boxes;
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      if (ignoreTrigger && b.trigger) continue;
      if (minX < b.maxX && maxX > b.minX && minY < b.maxY && maxY > b.minY && minZ < b.maxZ && maxZ > b.minZ) {
        out.push(b);
      }
    }
    return out;
  }

  // Hauteur du sol sous un point (x, z) en partant de y vers le bas. -Infinity si rien.
  groundBelow(x, y, z, radius = 0.3) {
    let best = -Infinity;
    for (const b of this.boxes) {
      if (b.trigger) continue;
      if (x + radius > b.minX && x - radius < b.maxX && z + radius > b.minZ && z - radius < b.maxZ && b.maxY <= y + 0.01) {
        if (b.maxY > best) best = b.maxY;
      }
    }
    return best;
  }

  // Lancer de rayon (direction normalisée) contre les boîtes solides.
  // Renvoie la distance du premier impact (ou Infinity) ; si `hit` est fourni, il reçoit
  // { dist, nx, ny, nz, box }. Les boîtes qui contiennent l'origine sont ignorées.
  // Aucune allocation : utilisable à chaque image.
  raycast(ox, oy, oz, dx, dy, dz, maxDist, hit = null) {
    let best = maxDist;
    let bestAxis = -1, bestSign = 0, bestBox = null;
    const boxes = this.boxes;
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      if (b.trigger) continue;
      let tmin = 0, tmax = best, axis = -1, sign = 0;
      // X
      if (dx > -1e-9 && dx < 1e-9) {
        if (ox <= b.minX || ox >= b.maxX) continue;
      } else {
        const inv = 1 / dx;
        let t1 = (b.minX - ox) * inv, t2 = (b.maxX - ox) * inv, s = -1;
        if (t1 > t2) { const t = t1; t1 = t2; t2 = t; s = 1; }
        if (t1 > tmin) { tmin = t1; axis = 0; sign = s; }
        if (t2 < tmax) tmax = t2;
        if (tmin > tmax) continue;
      }
      // Y
      if (dy > -1e-9 && dy < 1e-9) {
        if (oy <= b.minY || oy >= b.maxY) continue;
      } else {
        const inv = 1 / dy;
        let t1 = (b.minY - oy) * inv, t2 = (b.maxY - oy) * inv, s = -1;
        if (t1 > t2) { const t = t1; t1 = t2; t2 = t; s = 1; }
        if (t1 > tmin) { tmin = t1; axis = 1; sign = s; }
        if (t2 < tmax) tmax = t2;
        if (tmin > tmax) continue;
      }
      // Z
      if (dz > -1e-9 && dz < 1e-9) {
        if (oz <= b.minZ || oz >= b.maxZ) continue;
      } else {
        const inv = 1 / dz;
        let t1 = (b.minZ - oz) * inv, t2 = (b.maxZ - oz) * inv, s = -1;
        if (t1 > t2) { const t = t1; t1 = t2; t2 = t; s = 1; }
        if (t1 > tmin) { tmin = t1; axis = 2; sign = s; }
        if (t2 < tmax) tmax = t2;
        if (tmin > tmax) continue;
      }
      if (axis < 0) continue; // origine à l'intérieur de la boîte
      if (tmin < best) { best = tmin; bestAxis = axis; bestSign = sign; bestBox = b; }
    }
    if (bestAxis < 0) {
      if (hit) { hit.dist = Infinity; hit.box = null; }
      return Infinity;
    }
    if (hit) {
      hit.dist = best;
      hit.nx = bestAxis === 0 ? bestSign : 0;
      hit.ny = bestAxis === 1 ? bestSign : 0;
      hit.nz = bestAxis === 2 ? bestSign : 0;
      hit.box = bestBox;
    }
    return best;
  }
}
