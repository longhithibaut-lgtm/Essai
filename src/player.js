import * as THREE from 'three';

// Réglages du mouvement. Toutes les unités sont en mètres et secondes.
export const PARAMS = {
  radius: 0.3,
  height: 1.8,
  slideHeight: 1.0,
  eye: 1.62,
  slideEye: 0.82,

  runSpeed: 8.2,
  groundAccel: 60,
  groundFriction: 11,
  momentumDecay: 5, // m/s² perdus quand on va plus vite que runSpeed au sol
  airAccel: 14,
  gravity: 24,
  fallGravityScale: 1.15,
  jumpSpeed: 8.0,
  jumpCut: 0.55,
  coyote: 0.12,
  buffer: 0.14,
  stepHeight: 0.42,
  maxSpeed: 16,

  wallrunMinSpeed: 4.5,
  wallrunTime: 1.6,
  wallrunSpeed: 9.2,
  wallJumpOut: 6.0,
  wallJumpUp: 7.6,

  climbSpeed: 6.4,
  climbTime: 0.55,
  mantleReach: 1.55,
  vaultHeight: 1.2,
  mantleTime: 0.34,
  vaultTime: 0.24,

  slideMinSpeed: 5.0,
  slideBoost: 1.6,
  slideFriction: 2.4,
  slideMinTime: 0.35,
};

const EPS = 0.001;
const tmpBoxes = [];

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
    this.jumpCutDone = false;
    this.modeTime = 0;
    this.climbUsed = false;
    this.wall = null; // { nx, nz, side }
    this.lastWallNormal = null;
    this.wallCooldown = 0;
    this.mantle = null;
    this.airTime = 0;
    this.fallSpeed = 0;

    // Effets de caméra
    this.cam = {
      eye: this.p.eye,
      bobPhase: 0,
      bobAmount: 0,
      landOffset: 0,
      landVel: 0,
      roll: 0,
      fov: 80,
      pitchOffset: 0,
    };

    this.listeners = [];
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
    this.height = this.p.height;
    this.wall = null;
    this.mantle = null;
    this.climbUsed = false;
    this.cam.landOffset = 0;
    this.cam.landVel = 0;
    this.cam.roll = 0;
    this.fallSpeed = 0;
    this.airTime = 0;
    this.bufferTimer = 0;
    this.coyoteTimer = 0;
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

    // Tentative de montée de marche
    if (allowStep && axis !== 'y') {
      let top = -Infinity;
      for (const b of hits) top = Math.max(top, b.maxY);
      if (top - pos.y <= this.p.stepHeight && top > pos.y && this._free(pos.x, top + EPS, pos.z)) {
        pos.y = top + EPS;
        return false;
      }
    }

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
    this.prevPos.copy(this.pos);
    this.modeTime += dt;
    this.wallCooldown = Math.max(0, this.wallCooldown - dt);

    // Saisie
    const s = input.state;
    if (input.consumePressed('jump')) this.bufferTimer = p.buffer;
    else this.bufferTimer = Math.max(0, this.bufferTimer - dt);
    const slidePressed = input.consumePressed('slide');

    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
    const fwd = (s.forward ? 1 : 0) - (s.back ? 1 : 0);
    const str = (s.right ? 1 : 0) - (s.left ? 1 : 0);
    let wx = fx * fwd + rx * str;
    let wz = fz * fwd + rz * str;
    const wl = Math.hypot(wx, wz);
    if (wl > 0) { wx /= wl; wz /= wl; }
    const ctx = { dt, s, fx, fz, rx, rz, wx, wz, wl, fwd, slidePressed };

    switch (this.mode) {
      case 'ground': this._ground(ctx); break;
      case 'slide': this._slide(ctx); break;
      case 'air': this._air(ctx); break;
      case 'wallrun': this._wallrun(ctx); break;
      case 'climb': this._climb(ctx); break;
      case 'mantle': this._mantle(ctx); break;
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
    return { hitX, hitZ, landed };
  }

  _jump(vy = this.p.jumpSpeed) {
    this.vel.y = vy;
    this.bufferTimer = 0;
    this.coyoteTimer = 0;
    this.jumpCutDone = false;
    this.grounded = false;
    this._setMode('air');
    this.emit('jump');
  }

  _ground(c) {
    const p = this.p;
    const v = this.vel;
    const speed = this.speed;

    if (c.wl > 0) {
      const dirX = speed > 0.01 ? v.x / speed : c.wx;
      const dirZ = speed > 0.01 ? v.z / speed : c.wz;
      const align = dirX * c.wx + dirZ * c.wz;
      if (speed > p.runSpeed && align > 0.4) {
        // On garde l'élan, on tourne doucement vers la direction voulue.
        const ns = Math.max(p.runSpeed, speed - p.momentumDecay * c.dt);
        const t = Math.min(1, 10 * c.dt);
        let nx = dirX + (c.wx - dirX) * t, nz = dirZ + (c.wz - dirZ) * t;
        const nl = Math.hypot(nx, nz) || 1;
        v.x = (nx / nl) * ns;
        v.z = (nz / nl) * ns;
      } else {
        const tx = c.wx * p.runSpeed, tz = c.wz * p.runSpeed;
        const dx = tx - v.x, dz = tz - v.z;
        const dl = Math.hypot(dx, dz);
        const maxStep = p.groundAccel * c.dt;
        if (dl <= maxStep) { v.x = tx; v.z = tz; } else { v.x += (dx / dl) * maxStep; v.z += (dz / dl) * maxStep; }
      }
    } else {
      const k = Math.exp(-p.groundFriction * c.dt);
      v.x *= k; v.z *= k;
      if (this.speed < 0.05) { v.x = 0; v.z = 0; }
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
    if (c.fwd > 0 && this.speed > 3 && this._tryMantle(c, p.vaultHeight, p.vaultTime, true)) return;

    v.y = -2; // colle au sol
    this._integrate(c.dt, true);
    if (!this._groundCheck()) {
      // Petit pas vers le bas : on reste collé si la marche est faible.
      const g = this.physics.groundBelow(this.pos.x, this.pos.y, this.pos.z, p.radius - 0.02);
      if (this.pos.y - g < p.stepHeight + 0.02 && g > -Infinity) {
        this.pos.y = g + EPS;
      } else {
        v.y = 0;
        this.coyoteTimer = p.coyote;
        this.grounded = false;
        this.airTime = 0;
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
        const t = Math.min(1, 1.8 * c.dt);
        dx += (c.wx - dx) * t; dz += (c.wz - dz) * t;
        const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
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
      this._tryStand();
      this._setMode('air');
      return;
    }

    const wantsUp = !c.s.slide && this.modeTime > p.slideMinTime;
    if ((wantsUp || sp < 3.0) && this._tryStand()) {
      this._setMode('ground');
    } else if (sp < 2.5) {
      // Sous un obstacle : on avance lentement à quatre pattes.
      const tx = c.wx * 2.5, tz = c.wz * 2.5;
      v.x = tx; v.z = tz;
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

    // Saut variable
    if (!c.s.jump && v.y > 0 && !this.jumpCutDone) {
      v.y *= p.jumpCut;
      this.jumpCutDone = true;
    }

    // Contrôle aérien : on oriente la vitesse vers la direction voulue,
    // sans gagner de vitesse au-delà de l'élan ou de la course.
    if (c.wl > 0) {
      const sp = this.speed;
      const ts = Math.max(sp, p.runSpeed * 0.9);
      const dx = c.wx * ts - v.x, dz = c.wz * ts - v.z;
      const dl = Math.hypot(dx, dz);
      const maxStep = p.airAccel * c.dt;
      const k = dl > maxStep ? maxStep / dl : 1;
      v.x += dx * k;
      v.z += dz * k;
      const ns = this.speed;
      if (ns > ts) { v.x *= ts / ns; v.z *= ts / ns; }
    }

    const g = v.y < 0 ? p.gravity * p.fallGravityScale : p.gravity;
    v.y -= g * c.dt;
    if (v.y < -40) v.y = -40;
    this.fallSpeed = Math.max(this.fallSpeed, -v.y);

    // Escalade, course sur les murs, rétablissement
    if (c.fwd > 0) {
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
    this.cam.landVel -= Math.min(impact * 0.045, 0.6);
    this.emit('land', { impact });
    if (c.s.slide && this.speed > this.p.slideMinSpeed) {
      this._startSlide();
    } else {
      this._setMode('ground');
      if (this.bufferTimer > 0) this._jump();
    }
  }

  _axisDir(x, z) {
    // Direction axiale dominante
    if (Math.abs(x) > Math.abs(z)) return [Math.sign(x), 0];
    return [0, Math.sign(z)];
  }

  _tryWallrun(c) {
    const p = this.p;
    const sp = this.speed;
    if (sp < p.wallrunMinSpeed) return false;
    if (this.vel.y < -7) return false;
    const vx = this.vel.x / sp, vz = this.vel.z / sp;
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (const [dx, dz] of dirs) {
      // Le mur doit être sur le côté (on longe le mur, on ne fonce pas dedans).
      const into = vx * dx + vz * dz;
      if (into > 0.75 || into < -0.2) continue;
      const nx = -dx, nz = -dz;
      if (this.lastWallNormal && this.wallCooldown > 0 && this.lastWallNormal[0] === nx && this.lastWallNormal[1] === nz) continue;
      const box = this._wallAt(dx, dz, 0.4, 0.3, 0.3);
      if (!box) continue;
      // Aimante le joueur contre le mur
      if (dx > 0) this.pos.x = Math.max(this.pos.x, box.minX - this.p.radius - 0.02);
      if (dx < 0) this.pos.x = Math.min(this.pos.x, box.maxX + this.p.radius + 0.02);
      if (dz > 0) this.pos.z = Math.max(this.pos.z, box.minZ - this.p.radius - 0.02);
      if (dz < 0) this.pos.z = Math.min(this.pos.z, box.maxZ + this.p.radius + 0.02);
      // Le mur doit être assez haut pour couvrir le corps
      if (box.maxY < this.pos.y + 1.4) continue;
      // Côté gauche ou droit par rapport au regard
      const side = Math.sign(c.rx * dx + c.rz * dz) || 1;
      this.wall = { nx, nz, side, box };
      this.lastWallNormal = [nx, nz];
      this._setMode('wallrun');
      // Vitesse le long du mur
      let tx = this.vel.x - nx * (this.vel.x * nx + this.vel.z * nz);
      let tz = this.vel.z - nz * (this.vel.x * nx + this.vel.z * nz);
      const tl = Math.hypot(tx, tz) || 1;
      const ns = Math.max(sp, p.wallrunSpeed);
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
      this.wall = null;
      this._jump(p.wallJumpUp);
      this.emit('walljump');
      return;
    }

    // Gravité réduite qui augmente avec le temps
    const g = p.gravity * (0.12 + 0.9 * t * t);
    v.y -= g * c.dt;
    // Maintien de la vitesse le long du mur
    const sp = this.speed;
    const target = Math.max(p.wallrunSpeed, sp - 1.0 * c.dt);
    if (sp > 0.01) { v.x *= target / sp; v.z *= target / sp; }
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
    if (!still || t >= 1 || c.fwd <= 0) {
      // Fin : on se détache doucement
      v.x += w.nx * 1.2;
      v.z += w.nz * 1.2;
      this.wallCooldown = 0.35;
      this.wall = null;
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
      this.emit('walljump');
      return;
    }
    if (this._tryMantle(c, p.mantleReach, p.mantleTime, false)) return;
    const t = this.modeTime / p.climbTime;
    v.y = p.climbSpeed * (1 - 0.6 * t);
    v.x = -w.nx * 0.5; v.z = -w.nz * 0.5; // reste plaqué
    this._integrate(c.dt, false);
    const still = this._wallAt(-w.nx, -w.nz, 0.2, 0.2, 0.2);
    if (t >= 1 || !still || c.fwd <= 0) {
      v.x = w.nx * 1.5; v.z = w.nz * 1.5;
      v.y = Math.min(v.y, 1.0);
      this.wall = null;
      this._setMode('air');
    }
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
    // Hauteur du rebord : le sommet le plus bas atteignable, sans boîte au-dessus qui bloque.
    let top = -Infinity;
    for (const b of hits) if (b.maxY <= this.pos.y + reach + 0.001) top = Math.max(top, b.maxY);
    if (top === -Infinity) return false;
    if (top - this.pos.y < (vault ? p.stepHeight : 0.25)) return false;
    // Point d'arrivée sur le rebord
    const ex = this.pos.x + dx * (2 * r + 0.32);
    const ez = this.pos.z + dz * (2 * r + 0.32);
    const ey = top + EPS;
    if (!this._free(ex, ey, ez, p.height) && !this._free(ex, ey, ez, p.slideHeight)) return false;
    const g = this.physics.groundBelow(ex, ey + 0.05, ez, r - 0.05);
    if (Math.abs(g - top) > 0.02) return false;
    // Il faut aussi que le passage au-dessus du rebord soit libre
    if (this.physics.overlap(this.pos.x - r, ey, this.pos.z - r, this.pos.x + r, ey + p.slideHeight, this.pos.z + r)) return false;

    const keepSpeed = vault ? Math.max(this.speed * 0.92, p.runSpeed * 0.8) : Math.max(4.5, this.speed * 0.6);
    this.mantle = {
      sx: this.pos.x, sy: this.pos.y, sz: this.pos.z,
      ex, ey, ez, t: 0, duration, dx, dz, keepSpeed,
      height: top - this.pos.y,
    };
    this.wall = null;
    this.vel.set(0, 0, 0);
    this.fallSpeed = 0;
    this._setMode('mantle');
    this.emit(vault ? 'vault' : 'mantle', { height: top - this.pos.y });
    return true;
  }

  _mantle(c) {
    const m = this.mantle;
    m.t += c.dt;
    const t = Math.min(1, m.t / m.duration);
    // Monte d'abord, avance ensuite.
    const ty = 1 - Math.pow(1 - Math.min(1, t * 1.6), 3);
    const tf = t < 0.35 ? 0 : (t - 0.35) / 0.65;
    const tfe = tf * tf * (3 - 2 * tf);
    this.pos.x = m.sx + (m.ex - m.sx) * tfe;
    this.pos.z = m.sz + (m.ez - m.sz) * tfe;
    this.pos.y = m.sy + (m.ey - m.sy) * ty;
    if (t >= 1) {
      this.vel.x = m.dx * m.keepSpeed;
      this.vel.z = m.dz * m.keepSpeed;
      this.vel.y = 0;
      this.climbUsed = false;
      this.mantle = null;
      if (!this._free(this.pos.x, this.pos.y, this.pos.z, this.p.height)) this.height = this.p.slideHeight;
      if (this.height < this.p.height) this._setMode('slide');
      else this._setMode('ground');
      this.grounded = true;
    }
  }

  // ---------- Caméra (chaque image) ----------

  updateCamera(dt, alpha) {
    const p = this.p;
    const cam = this.cam;
    const speed = this.speed;

    // Hauteur des yeux
    const eyeTarget = this.height < p.height ? p.slideEye : p.eye;
    cam.eye += (eyeTarget - cam.eye) * Math.min(1, dt * 14);

    // Balancement de tête et pas
    const onFoot = this.mode === 'ground';
    const k = onFoot ? Math.min(1, speed / p.runSpeed) : 0;
    cam.bobAmount += (k - cam.bobAmount) * Math.min(1, dt * 8);
    if (onFoot && speed > 0.5) {
      const prev = cam.bobPhase;
      cam.bobPhase += dt * (4.2 + speed * 0.62);
      if (Math.floor(prev / Math.PI) !== Math.floor(cam.bobPhase / Math.PI)) this.emit('step', { speed });
    }
    if (this.mode === 'wallrun') {
      const prev = cam.bobPhase;
      cam.bobPhase += dt * 11;
      if (Math.floor(prev / Math.PI) !== Math.floor(cam.bobPhase / Math.PI)) this.emit('step', { speed, wall: true });
    }
    const bobY = Math.abs(Math.sin(cam.bobPhase)) * 0.055 * cam.bobAmount - 0.03 * cam.bobAmount;
    const bobX = Math.cos(cam.bobPhase) * 0.03 * cam.bobAmount;

    // Ressort d'atterrissage
    cam.landVel += (-cam.landOffset * 140 - cam.landVel * 15) * dt;
    cam.landOffset += cam.landVel * dt;

    // Roulis
    let rollTarget = 0;
    if (this.mode === 'wallrun' && this.wall) rollTarget = -this.wall.side * 0.2;
    else if (this.mode === 'slide') rollTarget = 0.035;
    else {
      // léger roulis en pas chassé
      const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
      const lateral = (this.vel.x * rx + this.vel.z * rz) / p.runSpeed;
      rollTarget = -lateral * 0.025;
    }
    cam.roll += (rollTarget - cam.roll) * Math.min(1, dt * 7);

    // Inclinaison pendant un rétablissement
    let pitchTarget = 0;
    if (this.mode === 'mantle' && this.mantle) {
      const t = this.mantle.t / this.mantle.duration;
      pitchTarget = -Math.sin(t * Math.PI) * 0.16;
    }
    cam.pitchOffset += (pitchTarget - cam.pitchOffset) * Math.min(1, dt * 12);

    // Champ de vision selon la vitesse
    let fovTarget = 80 + Math.max(0, speed - 6) * 1.5;
    if (this.mode === 'slide') fovTarget += 4;
    fovTarget = Math.min(fovTarget, 98);
    cam.fov += (fovTarget - cam.fov) * Math.min(1, dt * 4);

    // Position interpolée
    const x = this.prevPos.x + (this.pos.x - this.prevPos.x) * alpha;
    const y = this.prevPos.y + (this.pos.y - this.prevPos.y) * alpha;
    const z = this.prevPos.z + (this.pos.z - this.prevPos.z) * alpha;
    const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);

    const camera = this.camera;
    camera.position.set(x + rx * bobX, y + cam.eye + bobY + cam.landOffset, z + rz * bobX);
    camera.rotation.order = 'YXZ';
    camera.rotation.set(this.pitch + cam.pitchOffset, this.yaw, cam.roll);
    if (Math.abs(camera.fov - cam.fov) > 0.01) {
      camera.fov = cam.fov;
      camera.updateProjectionMatrix();
    }
  }
}
