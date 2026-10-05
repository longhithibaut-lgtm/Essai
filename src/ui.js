// Écrans, HUD et transitions (DOM par-dessus le canvas).
//
// L'interface en jeu reste presque invisible : un point au centre, le nom du lieu
// quand on y arrive, les lueurs quand on en cueille une, et des conseils posés sur
// le monde. Les écrans (titre, pause, fin) se lisent comme des pages de livre.

const BASE_SENSITIVITY = 0.0022;
const TEST = new URLSearchParams(location.search).has('test');

// Noms des lieux, dans l'ordre des points de reprise. Le dernier point de reprise
// est toujours le jardin de la cloche, quel que soit leur nombre.
// Un point de reprise peut aussi porter son propre nom (champ « title »).
const PLACE_NAMES = ['Le seuil', 'Premières lueurs', 'L’heure bleue', 'Le ciel s’éclaire', 'Les hauteurs', 'Au-dessus des nuages', 'Le vent tiède', 'La lumière haute'];
const LAST_PLACE = 'Le jardin de la cloche';
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];

const PLACE_HOLD = 3.0; // secondes d'affichage du nom du lieu
const LIGHTS_HOLD = 3.4; // secondes d'affichage des lueurs après une cueillette

function load(key, fallback) {
  try {
    const v = localStorage.getItem('aube.' + key);
    return v === null ? fallback : JSON.parse(v);
  } catch {
    return fallback;
  }
}

function save(key, value) {
  try {
    localStorage.setItem('aube.' + key, JSON.stringify(value));
  } catch {
    /* stockage indisponible : on continue sans */
  }
}

export function formatTime(t) {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(2)}`;
}

// Durée en langage courant : « 1 min 24 s », « 48 s ».
export function formatDuration(t) {
  const total = Math.max(0, Math.round(t));
  const m = Math.floor(total / 60);
  const s = total % 60;
  if (m === 0) return `${s} s`;
  return s === 0 ? `${m} min` : `${m} min ${s < 10 ? '0' : ''}${s} s`;
}

function lightsPhrase(n, total) {
  if (n === 0) return 'Aucune lueur pour l’instant';
  if (n === total) return `Les ${total} lueurs, toutes`;
  return `${n} ${n > 1 ? 'lueurs' : 'lueur'} sur ${total}`;
}

export class UI {
  constructor(game) {
    this.game = game;
    const $ = (id) => document.getElementById(id);
    this.el = {
      body: document.body,
      veil: $('veil'),
      hud: $('hud'),
      title: $('title'),
      pause: $('pause'),
      end: $('end'),
      sheet: $('sheet'),
      start: $('start-btn'),
      loading: $('loading'),
      resume: $('resume-btn'),
      restart: $('restart-btn'),
      again: $('again-btn'),
      home: $('home-btn'),
      sheetClose: $('sheet-close'),
      sens: $('sens'),
      vol: $('vol'),
      music: $('music'),
      sfx: $('sfx'),
      place: $('place'),
      placeNum: $('place-num'),
      placeName: $('place-name'),
      placeSub: $('place-sub'),
      lights: $('lights'),
      lightsDots: $('lights-dots'),
      orbCount: $('orb-count'),
      hint: $('hint'),
      pauseNum: $('pause-num'),
      pausePlace: $('pause-place'),
      pauseDots: $('pause-dots'),
      pauseCount: $('pause-count'),
      endTime: $('end-time'),
      endOrbs: $('end-orbs'),
      endDots: $('end-dots'),
      endBest: $('end-best'),
      endLine: $('end-line'),
      touchNote: $('touch-note'),
      toast: $('toast'),
      lock: $('lock'),
      game: $('game'),
    };

    if (TEST) document.documentElement.classList.add('is-test');

    this.current = 'title';
    this.hintTimer = 0;
    this.placeTimer = 0;
    this.lightsTimer = 0;
    this.toastTimer = 0;
    this.unlockedFor = 0;
    this.orbs = 0;
    this.total = 12;
    this._cp = undefined;
    this._respawning = false;
    this._finished = false;
    this.layout = null; // 'azerty' | 'qwerty' | null (inconnu)
    this._dotSets = [this.el.lightsDots, this.el.pauseDots, this.el.endDots];
    this._buildDots(this.total);

    this._initSettings();
    this._bindMenus();
    this._detectLayout();

    if (matchMedia('(pointer: coarse)').matches && !matchMedia('(pointer: fine)').matches) {
      this.el.touchNote.hidden = false;
    }
  }

  // ---------- Réglages ----------

  _initSettings() {
    const { game, el } = this;
    const sliders = [
      { input: el.sens, key: 'sensitivity', def: 1, fmt: (v) => v.toFixed(2).replace('.', ','), apply: (v) => { game.input.sensitivity = BASE_SENSITIVITY * v; } },
      { input: el.vol, key: 'volume', def: 0.8, fmt: (v) => `${Math.round(v * 100)} %`, apply: (v) => game.audio.setVolume(v) },
      { input: el.music, key: 'music', def: 0.8, fmt: (v) => `${Math.round(v * 100)} %`, apply: (v) => game.audio.setMusicVolume?.(v) },
      { input: el.sfx, key: 'sfx', def: 0.9, fmt: (v) => `${Math.round(v * 100)} %`, apply: (v) => game.audio.setSfxVolume?.(v) },
    ];
    for (const s of sliders) {
      const out = document.getElementById(s.input.id + '-out');
      const paint = (v) => {
        const min = parseFloat(s.input.min), max = parseFloat(s.input.max);
        s.input.style.setProperty('--fill', `${((v - min) / (max - min)) * 100}%`);
        if (out) out.textContent = s.fmt(v);
      };
      const v0 = load(s.key, s.def);
      s.input.value = v0;
      paint(v0);
      s.apply(v0);
      s.input.addEventListener('input', () => {
        const v = parseFloat(s.input.value);
        paint(v);
        s.apply(v);
        save(s.key, v);
      });
    }
  }

  // ---------- Menus ----------

  _bindMenus() {
    const { game, el } = this;
    const audio = game.audio;

    el.start.addEventListener('click', () => {
      audio.uiSelect?.();
      game.start();
    });
    el.resume.addEventListener('click', () => {
      audio.uiSelect?.();
      game.resume();
    });
    el.restart.addEventListener('click', () => {
      audio.uiSelect?.();
      this._restarting = true;
      game.restart();
      this._restarting = false;
    });
    el.again.addEventListener('click', () => {
      audio.uiSelect?.();
      game.restart();
    });
    el.home.addEventListener('click', () => {
      audio.uiBack?.();
      game.reset();
      game.state = 'title';
      this._veil([0.9, 0], 1800);
      this.screen('title');
    });

    for (const b of document.querySelectorAll('[data-open]')) {
      b.addEventListener('click', () => this.openSheet(b.dataset.open));
    }
    el.sheetClose.addEventListener('click', () => this.closeSheet());
    el.sheet.addEventListener('pointerdown', (e) => {
      if (e.target === el.sheet) this.closeSheet();
    });

    // Sons d'interface (discrets) au survol
    for (const b of document.querySelectorAll('.menu-item')) {
      b.addEventListener('pointerenter', () => {
        if (b.disabled) return;
        if (document.activeElement !== b) b.focus({ preventScroll: true });
        audio.uiHover?.();
      });
    }

    // La musique du titre commence au premier geste (règle des navigateurs).
    const wake = () => {
      if (game.state === 'title' || game.state === 'finished') audio.start();
    };
    window.addEventListener('pointerdown', wake, { passive: true });
    window.addEventListener('keydown', wake);

    window.addEventListener('keydown', (e) => this._onKey(e));

    // Juste après Échap, le navigateur refuse la capture du pointeur pendant un instant.
    document.addEventListener('pointerlockerror', () => {
      if (!TEST) this.toast('Un instant… clique encore une fois');
    });

    // Si le navigateur a refusé ou retardé la capture du pointeur, un clic la redemande.
    el.game.addEventListener('click', () => {
      if (!TEST && game.state === 'playing' && !game.input.locked) game.input.requestLock();
    });
  }

  _onKey(e) {
    if (TEST) return;
    if (e.code === 'Escape' && !this.el.sheet.hidden) {
      e.preventDefault();
      this.closeSheet();
      return;
    }
    if (e.code === 'KeyM' && !e.repeat) {
      // main.js bascule le son sur la même touche ; on lit l'état juste après.
      setTimeout(() => {
        if (this.game.audio.ctx) this.toast(this.game.audio.muted ? 'Son coupé' : 'Son rétabli');
      }, 0);
    }
    if (this.current === 'play') return;
    if (e.code === 'Enter' && this.current === 'title' && this.el.sheet.hidden && (document.activeElement === document.body || !document.activeElement)) {
      if (!this.el.start.disabled) this.el.start.click();
      return;
    }
    if (e.code === 'ArrowDown' || e.code === 'ArrowUp' || e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
      const root = !this.el.sheet.hidden ? this.el.sheet : this.el[this.current];
      if (!root) return;
      const items = [...root.querySelectorAll('.menu-item, input[type="range"]')].filter((b) => !b.disabled && b.offsetParent !== null);
      if (!items.length) return;
      const i = items.indexOf(document.activeElement);
      if (document.activeElement?.type === 'range' && (e.code === 'ArrowLeft' || e.code === 'ArrowRight')) return;
      const dir = e.code === 'ArrowDown' || e.code === 'ArrowRight' ? 1 : -1;
      const next = items[(i + dir + items.length) % items.length] || items[0];
      next.focus({ preventScroll: true });
      if (next.classList.contains('menu-item')) this.game.audio.uiHover?.();
      e.preventDefault();
    }
  }

  openSheet(view) {
    const { el } = this;
    el.sheet.dataset.view = view;
    el.sheet.hidden = false;
    this.game.audio.uiSelect?.();
    const first = el.sheet.querySelector(`.sheet-view[data-view="${view}"] input`) || el.sheetClose;
    requestAnimationFrame(() => first.focus({ preventScroll: true }));
  }

  closeSheet() {
    if (this.el.sheet.hidden) return;
    const view = this.el.sheet.dataset.view;
    this.el.sheet.hidden = true;
    this.game.audio.uiBack?.();
    const root = this.el[this.current];
    const opener = root?.querySelector(`[data-open="${view}"]`);
    if (opener) opener.focus({ preventScroll: true });
  }

  // ---------- Disposition du clavier (ZQSD ou WASD) ----------

  _detectLayout() {
    const apply = (layout) => {
      this.layout = layout;
      const map = layout === 'qwerty' ? { KeyW: 'W', KeyA: 'A', KeyS: 'S', KeyD: 'D' } : { KeyW: 'Z', KeyA: 'Q', KeyS: 'S', KeyD: 'D' };
      for (const k of document.querySelectorAll('kbd[data-code]')) {
        if (map[k.dataset.code]) k.textContent = map[k.dataset.code];
      }
    };
    try {
      const kb = navigator.keyboard;
      if (kb && kb.getLayoutMap) {
        kb.getLayoutMap().then((m) => {
          const w = m.get('KeyW');
          if (w) apply(w.toLowerCase() === 'z' ? 'azerty' : 'qwerty');
        }).catch(() => {});
      } else if (!/^fr(-FR|-BE)?$/i.test(navigator.language || '')) {
        apply('qwerty');
      }
    } catch {
      /* API absente : on garde ZQSD */
    }
  }

  // Les conseils du niveau écrivent « Z W » ; on n'affiche que la bonne touche quand on la connaît.
  _keys(html) {
    if (!this.layout) return html;
    const keep = this.layout === 'azerty' ? 'Z' : 'W';
    return html.replace(/<kbd>Z<\/kbd>\s*<kbd>W<\/kbd>/g, `<kbd>${keep}</kbd>`);
  }

  // ---------- États ----------

  ready() {
    this.el.loading.hidden = true;
    this.el.start.disabled = false;
    this._veil([1, 0], 2600, 200);
  }

  screen(name) {
    const prev = this.current;
    this.current = name;
    const { el } = this;
    el.title.hidden = name !== 'title';
    el.pause.hidden = name !== 'pause';
    el.end.hidden = name !== 'end';
    el.hud.hidden = !(name === 'play' || name === 'pause');
    el.body.dataset.screen = name;
    if (!el.sheet.hidden) el.sheet.hidden = true;

    const audio = this.game.audio;
    audio.setPaused?.(name === 'pause');

    if (name === 'play' && (prev === 'title' || prev === 'end' || this._restarting)) {
      // Le départ : un voile de lumière qui se dissipe, puis le nom du premier lieu.
      this._veil([0.92, 0], 1900);
      this._cp = undefined;
      this.hideHintNow();
      this.lightsTimer = 0;
      el.lights.classList.remove('show');
    }
    if (name === 'pause') this._fillPause();
    if (name === 'play') {
      // Sans ça, Espace (sauter) « cliquerait » encore le dernier bouton du menu.
      document.activeElement?.blur?.();
    } else if (!TEST && (name === 'pause' || name === 'end')) {
      const first = el[name].querySelector('.menu-item.primary');
      if (first) requestAnimationFrame(() => first.focus({ preventScroll: true }));
    }
  }

  _veil(frames, duration, delay = 0) {
    const v = this.el.veil;
    if (TEST || !v.animate) {
      v.classList.toggle('on', frames[frames.length - 1] > 0.5);
      return;
    }
    v.classList.remove('on');
    if (this._veilAnim) this._veilAnim.cancel();
    this._veilAnim = v.animate(frames.map((o) => ({ opacity: o })), { duration, delay, easing: 'cubic-bezier(0.25, 0.6, 0.3, 1)', fill: 'both' });
  }

  // ---------- HUD ----------

  _buildDots(total) {
    this.total = total;
    for (const set of this._dotSets) {
      if (!set) continue;
      set.textContent = '';
      for (let i = 0; i < total; i++) set.appendChild(document.createElement('i'));
    }
  }

  _paintDots(set, n, fresh = -1) {
    const dots = set.children;
    for (let i = 0; i < dots.length; i++) {
      dots[i].classList.toggle('on', i < n);
      dots[i].classList.toggle('new', i === fresh);
    }
  }

  setOrbs(n, total) {
    if (total !== this.total) this._buildDots(total);
    const prev = this.orbs;
    this.orbs = n;
    this.el.orbCount.textContent = `${n} / ${total}`;
    const fresh = n > prev ? n - 1 : -1;
    this._paintDots(this.el.lightsDots, n, fresh);
    // L'écran de fin reste à jour pendant la course ; showEnd y met les valeurs finales.
    this._paintDots(this.el.endDots, n);
    this.el.endOrbs.textContent = lightsPhrase(n, total);
    this.game.audio.setProgress?.(total ? n / total : 0);
    if (n > prev && n > 0) {
      this.el.lights.classList.add('show');
      this.lightsTimer = LIGHTS_HOLD + (n === total ? 2 : 0);
    } else if (n === 0) {
      this.el.lights.classList.remove('show');
      this.lightsTimer = 0;
    }
  }

  showHint(html, duration = 4.5) {
    this.el.hint.innerHTML = this._keys(html);
    this.el.hint.classList.add('show');
    this.hintTimer = duration;
  }

  hideHintNow() {
    this.hintTimer = 0;
    this.el.hint.classList.remove('show');
  }

  _placeIndex(cp) {
    const list = this.game.level?.checkpoints || [];
    return Math.max(0, list.indexOf(cp));
  }

  _placeName(cp) {
    if (cp?.title) return cp.title;
    const list = this.game.level?.checkpoints || [];
    const i = this._placeIndex(cp);
    if (list.length > 1 && i === list.length - 1) return LAST_PLACE;
    return PLACE_NAMES[i % PLACE_NAMES.length];
  }

  _showPlace(cp, sub = '') {
    const i = this._placeIndex(cp);
    this.el.placeNum.textContent = ROMAN[i] || String(i + 1);
    this.el.placeName.textContent = this._placeName(cp);
    this.el.placeSub.textContent = sub;
    this.el.place.classList.add('show');
    this.placeTimer = PLACE_HOLD + (sub ? 1.4 : 0);
  }

  toast(text) {
    this.el.toast.textContent = text;
    this.el.toast.classList.add('show');
    this.toastTimer = 2.2;
  }

  update(dt) {
    const { el, game } = this;
    if (this.hintTimer > 0) {
      this.hintTimer -= dt;
      if (this.hintTimer <= 0) el.hint.classList.remove('show');
    }
    if (this.placeTimer > 0) {
      this.placeTimer -= dt;
      if (this.placeTimer <= 0) el.place.classList.remove('show');
    }
    if (this.lightsTimer > 0) {
      this.lightsTimer -= dt;
      if (this.lightsTimer <= 0) el.lights.classList.remove('show');
    }
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) el.toast.classList.remove('show');
    }

    const playing = game.state === 'playing';
    if (!TEST) {
      this.unlockedFor = playing && !game.input.locked ? this.unlockedFor + dt : 0;
      const want = this.unlockedFor > 1.2;
      if (want !== el.lock.classList.contains('show')) el.lock.classList.toggle('show', want);
    }
    if (playing) {
      const sec = Math.floor(game.runTime || 0);
      if (sec !== this._sec) {
        this._sec = sec;
        el.endTime.textContent = formatDuration(sec);
      }
      // Arrivée dans un nouveau lieu (point de reprise atteint, ou départ)
      if (game.checkpoint && game.checkpoint !== this._cp) {
        const first = this._cp === undefined;
        this._cp = game.checkpoint;
        this._showPlace(game.checkpoint, first ? 'Suis les lueurs, à ton rythme' : '');
        if (!first) game.audio.place?.();
      }
      // Chute dans les nuages : un souffle doux, sans reproche
      const r = game.respawnTimer > 0;
      if (r && !this._respawning) {
        game.audio.respawn?.();
        this.hideHintNow();
      }
      this._respawning = r;
    }

    // Arrivée à la cloche : la lumière monte doucement avant l'écran de fin
    const fin = game.state === 'finished';
    if (fin && !this._finished) {
      this.hideHintNow();
      el.place.classList.remove('show');
      this.placeTimer = 0;
      if (!TEST) this._veil([0, 0.55], 2400);
    }
    this._finished = fin;
  }

  _fillPause() {
    const { el, game } = this;
    const cp = game.checkpoint;
    const i = this._placeIndex(cp);
    el.pauseNum.textContent = ROMAN[i] || String(i + 1);
    el.pausePlace.textContent = this._placeName(cp);
    this._paintDots(el.pauseDots, this.orbs);
    el.pauseCount.textContent = lightsPhrase(this.orbs, this.total);
  }

  showEnd(time, orbs, total) {
    const { el } = this;
    const best = load('best', null);
    const isBest = best === null || time < best;
    if (isBest) save('best', time);
    if (total !== this.total) this._buildDots(total);
    this._paintDots(el.endDots, orbs);
    el.endOrbs.textContent = lightsPhrase(orbs, total);
    el.endTime.textContent = formatDuration(time);
    el.endBest.textContent = best === null ? 'Ta première promenade' : isBest ? 'Ta promenade la plus fluide' : `La plus fluide : ${formatDuration(best)}`;
    el.endLine.textContent = orbs >= total
      ? 'Toutes les lueurs t’ont suivi jusqu’à la cloche. Le matin s’est levé avec toi.'
      : 'Le matin s’est levé avec toi. Quelques lueurs attendent encore, quand tu voudras.';
    this.screen('end');
    this._veil([0.55, 0], 1200);
  }
}
