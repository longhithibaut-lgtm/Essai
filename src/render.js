import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

// Rendu d'Aube : scène en HDR (MSAA 4x) avec texture de profondeur, puis
//  - occlusion ambiante (SAO) à demi-résolution, floutée en respectant la profondeur ;
//    elle n'assombrit que la part de lumière indirecte, que les matériaux écrivent
//    dans l'alpha (voir atmosphere.js) : recoins creusés, plein soleil intact,
//  - rais de lumière à demi-résolution quand le soleil est dans le champ,
//  - halo doux (bloom « dual filter » sur 6 niveaux),
//  - moyenne locale à 1/8 pour un contraste local (« clarté ») discret,
//  - une passe finale : occlusion, halo, rais, clarté, courbe de Lottes, étalonnage
//    ombres lavande / lumières dorées, vignette, grain.
// Peu de passes plein écran : seule la scène et la passe finale sont en pleine résolution.

const VS = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const BAYER = /* glsl */ `
  float bayer2(vec2 a) { a = floor(a); return fract(dot(a, vec2(0.5, a.y * 0.75))); }
  float bayer4(vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }
`;

function mat(fragmentShader, uniforms, extra = {}) {
  return new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader, uniforms, depthTest: false, depthWrite: false, ...extra });
}

// ---------- Occlusion ambiante (Scalable Ambient Obscurance) ----------
const AO_FS = /* glsl */ `
  uniform sampler2D tDepth;
  uniform mat4 uProjInv;
  uniform vec2 uTexel;     // texel pleine résolution
  uniform float uRadius, uIntensity, uBias, uProjScale;
  varying vec2 vUv;
  ${BAYER}
  #define NS 12
  vec3 viewPos(vec2 uv, float d) {
    vec4 v = uProjInv * vec4(vec3(uv, d) * 2.0 - 1.0, 1.0);
    return v.xyz / v.w;
  }
  void main() {
    float d = texture2D(tDepth, vUv).x;
    if (d >= 0.99999) { gl_FragColor = vec4(1.0, 0.0, 0.0, 1.0); return; }
    vec3 P = viewPos(vUv, d);
    // Normale reconstruite en choisissant le voisin le plus cohérent sur chaque axe.
    vec2 ox = vec2(uTexel.x * 2.0, 0.0), oy = vec2(0.0, uTexel.y * 2.0);
    vec3 pr = viewPos(vUv + ox, texture2D(tDepth, vUv + ox).x);
    vec3 pl = viewPos(vUv - ox, texture2D(tDepth, vUv - ox).x);
    vec3 pu = viewPos(vUv + oy, texture2D(tDepth, vUv + oy).x);
    vec3 pd = viewPos(vUv - oy, texture2D(tDepth, vUv - oy).x);
    vec3 dx = abs(pr.z - P.z) < abs(P.z - pl.z) ? pr - P : P - pl;
    vec3 dy = abs(pu.z - P.z) < abs(P.z - pd.z) ? pu - P : P - pd;
    vec3 N = normalize(cross(dx, dy));

    float z = -P.z;
    float ssR = min(uProjScale * uRadius / z, 110.0);
    float ao = 1.0;
    if (ssR > 1.0 && z < 110.0) {
      float rnd = bayer4(gl_FragCoord.xy) + 0.03125;
      float r2 = uRadius * uRadius;
      float sum = 0.0;
      for (int i = 0; i < NS; i++) {
        float alpha = (float(i) + 0.5) / float(NS);
        float ang = alpha * 43.98 + rnd * 6.2831853; // 7 tours
        vec2 suv = vUv + vec2(cos(ang), sin(ang)) * (alpha * ssR) * uTexel;
        vec3 Q = viewPos(suv, texture2D(tDepth, suv).x);
        vec3 v = Q - P;
        float vv = dot(v, v);
        float vn = dot(v, N);
        float f = max(r2 - vv, 0.0);
        sum += f * f * f * max((vn - uBias * z * 0.02 - 0.01) / (0.02 + vv), 0.0);
      }
      // Réponse douce : les recoins se creusent sans jamais virer au noir.
      ao = mix(0.42, 1.0, exp(-sum * uIntensity * 5.0 / (r2 * r2 * r2 * float(NS))));
      ao = mix(ao, 1.0, smoothstep(60.0, 110.0, z));
    }
    gl_FragColor = vec4(ao, z, 0.0, 1.0);
  }
`;

// Flou 4x4 qui respecte la profondeur (annule exactement le motif de rotation 4x4).
const AO_BLUR_FS = /* glsl */ `
  uniform sampler2D tAO;
  uniform vec2 uTexel; // texel demi-résolution
  varying vec2 vUv;
  void main() {
    vec2 c = texture2D(tAO, vUv).rg;
    if (c.g <= 0.0) { gl_FragColor = vec4(1.0, 0.0, 0.0, 1.0); return; }
    float sum = 0.0, wsum = 0.0;
    for (int y = -2; y <= 1; y++) {
      for (int x = -2; x <= 1; x++) {
        vec2 s = texture2D(tAO, vUv + vec2(float(x), float(y)) * uTexel).rg;
        float w = s.g > 0.0 ? max(0.0, 1.0 - abs(s.g - c.g) / (0.12 * c.g + 0.1)) : 0.0;
        sum += s.r * w;
        wsum += w;
      }
    }
    gl_FragColor = vec4(wsum > 0.0 ? sum / wsum : c.r, c.g, 0.0, 1.0);
  }
`;

// ---------- Rais de lumière ----------
const RAYS_FS = /* glsl */ `
  uniform sampler2D tDepth;
  uniform vec2 uSun;
  uniform float uAspect;
  varying vec2 vUv;
  ${BAYER}
  #define NR 36
  void main() {
    vec2 delta = (uSun - vUv) / float(NR) * 0.92;
    float jitter = bayer4(gl_FragCoord.xy);
    vec2 p = vUv + delta * jitter;
    float acc = 0.0, w = 1.0;
    for (int i = 0; i < NR; i++) {
      p += delta;
      vec2 inside = step(vec2(0.0), p) * step(p, vec2(1.0));
      float sky = step(0.99999, texture2D(tDepth, p).x) * inside.x * inside.y;
      vec2 ds = (p - uSun) * vec2(uAspect, 1.0);
      sky *= exp(-dot(ds, ds) * 11.0);
      acc += sky * w;
      w *= 0.975;
    }
    acc /= float(NR);
    gl_FragColor = vec4(vec3(acc), 1.0);
  }
`;

// ---------- Halo (bloom dual filter) ----------
const DOWN_FS = /* glsl */ `
  uniform sampler2D tSrc;
  uniform vec2 uTexel; // texel de la source
  uniform float uThreshold, uKnee, uFirst;
  varying vec2 vUv;
  vec3 s(vec2 o) { return texture2D(tSrc, vUv + o * uTexel).rgb; }
  void main() {
    vec3 a = s(vec2(-2.0, -2.0)), b = s(vec2(0.0, -2.0)), c = s(vec2(2.0, -2.0));
    vec3 d = s(vec2(-1.0, -1.0)), e = s(vec2(1.0, -1.0));
    vec3 f = s(vec2(-2.0, 0.0)), g = s(vec2(0.0, 0.0)), h = s(vec2(2.0, 0.0));
    vec3 i = s(vec2(-1.0, 1.0)), j = s(vec2(1.0, 1.0));
    vec3 k = s(vec2(-2.0, 2.0)), l = s(vec2(0.0, 2.0)), m = s(vec2(2.0, 2.0));
    vec3 col = (d + e + i + j) * 0.125 + (a + b + f + g) * 0.03125 + (b + c + g + h) * 0.03125 + (f + g + k + l) * 0.03125 + (g + h + l + m) * 0.03125;
    if (uFirst > 0.5) {
      col = min(col, vec3(40.0));
      float br = max(col.r, max(col.g, col.b));
      float soft = clamp(br - uThreshold + uKnee, 0.0, 2.0 * uKnee);
      soft = soft * soft / (4.0 * uKnee + 1e-4);
      col *= max(soft, br - uThreshold) / max(br, 1e-4);
    }
    gl_FragColor = vec4(col, 1.0);
  }
`;

const UP_FS = /* glsl */ `
  uniform sampler2D tSrc;
  uniform vec2 uTexel;
  uniform float uWeight;
  varying vec2 vUv;
  vec3 s(vec2 o) { return texture2D(tSrc, vUv + o * uTexel).rgb; }
  void main() {
    vec3 col = s(vec2(-1.0, -1.0)) + s(vec2(1.0, -1.0)) + s(vec2(-1.0, 1.0)) + s(vec2(1.0, 1.0));
    col += 2.0 * (s(vec2(0.0, -1.0)) + s(vec2(-1.0, 0.0)) + s(vec2(1.0, 0.0)) + s(vec2(0.0, 1.0)));
    col += 4.0 * s(vec2(0.0));
    gl_FragColor = vec4(col / 16.0 * uWeight, 1.0);
  }
`;

// ---------- Passe finale ----------
const FINAL_FS = /* glsl */ `
  uniform sampler2D tColor, tAO, tBloom, tRays, tLocal;
  uniform float uClarity;
  uniform float uBloom, uExposure, uAO, uVignette, uFade, uTime, uRays;
  uniform vec3 uFadeColor, uSunColor;
  uniform vec3 uAOTint;
  uniform vec3 uShadowTint, uHighTint, uFilmBase;
  uniform float uSat, uDebug;
  varying vec2 vUv;

  // Courbe de tonalité (Lottes 2016) : pied doux qui creuse les ombres sans les
  // boucher, épaule longue qui garde le détail des faces au soleil.
  uniform vec4 uCurve; // contraste a, a*d, b, c
  uniform float uCurveLum;
  vec3 tone(vec3 x) {
    vec3 xa = pow(x, vec3(uCurve.x));
    return xa / (pow(x, vec3(uCurve.y)) * uCurve.z + uCurve.w);
  }
  float tone1(float x) {
    return pow(x, uCurve.x) / (pow(x, uCurve.y) * uCurve.z + uCurve.w);
  }
  vec3 toSRGB(vec3 c) {
    c = clamp(c, 0.0, 1.0);
    return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
  }
  float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
  const vec3 LUM = vec3(0.2126, 0.7152, 0.0722);

  void main() {
    vec4 scene = texture2D(tColor, vUv);
    vec3 col = scene.rgb;
    // L'occlusion n'agit que sur la part indirecte (alpha écrit par les matériaux) :
    // recoins et pieds de murs se creusent dans l'ombre, le plein soleil reste net.
    float indirect = clamp(scene.a, 0.0, 1.0);
    float ao = texture2D(tAO, vUv).r;
    float occ = 1.0 - indirect * (1.0 - ao) * uAO;
    // Elle tire vers le bleu-lavande plutôt que vers le gris.
    col *= pow(vec3(max(occ, 0.0)), uAOTint);
    col += texture2D(tBloom, vUv).rgb * uBloom;
    col += uSunColor * texture2D(tRays, vUv).r * uRays;
    // Clarté : un pixel plus clair que son voisinage (1/8 d'écran) s'éclaire un peu,
    // un pixel plus sombre se creuse. Le relief et la matière ressortent sans durcir.
    {
      float Lp = dot(col, LUM);
      float Lb = dot(texture2D(tLocal, vUv).rgb, LUM);
      float k = clamp(pow(max(Lp, 1e-4) / max(Lb, 1e-4), uClarity), 0.72, 1.35);
      col *= k;
    }
    col = max(col * uExposure, 0.0);
    // Par canal (les hautes lumières blanchissent comme sur un film), avec une part
    // appliquée à la luminance seule pour ne pas trop saturer les teintes.
    float lin = dot(col, LUM);
    vec3 perChannel = tone(col);
    vec3 byLum = col * (tone1(lin) / max(lin, 1e-5));
    col = min(mix(perChannel, byLum, uCurveLum), vec3(1.0));

    // Étalonnage en espace d'affichage : ombres bleu-lavande, lumières dorées.
    float l = dot(col, LUM);
    col *= mix(uShadowTint, vec3(1.0), smoothstep(0.0, 0.5, l));
    col *= mix(vec3(1.0), uHighTint, smoothstep(0.4, 1.0, l));
    l = dot(col, LUM);
    col = max(mix(vec3(l), col, uSat), 0.0);
    // Noir doux, jamais d'encre : la base du film est lavande.
    col = uFilmBase + (1.0 - uFilmBase) * col;
    vec3 srgb = toSRGB(col);

    vec2 dv = vUv - 0.5;
    float v = smoothstep(0.95, 0.25, length(dv * vec2(1.15, 1.0)));
    srgb *= mix(1.0 - uVignette, 1.0, v);
    srgb = mix(srgb, uFadeColor, uFade);
    srgb += (ign(gl_FragCoord.xy + fract(uTime * 7.0) * 37.0) - 0.5) / 255.0 * 1.5;
    // Réglage : 1 = occlusion seule, 2 = part indirecte (alpha de la scène).
    if (uDebug > 0.5) srgb = vec3(uDebug > 1.5 ? indirect : ao);
    gl_FragColor = vec4(srgb, 1.0);
  }
`;

const _v = new THREE.Vector3();
const _fwd = new THREE.Vector3();

export class Renderer {
  constructor(container, { test = false } = {}) {
    this.test = test;
    const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: test, stencil: false });
    this.maxPixelRatio = Math.min(window.devicePixelRatio || 1, test ? 1 : 1.25);
    this.pixelRatio = this.maxPixelRatio;
    renderer.setPixelRatio(this.pixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.autoClear = true;
    container.appendChild(renderer.domElement);
    this.renderer = renderer;

    this.camera = new THREE.PerspectiveCamera(80, window.innerWidth / window.innerHeight, 0.05, 1500);
    this.scene = new THREE.Scene();
    this.quad = new FullScreenQuad();

    this.aoMat = mat(AO_FS, {
      tDepth: { value: null },
      uProjInv: { value: new THREE.Matrix4() },
      uTexel: { value: new THREE.Vector2() },
      uRadius: { value: 1.1 },
      uIntensity: { value: 1.8 },
      uBias: { value: 0.5 },
      uProjScale: { value: 1 },
    });
    this.aoBlurMat = mat(AO_BLUR_FS, { tAO: { value: null }, uTexel: { value: new THREE.Vector2() } });
    this.raysMat = mat(RAYS_FS, { tDepth: { value: null }, uSun: { value: new THREE.Vector2() }, uAspect: { value: 1 } });
    this.downMat = mat(DOWN_FS, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uThreshold: { value: 1.9 }, uKnee: { value: 1.0 }, uFirst: { value: 0 } });
    this.upMat = mat(UP_FS, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uWeight: { value: 1 } }, { blending: THREE.AdditiveBlending, transparent: true });
    this.finalMat = mat(FINAL_FS, {
      tColor: { value: null },
      tAO: { value: null },
      tBloom: { value: null },
      tLocal: { value: null },
      uClarity: { value: 0.22 },
      tRays: { value: null },
      uBloom: { value: 0.16 },
      uExposure: { value: 1.2 },
      uAO: { value: 0.9 },
      uAOTint: { value: new THREE.Vector3(1.15, 1.05, 0.8) },
      uRays: { value: 0 },
      uSunColor: { value: new THREE.Color(1.0, 0.82, 0.6) },
      uVignette: { value: 0.18 },
      uFade: { value: 0 },
      uFadeColor: { value: new THREE.Color() },
      uTime: { value: 0 },
      uShadowTint: { value: new THREE.Vector3(0.94, 0.95, 1.06) },
      uHighTint: { value: new THREE.Vector3(1.01, 1.0, 0.975) },
      uFilmBase: { value: new THREE.Vector3(0.012, 0.01, 0.02) },
      uSat: { value: 1.1 },
      uCurve: { value: new THREE.Vector4() },
      uCurveLum: { value: 0.62 },
      uDebug: { value: 0 },
    });
    this.setCurve(1.45, 0.99, 10, 0.18, 0.2);
    // La couleur de fondu est appliquée en espace d'affichage.
    this.finalMat.uniforms.uFadeColor.value.setRGB(1.0, 0.957, 0.918);

    // Réglages (utiles pour mesurer le coût de chaque effet, ou pour alléger le rendu).
    this.settings = { ao: true, bloom: true, rays: true, clarity: true };
    this.clarity = 0.22;
    this._createTargets();
    this.envReady = false;
    this._slow = 0;
    this._frames = 0;

    window.addEventListener('resize', () => this.resize());
  }

  _createTargets() {
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const w = Math.max(1, size.x), h = Math.max(1, size.y);
    this._disposeTargets();
    const depthTexture = new THREE.DepthTexture(w, h);
    depthTexture.type = THREE.FloatType;
    this.sceneRT = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: 4, depthTexture, depthBuffer: true });
    const hw = Math.max(1, Math.floor(w / 2)), hh = Math.max(1, Math.floor(h / 2));
    const half = { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter };
    this.aoRT = new THREE.WebGLRenderTarget(hw, hh, half);
    this.aoBlurRT = new THREE.WebGLRenderTarget(hw, hh, { type: THREE.HalfFloatType, depthBuffer: false });
    this.raysRT = new THREE.WebGLRenderTarget(hw, hh, { type: THREE.HalfFloatType, depthBuffer: false });
    // Moyenne locale (1/8) pour la « clarté » : contraste local doux.
    this.localRTs = [];
    let lw = w, lh = h;
    for (let i = 0; i < 3; i++) {
      lw = Math.max(1, Math.floor(lw / 2));
      lh = Math.max(1, Math.floor(lh / 2));
      this.localRTs.push(new THREE.WebGLRenderTarget(lw, lh, { type: THREE.HalfFloatType, depthBuffer: false }));
    }
    this.bloomRTs = [];
    let bw = w, bh = h;
    for (let i = 0; i < 6; i++) {
      bw = Math.max(1, Math.floor(bw / 2));
      bh = Math.max(1, Math.floor(bh / 2));
      this.bloomRTs.push(new THREE.WebGLRenderTarget(bw, bh, { type: THREE.HalfFloatType, depthBuffer: false }));
    }
    this.size = new THREE.Vector2(w, h);
    this.aoMat.uniforms.uTexel.value.set(1 / w, 1 / h);
    this.aoBlurMat.uniforms.uTexel.value.set(1 / hw, 1 / hh);
    this._raysCleared = false;
    this._aoCleared = false;
    this._bloomCleared = false;
  }

  _disposeTargets() {
    if (!this.sceneRT) return;
    this.sceneRT.depthTexture.dispose();
    this.sceneRT.dispose();
    this.aoRT.dispose();
    this.aoBlurRT.dispose();
    this.raysRT.dispose();
    for (const rt of this.bloomRTs) rt.dispose();
    for (const rt of this.localRTs) rt.dispose();
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(w, h);
    this._createTargets();
  }

  // Éclairage d'ambiance : le ciel filtré (PMREM) sert d'environnement à tous les matériaux.
  _buildEnv() {
    this.envReady = true;
    const src = this.scene.userData.aube;
    if (!src || !src.buildEnvScene) return;
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const envScene = src.buildEnvScene();
    const rt = pmrem.fromScene(envScene, 0.02, 0.1, 200, { size: 128 });
    this.scene.environment = rt.texture;
    this.scene.environmentIntensity = src.envIntensity ?? 0.44;
    pmrem.dispose();
    envScene.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
  }

  // Si les images sont trop lentes de façon durable, on baisse la résolution (jamais en test).
  _adapt(dt) {
    if (this.test || !(dt > 0)) return;
    this._frames++;
    if (dt > 1 / 48) this._slow++;
    if (this._frames >= 120) {
      if (this._slow > 40) {
        // D'abord la carte d'ombre, ensuite seulement la résolution.
        const src = this.scene.userData.aube;
        if (src && src.lowerShadows && src.lowerShadows()) {
          // carte d'ombre allégée
        } else if (this.pixelRatio > 0.75) {
          this.pixelRatio = Math.max(0.75, this.pixelRatio - 0.125);
          this.resize();
        }
      }
      this._frames = 0;
      this._slow = 0;
    }
  }

  _pass(material, target) {
    this.renderer.setRenderTarget(target);
    this.quad.material = material;
    this.quad.render(this.renderer);
  }

  render(dt, time) {
    const r = this.renderer;
    if (!this.envReady) this._buildEnv();
    this._adapt(dt);
    const cam = this.camera;
    const w = this.size.x, h = this.size.y;

    // 1. Scène
    r.setRenderTarget(this.sceneRT);
    r.render(this.scene, cam);
    const depth = this.sceneRT.depthTexture;

    // 2. Occlusion ambiante
    const set = this.settings;
    if (!set.ao && !this._aoCleared) {
      r.setRenderTarget(this.aoBlurRT);
      r.setClearColor(0xffffff, 1);
      r.clear(true, false, false);
      this._aoCleared = true;
    }
    const ao = this.aoMat.uniforms;
    ao.tDepth.value = depth;
    ao.uProjInv.value.copy(cam.projectionMatrixInverse);
    ao.uProjScale.value = h * cam.projectionMatrix.elements[5] * 0.5;
    if (set.ao) {
      this._pass(this.aoMat, this.aoRT);
      this.aoBlurMat.uniforms.tAO.value = this.aoRT.texture;
      this._pass(this.aoBlurMat, this.aoBlurRT);
      this._aoCleared = false;
    }

    // 3. Rais de lumière, seulement si le soleil est devant.
    let rays = 0;
    const sun = this.scene.userData.aube;
    if (sun) {
      cam.getWorldDirection(_fwd);
      const facing = _fwd.dot(sun.sunDir);
      if (set.rays && facing > 0.15) {
        _v.copy(sun.sunDir).multiplyScalar(1000).add(cam.position).project(cam);
        const sx = _v.x * 0.5 + 0.5, sy = _v.y * 0.5 + 0.5;
        const edge = Math.max(Math.abs(sx - 0.5), Math.abs(sy - 0.5));
        rays = THREE.MathUtils.smoothstep(facing, 0.15, 0.6) * (1 - THREE.MathUtils.smoothstep(edge, 0.55, 0.85));
        if (rays > 0.001) {
          const ru = this.raysMat.uniforms;
          ru.tDepth.value = depth;
          ru.uSun.value.set(sx, sy);
          ru.uAspect.value = w / h;
          this._pass(this.raysMat, this.raysRT);
          this._raysCleared = false;
        }
      }
    }
    if (rays <= 0.001 && !this._raysCleared) {
      r.setRenderTarget(this.raysRT);
      r.setClearColor(0x000000, 1);
      r.clear(true, false, false);
      this._raysCleared = true;
    }

    // 4. Halo
    if (set.bloom) this._bloom(w, h);
    else if (!this._bloomCleared) {
      r.setRenderTarget(this.bloomRTs[0]);
      r.setClearColor(0x000000, 1);
      r.clear(true, false, false);
      this._bloomCleared = true;
    }
    if (set.bloom) this._bloomCleared = false;

    // 5. Moyenne locale (trois réductions, sans seuil)
    if (set.clarity) {
      const dm = this.downMat.uniforms;
      let src = this.sceneRT.texture, sw = w, sh = h;
      dm.uFirst.value = 0;
      for (const rt of this.localRTs) {
        dm.tSrc.value = src;
        dm.uTexel.value.set(1 / sw, 1 / sh);
        this._pass(this.downMat, rt);
        src = rt.texture;
        sw = rt.width;
        sh = rt.height;
      }
    }

    // 6. Final
    const fu = this.finalMat.uniforms;
    fu.tLocal.value = this.localRTs[this.localRTs.length - 1].texture;
    fu.uClarity.value = set.clarity ? this.clarity : 0;
    fu.tColor.value = this.sceneRT.texture;
    fu.tAO.value = this.aoBlurRT.texture;
    fu.tBloom.value = this.bloomRTs[0].texture;
    fu.tRays.value = this.raysRT.texture;
    fu.uRays.value = rays * 0.55;
    fu.uTime.value = time;
    this._pass(this.finalMat, null);
  }

  _bloom(w, h) {
    const r = this.renderer;
    const dm = this.downMat.uniforms;
    let src = this.sceneRT.texture, sw = w, sh = h;
    for (let i = 0; i < this.bloomRTs.length; i++) {
      dm.tSrc.value = src;
      dm.uTexel.value.set(1 / sw, 1 / sh);
      dm.uFirst.value = i === 0 ? 1 : 0;
      this._pass(this.downMat, this.bloomRTs[i]);
      src = this.bloomRTs[i].texture;
      sw = this.bloomRTs[i].width;
      sh = this.bloomRTs[i].height;
    }
    const um = this.upMat.uniforms;
    for (let i = this.bloomRTs.length - 1; i > 0; i--) {
      const from = this.bloomRTs[i];
      um.tSrc.value = from.texture;
      um.uTexel.value.set(1 / from.width, 1 / from.height);
      um.uWeight.value = 0.8;
      r.autoClear = false;
      this._pass(this.upMat, this.bloomRTs[i - 1]);
      r.autoClear = true;
    }
  }

  // Courbe de Lottes : contraste a, épaule d, blanc hdrMax, gris moyen midIn -> midOut.
  setCurve(a, d, hdrMax, midIn, midOut) {
    const ad = a * d;
    const den = (Math.pow(hdrMax, ad) - Math.pow(midIn, ad)) * midOut;
    const b = (-Math.pow(midIn, a) + Math.pow(hdrMax, a) * midOut) / den;
    const c = (Math.pow(hdrMax, ad) * Math.pow(midIn, a) - Math.pow(hdrMax, a) * Math.pow(midIn, ad) * midOut) / den;
    this.finalMat.uniforms.uCurve.value.set(a, ad, b, c);
  }

  setFade(v) {
    this.finalMat.uniforms.uFade.value = v;
  }
}
