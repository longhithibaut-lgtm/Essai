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
}
