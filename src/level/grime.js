// Patine automatique aux jonctions : là où une terrasse bute contre un volume plus
// haut, on pose une salissure au pied du mur et une ombre de contact sur le sol.
// Ne dépend que des boîtes des immeubles du parcours (pas de calcul à l'écran).

export function junctionGrime(list, shadows, groundAt) {
  const L = list.filter((b) => b.top !== undefined);
  for (const b of L) {
    for (const a of L) {
      if (a === b || b.top < a.top + 0.35) continue;
      const y = a.top;
      const h = Math.min(1.5, b.top - a.top);
      const zo0 = Math.max(a.minZ, b.minZ), zo1 = Math.min(a.maxZ, b.maxZ);
      const xo0 = Math.max(a.minX, b.minX), xo1 = Math.min(a.maxX, b.maxX);
      const faces = [];
      if (zo1 - zo0 > 0.3) {
        if (a.minX < b.minX - 0.1 && a.maxX > b.minX - 0.2) faces.push(['x', b.minX, -1]);
        if (a.maxX > b.maxX + 0.1 && a.minX < b.maxX + 0.2) faces.push(['x', b.maxX, 1]);
      }
      if (xo1 - xo0 > 0.3) {
        if (a.minZ < b.minZ - 0.1 && a.maxZ > b.minZ - 0.2) faces.push(['z', b.minZ, -1]);
        if (a.maxZ > b.maxZ + 0.1 && a.minZ < b.maxZ + 0.2) faces.push(['z', b.maxZ, 1]);
      }
      for (const [ax, c, sg] of faces) {
        if (ax === 'x') {
          const zm = (zo0 + zo1) / 2;
          if (groundAt && !groundAt(c + sg * 0.35, zm, y)) continue;
          shadows.addWall(c, zo0, c, zo1, y, h, 0.85, sg, 0);
          shadows.add(c, zm, 1.1, zo1 - zo0, y, 0.7);
        } else {
          const xm = (xo0 + xo1) / 2;
          if (groundAt && !groundAt(xm, c + sg * 0.35, y)) continue;
          shadows.addWall(xo0, c, xo1, c, y, h, 0.85, 0, sg);
          shadows.add(xm, c, xo1 - xo0, 1.1, y, 0.7);
        }
      }
    }
  }
}
