import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { rng } from './world.js';

// Le parcours : des terrasses blanches posées sur de hautes tours, au-dessus des nuages.
// Le joueur avance vers -z. Toutes les collisions sont des boîtes alignées.

const TOWER_DEPTH = 70;

export function buildLevel(scene, physics, materials) {
  const groups = new Map(); // matériau -> géométries
  const rand = rng(11);

  function addGeo(matKey, geo) {
    if (!groups.has(matKey)) groups.set(matKey, []);
    groups.get(matKey).push(geo);
  }

  function shadeVertices(geo, top, bottom, low = 0.72) {
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      const t = THREE.MathUtils.clamp((y - (top - 10)) / 10, 0, 1);
      const v = low + (1 - low) * t;
      colors[i * 3] = v;
      colors[i * 3 + 1] = v * 0.985;
      colors[i * 3 + 2] = v * 0.98;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  }

  // Boîte solide : centre x/z, largeur/profondeur, sommet et hauteur.
  function block(cx, cz, w, d, top, h = TOWER_DEPTH, matKey = 'stone', opts = {}) {
    const bottom = top - h;
    const radius = Math.min(opts.radius ?? 0.06, w / 2 - 0.01, d / 2 - 0.01, h / 2 - 0.01);
    const geo = new RoundedBoxGeometry(w, h, d, 2, radius);
    geo.translate(cx, bottom + h / 2, cz);
    shadeVertices(geo, top, bottom, opts.low ?? (h > 6 ? 0.62 : 0.86));
    addGeo(matKey, geo);
    if (opts.collide !== false) {
      physics.add([cx - w / 2, bottom, cz - d / 2], [cx + w / 2, top, cz + d / 2], { tag: opts.tag || matKey });
    }
    return { minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2, top };
  }

  function decoGeo(matKey, geo, color = 1) {
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3).fill(color);
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(pos.count * 2), 2));
    addGeo(matKey, geo);
  }

  function tree(x, y, z, scale = 1, kind = 'blossom') {
    const h = 2.6 * scale;
    const trunk = new THREE.CylinderGeometry(0.12 * scale, 0.2 * scale, h, 7);
    trunk.translate(x, y + h / 2, z);
    decoGeo('trunk', trunk);
    physics.add([x - 0.25 * scale, y, z - 0.25 * scale], [x + 0.25 * scale, y + h, z + 0.25 * scale], { tag: 'tree' });
    const puffs = 7 + Math.floor(rand() * 4);
    for (let i = 0; i < puffs; i++) {
      const r = (0.7 + rand() * 0.6) * scale;
      const g = new THREE.IcosahedronGeometry(r, 1);
      const a = rand() * Math.PI * 2;
      const dist = rand() * 1.1 * scale;
      g.translate(x + Math.cos(a) * dist, y + h + (rand() - 0.2) * 0.9 * scale, z + Math.sin(a) * dist);
      decoGeo(kind, g, 0.92 + rand() * 0.08);
    }
  }

  function lantern(x, y, z) {
    block(x, z, 0.16, 0.16, y + 1.5, 1.5, 'wood', { radius: 0.03, low: 1, tag: 'post' });
    const g = new RoundedBoxGeometry(0.34, 0.42, 0.34, 2, 0.06);
    g.translate(x, y + 1.72, z);
    decoGeo('glow', g);
    const cap = new RoundedBoxGeometry(0.44, 0.08, 0.44, 1, 0.02);
    cap.translate(x, y + 1.97, z);
    decoGeo('wood', cap);
  }

  function parapet(x1, z1, x2, z2, top, h = 0.6, t = 0.35) {
    const cx = (x1 + x2) / 2, cz = (z1 + z2) / 2;
    const w = Math.abs(x2 - x1) || t, d = Math.abs(z2 - z1) || t;
    block(cx, cz, w, d, top + h, h, 'plaster', { radius: 0.05, low: 0.92, tag: 'parapet' });
  }

  // ---------- A : terrasse du départ ----------
  block(0, 0, 14, 14, 0);
  parapet(-7, 7, 7, 7, 0);
  parapet(-7, -7, -7, 7, 0);
  parapet(7, -7, 7, 7, 0);
  parapet(-7, -7, -2.2, -7, 0);
  parapet(2.2, -7, 7, -7, 0);
  tree(-4.4, 0, 3.6, 1.0);
  block(4.2, 3.4, 2.4, 0.7, 0.45, 0.45, 'wood', { radius: 0.05, low: 1, tag: 'bench' });
  lantern(-2.2, 0, -6.4);
  lantern(2.2, 0, -6.4);
  block(-5, -4.5, 2.2, 2.2, 0.35, 0.35, 'stoneShade', { low: 1 });
  block(5.2, -3.8, 1.2, 1.2, 0.9, 0.9, 'plaster', { low: 1 });

  // ---------- B : premier saut, puis muret à enjamber ----------
  block(0, -13, 6, 6, 0.5);
  block(0, -17.5, 4.4, 3, 1.2, TOWER_DEPTH, 'stone');

  // ---------- D : grande terrasse avant le mur ----------
  block(-0.5, -25.5, 7, 13, 2.0);
  lantern(-3.6, 2.0, -21);
  tree(-2.6, 2.0, -28.5, 0.75, 'leaf');

  // ---------- Mur pour la course murale ----------
  block(3.4, -37, 0.8, 12, 7.0, 17, 'accent', { radius: 0.04, low: 0.9, tag: 'wallrun' });
  // Pilier d'appui de l'autre côté, pour la composition
  block(-4.6, -37, 1.4, 1.4, 5.5, TOWER_DEPTH, 'stoneShade');

  // ---------- E : terrasse de la pergola ----------
  block(-0.5, -48, 7, 12, 2.0);
  // Pergola basse : on glisse dessous
  const roofBottom = 3.25;
  block(-0.5, -48, 7.2, 3.2, roofBottom + 0.45, 0.45, 'wood', { radius: 0.05, low: 1, tag: 'pergola' });
  for (const [px, pz] of [[-3.85, -46.6], [2.85, -46.6], [-3.85, -49.4], [2.85, -49.4]]) {
    block(px, pz, 0.3, 0.3, roofBottom, roofBottom - 2.0, 'wood', { radius: 0.03, low: 1, tag: 'post' });
  }
  for (let i = 0; i < 9; i++) {
    const g = new THREE.IcosahedronGeometry(0.45 + rand() * 0.3, 1);
    g.translate(-3.8 + i * 0.85 + (rand() - 0.5) * 0.3, roofBottom + 0.65 + rand() * 0.2, -48 + (rand() - 0.5) * 2.2);
    decoGeo('blossom', g, 0.95);
  }
  lantern(2.4, 2.0, -43.2);

  // ---------- F : le mur d'escalade ----------
  block(-0.5, -57, 7, 6, 5.6);
  block(-0.5, -53.97, 3.2, 0.06, 5.3, 3.3, 'accent', { radius: 0.02, low: 1, collide: false });

  // ---------- G : pas japonais ----------
  const stones = [[0.8, -63], [-0.8, -69.4], [0.8, -75.8], [-0.8, -82.2]];
  for (const [sx, sz] of stones) block(sx, sz, 3, 3.6, 4.4);

  // ---------- H : le jardin de la cloche ----------
  const H_TOP = 3.6;
  block(0, -95.2, 18, 17.6, H_TOP);
  parapet(-9, -104, 9, -104, H_TOP);
  parapet(-9, -86.4, -9, -104, H_TOP);
  parapet(9, -86.4, 9, -104, H_TOP);
  parapet(-9, -86.4, -2.5, -86.4, H_TOP);
  parapet(2.5, -86.4, 9, -86.4, H_TOP);
  tree(-4.6, H_TOP, -93, 1.5);
  tree(6.2, H_TOP, -100.5, 0.9);
  // Bassin
  block(4.2, -92, 4.4, 5.4, H_TOP + 0.25, 0.25, 'plaster', { low: 1, tag: 'rim' });
  {
    const w = new THREE.BoxGeometry(3.8, 0.05, 4.8);
    w.translate(4.2, H_TOP + 0.27, -92);
    decoGeo('water', w);
  }
  lantern(-2.6, H_TOP, -87.2);
  lantern(2.6, H_TOP, -87.2);
  // Pavillon de la cloche
  for (const [px, pz] of [[-1.7, -98], [1.7, -98], [-1.7, -101.4], [1.7, -101.4]]) {
    block(px, pz, 0.32, 0.32, H_TOP + 3.2, 3.2, 'wood', { radius: 0.04, low: 1, tag: 'post' });
  }
  block(0, -99.7, 4.6, 4.4, H_TOP + 3.5, 0.3, 'plaster', { radius: 0.06, low: 1 });
  block(0, -99.7, 3.6, 3.4, H_TOP + 3.75, 0.25, 'plaster', { radius: 0.06, low: 1 });

  // ---------- Fusion des géométries par matériau ----------
  const meshes = [];
  for (const [key, geos] of groups) {
    const list = geos.map((g) => (g.index ? g.toNonIndexed() : g));
    for (const g of list) {
      if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    }
    const merged = mergeGeometries(list, false);
    const mat = materials[key].clone();
    mat.vertexColors = true;
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = key !== 'water' && key !== 'glow';
    mesh.receiveShadow = true;
    scene.add(mesh);
    meshes.push(mesh);
  }

  // ---------- Cloche ----------
  const bell = new THREE.Group();
  const bellBody = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.55, 0.9, 20, 1, true), new THREE.MeshStandardMaterial({ color: 0xe8b77a, metalness: 0.7, roughness: 0.3, side: THREE.DoubleSide, emissive: 0x6a3a10, emissiveIntensity: 0.3 }));
  bellBody.position.y = -0.45;
  bell.add(bellBody);
  const bellTop = new THREE.Mesh(new THREE.SphereGeometry(0.28, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), bellBody.material);
  bell.add(bellTop);
  bell.position.set(0, H_TOP + 3.0, -99.7);
  bellBody.castShadow = true;
  scene.add(bell);

  // ---------- Lueurs à collecter ----------
  const orbPositions = [
    [0, 1.8, -8.5],
    [0, 2.0, -17.5],
    [2.6, 4.0, -34], [2.6, 4.4, -37.5], [2.6, 4.0, -41],
    [-0.5, 2.6, -48],
    [-0.5, 6.5, -57],
    [0, 5.8, -66.2], [0, 5.8, -72.6], [0, 5.8, -79.0],
    [-4.0, 4.7, -90], [4.2, 4.5, -95.5],
  ];
  const orbGeo = new THREE.IcosahedronGeometry(0.16, 1);
  const haloTex = makeHaloTexture();
  const orbs = orbPositions.map((p, i) => {
    const g = new THREE.Group();
    const core = new THREE.Mesh(orbGeo, materials.glow);
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
    { name: 'A', min: [-7, -1, -7], max: [7, 2, 7], spawn: [0, 0, 4], yaw: 0 },
    { name: 'B', min: [-3, 0, -16], max: [3, 2, -10], spawn: [0, 0.5, -12], yaw: 0 },
    { name: 'D', min: [-4, 1.5, -32], max: [3, 4, -19], spawn: [-0.5, 2, -22], yaw: 0 },
    { name: 'E', min: [-4, 1.5, -54], max: [3, 4, -42], spawn: [-0.5, 2, -43.5], yaw: 0 },
    { name: 'F', min: [-4, 5, -60], max: [3, 8, -54], spawn: [-0.5, 5.6, -58.5], yaw: 0 },
    { name: 'H', min: [-9, 3, -104], max: [9, 7, -86.4], spawn: [0, H_TOP, -88.5], yaw: 0 },
  ];

  // ---------- Conseils ----------
  const hints = [
    { id: 'move', min: [-7, -1, -1], max: [7, 3, 7], text: 'Avance avec <kbd>Z</kbd><kbd>W</kbd>, regarde avec la souris' },
    { id: 'jump', min: [-3, -1, -7], max: [3, 3, -3], text: '<kbd>Espace</kbd> pour sauter' },
    { id: 'vault', min: [-3, 0, -16], max: [3, 3, -12], text: 'Cours vers un muret pour l’enjamber' },
    { id: 'wallrun', min: [-4, 1.5, -31], max: [3, 5, -26], text: 'Saute le long du mur corail pour courir dessus' },
    { id: 'slide', min: [-4, 1.5, -46], max: [3, 5, -42.5], text: '<kbd>Maj</kbd> ou <kbd>C</kbd> en courant pour glisser' },
    { id: 'climb', min: [-4, 1.5, -54], max: [3, 5, -50], text: 'Saute face au mur pour grimper' },
  ];

  const goal = { min: [-1.7, H_TOP - 0.5, -101.4], max: [1.7, H_TOP + 3, -98] };

  // ---------- Points de vue (captures, menu) ----------
  const viewpoints = {
    depart: { pos: [0, 1.62, 5.5], yaw: 0, pitch: -0.04 },
    panorama: { pos: [-15, 10, -28], yaw: -0.62, pitch: -0.27 },
    mur: { pos: [1.2, 3.62, -27.5], yaw: -0.16, pitch: 0.02 },
    pergola: { pos: [-0.5, 3.62, -43], yaw: 0, pitch: -0.06 },
    jardin: { pos: [0, 5.22, -88], yaw: 0, pitch: -0.05 },
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
    { p: [0, H_TOP, -99.7], r: 0.5 },
  ];

  let time = 0;
  function update(dt) {
    time += dt;
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
