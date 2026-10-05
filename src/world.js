import * as THREE from 'three';
import { ATMO, ATMO_GLSL, NOISE_GLSL, installAtmosphereFog } from './atmosphere.js';
import { AubeMaterial, MATERIAL_TIME, MATERIAL_CLOUDS } from './materials.js';

// Ciel, lumière, mer de nuages, silhouette lointaine et pollen.

// Compatibilité : anciens noms de la palette.
export const SKY = {
  zenith: ATMO.zenith,
  upper: ATMO.upperCool,
  horizon: ATMO.horizonWarm,
  sun: ATMO.sunDisc,
  fog: ATMO.horizonCool,
  sunDir: ATMO.sunDir,
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

// La brume d'Aube remplace celle de three.js avant toute compilation de shader.
installAtmosphereFog();

// ---------- Texture de nuages (calculée une fois, raccordable) ----------
// R : hauteur des cumulus (union de dômes + fbm), G/B : pente encodée,
// A : fbm doux pour les nuages hauts du ciel.
function hash2(x, y, s) {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function vnoise(x, y, P, s) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const x0 = ((ix % P) + P) % P, x1 = (x0 + 1) % P, y0 = ((iy % P) + P) % P, y1 = (y0 + 1) % P;
  const a = hash2(x0, y0, s), b = hash2(x1, y0, s), c = hash2(x0, y1, s), d = hash2(x1, y1, s);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}
function pfbm(u, v, P, oct, s) {
  let sum = 0, amp = 0.5, norm = 0;
  for (let o = 0; o < oct; o++) {
    sum += amp * vnoise(u * P, v * P, P, s + o * 17);
    norm += amp;
    amp *= 0.5;
    P *= 2;
  }
  return sum / norm;
}
function domes(u, v, N, s) {
  const x = u * N, y = v * N;
  const ix = Math.floor(x), iy = Math.floor(y);
  let best = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const cx = ix + dx, cy = iy + dy;
      const wx = ((cx % N) + N) % N, wy = ((cy % N) + N) % N;
      const px = cx + hash2(wx, wy, s), py = cy + hash2(wx, wy, s + 7);
      const r = 0.55 + 0.55 * hash2(wx, wy, s + 13);
      const h = r * r - ((px - x) ** 2 + (py - y) ** 2);
      if (h > 0) best = Math.max(best, Math.sqrt(h));
    }
  }
  return best;
}

export const CLOUD_GRAD_SCALE = 24; // pente stockée = dh/dtexel * échelle

function makeCloudTexture(S = 256) {
  const H = new Float32Array(S * S);
  const sky = new Float32Array(S * S);
  for (let j = 0; j < S; j++) {
    for (let i = 0; i < S; i++) {
      const u = i / S, v = j / S;
      const wu = u + (pfbm(u, v, 4, 3, 101) - 0.5) * 0.1;
      const wv = v + (pfbm(u, v, 4, 3, 202) - 0.5) * 0.1;
      const big = pfbm(wu, wv, 3, 3, 9);
      const d1 = domes(wu, wv, 6, 5), d2 = domes(wu, wv, 15, 9), d3 = domes(wu, wv, 34, 21);
      let h = Math.max(d1 * 0.85, d2 * 0.55 + d1 * 0.35, d3 * 0.3 + d2 * 0.25 + d1 * 0.3);
      h += (big - 0.5) * 0.55 + 0.08 * pfbm(wu, wv, 16, 3, 44);
      H[j * S + i] = Math.min(1, Math.max(0, (h + 0.12) / 1.25));
      sky[j * S + i] = pfbm(wu, wv, 4, 6, 77);
    }
  }
  const data = new Uint8Array(S * S * 4);
  for (let j = 0; j < S; j++) {
    for (let i = 0; i < S; i++) {
      const k = j * S + i;
      const gx = (H[j * S + ((i + 1) % S)] - H[j * S + ((i - 1 + S) % S)]) * 0.5 * CLOUD_GRAD_SCALE;
      const gz = (H[((j + 1) % S) * S + i] - H[((j - 1 + S) % S) * S + i]) * 0.5 * CLOUD_GRAD_SCALE;
      data[k * 4] = Math.round(H[k] * 255);
      data[k * 4 + 1] = Math.round(THREE.MathUtils.clamp(gx * 0.5 + 0.5, 0, 1) * 255);
      data[k * 4 + 2] = Math.round(THREE.MathUtils.clamp(gz * 0.5 + 0.5, 0, 1) * 255);
      data[k * 4 + 3] = Math.round(sky[k] * 255);
    }
  }
  const tex = new THREE.DataTexture(data, S, S, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 8;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

// ---------- Ciel ----------
const SKY_GLSL = /* glsl */ `
  ${ATMO_GLSL}
  ${NOISE_GLSL}
  uniform sampler2D tCloud;
  uniform float uTime;
  uniform float uEnv;

  // Chaîne de montagnes lointaines, à peine sortie de la mer de nuages.
  float aubeRidge(vec2 d2, float freq, float seed) {
    float n = 0.0, a = 0.55;
    vec2 p = d2 * freq + seed;
    for (int i = 0; i < 4; i++) { n += a * (1.0 - abs(aNoise(p) * 2.0 - 1.0)); p = p * 2.1 + 3.7; a *= 0.45; }
    return n;
  }

  vec3 aubeSky(vec3 rd, out float cloudMask) {
    float h = rd.y;
    float a = aubeSunSide(rd);
    float aa = a * a * (3.0 - 2.0 * a);
    vec3 hor = aubeHorizon(rd);
    vec3 upper = mix(AUBE_UPPER_COOL, AUBE_UPPER_WARM, aa);
    vec3 col = mix(hor, upper, smoothstep(0.0, 0.3, h));
    col = mix(col, AUBE_ZENITH, smoothstep(0.12, 0.8, h));
    // Ombre de la Terre : bande bleutée juste au-dessus de l'horizon, à l'opposé du soleil.
    float es = (1.0 - aa) * (1.0 - smoothstep(0.0, 0.09, h)) * smoothstep(-0.03, 0.012, h);
    col = mix(col, AUBE_EARTH_SHADOW, es * 0.45);
    // Sous l'horizon : la lueur de la mer de nuages.
    col = mix(col, hor * 1.04, smoothstep(0.0, -0.06, h));

    // Montagnes : deux plans, le plus lointain plus pâle (calculées près de l'horizon seulement).
    vec2 d2 = rd.xz / max(length(rd.xz), 1e-4);
    float aaw = fwidth(h) * 1.5 + 1e-4;
    if (h < 0.09) {
    float mask1 = smoothstep(0.35, 0.62, aNoise(d2 * 2.2 + 11.0));
    float m1 = -0.01 + 0.075 * pow(aubeRidge(d2, 5.0, 2.0), 1.6) * mask1;
    float mask2 = smoothstep(0.4, 0.7, aNoise(d2 * 1.7 + 4.0));
    float m2 = -0.012 + 0.05 * pow(aubeRidge(d2, 8.0, 9.0), 1.5) * mask2;
    vec3 mcolFar = mix(hor, AUBE_EARTH_SHADOW, 0.32);
    vec3 mcolNear = mix(hor, AUBE_EARTH_SHADOW * 0.92, 0.5);
    // Arête éclairée côté soleil.
    float rim = pow(aa, 3.0);
    float in1 = 1.0 - smoothstep(m1 - aaw, m1 + aaw, h);
    float in2 = 1.0 - smoothstep(m2 - aaw, m2 + aaw, h);
    vec3 mc1 = mix(mcolFar, hor * 1.06, smoothstep(m1 - 0.01, m1, h) * rim * 0.6);
    col = mix(col, mix(mc1, hor, smoothstep(0.0, -0.02, h) * 0.8), in1 * smoothstep(-0.03, 0.0, m1));
    vec3 mc2 = mix(mcolNear, hor * 1.08, smoothstep(m2 - 0.008, m2, h) * rim * 0.7);
    col = mix(col, mix(mc2, hor, smoothstep(0.0, -0.025, h) * 0.75), in2 * smoothstep(-0.03, 0.0, m2));
    }

    // Nuages hauts : bancs d'altocumulus et voiles, éclairés par le soleil bas.
    cloudMask = 0.0;
    if (h > 0.0) {
      vec2 suv = rd.xz / (h + 0.11);
      vec2 wind = vec2(uTime * 0.0016, uTime * 0.0006);
      vec2 uv1 = suv * 0.16 + wind;
      vec2 sdir = normalize(AUBE_SUN_DIR.xz);
      float n = texture2D(tCloud, uv1).a;
      float nd = texture2D(tCloud, uv1 * 3.1 + 0.3).a;
      float nf = texture2D(tCloud, uv1 * 9.7 + 0.61).a;
      float dens = n * 0.8 + nd * 0.3 + nf * 0.1;
      // Bords nets mais doux, rongés par le détail fin.
      float cov = smoothstep(0.57, 0.71, dens);
      cov *= smoothstep(0.015, 0.16, h) * (1.0 - smoothstep(0.45, 0.85, h));
      // Voiles étirés (cirrus) plus haut.
      float ci = texture2D(tCloud, vec2(suv.x * 0.05, suv.y * 0.22) + wind * 0.7 + 0.5).a;
      float cir = smoothstep(0.55, 0.8, ci) * smoothstep(0.05, 0.3, h) * (1.0 - smoothstep(0.6, 1.0, h)) * 0.45;
      float s = max(dot(rd, AUBE_SUN_DIR), 0.0);
      // Éclairage : la face tournée vers le soleil s'allume, le cœur épais reste lavande.
      vec2 uvs = uv1 + sdir * 0.022;
      float ns = texture2D(tCloud, uvs).a * 0.8 + texture2D(tCloud, uvs * 3.1 + 0.3).a * 0.3;
      float lit = clamp(0.5 + (n * 0.8 + nd * 0.3 - ns) * 6.0, 0.0, 1.0);
      float thick = smoothstep(0.64, 0.86, dens);
      vec3 shade = mix(AUBE_UPPER_COOL * 0.88, AUBE_EARTH_SHADOW, 0.35);
      vec3 litc = mix(vec3(1.0, 0.87, 0.85), AUBE_HOR_WARM * 1.18, aa);
      vec3 cc = mix(shade, litc, lit * (1.0 - thick * 0.45));
      cc += AUBE_SUN * pow(s, 6.0) * 0.8 * (1.0 - cov * 0.5);
      col = mix(col, cc, cov * 0.84);
      // Liseré lumineux sur les bords minces, près du soleil.
      float rim = cov * (1.0 - smoothstep(0.35, 0.9, cov));
      col += AUBE_SUN * (pow(s, 4.0) * 0.7 + aa * 0.08) * rim;
      col = mix(col, mix(litc, AUBE_SUN, 0.3) * 1.05, cir * (1.0 - cov));
      cloudMask = cov;
    }

    // Soleil : halo large, couronne, disque.
    float s = max(dot(rd, AUBE_SUN_DIR), 0.0);
    float occl = 1.0 - cloudMask * 0.7;
    col += AUBE_SUN * (pow(s, 6.0) * 0.14 + pow(s, 28.0) * 0.3 + pow(s, 260.0) * 1.3 * occl);
    float disc = smoothstep(0.99975, 0.99988, s);
    col += AUBE_SUN_DISC * disc * mix(24.0, 3.0, uEnv) * occl;
    return col;
  }
`;

function skyMaterial(cloudTex, env = false) {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      tCloud: { value: cloudTex },
      uTime: { value: 0 },
      uEnv: { value: env ? 1 : 0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vDir;
      ${SKY_GLSL}
      void main() {
        vec3 rd = normalize(vDir);
        float cm;
        vec3 col = aubeSky(rd, cm);
        if (uEnv > 0.5) {
          // Éclairage d'ambiance : en haut le bleu-lavande du ciel (ombres fraîches et
          // nettement plus sombres que le soleil), en bas un rebond tiède et faible.
          float side = aubeSunSide(rd);
          vec3 up = AUBE_AMB_SKY * mix(1.0, 0.82, smoothstep(0.0, 0.7, rd.y));
          up = mix(up, AUBE_HOR_WARM * 0.9, side * side * (1.0 - smoothstep(0.0, 0.35, rd.y)) * 0.45);
          col = mix(col, up, 0.8);
          // En bas : surtout du lavande (rues à l'ombre, mer de nuages), un peu de tiède côté soleil.
          vec3 below = mix(AUBE_AMB_SKY * 0.42, AUBE_AMB_GROUND * 0.5, 0.25 + 0.35 * side);
          col = mix(col, below, smoothstep(0.02, -0.12, rd.y));
        }
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
}

// ---------- Lumière ----------
const SUN_INTENSITY = 10;
const ENV_INTENSITY = 0.26; // ciel filtré (ombres)
const SHADOW_MAP = 4096;
const SHADOW_HALF = 52; // demi-côté de la carte d'ombre (m)
const SHADOW_AHEAD = 30; // décalage du centre devant la caméra (m)

// ---------- Mer de nuages ----------
const CLOUD_TILE_A = 520; // mètres par motif, grande échelle
const CLOUD_TILE_B = 150; // détail
const CLOUD_AMP = 26; // hauteur des cumulus au-dessus du plan

export class World {
  constructor(scene) {
    this.scene = scene;
    this.time = 0;
    // Brume : le type importe peu, le shader d'Aube la remplace (density = multiplicateur).
    scene.fog = new THREE.FogExp2(ATMO.horizonCool.clone(), 1.0);
    scene.background = ATMO.horizonCool.clone();
    this.sunDir = ATMO.sunDir.clone();

    this.cloudTex = makeCloudTexture(256);
    MATERIAL_CLOUDS.value = this.cloudTex;
    this._sky();
    this._lights();
    this._clouds();
    this._distantTowers();
    this._pollen();

    // Pour le moteur de rendu : direction du soleil, couleur, et scène servant à
    // calculer l'éclairage d'ambiance (environnement filtré) depuis le ciel.
    scene.userData.aube = {
      sunDir: this.sunDir,
      sunColor: ATMO.sun,
      envIntensity: ENV_INTENSITY,
      // Appelé par le moteur de rendu si la machine peine : carte d'ombre plus légère.
      lowerShadows: () => {
        if (this.sun.shadow.mapSize.x <= 2048) return false;
        this.sun.shadow.mapSize.set(2048, 2048);
        return true;
      },
      buildEnvScene: () => {
        const s = new THREE.Scene();
        const m = new THREE.Mesh(new THREE.SphereGeometry(50, 48, 24), skyMaterial(this.cloudTex, true));
        m.frustumCulled = false;
        s.add(m);
        return s;
      },
    };
  }

  _sky() {
    const geo = new THREE.SphereGeometry(1200, 64, 32);
    const mat = skyMaterial(this.cloudTex);
    this.skyMat = mat;
    const sky = new THREE.Mesh(geo, mat);
    sky.frustumCulled = false;
    // Dessiné après les objets opaques : le shader du ciel ne tourne que sur les pixels visibles.
    sky.renderOrder = 20;
    this.sky = sky;
    this.scene.add(sky);
  }

  _lights() {
    // Le ciel (environnement filtré, voir buildEnvScene) éclaire les ombres en
    // bleu-lavande ; le soleil, seul, réchauffe. Un rebond tiède très léger
    // remonte des terrasses claires sous les avancées.
    const bounce = new THREE.HemisphereLight(0x000000, 0xffcfb0, 0.14);
    this.scene.add(bounce);
    this.bounce = bounce;

    const sun = new THREE.DirectionalLight(ATMO.sun.clone(), SUN_INTENSITY);
    sun.castShadow = true;
    // Carte d'ombre calée devant la caméra (voir update) : les ombres portées
    // sculptent aussi le mi-plan, pas seulement les pieds du joueur.
    sun.shadow.mapSize.set(SHADOW_MAP, SHADOW_MAP);
    const sc = sun.shadow.camera;
    sc.left = -SHADOW_HALF; sc.right = SHADOW_HALF; sc.top = SHADOW_HALF; sc.bottom = -SHADOW_HALF;
    sc.near = 1; sc.far = 300;
    sun.shadow.bias = -0.0002;
    sun.shadow.normalBias = 0.03;
    sun.shadow.radius = 2.0;
    this.scene.add(sun);
    this.scene.add(sun.target);
    this.sun = sun;
    // Repère de l'espace lumière, pour caler la carte d'ombre au texel près.
    this._lx = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), this.sunDir).normalize();
    this._ly = new THREE.Vector3().crossVectors(this.sunDir, this._lx).normalize();
    this._fwd = new THREE.Vector3();
    this._c = new THREE.Vector3();
  }

  _clouds() {
    const geo = new THREE.PlaneGeometry(3200, 3200, 1, 1);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.ShaderMaterial({
      fog: false,
      uniforms: {
        tCloud: { value: this.cloudTex },
        uTime: { value: 0 },
        uCam: { value: new THREE.Vector3() },
        uLit: { value: ATMO.cloudLit },
        uShade: { value: ATMO.cloudShade },
        uDeep: { value: ATMO.cloudDeep },
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
        uniform sampler2D tCloud;
        uniform float uTime;
        uniform vec3 uCam, uLit, uShade, uDeep;
        varying vec3 vWorld;
        ${ATMO_GLSL}
        const float AMP = ${CLOUD_AMP.toFixed(1)};
        const float TA = ${CLOUD_TILE_A.toFixed(1)};
        const float TB = ${CLOUD_TILE_B.toFixed(1)};
        const float GS = ${CLOUD_GRAD_SCALE.toFixed(1)};
        vec2 windA() { return vec2(uTime * 0.55, uTime * 0.2); }
        float cloudH(vec2 xz) {
          float a = texture2D(tCloud, (xz + windA()) / TA).r;
          float b = texture2D(tCloud, (xz + windA() * 1.7) / TB + 0.37).r;
          return a * 0.84 + b * 0.16;
        }
        void main() {
          vec3 rd = normalize(vWorld - uCam);
          float ry = min(rd.y, -0.015);
          // Marche courte dans la couche de nuages (parallaxe) : du haut des
          // cumulus jusqu'au plan, on cherche le premier point sous la surface.
          vec3 entry = vWorld + rd * (AMP / ry); // point du rayon à la hauteur des sommets
          if (uCam.y < vWorld.y + AMP) entry = uCam;
          float hPrev = 0.5, hit = 1.0;
          float hs = 0.0;
          vec2 p = vWorld.xz;
          const int N = 7;
          for (int i = 1; i <= N; i++) {
            float t = float(i) / float(N); // 0 sommet -> 1 plan
            float layer = 1.0 - t;
            vec2 q = mix(entry.xz, vWorld.xz, t);
            float hh = cloudH(q);
            if (hh >= layer) {
              // Interpolation entre le pas précédent et celui-ci.
              float prevLayer = 1.0 - float(i - 1) / float(N);
              float d0 = prevLayer - hPrev, d1 = hh - layer;
              float k = clamp(d0 / max(d0 + d1, 1e-4), 0.0, 1.0);
              float tt = (float(i - 1) + k) / float(N);
              p = mix(entry.xz, vWorld.xz, tt);
              hs = cloudH(p);
              hit = 0.0;
              break;
            }
            hPrev = hh;
          }
          if (hit > 0.5) { p = vWorld.xz; hs = cloudH(p); }

          // Pente (précalculée dans la texture) des deux échelles.
          vec2 ga = texture2D(tCloud, (p + windA()) / TA).gb * 2.0 - 1.0;
          vec2 gb = texture2D(tCloud, (p + windA() * 1.7) / TB + 0.37).gb * 2.0 - 1.0;
          float texA = TA / 256.0, texB = TB / 256.0;
          vec2 grad = ga / GS * 0.84 * AMP / texA + gb / GS * 0.16 * AMP / texB;
          vec3 n = normalize(vec3(-grad.x, 1.0, -grad.y));

          vec3 sd = AUBE_SUN_DIR;
          float ndl = dot(n, sd);
          float wrap = clamp((ndl + 0.2) / 1.05, 0.0, 1.0);
          wrap = wrap * wrap * (3.0 - 2.0 * wrap);
          // Ombre portée approximative : relief plus haut en direction du soleil.
          vec2 sxz = normalize(sd.xz);
          float hsun = cloudH(p + sxz * 16.0);
          float hsun2 = cloudH(p + sxz * 40.0);
          float occ = clamp(1.0 - max(hsun - hs - 0.03, 0.0) * 3.2 - max(hsun2 - hs - 0.12, 0.0) * 1.6, 0.22, 1.0);
          vec3 col = mix(uShade, uLit, wrap * occ);
          // Creux plus profonds et bleutés.
          col = mix(uDeep, col, smoothstep(0.05, 0.6, hs));
          col *= mix(0.93, 1.06, smoothstep(0.3, 0.9, hs));
          // Ciel au-dessus : léger apport bleuté sur les faces tournées vers le haut.
          col += AUBE_ZENITH * 0.06 * n.y;
          // Diffusion vers l'avant : bords lumineux à contre-jour.
          float fs = max(dot(rd, sd), 0.0);
          col += AUBE_SUN * pow(fs, 6.0) * (0.18 + 0.55 * (1.0 - hs)) * (0.6 + 0.4 * occ);

          vec3 surf = vec3(p.x, vWorld.y + hs * AMP, p.y);
          float dist = length(surf - uCam);
          float fd = dist * AUBE_HAZE * 0.9 + aubeFogDepth(uCam, rd, dist) * 0.05;
          float fogAmt = 1.0 - exp(-fd);
          col = mix(col, aubeFogColor(rd), fogAmt);
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    this.cloudMat = mat;
    const clouds = new THREE.Mesh(geo, mat);
    clouds.position.y = ATMO.cloudY;
    clouds.frustumCulled = false;
    clouds.renderOrder = 10; // après les tours, pour ne pas calculer les nuages cachés
    this.clouds = clouds;
    this.scene.add(clouds);
  }

  // Ville lointaine : tours de pierre claire avec corniches, pavillons et jardins.
  _distantTowers() {
    const rand = rng(7);
    const boxes = []; // [x, y, z, w, h, d, rotY, tint]
    const puffs = []; // [x, y, z, r, tint]
    const center = new THREE.Vector2(0, -50);
    const avoid = (x, z) => Math.abs(x) < 20 && z > -128 && z < 26;

    const tints = [0xf4ede6, 0xf6e6dc, 0xece6ee, 0xf2ece4, 0xf7efe6];
    const addTower = (x, z, w, d, top, opts = {}) => {
      const rot = (rand() - 0.5) * 0.25;
      const tint = tints[Math.floor(rand() * tints.length)];
      const bottom = -75;
      boxes.push([x, bottom, z, w, top - bottom, d, rot, tint, top - 2.2 - Math.floor(rand() * 2) * 4.2]);
      // Corniche
      boxes.push([x, top - 0.1, z, w + 0.9, 0.7, d + 0.9, rot, 0xfaf4ee]);
      // Ressaut / pavillon
      if (opts.setback ?? rand() < 0.55) {
        const sw = w * (0.4 + rand() * 0.3), sd = d * (0.4 + rand() * 0.3);
        const sh = 2.5 + rand() * 6;
        const ox = (rand() - 0.5) * (w - sw) * 0.8, oz = (rand() - 0.5) * (d - sd) * 0.8;
        boxes.push([x + ox, top + 0.6, z + oz, sw, sh, sd, rot, tint]);
        boxes.push([x + ox, top + 0.6 + sh - 0.05, z + oz, sw + 0.6, 0.45, sd + 0.6, rot, 0xfaf4ee]);
      }
      // Jardin suspendu : arbres en fleurs sur la terrasse.
      if (opts.garden ?? rand() < 0.6) {
        const n = 2 + Math.floor(rand() * 4);
        for (let i = 0; i < n; i++) {
          const px = x + (rand() - 0.5) * w * 0.8, pz = z + (rand() - 0.5) * d * 0.8;
          const r = 1.1 + rand() * 1.6;
          const pink = rand() < 0.55;
          puffs.push([px, top + 0.6 + r * 0.8, pz, r, pink ? 0xf6b8c8 : 0xa6cc9e]);
          puffs.push([px + r * 0.6, top + 0.6 + r * 0.6, pz + (rand() - 0.5) * r, r * 0.7, pink ? 0xf3c3cf : 0xb3d4a8]);
        }
      }
    };

    // Anneau proche : tours habitées, jardins.
    let placed = 0, guard = 0;
    while (placed < 34 && guard++ < 2000) {
      const a = rand() * Math.PI * 2;
      const r = 55 + rand() * 110;
      const x = center.x + Math.cos(a) * r * 1.15, z = center.y + Math.sin(a) * r;
      if (avoid(x, z)) continue;
      const w = 6 + rand() * 10, d = 6 + rand() * 10;
      addTower(x, z, w, d, -6 + rand() * 22, { garden: rand() < 0.75 });
      placed++;
    }
    // Anneau lointain.
    placed = 0; guard = 0;
    while (placed < 70 && guard++ < 3000) {
      const a = rand() * Math.PI * 2;
      const r = 170 + rand() * 330;
      const x = center.x + Math.cos(a) * r, z = center.y + Math.sin(a) * r * 0.9 - 40;
      if (avoid(x, z)) continue;
      const w = 8 + rand() * 18, d = 8 + rand() * 18;
      addTower(x, z, w, d, -10 + rand() * 36, { garden: rand() < 0.4 });
      placed++;
    }
    // Quelques flèches très hautes qui se perdent dans la lumière.
    const spires = [[-260, -420, 70], [180, -520, 95], [-460, -180, 55], [420, -300, 80], [40, -700, 120], [-120, 380, 60], [520, 120, 50]];
    for (const [x, z, top] of spires) {
      const w = 9 + rand() * 7;
      addTower(x, z, w, w * (0.8 + rand() * 0.4), top, { setback: true, garden: false });
      // Étages supérieurs en retrait successifs.
      boxes.push([x, top + 0.5, z, w * 0.62, 14, w * 0.62, 0, 0xf6eee6]);
      boxes.push([x, top + 14.5, z, w * 0.35, 10, w * 0.35, 0, 0xf6eee6]);
    }

    const boxGeo = new THREE.BoxGeometry(1, 1, 1);
    boxGeo.translate(0, 0.5, 0);
    // Hauteur sous laquelle s'ouvrent les fenêtres (aucune sur les corniches et pavillons).
    boxGeo.setAttribute('aWinTop', new THREE.InstancedBufferAttribute(new Float32Array(boxes.map((b) => b[8] ?? -999)), 1));
    const towerMat = new AubeMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0 }, 'facade');
    const mesh = new THREE.InstancedMesh(boxGeo, towerMat, boxes.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const pos = new THREE.Vector3(), scl = new THREE.Vector3();
    const col = new THREE.Color();
    boxes.forEach((b, i) => {
      q.setFromAxisAngle(up, b[6]);
      m.compose(pos.set(b[0], b[1], b[2]), q, scl.set(b[3], b[4], b[5]));
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, col.setHex(b[7]));
    });
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.frustumCulled = false;
    this.scene.add(mesh);
    this.towers = mesh;

    const puffGeo = new THREE.IcosahedronGeometry(1, 1);
    const puffMat = new AubeMaterial({ color: 0xffffff, roughness: 0.85 }, 'foliage');
    const pm = new THREE.InstancedMesh(puffGeo, puffMat, Math.max(1, puffs.length));
    puffs.forEach((p, i) => {
      m.compose(pos.set(p[0], p[1], p[2]), q.identity(), scl.setScalar(p[3]));
      pm.setMatrixAt(i, m);
      pm.setColorAt(i, col.setHex(p[4]));
    });
    pm.count = puffs.length;
    pm.castShadow = false;
    pm.receiveShadow = false;
    pm.frustumCulled = false;
    this.scene.add(pm);
    this.gardens = pm;
  }

  _pollen() {
    const count = 600;
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
        uSize: { value: 30 },
        uSunDir: { value: ATMO.sunDir },
      },
      vertexShader: /* glsl */ `
        attribute float seed;
        uniform float uTime, uSize;
        uniform vec3 uCam, uSunDir;
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
          // Plus visibles à contre-jour, comme des poussières dans la lumière.
          vec3 vd = normalize(p - uCam);
          float back = 0.45 + 0.9 * pow(max(dot(vd, uSunDir), 0.0), 3.0);
          vAlpha = back * smoothstep(0.5, 3.0, d) * (1.0 - smoothstep(18.0, 30.0, d)) * (0.5 + 0.5 * sin(uTime * 0.8 + seed * 3.0));
        }
      `,
      fragmentShader: /* glsl */ `
        varying float vAlpha;
        void main() {
          float r = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.0, r);
          gl_FragColor = vec4(vec3(1.0, 0.9, 0.74) * a * vAlpha * 0.6, 1.0);
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
    MATERIAL_TIME.value = this.time;
    this.sky.position.copy(camera.position);
    this.skyMat.uniforms.uTime.value = this.time;
    this.cloudMat.uniforms.uTime.value = this.time;
    this.cloudMat.uniforms.uCam.value.copy(camera.position);
    this.clouds.position.x = camera.position.x;
    this.clouds.position.z = camera.position.z;
    this.pollenMat.uniforms.uTime.value = this.time;
    this.pollenMat.uniforms.uCam.value.copy(camera.position);

    // La carte d'ombre couvre ce que la caméra regarde : centrée un peu devant
    // elle, recalée au texel près dans l'espace lumière (pas de scintillement).
    const fwd = camera.getWorldDirection(this._fwd);
    fwd.y = 0;
    if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
    fwd.normalize();
    const c = this._c.copy(camera.position).addScaledVector(fwd, SHADOW_AHEAD);
    c.y -= 1.6; // à peu près au niveau du sol
    const texel = (2 * SHADOW_HALF) / this.sun.shadow.mapSize.x;
    const lx = this._lx, ly = this._ly, sd = this.sunDir;
    const u = Math.round(c.dot(lx) / texel) * texel;
    const v = Math.round(c.dot(ly) / texel) * texel;
    const w = c.dot(sd);
    c.set(0, 0, 0).addScaledVector(lx, u).addScaledVector(ly, v).addScaledVector(sd, w);
    this.sun.target.position.copy(c);
    this.sun.position.copy(c).addScaledVector(sd, 150);
  }
}
