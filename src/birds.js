import * as THREE from 'three';

// Un vol d'oiseaux lointains pour le plan du soleil levant (titre et fin) :
// quelques silhouettes qui planent en larges boucles au-dessus de la mer de nuages,
// battent des ailes un instant, puis se laissent porter. Un seul appel de dessin,
// aucune allocation par image, et rien n'est visible pendant le jeu.

const COUNT = 9;

function birdGeometry() {
  // Deux ailes légèrement coudées ; aSpan vaut 0 au corps et 1 au bout de l'aile.
  const pos = [];
  const span = [];
  const wing = (s) => {
    const v = [
      [0, 0, -0.16, 0], [0, 0, 0.22, 0], [s * 0.42, 0.02, 0.02, 0.45],
      [s * 0.42, 0.02, 0.02, 0.45], [0, 0, 0.22, 0], [s * 0.46, 0.02, 0.2, 0.5],
      [s * 0.42, 0.02, 0.02, 0.45], [s * 0.46, 0.02, 0.2, 0.5], [s * 0.9, -0.02, 0.26, 1],
    ];
    for (const [x, y, z, k] of v) {
      pos.push(x, y, z);
      span.push(k);
    }
  };
  wing(1);
  wing(-1);
  // Petit corps et queue
  for (const [x, y, z] of [[-0.05, 0, -0.26], [0.05, 0, -0.26], [0, 0, 0.42]]) {
    pos.push(x, y, z);
    span.push(0);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aSpan', new THREE.Float32BufferAttribute(span, 1));
  return g;
}

export class Birds {
  constructor(scene) {
    const geo = birdGeometry();
    const phase = new Float32Array(COUNT);
    for (let i = 0; i < COUNT; i++) phase[i] = i * 2.399;
    geo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phase, 1));

    this.uniforms = { uTime: { value: 0 } };
    const mat = new THREE.MeshBasicMaterial({ color: 0x55476d, side: THREE.DoubleSide, fog: true });
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.uniforms.uTime;
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
          uniform float uTime;
          attribute float aSpan;
          attribute float aPhase;`,
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          {
            // Battements par séries, puis vol plané : les ailes restent un peu relevées.
            float burst = smoothstep(0.15, 0.65, sin(uTime * 0.37 + aPhase * 1.7));
            float flap = sin(uTime * 7.0 + aPhase * 3.1) * burst;
            transformed.y += (flap * 0.42 + 0.1) * aSpan * aSpan * 1.2;
            transformed.x *= 1.0 - abs(flap) * 0.12 * aSpan;
          }`,
        );
    };
    this.material = mat;

    const mesh = new THREE.InstancedMesh(geo, mat, COUNT);
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.visible = false;
    mesh.renderOrder = 5;
    scene.add(mesh);
    this.mesh = mesh;

    // Place de chaque oiseau dans le vol (un V lâche), et une petite errance propre.
    this.slots = [];
    for (let i = 0; i < COUNT; i++) {
      const side = i === 0 ? 0 : i % 2 ? 1 : -1;
      const rank = Math.ceil(i / 2);
      this.slots.push({ x: side * rank * 1.9, z: rank * 1.7, y: (i % 3) * 0.4, w: 0.6 + (i % 4) * 0.21, s: 1.55 + (i % 3) * 0.16 });
    }
    this.time = 0;
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler(0, 0, 0, 'YXZ');
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3();
  }

  setVisible(v) {
    this.mesh.visible = v;
  }

  // anchor : position du plan (pos), et son cap (yaw) ; le vol tourne devant lui.
  update(dt, shot) {
    this.mesh.visible = true;
    this.time += dt;
    this.uniforms.uTime.value = this.time;
    const t = this.time;
    const sy = Math.sin(shot.yaw), cy = Math.cos(shot.yaw);
    const fx = -sy, fz = -cy; // devant
    const rx = cy, rz = -sy; // à droite
    // Centre de la boucle : loin devant, un peu au-dessus de l'horizon.
    const cx = shot.pos[0] + fx * 72, cz = shot.pos[2] + fz * 72, cyy = shot.pos[1] + 13;
    const w = (Math.PI * 2) / 95; // un tour en un peu plus d'une minute et demie
    const a = t * w + 2.2;
    // Grande ellipse : de gauche à droite, en s'éloignant puis en revenant.
    const lx = Math.cos(a) * 42, lz = Math.sin(a) * 16;
    const vx = -Math.sin(a) * 42, vz = Math.cos(a) * 16; // tangente (dérivée)
    const px = cx + rx * lx + fx * lz;
    const pz = cz + rz * lx + fz * lz;
    const dirx = rx * vx + fx * vz, dirz = rz * vx + fz * vz;
    const heading = Math.atan2(-dirx, -dirz);
    const bank = -Math.cos(a) * 0.22; // s'incline dans le virage
    const hx = -Math.sin(heading), hz = -Math.cos(heading); // avant du vol
    const qx = Math.cos(heading), qz = -Math.sin(heading); // droite du vol
    for (let i = 0; i < COUNT; i++) {
      const s = this.slots[i];
      const wob = Math.sin(t * s.w + i) * 0.6;
      const ox = s.x + wob, oz = s.z + Math.cos(t * s.w * 0.8 + i * 1.3) * 0.7;
      const oy = s.y + Math.sin(t * s.w * 1.3 + i * 2.1) * 0.5 + Math.sin(a * 2) * 2.5;
      this._p.set(px + qx * ox - hx * oz, cyy + oy, pz + qz * ox - hz * oz);
      this._e.set(Math.sin(t * 0.5 + i) * 0.05, heading, bank + wob * 0.04);
      this._q.setFromEuler(this._e);
      this._s.setScalar(s.s);
      this._m.compose(this._p, this._q, this._s);
      this.mesh.setMatrixAt(i, this._m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
