import * as THREE from 'three';

// Filets d'air : quelques traits de lumière très pâles, posés dans le monde, que l'on
// traverse quand on va vite (course murale surtout, longues chutes, glissade lancée).
// Ils donnent la vitesse sans rien brusquer : fins, transparents, toujours sur les bords de
// l'image, jamais devant le regard. Un seul appel de dessin, aucune allocation par image.

const COUNT = 56;
const VERT = /* glsl */ `
  attribute vec2 corner; // x : 0 tête, 1 queue ; y : -1 / 1 de part et d'autre
  attribute float alpha;
  varying vec2 vC;
  varying float vA;
  void main() {
    vC = corner;
    vA = alpha;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying vec2 vC;
  varying float vA;
  void main() {
    // Tête un peu plus vive, queue qui s'efface ; bords doux.
    float along = smoothstep(0.0, 0.12, vC.x) * pow(1.0 - vC.x, 1.6);
    float across = 1.0 - vC.y * vC.y;
    float a = along * across * vA * uOpacity;
    if (a < 0.003) discard;
    gl_FragColor = vec4(uColor * a, a);
  }
`;

function rand(seed) {
  // Petit générateur déterministe (pas d'aléa différent d'une capture à l'autre).
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export class WindStreaks {
  constructor(scene) {
    this.rng = rand(7);
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(COUNT * 4 * 3);
    const corner = new Float32Array(COUNT * 4 * 2);
    this.alphaArr = new Float32Array(COUNT * 4);
    const idx = new Uint16Array(COUNT * 6);
    for (let i = 0; i < COUNT; i++) {
      const c = i * 8;
      corner.set([0, -1, 0, 1, 1, -1, 1, 1], c);
      const v = i * 4;
      idx.set([v, v + 2, v + 1, v + 1, v + 2, v + 3], i * 6);
    }
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('corner', new THREE.BufferAttribute(corner, 2));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.alphaArr, 1).setUsage(THREE.DynamicDrawUsage));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    this.geometry = g;
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uColor: { value: new THREE.Color(3.0, 2.85, 2.65) }, uOpacity: { value: 0 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      fog: false,
    });
    const mesh = new THREE.Mesh(g, this.material);
    mesh.frustumCulled = false;
    mesh.renderOrder = 2;
    mesh.visible = false;
    scene.add(mesh);
    this.mesh = mesh;

    // Chaque filet : point de tête (monde), longueur, largeur, éclat.
    this.p = [];
    for (let i = 0; i < COUNT; i++) this.p.push({ x: 0, y: 0, z: 0, len: 0.5, w: 0.006, a: 0, alive: false });
    this.intensity = 0;
    // Course murale : mur à longer (voir setWall), ou null.
    this.wall = null;
    this._wall = { x: 0, z: 0, dist: 0 };
    this.dir = new THREE.Vector3(0, 0, -1);
    this._v = new THREE.Vector3();
    this._s = new THREE.Vector3();
    this._t = new THREE.Vector3();
  }

  reset() {
    for (const s of this.p) s.alive = false;
    this.intensity = 0;
    this.material.uniforms.uOpacity.value = 0;
  }

  // Place un filet devant, autour de l'axe de la course, hors du centre de l'image.
  _spawn(s, cam, vx, vy, vz, speed, initial) {
    const r = this.rng;
    const ux = vx / speed, uy = vy / speed, uz = vz / speed;
    // Base orthonormée autour de la direction de la course.
    let ax = -uz, ay = 0, az = ux;
    let al = Math.hypot(ax, az);
    if (al < 1e-3) { ax = 1; az = 0; al = 1; }
    ax /= al; az /= al;
    const bx = uy * az - uz * ay, by = uz * ax - ux * az, bz = ux * ay - uy * ax;
    const ang = r() * Math.PI * 2;
    const rad = 0.7 + r() * 1.7;
    const ahead = initial ? r() * 7 - 1 : 4 + r() * 4;
    const ca = Math.cos(ang) * rad, sa = Math.sin(ang) * rad;
    s.x = cam.x + ux * ahead + ax * ca + bx * sa;
    s.y = cam.y + uy * ahead + ay * ca + by * sa;
    s.z = cam.z + uz * ahead + az * ca + bz * sa;
    const wall = this.wall;
    let onWall = false;
    if (wall && r() < 0.7) {
      // Course murale : la plupart des filets glissent au ras de la paroi, au-dessus ou en dessous
      // du regard : le mur, même lisse, défile alors sous les yeux.
      const v = r() < 0.65 ? -(0.45 + r() * 1.0) : 0.5 + r() * 0.8;
      const near = initial ? r() * 6 : 1.5 + r() * 4.5;
      const off = wall.dist - 0.03 - r() * 0.05;
      s.x = cam.x + ux * near + wall.x * off;
      s.y = cam.y + uy * near + v;
      s.z = cam.z + uz * near + wall.z * off;
      onWall = true;
    }
    s.len = (0.9 + r() * 1.1) * (onWall ? 1.3 : 1);
    s.w = (0.016 + r() * 0.016) * (onWall ? 1.4 : 1);
    s.a = Math.min(1, 0.4 + r() * 0.6 + (onWall ? 0.25 : 0));
    s.alive = true;
  }

  // Course murale : direction horizontale (monde) vers le mur et distance de l'œil au mur ;
  // dist <= 0 pour revenir à une répartition autour de la course.
  setWall(x, z, dist) {
    if (dist <= 0) this.wall = null;
    else {
      this._wall.x = x;
      this._wall.z = z;
      this._wall.dist = dist;
      this.wall = this._wall;
    }
  }

  update(dt, cam, vel, target) {
    this.intensity += (target - this.intensity) * (1 - Math.exp(-(target > this.intensity ? 4 : 2.5) * dt));
    const op = this.intensity;
    this.material.uniforms.uOpacity.value = op * 0.62;
    this.on = op > 0.02;
    if (!this.on) {
      for (const s of this.p) s.alive = false;
      return;
    }
    const speed = Math.hypot(vel.x, vel.y, vel.z);
    if (speed < 0.5) return;
    const ux = vel.x / speed, uy = vel.y / speed, uz = vel.z / speed;
    const pos = this.pos;
    for (let i = 0; i < COUNT; i++) {
      const s = this.p[i];
      if (!s.alive) this._spawn(s, cam, vel.x, vel.y, vel.z, speed, true);
      // Derrière l'œil ou trop loin : on le replace devant.
      const dx = s.x - cam.x, dy = s.y - cam.y, dz = s.z - cam.z;
      const along = dx * ux + dy * uy + dz * uz;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (along < -1.2 || d2 > 120) this._spawn(s, cam, vel.x, vel.y, vel.z, speed, false);
      // Le trait suit la direction de la course (la queue derrière la tête).
      const len = s.len * Math.min(1.7, speed / 7);
      const hx = s.x, hy = s.y, hz = s.z;
      const tx = hx - ux * len, ty = hy - uy * len, tz = hz - uz * len;
      // Largeur tournée vers la caméra.
      const vx = cam.x - hx, vy = cam.y - hy, vz = cam.z - hz;
      let sx = uy * vz - uz * vy, sy = uz * vx - ux * vz, sz = ux * vy - uy * vx;
      const sl = Math.hypot(sx, sy, sz) || 1;
      sx *= s.w / sl; sy *= s.w / sl; sz *= s.w / sl;
      // Trop près de l'axe du regard ou de l'œil : il s'efface.
      const dist = Math.sqrt(d2);
      const lateral = Math.sqrt(Math.max(0, d2 - along * along));
      const fade = Math.min(1, Math.max(0, (lateral - 0.55) / 0.4)) * Math.min(1, Math.max(0, (9 - dist) / 3)) * Math.min(1, Math.max(0, (dist - 0.4) / 0.6));
      const o = i * 12;
      pos[o] = hx - sx; pos[o + 1] = hy - sy; pos[o + 2] = hz - sz;
      pos[o + 3] = hx + sx; pos[o + 4] = hy + sy; pos[o + 5] = hz + sz;
      pos[o + 6] = tx - sx; pos[o + 7] = ty - sy; pos[o + 8] = tz - sz;
      pos[o + 9] = tx + sx; pos[o + 10] = ty + sy; pos[o + 11] = tz + sz;
      const a = s.a * fade;
      const k = i * 4;
      this.alphaArr[k] = this.alphaArr[k + 1] = this.alphaArr[k + 2] = this.alphaArr[k + 3] = a;
    }
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.alpha.needsUpdate = true;
  }
}

// Souffle de vitesse : de longs traits très pâles qui filent depuis le point vers lequel on
// court, seulement sur le pourtour de l'image (jamais au centre du regard). Il joue le rôle
// du flou de mouvement des jeux de course, en plus doux : on le sent surtout en course
// murale et dans les longues chutes. Un seul quad plein écran, un seul appel de dessin.
const FLOW_VERT = /* glsl */ `
  varying vec2 vP;
  void main() {
    vP = position.xy;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;
const FLOW_FRAG = /* glsl */ `
  uniform float uTime, uI, uAspect;
  uniform vec2 uC, uWall;
  uniform vec3 uColor;
  varying vec2 vP;
  float h1(float n) { return fract(sin(n * 127.1) * 43758.5453); }
  void main() {
    vec2 d = (vP - uC) * vec2(uAspect, 1.0);
    float r = length(d);
    float mask = smoothstep(0.68, 1.3, r);
    if (mask * uI < 0.003) discard;
    float u = atan(d.y, d.x) / 6.2831853 + 0.5;
    float N = 84.0;
    float idx = floor(u * N);
    float fa = fract(u * N);
    float ra = h1(idx), rb = h1(idx + 31.7), rc = h1(idx + 63.1);
    float on = step(0.42, ra);
    float line = 1.0 - smoothstep(0.0, 0.11 + 0.1 * rb, abs(fa - 0.5));
    float s = r * (0.9 + 0.8 * rb) - uTime * (1.6 + 1.4 * rc) + ra * 7.0;
    float f = fract(s);
    float dash = smoothstep(0.0, 0.12, f) * (1.0 - smoothstep(0.35, 0.75, f));
    // Plus dense du côté du mur (course murale).
    float side = 1.0 + uWall.y * (d.x * uWall.x > 0.0 ? 1.0 : -0.6);
    float a = uI * on * line * dash * mask * side * 0.13;
    if (a < 0.002) discard;
    gl_FragColor = vec4(uColor * a, a);
  }
`;

export class SpeedFlow {
  constructor(scene) {
    const g = new THREE.PlaneGeometry(2, 2);
    this.material = new THREE.ShaderMaterial({
      vertexShader: FLOW_VERT,
      fragmentShader: FLOW_FRAG,
      uniforms: {
        uTime: { value: 0 },
        uI: { value: 0 },
        uAspect: { value: 16 / 9 },
        uC: { value: new THREE.Vector2() },
        uWall: { value: new THREE.Vector2() },
        uColor: { value: new THREE.Color(2.6, 2.5, 2.3) },
      },
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      fog: false,
    });
    const mesh = new THREE.Mesh(g, this.material);
    mesh.frustumCulled = false;
    mesh.renderOrder = 10;
    mesh.visible = false;
    scene.add(mesh);
    this.mesh = mesh;
    this.intensity = 0;
    this.time = 0;
    this.on = false;
    this._v = new THREE.Vector3();
  }

  reset() {
    this.intensity = 0;
    this.material.uniforms.uI.value = 0;
    this.on = false;
  }

  // vel : vitesse (monde) ; target : 0..1 ; wallSide : -1/0/1 (mur à gauche ou à droite de l'image).
  update(dt, camera, vel, target, wallSide) {
    this.intensity += (target - this.intensity) * (1 - Math.exp(-(target > this.intensity ? 6 : 2.2) * dt));
    const u = this.material.uniforms;
    this.on = this.intensity > 0.02;
    u.uI.value = this.intensity;
    if (!this.on) return;
    const speed = Math.hypot(vel.x, vel.y, vel.z);
    this.time += dt * Math.min(1.6, speed / 7);
    u.uTime.value = this.time;
    u.uAspect.value = camera.aspect || 16 / 9;
    // Point de fuite : la direction de la course projetée à l'écran (bornée au centre).
    const p = this._v.copy(vel).multiplyScalar(speed > 0.1 ? 10 / speed : 0).add(camera.position).project(camera);
    const ok = p.z < 1 && p.z > -1;
    u.uC.value.set(ok ? THREE.MathUtils.clamp(p.x, -0.45, 0.45) : 0, ok ? THREE.MathUtils.clamp(p.y, -0.35, 0.35) : 0);
    u.uWall.value.set(wallSide, wallSide !== 0 ? 0.6 : 0);
  }
}
