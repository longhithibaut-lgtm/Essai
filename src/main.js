import * as THREE from 'three';
import { Renderer } from './render.js';
import { World } from './world.js';
import { PhysicsWorld } from './physics.js';
import { buildLevel } from './level.js';
import { Player } from './player.js';
import { Input } from './input.js';
import { Audio } from './audio.js';
import { UI } from './ui.js';
import { createMaterials } from './materials.js';
import { installTestAPI } from './testapi.js';

const TEST = new URLSearchParams(location.search).has('test');
const STEP = 1 / 120;
const FALL_Y = -14;

class Game {
  constructor() {
    this.r = new Renderer(document.getElementById('game'), { test: TEST });
    this.scene = this.r.scene;
    this.camera = this.r.camera;
    this.world = new World(this.scene);
    this.physics = new PhysicsWorld();
    this.level = buildLevel(this.scene, this.physics, createMaterials());
    this.input = new Input(this.r.renderer.domElement);
    this.player = new Player(this.physics, this.camera);
    this.player.attachBody(this.scene);
    this.audio = new Audio();
    this.ui = new UI(this);

    this.state = 'title'; // title | playing | paused | finished
    this.events = [];
    this.acc = 0;
    this.time = 0;
    this.simTime = 0;
    this.freeCamera = null;
    this.fade = 0;
    this.respawnTimer = 0;
    this.finishTimer = 0;

    this.player.onEvent((type, data) => this._onPlayerEvent(type, data));
    this.input.on('lockchange', (locked) => this._onLock(locked));
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === 'playing') this.pause();
    });

    this.reset();
  }

  reset() {
    const s = this.level.spawn;
    this.player.spawn(s.pos[0], s.pos[1], s.pos[2], s.yaw);
    this.checkpoint = this.level.checkpoints[0];
    this.collected = 0;
    this.runTime = 0;
    this.hintsShown = new Set();
    for (const o of this.level.orbs) {
      o.collected = false;
      o.fade = 1;
      o.group.visible = true;
      o.group.scale.setScalar(1);
      o.group.children[0].visible = true;
      o.group.children[1].material.opacity = 0.8;
    }
    this.ui.setOrbs(0, this.level.orbs.length);
    this.respawnTimer = 0;
    this.finishTimer = 0;
    this.fade = 0;
  }

  log(type, data) {
    this.events.push({ t: +this.simTime.toFixed(3), type, ...data });
    if (this.events.length > 500) this.events.shift();
  }

  // ---------- États ----------

  start() {
    this.audio.start();
    this.input.requestLock();
    this.reset();
    this.state = 'playing';
    this.ui.screen('play');
    this.ui.showHint(this.level.hints[0].text, 5);
    this.hintsShown.add(this.level.hints[0].id);
  }

  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.input.clear();
    this.ui.screen('pause');
  }

  resume() {
    this.audio.start();
    this.input.requestLock();
    // L'état repasse à "playing" quand le pointeur est verrouillé.
  }

  restart() {
    this.audio.start();
    this.input.requestLock();
    this.reset();
    this.state = 'playing';
    this.ui.screen('play');
  }

  _onLock(locked) {
    if (TEST) return;
    if (locked && (this.state === 'paused' || this.state === 'title')) {
      this.state = 'playing';
      this.ui.screen('play');
    } else if (!locked && this.state === 'playing') {
      this.pause();
    }
  }

  // ---------- Événements ----------

  _onPlayerEvent(type, data) {
    this.log(type, data);
    const a = this.audio;
    switch (type) {
      case 'step': a.step(data?.wall); break;
      case 'jump': case 'walljump': a.jump(); break;
      case 'land': a.land(data.impact); break;
      case 'slideStart': a.slide(); break;
      case 'vault': case 'mantle': a.land(4); break;
    }
  }

  _inBox(b, x, y, z) {
    return x >= b.min[0] && x <= b.max[0] && y >= b.min[1] && y <= b.max[1] && z >= b.min[2] && z <= b.max[2];
  }

  _checks() {
    const p = this.player.pos;
    const cy = p.y + 0.9;
    // Lueurs
    for (const o of this.level.orbs) {
      if (o.collected) continue;
      const dx = o.pos.x - p.x, dy = o.pos.y - cy, dz = o.pos.z - p.z;
      if (dx * dx + dy * dy + dz * dz < 1.25 * 1.25) {
        o.collected = true;
        this.collected++;
        this.ui.setOrbs(this.collected, this.level.orbs.length);
        this.audio.chime(this.collected);
        this.log('orb', { n: this.collected });
      }
    }
    // Points de reprise (au sol uniquement)
    if (this.player.grounded) {
      for (const c of this.level.checkpoints) {
        if (c !== this.checkpoint && this._inBox(c, p.x, p.y, p.z)) {
          this.checkpoint = c;
          this.log('checkpoint', { name: c.name });
        }
      }
    }
    // Conseils
    for (const h of this.level.hints) {
      if (!this.hintsShown.has(h.id) && this._inBox(h, p.x, p.y, p.z)) {
        this.hintsShown.add(h.id);
        this.ui.showHint(h.text);
      }
    }
    // Arrivée
    if (this._inBox(this.level.goal, p.x, p.y, p.z)) {
      this.state = 'finished';
      this.finishTimer = 0;
      this.audio.bell();
      this.log('finish', { time: +this.runTime.toFixed(2), orbs: this.collected });
    }
    // Chute dans les nuages
    if (p.y < FALL_Y && this.respawnTimer <= 0) {
      this.respawnTimer = 1.1;
      this.log('fall', {});
    }
  }

  _simulate(dt) {
    this.simTime += dt;
    if (this.state !== 'playing') return;
    if (this.respawnTimer > 0) {
      const before = this.respawnTimer;
      this.respawnTimer -= dt;
      if (before > 0.55 && this.respawnTimer <= 0.55) {
        const c = this.checkpoint;
        this.player.spawn(c.spawn[0], c.spawn[1], c.spawn[2], c.yaw);
        this.input.clear();
      }
      if (this.respawnTimer > 0.55) this.player.update(dt, this.input);
      return;
    }
    this.player.update(dt, this.input);
    this.runTime += dt;
    this._checks();
  }

  // ---------- Boucle ----------

  frame(dt, { render = true } = {}) {
    this.time += dt;
    if (this.state === 'playing') {
      const [dx, dy] = this.input.consumeLook();
      this.player.look(dx, dy);
    } else {
      this.input.consumeLook();
    }

    this.acc += dt;
    let n = 0;
    while (this.acc >= STEP && n < 12) {
      this._simulate(STEP);
      this.acc -= STEP;
      n++;
    }
    if (n === 12) this.acc = 0;

    // Fondu de reprise
    let fade = 0;
    if (this.respawnTimer > 0) fade = this.respawnTimer > 0.55 ? 1 - (this.respawnTimer - 0.55) / 0.55 : this.respawnTimer / 0.55;
    if (this.state === 'finished') {
      this.finishTimer += dt;
      fade = Math.min(0.35, this.finishTimer * 0.2);
      if (this.finishTimer > 2.2 && !this._endShown && !TEST) {
        this._endShown = true;
        this.input.exitLock();
        this.ui.showEnd(this.runTime, this.collected, this.level.orbs.length);
      }
    } else {
      this._endShown = false;
    }
    this.r.setFade(fade);

    // Caméra
    if (this.freeCamera) {
      const v = this.freeCamera;
      this.camera.position.set(v.pos[0], v.pos[1], v.pos[2]);
      this.camera.rotation.order = 'YXZ';
      this.camera.rotation.set(v.pitch, v.yaw, 0);
      if (this.camera.fov !== 72) { this.camera.fov = 72; this.camera.updateProjectionMatrix(); }
    } else if (this.state === 'title') {
      const v = this.level.viewpoints.panorama;
      const t = this.time * 0.05;
      this.camera.position.set(v.pos[0] + Math.sin(t) * 2, v.pos[1] + Math.sin(t * 0.7) * 0.5, v.pos[2] + Math.cos(t) * 1.5);
      this.camera.rotation.order = 'YXZ';
      this.camera.rotation.set(v.pitch, v.yaw + Math.sin(t * 0.8) * 0.06, 0);
      if (this.camera.fov !== 70) { this.camera.fov = 70; this.camera.updateProjectionMatrix(); }
    } else {
      this.player.updateCamera(dt, this.acc / STEP);
    }

    this.world.update(dt, this.camera, this.player.pos);
    this.level.update(dt);
    this.ui.update(dt);
    this.audio.update(this.state === 'playing' ? this.player.speed : 0, this.player.mode);
    if (render) this.renderFrame(dt);
  }

  renderFrame(dt) {
    this.r.render(dt, this.time);
  }
}

const game = new Game();

if (TEST) {
  game.state = 'playing';
  game.ui.screen('play');
  installTestAPI(game);
} else {
  game.ui.ready();
  let last = performance.now();
  const loop = (now) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    game.frame(dt);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyM' && game.audio.ctx) game.audio.setMuted(!game.audio.muted);
});

export { game, THREE };
