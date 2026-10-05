import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

// Corps à la première personne : bras, mains et jambes stylisés, tout en douceur.
//
// Une seule SkinnedMesh (un appel de dessin, un de plus pour l'ombre) : chaque segment
// (bras, avant-bras, paume, phalanges, cuisse, tibia, chaussure) est rigide et suit son os.
// Les os sont posés à chaque image par du code : cinématique inverse à deux os pour les
// bras et les jambes, doigts pliés à la main.
//
// Chaque geste a son contact : une main « posée » est ancrée dans le monde (point, normale,
// orientation) et y reste pendant que le corps bouge, l'épaule s'avançant au besoin ; elle
// lâche quand le geste se termine ou que la prise sort de portée. Escalade : les paumes
// claquent l'une après l'autre sur le mur et glissent vers le bas de l'écran pendant qu'on
// monte. Rétablissement : les deux paumes se plaquent sur le rebord pendant la traction.
// Franchissement : la main gauche s'appuie à plat sur le muret. Course murale : la main côté
// mur reste plaquée sur la paroi et se repose au rythme de la course. Au sol : mains contre
// un mur qu'on touche ou qu'on longe. Une ombre douce marque chaque paume posée.
//
// Repère « caméra » : x à droite, y en haut, -z devant. Les poses sont écrites pour la
// main droite ; la gauche est leur miroir (x inversé).

const COLORS = {
  skin: 0xdcae90,
  glove: 0x5b7a8f, // gants sans doigts bleu ardoise : se détachent du corail et du blanc
  band: 0xea8f76, // liseré corail au poignet, rappel du mur à suivre
  sleeve: 0xeee5d8, // manche de lin clair
  sleeveRoll: 0xf7f1e8,
  pants: 0x4a6377,
  shoe: 0xe58b72,
  sole: 0xf6f1ea,
};

// Proportions (mètres)
const SHOULDER = new THREE.Vector3(0.165, -0.215, 0.05);
const UPPER_LEN = 0.3;
const FORE_LEN = 0.275;
const THIGH_LEN = 0.44;
const SHIN_LEN = 0.43;
// Poignet au-dessus d'une surface quand la paume y est posée à plat (demi-épaisseur de la
// paume + un souffle).
const PALM_LIFT = 0.019;
// Les grands murs (bâtiments, murs d'escalade et de course) portent un parement visuel un
// peu en avant de leur boîte de collision : la main se pose sur le parement.
const CLADDING = 0.036;
function faceInset(box) {
  return box && box.maxY - box.minY > 2.5 ? CLADDING : 0;
}
// L'épaule peut s'avancer vers une prise lointaine (buste qui se penche) : le tronc n'est pas
// dessiné, seul le bras gagne cette allonge.
const SHOULDER_REACH = 0.2;

// Doigts (main droite) : jointure dans le repère de la main, longueurs des phalanges,
// écart de base. La paume regarde -y, les doigts vont vers -z, le pouce est côté -x.
const FINGERS = [
  { k: [-0.0285, 0.003, -0.097], len: [0.038, 0.023, 0.018], r: 0.011, spread: 0.07 },
  { k: [-0.0095, 0.004, -0.101], len: [0.041, 0.025, 0.019], r: 0.0113, spread: 0.015 },
  { k: [0.0095, 0.003, -0.098], len: [0.038, 0.024, 0.018], r: 0.0109, spread: -0.04 },
  { k: [0.0275, 0.0, -0.09], len: [0.03, 0.019, 0.016], r: 0.0101, spread: -0.1 },
];
const THUMB = { k: [-0.03, -0.008, -0.024], len: [0.038, 0.029, 0.023], r: 0.0124 };

// Index des os
const ARM_BONES = 18; // bras, avant-bras, main, 4 doigts × 3, pouce × 3
const B_UPPER = 0, B_FORE = 1, B_HAND = 2, B_FINGER = 3, B_THUMB = 15;
const LEG_BASE = ARM_BONES * 2;
const BONE_COUNT = LEG_BASE + 6;

// ---------- Géométrie ----------

// Capsule effilée le long de -z : sphère r0 en z=0, sphère r1 en z=-len. `cuts` : distances
// le long du segment où la couleur change ; on y place deux anneaux très proches pour que
// la limite soit nette (sinon la couleur se dilue d'un bout à l'autre du segment).
function capsule(r0, r1, len, radial = 10, capSegs = 4, cuts = []) {
  const pts = [];
  for (let i = 0; i <= capSegs; i++) {
    const a = -Math.PI / 2 + (i / capSegs) * (Math.PI / 2);
    pts.push(new THREE.Vector2(Math.cos(a) * r0, Math.sin(a) * r0));
  }
  for (const c of cuts) {
    for (const y of [c - 0.0015, c + 0.0015]) pts.push(new THREE.Vector2(r0 + (r1 - r0) * (y / len), y));
  }
  for (let i = 0; i <= capSegs; i++) {
    const a = (i / capSegs) * (Math.PI / 2);
    pts.push(new THREE.Vector2(Math.cos(a) * r1, len + Math.sin(a) * r1));
  }
  pts[0].x = 0;
  pts[pts.length - 1].x = 0;
  const g = new THREE.LatheGeometry(pts, radial);
  g.rotateX(-Math.PI / 2); // axe y du tour -> -z
  return g;
}

class BodyBuilder {
  constructor() {
    this.pos = [];
    this.nor = [];
    this.col = [];
    this.skin = [];
    this.idx = [];
    this.count = 0;
    this._c = new THREE.Color();
  }

  // colorOf(x, y, z) -> couleur hexadécimale, dans le repère local de la pièce.
  add(geo, bone, colorOf) {
    const g = geo.index ? geo : geo.toNonIndexed();
    const p = g.attributes.position, n = g.attributes.normal;
    const base = this.count;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      this.pos.push(x, y, z);
      this.nor.push(n.getX(i), n.getY(i), n.getZ(i));
      const c = this._c.setHex(typeof colorOf === 'function' ? colorOf(x, y, z) : colorOf);
      this.col.push(c.r, c.g, c.b);
      this.skin.push(bone);
    }
    if (g.index) {
      const ix = g.index.array;
      for (let i = 0; i < ix.length; i++) this.idx.push(base + ix[i]);
    } else {
      for (let i = 0; i < p.count; i++) this.idx.push(base + i);
    }
    this.count += p.count;
  }

  build() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    const si = new Uint16Array(this.count * 4);
    const sw = new Float32Array(this.count * 4);
    for (let i = 0; i < this.count; i++) {
      si[i * 4] = this.skin[i];
      sw[i * 4] = 1;
    }
    geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
    geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
    geo.setIndex(this.count > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    return geo;
  }
}

function buildBodyGeometry() {
  const b = new BodyBuilder();
  for (let side = 0; side < 2; side++) {
    const o = side * ARM_BONES;
    // Bras (manche)
    b.add(capsule(0.046, 0.039, UPPER_LEN, 10, 3), o + B_UPPER, COLORS.sleeve);
    // Avant-bras : manche retroussée sous le coude, peau, poignet enveloppé de corail.
    b.add(capsule(0.038, 0.028, FORE_LEN, 12, 3, [0.075, 0.236, 0.252]), o + B_FORE, (x, y, z) => {
      if (z > -0.075) return COLORS.sleeve;
      if (z < -0.252) return COLORS.glove;
      if (z < -0.236) return COLORS.band;
      return COLORS.skin;
    });
    const roll = new THREE.TorusGeometry(0.0335, 0.0095, 5, 12);
    roll.translate(0, 0, -0.077);
    b.add(roll, o + B_FORE, COLORS.sleeveRoll);
    // Paume (gant sans doigts), légèrement effilée vers le poignet et bombée sur le dos.
    const palm = new RoundedBoxGeometry(0.084, 0.03, 0.098, 2, 0.0135);
    const pp = palm.attributes.position;
    for (let i = 0; i < pp.count; i++) {
      const z = pp.getZ(i); // -0.049 .. 0.049 (0.049 = côté poignet)
      const t = (z + 0.049) / 0.098; // 0 aux jointures, 1 au poignet
      pp.setX(i, pp.getX(i) * (1 - 0.14 * t));
      const y = pp.getY(i);
      pp.setY(i, y * (1 - 0.12 * (1 - t)) + (y > 0 ? 0.003 * (1 - Math.abs(pp.getX(i)) / 0.042) : 0));
    }
    palm.computeVertexNormals();
    palm.translate(0, 0, -0.052);
    b.add(palm, o + B_HAND, (x, y, z) => (z > -0.01 ? COLORS.band : COLORS.glove));
    // Doigts : première phalange gantée, le reste en peau.
    FINGERS.forEach((f, fi) => {
      for (let j = 0; j < 3; j++) {
        const r0 = f.r * (1 - j * 0.08), r1 = f.r * (1 - (j + 1) * 0.08);
        b.add(capsule(r0, r1, f.len[j], 8, 2), o + B_FINGER + fi * 3 + j, j === 0 ? COLORS.glove : COLORS.skin);
      }
    });
    for (let j = 0; j < 3; j++) {
      const r0 = THUMB.r * (1 - j * 0.1), r1 = THUMB.r * (1 - (j + 1) * 0.1);
      b.add(capsule(r0, r1, THUMB.len[j], 8, 2), o + B_THUMB + j, j === 0 ? COLORS.glove : COLORS.skin);
    }
  }
  // Jambes : cuisse, tibia, chaussure.
  for (let side = 0; side < 2; side++) {
    const o = LEG_BASE + side * 3;
    b.add(capsule(0.078, 0.06, THIGH_LEN, 10, 3), o, COLORS.pants);
    b.add(capsule(0.06, 0.046, SHIN_LEN, 10, 3, [SHIN_LEN - 0.03]), o + 1, (x, y, z) => (z < -SHIN_LEN + 0.03 ? COLORS.sleeveRoll : COLORS.pants));
    // Chaussure : semelle claire un peu plus large (on en voit le liseré d'en haut),
    // dessus corail qui s'affine vers la pointe.
    const sole = new RoundedBoxGeometry(0.116, 0.03, 0.29, 2, 0.013);
    sole.translate(0, -0.083, -0.08);
    b.add(sole, o + 2, COLORS.sole);
    const upper = new RoundedBoxGeometry(0.1, 0.08, 0.255, 2, 0.034);
    const up = upper.attributes.position;
    for (let i = 0; i < up.count; i++) {
      const z = up.getZ(i);
      const t = (z + 0.1275) / 0.255; // 0 à la pointe, 1 au talon
      up.setX(i, up.getX(i) * (0.84 + 0.16 * Math.min(1, t * 2)));
      if (up.getY(i) > 0) up.setY(i, up.getY(i) * (0.45 + 0.75 * t));
    }
    upper.computeVertexNormals();
    upper.translate(0, -0.035, -0.07);
    b.add(upper, o + 2, COLORS.shoe);
  }
  return b.build();
}

// ---------- Outils ----------

// Tache de contact : disque doux (alpha radial), calculé sans canvas.
function makeContactTexture() {
  const N = 64;
  const data = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const dx = (x + 0.5) / N * 2 - 1, dy = (y + 0.5) / N * 2 - 1;
      const r = Math.sqrt(dx * dx + dy * dy);
      const q = Math.max(0, 1 - r * r);
      const a = q * q * (0.55 + 0.45 * Math.max(0, 1 - r * 1.6));
      const i = (y * N + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = 255;
      data[i + 3] = Math.round(a * 255);
    }
  }
  const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function dampK(rate, dt) {
  return 1 - Math.exp(-rate * dt);
}

// Ressort critique exact (stable quel que soit dt), composante par composante.
function springVec(x, v, target, w, dt) {
  if (dt <= 0) return;
  const e = Math.exp(-w * dt);
  let y = x.x - target.x, j = v.x + w * y;
  x.x = target.x + (y + j * dt) * e;
  v.x = (v.x - w * j * dt) * e;
  y = x.y - target.y; j = v.y + w * y;
  x.y = target.y + (y + j * dt) * e;
  v.y = (v.y - w * j * dt) * e;
  y = x.z - target.z; j = v.z + w * y;
  x.z = target.z + (y + j * dt) * e;
  v.z = (v.z - w * j * dt) * e;
}

class Hand {
  constructor(side) {
    this.side = side; // +1 droite, -1 gauche
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.quat = new THREE.Quaternion();
    this.curl = 0.45;
    this.spread = 0.3;
    this.thumb = 0.4;
    // cible libre (repère caméra)
    this.tPos = new THREE.Vector3();
    this.tQuat = new THREE.Quaternion();
    this.tCurl = 0.45;
    this.tSpread = 0.3;
    this.tThumb = 0.4;
    this.omega = 14;
    // ancrage dans le monde (rebord)
    this.anchor = new THREE.Vector3();
    this.anchorQ = new THREE.Quaternion(); // orientation monde
    this.anchorActive = false;
    this.anchorW = 0;
    this.anchorCurl = 0.15;
    this.anchorSpread = 0.85;
    this.anchorDelay = 0;
    this.anchorAge = 0;
    this.anchorRate = 22; // vitesse d'arrivée de la main sur la prise
    this.anchorN = new THREE.Vector3(0, 1, 0); // normale de la surface touchée
    this.reachExt = SHOULDER_REACH; // avancée possible de l'épaule vers la prise
    this.pole = new THREE.Vector3(0.55, -0.85, 0.25); // direction du coude (main droite, repère caméra)
    this.contactW = 0; // poids réel du contact (prise atteinte), pour l'ombre de contact
    // résultat
    this.P = new THREE.Vector3();
    this.Q = new THREE.Quaternion();
  }
}

// ---------- Corps ----------

export class FirstPersonBody {
  constructor(scene, player, physics, camera) {
    this.scene = scene;
    this.player = player;
    this.physics = physics;
    this.camera = camera;

    const geo = buildBodyGeometry();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.74, metalness: 0 });
    // Éclairage propre aux bras, comme dans les jeux à la première personne : le soleil du
    // matin est presque toujours devant le coureur, donc les mains seraient à contre-jour.
    // Une lumière d'appoint chaude (venue d'en haut à droite de la vue), un liseré doré sur
    // les contours et un peu de lumière enveloppante gardent un rendu doux et lisible.
    mat.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <opaque_fragment>',
        /* glsl */ `
        {
          vec3 vdir = normalize(vViewPosition);
          float facing = clamp(dot(vdir, normal), 0.0, 1.0);
          float rim = pow(1.0 - facing, 2.6);
          vec3 keyDir = normalize(vec3(0.45, 0.75, 0.5));
          float key = dot(normal, keyDir) * 0.5 + 0.5;
          key *= key;
          outgoingLight += diffuseColor.rgb * vec3(1.0, 0.86, 0.72) * key * 0.55;
          outgoingLight += vec3(1.0, 0.84, 0.68) * rim * 0.22;
          outgoingLight += diffuseColor.rgb * 0.05;
        }
        #include <opaque_fragment>`,
      );
    };
    this.material = mat;

    const mesh = new THREE.SkinnedMesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.bones = [];
    for (let i = 0; i < BONE_COUNT; i++) {
      const bone = new THREE.Bone();
      bone.matrixAutoUpdate = false;
      mesh.add(bone);
      this.bones.push(bone);
    }
    const inverses = this.bones.map(() => new THREE.Matrix4());
    mesh.bind(new THREE.Skeleton(this.bones, inverses), new THREE.Matrix4());
    this.mesh = mesh;
    scene.add(mesh);

    // Le corps n'apparaît que lorsque la caméra est celle du joueur (pas sur l'écran titre
    // ni sur les points de vue fixes).
    this._stamp = new THREE.Vector3(NaN, NaN, NaN);

    // Ombres de contact : une tache douce sous chaque paume posée (mur, rebord). Elles
    // disent tout de suite que la main touche, même à contre-jour. Deux petits quads,
    // dessinés seulement pendant un contact.
    const shadowGeo = new THREE.PlaneGeometry(0.26, 0.32);
    const shadowTex = makeContactTexture();
    this.shadows = [0, 1].map(() => {
      const sm = new THREE.MeshBasicMaterial({
        map: shadowTex, color: 0x2a2140, transparent: true, opacity: 0, depthWrite: false,
        polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      });
      const s = new THREE.Mesh(shadowGeo, sm);
      s.frustumCulled = false;
      s.visible = false;
      s.renderOrder = 1;
      s.userData.on = false;
      scene.add(s);
      return s;
    });

    const prev = scene.onBeforeRender;
    scene.onBeforeRender = (renderer, sc, cam, target) => {
      if (prev) prev.call(sc, renderer, sc, cam, target);
      const own = cam === this.camera && cam.position.equals(this._stamp);
      mesh.visible = own;
      for (const s of this.shadows) s.visible = own && s.userData.on;
    };

    this.hands = [new Hand(1), new Hand(-1)];
    this.legW = 0; // présence des jambes (glissade, regard vers les pieds)
    this.legSlide = 0; // pose de glissade (1) ou de course (0)
    this.brace = 0; // réception après un saut
    this.jumpKick = 0; // élan des bras au saut
    this.vaultAhead = 0; // muret droit devant : la main s'y prépare
    this.time = 0;
    this.swayX = 0;
    this.swayY = 0;
    this.lastYaw = 0;
    this.lastPitch = 0;
    this.lastMode = 'ground';
    this.modeT = 0;
    this.slapT = 0;
    this.slapSide = 1;
    this.wallCycle = 0;
    // Geste vers une lueur ramassée (voir reachFor)
    this.reachPos = new THREE.Vector3();
    this.reachT = -1;
    this.reachSide = 1;

    // Temporaires (aucune allocation par image)
    this.camInv = new THREE.Matrix4();
    this.camQ = new THREE.Quaternion();
    this.camQInv = new THREE.Quaternion();
    this.v1 = new THREE.Vector3();
    this.v2 = new THREE.Vector3();
    this.v3 = new THREE.Vector3();
    this.v4 = new THREE.Vector3();
    this.v5 = new THREE.Vector3();
    this.f = new THREE.Vector3();
    this.n = new THREE.Vector3();
    this.ax = new THREE.Vector3();
    this.ay = new THREE.Vector3();
    this.az = new THREE.Vector3();
    this.m4 = new THREE.Matrix4();
    this.q1 = new THREE.Quaternion();
    this.S = new THREE.Vector3();
    this.E = new THREE.Vector3();
    this.T = new THREE.Vector3();
    this.pole = new THREE.Vector3();
    this.hx = new THREE.Vector3();
    this.hy = new THREE.Vector3();
    this.hz = new THREE.Vector3();
    this.j0 = new THREE.Vector3();
    this.j1 = new THREE.Vector3();
    this.handUp = new THREE.Vector3();
    this.tAxis = new THREE.Vector3();
    this.tDir = new THREE.Vector3();
    this.tIn = new THREE.Vector3();
    this.hit = { dist: Infinity, nx: 0, ny: 0, nz: 0, box: null };
    this.hit2 = { dist: Infinity, nx: 0, ny: 0, nz: 0, box: null };
    this.brush = [Infinity, Infinity];
    this.brushN = [0, 0, 0, 0];
    this.brushInset = [0, 0];

    player.onEvent((type, data) => this._onEvent(type, data));
    this.reset();
  }

  _onEvent(type, data) {
    if (type === 'land' && data && data.impact > 4) this.brace = Math.max(this.brace, Math.min(1, (data.impact - 3) * 0.11));
    if (type === 'walljump' && data) {
      // Poussée sur le mur : la main côté mur s'en écarte d'un coup, puis revient au calme.
      for (const h of this.hands) {
        if (data.side === 0 || h.side === data.side) {
          this._release(h);
          h.vel.set(h.side * 1.2, 0.9, -0.6);
        }
      }
    }
    if (type === 'jump') this.jumpKick = 1;
    if (type === 'mantle') this._plantOnLedge();
    if (type === 'vault') this._plantVault();
  }

  // Une main se tend doucement vers un point du monde (ex. une lueur qu'on ramasse),
  // puis revient. Appel facultatif depuis le jeu : player.body.reachFor(orb.pos).
  reachFor(pos) {
    // Cible gardée dans le repère de la vue : en courant, la lueur est dépassée en un
    // instant ; la main balaie donc vers l'endroit où on l'a vue, à portée de bras.
    const tp = this.reachPos.copy(pos).applyMatrix4(this.camInv);
    this.reachSide = tp.x >= 0 ? 1 : -1;
    const sh = this.v2.set(SHOULDER.x * this.reachSide, SHOULDER.y, SHOULDER.z);
    const d = this.v3.subVectors(tp, sh);
    const len = d.length();
    if (len > 0.48) tp.copy(sh).addScaledVector(d, 0.48 / len);
    tp.z = Math.min(tp.z, -0.32);
    tp.y = THREE.MathUtils.clamp(tp.y, -0.32, 0.05);
    tp.x = this.reachSide * Math.max(0.14, Math.abs(tp.x));
    this.reachT = 0;
  }

  reset() {
    this.reachT = -1;
    for (const h of this.hands) {
      this._poseHidden(h);
      h.pos.copy(h.tPos);
      h.vel.set(0, 0, 0);
      h.quat.copy(h.tQuat);
      h.curl = h.tCurl;
      h.spread = h.tSpread;
      h.thumb = h.tThumb;
      h.anchorActive = false;
      h.anchorW = 0;
      h.contactW = 0;
    }
    this.legW = 0;
    this.legSlide = 0;
    this.brace = 0;
    this.jumpKick = 0;
    this.vaultAhead = 0;
    this.swayX = this.swayY = 0;
    this.lastYaw = this.player.yaw;
    this.lastPitch = this.player.pitch;
    this.lastMode = this.player.mode;
    this.modeT = 0;
  }

  // ---------- Poses (main droite ; la gauche est le miroir) ----------

  // Fixe la cible libre d'une main : position, direction des doigts, normale de la paume
  // (vers où regarde la paume), dans le repère caméra, écrite pour la main droite.
  _setFree(h, px, py, pz, fx, fy, fz, nx, ny, nz, curl, spread, thumb, omega) {
    const s = h.side;
    h.tPos.set(px * s, py, pz);
    this.f.set(fx * s, fy, fz);
    this.n.set(nx * s, ny, nz);
    this._quatFrom(this.f, this.n, h.tQuat);
    h.tCurl = curl;
    h.tSpread = spread;
    h.tThumb = thumb;
    h.omega = omega;
  }

  // Comme _setFree, mais position et directions données dans le monde (converties en repère caméra).
  _setWorld(h, wp, wf, wn, curl, spread, thumb, omega) {
    h.tPos.copy(wp).applyMatrix4(this.camInv);
    this.f.copy(wf).applyQuaternion(this.camQInv);
    this.n.copy(wn).applyQuaternion(this.camQInv);
    this._quatFrom(this.f, this.n, h.tQuat);
    h.tCurl = curl;
    h.tSpread = spread;
    h.tThumb = thumb;
    h.omega = omega;
  }

  // Orientation de la main : doigts selon f, paume vers n.
  _quatFrom(f, n, out) {
    const z = this.az.copy(f).normalize().negate();
    const y = this.ay.copy(n).negate();
    y.addScaledVector(z, -y.dot(z));
    if (y.lengthSq() < 1e-8) y.set(0, 1, 0).addScaledVector(z, -z.y);
    y.normalize();
    const x = this.ax.crossVectors(y, z);
    this.m4.makeBasis(x, y, z);
    out.setFromRotationMatrix(this.m4);
  }

  _poseHidden(h) {
    this._setFree(h, 0.24, -0.62, -0.1, 0.05, -0.25, -1, -1, -0.2, 0, 0.5, 0.2, 0.45, 9);
  }

  _poseRun(h, k, phase) {
    // Balancier alterné : la main avance et monte dans le coin bas de l'écran, puis repart.
    const s = Math.sin(phase + (h.side > 0 ? 0 : Math.PI));
    const up = Math.max(0, s);
    const a = smoothstep(0.12, 0.85, k);
    const px = 0.235 - 0.05 * up * a + 0.01 * (1 - a);
    const py = -0.62 + (0.23 + 0.05 * s + 0.2 * up * up) * a;
    const pz = -0.1 - (0.13 + 0.17 * s) * a;
    // Main détendue, doigts presque tendus et serrés (main « lame »), qui pivote un peu au balancier.
    this._setFree(h, px, py, pz, -0.28, 0.3 + 0.55 * up, -1, -1, -0.25 + 0.3 * up, 0.1 + 0.15 * up, 0.3 - 0.1 * up, 0.08, 0.3, 11);
  }

  _poseAir(h, vy) {
    // Bras légèrement ouverts pour l'équilibre ; ils remontent un peu en retombant.
    const f = THREE.MathUtils.clamp(-vy / 6, 0, 1);
    this._setFree(
      h,
      0.25 + 0.05 * f, -0.3 + 0.06 * f, -0.34 + 0.02 * f,
      0.3 + 0.15 * f, 0.22 + 0.2 * f, -1,
      -0.35 - 0.1 * f, -1, 0.1,
      0.22, 0.8, 0.15, 10,
    );
  }

  // Impulsion du saut : les deux bras partent vers l'avant et le haut, puis s'ouvrent.
  _poseTakeoff(h) {
    this._setFree(h, 0.2, -0.2, -0.42, 0.1, 0.55, -1, -0.15, -0.6, -0.7, 0.35, 0.5, 0.3, 16);
  }

  _poseBrace(h) {
    this._setFree(h, 0.21, -0.37, -0.36, 0.12, -0.4, -1, -0.2, -1, -0.25, 0.25, 0.7, 0.2, 16);
  }

  // Avant un muret : la main gauche descend vers le dessus de l'obstacle, prête à s'y poser.
  _poseVaultReach(h) {
    this._setFree(h, 0.14, -0.25, -0.5, -0.15, -0.5, -1, 0.05, -1, 0.3, -0.05, 0.9, 0.1, 15);
  }

  // Franchissement : la main libre (droite) s'ouvre sur le côté pour l'équilibre.
  _poseVaultFree(h, t) {
    const e = Math.sin(Math.PI * Math.min(1, t * 1.1));
    this._setFree(h, 0.27 + 0.05 * e, -0.3 + 0.1 * e, -0.4, 0.5, 0.15, -1, -0.35, -1, 0, 0.25, 0.85, 0.2, 14);
  }

  // Escalade : main levée vers le haut du mur, paume vers l'avant, prête à claquer dessus.
  _poseClimbReach(h) {
    this._setFree(h, 0.19, 0.06, -0.3, 0.12, 1, -0.3, 0, 0.1, -1, 0.1, 0.85, 0.2, 18);
  }

  // Après la bascule : les mains quittent le rebord en poussant, puis reviennent au calme.
  _poseMantleRecover(h) {
    this._setFree(h, 0.22, -0.48, -0.22, 0.05, -0.55, -1, 0, -1, 0.25, 0.3, 0.6, 0.25, 9);
  }

  _poseSlide(h) {
    // Main droite tendue devant pour l'équilibre, main gauche basse qui frôle le sol.
    if (h.side > 0) this._setFree(h, 0.26, -0.27, -0.36, 0.3, 0.2, -1, -0.3, -1, 0.05, 0.25, 0.75, 0.25, 10);
    else this._setFree(h, 0.33, -0.44, -0.16, 0.45, -0.55, -1, -0.15, -1, 0.15, 0.15, 0.85, 0.15, 10);
  }

  // Main à plat contre un plan vertical (mur), à une hauteur et un décalage latéral donnés.
  // nwx/nwz : normale du mur (vers le joueur). Position du plan via `planeDist` (depuis la caméra).
  _poseOnWall(h, cx, cy, cz, nwx, nwz, planeDist, along, lateral, height, fUpX, fUpZ, curl, omega, lean = 0.5, inset = 0) {
    // Direction vers le mur
    const tx = -nwx, tz = -nwz;
    const d = planeDist - PALM_LIFT - inset;
    const wp = this.v1.set(cx + tx * d + fUpX * along + lateral.x, cy + height, cz + tz * d + fUpZ * along + lateral.z);
    // Doigts vers le haut, un peu dans le sens de la marche ; paume vers le mur
    const wf = this.v2.set(fUpX * lean, 0.86, fUpZ * lean).normalize();
    const wn = this.v3.set(tx, 0, tz);
    this._setWorld(h, wp, wf, wn, curl, 0.9, 0.15, omega);
  }

  // ---------- Contacts : une main posée dans le monde ----------

  // Pose la main h sur une surface : poignet en wp (monde), doigts selon wf, paume contre la
  // surface de normale wn (tournée vers le joueur). La main part de là où elle est.
  _plant(h, wp, wf, wn, curl, spread, delay = 0, rate = 22) {
    if (h.anchorActive && h.anchorW > 0.05) h.anchorW = 0;
    h.wallHold = false;
    h.anchor.copy(wp);
    h.anchorN.copy(wn);
    this.n.copy(wn).negate();
    this._quatFrom(this.f.copy(wf), this.n, h.anchorQ);
    h.anchorActive = true;
    h.anchorCurl = curl;
    h.anchorSpread = spread;
    h.anchorDelay = delay;
    h.anchorAge = 0;
    h.anchorRate = rate;
    h.anchorHold = 0.06;
    h.anchorMode = this.player.mode;
    h.reachExt = SHOULDER_REACH;
    // Pour le son (facultatif) : une paume vient de se poser (mur, rebord, muret).
    this.player.emit('touch', { side: h.side, wall: Math.abs(wn.y) < 0.5 });
  }

  // Prise glissante (course murale) : la main reste sur la surface et se déplace avec le corps.
  _slideAnchor(h, wp, wf, wn) {
    h.anchor.copy(wp);
    h.anchorN.copy(wn);
    this.n.copy(wn).negate();
    this._quatFrom(this.f.copy(wf), this.n, h.anchorQ);
  }

  _release(h) {
    h.anchorActive = false;
    h.wallHold = false;
  }

  // Main posée contre un mur au sol (mur devant soi, ou mur longé) : la pose libre que
  // _poseOnWall vient de calculer (v1 : poignet, v2 : doigts) devient une vraie prise.
  _holdPose(h, nx, nz) {
    this.v3.set(nx, 0, nz);
    if (!h.anchorActive || !h.wallHold) this._plant(h, this.v1, this.v2, this.v3, 0.1, 1.15, 0, 16);
    else this._slideAnchor(h, this.v1, this.v2, this.v3);
    h.wallHold = true;
  }

  // Plan d'un mur (coordonnée de la face tournée vers le joueur).
  _plane(w) {
    const b = w.box;
    return w.nx !== 0 ? (w.nx < 0 ? b.minX : b.maxX) : (w.nz < 0 ? b.minZ : b.maxZ);
  }

  // Point du mur w, à partir d'une position (x, z) projetée sur la face, à la hauteur y.
  _wallPoint(w, x, y, z, out) {
    const plane = this._plane(w);
    const off = PALM_LIFT + faceInset(w.box);
    out.set(x, y, z);
    if (w.nx !== 0) out.x = plane + w.nx * off;
    else out.z = plane + w.nz * off;
    return out;
  }

  // Rétablissement : les deux paumes se plaquent sur le rebord, doigts vers l'avant.
  _plantOnLedge() {
    const m = this.player.mantle;
    if (!m) return;
    const dx = m.dx, dz = m.dz;
    const rx = -dz, rz = dx; // droite quand on regarde (dx, dz)
    for (const h of this.hands) {
      const lat = 0.2 * h.side;
      let ax = m.sx + rx * lat, az = m.sz + rz * lat;
      if (dx !== 0) ax = m.edge + dx * 0.1;
      else az = m.edge + dz * 0.1;
      this.v1.set(ax, m.top + PALM_LIFT, az);
      this.v2.set(dx + rx * 0.3 * h.side, 0, dz + rz * 0.3 * h.side);
      this.v3.set(0, 1, 0);
      // La main droite arrive un peu avant la gauche : moins mécanique.
      this._plant(h, this.v1, this.v2, this.v3, -0.06, 1.2, h.side > 0 ? 0 : 0.04, 26);
    }
  }

  // Franchissement : la main gauche se pose sur le dessus du muret et s'y appuie ; le corps
  // passe par-dessus. La paume reste à plat sur le dessus et glisse un peu, tant que le
  // muret est sous elle ; sur un muret mince, elle s'arrête au bord et le corps la dépasse.
  _plantVault() {
    this._vaultContact(0, this.camera.position, true);
  }

  _vaultContact(dt, cp, first = false) {
    const m = this.player.mantle;
    const h = this.hands[1];
    if (!m || !m.vault) return;
    const t = m.t / m.duration;
    if (t > 0.6) {
      this._release(h);
      return;
    }
    const dx = m.dx, dz = m.dz;
    const rx = -dz, rz = dx;
    const ahead = 0.6 - 0.14 * smoothstep(0.1, 0.55, t);
    let ax = cp.x + dx * ahead - rx * 0.12, az = cp.z + dz * ahead - rz * 0.12;
    // Toujours sur le dessus de l'obstacle, entre l'arête et le bord opposé.
    const lo = Math.min(m.edge + (dx + dz) * 0.05, m.far - (dx + dz) * 0.07);
    const hi = Math.max(m.edge + (dx + dz) * 0.05, m.far - (dx + dz) * 0.07);
    if (dx !== 0) ax = Math.min(hi, Math.max(lo, ax));
    else az = Math.min(hi, Math.max(lo, az));
    this.v1.set(ax, m.top + PALM_LIFT, az);
    this.v2.set(dx - rx * 0.45, 0, dz - rz * 0.45);
    this.v3.set(0, 1, 0);
    if (first || !h.anchorActive) {
      if (!first && t > 0.3) return;
      this._plant(h, this.v1, this.v2, this.v3, -0.03, 1.3, 0, 34);
      h.anchorHold = 0.16; // le corps vient vers la main : on ne lâche pas tout de suite
      h.reachExt = 0.46; // le buste plonge vers le muret (l'épaule reste hors du cadre)
      h.pole.set(0.3, -0.9, 0.35);
    } else {
      this._slideAnchor(h, this.v1, this.v2, this.v3);
    }
  }

  // Escalade : les mains claquent l'une après l'autre sur le mur, au-dessus de la tête, et y
  // restent : le corps monte, la main posée glisse vers le bas de l'écran, l'autre la relaie.
  _climbContacts(dt, entered, cp) {
    const pl = this.player;
    const w = pl.wall;
    if (entered) {
      this.slapT = 0;
      this.slapSide = 1;
    }
    this.slapT -= dt;
    if (this.slapT <= 0) {
      const h = this.hands[this.slapSide > 0 ? 0 : 1];
      const rx = w.nz, rz = -w.nx; // droite quand on fait face au mur
      const lat = 0.16 * h.side;
      const y = Math.min(cp.y + 0.2, w.box.maxY - 0.12);
      this._wallPoint(w, cp.x + rx * lat, y, cp.z + rz * lat, this.v1);
      this.v2.set(rx * 0.22 * h.side, 1, rz * 0.22 * h.side);
      this.v3.set(w.nx, 0, w.nz);
      this._plant(h, this.v1, this.v2, this.v3, -0.02, 1.3, 0, 34);
      this.slapSide = -this.slapSide;
      this.slapT = 1 / (pl.p.climbKick * 0.95);
    }
  }

  // Course murale : la main côté mur reste plaquée sur la paroi, en avant de l'épaule ; elle
  // glisse avec le corps, se soulève brièvement et se repose plus loin, au rythme de la course.
  _wallrunContacts(dt, entered, cp) {
    const pl = this.player;
    const w = pl.wall;
    const h = this.hands[w.side > 0 ? 0 : 1];
    if (entered) this.wallCycle = 0;
    this.wallCycle += dt * 1.6;
    const sp = pl.visualSpeed || 1;
    const ux = pl.vel.x / sp, uz = pl.vel.z / sp;
    const c = this.wallCycle % 1;
    const along = 0.45 - 0.13 * c;
    const vp = pl.viewPos;
    const y = vp.y + 1.43 + 0.02 * Math.sin(c * Math.PI);
    this._wallPoint(w, cp.x + ux * along, y, cp.z + uz * along, this.v1);
    this.v2.set(ux * 0.74, 0.67, uz * 0.74);
    this.v3.set(w.nx, 0, w.nz);
    // Coude vers le bas et vers le corps : il ne doit pas entrer dans le mur.
    h.pole.set(-0.25, -1, 0.15);
    const lifted = c > 0.84 || this.modeT < 0.06;
    if (!lifted) {
      if (!h.anchorActive) this._plant(h, this.v1, this.v2, this.v3, -0.06, 1.35, 0, 20);
      else this._slideAnchor(h, this.v1, this.v2, this.v3);
    } else {
      this._release(h);
    }
    // Cible libre : juste décollée du mur et un peu plus en avant (la main se repose devant).
    this.v1.x += w.nx * 0.06 + ux * 0.14;
    this.v1.z += w.nz * 0.06 + uz * 0.14;
    this._setWorld(h, this.v1, this.v2, this.v3, 0.05, 0.85, 0.15, 18);
  }

  // ---------- Mise à jour (chaque image, après la caméra) ----------

  update(dt) {
    const pl = this.player;
    const cam = this.camera;
    this.time += dt;
    cam.updateMatrixWorld();
    this.camInv.copy(cam.matrixWorld).invert();
    this.camQ.copy(cam.quaternion);
    this.camQInv.copy(cam.quaternion).invert();
    const cp = cam.position;
    const mode = pl.mode;
    const entered = mode !== this.lastMode;
    this.lastMode = mode;
    this.modeT = entered ? 0 : this.modeT + dt;
    const speed = pl.visualSpeed;
    const k = Math.min(1.2, speed / pl.p.runSpeed);
    const phase = pl.cam.bobPhase;
    const vp = pl.viewPos;

    // Inertie de la vue : les mains traînent un peu derrière les mouvements de souris.
    if (dt > 0) {
      let dyaw = pl.yaw - this.lastYaw;
      while (dyaw > Math.PI) dyaw -= Math.PI * 2;
      while (dyaw < -Math.PI) dyaw += Math.PI * 2;
      const dpitch = pl.pitch - this.lastPitch;
      this.swayX += (THREE.MathUtils.clamp((dyaw / dt) * 0.01, -0.035, 0.035) - this.swayX) * dampK(9, dt);
      this.swayY += (THREE.MathUtils.clamp((-dpitch / dt) * 0.008, -0.03, 0.03) - this.swayY) * dampK(9, dt);
    }
    this.lastYaw = pl.yaw;
    this.lastPitch = pl.pitch;

    // Changement de mouvement : les prises d'avant se relâchent (sauf celles posées à l'instant).
    if (entered) {
      for (const h of this.hands) if (h.anchorActive && h.anchorMode !== mode) this._release(h);
    }
    this.brace = Math.max(0, this.brace - dt * 2.8);
    this.jumpKick = Math.max(0, this.jumpKick - dt * 3.2);

    // Mur juste devant (au sol, lentement) : on y pose les mains plutôt que de le traverser.
    let touchDist = Infinity;
    const hit = this.hit;
    if (mode === 'ground' && speed < 3.5) {
      const fx = -Math.sin(pl.yaw), fz = -Math.cos(pl.yaw);
      touchDist = this.physics.raycast(cp.x, cp.y - 0.25, cp.z, fx, 0, fz, 0.62, hit);
    }

    // Muret droit devant en pleine course : la main gauche descend déjà vers lui.
    let ahead = 0;
    if (mode === 'ground' && speed > 3) {
      const ux = pl.vel.x / speed, uz = pl.vel.z / speed;
      const h2 = this.hit2;
      const d = this.physics.raycast(vp.x, vp.y + 0.36, vp.z, ux, 0, uz, 2.4, h2);
      if (d < 2.4 && h2.box && Math.abs(h2.nx * ux + h2.nz * uz) > 0.7) {
        const top = h2.box.maxY - vp.y;
        if (top > pl.p.stepHeight && top <= pl.p.vaultHeight + 0.01) ahead = 1 - smoothstep(0.7, 2.3, d);
      }
    }
    this.vaultAhead += (ahead - this.vaultAhead) * dampK(ahead > this.vaultAhead ? 12 : 6, dt);

    // Mur qui longe la course : la main de ce côté vient l'effleurer.
    const brush = this.brush;
    brush[0] = brush[1] = Infinity;
    if (mode === 'ground' && speed > 2.5 && touchDist === Infinity) {
      const rx = Math.cos(pl.yaw), rz = -Math.sin(pl.yaw);
      const ux = pl.vel.x / speed, uz = pl.vel.z / speed;
      for (let i = 0; i < 2; i++) {
        const sd = i === 0 ? 1 : -1;
        const d = this.physics.raycast(cp.x, cp.y - 0.4, cp.z, rx * sd, 0, rz * sd, 0.62, hit);
        if (d < 0.62 && Math.abs(hit.nx * ux + hit.nz * uz) < 0.35) {
          brush[i] = d * Math.abs(rx * hit.nx + rz * hit.nz);
          this.brushInset[i] = faceInset(hit.box);
          this.brushN[i * 2] = hit.nx;
          this.brushN[i * 2 + 1] = hit.nz;
        }
      }
    }

    // Prises selon le mouvement
    const m = pl.mantle;
    for (const h of this.hands) h.pole.set(0.55, -0.85, 0.25);
    if (mode === 'climb' && pl.wall) this._climbContacts(dt, entered, cp);
    else if (mode === 'mantle' && m && m.vault) {
      this._vaultContact(dt, cp);
      this.hands[1].pole.set(0.3, -0.9, 0.35);
    } else if (mode === 'mantle' && m) {
      // Suspendu, les mains agrippent l'arête (poignets au bord, doigts repliés dessus) ;
      // en se hissant, elles avancent un peu sur le dessus et s'ouvrent à plat pour pousser.
      const grip = m.phase === 'pull' ? 1 - smoothstep(0.3, 0.75, m.u) : 0;
      const inset = 0.1 - 0.1 * grip;
      for (const h of this.hands) {
        if (!h.anchorActive || h.anchorMode !== 'mantle') continue;
        if (m.phase === 'push' && m.u > 0.58) {
          this._release(h);
          continue;
        }
        if (m.dx !== 0) h.anchor.x = m.edge + m.dx * inset;
        else h.anchor.z = m.edge + m.dz * inset;
        h.anchorCurl = -0.06 + 0.5 * grip;
      }
    }

    const vy = pl.vel.y;
    for (const h of this.hands) {
      if (mode === 'ground') {
        if (touchDist < 0.6 && hit.box) {
          // La main droite à droite du regard, la gauche à gauche, paumes contre le mur.
          const rx = Math.cos(pl.yaw), rz = -Math.sin(pl.yaw);
          const fx = -rz, fz = rx;
          const planeDist = touchDist * Math.abs(fx * hit.nx + fz * hit.nz);
          this.v4.set(rx * 0.2 * h.side, 0, rz * 0.2 * h.side);
          this._poseOnWall(h, cp.x, cp.y, cp.z, hit.nx, hit.nz, planeDist, 0, this.v4, -0.3 + 0.03 * h.side, 0, 0, 0.2, 12, 0.5, faceInset(hit.box));
          this._holdPose(h, hit.nx, hit.nz);
        } else if (this.brush[h.side > 0 ? 0 : 1] < 0.6) {
          // Doigts qui glissent sur le mur, un peu devant, au rythme des pas.
          const i = h.side > 0 ? 0 : 1;
          const ux = pl.vel.x / speed, uz = pl.vel.z / speed;
          const st = Math.sin(phase);
          this.v4.set(0, 0, 0);
          this._poseOnWall(h, cp.x, cp.y, cp.z, this.brushN[i * 2], this.brushN[i * 2 + 1], this.brush[i], 0.34 + 0.04 * st, this.v4, -0.3 + 0.025 * Math.abs(st), ux, uz, 0.18, 16, 2.2, this.brushInset[i]);
          this._holdPose(h, this.brushN[i * 2], this.brushN[i * 2 + 1]);
        } else {
          if (h.wallHold) this._release(h);
          h.wallHold = false;
          if (speed > 0.6) this._poseRun(h, k, phase);
          else this._poseHidden(h);
        }
        if (h.side < 0 && this.vaultAhead > 0.01) this._blendPose(h, this.vaultAhead, this._poseVaultReach);
        if (this.brace > 0.01) this._blendPose(h, this.brace, this._poseBrace);
      } else if (mode === 'air') {
        this._poseAir(h, vy);
        if (this.jumpKick > 0.01) this._blendPose(h, this.jumpKick, this._poseTakeoff);
      } else if (mode === 'wallrun' && pl.wall) {
        if (h.side !== pl.wall.side) {
          // L'autre main s'ouvre vers le vide pour l'équilibre.
          this._setFree(h, 0.3, -0.31, -0.3, 0.5, 0.15, -1, -0.3, -1, 0, 0.3, 0.75, 0.2, 10);
        }
      } else if (mode === 'climb' && pl.wall) {
        this._poseClimbReach(h);
      } else if (mode === 'slide') {
        this._poseSlide(h);
      } else if (mode === 'mantle' && m && m.vault) {
        const t = m.t / m.duration;
        if (h.side < 0) this._poseVaultReach(h);
        else this._poseVaultFree(h, t);
      } else if (mode === 'mantle' && m) {
        this._poseMantleRecover(h);
      } else {
        this._poseAir(h, 0);
      }
    }
    if (mode === 'wallrun' && pl.wall) this._wallrunContacts(dt, entered, cp);

    // Geste vers une lueur : la main la plus proche s'ouvre et la frôle.
    if (this.reachT >= 0) {
      this.reachT += dt;
      const D = 0.5;
      if (this.reachT > D || (mode !== 'ground' && mode !== 'air')) this.reachT = -1;
      else {
        const w = Math.sin((this.reachT / D) * Math.PI);
        const h = this.hands[this.reachSide > 0 ? 0 : 1];
        if (!h.anchorActive) {
          const tp = this.reachPos;
          h.tPos.lerp(tp, w);
          this.f.copy(tp).normalize();
          this.n.set(-0.4 * h.side, -0.3, -0.85);
          this._quatFrom(this.f, this.n, this.q1);
          h.tQuat.slerp(this.q1, w);
          h.tCurl += (0.05 - h.tCurl) * w;
          h.tSpread += (0.9 - h.tSpread) * w;
          h.omega = Math.max(h.omega, 16);
        }
      }
    }

    // Lissage, prises et résultat
    const breathe = Math.sin(this.time * 1.6) * 0.004;
    const armMax = UPPER_LEN + FORE_LEN;
    for (const h of this.hands) {
      h.tPos.x += this.swayX;
      h.tPos.y += this.swayY + breathe;
      springVec(h.pos, h.vel, h.tPos, h.omega, dt);
      h.quat.slerp(h.tQuat, dampK(h.omega * 0.9, dt));
      const kf = dampK(12, dt);
      h.curl += (h.tCurl - h.curl) * kf;
      h.spread += (h.tSpread - h.spread) * kf;
      h.thumb += (h.tThumb - h.thumb) * kf;

      if (h.anchorActive) h.anchorAge += dt;
      const wTarget = h.anchorActive && h.anchorAge >= h.anchorDelay ? 1 : 0;
      h.anchorW += (wTarget - h.anchorW) * dampK(wTarget ? h.anchorRate : 10, dt);
      h.P.copy(h.pos);
      h.Q.copy(h.quat);
      let curl = h.curl, spread = h.spread;
      h.contactW = 0;
      if (h.anchorW > 0.001) {
        const ap = this.v1.copy(h.anchor).applyMatrix4(this.camInv);
        // Hors de portée (même en avançant l'épaule) : la main lâche plutôt que de flotter.
        const reach = ap.distanceTo(this.v2.set(SHOULDER.x * h.side, SHOULDER.y, SHOULDER.z));
        const reachW = 1 - smoothstep(armMax + h.reachExt - 0.06, armMax + h.reachExt + 0.02, reach);
        if (reachW < 0.05 && h.anchorActive && h.anchorAge > h.anchorDelay + (h.anchorHold || 0.06)) this._release(h);
        const w = h.anchorW * reachW;
        // En arrivant, la main vient d'un peu au-dessus de la surface, puis s'y plaque.
        const lift = 0.07 * (1 - h.anchorW) * w;
        this.v3.copy(h.anchorN).applyQuaternion(this.camQInv);
        ap.addScaledVector(this.v3, lift);
        h.P.lerp(ap, w);
        this.q1.copy(this.camQInv).multiply(h.anchorQ);
        h.Q.slerp(this.q1, w);
        curl += (h.anchorCurl - curl) * w;
        spread += (h.anchorSpread - spread) * w;
        h.contactW = w * smoothstep(0.55, 0.95, h.anchorW);
        // Main bien posée : le ressort libre la suit, pour qu'elle reparte d'ici en lâchant.
        if (w > 0.95) {
          h.vel.subVectors(h.P, h.pos).multiplyScalar(dt > 0 ? 0.5 / dt : 0).clampLength(0, 3);
          h.pos.copy(h.P);
          h.quat.copy(h.Q);
        }
      }
      this._applyArm(h, curl, spread, h.thumb);
    }

    this._updateLegs(dt, mode, cp);
    this._updateShadows();

    // La mesh suit la caméra ; on retient sa position pour la reconnaître au rendu.
    this.mesh.position.copy(cp);
    this.mesh.quaternion.copy(this.camQ);
    this._stamp.copy(cp);
  }

  // Ombres de contact : une tache douce sous chaque paume posée, à plat sur la surface.
  _updateShadows() {
    for (let i = 0; i < 2; i++) {
      const h = this.hands[i];
      const s = this.shadows[i];
      s.userData.on = h.contactW > 0.03;
      if (!s.userData.on) continue;
      const n = this.v1.copy(h.anchorN);
      // Doigts projetés sur la surface : la tache s'allonge sous la main.
      const f = this.v2.set(0, 0, -1).applyQuaternion(h.anchorQ);
      f.addScaledVector(n, -f.dot(n));
      if (f.lengthSq() < 1e-6) f.set(0, 1, 0).addScaledVector(n, -n.y);
      f.normalize();
      const x = this.v3.crossVectors(f, n);
      this.m4.makeBasis(x, f, n);
      s.quaternion.setFromRotationMatrix(this.m4);
      s.position.copy(h.anchor).addScaledVector(n, 0.005 - PALM_LIFT).addScaledVector(f, 0.045);
      // Vue rasante : la tache s'étirerait en traînée sombre, on l'efface.
      const toCam = this.v4.subVectors(this.camera.position, s.position).normalize();
      s.material.opacity = 0.62 * h.contactW * smoothstep(0.15, 0.45, Math.abs(toCam.dot(n)));
    }
  }

  // Mélange la cible courante avec une autre pose (poids w).
  _blendPose(h, w, pose) {
    const p = this.v1.copy(h.tPos), q = this.q1.copy(h.tQuat);
    const c = h.tCurl, sp = h.tSpread, om = h.omega;
    pose.call(this, h);
    h.tPos.lerp(p, 1 - w);
    h.tQuat.slerp(q, 1 - w);
    h.tCurl = h.tCurl * w + c * (1 - w);
    h.tSpread = h.tSpread * w + sp * (1 - w);
    h.omega = Math.max(om, h.omega * w);
  }

  // Petit état lisible par les tests (distance poignet / prise, poids du contact).
  debug() {
    const out = { va: +this.vaultAhead.toFixed(2) };
    for (const h of this.hands) {
      const key = h.side > 0 ? 'R' : 'L';
      if (h.anchorActive || h.anchorW > 0.05) {
        const wp = this.v1.copy(h.P).applyMatrix4(this.camera.matrixWorld);
        out[key + 'gap'] = +wp.distanceTo(h.anchor).toFixed(3);
        out[key + 'w'] = +h.contactW.toFixed(2);
      }
    }
    return out;
  }

  // ---------- Os ----------

  _setSegment(i, A, B, up) {
    const te = this.bones[i].matrix.elements;
    const z = this.hz.subVectors(A, B);
    const len = z.length();
    if (len < 1e-6) z.set(0, 0, 1); else z.multiplyScalar(1 / len);
    const x = this.hx.crossVectors(up, z);
    if (x.lengthSq() < 1e-8) x.crossVectors(this.v5.set(1, 0, 0), z);
    if (x.lengthSq() < 1e-8) x.crossVectors(this.v5.set(0, 0, 1), z);
    x.normalize();
    const y = this.hy.crossVectors(z, x);
    te[0] = x.x; te[1] = x.y; te[2] = x.z; te[3] = 0;
    te[4] = y.x; te[5] = y.y; te[6] = y.z; te[7] = 0;
    te[8] = z.x; te[9] = z.y; te[10] = z.z; te[11] = 0;
    te[12] = A.x; te[13] = A.y; te[14] = A.z; te[15] = 1;
    this.bones[i].matrixWorldNeedsUpdate = true;
  }

  _hideBone(i) {
    const te = this.bones[i].matrix.elements;
    te.fill(0);
    te[13] = -3;
    te[15] = 1;
    this.bones[i].matrixWorldNeedsUpdate = true;
  }

  // Cinématique inverse à deux os : épaule S, cible T, coude E (vers le pôle).
  _solve(S, T, a, b, pole, outE, outT) {
    const d = this.v3.subVectors(T, S);
    let len = d.length();
    if (len < 1e-6) { d.set(0, 0, -1); len = 1e-6; } else d.multiplyScalar(1 / len);
    const maxL = a + b - 0.002, minL = Math.abs(a - b) + 0.01;
    const L = Math.min(maxL, Math.max(minL, len));
    outT.copy(S).addScaledVector(d, L);
    const cosA = (a * a + L * L - b * b) / (2 * a * L);
    const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
    const pv = this.v4.subVectors(pole, S);
    pv.addScaledVector(d, -pv.dot(d));
    if (pv.lengthSq() < 1e-8) pv.set(0, -1, 0).addScaledVector(d, d.y);
    pv.normalize();
    outE.copy(S).addScaledVector(d, a * cosA).addScaledVector(pv, a * sinA);
  }

  _applyArm(h, curl, spread, thumb) {
    const s = h.side;
    const o = (s > 0 ? 0 : 1) * ARM_BONES;
    const S = this.S.set(SHOULDER.x * s, SHOULDER.y, SHOULDER.z);
    // Prise lointaine : l'épaule s'avance vers elle (le buste se penche), dans une limite.
    const toP = this.v3.subVectors(h.P, S);
    const dist = toP.length();
    const maxL = UPPER_LEN + FORE_LEN - 0.004;
    if (dist > maxL) S.addScaledVector(toP, Math.min(dist - maxL, h.reachExt) / dist);
    const pole = this.pole.set(S.x + h.pole.x * s, S.y + h.pole.y, S.z + h.pole.z);
    this._solve(S, h.P, UPPER_LEN, FORE_LEN, pole, this.E, this.T);
    const up = this.j1.set(0, 1, 0);
    this._setSegment(o + B_UPPER, S, this.E, up);
    // L'avant-bras tourne avec le poignet : son « haut » suit le dos de la main.
    const hy = this.handUp.set(0, 1, 0).applyQuaternion(h.Q);
    this._setSegment(o + B_FORE, this.E, this.T, hy);

    // Main
    const H = this.bones[o + B_HAND].matrix;
    H.compose(this.T, h.Q, this.v5.set(1, 1, 1));
    this.bones[o + B_HAND].matrixWorldNeedsUpdate = true;

    // Doigts : positions des articulations dans le repère de la main, puis dans la mesh.
    const handUp = hy;
    const A = this.v1, B = this.v2;
    for (let fi = 0; fi < 4; fi++) {
      const F = FINGERS[fi];
      const sp = (F.spread * (0.4 + spread)) * 1.0;
      const extra = fi === 3 ? 0.12 : fi === 2 ? 0.05 : 0;
      const c0 = 0.12 + (curl + extra) * 1.3;
      const c1 = 0.1 + (curl + extra) * 1.6;
      const c2 = 0.06 + (curl + extra) * 1.0;
      let ang = 0;
      A.set(F.k[0] * s, F.k[1], F.k[2]);
      for (let j = 0; j < 3; j++) {
        ang += j === 0 ? c0 : j === 1 ? c1 : c2;
        const ca = Math.cos(ang), sa = Math.sin(ang);
        B.set(-ca * Math.sin(sp) * s, -sa, -ca * Math.cos(sp)).multiplyScalar(F.len[j]).add(A);
        const Am = this.j0.copy(A).applyMatrix4(H);
        const Bm = this.v3.copy(B).applyMatrix4(H);
        this._setSegment(o + B_FINGER + fi * 3 + j, Am, Bm, handUp);
        A.copy(B);
      }
    }
    // Pouce : direction de base entre ouvert et replié sur la paume, puis flexion.
    const dir = this.tDir.set(-0.62 + 0.55 * thumb, -0.28 - 0.32 * thumb, -0.73).normalize();
    const inward = this.tIn.set(1, -0.55, -0.15).normalize();
    const axis = this.tAxis.crossVectors(dir, inward).normalize();
    A.set(THUMB.k[0], THUMB.k[1], THUMB.k[2]);
    for (let j = 0; j < 3; j++) {
      if (j === 1) dir.applyAxisAngle(axis, 0.15 + 0.45 * thumb);
      else if (j === 2) dir.applyAxisAngle(axis, 0.12 + 0.6 * thumb);
      B.copy(A).addScaledVector(dir, THUMB.len[j]);
      const Am = this.j0.set(A.x * s, A.y, A.z).applyMatrix4(H);
      const Bm = this.v3.set(B.x * s, B.y, B.z).applyMatrix4(H);
      this._setSegment(o + B_THUMB + j, Am, Bm, handUp);
      A.copy(B);
    }
  }

  // Jambes : pendant la glissade, la droite tendue devant (pointe en l'air), la gauche
  // repliée dessous, genou levé vers l'extérieur. En regardant ses pieds au sol ou en l'air,
  // on les voit courir (foulée accordée au balancier des bras et au rythme des pas).
  _updateLegs(dt, mode, cp) {
    const pl = this.player;
    const slide = mode === 'slide';
    const pitch = pl.pitch + pl.cam.pitchOffset;
    const look = mode === 'ground' || mode === 'air' ? smoothstep(-0.42, -0.72, pitch) : 0;
    const target = slide ? 1 : look;
    this.legW += (target - this.legW) * dampK(target > this.legW ? 10 : 12, dt);
    this.legSlide += ((slide ? 1 : 0) - this.legSlide) * dampK(12, dt);
    if (this.legW < 0.02) {
      for (let i = 0; i < 6; i++) this._hideBone(LEG_BASE + i);
      return;
    }
    const w = this.legW;
    const ws = this.legSlide;
    // Les hanches suivent le regard (comme le buste), pas la vitesse : en glissant de biais,
    // les jambes restent devant soi.
    const dx = -Math.sin(pl.yaw), dz = -Math.cos(pl.yaw);
    const rx = -dz, rz = dx;
    const vp = pl.viewPos;
    const gx = vp.x, gy = vp.y, gz = vp.z;
    const S = this.S, T = this.T, E = this.E, pole = this.pole;
    const tuck = 1 - w;
    // Les pieds bercent à peine : la glissade reste douce.
    const sway = Math.sin(this.time * 7) * 0.012;
    const k = Math.min(1, pl.visualSpeed / pl.p.runSpeed);
    const air = mode === 'air' ? 1 : 0;
    for (let side = 0; side < 2; side++) {
      const s = side === 0 ? 1 : -1;
      const o = LEG_BASE + side * 3;
      // Glissade
      let hipF = -0.05, hipH = 0.42, hipL = 0.11;
      let fwd, lat, h, pf, ph, pl2;
      if (s > 0) { fwd = 0.92; lat = 0.11; h = 0.15 + sway; pf = 0.5; ph = 0.9; pl2 = 0.15; } else { fwd = 0.42; lat = 0.22; h = 0.07; pf = 0.4; ph = 0.75; pl2 = 0.55; }
      if (ws < 0.999) {
        // Course : pied d'appui qui recule au sol, pied libre qui revient en se levant.
        const phase = pl.cam.bobPhase + (s > 0 ? Math.PI : 0);
        const c = Math.cos(phase), sn = Math.sin(phase);
        const stride = 0.4 * k;
        let rf = 0.1 - stride * c;
        let rh = 0.09 + Math.max(0, sn) * (0.1 + 0.2 * k);
        // En l'air : jambes un peu repliées, l'une devant l'autre.
        rf += (0.12 + 0.14 * s - rf) * air;
        rh += (0.36 + 0.06 * s - rh) * air;
        const b = 1 - ws;
        hipF += (0.0 - hipF) * b;
        hipH += (0.92 - hipH) * b;
        hipL += (0.1 - hipL) * b;
        fwd += (rf - fwd) * b;
        lat += (0.12 - lat) * b;
        h += (rh - h) * b;
        pf += (1.0 - pf) * b;
        ph += (0.1 - ph) * b;
        pl2 += (0.1 - pl2) * b;
      }
      S.set(gx + rx * hipL * s + dx * hipF, gy + hipH, gz + rz * hipL * s + dz * hipF);
      fwd -= tuck * 0.7 * ws;
      h -= tuck * 0.12 * ws;
      const ankle = this.v1.set(gx + dx * fwd + rx * lat * s, gy + h, gz + dz * fwd + rz * lat * s);
      if (s > 0) pole.set(S.x + dx * pf + rx * pl2, S.y + ph, S.z + dz * pf + rz * pl2);
      else pole.set(S.x + dx * pf - rx * pl2, S.y + ph, S.z + dz * pf - rz * pl2);
      // Repère caméra
      S.applyMatrix4(this.camInv);
      ankle.applyMatrix4(this.camInv);
      pole.applyMatrix4(this.camInv);
      this._solve(S, ankle, THIGH_LEN, SHIN_LEN, pole, E, T);
      const up = this.j1.set(0, 1, 0);
      this._setSegment(o, S, E, up);
      this._setSegment(o + 1, E, T, up);
      // Pied : tendu, pointe vers le haut ; replié, presque à plat ; en course, à plat.
      if (s > 0) {
        this.f.set(dx * 0.85 + rx * 0.12, 0.4 * ws - 0.05 * (1 - ws), dz * 0.85 + rz * 0.12);
        this.n.set(dx * 0.35 * ws, -0.9, dz * 0.35 * ws);
      } else {
        this.f.set(dx * 0.85 - rx * 0.4 * ws, -0.15 * ws - 0.05 * (1 - ws), dz * 0.85 - rz * 0.4 * ws);
        this.n.set(-rx * 0.2 * ws, -1, -rz * 0.2 * ws);
      }
      this.f.applyQuaternion(this.camQInv);
      this.n.applyQuaternion(this.camQInv);
      this._quatFrom(this.f, this.n, this.q1);
      const Fm = this.bones[o + 2].matrix;
      Fm.compose(T, this.q1, this.v5.set(1, 1, 1));
      this.bones[o + 2].matrixWorldNeedsUpdate = true;
    }
  }
}
