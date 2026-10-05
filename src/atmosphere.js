import * as THREE from 'three';

// Atmosphère commune : palette de l'aube, direction du soleil et modèle de brume.
// Le même code GLSL sert au ciel, à la mer de nuages et à tous les matériaux
// standards (par un remplacement des morceaux de shader « fog » de three.js),
// pour que tout se fonde dans la même lumière.

const c = (hex, k = 1) => new THREE.Color(hex).multiplyScalar(k);

export const ATMO = {
  // Soleil bas, à l'avant gauche du parcours (le joueur avance vers -z).
  sunDir: new THREE.Vector3(-0.83, 0.24, -0.43).normalize(), // ~14° : lumière rasante du matin
  sun: c(0xffe2c0, 1.0), // couleur de la lumière directe : or clair
  sunDisc: c(0xfff6e6, 1.0),
  zenith: c(0x2c5ec6, 0.7), // azur profond du haut du ciel
  upperWarm: c(0xffe0c0, 0.95), // haut du ciel au-dessus du soleil, or pâle
  upperCool: c(0x729ce0, 0.8), // haut du ciel, bleu clair
  horizonWarm: c(0xffcd94, 1.2), // horizon côté soleil, or lumineux
  horizonCool: c(0xc4cce2, 0.86), // horizon opposé, bleu poudré
  earthShadow: c(0x8092c6, 0.74), // ombre de la Terre, bleu ardoise
  cloudLit: c(0xfff0dc, 1.2),
  cloudShade: c(0x8e9cc8, 0.5),
  cloudDeep: c(0x6e7eb6, 0.42),
  mountain: c(0x95a3cc, 0.78),
  // Lumière d'ambiance (ciel filtré) : bleu de ciel en haut, rebond tiède en bas.
  ambientSky: c(0x98b6ec, 1.0),
  ambientGround: c(0xf2c49c, 1.0),
  // Brume : voile lointain et brume de hauteur qui coule sur la mer de nuages.
  haze: 0.00062, // voile linéaire (mer de nuages)
  // Voile des surfaces : épaisseur (d / hazeDist)^hazePow. Le mi-plan reste net
  // (1 % à 50 m, 4 % à 100 m, 13 % à 200 m), le lointain se fond (50 % vers 500 m).
  hazeDist: 620,
  hazePow: 1.75,
  fogY0: -22, // dessus de la mer de nuages
  fogDensity: 0.028, // densité au niveau des nuages (par mètre)
  fogFalloff: 0.24, // décroissance avec l'altitude (par mètre) : la brume reste dans les rues
  cloudY: -22,
  // Mer de nuages (champ de hauteur de world.js) : hauteur des cumulus et taille des motifs.
  cloudAmp: 26,
  cloudTileA: 520,
  cloudTileB: 150,
  cloudGradScale: 24,
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
  const vec3 AUBE_CLOUD_LIT = ${v3(ATMO.cloudLit)};
  const vec3 AUBE_CLOUD_SHADE = ${v3(ATMO.cloudShade)};
  const float AUBE_CLOUD_Y = ${f(ATMO.cloudY)};
  const vec3 AUBE_CLOUD_DEEP = ${v3(ATMO.cloudDeep)};
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

  // Mélange en racine carrée : entre l'or et le bleu, le ciel passe par un blanc
  // nacré au lieu d'un gris rosé (un mélange linéaire donnerait ce voile lilas).
  vec3 aubeMixSq(vec3 a, vec3 b, float t) {
    vec3 m = mix(sqrt(max(a, 0.0)), sqrt(max(b, 0.0)), t);
    return m * m;
  }

  vec3 aubeHorizon(vec3 rd) {
    float a = aubeSunSide(rd);
    return aubeMixSq(AUBE_HOR_COOL, AUBE_HOR_WARM, a * a * (3.0 - 2.0 * a));
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
    return mix(aubeHorizon(rd) * 0.8, AUBE_EARTH_SHADOW * 0.85, 0.6);
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
  // Matière : un relief très fin (grain de pierre, d'enduit, de bois) sur toutes les
  // surfaces mates, posé juste avant l'éclairage (donc après les normales propres à
  // chaque matériau). La lumière rasante de l'aube le révèle ; il s'efface au loin
  // avant de scintiller. Les surfaces lisses (verre, eau) et les métaux n'en ont pas.
  S.lights_fragment_begin = /* glsl */ `
    #if defined( STANDARD ) && defined( USE_FOG ) && defined( OPAQUE )
    {
      // Le grain ne se calcule que de près (au loin il s'efface avant de scintiller) :
      // la condition ne dépend que de fwidth, identique sur tout un bloc de 2x2 pixels,
      // donc les dérivées prises à l'intérieur restent bien définies.
      vec3 aubeGP = vAubeFogWorld;
      float aubeFw = length(fwidth(aubeGP));
      if (aubeFw < 0.07) {
        float aubeHt = aubeGN(aubeGP * 7.9 + 3.1) * 0.45 + aubeGN(aubeGP * 23.0 + 7.7) * 0.35;
        vec3 aubeSP = -vViewPosition;
        vec3 aubeSX = dFdx(aubeSP), aubeSY = dFdy(aubeSP);
        vec2 aubeDH = vec2(dFdx(aubeHt), dFdy(aubeHt));
        float aubeAmp = 0.0085 * (1.0 - smoothstep(0.02, 0.07, aubeFw)) * smoothstep(0.5, 0.75, roughnessFactor) * step(metalnessFactor, 0.5);
        // Repère pris sur la face géométrique, pas sur la normale du matériau (qui peut
        // être couchée dans le plan, par ex. dans l'embrasure d'une fenêtre peinte) :
        // le déterminant ne s'annule pas et la normale reste toujours finie.
        vec3 aubeNg = cross(aubeSX, aubeSY);
        float aubeDet = dot(aubeNg, aubeNg);
        if (aubeAmp > 1e-5 && aubeDet > 1e-30) {
          aubeNg *= inversesqrt(aubeDet);
          aubeNg *= dot(aubeNg, normal) < 0.0 ? -1.0 : 1.0;
          vec3 aubeR1 = cross(aubeSY, aubeNg), aubeR2 = cross(aubeNg, aubeSX);
          float aubeD = dot(aubeSX, aubeR1);
          vec3 aubeGrad = (aubeDH.x * aubeR1 + aubeDH.y * aubeR2) * (aubeAmp / (abs(aubeD) + 1e-12)) * (aubeD < 0.0 ? -1.0 : 1.0);
          vec3 aubeNN = normal - aubeGrad;
          float aubeL = dot(aubeNN, aubeNN);
          if (aubeL > 1e-8) normal = aubeNN * inversesqrt(aubeL);
        }
      }
    }
    #endif
  ` + S.lights_fragment_begin;
  // Ombres de nuages : de grandes taches douces qui glissent lentement sur les
  // terrasses et sur la ville (lumière directe seulement). Projetées depuis une
  // couche à 140 m le long du soleil ; vent et force viennent de fogColor.
  S.lights_fragment_end = S.lights_fragment_end + /* glsl */ `
    #if defined( USE_FOG ) && ( defined( STANDARD ) || defined( LAMBERT ) || defined( PHONG ) )
    if (fogColor.z > 0.0) {
      vec2 aubeCP = vAubeFogWorld.xz - AUBE_SUN_DIR.xz / AUBE_SUN_DIR.y * (140.0 - vAubeFogWorld.y) + fogColor.xy;
      float aubeCN = aubeVN(aubeCP * 0.022) * 0.6 + aubeVN(aubeCP * 0.055 + 3.7) * 0.28 + aubeVN(aubeCP * 0.14 + 9.1) * 0.12;
      float aubeCS = 1.0 - smoothstep(0.58, 0.67, aubeCN) * fogColor.z;
      reflectedLight.directDiffuse *= aubeCS;
      reflectedLight.directSpecular *= aubeCS;
    }
    #endif
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
      // fogColor ne sert pas à la brume d'Aube : World.update y range, à chaque image,
      // le déplacement du vent (x, z) et la force (y) des ombres de nuages, seul
      // uniforme partagé par tous les matériaux éclairés.
      uniform vec3 fogColor;
      varying vec3 vAubeFogWorld;
      float aubeVH(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
      float aubeVN(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(aubeVH(i), aubeVH(i + vec2(1.0, 0.0)), f.x), mix(aubeVH(i + vec2(0.0, 1.0)), aubeVH(i + vec2(1.0, 1.0)), f.x), f.y);
      }
      float aubeGH(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
      float aubeGN(vec3 x) {
        vec3 i = floor(x), f = fract(x);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(mix(aubeGH(i), aubeGH(i + vec3(1.0, 0.0, 0.0)), f.x), mix(aubeGH(i + vec3(0.0, 1.0, 0.0)), aubeGH(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
                   mix(mix(aubeGH(i + vec3(0.0, 0.0, 1.0)), aubeGH(i + vec3(1.0, 0.0, 1.0)), f.x), mix(aubeGH(i + vec3(0.0, 1.0, 1.0)), aubeGH(i + vec3(1.0, 1.0, 1.0)), f.x), f.y), f.z);
      }
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

// Mer de nuages : hauteur et couleur, partagées par le plan de nuages (world.js) et par
// le pied des tours lointaines (materials.js), pour qu'un nuage devant une tour ait
// exactement la couleur du nuage voisin.
export const CLOUDSEA_GLSL = /* glsl */ `
  #ifndef AUBE_CLOUDSEA
  #define AUBE_CLOUDSEA
  const float AUBE_CS_AMP = ${f(ATMO.cloudAmp)};
  const float AUBE_CS_TA = ${f(ATMO.cloudTileA)};
  const float AUBE_CS_TB = ${f(ATMO.cloudTileB)};
  const float AUBE_CS_GS = ${f(ATMO.cloudGradScale)};
  vec2 aubeCloudWind(float time) { return vec2(time * 0.55, time * 0.2); }
  float aubeCloudH(sampler2D t, vec2 xz, float time) {
    vec2 w = aubeCloudWind(time);
    return texture2D(t, (xz + w) / AUBE_CS_TA).r * 0.84 + texture2D(t, (xz + w * 1.7) / AUBE_CS_TB + 0.37).r * 0.16;
  }
  // Couleur (sans voile) du nuage au point p, de hauteur relative hs, vu dans la direction rd.
  vec3 aubeCloudColor(sampler2D t, vec2 p, float hs, float time, vec3 rd) {
    vec2 w = aubeCloudWind(time);
    vec2 ga = texture2D(t, (p + w) / AUBE_CS_TA).gb * 2.0 - 1.0;
    vec2 gb = texture2D(t, (p + w * 1.7) / AUBE_CS_TB + 0.37).gb * 2.0 - 1.0;
    vec2 grad = ga / AUBE_CS_GS * 0.84 * AUBE_CS_AMP / (AUBE_CS_TA / 256.0) + gb / AUBE_CS_GS * 0.16 * AUBE_CS_AMP / (AUBE_CS_TB / 256.0);
    // Relief accentué : les dômes tournés vers le soleil s'allument, les autres
    // restent dans une ombre bleutée (la mer de nuages a du modelé, pas un aplat).
    vec3 n = normalize(vec3(-grad.x * 3.2, 1.0, -grad.y * 3.2));
    vec3 sd = AUBE_SUN_DIR;
    float wrap = clamp((dot(n, sd) + 0.04) / 0.9, 0.0, 1.0);
    wrap = wrap * wrap * (3.0 - 2.0 * wrap);
    // Ombre portée approximative : relief plus haut en direction du soleil.
    vec2 sxz = normalize(sd.xz);
    float hsun = aubeCloudH(t, p + sxz * 16.0, time);
    float hsun2 = aubeCloudH(t, p + sxz * 40.0, time);
    float occ = clamp(1.0 - max(hsun - hs - 0.02, 0.0) * 4.0 - max(hsun2 - hs - 0.1, 0.0) * 2.0, 0.15, 1.0);
    vec3 col = mix(AUBE_CLOUD_SHADE, AUBE_CLOUD_LIT, wrap * occ);
    // Creux plus profonds et bleutés.
    col = mix(AUBE_CLOUD_DEEP, col, smoothstep(0.05, 0.6, hs));
    col *= mix(0.9, 1.06, smoothstep(0.3, 0.9, hs));
    // Ciel au-dessus : léger apport bleuté sur les faces tournées vers le haut.
    col += AUBE_ZENITH * 0.07 * max(n.y, 0.0);
    // Liseré d'argent : à contre-jour, la lumière traverse surtout les bords rasants
    // des dômes ; les flancs tournés vers nous restent dans une ombre bleutée. La mer
    // de nuages garde ainsi son modelé même face au soleil, au lieu d'un voile uniforme.
    float fs = max(dot(rd, sd), 0.0);
    float rim = 1.0 - clamp(dot(n, -rd), 0.0, 1.0);
    rim *= rim;
    col += AUBE_SUN * pow(fs, 8.0) * (0.05 + 0.55 * rim * (0.35 + 0.65 * occ)) * (0.5 + 0.5 * (1.0 - hs));
    // Chemin de lumière : sous le soleil, la mer de nuages vue en rasant s'allume d'or.
    col += AUBE_HOR_WARM * pow(fs, 16.0) * (0.06 + 0.75 * rim * rim);
    return col;
  }
  // Voile propre à la mer de nuages (plus léger que celui des surfaces).
  vec3 aubeCloudFog(vec3 col, vec3 cam, vec3 rd, float dist) {
    float fd = dist * AUBE_HAZE * 0.9 + aubeFogDepth(cam, rd, dist) * 0.05;
    return mix(col, aubeFogColor(rd), 1.0 - exp(-fd));
  }
  #endif
`;

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
