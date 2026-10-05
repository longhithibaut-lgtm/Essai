import * as THREE from 'three';

// Ciel, lumière, mer de nuages, tours lointaines et pollen.

export const SKY = {
  zenith: new THREE.Color(0x8ea5d8),
  upper: new THREE.Color(0xc7b6e0),
  horizon: new THREE.Color(0xffd6bd),
  sun: new THREE.Color(0xfff1da),
  fog: new THREE.Color(0xf1d8cc),
  sunDir: new THREE.Vector3(-0.85, 0.32, -0.42).normalize(),
};

// Générateur pseudo-aléatoire déterministe (captures reproductibles).
export function rng(seed = 1) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NOISE_GLSL = /* glsl */ `
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; }
    return v;
  }
`;

export class World {
  constructor(scene) {
    this.scene = scene;
    this.time = 0;
    scene.fog = new THREE.FogExp2(SKY.fog, 0.0062);
    scene.background = SKY.fog.clone();

    this._sky();
    this._lights();
    this._clouds();
    this._distantTowers();
    this._pollen();
  }

  _sky() {
    const geo = new THREE.SphereGeometry(1200, 48, 24);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        uZenith: { value: SKY.zenith },
        uUpper: { value: SKY.upper },
        uHorizon: { value: SKY.horizon },
        uSun: { value: SKY.sun },
        uSunDir: { value: SKY.sunDir },
        uTime: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_Position = p.xyww;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uZenith, uUpper, uHorizon, uSun, uSunDir;
        uniform float uTime;
        varying vec3 vDir;
        ${NOISE_GLSL}
        void main() {
          vec3 d = normalize(vDir);
          float h = d.y;
          vec3 col = mix(uHorizon, uUpper, smoothstep(0.0, 0.25, h));
          col = mix(col, uZenith, smoothstep(0.2, 0.75, h));
          col = mix(col, uHorizon * 0.98, smoothstep(0.0, -0.2, h));
          float s = max(dot(d, uSunDir), 0.0);
          col += uSun * (pow(s, 6.0) * 0.35 + pow(s, 64.0) * 0.6);
          col += vec3(1.0, 0.97, 0.9) * smoothstep(0.9993, 0.9997, s) * 3.0;
          // Fins nuages élevés
          vec2 uv = d.xz / max(d.y + 0.15, 0.05);
          float n = fbm(uv * 0.9 + vec2(uTime * 0.004, 0.0));
          float cl = smoothstep(0.55, 0.85, n) * smoothstep(0.03, 0.3, h) * (1.0 - smoothstep(0.5, 0.9, h));
          col = mix(col, mix(vec3(1.0, 0.93, 0.9), uSun, pow(s, 3.0)), cl * 0.55);
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    });
    this.skyMat = mat;
    const sky = new THREE.Mesh(geo, mat);
    sky.frustumCulled = false;
    sky.renderOrder = -1;
    this.sky = sky;
    this.scene.add(sky);
  }

  _lights() {
    const hemi = new THREE.HemisphereLight(0xc9d6ff, 0xf4c9b0, 1.15);
    this.scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xffe4c8, 2.6);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = -38; sc.right = 38; sc.top = 38; sc.bottom = -38;
    sc.near = 1; sc.far = 220;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.03;
    sun.shadow.radius = 3;
    this.scene.add(sun);
    this.scene.add(sun.target);
    this.sun = sun;
  }

  _clouds() {
    const geo = new THREE.PlaneGeometry(3000, 3000, 1, 1);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.ShaderMaterial({
      fog: false,
      uniforms: {
        uTime: { value: 0 },
        uSunDir: { value: SKY.sunDir },
        uFog: { value: SKY.fog },
        uLit: { value: new THREE.Color(0xfff5ee) },
        uShade: { value: new THREE.Color(0xd8c3d8) },
        uCam: { value: new THREE.Vector3() },
      },
      vertexShader: /* glsl */ `
        varying vec3 vWorld;
        void main() {
          vec4 w = modelMatrix * vec4(position, 1.0);
          vWorld = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform vec3 uSunDir, uFog, uLit, uShade, uCam;
        varying vec3 vWorld;
        ${NOISE_GLSL}
        void main() {
          vec2 p = vWorld.xz * 0.012 + vec2(uTime * 0.01, uTime * 0.004);
          float n = fbm(p);
          float n2 = fbm(p + vec2(0.03, 0.02));
          float light = clamp(0.55 + (n - n2) * 14.0 * dot(normalize(uSunDir.xz), vec2(1.0, 0.6)), 0.0, 1.0);
          vec3 col = mix(uShade, uLit, smoothstep(0.3, 0.75, n) * 0.6 + light * 0.4);
          float dist = length(vWorld - uCam);
          float f = 1.0 - exp(-pow(dist * 0.0028, 1.4));
          col = mix(col, uFog, clamp(f, 0.0, 1.0));
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    });
    this.cloudMat = mat;
    const clouds = new THREE.Mesh(geo, mat);
    clouds.position.y = -22;
    clouds.frustumCulled = false;
    this.clouds = clouds;
    this.scene.add(clouds);
  }

  _distantTowers() {
    const rand = rng(7);
    const count = 90;
    const geo = new THREE.BoxGeometry(1, 1, 1);
    geo.translate(0, 0.5, 0);
    const mat = new THREE.MeshStandardMaterial({ color: 0xf1e8e2, roughness: 0.9 });
    const mesh = new THREE.InstancedMesh(geo, mat, count);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    for (let i = 0; i < count; i++) {
      const a = rand() * Math.PI * 2;
      const r = 90 + rand() * 360;
      const x = Math.cos(a) * r, z = Math.sin(a) * r - 60;
      const w = 4 + rand() * 12, d = 4 + rand() * 12;
      const top = -8 + rand() * 40;
      const h = top + 40;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), (rand() - 0.5) * 0.2);
      m.compose(new THREE.Vector3(x, -40, z), q, new THREE.Vector3(w, h, d));
      mesh.setMatrixAt(i, m);
    }
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    this.scene.add(mesh);
  }

  _pollen() {
    const count = 700;
    const pos = new Float32Array(count * 3);
    const seed = new Float32Array(count);
    const rand = rng(3);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (rand() - 0.5) * 60;
      pos[i * 3 + 1] = (rand() - 0.5) * 30;
      pos[i * 3 + 2] = (rand() - 0.5) * 60;
      seed[i] = rand() * 100;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uCam: { value: new THREE.Vector3() },
        uSize: { value: 26 },
      },
      vertexShader: /* glsl */ `
        attribute float seed;
        uniform float uTime, uSize;
        uniform vec3 uCam;
        varying float vAlpha;
        void main() {
          vec3 p = position;
          p.x += sin(uTime * 0.21 + seed) * 1.5 + uTime * 0.25;
          p.y += sin(uTime * 0.17 + seed * 1.7) * 1.2;
          p.z += cos(uTime * 0.19 + seed * 0.7) * 1.5;
          // Enroule autour de la caméra
          vec3 size = vec3(60.0, 30.0, 60.0);
          p = uCam + mod(p - uCam + size * 0.5, size) - size * 0.5;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          float d = -mv.z;
          gl_PointSize = uSize * (0.6 + 0.4 * sin(seed)) / d;
          vAlpha = smoothstep(0.5, 3.0, d) * (1.0 - smoothstep(18.0, 30.0, d)) * (0.5 + 0.5 * sin(uTime * 0.8 + seed * 3.0));
        }
      `,
      fragmentShader: /* glsl */ `
        varying float vAlpha;
        void main() {
          float r = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.0, r);
          gl_FragColor = vec4(vec3(1.0, 0.92, 0.78) * a * vAlpha * 0.55, 1.0);
        }
      `,
    });
    this.pollenMat = mat;
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    this.scene.add(pts);
  }

  update(dt, camera, focus) {
    this.time += dt;
    this.sky.position.copy(camera.position);
    this.skyMat.uniforms.uTime.value = this.time;
    this.cloudMat.uniforms.uTime.value = this.time;
    this.cloudMat.uniforms.uCam.value.copy(camera.position);
    this.clouds.position.x = camera.position.x;
    this.clouds.position.z = camera.position.z;
    this.pollenMat.uniforms.uTime.value = this.time;
    this.pollenMat.uniforms.uCam.value.copy(camera.position);

    // L'ombre suit le joueur, par pas réguliers pour éviter le scintillement.
    const snap = 2;
    const fx = Math.round(focus.x / snap) * snap;
    const fy = Math.round(focus.y / snap) * snap;
    const fz = Math.round(focus.z / snap) * snap;
    this.sun.target.position.set(fx, fy, fz);
    this.sun.position.set(fx + SKY.sunDir.x * 90, fy + SKY.sunDir.y * 90, fz + SKY.sunDir.z * 90);
  }
}
