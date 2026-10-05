import * as THREE from 'three';
import * as WORLD from '../world.js';

const SKY = WORLD.SKY;

// Matériaux du décor : un seul matériau « architecture » pour presque tout ce qui
// est opaque (la couleur vient des sommets, le motif est calculé dans le shader
// selon le type de surface), plus le feuillage, les tissus et l'eau.
// Peu de matériaux = peu d'appels de dessin.

// Types de surface (attribut aKind)
export const K = {
  PLAIN: 0,
  PAVE: 1, // dalles sur le dessus, enduit sur les côtés
  FACADE: 2, // fenêtres sur les côtés, étanchéité sur le toit
  PLASTER: 3, // enduit doux
  WOOD: 4, // lames de bois
  CORAL: 5, // accent corail (vision du coureur)
  METAL: 6, // métal peint
  VENT: 7, // ventilation à lames
  GLASS: 8, // verre qui reflète le ciel
  SOIL: 9, // terre des jardinières
  GLOW: 10, // lumière chaude
  STONE: 11, // pierre de taille
  TERRA: 12, // terre cuite
  GRILLE: 13, // caillebotis / grille sombre
  ROOF: 14, // tuiles canal
  GRAVEL: 15, // gravier, galets
  MEMBRANE: 16, // relevé d'étanchéité (bitume à paillettes minérales)
};

// Les boîtes reçoivent des arêtes abattues et usées dans le shader. Les cylindres,
// tubes, géométries libres et tissus portent ce décalage sur leur type pour en être
// exemptés (le type entier reste lu avec floor(k + 0.5)).
export const NO_BEVEL = 0.25;

const COMMON_GLSL = /* glsl */ `
  float aHash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float aNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(aHash(i), aHash(i + vec2(1.0, 0.0)), u.x), mix(aHash(i + vec2(0.0, 1.0)), aHash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  // Distance (en mètres) à la ligne de grille la plus proche, sur un axe.
  float aGridDist(float x, float cell) { return abs(fract(x / cell + 0.5) - 0.5) * cell; }
  // Ligne anticrénelée : 1 sur la ligne, 0 ailleurs, s'efface quand elle devient plus fine qu'un pixel.
  float aLine(float d, float w, float fw) {
    float l = 1.0 - smoothstep(w - fw * 0.5, w + fw * 0.75, d);
    return l * (1.0 - smoothstep(w * 2.0, w * 7.0, fw));
  }
  // Rectangle anticrénelé
  float aRect(vec2 p, vec2 mn, vec2 mx, vec2 fw) {
    vec2 a = smoothstep(mn - fw * 0.5, mn + fw * 0.5, p);
    vec2 b = 1.0 - smoothstep(mx - fw * 0.5, mx + fw * 0.5, p);
    return a.x * a.y * b.x * b.y;
  }
  // Chanfrein simulé au bord des cellules d'une grille : -1 près du bord bas, +1 près du bord haut
  vec2 aBevel(vec2 p, vec2 cell, float w) {
    vec2 f = fract(p / cell) * cell;
    return (1.0 - smoothstep(0.0, w, cell - f)) - (1.0 - smoothstep(0.0, w, f));
  }
  vec3 aSky(vec3 r) {
    float h = r.y;
    vec3 c = mix(uSkyHorizon, uSkyUpper, smoothstep(0.0, 0.25, h));
    c = mix(c, uSkyZenith, smoothstep(0.2, 0.75, h));
    c = mix(c, uSkyLow, smoothstep(0.0, -0.25, h));
    float s = max(dot(r, uSunDir), 0.0);
    c += uSunCol * (pow(s, 8.0) * 0.5 + pow(s, 200.0) * 3.0);
    return c;
  }
`;

// Texture de bruit précalculée (répétable) : R grandes taches, G moyennes, B fines,
// A bruit blanc. Une lecture de texture remplace une vingtaine de hachages par pixel.
let noiseTex = null;
export function getNoiseTexture() {
  if (noiseTex) return noiseTex;
  const S = 256;
  const data = new Uint8Array(S * S * 4);
  let seed = 12345;
  const r = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const lattices = [4, 16, 64].map((c) => {
    const v = new Float32Array(c * c);
    for (let i = 0; i < v.length; i++) v[i] = r();
    return { c, v };
  });
  const smooth = (t) => t * t * (3 - 2 * t);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const o = (y * S + x) * 4;
      lattices.forEach(({ c, v }, ch) => {
        const fx = (x / S) * c, fy = (y / S) * c;
        const ix = Math.floor(fx), iy = Math.floor(fy);
        const tx = smooth(fx - ix), ty = smooth(fy - iy);
        const a = v[(iy % c) * c + (ix % c)], b = v[(iy % c) * c + ((ix + 1) % c)];
        const cc = v[((iy + 1) % c) * c + (ix % c)], d = v[((iy + 1) % c) * c + ((ix + 1) % c)];
        const val = (a + (b - a) * tx) * (1 - ty) + (cc + (d - cc) * tx) * ty;
        data[o + ch] = Math.round(val * 255);
      });
      data[o + 3] = Math.floor(r() * 256);
    }
  }
  noiseTex = new THREE.DataTexture(data, S, S, THREE.RGBAFormat, THREE.UnsignedByteType);
  noiseTex.wrapS = noiseTex.wrapT = THREE.RepeatWrapping;
  noiseTex.magFilter = THREE.LinearFilter;
  noiseTex.minFilter = THREE.LinearMipmapLinearFilter;
  noiseTex.generateMipmaps = true;
  noiseTex.needsUpdate = true;
  return noiseTex;
}

// Couleurs du ciel partagées avec world.js (avec des valeurs de repli si elles changent).
const sky = (key, fallback) => (SKY && SKY[key]) || fallback;

function skyUniforms() {
  return {
    uSkyZenith: { value: sky('zenith', new THREE.Color(0x8ea5d8)) },
    uSkyUpper: { value: sky('upper', new THREE.Color(0xc7b6e0)) },
    uSkyHorizon: { value: sky('horizon', new THREE.Color(0xffd6bd)) },
    uSkyLow: { value: new THREE.Color(0xf4e6e4) },
    uSunCol: { value: sky('sun', new THREE.Color(0xfff1da)) },
    uSunDir: { value: sky('sunDir', new THREE.Vector3(-0.85, 0.32, -0.42).normalize()) },
    uTime: { value: 0 },
    uNoise: { value: getNoiseTexture() },
  };
}

const SKY_DECL = /* glsl */ `
  uniform vec3 uSkyZenith, uSkyUpper, uSkyHorizon, uSkyLow, uSunCol, uSunDir;
  uniform float uTime;
  uniform sampler2D uNoise;
`;

// ---------------------------------------------------------------------------
// Architecture
// ---------------------------------------------------------------------------

const ARCH_VERT_HEAD = /* glsl */ `
  attribute float aKind;
  attribute vec3 aFace;
  flat varying float vKind;
  flat varying vec3 vFace;
  varying vec2 vLUv;
  varying vec3 vWPos;
  varying vec3 vWNrm;
`;

const ARCH_VERT_MAIN = /* glsl */ `
  vKind = aKind;
  vFace = aFace;
  vLUv = uv;
  vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
  vWNrm = normalize(mat3(modelMatrix) * objectNormal);
`;

const ARCH_FRAG_HEAD = /* glsl */ `
  flat varying float vKind;
  flat varying vec3 vFace;
  varying vec2 vLUv;
  varying vec3 vWPos;
  varying vec3 vWNrm;
  ${SKY_DECL}
  ${COMMON_GLSL}

  // Normale monde réécrite par le motif (relief simulé : tableaux des fenêtres, joints).
  vec3 pN;

  // Fenêtres d'une façade : baies en creux (parallaxe), tableaux éclairés ou dans
  // l'ombre selon le soleil, verre sombre qui reflète le ciel, appuis et coulures.
  void aWindows(inout vec3 col, inout float rough, inout vec3 emit, vec3 n, vec3 V, vec2 fw) {
    float W = vFace.x, H = vFace.y, st = vFace.z;
    vec2 uv = vLUv;
    // 0 : fenêtres percées, 1 : bandeaux vitrés, 2 : portes-fenêtres, 3 : mur rideau (tours)
    float style = st >= 0.97 ? 3.0 : floor(fract(st * 7.31) * 3.0);
    bool shut = (style == 0.0 || style == 2.0) && fract(st * 13.7) > 0.45;
    float band = 1.1 + 0.5 * fract(st * 3.7);
    float floorH = 3.1 + 0.5 * fract(st * 5.3);
    float bayW = style == 3.0 ? 1.5 : (style == 1.0 ? 1.6 + 0.4 * fract(st * 2.9) : 2.3 + 0.9 * fract(st * 9.1));
    float nb = max(1.0, floor(W / bayW + 0.5));
    float bw = W / nb;
    float vv = uv.y - band;
    float px = max(fw.x, fw.y);
    // Bandeau haut : enduit avec un joint
    float joint = aLine(abs(vv), 0.03, fw.y);
    col *= 1.0 - 0.10 * joint;
    if (vv < 0.0 || uv.y > H - 0.5) return;
    float flId = floor(vv / floorH);
    float fy = vv - flId * floorH;
    float bayId = floor(uv.x / bw);
    float fx = uv.x - bayId * bw;
    // Dalle de plancher
    float slab = aLine(fy, 0.02, fw.y);
    col *= 1.0 - 0.07 * slab;
    // Fenêtre
    vec2 mn, mx;
    if (style == 0.0) { mn = shut ? vec2(bw * 0.3, 0.55) : vec2(0.42, 0.55); mx = shut ? vec2(bw * 0.7, floorH - 0.95) : vec2(bw - 0.42, floorH - 0.95); }
    else if (style == 1.0) { mn = vec2(0.06, 0.7); mx = vec2(bw - 0.06, floorH - 0.85); }
    else if (style == 2.0) { mn = vec2(bw * 0.28, 0.35); mx = vec2(bw * 0.72, floorH - 0.3); }
    else { mn = vec2(0.0); mx = vec2(bw, floorH); }
    vec2 sz = mx - mn;
    vec2 p = vec2(fx, fy);
    // Verre vu de loin : bleu-gris sombre, un peu de ciel
    vec3 glassFar = vec3(0.08, 0.095, 0.13) + uSkyHorizon * 0.05 + uSkyUpper * 0.04;
    // Plus petites qu'un pixel : teinte moyenne (la grille reste lisible sans moiré)
    float cell = min(bw, floorH);
    float tiny = smoothstep(cell * 0.12, cell * 0.32, px);
    float cover = clamp(sz.x * sz.y / (bw * floorH), 0.0, 1.0);
    if (tiny > 0.999) {
      col = mix(col, glassFar, cover * 0.85);
      return;
    }
    float far = smoothstep(0.045, 0.16, px);
    float win = aRect(p, mn, mx, fw);
    float id0 = aHash(vec2(bayId + st * 31.0, flId + st * 17.0));
    // Encadrement de pierre claire autour des baies percées
    if (style != 1.0 && style != 3.0 && !shut) {
      float surr = aRect(p, mn - vec2(0.13, 0.13), mx + vec2(0.13, 0.0), fw) * (1.0 - aRect(p, mn, mx, fw));
      col = mix(col, col * 1.035 + 0.012, surr);
      // arête ombrée de l'encadrement (relief léger)
      float sEdge = aRect(p, mn - vec2(0.13, 0.13), mx + vec2(0.13, 0.0), fw) - aRect(p, mn - vec2(0.1, 0.1), mx + vec2(0.1, 0.0), fw);
      col *= 1.0 - 0.07 * sEdge * (1.0 - far);
    }
    // Volets peints de part et d'autre (couleurs douces), parfois fermés
    if (shut) {
      float swd = sz.x * 0.5;
      float sh = aRect(p, vec2(mn.x - swd, mn.y), vec2(mn.x - 0.03, mx.y), fw) + aRect(p, vec2(mx.x + 0.03, mn.y), vec2(mx.x + swd, mx.y), fw);
      float closed = step(0.88, id0) * win;
      float pal = fract(st * 23.1);
      vec3 shc = pal < 0.2 ? vec3(0.4, 0.5, 0.42) : pal < 0.4 ? vec3(0.38, 0.46, 0.58) : pal < 0.6 ? vec3(0.34, 0.5, 0.5) : pal < 0.8 ? vec3(0.66, 0.42, 0.34) : vec3(0.55, 0.52, 0.64);
      float lou = aLine(aGridDist(p.y, 0.07), 0.012, fw.y) * (1.0 - far);
      // cadre et traverse des vantaux, persiennes plus sombres entre les deux
      float lx0 = mn.x - swd, lx1 = mn.x - 0.03, rx0 = mx.x + 0.03, rx1 = mx.x + swd;
      float ex = p.x < mn.x ? min(p.x - lx0, lx1 - p.x) : min(p.x - rx0, rx1 - p.x);
      float ey = min(p.y - mn.y, mx.y - p.y);
      float sfr = 1.0 - smoothstep(0.045, 0.06 + fw.x, min(ex, ey));
      float rail = aLine(abs(p.y - (mn.y + mx.y) * 0.52), 0.035, fw.y);
      float fr = max(sfr, rail) * (1.0 - far);
      shc *= mix(0.8 - 0.22 * lou, 1.0, fr);
      // ombre portée du volet sur le mur
      float m = clamp(sh + closed, 0.0, 1.0);
      col = mix(col, shc, m);
      rough = mix(rough, 0.7, m);
      win *= 1.0 - closed;
    }
    // Appui saillant, son ombre et les coulures qu'il laisse sur l'enduit
    float sill = aRect(p, vec2(mn.x - 0.1, mx.y), vec2(mx.x + 0.1, mx.y + 0.08), fw);
    float sillShadow = aRect(p, vec2(mn.x - 0.1, mx.y + 0.08), vec2(mx.x + 0.1, mx.y + 0.2), fw);
    float below = clamp((p.y - mx.y - 0.08) / 1.7, 0.0, 1.0);
    float xin = aRect(vec2(p.x, 0.5), vec2(mn.x + 0.05, 0.0), vec2(mx.x - 0.05, 1.0), fw);
    float drip = smoothstep(0.35, 0.85, textureLod(uNoise, vec2(uv.x * 0.43 + st * 7.0, uv.y * 0.02), 0.0).b);
    float stain = xin * step(mx.y + 0.08, p.y) * (1.0 - below) * (1.0 - below) * (0.35 + 0.65 * drip);
    col *= (1.0 + 0.08 * sill) * (1.0 - 0.16 * sillShadow * (1.0 - far)) * (1.0 - 0.12 * stain * (1.0 - tiny));
    if (win <= 0.0) {
      col = mix(col, glassFar, cover * 0.85 * tiny);
      return;
    }
    float id = id0;
    // --- Baie en creux : on suit le rayon de vue derrière le nu du mur ---
    float depth = style == 3.0 ? 0.07 : (style == 1.0 ? 0.18 : 0.28);
    vec3 T = normalize(cross(vec3(0.0, 1.0, 0.0), n));
    float vn = max(-dot(V, n), 0.06);
    vec2 vt = vec2(dot(V, T), -V.y) / vn;
    vec2 q = p - mn;
    vec2 sxy = vec2(
      vt.x > 0.0 ? (sz.x - q.x) / max(vt.x, 1e-4) : q.x / max(-vt.x, 1e-4),
      vt.y > 0.0 ? (sz.y - q.y) / max(vt.y, 1e-4) : q.y / max(-vt.y, 1e-4));
    vec2 rv = clamp((depth - sxy) * abs(vt) / max(fw, vec2(1e-4)) + 0.5, 0.0, 1.0);
    bool xFirst = sxy.x < sxy.y;
    float reveal = (xFirst ? rv.x : rv.y) * (1.0 - far);
    float sHit = min(min(sxy.x, sxy.y), depth);
    vec2 hit = q + vt * sHit;
    vec3 rN = xFirst ? (vt.x > 0.0 ? -T : T) : (vt.y > 0.0 ? vec3(0.0, 1.0, 0.0) : vec3(0.0, -1.0, 0.0));
    // Ombre du soleil dans l'embrasure : on remonte vers le soleil jusqu'au nu du mur
    float ln = dot(uSunDir, n);
    float sunK = smoothstep(0.0, 0.18, ln);
    vec2 lt = vec2(dot(uSunDir, T), -uSunDir.y) / max(ln, 0.05);
    vec2 front = hit + lt * sHit;
    float recShadow = (1.0 - aRect(front, vec2(0.0), sz, fw * 1.5)) * sunK * (1.0 - far);
    // Coordonnées sur le plan du vitrage (parallaxe des menuiseries)
    vec2 g = q + vt * depth;
    g = mix(g, q, far);
    float frameD = min(min(g.x, sz.x - g.x), min(g.y, sz.y - g.y));
    float frame = 1.0 - smoothstep(0.05 - fw.x, 0.05 + fw.x, frameD);
    float mull = style == 3.0 ? 0.0 : style == 1.0 ? aLine(aGridDist(g.x, max(0.8, sz.x / floor(sz.x / 1.0 + 0.5))), 0.025, fw.x) : aLine(abs(g.x - sz.x * 0.5), 0.025, fw.x);
    float tran = aLine(abs(g.y - sz.y * 0.32), 0.02, fw.y) * step(1.0, style);
    frame = max(frame, max(mull, tran) * (1.0 - far));
    // Verre : reflet du ciel
    vec3 R = reflect(V, n);
    R.y = abs(R.y) * 0.8 + 0.1 + 0.05 * (id - 0.5);
    R = normalize(R);
    float fres = 0.04 + 0.96 * pow(1.0 - max(dot(-V, n), 0.0), 5.0);
    vec3 glass = vec3(0.05, 0.06, 0.09) * (0.8 + 0.4 * id);
    vec3 refl = aSky(R);
    float az = atan(R.x, R.z);
    vec4 sn = textureLod(uNoise, vec2(az * 0.6, 0.31), 0.0);
    float sky = smoothstep(0.0, 0.02, R.y - 0.12 - 0.07 * sn.r - 0.05 * step(0.62, sn.b));
    refl = mix(refl * vec3(0.5, 0.5, 0.56), refl, sky);
    // quelques vitres prennent davantage le ciel
    float bright = step(0.78, fract(id * 5.3));
    vec3 glassEmit = refl * (0.02 + 0.92 * fres + 0.08 * bright) * (0.8 + 0.4 * id);
    float spandrel = style == 3.0 ? step(floorH - 0.95, g.y) : 0.0;
    glass = mix(glass, vec3(0.3, 0.32, 0.37), spandrel);
    glassEmit *= 1.0 - 0.5 * spandrel;
    float curtain = step(style == 3.0 ? 2.0 : 0.6, id) * smoothstep(0.0, 0.02, sz.x * (0.25 + 0.3 * fract(id * 13.0)) - abs(g.x - (fract(id * 7.0) > 0.5 ? 0.0 : sz.x)));
    vec3 inside = mix(glass, vec3(0.8, 0.7, 0.62) * 0.8, curtain * 0.85);
    vec3 insideEmit = mix(glassEmit, vec3(1.0, 0.72, 0.48) * 0.1, curtain * 0.7);
    if (id > 0.92) insideEmit += vec3(1.0, 0.7, 0.45) * 0.16;
    vec3 frameCol = mix(vec3(0.9, 0.88, 0.85), vec3(0.32, 0.31, 0.34), step(0.5, fract(st * 4.3)));
    vec3 wc = mix(inside, frameCol, frame);
    vec3 we = insideEmit * (1.0 - frame);
    // ombre du linteau et du tableau sur la vitre
    wc *= 1.0 - 0.6 * recShadow;
    we *= 1.0 - 0.3 * recShadow;
    // Tableaux (côtés de l'embrasure) : enduit, plus sombre au fond
    vec3 revCol = col * (rN.y > 0.5 ? 1.02 : 0.9) * (1.0 - 0.32 * sHit / depth) * (1.0 - 0.55 * recShadow);
    wc = mix(wc, revCol, reveal);
    we *= 1.0 - reveal;
    // Au loin : verre sombre uniforme
    wc = mix(wc, glassFar, far * 0.7);
    we *= 1.0 - far * 0.6;
    col = mix(col, wc, win);
    emit += we * win;
    pN = normalize(mix(pN, rN, reveal * win));
    rough = mix(rough, mix(mix(0.12, 0.6, frame), 0.85, reveal), win);
  }

  // Gravillons roulés : deux lits décalés de cailloux de 2 à 5 cm, chacun sa teinte
  // (crème, gris doux, ocre, quelques sombres), bombés (ils prennent le soleil d'un
  // côté et gardent l'ombre de l'autre), interstices sombres. density < 1 : cailloux
  // épars sur le fond (base). Au-delà de quelques mètres, la teinte moyenne et des
  // nappes plus claires ou plus sombres prennent le relais, sans scintillement.
  vec3 aPebbleCol(float h) {
    return h < 0.42 ? vec3(0.8, 0.76, 0.7) : h < 0.66 ? vec3(0.64, 0.63, 0.62) : h < 0.86 ? vec3(0.78, 0.65, 0.52) : vec3(0.44, 0.43, 0.42);
  }
  vec3 aGravel(vec3 base, vec2 p, float px, float density, float sz) {
    vec3 avg = vec3(0.6, 0.57, 0.53);
    float clump = textureLod(uNoise, p * 0.09 + 0.3, 0.0).g;
    float tone = 0.86 + 0.28 * clump;
    // à mi-distance, un moucheté filtré par les mipmaps garde l'idée du gravier
    float spk = texture2D(uNoise, p * (0.0039 / sz) + 0.21).a;
    float spk2 = texture2D(uNoise, p * (0.0052 / sz) + 0.63).b;
    vec3 far = mix(base, avg * tone * (0.78 + 0.44 * spk) * (0.9 + 0.2 * spk2), density);
    float fade = 1.0 - smoothstep(0.006 * sz / 0.042, 0.024 * sz / 0.042, px);
    if (fade <= 0.0) return far;
    vec3 acc = vec3(0.0);
    vec2 bn = vec2(0.0);
    float cover = 0.0;
    for (int L = 0; L < 2; L++) {
      float fl = float(L);
      vec2 q = p / sz + fl * vec2(0.5, 0.37);
      vec2 id = floor(q);
      float h = aHash(id + fl * 17.0);
      float h2 = aHash(id + 31.0 + fl * 7.0);
      vec2 f = fract(q) - 0.5 - (vec2(h, h2) - 0.5) * 0.28;
      float r = (0.25 + 0.2 * h2) * (L == 0 ? 1.0 : 0.85);
      // galets oblongs, chacun tourné à sa façon
      float an = h2 * 6.2832;
      vec2 cs = vec2(cos(an), sin(an));
      vec2 fr = vec2(f.x * cs.x + f.y * cs.y, f.y * cs.x - f.x * cs.y);
      fr.y *= 1.15 + 0.55 * fract(h * 5.1);
      float d = length(fr) / r;
      float m = (1.0 - smoothstep(0.78, 1.0, d)) * step(fract(h * 11.3), density) * (1.0 - cover);
      acc += aPebbleCol(fract(h * 7.13)) * (0.86 + 0.24 * fract(h * 3.7)) * m;
      bn += f / r * m;
      cover += m;
    }
    vec3 gap = mix(base, avg * 0.42, smoothstep(0.35, 0.8, density));
    vec3 near = (acc + gap * (1.0 - cover)) * tone;
    pN = normalize(pN + vec3(bn.x, 0.0, bn.y) * 0.95 * fade);
    return mix(far, near, fade);
  }

  // Grain d'enduit : petites bosses qui prennent la lumière rasante (de près seulement).
  // Renvoie le gradient (du, dv) d'un relief de deux échelles (1,5 et 4 cm).
  vec2 aGrain(vec2 q, vec2 fw, float amp) {
    float px = max(fw.x, fw.y);
    float fade = 1.0 - smoothstep(0.005, 0.02, px);
    if (fade <= 0.0) return vec2(0.0);
    const float e = 1.0 / 256.0;
    vec2 t1 = q * 0.26, t2 = q * 0.42 + 0.17;
    float a0 = textureLod(uNoise, t1, 0.0).a, ax = textureLod(uNoise, t1 + vec2(e, 0.0), 0.0).a, ay = textureLod(uNoise, t1 + vec2(0.0, e), 0.0).a;
    float b0 = textureLod(uNoise, t2, 0.0).b, bx = textureLod(uNoise, t2 + vec2(e, 0.0), 0.0).b, by = textureLod(uNoise, t2 + vec2(0.0, e), 0.0).b;
    float fine = 1.0 - smoothstep(0.003, 0.009, px);
    // très près (course murale), le relief large se calme : on garde surtout le grain fin
    float close = smoothstep(0.0008, 0.003, px);
    return (vec2(a0 - ax, a0 - ay) * 0.6 * fine + vec2(b0 - bx, b0 - by) * (1.2 + 1.0 * close)) * amp * fade;
  }

  // Arêtes abattues et usées : le chanfrein est simulé par la normale (il accroche le
  // soleil ou se creuse d'ombre), le fil de l'arête s'use et s'épaufre par endroits,
  // et la matière à nu apparaît (l'enduit clair sous la peinture corail, la pierre
  // plus sombre sous le calcin). Lisible de 2 à 15 m, s'efface au loin.
  void aEdges(inout vec3 col, inout float rough, float kind, vec2 uv, float W, float H, vec2 fw, vec3 Tu, vec3 Tv, float seed) {
    float dU = min(uv.x, W - uv.x), dV = min(uv.y, H - uv.y);
    bool onU = dU < dV;
    // largeur mesurée en travers de l'arête la plus proche (nette même vue en enfilade)
    float across = onU ? fw.x : fw.y;
    float fade = 1.0 - smoothstep(0.1, 0.35, across);
    float lim = 0.3 * min(W, H);
    vec2 cw = min(max(vec2(0.024), fw * 1.6), vec2(min(lim, 0.08)));
    // loin de toute arête (l'essentiel d'une grande face) : rien à faire
    if (fade <= 0.0 || min(dU / cw.x, dV / cw.y) > 6.3) return;
    float along = onU ? uv.y + step(W * 0.5, uv.x) * 31.0 : uv.x + 57.0 + step(H * 0.5, uv.y) * 23.0;
    vec4 cn = textureLod(uNoise, vec2(along * 0.085 + seed * 7.0, seed * 3.1 + 0.37), 0.0);
    float cw2 = textureLod(uNoise, vec2(along * 0.6 + seed * 3.0, seed * 5.3 + 0.11), 0.0).b;
    float chip = smoothstep(0.66, 0.76, cn.b * 0.75 + cn.r * 0.25) * (1.0 - smoothstep(0.02, 0.06, across));
    chip *= (kind == 4.0 || kind == 6.0 || kind == 7.0) ? 0.0 : 1.0;
    float grow = 1.0 + chip * (2.2 + 3.0 * cw2);
    vec2 bite = min(cw * grow, vec2(lim));
    vec4 d = vec4(uv.x, W - uv.x, uv.y, H - uv.y);
    vec4 f = 1.0 - smoothstep(vec4(0.0), bite.xxyy, d);
    vec3 tilt = Tu * (f.y - f.x) + Tv * (f.w - f.z);
    pN = normalize(pN + tilt * fade);
    float e = max(max(f.x, f.y), max(f.z, f.w));
    col *= 1.0 + 0.04 * e * fade;
    float inChip = smoothstep(0.32, 0.6, e) * chip;
    vec3 bare = kind == 5.0 ? vec3(0.62, 0.55, 0.48) : col * vec3(0.8, 0.78, 0.76);
    col = mix(col, bare * (0.9 + 0.14 * cw2), inChip);
    rough = mix(rough, 0.95, inChip);
  }

  void aPattern(inout vec3 col, inout float rough, inout float metal, inout vec3 emit) {
    float kind = floor(vKind + 0.5);
    float bevelOK = step(fract(vKind + 0.01), 0.1);
    vec3 n = normalize(vWNrm);
    vec3 V = normalize(vWPos - cameraPosition);
    float isTop = step(0.6, n.y);
    float isSide = 1.0 - step(0.6, abs(n.y));
    vec2 uv = vLUv;
    // Toutes les dérivées sont calculées ici, hors de tout branchement.
    vec2 fw = max(fwidth(uv), vec2(1e-4));
    vec2 fwp = max(fwidth(vWPos.xz), vec2(1e-4));
    float W = vFace.x, H = vFace.y;
    // Repère de la face (sens des u et des v croissants), pour les chanfreins
    vec3 Tu, Tv;
    {
      vec3 dpx = dFdx(vWPos), dpy = dFdy(vWPos);
      vec2 dux = dFdx(uv), duy = dFdy(uv);
      vec3 r1 = cross(dpy, n), r2 = cross(n, dpx);
      vec3 gu = r1 * dux.x + r2 * duy.x;
      vec3 gv = r1 * dux.y + r2 * duy.y;
      Tu = gu / max(length(gu), 1e-9);
      Tv = gv / max(length(gv), 1e-9);
    }
    if (isSide > 0.5) { Tu = normalize(cross(vec3(0.0, 1.0, 0.0), n)); Tv = vec3(0.0, -1.0, 0.0); }
    // Graine propre à chaque face (son plan, quantifié pour être rigoureusement constant
    // sur la face malgré l'interpolation, et ses dimensions)
    float seed = fract(floor(dot(vWPos, n) * 4.0 + 0.37) * 0.1545 + (W + H) * 0.1373);
    // Blancs adoucis : au-delà de 0,62 l'albédo est comprimé, pour que joints,
    // fenêtres et patine gardent leur dessin en plein soleil.
    if (kind != 10.0) {
      float mxc = max(col.r, max(col.g, col.b));
      float knee = kind == 5.0 ? 0.8 : 0.62;
      if (mxc > knee) col *= (knee + (mxc - knee) * 0.55) / mxc;
    }
    // Arêtes légèrement éclaircies : faux chanfrein qui accroche la lumière
    float ed = min(min(uv.x, W - uv.x), min(uv.y, H - uv.y));
    float edge = 1.0 - smoothstep(0.0, 0.035 + fw.x, ed);
    // Grain général très doux
    vec2 wp = isTop > 0.5 ? vWPos.xz : vec2(vWPos.x + vWPos.z, vWPos.y);
    vec4 nz = texture2D(uNoise, wp * 0.045);
    float bigLow = texture2D(uNoise, wp.yx * 0.0163 + 0.37).r;
    float big = nz.r * 0.5 + bigLow * 0.3 + nz.g * 0.2;
    float fine = nz.b;
    // Les grandes façades s'assombrissent doucement vers le bas (profondeur, brume).
    col *= mix(1.0, mix(0.74, 1.0, exp(-clamp(uv.y, 0.0, 400.0) * 0.025)), isSide);

    if (kind == 1.0) { // dalles / enduit
      if (isTop > 0.5) {
        // Taille des dalles selon le style (petits carreaux de terre cuite -> grandes dalles)
        float ts = mix(0.4, 1.3, vFace.z);
        vec2 pp = vWPos.xz;
        // rangs décalés pour les grandes dalles
        pp.x += step(0.75, vFace.z) * step(0.5, fract(pp.y / ts * 0.5)) * ts * 0.5;
        vec2 tid = floor(pp / ts);
        float h = aHash(tid);
        float g = max(aLine(aGridDist(pp.x, ts), 0.012, fwp.x), aLine(aGridDist(pp.y, ts), 0.012, fwp.y));
        float h2 = aHash(tid + 17.3);
        float tv = mix(0.24, 0.22, step(0.75, vFace.z));
        col *= (1.0 - tv * 0.5 + tv * h) * (0.9 + 0.16 * big) * (0.97 + 0.06 * fine);
        // quelques dalles remplacées, plus sombres ou plus chaudes
        col *= h2 > 0.94 ? 0.86 : (h2 < 0.05 ? 1.04 : 1.0);
        col = mix(col, col * vec3(1.03, 0.97, 0.92), step(0.9, h) * 0.6);
        // joints encrassés, mousse par endroits
        float moss = smoothstep(0.55, 0.75, big) * (1.0 - smoothstep(0.08, 0.2, max(fwp.x, fwp.y)));
        col *= 1.0 - (0.27 + 0.12 * moss) * g;
        // arêtes des dalles légèrement abattues : accrochent le soleil rasant
        vec2 bv = aBevel(pp, vec2(ts), 0.035) * (1.0 - smoothstep(0.006, 0.03, max(fwp.x, fwp.y)));
        pN = normalize(n + vec3(bv.x * 0.3, 0.0, bv.y * 0.3));
        col = mix(col, col * vec3(0.78, 0.86, 0.66), g * moss * 0.8);
        // fissures fines sur quelques grandes dalles
        float crackOn = step(0.88, h2) * step(0.9, ts) * (1.0 - smoothstep(0.02, 0.06, max(fwp.x, fwp.y)));
        vec2 tl = pp / ts - tid;
        float cn = texture2D(uNoise, (tl + tid * 0.37) * 0.35).g;
        float seg = smoothstep(0.35, 0.6, texture2D(uNoise, (tl + tid * 0.21) * 0.6 + 0.5).b);
        float crack = aLine(abs(cn - 0.5 + (tl.x - 0.5) * 0.15), 0.004, max(fwp.x, fwp.y) / ts * 2.0) * crackOn * seg;
        col *= 1.0 - 0.2 * crack;
        // taches d'eau séchée, grandes et douces, cernées d'une auréole
        float wl = texture2D(uNoise, vWPos.xz * 0.013 + 0.71).r * 0.8 + texture2D(uNoise, vWPos.xz * 0.05 + 0.2).g * 0.2;
        float wet = smoothstep(0.56, 0.74, wl);
        float nearP = 1.0 - smoothstep(0.015, 0.06, max(fwp.x, fwp.y));
        float tide = (1.0 - smoothstep(0.0, 0.006, abs(wl - 0.585))) * nearP;
        col *= (1.0 - 0.13 * wet) * (1.0 - 0.24 * tide);
        // lichens : petites rosettes pâles semées sur la pierre (plus près des rives)
        {
          vec2 lp = vWPos.xz * 3.1;
          vec2 li = floor(lp);
          float lhh = aHash(li + 31.7);
          vec2 lo = (vec2(fract(lhh * 7.3), fract(lhh * 3.9)) - 0.5) * 0.45;
          float lr = 0.13 + 0.2 * fract(lhh * 13.1);
          float lich = (1.0 - smoothstep(lr - 0.07, lr, length(fract(lp) - 0.5 - lo))) * step(0.935, lhh) * nearP;
          col = mix(col, col * vec3(0.86, 0.88, 0.7), lich * 0.75);
        }
        rough = 0.78 + 0.12 * h - 0.12 * wet;
        // quelques dalles polies par les pas : elles prennent le soleil rasant
        if (h2 > 0.3 && h2 < 0.42) rough = 0.5;
        // grandes terrasses : crasse et mousse le long des rives, au pied des murets
        if (min(W, H) > 5.0) {
          float de = min(min(uv.x, W - uv.x), min(uv.y, H - uv.y));
          float rn = texture2D(uNoise, vWPos.xz * 0.15 + 0.4).b;
          float rim = 1.0 - smoothstep(0.04, 0.5, de + (rn - 0.5) * 0.3);
          col *= 1.0 - 0.2 * rim;
          col = mix(col, col * vec3(0.84, 0.9, 0.74), rim * smoothstep(0.45, 0.7, big) * 0.7);
          rough = mix(rough, 0.95, rim);
        }
      } else {
        float j = aLine(aGridDist(uv.y, 1.25), 0.01, fw.y) * isSide;
        col *= (0.95 + 0.07 * big) * (1.0 - 0.07 * j);
        rough = 0.88;
      }
      col *= 1.0 + 0.07 * edge;
    } else if (kind == 2.0) { // façade
      if (isSide > 0.5) {
        col *= 0.95 + 0.08 * big;
        aWindows(col, rough, emit, n, V, fw);
      } else if (isTop > 0.5 && n.y < 0.95) {
        // chanfrein de rive : enduit lissé, un peu encrassé
        col *= (0.9 + 0.08 * big) * 0.94;
        rough = 0.88;
      } else if (isTop > 0.5) {
        // Toit-terrasse : lés d'étanchéité soudés (bourrelets qui accrochent le soleil),
        // rustines, gravier de lestage en rive et par plaques, auréoles de flaques.
        vec2 p = vWPos.xz;
        float sd = fract(vFace.z * 9.13);
        float nearR = 1.0 - smoothstep(0.02, 0.07, max(fwp.x, fwp.y));
        float rid = floor(p.x);
        float zl = p.y + aHash(vec2(rid, sd)) * 7.0;
        float eid = floor(zl / 7.0);
        float sx = fract(p.x);
        float sz = zl - eid * 7.0;
        float weltX = (1.0 - smoothstep(0.0, 0.045 + fwp.x, sx)) * (1.0 - smoothstep(0.03, 0.09, fwp.x));
        float weltZ = (1.0 - smoothstep(0.0, 0.045 + fwp.y, sz)) * (1.0 - smoothstep(0.03, 0.09, fwp.y));
        float bead = max(aLine(min(sx, 1.0 - sx), 0.013, fwp.x), aLine(min(sz, 7.0 - sz), 0.013, fwp.y));
        float sheet = aHash(vec2(rid, eid) + sd * 13.0);
        // la rive haute du lé (bourrelet soudé) : fil clair qui se lit de loin
        float hi = aLine(abs(sx - 0.03), 0.012, fwp.x) + aLine(abs(sz - 0.03), 0.012, fwp.y);
        col = mix(col, vec3(0.66, 0.63, 0.6), 0.45) * 0.92;
        col *= (0.86 + 0.22 * big) * (0.94 + 0.1 * fine) * (0.88 + 0.2 * sheet) * (1.0 - 0.4 * bead) * (1.0 + 0.12 * min(hi, 1.0));
        pN = normalize(pN + vec3(-0.7 * weltX, 0.0, -0.7 * weltZ));
        // rustines : pièces de membrane plus fraîches, au bord marqué
        vec2 pc = floor(p / 2.6);
        float ph = aHash(pc + sd * 7.0 + 5.3);
        vec2 pl = p - pc * 2.6;
        vec2 pm = vec2(0.15 + 1.1 * fract(ph * 7.1), 0.15 + 1.1 * fract(ph * 3.3));
        vec2 pM = min(pm + vec2(0.45 + 0.8 * fract(ph * 5.7), 0.35 + 0.7 * fract(ph * 9.1)), vec2(2.45));
        float rp = aRect(pl, pm, pM, fwp + 0.004) * step(0.64, ph);
        float rpe = max(rp - aRect(pl, pm + 0.035, pM - 0.035, fwp), 0.0);
        col *= mix(1.0, step(0.88, ph) > 0.5 ? 1.12 : 0.74 + 0.1 * fract(ph * 17.0), rp) * (1.0 - 0.28 * rpe);
        // auréoles de flaques séchées (là où l'eau stagne, la membrane est plus lisse)
        float L = texture2D(uNoise, p * 0.019 + sd).r * 0.7 + texture2D(uNoise, p * 0.071 + sd).g * 0.3;
        float pond = smoothstep(0.6, 0.63, L);
        float tide = (1.0 - smoothstep(0.0, 0.007, abs(L - 0.605))) * nearR;
        col *= (1.0 - 0.1 * pond) * (1.0 - 0.32 * tide);
        // gravillons de lestage : nappe presque partout, plus épaisse le long des
        // relevés ; le vent et les pas ont balayé quelques plaques où la membrane
        // réapparaît, cernée de cailloux épars.
        float de = min(min(uv.x, W - uv.x), min(uv.y, H - uv.y));
        float sw = texture2D(uNoise, p * 0.045 + sd).g * 0.7 + texture2D(uNoise, p * 0.017 + sd + 0.4).r * 0.3;
        float density = 1.0 - smoothstep(0.6, 0.7, sw) * smoothstep(0.5, 1.4, de);
        // sous les flaques séchées, gravier plus fin et plus sombre
        vec3 mem = col;
        pN = normalize(mix(pN, n, density));
        col = aGravel(mem, p, max(fwp.x, fwp.y), density, 0.046);
        col *= 1.0 - 0.12 * pond * density;
        // mousse et lichens dans les nappes épaisses, du côté de l'ombre des rives
        float mossG = smoothstep(0.6, 0.8, texture2D(uNoise, p * 0.11 + sd + 0.7).g) * density * (1.0 - smoothstep(0.2, 0.9, de));
        col = mix(col, col * vec3(0.84, 0.9, 0.7), mossG * 0.6);
        // crasse et ombre au pied des relevés
        col *= 1.0 - 0.26 * (1.0 - smoothstep(0.0, 0.35, de));
        rough = mix(mix(0.92, 0.5, pond), 1.0, density);
      }
      col *= 1.0 + 0.05 * edge;
    } else if (kind == 3.0) { // enduit
      col *= (0.955 + 0.06 * big) * (0.99 + 0.02 * fine);
      if (isTop > 0.5 && min(W, H) > 0.25) {
        // dessus des corniches, bandeaux et chaperons : crasse déposée, lichens, plus
        // propre au bord où la pluie lave
        float de = min(min(uv.x, W - uv.x), min(uv.y, H - uv.y));
        float dirt = smoothstep(0.35, 0.75, texture2D(uNoise, vWPos.xz * 0.21 + seed).g * 0.6 + texture2D(uNoise, vWPos.xz * 0.06).r * 0.4);
        col *= 1.0 - 0.15 * dirt * smoothstep(0.03, 0.2, de);
        col = mix(col, col * vec3(0.9, 0.92, 0.8), smoothstep(0.7, 0.85, big) * 0.5);
      }
      if (isSide > 0.5 && W > 1.0 && H > 0.45) {
        // mouchetis de l'enduit et reprises : rectangles refaits, un ton plus clair ou plus gris
        col *= 0.95 + 0.1 * texture2D(uNoise, uv * vec2(0.21, 0.18) + seed).b;
        // nuées de l'enduit à l'échelle du mètre
        col *= 0.93 + 0.13 * texture2D(uNoise, uv * 0.045 + seed * 2.0).g;
        vec2 cs = vec2(1.9, 1.15);
        vec2 pc = floor(uv / cs);
        float ph = aHash(pc + seed * 11.0);
        vec2 pl = uv - pc * cs;
        vec2 pm = vec2(0.1 + 0.8 * fract(ph * 7.3), 0.08 + 0.5 * fract(ph * 3.7));
        vec2 pM = min(pm + vec2(0.35 + 0.7 * fract(ph * 5.3), 0.25 + 0.45 * fract(ph * 9.1)), cs - 0.05);
        float rp = aRect(pl, pm, pM, fw + 0.008) * step(0.7, ph) * (1.0 - smoothstep(0.04, 0.12, max(fw.x, fw.y)));
        col *= mix(1.0, step(0.86, ph) > 0.5 ? 1.06 : 0.91, rp);
        float rpe = max(rp - aRect(pl, pm + 0.02, pM - 0.02, fw + 0.004), 0.0);
        col *= 1.0 - 0.08 * rpe;
      }
      col *= 1.0 + 0.08 * edge;
      rough = 0.86;
    } else if (kind == 4.0) { // bois
      bool alongU = isSide > 0.5 ? true : W >= H;
      float across = alongU ? uv.y : uv.x;
      float along = alongU ? uv.x : uv.y;
      float pid = floor(across / 0.16);
      float ph = aHash(vec2(pid, 3.0));
      float gap = aLine(aGridDist(across, 0.16), 0.006, alongU ? fw.y : fw.x);
      float grain = textureLod(uNoise, vec2(along * 0.1 + ph, across * 0.6), 1.0).b;
      col *= (0.9 + 0.16 * ph) * (0.9 + 0.14 * grain) * (1.0 - 0.35 * gap);
      col *= 1.0 + 0.06 * edge;
      if (isTop > 0.5) {
        // lames bombées : arêtes arrondies
        float bvw = aBevel(vec2(across), vec2(0.16), 0.03).x * (1.0 - smoothstep(0.006, 0.025, alongU ? fw.y : fw.x));
        pN = normalize(n + vec3(alongU ? 0.0 : bvw * 0.45, 0.0, alongU ? bvw * 0.45 : 0.0));
      }
      rough = 0.7;
    } else if (kind == 5.0) { // corail : enduit peint à grain, levées, joints creux, reprises, écaillures
      col *= (0.95 + 0.06 * big);
      rough = 0.64;
      if (isSide > 0.5 && W > 1.0 && H > 1.2) {
        // fondus par axe : vu en enfilade (course murale), les levées horizontales restent nettes
        float nearC = 1.0 - smoothstep(0.03, 0.08, max(fw.x, fw.y));
        float nearY = 1.0 - smoothstep(0.04, 0.12, fw.y);
        // levées d'enduit d'environ 1,3 m au bord ondulé, chacune de sa teinte
        vec4 rn = textureLod(uNoise, vec2(uv.x * 0.09 + seed * 5.0, 0.21 + seed), 0.0);
        float ly = uv.y + (rn.g - 0.5) * 0.1 + (rn.b - 0.5) * 0.04;
        float lid = floor(ly / 1.3);
        float lh = aHash(vec2(lid, seed * 37.0));
        float lj = aLine(aGridDist(ly, 1.3), 0.009, fw.y);
        // joints creux verticaux tous les 2,4 m : le rythme se lit en course murale
        float sxg = fract(uv.x / 2.4 + 0.5) - 0.5;
        float gx = abs(sxg) * 2.4;
        float groove = aLine(gx, 0.013, fw.x);
        float cell = aHash(vec2(floor(uv.x / 2.4), lid) + seed * 3.1);
        // grain : mouchetis de 5 à 10 cm, nuées de la peinture
        float mott = texture2D(uNoise, uv * vec2(0.23, 0.2) + seed).b;
        float cloud = texture2D(uNoise, uv * vec2(0.05, 0.04) + seed * 2.0).g;
        col *= (0.93 + 0.13 * mix(0.5, lh, nearY)) * (0.97 + 0.06 * cell) * (0.93 + 0.14 * mix(0.5, mott, nearC)) * (0.9 + 0.18 * cloud);
        // chaque levée et chaque nuée a sa nuance (du saumon à l'orangé) : le dessin
        // survit même quand le rouge sature en plein soleil
        float hueL = mix(0.5, lh, nearY) - 0.5;
        col *= vec3(1.0 + 0.06 * hueL, 1.0 + 0.3 * hueL + 0.14 * (cloud - 0.5), 1.0 + 0.38 * hueL + 0.2 * (cloud - 0.5));
        // reprises : rectangles repeints, plus frais, au bord net
        vec2 cl = vec2(uv.x - floor(uv.x / 2.4) * 2.4, ly - lid * 1.3);
        vec2 pm = vec2(0.15 + 1.1 * fract(cell * 7.3), 0.12 + 0.45 * fract(cell * 3.9));
        vec2 pM = min(pm + vec2(0.45 + 0.8 * fract(cell * 5.1), 0.3 + 0.5 * fract(cell * 9.7)), vec2(2.3, 1.22));
        float rp = aRect(cl, pm, pM, fw + 0.006) * step(0.72, cell);
        col = mix(col, col * vec3(1.04, 1.14, 1.06), rp);
        float rpe = max(rp - aRect(cl, pm + 0.025, pM - 0.025, fw + 0.004), 0.0);
        col *= 1.0 - 0.07 * rpe * nearC;
        // grands murs : plus sombres et plus humides vers le bas (au-dessus du vide)
        col *= mix(1.0, 0.84, smoothstep(4.5, 13.0, uv.y));
        // haut délavé par le soleil, coulures sous le couronnement
        float sunFade = exp(-uv.y * 0.3);
        col = mix(col, vec3(dot(col, vec3(0.3, 0.5, 0.2))) * vec3(1.2, 1.0, 0.9), 0.12 * sunFade);
        vec4 sk = textureLod(uNoise, vec2(uv.x * 0.34 + seed, uv.y * 0.018 + seed), 0.0);
        float run = smoothstep(0.42, 0.85, sk.b * 0.6 + sk.g * 0.4) * exp(-uv.y * 0.2);
        col *= 1.0 - 0.17 * run;
        col = mix(col, col * vec3(0.9, 0.84, 0.88), run * 0.5);
        // joints : fond sombre, flancs qui prennent ou perdent la lumière
        col *= (1.0 - 0.4 * groove) * (1.0 - 0.28 * lj);
        // la levée du dessous déborde un peu : fil de lumière sous chaque joint
        float lip = aLine(abs(fract(ly / 1.3) * 1.3 - 0.024), 0.008, fw.y);
        col *= 1.0 + 0.14 * lip * nearY;
        float gs = (1.0 - smoothstep(0.0, 0.02 + fw.x, gx)) * nearC;
        pN = normalize(pN - Tu * sign(sxg) * 0.75 * gs);
        // grain de l'enduit sous la peinture : il frise au soleil, de près
        vec2 gr = aGrain(uv + seed * 3.0, fw, 1.0);
        pN = normalize(pN + (Tu * gr.x + Tv * gr.y) * 0.75);
        // écaillures : la peinture saute par petites plaques le long des joints et au
        // pied des levées ; l'enduit gris-rose apparaît, avec un liseré d'ombre au bord
        float footL = smoothstep(0.9, 1.24, ly - lid * 1.3);
        float nearJ = 1.0 - smoothstep(0.04, 0.22, gx);
        float zone = max(footL, nearJ) * smoothstep(0.55, 0.7, textureLod(uNoise, uv * 0.11 + seed * 4.0, 0.0).r);
        float fl = texture2D(uNoise, uv * 0.48 + seed * 9.0).b * 0.75 + texture2D(uNoise, uv * 0.9 + seed * 5.0).b * 0.25;
        float fk = fl + 0.18 * zone;
        float flake = smoothstep(0.84, 0.86, fk) * nearC;
        float flakeRim = (smoothstep(0.815, 0.84, fk) - flake) * nearC;
        col *= 1.0 - 0.25 * max(flakeRim, 0.0);
        col = mix(col, vec3(0.66, 0.56, 0.5) * (0.92 + 0.12 * mott), flake * 0.75);
        rough = mix(rough, 0.92, flake);
      }
      if (isTop > 0.5) {
        // dessus des chaperons et des bandes d'appel : peinture usée par les pas
        float mt = texture2D(uNoise, vWPos.xz * 0.27 + seed).b;
        float de = min(min(uv.x, W - uv.x), min(uv.y, H - uv.y));
        float worn = smoothstep(0.05, 0.3, de) * smoothstep(0.45, 0.75, texture2D(uNoise, vWPos.xz * 0.09 + seed).g);
        col *= 0.93 + 0.12 * mt;
        col = mix(col, vec3(0.74, 0.62, 0.54), worn * 0.45);
        rough = mix(rough, 0.5, worn);
      }
      col *= 1.0 + 0.06 * edge;
      // albédo retenu (le plein soleil ne sature plus et garde le grain), lueur propre
      // un peu plus forte : à l'ombre le corail reste aussi lisible qu'avant
      col *= 0.8;
      emit += col * 0.16;
    } else if (kind == 6.0) { // métal
      col *= 0.96 + 0.05 * textureLod(uNoise, wp * vec2(0.03, 0.5), 1.0).b;
      col *= 1.0 + 0.12 * edge;
      rough = 0.42;
      metal = 0.15;
    } else if (kind == 7.0) { // ventilation
      if (isSide > 0.5) {
        float l = aLine(aGridDist(uv.y, 0.08), 0.012, fw.y) * step(0.12, uv.y) * step(0.12, H - uv.y) * step(0.1, uv.x) * step(0.1, W - uv.x);
        col *= 1.0 - 0.3 * l;
      } else if (isTop > 0.5) {
        vec2 c = uv - vec2(W, H) * 0.5;
        float r = length(c);
        float rr = min(W, H) * 0.42;
        float disc = 1.0 - smoothstep(rr - fw.x, rr + fw.x, r);
        float ring = aLine(aGridDist(r, 0.06), 0.01, fw.x);
        col *= 1.0 - disc * (0.45 + 0.25 * ring);
      }
      col *= 1.0 + 0.1 * edge;
      rough = 0.5;
    } else if (kind == 8.0) { // verre : intérieur sombre, reflet de Schlick
      vec3 R = reflect(V, n);
      R.y = abs(R.y);
      float fres = 0.04 + 0.96 * pow(1.0 - max(dot(-V, n), 0.0), 5.0);
      col = vec3(0.05, 0.06, 0.09);
      emit += aSky(normalize(R)) * fres;
      rough = 0.1;
    } else if (kind == 16.0) { // relevé d'étanchéité : bitume à paillettes, pied encrassé
      float spk = texture2D(uNoise, (isTop > 0.5 ? vWPos.xz : uv) * 0.16 + seed).a;
      col *= (0.9 + 0.16 * spk) * (0.94 + 0.1 * big);
      if (isSide > 0.5) {
        col *= 1.0 - 0.18 * smoothstep(H * 0.5, H, uv.y);
        float lap = aLine(aGridDist(uv.x, 1.0), 0.004, fw.x);
        col *= 1.0 - 0.18 * lap;
      }
      rough = 0.9;
    } else if (kind == 9.0) { // terre
      float m = textureLod(uNoise, vWPos.xz * 0.1, 0.0).b;
      col = mix(vec3(0.33, 0.25, 0.2), vec3(0.42, 0.5, 0.3), smoothstep(0.55, 0.8, m)) * (0.8 + 0.3 * fine);
      rough = 1.0;
    } else if (kind == 10.0) { // lumière
      emit += col * 1.6;
    } else if (kind == 11.0) { // pierre de taille
      float bh = 0.62;
      float row = floor(uv.y / bh);
      float off = mod(row, 2.0) * 0.6;
      float bx = isTop > 0.5 ? vWPos.x : uv.x;
      float by = isTop > 0.5 ? vWPos.z : uv.y;
      float j1 = aLine(aGridDist(by, bh), 0.012, fw.y);
      float j2 = aLine(aGridDist(bx + (isTop > 0.5 ? 0.0 : off), 1.2), 0.012, fw.x);
      float bid = aHash(vec2(floor((bx + off) / 1.2), floor(by / bh)));
      float bid2 = aHash(vec2(floor((bx + off) / 1.2), floor(by / bh)) + 7.7);
      col *= (0.86 + 0.22 * bid) * (0.92 + 0.12 * big) * (1.0 - 0.34 * max(j1, j2));
      // quelques blocs plus chauds ou plus gris, calcin en surface
      col *= bid2 > 0.86 ? vec3(1.04, 0.99, 0.93) : (bid2 < 0.1 ? vec3(0.93, 0.94, 0.96) : vec3(1.0));
      col *= 0.96 + 0.07 * texture2D(uNoise, (isTop > 0.5 ? vWPos.xz : uv) * 0.24 + seed).b;
      col *= 1.0 + 0.07 * edge;
      // bossage : arêtes des blocs abattues (relief sous la lumière rasante)
      vec2 bfw = isTop > 0.5 ? fwp : fw;
      vec2 sb = aBevel(vec2(bx + (isTop > 0.5 ? 0.0 : off), by), vec2(1.2, bh), 0.045) * (1.0 - smoothstep(0.008, 0.035, max(bfw.x, bfw.y)));
      if (isTop > 0.5) pN = normalize(n + vec3(sb.x * 0.5, 0.0, sb.y * 0.5));
      else if (isSide > 0.5) {
        vec3 Ts = normalize(cross(vec3(0.0, 1.0, 0.0), n));
        pN = normalize(n + 0.5 * (sb.x * Ts - sb.y * vec3(0.0, 1.0, 0.0)));
      }
      rough = 0.9;
    } else if (kind == 12.0) { // terre cuite
      col *= (0.92 + 0.1 * big) * (0.95 + 0.08 * fine);
      col *= 1.0 + 0.08 * edge;
      rough = 0.85;
    } else if (kind == 14.0) { // tuiles
      float row = floor(uv.y / 0.26);
      float off = mod(row, 2.0) * 0.11;
      float tu = fract((uv.x + off) / 0.22);
      float tv = fract(uv.y / 0.26);
      float roundT = sqrt(max(0.0, 1.0 - pow(abs(tu - 0.5) * 2.0, 2.0)));
      float th = aHash(vec2(floor((uv.x + off) / 0.22), row));
      float fade = 1.0 - smoothstep(0.04, 0.12, fw.y);
      col *= mix(1.0, (0.78 + 0.26 * roundT) * (1.0 - 0.25 * smoothstep(0.75, 1.0, tv)) * (0.92 + 0.14 * th), fade);
      col *= 0.95 + 0.08 * big;
      rough = 0.8;
    } else if (kind == 15.0) { // gravier : galets roulés, teintés par la couleur du lot
      vec3 tint = clamp(col / vec3(0.66, 0.6, 0.53), vec3(0.6), vec3(1.3));
      vec2 gp = isTop > 0.5 ? vWPos.xz : vec2(vWPos.x + vWPos.z, vWPos.y);
      col = aGravel(vec3(0.3, 0.28, 0.26), gp, isTop > 0.5 ? max(fwp.x, fwp.y) : max(fw.x, fw.y), 1.0, 0.034) * tint;
      col *= isSide > 0.5 ? 0.8 : 1.0;
      rough = 1.0;
    } else if (kind == 13.0) { // grille
      float g = max(aLine(aGridDist(uv.x, 0.05), 0.01, fw.x), aLine(aGridDist(uv.y, 0.05), 0.01, fw.y));
      col *= 0.65 + 0.35 * (1.0 - g);
      rough = 0.5;
    } else {
      col *= (0.97 + 0.04 * big);
      col *= 1.0 + 0.06 * edge;
    }

    // --- Patine : coulures sous les arêtes hautes, pied des murs encrassé ---
    if (isSide > 0.5 && kind != 5.0 && kind != 8.0 && kind != 10.0 && kind != 9.0) {
      // coulures de 15 à 60 cm de large : elles se lisent encore à vingt mètres
      vec4 sk4 = textureLod(uNoise, vec2((uv.x + vFace.z * 13.0) * 0.12, uv.y * 0.01 + vFace.z), 0.0);
      float streak = smoothstep(0.42, 0.8, sk4.g * 0.6 + sk4.b * 0.4);
      float far2 = smoothstep(0.03, 0.12, max(fw.x, fw.y));
      // coulures qui partent du haut de chaque volume
      float run = streak * exp(-clamp(uv.y, 0.0, 100.0) * (kind == 2.0 ? 0.22 : 0.9)) * (1.0 - far2 * 0.6);
      // pied des murs, des bacs et des murets
      float footH = min(0.6, H * 0.4);
      float foot = (1.0 - smoothstep(0.0, footH, H - uv.y)) * step(0.5, H) * step(H, 24.0);
      foot *= 0.65 + 0.7 * fine * big;
      // sous la corniche des immeubles : ombre douce
      float cor = kind == 2.0 ? (1.0 - smoothstep(0.42, 1.9, uv.y)) * step(0.42, uv.y) : 0.0;
      float wash = kind == 2.0 ? streak * 0.05 : 0.0;
      col *= 1.0 - clamp(0.21 * run + 0.34 * foot + 0.26 * cor + wash, 0.0, 0.6);
      // marbrures chaudes et grises (vieil enduit), grandes taches d'humidité de 2 à 5 m
      col = mix(col, col * vec3(0.9, 0.87, 0.85), smoothstep(0.42, 0.78, big) * 0.75);
      float damp = smoothstep(0.55, 0.8, bigLow);
      col *= 1.0 - 0.09 * damp;
    }

    // --- Grain des enduits et de la pierre : il frise sous le soleil rasant, de près ---
    if (isSide > 0.5 && (kind == 3.0 || kind == 11.0 || kind == 12.0 || kind == 1.0)) {
      vec2 gr = aGrain(uv + seed * 3.0, fw, kind == 11.0 ? 1.0 : 0.75);
      pN = normalize(pN + (Tu * gr.x + Tv * gr.y) * 0.7);
    }

    // --- Arêtes abattues, usées, épaufrées (boîtes seulement, ni dessous ni lumières) ---
    if (bevelOK > 0.5 && (isTop > 0.5 || isSide > 0.5) && kind != 0.0 && kind != 8.0 && kind != 9.0 && kind != 10.0 && kind != 13.0 && kind != 15.0) {
      aEdges(col, rough, kind, uv, W, H, fw, Tu, Tv, seed);
    }
  }
`;

export function createArchMaterial({ shadows = true } = {}) {
  const uniforms = skyUniforms();
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.85, metalness: 0 });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + ARCH_VERT_HEAD)
      .replace('#include <fog_vertex>', '#include <fog_vertex>\n' + ARCH_VERT_MAIN);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + ARCH_FRAG_HEAD)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float pRough = roughness; float pMetal = metalness; vec3 pEmit = vec3(0.0);
        pN = normalize(vWNrm);
        aPattern(diffuseColor.rgb, pRough, pMetal, pEmit);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        normal = normalize((viewMatrix * vec4(pN, 0.0)).xyz);`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = pRough;')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = pMetal;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance += pEmit;');
  };
  mat.customProgramCacheKey = () => 'aube-arch-v4';
  mat.userData.uniforms = uniforms;
  mat.userData.shadows = shadows;
  return mat;
}

// ---------------------------------------------------------------------------
// Feuillage : boules adoucies + cartes de feuilles (alpha testé), vent léger,
// lumière qui traverse les feuilles à contre-jour.
// ---------------------------------------------------------------------------

// Atlas 512 x 512 en niveaux de gris (teinté par la couleur des sommets) :
// haut gauche plein, haut droite grappe de feuilles, bas gauche brins d'herbe,
// bas droite grappe de petites fleurs (cerisiers).
export const ATLAS = {
  solid: [0.25, 0.75],
  leaves: [0.5, 0.5, 1, 1],
  grass: [0, 0, 0.5, 0.5],
  blossom: [0.5, 0, 1, 0.5],
};

function makeLeafTexture() {
  const S = 512, H = S / 2;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  let seed = 7;
  const r = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, H, H);
  // Feuilles : ellipses pointues avec nervure, plus claires au centre de la grappe
  const leaf = (x, y, len, wid, ang, v) => {
    g.save();
    g.translate(x, y);
    g.rotate(ang);
    g.fillStyle = `rgb(${v},${v},${v})`;
    g.beginPath();
    g.moveTo(0, -len);
    g.quadraticCurveTo(wid, -len * 0.2, 0, len);
    g.quadraticCurveTo(-wid, -len * 0.2, 0, -len);
    g.fill();
    g.strokeStyle = `rgba(${v - 40},${v - 40},${v - 40},0.6)`;
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(0, -len * 0.85);
    g.lineTo(0, len * 0.85);
    g.stroke();
    g.restore();
  };
  for (let i = 0; i < 220; i++) {
    const a = r() * Math.PI * 2;
    const d = Math.pow(r(), 0.6) * H * 0.4;
    const x = H * 1.5 + Math.cos(a) * d, y = H * 0.5 + Math.sin(a) * d;
    const v = Math.floor(165 + 90 * (1 - d / (H * 0.4)) * (0.6 + 0.4 * r()));
    leaf(x, y, 9 + r() * 7, 6 + r() * 4, a + Math.PI / 2 + (r() - 0.5) * 1.2, v);
  }
  // Herbe : brins effilés qui partent du bas
  for (let i = 0; i < 110; i++) {
    const x0 = 20 + r() * (H - 40), y0 = S - 4;
    const h = 60 + r() * 150, lean = (r() - 0.5) * 70, w = 3 + r() * 4;
    const v = Math.floor(170 + r() * 85);
    g.fillStyle = `rgb(${v},${v},${v})`;
    g.beginPath();
    g.moveTo(x0 - w, y0);
    g.quadraticCurveTo(x0 + lean * 0.3, y0 - h * 0.6, x0 + lean, y0 - h);
    g.quadraticCurveTo(x0 + lean * 0.3 + w * 0.5, y0 - h * 0.6, x0 + w, y0);
    g.fill();
  }
  // Fleurs de cerisier : cinq pétales autour d'un cœur
  for (let i = 0; i < 70; i++) {
    const a = r() * Math.PI * 2;
    const d = Math.pow(r(), 0.6) * H * 0.4;
    const x = H * 1.5 + Math.cos(a) * d, y = H * 1.5 + Math.sin(a) * d;
    const rad = 8 + r() * 6;
    const v = Math.floor(205 + 50 * r());
    const rot = r() * Math.PI;
    for (let k = 0; k < 5; k++) {
      const pa = rot + (k / 5) * Math.PI * 2;
      g.fillStyle = `rgb(${v},${v},${v})`;
      g.beginPath();
      g.ellipse(x + Math.cos(pa) * rad * 0.55, y + Math.sin(pa) * rad * 0.55, rad * 0.55, rad * 0.38, pa, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = `rgb(${v - 60},${v - 70},${v - 70})`;
    g.beginPath();
    g.arc(x, y, rad * 0.2, 0, Math.PI * 2);
    g.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export function createFoliageMaterial() {
  const uniforms = skyUniforms();
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff, vertexColors: true, roughness: 0.85, metalness: 0,
    map: makeLeafTexture(), alphaTest: 0.45, side: THREE.DoubleSide,
  });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute float aSway;
        varying vec3 vWPosF;
        uniform float uTime;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          vec3 wp0 = (modelMatrix * vec4(position, 1.0)).xyz;
          float ph = wp0.x * 0.35 + wp0.z * 0.27;
          transformed.x += sin(uTime * 1.1 + ph) * 0.05 * aSway + sin(uTime * 2.7 + ph * 3.0) * 0.015 * aSway;
          transformed.z += cos(uTime * 0.9 + ph * 1.3) * 0.04 * aSway;
          transformed.y += sin(uTime * 1.7 + ph * 2.0) * 0.015 * aSway;
        }`)
      .replace('#include <fog_vertex>', `#include <fog_vertex>
        vWPosF = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWPosF;
        uniform vec3 uSunDir, uSunCol;
        float fHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }`)
      .replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
        normal = normalize(vNormal); // même normale des deux côtés des feuilles`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          float n = fHash(floor(vWPosF * 7.0));
          diffuseColor.rgb *= 0.88 + 0.22 * n;
        }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        {
          // Contre-jour : le soleil traverse les feuilles
          vec3 V = normalize(vWPosF - cameraPosition);
          float back = pow(max(dot(V, uSunDir), 0.0), 3.0);
          totalEmissiveRadiance += diffuseColor.rgb * uSunCol * (0.06 + back * 0.45);
        }`);
  };
  mat.customProgramCacheKey = () => 'aube-foliage-v1';
  mat.userData.uniforms = uniforms;
  return mat;
}

// ---------------------------------------------------------------------------
// Tissus : voiles d'ombrage, bannières, linge. Ondulent au vent, s'illuminent à contre-jour.
// ---------------------------------------------------------------------------

export function createFabricMaterial() {
  const uniforms = skyUniforms();
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.9, metalness: 0, side: THREE.DoubleSide });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute float aSway;
        varying vec3 vWPosF;
        uniform float uTime;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          vec3 wp0 = (modelMatrix * vec4(position, 1.0)).xyz;
          float ph = wp0.x * 0.6 + wp0.z * 0.45 + wp0.y * 0.8;
          float w = sin(uTime * 1.6 + ph) * 0.6 + sin(uTime * 2.9 + ph * 1.7) * 0.4;
          transformed += normal * w * 0.09 * aSway;
          transformed.x += sin(uTime * 0.8 + ph * 0.5) * 0.05 * aSway;
        }`)
      .replace('#include <fog_vertex>', `#include <fog_vertex>
        vWPosF = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWPosF;
        uniform vec3 uSunDir, uSunCol;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        {
          vec3 V = normalize(vWPosF - cameraPosition);
          float back = pow(max(dot(V, uSunDir), 0.0), 2.0);
          totalEmissiveRadiance += diffuseColor.rgb * uSunCol * (0.05 + back * 0.35);
        }`);
  };
  mat.customProgramCacheKey = () => 'aube-fabric-v1';
  mat.userData.uniforms = uniforms;
  return mat;
}

// ---------------------------------------------------------------------------
// Eau calme des bassins
// ---------------------------------------------------------------------------

export function createWaterMaterial() {
  const uniforms = skyUniforms();
  const mat = new THREE.MeshStandardMaterial({ color: 0x4a7a86, roughness: 0.06, metalness: 0 });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPosW;')
      .replace('#include <fog_vertex>', '#include <fog_vertex>\nvWPosW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWPosW;
        ${SKY_DECL}
        ${COMMON_GLSL}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          vec2 p = vWPosW.xz;
          float e = 0.08;
          float h0 = aNoise(p * 1.6 + uTime * 0.15) + 0.5 * aNoise(p * 3.7 - uTime * 0.22);
          float hx = aNoise((p + vec2(e, 0.0)) * 1.6 + uTime * 0.15) + 0.5 * aNoise((p + vec2(e, 0.0)) * 3.7 - uTime * 0.22);
          float hz = aNoise((p + vec2(0.0, e)) * 1.6 + uTime * 0.15) + 0.5 * aNoise((p + vec2(0.0, e)) * 3.7 - uTime * 0.22);
          vec3 wn = normalize(vec3(-(hx - h0) / e * 0.05, 1.0, -(hz - h0) / e * 0.05));
          normal = normalize((viewMatrix * vec4(wn, 0.0)).xyz);
        }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        {
          vec3 V = normalize(vWPosW - cameraPosition);
          vec3 wn = normalize((vec4(normal, 0.0) * viewMatrix).xyz);
          vec3 R = reflect(V, wn);
          R.y = abs(R.y);
          float fres = 0.04 + 0.96 * pow(1.0 - max(dot(-V, wn), 0.0), 5.0);
          totalEmissiveRadiance += aSky(normalize(R)) * (0.07 + 0.62 * fres);
        }`);
  };
  mat.customProgramCacheKey = () => 'aube-water-v1';
  mat.userData.uniforms = uniforms;
  return mat;
}
