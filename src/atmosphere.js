import * as THREE from 'three';

// Atmosphère commune : palette de l'aube, direction du soleil et modèle de brume.
// Le même code GLSL sert au ciel, à la mer de nuages et à tous les matériaux
// standards (par un remplacement des morceaux de shader « fog » de three.js),
// pour que tout se fonde dans la même lumière.

const c = (hex, k = 1) => new THREE.Color(hex).multiplyScalar(k);

export const ATMO = {
  // Soleil bas, à l'avant gauche du parcours (le joueur avance vers -z).
  sunDir: new THREE.Vector3(-0.83, 0.4, -0.43).normalize(),
  sun: c(0xffe8cc, 1.0), // couleur de la lumière directe : or pâle
  sunDisc: c(0xfff3dc, 1.0),
  zenith: c(0x4e74cc, 0.8),
  upperWarm: c(0xe2b8cf, 0.93), // haut du ciel côté soleil, rose
  upperCool: c(0x97a3e2, 0.86), // haut du ciel côté opposé, lavande
  horizonWarm: c(0xffd8b0, 1.08), // horizon côté soleil, pêche dorée
  horizonCool: c(0xdccfe6, 0.92), // horizon opposé, lavande poudrée
  earthShadow: c(0xaeafdc, 0.86), // bande bleutée sous la ceinture de Vénus
  cloudLit: c(0xffeedd, 1.32),
  cloudShade: c(0xaea9dc, 0.74),
  cloudDeep: c(0x8a90cc, 0.6),
  mountain: c(0x9aa3d0, 0.78),
  // Lumière d'ambiance (ciel filtré) : bleu-lavande en haut, rebond tiède en bas.
  ambientSky: c(0x98a8f8, 1.0),
  ambientGround: c(0xf2c9b0, 1.0),
  // Brume : voile lointain et brume de hauteur qui coule sur la mer de nuages.
  haze: 0.00062, // voile linéaire (mer de nuages)
  // Voile des surfaces : épaisseur (d / hazeDist)^hazePow. Le mi-plan reste net
  // (3 % à 50 m, 8 % à 100 m), le lointain se fond (50 % vers 500 m).
  hazeDist: 640,
  hazePow: 1.35,
  fogY0: -22, // dessus de la mer de nuages
  fogDensity: 0.034, // densité au niveau des nuages (par mètre)
  fogFalloff: 0.24, // décroissance avec l'altitude (par mètre) : la brume reste dans les rues
  cloudY: -22,
};

const v3 = (o) => {
  const a = o.isColor ? [o.r, o.g, o.b] : [o.x, o.y, o.z];
  return `vec3(${a.map((x) => x.toFixed(5)).join(', ')})`;
};
const f = (x) => x.toFixed(6);

// Constantes et fonctions GLSL partagées.
export const ATMO_GLSL = /* glsl */ `
  #ifndef AUBE_ATMO
  #define AUBE_ATMO
  const vec3 AUBE_SUN_DIR = ${v3(ATMO.sunDir)};
  const vec3 AUBE_SUN = ${v3(ATMO.sun)};
  const vec3 AUBE_SUN_DISC = ${v3(ATMO.sunDisc)};
  const vec3 AUBE_ZENITH = ${v3(ATMO.zenith)};
  const vec3 AUBE_UPPER_WARM = ${v3(ATMO.upperWarm)};
  const vec3 AUBE_UPPER_COOL = ${v3(ATMO.upperCool)};
  const vec3 AUBE_HOR_WARM = ${v3(ATMO.horizonWarm)};
  const vec3 AUBE_HOR_COOL = ${v3(ATMO.horizonCool)};
  const vec3 AUBE_EARTH_SHADOW = ${v3(ATMO.earthShadow)};
  const vec3 AUBE_AMB_SKY = ${v3(ATMO.ambientSky)};
  const vec3 AUBE_AMB_GROUND = ${v3(ATMO.ambientGround)};
  const float AUBE_HAZE = ${f(ATMO.haze)};
  const float AUBE_HAZE_DIST = ${f(ATMO.hazeDist)};
  const float AUBE_HAZE_POW = ${f(ATMO.hazePow)};
  const float AUBE_FOG_Y0 = ${f(ATMO.fogY0)};
  const float AUBE_FOG_C = ${f(ATMO.fogDensity)};
  const float AUBE_FOG_B = ${f(ATMO.fogFalloff)};

  // 0 à l'opposé du soleil, 1 dans sa direction (azimut seulement).
  float aubeSunSide(vec3 rd) {
    vec2 s = normalize(AUBE_SUN_DIR.xz);
    vec2 r = rd.xz / max(length(rd.xz), 1e-4);
    return dot(r, s) * 0.5 + 0.5;
  }

  vec3 aubeHorizon(vec3 rd) {
    float a = aubeSunSide(rd);
    return mix(AUBE_HOR_COOL, AUBE_HOR_WARM, a * a * (3.0 - 2.0 * a));
  }

  // Couleur de la brume dans la direction rd : l'horizon, réchauffé près du soleil.
  vec3 aubeFogColor(vec3 rd) {
    vec3 col = aubeHorizon(rd);
    float s = max(dot(rd, AUBE_SUN_DIR), 0.0);
    col += AUBE_SUN * (pow(s, 8.0) * 0.1 + pow(s, 32.0) * 0.16);
    return col;
  }

  // Épaisseurs optiques : x = voile lointain, y = brume de hauteur intégrée
  // analytiquement le long du rayon (densité c * exp(-b * (y - y0))).
  vec2 aubeFogDepths(vec3 ro, vec3 rd, float dist) {
    float camH = ro.y - AUBE_FOG_Y0;
    float k = rd.y * AUBE_FOG_B;
    float e = min(-k * dist, 60.0);
    float path = abs(k) > 1e-4 ? (1.0 - exp(e)) / k : dist;
    float hf = AUBE_FOG_C * exp(clamp(-AUBE_FOG_B * camH, -60.0, 20.0)) * path;
    return vec2(pow(dist / AUBE_HAZE_DIST, AUBE_HAZE_POW), max(hf, 0.0));
  }
  float aubeFogDepth(vec3 ro, vec3 rd, float dist) {
    vec2 d = aubeFogDepths(ro, rd, dist);
    return d.x + d.y;
  }

  // La brume basse des rues est à l'ombre : lavande pâle, sans l'éclat du soleil.
  vec3 aubeMistColor(vec3 rd) {
    return mix(aubeHorizon(rd), AUBE_EARTH_SHADOW * 1.06, 0.45);
  }

  float aubeFogAmount(vec3 ro, vec3 rd, float dist) {
    return 1.0 - exp(-aubeFogDepth(ro, rd, dist));
  }
  #endif
`;

// Remplace la brume de three.js par celle d'Aube pour tous les matériaux.
// scene.fog doit exister (n'importe quel type) pour activer USE_FOG ;
// fogDensity sert alors de multiplicateur global (FogExp2 : density = 1).
let installed = false;
export function installAtmosphereFog() {
  if (installed) return;
  installed = true;
  const S = THREE.ShaderChunk;
  // Ombres : filtre en tente lisse (9 lectures PCF matérielles) au lieu du disque
  // de Vogel bruité, pour des pénombres douces sans grain. Près du bord de la
  // carte d'ombre, l'ombre s'efface doucement au lieu de s'arrêter net.
  const pcf = /float phi = interleavedGradientNoise\( gl_FragCoord\.xy \) \* PI2;[\s\S]*?\) \* 0\.2;/;
  if (pcf.test(S.shadowmap_pars_fragment)) {
    S.shadowmap_pars_fragment = S.shadowmap_pars_fragment.replace(
      pcf,
      `vec2 aubeO = texelSize * max(shadowRadius, 1.0) * 0.7;
        shadow = 0.0;
        for (int sy = -1; sy <= 1; sy++) {
          for (int sx = -1; sx <= 1; sx++) {
            float wgt = (sx == 0 ? 2.0 : 1.0) * (sy == 0 ? 2.0 : 1.0);
            shadow += wgt * texture(shadowMap, vec3(shadowCoord.xy + vec2(float(sx), float(sy)) * aubeO, shadowCoord.z));
          }
        }
        shadow *= 0.0625;
        vec2 aubeEdge = abs(shadowCoord.xy * 2.0 - 1.0);
        shadow = mix(shadow, 1.0, smoothstep(0.8, 0.985, max(aubeEdge.x, aubeEdge.y)));`
    );
  }
  // Part de lumière indirecte (ciel, rebonds) dans le canal alpha des surfaces
  // opaques : la passe d'occlusion ambiante n'assombrit que cette part, jamais le
  // plein soleil. Les ombres et les recoins se creusent, la lumière reste nette.
  S.opaque_fragment = /* glsl */ `
    #ifdef OPAQUE
    diffuseColor.a = 1.0;
    #endif
    #ifdef USE_TRANSMISSION
    diffuseColor.a *= material.transmissionAlpha;
    #endif
    #if defined( OPAQUE ) && ( defined( STANDARD ) || defined( LAMBERT ) || defined( PHONG ) || defined( TOON ) )
    {
      const vec3 aubeLum = vec3( 0.2126, 0.7152, 0.0722 );
      float aubeInd = dot( reflectedLight.indirectDiffuse + reflectedLight.indirectSpecular, aubeLum );
      diffuseColor.a = clamp( aubeInd / max( dot( outgoingLight, aubeLum ), 1e-4 ), 0.0, 1.0 );
    }
    #endif
    gl_FragColor = vec4( outgoingLight, diffuseColor.a );
  `;
  S.fog_pars_vertex = /* glsl */ `
    #ifdef USE_FOG
      varying vec3 vAubeFogWorld;
    #endif
  `;
  // Position monde retrouvée depuis l'espace vue (marche aussi pour les sprites et points).
  S.fog_vertex = /* glsl */ `
    #ifdef USE_FOG
      vAubeFogWorld = (mvPosition.xyz - viewMatrix[3].xyz) * mat3(viewMatrix);
    #endif
  `;
  S.fog_pars_fragment = /* glsl */ `
    #ifdef USE_FOG
      uniform vec3 fogColor;
      varying vec3 vAubeFogWorld;
      #ifdef FOG_EXP2
        uniform float fogDensity;
      #else
        uniform float fogNear;
        uniform float fogFar;
      #endif
      ${ATMO_GLSL}
    #endif
  `;
  S.fog_fragment = /* glsl */ `
    #ifdef USE_FOG
      vec3 aubeD = vAubeFogWorld - cameraPosition;
      float aubeDist = length(aubeD);
      vec3 aubeRd = aubeD / max(aubeDist, 1e-4);
      #ifdef FOG_EXP2
        float aubeMul = fogDensity;
      #else
        float aubeMul = 1.0;
      #endif
      vec2 aubeFD = aubeFogDepths(cameraPosition, aubeRd, aubeDist) * aubeMul;
      float aubeFT = aubeFD.x + aubeFD.y;
      float fogFactor = 1.0 - exp(-aubeFT);
      vec3 aubeFC = mix(aubeFogColor(aubeRd), aubeMistColor(aubeRd), aubeFD.y / max(aubeFT, 1e-5));
      gl_FragColor.rgb = mix(gl_FragColor.rgb, aubeFC, fogFactor);
      #ifdef OPAQUE
        gl_FragColor.a *= 1.0 - fogFactor;
      #endif
    #endif
  `;
}

// Bruit de valeur et fbm 2D (ciel).
export const NOISE_GLSL = /* glsl */ `
  float aHash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float aNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(aHash(i), aHash(i + vec2(1.0, 0.0)), u.x), mix(aHash(i + vec2(0.0, 1.0)), aHash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float aFbm(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 5; i++) { v += a * aNoise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; }
    return v;
  }
`;
