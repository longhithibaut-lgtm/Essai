import * as THREE from 'three';
import { FirstPersonBody } from './arms.js';

// Réglages du mouvement. Toutes les unités sont en mètres et secondes.
//
// Enveloppe garantie pour le dessin du niveau (au moins celle de la version précédente) :
// saut à plat ≈ 5,6 m à pleine course, sommet ≈ 1,37 m, saut vers +0,5 m ≈ 4,9 m,
// course murale > 12 m sans perdre d'altitude, escalade ≈ 2,7 m + 1,55 m d'allonge,
// franchissement jusqu'à 1,2 m, glissade sous 1,1 m.
export const PARAMS = {
  radius: 0.3,
  height: 1.8,
  slideHeight: 1.0,
  eye: 1.62,
  slideEye: 0.82,

  // Course : on prend de l'élan progressivement (≈ 0,6 s pour la pleine vitesse),
  // on tourne en arc sans perdre la vitesse et on s'arrête en glissant.
  runSpeed: 7.3,
  accelRate: 3.0, // approche exponentielle de la vitesse voulue (1/s)
  accelBase: 4.0, // plus une accélération constante (m/s²)
  slowDecel: 9, // quand la vitesse voulue baisse (stick analogique)
  turnRateLow: 16, // rad/s à l'arrêt
  turnRateHigh: 9, // rad/s à pleine course
  brake: 20, // demi-tour : on freine d'abord (m/s²)
  groundFriction: 7, // relâché : décroissance exponentielle (1/s)
  stopDecel: 3, // ... plus un freinage constant (≈ 0,9 m de glisse depuis la pleine course)
  momentumDecay: 2.6, // m/s² perdus au sol au-dessus de la vitesse de course
  backFactor: 0.62,
  strafeFactor: 0.86,

  airAccel: 14,
  gravity: 21,
  fallGravityScale: 1.1,
  apexHangSpeed: 1.5, // près du sommet du saut, la gravité s'adoucit
  apexHangScale: 0.65,
  jumpSpeed: 7.6,
  jumpCut: 0.72,
  jumpCutMinTime: 0.08,
  coyote: 0.15,
  buffer: 0.16,
  stepHeight: 0.42,
  maxSpeed: 15,

  wallrunMinSpeed: 4.2,
  wallrunTime: 1.7,
  wallrunSpeed: 8.6,
  wallGravity: 24,
  wallJumpOut: 6.0,
  wallJumpUp: 7.6,

  climbSpeed: 6.0,
  climbTime: 0.65,
  mantleReach: 1.55,
  vaultHeight: 1.2,
  mantleTime: 0.5,
  vaultTime: 0.36,

  slideMinSpeed: 4.6,
  slideBoost: 1.3,
  slideFriction: 2.2,
  slideMinTime: 0.35,

  // Caméra
  hfov: 100, // champ horizontal au repos (degrés)
  hfovRun: 5, // + à pleine course
  hfovMax: 112,
};

const EPS = 0.001;
const tmpBoxes = [];
const WALL_DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const AXIS = [0, 0];
const INTEGRATE = { hitX: false, hitZ: false, landed: false };

function damp(current, target, rate, dt) {
  return current + (target - current) * (1 - Math.exp(-rate * dt));
}

function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export class Player {
  constructor(physics, camera) {
    this.physics = physics;
    this.camera = camera;
    this.p = { ...PARAMS };

    this.pos = new THREE.Vector3();
    this.prevPos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;

    this.mode = 'ground'; // ground | air | wallrun | climb | mantle | slide
    this.grounded = false;
    this.height = this.p.height;
    this.coyoteTimer = 0;
    this.bufferTimer = 0;
    this.slideBuffer = 0;
    this.jumpCutDone = false;
    this.jumpAge = 0;
    this.modeTime = 0;
    this.climbUsed = false;
    this.wall = null; // { nx, nz, side, box }
    this.lastWall = null;
    this.lastWallNormal = null;
    this.wallCooldown = 0;
    this.mantle = null;
    this.airTime = 0;
    this.fallSpeed = 0;
    this.stepOffset = 0; // lissage de la caméra sur les marches
    this.prevStepOffset = 0;
    // Temps (caméra) depuis le dernier pas de simulation : en pause ou à l'arrivée, la
    // simulation s'arrête et la vitesse reste figée ; on ne doit plus « courir » à l'écran.
    this.simAge = 0;
    this.visualSpeed = 0;
    this._rx = 0;
    this._rz = 0;
    this._c = { dt: 0, s: null, fx: 0, fz: 0, rx: 0, rz: 0, wx: 0, wz: 0, wl: 0, fwd: 0, str: 0, dirFactor: 1, slidePressed: false };

    // Effets de caméra
    this.cam = {
      eye: this.p.eye,
      bobPhase: 0,
      bobAmount: 0,
      landOffset: 0,
      landVel: 0,
      nod: 0,
      nodVel: 0,
      roll: 0,
      fov: 70,
      hfov: this.p.hfov,
      pitchOffset: 0,
      shiftX: 0,
      dip: 0,
      heading: 0,
      turn: 0,
    };

    this.body = null;
    this.listeners = [];
  }

  // Corps à la première personne (bras, mains, jambes). Appelé une fois par le jeu.
  attachBody(scene) {
    if (!this.body) this.body = new FirstPersonBody(scene, this, this.physics, this.camera);
    return this.body;
  }

  onEvent(fn) {
    this.listeners.push(fn);
  }

  emit(type, data) {
    for (const fn of this.listeners) fn(type, data);
  }

  spawn(x, y, z, yaw = 0) {
    this.pos.set(x, y, z);
    this.prevPos.copy(this.pos);
    this.vel.set(0, 0, 0);
    this.yaw = yaw;
    this.pitch = 0;
    this.mode = 'ground';
    this.modeTime = 0;
    this.height = this.p.height;
    this.wall = null;
    this.lastWall = null;
    this.mantle = null;
    this.climbUsed = false;
    this.cam.eye = this.p.eye;
    this.cam.landOffset = 0;
    this.cam.landVel = 0;
    this.cam.nod = 0;
    this.cam.nodVel = 0;
    this.cam.roll = 0;
    this.cam.pitchOffset = 0;
    this.cam.shiftX = 0;
    this.cam.dip = 0;
    this.cam.bobAmount = 0;
    this.cam.turn = 0;
    this.cam.heading = yaw;
    this.fallSpeed = 0;
    this.airTime = 0;
    this.bufferTimer = 0;
    this.slideBuffer = 0;
    this.coyoteTimer = 0;
    this.stepOffset = 0;
    this.prevStepOffset = 0;
    this.simAge = 0;
    if (this.body) this.body.reset();
  }

  get speed() {
    return Math.hypot(this.vel.x, this.vel.z);
  }

  // ---------- Collision ----------

  _free(x, y, z, h = this.height) {
    const r = this.p.radius;
    return !this.physics.overlap(x - r, y, z - r, x + r, y + h, z + r);
  }

  _moveAxis(axis, delta, allowStep) {
    if (delta === 0) return false;
    const r = this.p.radius;
    const pos = this.pos;
    pos[axis] += delta;
    const hits = this.physics.overlapAll(pos.x - r, pos.y, pos.z - r, pos.x + r, pos.y + this.height, pos.z + r, tmpBoxes);
    if (hits.length === 0) return false;

    // Tentative de montée de marche (la caméra la lisse ensuite)
    if (allowStep && axis !== 'y') {
      let top = -Infinity;
      for (const b of hits) top = Math.max(top, b.maxY);
      if (top - pos.y <= this.p.stepHeight && top > pos.y && this._free(pos.x, top + EPS, pos.z)) {
        this.stepOffset = THREE.MathUtils.clamp(this.stepOffset - (top + EPS - pos.y), -0.5, 0.5);
        pos.y = top + EPS;
        return false;
      }
    }

    // Coin effleuré : si on ne mord que de quelques centimètres sur l'angle d'un obstacle,
    // on glisse à côté au lieu de s'y arrêter net (la course reste fluide).
    if (axis !== 'y' && this._cornerSlide(axis === 'x' ? 'z' : 'x', hits)) return false;

    let collided = false;
    for (const b of hits) {
      if (axis === 'x') {
        pos.x = delta > 0 ? Math.min(pos.x, b.minX - r - EPS) : Math.max(pos.x, b.maxX + r + EPS);
      } else if (axis === 'z') {
        pos.z = delta > 0 ? Math.min(pos.z, b.minZ - r - EPS) : Math.max(pos.z, b.maxZ + r + EPS);
      } else {
        pos.y = delta > 0 ? Math.min(pos.y, b.minY - this.height - EPS) : Math.max(pos.y, b.maxY + EPS);
      }
      collided = true;
    }
    return collided;
  }

  _cornerSlide(perp, hits) {
    const m = this.mode;
    if (m !== 'ground' && m !== 'air' && m !== 'slide') return false;
    const r = this.p.radius;
    const pos = this.pos;
    const axisV = Math.abs(perp === 'x' ? this.vel.z : this.vel.x);
    const perpV = perp === 'x' ? this.vel.x : this.vel.z;
    if (axisV < 2) return false;
    const minK = perp === 'x' ? 'minX' : 'minZ', maxK = perp === 'x' ? 'maxX' : 'maxZ';
    let shift = 0;
    for (const b of hits) {
      const s = pos[perp] < (b[minK] + b[maxK]) / 2 ? b[minK] - (pos[perp] + r) - EPS : b[maxK] - (pos[perp] - r) + EPS;
      if (Math.abs(s) > 0.13) return false;
      if (shift !== 0 && Math.sign(s) !== Math.sign(shift)) return false;
      if (Math.abs(s) > Math.abs(shift)) shift = s;
    }
    if (shift === 0) return false;
    // Jamais à rebours du mouvement principal.
    if (Math.sign(shift) !== Math.sign(perpV) && Math.abs(perpV) > axisV) return false;
    const before = pos[perp];
    pos[perp] += shift;
    if (this._free(pos.x, pos.y, pos.z)) return true;
    pos[perp] = before;
    return false;
  }

  _groundCheck() {
    const r = this.p.radius - 0.02;
    return !!this.physics.overlap(this.pos.x - r, this.pos.y - 0.06, this.pos.z - r, this.pos.x + r, this.pos.y + 0.01, this.pos.z + r);
  }

  // Mur adjacent dans une direction axiale (dx, dz). Renvoie la boîte ou null.
  _wallAt(dx, dz, reach = 0.18, yMin = 0.35, yMax = 0.25) {
    const r = this.p.radius;
    const x = this.pos.x + dx * reach;
    const z = this.pos.z + dz * reach;
    return this.physics.overlap(x - r, this.pos.y + yMin, z - r, x + r, this.pos.y + this.height - yMax, z + r);
  }

  // ---------- Mise à jour (pas fixe) ----------

  // Regard : appliqué à chaque image, hors du pas fixe, pour rester réactif.
  look(dx, dy) {
    this.yaw -= dx;
    this.pitch = THREE.MathUtils.clamp(this.pitch - dy, -1.52, 1.52);
  }

  update(dt, input) {
    const p = this.p;
    this.simAge = 0;
    this.prevPos.copy(this.pos);
    this.prevStepOffset = this.stepOffset;
    this.stepOffset *= Math.exp(-dt * 13);
    this.modeTime += dt;
    this.jumpAge += dt;
    this.wallCooldown = Math.max(0, this.wallCooldown - dt);

    // Saisie
    const s = input.state;
    if (input.consumePressed('jump')) this.bufferTimer = p.buffer;
    else this.bufferTimer = Math.max(0, this.bufferTimer - dt);
    const slidePressed = input.consumePressed('slide');
    if (slidePressed) this.slideBuffer = 0.15;
    else this.slideBuffer = Math.max(0, this.slideBuffer - dt);

    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
    let fwd, str;
    if (input.axis) {
      fwd = input.axis.y;
      str = input.axis.x;
    } else {
      fwd = (s.forward ? 1 : 0) - (s.back ? 1 : 0);
      str = (s.right ? 1 : 0) - (s.left ? 1 : 0);
    }
    let wx = fx * fwd + rx * str;
    let wz = fz * fwd + rz * str;
    let wl = Math.hypot(wx, wz);
    if (wl > 1) { wx /= wl; wz /= wl; wl = 1; } else if (wl > 0) { wx /= wl; wz /= wl; }
    // Vitesse relative selon la direction : on recule et on se décale un peu moins vite.
    let dirFactor = 1;
    const al = Math.hypot(fwd, str);
    if (al > 0) {
      const f2 = (fwd / al) * (fwd / al);
      dirFactor = fwd >= 0 ? p.strafeFactor + (1 - p.strafeFactor) * f2 : p.strafeFactor + (p.backFactor - p.strafeFactor) * f2;
    }
    const c = this._c;
    c.dt = dt; c.s = s; c.fx = fx; c.fz = fz; c.rx = rx; c.rz = rz;
    c.wx = wx; c.wz = wz; c.wl = wl; c.fwd = fwd; c.str = str;
    c.dirFactor = dirFactor; c.slidePressed = slidePressed || this.slideBuffer > 0;

    switch (this.mode) {
      case 'ground': this._ground(c); break;
      case 'slide': this._slide(c); break;
      case 'air': this._air(c); break;
      case 'wallrun': this._wallrun(c); break;
      case 'climb': this._climb(c); break;
      case 'mantle': this._mantle(c); break;
    }

    // Vitesse horizontale max
    const sp = this.speed;
    if (sp > p.maxSpeed) {
      this.vel.x *= p.maxSpeed / sp;
      this.vel.z *= p.maxSpeed / sp;
    }
  }

  _setMode(m) {
    if (this.mode === m) return;
    const prev = this.mode;
    this.mode = m;
    this.modeTime = 0;
    if (prev === 'slide') this.emit('slideEnd');
    if (prev === 'wallrun') this.emit('wallrunEnd');
  }

  _tryStand() {
    if (this.height === this.p.height) return true;
    if (this._free(this.pos.x, this.pos.y, this.pos.z, this.p.height)) {
      this.height = this.p.height;
      return true;
    }
    return false;
  }

  _integrate(dt, allowStep) {
    const hitX = this._moveAxis('x', this.vel.x * dt, allowStep);
    if (hitX) this.vel.x = 0;
    const hitZ = this._moveAxis('z', this.vel.z * dt, allowStep);
    if (hitZ) this.vel.z = 0;
    const wasFalling = this.vel.y <= 0;
    const hitY = this._moveAxis('y', this.vel.y * dt, false);
    let landed = false;
    if (hitY) {
      if (wasFalling) landed = true;
      this.vel.y = 0;
    }
    INTEGRATE.hitX = hitX;
    INTEGRATE.hitZ = hitZ;
    INTEGRATE.landed = landed;
    return INTEGRATE;
  }

  // Tourne (ax, az) vers (bx, bz) d'au plus maxA radians. Résultat dans _rx, _rz.
  _rotateToward(ax, az, bx, bz, maxA) {
    const ang = Math.atan2(ax * bz - az * bx, ax * bx + az * bz);
    const a = Math.max(-maxA, Math.min(maxA, ang));
    const co = Math.cos(a), si = Math.sin(a);
    this._rx = ax * co - az * si;
    this._rz = ax * si + az * co;
  }

  _jump(vy = this.p.jumpSpeed) {
    this.vel.y = vy;
    this.bufferTimer = 0;
    this.coyoteTimer = 0;
    this.jumpCutDone = false;
    this.jumpAge = 0;
    this.grounded = false;
    this._setMode('air');
    // La tête accuse un peu l'impulsion
    this.cam.landVel -= 0.22;
    this.cam.nodVel += 0.05;
    this.emit('jump');
  }

  _ground(c) {
    const p = this.p;
    const v = this.vel;
    const speed = this.speed;

    if (c.wl > 0.05) {
      const target = p.runSpeed * c.wl * c.dirFactor;
      let dirX = c.wx, dirZ = c.wz;
      let ns = speed;
      let braking = false;
      if (speed > 0.05) {
        dirX = v.x / speed;
        dirZ = v.z / speed;
        const dot = dirX * c.wx + dirZ * c.wz;
        if (dot < -0.3 && speed > 1.0) {
          // Demi-tour : on freine d'abord, puis on repart dans l'autre sens.
          braking = true;
          ns = Math.max(0, speed - p.brake * c.dt);
        } else {
          // La vitesse tourne en arc vers la direction voulue, sans être perdue.
          const k = Math.min(1, speed / p.runSpeed);
          const rate = p.turnRateLow + (p.turnRateHigh - p.turnRateLow) * k;
          this._rotateToward(dirX, dirZ, c.wx, c.wz, rate * c.dt);
          dirX = this._rx;
          dirZ = this._rz;
        }
      }
      if (!braking) {
        if (ns < target) {
          ns = Math.min(target, ns + (p.accelRate * (target - ns) + p.accelBase) * c.dt);
        } else if (ns > target) {
          // L'élan au-delà de la course s'épuise doucement.
          const decay = ns > p.runSpeed ? p.momentumDecay : p.slowDecel;
          ns = Math.max(target, ns - decay * c.dt);
        }
      }
      v.x = dirX * ns;
      v.z = dirZ * ns;
    } else {
      // Relâché : on s'arrête en glissant doucement.
      const ns = Math.max(0, speed * Math.exp(-p.groundFriction * c.dt) - p.stopDecel * c.dt);
      if (speed > 1e-6) {
        v.x *= ns / speed;
        v.z *= ns / speed;
      }
    }

    // Saut
    if (this.bufferTimer > 0) {
      this._jump();
      this._air(c);
      return;
    }

    // Glissade
    if (c.slidePressed && this.speed > p.slideMinSpeed) {
      this._startSlide();
      this._slide(c);
      return;
    }

    // Franchissement d'obstacle bas en courant
    if (c.fwd > 0.3 && this.speed > 3 && this._tryMantle(c, p.vaultHeight, p.vaultTime, true)) return;

    v.y = -2; // colle au sol
    this._integrate(c.dt, true);
    if (!this._groundCheck()) {
      // Petit pas vers le bas : on reste collé si la marche est faible.
      const g = this.physics.groundBelow(this.pos.x, this.pos.y, this.pos.z, p.radius - 0.02);
      if (this.pos.y - g < p.stepHeight + 0.02 && g > -Infinity) {
        this.stepOffset = THREE.MathUtils.clamp(this.stepOffset + (this.pos.y - g - EPS), -0.5, 0.5);
        this.pos.y = g + EPS;
      } else {
        v.y = 0;
        this.coyoteTimer = p.coyote;
        this.grounded = false;
        this.airTime = 0;
        this.jumpCutDone = true;
        this._setMode('air');
      }
    }
    this.grounded = this.mode === 'ground';
  }

  _startSlide() {
    const p = this.p;
    const sp = this.speed;
    const ns = Math.min(p.maxSpeed, sp + p.slideBoost);
    this.vel.x *= ns / sp;
    this.vel.z *= ns / sp;
    this.height = p.slideHeight;
    this.slideBuffer = 0;
    this._setMode('slide');
    this.emit('slideStart');
  }

  _slide(c) {
    const p = this.p;
    const v = this.vel;
    let sp = this.speed;
    // Friction faible, légère direction
    const ns = Math.max(0, sp - p.slideFriction * c.dt);
    if (sp > 0.01) {
      let dx = v.x / sp, dz = v.z / sp;
      if (c.wl > 0) {
        this._rotateToward(dx, dz, c.wx, c.wz, 1.2 * c.dt);
        dx = this._rx; dz = this._rz;
      }
      v.x = dx * ns; v.z = dz * ns;
    }
    sp = ns;

    if (this.bufferTimer > 0 && this._free(this.pos.x, this.pos.y, this.pos.z, p.height)) {
      this.height = p.height;
      this._jump();
      return;
    }

    v.y = -2;
    this._integrate(c.dt, true);

    if (!this._groundCheck()) {
      v.y = 0;
      this.coyoteTimer = p.coyote;
      this.jumpCutDone = true;
      this._tryStand();
      this._setMode('air');
      return;
    }

    const wantsUp = !c.s.slide && this.modeTime > p.slideMinTime;
    if ((wantsUp || sp < 3.0) && this._tryStand()) {
      this._setMode('ground');
    } else if (sp < 2.5) {
      // Sous un obstacle : on avance lentement, accroupi.
      v.x = c.wx * 2.5 * c.wl;
      v.z = c.wz * 2.5 * c.wl;
    }
    this.grounded = true;
  }

  _air(c) {
    const p = this.p;
    const v = this.vel;
    this.airTime += c.dt;
    this.coyoteTimer = Math.max(0, this.coyoteTimer - c.dt);

    if (this.bufferTimer > 0 && this.coyoteTimer > 0) {
      this._jump();
    }

    // Saut variable, en douceur : relâcher tôt donne un saut un peu plus court.
    if (!c.s.jump && v.y > 0 && !this.jumpCutDone && this.jumpAge > p.jumpCutMinTime) {
      v.y *= p.jumpCut;
      this.jumpCutDone = true;
    }

    // Contrôle aérien : on oriente la vitesse vers la direction voulue,
    // sans gagner de vitesse au-delà de l'élan ou de la course.
    if (c.wl > 0.05) {
      const sp = this.speed;
      const ts = Math.max(sp, p.runSpeed * 0.9 * c.wl);
      const dx = c.wx * ts - v.x, dz = c.wz * ts - v.z;
      const dl = Math.hypot(dx, dz);
      const maxStep = p.airAccel * c.dt;
      const k = dl > maxStep ? maxStep / dl : 1;
      v.x += dx * k;
      v.z += dz * k;
      const ns = this.speed;
      if (ns > ts) { v.x *= ts / ns; v.z *= ts / ns; }
    }

    let g = v.y < 0 ? p.gravity * p.fallGravityScale : p.gravity;
    if (Math.abs(v.y) < p.apexHangSpeed) g *= p.apexHangScale;
    v.y -= g * c.dt;
    if (v.y < -40) v.y = -40;
    this.fallSpeed = Math.max(this.fallSpeed, -v.y);

    // Escalade, course sur les murs, rétablissement
    if (c.fwd > 0.3) {
      if (this._tryMantle(c, p.mantleReach, p.mantleTime, false)) return;
      if (!this.climbUsed && this._tryClimb(c)) return;
      if (this._tryWallrun(c)) return;
    }

    const r = this._integrate(c.dt, false);
    if (r.landed) {
      this._land(c);
    }
  }

  _land(c) {
    const impact = this.fallSpeed;
    this.fallSpeed = 0;
    this.climbUsed = false;
    this.lastWallNormal = null;
    this.grounded = true;
    // Atterrissage amorti : la tête s'enfonce un peu et s'incline, puis revient.
    this.cam.landVel -= Math.min(impact * 0.05, 0.75);
    this.cam.nodVel -= Math.min(impact * 0.022, 0.32);
    this.emit('land', { impact });
    if ((c.s.slide || this.slideBuffer > 0) && this.speed > this.p.slideMinSpeed) {
      this._setMode('ground');
      this._startSlide();
    } else {
      this._setMode('ground');
      if (this.bufferTimer > 0) this._jump();
    }
  }

  _axisDir(x, z) {
    // Direction axiale dominante (tableau partagé : à lire tout de suite)
    if (Math.abs(x) > Math.abs(z)) { AXIS[0] = Math.sign(x); AXIS[1] = 0; } else { AXIS[0] = 0; AXIS[1] = Math.sign(z); }
    return AXIS;
  }

  _tryWallrun(c) {
    const p = this.p;
    const sp = this.speed;
    if (sp < p.wallrunMinSpeed) return false;
    if (this.vel.y < -7) return false;
    const vx = this.vel.x / sp, vz = this.vel.z / sp;
    for (const [dx, dz] of WALL_DIRS) {
      // Le mur doit être sur le côté (on longe le mur, on ne fonce pas dedans).
      const into = vx * dx + vz * dz;
      if (into > 0.75 || into < -0.2) continue;
      const nx = -dx, nz = -dz;
      if (this.lastWallNormal && this.wallCooldown > 0 && this.lastWallNormal[0] === nx && this.lastWallNormal[1] === nz) continue;
      const box = this._wallAt(dx, dz, 0.4, 0.3, 0.3);
      if (!box) continue;
      // Le mur doit être assez haut pour couvrir le corps
      if (box.maxY < this.pos.y + 1.4) continue;
      // Aimante le joueur contre le mur
      if (dx > 0) this.pos.x = Math.max(this.pos.x, box.minX - this.p.radius - 0.02);
      if (dx < 0) this.pos.x = Math.min(this.pos.x, box.maxX + this.p.radius + 0.02);
      if (dz > 0) this.pos.z = Math.max(this.pos.z, box.minZ - this.p.radius - 0.02);
      if (dz < 0) this.pos.z = Math.min(this.pos.z, box.maxZ + this.p.radius + 0.02);
      // Côté gauche ou droit par rapport au regard
      const side = Math.sign(c.rx * dx + c.rz * dz) || 1;
      this.wall = { nx, nz, side, box };
      this.lastWallNormal = [nx, nz];
      this._setMode('wallrun');
      // Vitesse le long du mur (elle monte doucement vers la vitesse murale)
      let tx = this.vel.x - nx * (this.vel.x * nx + this.vel.z * nz);
      let tz = this.vel.z - nz * (this.vel.x * nx + this.vel.z * nz);
      const tl = Math.hypot(tx, tz) || 1;
      const ns = Math.max(sp, p.wallrunSpeed * 0.9);
      this.vel.x = (tx / tl) * ns;
      this.vel.z = (tz / tl) * ns;
      this.vel.y = THREE.MathUtils.clamp(this.vel.y, 2.0, 4.2);
      this.fallSpeed = 0;
      this.emit('wallrunStart', { side });
      return true;
    }
    return false;
  }

  _wallrun(c) {
    const p = this.p;
    const v = this.vel;
    const w = this.wall;
    const t = this.modeTime / p.wallrunTime;

    if (this.bufferTimer > 0) {
      // Saut mural : on s'écarte du mur, en suivant un peu le regard.
      const sp = Math.max(this.speed, p.runSpeed);
      let tx = v.x / (this.speed || 1), tz = v.z / (this.speed || 1);
      let jx = tx * 0.75 + w.nx * 0.55 + c.fx * 0.35;
      let jz = tz * 0.75 + w.nz * 0.55 + c.fz * 0.35;
      const jl = Math.hypot(jx, jz) || 1;
      v.x = (jx / jl) * sp + w.nx * (p.wallJumpOut * 0.4);
      v.z = (jz / jl) * sp + w.nz * (p.wallJumpOut * 0.4);
      this.wallCooldown = 0.45;
      this.lastWall = w;
      this.wall = null;
      this._jump(p.wallJumpUp);
      this.emit('walljump', { side: w.side });
      return;
    }

    // Gravité réduite qui augmente avec le temps : un arc lent, qui monte puis redescend.
    const g = p.wallGravity * (0.12 + 0.9 * t * t);
    v.y -= g * c.dt;
    // La vitesse le long du mur rejoint doucement la vitesse murale.
    const sp = this.speed;
    const target = Math.max(p.wallrunSpeed, sp - 1.0 * c.dt);
    const ns = sp + (target - sp) * Math.min(1, 4 * c.dt);
    if (sp > 0.01) { v.x *= ns / sp; v.z *= ns / sp; }
    // Légère attraction vers le mur
    v.x -= w.nx * 1.5;
    v.z -= w.nz * 1.5;

    const r = this._integrate(c.dt, false);
    // On retire l'attraction pour ne pas perdre la vitesse tangentielle
    v.x += w.nx * 1.5;
    v.z += w.nz * 1.5;
    if (Math.abs(v.x * w.nx + v.z * w.nz) > 0.01) {
      const d = v.x * w.nx + v.z * w.nz;
      v.x -= w.nx * d; v.z -= w.nz * d;
    }

    if (r.landed) { this.wall = null; this._land(c); return; }

    const still = this._wallAt(-w.nx, -w.nz, 0.22, 0.3, 0.3);
    if (!still || t >= 1 || c.fwd <= 0.1) {
      // Fin : on se détache doucement
      v.x += w.nx * 1.2;
      v.z += w.nz * 1.2;
      this.wallCooldown = 0.35;
      this.lastWall = w;
      this.wall = null;
      this.jumpCutDone = true;
      this._setMode('air');
    }
  }

  _tryClimb(c) {
    const p = this.p;
    const [dx, dz] = this._axisDir(c.fx, c.fz);
    const facing = c.fx * dx + c.fz * dz;
    if (facing < 0.8) return false;
    if (this.vel.y < -4) return false;
    const box = this._wallAt(dx, dz, 0.16, 0.2, 0.2);
    if (!box) return false;
    if (box.maxY < this.pos.y + p.mantleReach) return false; // trop bas : rétablissement direct
    this.wall = { nx: -dx, nz: -dz, side: 0, box };
    this.climbUsed = true;
    this.vel.x = 0; this.vel.z = 0;
    this.vel.y = Math.max(this.vel.y, p.climbSpeed);
    this.fallSpeed = 0;
    this._setMode('climb');
    this.emit('climb');
    return true;
  }

  _climb(c) {
    const p = this.p;
    const v = this.vel;
    const w = this.wall;
    if (this.bufferTimer > 0) {
      // Saut arrière depuis le mur
      v.x = w.nx * 5.5; v.z = w.nz * 5.5;
      this.wall = null;
      this._jump(6.8);
      this.emit('walljump', { side: 0 });
      return;
    }
    if (this._tryMantle(c, p.mantleReach, p.mantleTime, false)) return;
    const t = this.modeTime / p.climbTime;
    v.y = p.climbSpeed * (1 - 0.6 * t);
    v.x = -w.nx * 0.5; v.z = -w.nz * 0.5; // reste plaqué
    this._integrate(c.dt, false);
    const still = this._wallAt(-w.nx, -w.nz, 0.2, 0.2, 0.2);
    if (t >= 1 || !still || c.fwd <= 0.1) {
      v.x = w.nx * 1.5; v.z = w.nz * 1.5;
      v.y = Math.min(v.y, 1.0);
      this.wall = null;
      this.jumpCutDone = true;
      this._setMode('air');
    }
  }

  // Le trajet d'un franchissement (axe dx/dz, distance d) est-il libre et finit-il sur le rebord ?
  _mantleTarget(dx, dz, dist, top) {
    const p = this.p, r = p.radius;
    const ex = this.pos.x + dx * dist;
    const ez = this.pos.z + dz * dist;
    const ey = top + EPS;
    if (!this._free(ex, ey, ez, p.height) && !this._free(ex, ey, ez, p.slideHeight)) return false;
    const g = this.physics.groundBelow(ex, ey + 0.05, ez, r - 0.05);
    if (Math.abs(g - top) > 0.02) return false;
    // Tout le couloir au-dessus du rebord doit être libre
    const x0 = Math.min(this.pos.x, ex) - r, x1 = Math.max(this.pos.x, ex) + r;
    const z0 = Math.min(this.pos.z, ez) - r, z1 = Math.max(this.pos.z, ez) + r;
    if (this.physics.overlap(x0, ey, z0, x1, ey + p.slideHeight, z1)) return false;
    return true;
  }

  // Rétablissement / franchissement : monter sur le rebord devant soi.
  _tryMantle(c, reach, duration, vault) {
    const p = this.p;
    const [dx, dz] = this._axisDir(vault ? (this.vel.x || c.fx) : c.fx, vault ? (this.vel.z || c.fz) : c.fz);
    const facing = c.fx * dx + c.fz * dz;
    if (facing < 0.55) return false;
    // Il faut un obstacle juste devant
    const front = this._wallAt(dx, dz, vault ? 0.25 : 0.14, 0.05, 0.05);
    if (!front) return false;
    const r = p.radius;
    // Colonne de sonde devant le joueur
    const px = this.pos.x + dx * (r + 0.25);
    const pz = this.pos.z + dz * (r + 0.25);
    const hits = this.physics.overlapAll(px - 0.05, this.pos.y + 0.05, pz - 0.05, px + 0.05, this.pos.y + reach + 2.2, pz + 0.05, tmpBoxes);
    if (!hits.length) return false;
    // Hauteur du rebord : le sommet le plus haut atteignable.
    let top = -Infinity, edgeBox = null;
    for (const b of hits) {
      if (b.maxY <= this.pos.y + reach + 0.001 && b.maxY > top) { top = b.maxY; edgeBox = b; }
    }
    if (top === -Infinity) return false;
    if (top - this.pos.y < (vault ? p.stepHeight : 0.25)) return false;

    // Distance parcourue : un franchissement garde l'élan et va plus loin sur le dessus.
    const base = 2 * r + 0.32;
    let dist = -1;
    if (vault) {
      const want = THREE.MathUtils.clamp(this.speed * duration * 0.85, base, 2.4);
      for (let d = want; d > base + 0.01; d -= 0.3) {
        if (this._mantleTarget(dx, dz, d, top)) { dist = d; break; }
      }
    }
    if (dist < 0) {
      if (!this._mantleTarget(dx, dz, base, top)) return false;
      dist = base;
    }

    const edge = dx > 0 ? edgeBox.minX : dx < 0 ? edgeBox.maxX : dz > 0 ? edgeBox.minZ : edgeBox.maxZ;
    const keepSpeed = vault ? Math.max(this.speed * 0.95, p.runSpeed * 0.85) : Math.max(3.5, this.speed * 0.5);
    const height = top - this.pos.y;
    // La durée suit un peu la hauteur : un petit muret se passe plus vite qu'un grand.
    const dur = vault ? duration * (0.85 + 0.25 * Math.min(1, height / p.vaultHeight)) : duration * (0.8 + 0.2 * Math.min(1, height / reach));
    this.mantle = {
      sx: this.pos.x, sy: this.pos.y, sz: this.pos.z,
      ex: this.pos.x + dx * dist, ey: top + EPS, ez: this.pos.z + dz * dist,
      t: 0, duration: dur, dx, dz, keepSpeed, vault,
      height, top, edge,
    };
    this.wall = null;
    this.vel.set(0, 0, 0);
    this.fallSpeed = 0;
    this._setMode('mantle');
    this.emit(vault ? 'vault' : 'mantle', { height });
    return true;
  }

  _mantle(c) {
    const m = this.mantle;
    m.t += c.dt;
    const t = Math.min(1, m.t / m.duration);
    if (m.vault) {
      // Franchissement : avance continue, on monte vite puis on se pose avec un petit rebond.
      const ty = 1 - Math.pow(1 - Math.min(1, t / 0.55), 3);
      const hop = Math.sin(Math.PI * t) * 0.1;
      this.pos.x = m.sx + (m.ex - m.sx) * t;
      this.pos.z = m.sz + (m.ez - m.sz) * t;
      this.pos.y = m.sy + (m.ey - m.sy) * ty + hop;
    } else {
      // Rétablissement : on se hisse d'abord, on avance ensuite.
      const ty = 1 - Math.pow(1 - Math.min(1, t * 1.45), 3);
      const tf = t < 0.38 ? 0 : (t - 0.38) / 0.62;
      const tfe = tf * tf * (3 - 2 * tf);
      this.pos.x = m.sx + (m.ex - m.sx) * tfe;
      this.pos.z = m.sz + (m.ez - m.sz) * tfe;
      this.pos.y = m.sy + (m.ey - m.sy) * ty;
    }
    if (t >= 1) {
      this.pos.y = m.ey;
      this.vel.x = m.dx * m.keepSpeed;
      this.vel.z = m.dz * m.keepSpeed;
      this.vel.y = 0;
      this.climbUsed = false;
      this.mantle = null;
      if (!this._free(this.pos.x, this.pos.y, this.pos.z, this.p.height)) this.height = this.p.slideHeight;
      if (this.height < this.p.height) this._setMode('slide');
      else this._setMode('ground');
      this.grounded = true;
      if (!m.vault) {
        this.cam.landVel -= 0.12;
        this.cam.nodVel -= 0.06;
      }
    }
  }

  // ---------- Caméra (chaque image) ----------

  updateCamera(dt, alpha) {
    const p = this.p;
    const cam = this.cam;
    this.simAge += dt;
    const frozen = this.simAge > 0.12;
    const speed = frozen ? 0 : this.speed;
    this.visualSpeed = speed;
    const mode = this.mode;

    // Hauteur des yeux
    const eyeTarget = this.height < p.height ? p.slideEye : p.eye;
    cam.eye = damp(cam.eye, eyeTarget, 11, dt);

    // Rythme des pas
    const onFoot = mode === 'ground';
    const k = onFoot ? Math.min(1, speed / p.runSpeed) : 0;
    cam.bobAmount = damp(cam.bobAmount, k, 7, dt);
    const prevPhase = cam.bobPhase;
    let wallStep = false;
    if (onFoot && speed > 0.4) {
      cam.bobPhase += dt * Math.PI * (1.5 + speed * 0.165); // ≈ 2,7 pas/s en pleine course
    } else if (mode === 'wallrun') {
      cam.bobPhase += dt * Math.PI * 3.3;
      wallStep = true;
    } else if (mode === 'climb') {
      cam.bobPhase += dt * Math.PI * 3.0;
      wallStep = true;
    }
    if (Math.floor(prevPhase / Math.PI) !== Math.floor(cam.bobPhase / Math.PI)) {
      this.emit('step', wallStep ? { speed, wall: true } : { speed });
    }
    const ph = cam.bobPhase;
    const sp = Math.sin(ph);
    const a = cam.bobAmount;
    // Vertical : léger creux à chaque appui, sommet arrondi. Latéral : on se pose sur chaque pied.
    let bobY = (Math.abs(sp) * 0.55 + sp * sp * 0.45) * 0.04 * a - 0.024 * a;
    const bobX = Math.cos(ph) * 0.02 * a;
    const bobRoll = Math.cos(ph) * 0.006 * a;
    let bobPitch = (Math.abs(sp) - 0.64) * 0.008 * a;
    if (mode === 'wallrun' || mode === 'climb') {
      bobY += Math.abs(sp) * 0.016 - 0.008;
      bobPitch += (Math.abs(sp) - 0.64) * 0.006;
    }

    // Ressorts d'atterrissage (hauteur et inclinaison), en sous-pas pour rester stables.
    let rem = Math.min(dt, 0.1);
    while (rem > 1e-6) {
      const h = Math.min(rem, 1 / 240);
      cam.landVel += (-cam.landOffset * 110 - cam.landVel * 13) * h;
      cam.landOffset += cam.landVel * h;
      cam.nodVel += (-cam.nod * 90 - cam.nodVel * 12) * h;
      cam.nod += cam.nodVel * h;
      rem -= h;
    }

    // Virage : on suit le cap de la vitesse pour pencher très légèrement dans les courbes.
    if (speed > 1 && dt > 0) {
      const heading = Math.atan2(this.vel.x, this.vel.z);
      const dh = wrapAngle(heading - cam.heading);
      cam.heading = heading;
      cam.turn = damp(cam.turn, THREE.MathUtils.clamp(dh / dt, -4, 4), 6, dt);
    } else {
      cam.turn = damp(cam.turn, 0, 6, dt);
    }

    // Roulis
    let rollTarget = 0;
    let shiftTarget = 0;
    if (mode === 'wallrun' && this.wall) {
      // La tête se penche vers le vide, loin du mur, et s'en écarte un peu.
      const e = Math.min(1, this.modeTime * 5);
      rollTarget = this.wall.side * 0.15 * e;
      shiftTarget = -this.wall.side * 0.07 * e;
    } else if (mode === 'slide') {
      rollTarget = 0.05;
    } else {
      const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
      const lateral = (this.vel.x * rx + this.vel.z * rz) / p.runSpeed;
      rollTarget = -lateral * 0.02;
      if (onFoot) rollTarget += THREE.MathUtils.clamp(cam.turn * Math.min(1, speed / p.runSpeed) * 0.012, -0.035, 0.035);
    }
    cam.roll = damp(cam.roll, rollTarget, mode === 'wallrun' ? 7 : 5, dt);
    cam.shiftX = damp(cam.shiftX, shiftTarget, 6, dt);

    // Inclinaison et creux selon le mouvement
    let pitchTarget = 0;
    let dipTarget = 0;
    let pitchRate = 9;
    if (mode === 'mantle' && this.mantle) {
      const m = this.mantle;
      const t = Math.min(1, m.t / m.duration);
      if (m.vault) {
        // On plonge le regard vers les mains, le corps se ramasse, puis tout se relève.
        const e = Math.sin(Math.min(1, t * 1.15) * Math.PI);
        pitchTarget = -e * 0.26;
        dipTarget = -e * (0.16 + 0.12 * Math.min(1, m.height / p.vaultHeight));
        pitchRate = 14;
      } else {
        pitchTarget = -Math.sin(Math.min(1, t * 1.1) * Math.PI) * 0.16;
        dipTarget = -Math.sin(t * Math.PI) * 0.1;
        pitchRate = 12;
      }
    } else if (mode === 'climb') {
      // On lève les yeux vers le haut du mur.
      pitchTarget = 0.15 * Math.min(1, this.modeTime * 4);
      pitchRate = 7;
    } else if (mode === 'slide') {
      // Regard un peu plus bas pour voir ses jambes filer devant.
      pitchTarget = -0.15;
      pitchRate = 6;
    } else if (mode === 'air') {
      // En retombant de haut, on regarde légèrement vers le point d'arrivée.
      pitchTarget = THREE.MathUtils.clamp(this.vel.y * 0.006, -0.05, 0.02);
      pitchRate = 4;
    }
    cam.pitchOffset = damp(cam.pitchOffset, pitchTarget, pitchRate, dt);
    cam.dip = damp(cam.dip, dipTarget, 16, dt);

    // Champ de vision : fixé à l'horizontale (indépendant du format de l'écran), il s'ouvre
    // un peu avec la vitesse, sans jamais devenir un fish-eye.
    let hfovTarget = p.hfov + p.hfovRun * THREE.MathUtils.clamp((speed - 2) / (p.runSpeed - 2), 0, 1) + Math.max(0, speed - p.runSpeed) * 1.2;
    if (mode === 'slide') hfovTarget += 3;
    if (mode === 'wallrun') hfovTarget += 2;
    hfovTarget = Math.min(hfovTarget, p.hfovMax);
    cam.hfov = damp(cam.hfov, hfovTarget, 3, dt);
    const aspect = this.camera.aspect || 16 / 9;
    const vfov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(cam.hfov) / 2) / aspect));
    cam.fov = THREE.MathUtils.clamp(vfov, 52, 84);

    // Position interpolée
    const x = this.prevPos.x + (this.pos.x - this.prevPos.x) * alpha;
    const y = this.prevPos.y + (this.pos.y - this.prevPos.y) * alpha;
    const z = this.prevPos.z + (this.pos.z - this.prevPos.z) * alpha;
    const stepY = this.prevStepOffset + (this.stepOffset - this.prevStepOffset) * alpha;
    const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
    const sx = bobX + cam.shiftX;

    const camera = this.camera;
    camera.position.set(x + rx * sx, y + cam.eye + bobY + cam.landOffset + cam.dip + stepY, z + rz * sx);
    camera.rotation.order = 'YXZ';
    camera.rotation.set(this.pitch + cam.pitchOffset + cam.nod + bobPitch, this.yaw, cam.roll + bobRoll);
    if (Math.abs(camera.fov - cam.fov) > 0.01) {
      camera.fov = cam.fov;
      camera.updateProjectionMatrix();
    }

    if (this.body) this.body.update(dt);
  }
}
