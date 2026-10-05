// Clavier + souris (pointer lock), et manette en complément. Les touches utilisent
// e.code, donc la position physique : ZQSD sur AZERTY et WASD sur QWERTY marchent tous les deux.
//
// Ctrl n'est volontairement pas lié à la glissade : Ctrl+W (Ctrl+Z en AZERTY) ferme
// l'onglet du navigateur pendant qu'on court.

const BINDINGS = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  jump: ['Space'],
  slide: ['ShiftLeft', 'ShiftRight', 'KeyC'],
};

// Manette (disposition standard) : stick gauche pour courir, stick droit pour regarder,
// A ou LB pour sauter, B, LT ou RT pour glisser.
const PAD_JUMP = [0, 4];
const PAD_SLIDE = [1, 6, 7];
const PAD_DEAD = 0.16;
const PAD_LOOK_SPEED = 2.6; // rad/s à fond, avant la sensibilité
const BASE_SENSITIVITY = 0.0022;

function deadzone(v) {
  const a = Math.abs(v);
  if (a < PAD_DEAD) return 0;
  return Math.sign(v) * (a - PAD_DEAD) / (1 - PAD_DEAD);
}

export class Input {
  constructor(element) {
    this.element = element;
    // État fusionné (clavier ou pilote automatique + manette), lu par le joueur.
    this.state = { forward: false, back: false, left: false, right: false, jump: false, slide: false };
    this.pressed = { jump: false, slide: false }; // fronts montants, consommés par le joueur
    this.keys = { forward: false, back: false, left: false, right: false, jump: false, slide: false };
    this.pad = { jump: false, slide: false, x: 0, y: 0 };
    // Direction voulue, analogique : x vers la droite, y vers l'avant, longueur <= 1.
    this.axis = { x: 0, y: 0 };
    this.lookDX = 0;
    this.lookDY = 0;
    this.sensitivity = BASE_SENSITIVITY;
    this.enabled = true;
    this.locked = false;
    this.listeners = { lockchange: [] };
    this._padTime = 0;

    this._codes = new Map();
    for (const [action, codes] of Object.entries(BINDINGS)) {
      for (const c of codes) this._codes.set(c, action);
    }

    window.addEventListener('keydown', (e) => this._onKey(e, true));
    window.addEventListener('keyup', (e) => this._onKey(e, false));
    window.addEventListener('blur', () => this.clear());
    document.addEventListener('mousemove', (e) => {
      if (!this.locked || !this.enabled) return;
      // Ignore les sauts aberrants que certains navigateurs envoient au verrouillage.
      if (Math.abs(e.movementX) > 400 || Math.abs(e.movementY) > 400) return;
      this.lookDX += e.movementX;
      this.lookDY += e.movementY;
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.element;
      if (!this.locked) this.clear();
      for (const fn of this.listeners.lockchange) fn(this.locked);
    });
  }

  on(event, fn) {
    this.listeners[event].push(fn);
  }

  requestLock() {
    try {
      const p = this.element.requestPointerLock?.({ unadjustedMovement: true });
      if (p && p.catch) p.catch(() => this.element.requestPointerLock?.());
    } catch {
      this.element.requestPointerLock?.();
    }
  }

  exitLock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  _onKey(e, down) {
    const action = this._codes.get(e.code);
    if (!action) return;
    if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
    if (!this.enabled) return;
    this.keys[action] = down;
    this._merge();
  }

  // Fusionne clavier et manette, détecte les fronts montants et calcule l'axe analogique.
  _merge() {
    const s = this.state, k = this.keys, p = this.pad;
    const jump = k.jump || p.jump;
    const slide = k.slide || p.slide;
    if (jump && !s.jump) this.pressed.jump = true;
    if (slide && !s.slide) this.pressed.slide = true;
    s.jump = jump;
    s.slide = slide;
    // Le stick compte aussi comme des touches pour le code qui lit l'état booléen.
    s.forward = k.forward || p.y > 0.5;
    s.back = k.back || p.y < -0.5;
    s.right = k.right || p.x > 0.5;
    s.left = k.left || p.x < -0.5;

    let x = (k.right ? 1 : 0) - (k.left ? 1 : 0) + p.x;
    let y = (k.forward ? 1 : 0) - (k.back ? 1 : 0) + p.y;
    const l = Math.hypot(x, y);
    if (l > 1) { x /= l; y /= l; }
    this.axis.x = x;
    this.axis.y = y;
  }

  _pollPad() {
    let pads = null;
    try {
      pads = navigator.getGamepads ? navigator.getGamepads() : null;
    } catch {
      pads = null; // manette interdite par la politique de la page : clavier et souris seulement
    }
    const now = performance.now();
    const dt = this._padTime ? Math.min(0.1, (now - this._padTime) / 1000) : 0;
    this._padTime = now;
    let gp = null;
    if (pads) for (const g of pads) if (g && g.connected && g.mapping === 'standard') { gp = g; break; }
    const p = this.pad;
    if (!gp || !this.enabled) {
      if (p.jump || p.slide || p.x || p.y) {
        p.jump = p.slide = false;
        p.x = p.y = 0;
        this._merge();
      }
      return;
    }
    const btn = (list) => list.some((i) => gp.buttons[i] && (gp.buttons[i].pressed || gp.buttons[i].value > 0.4));
    p.jump = btn(PAD_JUMP);
    p.slide = btn(PAD_SLIDE);
    p.x = deadzone(gp.axes[0] || 0);
    p.y = -deadzone(gp.axes[1] || 0);
    // Regard : courbe douce (précision au centre), exprimé en « pixels » de souris
    // pour que le réglage de sensibilité s'applique aussi à la manette.
    const lx = deadzone(gp.axes[2] || 0), ly = deadzone(gp.axes[3] || 0);
    const scale = (PAD_LOOK_SPEED * dt) / BASE_SENSITIVITY;
    this.lookDX += Math.sign(lx) * lx * lx * scale;
    this.lookDY += Math.sign(ly) * ly * ly * scale * 0.7;
    this._merge();
  }

  // Lecture et remise à zéro du mouvement de souris accumulé (appelé à chaque image).
  consumeLook() {
    this._pollPad();
    const dx = this.lookDX * this.sensitivity;
    const dy = this.lookDY * this.sensitivity;
    this.lookDX = 0;
    this.lookDY = 0;
    return [dx, dy];
  }

  consumePressed(action) {
    const v = this.pressed[action];
    this.pressed[action] = false;
    return v;
  }

  // Utilisé par le mode test et le pilote automatique.
  set(partial) {
    for (const [k, v] of Object.entries(partial)) {
      if (k in this.keys) this.keys[k] = !!v;
    }
    this._merge();
  }

  clear() {
    for (const k of Object.keys(this.keys)) this.keys[k] = false;
    this.pad.jump = this.pad.slide = false;
    this.pad.x = this.pad.y = 0;
    for (const k of Object.keys(this.state)) this.state[k] = false;
    this.axis.x = this.axis.y = 0;
    this.pressed.jump = false;
    this.pressed.slide = false;
  }
}
