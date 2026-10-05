// Clavier + souris (pointer lock). Les touches utilisent e.code, donc la position
// physique : ZQSD sur AZERTY et WASD sur QWERTY marchent tous les deux.

const BINDINGS = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  jump: ['Space'],
  slide: ['ShiftLeft', 'ShiftRight', 'ControlLeft', 'KeyC'],
};

export class Input {
  constructor(element) {
    this.element = element;
    this.state = { forward: false, back: false, left: false, right: false, jump: false, slide: false };
    this.pressed = { jump: false, slide: false }; // fronts montants, consommés par le joueur
    this.lookDX = 0;
    this.lookDY = 0;
    this.sensitivity = 0.0022;
    this.enabled = true;
    this.locked = false;
    this.listeners = { lockchange: [] };

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
    if (down && !this.state[action] && action in this.pressed) this.pressed[action] = true;
    this.state[action] = down;
  }

  // Lecture et remise à zéro du mouvement de souris accumulé.
  consumeLook() {
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
      if (k in this.pressed && v && !this.state[k]) this.pressed[k] = true;
      if (k in this.state) this.state[k] = !!v;
    }
  }

  clear() {
    for (const k of Object.keys(this.state)) this.state[k] = false;
    this.pressed.jump = false;
    this.pressed.slide = false;
  }
}
