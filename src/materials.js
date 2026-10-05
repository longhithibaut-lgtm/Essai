import * as THREE from 'three';
import { ATMO_GLSL } from './atmosphere.js';

// Palette d'aube : blancs chauds, corail pour guider le regard, verts tendres.
export const COLORS = {
  stone: 0xf4ede6,
  stoneShade: 0xe8ded8,
  plaster: 0xf8f2ea,
  accent: 0xea6a4e,
  accentSoft: 0xffb497,
  wood: 0xc29a7a,
  trunk: 0x86685b,
  blossom: 0xf7b9c9,
  leaf: 0x9dc79a,
  water: 0x8fc6d4,
  glow: 0xffd9a8,
};

// Temps partagé par les matériaux animés (eau, ombres de nuages). Mis à jour par World.update.
export const MATERIAL_TIME = { value: 0 };
// Texture de nuages partagée (canal A) pour les ombres douces qui glissent sur les terrasses.
export const MATERIAL_CLOUDS = { value: null };

// Réglages du détail de surface par famille de matériau.
const KINDS = {
  // Pierre : grain, nuances larges, dalles au sol et assises sur les murs.
  stone: { defines: { AUBE_GRAIN: '', AUBE_JOINTS: '', AUBE_WINDOWS: '' }, big: 0.07, mid: 0.045, fine: 0.035, joint: 0.15, wallJoint: 0.08, tile: 1.6, course: 1.3, block: 2.8 },
  // Tours lointaines : comme la pierre, avec la hauteur des fenêtres par instance.
  facade: { defines: { AUBE_GRAIN: '', AUBE_JOINTS: '', AUBE_WINDOWS: '', AUBE_WIN_ATTR: '' }, big: 0.07, mid: 0.045, fine: 0.035, joint: 0.15, wallJoint: 0.08, tile: 1.6, course: 1.3, block: 2.8 },
  plaster: { defines: { AUBE_GRAIN: '' }, big: 0.05, mid: 0.03, fine: 0.025 },
  paint: { defines: { AUBE_GRAIN: '' }, big: 0.05, mid: 0.025, fine: 0.02 },
  wood: { defines: { AUBE_GRAIN: '', AUBE_WOOD: '' }, big: 0.06, mid: 0.05, fine: 0.06 },
  foliage: { defines: { AUBE_GRAIN: '', AUBE_FOLIAGE: '' }, big: 0.12, mid: 0.1, fine: 0.06 },
  water: { defines: { AUBE_WATER: '' } },
};

const SURFACE_PARS = /* glsl */ `
  varying vec3 vAubeW;
  varying vec3 vAubeN;
  uniform float uAubeTime;
  uniform sampler2D tAubeClouds;
  float aH3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float aN3(vec3 x) {
    vec3 i = floor(x), f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(aH3(i), aH3(i + vec3(1.0, 0.0, 0.0)), f.x), mix(aH3(i + vec3(0.0, 1.0, 0.0)), aH3(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
               mix(mix(aH3(i + vec3(0.0, 0.0, 1.0)), aH3(i + vec3(1.0, 0.0, 1.0)), f.x), mix(aH3(i + vec3(0.0, 1.0, 1.0)), aH3(i + vec3(1.0, 1.0, 1.0)), f.x), f.y), f.z);
  }
  float aH2(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
  // Joint antialiasé : 1 sur les lignes d'une grille de pas 1 (coordonnées g).
  float aJoint(vec2 g, float width) {
    vec2 fw = max(fwidth(g), vec2(1e-4));
    vec2 d = abs(fract(g) - 0.5);
    vec2 l = smoothstep(0.5 - width - fw, 0.5 - width + fw * 0.5, d);
    float fade = 1.0 - smoothstep(0.08, 0.3, max(fw.x, fw.y));
    return max(l.x, l.y) * fade;
  }
  #ifdef AUBE_WIN_ATTR
    varying float vAubeWinTop;
  #endif
  ${ATMO_GLSL}
`;

const n4 = (x) => Number(x || 0).toFixed(4);

function patchShader(shader, cfg) {
  shader.uniforms.uAubeTime = MATERIAL_TIME;
  shader.uniforms.tAubeClouds = MATERIAL_CLOUDS;
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vAubeW;\nvarying vec3 vAubeN;\n#ifdef AUBE_WIN_ATTR\nattribute float aWinTop;\nvarying float vAubeWinTop;\n#endif')
    .replace(
      '#include <project_vertex>',
      /* glsl */ `#include <project_vertex>
      vec4 aubeWP = vec4(transformed, 1.0);
      vec3 aubeON = objectNormal;
      #ifdef USE_INSTANCING
        aubeWP = instanceMatrix * aubeWP;
        aubeON = mat3(instanceMatrix) * aubeON;
      #endif
      aubeWP = modelMatrix * aubeWP;
      vAubeW = aubeWP.xyz;
      vAubeN = normalize(mat3(modelMatrix) * aubeON);
      #ifdef AUBE_WIN_ATTR
        vAubeWinTop = aWinTop;
      #endif`
    );

  let frag = shader.fragmentShader.replace('#include <common>', '#include <common>\n' + SURFACE_PARS);

  // Albédo : nuances, grain, joints.
  frag = frag.replace(
    '#include <color_fragment>',
    /* glsl */ `#include <color_fragment>
    vec3 aw = vAubeW;
    vec3 an = normalize(vAubeN);
    float aubeRough = 1.0;
    #ifdef AUBE_GRAIN
    {
      float big = aN3(aw * 0.16);
      float mid = aN3(aw * 0.85 + 7.1);
      float fine = aN3(aw * 5.3 + 3.7);
      #ifdef AUBE_WOOD
        fine = aN3(aw * vec3(9.0, 0.7, 9.0) + 1.3);
      #endif
      float tone = 1.0 + (big - 0.5) * ${n4(cfg.big * 2)} + (mid - 0.5) * ${n4(cfg.mid * 2)} + (fine - 0.5) * ${n4(cfg.fine * 2)};
      aubeRough = 1.0 + (mid - 0.5) * 0.2;
      #ifdef AUBE_JOINTS
      {
        float joint = 0.0;
        if (an.y > 0.6) {
          vec2 g = aw.xz / ${n4(cfg.tile)};
          joint = aJoint(g, 0.012) * ${n4(cfg.joint)};
          tone *= 1.0 + (aH2(floor(g)) - 0.5) * 0.06;
          aubeRough *= 0.72 + aH2(floor(g) + 9.0) * 0.12; // dalles un peu polies : reflet doux du soleil
        } else if (abs(an.y) < 0.35) {
          float u = dot(aw.xz, normalize(vec2(-an.z, an.x) + vec2(1e-5)));
          float row = aw.y / ${n4(cfg.course)};
          float r = floor(row);
          vec2 g = vec2(u / ${n4(cfg.block)} + 0.5 * mod(r, 2.0), row);
          joint = aJoint(g, 0.012) * ${n4(cfg.wallJoint)};
          tone *= 1.0 + (aH2(floor(g) + 3.0) - 0.5) * 0.05;
        }
        
        tone *= 1.0 - joint;
        aubeRough *= 1.0 + joint * 2.0;
      }
      #endif
      diffuseColor.rgb *= tone;
    }
    #endif
    vec3 aubeGlow = vec3(0.0);
    #ifdef AUBE_WINDOWS
    {
      // Baies cintrées sur les fûts des tours, sous le niveau du parcours.
      #ifdef AUBE_WIN_ATTR
        float winTop = vAubeWinTop;
      #else
        float winTop = -5.0;
      #endif
      // Chaque façade a son caractère : baies serrées, baies espacées, ou mur plein.
      vec2 nq = floor(an.xz * 6.0 + 0.5);
      float faceSeed = aH2(vec2(floor(dot(aw.xz, an.xz) * 0.5 + 0.5) + nq.x * 7.0, nq.y * 3.0 + floor(winTop)));
      if (abs(an.y) < 0.3 && aw.y < winTop && faceSeed < 0.86) {
        vec2 tdir = normalize(vec2(-an.z, an.x) + vec2(1e-5));
        float u = dot(aw.xz, tdir);
        vec2 cs = faceSeed > 0.6 ? vec2(5.8, 5.2) : vec2(3.8, 4.4);
        vec2 cell = vec2(u, aw.y - winTop) / cs;
        vec2 id = floor(cell);
        vec2 lp = (fract(cell) - vec2(0.5, 0.0)) * cs;
        float hw = 0.55, y0 = 0.75, y1 = 2.55;
        float dRect = max(abs(lp.x) - hw, max(y0 - lp.y, lp.y - y1));
        float dArch = length(vec2(lp.x, lp.y - y1)) - hw;
        float d = min(dRect, dArch);
        float px = length(fwidth(vec2(u, aw.y)));
        float m = (1.0 - smoothstep(-px, px, d)) * step(0.13, aH2(id * 1.37 + faceSeed * 17.0));
        float sill = (1.0 - smoothstep(0.0, px + 0.02, abs(lp.y - y0 + 0.06) - 0.05)) * step(abs(lp.x), hw + 0.15);
        float far = smoothstep(0.08, 0.3, px / cs.x);
        float lit = step(aH2(id + floor(winTop) + faceSeed * 5.0), 0.06);
        // Embrasure sombre et fraîche ; quelques fenêtres éclairées, chaudes.
        vec3 recess = vec3(0.30, 0.32, 0.46) * mix(0.55, 1.0, smoothstep(y0, y1 + hw, lp.y));
        vec3 wcol = mix(diffuseColor.rgb, diffuseColor.rgb * recess, m);
        wcol *= 1.0 + sill * 0.12;
        diffuseColor.rgb = mix(wcol, diffuseColor.rgb * 0.86, far);
        aubeGlow = vec3(1.0, 0.62, 0.32) * 1.6 * m * lit * (1.0 - far * 0.6);
      }
    }
    #endif`
  );

  frag = frag.replace(
    '#include <emissivemap_fragment>',
    /* glsl */ `#include <emissivemap_fragment>
    totalEmissiveRadiance += aubeGlow;`
  );

  frag = frag.replace(
    '#include <roughnessmap_fragment>',
    /* glsl */ `#include <roughnessmap_fragment>
    roughnessFactor = clamp(roughnessFactor * aubeRough, 0.04, 1.0);`
  );

  // Eau : petites rides lentes qui font bouger le reflet du ciel.
  frag = frag.replace(
    '#include <normal_fragment_maps>',
    /* glsl */ `#include <normal_fragment_maps>
    #ifdef AUBE_FOLIAGE
    {
      // Touffes de feuilles : normale bosselée par un bruit 3D à deux échelles.
      vec3 p = aw * 2.6;
      float e = 0.2;
      float n0 = aN3(p);
      vec3 g = vec3(aN3(p + vec3(e, 0.0, 0.0)) - n0, aN3(p + vec3(0.0, e, 0.0)) - n0, aN3(p + vec3(0.0, 0.0, e)) - n0) / e;
      vec3 p2 = aw * 7.5 + 2.3;
      float m0 = aN3(p2);
      vec3 g2 = vec3(aN3(p2 + vec3(e, 0.0, 0.0)) - m0, aN3(p2 + vec3(0.0, e, 0.0)) - m0, aN3(p2 + vec3(0.0, 0.0, e)) - m0) / e;
      g = g * 0.6 + g2 * 0.4;
      vec3 wn = normalize(an - (g - an * dot(g, an)) * 0.8);
      normal = normalize((viewMatrix * vec4(wn, 0.0)).xyz);
      diffuseColor.rgb *= 0.82 + 0.3 * (n0 * 0.6 + m0 * 0.4);
    }
    #endif
    #ifdef AUBE_WATER
    {
      float t = uAubeTime;
      vec2 p = aw.xz;
      vec2 g = vec2(0.0);
      g += vec2(0.8, 0.3) * cos(dot(p, vec2(0.8, 0.3)) * 3.1 + t * 0.9) * 0.05;
      g += vec2(-0.4, 0.9) * cos(dot(p, vec2(-0.4, 0.9)) * 4.3 + t * 1.2) * 0.035;
      g += vec2(0.6, -0.7) * cos(dot(p, vec2(0.6, -0.7)) * 7.7 + t * 1.6) * 0.02;
      vec3 wn = normalize(vec3(-g.x, 1.0, -g.y));
      normal = normalize((viewMatrix * vec4(wn, 0.0)).xyz);
    }
    #endif`
  );

  // Feuillage : lumière enveloppante et translucidité à contre-jour.
  frag = frag.replace(
    '#include <lights_fragment_end>',
    /* glsl */ `#include <lights_fragment_end>
    {
      // Ombres de nuages hauts, très lentes et très douces (lumière directe seulement).
      vec2 cuv = (aw.xz - AUBE_SUN_DIR.xz / AUBE_SUN_DIR.y * (160.0 - aw.y)) / 420.0 + vec2(uAubeTime * 0.0032, uAubeTime * 0.0012);
      float cc = texture2D(tAubeClouds, cuv).a;
      float csh = mix(1.0, 0.62, smoothstep(0.56, 0.74, cc));
      reflectedLight.directDiffuse *= csh;
      reflectedLight.directSpecular *= csh;
    }
    #ifdef AUBE_FOLIAGE
    {
      vec3 vdir = normalize(aw - cameraPosition);
      float back = pow(max(dot(vdir, AUBE_SUN_DIR), 0.0), 3.0);
      float wrap = clamp((dot(an, AUBE_SUN_DIR) + 0.6) / 1.6, 0.0, 1.0);
      reflectedLight.indirectDiffuse += diffuseColor.rgb * AUBE_SUN * (wrap * 0.18 + back * 0.55);
    }
    #endif`
  );

  shader.fragmentShader = frag;
}

// MeshStandardMaterial enrichi. Le détail survit à material.clone() (utilisé par le
// niveau) : le patch est posé dans le constructeur et la famille est dans userData.
export class AubeMaterial extends THREE.MeshStandardMaterial {
  constructor(params, kind) {
    super(params);
    if (kind) this.userData.aubeKind = kind;
    this.onBeforeCompile = (shader) => {
      const cfg = KINDS[this.userData.aubeKind];
      if (!cfg) return;
      shader.defines = Object.assign(shader.defines || {}, cfg.defines);
      patchShader(shader, cfg);
    };
  }

  customProgramCacheKey() {
    return 'aube-' + (this.userData.aubeKind || 'none');
  }
}

export function createMaterials() {
  return {
    stone: new AubeMaterial({ color: COLORS.stone, roughness: 0.86, metalness: 0 }, 'stone'),
    stoneShade: new AubeMaterial({ color: COLORS.stoneShade, roughness: 0.9, metalness: 0 }, 'stone'),
    plaster: new AubeMaterial({ color: COLORS.plaster, roughness: 0.78, metalness: 0 }, 'plaster'),
    accent: new AubeMaterial({ color: COLORS.accent, roughness: 0.9, metalness: 0, emissive: COLORS.accent, emissiveIntensity: 0.04 }, 'paint'),
    wood: new AubeMaterial({ color: COLORS.wood, roughness: 0.72 }, 'wood'),
    trunk: new AubeMaterial({ color: COLORS.trunk, roughness: 0.9 }, 'wood'),
    blossom: new AubeMaterial({ color: COLORS.blossom, roughness: 0.8 }, 'foliage'),
    leaf: new AubeMaterial({ color: COLORS.leaf, roughness: 0.82 }, 'foliage'),
    water: new AubeMaterial({ color: COLORS.water, roughness: 0.06, metalness: 0, transparent: true, opacity: 0.9 }, 'water'),
    glow: new THREE.MeshStandardMaterial({ color: COLORS.glow, emissive: COLORS.glow, emissiveIntensity: 1.9, roughness: 0.5 }),
  };
}
