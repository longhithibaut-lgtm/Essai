// Interface de test (?test dans l'URL) : simulation pas à pas pilotée depuis
// Playwright, points de vue fixes et pilote automatique qui suit l'itinéraire du niveau.

function angleDiff(a, b) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

class Bot {
  constructor(game) {
    this.game = game;
    this.active = false;
  }

  start() {
    this.active = true;
    this.index = 0;
    this.jumpHold = 0;
    this.slideHold = 0;
  }

  stop() {
    this.active = false;
    this.game.input.clear();
  }

  // Après une chute, reprend au premier waypoint situé devant le point de reprise.
  resync() {
    const { player, level } = this.game;
    const i = level.route.findIndex((w) => w.p[2] < player.pos.z - 0.5);
    this.index = i < 0 ? level.route.length : i;
    this.jumpHold = 0;
    this.slideHold = 0;
  }

  update(dt) {
    if (!this.active) return;
    const { player, input, level } = this.game;
    const route = level.route;
    if (this.game.respawnTimer > 0) {
      this.needResync = true;
      input.clear();
      return;
    }
    if (this.needResync) {
      this.needResync = false;
      this.resync();
    }
    if (this.index >= route.length) {
      input.set({ forward: false });
      return;
    }
    const wp = route[this.index];
    const dx = wp.p[0] - player.pos.x;
    const dz = wp.p[2] - player.pos.z;
    const dist = Math.hypot(dx, dz);
    const target = Math.atan2(-dx, -dz);
    if (player.mode !== 'mantle') player.yaw += angleDiff(player.yaw, target) * Math.min(1, dt * 14);
    player.pitch += (-0.06 - player.pitch) * Math.min(1, dt * 4);

    // Le waypoint est atteint ou dépassé
    let reached = dist < (wp.r ?? 0.8);
    if (!reached && this.index > 0) {
      const prev = route[this.index - 1].p;
      const sx = wp.p[0] - prev[0], sz = wp.p[2] - prev[2];
      const along = (player.pos.x - wp.p[0]) * sx + (player.pos.z - wp.p[2]) * sz;
      if (along > 0 && dist < 2.5) reached = true;
    }
    if (reached) {
      if (wp.action === 'jump') this.jumpHold = 0.3;
      if (wp.action === 'slide') this.slideHold = 0.25;
      this.index++;
    }

    input.set({
      forward: true,
      jump: this.jumpHold > 0,
      slide: this.slideHold > 0,
    });
    this.jumpHold -= dt;
    this.slideHold -= dt;
  }
}

export function installTestAPI(game) {
  const bot = new Bot(game);
  const FRAME = 1 / 60;
  let renderMs = [];

  const api = {
    ready: true,
    viewpoints: game.level.viewpoints,
    route: game.level.route,
    events: game.events,

    reset() {
      bot.stop();
      game.reset();
      game.state = 'playing';
      game.events.length = 0;
      game.freeCamera = null;
      game.player.updateCamera(0, 1);
      game.world.update(0, game.camera, game.player.pos);
    },
    setInput(partial) {
      game.input.set(partial);
    },
    clearInput() {
      game.input.clear();
    },
    look(yaw, pitch) {
      game.player.yaw = yaw;
      game.player.pitch = pitch;
    },
    teleport(x, y, z, yaw = 0, pitch = 0) {
      game.player.spawn(x, y, z, yaw);
      game.player.pitch = pitch;
    },
    // Avance la simulation de `seconds` (par images de 1/60 s).
    step(seconds) {
      const n = Math.max(1, Math.round(seconds / FRAME));
      for (let i = 0; i < n; i++) {
        bot.update(FRAME);
        game.frame(FRAME, { render: false });
        if (game.state === 'finished' && bot.active) bot.stop();
      }
    },
    // Place une caméra libre sur un point de vue nommé.
    view(name) {
      const v = game.level.viewpoints[name];
      if (!v) throw new Error('Point de vue inconnu : ' + name);
      game.freeCamera = v;
      game.frame(FRAME, { render: false });
    },
    followPlayer() {
      game.freeCamera = null;
    },
    render() {
      const renderer = game.r.renderer;
      renderer.info.autoReset = false;
      renderer.info.reset();
      const t0 = performance.now();
      game.renderFrame(FRAME);
      renderer.getContext().finish();
      renderMs.push(performance.now() - t0);
    },
    startBot() {
      game.freeCamera = null;
      bot.start();
    },
    stopBot() {
      bot.stop();
    },
    // Joue tout l'itinéraire sans rendu. Renvoie le journal des événements.
    runRoute(maxTime = 120) {
      api.reset();
      bot.start();
      let t = 0;
      while (t < maxTime && game.state !== 'finished') {
        api.step(FRAME);
        t += FRAME;
      }
      bot.stop();
      return { finished: game.state === 'finished', time: t, orbs: game.collected, events: game.events.slice() };
    },
    state() {
      const p = game.player;
      return {
        t: game.simTime,
        pos: [p.pos.x, p.pos.y, p.pos.z],
        vel: [p.vel.x, p.vel.y, p.vel.z],
        speed: p.speed,
        mode: p.mode,
        yaw: p.yaw,
        pitch: p.pitch,
        state: game.state,
        orbs: game.collected,
        checkpoint: game.checkpoint?.name,
        botIndex: bot.index,
      };
    },
    stats() {
      const info = game.r.renderer.info;
      const avg = renderMs.length ? renderMs.reduce((a, b) => a + b, 0) / renderMs.length : 0;
      return { calls: info.render.calls, triangles: info.render.triangles, geometries: info.memory.geometries, textures: info.memory.textures, avgRenderMs: avg, renders: renderMs.length };
    },
  };
  window.__aube = api;
  return api;
}
